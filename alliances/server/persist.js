/*
 * persist.js — debounced atomic room snapshots so interrupted games survive
 * server restarts (and Railway redeploys are lossless).
 *
 * - markDirty(room): write at most once per 500ms per room (trailing write)
 * - atomic tmp+rename so a crash mid-write never corrupts a snapshot
 * - sync flush on round start/end and SIGTERM
 * - boot restore drops stale (>24h) or unparseable files and marks everyone
 *   disconnected (their sockets did not survive the restart)
 */
"use strict";

var fs = require("fs");
var path = require("path");

var BASE_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "alliances")
  : path.join(__dirname, "..", "data");
var ROOMS_DIR = path.join(BASE_DIR, "rooms");

var DEBOUNCE_MS = 500;
var STALE_MS = 24 * 60 * 60 * 1000;

var timers = new Map(); // roomCode -> { timer, room }

function ensureDirs() {
  try {
    if (!fs.existsSync(ROOMS_DIR)) fs.mkdirSync(ROOMS_DIR, { recursive: true });
  } catch (e) {
    console.warn("[persist] could not create data dir:", e.message);
  }
}

function fileFor(code) {
  return path.join(ROOMS_DIR, code + ".json");
}

function writeSync(room) {
  try {
    ensureDirs();
    room.savedAt = Date.now();
    var file = fileFor(room.roomCode);
    var tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(room), "utf8");
    fs.renameSync(tmp, file); // atomic on the same volume
    return true;
  } catch (e) {
    // Volume mounts can flake — log and keep playing rather than crash.
    console.warn("[persist] write failed for " + room.roomCode + ":", e.message);
    return false;
  }
}

function markDirty(room) {
  var code = room.roomCode;
  if (timers.has(code)) return; // a write is already scheduled
  var entry = {
    room: room,
    timer: setTimeout(function () {
      timers.delete(code);
      writeSync(room);
    }, DEBOUNCE_MS)
  };
  if (entry.timer.unref) entry.timer.unref();
  timers.set(code, entry);
}

function flushSync(room) {
  var entry = timers.get(room.roomCode);
  if (entry) {
    clearTimeout(entry.timer);
    timers.delete(room.roomCode);
  }
  return writeSync(room);
}

// SIGTERM path: flush every room with a pending debounced write.
function flushAllSync() {
  var pending = Array.from(timers.values());
  timers.forEach(function (entry) { clearTimeout(entry.timer); });
  timers.clear();
  var count = 0;
  pending.forEach(function (entry) { if (writeSync(entry.room)) count++; });
  return count;
}

function deleteSnapshot(code) {
  var entry = timers.get(code);
  if (entry) {
    clearTimeout(entry.timer);
    timers.delete(code);
  }
  try {
    var file = fileFor(code);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (e) {
    console.warn("[persist] delete failed for " + code + ":", e.message);
  }
}

function restoreAll() {
  ensureDirs();
  var restored = [];
  var files = [];
  try {
    files = fs.readdirSync(ROOMS_DIR).filter(function (f) { return /\.json$/.test(f); });
  } catch (e) {
    console.warn("[persist] could not read rooms dir:", e.message);
    return restored;
  }
  var now = Date.now();
  files.forEach(function (f) {
    var file = path.join(ROOMS_DIR, f);
    var room = null;
    try {
      room = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      console.warn("[persist] dropping unparseable snapshot " + f + ":", e.message);
      try { fs.unlinkSync(file); } catch (e2) {}
      return;
    }
    if (!room || !room.roomCode || !Array.isArray(room.players) ||
        now - (room.savedAt || 0) > STALE_MS) {
      console.log("[persist] dropping stale snapshot " + f);
      try { fs.unlinkSync(file); } catch (e3) {}
      return;
    }
    // Nobody's socket survived the restart.
    room.players.forEach(function (p) {
      p.connected = false;
      p.disconnectedAt = now;
    });
    room.emptySince = now;
    // Migration: pre-expiry-ruling snapshots may hold a "deferred" offer —
    // a status no sweeper touches anymore. Void it or it lives forever.
    if (room.round && room.round.offers) {
      for (var oid in room.round.offers) {
        if (room.round.offers[oid].status === "deferred") {
          room.round.offers[oid].status = "voided";
        }
      }
    }
    // Migration: playtest-revision fields. Old rounds tracked hasAttacked
    // (boolean) and had no turnOrder — restoring them unmigrated would make
    // the attack counter NaN and crash the turn advance.
    if (room.round && room.round.turn && typeof room.round.turn.attacksMade !== "number") {
      room.round.turn.attacksMade = room.round.turn.hasAttacked ? 1 : 0;
      delete room.round.turn.hasAttacked;
    }
    if (room.round && !Array.isArray(room.round.turnOrder)) {
      var order = [];
      room.players.forEach(function (p) { order.push(p.seat); });
      room.round.turnOrder = order;
    }
    if (!room.settings.pointsScheme) room.settings.pointsScheme = "equal";
    room.players.forEach(function (p) {
      if (typeof p.colorIndex !== "number") p.colorIndex = p.seat;
      if (!p.isBot && !p.playerCode) p.playerCode = null; // assigned below, after insert
      if (!Array.isArray(p.pushSubs)) p.pushSubs = [];
      if (typeof p.notifyOptIn !== "boolean") p.notifyOptIn = false;
    });
    restored.push(room);
  });
  return restored;
}

module.exports = {
  markDirty: markDirty,
  flushSync: flushSync,
  flushAllSync: flushAllSync,
  deleteSnapshot: deleteSnapshot,
  restoreAll: restoreAll,
  writeSync: writeSync,
  BASE_DIR: BASE_DIR,
  ROOMS_DIR: ROOMS_DIR,
  DEBOUNCE_MS: DEBOUNCE_MS
};

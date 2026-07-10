/*
 * rooms.js — room registry, seats, tokens, host migration, GC.
 * Pure data + bookkeeping: no sockets, no game rules. The room object is the
 * snapshot persist.js writes to disk, so everything here must stay JSON-safe.
 */
"use strict";

var crypto = require("crypto");
var CONST = require("../public/js/const.js");

// No look-alike characters (I, O, 0, 1, L) so codes survive being read aloud.
// 3 chars = 32^3 = 32,768 codes — plenty for a family-scale server, and short
// enough to shout across a room (designer request).
var CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var CODE_LENGTH = 3;
var LOBBY_GC_MS = 15 * 60 * 1000;      // empty lobby: 15 minutes
var GAME_GC_MS = 24 * 60 * 60 * 1000;  // abandoned game: 24 hours
var LOG_CAP = 100;

var registry = new Map(); // roomCode -> room

function genRoomCode() {
  var code = "";
  for (var i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

function genToken() {
  return crypto.randomBytes(16).toString("hex");
}

function sanitizeName(raw, fallback) {
  var s = String(raw == null ? "" : raw)
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return fallback;
  return s.slice(0, CONST.MAX_NAME_LEN);
}

// Duplicate display names get a " (2)" suffix instead of a rejection —
// friends named Mike shouldn't have to negotiate over who renames.
function uniqueName(room, base) {
  var taken = {};
  room.players.forEach(function (p) { taken[p.name] = true; });
  if (!taken[base]) return base;
  for (var i = 2; i < 100; i++) {
    var suffix = " (" + i + ")";
    var candidate = base.slice(0, CONST.MAX_NAME_LEN - suffix.length) + suffix;
    if (!taken[candidate]) return candidate;
  }
  return base + "#" + crypto.randomInt(1000);
}

function getPlayer(room, seat) {
  for (var i = 0; i < room.players.length; i++) {
    if (room.players[i].seat === seat) return room.players[i];
  }
  return null;
}

// Structured log: kind + data, rendered to text client-side. Capped so
// snapshots and rejoin payloads stay small.
function pushLog(room, kind, data) {
  room.log.push({
    t: Date.now(),
    turnNumber: room.round && room.round.turn ? room.round.turn.turnNumber : 0,
    kind: kind,
    data: data
  });
  if (room.log.length > LOG_CAP) room.log.splice(0, room.log.length - LOG_CAP);
}

function makePlayer(seat, name, isBot) {
  return {
    seat: seat,
    name: name,
    token: genToken(),       // SECRET — never serialized to clients
    playerCode: null,        // humans get a 3-char re-entry code (assigned on seat)
    isBot: !!isBot,          // bots have no socket and are always "connected"
    colorIndex: seat,        // banner color — players may swap in the lobby
    connected: true,
    disconnectedAt: null,
    eliminated: false,
    allianceId: null,
    winPoints: 0,
    notifyOptIn: false,      // opt-in turn/offer notifications
    pushSubs: []             // web-push subscriptions (multi-device)
  };
}

// Lowest banner color not already flying in this room.
function freeColorIndex(room) {
  var taken = {};
  room.players.forEach(function (p) { taken[p.colorIndex] = true; });
  for (var i = 0; i < 6; i++) if (!taken[i]) return i;
  return 0;
}

/*
 * 3-char personal re-entry code, unique across every live player on the
 * server (games run for weeks — the code is how you come back from any
 * device). Same look-alike-free alphabet as room codes; also avoids clashing
 * with a live ROOM code so one landing-page input could take either.
 */
function genPlayerCode() {
  for (var attempt = 0; attempt < 200; attempt++) {
    var code = "";
    for (var i = 0; i < 3; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (registry.has(code)) continue;
    if (findByPlayerCode(code)) continue;
    return code;
  }
  return null; // ~32k codespace exhausted — realistically unreachable
}

function findByPlayerCode(code) {
  if (!code || typeof code !== "string") return null;
  var needle = code.toUpperCase();
  var hit = null;
  registry.forEach(function (room) {
    if (hit) return;
    for (var i = 0; i < room.players.length; i++) {
      if (room.players[i].playerCode === needle) { hit = { room: room, player: room.players[i] }; return; }
    }
  });
  return hit;
}

// AI commander names — assigned in order, uniqueName() suffixes on collision.
var BOT_NAMES = [
  "Warlord Kryx", "General Vosk", "Marshal Enna", "Praetor Sil",
  "Khan Bruma", "Admiral Wren", "Baroness Vale", "Strategos Mira",
  "Overseer Thane", "Chancellor Odo"
];

function createRoom(rawName) {
  var code = null;
  for (var i = 0; i < 50 && !code; i++) {
    var c = genRoomCode();
    // Room codes and player codes share one 3-char namespace, so a single
    // landing-page input can take either — keep them disjoint from BOTH sides.
    if (!registry.has(c) && !findByPlayerCode(c)) code = c;
  }
  if (!code) return null; // 32k codespace exhausted — realistically unreachable
  var player = makePlayer(0, sanitizeName(rawName, "Commander"));
  var room = {
    roomCode: code,
    phase: "lobby", // lobby | playing | round_end
    hostSeat: 0,
    creatorToken: player.token, // original host reclaims hosting on return
    settings: { mapId: "hexfield", playerCount: 2, pointsScheme: "equal" },
    players: [player],
    round: null,
    log: [],
    playerCountLocked: false, // locked after the first round starts
    emptySince: null,         // timestamp when the last connected player dropped
    createdAt: Date.now()
  };
  registry.set(code, room);
  // AFTER registration so the creator's personal code can't collide with the
  // just-created room's own code.
  player.playerCode = genPlayerCode();
  return { room: room, player: player };
}

function addPlayer(room, rawName) {
  // Fresh joins are allowed in the lobby and BETWEEN rounds (a vacated seat must be
  // refillable or PLAY AGAIN could never gather a full table). Mid-round = rejoin-only.
  if (room.phase !== "lobby" && room.phase !== "round_end") return { ok: false, reason: "GAME_IN_PROGRESS" };
  if (room.players.length >= room.settings.playerCount) return { ok: false, reason: "ROOM_FULL" };
  // Lowest free seat — players who leave the lobby free their seat (and color).
  var seat = 0;
  while (getPlayer(room, seat)) seat++;
  var name = uniqueName(room, sanitizeName(rawName, "Commander " + (seat + 1)));
  var player = makePlayer(seat, name);
  player.playerCode = genPlayerCode();
  player.colorIndex = freeColorIndex(room);
  room.players.push(player);
  room.players.sort(function (a, b) { return a.seat - b.seat; });
  room.emptySince = null;
  recomputeHost(room);
  return { ok: true, player: player };
}

function removePlayer(room, seat) {
  var idx = room.players.findIndex(function (p) { return p.seat === seat; });
  if (idx === -1) return false;
  room.players.splice(idx, 1);
  recomputeHost(room);
  updateEmptySince(room, Date.now());
  return true;
}

// Host adds an AI commander to the lowest free seat (same phase rules as a join).
function addBot(room) {
  if (room.phase !== "lobby" && room.phase !== "round_end") return { ok: false, reason: "GAME_IN_PROGRESS" };
  if (room.players.length >= room.settings.playerCount) return { ok: false, reason: "ROOM_FULL" };
  var seat = 0;
  while (getPlayer(room, seat)) seat++;
  var botCount = room.players.filter(function (p) { return p.isBot; }).length;
  var name = uniqueName(room, BOT_NAMES[botCount % BOT_NAMES.length]);
  var player = makePlayer(seat, name, true);
  player.colorIndex = freeColorIndex(room);
  room.players.push(player);
  room.players.sort(function (a, b) { return a.seat - b.seat; });
  return { ok: true, player: player };
}

function findByToken(room, token) {
  if (!token || typeof token !== "string") return null;
  for (var i = 0; i < room.players.length; i++) {
    if (room.players[i].token === token) return room.players[i];
  }
  return null;
}

function updateEmptySince(room, now) {
  // Bots are always "connected" but must never hold a room alive — a table
  // of abandoned AIs is still an abandoned table.
  var anyConnected = room.players.some(function (p) { return p.connected && !p.isBot; });
  room.emptySince = anyConnected ? null : (room.emptySince || now);
}

function setConnected(room, seat, connected, now) {
  var p = getPlayer(room, seat);
  if (!p) return { hostChanged: false };
  now = now || Date.now();
  p.connected = connected;
  p.disconnectedAt = connected ? null : now;
  updateEmptySince(room, now);
  var hostChanged = recomputeHost(room);
  return { hostChanged: hostChanged };
}

/*
 * Host preference order: the original creator while connected (so they reclaim
 * hosting when they return), else the lowest connected seat, else keep current.
 */
function recomputeHost(room) {
  var prev = room.hostSeat;
  var creator = null;
  for (var i = 0; i < room.players.length; i++) {
    if (room.players[i].token === room.creatorToken) { creator = room.players[i]; break; }
  }
  if (creator && creator.connected) {
    room.hostSeat = creator.seat;
  } else {
    // Never migrate hosting to a bot — bots can't click START WAR.
    var connected = room.players.filter(function (p) { return p.connected && !p.isBot; });
    if (connected.length) room.hostSeat = connected[0].seat; // players sorted by seat
  }
  // Safety: never leave hostSeat pointing at a removed player.
  if (!getPlayer(room, room.hostSeat) && room.players.length) {
    room.hostSeat = room.players[0].seat;
  }
  return room.hostSeat !== prev;
}

function get(code) {
  return registry.get(code) || null;
}

function insert(room) {
  registry.set(room.roomCode, room);
}

function destroy(code) {
  var room = registry.get(code);
  registry.delete(code);
  return room || null;
}

function all() {
  return Array.from(registry.values());
}

// Returns the codes of rooms reaped this sweep (caller deletes snapshots/sockets).
function gcSweep(now) {
  var dead = [];
  registry.forEach(function (room, code) {
    if (room.players.length === 0) { dead.push(code); return; }
    if (!room.emptySince) return;
    var limit = room.phase === "lobby" ? LOBBY_GC_MS : GAME_GC_MS;
    if (now - room.emptySince >= limit) dead.push(code);
  });
  dead.forEach(function (code) { registry.delete(code); });
  return dead;
}

module.exports = {
  createRoom: createRoom,
  addPlayer: addPlayer,
  addBot: addBot,
  removePlayer: removePlayer,
  findByToken: findByToken,
  findByPlayerCode: findByPlayerCode,
  genPlayerCode: genPlayerCode,
  freeColorIndex: freeColorIndex,
  setConnected: setConnected,
  recomputeHost: recomputeHost,
  getPlayer: getPlayer,
  pushLog: pushLog,
  sanitizeName: sanitizeName,
  uniqueName: uniqueName,
  get: get,
  insert: insert,
  destroy: destroy,
  all: all,
  gcSweep: gcSweep,
  LOBBY_GC_MS: LOBBY_GC_MS,
  GAME_GC_MS: GAME_GC_MS
};

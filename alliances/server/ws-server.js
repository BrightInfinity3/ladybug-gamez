/*
 * ws-server.js — the thin router. Parses messages, looks up room + seat by
 * socket, calls the engine, broadcasts the resulting events. All rules live in
 * engine/offers; all serialization goes through engine.serializeFor.
 */
"use strict";

var WebSocket = require("ws");
var CONST = require("../public/js/const.js");
var roomsMod = require("./rooms.js");
var engine = require("./engine.js");
var persist = require("./persist.js");
var bots = require("./bots.js");
var push = require("./push.js");

var HEARTBEAT_MS = 10000;
var GC_INTERVAL_MS = 60000;
var MAX_PAYLOAD = 16 * 1024;

var ENGINE_ACTIONS = {
  set_settings: true, start_round: true,
  offer_alliance: true, request_join: true, respond_offer: true,
  rescind_offer: true, propose_rename: true,
  defect: true, attack: true, end_turn: true,
  force_end_turn: true, abort_round: true
};

function attach(httpServer, opts) {
  // noServer mode: on a shared host with MULTIPLE WebSocket servers (e.g. the
  // Ladybug hub at /ws plus this game at /alliances/ws), the caller must route
  // 'upgrade' events itself — two ws instances bound with {server, path} each
  // abort the other's upgrades with HTTP 400.
  var wss = (opts && opts.noServer)
    ? new WebSocket.Server({ noServer: true, maxPayload: MAX_PAYLOAD })
    : new WebSocket.Server({
        server: httpServer,
        path: (opts && opts.path) || CONST.WS_PATH,
        maxPayload: MAX_PAYLOAD
      });

  // roomCode -> Map(seat -> ws). Kept here so room objects stay JSON-safe.
  var socketsByRoom = new Map();

  function log() {
    var args = ["[alliances-ws]", new Date().toISOString()];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    console.log.apply(console, args);
  }

  function safeSend(ws, type, data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify({ type: type, data: data == null ? {} : data }));
      return true;
    } catch (e) {
      log("send failed:", e.message);
      return false;
    }
  }

  function bind(ws, roomCode, seat) {
    if (!socketsByRoom.has(roomCode)) socketsByRoom.set(roomCode, new Map());
    socketsByRoom.get(roomCode).set(seat, ws);
    ws._roomCode = roomCode;
    ws._seat = seat;
  }

  function unbind(ws) {
    var code = ws._roomCode;
    var seat = ws._seat;
    ws._roomCode = null;
    ws._seat = null;
    if (code == null || seat == null) return;
    var seats = socketsByRoom.get(code);
    if (seats && seats.get(seat) === ws) {
      seats.delete(seat);
      if (seats.size === 0) socketsByRoom.delete(code);
    }
  }

  function sockFor(roomCode, seat) {
    var seats = socketsByRoom.get(roomCode);
    return seats ? seats.get(seat) || null : null;
  }

  function sendToSeat(room, seat, type, data) {
    safeSend(sockFor(room.roomCode, seat), type, data);
  }

  function broadcast(room, type, data) {
    room.players.forEach(function (p) {
      sendToSeat(room, p.seat, type, data);
    });
  }

  // Engine events -> sockets. Personalized events (withState) get a fresh
  // serializeFor per recipient — the single chokepoint keeps tokens and
  // foreign offers out of every payload.
  function dispatch(room, events) {
    events.forEach(function (ev) {
      var targets = ev.to || room.players.map(function (p) { return p.seat; });
      targets.forEach(function (seat) {
        var data = ev.data || {};
        if (ev.withState) {
          data = Object.assign({}, data, { state: engine.serializeFor(room, seat) });
        }
        sendToSeat(room, seat, ev.type, data);
      });
    });
    // Opted-in, DISCONNECTED humans get a push for the moments that matter
    // (their turn, an incoming offer, round end). Connected clients handle
    // their own local notifications instead.
    try { push.considerNotify(room, events, roomsMod.getPlayer); } catch (e) { log("push error:", e.message); }
  }

  function reject(ws, reqId, command, code, message) {
    safeSend(ws, "action_rejected", {
      reqId: reqId == null ? null : reqId,
      command: command,
      code: code,
      message: message
    });
  }

  function roomOf(ws) {
    return ws._roomCode != null ? roomsMod.get(ws._roomCode) : null;
  }

  // -------------------------------------------------------------------------
  // Pre-room handlers
  // -------------------------------------------------------------------------

  function onCreateRoom(ws, data, reqId) {
    if (roomOf(ws)) return reject(ws, reqId, "create_room", "ALREADY_IN_ROOM", "Leave your current room first.");
    var created = roomsMod.createRoom(data && data.name);
    if (!created) return reject(ws, reqId, "create_room", "SERVER_ERROR", "Could not allocate a room code.");
    var room = created.room;
    bind(ws, room.roomCode, created.player.seat);
    safeSend(ws, "room_created", {
      roomCode: room.roomCode,
      seat: created.player.seat,
      token: created.player.token
    });
    safeSend(ws, "lobby_update", engine.lobbySnapshot(room));
    persist.markDirty(room);
    log("room " + room.roomCode + " created by '" + created.player.name + "'");
  }

  function onJoinRoom(ws, data, reqId) {
    if (roomOf(ws)) return reject(ws, reqId, "join_room", "ALREADY_IN_ROOM", "Leave your current room first.");
    var code = String(data && data.roomCode || "").trim().toUpperCase();
    var room = roomsMod.get(code);
    if (!room) return safeSend(ws, "join_failed", { reason: "ROOM_NOT_FOUND" });
    var res = roomsMod.addPlayer(room, data && data.name);
    if (!res.ok) return safeSend(ws, "join_failed", { reason: res.reason });
    bind(ws, code, res.player.seat);
    safeSend(ws, "room_joined", {
      roomCode: code,
      seat: res.player.seat,
      token: res.player.token,
      state: engine.serializeFor(room, res.player.seat)
    });
    broadcast(room, "lobby_update", engine.lobbySnapshot(room));
    persist.markDirty(room);
    log("'" + res.player.name + "' joined " + code + " (seat " + res.player.seat + ")");
  }

  function onRejoin(ws, data, reqId) {
    if (roomOf(ws)) return reject(ws, reqId, "rejoin", "ALREADY_IN_ROOM", "Already attached to a room.");
    var code = String(data && data.roomCode || "").trim().toUpperCase();
    var room = roomsMod.get(code);
    if (!room) return safeSend(ws, "join_failed", { reason: "ROOM_NOT_FOUND" });
    var player = roomsMod.findByToken(room, data && data.token);
    if (!player) return safeSend(ws, "join_failed", { reason: "BAD_TOKEN" });

    // Duplicate-tab guard: the newest socket wins, the zombie is terminated.
    // bind() replaces the map entry first so the zombie's close handler sees
    // the mismatch and does NOT mark the player disconnected.
    var old = sockFor(code, player.seat);
    bind(ws, code, player.seat);
    if (old && old !== ws) {
      try { old.close(4000, "replaced by new connection"); } catch (e) {}
    }

    var conn = roomsMod.setConnected(room, player.seat, true);
    safeSend(ws, "room_joined", {
      roomCode: code,
      seat: player.seat,
      token: player.token,
      state: engine.serializeFor(room, player.seat)
    });
    broadcast(room, "player_connection", { seat: player.seat, connected: true });
    if (room.phase === "lobby" || conn.hostChanged) {
      broadcast(room, "lobby_update", engine.lobbySnapshot(room));
    }
    persist.markDirty(room);
    log("'" + player.name + "' rejoined " + code + " (seat " + player.seat + ")");
  }

  // -------------------------------------------------------------------------
  // In-room handlers
  // -------------------------------------------------------------------------

  function onLeaveRoom(ws, room, reqId) {
    // Leaving is legal in the lobby and between rounds; mid-round you can only
    // disconnect (and rejoin later) so a round can never lose a seated player.
    if (room.phase !== "lobby" && room.phase !== "round_end") {
      return reject(ws, reqId, "leave_room", "BAD_PHASE", "You can only leave between rounds. Ask the host to disband.");
    }
    var seat = ws._seat;
    unbind(ws);
    roomsMod.removePlayer(room, seat);
    var humansLeft = room.players.some(function (p) { return !p.isBot; });
    if (room.players.length === 0 || !humansLeft) {
      roomsMod.destroy(room.roomCode);
      persist.deleteSnapshot(room.roomCode);
      bots.reset(room.roomCode);
      log("room " + room.roomCode + " empty - destroyed");
      return;
    }
    broadcast(room, "lobby_update", engine.lobbySnapshot(room));
    persist.markDirty(room);
  }

  function onDisbandRoom(ws, room, reqId) {
    if (ws._seat !== room.hostSeat) {
      return reject(ws, reqId, "disband_room", "NOT_HOST", "Only the host can disband the room.");
    }
    broadcast(room, "room_disbanded", { reason: "The host disbanded the war room." });
    room.players.forEach(function (p) {
      var sock = sockFor(room.roomCode, p.seat);
      if (sock) unbind(sock);
    });
    socketsByRoom.delete(room.roomCode);
    roomsMod.destroy(room.roomCode);
    persist.deleteSnapshot(room.roomCode);
    bots.reset(room.roomCode);
    log("room " + room.roomCode + " disbanded by host");
  }

  function onEngineAction(ws, room, type, data, reqId) {
    var seat = ws._seat;
    var prevPhase = room.phase;
    var result = engine.handle(room, seat, type, data);
    if (!result.ok) return reject(ws, reqId, type, result.code, result.message);

    dispatch(room, result.events);
    // Round boundaries get an immediate snapshot; everything else debounces.
    var crossedBoundary = type === "start_round" ||
      (prevPhase === "playing" && room.phase === "round_end");
    if (crossedBoundary) persist.flushSync(room);
    else persist.markDirty(room);
  }

  // Bot actions flow through the exact same engine/dispatch/persist path as a
  // human's — the only difference is who decided.
  function actAsBot(room, seat, type, data) {
    var prevPhase = room.phase;
    var result = engine.handle(room, seat, type, data);
    if (!result.ok) {
      log("bot action rejected: seat " + seat + " " + type + " -> " + result.code);
      return result;
    }
    dispatch(room, result.events);
    if (prevPhase === "playing" && room.phase === "round_end") persist.flushSync(room);
    else persist.markDirty(room);
    return result;
  }

  function onAddBot(ws, room, reqId) {
    if (ws._seat !== room.hostSeat) {
      return reject(ws, reqId, "add_bot", "NOT_HOST", "Only the host can add AI commanders.");
    }
    var res = roomsMod.addBot(room);
    if (!res.ok) {
      return reject(ws, reqId, "add_bot", res.reason,
        res.reason === "ROOM_FULL" ? "All seats are filled." : "AI can only be added between rounds.");
    }
    broadcast(room, "lobby_update", engine.lobbySnapshot(room));
    persist.markDirty(room);
    log("bot '" + res.player.name + "' added to " + room.roomCode + " (seat " + res.player.seat + ")");
  }

  function onRemoveBot(ws, room, data, reqId) {
    if (ws._seat !== room.hostSeat) {
      return reject(ws, reqId, "remove_bot", "NOT_HOST", "Only the host can remove AI commanders.");
    }
    if (room.phase !== "lobby" && room.phase !== "round_end") {
      return reject(ws, reqId, "remove_bot", "BAD_PHASE", "AI can only be removed between rounds.");
    }
    var seat = data ? data.seat : null;
    var p = roomsMod.getPlayer(room, seat);
    if (!p || !p.isBot) {
      return reject(ws, reqId, "remove_bot", "BAD_TARGET", "That seat is not an AI commander.");
    }
    roomsMod.removePlayer(room, seat);
    broadcast(room, "lobby_update", engine.lobbySnapshot(room));
    persist.markDirty(room);
  }

  // Banner colors are picked between rounds: your own seat, or (host) a bot's.
  function onPickColor(ws, room, data, reqId) {
    if (room.phase !== "lobby" && room.phase !== "round_end") {
      return reject(ws, reqId, "pick_color", "BAD_PHASE", "Colors are chosen between rounds.");
    }
    var idx = data ? data.colorIndex : null;
    if (!Number.isInteger(idx) || idx < 0 || idx > 5) {
      return reject(ws, reqId, "pick_color", "BAD_REQUEST", "colorIndex must be 0-5.");
    }
    var seat = data && Number.isInteger(data.seat) ? data.seat : ws._seat;
    var target = roomsMod.getPlayer(room, seat);
    if (!target) return reject(ws, reqId, "pick_color", "BAD_TARGET", "No commander in that seat.");
    if (seat !== ws._seat && !(ws._seat === room.hostSeat && target.isBot)) {
      return reject(ws, reqId, "pick_color", "NOT_YOURS", "You can only recolor your own banner (hosts may recolor AIs).");
    }
    var clash = room.players.some(function (p) { return p.seat !== seat && p.colorIndex === idx; });
    if (clash) return reject(ws, reqId, "pick_color", "COLOR_TAKEN", "Another commander already flies that color.");
    target.colorIndex = idx;
    broadcast(room, "lobby_update", engine.lobbySnapshot(room));
    persist.markDirty(room);
  }

  function onRenameBot(ws, room, data, reqId) {
    if (ws._seat !== room.hostSeat) {
      return reject(ws, reqId, "rename_bot", "NOT_HOST", "Only the host can rename AI commanders.");
    }
    if (room.phase !== "lobby" && room.phase !== "round_end") {
      return reject(ws, reqId, "rename_bot", "BAD_PHASE", "AI can only be renamed between rounds.");
    }
    var seat = data ? data.seat : null;
    var p = roomsMod.getPlayer(room, seat);
    if (!p || !p.isBot) {
      return reject(ws, reqId, "rename_bot", "BAD_TARGET", "That seat is not an AI commander.");
    }
    var name = roomsMod.sanitizeName(data && data.name, "");
    if (!name) return reject(ws, reqId, "rename_bot", "BAD_NAME", "Give the commander a name.");
    p.name = roomsMod.uniqueName(room, name);
    broadcast(room, "lobby_update", engine.lobbySnapshot(room));
    persist.markDirty(room);
  }

  // Personal re-entry: a human types their own 3-char code on ANY device and
  // lands back in their seat — this is how a weeks-long game is picked up.
  function onReenter(ws, data, reqId) {
    if (roomOf(ws)) return reject(ws, reqId, "reenter", "ALREADY_IN_ROOM", "Already attached to a room.");
    var hit = roomsMod.findByPlayerCode(data && data.playerCode);
    if (!hit || hit.player.isBot) {
      // Personal codes hand over a session token — a 32k codespace must not
      // be enumerable. A handful of typos is human; more is a scanner.
      ws._reenterMisses = (ws._reenterMisses || 0) + 1;
      safeSend(ws, "join_failed", { reason: "CODE_NOT_FOUND" });
      if (ws._reenterMisses >= 8) {
        log("closing socket after " + ws._reenterMisses + " failed re-entry attempts");
        try { ws.close(4008, "too many re-entry attempts"); } catch (e) {}
      }
      return;
    }
    var room = hit.room, player = hit.player;

    var old = sockFor(room.roomCode, player.seat);
    bind(ws, room.roomCode, player.seat);
    if (old && old !== ws) {
      try { old.close(4000, "replaced by new connection"); } catch (e) {}
    }
    var conn = roomsMod.setConnected(room, player.seat, true);
    safeSend(ws, "room_joined", {
      roomCode: room.roomCode,
      seat: player.seat,
      token: player.token, // the new device gets the session credential too
      state: engine.serializeFor(room, player.seat)
    });
    broadcast(room, "player_connection", { seat: player.seat, connected: true });
    if (room.phase === "lobby" || conn.hostChanged) {
      broadcast(room, "lobby_update", engine.lobbySnapshot(room));
    }
    persist.markDirty(room);
    log("'" + player.name + "' re-entered " + room.roomCode + " via personal code");
  }

  // -------------------------------------------------------------------------
  // Connection plumbing
  // -------------------------------------------------------------------------

  wss.on("connection", function (ws, req) {
    ws._alive = true;
    ws._roomCode = null;
    ws._seat = null;

    ws.on("pong", function () { ws._alive = true; });

    ws.on("message", function (raw) {
      var msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (e) {
        return safeSend(ws, "action_rejected", {
          reqId: null, command: null, code: "BAD_JSON", message: "Malformed JSON."
        });
      }
      if (!msg || typeof msg.type !== "string") return;
      var type = msg.type;
      var data = msg.data;
      var reqId = msg.reqId != null ? msg.reqId : null;

      try {
        if (type === "_ping") return safeSend(ws, "_pong", {});
        if (type === "create_room") return onCreateRoom(ws, data, reqId);
        if (type === "join_room") return onJoinRoom(ws, data, reqId);
        if (type === "rejoin") return onRejoin(ws, data, reqId);
        if (type === "reenter") return onReenter(ws, data, reqId);

        var room = roomOf(ws);
        if (!room) return reject(ws, reqId, type, "NOT_IN_ROOM", "Join a room first.");

        if (type === "leave_room") return onLeaveRoom(ws, room, reqId);
        if (type === "disband_room") return onDisbandRoom(ws, room, reqId);
        if (type === "add_bot") return onAddBot(ws, room, reqId);
        if (type === "remove_bot") return onRemoveBot(ws, room, data, reqId);
        if (type === "pick_color") return onPickColor(ws, room, data, reqId);
        if (type === "rename_bot") return onRenameBot(ws, room, data, reqId);
        if (type === "set_notify") {
          var me = roomsMod.getPlayer(room, ws._seat);
          if (!me) return reject(ws, reqId, "set_notify", "NOT_IN_ROOM", "Take a seat first.");
          me.notifyOptIn = !!(data && data.enabled);
          if (data && data.subscription) push.addSubscription(me, data.subscription);
          persist.markDirty(room);
          return safeSend(ws, "notify_state", { enabled: me.notifyOptIn });
        }
        if (type === "request_state") {
          return safeSend(ws, "state", { state: engine.serializeFor(room, ws._seat) });
        }
        if (ENGINE_ACTIONS[type]) return onEngineAction(ws, room, type, data, reqId);

        reject(ws, reqId, type, "UNKNOWN_COMMAND", "Unknown command: " + type);
      } catch (e) {
        log("handler error:", e && e.stack || e);
        reject(ws, reqId, type, "SERVER_ERROR", "Internal server error.");
      }
    });

    ws.on("close", function () {
      var code = ws._roomCode;
      var seat = ws._seat;
      if (code == null || seat == null) return;
      var current = sockFor(code, seat);
      if (current !== ws) return; // already replaced by a rejoin — not a real disconnect
      unbind(ws);
      var room = roomsMod.get(code);
      if (!room || !roomsMod.getPlayer(room, seat)) return;

      var conn = roomsMod.setConnected(room, seat, false);
      broadcast(room, "player_connection", { seat: seat, connected: false });
      if (room.phase === "lobby" || conn.hostChanged) {
        broadcast(room, "lobby_update", engine.lobbySnapshot(room));
      }
      persist.markDirty(room);
    });

    ws.on("error", function (err) { log("socket error:", err.message); });
  });

  // Heartbeat: dead sockets are detected within ~2 intervals. The app-level
  // _tick rides along because browsers throttle JS timers in hidden tabs: a
  // tabbed-away client can't send its own _ping and can't see protocol pings,
  // so without inbound JSON its silence watchdog would recycle a healthy
  // socket forever. Message delivery is never throttled — _tick keeps the
  // client's lastInboundAt fresh while the player reads another tab.
  var hbTimer = setInterval(function () {
    wss.clients.forEach(function (ws) {
      if (ws._alive === false) {
        try { ws.terminate(); } catch (e) {}
        return;
      }
      ws._alive = false;
      try { ws.ping(); } catch (e) {}
      safeSend(ws, "_tick", {});
    });
  }, HEARTBEAT_MS);
  if (hbTimer.unref) hbTimer.unref();

  // AI heartbeat: bots decide and act once a second — polling instead of
  // per-event timers means bot play survives server restarts for free.
  var botTimer = setInterval(function () {
    try {
      bots.tick(Date.now(), actAsBot);
    } catch (e) {
      log("bot tick error:", e && e.stack || e);
    }
  }, 1000);
  if (botTimer.unref) botTimer.unref();

  // GC: empty lobbies after 15 min, abandoned games after 24h.
  var gcTimer = setInterval(function () {
    var dead = roomsMod.gcSweep(Date.now());
    dead.forEach(function (code) {
      socketsByRoom.delete(code);
      persist.deleteSnapshot(code);
      bots.reset(code); // scratch must die with the room — 3-char codes get reissued
      log("room " + code + " garbage-collected");
    });
  }, GC_INTERVAL_MS);
  if (gcTimer.unref) gcTimer.unref();

  wss.on("close", function () {
    clearInterval(hbTimer);
    clearInterval(gcTimer);
    clearInterval(botTimer);
  });

  log("WebSocket server listening on " + CONST.WS_PATH);
  return wss;
}

module.exports = { attach: attach };

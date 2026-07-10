/*
 * Net — the WebSocket client for Alliances.
 * Single responsibility: keep one healthy socket to the server and shuttle
 * {type, data} envelopes both ways. No game knowledge lives here.
 *
 * Resilience model (adapted from wbcgamez/30's battle-tested network.js):
 *   - exponential backoff reconnect (1s, 2s, 4s ... capped 15s)
 *   - app-level _ping every 10s + inbound-silence watchdog (35s) that recycles
 *     half-dead sockets (NAT timeouts, proxies that eat WS protocol pings)
 *   - proactive reconnect on visibilitychange / pageshow / online events
 *     (phone wake, iOS bfcache restore, Wi-Fi <-> cellular hops)
 *   - sends attempted while closed are queued and flushed after the next
 *     open+rejoin, so a button clicked during a blip is not lost
 *   - on every successful open, if Save.session() exists we immediately send
 *     `rejoin {roomCode, token}` — the server answers room_joined (full state)
 *     or join_failed (we clear the dead session so we stop retrying it)
 *
 * Status callbacks: 'connecting' | 'open' | 'reconnecting' | 'dead'.
 */
(function () {
  "use strict";

  var C = window.AlliancesConst || { WS_PATH: "/ws" };

  var ws = null;
  var status = "connecting";
  var everConnected = false;   // distinguishes 'connecting' from 'reconnecting'
  var reconnectAttempt = 0;
  var reconnectTimer = null;
  var MAX_ATTEMPTS = 30;       // ~7 minutes of trying before we declare 'dead'

  var handlers = {};           // type -> [callbacks]
  var statusHandlers = [];
  var sendQueue = [];          // envelopes attempted while the socket was closed
  var MAX_QUEUE = 20;

  var pingTimer = null;
  var watchdogTimer = null;
  var lastInboundAt = 0;
  var PING_MS = 10000;
  var STALE_MS = 35000;        // > 3 missed server heartbeats = presumed dead

  var rejoinInFlight = false;  // true between sending `rejoin` and the server's verdict

  // ---- URL resolution ----
  // Same-origin by default (the Alliances server serves both HTTP and WS).
  // Overridable for dev pointing a static page at a remote server.
  function wsUrl() {
    if (window.ALLIANCES_WS_URL) return window.ALLIANCES_WS_URL;
    try {
      var stored = window.localStorage && window.localStorage.getItem("ALLIANCES_WS_URL");
      if (stored) return stored;
    } catch (e) { /* ignore */ }
    var scheme = (window.location.protocol === "https:") ? "wss:" : "ws:";
    // Subpath-aware: served from /alliances/ the socket lives at /alliances/ws,
    // standalone it lives at /ws. Derive from wherever the page actually is.
    var base = window.location.pathname;
    base = base.charAt(base.length - 1) === "/" ? base : base.replace(/[^/]*$/, "");
    return scheme + "//" + window.location.host + base + "ws";
  }

  // ---- Status ----
  function setStatus(s) {
    if (s === status) return;
    status = s;
    for (var i = 0; i < statusHandlers.length; i++) {
      try { statusHandlers[i](s); } catch (e) { console.error("[Net] status handler:", e); }
    }
  }

  // ---- Dispatch ----
  function dispatch(type, data, msg) {
    var list = handlers[type];
    if (!list) return;
    var copy = list.slice();
    for (var i = 0; i < copy.length; i++) {
      try { copy[i](data, msg); } catch (e) { console.error("[Net] handler for " + type + ":", e); }
    }
  }

  function isOpen() {
    return !!ws && ws.readyState === WebSocket.OPEN;
  }

  function rawSend(envelope) {
    if (!isOpen()) return false;
    try { ws.send(JSON.stringify(envelope)); return true; }
    catch (e) { console.warn("[Net] send failed:", e.message); return false; }
  }

  function flushQueue() {
    if (!sendQueue.length) return;
    var toSend = sendQueue.slice();
    sendQueue = [];
    for (var i = 0; i < toSend.length; i++) rawSend(toSend[i]);
  }

  // ---- Heartbeat + watchdog ----
  function startHeartbeat() {
    stopHeartbeat();
    pingTimer = setInterval(function () {
      if (isOpen()) rawSend({ type: "_ping", data: {} });
    }, PING_MS);
    watchdogTimer = setInterval(function () {
      if (!isOpen()) return;
      if (Date.now() - lastInboundAt > STALE_MS) {
        console.warn("[Net] watchdog: socket silent — recycling");
        // 4001, NOT 4000: 4000 is the server's "replaced by another device"
        // signal, and a self-recycle must never be mistaken for it (that
        // would freeze this tab on the stand-down scrim instead of healing).
        try { ws.close(4001, "watchdog stale"); } catch (e) { /* close anyway */ }
      }
    }, 5000);
  }

  function stopHeartbeat() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
  }

  // ---- Connect lifecycle ----
  function openSocket() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
    setStatus(everConnected ? "reconnecting" : "connecting");
    try {
      ws = new WebSocket(wsUrl());
    } catch (e) {
      ws = null;
      scheduleReconnect();
      return;
    }

    ws.addEventListener("open", function () {
      everConnected = true;
      reconnectAttempt = 0;
      lastInboundAt = Date.now();
      startHeartbeat();
      setStatus("open");
      // Auto-rejoin: a stored session means we belong somewhere. The server
      // either restores us (room_joined w/ full state) or rejects (join_failed
      // -> we clear the session below so the next open doesn't loop on it).
      var sess = window.Save && window.Save.session();
      if (sess) {
        rejoinInFlight = true;
        rawSend({ type: "rejoin", data: { roomCode: sess.roomCode, token: sess.token } });
      }
      flushQueue();
    });

    ws.addEventListener("message", function (evt) {
      lastInboundAt = Date.now();
      var msg;
      try { msg = JSON.parse(evt.data); } catch (e) { return; }
      if (!msg || !msg.type) return;
      var data = msg.data || {};

      // Interception: bookkeep the rejoin handshake before app handlers see it.
      if (msg.type === "room_joined" && rejoinInFlight) {
        rejoinInFlight = false;
        data._viaRejoin = true; // client-only marker so ui.js can toast "Rejoined"
      } else if (msg.type === "join_failed" && rejoinInFlight) {
        rejoinInFlight = false;
        data._wasRejoin = true;
        // Dead session — stop retrying it forever.
        if (window.Save) window.Save.clearSession();
      }

      dispatch(msg.type, data, msg);
    });

    ws.addEventListener("close", function (evt) {
      stopHeartbeat();
      rejoinInFlight = false;
      ws = null;
      // Code 4000 = the server replaced this socket because the SAME player
      // connected elsewhere (second tab, or re-entry from another device).
      // Auto-rejoining would steal the seat straight back and the two devices
      // would kick each other forever — so this tab stands down instead and
      // lets the player choose (the RETRY path deliberately takes it back).
      if (evt && evt.code === 4000) {
        setStatus("elsewhere");
        return;
      }
      scheduleReconnect();
    });

    ws.addEventListener("error", function () {
      // close always follows error; reconnect is handled there
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectAttempt++;
    if (reconnectAttempt > MAX_ATTEMPTS) {
      setStatus("dead");
      return;
    }
    setStatus(everConnected ? "reconnecting" : "connecting");
    var delay = Math.min(1000 * Math.pow(2, reconnectAttempt - 1), 15000);
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      openSocket();
    }, delay);
  }

  // Proactive wake triggers — don't sit on a dead socket waiting for backoff.
  function checkAlive(why) {
    // A stood-down tab (seat taken by another device) must NOT auto-reconnect
    // when it becomes visible — that would steal the seat straight back.
    // Only the explicit RESUME HERE button (Net.connect) leaves this state.
    if (status === "elsewhere") return;
    if (!ws || ws.readyState >= WebSocket.CLOSING) {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      openSocket();
    } else if (isOpen()) {
      // Socket claims open — probe it; the watchdog catches a missing _pong.
      rawSend({ type: "_ping", data: {} });
    }
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") checkAlive("visible");
  });
  window.addEventListener("pageshow", function () { checkAlive("pageshow"); });
  window.addEventListener("online", function () { checkAlive("online"); });

  // ---- Public API ----
  var Net = {
    connect: function () {
      // Manual connect (boot, or the user hitting RETRY on a dead connection)
      // resets the backoff so we try eagerly again.
      reconnectAttempt = 0;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      openSocket();
    },

    send: function (type, data, reqId) {
      var envelope = { type: type, data: data || {} };
      if (reqId) envelope.reqId = reqId;
      if (isOpen()) return rawSend(envelope);
      // Queue real actions during a reconnect window; never queue pings.
      if (type !== "_ping") {
        sendQueue.push(envelope);
        if (sendQueue.length > MAX_QUEUE) sendQueue.shift();
      }
      return false;
    },

    on: function (type, cb) {
      (handlers[type] = handlers[type] || []).push(cb);
    },

    onStatus: function (cb) {
      statusHandlers.push(cb);
      try { cb(status); } catch (e) { /* report current state immediately */ }
    },

    status: function () { return status; },
    isOpen: isOpen
  };

  window.Net = Net;
})();

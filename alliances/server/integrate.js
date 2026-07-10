/*
 * integrate.js — wires the complete Alliances game onto an existing Express
 * app + HTTP server, under an optional base path. Both hosts consume THIS
 * file, so there is exactly one wiring to maintain:
 *   - standalone:  server.js calls attachAlliances(app, server, { basePath: "" })
 *   - Ladybug:     ladybug-gamez/server.js calls it with basePath "/alliances"
 * Returns { flushAllSync } so the host's SIGTERM handler can flush snapshots.
 */
"use strict";

var express = require("express");
var path = require("path");
var os = require("os");

function attachAlliances(app, httpServer, opts) {
  var base = (opts && opts.basePath) || "";
  var tag = "[alliances]";

  // ---- Boot-time map validation ----
  // Hexfield is the always-available baseline: refuse to wire the game if it
  // is broken. Other maps that fail validation are EXCLUDED loudly instead.
  var MAPS = require("../public/maps/index.js");
  var validateMaps = require("./validate-maps.js");
  if (!MAPS.hexfield) throw new Error(tag + " FATAL: hexfield map missing");
  Object.keys(MAPS).forEach(function (id) {
    var errs = validateMaps.validateMap(MAPS[id]);
    if (!errs.length) return;
    if (id === "hexfield") {
      throw new Error(tag + " FATAL: hexfield failed validation:\n  - " + errs.join("\n  - "));
    }
    console.error(tag + " map '" + id + "' failed validation — EXCLUDED from play:\n  - " + errs.join("\n  - "));
    delete MAPS[id]; // same module-cached object the engine reads
  });
  console.log(tag + " maps validated: " + validateMaps.validateAllOrThrow(MAPS).join(", "));

  // ---- Restore persisted rooms ----
  var persist = require("./persist.js");
  var roomsMod = require("./rooms.js");
  var restored = persist.restoreAll();
  restored.forEach(function (room) { roomsMod.insert(room); });
  // Humans from pre-code snapshots get their re-entry code now — uniqueness
  // needs the full registry, so this runs after every room is inserted.
  restored.forEach(function (room) {
    room.players.forEach(function (p) {
      if (!p.isBot && !p.playerCode) p.playerCode = roomsMod.genPlayerCode();
    });
  });
  console.log(tag + " restored " + restored.length + " room(s) from " + persist.ROOMS_DIR);

  // ---- Push notifications (opt-in; VAPID keys persist beside snapshots) ----
  var push = require("./push.js");
  push.init(path.dirname(persist.ROOMS_DIR));

  // ---- HTTP routes under the base path ----
  if (base) {
    // /alliances (no slash) must land on /alliances/ or every relative URL
    // in the client (ws, info, push/key, sw.js) resolves one level too high.
    // Express matches "/alliances/" against this route too (non-strict
    // routing), so guard on the exact path or the redirect loops on itself.
    app.get(base, function (req, res, next) {
      if (req.path !== base) return next();
      res.redirect(base + "/");
    });
  }
  app.get(base + "/push/key", function (req, res) {
    res.json({ key: push.publicKey() }); // null = push unavailable
  });
  app.get(base + "/info", function (req, res) {
    var lanUrls = [];
    var port = httpServer.address() ? httpServer.address().port : (process.env.PORT || 3002);
    var ifaces = os.networkInterfaces();
    Object.keys(ifaces).forEach(function (name) {
      (ifaces[name] || []).forEach(function (addr) {
        if (addr.family === "IPv4" && !addr.internal) {
          lanUrls.push("http://" + addr.address + ":" + port + base);
        }
      });
    });
    res.json({ port: port, lanUrls: lanUrls });
  });
  if (base) {
    app.use(base, express.static(path.join(__dirname, "..", "public")));
  } else {
    app.use(express.static(path.join(__dirname, "..", "public")));
    app.get("/", function (req, res) {
      res.sendFile(path.join(__dirname, "..", "public", "index.html"));
    });
  }

  // ---- WebSocket game server ----
  // On a shared host pass noServerWs: true and route 'upgrade' events to the
  // returned wss yourself (see ladybug-gamez/server.js).
  var wss = require("./ws-server.js").attach(httpServer, {
    path: base + "/ws",
    noServer: !!(opts && opts.noServerWs)
  });

  return { flushAllSync: persist.flushAllSync, wss: wss, wsPath: base + "/ws" };
}

module.exports = attachAlliances;

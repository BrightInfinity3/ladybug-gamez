/*
 * push.js — opt-in web-push notifications ("your turn", "a pact is offered",
 * "the round ended"). Why web push and not email: email needs an external
 * account's SMTP credentials; web push is standards-built into browsers,
 * needs no third-party service, and works even with the game tab closed
 * (requires HTTPS or localhost — on plain LAN HTTP the client quietly falls
 * back to in-browser notifications instead).
 *
 * VAPID keys are generated once and persisted next to the room snapshots.
 * Pushes go only to players who opted in AND are not currently connected —
 * someone actively playing doesn't need an OS nudge on top.
 */
"use strict";

var fs = require("fs");
var path = require("path");
var webpush = null;
try {
  webpush = require("web-push");
} catch (e) {
  console.warn("[push] web-push module unavailable — push notifications disabled");
}

var keys = null;
var enabled = false;

function init(dataDir) {
  if (!webpush) return false;
  var file = path.join(dataDir, "vapid.json");
  try {
    if (fs.existsSync(file)) {
      keys = JSON.parse(fs.readFileSync(file, "utf8"));
    } else {
      keys = webpush.generateVAPIDKeys();
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(keys));
      console.log("[push] generated new VAPID keys");
    }
    webpush.setVapidDetails("mailto:alliances@localhost", keys.publicKey, keys.privateKey);
    enabled = true;
  } catch (e) {
    console.warn("[push] init failed:", e.message);
    enabled = false;
  }
  return enabled;
}

function publicKey() {
  return enabled ? keys.publicKey : null;
}

// Store a browser subscription on the player (multi-device: newest 5 kept).
function addSubscription(player, sub) {
  if (!sub || !sub.endpoint) return;
  player.pushSubs = (player.pushSubs || []).filter(function (s) { return s.endpoint !== sub.endpoint; });
  player.pushSubs.push(sub);
  if (player.pushSubs.length > 5) player.pushSubs = player.pushSubs.slice(-5);
}

function sendTo(player, payload) {
  if (!enabled || !player || player.isBot || !player.notifyOptIn) return;
  // Throttle: at most one push per player per 45s — an offer/rescind cycler
  // (or a busy table) must never turn into phone-notification spam.
  var now = Date.now();
  if (player._lastPushAt && now - player._lastPushAt < 45000) return;
  player._lastPushAt = now;
  var subs = player.pushSubs || [];
  if (!subs.length) return;
  var body = JSON.stringify(payload);
  subs.forEach(function (sub) {
    webpush.sendNotification(sub, body).catch(function (err) {
      // 404/410 = the browser dropped the subscription; prune it.
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        player.pushSubs = (player.pushSubs || []).filter(function (s) { return s.endpoint !== sub.endpoint; });
      }
    });
  });
}

/*
 * Scan a dispatched event batch for notification-worthy moments. Only
 * DISCONNECTED humans get pushed — a connected player's own client shows a
 * local notification when the tab is hidden instead.
 */
function considerNotify(room, events, getPlayer) {
  if (!enabled) return;
  events.forEach(function (ev) {
    var targets = [];
    var title = null, bodyText = null;
    if (ev.type === "turn_began") {
      targets = [ev.data.seat];
      title = "Alliances — your turn!";
      bodyText = "It's your move in war room " + room.roomCode + ".";
    } else if (ev.type === "offer_created") {
      var offer = ev.data && ev.data.offer;
      if (!offer || offer.kind === "rename") return;
      targets = (offer.to || []).filter(function (s) { return s !== offer.from; });
      var from = getPlayer(room, offer.from);
      title = "Alliances — a pact is offered";
      bodyText = (from ? from.name : "A commander") +
        " proposes an alliance in room " + room.roomCode + ". It expires when their turn ends!";
    } else if (ev.type === "round_ended") {
      targets = room.players.map(function (p) { return p.seat; });
      title = "Alliances — the round has ended";
      bodyText = ev.data && ev.data.winner
        ? "The war in room " + room.roomCode + " is over. Come see the spoils."
        : "The round in room " + room.roomCode + " was called off.";
    } else {
      return;
    }
    targets.forEach(function (seat) {
      var p = getPlayer(room, seat);
      if (p && !p.connected) sendTo(p, { title: title, body: bodyText });
    });
  });
}

module.exports = {
  init: init,
  publicKey: publicKey,
  addSubscription: addSubscription,
  considerNotify: considerNotify,
  sendTo: sendTo
};

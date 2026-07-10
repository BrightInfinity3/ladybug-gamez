/*
 * bots.js — AI commanders.
 *
 * Decisions are PURE functions over the room state (testable like the rules
 * engine); the only impure part is tick(), a 1-second poll the ws-server runs.
 * Polling beats per-event timer bookkeeping here: it survives server restarts
 * (no timers to rebuild), can never leak a timeout, and 1s granularity is
 * plenty for "thinking" pauses that are seconds long anyway.
 *
 * Personality, in one paragraph: a bot attacks only with a dice advantage
 * (a failed attack wipes out the attacking force for nothing), kills the
 * fattest safe target first, sometimes proposes a pact when it isn't winning,
 * waits a polite while for humans to answer (a pending offer blocks its
 * armies — when patience runs out it rescinds and marches), answers incoming
 * offers after a thoughtful pause (banding against the leader, accepting a
 * shared-victory pact only from behind), always approves renames, and never
 * defects — betrayal stays a human privilege.
 */
"use strict";

var crypto = require("crypto");
var rooms = require("./rooms.js");

// Pacing (ms) — tuned so client battle cinematics can breathe between attacks.
var STEP_ATTACK_MS = 2600;   // between a bot's consecutive attacks
var STEP_SMALL_MS = 1200;    // between minor actions
var WAIT_HUMAN_MS = 20000;   // how long a bot holds its offer open for humans
var WAIT_BOT_MS = 6000;      // ... and for an all-bot audience
var RESPOND_MIN_MS = 1500;   // thinking pause before answering an offer
var RESPOND_JITTER_MS = 2500;
var INITIATIVE_CHANCE = 0.35; // per-turn chance a lonely bot reaches out

function defaultRng() { return crypto.randomInt(1000000) / 1000000; }

// ---------------------------------------------------------------------------
// Pure evaluation helpers
// ---------------------------------------------------------------------------

function aliveSeats(room) {
  return room.players.filter(function (p) { return !p.eliminated; })
    .map(function (p) { return p.seat; });
}

function seatValue(room, seat) {
  var sum = 0;
  var t = room.round.territories;
  for (var id in t) if (t[id].owner === seat) sum += t[id].value;
  return sum;
}

// A player's fighting weight = their whole faction's weight.
function factionValue(room, seat) {
  var p = rooms.getPlayer(room, seat);
  if (!p) return 0;
  if (p.allianceId == null) return seatValue(room, seat);
  var a = room.round.alliances[p.allianceId];
  if (!a) return seatValue(room, seat);
  return a.members.reduce(function (s, m) { return s + seatValue(room, m); }, 0);
}

function isValueLeader(room, seat) {
  var mine = factionValue(room, seat);
  return aliveSeats(room).every(function (s) { return factionValue(room, s) <= mine; });
}

// Would applying this offer put every remaining player in one alliance?
function offerUnitesAll(room, offer) {
  var alive = aliveSeats(room);
  var members;
  if (offer.kind === "make_alliance") members = [offer.from, offer.to[0]];
  else if (offer.kind === "join_alliance") {
    var a = room.round.alliances[offer.allianceId];
    if (!a) return false;
    members = a.members.concat([offer.from]);
  } else return false;
  return alive.every(function (s) { return members.indexOf(s) !== -1; });
}

// ---------------------------------------------------------------------------
// Pure decisions
// ---------------------------------------------------------------------------

/*
 * Answer an incoming offer. Doctrine:
 *  - renames: always approve (bots are agreeable about names)
 *  - a pact that ends the round in shared victory: accept only from BEHIND
 *    (below-average faction value — a guaranteed split beats a likely loss)
 *  - otherwise: the leader stays aloof; everyone else bands together as long
 *    as the offerer's faction carries real weight (>= 60% of the bot's own)
 */
function decideRespond(room, seat, offer, rng) {
  if (offer.kind === "rename") return true;
  var alive = aliveSeats(room);
  if (offerUnitesAll(room, offer)) {
    return factionValue(room, seat) < 240 / Math.max(1, alive.length);
  }
  if (isValueLeader(room, seat)) return false;
  var accept = factionValue(room, offer.from) >= 0.6 * factionValue(room, seat);
  if ((rng || defaultRng)() < 0.1) accept = !accept; // a little unpredictability
  return accept;
}

/*
 * Best attack, or null. Only strict dice advantages (attacker rolls value-1):
 * value-1 > target value. Rank by advantage, tiebreak toward fatter targets
 * (winning absorbs the defender's stack — bigger capture, bigger swing).
 */
function chooseAttack(room, seat) {
  var r = room.round;
  var me = rooms.getPlayer(room, seat);
  var myAlliance = me ? me.allianceId : null;
  var MAPS = require("../public/maps/index.js");
  var map = MAPS[room.settings.mapId];
  if (!map) return null;

  var best = null;
  map.territories.forEach(function (t) {
    var from = r.territories[t.id];
    if (!from || from.owner !== seat || from.value < 2) return;
    t.adjacent.forEach(function (nid) {
      var to = r.territories[nid];
      if (!to || to.owner === seat) return;
      var owner = rooms.getPlayer(room, to.owner);
      if (owner && myAlliance != null && owner.allianceId === myAlliance) return;
      var advantage = (from.value - 1) - to.value;
      if (advantage <= 0) return;
      if (!best || advantage > best.advantage ||
          (advantage === best.advantage && to.value > best.targetValue)) {
        best = { from: t.id, to: nid, advantage: advantage, targetValue: to.value };
      }
    });
  });
  return best ? { from: best.from, to: best.to } : null;
}

/*
 * Optional opening diplomacy on the bot's own turn. A bot that is single and
 * not leading sometimes reaches out: request to join the strongest alliance
 * when trailing badly, else propose a pact to the strongest other single.
 * Returns {type, data} or null.
 */
function decideInitiative(room, seat, rng) {
  var me = rooms.getPlayer(room, seat);
  if (!me || me.allianceId != null) return null;
  if ((rng || defaultRng)() > INITIATIVE_CHANCE) return null;
  if (isValueLeader(room, seat)) return null; // winners don't beg

  var alive = aliveSeats(room);
  var avg = 240 / Math.max(1, alive.length);

  // Trailing: request to join the strongest alliance. This is only reached
  // from below average, which is exactly when doctrine also permits a
  // shared-victory pact (mirrors decideRespond's unite-all rule).
  var allianceIds = Object.keys(room.round.alliances || {});
  if (allianceIds.length && factionValue(room, seat) < avg) {
    var strongest = null;
    allianceIds.forEach(function (aid) {
      var a = room.round.alliances[aid];
      var v = a.members.reduce(function (s, m) { return s + seatValue(room, m); }, 0);
      if (!strongest || v > strongest.v) strongest = { id: aid, v: v };
    });
    return { type: "request_join", data: { allianceId: strongest.id } };
  }

  // Otherwise: court the strongest other single player.
  var target = null;
  alive.forEach(function (s) {
    if (s === seat) return;
    var p = rooms.getPlayer(room, s);
    if (!p || p.allianceId != null) return;
    var v = seatValue(room, s);
    if (!target || v > target.v) target = { seat: s, v: v };
  });
  if (!target) return null;
  return { type: "offer_alliance", data: { targetSeat: target.seat } };
}

// ---------------------------------------------------------------------------
// Tick driver (the only impure part)
// ---------------------------------------------------------------------------

// Per-room scratch state. In-memory only ON PURPOSE: after a restart the tick
// re-derives everything from the room. Worst case a bot re-tries diplomacy it
// already used this turn — the engine's hasJoined guard shrugs it off.
var scratch = {}; // roomCode -> { turnNumber, nextActAt, triedDiplomacy, waitingOfferId, waitUntil, respondAt: {offerId:seat -> t} }

function stateFor(room) {
  var st = scratch[room.roomCode];
  if (!st) st = scratch[room.roomCode] = { turnNumber: -1, nextActAt: 0, triedDiplomacy: false, waitingOfferId: null, waitUntil: 0, respondAt: {} };
  return st;
}

function reset(roomCode) { delete scratch[roomCode]; }

/*
 * act(room, seat, type, data) -> engine result; supplied by ws-server so bot
 * actions flow through the exact same dispatch/persist path as human ones.
 */
function tick(now, act, rng) {
  rng = rng || defaultRng;
  rooms.all().forEach(function (room) {
    if (room.phase !== "playing" || !room.round) { reset(room.roomCode); return; }
    // Bots perform for an audience: with no human connected there is nobody
    // to watch (or to ever win back the room), so they hold still. This also
    // stops two stalemated bots from grinding end_turn snapshots for 24h.
    var humanWatching = room.players.some(function (p) { return !p.isBot && p.connected; });
    if (!humanWatching) return;
    var st = stateFor(room);

    // Drop scheduled answers whose offer has since resolved (keeps scratch tidy).
    for (var k in st.respondAt) {
      var koid = k.split(":")[0];
      var ko = room.round.offers[koid];
      if (!ko || ko.status !== "pending") delete st.respondAt[k];
    }

    // ---- 1. Bots answer offers addressed to them (any time, like humans) ----
    for (var oid in room.round.offers) {
      var offer = room.round.offers[oid];
      if (offer.status !== "pending") continue;
      offer.to.forEach(function (seat) {
        // An earlier recipient in this very loop may have finalized the offer
        // or ended the round — recheck before acting.
        if (offer.status !== "pending" || room.phase !== "playing") return;
        var p = rooms.getPlayer(room, seat);
        if (!p || !p.isBot || p.eliminated) return;
        if (offer.responses[seat]) return; // already approved
        var key = oid + ":" + seat;
        if (!st.respondAt[key]) {
          st.respondAt[key] = now + RESPOND_MIN_MS + Math.floor(rng() * RESPOND_JITTER_MS);
          return;
        }
        if (now < st.respondAt[key]) return;
        delete st.respondAt[key];
        act(room, seat, "respond_offer", { offerId: oid, accept: decideRespond(room, seat, offer, rng) });
      });
      if (room.phase !== "playing") return; // an acceptance may end the round
    }

    // ---- 2. The active bot takes its turn, one paced step per tick ----
    var turn = room.round.turn;
    var active = rooms.getPlayer(room, turn.seat);
    if (!active || !active.isBot || active.eliminated) return;

    if (st.turnNumber !== turn.turnNumber) {
      st.turnNumber = turn.turnNumber;
      st.triedDiplomacy = false;
      st.waitingOfferId = null;
      st.nextActAt = now + STEP_SMALL_MS; // brief pause before the bot "arrives"
      return;
    }
    if (now < st.nextActAt) return;

    // Holding an offer open: give recipients time to answer. A pending offer
    // now BLOCKS attacking (designer revision), so when patience runs out the
    // bot RESCINDS to free its armies rather than letting the offer rot.
    // The held offer is derived from ROOM STATE, not just scratch: after a
    // server restart the scratch is gone but the pending offer persists —
    // without this the bot would try to attack into ENVOY_OUT forever.
    if (!st.waitingOfferId) {
      for (var hid in room.round.offers) {
        var ho = room.round.offers[hid];
        if (ho.status === "pending" && ho.from === turn.seat && ho.kind !== "rename") {
          st.waitingOfferId = hid;
          if (!st.waitUntil || st.waitUntil < now) st.waitUntil = now; // restart: no patience left
          break;
        }
      }
    }
    if (st.waitingOfferId) {
      var held = room.round.offers[st.waitingOfferId];
      if (held && held.status === "pending") {
        if (now < st.waitUntil) return;
        act(room, turn.seat, "rescind_offer", { offerId: st.waitingOfferId });
        st.waitingOfferId = null;
        st.nextActAt = now + STEP_SMALL_MS;
        return;
      }
      st.waitingOfferId = null; // answered or dead
    }

    // Opening diplomacy, once per turn, before any attack.
    if (!st.triedDiplomacy && !turn.hasJoined && turn.attacksMade === 0) {
      st.triedDiplomacy = true;
      var move = decideInitiative(room, turn.seat, rng);
      if (move) {
        var res = act(room, turn.seat, move.type, move.data);
        if (res && res.ok) {
          var created = (res.events || []).find(function (e) { return e.type === "offer_created"; });
          if (created) {
            var to = created.data.offer.to;
            var humanAudience = to.some(function (s) {
              var rp = rooms.getPlayer(room, s);
              return rp && !rp.isBot;
            });
            st.waitingOfferId = created.data.offer.id;
            st.waitUntil = now + (humanAudience ? WAIT_HUMAN_MS : WAIT_BOT_MS);
          }
        }
        st.nextActAt = now + STEP_SMALL_MS;
        return;
      }
    }

    // Fight while the dice favor us and attacks remain, then yield.
    var CAP = require("./engine.js").ATTACKS_PER_TURN;
    var attack = turn.attacksMade < CAP ? chooseAttack(room, turn.seat) : null;
    if (attack) {
      act(room, turn.seat, "attack", attack);
      st.nextActAt = now + STEP_ATTACK_MS;
      return;
    }
    act(room, turn.seat, "end_turn", {});
    st.nextActAt = now + STEP_SMALL_MS;
  });
}

module.exports = {
  tick: tick,
  reset: reset,
  // pure decision surface, exported for tests
  decideRespond: decideRespond,
  chooseAttack: chooseAttack,
  decideInitiative: decideInitiative,
  factionValue: factionValue,
  seatValue: seatValue,
  offerUnitesAll: offerUnitesAll,
  isValueLeader: isValueLeader,
  WAIT_HUMAN_MS: WAIT_HUMAN_MS,
  WAIT_BOT_MS: WAIT_BOT_MS
};

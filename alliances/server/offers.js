/*
 * offers.js — PURE offer lifecycle over the room state: create / respond /
 * rescind / auto-void sweep / turn-bound expiry. No sockets, no engine
 * imports (engine imports us), so every path is testable without networking.
 *
 * Designer rulings implemented here:
 *  - Rescind REFUNDS the join action the same turn (decline does NOT).
 *  - Max ONE pending outgoing make/join offer per player.
 *  - Accepting an incoming offer never consumes the acceptor's join action.
 *  - An alliance offer lives only while the offerer's turn is open: it is
 *    voided the moment they attack (Capture Territory) or end their turn
 *    (voidTurnOffers). Recipients answer whenever — but the window is the
 *    offerer's live turn.
 *  - Renames are exempt from turn expiry (they're not turn-gated diplomacy
 *    and belong to the whole alliance, any time).
 */
"use strict";

var CONST = require("../public/js/const.js");
var rooms = require("./rooms.js");

var MAX_METALS = CONST.METALS.length; // 3 — at most 3 alliances with 6 players

function ok(events, extra) {
  var res = { ok: true, events: events || [] };
  if (extra) for (var k in extra) res[k] = extra[k];
  return res;
}
function fail(code, message) {
  return { ok: false, code: code, message: message };
}

function getPlayer(room, seat) { return rooms.getPlayer(room, seat); }

function participants(offer) { return [offer.from].concat(offer.to); }

function cleanAllianceName(raw, fallback) {
  var s = String(raw == null ? "" : raw)
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) s = fallback || "";
  return s.slice(0, CONST.MAX_ALLIANCE_NAME_LEN);
}

function nextOfferId(round) {
  round.nextOfferId = (round.nextOfferId || 0) + 1;
  return "o" + round.nextOfferId;
}

function nextAllianceId(round) {
  round.nextAllianceId = (round.nextAllianceId || 0) + 1;
  return "A" + round.nextAllianceId;
}

// Metals are recycled: a dissolved alliance frees its metal for the next pact.
function lowestFreeMetal(round) {
  var used = {};
  for (var id in round.alliances) used[round.alliances[id].metalIndex] = true;
  for (var i = 0; i < MAX_METALS; i++) if (!used[i]) return i;
  return MAX_METALS - 1; // unreachable: 6 players cap alliances at 3
}

function sameMembers(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  var x = a.slice().sort(function (m, n) { return m - n; });
  var y = b.slice().sort(function (m, n) { return m - n; });
  for (var i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

// What clients see — never includes the internal membersSnapshot.
function serializeOffer(o) {
  var responses = {};
  for (var s in o.responses) responses[s] = o.responses[s];
  return {
    id: o.id,
    kind: o.kind,
    from: o.from,
    to: o.to.slice(),
    allianceId: o.allianceId,
    proposedName: o.proposedName,
    responses: responses,
    status: o.status,
    t: o.createdAt // dispatch cards show real arrival time, not "now"
  };
}

// Diplomacy is private: offer events go to participants only.
function offerEvent(type, offer, reason) {
  return {
    type: type,
    data: { offer: serializeOffer(offer), reason: reason || null },
    to: participants(offer)
  };
}

function hasPendingOutgoing(round, seat) {
  for (var id in round.offers) {
    var o = round.offers[id];
    if (o.from === seat && o.kind !== "rename" && o.status === "pending") return true;
  }
  return false;
}

function makeOffer(round, kind, from, to, fields) {
  var offer = {
    id: nextOfferId(round),
    kind: kind,
    from: from,
    to: to,
    allianceId: fields.allianceId || null,
    proposedName: fields.proposedName || null,
    membersSnapshot: fields.membersSnapshot || null,
    responses: {},
    status: "pending",
    createdAt: Date.now()
  };
  round.offers[offer.id] = offer;
  return offer;
}

// Shared turn-action guards for make/join (the only offer kinds that consume
// the per-turn join action). Designer revision: diplomacy is legal at ANY
// point in your turn — instead, a pending outgoing offer blocks ATTACKING
// (enforced in engine.attack) until it resolves or is rescinded.
function guardDiplomacyAction(room, seat) {
  if (room.phase !== "playing") return fail("BAD_PHASE", "No round in progress.");
  var turn = room.round.turn;
  if (turn.seat !== seat) return fail("NOT_YOUR_TURN", "Diplomacy offers are made on your own turn.");
  if (turn.hasJoined) return fail("JOIN_USED", "You already used your join action this turn.");
  var me = getPlayer(room, seat);
  if (!me || me.eliminated) return fail("ELIMINATED", "Eliminated commanders cannot make offers.");
  if (me.allianceId != null) return fail("ALREADY_IN_ALLIANCE", "You are already in an alliance.");
  if (hasPendingOutgoing(room.round, seat)) return fail("PENDING_OFFER_EXISTS", "You already have a pending offer. Rescind it first.");
  return null;
}

function createAllianceOffer(room, seat, data) {
  var guard = guardDiplomacyAction(room, seat);
  if (guard) return guard;
  var targetSeat = data ? data.targetSeat : null;
  if (!Number.isInteger(targetSeat)) return fail("BAD_REQUEST", "targetSeat must be a seat number.");
  if (targetSeat === seat) return fail("SELF_TARGET", "You cannot ally with yourself.");
  var target = getPlayer(room, targetSeat);
  if (!target) return fail("BAD_TARGET", "No such player.");
  if (target.eliminated) return fail("TARGET_ELIMINATED", "That commander has been eliminated.");
  if (target.allianceId != null) return fail("TARGET_IN_ALLIANCE", "They are already in an alliance.");

  var me = getPlayer(room, seat);
  var name = cleanAllianceName(data.allianceName, me.name + " & " + target.name);
  var offer = makeOffer(room.round, "make_alliance", seat, [targetSeat], { proposedName: name });
  room.round.turn.hasJoined = true;
  return ok([offerEvent("offer_created", offer)]);
}

function createJoinRequest(room, seat, data) {
  var guard = guardDiplomacyAction(room, seat);
  if (guard) return guard;
  var alliance = room.round.alliances[data ? data.allianceId : null];
  if (!alliance) return fail("BAD_TARGET", "No such alliance.");

  // Unanimous accept: every current member must approve. Membership is
  // snapshotted so any change before the final acceptance auto-voids.
  var offer = makeOffer(room.round, "join_alliance", seat, alliance.members.slice(), {
    allianceId: alliance.id,
    membersSnapshot: alliance.members.slice()
  });
  room.round.turn.hasJoined = true;
  return ok([offerEvent("offer_created", offer)]);
}

function createRenameProposal(room, seat, data) {
  if (room.phase !== "playing") return fail("BAD_PHASE", "No round in progress.");
  var me = getPlayer(room, seat);
  if (!me || me.eliminated) return fail("ELIMINATED", "Eliminated commanders cannot propose renames.");
  var alliance = room.round.alliances[data ? data.allianceId : null];
  if (!alliance) return fail("BAD_TARGET", "No such alliance.");
  if (alliance.members.indexOf(seat) === -1) return fail("NOT_MEMBER", "Only members can propose a rename.");
  for (var id in room.round.offers) {
    var o = room.round.offers[id];
    if (o.kind === "rename" && o.allianceId === alliance.id && o.status === "pending") {
      return fail("RENAME_PENDING", "A rename is already awaiting votes.");
    }
  }
  var name = cleanAllianceName(data.newName, null);
  if (!name) return fail("BAD_NAME", "Alliance name cannot be empty.");

  var to = alliance.members.filter(function (s) { return s !== seat; });
  var offer = makeOffer(room.round, "rename", seat, to, {
    allianceId: alliance.id,
    proposedName: name,
    membersSnapshot: alliance.members.slice()
  });
  return ok([offerEvent("offer_created", offer)]);
}

function respond(room, seat, data) {
  if (room.phase !== "playing") return fail("BAD_PHASE", "No round in progress.");
  var offer = room.round.offers[data ? data.offerId : null];
  if (!offer) return fail("OFFER_NOT_FOUND", "No such offer.");
  // Same-tick races: first message wins; late responses reconcile via this code.
  if (offer.status !== "pending") return fail("OFFER_RESOLVED", "That offer was already resolved.");
  if (offer.to.indexOf(seat) === -1) return fail("NOT_RECIPIENT", "That offer is not addressed to you.");
  var me = getPlayer(room, seat);
  if (!me || me.eliminated) return fail("ELIMINATED", "Eliminated commanders cannot respond.");
  if (offer.responses[seat]) return fail("ALREADY_RESPONDED", "You already approved this offer.");
  if (!data || typeof data.accept !== "boolean") return fail("BAD_REQUEST", "accept must be true or false.");

  if (!data.accept) {
    offer.status = "declined";
    return ok([offerEvent("offer_updated", offer, "declined")], { factionChanged: false });
  }

  offer.responses[seat] = true;
  var allAccepted = offer.to.every(function (s) { return offer.responses[s]; });
  if (!allAccepted) {
    return ok([offerEvent("offer_updated", offer)], { factionChanged: false });
  }

  // Final acceptance applies immediately. Designer ruling: an alliance offer
  // only lives while the offerer's turn is open — it is voided the moment they
  // attack or end their turn (see voidTurnOffers) — so a late acceptance can
  // never collide with "attacked = no diplomacy this turn".
  return finalizeOffer(room, offer);
}

/*
 * Applies a fully-accepted offer. Always re-validates from scratch first —
 * the world can change between the last two accept clicks.
 */
function finalizeOffer(room, offer) {
  var reason = voidReason(room, offer);
  if (reason) {
    offer.status = "voided";
    return ok([offerEvent("offer_updated", offer, reason)], { factionChanged: false });
  }

  offer.status = "accepted";
  var round = room.round;
  var events = [offerEvent("offer_updated", offer, "accepted")];

  if (offer.kind === "make_alliance") {
    var alliance = {
      id: nextAllianceId(round),
      name: offer.proposedName,
      members: [offer.from, offer.to[0]].sort(function (a, b) { return a - b; }),
      createdBy: offer.from,
      metalIndex: lowestFreeMetal(round)
    };
    round.alliances[alliance.id] = alliance;
    alliance.members.forEach(function (s) { getPlayer(room, s).allianceId = alliance.id; });
    rooms.pushLog(room, "formed", { allianceId: alliance.id, name: alliance.name, members: alliance.members.slice() });
    events.push({
      type: "alliance_formed",
      data: {
        alliance: {
          id: alliance.id, name: alliance.name, members: alliance.members.slice(),
          createdBy: alliance.createdBy, metalIndex: alliance.metalIndex
        }
      }
    });
  } else if (offer.kind === "join_alliance") {
    var a = round.alliances[offer.allianceId];
    a.members.push(offer.from);
    a.members.sort(function (x, y) { return x - y; });
    getPlayer(room, offer.from).allianceId = a.id;
    rooms.pushLog(room, "joined", { allianceId: a.id, seat: offer.from });
    events.push({
      type: "member_joined",
      data: { allianceId: a.id, seat: offer.from, members: a.members.slice() }
    });
  } else if (offer.kind === "rename") {
    var ra = round.alliances[offer.allianceId];
    ra.name = offer.proposedName;
    rooms.pushLog(room, "renamed", { allianceId: ra.id, name: ra.name });
    events.push({ type: "renamed", data: { allianceId: ra.id, name: ra.name } });
  }

  // A formation changes who is "single" — other pending offers may now be dead.
  var voided = sweepAutoVoid(room);
  return ok(events.concat(voided), { factionChanged: offer.kind !== "rename" });
}

function rescind(room, seat, data) {
  if (room.phase !== "playing") return fail("BAD_PHASE", "No round in progress.");
  var offer = room.round.offers[data ? data.offerId : null];
  if (!offer) return fail("OFFER_NOT_FOUND", "No such offer.");
  if (offer.status !== "pending") return fail("OFFER_RESOLVED", "That offer was already resolved.");
  if (offer.from !== seat) return fail("NOT_OFFERER", "Only the sender can rescind an offer.");

  offer.status = "rescinded";
  // Designer ruling: rescinding refunds the join action the same turn.
  if (offer.kind !== "rename" && room.round.turn.seat === seat) {
    room.round.turn.hasJoined = false;
  }
  return ok([offerEvent("offer_updated", offer, "rescinded")]);
}

/*
 * The auto-void matrix. Runs against pending offers on every relevant
 * mutation (formation, join, defect, elimination, end-of-turn).
 */
function voidReason(room, offer) {
  var ps = participants(offer);
  for (var i = 0; i < ps.length; i++) {
    var p = getPlayer(room, ps[i]);
    if (!p || p.eliminated) return "party_eliminated";
  }
  if (offer.kind === "make_alliance") {
    if (getPlayer(room, offer.from).allianceId != null) return "offerer_not_single";
    if (getPlayer(room, offer.to[0]).allianceId != null) return "target_not_single";
  } else if (offer.kind === "join_alliance") {
    if (getPlayer(room, offer.from).allianceId != null) return "offerer_not_single";
    var a = room.round.alliances[offer.allianceId];
    if (!a) return "alliance_dissolved";
    if (!sameMembers(a.members, offer.membersSnapshot)) return "membership_changed";
  } else if (offer.kind === "rename") {
    var ra = room.round.alliances[offer.allianceId];
    if (!ra) return "alliance_dissolved";
    if (!sameMembers(ra.members, offer.membersSnapshot)) return "membership_changed";
  }
  return null;
}

function sweepAutoVoid(room) {
  var events = [];
  var round = room.round;
  if (!round) return events;
  for (var id in round.offers) {
    var o = round.offers[id];
    if (o.status !== "pending") continue;
    var reason = voidReason(room, o);
    if (reason) {
      o.status = "voided";
      events.push(offerEvent("offer_updated", o, reason));
    }
  }
  return events;
}

/*
 * Designer ruling: an alliance offer/join request lives only while the
 * offerer's turn is open. The moment they attack or end their turn, any
 * unanswered offer they sent disappears. Renames are untouched — they are
 * not turn actions and belong to the whole alliance.
 */
function voidTurnOffers(room, seat, reason) {
  var events = [];
  var round = room.round;
  if (!round) return events;
  for (var id in round.offers) {
    var o = round.offers[id];
    if (o.status !== "pending" || o.kind === "rename" || o.from !== seat) continue;
    o.status = "voided";
    events.push(offerEvent("offer_updated", o, reason || "turn_ended"));
  }
  return events;
}

// Round end voids everything still open.
function voidAll(room, reason) {
  var events = [];
  var round = room.round;
  if (!round) return events;
  for (var id in round.offers) {
    var o = round.offers[id];
    if (o.status !== "pending") continue;
    o.status = "voided";
    events.push(offerEvent("offer_updated", o, reason || "round_ended"));
  }
  return events;
}

module.exports = {
  createAllianceOffer: createAllianceOffer,
  createJoinRequest: createJoinRequest,
  createRenameProposal: createRenameProposal,
  respond: respond,
  rescind: rescind,
  finalizeOffer: finalizeOffer,
  sweepAutoVoid: sweepAutoVoid,
  voidTurnOffers: voidTurnOffers,
  voidAll: voidAll,
  voidReason: voidReason,
  serializeOffer: serializeOffer,
  participants: participants,
  hasPendingOutgoing: hasPendingOutgoing,
  lowestFreeMetal: lowestFreeMetal
};

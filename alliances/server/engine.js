/*
 * engine.js — PURE rules functions over the room state. Validates and applies
 * every game action, returning { ok, events } for the ws router to broadcast
 * (or { ok:false, code, message } for an action_rejected). No socket knowledge,
 * no persistence — tests drive these functions directly.
 *
 * Event shape: { type, data, to?, withState? }
 *   to        — seat array; omitted means broadcast to the whole room
 *   withState — router merges a personalized state (serializeFor) per recipient
 */
"use strict";

var MAPS = require("../public/maps/index.js");
var rooms = require("./rooms.js");
var offers = require("./offers.js");
var setup = require("./setup.js");
var battle = require("./battle.js");

var WIN_POINTS = 60;
var ATTACKS_PER_TURN = 3;        // designer revision: caps the early-mover snowball
var AFK_VALVE_MS = 180000;       // host may force-end after 3 min of active-player silence
var DISCONNECT_VALVE_MS = 60000; // ... or 60s of active-player disconnection

function ok(events) { return { ok: true, events: events || [] }; }
function fail(code, message) { return { ok: false, code: code, message: message }; }
function getPlayer(room, seat) { return rooms.getPlayer(room, seat); }

// ---------------------------------------------------------------------------
// Serialization — the SINGLE outbound state chokepoint. Strips tokens, filters
// offers to those the viewer participates in, adds yourSeat.
// ---------------------------------------------------------------------------

function serializeFor(room, seat) {
  var r = room.round;
  var round = null;
  if (r) {
    var territories = {};
    for (var tid in r.territories) {
      territories[tid] = { owner: r.territories[tid].owner, value: r.territories[tid].value };
    }
    var alliances = {};
    for (var aid in r.alliances) {
      var a = r.alliances[aid];
      alliances[aid] = {
        id: a.id, name: a.name, members: a.members.slice(),
        createdBy: a.createdBy, metalIndex: a.metalIndex
      };
    }
    var visibleOffers = {};
    for (var oid in r.offers) {
      var o = r.offers[oid];
      if (o.from === seat || o.to.indexOf(seat) !== -1) {
        visibleOffers[oid] = offers.serializeOffer(o);
      }
    }
    round = {
      number: r.number,
      startingSeat: r.startingSeat,
      turnOrder: (r.turnOrder || []).slice(),
      territories: territories,
      alliances: alliances,
      turn: {
        seat: r.turn.seat,
        turnNumber: r.turn.turnNumber,
        attacksMade: r.turn.attacksMade,
        hasJoined: r.turn.hasJoined,
        hasDefected: r.turn.hasDefected
      },
      offers: visibleOffers,
      winner: r.winner ? {
        type: r.winner.type,
        seats: r.winner.seats.slice(),
        allianceName: r.winner.allianceName || null
      } : null
    };
  }
  return {
    roomCode: room.roomCode,
    phase: room.phase,
    hostSeat: room.hostSeat,
    settings: {
      mapId: room.settings.mapId,
      playerCount: room.settings.playerCount,
      pointsScheme: room.settings.pointsScheme || "equal"
    },
    yourSeat: seat,
    players: room.players.map(function (p) {
      return {
        seat: p.seat, name: p.name, connected: p.connected, isBot: !!p.isBot,
        colorIndex: typeof p.colorIndex === "number" ? p.colorIndex : p.seat,
        eliminated: p.eliminated, allianceId: p.allianceId, winPoints: p.winPoints
      };
    }),
    // The viewer's own re-entry code is a credential — never anyone else's.
    yourCode: (getPlayer(room, seat) || {}).playerCode || null,
    notifyOptIn: !!(getPlayer(room, seat) || {}).notifyOptIn,
    round: round,
    log: room.log.slice()
  };
}

function lobbySnapshot(room) {
  return {
    players: room.players.map(function (p) {
      return {
        seat: p.seat, name: p.name, connected: p.connected, isBot: !!p.isBot,
        colorIndex: typeof p.colorIndex === "number" ? p.colorIndex : p.seat,
        winPoints: p.winPoints
      };
    }),
    settings: {
      mapId: room.settings.mapId,
      playerCount: room.settings.playerCount,
      pointsScheme: room.settings.pointsScheme || "equal"
    },
    hostSeat: room.hostSeat
  };
}

function scoreboard(room) {
  return room.players.map(function (p) {
    return { seat: p.seat, name: p.name, winPoints: p.winPoints };
  });
}

// ---------------------------------------------------------------------------
// Map adjacency (cached id -> Set per map)
// ---------------------------------------------------------------------------

var adjacencyCache = {};
function adjacencyIndex(mapId) {
  if (!adjacencyCache[mapId]) {
    var idx = {};
    MAPS[mapId].territories.forEach(function (t) {
      var set = {};
      t.adjacent.forEach(function (n) { set[n] = true; });
      idx[t.id] = set;
    });
    adjacencyCache[mapId] = idx;
  }
  return adjacencyCache[mapId];
}

// ---------------------------------------------------------------------------
// Win + elimination checkers — ownership changes only in attack; faction
// composition changes in formation/join/defect/dissolve/elimination. Both
// checkers run after each of those.
// ---------------------------------------------------------------------------

function computeWinner(room) {
  var r = room.round;
  var owners = {};
  var ownerList = [];
  for (var id in r.territories) {
    var s = r.territories[id].owner;
    if (!owners[s]) { owners[s] = true; ownerList.push(s); }
  }
  if (ownerList.length === 1) {
    var solo = getPlayer(room, ownerList[0]);
    // A sole owner with a surviving ally is impossible (the ally would own 0
    // and be eliminated), but award the faction if it somehow happens.
    if (solo.allianceId != null && r.alliances[solo.allianceId]) {
      var sa = r.alliances[solo.allianceId];
      return { type: "alliance", seats: sa.members.slice(), allianceId: sa.id, allianceName: sa.name };
    }
    return { type: "solo", seats: [ownerList[0]] };
  }
  // Alliance win: every territory owner belongs to one alliance. This is what
  // makes the everyone-alliance fire at FORMATION time, not just conquest.
  for (var aid in r.alliances) {
    var a = r.alliances[aid];
    var allIn = ownerList.every(function (o) { return a.members.indexOf(o) !== -1; });
    if (allIn) return { type: "alliance", seats: a.members.slice(), allianceId: aid, allianceName: a.name };
  }
  return null;
}

/*
 * Split the 60 points among the winners according to the room's scheme.
 *
 * "equal"  — the original rule: 60 / winners, always an integer (1..6 all
 *            divide 60).
 * "spoils" — the Shapley value of a natural two-part victory game:
 *            v(S) = 30·(S's share of the winners' final force) + 30·[S is the
 *            full coalition]. Half the pot rewards the PACT ITSELF (nobody
 *            wins without the whole coalition — split equally), half rewards
 *            each member's contribution: their share of the force standing at
 *            the moment of victory. Rounded to integers by largest remainder
 *            so the shares always sum to exactly 60.
 */
function splitPoints(room, winner) {
  var seats = winner.seats;
  var awards = {};
  if (seats.length === 1 || (room.settings.pointsScheme || "equal") === "equal") {
    seats.forEach(function (s) { awards[s] = WIN_POINTS / seats.length; });
    return awards;
  }

  var force = {};
  var total = 0;
  for (var tid in room.round.territories) {
    var t = room.round.territories[tid];
    if (seats.indexOf(t.owner) !== -1) {
      force[t.owner] = (force[t.owner] || 0) + t.value;
      total += t.value;
    }
  }
  var half = WIN_POINTS / 2;
  var exact = seats.map(function (s) {
    var share = total > 0 ? (force[s] || 0) / total : 1 / seats.length;
    return { seat: s, value: half / seats.length + half * share };
  });
  // Largest-remainder rounding: floor everything, then hand the leftover
  // points to the biggest fractional parts. Deterministic tiebreak by seat.
  var floorSum = 0;
  exact.forEach(function (e) { e.floor = Math.floor(e.value); e.frac = e.value - e.floor; floorSum += e.floor; });
  exact.sort(function (a, b) { return b.frac - a.frac || a.seat - b.seat; });
  for (var i = 0; i < WIN_POINTS - floorSum; i++) exact[i % exact.length].floor += 1;
  exact.forEach(function (e) { awards[e.seat] = e.floor; });
  return awards;
}

function checkRoundEnd(room) {
  if (room.phase !== "playing") return [];
  var winner = computeWinner(room);
  if (!winner) return [];

  var pointsAwarded = splitPoints(room, winner); // reads the final board
  room.phase = "round_end";
  room.round.winner = winner;
  winner.seats.forEach(function (s) { getPlayer(room, s).winPoints += pointsAwarded[s]; });

  var events = offers.voidAll(room, "round_ended");
  rooms.pushLog(room, "round_end", {
    winner: { type: winner.type, seats: winner.seats.slice(), allianceName: winner.allianceName || null },
    pointsAwarded: pointsAwarded
  });
  events.push({
    type: "round_ended",
    data: { winner: winner, pointsAwarded: pointsAwarded, scoreboard: scoreboard(room) }
  });
  return events;
}

function removeFromAlliance(room, seat, reason) {
  var events = [];
  var r = room.round;
  var me = getPlayer(room, seat);
  var alliance = r.alliances[me.allianceId];
  if (!alliance) { me.allianceId = null; return events; }

  alliance.members = alliance.members.filter(function (s) { return s !== seat; });
  me.allianceId = null;
  events.push({
    type: "member_left",
    data: { allianceId: alliance.id, seat: seat, members: alliance.members.slice(), reason: reason }
  });
  // An alliance of one is no alliance: auto-dissolve, freeing its metal.
  if (alliance.members.length < 2) {
    alliance.members.forEach(function (s) { getPlayer(room, s).allianceId = null; });
    delete r.alliances[alliance.id];
    events.push({ type: "dissolved", data: { allianceId: alliance.id, reason: "too_few_members" } });
  }
  return events;
}

function checkElimination(room, seat) {
  var p = getPlayer(room, seat);
  if (!p || p.eliminated) return [];
  var r = room.round;
  for (var id in r.territories) {
    if (r.territories[id].owner === seat) return []; // still holds ground
  }
  p.eliminated = true;
  rooms.pushLog(room, "eliminated", { seat: seat });
  var events = [{
    type: "player_eliminated",
    data: { seat: seat, turnNumber: r.turn.turnNumber }
  }];
  if (p.allianceId != null) {
    events = events.concat(removeFromAlliance(room, seat, "eliminated"));
  }
  events = events.concat(offers.sweepAutoVoid(room));
  return events;
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

function setSettings(room, seat, data) {
  if (seat !== room.hostSeat) return fail("NOT_HOST", "Only the host can change settings.");
  if (room.phase === "playing") return fail("BAD_PHASE", "Settings are locked during a round.");

  var mapId = data && data.mapId != null ? data.mapId : room.settings.mapId;
  var playerCount = data && data.playerCount != null ? data.playerCount : room.settings.playerCount;
  var pointsScheme = data && data.pointsScheme != null ? data.pointsScheme
    : (room.settings.pointsScheme || "equal");
  if (!MAPS[mapId]) return fail("BAD_SETTINGS", "Unknown map: " + mapId);
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 6) {
    return fail("BAD_SETTINGS", "Player count must be 2-6.");
  }
  if (pointsScheme !== "equal" && pointsScheme !== "spoils") {
    return fail("BAD_SETTINGS", "Unknown points scheme: " + pointsScheme);
  }
  if (room.playerCountLocked && playerCount !== room.settings.playerCount) {
    return fail("PLAYER_COUNT_LOCKED", "Player count is locked once the first round has started.");
  }
  if (playerCount < room.players.length) {
    return fail("BAD_SETTINGS", "Player count cannot drop below the " + room.players.length + " commanders already seated.");
  }
  room.settings.mapId = mapId;
  room.settings.playerCount = playerCount;
  room.settings.pointsScheme = pointsScheme;
  return ok([{ type: "lobby_update", data: lobbySnapshot(room) }]);
}

function startRound(room, seat, data, opts) {
  if (seat !== room.hostSeat) return fail("NOT_HOST", "Only the host can start the round.");
  if (room.phase === "playing") return fail("BAD_PHASE", "A round is already in progress.");
  var n = room.settings.playerCount;
  if (room.players.length !== n) {
    return fail("ROOM_NOT_READY", "Waiting for commanders (" + room.players.length + "/" + n + ").");
  }
  var map = MAPS[room.settings.mapId];
  if (!map) return fail("BAD_SETTINGS", "Map not available: " + room.settings.mapId);

  var number = room.round ? room.round.number + 1 : 1;
  // Designer revision: moving early is a real edge, so the whole turn ORDER is
  // shuffled fresh every round instead of rotating a fixed sequence.
  var randInt = (opts && opts.randInt) || require("crypto").randomInt;
  var turnOrder = [];
  for (var s = 0; s < n; s++) turnOrder.push(s);
  for (var i = turnOrder.length - 1; i > 0; i--) {
    var j = randInt(i + 1);
    var tmp = turnOrder[i]; turnOrder[i] = turnOrder[j]; turnOrder[j] = tmp;
  }
  var startingSeat = turnOrder[0];

  room.players.forEach(function (p) {
    p.eliminated = false;
    p.allianceId = null;
  });

  var territoryIds = map.territories.map(function (t) { return t.id; });
  var territories = setup.deal(territoryIds, n, opts && opts.randInt);

  room.round = {
    number: number,
    startingSeat: startingSeat,
    turnOrder: turnOrder,
    territories: territories,
    alliances: {},
    turn: {
      seat: startingSeat,
      turnNumber: 1,
      attacksMade: 0,
      hasJoined: false,
      hasDefected: false,
      lastActionAt: (opts && opts.now) || Date.now()
    },
    offers: {},
    winner: null,
    nextOfferId: 0,
    nextAllianceId: 0
  };
  room.phase = "playing";
  room.playerCountLocked = true;
  rooms.pushLog(room, "turn", { seat: startingSeat, turnNumber: 1, roundNumber: number });

  return ok([
    { type: "round_started", data: {}, withState: true },
    { type: "turn_began", data: { seat: startingSeat, turnNumber: 1 } }
  ]);
}

function attack(room, seat, data, opts) {
  if (room.phase !== "playing") return fail("BAD_PHASE", "No round in progress.");
  var r = room.round;
  if (r.turn.seat !== seat) return fail("NOT_YOUR_TURN", "It is not your turn.");
  var fromId = data ? data.from : null;
  var toId = data ? data.to : null;
  var from = r.territories[fromId];
  var to = r.territories[toId];
  if (!from || !to) return fail("BAD_TARGET", "Unknown territory.");
  if (from.owner !== seat) return fail("NOT_YOURS", "You do not hold that territory.");
  if (from.value < 2) return fail("TOO_WEAK", "A territory needs at least 2 strength to attack.");
  if (r.turn.attacksMade >= ATTACKS_PER_TURN) {
    return fail("ATTACK_LIMIT", "You have launched all " + ATTACKS_PER_TURN + " attacks for this turn.");
  }
  // Designer revision: while your alliance offer/join request is out, your
  // armies hold — rescind it or await the answer before marching.
  if (offers.hasPendingOutgoing(r, seat)) {
    return fail("ENVOY_OUT", "Your envoy is still out — rescind the offer or await the answer before attacking.");
  }
  var adj = adjacencyIndex(room.settings.mapId);
  if (!adj[fromId] || !adj[fromId][toId]) return fail("NOT_ADJACENT", "Those territories do not border each other.");
  if (to.owner === seat) return fail("OWN_TERRITORY", "You already hold the target.");
  var me = getPlayer(room, seat);
  var defender = getPlayer(room, to.owner);
  if (me.allianceId != null && defender && defender.allianceId === me.allianceId) {
    return fail("TARGET_IS_ALLY", "You cannot attack a member of your alliance.");
  }

  var payload = battle.resolveAttack(r, fromId, toId, opts && opts.randInt);
  r.turn.attacksMade += 1;
  rooms.pushLog(room, "battle", {
    from: fromId, to: toId,
    attackerSeat: payload.attackerSeat, defenderSeat: payload.defenderSeat,
    attackerTotal: payload.attackerTotal, defenderTotal: payload.defenderTotal,
    attackerDice: payload.attackerDice.length, defenderDice: payload.defenderDice.length,
    won: payload.won
  });

  var events = [{ type: "attack_resolved", data: payload }];
  events = events.concat(checkElimination(room, payload.defenderSeat));
  events = events.concat(checkRoundEnd(room));
  return ok(events);
}

function defect(room, seat) {
  if (room.phase !== "playing") return fail("BAD_PHASE", "No round in progress.");
  var turn = room.round.turn;
  if (turn.seat !== seat) return fail("NOT_YOUR_TURN", "Defection happens on your own turn.");
  // Designer revision: defection is legal at ANY point in your turn — even
  // after attacking. Once per turn still applies.
  if (turn.hasDefected) return fail("DEFECT_USED", "You already defected this turn.");
  var me = getPlayer(room, seat);
  if (me.allianceId == null) return fail("NOT_IN_ALLIANCE", "You are not in an alliance.");

  var allianceId = me.allianceId;
  var events = removeFromAlliance(room, seat, "defected");
  turn.hasDefected = true;
  rooms.pushLog(room, "defected", { allianceId: allianceId, seat: seat });
  events = events.concat(offers.sweepAutoVoid(room));
  events = events.concat(checkRoundEnd(room));
  return ok(events);
}

/*
 * End-turn pipeline — IDENTICAL for end_turn and force_end_turn:
 * void the leaving player's unanswered offers (designer ruling: an offer
 * lives only while the offerer's turn is open) -> auto-void sweep ->
 * checkRoundEnd -> advance to next non-eliminated seat, reset flags,
 * turnNumber++, turn_began.
 */
function endTurnPipeline(room, opts, forced) {
  var events = [];
  events = events.concat(offers.voidTurnOffers(room, room.round.turn.seat, "turn_ended"));
  events = events.concat(offers.sweepAutoVoid(room));
  events = events.concat(checkRoundEnd(room));
  if (room.phase !== "playing") return events; // defensive: a faction change elsewhere may already have ended the round

  var turn = room.round.turn;
  // Advance along the round's shuffled turn order, skipping the fallen.
  var order = room.round.turnOrder;
  var idx = order.indexOf(turn.seat);
  var s;
  do { idx = (idx + 1) % order.length; s = order[idx]; } while (getPlayer(room, s).eliminated);
  turn.seat = s;
  turn.turnNumber += 1;
  turn.attacksMade = 0;
  turn.hasJoined = false;
  turn.hasDefected = false;
  turn.lastActionAt = (opts && opts.now) || Date.now();
  rooms.pushLog(room, "turn", forced ? { seat: s, turnNumber: turn.turnNumber, forced: true }
                                     : { seat: s, turnNumber: turn.turnNumber });
  events.push({ type: "turn_began", data: { seat: s, turnNumber: turn.turnNumber } });
  return events;
}

function endTurn(room, seat, data, opts) {
  if (room.phase !== "playing") return fail("BAD_PHASE", "No round in progress.");
  if (room.round.turn.seat !== seat) return fail("NOT_YOUR_TURN", "It is not your turn.");
  return ok(endTurnPipeline(room, opts, false));
}

// Stall valve: the host can force the turn over when the active player is
// disconnected >= 60s or has done nothing for >= 3 minutes (AFK hostage).
function forceEndTurn(room, seat, data, opts) {
  if (room.phase !== "playing") return fail("BAD_PHASE", "No round in progress.");
  if (seat !== room.hostSeat) return fail("NOT_HOST", "Only the host can force-end a turn.");
  var now = (opts && opts.now) || Date.now();
  var active = getPlayer(room, room.round.turn.seat);
  var disconnectedLongEnough = !active.connected && active.disconnectedAt != null &&
    (now - active.disconnectedAt >= DISCONNECT_VALVE_MS);
  var afkLongEnough = (now - room.round.turn.lastActionAt) >= AFK_VALVE_MS;
  if (!disconnectedLongEnough && !afkLongEnough) {
    return fail("VALVE_CLOSED", "Force-end unlocks after 60s of disconnection or 3 minutes of inactivity.");
  }
  return ok(endTurnPipeline(room, opts, true));
}

// Escape hatch from value-1 stalemates: zero points, scoreboard intact.
function abortRound(room, seat) {
  if (room.phase !== "playing") return fail("BAD_PHASE", "No round in progress.");
  if (seat !== room.hostSeat) return fail("NOT_HOST", "Only the host can abort the round.");

  room.phase = "round_end";
  room.round.winner = null;
  var events = offers.voidAll(room, "round_ended");
  rooms.pushLog(room, "round_end", { winner: null, pointsAwarded: 0, aborted: true });
  events.push({
    type: "round_ended",
    data: { winner: null, pointsAwarded: 0, scoreboard: scoreboard(room) }
  });
  return ok(events);
}

function respondOffer(room, seat, data) {
  var res = offers.respond(room, seat, data);
  if (!res.ok) return res;
  // Formation/join can end the round instantly (everyone-alliance, or allying
  // with the only other landholder).
  if (res.factionChanged) {
    res.events = res.events.concat(checkRoundEnd(room));
  }
  return res;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

var HANDLERS = {
  set_settings: setSettings,
  start_round: startRound,
  offer_alliance: function (room, seat, data) { return offers.createAllianceOffer(room, seat, data); },
  request_join: function (room, seat, data) { return offers.createJoinRequest(room, seat, data); },
  respond_offer: respondOffer,
  rescind_offer: function (room, seat, data) { return offers.rescind(room, seat, data); },
  propose_rename: function (room, seat, data) { return offers.createRenameProposal(room, seat, data); },
  defect: defect,
  attack: attack,
  end_turn: endTurn,
  force_end_turn: forceEndTurn,
  abort_round: abortRound
};

function handle(room, seat, type, data, opts) {
  var handler = HANDLERS[type];
  if (!handler) return fail("UNKNOWN_COMMAND", "Unknown command: " + type);
  var result;
  try {
    result = handler(room, seat, data || {}, opts || {});
  } catch (e) {
    console.error("[engine] " + type + " threw:", e && e.stack || e);
    return fail("SERVER_ERROR", "Internal error handling " + type + ".");
  }
  // Idle tracking for the AFK valve: any successful action by the active seat
  // counts as activity. (Turn advancement stamps its own timestamp.)
  if (result.ok && room.phase === "playing" && room.round && room.round.turn.seat === seat) {
    room.round.turn.lastActionAt = (opts && opts.now) || Date.now();
  }
  return result;
}

module.exports = {
  handle: handle,
  serializeFor: serializeFor,
  lobbySnapshot: lobbySnapshot,
  scoreboard: scoreboard,
  computeWinner: computeWinner,
  checkRoundEnd: checkRoundEnd,
  checkElimination: checkElimination,
  endTurnPipeline: endTurnPipeline,
  WIN_POINTS: WIN_POINTS,
  ATTACKS_PER_TURN: ATTACKS_PER_TURN,
  AFK_VALVE_MS: AFK_VALVE_MS,
  DISCONNECT_VALVE_MS: DISCONNECT_VALVE_MS
};

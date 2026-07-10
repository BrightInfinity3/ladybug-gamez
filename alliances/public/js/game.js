/*
 * Game — the client-side state mirror.
 * Holds the personalized snapshot the server sends (room_joined / round_started /
 * state) and applies incremental events between snapshots so the UI always has
 * a current picture without waiting for full re-syncs.
 *
 * The mirror NEVER decides rules — the server is authoritative. Helpers here
 * (legalSources, attackOdds...) exist only to gray buttons and hint odds;
 * any drift is corrected by the next snapshot or an action_rejected.
 *
 * One-way dependency rule: renderer/animations/sound must NOT call Game.
 * ui.js is the only orchestrator.
 */
(function () {
  "use strict";

  var state = null;          // personalized payload, or null before joining
  var listeners = {};        // event -> [callbacks]; only 'change' is emitted

  // adjacency cache: built once per map, reused for every legality check
  var adjCache = { mapId: null, table: null };

  // ---- Emitter ----
  function on(evt, cb) {
    (listeners[evt] = listeners[evt] || []).push(cb);
  }
  function emit(evt, payload) {
    var list = listeners[evt];
    if (!list) return;
    var copy = list.slice();
    for (var i = 0; i < copy.length; i++) {
      try { copy[i](payload); } catch (e) { console.error("[Game] listener:", e); }
    }
  }

  // ---- Lookups ----
  function player(seat) {
    if (!state || !state.players) return null;
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].seat === seat) return state.players[i];
    }
    return null;
  }

  function aliveSeats() {
    if (!state || !state.players) return [];
    var out = [];
    for (var i = 0; i < state.players.length; i++) {
      if (!state.players[i].eliminated) out.push(state.players[i].seat);
    }
    return out;
  }

  function allianceOf(seat) {
    var p = player(seat);
    if (!p || !p.allianceId || !state.round || !state.round.alliances) return null;
    return state.round.alliances[p.allianceId] || null;
  }

  function areAllied(a, b) {
    if (a === b) return false;
    var pa = player(a), pb = player(b);
    return !!(pa && pb && pa.allianceId && pa.allianceId === pb.allianceId);
  }

  function activeMap() {
    if (!state || !state.settings) return null;
    var reg = (typeof window !== "undefined" && window.ALLIANCES_MAPS) ? window.ALLIANCES_MAPS
      : (typeof global !== "undefined" && global.ALLIANCES_MAPS) ? global.ALLIANCES_MAPS : null;
    return (reg && reg[state.settings.mapId]) || null;
  }

  function adjacency() {
    var map = activeMap();
    if (!map) return {};
    if (adjCache.mapId === map.id && adjCache.table) return adjCache.table;
    var table = {};
    for (var i = 0; i < map.territories.length; i++) {
      var t = map.territories[i];
      table[t.id] = t.adjacent || [];
    }
    adjCache = { mapId: map.id, table: table };
    return table;
  }

  // ---- Normalization (defensive defaults on every snapshot) ----
  function normPlayer(p) {
    return {
      seat: p.seat,
      name: p.name || "",
      isBot: !!p.isBot,
      colorIndex: typeof p.colorIndex === "number" ? p.colorIndex : p.seat,
      connected: p.connected !== false,
      eliminated: !!p.eliminated,
      allianceId: p.allianceId || null,
      winPoints: p.winPoints || 0
    };
  }

  function normalize(s) {
    if (!s) return null;
    s.players = (s.players || []).map(normPlayer);
    s.log = s.log || [];
    if (s.round) {
      s.round.territories = s.round.territories || {};
      s.round.alliances = s.round.alliances || {};
      s.round.offers = s.round.offers || {};
    }
    return s;
  }

  function pushLog(kind, data) {
    if (!state) return;
    state.log = state.log || [];
    state.log.push({
      t: Date.now(),
      turnNumber: (state.round && state.round.turn) ? state.round.turn.turnNumber : 0,
      kind: kind,
      data: data
    });
    if (state.log.length > 100) state.log.splice(0, state.log.length - 100);
  }

  function storeOffer(d) {
    var o = d && (d.offer || d);
    if (!o || !o.id || !state || !state.round) return null;
    state.round.offers = state.round.offers || {};
    state.round.offers[o.id] = o;
    return o;
  }

  function clearAllianceMembership(allianceId) {
    if (!state) return;
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].allianceId === allianceId) state.players[i].allianceId = null;
    }
  }

  // ---- Reducers (one per server event type) ----
  var reducers = {

    // Client-synthesized after `room_created` (which carries no snapshot):
    // a minimal lobby state so the UI can render while request_state round-trips.
    room_created: function (d) {
      state = normalize({
        roomCode: d.roomCode,
        phase: "lobby",
        hostSeat: d.seat,
        settings: { mapId: "hexfield", playerCount: 2 },
        yourSeat: d.seat,
        players: [{ seat: d.seat, name: d.name || "", connected: true, eliminated: false, allianceId: null, winPoints: 0 }],
        round: null,
        log: []
      });
    },

    room_joined: function (d) { if (d && d.state) state = normalize(d.state); },
    round_started: function (d) { if (d && d.state) state = normalize(d.state); },
    state: function (d) { if (d && d.state) state = normalize(d.state); },

    lobby_update: function (d) {
      if (!d) return;
      if (!state) {
        state = normalize({
          roomCode: "", phase: "lobby", hostSeat: 0,
          settings: d.settings || { mapId: "hexfield", playerCount: 2 },
          yourSeat: -1, players: [], round: null, log: []
        });
      }
      if (d.players) {
        // Merge by seat so fields lobby_update doesn't carry survive — but only
        // when the seat still holds the SAME player (a seat vacated and refilled
        // between rounds must not inherit the old occupant's elimination).
        var prev = {};
        for (var i = 0; i < state.players.length; i++) prev[state.players[i].seat] = state.players[i];
        state.players = d.players.map(function (p) {
          var old = prev[p.seat];
          var merged = normPlayer(p);
          if (old && old.name === p.name && old.isBot === merged.isBot) {
            merged.eliminated = old.eliminated;
            merged.allianceId = old.allianceId;
          }
          return merged;
        });
      }
      if (d.settings) state.settings = d.settings;
      if (typeof d.hostSeat === "number") state.hostSeat = d.hostSeat;
    },

    turn_began: function (d) {
      if (!state || !state.round) return;
      state.round.turn = {
        seat: d.seat,
        turnNumber: d.turnNumber,
        attacksMade: 0,
        hasJoined: false,
        hasDefected: false
      };
      pushLog("turn", { seat: d.seat, turnNumber: d.turnNumber });
    },

    attack_resolved: function (d) {
      if (!state || !state.round) return;
      var t = state.round.territories;
      if (d.fromAfter) t[d.from] = { owner: d.fromAfter.owner, value: d.fromAfter.value };
      if (d.toAfter) t[d.to] = { owner: d.toAfter.owner, value: d.toAfter.value };
      if (state.round.turn && state.round.turn.seat === d.attackerSeat) {
        state.round.turn.attacksMade = (state.round.turn.attacksMade || 0) + 1;
      }
      pushLog("attack", d);
    },

    offer_created: function (d) {
      var o = storeOffer(d);
      // Sending a make/join offer consumes your join action — mirror it so the
      // JOIN button stays honestly disabled if the offer later dies un-refunded
      // (declined/expired; only a rescind gives the action back).
      if (o && o.kind !== "rename" && state && state.round && state.round.turn &&
          o.from === state.yourSeat && state.round.turn.seat === state.yourSeat) {
        state.round.turn.hasJoined = true;
      }
    },

    offer_updated: function (d) {
      var o = storeOffer(d);
      // Designer ruling 1: rescinding your own offer REFUNDS the join action
      // the same turn, so the JOIN button comes back. (Renames never consumed
      // the join action, so they refund nothing.)
      if (o && o.status === "rescinded" && o.kind !== "rename" && state && state.round && state.round.turn &&
          o.from === state.yourSeat && state.round.turn.seat === state.yourSeat) {
        state.round.turn.hasJoined = false;
      }
    },

    alliance_formed: function (d) {
      if (!state || !state.round) return;
      var a = d.alliance || d;
      if (!a || !a.id) return;
      state.round.alliances[a.id] = a;
      var members = a.members || [];
      for (var i = 0; i < members.length; i++) {
        var p = player(members[i]);
        if (p) p.allianceId = a.id;
      }
      pushLog("alliance_formed", { id: a.id, name: a.name, members: members.slice() });
    },

    member_joined: function (d) {
      if (!state || !state.round) return;
      var aid = d.allianceId || (d.alliance && d.alliance.id);
      if (d.alliance && d.alliance.id) {
        state.round.alliances[d.alliance.id] = d.alliance;
      } else if (aid && state.round.alliances[aid]) {
        var a = state.round.alliances[aid];
        if (a.members.indexOf(d.seat) < 0) a.members.push(d.seat);
      }
      var p = player(d.seat);
      if (p) p.allianceId = aid || p.allianceId;
      pushLog("member_joined", { allianceId: aid, seat: d.seat });
    },

    member_left: function (d) {
      if (!state || !state.round) return;
      var a = state.round.alliances[d.allianceId];
      if (a && a.members) {
        a.members = a.members.filter(function (s) { return s !== d.seat; });
      }
      var p = player(d.seat);
      if (p && p.allianceId === d.allianceId) p.allianceId = null;
      pushLog("member_left", { allianceId: d.allianceId, seat: d.seat, reason: d.reason || null });
    },

    dissolved: function (d) {
      if (!state || !state.round) return;
      var a = state.round.alliances[d.allianceId];
      pushLog("dissolved", { allianceId: d.allianceId, name: a ? a.name : null });
      clearAllianceMembership(d.allianceId);
      delete state.round.alliances[d.allianceId];
    },

    renamed: function (d) {
      if (!state || !state.round) return;
      var a = state.round.alliances[d.allianceId];
      var newName = d.name || d.newName || (d.alliance && d.alliance.name);
      if (a && newName) {
        pushLog("renamed", { allianceId: d.allianceId, from: a.name, to: newName });
        a.name = newName;
      }
    },

    player_eliminated: function (d) {
      var p = player(d.seat);
      if (p) {
        p.eliminated = true;
        // The server also broadcasts member_left/dissolved; clearing here too
        // keeps the mirror right even if those land out of order.
        p.allianceId = null;
      }
      pushLog("eliminated", { seat: d.seat, turnNumber: d.turnNumber });
    },

    player_connection: function (d) {
      var p = player(d.seat);
      if (p) p.connected = !!d.connected;
    },

    round_ended: function (d) {
      if (!state) return;
      state.phase = "round_end";
      if (state.round) state.round.winner = d.winner || null;
      // scoreboard: accept either an array of {seat, winPoints} or a seat->points map
      if (d.scoreboard) {
        if (Object.prototype.toString.call(d.scoreboard) === "[object Array]") {
          for (var i = 0; i < d.scoreboard.length; i++) {
            var row = d.scoreboard[i];
            var p = player(row.seat);
            if (p && typeof row.winPoints === "number") p.winPoints = row.winPoints;
          }
        } else {
          for (var seatKey in d.scoreboard) {
            var pl = player(parseInt(seatKey, 10));
            if (pl && typeof d.scoreboard[seatKey] === "number") pl.winPoints = d.scoreboard[seatKey];
          }
        }
      }
      pushLog("round_end", { winner: d.winner || null, pointsAwarded: d.pointsAwarded });
    },

    room_disbanded: function () {
      state = null;
    }
  };

  // ---- Odds math ----
  // Sum of n d6: mean 3.5n, variance 35n/12. Attacker (a dice) beats defender
  // (d dice) iff sum_A - sum_D >= 1 (ties defend). Normal approximation with
  // continuity correction at 0.5 is plenty accurate for a UI hint.
  function normalCdf(z) {
    // Abramowitz & Stegun 26.2.17
    var t = 1 / (1 + 0.2316419 * Math.abs(z));
    var dteil = 0.3989423 * Math.exp(-z * z / 2);
    var p = dteil * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  }

  function attackWinProb(attackerDice, defenderDice) {
    if (attackerDice <= 0) return 0;
    if (defenderDice <= 0) return 1;
    var mean = 3.5 * (attackerDice - defenderDice);
    var sd = Math.sqrt((35 * (attackerDice + defenderDice)) / 12);
    var z = (0.5 - mean) / sd;
    return 1 - normalCdf(z);
  }

  function attackOdds(attackerDice, defenderDice) {
    var p = attackWinProb(attackerDice, defenderDice);
    if (p > 0.58) return "favored";
    if (p < 0.42) return "risky";
    return "even";
  }

  // ---- Legality helpers (mirror of the server's validation, for graying UI) ----
  function isMyTurn() {
    if (!state || state.phase !== "playing" || !state.round || !state.round.turn) return false;
    if (state.round.turn.seat !== state.yourSeat) return false;
    var me = player(state.yourSeat);
    return !!me && !me.eliminated;
  }

  function targetsFor(id) {
    if (!state || !state.round) return [];
    var terr = state.round.territories;
    var mine = terr[id];
    if (!mine) return [];
    var adj = adjacency()[id] || [];
    var me = mine.owner;
    var out = [];
    for (var i = 0; i < adj.length; i++) {
      var n = terr[adj[i]];
      if (!n) continue;
      if (n.owner === me) continue;
      if (areAllied(n.owner, me)) continue;
      out.push(adj[i]);
    }
    return out;
  }

  function legalSources() {
    if (!isMyTurn()) return [];
    var terr = state.round.territories;
    var out = [];
    for (var id in terr) {
      var t = terr[id];
      if (t.owner !== state.yourSeat) continue;
      if (t.value < 2) continue;
      if (targetsFor(id).length > 0) out.push(id);
    }
    return out;
  }

  // ---- Public API ----
  var Game = {
    applyEvent: function (type, data) {
      var reducer = reducers[type];
      if (!reducer) return false;
      reducer(data || {});
      emit("change", { type: type, data: data });
      return true;
    },

    isMyTurn: isMyTurn,
    legalSources: legalSources,
    targetsFor: targetsFor,
    attackOdds: attackOdds,
    attackWinProb: attackWinProb, // exposed for the confirm tooltip's percentage
    on: on,

    // Convenience lookups for ui.js (extras beyond the pinned contract)
    player: player,
    allianceOf: allianceOf,
    areAllied: areAllied,
    aliveSeats: aliveSeats,
    reset: function () { state = null; emit("change", { type: "reset" }); }
  };

  Object.defineProperty(Game, "state", { get: function () { return state; } });
  Object.defineProperty(Game, "mySeat", {
    get: function () { return state ? state.yourSeat : null; }
  });
  Object.defineProperty(Game, "map", { get: activeMap });

  if (typeof window !== "undefined") window.Game = Game;
  if (typeof module !== "undefined" && module.exports) module.exports = Game;
})();

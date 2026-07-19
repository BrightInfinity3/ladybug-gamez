/* ============================================================
   Animal Battle Champions - Flow (round orchestrator)

   One code path shared by OFFLINE mode and the ONLINE HOST.
   Guests never run Flow; they replay broadcast event lists.

   Responsibilities:
     - owns the live battle object (created via Engine)
     - collects player intents for the current round (kept in
       module-local state, NEVER written into the battle object,
       so BossAI structurally cannot see them)
     - holds the boss's committed intent for the UPCOMING round.
       The boss commits at the END of the previous round (round 1:
       at battle start) - blind by construction. The commitment
       lives only here, is never serialized into snapshots, and
       is revealed only via Owl's Foresight event.
     - fills AI-companion seats via CompanionAI at resolve time
     - auto-applies AI companions' forced switches, prompts the
       sink for human ones
     - finishes Foresight: replaces the engine's
       {t:'foresightPending'} marker with {t:'foresight', cat}
       once the boss's next intent is committed.

   sink interface (all optional, supplied by main.js / online.js):
     onIntentStatus(locked)            // [{seat, kind, cat?}] for lock chips
     onRoundResolved({events, snapshot})
     onSwitchApplied({events, snapshot})
     onNeedSwitch(seats)               // human seats that must pick
     onBattleEnd(result, snapshot)     // 'victory' | 'defeat'

   Round pacing: after onRoundResolved, Flow waits until the
   renderer calls openSelection() before the next round can
   resolve (prevents an AI-only battle from resolving many rounds
   synchronously with no playback in between).
   ============================================================ */
var Flow = (function () {
  'use strict';

  var battle = null;
  var sink = {};
  var pendingIntents = {};    // seat -> intent (module-local; never in battle)
  var nextBossIntent = null;  // the boss's committed action for the upcoming round
  var collecting = false;     // selection window open?
  var rng = Math.random;

  function party(seat) {
    for (var i = 0; i < battle.parties.length; i++) {
      if (battle.parties[i].seat === seat) return battle.parties[i];
    }
    return null;
  }

  function partyAlive(p) {
    for (var i = 0; i < p.animals.length; i++) {
      if (!p.animals[i].fainted) return true;
    }
    return false;
  }

  // Seats whose intent must arrive from OUTSIDE (humans with a living
  // deployed animal that is not locked into a forced action).
  function neededSeats() {
    var out = [];
    if (!battle) return out;
    for (var i = 0; i < battle.parties.length; i++) {
      var p = battle.parties[i];
      if (p.controller !== 'human') continue;
      if (!partyAlive(p)) continue;
      var active = p.animals[p.activeIndex];
      if (!active || active.fainted) continue;
      var legal = Engine.legalOptions(battle, p.seat);
      if (legal && legal.forced) continue;   // e.g. charge release auto-fires
      out.push(p.seat);
    }
    return out;
  }

  function lockedList() {
    var out = [];
    Object.keys(pendingIntents).forEach(function (seat) {
      var it = pendingIntents[seat];
      out.push({ seat: Number(seat), kind: it.kind, cat: it.cat });
    });
    return out;
  }

  function emit(name, a, b) {
    if (sink && typeof sink[name] === 'function') {
      try { sink[name](a, b); } catch (e) {
        if (typeof console !== 'undefined') console.error('Flow sink ' + name + ' failed:', e);
      }
    }
  }

  function startBattle(opts) {
    // opts: { parties:[{seat,name,controller,team:[id x3]}], rung, sink, rng? }
    sink = opts.sink || {};
    rng = opts.rng || Math.random;
    pendingIntents = {};
    collecting = false;
    var boss = GameData.bossByRung(opts.rung);
    battle = Engine.createBattle({ parties: opts.parties, bossId: boss.id, rung: opts.rung });
    nextBossIntent = BossAI.chooseIntent(battle, rng);   // round-1 commit, pre-picks
    return Engine.publicSnapshot(battle);
  }

  // Renderer signals the selection window is open (initially and after
  // each round's playback finishes).
  function openSelection() {
    if (!battle) return;
    if (battle.phase !== 'select') return;
    collecting = true;
    maybeResolve();
  }

  function submitIntent(seat, intent) {
    if (!battle || battle.phase !== 'select') return false;
    var p = party(seat);
    if (!p || p.controller !== 'human' || !partyAlive(p)) return false;
    var legal = Engine.legalOptions(battle, seat);
    if (!legal || !legal.canAct || legal.forced) return false;
    if (intent.kind === 'move') {
      if (!legal.cats || !legal.cats[intent.cat]) return false;
    } else if (intent.kind === 'switch') {
      if (!legal.switchTo || legal.switchTo.indexOf(intent.to) === -1) return false;
    } else {
      return false;
    }
    pendingIntents[seat] = intent;
    emit('onIntentStatus', lockedList());
    maybeResolve();
    return true;
  }

  function undoIntent(seat) {
    // Allowed until the round actually resolves (local convenience; the
    // online layer may disallow it for guests to keep things simple).
    if (!battle || battle.phase !== 'select') return false;
    if (!(seat in pendingIntents)) return false;
    delete pendingIntents[seat];
    emit('onIntentStatus', lockedList());
    return true;
  }

  function maybeResolve() {
    if (!battle || battle.phase !== 'select' || !collecting) return;
    var needed = neededSeats();
    for (var i = 0; i < needed.length; i++) {
      if (!(needed[i] in pendingIntents)) return;   // still waiting on a human
    }
    collecting = false;

    // Fill AI-companion seats now (they pick blind too - they can only
    // read battle state, and current-round human intents are not in it).
    for (var j = 0; j < battle.parties.length; j++) {
      var p = battle.parties[j];
      if (p.controller !== 'ai' || !partyAlive(p)) continue;
      var active = p.animals[p.activeIndex];
      if (!active || active.fainted) continue;
      var legal = Engine.legalOptions(battle, p.seat);
      if (legal && legal.forced) continue;
      if (!(p.seat in pendingIntents)) {
        pendingIntents[p.seat] = CompanionAI.chooseIntent(battle, p.seat, rng);
      }
    }

    var intents = pendingIntents;
    pendingIntents = {};
    var bossIntent = nextBossIntent;
    nextBossIntent = null;

    var res = Engine.resolveRound(battle, intents, bossIntent, rng);
    battle = res.battle;
    var events = res.events;

    // Commit the boss's NEXT action (end-of-round, before anyone picks).
    if (battle.phase !== 'victory' && battle.phase !== 'defeat') {
      nextBossIntent = BossAI.chooseIntent(battle, rng);
      for (var k = 0; k < events.length; k++) {
        if (events[k].t === 'foresightPending') {
          events[k] = { t: 'foresight', seat: events[k].seat, cat: nextBossIntent.cat };
        }
      }
    } else {
      events = events.filter(function (ev) { return ev.t !== 'foresightPending'; });
    }

    var snapshot = Engine.publicSnapshot(battle);
    emit('onRoundResolved', { events: events, snapshot: snapshot });

    afterResolution();
  }

  // Handle forced switches and battle end after a resolution or a
  // forced-switch application.
  function afterResolution() {
    if (!battle) return;

    if (battle.phase === 'victory' || battle.phase === 'defeat') {
      emit('onBattleEnd', battle.phase, Engine.publicSnapshot(battle));
      return;
    }

    if (battle.phase === 'awaitSwitch') {
      // Auto-apply AI companions' forced switches immediately.
      var pending = battle.pendingSwitchSeats.slice();
      for (var i = 0; i < pending.length; i++) {
        var p = party(pending[i]);
        if (!p || p.controller !== 'ai') continue;
        var slot = CompanionAI.chooseSwitchIn(battle, p.seat, rng);
        var res = Engine.applyForcedSwitch(battle, p.seat, slot);
        battle = res.battle;
        emit('onSwitchApplied', { events: res.events, snapshot: Engine.publicSnapshot(battle) });
      }
      if (battle.phase === 'awaitSwitch') {
        // Humans still owe a pick.
        emit('onNeedSwitch', battle.pendingSwitchSeats.slice());
        return;
      }
    }
    // phase is back to 'select'; the renderer calls openSelection() when
    // its playback queue drains.
  }

  function submitForcedSwitch(seat, slot) {
    if (!battle || battle.phase !== 'awaitSwitch') return false;
    if (battle.pendingSwitchSeats.indexOf(seat) === -1) return false;
    var res = Engine.applyForcedSwitch(battle, seat, slot);
    if (!res) return false;
    battle = res.battle;
    emit('onSwitchApplied', { events: res.events, snapshot: Engine.publicSnapshot(battle) });
    afterResolution();
    return true;
  }

  // Host migration: a newly promoted online host resumes from the last
  // broadcast snapshot. Half-collected intents died with the old host
  // (by design - worst case everyone re-picks once), and the boss
  // commits a FRESH next action against the adopted state (still blind:
  // the adopted snapshot contains no current-round intents).
  function adoptBattle(snapshotBattle, opts) {
    opts = opts || {};
    sink = opts.sink || sink || {};
    rng = opts.rng || Math.random;
    battle = JSON.parse(JSON.stringify(snapshotBattle));
    pendingIntents = {};
    collecting = false;
    nextBossIntent = null;
    if (battle.phase !== 'victory' && battle.phase !== 'defeat') {
      nextBossIntent = BossAI.chooseIntent(battle, rng);
    }
    return Engine.publicSnapshot(battle);
  }

  // ONLINE-ONLY: mid-battle seat control handoff (guest drop -> AI
  // takeover, rejoin -> back to human). Flips ONLY the party's
  // controller field; AI fill / needed-seat logic reads it live.
  function setSeatController(seat, controller) {
    if (!battle) { return false; }
    if (controller !== 'ai' && controller !== 'human') { return false; }
    var p = party(seat);
    if (!p) { return false; }
    p.controller = controller;
    return true;
  }

  function getSnapshot() { return battle ? Engine.publicSnapshot(battle) : null; }
  function getPhase() { return battle ? battle.phase : null; }
  function getNeededSeats() { return neededSeats(); }
  function getLocked() { return lockedList(); }
  function isActive() { return !!battle && battle.phase !== 'victory' && battle.phase !== 'defeat'; }

  function reset() {
    battle = null; sink = {}; pendingIntents = {}; nextBossIntent = null; collecting = false;
  }

  return {
    startBattle: startBattle,
    adoptBattle: adoptBattle,
    openSelection: openSelection,
    submitIntent: submitIntent,
    undoIntent: undoIntent,
    submitForcedSwitch: submitForcedSwitch,
    setSeatController: setSeatController,
    getSnapshot: getSnapshot,
    getPhase: getPhase,
    getNeededSeats: getNeededSeats,
    getLocked: getLocked,
    isActive: isActive,
    reset: reset
  };
})();

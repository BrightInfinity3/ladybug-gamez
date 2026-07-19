/* ============================================================
   Animal Battle Champions - main.js (composition root)
   Wires Save + Screens + Flow + BattleRender + CompanionAI + Online
   into the playable game: solo (human seat 0 plus 0-2 AI allies)
   AND online co-op (2-3 humans + optional AI seats vs the boss).

   Modes (netMode):
     null    - offline solo. Flow runs locally, nothing touches the net.
     'host'  - online host. SAME Flow/sink path as offline, plus a
               broadcast tap (Online.getHostTap()) layered on top of
               every sink event; guest intents flow into Flow via
               online.js.
     'guest' - online guest. NO Flow. BattleRender is driven purely by
               host broadcasts (round_result/switch_applied/etc.);
               intents/switches are sent to the host, locks optimistic.

   Battle pacing (all modes): BattleRender.onPlaybackDone is the
   single pump - end-of-battle, forced-switch prompts and reopening
   the selection window all wait for the playback queue to drain.
   ============================================================ */
(function () {
  'use strict';

  var run = null;            // { rung, parties:[{seat,controller,name,team}] }
  var currentRung = 0;
  var pendingEnd = null;     // {result, snapshot} parked until playback drains
  var pendingSwitchSeats = [];
  var resumePending = false;

  // online state
  var netMode = null;            // null | 'host' | 'guest'
  var mySeats = [0];             // seats this device controls
  var netTap = null;             // Online.getHostTap() during online-host battles
  var guestLockedRound = null;   // round the guest optimistically locked

  function $(id) { return document.getElementById(id); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function guard(name, fn) {
    return function () {
      try {
        return fn.apply(null, arguments);
      } catch (e) {
        console.error('[main] ' + name + ' failed:', e);
        if (window.Screens) { Screens.toast('Oops - something went wrong. (' + name + ')'); }
        return undefined;
      }
    };
  }

  function unlockedIds() {
    return SpriteEngine.getAnimalList().filter(function (id) { return Save.isUnlocked(id); });
  }

  function isMySeat(seat) { return mySeats.indexOf(seat) !== -1; }

  // === run state (solo) ====================================================
  function validRun(r) {
    if (!r || typeof r !== 'object') { return false; }
    if (typeof r.rung !== 'number' || r.rung < 1 || r.rung > GameData.BOSSES.length) { return false; }
    if (!(r.parties instanceof Array) || r.parties.length < 1 || r.parties.length > 3) { return false; }
    if (r.parties[0].controller !== 'human') { return false; }
    for (var i = 0; i < r.parties.length; i++) {
      var p = r.parties[i];
      if (!p || (p.controller !== 'human' && p.controller !== 'ai')) { return false; }
      if (typeof p.name !== 'string' || !p.name) { return false; }
      if (!(p.team instanceof Array) || p.team.length !== 3) { return false; }
      var seen = {};
      for (var t = 0; t < 3; t++) {
        var id = p.team[t];
        if (!GameData.ANIMALS[id] || seen[id]) { return false; }
        seen[id] = true;
      }
    }
    return true;
  }

  function normalizeRun(r) {
    var parties = [];
    for (var i = 0; i < r.parties.length; i++) {
      parties.push({
        seat: i,
        controller: r.parties[i].controller,
        name: r.parties[i].name,
        team: r.parties[i].team.slice()
      });
    }
    return { rung: r.rung, parties: parties };
  }

  function persistRun() {
    Save.patch({ currentRun: run ? clone(run) : null });
  }

  function buildRun(partiesFromScreens) {
    var taken = [];
    var seats = [];
    var i;
    for (i = 0; i < partiesFromScreens.length; i++) {
      if (partiesFromScreens[i].controller === 'human') { taken.push(partiesFromScreens[i].team); }
    }
    for (i = 0; i < partiesFromScreens.length && seats.length < 3; i++) {
      var p = partiesFromScreens[i];
      if (p.controller === 'human') {
        seats.push({ seat: seats.length, controller: 'human', name: p.name || 'You', team: p.team.slice() });
      } else {
        var team = CompanionAI.draftParty(unlockedIds(), taken, Math.random);
        taken.push(team);
        var name = p.name || SpriteEngine.pickNickname(team[0]);
        seats.push({ seat: seats.length, controller: 'ai', name: name, team: team });
      }
    }
    return {
      rung: Math.min(GameData.BOSSES.length, Save.data.ladder.highestRungCleared + 1),
      parties: seats
    };
  }

  // === battle orchestration ================================================
  function latestSnapshot() {
    return netMode === 'guest' ? Online.getLatestSnapshot() : Flow.getSnapshot();
  }

  function enterSelection() {
    var snap = latestSnapshot();
    if (!snap) { return; }
    var legalBySeat = {};
    for (var i = 0; i < mySeats.length; i++) {
      legalBySeat[mySeats[i]] = Engine.legalOptions(snap, mySeats[i]);
    }
    BattleRender.enterSelection(legalBySeat);
  }

  var onIntent = guard('onIntent', function (seat, intent) {
    if (netMode === 'guest') {
      var snap = Online.getLatestSnapshot();
      if (!snap || snap.phase !== 'select') {
        Screens.toast("Can't do that right now.");
        return false;
      }
      guestLockedRound = snap.round;
      Online.sendIntent(seat, intent, snap.round);
      return true;   // optimistic lock; host rejects via intent_rejected
    }
    var ok = Flow.submitIntent(seat, intent);
    if (!ok) { Screens.toast("Can't do that right now."); }
    return ok;
  });

  var onForcedSwitch = guard('onForcedSwitch', function (seat, slot) {
    if (netMode === 'guest') {
      Online.sendSwitchChoice(seat, slot);
      return true;
    }
    var ok = Flow.submitForcedSwitch(seat, slot);
    if (!ok) {
      Screens.toast('Pick someone else!');
      BattleRender.promptForcedSwitch(seat);
    }
    return ok;
  });

  var onPlaybackDone = guard('onPlaybackDone', function () {
    if (pendingEnd) {
      var pe = pendingEnd;
      pendingEnd = null;
      pendingSwitchSeats = [];
      finishBattle(pe);
      return;
    }
    while (pendingSwitchSeats.length > 0) {
      var seat = pendingSwitchSeats.shift();
      // validate against the latest snapshot - the host may have
      // auto-picked for us (deadline) while our playback was running
      var sw = latestSnapshot();
      if (sw && sw.phase === 'awaitSwitch' && sw.pendingSwitchSeats &&
          sw.pendingSwitchSeats.indexOf(seat) !== -1) {
        BattleRender.promptForcedSwitch(seat);
        return;
      }
    }
    if (netMode === 'guest') {
      var snap = Online.getLatestSnapshot();
      if (snap && snap.phase === 'select' && guestLockedRound !== snap.round) {
        enterSelection();
      }
      return;
    }
    if (Flow.getPhase() === 'select') {
      // openSelection may resolve the round SYNCHRONOUSLY (e.g. the
      // human's animal is locked into a charge release) - in that case
      // a new playback is already queued and selection must stay shut.
      Flow.openSelection();
      if (Flow.getPhase() === 'select' && !BattleRender.isPlaying()) {
        enterSelection();
      }
    }
  });

  function playRound(payload) {
    var foresight = null;
    for (var i = 0; i < payload.events.length; i++) {
      if (payload.events[i].t === 'foresight') { foresight = payload.events[i]; }
    }
    BattleRender.play(payload.events).then(function () {
      BattleRender.syncTo(payload.snapshot);
      if (foresight) { BattleRender.showForesight(foresight.cat); }
    });
  }

  // Shared Flow sink (offline + online host). When netTap is set (online
  // host), every event is ALSO broadcast to the guests - broadcast first
  // so their playback starts while ours does.
  var sink = {
    onIntentStatus: guard('onIntentStatus', function (locked) {
      if (netTap) { netTap.onIntentStatus(locked); }
      BattleRender.setLocked(locked);
    }),
    onRoundResolved: guard('onRoundResolved', function (payload) {
      if (netTap) { netTap.onRoundResolved(payload); }
      playRound(payload);
    }),
    onSwitchApplied: guard('onSwitchApplied', function (payload) {
      if (netTap) { netTap.onSwitchApplied(payload); }
      BattleRender.play(payload.events).then(function () {
        BattleRender.syncTo(payload.snapshot);
      });
    }),
    onNeedSwitch: guard('onNeedSwitch', function (seats) {
      if (netTap) { netTap.onNeedSwitch(seats); }
      pendingSwitchSeats = seats.filter(isMySeat);
    }),
    onBattleEnd: guard('onBattleEnd', function (result, snapshot) {
      if (netTap) { netTap.onBattleEnd(result, snapshot); }
      pendingEnd = { result: result, snapshot: snapshot };
    })
  };

  function battleRenderOpts() {
    return {
      mySeats: mySeats.slice(),
      onIntent: onIntent,
      onForcedSwitch: onForcedSwitch,
      onPlaybackDone: onPlaybackDone
    };
  }

  function startBattle(rung) {   // offline solo
    if (!run) {
      Screens.toast('Set up your party first!');
      Screens.show('mode');
      return;
    }
    var maxFightable = Math.min(GameData.BOSSES.length, Save.data.ladder.highestRungCleared + 1);
    if (typeof rung !== 'number' || rung < 1 || rung > maxFightable) {
      Screens.toast('That rung is still locked.');
      return;
    }
    netMode = null;
    netTap = null;
    mySeats = [0];
    pendingEnd = null;
    pendingSwitchSeats = [];
    guestLockedRound = null;
    currentRung = rung;
    Flow.reset();
    var snapshot = Flow.startBattle({ parties: clone(run.parties), rung: rung, sink: sink });
    Screens.show('battle');
    BattleRender.mount(snapshot, battleRenderOpts());
    Flow.openSelection();
    enterSelection();
  }

  function computeFlawless(snapshot) {
    for (var i = 0; i < snapshot.parties.length; i++) {
      var animals = snapshot.parties[i].animals;
      for (var a = 0; a < animals.length; a++) {
        if (animals[a].fainted) { return false; }
      }
    }
    return true;
  }

  function finishBattle(pe) {
    if (netMode === 'host' || netMode === 'guest') {
      finishOnlineBattle(pe);
      return;
    }
    var boss = GameData.bossByRung(currentRung);
    if (pe.result === 'victory') {
      BattleRender.playRestoration(boss).then(guard('victorySequence', function () {
        var flawless = computeFlawless(pe.snapshot);
        var rounds = Math.max(1, (pe.snapshot.round || 1) - 1);
        var res = Save.recordVictory('solo', boss.id, { flawless: flawless, rounds: rounds });
        Screens.showVictory({
          boss: boss,
          restoreLine: boss.restoreLine,
          unlocked: res.newlyUnlocked,
          defer: true
        });
        Screens.show('result');
        finishResultReveal(res.newlyUnlocked);
        if (boss.rung === GameData.BOSSES.length) {
          run = null;
          persistRun();
          Screens.toast('LADDER CLEARED - every champion is free!');
        } else if (run) {
          run.rung = Math.min(GameData.BOSSES.length, Save.data.ladder.highestRungCleared + 1);
          persistRun();
        }
      }));
    } else {
      Screens.showDefeat({ boss: boss });
      Screens.show('result');
    }
  }

  // === online battle end: cinematic -> coop save -> back to the ROOM =======
  function advanceHostLadder(boss) {
    var lad = clone(Save.data.ladder);
    var changed = false;
    if (boss.rung > lad.highestRungCleared) {
      lad.highestRungCleared = boss.rung;
      changed = true;
    }
    if (lad.restoredBosses.indexOf(boss.id) === -1) {
      lad.restoredBosses.push(boss.id);
      changed = true;
    }
    if (changed) { Save.patch({ ladder: lad }); }
  }

  function finishOnlineBattle(pe) {
    var boss = GameData.bossById(pe.snapshot.boss.id) || GameData.bossByRung(currentRung);
    if (pe.result === 'victory') {
      Online.setRestoring(true);
      BattleRender.playRestoration(boss).then(guard('coopVictory', function () {
        Online.setRestoring(false);
        var rounds = Math.max(1, (pe.snapshot.round || 1) - 1);
        var res = Save.recordVictory('coop', boss.id, { rounds: rounds });
        if (netMode === 'host') {
          advanceHostLadder(boss);
          Online.afterBattleReturn();
        }
        var animalName = SpriteEngine.getAnimalName(boss.animal);
        returnToRoom('VICTORY! ' + animalName + ' is restored!');
        if (res.newlyUnlocked) {
          Screens.toast(animalName + ' joins YOUR roster!');
        }
      }));
    } else {
      if (netMode === 'host') { Online.afterBattleReturn(); }
      returnToRoom('Defeat... regroup, ready up, and try again!');
    }
  }

  function returnToRoom(msg) {
    pendingEnd = null;
    pendingSwitchSeats = [];
    guestLockedRound = null;
    netTap = null;
    Flow.reset();
    BattleRender.reset();
    Screens.renderRoom(Online.getLobby() || {}, { isHost: Online.isHost(), mySeat: Online.getMySeat() });
    Screens.show('room');
    if (msg) { Screens.toast(msg); }
  }

  function refreshRoom() {
    Screens.renderRoom(Online.getLobby() || {}, { isHost: Online.isHost(), mySeat: Online.getMySeat() });
  }

  function clearOnlineState() {
    netMode = null;
    netTap = null;
    mySeats = [0];
    guestLockedRound = null;
    pendingEnd = null;
    pendingSwitchSeats = [];
  }

  // Screens.showVictory({defer:true}) builds the result DOM but runs no
  // cinematic (battle-render already played the full one in the arena).
  // Re-run a quick reveal on the result screen so it ends in the light.
  function finishResultReveal(unlocked) {
    setTimeout(function () {
      var img = $('restore-img');
      if (img) { img.classList.add('restored'); }
      var burst = $('light-burst');
      if (burst) { burst.classList.add('run'); }
      setTimeout(function () {
        var nameNode = $('restore-name');
        if (nameNode) {
          nameNode.textContent = nameNode.getAttribute('data-restored-name') || '';
          nameNode.classList.add('freed');
        }
        var line = $('restore-line');
        if (line) { line.classList.add('shown'); }
        var un = $('result-unlocked');
        if (un && unlocked) { un.hidden = false; }
      }, 700);
    }, 250);
  }

  // === Online handler registry =============================================
  Online.init({
    onLobby: guard('net.onLobby', function (lobby, m) {
      Screens.renderRoom(lobby || {}, { isHost: m.isHost, mySeat: m.mySeat });
    }),

    onToast: guard('net.onToast', function (msg) {
      if (msg) { Screens.toast(msg); }
    }),

    // HOST: start the battle through the same Flow/sink path as offline,
    // with the broadcast tap layered on. Returns the initial snapshot so
    // online.js can put it in the battle_start broadcast.
    onHostStart: guard('net.onHostStart', function (cfg) {
      netMode = 'host';
      mySeats = [Online.getMySeat()];
      netTap = Online.getHostTap();
      pendingEnd = null;
      pendingSwitchSeats = [];
      guestLockedRound = null;
      currentRung = cfg.rung;
      Flow.reset();
      var snapshot = Flow.startBattle({ parties: clone(cfg.parties), rung: cfg.rung, sink: sink });
      Screens.show('battle');
      BattleRender.mount(snapshot, battleRenderOpts());
      Flow.openSelection();
      enterSelection();
      return snapshot;
    }),

    onGuestBattleStart: guard('net.onGuestBattleStart', function (cfg) {
      netMode = 'guest';
      mySeats = [cfg.mySeat];
      netTap = null;
      pendingEnd = null;
      pendingSwitchSeats = [];
      guestLockedRound = null;
      currentRung = cfg.rung;
      Flow.reset();
      Screens.show('battle');
      BattleRender.mount(cfg.snapshot, battleRenderOpts());
      if (cfg.snapshot.phase === 'select') { enterSelection(); }
    }),

    onIntentStatus: guard('net.onIntentStatus', function (locked) {
      BattleRender.setLocked(locked);
    }),

    onIntentRejected: guard('net.onIntentRejected', function (data) {
      guestLockedRound = null;
      var snap = Online.getLatestSnapshot();
      // only re-open if the host is still on the round we were rejected
      // for; otherwise a round_result is in flight and will re-open it.
      if (snap && data && snap.round === data.round && snap.phase === 'select') {
        Screens.toast('That pick was rejected - choose again.');
        if (!BattleRender.isPlaying()) { enterSelection(); }
      }
    }),

    onRoundResolved: guard('net.onRoundResolved', function (payload) {
      playRound(payload);   // pacing continues in onPlaybackDone (guest branch)
    }),

    onSwitchApplied: guard('net.onSwitchApplied', function (payload) {
      BattleRender.play(payload.events).then(function () {
        BattleRender.syncTo(payload.snapshot);
      });
    }),

    onNeedSwitch: guard('net.onNeedSwitch', function (seatList, deadline) {
      pendingSwitchSeats = seatList.filter(isMySeat);
      if (!pendingSwitchSeats.length) { return; }
      Screens.toast('Choose your next fighter! (' + deadline + 's)');
      if (!BattleRender.isPlaying()) {
        BattleRender.promptForcedSwitch(pendingSwitchSeats.shift());
      }
    }),

    onBattleEnd: guard('net.onBattleEnd', function (data) {
      pendingEnd = { result: data.result, snapshot: data.snapshot };
      if (!BattleRender.isPlaying()) {
        var pe = pendingEnd;
        pendingEnd = null;
        pendingSwitchSeats = [];
        finishBattle(pe);
      }
    }),

    // Guest applying a full sync (reconnect, rejoin, host migration):
    // rebuild cleanly whatever we were doing.
    onGameSync: guard('net.onGameSync', function (d) {
      guestLockedRound = null;
      pendingEnd = null;
      pendingSwitchSeats = [];
      if (d.phase === 'battle' && d.battle) {
        netMode = 'guest';
        netTap = null;
        mySeats = [d.mySeat];
        currentRung = d.battle.rung;
        Flow.reset();   // guests never run Flow (kills a demoted host's stale one)
        BattleRender.mount(d.battle, battleRenderOpts());
        Screens.show('battle');
        BattleRender.setLocked(d.locked);
        var minePicked = false;
        for (var i = 0; i < d.locked.length; i++) {
          if (isMySeat(d.locked[i].seat)) { minePicked = true; }
        }
        if (minePicked) { guestLockedRound = d.battle.round; }
        if (d.battle.phase === 'select' && !minePicked) {
          enterSelection();
        } else if (d.battle.phase === 'awaitSwitch' &&
                   d.battle.pendingSwitchSeats.indexOf(mySeats[0]) !== -1) {
          BattleRender.promptForcedSwitch(mySeats[0]);
        }
      } else {
        netTap = null;
        BattleRender.reset();
        Flow.reset();
        Screens.renderRoom(d.lobbyState || {}, { isHost: Online.isHost(), mySeat: d.mySeat });
        Screens.show('room');
      }
    }),

    // Host migration: WE were promoted. Adopt the last snapshot into
    // Flow with the full host sink (broadcast tap included).
    onAdoptBattle: guard('net.onAdoptBattle', function (d) {
      netMode = 'host';
      mySeats = [Online.getMySeat()];
      netTap = Online.getHostTap();
      pendingEnd = null;
      pendingSwitchSeats = [];
      guestLockedRound = null;
      Flow.reset();
      var snap = Flow.adoptBattle(d.snapshot, { sink: sink });
      currentRung = snap.rung;
      BattleRender.mount(snap, battleRenderOpts());
      Screens.show('battle');
      return snap;
    }),

    // Called after online.js flipped departed seats to AI: re-open the
    // adopted round (everyone re-picks) or settle pending switches.
    onAdoptOpen: guard('net.onAdoptOpen', function () {
      var snap = Flow.getSnapshot();
      if (!snap) { return; }
      if (snap.phase === 'awaitSwitch') {
        var pend = snap.pendingSwitchSeats.slice();
        var aiSeat = null;
        for (var i = 0; i < pend.length; i++) {
          for (var p = 0; p < snap.parties.length; p++) {
            if (snap.parties[p].seat === pend[i] && snap.parties[p].controller === 'ai') {
              aiSeat = pend[i];
            }
          }
        }
        if (aiSeat != null) {
          // afterResolution cascades the remaining AI switches + humans
          Flow.submitForcedSwitch(aiSeat, CompanionAI.chooseSwitchIn(snap, aiSeat, Math.random));
        } else {
          sink.onNeedSwitch(pend);
          if (pendingSwitchSeats.length && !BattleRender.isPlaying()) {
            BattleRender.promptForcedSwitch(pendingSwitchSeats.shift());
          }
        }
      } else if (snap.phase === 'select') {
        Flow.openSelection();
        if (Flow.getPhase() === 'select' && !BattleRender.isPlaying()) {
          enterSelection();
        }
      }
    }),

    // WE handed the host role to someone else (voluntary handoff):
    // stop running Flow immediately; the new host's game_state_sync
    // remounts us as a pure guest renderer.
    onDemoted: guard('net.onDemoted', function () {
      netMode = 'guest';
      netTap = null;
      mySeats = [Online.getMySeat()];
      guestLockedRound = null;
      Flow.reset();
      Screens.toast('Host role handed over.');
    }),

    onRoomClosed: guard('net.onRoomClosed', function (reason) {
      clearOnlineState();
      Flow.reset();
      BattleRender.reset();
      Screens.toast(reason || 'The room was closed.');
      Screens.show('lobby');
    })
  });

  // === hooks ===============================================================
  var hooks = {
    onSoloStart: guard('onSoloStart', function (opts) {
      clearOnlineState();
      run = buildRun((opts && opts.parties) || []);
      resumePending = false;
      Save.data.stats.runsStarted = (Save.data.stats.runsStarted || 0) + 1;
      persistRun();
      Screens.renderLadder(Save.data);
      Screens.show('ladder');
      var allies = run.parties.length - 1;
      Screens.toast(allies > 0
        ? 'Party ready - ' + allies + ' AI ' + (allies === 1 ? 'ally joins' : 'allies join') + ' you!'
        : 'Going in alone. Brutal - and brave.');
    }),

    onFight: guard('onFight', function (rung) { startBattle(rung); }),

    onCreateRoom: guard('onCreateRoom', function (name) {
      Screens.toast('Creating room...');
      Online.createRoom(name).then(guard('createRoomOk', function (code) {
        netMode = 'host';
        mySeats = [0];
        refreshRoom();
        Screens.show('room');
        Screens.toast('Room ' + code + ' - share the code, then pick your TEAM!');
      }), guard('createRoomFail', function (err) {
        Screens.toast((err && err.message) || 'Could not create the room.');
      }));
    }),

    onJoinRoom: guard('onJoinRoom', function (code, name) {
      Screens.toast('Joining ' + code + '...');
      Online.joinRoom(code, name).then(guard('joinRoomOk', function (res) {
        netMode = 'guest';
        mySeats = [res.seat];
        Screens.renderRoom(res.lobbyState || {}, { isHost: false, mySeat: res.seat });
        Screens.show('room');
        Screens.toast('Joined! Pick your TEAM, then READY up.');
      }), guard('joinRoomFail', function (err) {
        Screens.toast((err && err.message) || 'Could not join that room.');
      }));
    }),

    onRoomStart: guard('onRoomStart', function () {
      if (!Online.isHost()) {
        Screens.toast('Only the host can start the battle.');
        return;
      }
      Online.requestStart();
    }),

    onSetParty: guard('onSetParty', function (team) {
      if (!Online.isOnline()) {
        Screens.toast('Join a room first!');
        Screens.show('lobby');
        return;
      }
      Online.setParty(team);
      refreshRoom();
      Screens.show('room');
      Screens.toast('Team locked in - press READY!');
    }),

    onReadyToggle: guard('onReadyToggle', function (ready) {
      if (!Online.isOnline()) { return; }
      var ok = Online.setReady(ready);
      if (!ok) {
        Screens.toast('Pick your TEAM first!');
        refreshRoom();
      }
    }),

    onSeatAiToggle: guard('onSeatAiToggle', function (seatIdx, makeAi) {
      Online.toggleSeatAI(seatIdx, makeAi);
    }),

    onLeaveRoom: guard('onLeaveRoom', function () {
      if (Online.isOnline()) { Online.leaveRoom(); }
      clearOnlineState();
      Flow.reset();
      BattleRender.reset();
    })
  };

  // === boot ================================================================
  guard('boot', function () {
    Save.load();
    document.body.classList.toggle('reduced-motion', !!Save.data.settings.reduceMotion);

    var saved = Save.data.currentRun;
    if (validRun(saved)) {
      run = normalizeRun(saved);
      resumePending = true;
    } else if (saved) {
      Save.patch({ currentRun: null });   // corrupt run: drop it
    }

    Screens.init(hooks);

    // Resume interception: Screens' own PLAY handler runs first (it
    // validates + saves the name and shows the mode screen); this one
    // then jumps straight to the ladder when a run is waiting.
    var resume = guard('resume', function () {
      if (!resumePending) { return; }
      var input = $('input-player-name');
      var name = input ? input.value.replace(/^\s+|\s+$/g, '') : '';
      if (!name) { return; }   // Screens already toasted
      resumePending = false;
      Screens.show('ladder');
      Screens.toast('Run resumed - rung ' + run.rung + ' awaits!');
    });
    var playBtn = $('btn-play');
    if (playBtn) { playBtn.addEventListener('click', resume); }
    var nameInput = $('input-player-name');
    if (nameInput) {
      nameInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { resume(); }
      });
    }
  })();
})();

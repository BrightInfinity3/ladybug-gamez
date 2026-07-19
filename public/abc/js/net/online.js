/* ============================================================
   Animal Battle Champions - Online (window.Online)
   Lobby / seats / sync / migration layer on top of js/net/network.js.
   Host-authoritative: only the host runs Flow; guests are pure
   renderers driven by broadcasts. main.js subscribes to the handler
   registry below and owns ALL rendering (Screens / BattleRender);
   this file owns ALL protocol + seat bookkeeping.

   PROTOCOL (payloads relayed via Network.send / Network.broadcast)
     guest -> host:
       join_request  {username}            (synthesized by network.js)
       set_party     {team:[3 ids]}
       ready         {ready:bool}
       intent        {round, seat, intent}
       switch_choice {seat, slot}
       rejoin        {}                    (after self-reconnect / migration)
     host -> guest(s):
       join_response {ok:true, seat, lobbyState, rung} |
                     {ok:false, reason}
       lobby_state   {code, seats:[{name,controller,ready,connected,
                      peerId} x3], canStart, rung, hostPeerId}
       battle_start  {rung, bossId, parties, snapshot}
       intent_status {locked:[{seat,kind,cat}]}
       intent_rejected {round}             (targeted; guest re-picks)
       round_result  {events, snapshot}
       switch_wait   {seats, deadline}
       switch_applied{events, snapshot}
       battle_end    {result, snapshot}
       game_state_sync {lobbyState, rung, phase:'lobby'|'battle',
                        battle:snapshot|null, locked}
       toast         {msg}
   Boss committed intents / unresolved player intents NEVER appear in
   any payload (snapshots structurally exclude them).

   PUBLIC API (all no-ops unless applicable to the current role):
     Online.init(handlers)      register callbacks (once, at boot):
       onLobby(lobbyState, {isHost, mySeat, rung})
       onToast(msg)
       onHostStart({parties, rung, bossId}) -> snapshot   (host: run Flow)
       onGuestBattleStart({snapshot, rung, bossId, mySeat})
       onIntentStatus(locked)              (guest)
       onIntentRejected({round})           (guest)
       onRoundResolved({events, snapshot}) (guest)
       onSwitchApplied({events, snapshot}) (guest)
       onNeedSwitch(seats, deadline)       (guest)
       onBattleEnd({result, snapshot})     (guest)
       onGameSync({lobbyState, rung, phase, battle, locked, mySeat})
       onAdoptBattle({snapshot}) -> snapshot   (promoted host: adopt Flow)
       onAdoptOpen()                       (promoted host: re-open round)
       onDemoted()                         (old host handed off: now guest)
       onRoomClosed(reason)
     Online.createRoom(name) -> Promise(code)
     Online.joinRoom(code, name) -> Promise({seat, lobbyState, rung})
     Online.leaveRoom()
     Online.setParty(team) / Online.setReady(bool) -> bool
     Online.toggleSeatAI(seatIdx, makeAi)   (host)
     Online.requestStart() -> bool          (host)
     Online.sendIntent(seat, intent, round) (guest)
     Online.sendSwitchChoice(seat, slot)    (guest)
     Online.getHostTap()   sink-shaped broadcast tap for the host's Flow
     Online.afterBattleReturn()             (host: back-to-room reset)
     Online.setRestoring(bool)              (migration guard)
     Online.isOnline() / isHost() / getMySeat() / getLobby() /
     Online.getLatestSnapshot() / getRung()
   ============================================================ */
var Online = (function () {
  'use strict';

  var APPROVAL_TIMEOUT_MS = 10000;

  var handlers = {};
  var wired = false;

  var role = null;          // null | 'host' | 'guest'
  var mySeat = null;
  var hostPeerId = null;
  var inBattle = false;
  var restoring = false;

  // host-side seat model: [{name, controller:'human'|'ai'|null, ready,
  //   connected, peerId, team, departedName}]
  var seats = null;
  var lobbyRung = 1;
  var switchTimers = {};

  // guest-side mirrors
  var lastLobby = null;
  var lastSnapshot = null;
  var myParty = null;
  var myReady = false;
  var joinWait = null;      // {resolve, reject, timer}

  // === tiny helpers ========================================================
  function emit(name, a, b) {
    if (typeof handlers[name] === 'function') {
      try { return handlers[name](a, b); }
      catch (e) { console.error('[Online] handler ' + name + ' failed:', e); }
    }
    return undefined;
  }

  function toastAll(msg) {
    Network.broadcast({ type: 'toast', data: { msg: msg } });
    emit('onToast', msg);
  }

  function deadlineS() {
    return (window.GameData && GameData.TUNING && GameData.TUNING.SWITCH_DEADLINE_S) || 25;
  }

  function maxRung() {
    return (window.GameData && GameData.BOSSES) ? GameData.BOSSES.length : 8;
  }

  function computeLobbyRung() {
    var cleared = (window.Save && Save.data && Save.data.ladder)
      ? (Save.data.ladder.highestRungCleared || 0) : 0;
    return Math.min(maxRung(), cleared + 1);
  }

  function hostUnlockedIds() {
    var list = window.SpriteEngine ? SpriteEngine.getAnimalList() : [];
    if (!window.Save) { return list; }
    return list.filter(function (id) { return Save.isUnlocked(id); });
  }

  function aiSeatName() {
    try {
      var pool = (window.GameData && GameData.STARTER_ANIMALS) || [];
      var id = pool[Math.floor(Math.random() * pool.length)];
      if (window.SpriteEngine && id) { return SpriteEngine.pickNickname(id); }
    } catch (e) { /* fall through */ }
    return 'AI Ally';
  }

  function emptySeat() {
    return { name: null, controller: null, ready: false, connected: true,
             peerId: null, team: null, departedName: null };
  }

  function seatOfPeer(peerId) {
    if (!seats) { return null; }
    for (var i = 0; i < 3; i++) {
      if (seats[i].peerId && seats[i].peerId === peerId) { return i; }
    }
    return null;
  }

  function meta() {
    return {
      isHost: role === 'host',
      mySeat: mySeat,
      rung: role === 'host' ? lobbyRung : ((lastLobby && lastLobby.rung) || 1)
    };
  }

  function resetState() {
    clearAllSwitchTimers();
    if (joinWait) {
      clearTimeout(joinWait.timer);
      joinWait = null;
    }
    role = null; mySeat = null; hostPeerId = null;
    inBattle = false; restoring = false;
    seats = null; lobbyRung = 1;
    lastLobby = null; lastSnapshot = null;
    myParty = null; myReady = false;
  }

  // === host: lobby state ===================================================
  function computeCanStart() {
    if (!seats) { return false; }
    var humans = 0;
    for (var i = 0; i < 3; i++) {
      var s = seats[i];
      if (s.controller === 'human') {
        humans++;
        if (!s.team || !s.ready || s.connected === false) { return false; }
      }
    }
    return humans >= 1;
  }

  function buildLobbyState() {
    var out = [];
    for (var i = 0; i < 3; i++) {
      var s = seats ? seats[i] : null;
      out.push(s ? {
        name: s.name, controller: s.controller, ready: !!s.ready,
        connected: s.connected !== false, peerId: s.peerId || null
      } : { name: null, controller: null, ready: false, connected: true, peerId: null });
    }
    return {
      code: Network.getRoomCode(),
      seats: out,
      canStart: computeCanStart(),
      rung: lobbyRung,
      hostPeerId: Network.getMyPeerId()
    };
  }

  function broadcastLobby() {
    if (role !== 'host') { return; }
    lastLobby = buildLobbyState();
    Network.broadcast({ type: 'lobby_state', data: lastLobby });
    emit('onLobby', lastLobby, meta());
  }

  function buildSyncPayload() {
    var battleSnap = null;
    var locked = [];
    if (inBattle && window.Flow && Flow.isActive()) {
      battleSnap = Flow.getSnapshot();
      locked = Flow.getLocked();
    }
    return {
      lobbyState: buildLobbyState(),
      rung: lobbyRung,
      phase: battleSnap ? 'battle' : 'lobby',
      battle: battleSnap,
      locked: locked
    };
  }

  function sendSync(peerId) {
    Network.send(peerId, { type: 'game_state_sync', data: buildSyncPayload() });
  }

  // === host: joins =========================================================
  function handleJoinRequest(peerId, username) {
    if (role !== 'host' || !seats) { return; }
    username = String(username || 'Player').slice(0, 16);
    var i;
    // Rejoin-by-name reclaim, checked BEFORE the free-seat scan:
    //   1. a paused human seat with this name (they refreshed the page -
    //      their old socket sits in the relay grace window and can never
    //      come back as them, so hand the seat to the fresh connection)
    //   2. mid-battle: a seat the AI took over after this name departed
    var back = -1;
    for (i = 0; i < 3; i++) {
      if (seats[i].controller === 'human' && seats[i].connected === false &&
          seats[i].name === username) { back = i; break; }
    }
    if (back === -1 && inBattle) {
      for (i = 0; i < 3; i++) {
        if (seats[i].controller === 'ai' && !seats[i].peerId &&
            seats[i].departedName === username) { back = i; break; }
      }
    }
    if (back !== -1) {
      seats[back].name = username;
      seats[back].controller = 'human';
      seats[back].peerId = peerId;
      seats[back].connected = true;
      seats[back].departedName = null;
      if (inBattle) {
        seats[back].ready = true;
        if (window.Flow) { Flow.setSeatController(back, 'human'); }
      } else {
        // fresh page state on their side - make them re-pick + re-ready
        seats[back].team = null;
        seats[back].ready = false;
      }
      Network.send(peerId, { type: 'join_response',
        data: { ok: true, seat: back, lobbyState: buildLobbyState(), rung: lobbyRung } });
      if (inBattle) { sendSync(peerId); }
      broadcastLobby();
      toastAll(inBattle ? username + ' is back in the fight!' : username + ' reconnected!');
      return;
    }
    if (inBattle) {
      Network.send(peerId, { type: 'join_response',
        data: { ok: false, reason: 'Battle already started - spectating not supported yet' } });
      return;
    }
    var free = -1;
    for (i = 0; i < 3; i++) {
      if (seats[i].controller === null) { free = i; break; }
    }
    if (free === -1) {
      Network.send(peerId, { type: 'join_response',
        data: { ok: false, reason: 'Room is full' } });
      return;
    }
    seats[free] = emptySeat();
    seats[free].name = username;
    seats[free].controller = 'human';
    seats[free].peerId = peerId;
    Network.send(peerId, { type: 'join_response',
      data: { ok: true, seat: free, lobbyState: buildLobbyState(), rung: lobbyRung } });
    broadcastLobby();
    emit('onToast', username + ' joined the room!');
  }

  // === host: forced-switch deadline timers =================================
  function clearSwitchTimer(seat) {
    if (switchTimers[seat]) { clearTimeout(switchTimers[seat]); switchTimers[seat] = null; }
  }

  function clearAllSwitchTimers() {
    for (var k in switchTimers) {
      if (Object.prototype.hasOwnProperty.call(switchTimers, k)) { clearSwitchTimer(k); }
    }
    switchTimers = {};
  }

  function highestHpBench(snapshot, seat) {
    var party = null;
    for (var i = 0; i < snapshot.parties.length; i++) {
      if (snapshot.parties[i].seat === seat) { party = snapshot.parties[i]; break; }
    }
    if (!party) { return null; }
    var best = null, bestHp = -1;
    for (var s = 0; s < party.animals.length; s++) {
      if (s === party.activeIndex || party.animals[s].fainted) { continue; }
      if (party.animals[s].hp > bestHp) { bestHp = party.animals[s].hp; best = s; }
    }
    return best;
  }

  function armSwitchTimer(seat) {
    clearSwitchTimer(seat);
    switchTimers[seat] = setTimeout(function () {
      switchTimers[seat] = null;
      if (role !== 'host' || !inBattle || !window.Flow || !Flow.isActive()) { return; }
      if (Flow.getPhase() !== 'awaitSwitch') { return; }
      var snap = Flow.getSnapshot();
      if (snap.pendingSwitchSeats.indexOf(seat) === -1) { return; }
      if (seats && seats[seat] && seats[seat].connected === false) {
        // paused human: the battle waits for them - never auto-play
        armSwitchTimer(seat);
        return;
      }
      var slot = highestHpBench(snap, seat);
      if (slot == null) { return; }
      Flow.submitForcedSwitch(seat, slot);
      toastAll('Time up - auto-picked for ' + ((seats && seats[seat] && seats[seat].name) || 'a player'));
    }, deadlineS() * 1000);
  }

  function armSwitchTimers(seatList) {
    for (var i = 0; i < seatList.length; i++) {
      var s = seatList[i];
      if (s === mySeat) { continue; }
      if (!seats || !seats[s] || seats[s].controller !== 'human' || !seats[s].peerId) { continue; }
      armSwitchTimer(s);
    }
  }

  // === host: guest departures / battle takeover ============================
  function handleGuestGone(peerId) {
    var seat = seatOfPeer(peerId);
    if (seat == null) { return; }
    var nm = seats[seat].name || 'A player';
    clearSwitchTimer(seat);
    if (!inBattle) {
      seats[seat] = emptySeat();
      broadcastLobby();
      emit('onToast', nm + ' left the room.');
      return;
    }
    // mid-battle: convert the seat to AI so the fight can go on
    seats[seat].controller = 'ai';
    seats[seat].peerId = null;
    seats[seat].departedName = nm;
    seats[seat].ready = true;
    seats[seat].connected = true;
    if (window.Flow && Flow.isActive()) {
      Flow.setSeatController(seat, 'ai');
      var ph = Flow.getPhase();
      if (ph === 'select') {
        // if everyone else already locked, this re-triggers resolution
        Flow.openSelection();
      } else if (ph === 'awaitSwitch') {
        var snap = Flow.getSnapshot();
        if (snap.pendingSwitchSeats.indexOf(seat) !== -1 && window.CompanionAI) {
          Flow.submitForcedSwitch(seat, CompanionAI.chooseSwitchIn(snap, seat, Math.random));
        }
      }
    }
    broadcastLobby();
    toastAll(nm + ' disconnected - an AI takes over their seat.');
  }

  // === message handling ====================================================
  function handleMessage(from, payload) {
    if (!payload || !payload.type) { return; }
    var data = payload.data || {};
    var seat, snap;

    switch (payload.type) {
      // ---- host-side ----
      case 'join_request':
        handleJoinRequest(from, data.username);
        break;

      case 'set_party':
        if (role !== 'host') { break; }
        seat = seatOfPeer(from);
        if (seat == null || !validTeam(data.team)) { break; }
        seats[seat].team = data.team.slice(0, 3);
        broadcastLobby();
        break;

      case 'ready':
        if (role !== 'host') { break; }
        seat = seatOfPeer(from);
        if (seat == null) { break; }
        if (data.ready && !seats[seat].team) {
          Network.send(from, { type: 'toast', data: { msg: 'Pick a team first!' } });
          broadcastLobby();   // authoritative un-ready re-render
          break;
        }
        seats[seat].ready = !!data.ready;
        broadcastLobby();
        break;

      case 'intent':
        if (role !== 'host' || !inBattle || !window.Flow || !Flow.isActive()) { break; }
        seat = seatOfPeer(from);
        if (seat == null) { break; }
        snap = Flow.getSnapshot();
        var ok = false;
        if (data.round === snap.round && data.intent) {
          ok = Flow.submitIntent(seat, data.intent);
        }
        if (!ok) {
          Network.send(from, { type: 'intent_rejected', data: { round: snap.round } });
          Network.broadcast({ type: 'intent_status', data: { locked: Flow.getLocked() } });
        }
        break;

      case 'switch_choice':
        if (role !== 'host' || !inBattle || !window.Flow || !Flow.isActive()) { break; }
        seat = seatOfPeer(from);
        if (seat == null) { break; }
        clearSwitchTimer(seat);
        if (Flow.getPhase() !== 'awaitSwitch') { break; }
        snap = Flow.getSnapshot();
        if (snap.pendingSwitchSeats.indexOf(seat) === -1) { break; }
        if (!validBenchSlot(snap, seat, data.slot)) {
          Network.send(from, { type: 'switch_wait', data: { seats: [seat], deadline: deadlineS() } });
          armSwitchTimer(seat);
          break;
        }
        Flow.submitForcedSwitch(seat, data.slot);
        break;

      case 'rejoin':
        if (role !== 'host') { break; }
        seat = seatOfPeer(from);
        if (seat == null) { break; }
        seats[seat].connected = true;
        sendSync(from);
        broadcastLobby();
        break;

      // ---- guest-side ----
      case 'join_response':
        if (!joinWait) { break; }
        clearTimeout(joinWait.timer);
        var w = joinWait;
        joinWait = null;
        if (data.ok) {
          role = 'guest';
          mySeat = data.seat;
          if (data.lobbyState) {
            lastLobby = data.lobbyState;
            hostPeerId = data.lobbyState.hostPeerId || hostPeerId;
          }
          w.resolve({ seat: data.seat, lobbyState: data.lobbyState, rung: data.rung });
        } else {
          Network.disconnect();
          resetState();
          w.reject(new Error(data.reason || 'Join refused.'));
        }
        break;

      case 'lobby_state':
        if (role !== 'guest') { break; }
        lastLobby = data;
        hostPeerId = data.hostPeerId || hostPeerId;
        emit('onLobby', data, meta());
        break;

      case 'battle_start':
        if (role !== 'guest') { break; }
        inBattle = true;
        lastSnapshot = data.snapshot;
        myReady = false;
        emit('onGuestBattleStart', {
          snapshot: data.snapshot, rung: data.rung,
          bossId: data.bossId, parties: data.parties, mySeat: mySeat
        });
        break;

      case 'intent_status':
        if (role !== 'guest') { break; }
        emit('onIntentStatus', data.locked || []);
        break;

      case 'intent_rejected':
        if (role !== 'guest') { break; }
        emit('onIntentRejected', data);
        break;

      case 'round_result':
        if (role !== 'guest') { break; }
        lastSnapshot = data.snapshot;
        emit('onRoundResolved', { events: data.events || [], snapshot: data.snapshot });
        break;

      case 'switch_wait':
        if (role !== 'guest') { break; }
        emit('onNeedSwitch', data.seats || [], data.deadline || deadlineS());
        break;

      case 'switch_applied':
        if (role !== 'guest') { break; }
        lastSnapshot = data.snapshot;
        emit('onSwitchApplied', { events: data.events || [], snapshot: data.snapshot });
        break;

      case 'battle_end':
        if (role !== 'guest') { break; }
        inBattle = false;
        lastSnapshot = data.snapshot;
        myReady = false;
        // re-announce our party so a migrated host has it for the next rung
        if (myParty) { Network.send('host', { type: 'set_party', data: { team: myParty } }); }
        emit('onBattleEnd', { result: data.result, snapshot: data.snapshot });
        break;

      case 'game_state_sync':
        if (role !== 'guest') { break; }
        if (data.lobbyState) {
          lastLobby = data.lobbyState;
          hostPeerId = data.lobbyState.hostPeerId || hostPeerId;
        }
        if (data.phase === 'battle' && data.battle) {
          inBattle = true;
          lastSnapshot = data.battle;
        } else {
          inBattle = false;
        }
        emit('onGameSync', {
          lobbyState: data.lobbyState, rung: data.rung, phase: data.phase,
          battle: data.battle, locked: data.locked || [], mySeat: mySeat
        });
        if (data.lobbyState) { emit('onLobby', data.lobbyState, meta()); }
        break;

      case 'toast':
        emit('onToast', data.msg);
        break;
    }
  }

  function validTeam(team) {
    if (!(team instanceof Array) || team.length !== 3) { return false; }
    var seen = {};
    for (var i = 0; i < 3; i++) {
      var id = team[i];
      if (!window.GameData || !GameData.ANIMALS[id] || seen[id]) { return false; }
      seen[id] = true;
    }
    return true;
  }

  function validBenchSlot(snapshot, seat, slot) {
    if (typeof slot !== 'number') { return false; }
    for (var i = 0; i < snapshot.parties.length; i++) {
      var p = snapshot.parties[i];
      if (p.seat !== seat) { continue; }
      return !!(p.animals[slot] && !p.animals[slot].fainted && slot !== p.activeIndex);
    }
    return false;
  }

  // === connection events ===================================================
  function handlePaused(peerId) {
    if (role === 'host') {
      var seat = seatOfPeer(peerId);
      if (seat == null) { return; }
      seats[seat].connected = false;
      broadcastLobby();
      toastAll((seats[seat].name || 'A player') + ' reconnecting...');
    } else if (role === 'guest' && peerId === hostPeerId) {
      emit('onToast', 'Host reconnecting - hang tight...');
    }
  }

  function handleResumed(peerId) {
    if (role === 'host') {
      var seat = seatOfPeer(peerId);
      if (seat == null) { return; }
      seats[seat].connected = true;
      sendSync(peerId);
      broadcastLobby();
      emit('onToast', (seats[seat].name || 'A player') + ' is back!');
      // re-arm their forced-switch deadline if they still owe one
      if (inBattle && window.Flow && Flow.isActive() && Flow.getPhase() === 'awaitSwitch') {
        var snap = Flow.getSnapshot();
        if (snap.pendingSwitchSeats.indexOf(seat) !== -1) {
          Network.send(peerId, { type: 'switch_wait', data: { seats: [seat], deadline: deadlineS() } });
          armSwitchTimer(seat);
        }
      }
    } else if (role === 'guest' && peerId === hostPeerId) {
      emit('onToast', 'Host is back!');
    }
  }

  function handleSelfReconnect() {
    if (role === 'host') {
      broadcastLobby();
      if (inBattle && window.Flow && Flow.isActive()) {
        Network.broadcast({ type: 'game_state_sync', data: buildSyncPayload() });
      }
    } else if (role === 'guest') {
      Network.send('host', { type: 'rejoin' });
    }
  }

  function handleDisconnect(id) {
    if (!role) { return; }
    if (id === 'host') {
      // room disbanded / kicked / reclaim failed / migration exhausted
      var wasInRoom = role !== null;
      resetState();
      if (wasInRoom) { emit('onRoomClosed', 'Connection to the room was lost.'); }
      return;
    }
    if (role === 'host') { handleGuestGone(id); }
    // guests ignore other guests' departures - the host re-broadcasts state
  }

  // === host migration ======================================================
  function handleMigration(info) {
    if (info.type === 'proposal') {
      if (info.isMe) {
        if (restoring) {
          Network.declineMigrationProposal();
        } else {
          Network.acceptMigrationProposal();
          emit('onToast', 'Host lost - you are taking over...');
        }
      } else {
        emit('onToast', 'Host lost - choosing a new host...');
      }
      return;
    }
    if (info.type !== 'completed') { return; }
    if (info.newHostPeerId === Network.getMyPeerId()) {
      becomeHost(info);
      return;
    }
    if (role === 'host') {
      // WE were the host and someone else took over (voluntary handoff).
      // Demote cleanly: stop authoritative duties, keep a guest-side
      // mirror of the lobby, and let the new host's sync rebuild us.
      clearAllSwitchTimers();
      var mirror = buildLobbyState();
      mirror.hostPeerId = info.newHostPeerId;
      lastLobby = mirror;
      seats = null;
      role = 'guest';
      emit('onDemoted');
    }
    hostPeerId = info.newHostPeerId;
    emit('onToast', 'A new host has taken over.');
    if (role === 'guest') {
      if (!inBattle) {
        if (myParty) { Network.send('host', { type: 'set_party', data: { team: myParty } }); }
        if (myReady) { Network.send('host', { type: 'ready', data: { ready: true } }); }
      }
      Network.send('host', { type: 'rejoin' });
    }
  }

  function becomeHost(info) {
    role = 'host';
    hostPeerId = Network.getMyPeerId();
    var src = (lastLobby && lastLobby.seats) || [];
    seats = [emptySeat(), emptySeat(), emptySeat()];
    var i;
    for (i = 0; i < 3; i++) {
      var s = src[i];
      if (!s || !s.controller) { continue; }
      seats[i].name = s.name;
      seats[i].controller = s.controller;
      seats[i].ready = !!s.ready;
      seats[i].connected = s.connected !== false;
      seats[i].peerId = s.peerId || null;
    }
    if (mySeat != null && seats[mySeat]) {
      seats[mySeat].peerId = Network.getMyPeerId();
      seats[mySeat].connected = true;
      seats[mySeat].team = myParty ? myParty.slice() : null;
      seats[mySeat].ready = myReady;
    }
    // The old host's seat: on a TIMEOUT migration they are gone (AI
    // mid-battle, empty in the lobby). On a VOLUNTARY handoff they are
    // still connected and simply demote to a guest - keep their seat.
    var battleLive = inBattle && lastSnapshot &&
      lastSnapshot.phase !== 'victory' && lastSnapshot.phase !== 'defeat';
    var oldHostGone = info.reason !== 'voluntary';
    for (i = 0; i < 3; i++) {
      if (i === mySeat) { continue; }
      if (seats[i].peerId === info.oldHostPeerId || (src[i] && src[i].peerId === info.oldHostPeerId)) {
        if (!oldHostGone) { continue; }
        if (battleLive) {
          seats[i].departedName = seats[i].name;
          seats[i].controller = 'ai';
          seats[i].peerId = null;
          seats[i].ready = true;
          seats[i].connected = true;
        } else {
          seats[i] = emptySeat();
        }
      }
    }
    lobbyRung = battleLive && lastSnapshot.rung
      ? Math.min(maxRung(), lastSnapshot.rung) : computeLobbyRung();

    if (battleLive) {
      var adopted = emit('onAdoptBattle', { snapshot: lastSnapshot, mySeat: mySeat });
      if (adopted) {
        lastSnapshot = adopted;
        // flip any seat that is AI in OUR seat model but was human in the
        // adopted snapshot (the departed old host, prior AI takeovers)
        for (i = 0; i < 3; i++) {
          if (seats[i].controller === 'ai' && window.Flow) { Flow.setSeatController(i, 'ai'); }
        }
        lastLobby = buildLobbyState();
        Network.broadcast({ type: 'game_state_sync', data: buildSyncPayload() });
        Network.broadcast({ type: 'intent_status', data: { locked: [] } });
        emit('onAdoptOpen');
      } else {
        inBattle = false;
        broadcastLobby();
      }
    } else {
      inBattle = false;
      broadcastLobby();
      Network.broadcast({ type: 'game_state_sync', data: buildSyncPayload() });
    }
    emit('onToast', 'You are now the host!');
    emit('onLobby', buildLobbyState(), meta());
  }

  // === public API ==========================================================
  function init(newHandlers) {
    handlers = newHandlers || {};
    if (wired) { return; }
    wired = true;
    Network.onMessage(handleMessage);
    Network.onConnect(function () { /* join_request follows via onMessage */ });
    Network.onPaused(handlePaused);
    Network.onResumed(handleResumed);
    Network.onReconnect(function (id) { if (id === 'self') { handleSelfReconnect(); } });
    Network.onDisconnect(handleDisconnect);
    Network.onMigration(handleMigration);
  }

  function createRoom(name) {
    resetState();
    return Network.createRoom(name).then(function (code) {
      role = 'host';
      mySeat = 0;
      hostPeerId = Network.getMyPeerId();
      seats = [emptySeat(), emptySeat(), emptySeat()];
      seats[0].name = name || 'Host';
      seats[0].controller = 'human';
      seats[0].peerId = Network.getMyPeerId();
      lobbyRung = computeLobbyRung();
      lastLobby = buildLobbyState();
      emit('onLobby', lastLobby, meta());
      return code;
    });
  }

  function joinRoom(code, name) {
    resetState();
    return Network.joinRoom(code, name, 1).then(function () {
      return new Promise(function (resolve, reject) {
        joinWait = {
          resolve: resolve,
          reject: reject,
          timer: setTimeout(function () {
            if (!joinWait) { return; }
            joinWait = null;
            Network.disconnect();
            resetState();
            reject(new Error('The host did not respond - try again.'));
          }, APPROVAL_TIMEOUT_MS)
        };
      });
    });
  }

  function leaveRoom() {
    try { Network.disconnect(); } catch (e) { /* already down */ }
    resetState();
  }

  function setParty(team) {
    if (!validTeam(team)) { return false; }
    if (role === 'host') {
      seats[mySeat].team = team.slice();
      myParty = team.slice();
      broadcastLobby();
      return true;
    }
    if (role === 'guest') {
      myParty = team.slice();
      Network.send('host', { type: 'set_party', data: { team: myParty } });
      return true;
    }
    return false;
  }

  function setReady(ready) {
    ready = !!ready;
    if (ready && !myParty) { return false; }
    myReady = ready;
    if (role === 'host') {
      seats[mySeat].ready = ready;
      broadcastLobby();
      return true;
    }
    if (role === 'guest') {
      Network.send('host', { type: 'ready', data: { ready: ready } });
      return true;
    }
    return false;
  }

  function toggleSeatAI(seatIdx, makeAi) {
    if (role !== 'host' || inBattle || !seats || seatIdx === mySeat) { return false; }
    var s = seats[seatIdx];
    if (!s) { return false; }
    if (makeAi && s.controller === null) {
      seats[seatIdx] = emptySeat();
      seats[seatIdx].name = aiSeatName();
      seats[seatIdx].controller = 'ai';
      seats[seatIdx].ready = true;
      broadcastLobby();
      return true;
    }
    if (!makeAi && s.controller === 'ai' && !s.peerId) {
      seats[seatIdx] = emptySeat();
      broadcastLobby();
      return true;
    }
    return false;
  }

  function requestStart() {
    if (role !== 'host' || inBattle) { return false; }
    if (!computeCanStart()) {
      emit('onToast', 'Every player needs a team and READY first!');
      return false;
    }
    lobbyRung = computeLobbyRung();
    var boss = GameData.bossByRung(lobbyRung);
    var parties = [];
    var taken = [];
    var i;
    for (i = 0; i < 3; i++) {
      if (seats[i].controller === 'human') {
        parties.push({ seat: i, name: seats[i].name, controller: 'human', team: seats[i].team.slice() });
        taken.push(seats[i].team.slice());
      }
    }
    for (i = 0; i < 3; i++) {
      if (seats[i].controller === 'ai') {
        var team = CompanionAI.draftParty(hostUnlockedIds(), taken, Math.random);
        taken.push(team);
        seats[i].team = team.slice();
        parties.push({ seat: i, name: seats[i].name, controller: 'ai', team: team });
      }
    }
    parties.sort(function (a, b) { return a.seat - b.seat; });
    inBattle = true;
    var snapshot = emit('onHostStart', { parties: parties, rung: lobbyRung, bossId: boss.id });
    if (!snapshot) {
      inBattle = false;
      return false;
    }
    lastSnapshot = snapshot;
    Network.broadcast({ type: 'battle_start',
      data: { rung: lobbyRung, bossId: boss.id, parties: parties, snapshot: snapshot } });
    return true;
  }

  // Broadcast tap the host's Flow sink calls IN ADDITION to local render.
  var hostTap = {
    onIntentStatus: function (locked) {
      if (role !== 'host') { return; }
      Network.broadcast({ type: 'intent_status', data: { locked: locked } });
    },
    onRoundResolved: function (payload) {
      if (role !== 'host') { return; }
      clearAllSwitchTimers();
      lastSnapshot = payload.snapshot;
      Network.broadcast({ type: 'round_result',
        data: { events: payload.events, snapshot: payload.snapshot } });
    },
    onSwitchApplied: function (payload) {
      if (role !== 'host') { return; }
      lastSnapshot = payload.snapshot;
      Network.broadcast({ type: 'switch_applied',
        data: { events: payload.events, snapshot: payload.snapshot } });
    },
    onNeedSwitch: function (seatList) {
      if (role !== 'host') { return; }
      Network.broadcast({ type: 'switch_wait',
        data: { seats: seatList, deadline: deadlineS() } });
      armSwitchTimers(seatList);
    },
    onBattleEnd: function (result, snapshot) {
      if (role !== 'host') { return; }
      clearAllSwitchTimers();
      inBattle = false;
      lastSnapshot = snapshot;
      Network.broadcast({ type: 'battle_end', data: { result: result, snapshot: snapshot } });
    }
  };

  function afterBattleReturn() {
    if (role !== 'host') { return; }
    inBattle = false;
    clearAllSwitchTimers();
    lobbyRung = computeLobbyRung();
    for (var i = 0; i < 3; i++) {
      if (seats[i].controller === 'human') { seats[i].ready = false; }
      seats[i].departedName = null;
    }
    myReady = false;
    broadcastLobby();
  }

  return {
    init: init,
    createRoom: createRoom,
    joinRoom: joinRoom,
    leaveRoom: leaveRoom,
    setParty: setParty,
    setReady: setReady,
    toggleSeatAI: toggleSeatAI,
    requestStart: requestStart,
    sendIntent: function (seat, intent, round) {
      Network.send('host', { type: 'intent', data: { round: round, seat: seat, intent: intent } });
    },
    sendSwitchChoice: function (seat, slot) {
      Network.send('host', { type: 'switch_choice', data: { seat: seat, slot: slot } });
    },
    getHostTap: function () { return hostTap; },
    afterBattleReturn: afterBattleReturn,
    setRestoring: function (on) { restoring = !!on; },
    isOnline: function () { return role !== null; },
    isHost: function () { return role === 'host'; },
    getMySeat: function () { return mySeat; },
    getLobby: function () { return role === 'host' ? buildLobbyState() : lastLobby; },
    getLatestSnapshot: function () { return lastSnapshot; },
    getRung: function () { return meta().rung; }
  };
})();

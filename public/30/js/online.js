/* ============================================================
   30 - Online Multiplayer Module
   Lobby management, game sync, host/guest coordination
   ============================================================ */

var Online = (function () {
  'use strict';

  // ---- Constants ----
  var SEAT_FILL_ORDER = [0, 4, 2, 6, 1, 5, 3, 7];
  var NUM_SEATS = 8;

  // Nickname arrays matching ui.js — pick randomly
  var NICKNAMES = {
    bear:['Bruno','Grizzly','Kodiak'], cat:['Shadow','Mittens','Whiskers'],
    owl:['Hoot','Sage','Luna'], penguin:['Waddles','Tux','Frost'],
    raccoon:['Bandit','Rascal','Stripe'], frog:['Ribbit','Lily','Marsh'],
    dog:['Buddy','Rex','Scout'], panda:['Bamboo','Oreo','Patches'],
    monkey:['Coco','Chip','Mango'], deer:['Dasher','Fawn','Buck'],
    hedgehog:['Spike','Bramble','Thistle'], shark:['Finn','Jaws','Reef'],
    octopus:['Inky','Coral','Squid'], hamster:['Nibbles','Peanut','Biscuit'],
    parrot:['Polly','Stella','Rio'], turtle:['Shelly','Mossy','Tank'],
    goat:['Billy','Cliffs','Bleat'], spider:['Webster','Silk','Fang'],
    ladybug:['Dotty','Pepper','Ruby'], bee:['Buzz','Abby','Nectar'],
    crocodile:['Snappy','Chomp','Marsh'], dolphin:['Splash','Snowflake','Echo'],
    rabbit:['Clover','Hopper','Thumper'], dodo:['Doodle','Pebble','Waddle']
  };
  function pickNickname(animal) {
    var arr = NICKNAMES[animal];
    return arr ? arr[Math.floor(Math.random() * arr.length)] : animal;
  }

  // ---- State ----
  var active = false;        // online mode active?
  var _isHost = false;
  var myDeviceId = '';       // PeerJS peer ID
  var myUsername = '';
  var gamePhase = 'lobby';   // 'lobby' | 'playing' | 'results'

  // Lobby state (host is authoritative, guests receive copies)
  var lobbyState = {
    roomCode: '',
    seats: [],              // 8 seats: { occupied, animal, name, isHuman, isAI, deviceId }
    devices: {},            // peerId -> { username, playerCount, isHost }
  };

  // Pending join requests (host only)
  var pendingRequests = [];  // [{ peerId, username, playerCount }]

  // Pending "a device just left" decisions (host only). Each entry maps a
  // departed peer to the set of seat indices that device owned at the
  // moment it left, so the host can pick AI / Human-controlled for each.
  var pendingLeaves = {};    // peerId -> { username, seats: [seatIdx], decisions: { seatIdx: 'ai'|'human' } }
  // Short-delay timers that open the leave-modal after a disconnect —
  // cancelled if the device reconnects within the grace window.
  var pauseModalTimers = {}; // peerId -> setTimeout handle

  // Auto-play-grace timers. When a device's socket drops we do NOT
  // let the host's AI play for them immediately — that caused the
  // "phone power button → a card got drawn for me" complaint. Instead
  // shouldHostAutoPlay returns false for the first PAUSE_AUTOPLAY_DELAY_MS
  // milliseconds of pause. If the device reconnects in that window we
  // cancel the pending autoplay kick entirely (their turn is still
  // theirs). If they're still paused after the delay, we fire the
  // host-auto-play callback so nextTurn picks up the AI path.
  var autoplayTimers = {};   // peerId -> setTimeout handle
  var PAUSE_AUTOPLAY_DELAY_MS = 30000; // 30s — generous for mobile wake-ups

  // ---- Initialize ----
  function initLobbyState() {
    // Clear roomCode too — without this, the stale code from a
    // previously-disbanded room lingers in the HUD / lobby header
    // when the user immediately hosts or joins a new room.
    lobbyState.roomCode = '';
    lobbyState.dealerIndex = -1;
    lobbyState.seats = [];
    for (var i = 0; i < NUM_SEATS; i++) {
      lobbyState.seats.push({
        occupied: false,
        animal: null,
        name: '',
        isHuman: false,
        isAI: false,
        deviceId: null,
        isDealer: false
      });
    }
    lobbyState.devices = {};
    pendingRequests = [];
    // Clear the DOM displays that might still show the OLD code.
    var codeEl = document.getElementById('online-room-code');
    if (codeEl) codeEl.textContent = '---';
    var hudCode = document.getElementById('hud-room-code');
    if (hudCode) hudCode.textContent = '---';
    var hudRoomRow = document.getElementById('hud-room-row');
    if (hudRoomRow) hudRoomRow.style.display = 'none';
  }

  // ---- Get next N available seats in fill order ----
  function getNextSeats(count) {
    var seats = [];
    for (var i = 0; i < SEAT_FILL_ORDER.length && seats.length < count; i++) {
      if (!lobbyState.seats[SEAT_FILL_ORDER[i]].occupied) {
        seats.push(SEAT_FILL_ORDER[i]);
      }
    }
    return seats;
  }

  // ---- Count total players ----
  function totalPlayerCount() {
    var count = 0;
    for (var i = 0; i < NUM_SEATS; i++) {
      if (lobbyState.seats[i].occupied) count++;
    }
    return count;
  }

  // ---- Count human players from a device ----
  function devicePlayerCount(deviceId) {
    var count = 0;
    for (var i = 0; i < NUM_SEATS; i++) {
      if (lobbyState.seats[i].deviceId === deviceId) count++;
    }
    return count;
  }

  // ---- Get seat indices owned by a device ----
  function deviceSeatIndices(deviceId) {
    var seats = [];
    for (var i = 0; i < NUM_SEATS; i++) {
      if (lobbyState.seats[i].deviceId === deviceId) seats.push(i);
    }
    return seats;
  }

  // ---- Assign players to seats ----
  function assignPlayersToSeats(deviceId, username, count) {
    var seats = getNextSeats(count);
    var animals = SpriteEngine.getAnimalList();
    var usedAnimals = lobbyState.seats
      .filter(function (s) { return s.occupied && s.animal; })
      .map(function (s) { return s.animal; });

    for (var i = 0; i < seats.length; i++) {
      var seatIdx = seats[i];
      // Pick unused animal
      var available = animals.filter(function (a) { return usedAnimals.indexOf(a) === -1; });
      if (available.length === 0) available = animals;
      var animal = available[Math.floor(Math.random() * available.length)];
      usedAnimals.push(animal);

      lobbyState.seats[seatIdx] = {
        occupied: true,
        animal: animal,
        name: pickNickname(animal),
        isHuman: true,
        isAI: false,
        deviceId: deviceId
      };
    }
    return seats;
  }

  // ---- Remove all players from a device ----
  function removeDevicePlayers(deviceId) {
    for (var i = 0; i < NUM_SEATS; i++) {
      if (lobbyState.seats[i].deviceId === deviceId) {
        lobbyState.seats[i] = {
          occupied: false, animal: null, name: '',
          isHuman: false, isAI: false, deviceId: null
        };
      }
    }
    delete lobbyState.devices[deviceId];
  }

  // ======== HOST FUNCTIONS ========

  // v96: hostGame no longer takes playerCount. The host seats players
  // manually during the lobby phase via the same +/- control that
  // local play uses (or by clicking dotted-ring seats directly). Every
  // newly-added player defaults to host-controlled; the host then
  // clicks the avatar to reassign control to AI or a connected joiner.
  function hostGame(username) {
    active = true;
    _isHost = true;
    gamePhase = 'lobby';
    initLobbyState();

    return Network.createRoom(username).then(function (code) {
      lobbyState.roomCode = code;
      myDeviceId = Network.getMyPeerId();
      myUsername = username;

      lobbyState.devices[myDeviceId] = {
        username: username,
        isHost: true
      };

      // Set up network handlers
      Network.onConnect(function (peerId) {
        // New connection — wait for join_request message
      });

      Network.onMessage(handleHostMessage);
      Network.onDisconnect(handleGuestDisconnect);

      // v96: onPaused is now a quiet event. We mark the device paused
      // in lobbyState (so their badge can render differently if
      // desired, and for debug) but we DON'T auto-draw, DON'T open a
      // modal, and DON'T schedule any timers. If their turn comes up
      // while they're away the game simply stalls — the host can
      // click their avatar to reassign the seat to AI / themselves /
      // another joiner, or the device can reconnect silently (reclaim
      // keeps their peerId and seats).
      Network.onPaused(function (peerId) {
        console.log('[Online] Guest paused:', peerId);
        if (!lobbyState.devices[peerId]) return;
        lobbyState.devices[peerId].paused = true;
        lobbyState.devices[peerId].pausedSince = Date.now();
        broadcastLobbyState();
        renderOnlineLobby();
      });

      // Resumed — conn reopened within grace. Flip paused off, cancel
      // any pending leave-modal, let the rejoining device reclaim their
      // seats so they can keep playing.
      Network.onResumed(function (peerId) {
        console.log('[Online] Guest resumed:', peerId);
        if (lobbyState.devices[peerId]) {
          lobbyState.devices[peerId].paused = false;
          lobbyState.devices[peerId].pausedSince = null;
          lobbyState.devices[peerId].leaving = false;
        }
        // Cancel the scheduled-but-not-yet-opened modal AND the
        // autoplay kick — they're back, neither needs to fire.
        if (pauseModalTimers[peerId]) {
          clearTimeout(pauseModalTimers[peerId]);
          delete pauseModalTimers[peerId];
        }
        if (autoplayTimers[peerId]) {
          clearTimeout(autoplayTimers[peerId]);
          delete autoplayTimers[peerId];
        }
        // If the modal HAD opened already, close it — the player is
        // back, no decision needed.
        if (pendingLeaves[peerId]) {
          delete pendingLeaves[peerId];
          renderDeviceLeaveModal();
          var uname = (lobbyState.devices[peerId] && lobbyState.devices[peerId].username) || 'A player';
          showLocalToast(uname + ' has reconnected.');
          Network.broadcast({ type: 'toast', data: { message: uname + ' has reconnected.' } });
        }
        broadcastLobbyState();
        renderOnlineLobby();
        // Re-send the full lobby / game state so the reconnected device
        // catches up with anything it missed.
        if (gamePhase === 'lobby') {
          Network.send(peerId, { type: 'lobby_state', data: JSON.parse(JSON.stringify(lobbyState)) });
        } else if (gamePhase === 'playing') {
          Network.send(peerId, {
            type: 'game_state_sync',
            data: { gameState: Game.serialize(), lobbyState: JSON.parse(JSON.stringify(lobbyState)) }
          });
        }
      });

      // Reconnection handler — guest came back during grace period.
      // Re-sync full state so they can catch up.
      Network.onReconnect(function (peerId) {
        console.log('[Online] Guest reconnected:', peerId);
        if (gamePhase === 'lobby') {
          Network.send(peerId, { type: 'lobby_state', data: JSON.parse(JSON.stringify(lobbyState)) });
        } else if (gamePhase === 'playing') {
          Network.send(peerId, {
            type: 'game_state_sync',
            data: { gameState: Game.serialize(), lobbyState: JSON.parse(JSON.stringify(lobbyState)) }
          });
        }
      });

      return code;
    });
  }

  function handleHostMessage(fromPeerId, message) {
    switch (message.type) {
      case 'join_request':
        handleJoinRequest(fromPeerId, message.data);
        break;
      case 'change_name':
        handleRemoteChangeName(fromPeerId, message.data);
        break;
      case 'change_animal':
        handleRemoteChangeAnimal(fromPeerId, message.data);
        break;
      case 'swap_seat':
        handleRemoteSwapSeat(fromPeerId, message.data);
        break;
      case 'player_action':
        handleRemoteAction(message.data);
        break;
      case 'leave':
        handleGuestLeave(fromPeerId);
        break;
      case 'rejoin':
        handleGuestRejoin(fromPeerId, message.data);
        break;
    }
  }

  function handleGuestRejoin(peerId, data) {
    console.log('[Online] Guest rejoin:', data && data.username);
    // Guest's socket was dropped then reclaimed — after server-side
    // reclaim the peerId stays the same, so there's nothing to remap
    // normally. We still handle the legacy case where the old peerId
    // might differ (e.g. after a full re-join).
    var oldDeviceId = data && data.deviceId;
    if (oldDeviceId && oldDeviceId !== peerId && lobbyState.devices[oldDeviceId]) {
      lobbyState.devices[peerId] = lobbyState.devices[oldDeviceId];
      delete lobbyState.devices[oldDeviceId];
      for (var i = 0; i < NUM_SEATS; i++) {
        if (lobbyState.seats[i].deviceId === oldDeviceId) {
          lobbyState.seats[i].deviceId = peerId;
        }
      }
    }

    // Still own any seats? → silent resume.
    // Already reassigned away? → open the reconnect-gate popup so the
    // host decides whether to let them back in as an observer.
    var stillOwnsSeats = deviceSeatIndices(peerId).length > 0;
    var dev = lobbyState.devices[peerId];
    if (!stillOwnsSeats && dev) {
      // Re-show as observer; host will see the reconnect-gate popup.
      dev.wasReassigned = true;
      showReconnectGate(peerId, dev.username);
    }

    // Clear any paused flag and the autoplay/modal timers too —
    // they're fully back now.
    if (dev) {
      dev.paused = false;
      dev.pausedSince = null;
      dev.leaving = false;
    }
    if (autoplayTimers[peerId]) { clearTimeout(autoplayTimers[peerId]); delete autoplayTimers[peerId]; }
    if (pauseModalTimers[peerId]) { clearTimeout(pauseModalTimers[peerId]); delete pauseModalTimers[peerId]; }
    if (pendingLeaves[peerId]) { delete pendingLeaves[peerId]; renderDeviceLeaveModal(); }

    // Re-sync full state so the reconnected device catches up.
    if (gamePhase === 'lobby') {
      Network.send(peerId, { type: 'lobby_state', data: JSON.parse(JSON.stringify(lobbyState)) });
      renderOnlineLobby();
    } else if (gamePhase === 'playing') {
      Network.send(peerId, {
        type: 'game_state_sync',
        data: { gameState: Game.serialize(), lobbyState: JSON.parse(JSON.stringify(lobbyState)) }
      });
    }
  }

  // Reconnect-gate popup. Only fires on host when a previously-
  // reassigned device reclaims. If host allows, the peer stays as
  // observer (no seats) and the host can click avatars to re-assign
  // them manually. If deny, kick them.
  function showReconnectGate(peerId, username) {
    var overlay = document.getElementById('reconnect-gate-overlay');
    if (!overlay || !_isHost) return;
    document.getElementById('reconnect-gate-title').textContent =
      (username || 'Someone') + ' is reconnecting';
    var allowBtn = document.getElementById('btn-reconnect-gate-allow');
    var denyBtn  = document.getElementById('btn-reconnect-gate-deny');
    allowBtn.onclick = function () {
      overlay.style.display = 'none';
      // Observer stays in devices list; nothing else to do.
      broadcastPlayerLeftNotice((username || 'A player') + ' reconnected as an observer.');
    };
    denyBtn.onclick = function () {
      overlay.style.display = 'none';
      Network.kickGuest(peerId, 'Host did not let you back in.');
      if (lobbyState.devices[peerId]) delete lobbyState.devices[peerId];
      broadcastLobbyState();
    };
    overlay.style.display = 'flex';
  }

  function handleJoinRequest(peerId, data) {
    // v96: joiners no longer bring player counts. They connect as
    // observers and the host assigns them to specific players via
    // the avatar-click reassign popup. So the only gate here is the
    // approve/deny decision — no seat-count math.
    pendingRequests.push({
      peerId: peerId,
      username: (data && data.username) || 'Guest'
    });
    renderJoinRequests();
  }

  function approveGuest(peerId) {
    var request = null;
    for (var i = 0; i < pendingRequests.length; i++) {
      if (pendingRequests[i].peerId === peerId) {
        request = pendingRequests.splice(i, 1)[0];
        break;
      }
    }
    if (!request) return;

    // Defensive: if this peer is already registered (e.g. a stale
    // re-send of join_request), just re-sync their state.
    if (lobbyState.devices[peerId]) {
      console.warn('[Online] approveGuest: peer already registered, re-syncing:', peerId);
      Network.send(peerId, {
        type: 'join_response',
        data: { approved: true, deviceId: peerId }
      });
      broadcastLobbyState();
      renderJoinRequests();
      return;
    }

    console.log('[Online] Approving guest:', request.username, 'peerId:', peerId);

    // Register device (as observer — no seats yet).
    lobbyState.devices[peerId] = {
      username: request.username,
      isHost: false
    };

    // Notify guest
    Network.send(peerId, {
      type: 'join_response',
      data: { approved: true, deviceId: peerId, midGame: gamePhase === 'playing' }
    });

    // Broadcast updated lobby
    broadcastLobbyState();

    // If a round is already in progress, give the new device
    // enough state to render the game screen directly (instead of
    // the lobby's "Waiting for host..." view). Send game_starting
    // first (player list + lobbyState) and then a full state sync.
    if (gamePhase === 'playing') {
      Network.send(peerId, {
        type: 'game_starting',
        data: {
          players: Game.getState().players,
          lobbyState: JSON.parse(JSON.stringify(lobbyState)),
          midGame: true
        }
      });
      Network.send(peerId, {
        type: 'game_state_sync',
        data: { gameState: Game.serialize(), lobbyState: JSON.parse(JSON.stringify(lobbyState)) }
      });
    }

    renderOnlineLobby();
    renderJoinRequests();
  }

  function denyGuest(peerId) {
    for (var i = 0; i < pendingRequests.length; i++) {
      if (pendingRequests[i].peerId === peerId) {
        pendingRequests.splice(i, 1);
        break;
      }
    }
    Network.send(peerId, {
      type: 'join_response',
      data: { approved: false, reason: 'Host denied your request.' }
    });
    renderJoinRequests();
  }

  function handleRemoteChangeName(fromPeerId, data) {
    var seat = lobbyState.seats[data.seatIndex];
    if (seat && seat.deviceId === fromPeerId) {
      seat.name = data.name;
      broadcastLobbyState();
      renderOnlineLobby();
    }
  }

  function handleRemoteChangeAnimal(fromPeerId, data) {
    var seat = lobbyState.seats[data.seatIndex];
    if (!seat || seat.deviceId !== fromPeerId) return;
    // Check animal not taken
    var taken = lobbyState.seats.some(function (s, idx) {
      return s.occupied && s.animal === data.animal && idx !== data.seatIndex;
    });
    if (taken) return;
    seat.animal = data.animal;
    broadcastLobbyState();
    renderOnlineLobby();
  }

  function handleRemoteSwapSeat(fromPeerId, data) {
    // Guest can only move their own player to an open seat
    var fromSeat = lobbyState.seats[data.fromSeat];
    if (!fromSeat || fromSeat.deviceId !== fromPeerId) return;
    var toSeat = lobbyState.seats[data.toSeat];
    if (toSeat.occupied) return; // guests can't swap with occupied seats
    // Move
    lobbyState.seats[data.toSeat] = fromSeat;
    lobbyState.seats[data.fromSeat] = {
      occupied: false, animal: null, name: '',
      isHuman: false, isAI: false, deviceId: null
    };
    broadcastLobbyState();
    renderOnlineLobby();
  }

  function handleRemoteAction(data) {
    // Process a game action from a guest's player
    if (typeof onActionCallback === 'function') {
      onActionCallback(data);
    }
  }

  function handleGuestDisconnect(peerId) {
    var dev = lobbyState.devices[peerId];
    var uname = dev ? dev.username : 'A player';

    if (gamePhase === 'lobby') {
      // Lobby: pulling out before the game starts. Remove the device
      // AND clear any seats that were pointed at them (they weren't
      // playing yet, so the seats are stale).
      removeDevicePlayers(peerId);
      pendingRequests = pendingRequests.filter(function (r) { return r.peerId !== peerId; });
      broadcastLobbyState();
      broadcastPlayerLeftNotice(uname + ' has left the room.');
      renderOnlineLobby();
      renderJoinRequests();
    } else {
      // v97 during game: open the BLOCKING reassign modal on the host
      // immediately. The host must pick a new controller (AI, Host, or
      // any connected joiner) for each of the departed device's seats
      // before gameplay continues. Without this, the game effectively
      // freezes when the departed player's turn comes up.
      startPendingLeave(peerId, /*definitive=*/true);
    }

    // Clean up timers in case any are still live.
    if (autoplayTimers[peerId]) { clearTimeout(autoplayTimers[peerId]); delete autoplayTimers[peerId]; }
    if (pauseModalTimers[peerId]) { clearTimeout(pauseModalTimers[peerId]); delete pauseModalTimers[peerId]; }
  }

  function handleGuestLeave(peerId) {
    // Explicit "Leave Room" click from a guest — treated as definitive
    // (unlike a silent drop, the player isn't coming back). Remove the
    // peer from our connection list immediately, then route through the
    // same path as a grace-expired disconnect.
    handleGuestDisconnect(peerId);
  }

  // ---- Host: open "a device left" decision flow for a departed peer ----
  // Collects the seat indices owned by that peer, posts the modal on the
  // host, and broadcasts a brief toast to all other devices. During the
  // modal, the device's `paused` flag stays true so host AI covers their
  // turns — host can take their time choosing without the game stalling.
  function startPendingLeave(peerId, definitive) {
    var dev = lobbyState.devices[peerId];
    if (!dev) return;
    var seats = deviceSeatIndices(peerId);
    if (seats.length === 0) {
      // Already had nothing assigned — just clean up the device record.
      delete lobbyState.devices[peerId];
      broadcastLobbyState();
      return;
    }
    // Keep their seats but mark paused so host AI keeps playing until
    // the host picks a final disposition.
    dev.paused = true;
    dev.leaving = true;
    var decisions = {};
    for (var i = 0; i < seats.length; i++) decisions[seats[i]] = 'ai';
    pendingLeaves[peerId] = {
      username: dev.username || 'A player',
      seats: seats,
      decisions: decisions
    };
    broadcastLobbyState();
    broadcastPlayerLeftNotice(dev.username + ' has left the game.');
    renderDeviceLeaveModal();
    // Kick the turn loop in case we were waiting on one of their plays.
    if (typeof onHostAutoPlayCallback === 'function') onHostAutoPlayCallback();
  }

  // Store a choice for one seat inside the pending-leave modal. The
  // choice is either the string 'ai' or a peerId of a connected device
  // (host's peerId for host-controlled, or any other joiner).
  function setLeaveDecision(peerId, seatIdx, choice) {
    var p = pendingLeaves[peerId];
    if (!p) return;
    if (choice !== 'ai' && !lobbyState.devices[choice]) return;
    p.decisions[seatIdx] = choice;
    renderDeviceLeaveModal();
  }

  // Apply all choices in the pending-leave modal for one peer. For each
  // departed seat, route control to either AI or one of the connected
  // devices (host OR another joiner). Updates both lobbyState AND the
  // live Game.players so turn routing switches immediately.
  function applyLeaveDecisions(peerId) {
    var p = pendingLeaves[peerId];
    if (!p) return;
    for (var i = 0; i < p.seats.length; i++) {
      var idx = p.seats[i];
      var seat = lobbyState.seats[idx];
      if (!seat) continue;
      var choice = p.decisions[idx];
      if (choice === 'ai') {
        seat.isHuman = false;
        seat.isAI = true;
        seat.deviceId = null;
        updateLivePlayerForSeat(idx, null, /*isAI=*/true);
      } else if (lobbyState.devices[choice]) {
        // 'choice' is a peerId (host's own or another connected joiner).
        seat.deviceId = choice;
        seat.isHuman = true;
        seat.isAI = false;
        updateLivePlayerForSeat(idx, choice, /*isAI=*/false);
      }
    }
    // Remove the departed device from the device list — its seats are
    // now reassigned.
    delete lobbyState.devices[peerId];
    delete pendingLeaves[peerId];
    broadcastLobbyState();
    // Push the fresh game state so all guests know about the new
    // controllers (their local Game.players needs updating for turn
    // routing). Same reason we do this inside assignSeatController.
    if (gamePhase === 'playing') {
      broadcastGameStateSync({ gameState: Game.serialize() });
    }
    renderDeviceLeaveModal();
    // Kick the turn loop in case the current turn is one we just reassigned.
    if (typeof onHostAutoPlayCallback === 'function') onHostAutoPlayCallback();
  }

  // Update the in-play Game.players entry for a given seat index so
  // turn-routing reflects the new ownership without waiting for a new
  // round. Safe no-op if the game hasn't started yet.
  function updateLivePlayerForSeat(seatIdx, newDeviceId, isAI) {
    if (typeof Game === 'undefined' || !Game.getState) return;
    var state = Game.getState();
    if (!state || !state.players) return;
    for (var i = 0; i < state.players.length; i++) {
      var p = state.players[i];
      if (p.seatIndex !== seatIdx) continue;
      p.deviceId = newDeviceId;
      p.isAI = !!isAI;
      p.isHuman = !isAI;
      return;
    }
  }

  // Render the host-side "device left — choose controller per seat"
  // modal. Each seat gets buttons for AI, Host, and every other
  // connected joiner. Modal is blocking: gameplay can't continue
  // until Apply is clicked.
  function renderDeviceLeaveModal() {
    var overlay = document.getElementById('device-leave-overlay');
    if (!overlay) return;
    var peers = Object.keys(pendingLeaves);
    if (!_isHost || peers.length === 0) {
      overlay.style.display = 'none';
      return;
    }
    var peerId = peers[0];
    var p = pendingLeaves[peerId];
    var titleEl = document.getElementById('device-leave-title');
    if (titleEl) titleEl.textContent = (p.username || 'A player') + ' has left';
    var list = document.getElementById('device-leave-players');
    list.innerHTML = '';

    // Build once per render — "AI" + each currently-connected device.
    function buildChoices() {
      var choices = [{ value: 'ai', label: 'AI', tag: 'AI' }];
      if (lobbyState.devices[myDeviceId]) {
        choices.push({ value: myDeviceId, label: (lobbyState.devices[myDeviceId].username || 'Host') + ' (you)', tag: 'Host' });
      }
      Object.keys(lobbyState.devices).forEach(function (pid) {
        if (pid === myDeviceId) return;
        if (pid === peerId) return; // The departing device itself — can't reassign to them
        choices.push({ value: pid, label: lobbyState.devices[pid].username || pid, tag: 'Player' });
      });
      return choices;
    }

    for (var i = 0; i < p.seats.length; i++) {
      var idx = p.seats[i];
      var seat = lobbyState.seats[idx];
      if (!seat) continue;
      var row = document.createElement('div');
      row.className = 'device-leave-player';
      // Avatar
      var avatar = document.createElement('div');
      avatar.className = 'device-leave-player-avatar';
      if (seat.animal) {
        var img = SpriteEngine.createSpriteImg(seat.animal);
        img.style.width = '100%'; img.style.height = '100%';
        avatar.appendChild(img);
      }
      row.appendChild(avatar);
      // Name
      var name = document.createElement('div');
      name.className = 'device-leave-player-name';
      name.textContent = seat.name;
      row.appendChild(name);
      // Per-seat choice buttons
      var toggle = document.createElement('div');
      toggle.className = 'device-leave-toggle';
      var choices = buildChoices();
      for (var ci = 0; ci < choices.length; ci++) {
        var c = choices[ci];
        var btn = document.createElement('button');
        btn.textContent = c.label;
        btn.title = c.tag;
        if (p.decisions[idx] === c.value) btn.classList.add('selected');
        btn.addEventListener('click', (function (pid, si, val) {
          return function () { setLeaveDecision(pid, si, val); };
        })(peerId, idx, c.value));
        toggle.appendChild(btn);
      }
      row.appendChild(toggle);
      list.appendChild(row);
    }
    // Wire up the Apply button (single-shot handler each render)
    var btn = document.getElementById('btn-device-leave-confirm');
    if (btn) {
      btn.onclick = function () { applyLeaveDecisions(peerId); };
    }
    overlay.style.display = 'flex';
  }

  // Broadcast a short notice to every guest so they see a toast. Host
  // also displays the toast locally (so host sees the same feedback).
  function broadcastPlayerLeftNotice(message) {
    Network.broadcast({ type: 'toast', data: { message: message } });
    showLocalToast(message);
  }

  // Small self-dismissing toast at the top of the screen.
  function showLocalToast(message) {
    var toast = document.getElementById('game-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.style.display = 'block';
    // CSS animation re-runs each time we toggle display by reflow.
    toast.style.animation = 'none';
    toast.offsetHeight; // force reflow
    toast.style.animation = '';
    clearTimeout(showLocalToast._t);
    showLocalToast._t = setTimeout(function () {
      toast.style.display = 'none';
    }, 5000);
  }

  // ---- Host: Add a new player to an empty seat ----
  // v96: new players default to HOST-controlled human. Host picks
  // another controller (AI, or a connected joiner) by clicking the
  // avatar and choosing from the reassign popup.
  function addPlayer(seatIdx, asAI) {
    if (!_isHost || lobbyState.seats[seatIdx].occupied) return;
    var animals = SpriteEngine.getAnimalList();
    var usedAnimals = lobbyState.seats
      .filter(function (s) { return s.occupied && s.animal; })
      .map(function (s) { return s.animal; });
    var available = animals.filter(function (a) { return usedAnimals.indexOf(a) === -1; });
    if (available.length === 0) available = animals;
    var animal = available[Math.floor(Math.random() * available.length)];

    lobbyState.seats[seatIdx] = {
      occupied: true,
      animal: animal,
      name: pickNickname(animal),
      isHuman: !asAI,
      isAI: !!asAI,
      deviceId: asAI ? null : myDeviceId
    };
    broadcastLobbyState();
    renderOnlineLobby();
  }
  // Back-compat alias: local and existing code calls addAI(seatIdx).
  // In online mode, new players now default to host-controlled; but
  // the local flow still uses this as "add an AI seat". We branch on
  // `active` (online mode) to preserve local behaviour.
  function addAI(seatIdx) {
    return addPlayer(seatIdx, !active);
  }

  // ---- Host: Reassign the controller of an occupied seat ----
  // `controller` is one of:
  //   'ai'             — seat plays via AI
  //   a peerId string  — that device controls the seat
  function assignSeatController(seatIdx, controller) {
    if (!_isHost) return;
    var seat = lobbyState.seats[seatIdx];
    if (!seat || !seat.occupied) return;
    if (controller === 'ai') {
      seat.isAI = true;
      seat.isHuman = false;
      seat.deviceId = null;
    } else {
      // peerId — must be a known device.
      if (!lobbyState.devices[controller]) return;
      seat.isAI = false;
      seat.isHuman = true;
      seat.deviceId = controller;
    }
    // Mirror onto the live Game player record so turn routing updates
    // immediately (without waiting for a new round).
    updateLivePlayerForSeat(seatIdx, seat.deviceId, seat.isAI);
    broadcastLobbyState();
    // During game, also push the full game state so each guest's
    // local Game.players reflects the new deviceId — without this, a
    // newly-assigned guest device's Online.isMyPlayer() stays false
    // and their action bar wouldn't appear on their turn.
    if (gamePhase === 'playing') {
      broadcastGameStateSync({ gameState: Game.serialize() });
    }
    renderOnlineLobby();
    if (typeof onHostAutoPlayCallback === 'function') onHostAutoPlayCallback();
  }

  // ---- Host: Set the dealer to a specific occupied seat ----
  // Tracked in lobbyState.dealerIndex (not on the seat itself, so
  // there's always exactly one dealer). If the previous dealer's
  // seat no longer exists (removed), dealerIndex falls back to -1
  // and startOnlineGame falls back to a random pick.
  function setDealer(seatIdx) {
    if (!_isHost) return;
    var seat = lobbyState.seats[seatIdx];
    if (!seat || !seat.occupied) return;
    lobbyState.dealerIndex = seatIdx;
    broadcastLobbyState();
    renderOnlineLobby();
  }

  // ---- Host: Remove a player/AI from a seat ----
  function removeFromSeat(seatIdx) {
    if (!_isHost) return;
    var seat = lobbyState.seats[seatIdx];
    if (!seat.occupied) return;
    lobbyState.seats[seatIdx] = {
      occupied: false, animal: null, name: '',
      isHuman: false, isAI: false, deviceId: null
    };
    broadcastLobbyState();
    renderOnlineLobby();
  }

  // ---- Host: Swap two seats ----
  function swapSeats(seatA, seatB) {
    if (!_isHost) return;
    var temp = lobbyState.seats[seatA];
    lobbyState.seats[seatA] = lobbyState.seats[seatB];
    lobbyState.seats[seatB] = temp;
    broadcastLobbyState();
    renderOnlineLobby();
  }

  // ---- Host: Start the game ----
  function startOnlineGame() {
    if (!_isHost) return;
    var count = totalPlayerCount();
    if (count < 2) return;

    gamePhase = 'playing';

    // Build player list from lobby seats. Also map the chosen
    // dealer's seatIndex to the corresponding player index so
    // Game.setupGame gets the right dealerIdx.
    var players = [];
    var dealerIdx = -1;
    var id = 0;
    for (var i = 0; i < NUM_SEATS; i++) {
      var seat = lobbyState.seats[i];
      if (!seat.occupied) continue;
      var p = Game.createPlayer(id, i, seat.animal, seat.name, seat.isHuman, false);
      p.deviceId = seat.deviceId;
      p.isAI = seat.isAI;
      players.push(p);
      if (i === lobbyState.dealerIndex) dealerIdx = id;
      id++;
    }
    // Fall back to a random dealer if none was picked during lobby.
    if (dealerIdx < 0) dealerIdx = Math.floor(Math.random() * players.length);

    Game.setupGame(players, dealerIdx);

    // Broadcast game start with player list
    Network.broadcast({
      type: 'game_starting',
      data: {
        players: players,
        lobbyState: lobbyState
      }
    });

    // Trigger the UI to begin the round
    if (typeof onGameStartCallback === 'function') {
      onGameStartCallback(players);
    }
  }

  // ---- Host: Broadcast lobby state to all guests ----
  // Deep-clones lobbyState before sending so the object that reaches the
  // PeerJS JSON serializer is immutable relative to our own state. Without
  // this, a subsequent host-side mutation (e.g. another guest joining
  // mid-serialization) could in theory race with the serializer. Also
  // helpful for diagnosing races — we log the seat occupants on each
  // broadcast so the host console shows exactly what each guest receives.
  function broadcastLobbyState() {
    var snapshot = JSON.parse(JSON.stringify(lobbyState));
    if (typeof console !== 'undefined' && console.log) {
      var occ = snapshot.seats.map(function (s, i) {
        return s.occupied ? (i + ':' + (s.isAI ? 'AI' : (s.deviceId || '?').slice(-4)) + '/' + s.name) : null;
      }).filter(Boolean);
      console.log('[Online] Broadcasting lobby state — seats:', occ.join(', '));
    }
    Network.broadcast({
      type: 'lobby_state',
      data: snapshot
    });
  }

  // ---- Disband room ----
  function disbandRoom(message) {
    Network.broadcast({
      type: 'room_disbanded',
      data: { message: message }
    });
    cleanup();
    showDisbandMessage(message);
  }

  // ======== GUEST FUNCTIONS ========

  // v96: joinGame no longer takes playerCount. Joiners connect as
  // observers; the host assigns them to specific player seats via the
  // avatar-click reassign popup after approval.
  function joinGame(code, username) {
    active = true;
    _isHost = false;
    myUsername = username;
    gamePhase = 'lobby';

    return Network.joinRoom(code, username, 0).then(function () {
      myDeviceId = Network.getMyPeerId();

      Network.onMessage(handleGuestMessage);
      Network.onDisconnect(function (peerId) {
        // The WebSocket relay broadcasts peer_left whenever ANY peer
        // leaves the room — including other guests. We should only
        // disband OUR session when the HOST drops (network.js signals
        // that by passing the literal string 'host', as it does for
        // room_disbanded / kicked). For any other peer leaving we just
        // let the state-sync update our lobby display naturally.
        if (peerId === 'host') {
          showDisbandMessage('Lost connection to host. Please create a new room to continue playing.');
          cleanup();
        } else {
          console.log('[Online] Another peer left the room:', peerId);
        }
      });

      // Reconnect (reclaim) — tell the host we're back. Host uses this
      // to decide: silent resume if our seats are still ours, or open
      // the reconnect-gate popup if they'd already been reassigned.
      Network.onReconnect(function () {
        console.log('[Online] Reconnected, re-announcing...');
        Network.send('host', {
          type: 'rejoin',
          data: {
            username: myUsername,
            deviceId: myDeviceId
          }
        });
      });
    });
  }

  function handleGuestMessage(fromId, message) {
    switch (message.type) {
      case 'join_response':
        handleJoinResponse(message.data);
        break;
      case 'lobby_state':
        lobbyState = message.data;
        renderOnlineLobby();
        break;
      case 'game_starting':
        handleGameStarting(message.data);
        break;
      case 'game_action':
        handleGameAction(message.data);
        break;
      case 'game_state_sync':
        handleGameStateSync(message.data);
        break;
      case 'room_disbanded':
        showDisbandMessage(message.data.message);
        cleanup();
        break;
      case 'toast':
        showLocalToast(message.data.message);
        break;
    }
  }

  var joinResponseCallback = null;

  function handleJoinResponse(data) {
    if (data.approved) {
      myDeviceId = data.deviceId || Network.getMyPeerId();
      if (joinResponseCallback) joinResponseCallback(true, null);
    } else {
      if (joinResponseCallback) joinResponseCallback(false, data.reason);
    }
  }

  function onJoinResponse(callback) {
    joinResponseCallback = callback;
  }

  function handleGameStarting(data) {
    gamePhase = 'playing';
    var players = data.players;
    Game.setupGame(players, 0);
    lobbyState = data.lobbyState;

    // Mid-game join: skip beginNewRound (no deal animation) and go
    // straight to the running game via a different callback.
    if (data.midGame && typeof onMidGameEntryCallback === 'function') {
      onMidGameEntryCallback(players);
      return;
    }

    if (typeof onGameStartCallback === 'function') {
      onGameStartCallback(players);
    }
  }

  function handleGameAction(data) {
    // Host sent a game action to replay (draw/stay/deal/etc.)
    if (typeof onGameActionCallback === 'function') {
      onGameActionCallback(data);
    }
  }

  function handleGameStateSync(data) {
    if (typeof onGameStateSyncCallback === 'function') {
      onGameStateSyncCallback(data);
    }
  }

  // ---- Guest: Send action to host ----
  function sendAction(playerId, action) {
    Network.send('host', {
      type: 'player_action',
      data: { playerId: playerId, action: action }
    });
  }

  // ---- Guest: Change own player's name ----
  function sendChangeName(seatIndex, name) {
    if (_isHost) {
      lobbyState.seats[seatIndex].name = name;
      broadcastLobbyState();
      renderOnlineLobby();
    } else {
      Network.send('host', {
        type: 'change_name',
        data: { seatIndex: seatIndex, name: name }
      });
    }
  }

  // ---- Guest: Change own player's animal ----
  function sendChangeAnimal(seatIndex, animal) {
    if (_isHost) {
      var taken = lobbyState.seats.some(function (s, idx) {
        return s.occupied && s.animal === animal && idx !== seatIndex;
      });
      if (taken) return;
      lobbyState.seats[seatIndex].animal = animal;
      broadcastLobbyState();
      renderOnlineLobby();
    } else {
      Network.send('host', {
        type: 'change_animal',
        data: { seatIndex: seatIndex, animal: animal }
      });
    }
  }

  // ---- Guest: Move own player to open seat ----
  function sendSwapSeat(fromSeat, toSeat) {
    if (_isHost) {
      swapSeats(fromSeat, toSeat);
    } else {
      Network.send('host', {
        type: 'swap_seat',
        data: { fromSeat: fromSeat, toSeat: toSeat }
      });
    }
  }

  // ---- Leave room ----
  function leaveRoom() {
    if (_isHost) {
      if (gamePhase === 'lobby') {
        disbandRoom(myUsername + ' has left the game. Please create a new room to continue playing.');
      } else {
        disbandRoom(myUsername + ' has left the game. Please create a new room to continue playing.');
      }
    } else {
      Network.send('host', { type: 'leave', data: {} });
      cleanup();
    }
  }

  // ======== RENDERING (delegates to UI) ========

  var renderLobbyCallback = null;
  function onRenderLobby(cb) { renderLobbyCallback = cb; }

  function renderOnlineLobby() {
    // Update room info
    var codeEl = document.getElementById('online-room-code');
    if (codeEl) codeEl.textContent = lobbyState.roomCode;

    var countEl = document.getElementById('online-player-count');
    if (countEl) countEl.textContent = totalPlayerCount() + '/8 Players';

    // Deal button (host, AND only while we're still in the lobby phase).
    // Without the phase check, any mid-game lobby_state broadcast
    // (pause/resume/leave/name change) reopens the Deal! button on top
    // of gameplay — the bug that made it look like the host was
    // "re-dealing" the board.
    var dealBtn = document.getElementById('btn-online-deal');
    if (dealBtn) {
      var inLobby = (gamePhase === 'lobby');
      dealBtn.style.display = (_isHost && inLobby) ? '' : 'none';
      dealBtn.disabled = totalPlayerCount() < 2;
    }
    // Similarly, the lobby-waiting message for guests should ONLY be
    // visible during the lobby phase — not during gameplay.
    var waiting = document.getElementById('lobby-waiting');
    if (waiting && !_isHost) {
      waiting.style.display = (gamePhase === 'lobby') ? '' : 'none';
    }

    // Delegate seat rendering to UI — but ONLY during lobby. During
    // gameplay the seats-ring holds the game seats (avatar + score +
    // status pill + leader halo) and we must NOT overwrite those with
    // lobby seats. Previously any mid-game lobby_state broadcast (e.g.
    // a guest leaving) wiped the scores and showed the setup-style
    // seat layout until the next state sync landed.
    if (gamePhase === 'lobby' && typeof renderLobbyCallback === 'function') {
      renderLobbyCallback();
    }
  }

  function renderJoinRequests() {
    var container = document.getElementById('join-requests');
    if (!container) return;

    if (pendingRequests.length === 0) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'flex';
    var list = container.querySelector('.join-request-list');
    if (!list) return;
    list.innerHTML = '';

    for (var i = 0; i < pendingRequests.length; i++) {
      var req = pendingRequests[i];
      var el = document.createElement('div');
      el.className = 'join-request-item';

      var info = document.createElement('div');
      info.className = 'join-request-info';
      info.innerHTML = '<strong>' + req.username + '</strong> wants to join';
      el.appendChild(info);

      var buttons = document.createElement('div');
      buttons.className = 'join-request-buttons';

      var approveBtn = document.createElement('button');
      approveBtn.className = 'btn btn-gold btn-sm';
      approveBtn.textContent = 'Allow';
      approveBtn.addEventListener('click', (function (peerId) {
        return function () { approveGuest(peerId); };
      })(req.peerId));
      buttons.appendChild(approveBtn);

      var denyBtn = document.createElement('button');
      denyBtn.className = 'btn btn-outline btn-sm';
      denyBtn.textContent = 'Deny';
      denyBtn.addEventListener('click', (function (peerId) {
        return function () { denyGuest(peerId); };
      })(req.peerId));
      buttons.appendChild(denyBtn);

      el.appendChild(buttons);
      list.appendChild(el);
    }
  }

  function showDisbandMessage(message) {
    var overlay = document.getElementById('disband-overlay');
    if (overlay) {
      overlay.querySelector('.disband-message').textContent = message;
      overlay.style.display = 'flex';
    }
  }

  // ======== CALLBACKS ========

  var onGameStartCallback = null;
  var onActionCallback = null;
  var onGameActionCallback = null;
  var onGameStateSyncCallback = null;
  var onMidGameEntryCallback = null;

  function onGameStart(cb) { onGameStartCallback = cb; }
  function onAction(cb) { onActionCallback = cb; }
  function onGameAction(cb) { onGameActionCallback = cb; }
  function onGameStateSync(cb) { onGameStateSyncCallback = cb; }
  function onMidGameEntry(cb) { onMidGameEntryCallback = cb; }

  // ======== HOST: Game Flow Helpers ========

  // Host broadcasts an action for guests to replay
  function broadcastGameAction(data) {
    Network.broadcast({ type: 'game_action', data: data });
  }

  // Host broadcasts full game state sync
  function broadcastGameStateSync(data) {
    Network.broadcast({ type: 'game_state_sync', data: data });
  }

  // Host sets phase
  function setGamePhase(phase) {
    gamePhase = phase;
  }

  // ======== CLEANUP ========

  function cleanup() {
    Network.disconnect();
    active = false;
    _isHost = false;
    myDeviceId = '';
    myUsername = '';
    gamePhase = 'lobby';
    initLobbyState();
    pendingRequests = [];
    joinResponseCallback = null;
    onGameStartCallback = null;
    onActionCallback = null;
    onGameActionCallback = null;
    onGameStateSyncCallback = null;
    renderLobbyCallback = null;
  }

  // ======== ACCESSORS ========

  function isActive() { return active; }
  function isHost() { return _isHost; }
  function getMyDeviceId() { return myDeviceId; }
  function getMyUsername() { return myUsername; }
  function getLobbyState() { return lobbyState; }
  function getGamePhase() { return gamePhase; }

  // Check if a player ID belongs to this device
  function isMyPlayer(playerId) {
    var players = Game.getState().players;
    for (var i = 0; i < players.length; i++) {
      if (players[i].id === playerId) {
        return players[i].deviceId === myDeviceId;
      }
    }
    return false;
  }

  // Check if a seat belongs to this device
  function isMySeat(seatIdx) {
    return lobbyState.seats[seatIdx] && lobbyState.seats[seatIdx].deviceId === myDeviceId;
  }

  // Is a remote device currently paused (screen-off, dropped, etc.)?
  // During game, the host plays AI for these players' turns.
  function isDevicePaused(deviceId) {
    if (!deviceId) return false;
    var dev = lobbyState.devices[deviceId];
    return !!(dev && dev.paused);
  }

  // v96: host-AI NEVER auto-takes-over. If a device's player's turn
  // comes up while they're disconnected, the game simply STALLS until
  // either: (a) the device reconnects (their turn is still theirs), or
  // (b) the host manually reassigns that player via the avatar-click
  // reassign popup. This eliminates the "my phone slept for 5 seconds
  // and a card got drawn for me" class of bugs — no automatic action
  // is ever taken without explicit host intent.
  function shouldHostAutoPlay(/*playerId*/) {
    return false;
  }

  var onHostAutoPlayCallback = null;
  function onHostAutoPlay(cb) { onHostAutoPlayCallback = cb; }

  return {
    hostGame: hostGame,
    joinGame: joinGame,
    leaveRoom: leaveRoom,
    approveGuest: approveGuest,
    denyGuest: denyGuest,
    addAI: addAI,
    addPlayer: addPlayer,
    removeFromSeat: removeFromSeat,
    assignSeatController: assignSeatController,
    setDealer: setDealer,
    swapSeats: swapSeats,
    startOnlineGame: startOnlineGame,
    sendAction: sendAction,
    sendChangeName: sendChangeName,
    sendChangeAnimal: sendChangeAnimal,
    sendSwapSeat: sendSwapSeat,
    onJoinResponse: onJoinResponse,
    onGameStart: onGameStart,
    onAction: onAction,
    onGameAction: onGameAction,
    onGameStateSync: onGameStateSync,
    onMidGameEntry: onMidGameEntry,
    onRenderLobby: onRenderLobby,
    broadcastGameAction: broadcastGameAction,
    broadcastGameStateSync: broadcastGameStateSync,
    broadcastLobbyState: broadcastLobbyState,
    setGamePhase: setGamePhase,
    renderOnlineLobby: renderOnlineLobby,
    renderJoinRequests: renderJoinRequests,
    isActive: isActive,
    isHost: isHost,
    isMyPlayer: isMyPlayer,
    isMySeat: isMySeat,
    isDevicePaused: isDevicePaused,
    shouldHostAutoPlay: shouldHostAutoPlay,
    onHostAutoPlay: onHostAutoPlay,
    renderDeviceLeaveModal: renderDeviceLeaveModal,
    showLocalToast: showLocalToast,
    getMyDeviceId: getMyDeviceId,
    getMyUsername: getMyUsername,
    getLobbyState: getLobbyState,
    getGamePhase: getGamePhase,
    totalPlayerCount: totalPlayerCount,
    cleanup: cleanup
  };
})();

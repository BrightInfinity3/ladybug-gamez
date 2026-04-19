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

  // ---- Initialize ----
  function initLobbyState() {
    lobbyState.seats = [];
    for (var i = 0; i < NUM_SEATS; i++) {
      lobbyState.seats.push({
        occupied: false,
        animal: null,
        name: '',
        isHuman: false,
        isAI: false,
        deviceId: null
      });
    }
    lobbyState.devices = {};
    pendingRequests = [];
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

  function hostGame(username, playerCount) {
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
        playerCount: playerCount,
        isHost: true
      };

      assignPlayersToSeats(myDeviceId, username, playerCount);

      // Set up network handlers
      Network.onConnect(function (peerId) {
        // New connection — wait for join_request message
      });

      Network.onMessage(handleHostMessage);
      Network.onDisconnect(handleGuestDisconnect);

      // Paused — conn.close fired, entering grace period. Mark the
      // device paused so during-game turn handling can switch to host-AI
      // immediately for their players. After a short grace delay
      // (PAUSE_MODAL_DELAY_MS below), also open the "device left" modal
      // so the host can decide sooner — cancelled on resume if they
      // reconnect first.
      var PAUSE_MODAL_DELAY_MS = 8000;  // 8s — covers brief network blips
                                        // without making the host wait
      Network.onPaused(function (peerId) {
        console.log('[Online] Guest paused:', peerId);
        if (lobbyState.devices[peerId]) {
          lobbyState.devices[peerId].paused = true;
          broadcastLobbyState();
          renderOnlineLobby();
          if (gamePhase === 'playing' && typeof onHostAutoPlayCallback === 'function') {
            onHostAutoPlayCallback();
          }
          // Show the "how should I handle their players" modal after a
          // short delay, unless they reconnect first.
          if (_isHost && gamePhase === 'playing' && !pendingLeaves[peerId]) {
            if (pauseModalTimers[peerId]) clearTimeout(pauseModalTimers[peerId]);
            pauseModalTimers[peerId] = setTimeout(function () {
              delete pauseModalTimers[peerId];
              var dev = lobbyState.devices[peerId];
              if (dev && dev.paused && !pendingLeaves[peerId]) {
                startPendingLeave(peerId, /*definitive=*/false);
              }
            }, PAUSE_MODAL_DELAY_MS);
          }
        }
      });

      // Resumed — conn reopened within grace. Flip paused off, cancel
      // any pending leave-modal, let the rejoining device reclaim their
      // seats so they can keep playing.
      Network.onResumed(function (peerId) {
        console.log('[Online] Guest resumed:', peerId);
        if (lobbyState.devices[peerId]) {
          lobbyState.devices[peerId].paused = false;
          lobbyState.devices[peerId].leaving = false;
        }
        // Cancel any scheduled-but-not-yet-opened modal.
        if (pauseModalTimers[peerId]) {
          clearTimeout(pauseModalTimers[peerId]);
          delete pauseModalTimers[peerId];
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
    console.log('[Online] Guest rejoin:', data.username);
    // Guest reconnected — update their connection mapping
    // Their seats still exist from before, just re-map deviceId if peer changed
    var oldDeviceId = data.deviceId;
    if (oldDeviceId !== peerId && lobbyState.devices[oldDeviceId]) {
      // Peer ID changed — remap
      lobbyState.devices[peerId] = lobbyState.devices[oldDeviceId];
      delete lobbyState.devices[oldDeviceId];
      for (var i = 0; i < NUM_SEATS; i++) {
        if (lobbyState.seats[i].deviceId === oldDeviceId) {
          lobbyState.seats[i].deviceId = peerId;
        }
      }
    }

    // Re-sync state
    if (gamePhase === 'lobby') {
      Network.send(peerId, { type: 'lobby_state', data: lobbyState });
      renderOnlineLobby();
    } else if (gamePhase === 'playing') {
      Network.send(peerId, {
        type: 'game_state_sync',
        data: { gameState: Game.serialize() }
      });
    }
  }

  function handleJoinRequest(peerId, data) {
    var totalAfter = totalPlayerCount() + data.playerCount;
    if (totalAfter > 8) {
      Network.send(peerId, {
        type: 'join_response',
        data: { approved: false, reason: 'Too many players (max 8). Only ' + (8 - totalPlayerCount()) + ' slots available.' }
      });
      return;
    }
    // Add to pending — show popup to host
    pendingRequests.push({
      peerId: peerId,
      username: data.username,
      playerCount: data.playerCount
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

    // Check still enough room
    if (totalPlayerCount() + request.playerCount > 8) {
      Network.send(peerId, {
        type: 'join_response',
        data: { approved: false, reason: 'Not enough seats available anymore.' }
      });
      renderJoinRequests();
      return;
    }

    // Defensive: make sure we haven't already assigned seats for this peer.
    // If they somehow re-sent a join_request while already approved, don't
    // double-assign or wipe their existing seats — just re-send the current
    // state so they can catch up.
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

    console.log('[Online] Approving guest:', request.username, 'peerId:', peerId, 'players:', request.playerCount);
    console.log('[Online] Lobby BEFORE approve:', totalPlayerCount(), 'players');

    // Register device
    lobbyState.devices[peerId] = {
      username: request.username,
      playerCount: request.playerCount,
      isHost: false
    };

    // Assign seats
    var assigned = assignPlayersToSeats(peerId, request.username, request.playerCount);
    console.log('[Online] Assigned', request.username, 'to seats:', assigned);
    console.log('[Online] Lobby AFTER approve:', totalPlayerCount(), 'players');

    // Notify guest
    Network.send(peerId, {
      type: 'join_response',
      data: { approved: true, deviceId: peerId }
    });

    // Broadcast updated lobby
    broadcastLobbyState();
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
    if (gamePhase === 'lobby') {
      // Lobby: pulling out before the game starts — remove their seats.
      // 5-minute grace has already expired so we know they aren't coming
      // back quickly; open those seats up for someone else.
      var dev = lobbyState.devices[peerId];
      var uname = dev ? dev.username : 'A player';
      removeDevicePlayers(peerId);
      pendingRequests = pendingRequests.filter(function (r) { return r.peerId !== peerId; });
      broadcastLobbyState();
      broadcastPlayerLeftNotice(uname + ' has left the room.');
      renderOnlineLobby();
      renderJoinRequests();
    } else {
      // During game: hand off to the "device left — host decides" flow.
      // Host AI keeps playing their turns in the meantime so the game
      // never stalls while the host is still picking.
      startPendingLeave(peerId, /*definitive=*/true);
    }
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

  // Toggle an AI/human choice for one seat inside the pending-leave modal.
  function setLeaveDecision(peerId, seatIdx, choice) {
    var p = pendingLeaves[peerId];
    if (!p) return;
    if (choice !== 'ai' && choice !== 'human') return;
    p.decisions[seatIdx] = choice;
    renderDeviceLeaveModal();
  }

  // Apply all choices in the pending-leave modal for one peer.
  // Human choices transfer ownership to the HOST's device (host plays them
  // manually going forward). AI choices flip isAI on, so the normal AI
  // turn logic handles them.
  function applyLeaveDecisions(peerId) {
    var p = pendingLeaves[peerId];
    if (!p) return;
    for (var i = 0; i < p.seats.length; i++) {
      var idx = p.seats[i];
      var seat = lobbyState.seats[idx];
      if (!seat) continue;
      var choice = p.decisions[idx];
      if (choice === 'human') {
        // Host takes over — seat becomes owned by the host device.
        seat.deviceId = myDeviceId;
        seat.isHuman = true;
        seat.isAI = false;
        // Mirror onto the live Game player record so turn routing updates
        // immediately (otherwise Online.isMyPlayer still returns false
        // for the old deviceId until next round).
        updateLivePlayerForSeat(idx, myDeviceId, /*isAI=*/false);
      } else {
        // Auto-play by AI.
        seat.isHuman = false;
        seat.isAI = true;
        seat.deviceId = null;
        updateLivePlayerForSeat(idx, null, /*isAI=*/true);
      }
    }
    // Remove the departed device from the device list — its seats are
    // now reassigned.
    delete lobbyState.devices[peerId];
    delete pendingLeaves[peerId];
    broadcastLobbyState();
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

  // Render the host-side "device left — choose AI/human" modal. If there
  // are no pending leaves, the modal is hidden.
  function renderDeviceLeaveModal() {
    var overlay = document.getElementById('device-leave-overlay');
    if (!overlay) return;
    var peers = Object.keys(pendingLeaves);
    if (!_isHost || peers.length === 0) {
      overlay.style.display = 'none';
      return;
    }
    // Show the first pending peer (handle one at a time)
    var peerId = peers[0];
    var p = pendingLeaves[peerId];
    var titleEl = document.getElementById('device-leave-title');
    if (titleEl) titleEl.textContent = (p.username || 'A player') + ' has left';
    var list = document.getElementById('device-leave-players');
    list.innerHTML = '';
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
      // Toggle
      var toggle = document.createElement('div');
      toggle.className = 'device-leave-toggle';
      var aiBtn = document.createElement('button');
      aiBtn.textContent = 'AI';
      if (p.decisions[idx] === 'ai') aiBtn.classList.add('selected');
      aiBtn.addEventListener('click', (function (pid, si) {
        return function () { setLeaveDecision(pid, si, 'ai'); };
      })(peerId, idx));
      toggle.appendChild(aiBtn);
      var humBtn = document.createElement('button');
      humBtn.textContent = 'Host';
      if (p.decisions[idx] === 'human') humBtn.classList.add('selected');
      humBtn.addEventListener('click', (function (pid, si) {
        return function () { setLeaveDecision(pid, si, 'human'); };
      })(peerId, idx));
      toggle.appendChild(humBtn);
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

  // ---- Host: Add AI to a seat ----
  function addAI(seatIdx) {
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
      isHuman: false,
      isAI: true,
      deviceId: null
    };
    broadcastLobbyState();
    renderOnlineLobby();
  }

  // ---- Host: Remove a player/AI from a seat ----
  function removeFromSeat(seatIdx) {
    if (!_isHost) return;
    var seat = lobbyState.seats[seatIdx];
    if (!seat.occupied) return;
    // If it's a human from a device, remove that player
    if (seat.deviceId) {
      var dev = lobbyState.devices[seat.deviceId];
      if (dev) dev.playerCount--;
    }
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

    // Build player list from lobby seats
    var players = [];
    var dealerIdx = 0;
    var id = 0;
    for (var i = 0; i < NUM_SEATS; i++) {
      var seat = lobbyState.seats[i];
      if (!seat.occupied) continue;
      var p = Game.createPlayer(id, i, seat.animal, seat.name, seat.isHuman, false);
      // Store deviceId mapping for later
      p.deviceId = seat.deviceId;
      p.isAI = seat.isAI;
      players.push(p);
      id++;
    }

    Game.setupGame(players, 0);

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

  function joinGame(code, username, playerCount) {
    active = true;
    _isHost = false;
    myUsername = username;
    gamePhase = 'lobby';

    // The server's join_room handler automatically notifies the host with
    // a peer_joined / join_request — we don't need to send one ourselves
    // anymore (the old PeerJS client had to). Username + playerCount go
    // through the server as part of the join handshake.
    return Network.joinRoom(code, username, playerCount).then(function () {
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

      // Reconnect — if the WebSocket drops and comes back, re-announce
      // ourselves so the host remaps our (possibly new) peerId to our
      // existing seats.
      Network.onReconnect(function () {
        console.log('[Online] Reconnected, re-announcing...');
        Network.send('host', {
          type: 'rejoin',
          data: {
            username: myUsername,
            deviceId: myDeviceId,
            playerCount: playerCount
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
    // Rebuild game state from host's data
    var players = data.players;
    Game.setupGame(players, 0);
    lobbyState = data.lobbyState;

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

    // Delegate seat rendering to UI
    if (typeof renderLobbyCallback === 'function') {
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
      info.innerHTML = '<strong>' + req.username + '</strong> wants to join with <strong>' + req.playerCount + '</strong> player' + (req.playerCount > 1 ? 's' : '');
      el.appendChild(info);

      var slotsLeft = 8 - totalPlayerCount();
      if (req.playerCount > slotsLeft) {
        var warning = document.createElement('div');
        warning.className = 'join-request-warning';
        warning.textContent = 'Not enough slots (' + slotsLeft + ' available)';
        el.appendChild(warning);
      }

      var buttons = document.createElement('div');
      buttons.className = 'join-request-buttons';

      var approveBtn = document.createElement('button');
      approveBtn.className = 'btn btn-gold btn-sm';
      approveBtn.textContent = 'Allow';
      approveBtn.disabled = req.playerCount > slotsLeft;
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

  function onGameStart(cb) { onGameStartCallback = cb; }
  function onAction(cb) { onActionCallback = cb; }
  function onGameAction(cb) { onGameActionCallback = cb; }
  function onGameStateSync(cb) { onGameStateSyncCallback = cb; }

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

  // Returns true if the given player is a human on a device that is
  // currently paused, i.e. the host should auto-play an AI move for them.
  function shouldHostAutoPlay(playerId) {
    if (!_isHost) return false;
    var players = Game.getState().players;
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      if (p.id !== playerId) continue;
      // AI players already play via normal AI path — don't override
      if (p.isAI) return false;
      // Host's own local players always play normally
      if (p.deviceId === myDeviceId) return false;
      // Remote human whose device is paused → host AI takes over
      return isDevicePaused(p.deviceId);
    }
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
    removeFromSeat: removeFromSeat,
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

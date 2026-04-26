/* ==========================================================================
   game-ws-server.js
   Reusable WebSocket room server for turn-based multiplayer games.
   Host-authoritative: the server just relays JSON messages between clients
   that share a room code. No game rules live here.

   Usage (in server.js):
     const { attachGameWebSocketServer } = require('./game-ws-server');
     const server = http.createServer(app);
     attachGameWebSocketServer(server, { path: '/ws' });
     server.listen(PORT, ...);

   Protocol — client → server (JSON):
     { type: 'create_room', data: { username } }
     { type: 'join_room',   data: { roomCode, username, playerCount } }
     { type: 'leave_room' }
     { type: 'kick',        data: { peerId, reason } }   // host-only
     { type: 'broadcast',   data: { payload } }
     { type: 'send',        data: { peerId, payload } }  // peerId can be 'host'
     { type: '_ping' }

   Server → client:
     { type: 'room_created', data: { roomCode, peerId } }
     { type: 'room_joined',  data: { roomCode, peerId } }
     { type: 'join_failed',  data: { reason } }
     { type: 'peer_joined',  data: { peerId, username, playerCount } }    // to host
     { type: 'peer_message', data: { from, payload } }
     { type: 'peer_paused',  data: { peerId } }
     { type: 'peer_resumed', data: { peerId } }
     { type: 'peer_left',    data: { peerId } }
     { type: 'room_disbanded',data: { reason } }
     { type: 'kicked',       data: { reason } }
     { type: '_pong' }
     { type: 'error',        data: { message } }
   ========================================================================== */

'use strict';

const WebSocket = require('ws');
const crypto = require('crypto');

function genRoomCode() {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 3; i++) code += alpha[Math.floor(Math.random() * alpha.length)];
  return code;
}

function genPeerId() {
  return 'p-' + crypto.randomBytes(6).toString('hex');
}

function attachGameWebSocketServer(httpServer, options) {
  options = options || {};
  const path = options.path || '/ws';
  // Faster heartbeat so socket death is detected within ~20s instead of
  // ~50s. Dead sockets still get up to one missed ping + one interval
  // before termination, so real-world close latency is ~HEARTBEAT_MS * 2.
  const HEARTBEAT_MS = 10000;
  const RECONNECT_GRACE_MS = 300000; // 5 min to reconnect before final drop

  const wss = new WebSocket.Server({ server: httpServer, path: path });

  // rooms: roomCode -> { code, hostPeerId, peers: { peerId: PeerEntry } }
  // PeerEntry: { peerId, socket, isHost, username, playerCount, lastSeen, graceTimer }
  const rooms = new Map();
  // peerId → roomCode
  const peerRoom = new Map();

  const log = (...a) => console.log('[game-ws]', new Date().toISOString(), ...a);

  function safeSend(ws, obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try { ws.send(JSON.stringify(obj)); return true; }
    catch (e) { log('send failed:', e.message); return false; }
  }

  function roomOf(peerId) {
    const code = peerRoom.get(peerId);
    return code ? rooms.get(code) : null;
  }

  function broadcastToRoom(room, message, exceptPeerId) {
    for (const pid in room.peers) {
      if (pid === exceptPeerId) continue;
      safeSend(room.peers[pid].socket, message);
    }
  }

  function sendToPeer(room, targetPeerId, message) {
    // 'host' alias — resolve to whoever is currently hosting this room.
    const realTarget = (targetPeerId === 'host') ? room.hostPeerId : targetPeerId;
    const p = room.peers[realTarget];
    if (p) safeSend(p.socket, message);
  }

  function addPeerToRoom(room, peerId, ws, isHost, username, playerCount) {
    room.peers[peerId] = {
      peerId, socket: ws,
      isHost: !!isHost,
      username: username || '',
      playerCount: playerCount || 1,
      lastSeen: Date.now(),
      graceTimer: null
    };
    peerRoom.set(peerId, room.code);
    ws._peerId = peerId;
    ws._roomCode = room.code;
  }

  function removePeer(room, peerId, reason) {
    const p = room.peers[peerId];
    if (!p) return;
    if (p.graceTimer) clearTimeout(p.graceTimer);
    const wasHost = (room.hostPeerId === peerId);
    delete room.peers[peerId];
    peerRoom.delete(peerId);
    broadcastToRoom(room, { type: 'peer_left', data: { peerId, reason } });
    log(`peer ${peerId} removed from ${room.code} (${reason})`);

    if (wasHost) {
      // Host departed. If they EXPLICITLY left (clicked Leave Room),
      // disband — they confirmed "this ends the game for everyone".
      // If they timed out (network drop, screen lock past grace),
      // start the proposal-cascade so a remaining peer can opt-in
      // as the new host. Each candidate gets accept/deny; on deny
      // the next candidate is proposed; if all decline (or there
      // are no candidates), the room disbands.
      if (reason === 'timed_out') {
        if (startMigrationCascade(room, peerId)) return;
      }
      const friendly = (reason === 'left') ? 'Host left.' : 'Host disconnected.';
      disbandRoom(room.code, friendly);
    } else if (Object.keys(room.peers).length === 0) {
      rooms.delete(room.code);
      log(`room ${room.code} empty — deleted`);
    }
  }

  // ---- Voluntary host handoff (current host hands off) ----
  // The host-side requestHandoff/respondHandoff dance happens
  // peer-to-peer (we just relay the messages); when the candidate
  // accepts, the current host calls Network.handoffHost which
  // sends `host_handoff` to the server. We validate, update room
  // state, and broadcast host_migrated so every device runs the
  // migration takeover.
  function onHostHandoff(ws, peerId, data) {
    const room = roomOf(peerId);
    if (!room) return;
    if (peerId !== room.hostPeerId) {
      safeSend(ws, { type: 'error', data: { message: 'only host can hand off' } });
      return;
    }
    const newHostId = data && data.newHostPeerId;
    if (!newHostId || !room.peers[newHostId]) {
      safeSend(ws, { type: 'error', data: { message: 'invalid candidate' } });
      return;
    }
    log(`voluntary host handoff in ${room.code}: ${peerId} -> ${newHostId}`);
    migrateHost(room, peerId, newHostId, 'voluntary');
  }

  // ---- Cascade migration on host timeout ----
  // Starts a proposal-cascade: pick the first candidate, broadcast
  // `host_migration_proposal` to everyone (so the candidate's UI
  // can show accept/deny and other peers can show a waiting state).
  // When the candidate responds via host_migration_accept or
  // host_migration_decline, we either finalize (broadcast
  // host_migrated) or move to the next candidate. When the
  // candidate list is exhausted, broadcast host_migration_disbanded
  // and tear the room down.
  function startMigrationCascade(room, oldHostPeerId) {
    room._migrationCascade = {
      oldHostPeerId,
      declined: new Set(),
      pendingCandidate: null,
      reason: 'timed_out'
    };
    return proposeNextCandidate(room);
  }

  function proposeNextCandidate(room) {
    const cascade = room._migrationCascade;
    if (!cascade) return false;
    const declined = cascade.declined;
    const candidate = pickNewHost(room, declined);
    if (!candidate) {
      // Nobody is eligible — every candidate already declined or
      // none exist at all. Broadcast a final notice and disband.
      log(`room ${room.code} migration cascade exhausted — disbanding`);
      broadcastToRoom(room, { type: 'host_migration_disbanded', data: { reason: 'all_declined' } });
      delete room._migrationCascade;
      disbandRoom(room.code, 'No host could be found.');
      return false;
    }
    cascade.pendingCandidate = candidate;
    log(`room ${room.code} proposing host migration to ${candidate}`);
    broadcastToRoom(room, {
      type: 'host_migration_proposal',
      data: {
        candidatePeerId: candidate,
        oldHostPeerId: cascade.oldHostPeerId,
        declinedPeers: Array.from(declined),
        reason: cascade.reason
      }
    });
    return true;
  }

  function onHostMigrationAccept(ws, peerId) {
    const room = roomOf(peerId);
    if (!room || !room._migrationCascade) return;
    const cascade = room._migrationCascade;
    if (cascade.pendingCandidate !== peerId) {
      log(`ignoring host_migration_accept from ${peerId} (not the pending candidate)`);
      return;
    }
    log(`peer ${peerId} accepted host migration in ${room.code}`);
    delete room._migrationCascade;
    migrateHost(room, cascade.oldHostPeerId, peerId, 'cascade_accept');
  }

  function onHostMigrationDecline(ws, peerId) {
    const room = roomOf(peerId);
    if (!room || !room._migrationCascade) return;
    const cascade = room._migrationCascade;
    if (cascade.pendingCandidate !== peerId) {
      log(`ignoring host_migration_decline from ${peerId} (not the pending candidate)`);
      return;
    }
    log(`peer ${peerId} declined host migration in ${room.code}`);
    cascade.declined.add(peerId);
    cascade.pendingCandidate = null;
    proposeNextCandidate(room);
  }

  // Pick a peer to promote to host when the current host has timed
  // out. Preference order:
  //   1. Any peer with an OPEN socket — they can take over right
  //      now and start broadcasting state.
  //   2. Any peer still inside their own grace window (paused but
  //      not yet timed out). They'll take over once they reclaim.
  // The optional `excluded` Set skips peers that have already
  // declined a proposal during the current migration cascade.
  // Returns null if no candidates exist (room should disband).
  function pickNewHost(room, excluded) {
    let openCandidate = null;
    let pausedCandidate = null;
    for (const pid in room.peers) {
      if (excluded && excluded.has(pid)) continue;
      const p = room.peers[pid];
      if (p.socket && p.socket.readyState === WebSocket.OPEN) {
        if (!openCandidate) openCandidate = pid;
      } else if (!pausedCandidate) {
        pausedCandidate = pid;
      }
    }
    return openCandidate || pausedCandidate;
  }

  // Promote `newHostPeerId` to host of `room`. Broadcasts a
  // `host_migrated` message to all remaining peers. The new host's
  // client takes over host duties (lobby/game state broadcasts,
  // join-request approvals, etc.); other peers just update their
  // host reference and continue as guests. Game state continuity
  // comes from the routine `game_state_sync` broadcasts that all
  // peers received before the old host vanished — every peer's
  // local Game state is already current, so the new host can keep
  // broadcasting from where the old one left off.
  function migrateHost(room, oldHostPeerId, newHostPeerId, reason) {
    room.hostPeerId = newHostPeerId;
    log(`room ${room.code} host migrated: ${oldHostPeerId} -> ${newHostPeerId} (${reason})`);
    broadcastToRoom(room, {
      type: 'host_migrated',
      data: { newHostPeerId, oldHostPeerId, reason }
    });
  }

  function disbandRoom(code, reason) {
    const room = rooms.get(code);
    if (!room) return;
    for (const pid in room.peers) {
      const p = room.peers[pid];
      safeSend(p.socket, { type: 'room_disbanded', data: { reason } });
      if (p.graceTimer) clearTimeout(p.graceTimer);
      try { p.socket.close(1000, 'room disbanded'); } catch (e) {}
      peerRoom.delete(pid);
    }
    rooms.delete(code);
    log(`room ${code} disbanded: ${reason}`);
  }

  // ---- Handlers -----------------------------------------------------------

  function onCreateRoom(ws, peerId, data) {
    let code;
    for (let i = 0; i < 8; i++) {
      const c = genRoomCode();
      if (!rooms.has(c)) { code = c; break; }
    }
    if (!code) { safeSend(ws, { type: 'error', data: { message: 'Could not allocate room code' } }); return; }
    const room = { code, hostPeerId: peerId, peers: {} };
    rooms.set(code, room);
    addPeerToRoom(room, peerId, ws, true, (data && data.username) || '');
    safeSend(ws, { type: 'room_created', data: { roomCode: code, peerId } });
    log(`room ${code} created by host ${peerId}`);
  }

  function onJoinRoom(ws, peerId, data) {
    const code = (data && data.roomCode || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      safeSend(ws, { type: 'join_failed', data: { reason: 'Room ' + code + ' not found.' } });
      return;
    }
    const username = (data && data.username) || '';
    const playerCount = (data && data.playerCount) || 1;
    addPeerToRoom(room, peerId, ws, false, username, playerCount);
    // Tell the joining client they're attached.
    safeSend(ws, { type: 'room_joined', data: { roomCode: code, peerId } });
    // Tell the host a new peer arrived (they run the approval UI).
    sendToPeer(room, room.hostPeerId, {
      type: 'peer_joined',
      data: { peerId, username, playerCount }
    });
    log(`peer ${peerId} joined ${code} (${username}, ${playerCount} players)`);
  }

  function onLeaveRoom(room, peerId) {
    removePeer(room, peerId, 'left');
  }

  // Reclaim an existing peerId after the client's socket was dropped
  // and reopened (e.g. mobile screen lock / Wi-Fi blip). The client
  // sends its previously-assigned peerId + roomCode; if that peer is
  // still within the reconnect-grace window, we swap its socket to
  // the new connection and broadcast peer_resumed. Guests and hosts
  // can both reclaim — this is how the host survives a screen-lock
  // without tearing the room down.
  function onReclaim(ws, tempPeerId, data) {
    const claimedId = data && data.peerId;
    const claimedRoom = data && data.roomCode;
    if (!claimedId) {
      safeSend(ws, { type: 'reclaim_failed', data: { reason: 'missing peerId' } });
      return;
    }
    const stillIndexed = peerRoom.get(claimedId);
    if (!stillIndexed || (claimedRoom && stillIndexed !== claimedRoom)) {
      safeSend(ws, { type: 'reclaim_failed', data: { reason: 'not found' } });
      return;
    }
    const room = rooms.get(stillIndexed);
    if (!room || !room.peers[claimedId]) {
      safeSend(ws, { type: 'reclaim_failed', data: { reason: 'not found' } });
      return;
    }
    const entry = room.peers[claimedId];
    // Cancel any grace / final-drop timer — they're back.
    if (entry.graceTimer) { clearTimeout(entry.graceTimer); entry.graceTimer = null; }
    // Close the old socket if it's somehow still open (shouldn't be).
    if (entry.socket && entry.socket !== ws && entry.socket.readyState === WebSocket.OPEN) {
      try { entry.socket.close(1000, 'replaced by reclaim'); } catch (e) {}
    }
    // Swap the socket. Note tempPeerId was never in peerRoom (we only
    // add on create/join/reclaim), so no cleanup there.
    entry.socket = ws;
    ws._peerId = claimedId;
    ws._roomCode = stillIndexed;
    entry.lastSeen = Date.now();
    safeSend(ws, { type: 'reclaimed', data: { peerId: claimedId, roomCode: stillIndexed, isHost: claimedId === room.hostPeerId } });
    broadcastToRoom(room, { type: 'peer_resumed', data: { peerId: claimedId } }, claimedId);
    log(`peer ${claimedId} reclaimed in ${stillIndexed} (was temp ${tempPeerId})`);
  }

  function onKick(room, fromPeerId, data) {
    if (fromPeerId !== room.hostPeerId) return;
    const target = data && data.peerId;
    if (!target) return;
    const p = room.peers[target];
    if (!p) return;
    safeSend(p.socket, { type: 'kicked', data: { reason: (data && data.reason) || 'Host kicked you.' } });
    try { p.socket.close(1000, 'kicked'); } catch (e) {}
    // Treat the kick as a final drop — don't wait for grace.
    if (p.graceTimer) clearTimeout(p.graceTimer);
    delete room.peers[target];
    peerRoom.delete(target);
    broadcastToRoom(room, { type: 'peer_left', data: { peerId: target, reason: 'kicked' } });
    log(`host ${fromPeerId} kicked ${target} from ${room.code}`);
  }

  function onBroadcast(room, fromPeerId, data) {
    const payload = data && data.payload;
    if (!payload) return;
    broadcastToRoom(room, { type: 'peer_message', data: { from: fromPeerId, payload } }, fromPeerId);
  }

  function onSend(room, fromPeerId, data) {
    const to = data && data.peerId;
    const payload = data && data.payload;
    if (!to || !payload) return;
    sendToPeer(room, to, { type: 'peer_message', data: { from: fromPeerId, payload } });
  }

  // ---- Graceful disconnect / reconnect -----------------------------------
  function onSocketClose(ws) {
    const peerId = ws._peerId;
    const code = ws._roomCode;
    if (!peerId || !code) return;
    const room = rooms.get(code);
    if (!room) return;
    const p = room.peers[peerId];
    if (!p) return;
    if (p.socket !== ws) return; // this socket has already been replaced

    broadcastToRoom(room, { type: 'peer_paused', data: { peerId } }, peerId);
    log(`peer ${peerId} paused in ${code}`);

    // For BOTH host and guest: wait out the grace window instead of
    // kicking immediately. A `reclaim` message on a new socket within
    // the window reclaims this peer's slot (and any game state they
    // held as host). If nobody reclaims within RECONNECT_GRACE_MS,
    // removePeer fires — and if the departed peer was the host, that
    // triggers the full room disband. This is what saves a mobile
    // device briefly losing the socket when the screen locks.
    p.graceTimer = setTimeout(() => {
      removePeer(room, peerId, 'timed_out');
    }, RECONNECT_GRACE_MS);
  }

  // ---- Top-level connection plumbing -------------------------------------
  wss.on('connection', (ws, req) => {
    const tempPeerId = genPeerId();
    ws._peerId = tempPeerId;
    ws._alive = true;
    log(`peer ${tempPeerId} connected from ${req && req.socket && req.socket.remoteAddress}`);

    ws.on('pong', () => { ws._alive = true; });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); }
      catch (e) { safeSend(ws, { type: 'error', data: { message: 'malformed JSON' } }); return; }
      const type = msg && msg.type;
      const data = msg && msg.data;
      if (!type) return;

      if (type === '_ping') { safeSend(ws, { type: '_pong' }); return; }

      // CRITICAL: read the CURRENT peerId from the socket, not the
      // captured closure value. After a reclaim() call the socket's
      // _peerId is updated to the claimed id, but the closure still
      // holds the temporary id assigned at connection time. Using
      // the stale closure id made roomOf() return null for every
      // message sent on a reclaimed socket, which silently dropped
      // the guest's Draw/Stay action after a phone-sleep reconnect.
      const peerId = ws._peerId;
      const room = roomOf(peerId);

      try {
        switch (type) {
          case 'create_room':
            if (room) { safeSend(ws, { type: 'error', data: { message: 'already in a room' } }); return; }
            onCreateRoom(ws, peerId, data);
            break;
          case 'join_room':
            if (room) { safeSend(ws, { type: 'error', data: { message: 'already in a room' } }); return; }
            onJoinRoom(ws, peerId, data);
            break;
          case 'reclaim':
            if (room) { safeSend(ws, { type: 'error', data: { message: 'already in a room' } }); return; }
            onReclaim(ws, peerId, data);
            break;
          case 'leave_room':
            if (room) onLeaveRoom(room, peerId);
            break;
          case 'kick':
            if (room) onKick(room, peerId, data);
            break;
          case 'broadcast':
            if (room) onBroadcast(room, peerId, data);
            break;
          case 'send':
            if (room) onSend(room, peerId, data);
            break;
          case 'host_handoff':
            // Voluntary handoff initiated by current host (CHANGE
            // HOST or "Yes, Exit (Choose New Host)" on Leave Room).
            if (room) onHostHandoff(ws, peerId, data);
            break;
          case 'host_migration_accept':
            // Cascade migration: candidate accepted the proposal.
            if (room) onHostMigrationAccept(ws, peerId);
            break;
          case 'host_migration_decline':
            // Cascade migration: candidate declined; propose next.
            if (room) onHostMigrationDecline(ws, peerId);
            break;
          default:
            safeSend(ws, { type: 'error', data: { message: 'unknown type: ' + type } });
        }
      } catch (e) {
        log('handler error:', e.message, e.stack);
        safeSend(ws, { type: 'error', data: { message: 'server error' } });
      }

      if (room && room.peers[peerId]) room.peers[peerId].lastSeen = Date.now();
    });

    ws.on('close', () => {
      log(`peer ${ws._peerId} socket closed`);
      onSocketClose(ws);
    });

    ws.on('error', (err) => log(`peer ${ws._peerId} socket error: ${err.message}`));
  });

  const hbInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws._alive === false) { try { ws.terminate(); } catch (e) {} continue; }
      ws._alive = false;
      try { ws.ping(); } catch (e) {}
    }
  }, HEARTBEAT_MS);

  wss.on('close', () => clearInterval(hbInterval));

  log(`WebSocket server listening on path ${path}`);
  return wss;
}

module.exports = { attachGameWebSocketServer };

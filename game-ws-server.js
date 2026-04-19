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
  for (let i = 0; i < 4; i++) code += alpha[Math.floor(Math.random() * alpha.length)];
  return code;
}

function genPeerId() {
  return 'p-' + crypto.randomBytes(6).toString('hex');
}

function attachGameWebSocketServer(httpServer, options) {
  options = options || {};
  const path = options.path || '/ws';
  const HEARTBEAT_MS = 25000;
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
    delete room.peers[peerId];
    peerRoom.delete(peerId);
    broadcastToRoom(room, { type: 'peer_left', data: { peerId, reason } });
    log(`peer ${peerId} removed from ${room.code} (${reason})`);

    if (room.hostPeerId === peerId) {
      disbandRoom(room.code, 'Host left.');
    } else if (Object.keys(room.peers).length === 0) {
      rooms.delete(room.code);
      log(`room ${room.code} empty — deleted`);
    }
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

    // If the HOST's socket closed, disband immediately — there's no path
    // for them to resume on a new socket in v1. (We could add host
    // reconnect later by letting the re-opened socket reclaim the peerId.)
    if (peerId === room.hostPeerId) {
      disbandRoom(code, 'Host disconnected.');
      return;
    }

    p.graceTimer = setTimeout(() => {
      removePeer(room, peerId, 'timed_out');
    }, RECONNECT_GRACE_MS);
  }

  // ---- Top-level connection plumbing -------------------------------------
  wss.on('connection', (ws, req) => {
    const peerId = genPeerId();
    ws._peerId = peerId;
    ws._alive = true;
    log(`peer ${peerId} connected from ${req && req.socket && req.socket.remoteAddress}`);

    ws.on('pong', () => { ws._alive = true; });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); }
      catch (e) { safeSend(ws, { type: 'error', data: { message: 'malformed JSON' } }); return; }
      const type = msg && msg.type;
      const data = msg && msg.data;
      if (!type) return;

      if (type === '_ping') { safeSend(ws, { type: '_pong' }); return; }

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
      log(`peer ${peerId} socket closed`);
      onSocketClose(ws);
    });

    ws.on('error', (err) => log(`peer ${peerId} socket error: ${err.message}`));
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

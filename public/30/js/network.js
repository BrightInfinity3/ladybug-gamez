/* ============================================================
   30 - Network Layer (WebSocket client)
   Host-authoritative. Talks to the central Ladybug-Gamez WebSocket
   relay server; no peer-to-peer / STUN / TURN / ICE.
   ============================================================ */

var Network = (function () {
  'use strict';

  // ---- WebSocket URL resolution ----
  // Priority:
  //   1) window.GAME_WS_URL (hard override — set from console / before load)
  //   2) localStorage.GAME_WS_URL (persistent dev override)
  //   3) If page is on ladybug-gamez.* → same-origin WebSocket
  //   4) If page is on localhost → local Ladybug Gamez dev server (:3001)
  //   5) Otherwise → production Ladybug Gamez.
  // Change the PRODUCTION_WS constant below if your Railway URL differs.
  var PRODUCTION_WS = 'wss://ladybug.up.railway.app/ws';

  function resolveWsUrl() {
    if (typeof window !== 'undefined' && window.GAME_WS_URL) return window.GAME_WS_URL;
    try {
      var stored = window.localStorage && window.localStorage.getItem('GAME_WS_URL');
      if (stored) return stored;
    } catch (e) {}
    var host = location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '') {
      // Local dev — assume Ladybug Gamez is running on :3001 alongside the
      // static server. Override via localStorage.GAME_WS_URL if needed.
      return 'ws://' + (host || 'localhost') + ':3001/ws';
    }
    if (host.indexOf('ladybug') !== -1) {
      var scheme = (location.protocol === 'https:') ? 'wss:' : 'ws:';
      return scheme + '//' + location.host + '/ws';
    }
    return PRODUCTION_WS;
  }

  var WS_URL = resolveWsUrl();

  // ---- State ----
  var ws = null;
  var _isHost = false;
  var myPeerId = '';
  var roomCode = '';
  var connectedToRoom = false;
  var userInitiatedClose = false; // true after disconnect() / kicked / disband

  // Reconnect state for socket-level drops (screen lock, Wi-Fi blip etc.)
  var reconnectTimer = null;
  var reconnectAttempt = 0;
  var reconnectInFlight = false;

  // Pending promises for createRoom / joinRoom
  var createResolve = null, createReject = null;
  var joinResolve = null, joinReject = null;
  var pendingJoinCode = '';
  var pendingUsername = '';
  var pendingPlayerCount = 1;

  // Handlers (set by online.js)
  var messageHandler = null;
  var connectHandler = null;
  var disconnectHandler = null;
  var reconnectHandler = null;
  var pausedHandler = null;
  var resumedHandler = null;

  var pingTimer = null;

  // ---- Low-level socket helpers ----
  function openSocket(onReady, onError) {
    try {
      ws = new WebSocket(WS_URL);
    } catch (e) {
      if (onError) onError(e);
      return;
    }
    ws.addEventListener('open', function () {
      console.log('[Network] WebSocket open:', WS_URL);
      startHeartbeat();
      if (onReady) onReady();
    });
    ws.addEventListener('message', onSocketMessage);
    ws.addEventListener('close', onSocketClose);
    ws.addEventListener('error', function (err) {
      console.warn('[Network] WebSocket error (url=' + WS_URL + ')');
      if (onError) onError(err);
    });
  }

  function wsSend(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[Network] dropping send on closed socket:', obj && obj.type);
      return false;
    }
    try { ws.send(JSON.stringify(obj)); return true; }
    catch (e) { console.warn('[Network] send failed:', e.message); return false; }
  }

  function startHeartbeat() {
    stopHeartbeat();
    pingTimer = setInterval(function () {
      if (ws && ws.readyState === WebSocket.OPEN) wsSend({ type: '_ping' });
    }, 20000);
  }
  function stopHeartbeat() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  }

  // ---- Public: Create Room (host) ----
  function createRoom(username) {
    _isHost = true;
    userInitiatedClose = false;
    cancelReconnect();
    return new Promise(function (resolve, reject) {
      createResolve = resolve;
      createReject = reject;
      pendingUsername = username || '';
      var send = function () {
        wsSend({ type: 'create_room', data: { username: pendingUsername } });
      };
      if (ws && ws.readyState === WebSocket.OPEN) send();
      else openSocket(send, function (e) {
        if (createReject) { createReject(new Error('Could not reach the game server. Check your connection.')); createReject = null; createResolve = null; }
      });
    });
  }

  // ---- Public: Join Room (guest) ----
  function joinRoom(code, username, playerCount) {
    _isHost = false;
    userInitiatedClose = false;
    cancelReconnect();
    pendingJoinCode = (code || '').toUpperCase();
    pendingUsername = username || '';
    pendingPlayerCount = playerCount || 1;
    return new Promise(function (resolve, reject) {
      joinResolve = resolve;
      joinReject = reject;
      var send = function () {
        wsSend({
          type: 'join_room',
          data: {
            roomCode: pendingJoinCode,
            username: pendingUsername,
            playerCount: pendingPlayerCount
          }
        });
      };
      if (ws && ws.readyState === WebSocket.OPEN) send();
      else openSocket(send, function (e) {
        if (joinReject) { joinReject(new Error('Could not reach the game server. Check your connection.')); joinReject = null; joinResolve = null; }
      });
      // Safety timeout — if the server never responds to our join_room
      // within 10s, fail the promise so the UI can show an error.
      setTimeout(function () {
        if (joinReject && !connectedToRoom) {
          joinReject(new Error('Timed out reaching the game server.'));
          joinReject = null; joinResolve = null;
        }
      }, 10000);
    });
  }

  // ---- Public: Send / Broadcast ----
  // target: peerId string OR 'host' (alias resolved server-side).
  function send(target, payload) {
    wsSend({ type: 'send', data: { peerId: target, payload: payload } });
  }

  function broadcast(payload) {
    wsSend({ type: 'broadcast', data: { payload: payload } });
  }

  // ---- Public: Leave / Kick ----
  function disconnect() {
    userInitiatedClose = true;
    cancelReconnect();
    connectedToRoom = false;
    if (ws) {
      try { wsSend({ type: 'leave_room' }); } catch (e) {}
      try { ws.close(1000, 'client disconnecting'); } catch (e) {}
      ws = null;
    }
    stopHeartbeat();
    _isHost = false;
    myPeerId = '';
    roomCode = '';
  }

  function kickGuest(peerId, reason) {
    wsSend({ type: 'kick', data: { peerId: peerId, reason: reason || 'Host removed this player.' } });
  }

  // ---- Incoming message dispatch ----
  function onSocketMessage(evt) {
    var msg;
    try { msg = JSON.parse(evt.data); } catch (e) { return; }
    handleServerMessage(msg);
  }

  function handleServerMessage(msg) {
    var type = msg.type;
    var data = msg.data || {};
    switch (type) {
      case 'room_created':
        myPeerId = data.peerId;
        roomCode = data.roomCode;
        connectedToRoom = true;
        if (createResolve) { createResolve(roomCode); createResolve = null; createReject = null; }
        break;

      case 'room_joined':
        // Our socket is attached to the room, but the HOST still needs to
        // approve us at the application level (online.js handles that via
        // join_response). Resolving the Promise here lets online.js wire
        // its handlers and wait for that approval.
        myPeerId = data.peerId;
        roomCode = data.roomCode;
        connectedToRoom = true;
        if (joinResolve) { joinResolve(); joinResolve = null; joinReject = null; }
        break;

      case 'join_failed':
        connectedToRoom = false;
        if (joinReject) { joinReject(new Error(data.reason || 'Join failed.')); joinReject = null; joinResolve = null; }
        break;

      case 'peer_joined':
        // Server telling us (the host) a new peer arrived. Translate into
        // the same 'join_request' application message shape online.js
        // already handles in handleHostMessage.
        if (connectHandler) connectHandler(data.peerId);
        if (messageHandler) messageHandler(data.peerId, {
          type: 'join_request',
          data: { username: data.username, playerCount: data.playerCount }
        });
        break;

      case 'peer_message':
        // Normal app-level message relayed from another peer.
        if (messageHandler) messageHandler(data.from, data.payload);
        break;

      case 'peer_paused':
        if (pausedHandler) pausedHandler(data.peerId);
        break;

      case 'peer_resumed':
        if (resumedHandler) resumedHandler(data.peerId);
        if (reconnectHandler) reconnectHandler(data.peerId);
        break;

      case 'peer_left':
        if (disconnectHandler) disconnectHandler(data.peerId);
        break;

      case 'room_disbanded':
        // The whole room was torn down (host left, etc.). Tell app layer
        // via disconnect('host') to match the old PeerJS behaviour.
        if (disconnectHandler) disconnectHandler('host');
        connectedToRoom = false;
        break;

      case 'kicked':
        userInitiatedClose = true;
        if (disconnectHandler) disconnectHandler('host');
        connectedToRoom = false;
        break;

      case 'reclaimed':
        // Server confirmed we retook our old peerId after a reconnect.
        // From the app's perspective we just resumed — no new join flow.
        myPeerId = data.peerId || myPeerId;
        roomCode = data.roomCode || roomCode;
        connectedToRoom = true;
        reconnectAttempt = 0;
        console.log('[Network] Reclaimed peerId', myPeerId, 'in room', roomCode);
        // Let the app layer know we're back so it can re-announce state.
        if (reconnectHandler) reconnectHandler('self');
        break;

      case 'reclaim_failed':
        // Our old peerId is no longer valid (grace expired or room gone).
        // Surface as a disconnect so the app can show the disband dialog.
        console.warn('[Network] Reclaim failed:', data && data.reason);
        userInitiatedClose = true;
        if (disconnectHandler) disconnectHandler('host');
        connectedToRoom = false;
        break;

      case '_pong':
        // alive
        break;

      case 'error':
        console.warn('[Network] server error:', data.message);
        break;
    }
  }

  function onSocketClose() {
    console.log('[Network] WebSocket closed');
    stopHeartbeat();
    ws = null;
    // If we were mid-join, fail the join promise so UI can show an error.
    if (joinReject && !connectedToRoom) {
      joinReject(new Error('Lost connection to the game server.'));
      joinReject = null; joinResolve = null;
      return;
    }
    // If the close was INTENTIONAL (disconnect() called, kicked, or
    // reclaim_failed) — don't reconnect, just tear down.
    if (userInitiatedClose) {
      userInitiatedClose = false;
      if (connectedToRoom) {
        connectedToRoom = false;
        if (disconnectHandler) disconnectHandler('host');
      }
      return;
    }
    // Otherwise the socket dropped unexpectedly (screen lock, Wi-Fi
    // blip, server restart, etc.). Try to reconnect and reclaim our
    // old peerId within the 5-minute server grace window so the room
    // doesn't disband. If we weren't in a room, don't bother.
    if (myPeerId && roomCode) {
      scheduleReconnect();
    } else {
      connectedToRoom = false;
    }
  }

  function scheduleReconnect() {
    if (reconnectInFlight) return;
    // Exponential backoff: 1s, 2s, 4s, 8s, then every 15s up to ~5 min
    // (roughly matching the server's grace window).
    var backoff = Math.min(1000 * Math.pow(2, reconnectAttempt), 15000);
    reconnectAttempt++;
    console.log('[Network] Reconnect attempt #' + reconnectAttempt + ' in ' + backoff + 'ms');
    reconnectInFlight = true;
    reconnectTimer = setTimeout(function () {
      reconnectInFlight = false;
      doReconnect();
    }, backoff);
  }

  function cancelReconnect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectInFlight = false;
    reconnectAttempt = 0;
  }

  function doReconnect() {
    var savedPeerId = myPeerId;
    var savedRoom = roomCode;
    if (!savedPeerId || !savedRoom) return;
    console.log('[Network] Attempting reconnect; reclaiming peerId', savedPeerId);
    openSocket(function () {
      // Socket is open — send reclaim as first message.
      wsSend({ type: 'reclaim', data: { peerId: savedPeerId, roomCode: savedRoom } });
      // If the server responds with reclaim_failed, handleServerMessage
      // will fire disconnectHandler. If it responds with `reclaimed`,
      // we're back in business.
    }, function () {
      // Socket open failed — try again.
      if (reconnectAttempt < 20) scheduleReconnect();
      else {
        console.warn('[Network] Gave up reconnecting after', reconnectAttempt, 'attempts');
        reconnectAttempt = 0;
        if (connectedToRoom) {
          connectedToRoom = false;
          if (disconnectHandler) disconnectHandler('host');
        }
      }
    });
  }

  // When the page regains visibility (phone wakes, tab becomes active),
  // a dead socket may not fire `close` for a while. Force a quick check
  // and trigger a reconnect if we're holding a dead connection.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (userInitiatedClose) return;
    // If we think we're connected but the socket is dead or closing,
    // kick a reconnect now instead of waiting for the server heartbeat
    // to notice 20+ seconds from now.
    if (myPeerId && roomCode && (!ws || ws.readyState >= WebSocket.CLOSING)) {
      console.log('[Network] Page visible — socket is dead, reconnecting now');
      cancelReconnect();
      doReconnect();
    } else if (ws && ws.readyState === WebSocket.OPEN) {
      // Socket thinks it's open — send an immediate ping so if it's
      // actually half-closed we find out quickly.
      wsSend({ type: '_ping' });
    }
  });

  // ---- Handler registration ----
  function onMessage(h)    { messageHandler = h; }
  function onConnect(h)    { connectHandler = h; }
  function onDisconnect(h) { disconnectHandler = h; }
  function onReconnect(h)  { reconnectHandler = h; }
  function onPaused(h)     { pausedHandler = h; }
  function onResumed(h)    { resumedHandler = h; }

  // ---- Accessors ----
  function isHost()          { return _isHost; }
  function isConnected()     { return ws && ws.readyState === WebSocket.OPEN; }
  function isReconnecting()  { return false; }
  function getRoomCode()     { return roomCode; }
  function getMyPeerId()     { return myPeerId; }
  function getGuestIds()     { return []; } // server owns the peer list now
  function getWsUrl()        { return WS_URL; }

  return {
    createRoom: createRoom,
    joinRoom: joinRoom,
    send: send,
    broadcast: broadcast,
    disconnect: disconnect,
    kickGuest: kickGuest,
    onMessage: onMessage,
    onConnect: onConnect,
    onDisconnect: onDisconnect,
    onReconnect: onReconnect,
    onPaused: onPaused,
    onResumed: onResumed,
    isHost: isHost,
    isConnected: isConnected,
    isReconnecting: isReconnecting,
    getRoomCode: getRoomCode,
    getMyPeerId: getMyPeerId,
    getGuestIds: getGuestIds,
    getWsUrl: getWsUrl
  };
})();

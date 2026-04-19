/* ============================================================
   30 - Save/Load System
   localStorage persistence
   ============================================================ */

var SaveSystem = (function () {
  'use strict';

  var SAVE_KEY = 'thirty_game_save';
  var SETUP_KEY = 'thirty_setup';

  // ---- Game State Save/Load ----
  function saveGame() {
    try {
      var data = {
        version: 2,
        gameState: Game.serialize(),
        timestamp: Date.now()
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Save failed:', e);
    }
  }

  function loadGame() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      // Accept version 1 or 2 (game.js deserialize handles migration)
      if (data.version !== 1 && data.version !== 2) return null;
      return data;
    } catch (e) {
      console.warn('Load failed:', e);
      return null;
    }
  }

  function hasSave() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      return data && (data.version === 1 || data.version === 2) && data.gameState && data.gameState.roundPhase !== 'idle';
    } catch (e) {
      return false;
    }
  }

  function clearSave() {
    localStorage.removeItem(SAVE_KEY);
  }

  function getSaveTimestamp() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      return data.timestamp || null;
    } catch (e) {
      return null;
    }
  }

  // ---- Setup Config Save/Load ----
  function saveSetup(config) {
    try {
      localStorage.setItem(SETUP_KEY, JSON.stringify(config));
    } catch (e) {
      console.warn('Setup save failed:', e);
    }
  }

  function loadSetup() {
    try {
      var raw = localStorage.getItem(SETUP_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  // ---- Time Ago Helper ----
  function timeAgo(timestamp) {
    if (!timestamp) return '';
    var diff = Date.now() - timestamp;
    var minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return minutes + ' min ago';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.floor(hours / 24);
    return days + 'd ago';
  }

  return {
    saveGame: saveGame,
    loadGame: loadGame,
    hasSave: hasSave,
    clearSave: clearSave,
    getSaveTimestamp: getSaveTimestamp,
    saveSetup: saveSetup,
    loadSetup: loadSetup,
    timeAgo: timeAgo
  };
})();

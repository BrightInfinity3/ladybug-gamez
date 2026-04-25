/* ============================================================
   Solitairra - Save/Load System
   localStorage persistence for solitaire game state
   ============================================================ */

var SaveSystem = (function () {
  'use strict';

  var SAVE_KEY = 'solitairra_game_save';
  var PREFS_KEY = 'solitairra_suit_prefs';

  function saveGame() {
    try {
      var data = {
        version: 1,
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
      if (data.version !== 1) return null;
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
      return data && data.version === 1 && data.gameState && !data.gameState.gameOver;
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

  function saveSuitPrefs(prefs) {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (e) {
      console.warn('Suit prefs save failed:', e);
    }
  }

  function loadSuitPrefs() {
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  // ---- Leaderboard (Server-side with localStorage fallback) ----
  var LEADERBOARD_KEY = 'solitairra_leaderboard';
  var LEADERBOARD_MAX = 60;
  var API_BASE = '/api/solitairra/leaderboard';

  // Cache of last known leaderboard data
  var leaderboardCache = [];

  function sortBoard(board) {
    board.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (a.moves !== b.moves) return a.moves - b.moves;
      return b.timestamp - a.timestamp;
    });
    return board;
  }

  function getLocalLeaderboard() {
    try {
      var raw = localStorage.getItem(LEADERBOARD_KEY);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch (e) {
      return [];
    }
  }

  function saveLocalLeaderboard(board) {
    try {
      localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(board));
    } catch (e) { /* ignore */ }
  }

  // Fetch leaderboard from server, fall back to localStorage
  function getLeaderboard(callback) {
    fetch(API_BASE)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        leaderboardCache = data;
        saveLocalLeaderboard(data); // sync local cache
        if (callback) callback(data);
      })
      .catch(function () {
        // Fallback to localStorage
        var local = getLocalLeaderboard();
        leaderboardCache = local;
        if (callback) callback(local);
      });
  }

  // Submit score to server, fall back to localStorage
  function addLeaderboardEntry(name, score, moves, callback) {
    fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, score: score, moves: moves })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.leaderboard) {
          leaderboardCache = data.leaderboard;
          saveLocalLeaderboard(data.leaderboard);
        }
        if (callback) callback(true);
      })
      .catch(function () {
        // Fallback: save locally
        var board = getLocalLeaderboard();
        board.push({
          name: name,
          score: score,
          moves: moves,
          timestamp: Date.now()
        });
        sortBoard(board);
        saveLocalLeaderboard(board);
        leaderboardCache = board;
        if (callback) callback(true);
      });
  }

  // Synchronous getter for cached data (used by populateLeaderboard after async fetch)
  function getCachedLeaderboard() {
    return leaderboardCache;
  }

  return {
    saveGame: saveGame,
    loadGame: loadGame,
    hasSave: hasSave,
    clearSave: clearSave,
    getSaveTimestamp: getSaveTimestamp,
    timeAgo: timeAgo,
    saveSuitPrefs: saveSuitPrefs,
    loadSuitPrefs: loadSuitPrefs,
    getLeaderboard: getLeaderboard,
    addLeaderboardEntry: addLeaderboardEntry,
    getCachedLeaderboard: getCachedLeaderboard,
    LEADERBOARD_MAX: LEADERBOARD_MAX
  };
})();

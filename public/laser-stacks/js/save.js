/* ============================================================
   Laser Stacks - Save/Load System
   localStorage persistence
   ============================================================ */

var SaveSystem = (function () {
  'use strict';

  var SAVE_KEY = 'laser_stacks_save';
  var SETUP_KEY = 'laser_stacks_setup';
  var OPTIONS_KEY = 'laser_stacks_options';
  var DEFAULT_OPTIONS = { suitStyle: 'classic' };

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
      return data && data.version === 1 && data.gameState && data.gameState.roundPhase !== 'idle';
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

  function getOptions() {
    try {
      var raw = localStorage.getItem(OPTIONS_KEY);
      if (!raw) return Object.assign({}, DEFAULT_OPTIONS);
      var parsed = JSON.parse(raw);
      return Object.assign({}, DEFAULT_OPTIONS, parsed);
    } catch (e) {
      return Object.assign({}, DEFAULT_OPTIONS);
    }
  }

  function setOptions(updates) {
    try {
      var merged = Object.assign({}, getOptions(), updates || {});
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(merged));
      return merged;
    } catch (e) {
      console.warn('Options save failed:', e);
      return getOptions();
    }
  }

  function getSuitStyle() {
    var s = getOptions().suitStyle;
    return s === 'laser' ? 'laser' : 'classic';
  }

  function setSuitStyle(style) {
    setOptions({ suitStyle: style === 'laser' ? 'laser' : 'classic' });
  }

  return {
    saveGame: saveGame,
    loadGame: loadGame,
    hasSave: hasSave,
    clearSave: clearSave,
    getSaveTimestamp: getSaveTimestamp,
    saveSetup: saveSetup,
    loadSetup: loadSetup,
    timeAgo: timeAgo,
    getOptions: getOptions,
    setOptions: setOptions,
    getSuitStyle: getSuitStyle,
    setSuitStyle: setSuitStyle
  };
})();

/* ============================================================
   Laser Stacks - Persistence
   localStorage for the setup-screen memory and options.
   (No mid-game save/resume — rounds are quick; MK removed the
   Continue feature in the 2026-07 round-2 refinements.)
   ============================================================ */

var SaveSystem = (function () {
  'use strict';

  var SETUP_KEY = 'laser_stacks_setup';
  var OPTIONS_KEY = 'laser_stacks_options';
  var DEFAULT_OPTIONS = { suitStyle: 'laser' };

  // ---- Setup memory (last table: characters, names, human/AI) ----
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

  // ---- Options ----
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
    return (s === 'classic' || s === 'laser' || s === 'animals') ? s : 'laser';
  }

  function setSuitStyle(style) {
    var s = (style === 'classic' || style === 'animals') ? style : 'laser';
    setOptions({ suitStyle: s });
  }

  return {
    saveSetup: saveSetup,
    loadSetup: loadSetup,
    getOptions: getOptions,
    setOptions: setOptions,
    getSuitStyle: getSuitStyle,
    setSuitStyle: setSuitStyle
  };
})();

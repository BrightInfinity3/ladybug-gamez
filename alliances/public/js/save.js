/*
 * Save — localStorage persistence for Alliances.
 * Two keys only:
 *   'alliances.session' — {roomCode, token, seat, name}; presence of this means
 *     "I belong to a war room" and net.js auto-rejoins with it on every socket open.
 *     This IS the game's save/load system: refresh, crash, redeploy — you come back.
 *   'alliances.prefs'   — {name, soundOn, battleSpeed, quickAttack}; cosmetic
 *     preferences that survive across rooms.
 * Everything is wrapped in try/catch because localStorage can be unavailable
 * (private browsing, storage quota) and the game must still run without it.
 */
(function () {
  "use strict";

  var SESSION_KEY = "alliances.session";
  var PREFS_KEY = "alliances.prefs";

  var DEFAULT_PREFS = {
    name: "",
    soundOn: true,
    battleSpeed: "cinematic", // 'cinematic' | 'brisk' | 'instant'
    quickAttack: false        // true = skip the attack confirm tooltip
  };

  function read(key) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function write(key, value) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* storage unavailable — play on without saving */ }
  }

  var Save = {
    // --- Session (room membership) ---
    session: function () {
      var s = read(SESSION_KEY);
      // A session without a roomCode+token can never rejoin — treat as absent.
      return (s && s.roomCode && s.token) ? s : null;
    },

    setSession: function (s) {
      if (!s || !s.roomCode || !s.token) return;
      write(SESSION_KEY, {
        roomCode: s.roomCode,
        token: s.token,
        seat: s.seat,
        name: s.name || ""
      });
    },

    clearSession: function () {
      write(SESSION_KEY, null);
    },

    // --- Preferences ---
    prefs: function () {
      var stored = read(PREFS_KEY) || {};
      var out = {};
      for (var k in DEFAULT_PREFS) {
        out[k] = (k in stored) ? stored[k] : DEFAULT_PREFS[k];
      }
      return out;
    },

    patchPrefs: function (patch) {
      var p = Save.prefs();
      if (patch) {
        for (var k in patch) {
          if (k in DEFAULT_PREFS) p[k] = patch[k];
        }
      }
      write(PREFS_KEY, p);
      return p;
    }
  };

  window.Save = Save;
})();

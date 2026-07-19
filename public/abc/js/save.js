/* ============================================================
   Animal Battle Champions - Save (window.Save)
   localStorage persistence, key 'abc_save_v1', versioned.
   Defensive: parse failures / private-mode storage errors fall
   back to a purely in-memory save (the game still runs; it just
   forgets on refresh).

   PUBLIC API
     Save.data                     live save object (mutate + persist())
     Save.load()                   (re)load from localStorage -> Save.data
     Save.persist()                write Save.data; false if storage failed
     Save.patch(partial)           shallow-merge top-level keys + persist
     Save.isUnlocked(animalId)     true when settings.unlockMode === false
                                   (the "all 24" toggle), else membership
                                   in unlockedAnimals
     Save.unlockAnimal(id)         add to unlockedAnimals; true if new
     Save.recordVictory(mode, bossId, {flawless, rounds})
                                   mode 'solo': advances ladder, pushes
                                   restoredBosses/flawlessRungs;
                                   any other mode: co-op record. Both
                                   unlock the boss's animal and bump
                                   stats. Returns {newlyUnlocked}.
     Save.reset()                  wipe back to defaults + persist
   Migration guard: on version mismatch (or partial/corrupt data),
   keep whatever parses shape-correctly, defaults for the rest.
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'abc_save_v1';
  var VERSION = 1;

  function starterAnimals() {
    if (typeof window !== 'undefined' && window.GameData && window.GameData.STARTER_ANIMALS) {
      return window.GameData.STARTER_ANIMALS.slice();
    }
    return [];
  }

  function defaults() {
    return {
      v: VERSION,
      playerName: '',
      settings: {
        sfx: true,
        reduceMotion: false,
        hideAllyPicks: false,
        unlockMode: true,      // true = animals must be freed; false = all 24
        seenRpsHint: false     // RPS hint sheet auto-opens once ever
      },
      ladder: {
        highestRungCleared: 0,
        restoredBosses: [],
        flawlessRungs: []
      },
      currentRun: null,
      unlockedAnimals: starterAnimals(),
      partyPreset: null,
      stats: { runsStarted: 0, bossKills: {}, totalRounds: 0 },
      coop: { wins: 0, bossesBeaten: [] }
    };
  }

  function isPlainObj(x) {
    return !!x && typeof x === 'object' && Object.prototype.toString.call(x) === '[object Object]';
  }

  // Recursively fill `base` (a fresh defaults tree) with same-shaped values
  // from `src`. Anything missing or shape-wrong keeps the default.
  function mergeInto(base, src) {
    if (!isPlainObj(src)) { return base; }
    for (var k in base) {
      if (!Object.prototype.hasOwnProperty.call(base, k)) { continue; }
      if (!Object.prototype.hasOwnProperty.call(src, k)) { continue; }
      var d = base[k];
      var s = src[k];
      if (d instanceof Array) {
        if (s instanceof Array) { base[k] = s.slice(); }
      } else if (isPlainObj(d)) {
        if (Object.keys(d).length === 0) {
          // open maps (e.g. stats.bossKills): restore wholesale
          if (isPlainObj(s)) { base[k] = s; }
        } else {
          base[k] = mergeInto(d, s);
        }
      } else if (d === null) {
        base[k] = s; // nullable slots (currentRun, partyPreset) accept anything
      } else if (typeof s === typeof d) {
        base[k] = s;
      }
    }
    return base;
  }

  // Post-merge invariants: a shape-valid but poisonous save (e.g.
  // unlockedAnimals:[] or highestRungCleared:NaN) must not soft-brick
  // the game (nothing selectable / no FIGHT rung anywhere).
  function sanitize(data) {
    var starters = starterAnimals();
    for (var i = 0; i < starters.length; i++) {
      if (data.unlockedAnimals.indexOf(starters[i]) === -1) {
        data.unlockedAnimals.push(starters[i]);
      }
    }
    var maxRung = 8;
    if (typeof window !== 'undefined' && window.GameData && window.GameData.BOSSES) {
      maxRung = window.GameData.BOSSES.length;
    }
    var h = data.ladder.highestRungCleared;
    if (typeof h !== 'number' || !isFinite(h)) { h = 0; }
    data.ladder.highestRungCleared = Math.max(0, Math.min(maxRung, Math.floor(h)));
    return data;
  }

  function load() {
    var parsed = null;
    try {
      var raw = window.localStorage.getItem(KEY);
      if (raw) { parsed = JSON.parse(raw); }
    } catch (e) {
      parsed = null; // private mode / corrupt JSON -> defaults, in-memory
    }
    var data = defaults();
    if (parsed) {
      // Version mismatch guard: same merge path - keep what parses,
      // defaults for the rest, then stamp the current version.
      data = mergeInto(data, parsed);
    }
    data.v = VERSION;
    sanitize(data);
    api.data = data;
    return data;
  }

  function persist() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(api.data));
      return true;
    } catch (e) {
      return false; // in-memory only (private mode / quota) - keep playing
    }
  }

  function patch(partial) {
    if (isPlainObj(partial)) {
      for (var k in partial) {
        if (Object.prototype.hasOwnProperty.call(partial, k)) {
          api.data[k] = partial[k];
        }
      }
    }
    persist();
    return api.data;
  }

  function isUnlocked(animalId) {
    if (api.data.settings.unlockMode === false) { return true; }
    return api.data.unlockedAnimals.indexOf(animalId) !== -1;
  }

  function unlockAnimal(animalId) {
    if (!animalId) { return false; }
    if (api.data.unlockedAnimals.indexOf(animalId) !== -1) { return false; }
    api.data.unlockedAnimals.push(animalId);
    persist();
    return true;
  }

  function recordVictory(mode, bossId, info) {
    info = info || {};
    var newlyUnlocked = false;
    var boss = (window.GameData && window.GameData.bossById) ? window.GameData.bossById(bossId) : null;
    if (boss) {
      if (mode === 'solo') {
        if (boss.rung > api.data.ladder.highestRungCleared) {
          api.data.ladder.highestRungCleared = boss.rung;
        }
        if (api.data.ladder.restoredBosses.indexOf(bossId) === -1) {
          api.data.ladder.restoredBosses.push(bossId);
        }
        if (info.flawless && api.data.ladder.flawlessRungs.indexOf(boss.rung) === -1) {
          api.data.ladder.flawlessRungs.push(boss.rung);
        }
      } else {
        api.data.coop.wins += 1;
        if (api.data.coop.bossesBeaten.indexOf(bossId) === -1) {
          api.data.coop.bossesBeaten.push(bossId);
        }
      }
      newlyUnlocked = unlockAnimal(boss.animal);
      api.data.stats.bossKills[bossId] = (api.data.stats.bossKills[bossId] || 0) + 1;
    }
    if (typeof info.rounds === 'number') {
      api.data.stats.totalRounds += info.rounds;
    }
    persist();
    return { newlyUnlocked: newlyUnlocked };
  }

  function reset() {
    try { window.localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    api.data = defaults();
    persist();
    return api.data;
  }

  var api = {
    data: null,
    load: load,
    persist: persist,
    patch: patch,
    isUnlocked: isUnlocked,
    unlockAnimal: unlockAnimal,
    recordVictory: recordVictory,
    reset: reset
  };

  load();

  window.Save = api;
})();

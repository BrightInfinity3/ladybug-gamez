/* ============================================================
   Animal Battle Champions - Companion AI (AI friend parties)
   Decent-not-optimal by design: scores attack/special/defense from a
   history-based prediction of the boss's category (plus the visible
   charge telegraph), then blunders to the second-best pick with
   probability GameData.TUNING.COMPANION_BLUNDER. Foresight reveals are
   a Flow-layer concern and are NOT visible here.

   UMD: node `module.exports` / browser `window.CompanionAI`.

   API:
     CompanionAI.chooseIntent(battle, seat, rng)  -> intent
     CompanionAI.chooseSwitchIn(battle, seat, rng) -> slot
     CompanionAI.draftParty(unlockedIds, takenTeams, rng) -> [3 ids]
   ============================================================ */
(function (exports) {
  'use strict';

  var GameData = (typeof module !== 'undefined' && module.exports)
    ? require('./gameData.js')
    : window.GameData;
  var TU = GameData.TUNING;
  var CATS = ['attack', 'defense', 'special'];

  function partyBySeat(battle, seat) {
    for (var i = 0; i < battle.parties.length; i++) {
      if (battle.parties[i].seat === seat) { return battle.parties[i]; }
    }
    return null;
  }

  function deployed(battle) {
    var out = [];
    battle.parties.forEach(function (p) {
      var act = p.animals[p.activeIndex];
      if (act && !act.fainted && act.hp > 0) { out.push({ seat: p.seat, ent: act }); }
    });
    return out;
  }

  // Predicted boss category distribution: history frequency (Laplace)
  // plus the openly visible charge telegraph.
  function predictBossCat(battle) {
    if (battle.boss.charging) { return { attack: 0, defense: 0, special: 1 }; }
    var counts = { attack: 1, defense: 1, special: 1 };
    battle.history.forEach(function (h) {
      if (counts[h.bossCat] != null) { counts[h.bossCat]++; }
    });
    var n = battle.history.length + 3;
    return { attack: counts.attack / n, defense: counts.defense / n, special: counts.special / n };
  }

  function bossDefOf(battle) { return GameData.bossById(battle.boss.id); }

  // Rough expected damage of a damaging move vs the boss, given the
  // boss's predicted category distribution.
  function estMoveDamage(battle, ent, move, moveCat, pred) {
    var bd = bossDefOf(battle);
    var boss = battle.boss;
    var basePower = move.power || (move.hits ? move.power * move.hits : 0);
    if (move.hits) { basePower = move.power * move.hits; }
    if (move.echoLastBossDamage) {
      basePower = 0; // handled as flat below
    }
    var atkStat = move.useStat === 'def' ? ent.def : ent.atk;
    var ev = 0;
    CATS.forEach(function (bc) {
      var p = pred[bc];
      if (p <= 0) { return; }
      var mult = (GameData.MATCHUP[moveCat] && GameData.MATCHUP[moveCat][bc] != null)
        ? GameData.MATCHUP[moveCat][bc] : 1;
      var dmg;
      if (move.echoLastBossDamage) {
        dmg = Math.min(move.cap, battle.lastRound.bossDamageDealt || 0) * mult;
      } else {
        dmg = (atkStat / boss.def) * basePower * 0.5 * mult * 0.925;
      }
      if (bc === 'defense' && bd.moves.defense) {
        var dm = bd.moves.defense;
        if (moveCat === 'attack' && dm.block) { dmg = 0; }
        if (dm.evade) {
          var evc = dm.evade * (moveCat === 'special' ? TU.EVADE_VS_SPECIAL : 1);
          dmg *= (1 - evc / 100);
        }
      }
      var accP = move.acc != null ? Math.min(move.acc, 100) / 100 : 1;
      ev += p * dmg * accP;
    });
    if (bd.twistFx && bd.twistFx.singleHitCap != null && !move.hits) {
      ev = Math.min(ev, bd.twistFx.singleHitCap);
    }
    return ev;
  }

  // Rough expected boss damage TO this animal next round.
  function estThreatToSelf(battle, seat, ent, pred) {
    var bd = bossDefOf(battle);
    var boss = battle.boss;
    var dep = deployed(battle);
    // probability this animal is the boss's target
    var targetedP;
    var taunter = dep.filter(function (d) { return d.ent.tauntTurns > 0; });
    if (bd.twistFx && bd.twistFx.alwaysTargetLowest) {
      // twist lock beats taunt (mirrors engine.pickBossTarget precedence)
      var lowest = dep[0];
      dep.forEach(function (d) { if (d.ent.hp < lowest.ent.hp) { lowest = d; } });
      targetedP = lowest.seat === seat ? 0.95 : 0.05;
    } else if (taunter.length > 0) {
      targetedP = taunter.some(function (d) { return d.seat === seat; }) ? 1 : 0.05;
    } else {
      targetedP = dep.length > 0 ? 1 / dep.length : 1;
    }
    var threat = 0;
    ['attack', 'special'].forEach(function (bc) {
      var m = boss.charging ? bd.moves.special : bd.moves[bc];
      var power = boss.charging ? boss.charging.power : (m.power || 0);
      if (m.hits) { power = power * m.hits; }
      var perTarget = m.aoe ? 1 : targetedP;
      var dmg = (boss.atk / ent.def) * power * 0.5 * 1.0 * 0.925;
      threat += pred[bc] * dmg * perTarget;
    });
    return threat;
  }

  function teamHurtAmount(battle) {
    var missing = 0;
    deployed(battle).forEach(function (d) { missing += d.ent.maxHp - d.ent.hp; });
    return missing;
  }

  function anyoneFainted(battle) {
    var n = 0;
    battle.parties.forEach(function (p) {
      p.animals.forEach(function (a) { if (a.fainted) { n++; } });
    });
    return n;
  }

  function scoreSpecial(battle, seat, ent, move, pred) {
    if (ent.cooldowns.special > 0) { return -Infinity; }
    // damaging specials: expected damage
    if (move.power != null || move.hits || move.echoLastBossDamage || move.roulette) {
      if (move.roulette) { return 25; } // wildcard: solid average value
      var s = estMoveDamage(battle, ent, move, 'special', pred);
      if (move.dot) { s += move.dot.dmg * move.dot.turns * 0.8; }
      if (move.debuff) { s += 10; }
      if (move.lifesteal && ent.hp < ent.maxHp * 0.8) { s += 8; }
      if (move.recoil) { s -= move.recoil * 0.5; }
      if (move.chargeTurns) { s *= 0.85; } // pays a round of setup
      return s;
    }
    if (move.revivePct != null) {
      if (!ent.usedOncePerBattle[move.name] && anyoneFainted(battle) > 0) { return 90; }
      return teamHurtAmount(battle) > 40 ? 12 : 2;
    }
    if (move.heal != null || move.regen) {
      var hpPct = ent.hp / ent.maxHp;
      if (hpPct < 0.6) { return 30 + (0.6 - hpPct) * 80; }
      return 2;
    }
    if (move.healAll != null) {
      var hurt = teamHurtAmount(battle);
      return hurt > 30 ? 20 + Math.min(30, hurt / 4) : 3;
    }
    if (move.dot || move.debuff) { // status throws (poison / ink)
      var already = move.dot && battle.boss.dots.some(function (d) { return d.source === move.name; });
      return already ? 4 : 26;
    }
    if (move.buffAll || move.buffSelf || move.luckBuff) {
      return battle.round <= 2 ? 28 : 12;
    }
    if (move.shieldAll != null) { return battle.round <= 2 ? 24 : 14; }
    if (move.taunt) {
      var fragileAlly = deployed(battle).some(function (d) {
        return d.seat !== seat && d.ent.hp < d.ent.maxHp * 0.5;
      });
      return fragileAlly ? 30 : 10;
    }
    if (move.untargetable) { return ent.hp < ent.maxHp * 0.4 ? 32 : 8; }
    if (move.revealBossNext) { return 15; }
    return 10;
  }

  function chooseIntent(battle, seat, rng) {
    var party = partyBySeat(battle, seat);
    var ent = party.animals[party.activeIndex];
    if (ent.charging) { return { kind: 'move', cat: 'special' }; }
    var moves = GameData.MOVES[ent.id];
    var pred = predictBossCat(battle);

    var scores = [
      { cat: 'attack', score: estMoveDamage(battle, ent, moves.attack, 'attack', pred) },
      { cat: 'special', score: scoreSpecial(battle, seat, ent, moves.special, pred) },
      { cat: 'defense', score: (function () {
          var threat = estThreatToSelf(battle, seat, ent, pred);
          var dm = moves.defense;
          var mitigation = dm.block ? 0.9 : (dm.evade ? dm.evade / 100 : 0.5);
          var s = threat * mitigation * 1.15;
          if (dm.teamGuard) { s += 6; }
          if (dm.heal) { s += Math.min(dm.heal, ent.maxHp - ent.hp) * 0.5; }
          return s;
        })() }
    ];
    scores.sort(function (a, b) { return b.score - a.score; });
    var pick = scores[0];
    if (scores[1].score > -Infinity && rng() < TU.COMPANION_BLUNDER) {
      pick = scores[1]; // deliberate second-best blunder
    }
    return { kind: 'move', cat: pick.cat };
  }

  function chooseSwitchIn(battle, seat, rng) {
    var party = partyBySeat(battle, seat);
    var options = [];
    for (var s = 0; s < party.animals.length; s++) {
      if (s !== party.activeIndex && !party.animals[s].fainted) { options.push(s); }
    }
    if (options.length === 0) {
      // engine only asks when a bench exists; fall back defensively
      return party.activeIndex;
    }
    if (options.length === 1) { return options[0]; }
    var pickBy = function (fn) {
      var best = options[0], bestV = -Infinity;
      options.forEach(function (o) {
        var v = fn(party.animals[o]);
        if (v > bestV) { bestV = v; best = o; }
      });
      return best;
    };
    // under a visible telegraph: send the tankiest
    if (battle.boss.charging) { return pickBy(function (a) { return a.def; }); }
    // if the team lacks a living healer, prefer a SUPPORT
    var hasHealer = false;
    deployed(battle).forEach(function (d) {
      var sp = GameData.MOVES[d.ent.id].special;
      if (sp.heal != null || sp.healAll != null || sp.revivePct != null) { hasHealer = true; }
    });
    if (!hasHealer) {
      var supports = options.filter(function (o) {
        return GameData.ANIMALS[party.animals[o].id].archetype === 'SUPPORT';
      });
      if (supports.length > 0) { return supports[Math.floor(rng() * supports.length)]; }
    }
    // else: highest current HP
    return pickBy(function (a) { return a.hp; });
  }

  function draftParty(unlockedIds, takenTeams, rng) {
    var taken = {};
    (takenTeams || []).forEach(function (team) {
      (team || []).forEach(function (id) { taken[id] = true; });
    });
    var groups = [
      ['TANK', 'BRUISER'],
      ['CANNON', 'SPEEDSTER'],
      ['SUPPORT']
    ];
    var picked = [];
    groups.forEach(function (archs) {
      var pool = unlockedIds.filter(function (id) {
        return picked.indexOf(id) === -1 &&
          archs.indexOf(GameData.ANIMALS[id].archetype) !== -1;
      });
      var fresh = pool.filter(function (id) { return !taken[id]; });
      var from = fresh.length > 0 ? fresh : pool;
      if (from.length === 0) {
        // no archetype match unlocked: any unpicked animal
        from = unlockedIds.filter(function (id) { return picked.indexOf(id) === -1; });
      }
      picked.push(from[Math.floor(rng() * from.length)]);
    });
    return picked;
  }

  exports.chooseIntent = chooseIntent;
  exports.chooseSwitchIn = chooseSwitchIn;
  exports.draftParty = draftParty;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.CompanionAI = {}));
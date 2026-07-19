/* ============================================================
   Animal Battle Champions - Boss AI
   Pure function of the PUBLIC battle state: history (past picks,
   past boss categories), hp, and visible statuses. Current-round
   player intents never exist in state, so the boss is blind by
   construction. Escalation is smarter-not-cheating.

   UMD: node `module.exports` / browser `window.BossAI`.

   API:
     BossAI.chooseIntent(battle, rng)
       -> { cat, targetRule, aoeMode?, moveNote? }
   ============================================================ */
(function (exports) {
  'use strict';

  var GameData = (typeof module !== 'undefined' && module.exports)
    ? require('./gameData.js')
    : window.GameData;

  var CATS = ['attack', 'defense', 'special'];

  // PAYOFF[bossCat][playerCat]: beats +2, tie +1, loses -1.
  // Boss beats: attack>special, special>defense, defense>attack.
  function payoff(bossCat, playerCat) {
    if (bossCat === playerCat) { return 1; }
    if ((bossCat === 'attack' && playerCat === 'special') ||
        (bossCat === 'special' && playerCat === 'defense') ||
        (bossCat === 'defense' && playerCat === 'attack')) { return 2; }
    return -1;
  }

  // What a player would pick to beat `bossCat` (player beats:
  // attack>special, special>defense, defense>attack).
  function playerCounterOf(bossCat) {
    if (bossCat === 'attack') { return 'defense'; }
    if (bossCat === 'special') { return 'attack'; }
    return 'special';
  }

  function livingSeats(battle) {
    var out = [];
    battle.parties.forEach(function (p) {
      var act = p.animals[p.activeIndex];
      if (act && !act.fainted && act.hp > 0) { out.push(p.seat); }
    });
    return out;
  }

  function seatPicks(battle, seat, windowRounds) {
    var hist = battle.history;
    var start = windowRounds ? Math.max(0, hist.length - windowRounds) : 0;
    var out = [];
    for (var i = start; i < hist.length; i++) {
      var pk = hist[i].picks[seat];
      if (pk === 'attack' || pk === 'defense' || pk === 'special') { out.push(pk); }
    }
    return out;
  }

  // Laplace-smoothed category frequency distribution for one seat.
  function freqDist(battle, seat, windowRounds) {
    var picks = seatPicks(battle, seat, windowRounds);
    var counts = { attack: 1, defense: 1, special: 1 };
    picks.forEach(function (pk) { counts[pk]++; });
    var n = picks.length + 3;
    return { attack: counts.attack / n, defense: counts.defense / n, special: counts.special / n };
  }

  // Laplace-smoothed first-order Markov prediction for one seat.
  function markovDist(battle, seat) {
    var picks = seatPicks(battle, seat, 0);
    if (picks.length < 1) { return { attack: 1 / 3, defense: 1 / 3, special: 1 / 3 }; }
    var trans = {};
    CATS.forEach(function (a) {
      trans[a] = { attack: 1, defense: 1, special: 1 };
    });
    for (var i = 0; i + 1 < picks.length; i++) {
      trans[picks[i]][picks[i + 1]]++;
    }
    var last = picks[picks.length - 1];
    var row = trans[last];
    var n = row.attack + row.defense + row.special;
    return { attack: row.attack / n, defense: row.defense / n, special: row.special / n };
  }

  // Expected-value best response against per-seat predicted distributions.
  function bestResponse(distsBySeat, rng) {
    var seats = Object.keys(distsBySeat);
    var best = [], bestEv = -Infinity;
    CATS.forEach(function (bc) {
      var ev = 0;
      seats.forEach(function (s) {
        var dist = distsBySeat[s];
        CATS.forEach(function (pc) { ev += dist[pc] * payoff(bc, pc); });
      });
      if (ev > bestEv + 1e-9) { bestEv = ev; best = [bc]; }
      else if (Math.abs(ev - bestEv) <= 1e-9) { best.push(bc); }
    });
    return best.length === 1 ? best[0] : best[Math.floor(rng() * best.length)];
  }

  function weightedCat(weights, rng) {
    var u = rng(), acc = 0, cat = 'attack';
    for (var i = 0; i < CATS.length; i++) {
      var w = weights[CATS[i]] || 0;
      acc += w;
      if (u < acc) { cat = CATS[i]; break; }
      cat = CATS[i];
    }
    return cat;
  }

  function damageTakenLastRound(battle) {
    return (battle.boss.lastRound && battle.boss.lastRound.damageTaken) || 0;
  }

  // PATTERN loop position, reconstructed from public history (a defend
  // inserted by the hurt-check pauses the loop; charge/release both show
  // as 'special' in history and match their loop steps).
  function patternPos(battle, loop) {
    var pos = 0;
    for (var i = 0; i < battle.history.length; i++) {
      var bc = battle.history[i].bossCat;
      var expected = loop[pos % loop.length];
      var expCat = (expected === 'charge' || expected === 'release') ? 'special' : expected;
      if (bc === expCat) { pos++; }
      // else: an inserted defend (or fizzle) - loop position holds
    }
    return pos % loop.length;
  }

  function chooseIntent(battle, rng) {
    var bd = GameData.bossById(battle.boss.id);
    var ai = bd.ai;
    var rule = ai.targetRule || 'random';
    var boss = battle.boss;

    // A committed charge always releases; the engine forces it anyway.
    if (boss.charging) {
      return { cat: 'special', targetRule: rule, moveNote: 'release' };
    }

    var seats = livingSeats(battle);
    var intent = { cat: 'attack', targetRule: rule };

    if (ai.profile === 'SCRAPPER') {
      intent.cat = weightedCat(ai.weights, rng);

    } else if (ai.profile === 'PATTERN') {
      var pos = patternPos(battle, ai.loop);
      var step = ai.loop[pos];
      if (step === 'release') { step = 'charge'; } // desync guard: restart charge
      if (step === 'attack' &&
          damageTakenLastRound(battle) > ai.defendIfHurtPct * boss.maxHp) {
        intent.cat = 'defense';
        intent.moveNote = 'hurt-defend';
      } else if (step === 'charge') {
        intent.cat = 'special';
        intent.moveNote = 'charge';
      } else {
        intent.cat = step;
      }

    } else if (ai.profile === 'TRAPPER') {
      if (rng() < ai.bestResponseChance) {
        var dists = {};
        seats.forEach(function (s) { dists[s] = freqDist(battle, s, 0); });
        intent.cat = seats.length ? bestResponse(dists, rng) : 'attack';
      } else {
        intent.cat = 'special';
      }

    } else if (ai.profile === 'REACTIVE') {
      if (damageTakenLastRound(battle) > ai.hurtThresholdPct * boss.maxHp) {
        intent.cat = 'defense';
      } else {
        intent.cat = rng() < 0.65 ? 'attack' : 'special';
      }

    } else if (ai.profile === 'FREQUENCY') {
      var fdists = {};
      seats.forEach(function (s) { fdists[s] = freqDist(battle, s, ai.windowRounds); });
      intent.cat = seats.length ? bestResponse(fdists, rng) : 'attack';

    } else if (ai.profile === 'MOMENTUM') {
      var lr = battle.lastRound || {};
      if ((lr.bossDamageDealt || 0) >= ai.pressDamage) {
        intent.cat = 'attack'; intent.moveNote = 'press';
      } else if ((lr.partyHealing || 0) >= ai.punishHeal) {
        intent.cat = 'special'; intent.moveNote = 'punish-heal';
      } else {
        intent.cat = weightedCat({ attack: 0.45, special: 0.3, defense: 0.25 }, rng);
      }

    } else if (ai.profile === 'MARKOV') {
      var mdists = {};
      seats.forEach(function (s) { mdists[s] = markovDist(battle, s); });
      intent.cat = seats.length ? bestResponse(mdists, rng) : 'attack';

    } else if (ai.profile === 'ENSEMBLE') {
      var w = ai.weights;
      // level-2: players counter the boss's own modal past category, so
      // counter their counter.
      var bossCounts = { attack: 1, defense: 1, special: 1 };
      battle.history.forEach(function (h) {
        if (bossCounts[h.bossCat] != null) { bossCounts[h.bossCat]++; }
      });
      var modal = 'attack', mc = -1;
      CATS.forEach(function (c) { if (bossCounts[c] > mc) { mc = bossCounts[c]; modal = c; } });
      var predictedPlayer = playerCounterOf(modal);
      var edists = {};
      seats.forEach(function (s) {
        var f = freqDist(battle, s, 6);
        var m = markovDist(battle, s);
        var d = {};
        CATS.forEach(function (c) {
          d[c] = w.frequency * f[c] + w.markov * m[c] +
                 w.level2 * (c === predictedPlayer ? 1 : 0);
        });
        edists[s] = d;
      });
      intent.cat = seats.length ? bestResponse(edists, rng) : 'attack';
      if (boss.phase === 2 && ai.phase2BluffRate && rng() < ai.phase2BluffRate) {
        var others = CATS.filter(function (c) { return c !== intent.cat; });
        intent.cat = others[Math.floor(rng() * others.length)];
        intent.moveNote = 'bluff';
      }
      // Nevermore: swap the attack for its AoE wing when >=2 targets are
      // below 40% hp and the AoE is off cooldown.
      if (intent.cat === 'attack' && boss.aoeCooldown === 0) {
        var lowCount = 0;
        battle.parties.forEach(function (p) {
          var act = p.animals[p.activeIndex];
          if (act && !act.fainted && act.hp > 0 && act.hp < 0.4 * act.maxHp) { lowCount++; }
        });
        if (lowCount >= 2) { intent.aoeMode = true; }
      }
    }

    return intent;
  }

  exports.chooseIntent = chooseIntent;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.BossAI = {}));
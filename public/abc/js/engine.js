/* ============================================================
   Animal Battle Champions - Battle Engine (pure, deterministic)

   UMD: `module.exports` in node (tests), `window.Engine` in the
   browser. No DOM, no network, no Math.random - every random draw
   goes through the injected rng() (a function returning [0,1)).

   PUBLIC API:
     Engine.createBattle({ parties:[{seat,name,controller,team:[id x3]}],
                           bossId, rung }) -> battle
     Engine.legalOptions(battle, seat)
       -> { canAct, forced:null|'charge',
            cats:{attack,defense,special}, switchTo:[slots] }
     Engine.resolveRound(battle, intents, bossIntent, rng)
       -> { events, battle }        (input battle is NOT mutated)
     Engine.applyForcedSwitch(battle, seat, slot) -> { events, battle }
     Engine.publicSnapshot(battle) -> deep clone

   CANONICAL BATTLE EVENT SCHEMA (the contract the renderer and the
   network layer consume; side:'p'=player,'b'=boss; seat 0-2;
   slot 0-2 = index into that party's animals array; every event is
   self-contained enough to render without engine internals):

   {t:'round', n}
   {t:'switch', seat, from, to, voluntary}   player active-animal change
   {t:'deploy', seat, slot}                  KO replacement enters
   {t:'act', side, seat?, animal, moveName, cat, targetSide, targetSeat?}
                                             move announced
   {t:'charge', side, seat?, moveName}       telegraph round of a charge move
   {t:'hit', side, seat?, slot?, dmg, verb, shieldAbsorbed, hpAfter,
     shieldAfter}                            verb: 'CUT THROUGH!'|'PIERCED!'|
                                             'BLOCKED!'|'CLASH!'|''
                                             (GameData.CAT_VERBS)
   {t:'miss', side, seat?}                   the actor missed
   {t:'evade', side, seat?}                  the target evaded
   {t:'immune', side, seat?, why}            'untargetable'|'blocked'
   {t:'counter', side, seat?, dmg, hpAfter, kind}
                                             flat rider (counter|thorns|
                                             reflect) hitting side/seat
   {t:'heal', side, seat?, amount, hpAfter, source}
   {t:'shield', side, seat?, amount}
   {t:'buff'|'debuff', side, seat?, stat, pct?, flat?, turns, resisted?}
   {t:'dot', side, seat?, dmg, hpAfter, source}   end-of-round tick
   {t:'disrupt', side, seat?}
   {t:'stealBuff', name}
   {t:'taunt', seat, turns}
   {t:'untargetable', seat, turns}
   {t:'revive', seat, slot, hp}
   {t:'roulette', label}
   {t:'recoil', side, seat?, dmg, hpAfter}
   {t:'faint', side, seat?, slot?}
   {t:'needSwitch', seats}                   battle.phase -> 'awaitSwitch'
   {t:'partyDown', seat}
   {t:'bossPhase', name, desc}               enrage, Extinction Denied, ...
   {t:'foresightPending', seat}              engine marker; the Flow layer
                                             replaces it with
                                             {t:'foresight', cat} after
                                             committing the boss intent
   {t:'end', result}                         'victory'|'defeat'

   RNG DRAW ORDER (deterministic; tests rely on it):
     speed-order jitter draws only happen when two actors tie on
     effective SPD (one draw per actor, boss first then seats asc).
     Boss single-target action: [tauntResist?] -> [target rule pick?]
     -> per hit: [acc] -> [evade?] -> [damage roll].
     (The alwaysTargetLowest twist overrides taunt and picks
     deterministically - it draws nothing.)
     Player damaging move: [roulette branch?] -> per hit: [acc unless
     luckBuff] -> [boss evade?] -> [damage roll].
   ============================================================ */
(function (exports) {
  'use strict';

  var GameData = (typeof module !== 'undefined' && module.exports)
    ? require('./gameData.js')
    : window.GameData;
  var TU = GameData.TUNING;
  var MATCHUP = GameData.MATCHUP;
  var VERBS = GameData.CAT_VERBS;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // === construction ========================================================

  function makeAnimal(id) {
    var a = GameData.ANIMALS[id];
    if (!a) { throw new Error('createBattle: unknown animal ' + id); }
    return {
      id: id, hp: a.hp, maxHp: a.hp, atk: a.atk, def: a.def, spd: a.spd,
      fainted: false, shield: 0, shieldTurns: 0, dots: [], mods: [],
      cooldowns: { special: 0 }, charging: null, untargetableTurns: 0,
      tauntTurns: 0, healingHalvedTurns: 0, usedOncePerBattle: {},
      lastRound: { tookDamage: false }
    };
  }

  function createBattle(cfg) {
    var bossDef = GameData.bossById(cfg.bossId);
    if (!bossDef) { throw new Error('createBattle: unknown boss ' + cfg.bossId); }
    var parties = cfg.parties.map(function (p) {
      var seen = {};
      p.team.forEach(function (id) {
        if (seen[id]) { throw new Error('createBattle: duplicate ' + id + ' in party ' + p.seat); }
        seen[id] = true;
      });
      return {
        seat: p.seat, name: p.name, controller: p.controller,
        activeIndex: 0, animals: p.team.map(makeAnimal)
      };
    });
    return {
      v: 1, round: 1, phase: 'select',
      rung: (cfg.rung != null ? cfg.rung : bossDef.rung),
      parties: parties,
      boss: {
        id: bossDef.id, animal: bossDef.animal, name: bossDef.name,
        title: bossDef.title, hp: bossDef.stats.hp, maxHp: bossDef.stats.hp,
        atk: bossDef.stats.atk, def: bossDef.stats.def, spd: bossDef.stats.spd,
        phase: 1, enraged: false, shield: 0, shieldTurns: 0,
        mods: [], dots: [], charging: null,
        aoeCooldown: 0, lastRound: { damageTaken: 0, tookDamage: false }
      },
      pendingSwitchSeats: [],
      lastRound: { bossDamageDealt: 0, damageToBossBySeat: {}, partyHealing: 0, healingReceivedByBoss: 0 },
      history: []
    };
  }

  function partyBySeat(battle, seat) {
    for (var i = 0; i < battle.parties.length; i++) {
      if (battle.parties[i].seat === seat) { return battle.parties[i]; }
    }
    return null;
  }

  function legalOptions(battle, seat) {
    var res = { canAct: false, forced: null, cats: { attack: false, defense: false, special: false }, switchTo: [] };
    var party = partyBySeat(battle, seat);
    if (!party || battle.phase !== 'select') { return res; }
    var act = party.animals[party.activeIndex];
    if (!act || act.fainted) { return res; }
    res.canAct = true;
    for (var s = 0; s < party.animals.length; s++) {
      if (s !== party.activeIndex && !party.animals[s].fainted) { res.switchTo.push(s); }
    }
    if (act.charging) { res.forced = 'charge'; return res; }
    res.cats = { attack: true, defense: true, special: act.cooldowns.special === 0 };
    return res;
  }

  // === stat helpers ========================================================

  function netPct(ent, stat) {
    var s = 0, lim = TU.STAT_MOD_CLAMP * 100;
    for (var i = 0; i < ent.mods.length; i++) {
      var m = ent.mods[i];
      if (m.stat === stat && m.pct != null) { s += m.pct; }
    }
    if (s > lim) { s = lim; }
    if (s < -lim) { s = -lim; }
    return s;
  }

  function netFlat(ent, stat) {
    var s = 0;
    for (var i = 0; i < ent.mods.length; i++) {
      var m = ent.mods[i];
      if (m.stat === stat && m.flat != null) { s += m.flat; }
    }
    return s;
  }

  function effStat(R, ref, stat) {
    var ent = ref.ent;
    var v = ent[stat] * (1 + netPct(ent, stat) / 100);
    if (ref.side === 'b' && stat === 'atk' && ent.enraged &&
        R.bossDef.twistFx && R.bossDef.twistFx.enrageAtkPct) {
      v *= (1 + R.bossDef.twistFx.enrageAtkPct / 100);
    }
    return Math.max(1, v);
  }

  function clampAcc(a) {
    if (a < TU.ACC_MIN) { return TU.ACC_MIN; }
    if (a > TU.ACC_MAX) { return TU.ACC_MAX; }
    return a;
  }

  function luckMod(ent) {
    for (var i = 0; i < ent.mods.length; i++) {
      if (ent.mods[i].stat === 'luck') { return ent.mods[i]; }
    }
    return null;
  }

  function verbFor(moveCat, tgtCat, blocked) {
    if (moveCat === 'attack' && tgtCat === 'special') { return VERBS.attackBeatsSpecial; }
    if (moveCat === 'special' && tgtCat === 'defense') { return VERBS.specialBeatsDefense; }
    if (moveCat === 'attack' && tgtCat === 'defense') { return VERBS.defenseBeatsAttack; }
    if (moveCat === tgtCat) { return VERBS.clash; }
    return '';
  }

  // === refs & aggregates ===================================================

  function pRef(R, party) {
    var slot = party.activeIndex;
    var ent = party.animals[slot];
    var ctx = R.ctxs[party.seat];
    if (!ctx || ctx.ent !== ent) {
      ctx = { side: 'p', seat: party.seat, ent: ent, cat: 'none', move: null, specialDone: true, disrupted: false };
    }
    return { side: 'p', seat: party.seat, slot: slot, ent: ent, ctx: ctx, party: party };
  }

  function deployedRefs(R) {
    var out = [];
    for (var i = 0; i < R.b.parties.length; i++) {
      var ref = pRef(R, R.b.parties[i]);
      if (ref.ent && !ref.ent.fainted && ref.ent.hp > 0) { out.push(ref); }
    }
    return out;
  }

  function bossRef(R) {
    return { side: 'b', ent: R.b.boss, ctx: R.bossCtx };
  }

  function markTook(R, ref) {
    if (ref.side === 'p') {
      if (R.agg.tookEnts.indexOf(ref.ent) === -1) { R.agg.tookEnts.push(ref.ent); }
    }
  }

  // === core damage / effect primitives =====================================

  function faintPlayer(R, ref) {
    var ent = ref.ent;
    ent.fainted = true; ent.hp = 0; ent.shield = 0; ent.shieldTurns = 0;
    ent.dots = []; ent.mods = []; ent.charging = null; ent.tauntTurns = 0;
    ent.untargetableTurns = 0; ent.healingHalvedTurns = 0;
    R.ev.push({ t: 'faint', side: 'p', seat: ref.seat, slot: ref.slot });
    var party = partyBySeat(R.b, ref.seat);
    var living = party.animals.filter(function (a) { return !a.fainted; });
    if (living.length === 0) { R.ev.push({ t: 'partyDown', seat: ref.seat }); }
    var anyAlive = false;
    R.b.parties.forEach(function (p) {
      p.animals.forEach(function (a) { if (!a.fainted) { anyAlive = true; } });
    });
    if (!anyAlive) {
      R.b.phase = 'defeat';
      R.ev.push({ t: 'end', result: 'defeat' });
      R.ended = true;
    }
  }

  function bossZero(R) {
    var boss = R.b.boss, bd = R.bossDef;
    if (bd.phase2 && boss.phase === 1) {
      boss.phase = 2;
      boss.hp = bd.phase2.hp; boss.maxHp = bd.phase2.hp; boss.atk = bd.phase2.atk;
      boss.mods = boss.mods.filter(function (m) {
        return (m.pct == null || m.pct >= 0) && (m.flat == null || m.flat >= 0);
      });
      boss.dots = []; boss.charging = null;
      R.ev.push({ t: 'bossPhase', name: bd.phase2.name, desc: bd.twist });
    } else {
      boss.hp = 0;
      R.b.phase = 'victory';
      R.ev.push({ t: 'end', result: 'victory' });
      R.ended = true;
    }
  }

  function checkEnrage(R) {
    var boss = R.b.boss, tw = R.bossDef.twistFx || {};
    if (tw.enrageAt && !boss.enraged && boss.hp > 0 && boss.hp <= tw.enrageAt * boss.maxHp) {
      boss.enraged = true;
      R.ev.push({ t: 'bossPhase', name: 'Enraged', desc: R.bossDef.twist });
    }
  }

  // Flat rider damage (counter / thorns / reflect) at the given victim.
  function flatRider(R, victim, amount, kind) {
    amount = Math.min(amount, TU.FLAT_RIDER_CAP);
    if (amount <= 0) { return; }
    var ent = victim.ent;
    if (ent.untargetableTurns > 0) {
      R.ev.push({ t: 'immune', side: victim.side, seat: victim.seat, why: 'untargetable' });
      return;
    }
    if (victim.side === 'b' && R.bossDef.twistFx && R.bossDef.twistFx.singleHitCap != null) {
      amount = Math.min(amount, R.bossDef.twistFx.singleHitCap);
    }
    var abs = Math.min(ent.shield, amount);
    ent.shield -= abs;
    if (ent.shield <= 0) { ent.shield = 0; ent.shieldTurns = 0; }
    ent.hp = Math.max(0, ent.hp - (amount - abs));
    R.ev.push({ t: 'counter', side: victim.side, seat: victim.seat, dmg: amount, hpAfter: ent.hp, kind: kind });
    markTook(R, victim);
    if (victim.side === 'b') { R.agg.bossTaken += amount; }
    if (ent.hp <= 0) {
      if (victim.side === 'b') { bossZero(R); } else { faintPlayer(R, victim); }
    } else if (victim.side === 'b') { checkEnrage(R); }
  }

  // Self-inflicted flat damage (recoil / dodo trip). Bypasses shields.
  function selfFlat(R, ref, amount) {
    var ent = ref.ent;
    ent.hp = Math.max(0, ent.hp - amount);
    R.ev.push({ t: 'recoil', side: ref.side, seat: ref.seat, dmg: amount, hpAfter: ent.hp });
    markTook(R, ref);
    if (ent.hp <= 0) {
      if (ref.side === 'b') { bossZero(R); } else { faintPlayer(R, ref); }
    }
  }

  function healEntity(R, ref, amount, source) {
    var ent = ref.ent;
    if (amount <= 0 || ent.fainted || ent.hp <= 0) { return; }
    if ((ent.healingHalvedTurns || 0) > 0) { amount = Math.round(amount * 0.5); }
    var healed = Math.min(amount, ent.maxHp - ent.hp);
    if (healed <= 0) { return; }
    ent.hp += healed;
    R.ev.push({ t: 'heal', side: ref.side, seat: ref.seat, amount: healed, hpAfter: ent.hp, source: source });
    if (ref.side === 'p') { R.agg.partyHealing += healed; } else { R.agg.bossHealed += healed; }
  }

  // Apply a buff/debuff mod. q = disrupt potency scale for the caster.
  function applyStatMod(R, ref, spec, q) {
    var ent = ref.ent;
    var pct = spec.pct != null ? Math.round(spec.pct * q) : null;
    var flat = spec.flat != null ? Math.round(spec.flat * q) : null;
    var isDebuff = (pct != null && pct < 0) || (flat != null && flat < 0);
    var resisted = false;
    if (isDebuff) {
      if (ref.side === 'b') {
        var tw = R.bossDef.twistFx || {};
        if (tw.spdDebuffImmune && spec.stat === 'spd') { resisted = true; }
        else if (tw.darkWill) {
          if (pct != null) { pct = Math.round(pct * TU.DARK_WILL_FACTOR); }
          if (flat != null) { flat = Math.round(flat * TU.DARK_WILL_FACTOR); }
        }
      } else {
        var tctx = ref.ctx;
        if (tctx && tctx.cat === 'defense' && tctx.move && tctx.move.debuffImmune) { resisted = true; }
      }
    }
    var evt = { t: isDebuff ? 'debuff' : 'buff', side: ref.side, seat: ref.seat, stat: spec.stat, turns: spec.turns };
    if (pct != null) { evt.pct = pct; }
    if (flat != null) { evt.flat = flat; }
    if (resisted) { evt.resisted = true; R.ev.push(evt); return; }
    // same effect refreshes; different effects stack
    for (var i = 0; i < ent.mods.length; i++) {
      var m = ent.mods[i];
      if (m.stat === spec.stat && m.pct === pct && m.flat === flat) {
        m.turns = Math.max(m.turns, spec.turns); m.r = R.b.round;
        R.ev.push(evt);
        return;
      }
    }
    var mod = { stat: spec.stat, turns: spec.turns, r: R.b.round };
    if (pct != null) { mod.pct = pct; }
    if (flat != null) { mod.flat = flat; }
    ent.mods.push(mod);
    R.ev.push(evt);
  }

  // DoT / regen (negative dmg = regen). Reapplication refreshes by source.
  function applyDot(R, ref, dmg, turns, source) {
    var ent = ref.ent;
    for (var i = 0; i < ent.dots.length; i++) {
      if (ent.dots[i].source === source) {
        ent.dots[i].dmg = dmg; ent.dots[i].turns = turns;
        return;
      }
    }
    ent.dots.push({ dmg: dmg, turns: turns, source: source });
  }

  /* One strike of a damaging (or landing-check) move.
     o: { cat, acc?, power?, flat?, useStat?, bonus?, guardFraction?, statusOnly? }
     Returns { connected, dmg, pre, blocked }. */
  function strike(R, A, Tg, o) {
    var ent = Tg.ent;
    if (ent.untargetableTurns > 0) {
      R.ev.push({ t: 'immune', side: Tg.side, seat: Tg.seat, why: 'untargetable' });
      return { connected: false, dmg: 0 };
    }
    var lucky = A.side === 'p' ? luckMod(A.ent) : null;
    if (o.acc != null && !lucky) {
      var acc = clampAcc(o.acc + netFlat(A.ent, 'acc'));
      if (R.rng() * 100 >= acc) {
        R.ev.push({ t: 'miss', side: A.side, seat: A.seat });
        return { connected: false, dmg: 0 };
      }
    }
    var tctx = Tg.ctx;
    var dm = (tctx && tctx.cat === 'defense') ? tctx.move : null;
    if (dm && dm.evade) {
      var evc = dm.evade * (o.cat === 'special' ? TU.EVADE_VS_SPECIAL : 1);
      if (R.rng() * 100 < evc) {
        R.ev.push({ t: 'evade', side: Tg.side, seat: Tg.seat });
        if (dm.healOnEvade) { healEntity(R, Tg, dm.healOnEvade, tctx.move.name); }
        if (dm.counterOnEvade) { flatRider(R, A, dm.counterOnEvade, 'counter'); }
        if (dm.buffOnEvade) { applyStatMod(R, Tg, dm.buffOnEvade, 1); }
        if (dm.debuffOnEvade) { applyStatMod(R, A, dm.debuffOnEvade, 1); }
        return { connected: false, dmg: 0, evaded: true };
      }
    }
    if (o.statusOnly) { return { connected: true, dmg: 0 }; }
    var tgtCat = tctx ? tctx.cat : 'none';
    var mult = (MATCHUP[o.cat] && MATCHUP[o.cat][tgtCat] != null) ? MATCHUP[o.cat][tgtCat] : 1;
    var ridersOn = !!(dm && o.cat === 'attack');
    var raw;
    if (o.flat != null) {
      raw = o.flat * mult;
    } else {
      var roll = TU.DMG_ROLL_MIN + R.rng() * (TU.DMG_ROLL_MAX - TU.DMG_ROLL_MIN);
      raw = (effStat(R, A, o.useStat || 'atk') / effStat(R, Tg, 'def')) * o.power * 0.5 * mult * roll;
    }
    if (lucky && lucky.pct) { raw *= (1 + lucky.pct / 100); }
    if (o.bonus && !A.ent.lastRound.tookDamage) { raw *= (1 + o.bonus); }
    if (ridersOn && dm.extraReduce != null) { raw *= dm.extraReduce; }
    if (o.guardFraction != null) { raw *= o.guardFraction; }
    var pre = Math.max(1, Math.round(raw));
    var blocked = !!(ridersOn && dm.block);
    var dmg = blocked ? 0 : pre;
    if (Tg.side === 'b' && R.bossDef.twistFx && R.bossDef.twistFx.singleHitCap != null) {
      dmg = Math.min(dmg, R.bossDef.twistFx.singleHitCap);
    }
    var abs = Math.min(ent.shield, dmg);
    ent.shield -= abs;
    if (ent.shield <= 0) { ent.shield = 0; ent.shieldTurns = 0; }
    ent.hp = Math.max(0, ent.hp - (dmg - abs));
    R.ev.push({
      t: 'hit', side: Tg.side, seat: Tg.seat, slot: Tg.slot, dmg: dmg,
      verb: verbFor(o.cat, tgtCat, blocked), shieldAbsorbed: abs,
      hpAfter: ent.hp, shieldAfter: ent.shield
    });
    if (dmg > 0) {
      markTook(R, Tg);
      if (Tg.side === 'b') {
        if (A.side === 'p') {
          R.agg.toBossBySeat[A.seat] = (R.agg.toBossBySeat[A.seat] || 0) + dmg;
        }
        R.agg.bossTaken += dmg;
      }
      if (A.side === 'b' && Tg.side === 'p') { R.agg.bossDealt += dmg; }
    }
    if (ent.hp <= 0) {
      if (Tg.side === 'b') { bossZero(R); } else { faintPlayer(R, Tg); }
      return { connected: true, dmg: dmg, pre: pre, blocked: blocked };
    }
    if (Tg.side === 'b') { checkEnrage(R); }
    if (ridersOn) {
      if (dm.thorns) { flatRider(R, A, dm.thorns, 'thorns'); }
      if (dm.counter) { flatRider(R, A, dm.counter, 'counter'); }
      if (blocked) {
        if (dm.reflectPct) {
          var refl = Math.round(pre * dm.reflectPct / 100);
          if (dm.reflectCap != null) { refl = Math.min(refl, dm.reflectCap); }
          flatRider(R, A, refl, 'reflect');
        }
        if (dm.healOnBlock) { healEntity(R, Tg, dm.healOnBlock, dm.name); }
        if (dm.debuffOnBlock) { applyStatMod(R, A, dm.debuffOnBlock, 1); }
      }
    }
    // Disrupt: a landed attack-category hit on a target whose special has
    // not resolved yet this round halves that special's numeric potencies.
    if (o.cat === 'attack' && tctx && tctx.cat === 'special' &&
        !tctx.specialDone && !tctx.disrupted) {
      tctx.disrupted = true;
      R.ev.push({ t: 'disrupt', side: Tg.side, seat: Tg.seat });
      if (tctx.isTelegraph && ent.charging) {
        ent.charging.power = Math.round(ent.charging.power * TU.DISRUPT_POTENCY);
      }
    }
    return { connected: true, dmg: dmg, pre: pre, blocked: blocked };
  }

  // === player actions ======================================================

  function setCooldown(R, ref, cd) {
    if (cd) {
      ref.ent.cooldowns.special = cd;
      R.freshEnts.push(ref.ent);
    }
  }

  function healAllAllies(R, amount, source) {
    deployedRefs(R).forEach(function (ref) { healEntity(R, ref, amount, source); });
  }

  function strikeBoss(R, ref, o) {
    return strike(R, ref, bossRef(R), o);
  }

  function execPlayer(R, ref) {
    var ctx = ref.ctx, ent = ref.ent;
    if (ctx.isRelease) {
      var relMove = GameData.MOVES[ent.id].special;
      var power = ent.charging.power;
      if (ctx.disrupted) { power = power * TU.DISRUPT_POTENCY; }
      R.ev.push({
        t: 'act', side: 'p', seat: ref.seat, animal: ent.id,
        moveName: ent.charging.moveName, cat: 'special', targetSide: 'b'
      });
      ent.charging = null;
      strikeBoss(R, ref, { cat: 'special', acc: relMove.acc != null ? relMove.acc : 100, power: power });
      setCooldown(R, ref, relMove.cd);
      ctx.specialDone = true;
      return;
    }
    var move = ctx.move;
    if (!move) { return; }
    if (ctx.cat === 'defense') {
      R.ev.push({
        t: 'act', side: 'p', seat: ref.seat, animal: ent.id,
        moveName: move.name, cat: 'defense', targetSide: 'p', targetSeat: ref.seat
      });
      if (move.heal) { healEntity(R, ref, move.heal, move.name); }
      return;
    }
    if (ctx.cat === 'attack') {
      R.ev.push({
        t: 'act', side: 'p', seat: ref.seat, animal: ent.id,
        moveName: move.name, cat: 'attack', targetSide: 'b'
      });
      strikeBoss(R, ref, { cat: 'attack', acc: move.acc, power: move.power, useStat: move.useStat });
      return;
    }
    execPlayerSpecial(R, ref);
  }

  function execPlayerSpecial(R, ref) {
    var ctx = ref.ctx, ent = ref.ent, move = ctx.move;
    var q = ctx.disrupted ? TU.DISRUPT_POTENCY : 1;
    if (ctx.isTelegraph) {
      R.ev.push({
        t: 'act', side: 'p', seat: ref.seat, animal: ent.id,
        moveName: move.name, cat: 'special', targetSide: 'b'
      });
      var cp = ctx.disrupted ? Math.round(move.power * TU.DISRUPT_POTENCY) : move.power;
      ent.charging = { power: cp, moveName: move.name };
      R.ev.push({ t: 'charge', side: 'p', seat: ref.seat, moveName: move.name });
      return; // special resolves next round; no cooldown yet
    }
    var offensive = (move.power != null || move.hits || move.echoLastBossDamage ||
                     move.dot || move.debuff || move.roulette);
    var selfish = (move.heal != null || move.buffSelf || move.taunt ||
                   move.untargetable || move.regen);
    var actEvt = {
      t: 'act', side: 'p', seat: ref.seat, animal: ent.id,
      moveName: move.name, cat: 'special',
      targetSide: offensive ? 'b' : 'p'
    };
    if (!offensive && selfish) { actEvt.targetSeat = ref.seat; }
    R.ev.push(actEvt);

    if (move.roulette) {
      var u = R.rng(), acc2 = 0, br = move.roulette[move.roulette.length - 1];
      for (var i = 0; i < move.roulette.length; i++) {
        acc2 += move.roulette[i].chance;
        if (u < acc2) { br = move.roulette[i]; break; }
      }
      R.ev.push({ t: 'roulette', label: br.label });
      if (br.effect === 'nuke') {
        strikeBoss(R, ref, { cat: 'special', acc: br.acc, power: br.power * q });
      } else if (br.effect === 'healAll') {
        healAllAllies(R, Math.round(br.amount * q), move.name);
      } else if (br.effect === 'debuff') {
        applyStatMod(R, bossRef(R), { stat: br.stat, pct: br.pct, turns: br.turns }, q);
      } else if (br.effect === 'trip') {
        selfFlat(R, ref, br.selfDamage);
      }
    } else {
      var connected = false, total = 0, r, h;
      if (move.hits) {
        for (h = 0; h < move.hits && R.b.boss.hp > 0 && !R.ended && ent.hp > 0; h++) {
          r = strikeBoss(R, ref, { cat: 'special', acc: move.acc, power: move.power * q });
          if (r.connected) { connected = true; total += r.dmg; }
        }
      } else if (move.echoLastBossDamage) {
        var flat = Math.min(move.cap, R.b.lastRound.bossDamageDealt || 0);
        r = strikeBoss(R, ref, { cat: 'special', acc: move.acc, flat: Math.round(flat * q) });
        connected = r.connected; total = r.dmg;
      } else if (move.power != null) {
        r = strikeBoss(R, ref, {
          cat: 'special', acc: move.acc, power: move.power * q,
          bonus: move.bonusIfUntouched
        });
        connected = r.connected; total = r.dmg;
      } else if (move.dot || move.debuff) {
        // status-only move aimed at the boss (frog poison, octopus ink)
        if (move.acc != null) {
          r = strikeBoss(R, ref, { cat: 'special', acc: move.acc, statusOnly: true });
          connected = r.connected;
        } else { connected = true; }
      }
      if (connected && ent.hp > 0) {
        if (move.lifesteal && total > 0) {
          healEntity(R, ref, Math.round(move.lifesteal * total), move.name);
        }
        if (move.dot) { applyDot(R, bossRef(R), Math.round(move.dot.dmg * q), move.dot.turns, move.name); }
        if (move.debuff) { applyStatMod(R, bossRef(R), move.debuff, q); }
      }
      if (move.recoil && ent.hp > 0) { selfFlat(R, ref, move.recoil); }
      // team / self effects
      if (ent.hp > 0) {
        if (move.heal != null) { healEntity(R, ref, Math.round(move.heal * q), move.name); }
        if (move.healAll != null) { healAllAllies(R, Math.round(move.healAll * q), move.name); }
        if (move.shieldAll != null) {
          var amt = Math.round(move.shieldAll * q);
          deployedRefs(R).forEach(function (aRef) {
            aRef.ent.shield = Math.max(aRef.ent.shield, amt);
            aRef.ent.shieldTurns = TU.SHIELD_DURATION;
            R.ev.push({ t: 'shield', side: 'p', seat: aRef.seat, amount: amt });
          });
        }
        if (move.regen) { applyDot(R, ref, -Math.round(move.regen.amount * q), move.regen.turns, move.name); }
        if (move.buffSelf) { applyStatMod(R, ref, move.buffSelf, q); }
        if (move.buffAll) {
          deployedRefs(R).forEach(function (aRef) { applyStatMod(R, aRef, move.buffAll, q); });
        }
        if (move.luckBuff) {
          deployedRefs(R).forEach(function (aRef) {
            applyStatMod(R, aRef, { stat: 'luck', pct: Math.round(move.luckBuff.dmgPct * q), turns: move.luckBuff.turns }, 1);
          });
        }
        if (move.taunt) {
          ent.tauntTurns = move.taunt;
          R.ev.push({ t: 'taunt', seat: ref.seat, turns: move.taunt });
        }
        if (move.untargetable) {
          ent.untargetableTurns = move.untargetable + 1; // until end of NEXT round
          R.ev.push({ t: 'untargetable', seat: ref.seat, turns: move.untargetable });
        }
        if (move.revealBossNext) { R.ev.push({ t: 'foresightPending', seat: ref.seat }); }
        if (move.revivePct != null) { doRevive(R, ref, move, q); }
      }
    }
    setCooldown(R, ref, move.cd);
    ctx.specialDone = true;
  }

  function doRevive(R, ref, move, q) {
    var ent = ref.ent;
    var used = ent.usedOncePerBattle[move.name];
    var target = null, targetParty = null, slot = -1, wasDown = false;
    if (!used) {
      // 1) a party with ZERO living animals rejoins
      for (var i = 0; i < R.b.parties.length && !target; i++) {
        var p = R.b.parties[i];
        var living = p.animals.filter(function (a) { return !a.fainted; });
        if (living.length === 0) {
          for (var s = 0; s < p.animals.length; s++) {
            if (p.animals[s].fainted && (slot === -1 || p.animals[s].maxHp > p.animals[slot].maxHp)) { slot = s; }
          }
          targetParty = p; target = p.animals[slot]; wasDown = true;
        }
      }
      // 2) else the fainted animal with the highest maxHp anywhere
      if (!target) {
        R.b.parties.forEach(function (p2) {
          for (var s2 = 0; s2 < p2.animals.length; s2++) {
            var a2 = p2.animals[s2];
            if (a2.fainted && (!target || a2.maxHp > target.maxHp)) {
              target = a2; targetParty = p2; slot = s2;
            }
          }
        });
        wasDown = false;
      }
    }
    if (target) {
      target.fainted = false;
      target.hp = Math.max(1, Math.round(target.maxHp * move.revivePct * q));
      R.ev.push({ t: 'revive', seat: targetParty.seat, slot: slot, hp: target.hp });
      if (wasDown) {
        targetParty.activeIndex = slot;
        R.ev.push({ t: 'deploy', seat: targetParty.seat, slot: slot });
      }
      ent.usedOncePerBattle[move.name] = true;
    } else if (move.fallbackHealAll != null) {
      healAllAllies(R, Math.round(move.fallbackHealAll * q), move.name);
    }
  }

  // === boss actions ========================================================

  function targetableRefs(R) {
    return deployedRefs(R).filter(function (ref) { return ref.ent.untargetableTurns === 0; });
  }

  function fastestOf(R, refs) {
    var best = null, bestSpd = -1;
    refs.forEach(function (ref) {
      var s = effStat(R, ref, 'spd');
      if (s > bestSpd) { bestSpd = s; best = ref; }
    });
    return best;
  }

  function lowestHpOf(refs) {
    var best = null;
    refs.forEach(function (ref) {
      if (!best || ref.ent.hp < best.ent.hp) { best = ref; }
    });
    return best;
  }

  function rngPick(R, arr) {
    return arr[Math.floor(R.rng() * arr.length)];
  }

  function pickBossTarget(R, rule) {
    var refs = targetableRefs(R);
    if (refs.length === 0) { return null; }
    var boss = R.b.boss, bd = R.bossDef;
    // Twist lock beats taunt: alwaysTargetLowest is a compulsion the boss
    // cannot be baited out of (deterministic, no rng draws).
    if (bd.twistFx && bd.twistFx.alwaysTargetLowest) { return lowestHpOf(refs); }
    var taunters = refs.filter(function (ref) { return ref.ent.tauntTurns > 0; });
    if (taunters.length > 0) {
      var resist = (boss.phase === 2 && bd.phase2 && bd.phase2.tauntResist) ? bd.phase2.tauntResist : 0;
      if (!(resist && R.rng() < resist)) { return fastestOf(R, taunters); }
    }
    if (rule === 'lowestHp') { return lowestHpOf(refs); }
    if (rule === 'highestAtk') {
      var bestA = null, bestV = -1;
      refs.forEach(function (ref) {
        var v = effStat(R, ref, 'atk');
        if (v > bestV) { bestV = v; bestA = ref; }
      });
      return bestA;
    }
    if (rule === 'unpoisoned') {
      var clean = refs.filter(function (ref) {
        return !ref.ent.dots.some(function (d) { return d.dmg > 0; });
      });
      return rngPick(R, clean.length ? clean : refs);
    }
    if (rule === 'lowestTwo') {
      var sorted = refs.slice().sort(function (a, b2) { return a.ent.hp - b2.ent.hp; });
      return rngPick(R, sorted.slice(0, Math.min(2, sorted.length)));
    }
    if (rule === 'topDamager') {
      var by = R.b.lastRound.damageToBossBySeat || {};
      var bestT = null, bestD = -1;
      refs.forEach(function (ref) {
        var d = by[ref.seat] || 0;
        if (d > bestD) { bestD = d; bestT = ref; }
      });
      return bestD > 0 ? bestT : rngPick(R, refs);
    }
    if (rule === 'smart') {
      var bestS = null, bestE = Infinity;
      refs.forEach(function (ref) {
        var e = ref.ent.hp + ref.ent.shield;
        if (e < bestE) { bestE = e; bestS = ref; }
      });
      return bestS;
    }
    return rngPick(R, refs); // 'random' and default
  }

  function findGuard(R, target) {
    var guards = deployedRefs(R).filter(function (ref) {
      return ref.seat !== target.seat && ref.ent.untargetableTurns === 0 &&
        ref.ctx.cat === 'defense' && ref.ctx.move && ref.ctx.move.teamGuard;
    });
    return guards.length ? fastestOf(R, guards) : null;
  }

  function bossLifestealFraction(R, move, cat) {
    if (move && move.lifesteal) { return move.lifesteal; }
    var tw = R.bossDef.twistFx || {};
    if (cat === 'attack' && tw.lifestealAll) { return tw.lifestealAll; }
    return 0;
  }

  function execBoss(R) {
    var boss = R.b.boss, ctx = R.bossCtx, bd = R.bossDef;
    var B = bossRef(R);
    if (boss.hp <= 0) { return; }

    if (ctx.isRelease) {
      var target0 = pickBossTarget(R, R.bossIntent.targetRule);
      var power0 = boss.charging.power;
      if (ctx.disrupted) { power0 = power0 * TU.DISRUPT_POTENCY; }
      R.ev.push({
        t: 'act', side: 'b', animal: boss.animal, moveName: boss.charging.moveName,
        cat: 'special', targetSide: 'p', targetSeat: target0 ? target0.seat : null
      });
      var relAcc = bd.moves.special.acc != null ? bd.moves.special.acc : 100;
      boss.charging = null;
      if (!target0) { R.ev.push({ t: 'miss', side: 'b' }); }
      else {
        R.bossTargetSeat = target0.seat;
        strike(R, B, target0, { cat: 'special', acc: relAcc, power: power0 });
      }
      ctx.specialDone = true;
      return;
    }

    var move = ctx.move;
    if (ctx.cat === 'defense') {
      R.ev.push({
        t: 'act', side: 'b', animal: boss.animal, moveName: move.name,
        cat: 'defense', targetSide: 'b'
      });
      return;
    }
    if (ctx.isTelegraph) {
      R.ev.push({
        t: 'act', side: 'b', animal: boss.animal, moveName: move.name,
        cat: 'special', targetSide: 'p'
      });
      boss.charging = {
        power: ctx.disrupted ? Math.round(move.power * TU.DISRUPT_POTENCY) : move.power,
        moveName: move.name
      };
      R.ev.push({ t: 'charge', side: 'b', moveName: move.name });
      return;
    }

    var tw = bd.twistFx || {};
    var q = ctx.disrupted ? TU.DISRUPT_POTENCY : 1; // only specials get disrupted
    var power = move.power != null ? move.power * q : move.power;
    var moveName = move.name;
    var isAoe = !!move.aoe;
    if (ctx.useAoeMode) {
      isAoe = true;
      power = move.aoeMode.power;
      boss.aoeCooldown = move.aoeMode.everyN;
    }

    if (isAoe) {
      R.ev.push({
        t: 'act', side: 'b', animal: boss.animal, moveName: moveName,
        cat: ctx.cat, targetSide: 'p'
      });
      var totalAoe = 0;
      deployedRefs(R).forEach(function (tref) {
        if (R.ended || boss.hp <= 0) { return; }
        if (tref.ent.untargetableTurns > 0) {
          R.ev.push({ t: 'immune', side: 'p', seat: tref.seat, why: 'untargetable' });
          return;
        }
        var rr = strike(R, B, tref, { cat: ctx.cat, acc: move.acc, power: power });
        if (rr.connected) {
          totalAoe += rr.dmg;
          if (tref.ent.hp > 0) {
            if (move.dot) { applyDot(R, tref, Math.round(move.dot.dmg * q), move.dot.turns, moveName); }
            if (move.debuffAll) { applyStatMod(R, tref, move.debuffAll, q); }
            if (move.randomDebuffEach) {
              var rd = move.randomDebuffEach;
              applyStatMod(R, tref, {
                stat: rd.options[Math.floor(R.rng() * rd.options.length)],
                pct: rd.pct, turns: rd.turns
              }, q);
            }
          }
        }
      });
      var lsA = bossLifestealFraction(R, move, ctx.cat);
      if (lsA && totalAoe > 0) { healEntity(R, B, Math.round(lsA * totalAoe), moveName); }
      R.bossTargetSeat = null;
    } else if (move.randomTargets && move.hits) {
      R.ev.push({
        t: 'act', side: 'b', animal: boss.animal, moveName: moveName,
        cat: ctx.cat, targetSide: 'p'
      });
      var totalR = 0;
      for (var h = 0; h < move.hits && !R.ended && boss.hp > 0; h++) {
        var cands = targetableRefs(R);
        if (cands.length === 0) { R.ev.push({ t: 'miss', side: 'b' }); break; }
        var pick = rngPick(R, cands);
        var guard = findGuard(R, pick);
        var actual = guard || pick;
        var rr2 = strike(R, B, actual, {
          cat: ctx.cat, acc: move.acc, power: power,
          guardFraction: guard ? guard.ctx.move.teamGuard : null
        });
        if (rr2.connected) { totalR += rr2.dmg; }
      }
      var lsR = bossLifestealFraction(R, move, ctx.cat);
      if (lsR && totalR > 0) { healEntity(R, B, Math.round(lsR * totalR), moveName); }
      R.bossTargetSeat = null;
    } else {
      var target = pickBossTarget(R, R.bossIntent.targetRule);
      R.ev.push({
        t: 'act', side: 'b', animal: boss.animal, moveName: moveName,
        cat: ctx.cat, targetSide: 'p', targetSeat: target ? target.seat : null
      });
      if (!target) {
        R.ev.push({ t: 'miss', side: 'b' });
      } else {
        R.bossTargetSeat = target.seat;
        var guard1 = findGuard(R, target);
        var actual1 = guard1 || target;
        var n = move.hits || 1, total1 = 0, connected1 = false;
        for (var h1 = 0; h1 < n && !R.ended && boss.hp > 0 && actual1.ent.hp > 0; h1++) {
          var rr3 = strike(R, B, actual1, {
            cat: ctx.cat, acc: move.acc, power: power,
            guardFraction: guard1 ? guard1.ctx.move.teamGuard : null
          });
          if (rr3.connected) { connected1 = true; total1 += rr3.dmg; }
        }
        if (connected1) {
          if (actual1.ent.hp > 0) {
            if (ctx.cat === 'attack' && tw.attackDot) {
              applyDot(R, actual1, tw.attackDot.dmg, tw.attackDot.turns, 'Venom');
            }
            if (move.dot) { applyDot(R, actual1, Math.round(move.dot.dmg * q), move.dot.turns, moveName); }
            if (move.healingHalve) {
              actual1.ent.healingHalvedTurns = Math.max(actual1.ent.healingHalvedTurns, move.healingHalve);
            }
          }
          if (move.debuffAll) {
            deployedRefs(R).forEach(function (aRef) { applyStatMod(R, aRef, move.debuffAll, q); });
          }
          if (move.stealBuff) { stealNewestBuff(R); }
          var ls = bossLifestealFraction(R, move, ctx.cat);
          if (ls && total1 > 0 && boss.hp > 0) { healEntity(R, B, Math.round(ls * total1), moveName); }
        }
      }
    }
    if (ctx.cat === 'special') { ctx.specialDone = true; }
  }

  function stealNewestBuff(R) {
    var best = null; // {ent, idx, mod}
    R.b.parties.forEach(function (p) {
      p.animals.forEach(function (a) {
        if (a.fainted) { return; }
        for (var i = 0; i < a.mods.length; i++) {
          var m = a.mods[i];
          var isBuff = (m.pct != null && m.pct > 0) || (m.flat != null && m.flat > 0);
          if (isBuff && (!best || (m.r || 0) >= (best.mod.r || 0))) {
            best = { ent: a, idx: i, mod: m };
          }
        }
      });
    });
    if (best) {
      best.ent.mods.splice(best.idx, 1);
      var label = best.mod.stat === 'luck' ? 'Lucky Charm'
        : best.mod.stat.toUpperCase() + ' ' + (best.mod.pct != null ? '+' + best.mod.pct + '%' : '+' + best.mod.flat);
      R.ev.push({ t: 'stealBuff', name: label });
    }
  }

  // === round resolution ====================================================

  function mkNoneCtx(seat, ent) {
    return { side: 'p', seat: seat, ent: ent, cat: 'none', move: null, specialDone: true, disrupted: false };
  }

  function resolveRound(orig, intents, bossIntent, rng) {
    if (orig.phase !== 'select') {
      throw new Error('resolveRound: phase is ' + orig.phase);
    }
    var b = clone(orig);
    intents = intents || {};
    bossIntent = bossIntent || { cat: 'attack', targetRule: 'random' };
    var R = {
      b: b, ev: [], rng: rng, bossDef: GameData.bossById(b.boss.id),
      ctxs: {}, bossCtx: null, bossIntent: bossIntent,
      agg: { bossDealt: 0, toBossBySeat: {}, partyHealing: 0, bossHealed: 0, bossTaken: 0, tookEnts: [] },
      freshEnts: [], ended: false, bossTargetSeat: null, picks: {}, bossCat: null
    };
    R.ev.push({ t: 'round', n: b.round });

    // 1) voluntary switches resolve first
    b.parties.forEach(function (party) {
      var it = intents[party.seat];
      if (!it || it.kind !== 'switch') { return; }
      var from = party.activeIndex, to = it.to;
      var tgt = party.animals[to];
      if (to === from || !tgt || tgt.fainted) { return; }
      var out = party.animals[from];
      if (out) { out.charging = null; out.tauntTurns = 0; }
      party.activeIndex = to;
      R.ev.push({ t: 'switch', seat: party.seat, from: from, to: to, voluntary: true });
      R.picks[party.seat] = 'switch';
      R.ctxs[party.seat] = mkNoneCtx(party.seat, tgt);
      R.ctxs[party.seat].switched = true;
    });

    // 2) lock categories for the remaining seats
    b.parties.forEach(function (party) {
      if (R.ctxs[party.seat]) { return; }
      var ent = party.animals[party.activeIndex];
      if (!ent || ent.fainted || ent.hp <= 0) {
        R.ctxs[party.seat] = mkNoneCtx(party.seat, ent);
        return;
      }
      if (ent.charging) { // forced release
        R.ctxs[party.seat] = {
          side: 'p', seat: party.seat, ent: ent, cat: 'special', move: null,
          specialDone: false, disrupted: false, isRelease: true
        };
        R.picks[party.seat] = 'special';
        return;
      }
      var it = intents[party.seat];
      if (!it || it.kind !== 'move') {
        R.ctxs[party.seat] = mkNoneCtx(party.seat, ent);
        return;
      }
      var cat = it.cat;
      if (cat === 'special' && ent.cooldowns.special > 0) { cat = 'attack'; } // defensive clamp
      var move = GameData.MOVES[ent.id][cat];
      R.ctxs[party.seat] = {
        side: 'p', seat: party.seat, ent: ent, cat: cat, move: move,
        specialDone: cat !== 'special', disrupted: false,
        isTelegraph: !!(cat === 'special' && move.chargeTurns && !ent.charging)
      };
      R.picks[party.seat] = cat;
    });

    // boss context
    var boss = b.boss;
    if (boss.charging) {
      R.bossCtx = { side: 'b', ent: boss, cat: 'special', move: null, specialDone: false, disrupted: false, isRelease: true };
    } else {
      var bcat = bossIntent.cat;
      var bmove = R.bossDef.moves[bcat];
      R.bossCtx = {
        side: 'b', ent: boss, cat: bcat, move: bmove,
        specialDone: bcat !== 'special', disrupted: false,
        isTelegraph: !!(bcat === 'special' && bmove.chargeTurns),
        useAoeMode: !!(bcat === 'attack' && bossIntent.aoeMode && bmove.aoeMode && boss.aoeCooldown === 0)
      };
    }
    R.bossCat = R.bossCtx.cat;

    // 3) actor order: all actors in current effective SPD order
    var actors = [];
    if (boss.hp > 0) { actors.push({ isBoss: true, ref: bossRef(R) }); }
    b.parties.forEach(function (party) {
      var ctx = R.ctxs[party.seat];
      if (ctx && ctx.cat !== 'none' && !ctx.switched) {
        actors.push({ isBoss: false, seat: party.seat, ref: pRef(R, party) });
      }
    });
    var speeds = actors.map(function (a) { return effStat(R, a.ref, 'spd'); });
    var hasTie = false;
    for (var i = 0; i < speeds.length; i++) {
      for (var j2 = i + 1; j2 < speeds.length; j2++) {
        if (speeds[i] === speeds[j2]) { hasTie = true; }
      }
    }
    var order = actors.map(function (a, idx) {
      return { a: a, spd: speeds[idx], jit: hasTie ? R.rng() : 0 };
    });
    order.sort(function (x, y) {
      if (y.spd !== x.spd) { return y.spd - x.spd; }
      return y.jit - x.jit;
    });

    // 4) execute
    order.forEach(function (o) {
      if (R.ended) { return; }
      if (o.a.isBoss) {
        execBoss(R);
      } else {
        var ref = o.a.ref;
        if (ref.ent.fainted || ref.ent.hp <= 0) { return; } // KO'd: pending action lost
        execPlayer(R, ref);
      }
    });

    // 5) end-of-round bookkeeping
    if (!R.ended) { endOfRound(R); }
    return { events: R.ev, battle: b };
  }

  function endOfRound(R) {
    var b = R.b, boss = b.boss;

    // DoT / regen ticks (players, then boss)
    b.parties.forEach(function (party) {
      party.animals.forEach(function (an, idx) {
        if (an.fainted || an.hp <= 0 || R.ended) { return; }
        var ref = { side: 'p', seat: party.seat, slot: idx, ent: an, ctx: R.ctxs[party.seat], party: party };
        var dots = an.dots.slice();
        for (var i = 0; i < dots.length; i++) {
          if (an.fainted || R.ended) { break; }
          var d = dots[i];
          if (d.dmg > 0) {
            if (an.untargetableTurns > 0) { continue; }
            an.hp = Math.max(0, an.hp - d.dmg);
            R.ev.push({ t: 'dot', side: 'p', seat: party.seat, dmg: d.dmg, hpAfter: an.hp, source: d.source });
            markTook(R, ref);
            if (an.hp <= 0) { faintPlayer(R, ref); }
          } else if (d.dmg < 0) {
            healEntity(R, ref, -d.dmg, d.source);
          }
        }
      });
    });
    if (!R.ended && boss.hp > 0) {
      var bDots = boss.dots.slice();
      var bossPhase0 = boss.phase;
      for (var k = 0; k < bDots.length; k++) {
        // stop if the battle ended or a phase-2 revive cleared the dots
        if (boss.hp <= 0 || R.ended || boss.phase !== bossPhase0) { break; }
        var bd2 = bDots[k];
        if (bd2.dmg > 0) {
          boss.hp = Math.max(0, boss.hp - bd2.dmg);
          R.ev.push({ t: 'dot', side: 'b', dmg: bd2.dmg, hpAfter: boss.hp, source: bd2.source });
          R.agg.bossTaken += bd2.dmg;
          if (boss.hp <= 0) { bossZero(R); } else { checkEnrage(R); }
        }
      }
    }
    if (R.ended) { return; }

    // duration decrements
    function decEnt(ent) {
      ent.mods = ent.mods.filter(function (m) { m.turns--; return m.turns > 0; });
      ent.dots = ent.dots.filter(function (d) { d.turns--; return d.turns > 0; });
      if (ent.shield > 0) {
        ent.shieldTurns--;
        if (ent.shieldTurns <= 0) { ent.shield = 0; ent.shieldTurns = 0; }
      }
      if (ent.tauntTurns > 0) { ent.tauntTurns--; }
      if (ent.untargetableTurns > 0) { ent.untargetableTurns--; }
      if ((ent.healingHalvedTurns || 0) > 0) { ent.healingHalvedTurns--; }
      if (ent.cooldowns && ent.cooldowns.special > 0 && R.freshEnts.indexOf(ent) === -1) {
        ent.cooldowns.special--;
      }
    }
    b.parties.forEach(function (party) {
      party.animals.forEach(function (an) { if (!an.fainted) { decEnt(an); } });
    });
    boss.mods = boss.mods.filter(function (m) { m.turns--; return m.turns > 0; });
    boss.dots = boss.dots.filter(function (d) { d.turns--; return d.turns > 0; });
    if (boss.aoeCooldown > 0) { boss.aoeCooldown--; }

    // lastRound aggregates
    b.lastRound = {
      bossDamageDealt: R.agg.bossDealt,
      damageToBossBySeat: R.agg.toBossBySeat,
      partyHealing: R.agg.partyHealing,
      healingReceivedByBoss: R.agg.bossHealed
    };
    b.parties.forEach(function (party) {
      party.animals.forEach(function (an) {
        an.lastRound = { tookDamage: R.agg.tookEnts.indexOf(an) !== -1 };
      });
    });
    boss.lastRound = { damageTaken: R.agg.bossTaken, tookDamage: R.agg.bossTaken > 0 };

    // public history (all the boss AI may ever read besides hp/statuses)
    b.history.push({ picks: R.picks, bossCat: R.bossCat, bossTargetSeat: R.bossTargetSeat });

    // forced-switch bookkeeping
    var pending = [];
    b.parties.forEach(function (party) {
      var act = party.animals[party.activeIndex];
      var living = party.animals.some(function (a) { return !a.fainted; });
      if (living && (!act || act.fainted)) { pending.push(party.seat); }
    });
    b.pendingSwitchSeats = pending;
    if (pending.length > 0) {
      b.phase = 'awaitSwitch';
      R.ev.push({ t: 'needSwitch', seats: pending.slice() });
    } else {
      b.phase = 'select';
    }
    b.round++;
  }

  function applyForcedSwitch(orig, seat, slot) {
    if (orig.phase !== 'awaitSwitch') {
      throw new Error('applyForcedSwitch: phase is ' + orig.phase);
    }
    var b = clone(orig);
    var events = [];
    if (b.pendingSwitchSeats.indexOf(seat) === -1) {
      throw new Error('applyForcedSwitch: seat ' + seat + ' not pending');
    }
    var party = partyBySeat(b, seat);
    var tgt = party.animals[slot];
    if (!tgt || tgt.fainted) {
      throw new Error('applyForcedSwitch: invalid slot ' + slot);
    }
    party.activeIndex = slot;
    events.push({ t: 'deploy', seat: seat, slot: slot });
    b.pendingSwitchSeats = b.pendingSwitchSeats.filter(function (s) { return s !== seat; });
    if (b.pendingSwitchSeats.length === 0) { b.phase = 'select'; }
    return { events: events, battle: b };
  }

  function publicSnapshot(battle) { return clone(battle); }

  exports.createBattle = createBattle;
  exports.legalOptions = legalOptions;
  exports.resolveRound = resolveRound;
  exports.applyForcedSwitch = applyForcedSwitch;
  exports.publicSnapshot = publicSnapshot;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.Engine = {}));

/* ============================================================
   Animal Battle Champions - Battle Renderer (window.BattleRender)
   Owns the battle screen DOM: boss card, ally cards, command
   panel, ticker/log, sequential event playback, forced-switch
   picker and the restoration cinematic. Consumes ONLY public
   snapshots + the canonical event schema from engine.js. Never
   calls Engine/Flow directly - main.js (or online.js) wires the
   callbacks below.

   PUBLIC API
     BattleRender.mount(snapshot, opts)
       opts = { mySeats:[seats this device controls],
                onIntent(seat, intent),      // locked a move/switch
                onForcedSwitch(seat, slot),  // picked a KO replacement
                onPlaybackDone() }           // playback queue drained
     BattleRender.play(events) -> Promise    // sequential playback;
                                             // batches queue up, the
                                             // promise resolves when
                                             // THAT batch finishes
     BattleRender.syncTo(snapshot)           // hard-set bars/benches/
                                             // statuses (self-heal)
     BattleRender.setLocked(lockedList)      // [{seat,kind,cat}] chips
     BattleRender.showForesight(cat)         // pin "boss preparing X"
     BattleRender.enterSelection(legalBySeat)// re-open command panel
     BattleRender.promptForcedSwitch(seat)   // KO replacement modal
     BattleRender.playRestoration(boss) -> Promise
     BattleRender.isPlaying()
     BattleRender.reset()

   Playback controls: tapping the boss arena fast-forwards the
   current event; the SKIP button settles the whole round (waits
   collapse to 0; the trailing syncTo squares everything). Reduced
   motion (Save.data.settings.reduceMotion or body.reduced-motion)
   collapses every wait to ~60ms.
   ============================================================ */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var XLINK_NS = 'http://www.w3.org/1999/xlink';
  var LOG_CAP = 250;
  var AI_CHIP_DELAY = 700;

  var wiredStatic = false;

  var state = {
    view: null,            // deep clone of the latest snapshot (playback mirror)
    bossDef: null,
    opts: { mySeats: [] },
    cards: {},             // seat -> node refs
    bossImg: null,
    burstNode: null,
    // selection
    selectionOpen: false,
    sel: null,             // {kind:'move',cat} | {kind:'switch',to}
    legal: {},
    // playback
    queue: [],             // [{events:[...], resolve}]
    playing: false,
    skipAll: false,
    ffResolve: null,
    ffTimer: null,
    timers: [],
    foresightCat: null,
    dmgPool: [],
    dmgIdx: 0
  };

  // === tiny helpers ========================================================
  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) { n.className = className; }
    if (text !== undefined && text !== null) { n.textContent = text; }
    return n;
  }

  function svgIcon(symbolId, className) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', className || 'rps-icon');
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#' + symbolId);
    use.setAttributeNS(XLINK_NS, 'xlink:href', '#' + symbolId);
    svg.appendChild(use);
    return svg;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function later(fn, ms) {
    var id = setTimeout(fn, ms);
    state.timers.push(id);
    return id;
  }

  function clearTimers() {
    for (var i = 0; i < state.timers.length; i++) { clearTimeout(state.timers[i]); }
    state.timers = [];
  }

  function reducedMotion() {
    if (window.Save && Save.data && Save.data.settings.reduceMotion) { return true; }
    return document.body.classList.contains('reduced-motion');
  }

  function hideAllyPicks() {
    return !!(window.Save && Save.data && Save.data.settings.hideAllyPicks);
  }

  function isMine(seat) { return state.opts.mySeats.indexOf(seat) !== -1; }

  function cmdSeat() { return state.opts.mySeats.length ? state.opts.mySeats[0] : null; }

  function partyBySeat(seat) {
    if (!state.view) { return null; }
    for (var i = 0; i < state.view.parties.length; i++) {
      if (state.view.parties[i].seat === seat) { return state.view.parties[i]; }
    }
    return null;
  }

  function activeEnt(seat) {
    var p = partyBySeat(seat);
    return p ? p.animals[p.activeIndex] : null;
  }

  function speciesName(id) {
    return (window.GameData && GameData.ANIMALS[id]) ? GameData.ANIMALS[id].name : id;
  }

  function allyLabel(seat) {
    var p = partyBySeat(seat);
    if (!p) { return 'Ally'; }
    var ent = p.animals[p.activeIndex];
    return p.name + "'s " + (ent ? speciesName(ent.id) : '???');
  }

  function bossLabel() { return state.bossDef ? state.bossDef.name : 'The boss'; }

  function catIconId(cat) {
    if (cat === 'attack') { return 'icon-sword'; }
    if (cat === 'defense') { return 'icon-shield'; }
    return 'icon-star';
  }

  // === ticker + battle log =================================================
  function P(text, cls) { return { text: text, cls: cls }; }

  function appendParts(node, parts) {
    for (var i = 0; i < parts.length; i++) {
      var s = el('span', parts[i].cls || null, parts[i].text);
      node.appendChild(s);
    }
  }

  function say(parts, logCls) {
    var t = $('log-ticker-text');
    if (t) {
      t.innerHTML = '';
      appendParts(t, parts);
    }
    addLog(parts, logCls);
  }

  function addLog(parts, cls) {
    var box = $('battle-log-entries');
    if (!box) { return; }
    var d = el('div', 'log-entry ' + (cls || 'log-system'));
    appendParts(d, parts);
    box.appendChild(d);
    while (box.children.length > LOG_CAP) { box.removeChild(box.firstChild); }
  }

  var VERB_CLS = {
    'CUT THROUGH!': 't-attack',
    'PIERCED!': 't-special',
    'BLOCKED!': 't-defense',
    'CLASH!': 't-dim'
  };

  // === boss rendering ======================================================
  function renderBossStatic() {
    var boss = state.view.boss;
    var bd = state.bossDef;
    var nameNode = $('boss-name');
    if (nameNode) {
      nameNode.classList.remove('gold-name');
      nameNode.textContent = 'CORRUPTED ' + speciesName(boss.animal).toUpperCase();
    }
    var spriteBox = $('boss-sprite');
    if (spriteBox && window.SpriteEngine) {
      spriteBox.innerHTML = '';
      var img = SpriteEngine.createSpriteImg(boss.animal);
      img.classList.add('corrupted');
      spriteBox.appendChild(img);
      state.bossImg = img;
    }
    var eyes = $('boss-eyes');
    if (eyes) {
      eyes.classList.remove('faded');
      if (bd && bd.eyes) {
        eyes.style.setProperty('--eye-l', bd.eyes.l);
        eyes.style.setProperty('--eye-r', bd.eyes.r);
      }
    }
    var aura = $('boss-aura');
    if (aura) { aura.classList.remove('faded'); }
    var embers = $('boss-embers');
    if (embers) { embers.classList.remove('faded'); }
    // chip holder lives inside the existing title row
    var row = document.querySelector('#battle-boss-header .boss-title-row');
    if (row && !$('boss-chips')) {
      var holder = el('span', 'boss-chips');
      holder.id = 'boss-chips';
      var hpText = $('boss-hp-text');
      row.insertBefore(holder, hpText || null);
    }
    // light burst node inside the stage (used by playRestoration)
    var stage = $('boss-stage');
    if (stage) {
      var burst = stage.querySelector('.light-burst');
      if (!burst) {
        burst = el('div', 'light-burst');
        stage.insertBefore(burst, stage.firstChild);
      }
      state.burstNode = burst;
    }
    if (state.burstNode) { state.burstNode.classList.remove('run'); }
    renderBossChips();
    setBossHp();
  }

  function hpFillClasses(fill, frac) {
    fill.classList.toggle('hp-low', frac <= 0.25);
    fill.classList.toggle('hp-mid', frac > 0.25 && frac <= 0.5);
  }

  function setBossHp() {
    var boss = state.view.boss;
    var frac = boss.maxHp > 0 ? Math.max(0, Math.min(1, boss.hp / boss.maxHp)) : 0;
    var fill = $('boss-hp-fill');
    var ghost = $('boss-hp-ghost');
    var txt = $('boss-hp-text');
    if (fill) { fill.style.setProperty('--hp', String(frac)); hpFillClasses(fill, frac); }
    if (ghost) { ghost.style.setProperty('--hp-ghost', String(frac)); }
    if (txt) { txt.textContent = boss.hp + '/' + boss.maxHp; }
  }

  function renderBossChips() {
    var holder = $('boss-chips');
    if (!holder || !state.view) { return; }
    holder.innerHTML = '';
    var boss = state.view.boss;
    if (boss.phase === 2 && state.bossDef && state.bossDef.phase2) {
      holder.appendChild(el('span', 'boss-chip chip-phase', state.bossDef.phase2.name.toUpperCase()));
    }
    if (boss.enraged) {
      holder.appendChild(el('span', 'boss-chip chip-enrage', 'ENRAGED'));
    }
    if (boss.charging && boss.charging.moveName) {
      // persistent telegraph: keep the incoming release visible while the
      // player picks their answer (reuses the gold foresight chip style)
      holder.appendChild(el('span', 'boss-chip chip-foresight',
        'CHARGING: ' + boss.charging.moveName.toUpperCase()));
    }
    if (state.foresightCat && window.GameData) {
      holder.appendChild(el('span', 'boss-chip chip-foresight',
        'NEXT: ' + (GameData.CAT_LABELS[state.foresightCat] || state.foresightCat).toUpperCase()));
    }
  }

  function bossFlash() {
    var flash = $('boss-hit-flash');
    if (!flash) { return; }
    flash.classList.remove('run');
    void flash.offsetWidth;
    flash.classList.add('run');
  }

  function bossLunge() {
    var stage = $('boss-stage');
    if (!stage) { return; }
    stage.classList.remove('anim-lunge-down');
    void stage.offsetWidth;
    stage.classList.add('anim-lunge-down');
  }

  // === ally cards ==========================================================
  function buildAllyRow() {
    var row = $('ally-row');
    if (!row) { return; }
    row.innerHTML = '';
    state.cards = {};
    var parties = state.view.parties.slice().sort(function (a, b) { return a.seat - b.seat; });
    for (var i = 0; i < parties.length; i++) {
      row.appendChild(buildAllyCard(parties[i]));
    }
  }

  function buildAllyCard(party) {
    var root = el('div', 'ally-card' + (isMine(party.seat) ? ' mine' : ''));
    root.setAttribute('data-seat', String(party.seat));

    var chip = el('span', 'lock-chip');
    chip.hidden = true;
    root.appendChild(chip);

    var spriteBox = el('div', 'ally-sprite');
    var img = document.createElement('img');
    img.draggable = false;
    spriteBox.appendChild(img);
    var flash = el('div', 'hit-flash');
    spriteBox.appendChild(flash);
    root.appendChild(spriteBox);

    root.appendChild(el('span', 'ally-name', party.name));

    var track = el('div', 'hp-track mini');
    var ghost = el('div', 'hp-ghost');
    var fill = el('div', 'hp-fill');
    track.appendChild(ghost);
    track.appendChild(fill);
    root.appendChild(track);

    var pips = el('div', 'shield-pips');
    root.appendChild(pips);
    var dots = el('div', 'status-dots');
    root.appendChild(dots);
    var minis = el('div', 'ally-bench-minis');
    root.appendChild(minis);

    state.cards[party.seat] = {
      root: root, chip: chip, spriteBox: spriteBox, img: img, flash: flash,
      fill: fill, ghost: ghost, pips: pips, dots: dots, minis: minis
    };
    renderAllyCard(party.seat);
    return root;
  }

  // Refresh one card completely from the view model.
  function renderAllyCard(seat, entranceAnim) {
    var refs = state.cards[seat];
    var party = partyBySeat(seat);
    if (!refs || !party) { return; }
    var ent = party.animals[party.activeIndex];
    if (window.SpriteEngine && ent) {
      var src = SpriteEngine.getSprite(ent.id);
      if (src && refs.img.getAttribute('src') !== src) { refs.img.setAttribute('src', src); }
      refs.img.alt = speciesName(ent.id);
    }
    refs.img.classList.remove('anim-faint', 'anim-switch-in');
    if (entranceAnim) {
      void refs.img.offsetWidth;
      refs.img.classList.add('anim-switch-in');
    }
    var partyAlive = party.animals.some(function (a) { return !a.fainted; });
    refs.root.classList.toggle('fainted', !ent || ent.fainted || !partyAlive);
    updateAllyHp(seat);
    renderAllyStatus(seat);
    renderBenchMinis(seat);
  }

  function updateAllyHp(seat) {
    var refs = state.cards[seat];
    var ent = activeEnt(seat);
    if (!refs || !ent) { return; }
    var frac = ent.maxHp > 0 ? Math.max(0, Math.min(1, ent.hp / ent.maxHp)) : 0;
    refs.fill.style.setProperty('--hp', String(frac));
    refs.ghost.style.setProperty('--hp-ghost', String(frac));
    hpFillClasses(refs.fill, frac);
  }

  function renderAllyStatus(seat) {
    var refs = state.cards[seat];
    var ent = activeEnt(seat);
    if (!refs || !ent) { return; }
    refs.pips.innerHTML = '';
    var pipCount = Math.min(8, Math.ceil((ent.shield || 0) / 5));
    for (var i = 0; i < pipCount; i++) { refs.pips.appendChild(el('i', 'shield-pip')); }
    refs.dots.innerHTML = '';
    var up = 0, down = 0;
    for (var m = 0; m < ent.mods.length; m++) {
      var mod = ent.mods[m];
      var v = mod.pct != null ? mod.pct : (mod.flat != null ? mod.flat : 0);
      if (v > 0) { up++; } else if (v < 0) { down++; }
    }
    var d;
    for (d = 0; d < Math.min(3, up); d++) { refs.dots.appendChild(el('span', 'status-dot t-good', '▲')); }
    for (d = 0; d < Math.min(3, down); d++) { refs.dots.appendChild(el('span', 'status-dot t-bad', '▼')); }
    if ((ent.shield || 0) > 0) { refs.dots.appendChild(el('span', 'status-dot t-shield', '◆')); }
    if (ent.tauntTurns > 0) { refs.dots.appendChild(el('span', 'status-dot t-gold', '●')); }
    if (ent.untargetableTurns > 0) { refs.dots.appendChild(el('span', 'status-dot t-dim', '○')); }
  }

  function renderBenchMinis(seat) {
    var refs = state.cards[seat];
    var party = partyBySeat(seat);
    if (!refs || !party) { return; }
    refs.minis.innerHTML = '';
    for (var s = 0; s < party.animals.length; s++) {
      if (s === party.activeIndex) { continue; }
      var a = party.animals[s];
      if (!window.SpriteEngine) { continue; }
      var mini = SpriteEngine.createSpriteImg(a.id);
      mini.classList.add('bench-mini');
      if (a.fainted) { mini.classList.add('mini-fainted'); }
      mini.setAttribute('data-seat', String(seat));
      mini.setAttribute('data-slot', String(s));
      refs.minis.appendChild(mini);
    }
  }

  function allyFlash(seat) {
    var refs = state.cards[seat];
    if (!refs) { return; }
    refs.flash.classList.remove('run');
    void refs.flash.offsetWidth;
    refs.flash.classList.add('run');
  }

  function allyLunge(seat) {
    var refs = state.cards[seat];
    if (!refs) { return; }
    refs.spriteBox.classList.remove('anim-lunge-up');
    void refs.spriteBox.offsetWidth;
    refs.spriteBox.classList.add('anim-lunge-up');
  }

  // === lock chips ==========================================================
  function stampChip(seat, iconId, generic) {
    var refs = state.cards[seat];
    if (!refs) { return; }
    var chip = refs.chip;
    chip.innerHTML = '';
    chip.className = 'lock-chip';
    chip.hidden = false;
    if (generic) {
      chip.classList.add('chip-hidden');
      chip.textContent = '✓';
    } else if (iconId === 'icon-swap') {
      chip.classList.add('chip-hidden');
      chip.appendChild(svgIcon('icon-swap', 'rps-icon'));
    } else {
      var cat = iconId === 'icon-sword' ? 'attack' : (iconId === 'icon-shield' ? 'defense' : 'special');
      chip.classList.add('chip-' + cat);
      chip.appendChild(svgIcon(iconId, 'rps-icon'));
    }
    chip.classList.remove('lock-stamp');
    void chip.offsetWidth;
    chip.classList.add('lock-stamp');
  }

  function clearChip(seat) {
    var refs = state.cards[seat];
    if (refs) { refs.chip.hidden = true; }
  }

  function clearAllChips() {
    for (var seat in state.cards) {
      if (Object.prototype.hasOwnProperty.call(state.cards, seat)) { clearChip(Number(seat)); }
    }
  }

  function setLocked(lockedList) {
    if (!state.view) { return; }
    lockedList = lockedList || [];
    // rebuild from scratch each call (Flow reports the full list)
    var lockedSeats = {};
    for (var i = 0; i < lockedList.length; i++) {
      var it = lockedList[i];
      lockedSeats[it.seat] = true;
      var party = partyBySeat(it.seat);
      var isAi = party && party.controller === 'ai';
      var iconId = it.kind === 'switch' ? 'icon-swap' : catIconId(it.cat);
      if (isMine(it.seat)) {
        stampChip(it.seat, iconId, false);
      } else if (isAi) {
        // cosmetic: AI locks stamp with a small delay so allies feel alive
        (function (seat) {
          later(function () { stampChip(seat, null, true); }, AI_CHIP_DELAY);
        })(it.seat);
      } else {
        // human teammate: category unless the blind-mode toggle is on
        stampChip(it.seat, iconId, hideAllyPicks());
      }
    }
    // seats that unlocked (undo) lose their chip
    for (var seat in state.cards) {
      if (Object.prototype.hasOwnProperty.call(state.cards, seat) && !lockedSeats[Number(seat)]) {
        clearChip(Number(seat));
      }
    }
  }

  // === command panel =======================================================
  function moveSub(move) {
    if (!move) { return ''; }
    if (move.chargeTurns) { return 'CHARGE ' + move.power; }
    if (move.hits) { return move.hits + 'x' + move.power + ' ' + (move.acc || 100) + '%'; }
    if (move.power != null && move.acc != null) { return move.power + ' PWR ' + move.acc + '%'; }
    if (move.block) { return move.counter ? 'BLOCK+' + move.counter : (move.reflectPct ? 'BLOCK+REFLECT' : 'BLOCK'); }
    if (move.evade) { return 'EVADE ' + move.evade + '%'; }
    if (move.teamGuard) { return 'GUARD ALLY'; }
    if (move.extraReduce) { return 'IRONHIDE'; }
    if (move.thorns) { return 'THORNS ' + move.thorns; }
    if (move.heal != null) { return 'HEAL ' + move.heal; }
    if (move.healAll != null) { return 'TEAM HEAL ' + move.healAll; }
    if (move.shieldAll != null) { return 'TEAM SHIELD'; }
    if (move.buffAll) { return 'TEAM BUFF'; }
    if (move.buffSelf) { return 'SELF BUFF'; }
    if (move.debuff) { return 'DEBUFF BOSS'; }
    if (move.dot) { return 'POISON'; }
    if (move.taunt) { return 'TAUNT'; }
    if (move.untargetable) { return 'VANISH'; }
    if (move.revivePct != null) { return 'REVIVE'; }
    if (move.revealBossNext) { return 'REVEAL'; }
    if (move.luckBuff) { return 'TEAM LUCK'; }
    if (move.roulette) { return 'RANDOM!'; }
    if (move.echoLastBossDamage) { return 'ECHO DMG'; }
    return '';
  }

  function buildCommandPanel() {
    var seat = cmdSeat();
    var legal = seat != null ? state.legal[seat] : null;
    var ent = seat != null ? activeEnt(seat) : null;
    var moves = (ent && window.GameData) ? GameData.MOVES[ent.id] : null;
    var cats = ['attack', 'defense', 'special'];
    for (var i = 0; i < cats.length; i++) {
      var cat = cats[i];
      var btn = $('btn-move-' + cat);
      var nameNode = $('move-name-' + cat);
      var subNode = $('move-sub-' + cat);
      var mv = moves ? moves[cat] : null;
      if (nameNode) { nameNode.textContent = mv ? mv.name : cat.toUpperCase(); }
      if (subNode) { subNode.textContent = moveSub(mv); }
      if (btn) {
        var ok = !!(state.selectionOpen && legal && legal.canAct && !legal.forced && legal.cats[cat]);
        btn.disabled = !ok;
        btn.classList.toggle('selected', !!(state.sel && state.sel.kind === 'move' && state.sel.cat === cat));
      }
    }
    var cd = $('move-cd-special');
    if (cd) {
      var cdVal = ent ? (ent.cooldowns ? ent.cooldowns.special : 0) : 0;
      if (legal && legal.canAct && !legal.forced && !legal.cats.special && cdVal > 0) {
        cd.hidden = false;
        cd.textContent = 'CD ' + cdVal;
      } else {
        cd.hidden = true;
      }
    }
    buildBench(seat, legal);
    var lock = $('btn-lock-in');
    if (lock) {
      lock.classList.remove('locked-in');
      if (legal && legal.forced === 'charge') {
        lock.disabled = true;
        lock.textContent = 'CHARGING...';
        if (seat != null) { stampChip(seat, 'icon-star', false); }
      } else if (state.sel && state.sel.kind === 'switch') {
        lock.disabled = !state.selectionOpen;
        lock.textContent = 'SWITCH IN';
      } else {
        lock.disabled = !(state.selectionOpen && state.sel);
        lock.textContent = 'LOCK IN';
      }
    }
  }

  function buildBench(seat, legal) {
    var box = $('bench-chips');
    if (!box) { return; }
    box.innerHTML = '';
    var party = seat != null ? partyBySeat(seat) : null;
    if (!party) { return; }
    for (var s = 0; s < party.animals.length; s++) {
      if (s === party.activeIndex) { continue; }
      var a = party.animals[s];
      var chip = el('button', 'bench-chip');
      chip.type = 'button';
      chip.setAttribute('data-slot', String(s));
      if (window.SpriteEngine) { chip.appendChild(SpriteEngine.createSpriteImg(a.id)); }
      chip.appendChild(el('span', 'chip-name', speciesName(a.id) + ' ' + a.hp + '/' + a.maxHp));
      chip.appendChild(svgIcon('icon-swap', 'swap-icon'));
      var legalSwitch = !!(state.selectionOpen && legal && legal.canAct && !legal.forced &&
        legal.switchTo && legal.switchTo.indexOf(s) !== -1);
      if (a.fainted) { chip.classList.add('fainted'); }
      chip.disabled = !legalSwitch;
      chip.classList.toggle('selected', !!(state.sel && state.sel.kind === 'switch' && state.sel.to === s));
      box.appendChild(chip);
    }
  }

  var PREVIEW = {
    attack: [P('Attack', 't-attack'), P(' — cuts through '), P('Special', 't-special'), P(', blocked by '), P('Defend', 't-defense')],
    defense: [P('Defend', 't-defense'), P(' — blocks '), P('Attack', 't-attack'), P(', pierced by '), P('Special', 't-special')],
    special: [P('Special', 't-special'), P(' — pierces '), P('Defend', 't-defense'), P(', loses to '), P('Attack', 't-attack')]
  };

  function selectCat(cat) {
    var seat = cmdSeat();
    var legal = seat != null ? state.legal[seat] : null;
    if (!state.selectionOpen || !legal || !legal.canAct || legal.forced || !legal.cats[cat]) { return; }
    state.sel = { kind: 'move', cat: cat };
    buildCommandPanel();
    var ent = activeEnt(seat);
    var mv = (ent && window.GameData) ? GameData.MOVES[ent.id][cat] : null;
    var parts = [P((mv ? mv.name : cat) + ': ', 't-' + cat)].concat(PREVIEW[cat]);
    var t = $('log-ticker-text');
    if (t) { t.innerHTML = ''; appendParts(t, parts); }
  }

  function selectBench(slot) {
    var seat = cmdSeat();
    var legal = seat != null ? state.legal[seat] : null;
    if (!state.selectionOpen || !legal || !legal.canAct || legal.forced) { return; }
    if (!legal.switchTo || legal.switchTo.indexOf(slot) === -1) { return; }
    state.sel = { kind: 'switch', to: slot };
    buildCommandPanel();
    var party = partyBySeat(seat);
    var a = party ? party.animals[slot] : null;
    var t = $('log-ticker-text');
    if (t) {
      t.innerHTML = '';
      appendParts(t, [P('Switch: ', 't-gold'),
        P((a ? speciesName(a.id) : '???') + ' jumps in (no action this round)')]);
    }
  }

  function commit() {
    var seat = cmdSeat();
    if (seat == null || !state.selectionOpen || !state.sel) { return; }
    var intent = state.sel.kind === 'move'
      ? { kind: 'move', cat: state.sel.cat }
      : { kind: 'switch', to: state.sel.to };
    // close the panel optimistically; re-open if the intent bounces
    var legalKeep = state.legal;
    state.selectionOpen = false;
    var iconId = intent.kind === 'switch' ? 'icon-swap' : catIconId(intent.cat);
    stampChip(seat, iconId, false);
    var lock = $('btn-lock-in');
    if (lock) { lock.disabled = true; lock.textContent = 'LOCKED IN'; lock.classList.add('locked-in'); }
    disableMoveButtons();
    var ok = true;
    if (state.opts.onIntent) { ok = state.opts.onIntent(seat, intent); }
    if (ok === false) {
      state.selectionOpen = true;
      state.legal = legalKeep;
      state.sel = null;
      clearChip(seat);
      buildCommandPanel();
    }
  }

  function disableMoveButtons() {
    var cats = ['attack', 'defense', 'special'];
    for (var i = 0; i < cats.length; i++) {
      var btn = $('btn-move-' + cats[i]);
      if (btn) { btn.disabled = true; btn.classList.remove('selected'); }
    }
    var box = $('bench-chips');
    if (box) {
      var chips = box.children;
      for (var c = 0; c < chips.length; c++) { chips[c].disabled = true; }
    }
  }

  function enterSelection(legalBySeat) {
    state.legal = legalBySeat || {};
    state.sel = null;
    state.selectionOpen = true;
    clearAllChips();
    buildCommandPanel();
  }

  // === playback ============================================================
  function showSkip(on) {
    var btn = $('btn-skip-round');
    if (btn) { btn.hidden = !on; }
  }

  function wait(ms) {
    if (reducedMotion()) { ms = Math.min(ms, 60); }
    if (state.skipAll) { ms = 0; }
    return new Promise(function (resolve) {
      var done = false;
      var finish = function () {
        if (done) { return; }
        done = true;
        if (state.ffResolve === finish) { state.ffResolve = null; }
        if (state.ffTimer) { clearTimeout(state.ffTimer); state.ffTimer = null; }
        resolve();
      };
      state.ffResolve = finish;
      state.ffTimer = setTimeout(finish, ms);
    });
  }

  function fastForward() {
    if (state.playing && state.ffResolve) { state.ffResolve(); }
  }

  function skipRound() {
    if (!state.playing) { return; }
    state.skipAll = true;
    fastForward();
  }

  function play(events) {
    var entry = { events: (events || []).slice(), resolve: null };
    var pr = new Promise(function (res) { entry.resolve = res; });
    state.queue.push(entry);
    if (!state.playing) {
      state.playing = true;
      showSkip(true);
      later(nextEvent, 0);
    }
    return pr;
  }

  function nextEvent() {
    if (!state.view) { return; }   // reset() mid-playback
    var entry = state.queue[0];
    if (!entry) { finishPlayback(); return; }
    if (entry.events.length === 0) {
      state.queue.shift();
      entry.resolve();
      nextEvent();
      return;
    }
    var ev = entry.events.shift();
    var ms = 500;
    try {
      ms = applyEvent(ev);
    } catch (e) {
      console.error('[BattleRender] event failed', ev, e);
      ms = 60;
    }
    wait(ms).then(nextEvent);
  }

  function finishPlayback() {
    state.playing = false;
    state.skipAll = false;
    showSkip(false);
    later(function () {
      if (!state.playing && state.queue.length === 0 &&
          state.opts && typeof state.opts.onPlaybackDone === 'function') {
        state.opts.onPlaybackDone();
      }
    }, 0);
  }

  // pooled floating damage numbers (max 3 live nodes)
  function spawnDmg(container, text, cls) {
    if (!container) { return; }
    var node = state.dmgPool[state.dmgIdx % 3];
    if (!node) {
      node = el('div', 'dmg-number');
      state.dmgPool[state.dmgIdx % 3] = node;
    }
    state.dmgIdx++;
    node.className = 'dmg-number' + (cls ? ' ' + cls : '');
    node.textContent = text;
    node.style.left = (28 + (state.dmgIdx * 17) % 34) + '%';
    node.style.top = (14 + (state.dmgIdx * 11) % 22) + '%';
    if (node.parentNode !== container) { container.appendChild(node); }
    node.style.animation = 'none';
    void node.offsetWidth;
    node.style.animation = '';
  }

  function dmgTarget(side, seat) {
    if (side === 'b') { return $('boss-stage'); }
    var refs = state.cards[seat];
    return refs ? refs.spriteBox : null;
  }

  function targetLabel(side, seat) {
    return side === 'b' ? bossLabel() : allyLabel(seat);
  }

  function applyHpEvent(side, seat, hpAfter, shieldAfter) {
    if (side === 'b') {
      state.view.boss.hp = hpAfter;
      if (shieldAfter != null) { state.view.boss.shield = shieldAfter; }
      setBossHp();
    } else {
      var ent = activeEnt(seat);
      if (ent) {
        ent.hp = hpAfter;
        if (shieldAfter != null) { ent.shield = shieldAfter; }
        updateAllyHp(seat);
        renderAllyStatus(seat);
      }
    }
  }

  // Every handler updates the view mirror + DOM and returns a duration.
  function applyEvent(ev) {
    switch (ev.t) {
      case 'round':
        state.foresightCat = null;
        renderBossChips();
        clearAllChips();
        say([P('— ROUND ' + ev.n + ' —', 't-dim')], 'log-round');
        return 380;

      case 'act': {
        var actorIsBoss = ev.side === 'b';
        // the boss unleashing its charged move: drop the CHARGING chip
        if (actorIsBoss && state.view.boss.charging &&
            state.view.boss.charging.moveName === ev.moveName) {
          state.view.boss.charging = null;
          renderBossChips();
        }
        var label = actorIsBoss ? bossLabel() : allyLabel(ev.seat);
        if (actorIsBoss) { bossLunge(); } else { allyLunge(ev.seat); }
        var parts = [P(label + ' uses '), P(ev.moveName, 't-' + ev.cat), P('!')];
        if (actorIsBoss && ev.targetSide === 'p' && ev.targetSeat != null) {
          parts.push(P(' → ' + allyLabel(ev.targetSeat), 't-dim'));
        }
        say(parts, actorIsBoss ? 'log-boss' : 'log-player');
        return 550;
      }

      case 'charge': {
        var who = ev.side === 'b' ? bossLabel() : allyLabel(ev.seat);
        if (ev.side === 'b') {
          state.view.boss.charging = { moveName: ev.moveName };
          renderBossChips();
        }
        say([P(who + ' is charging '), P(ev.moveName, 't-gold'), P('... brace yourselves!')], 'log-status');
        return 700;
      }

      case 'hit': {
        applyHpEvent(ev.side, ev.seat, ev.hpAfter, ev.shieldAfter);
        if (ev.side === 'b') { bossFlash(); } else { allyFlash(ev.seat); }
        var cls = ev.side === 'p' ? 'dmg-boss' : '';
        if (ev.verb === 'CUT THROUGH!' || ev.verb === 'PIERCED!') { cls = (cls + ' dmg-strong').replace(/^ /, ''); }
        if (ev.verb === 'BLOCKED!') { cls = (cls + ' dmg-weak').replace(/^ /, ''); }
        spawnDmg(dmgTarget(ev.side, ev.seat), '-' + ev.dmg, cls);
        var hitParts = [];
        if (ev.verb) { hitParts.push(P(ev.verb + ' ', VERB_CLS[ev.verb] || 't-dim')); }
        hitParts.push(P(ev.dmg + ' damage to ' + targetLabel(ev.side, ev.seat)));
        if (ev.shieldAbsorbed > 0) { hitParts.push(P(' (' + ev.shieldAbsorbed + ' shielded)', 't-shield')); }
        say(hitParts, ev.side === 'b' ? 'log-player' : 'log-boss');
        return 650;
      }

      case 'miss':
        say([P((ev.side === 'b' ? bossLabel() : allyLabel(ev.seat)) + ' missed!', 't-dim')],
          ev.side === 'b' ? 'log-boss' : 'log-player');
        return 450;

      case 'evade':
        say([P(targetLabel(ev.side, ev.seat) + ' evaded!', 't-defense')], 'log-status');
        return 450;

      case 'immune':
        say([P(targetLabel(ev.side, ev.seat) +
          (ev.why === 'untargetable' ? ' cannot be hit!' : ' shrugged it off!'), 't-dim')], 'log-status');
        return 450;

      case 'counter': {
        applyHpEvent(ev.side, ev.seat, ev.hpAfter);
        spawnDmg(dmgTarget(ev.side, ev.seat), '-' + ev.dmg, ev.side === 'p' ? 'dmg-boss' : '');
        var kindLabel = ev.kind === 'thorns' ? 'Thorns' : (ev.kind === 'reflect' ? 'Reflected' : 'Counter');
        say([P(kindLabel + '! ', 't-defense'), P(ev.dmg + ' back at ' + targetLabel(ev.side, ev.seat))], 'log-status');
        return 500;
      }

      case 'heal': {
        applyHpEvent(ev.side, ev.seat, ev.hpAfter);
        spawnDmg(dmgTarget(ev.side, ev.seat), '+' + ev.amount, 'dmg-heal');
        say([P(targetLabel(ev.side, ev.seat) + ' healed '), P('+' + ev.amount, 't-good'),
          P(ev.source ? ' (' + ev.source + ')' : '', 't-dim')], 'log-heal');
        return 500;
      }

      case 'shield': {
        var sEnt = activeEnt(ev.seat);
        if (sEnt) { sEnt.shield = Math.max(sEnt.shield || 0, ev.amount); }
        renderAllyStatus(ev.seat);
        say([P(targetLabel('p', ev.seat) + ' gains a '), P(ev.amount + ' HP shield', 't-shield'), P('!')], 'log-status');
        return 450;
      }

      case 'buff':
      case 'debuff': {
        var isBuff = ev.t === 'buff';
        var tgt = ev.side === 'b' ? state.view.boss : activeEnt(ev.seat);
        if (tgt && !ev.resisted) {
          var mod = { stat: ev.stat, turns: ev.turns };
          if (ev.pct != null) { mod.pct = ev.pct; }
          if (ev.flat != null) { mod.flat = ev.flat; }
          tgt.mods.push(mod);
        }
        if (ev.side === 'p') { renderAllyStatus(ev.seat); }
        var amount = ev.pct != null ? (ev.pct > 0 ? '+' + ev.pct + '%' : ev.pct + '%')
          : (ev.flat != null ? (ev.flat > 0 ? '+' + ev.flat : String(ev.flat)) : '');
        var statLbl = (ev.stat === 'luck') ? 'LUCK' : String(ev.stat).toUpperCase();
        var bParts = [P(targetLabel(ev.side, ev.seat) + ' ')];
        if (ev.resisted) {
          bParts.push(P('resisted the ' + statLbl + ' ' + (isBuff ? 'buff' : 'debuff') + '!', 't-dim'));
        } else {
          bParts.push(P(statLbl + ' ' + amount, isBuff ? 't-good' : 't-bad'));
          bParts.push(P(' for ' + ev.turns + ' round' + (ev.turns === 1 ? '' : 's')));
        }
        say(bParts, 'log-status');
        return 500;
      }

      case 'dot': {
        applyHpEvent(ev.side, ev.seat, ev.hpAfter);
        spawnDmg(dmgTarget(ev.side, ev.seat), '-' + ev.dmg, ev.side === 'p' ? 'dmg-boss' : 'dmg-weak');
        say([P(targetLabel(ev.side, ev.seat) + ' takes '), P(ev.dmg + ' ' + (ev.source || 'poison'), 't-special'),
          P(' damage')], 'log-status');
        return 500;
      }

      case 'disrupt':
        say([P('DISRUPTED! ', 't-attack'),
          P(targetLabel(ev.side, ev.seat) + "'s special is weakened!")], 'log-status');
        return 500;

      case 'stealBuff':
        say([P(bossLabel() + ' steals ', 't-bad'), P(ev.name || 'a buff', 't-gold'), P('!')], 'log-boss');
        return 500;

      case 'taunt':
        say([P(allyLabel(ev.seat) + ' taunts the boss!', 't-gold'),
          P(' (' + ev.turns + ' rounds)', 't-dim')], 'log-status');
        renderAllyStatus(ev.seat);
        return 450;

      case 'untargetable':
        say([P(allyLabel(ev.seat) + ' becomes a blur - untargetable!', 't-gold')], 'log-status');
        return 450;

      case 'revive': {
        var rParty = partyBySeat(ev.seat);
        if (rParty && rParty.animals[ev.slot]) {
          rParty.animals[ev.slot].fainted = false;
          rParty.animals[ev.slot].hp = ev.hp;
        }
        renderAllyCard(ev.seat);
        say([P('POD RESCUE! ', 't-gold'),
          P((rParty ? speciesName(rParty.animals[ev.slot].id) : 'An ally') + ' is revived with ' + ev.hp + ' HP!')],
          'log-heal');
        return 700;
      }

      case 'roulette':
        say([P('Extinction Roulette: ', 't-special'), P(ev.label || '???', 't-gold')], 'log-status');
        return 750;

      case 'recoil':
        applyHpEvent(ev.side, ev.seat, ev.hpAfter);
        spawnDmg(dmgTarget(ev.side, ev.seat), '-' + ev.dmg, 'dmg-weak');
        say([P(targetLabel(ev.side, ev.seat) + ' takes ' + ev.dmg + ' recoil', 't-dim')], 'log-status');
        return 450;

      case 'faint': {
        if (ev.side === 'p') {
          var fParty = partyBySeat(ev.seat);
          if (fParty && ev.slot != null && fParty.animals[ev.slot]) {
            fParty.animals[ev.slot].fainted = true;
            fParty.animals[ev.slot].hp = 0;
          }
          var refs = state.cards[ev.seat];
          if (refs) {
            refs.root.classList.add('fainted');
            refs.img.classList.add('anim-faint');
          }
          updateAllyHp(ev.seat);
          say([P((fParty && ev.slot != null ? speciesName(fParty.animals[ev.slot].id) : 'An ally') +
            ' fainted!', 't-bad')], 'log-ko');
        } else {
          say([P(bossLabel() + ' falls!', 't-gold')], 'log-ko');
        }
        return 700;
      }

      case 'switch': {
        var swParty = partyBySeat(ev.seat);
        if (swParty) { swParty.activeIndex = ev.to; }
        closeStaleSwitchModal(ev.seat);
        renderAllyCard(ev.seat, true);
        say([P(allyLabel(ev.seat) + ' switches in!', 't-gold')], 'log-player');
        return 450;
      }

      case 'deploy': {
        var dParty = partyBySeat(ev.seat);
        if (dParty) { dParty.activeIndex = ev.slot; }
        closeStaleSwitchModal(ev.seat);
        renderAllyCard(ev.seat, true);
        say([P('Go, ' + allyLabel(ev.seat) + '!', 't-gold')], 'log-player');
        return 450;
      }

      case 'needSwitch':
        say([P('Choose your next fighter!', 't-gold')], 'log-system');
        return 350;

      case 'partyDown': {
        var pdParty = partyBySeat(ev.seat);
        renderAllyCard(ev.seat);
        say([P((pdParty ? pdParty.name : 'A party') + "'s whole team is down!", 't-bad')], 'log-ko');
        return 600;
      }

      case 'bossPhase': {
        if (state.bossDef && state.bossDef.phase2 && ev.name === state.bossDef.phase2.name) {
          state.view.boss.phase = 2;
          state.view.boss.hp = state.bossDef.phase2.hp;
          state.view.boss.maxHp = state.bossDef.phase2.hp;
          setBossHp();
        } else {
          state.view.boss.enraged = true;
        }
        renderBossChips();
        bossFlash();
        say([P(ev.name.toUpperCase() + '! ', 't-bad'), P(ev.desc || '', 't-dim')], 'log-boss');
        return 950;
      }

      case 'foresight':
        state.foresightCat = ev.cat;
        renderBossChips();
        say([P('FORESIGHT: ', 't-special'), P('the boss is preparing '),
          P((window.GameData ? GameData.CAT_LABELS[ev.cat] : ev.cat).toUpperCase(), 't-' + ev.cat), P('!')],
          'log-status');
        return 700;

      case 'end':
        if (ev.result === 'victory') {
          say([P('VICTORY! ', 't-gold'), P('The corruption shatters!')], 'log-system');
        } else {
          say([P('DEFEAT... ', 't-bad'), P('the darkness holds this rung.')], 'log-system');
        }
        return 650;

      default:
        // unknown events: log only, never throw
        addLog([P('[' + ev.t + ']', 't-dim')], 'log-system');
        return 60;
    }
  }

  // === public: sync / foresight / forced switch ============================
  function syncTo(snapshot) {
    if (!snapshot) { return; }
    state.view = clone(snapshot);
    setBossHp();
    renderBossChips();
    var parties = state.view.parties;
    for (var i = 0; i < parties.length; i++) {
      if (!state.cards[parties[i].seat]) { buildAllyRow(); break; }
    }
    for (var j = 0; j < parties.length; j++) { renderAllyCard(parties[j].seat); }
  }

  function showForesight(cat) {
    state.foresightCat = cat;
    renderBossChips();
  }

  function promptForcedSwitch(seat) {
    var modal = $('modal');
    var title = $('modal-title');
    var body = $('modal-body');
    var actions = $('modal-actions');
    var party = partyBySeat(seat);
    if (!modal || !body || !party) {
      // fallback: auto-pick first living slot so the game never stalls
      autoPickSwitch(seat);
      return;
    }
    if (title) { title.textContent = 'CHOOSE YOUR NEXT FIGHTER'; }
    if (actions) { actions.innerHTML = ''; }
    body.innerHTML = '';
    var picker = el('div', 'bench-pick-row');
    var found = false;
    for (var s = 0; s < party.animals.length; s++) {
      var a = party.animals[s];
      if (a.fainted || s === party.activeIndex) { continue; }
      found = true;
      var btn = el('button', 'bench-pick');
      btn.type = 'button';
      if (window.SpriteEngine) { btn.appendChild(SpriteEngine.createSpriteImg(a.id, 64)); }
      btn.appendChild(el('span', 'bench-pick-name', speciesName(a.id)));
      btn.appendChild(el('span', 'bench-pick-hp', a.hp + '/' + a.maxHp + ' HP'));
      (function (slot) {
        btn.addEventListener('click', function () {
          modal.hidden = true;
          if (state.opts.onForcedSwitch) { state.opts.onForcedSwitch(seat, slot); }
        });
      })(s);
      picker.appendChild(btn);
    }
    if (!found) { autoPickSwitch(seat); return; }
    body.appendChild(picker);
    modal.hidden = false;
  }

  // If OUR forced-switch modal is still open when our switch/deploy event
  // arrives (online: the host auto-picked after the deadline), close it -
  // the choice has already been made for us.
  function closeStaleSwitchModal(seat) {
    if (!isMine(seat)) { return; }
    var modal = $('modal');
    if (modal && !modal.hidden) { modal.hidden = true; }
  }

  function autoPickSwitch(seat) {
    var party = partyBySeat(seat);
    if (!party) { return; }
    for (var s = 0; s < party.animals.length; s++) {
      if (!party.animals[s].fainted && s !== party.activeIndex) {
        if (state.opts.onForcedSwitch) { state.opts.onForcedSwitch(seat, s); }
        return;
      }
    }
  }

  // === restoration cinematic ===============================================
  function playRestoration(boss) {
    return new Promise(function (resolve) {
      var rm = reducedMotion();
      var screen = $('screen-battle');
      if (screen) { screen.classList.add('restoring'); }
      var modal = $('modal');
      if (modal) { modal.hidden = true; }
      showSkip(false);
      var fadeIds = ['boss-aura', 'boss-eyes', 'boss-embers'];
      for (var i = 0; i < fadeIds.length; i++) {
        var n = $(fadeIds[i]);
        if (n) { n.classList.add('faded'); }
      }
      state.foresightCat = null;
      state.view.boss.charging = null;   // no CHARGING chip over the cinematic
      renderBossChips();
      say([P('The darkness lifts...', 't-gold')], 'log-system');
      var animalName = speciesName(boss.animal);
      later(function () {
        if (state.bossImg) { state.bossImg.classList.add('restored'); }
        if (state.burstNode) {
          state.burstNode.classList.remove('run');
          void state.burstNode.offsetWidth;
          state.burstNode.classList.add('run');
        }
        var nameNode = $('boss-name');
        if (nameNode) {
          nameNode.textContent = animalName.toUpperCase() + ' RESTORED!';
          nameNode.classList.add('gold-name');
        }
        say([P(animalName + ' is free!', 't-gold')], 'log-system');
        later(resolve, rm ? 350 : 2400);
      }, rm ? 120 : 550);
    });
  }

  // === mount / reset =======================================================
  function wireStatic() {
    if (wiredStatic) { return; }
    wiredStatic = true;
    var cats = ['attack', 'defense', 'special'];
    for (var i = 0; i < cats.length; i++) {
      (function (cat) {
        var btn = $('btn-move-' + cat);
        if (btn) { btn.addEventListener('click', function () { selectCat(cat); }); }
      })(cats[i]);
    }
    var lock = $('btn-lock-in');
    if (lock) { lock.addEventListener('click', commit); }
    var bench = $('bench-chips');
    if (bench) {
      bench.addEventListener('click', function (e) {
        var chip = e.target.closest ? e.target.closest('.bench-chip') : null;
        if (chip && !chip.disabled) { selectBench(Number(chip.getAttribute('data-slot'))); }
      });
    }
    var arena = $('boss-arena');
    if (arena) { arena.addEventListener('click', fastForward); }
    // SKIP button (created once, lives inside the arena)
    if (arena && !$('btn-skip-round')) {
      var skip = el('button', 'btn-skip', 'SKIP »');
      skip.id = 'btn-skip-round';
      skip.type = 'button';
      skip.hidden = true;
      skip.addEventListener('click', function (e) {
        e.stopPropagation();
        skipRound();
      });
      arena.appendChild(skip);
    }
    // tapping a bench mini on MY card selects that switch
    var allyRow = $('ally-row');
    if (allyRow) {
      allyRow.addEventListener('click', function (e) {
        var mini = e.target.closest ? e.target.closest('.bench-mini') : null;
        if (!mini) { return; }
        var seat = Number(mini.getAttribute('data-seat'));
        if (isMine(seat) && seat === cmdSeat()) {
          selectBench(Number(mini.getAttribute('data-slot')));
        }
      });
    }
  }

  function mount(snapshot, opts) {
    reset();
    state.opts = opts || {};
    if (!state.opts.mySeats) { state.opts.mySeats = []; }
    state.view = clone(snapshot);
    state.bossDef = GameData.bossById(snapshot.boss.id);
    wireStatic();
    var screen = $('screen-battle');
    if (screen) { screen.classList.remove('restoring'); }
    var modal = $('modal');
    if (modal) { modal.hidden = true; }
    var logBox = $('battle-log-entries');
    if (logBox) { logBox.innerHTML = ''; }
    renderBossStatic();
    buildAllyRow();
    state.selectionOpen = false;
    state.sel = null;
    state.legal = {};
    buildCommandPanel();
    showSkip(false);
    say([P(state.bossDef.name + ' ' + state.bossDef.title, 't-bad'),
      P(' blocks rung ' + state.view.rung + '. The battle begins!')], 'log-system');
  }

  function reset() {
    clearTimers();
    if (state.ffTimer) { clearTimeout(state.ffTimer); state.ffTimer = null; }
    state.ffResolve = null;
    var q = state.queue;
    state.queue = [];
    for (var i = 0; i < q.length; i++) {
      if (q[i].resolve) { q[i].resolve(); }
    }
    state.playing = false;
    state.skipAll = false;
    state.view = null;
    state.bossDef = null;
    state.cards = {};
    state.bossImg = null;
    state.burstNode = null;   // rebuilt by renderBossStatic (node stays in DOM)
    state.sel = null;
    state.selectionOpen = false;
    state.legal = {};
    state.foresightCat = null;
    state.dmgPool = [];
    state.dmgIdx = 0;
    var screen = $('screen-battle');
    if (screen) { screen.classList.remove('restoring'); }
    showSkip(false);
  }

  window.BattleRender = {
    mount: mount,
    play: play,
    syncTo: syncTo,
    setLocked: setLocked,
    showForesight: showForesight,
    enterSelection: enterSelection,
    promptForcedSwitch: promptForcedSwitch,
    playRestoration: playRestoration,
    isPlaying: function () { return state.playing; },
    reset: reset
  };
})();

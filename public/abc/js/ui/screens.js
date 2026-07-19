/* ============================================================
   Animal Battle Champions - Screens (window.Screens)
   Owns screen switching plus every NON-battle screen's rendering
   and interactions. Talks only to GameData, SpriteEngine and Save.
   It never calls Engine/Flow/Network directly - main.js wires the
   hooks below and orchestrates.

   PUBLIC API
     Screens.init(hooks)
       hooks = {
         onSoloStart({parties})   team READY in solo mode.
                                  parties[0] = {controller:'human', name, team:[3 ids]}
                                  extra seats = {controller:'ai', name} (main.js /
                                  companionAI drafts their teams)
         onFight(rung)            FIGHT pressed on a ladder rung (1-8);
                                  also defeat-screen TRY AGAIN
         onCreateRoom(name)       lobby: create co-op room
         onJoinRoom(code, name)   lobby: join room by code
         onRoomStart()            room: host pressed START
         onSetParty(team)         online: local player locked their 3 ids
         onReadyToggle(ready)     room: ready toggled (bool)
         onSeatAiToggle(i, makeAi) room: host toggles empty seat <-> AI
         onLeaveRoom()            room/lobby: leave
       }
       Any missing hook console.warns instead of crashing, so the
       page runs standalone before main.js exists. If init() is
       never called (main.js missing), Screens self-initializes
       with stub hooks one tick after load.
     Screens.show(name)           title|mode|party|lobby|room|team|ladder|battle|result
     Screens.toast(msg)
     Screens.renderLadder(saveData)          saveData = Save.data-shaped
     Screens.renderTeamSelect(opts)          opts? {lockedIds:[ids], takenLabel:{id:label}}
                                             lockedIds defaults to Save.isUnlocked();
                                             pass null to clear a previous opts,
                                             omit the arg to keep it
     Screens.renderRoom(lobbyState, {isHost, mySeat})
       lobbyState = {code, seats:[{name, controller:'human'|'ai'|null,
                     ready, connected} x3], canStart}
     Screens.showSheet(name)      settings|battle-log|animal-detail|rps-hint
     Screens.hideSheet()
     Screens.getPartySetup()      -> [{controller:'human'|'ai'}, ...]
     Screens.showVictory({boss, restoreLine, unlocked, defer})
       Builds the restoration DOM (classes only). Unless defer:true,
       runs a default cinematic; battle-render passes defer and
       drives .restored / .light-burst.run / name rewrite itself.
     Screens.showDefeat({boss})
   ============================================================ */
(function () {
  'use strict';

  var SCREEN_NAMES = ['title', 'mode', 'party', 'lobby', 'room', 'team', 'ladder', 'battle', 'result'];
  var SHEET_NAMES = ['settings', 'battle-log', 'animal-detail', 'rps-hint'];
  var LONG_PRESS_MS = 450;
  var TOAST_MS = 2400;

  var hooks = {};
  var inited = false;
  var wired = false;

  var state = {
    screen: null,
    mode: 'solo',            // 'solo' | 'online'
    allies: { 2: null, 3: null },   // {animal, nick} when toggled on
    teamPicks: [],
    teamOpts: null,          // last renderTeamSelect opts
    roomCode: '',
    myReady: false,
    lastRoom: null,
    lastBossRung: 1
  };

  // --- tiny DOM helpers ---------------------------------------------------
  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined && text !== null) { node.textContent = text; }
    return node;
  }

  function svgIcon(symbolId, className) {
    var SVG_NS = 'http://www.w3.org/2000/svg';
    var XLINK_NS = 'http://www.w3.org/1999/xlink';
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', className || 'rps-icon');
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#' + symbolId);
    use.setAttributeNS(XLINK_NS, 'xlink:href', '#' + symbolId);
    svg.appendChild(use);
    return svg;
  }

  function on(id, evt, fn) {
    var node = $(id);
    if (node) { node.addEventListener(evt, fn); }
    return node;
  }

  function callHook(name, args) {
    if (hooks && typeof hooks[name] === 'function') {
      return hooks[name].apply(null, args || []);
    }
    console.warn('[Screens] hook "' + name + '" not wired yet (main.js pending)', args || []);
    return undefined;
  }

  function catIconId(cat) {
    if (cat === 'attack') { return 'icon-sword'; }
    if (cat === 'defense') { return 'icon-shield'; }
    return 'icon-star';
  }

  // === SCREEN SWITCHING ====================================================
  function show(name) {
    if (SCREEN_NAMES.indexOf(name) === -1) {
      console.warn('[Screens] unknown screen "' + name + '"');
      return;
    }
    var i, node;
    for (i = 0; i < SCREEN_NAMES.length; i++) {
      node = $('screen-' + SCREEN_NAMES[i]);
      if (node) { node.classList.remove('active'); }
    }
    node = $('screen-' + name);
    if (node) { node.classList.add('active'); }
    state.screen = name;

    if (name === 'ladder') {
      renderLadder(window.Save ? Save.data : null);
    } else if (name === 'team') {
      renderTeamSelect(state.teamOpts);
    } else if (name === 'battle') {
      maybeAutoShowRpsHint();
    }
  }

  function maybeAutoShowRpsHint() {
    if (!window.Save || !Save.data) { return; }
    if (Save.data.settings.seenRpsHint) { return; }
    Save.data.settings.seenRpsHint = true;
    Save.persist();
    setTimeout(function () { showSheet('rps-hint'); }, 400);
  }

  // === TOASTS ==============================================================
  function toast(msg) {
    var holder = $('toast-holder');
    if (!holder) { return; }
    while (holder.children.length >= 3) {
      holder.removeChild(holder.firstChild);
    }
    var node = el('div', 'toast', msg);
    holder.appendChild(node);
    setTimeout(function () {
      node.classList.add('hiding');
      setTimeout(function () {
        if (node.parentNode) { node.parentNode.removeChild(node); }
      }, 350);
    }, TOAST_MS);
  }

  // === SHEETS ==============================================================
  function showSheet(name) {
    if (SHEET_NAMES.indexOf(name) === -1) {
      console.warn('[Screens] unknown sheet "' + name + '"');
      return;
    }
    hideSheet();
    var sheet = $('sheet-' + name);
    var backdrop = $('sheet-backdrop');
    if (sheet) { sheet.classList.add('open'); }
    if (backdrop) { backdrop.classList.add('open'); }
  }

  function hideSheet() {
    for (var i = 0; i < SHEET_NAMES.length; i++) {
      var sheet = $('sheet-' + SHEET_NAMES[i]);
      if (sheet) { sheet.classList.remove('open'); }
    }
    var backdrop = $('sheet-backdrop');
    if (backdrop) { backdrop.classList.remove('open'); }
  }

  // === TITLE ===============================================================
  function hydrateTitle() {
    var input = $('input-player-name');
    if (input && window.Save && Save.data.playerName) {
      input.value = Save.data.playerName;
    }
    var list = window.SpriteEngine ? SpriteEngine.getAnimalList() : [];
    var starters = (window.GameData && GameData.STARTER_ANIMALS) ? GameData.STARTER_ANIMALS : list;
    var corrupt = (window.GameData && GameData.LOCKED_START) ? GameData.LOCKED_START : list;
    if (!list.length || !window.SpriteEngine) { return; }
    placeTitleSprite('title-sprite-left', pickRandom(starters), false);
    placeTitleSprite('title-sprite-mid', pickRandom(corrupt), true);
    placeTitleSprite('title-sprite-right', pickRandom(starters), false);
  }

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function placeTitleSprite(slotId, animalId, corrupted) {
    var slot = $(slotId);
    if (!slot || !animalId) { return; }
    slot.innerHTML = '';
    var img = SpriteEngine.createSpriteImg(animalId);
    if (corrupted) { img.classList.add('corrupted'); }
    slot.appendChild(img);
  }

  function onPlay() {
    var input = $('input-player-name');
    var name = input ? input.value.replace(/^\s+|\s+$/g, '') : '';
    if (!name) {
      toast('Enter your name to play!');
      if (input) { input.focus(); }
      return;
    }
    if (window.Save) { Save.patch({ playerName: name }); }
    show('mode');
  }

  // === PARTY SETUP (solo) ==================================================
  function toggleAlly(seatNum) {
    if (state.allies[seatNum]) {
      state.allies[seatNum] = null;
    } else {
      var pool = unlockedAnimalIds();
      var animal = pool.length ? pickRandom(pool) : 'dog';
      state.allies[seatNum] = {
        animal: animal,
        nick: window.SpriteEngine ? SpriteEngine.pickNickname(animal) : 'Ally'
      };
    }
    renderPartySeats();
  }

  function unlockedAnimalIds() {
    var list = window.SpriteEngine ? SpriteEngine.getAnimalList() : [];
    if (!window.Save) { return list; }
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (Save.isUnlocked(list[i])) { out.push(list[i]); }
    }
    return out;
  }

  function renderPartySeats() {
    var nameNode = $('party-name-1');
    if (nameNode) {
      nameNode.textContent = (window.Save && Save.data.playerName) ? Save.data.playerName : 'You';
    }
    var face1 = $('party-face-1');
    if (face1 && !face1.firstChild && window.SpriteEngine) {
      var pool = unlockedAnimalIds();
      if (pool.length) { face1.appendChild(SpriteEngine.createSpriteImg(pickRandom(pool))); }
    }
    for (var n = 2; n <= 3; n++) {
      var ally = state.allies[n];
      var toggleBtn = $('btn-ally-' + n);
      var filled = $('party-ally-' + n);
      if (!toggleBtn || !filled) { continue; }
      if (ally) {
        toggleBtn.hidden = true;
        filled.hidden = false;
        var face = $('party-face-' + n);
        if (face && window.SpriteEngine) {
          face.innerHTML = '';
          face.appendChild(SpriteEngine.createSpriteImg(ally.animal));
        }
        var nick = $('party-name-' + n);
        if (nick) { nick.textContent = ally.nick; }
      } else {
        toggleBtn.hidden = false;
        filled.hidden = true;
      }
    }
  }

  function getPartySetup() {
    var seats = [{ controller: 'human' }];
    if (state.allies[2]) { seats.push({ controller: 'ai' }); }
    if (state.allies[3]) { seats.push({ controller: 'ai' }); }
    return seats;
  }

  // === TEAM SELECT =========================================================
  function isLockedForSelect(animalId) {
    if (state.teamOpts && state.teamOpts.lockedIds) {
      return state.teamOpts.lockedIds.indexOf(animalId) !== -1;
    }
    if (window.Save) { return !Save.isUnlocked(animalId); }
    return false;
  }

  // opts: object = use these; null = CLEAR back to Save-based locking;
  // undefined (no arg) = keep whatever was last set.
  function renderTeamSelect(opts) {
    if (opts === null) { state.teamOpts = null; }
    else if (opts) { state.teamOpts = opts; }
    var grid = $('team-grid');
    if (!grid || !window.GameData || !window.SpriteEngine) { return; }
    grid.innerHTML = '';
    var list = SpriteEngine.getAnimalList();
    // drop picks that got locked (e.g. unlockMode turned back on)
    state.teamPicks = state.teamPicks.filter(function (id) {
      return !isLockedForSelect(id);
    });
    for (var i = 0; i < list.length; i++) {
      grid.appendChild(buildAnimalCard(list[i]));
    }
    updateTeamSlots();
  }

  function buildAnimalCard(id) {
    var a = GameData.ANIMALS[id];
    var locked = isLockedForSelect(id);
    var card = el('button', 'animal-card');
    card.type = 'button';
    card.setAttribute('data-animal', id);
    if (locked) { card.classList.add('locked'); }
    if (state.teamPicks.indexOf(id) !== -1) { card.classList.add('selected'); }

    var spr = el('div', 'card-sprite');
    spr.appendChild(SpriteEngine.createSpriteImg(id));
    card.appendChild(spr);
    card.appendChild(el('span', 'card-name', a ? a.name : id));

    var bars = el('div', 'card-bars');
    var stats = ['hp', 'atk', 'def', 'spd'];
    for (var i = 0; i < stats.length; i++) {
      var bar = el('i', 'bar bar-' + stats[i]);
      var fill = el('b');
      var val = a ? a[stats[i]] : 0;
      fill.style.transform = 'scaleX(' + Math.min(1, val / 100) + ')';
      bar.appendChild(fill);
      bars.appendChild(bar);
    }
    card.appendChild(bars);

    card.appendChild(el('span', 'card-check', '✓'));
    card.appendChild(svgIcon('icon-lock', 'lock-glyph'));
    card.appendChild(el('span', 'lock-label', 'Defeat to free!'));

    var takenMap = state.teamOpts && state.teamOpts.takenLabel;
    if (takenMap && takenMap[id]) {
      card.appendChild(el('span', 'card-taken', takenMap[id]));
    }

    attachCardInteractions(card, id, locked);
    return card;
  }

  // tap: select / (if already selected) open detail; long-press: detail
  function attachCardInteractions(card, id, locked) {
    var pressTimer = null;
    var longPressed = false;

    card.addEventListener('pointerdown', function () {
      longPressed = false;
      pressTimer = setTimeout(function () {
        longPressed = true;
        openAnimalDetail(id);
      }, LONG_PRESS_MS);
    });
    function cancelPress() {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    }
    card.addEventListener('pointerup', cancelPress);
    card.addEventListener('pointerleave', cancelPress);
    card.addEventListener('pointercancel', cancelPress);

    card.addEventListener('click', function () {
      if (longPressed) { longPressed = false; return; }
      if (locked) {
        toast('Defeat this corrupted champion to free it!');
        openAnimalDetail(id);
        return;
      }
      var idx = state.teamPicks.indexOf(id);
      if (idx !== -1) {
        openAnimalDetail(id);
        return;
      }
      if (state.teamPicks.length >= 3) {
        toast('Team is full - tap a slot to remove someone.');
        return;
      }
      state.teamPicks.push(id);
      syncCardSelection();
      updateTeamSlots();
    });
  }

  function removePick(id) {
    var idx = state.teamPicks.indexOf(id);
    if (idx !== -1) {
      state.teamPicks.splice(idx, 1);
      syncCardSelection();
      updateTeamSlots();
    }
  }

  function syncCardSelection() {
    var grid = $('team-grid');
    if (!grid) { return; }
    var cards = grid.children;
    for (var i = 0; i < cards.length; i++) {
      var id = cards[i].getAttribute('data-animal');
      cards[i].classList.toggle('selected', state.teamPicks.indexOf(id) !== -1);
    }
  }

  function updateTeamSlots() {
    for (var s = 1; s <= 3; s++) {
      var slot = $('team-slot-' + s);
      if (!slot) { continue; }
      slot.innerHTML = '';
      var id = state.teamPicks[s - 1];
      if (id) {
        slot.classList.add('filled');
        slot.appendChild(SpriteEngine.createSpriteImg(id));
        slot.appendChild(el('span', 'slot-name', SpriteEngine.getAnimalName(id)));
      } else {
        slot.classList.remove('filled');
        slot.textContent = '+';
      }
    }
    var count = $('team-count');
    if (count) { count.textContent = state.teamPicks.length + ' / 3'; }
    var ready = $('btn-team-ready');
    if (ready) { ready.disabled = state.teamPicks.length !== 3; }
  }

  function onTeamReady() {
    if (state.teamPicks.length !== 3) { return; }
    var team = state.teamPicks.slice();
    if (window.Save) { Save.patch({ partyPreset: team }); }
    if (state.mode === 'online') {
      callHook('onSetParty', [team]);
    } else {
      var parties = [{
        controller: 'human',
        name: (window.Save && Save.data.playerName) || 'You',
        team: team
      }];
      for (var n = 2; n <= 3; n++) {
        if (state.allies[n]) {
          parties.push({ controller: 'ai', name: state.allies[n].nick });
        }
      }
      callHook('onSoloStart', [{ parties: parties }]);
    }
  }

  // === ANIMAL DETAIL SHEET =================================================
  function openAnimalDetail(id) {
    var body = $('animal-detail-body');
    if (!body || !window.GameData) { return; }
    var a = GameData.ANIMALS[id];
    var moves = GameData.MOVES[id];
    if (!a || !moves) { return; }
    var locked = isLockedForSelect(id);
    body.innerHTML = '';

    var head = el('div', 'detail-head');
    var img = SpriteEngine.createSpriteImg(id);
    if (locked) { img.classList.add('corrupted'); }
    head.appendChild(img);
    var titleBox = el('div', 'detail-title');
    titleBox.appendChild(el('div', 'detail-name', a.name));
    var tags = el('div', 'detail-tags');
    tags.appendChild(el('span', 'detail-tag', a.archetype));
    tags.appendChild(el('span', 'detail-tag', a.class));
    titleBox.appendChild(tags);
    titleBox.appendChild(el('div', 'detail-desc', a.desc));
    head.appendChild(titleBox);
    body.appendChild(head);

    if (locked) {
      body.appendChild(el('div', 'detail-locked-note', 'CORRUPTED - Defeat to free!'));
    }

    var statsBox = el('div', 'detail-stats');
    var statDefs = [
      { key: 'hp', label: 'HP', cls: 'bar-hp' },
      { key: 'atk', label: 'ATK', cls: 'bar-atk' },
      { key: 'def', label: 'DEF', cls: 'bar-def' },
      { key: 'spd', label: 'SPD', cls: 'bar-spd' }
    ];
    for (var i = 0; i < statDefs.length; i++) {
      var d = statDefs[i];
      var row = el('div', 'stat-row');
      row.appendChild(el('span', 'stat-label', d.label));
      var bar = el('span', 'bar ' + d.cls);
      var fill = el('b');
      fill.style.transform = 'scaleX(' + Math.min(1, a[d.key] / 100) + ')';
      bar.appendChild(fill);
      row.appendChild(bar);
      row.appendChild(el('span', 'stat-val', String(a[d.key])));
      statsBox.appendChild(row);
    }
    body.appendChild(statsBox);

    var movesBox = el('div', 'detail-moves');
    var cats = ['attack', 'defense', 'special'];
    for (var m = 0; m < cats.length; m++) {
      var mv = moves[cats[m]];
      var moveRow = el('div', 'detail-move cat-' + cats[m]);
      moveRow.appendChild(svgIcon(catIconId(cats[m]), 'rps-icon'));
      var info = el('div', 'detail-move-info');
      var nm = mv.name + (mv.cd ? '  (CD ' + mv.cd + ')' : '');
      info.appendChild(el('div', 'detail-move-name', nm));
      info.appendChild(el('div', 'detail-move-desc', mv.desc));
      moveRow.appendChild(info);
      movesBox.appendChild(moveRow);
    }
    body.appendChild(movesBox);

    if (!locked && state.teamPicks.indexOf(id) !== -1) {
      var removeBtn = el('button', 'btn btn-secondary btn-wide', 'REMOVE FROM TEAM');
      removeBtn.addEventListener('click', function () {
        removePick(id);
        hideSheet();
      });
      body.appendChild(removeBtn);
    }

    showSheet('animal-detail');
  }

  // === LADDER ==============================================================
  function renderLadder(saveData) {
    var tower = $('ladder-tower');
    if (!tower || !window.GameData || !window.SpriteEngine) { return; }
    var ladder = (saveData && saveData.ladder) || { highestRungCleared: 0 };
    var highest = ladder.highestRungCleared || 0;
    tower.innerHTML = '';
    // flex-direction:column-reverse renders appended rung 1..8 bottom-up
    for (var i = 0; i < GameData.BOSSES.length; i++) {
      var boss = GameData.BOSSES[i];
      var status = 'locked';
      if (boss.rung <= highest) { status = 'beaten'; }
      else if (boss.rung === highest + 1) { status = 'current'; }
      tower.appendChild(buildRung(boss, status));
    }
    var current = tower.querySelector('.rung-current');
    if (current) {
      try { current.scrollIntoView({ block: 'center' }); } catch (e) { /* older browsers */ }
    }
  }

  function buildRung(boss, status) {
    var animalName = SpriteEngine.getAnimalName(boss.animal);
    var rung = el('div', 'rung rung-' + status + (boss.rung === 8 ? ' rung-final' : ''));
    rung.setAttribute('data-rung', String(boss.rung));

    var face = el('div', 'rung-face');
    if (status === 'current') {
      face.appendChild(el('div', 'boss-aura'));
    }
    // .rung-stage shrink-wraps the img so the eye overlay's % coords
    // (relative to the sprite box) line up, and layers above the aura.
    var stage = el('div', 'rung-stage');
    var img = SpriteEngine.createSpriteImg(boss.animal);
    if (status === 'current') { img.classList.add('corrupted'); }
    stage.appendChild(img);
    if (status === 'current' && boss.eyes) {
      var eyes = el('div', 'boss-eyes');
      eyes.style.setProperty('--eye-l', boss.eyes.l);
      eyes.style.setProperty('--eye-r', boss.eyes.r);
      stage.appendChild(eyes);
    }
    face.appendChild(stage);
    rung.appendChild(face);

    if (status === 'beaten') {
      rung.appendChild(el('div', 'rung-label', animalName.toUpperCase()));
      rung.appendChild(el('div', 'rung-sub', boss.name + ' - freed'));
    } else if (status === 'current') {
      rung.appendChild(el('div', 'rung-label', 'CORRUPTED ' + animalName.toUpperCase()));
      rung.appendChild(el('div', 'rung-sub', 'Rung ' + boss.rung + ' of 8'));
      var fightBtn = el('button', 'btn-fight', 'FIGHT');
      (function (rungNum) {
        fightBtn.addEventListener('click', function () {
          state.lastBossRung = rungNum;
          callHook('onFight', [rungNum]);
        });
      })(boss.rung);
      rung.appendChild(fightBtn);
    } else {
      rung.appendChild(el('div', 'rung-label', '? ? ?'));
      rung.appendChild(el('div', 'rung-sub', 'Rung ' + boss.rung));
    }
    return rung;
  }

  // === ONLINE: LOBBY + ROOM ================================================
  function onCreateRoom() {
    callHook('onCreateRoom', [(window.Save && Save.data.playerName) || 'Player']);
  }

  function onJoinRoom() {
    var input = $('input-join-code');
    var code = input ? input.value.replace(/\s+/g, '').toUpperCase() : '';
    if (!code) {
      toast('Enter a room code first.');
      if (input) { input.focus(); }
      return;
    }
    callHook('onJoinRoom', [code, (window.Save && Save.data.playerName) || 'Player']);
  }

  function renderRoom(lobbyState, opts) {
    lobbyState = lobbyState || {};
    opts = opts || {};
    state.lastRoom = { lobbyState: lobbyState, opts: opts };
    state.roomCode = lobbyState.code || '';

    var codeNode = $('room-code');
    if (codeNode) { codeNode.textContent = state.roomCode || '------'; }

    var titleNode = document.querySelector('#screen-room .screen-title');
    if (titleNode) {
      titleNode.textContent = lobbyState.rung ? 'ROOM · RUNG ' + lobbyState.rung : 'ROOM';
    }

    var seatsBox = $('room-seats');
    if (seatsBox) {
      seatsBox.innerHTML = '';
      var seats = lobbyState.seats || [];
      for (var i = 0; i < 3; i++) {
        seatsBox.appendChild(buildSeatCard(seats[i], i, opts));
      }
    }

    var startBtn = $('btn-room-start');
    if (startBtn) {
      startBtn.hidden = !opts.isHost;
      startBtn.disabled = !opts.isHost || !lobbyState.canStart;
    }
    var readyBtn = $('btn-room-ready');
    if (readyBtn) {
      var mySeat = (lobbyState.seats || [])[opts.mySeat];
      state.myReady = !!(mySeat && mySeat.ready);
      readyBtn.textContent = state.myReady ? 'UNREADY' : 'READY';
    }
  }

  function buildSeatCard(seat, index, opts) {
    if (!seat || (!seat.name && !seat.controller)) {
      var emptyCard = el('div', 'seat-card empty');
      emptyCard.appendChild(el('span', null, 'WAITING FOR PLAYER...'));
      if (opts && opts.isHost) {
        var aiBtn = el('button', 'btn-mini seat-ai-btn', '+ AI');
        aiBtn.type = 'button';
        aiBtn.addEventListener('click', function () {
          callHook('onSeatAiToggle', [index, true]);
        });
        emptyCard.appendChild(aiBtn);
      }
      return emptyCard;
    }
    var card = el('div', 'seat-card');
    if (seat.connected === false) { card.classList.add('disconnected'); }

    var face = el('div', 'seat-face');
    if (seat.faceAnimal && window.SpriteEngine) {
      face.appendChild(SpriteEngine.createSpriteImg(seat.faceAnimal));
    } else {
      face.appendChild(el('span', null, String(index + 1)));
    }
    card.appendChild(face);

    var info = el('div', 'seat-info');
    var label = seat.name || 'Player ' + (index + 1);
    if (opts && opts.mySeat === index) { label += ' (you)'; }
    info.appendChild(el('span', 'seat-name', label));
    info.appendChild(el('span', 'seat-sub',
      seat.connected === false ? 'Reconnecting...' : 'Seat ' + (index + 1)));
    card.appendChild(info);

    if (seat.controller === 'ai') {
      card.appendChild(el('span', 'seat-tag', 'AI'));
    }
    var chip = el('span', 'ready-chip' + (seat.ready ? '' : ' waiting'),
      seat.ready ? 'READY' : 'PICKING');
    card.appendChild(chip);
    if (seat.controller === 'ai' && opts && opts.isHost && !seat.peerId) {
      var rmBtn = el('button', 'btn-mini seat-ai-btn', String.fromCharCode(215));
      rmBtn.type = 'button';
      rmBtn.setAttribute('aria-label', 'Remove AI');
      rmBtn.addEventListener('click', function () {
        callHook('onSeatAiToggle', [index, false]);
      });
      card.appendChild(rmBtn);
    }
    return card;
  }

  function copyRoomCode() {
    var code = state.roomCode;
    if (!code) { return; }
    var done = function () { toast('Room code copied!'); };
    var fail = function () { toast('Code: ' + code); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(done, fail);
      } else {
        fail();
      }
    } catch (e) {
      fail();
    }
  }

  // === RESULT: VICTORY / DEFEAT ============================================
  function showVictory(opts) {
    opts = opts || {};
    var boss = opts.boss || null;
    if (boss) { state.lastBossRung = boss.rung; }

    var victory = $('result-victory');
    var defeat = $('result-defeat');
    if (victory) { victory.hidden = false; }
    if (defeat) { defeat.hidden = true; }

    var stage = $('restore-sprite');
    var burst = $('light-burst');
    var nameNode = $('restore-name');
    var lineNode = $('restore-line');
    var unlockedNode = $('result-unlocked');

    if (burst) { burst.classList.remove('run'); }
    if (lineNode) {
      lineNode.classList.remove('shown');
      lineNode.textContent = opts.restoreLine || (boss ? boss.restoreLine : '') || '';
    }
    if (unlockedNode) { unlockedNode.hidden = true; }

    var img = null;
    if (stage && boss && window.SpriteEngine) {
      stage.innerHTML = '';
      img = SpriteEngine.createSpriteImg(boss.animal);
      img.classList.add('corrupted');
      img.id = 'restore-img';
      stage.appendChild(img);
    }
    if (nameNode && boss) {
      nameNode.classList.remove('freed');
      nameNode.textContent = boss.name + ' ' + boss.title;
      var animalName = window.SpriteEngine
        ? SpriteEngine.getAnimalName(boss.animal) : boss.animal;
      nameNode.setAttribute('data-restored-name',
        animalName.toUpperCase() + ' RESTORED!');
    }

    show('result');

    // Default cinematic (classes only). battle-render passes defer:true
    // and drives these same hooks itself for the full sequence.
    if (!opts.defer) {
      setTimeout(function () {
        if (img) { img.classList.add('restored'); }
        if (burst) { burst.classList.add('run'); }
        setTimeout(function () {
          if (nameNode) {
            nameNode.textContent = nameNode.getAttribute('data-restored-name') || '';
            nameNode.classList.add('freed');
          }
          if (lineNode) { lineNode.classList.add('shown'); }
          if (unlockedNode && opts.unlocked) { unlockedNode.hidden = false; }
        }, 900);
      }, 600);
    }
  }

  function showDefeat(opts) {
    opts = opts || {};
    var boss = opts.boss || null;
    if (boss) { state.lastBossRung = boss.rung; }

    var victory = $('result-victory');
    var defeat = $('result-defeat');
    if (victory) { victory.hidden = true; }
    if (defeat) { defeat.hidden = false; }

    var stage = $('defeat-sprite');
    if (stage && boss && window.SpriteEngine) {
      stage.innerHTML = '';
      var img = SpriteEngine.createSpriteImg(boss.animal);
      img.classList.add('corrupted');
      stage.appendChild(img);
    }
    var line = $('defeat-line');
    if (line) {
      line.textContent = boss
        ? boss.name + ' ' + boss.title + ' still holds rung ' + boss.rung + '. Your party is fully healed - try again!'
        : 'The darkness holds... for now.';
    }
    show('result');
  }

  // === SETTINGS ============================================================
  function syncSettingsUI() {
    if (!window.Save) { return; }
    var s = Save.data.settings;
    var map = {
      'toggle-sfx': 'sfx',
      'toggle-reduce-motion': 'reduceMotion',
      'toggle-hide-ally-picks': 'hideAllyPicks',
      'toggle-unlock-mode': 'unlockMode'
    };
    for (var id in map) {
      if (Object.prototype.hasOwnProperty.call(map, id)) {
        var box = $(id);
        if (box) { box.checked = !!s[map[id]]; }
      }
    }
    document.body.classList.toggle('reduced-motion', !!s.reduceMotion);
  }

  function wireSetting(id, key, onChange) {
    on(id, 'change', function (e) {
      if (!window.Save) { return; }
      Save.data.settings[key] = !!e.target.checked;
      Save.persist();
      if (onChange) { onChange(!!e.target.checked); }
    });
  }

  function wireSettings() {
    wireSetting('toggle-sfx', 'sfx');
    wireSetting('toggle-reduce-motion', 'reduceMotion', function (val) {
      document.body.classList.toggle('reduced-motion', val);
    });
    wireSetting('toggle-hide-ally-picks', 'hideAllyPicks');
    wireSetting('toggle-unlock-mode', 'unlockMode', function (val) {
      renderTeamSelect(state.teamOpts);
      toast(val ? 'Animals must be freed to play them.' : 'All 24 animals unlocked!');
    });
    on('btn-save-reset', 'click', function () {
      var sure = window.confirm('Reset ALL save data? Ladder progress, unlocks and settings will be wiped.');
      if (!sure) { return; }
      if (window.Save) { Save.reset(); }
      hideSheet();
      syncSettingsUI();
      state.teamPicks = [];
      state.allies = { 2: null, 3: null };
      hydrateTitle();
      show('title');
      toast('Save data reset.');
    });
    on('btn-settings-close', 'click', hideSheet);
  }

  // === INIT ================================================================
  function wireOnce() {
    if (wired) { return; }
    wired = true;

    // title
    on('btn-play', 'click', onPlay);
    on('input-player-name', 'keydown', function (e) {
      if (e.key === 'Enter') { onPlay(); }
    });
    on('btn-title-settings', 'click', function () { showSheet('settings'); });

    // mode select
    on('btn-mode-back', 'click', function () { show('title'); });
    on('btn-mode-solo', 'click', function () {
      state.mode = 'solo';
      state.teamOpts = null;   // drop any online lockedIds/taken badges
      renderPartySeats();
      show('party');
    });
    on('btn-mode-online', 'click', function () {
      state.mode = 'online';
      show('lobby');
    });

    // party setup
    on('btn-party-back', 'click', function () { show('mode'); });
    on('btn-ally-2', 'click', function () { toggleAlly(2); });
    on('btn-ally-3', 'click', function () { toggleAlly(3); });
    on('btn-ally-remove-2', 'click', function () { toggleAlly(2); });
    on('btn-ally-remove-3', 'click', function () { toggleAlly(3); });
    on('btn-party-continue', 'click', function () { show('team'); });

    // lobby
    on('btn-lobby-back', 'click', function () {
      callHook('onLeaveRoom', []);
      show('mode');
    });
    on('btn-create-room', 'click', onCreateRoom);
    on('btn-join-room', 'click', onJoinRoom);
    on('input-join-code', 'keydown', function (e) {
      if (e.key === 'Enter') { onJoinRoom(); }
    });

    // room
    on('btn-room-leave', 'click', function () {
      callHook('onLeaveRoom', []);
      show('lobby');
    });
    // TEAM button (created once - index.html predates online co-op):
    // opens team select against the LOCAL player's own unlocked roster.
    var roomActions = document.querySelector('#screen-room .room-actions');
    if (roomActions && !$('btn-room-team')) {
      var teamBtn = el('button', 'btn btn-secondary', 'TEAM');
      teamBtn.id = 'btn-room-team';
      teamBtn.type = 'button';
      roomActions.insertBefore(teamBtn, roomActions.firstChild);
      teamBtn.addEventListener('click', function () {
        state.teamOpts = null;   // each player picks from their OWN unlocks
        renderTeamSelect(null);
        show('team');
      });
    }
    on('btn-copy-code', 'click', copyRoomCode);
    on('btn-room-ready', 'click', function () {
      state.myReady = !state.myReady;
      var btn = $('btn-room-ready');
      if (btn) { btn.textContent = state.myReady ? 'UNREADY' : 'READY'; }
      callHook('onReadyToggle', [state.myReady]);
    });
    on('btn-room-start', 'click', function () { callHook('onRoomStart', []); });

    // team select
    on('btn-team-back', 'click', function () {
      show(state.mode === 'online' ? 'room' : 'party');
    });
    on('btn-team-ready', 'click', onTeamReady);
    on('team-slot-1', 'click', function () { if (state.teamPicks[0]) { removePick(state.teamPicks[0]); } });
    on('team-slot-2', 'click', function () { if (state.teamPicks[1]) { removePick(state.teamPicks[1]); } });
    on('team-slot-3', 'click', function () { if (state.teamPicks[2]) { removePick(state.teamPicks[2]); } });

    // ladder
    on('btn-ladder-back', 'click', function () { show('mode'); });
    on('btn-settings', 'click', function () { showSheet('settings'); });

    // battle chrome owned here: ticker opens the log sheet, [?] the hint
    on('log-ticker', 'click', function () { showSheet('battle-log'); });
    on('btn-rps-hint', 'click', function () { showSheet('rps-hint'); });
    on('btn-rps-close', 'click', hideSheet);

    // result
    on('btn-victory-continue', 'click', function () { show('ladder'); });
    on('btn-defeat-retry', 'click', function () { callHook('onFight', [state.lastBossRung]); });
    on('btn-defeat-menu', 'click', function () { show('ladder'); });

    // sheets
    on('sheet-backdrop', 'click', hideSheet);

    wireSettings();
  }

  function init(newHooks) {
    hooks = newHooks || {};
    if (!inited) {
      inited = true;
      wireOnce();
      syncSettingsUI();
      hydrateTitle();
      renderPartySeats();
      if (window.Save && Save.data.partyPreset && Save.data.partyPreset.length === 3) {
        // a corrupt save could hold junk ids - keep only real animals
        state.teamPicks = Save.data.partyPreset.filter(function (id) {
          return !!(window.GameData && GameData.ANIMALS[id]);
        }).slice(0, 3);
      }
      show('title');
    }
    return api;
  }

  // Dev stub: if main.js hasn't been built yet, self-initialize with empty
  // hooks one tick after all scripts have run, so the page works standalone.
  setTimeout(function () {
    if (!inited) {
      console.warn('[Screens] main.js not detected - self-initializing with stub hooks.');
      init({});
    }
  }, 0);

  var api = {
    init: init,
    show: show,
    toast: toast,
    renderLadder: renderLadder,
    renderTeamSelect: renderTeamSelect,
    renderRoom: renderRoom,
    showSheet: showSheet,
    hideSheet: hideSheet,
    getPartySetup: getPartySetup,
    showVictory: showVictory,
    showDefeat: showDefeat
  };

  window.Screens = api;
})();

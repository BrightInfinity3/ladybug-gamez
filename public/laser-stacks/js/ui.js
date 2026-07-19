/* ============================================================
   Laser Stacks - UI Controller
   Screen management, rendering, event handling, game flow
   Trick-taking card game with bidding
   ============================================================ */

var UI = (function () {
  'use strict';

  // ---- Constants ----
  var NUM_TABLE_SEATS = 8;

  // ---- Setup State ----
  var setupSeats = [];
  var playerCount = 4; // Always 4 for Laser Stacks
  var pickerTargetSeat = -1;
  var addOrder = [];
  var gameFlowLocked = false;

  // ---- Phase State ----
  var gamePhase = 'none'; // 'none' | 'setup' | 'playing'

  // ---- Bidding State ----
  var currentBidValue = 0;

  // ---- Online State ----
  var _hostRequestSource = null;    // 'cascade' | 'voluntary' popup source
  var _waitingForRemote = false;    // host: stalled on a remote player's action
  var _pendingLobbySeatsRender = false;
  var _dealLock = false;            // guest: deal animation in progress
  var _onlineQueue = [];            // guest: events/syncs stashed during deal

  // ---- Canvas State ----
  var canvasReady = false;
  var handDisplay = {};    // playerId -> [{card, faceUp}]
  var trickDisplay = [];   // [{playerId, card, seatIndex}] current trick cards on table
  var resizeListenerAdded = false;

  // ---- Responsive Helpers (30's vmin system) ----
  // DOM-side vmin — must agree with Renderer.getVmin() so canvas geometry
  // and DOM overlays land on the same points.
  function getVmin() {
    var vw = document.documentElement.clientWidth || window.innerWidth;
    var vh = document.documentElement.clientHeight || window.innerHeight;
    return Math.min(vw, vh) / 100;
  }
  function getSetupAvatarSize() {
    return 7.8 * getVmin(); // matches .seat-avatar CSS (in-game size)
  }
  function getGameAvatarSize() {
    return 7.8 * getVmin(); // matches .game-seat-avatar CSS
  }
  // Card scale for flying/deal animations — same formula AND basis as
  // drawGameFrame (layout viewport, not window.inner*) so cards never
  // change size mid-flight. Reference: 1080p desktop.
  function getCardScale() {
    return 1.1 * (getVmin() * 100 / 1080);
  }

  // ---- View mode (round-3 simplification) ----
  // One proportional layout everywhere; the only responsive extra is the
  // pbar-active class, which shows the #pbar-message pill in the thumb
  // zone on portrait phones. The old lbar mode (shrunken felt, relocated
  // legend/counter) is gone — MK wants every screen to look the same.
  function isMobilePortrait() {
    return window.matchMedia('(orientation: portrait) and (max-width: 480px)').matches;
  }

  function updateLayoutMode() {
    var inGame = gamePhase === 'playing' &&
      document.getElementById('screen-game').classList.contains('active');
    document.body.classList.toggle('pbar-active', inGame && isMobilePortrait());
  }

  // ---- Unified viewport-change handler (ported from 30) ----
  // Rebuilds the canvas renderer and re-lays out DOM overlays. Called on
  // window.resize, orientationchange, and visualViewport.resize. On iOS,
  // the orientation event fires BEFORE the final layout is known, so we
  // re-run after short delays to catch the settled dimensions.
  function handleViewportChange() {
    if (!canvasReady) return;
    if (!document.getElementById('screen-game').classList.contains('active')) return;
    updateLayoutMode();
    Renderer.resize();
    // iPad keyboard fix: when a seat-name INPUT has focus, the
    // visualViewport.resize fired by the keyboard opening triggers this
    // handler. Re-rendering setup seats would destroy the input element
    // mid-typing, so skip the seat rebuild while an input is focused.
    var activeEl = document.activeElement;
    var inputFocused = activeEl && activeEl.tagName === 'INPUT';
    if (gamePhase === 'setup') {
      if (!inputFocused) renderSetupSeats();
    } else if (gamePhase === 'online-lobby') {
      if (!inputFocused) renderOnlineLobbySeats();
    } else {
      positionGameOverlays();
    }
  }

  function installViewportHandlers() {
    if (resizeListenerAdded) return;
    resizeListenerAdded = true;

    // Debounce: only run handleViewportChange after the dimensions have
    // been stable for ~100ms. Prevents expensive table-texture/particle
    // rebuilds during URL-bar animations or window drags.
    var debounceTimer = null;
    var lastW = 0, lastH = 0;
    function schedule() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        debounceTimer = null;
        // Compare the LAYOUT viewport (same basis as getVmin/renderer),
        // not window.inner* — on iPad Safari the URL-bar collapse can
        // move one without the other, and a swallowed event here means
        // Renderer.resize() never corrects the canvas (vertical squash).
        var w = document.documentElement.clientWidth || window.innerWidth;
        var h = document.documentElement.clientHeight || window.innerHeight;
        if (w === lastW && h === lastH) return; // no-op if nothing changed
        lastW = w; lastH = h;
        handleViewportChange();
      }, 100);
    }

    window.addEventListener('resize', schedule);

    // iOS Safari: orientationchange fires before layout settles; re-run on
    // a series of delayed ticks to catch the correct dimensions.
    window.addEventListener('orientationchange', function () {
      var forceRun = function () { lastW = -1; schedule(); };
      forceRun();
      setTimeout(forceRun, 100);
      setTimeout(forceRun, 300);
      setTimeout(forceRun, 600);
    });

    // visualViewport captures changes `resize` misses on mobile (URL bar
    // hiding/showing, keyboard, pinch-zoom).
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', schedule);
    }

    // Returning to a backgrounded tab can leave the WebGL canvas blank
    // (context lost without the event firing). Force a rebuild.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && canvasReady &&
          document.getElementById('screen-game').classList.contains('active')) {
        lastW = -1;
        schedule();
      }
    });
  }

  // Belt-and-suspenders pinch-zoom / double-tap-zoom blocker (from 30 —
  // iPad Safari ignores user-scalable=no and honors multi-touch gestures
  // even with touch-action set).
  function blockPinchZoom() {
    var prevent = function (e) { e.preventDefault(); };
    document.addEventListener('gesturestart',  prevent, { passive: false });
    document.addEventListener('gesturechange', prevent, { passive: false });
    document.addEventListener('gestureend',    prevent, { passive: false });
    document.addEventListener('touchstart', function (e) {
      if (e.touches && e.touches.length > 1) e.preventDefault();
    }, { passive: false });
    document.addEventListener('touchmove', function (e) {
      if (e.touches && e.touches.length > 1) e.preventDefault();
    }, { passive: false });
    document.addEventListener('dblclick', prevent, { passive: false });
    document.addEventListener('wheel', function (e) {
      if (e.ctrlKey) e.preventDefault();
    }, { passive: false });
  }

  // iPad keyboard scroll-persistence fix (from 30): iOS scrolls the window
  // to bring a focused input above the keyboard and can leave that scroll
  // stuck after the keyboard closes. Reset on blur and keyboard-close.
  function installKeyboardScrollReset() {
    var reset = function () {
      try {
        window.scrollTo(0, 0);
        if (document.body) document.body.scrollTop = 0;
        if (document.documentElement) document.documentElement.scrollTop = 0;
      } catch (e) { /* non-fatal */ }
    };
    document.addEventListener('focusout', function (e) {
      if (e.target && e.target.tagName === 'INPUT') {
        reset();
        setTimeout(reset, 50);
        setTimeout(reset, 200);
      }
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', function () {
        var ae = document.activeElement;
        if (!ae || ae.tagName !== 'INPUT') reset();
      });
    }
  }

  // ---- Initialize ----
  function init() {
    // Build stamp — matches the title-screen .build-tag; a device
    // logging an older number is running a cached build.
    console.log('[LaserStacks] build v2.5');
    initSetupSeats();
    bindEvents();
    bindOnlineEvents();
    createFloatingSuits();
    installViewportHandlers();
    blockPinchZoom();
    installKeyboardScrollReset();
    // Apply saved suit-style preference before any rendering happens
    var savedStyle = SaveSystem.getSuitStyle();
    if (Renderer && Renderer.setSuitStyle) Renderer.setSuitStyle(savedStyle);
    applySuitStyleToDom(savedStyle);
    syncOptionsButtons(savedStyle);
    renderOptionButtonPips();
    showScreen('screen-title');
  }

  function initSetupSeats() {
    setupSeats = [];
    for (var i = 0; i < NUM_TABLE_SEATS; i++) {
      setupSeats.push({
        occupied: false, animal: null, name: '', isHuman: false
      });
    }
  }

  // ---- Suit style (Options) ----
  function applySuitStyle(style) {
    style = (style === 'classic' || style === 'animals') ? style : 'laser';
    SaveSystem.setSuitStyle(style);
    if (Renderer && Renderer.setSuitStyle) Renderer.setSuitStyle(style);
    if (Renderer && Renderer.rebuildCardTextures && canvasReady) Renderer.rebuildCardTextures();
    applySuitStyleToDom(style);
    syncOptionsButtons(style);
    renderSuitPreview();
  }

  function syncOptionsButtons(style) {
    var btns = document.querySelectorAll('#opt-suit-style .opt-choice');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].getAttribute('data-value') === style) {
        btns[i].classList.add('opt-choice-active');
      } else {
        btns[i].classList.remove('opt-choice-active');
      }
    }
  }

  // Fill the Laser/Animals option buttons with real pip glyphs (matching
  // the Classic button's Unicode row), in hierarchy order best-to-worst.
  function renderOptionButtonPips() {
    var suits = ['clubs', 'spades', 'hearts', 'diamonds'];
    var subs = document.querySelectorAll('#opt-suit-style [data-style-sub]');
    var dpr = window.devicePixelRatio || 1;
    for (var i = 0; i < subs.length; i++) {
      var style = subs[i].getAttribute('data-style-sub');
      var html = '';
      for (var j = 0; j < suits.length; j++) {
        html += inlineLaserPipHtml(suits[j]);
      }
      subs[i].innerHTML = html;
      var pips = subs[i].querySelectorAll('canvas.inline-laser-pip');
      for (var k = 0; k < pips.length; k++) {
        var rect = pips[k].getBoundingClientRect();
        if (rect.width > 0) {
          pips[k].width = Math.round(rect.width * dpr * 2);
          pips[k].height = Math.round(rect.height * dpr * 2);
        }
        LaserPips.renderPipCanvas(pips[k], pips[k].getAttribute('data-inline-pip'), style);
      }
    }
  }

  // Card preview in Options — four sample 10s on a felt canvas, ported
  // from the solitaire games' renderSuitPreview. Shown in hierarchy
  // order (best suit first) since the hierarchy IS this game.
  function renderSuitPreview() {
    var canvas = document.getElementById('preview-canvas');
    if (!canvas) return;
    var c = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    c.clearRect(0, 0, w, h);

    var style = SaveSystem.getSuitStyle();
    var suits = ['clubs', 'spades', 'hearts', 'diamonds'];
    var sampleRank = '10';
    var cardW = 104, cardH = 148, gap = 18;
    var hasAlt = style !== 'classic';
    var labelLineH = 22, altLineH = hasAlt ? 20 : 0, labelGap = hasAlt ? 4 : 6;
    var labelsH = labelLineH + altLineH + labelGap;
    var totalContentH = labelsH + cardH;
    var totalW = suits.length * cardW + (suits.length - 1) * gap;
    var startX = (w / 2 - totalW / 2);
    var startY = (h / 2 - totalContentH / 2);

    for (var i = 0; i < suits.length; i++) {
      var cardCanvas = Renderer.renderCardToImage(sampleRank, suits[i]);
      var dx = startX + i * (cardW + gap);
      var cx = dx + cardW / 2;

      c.font = '700 18px "Cinzel", serif';
      c.fillStyle = '#d4a017';
      c.textAlign = 'center';
      c.textBaseline = 'bottom';
      c.fillText(LaserPips.getLabel(suits[i], style, true), cx, startY + labelLineH);

      if (hasAlt) {
        c.font = '700 15px "Cinzel", serif';
        c.fillText('(' + LaserPips.getLabel(suits[i], 'classic', true) + ')', cx, startY + labelLineH + altLineH);
      }

      var cardY = startY + labelsH;
      c.drawImage(cardCanvas, 0, 0, cardCanvas.width, cardCanvas.height, dx, cardY, cardW, cardH);
    }
  }

  function applySuitStyleToDom(style) {
    document.documentElement.setAttribute('data-suit-style', style);

    // Keep DOM suit colors (hand bar, legend, rules text) in lockstep with
    // the canvas card faces: drawn styles pull from the style's palette,
    // classic falls back to the stylesheet defaults (red/black).
    var rootStyle = document.documentElement.style;
    var suits = ['hearts', 'diamonds', 'spades', 'clubs'];
    for (var i = 0; i < suits.length; i++) {
      if (style !== 'classic') {
        rootStyle.setProperty('--suit-' + suits[i], LaserPips.getSuitColor(suits[i], style));
      } else {
        rootStyle.removeProperty('--suit-' + suits[i]);
      }
    }

    updateSuitStackLegend(style);
    updateRulesText(style);
  }

  function updateSuitStackLegend(style) {
    var items = document.querySelectorAll('#suit-stack .suit-stack-item');
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var suit = item.getAttribute('data-suit');
      var canvas = item.querySelector('canvas.suit-pip-canvas');
      if (style !== 'classic' && typeof LaserPips !== 'undefined') {
        if (!canvas) {
          canvas = document.createElement('canvas');
          canvas.className = 'suit-pip-canvas';
          item.appendChild(canvas);
        }
        // Match container's pixel size (x devicePixelRatio for retina)
        // so the pip is drawn at native resolution
        var dpr = window.devicePixelRatio || 1;
        var rect = item.getBoundingClientRect();
        var px = Math.max(32, Math.round((rect.width || 64) * dpr));
        var py = Math.max(32, Math.round((rect.height || 64) * dpr));
        canvas.width = px;
        canvas.height = py;
        LaserPips.renderPipCanvas(canvas, suit, style);
        item.classList.add('has-laser-pip');
      } else {
        item.classList.remove('has-laser-pip');
      }
    }
  }

  function inlineLaserPipHtml(suit) {
    return '<canvas class="inline-laser-pip" data-inline-pip="' + suit + '" width="22" height="28"></canvas>';
  }

  function suitToken(suit, style) {
    if (style !== 'classic') return inlineLaserPipHtml(suit);
    return '<strong class="suit-' + suit + '">' + CardSystem.SUIT_SYMBOLS[suit] + '</strong>';
  }

  function suitName(suit, style, plural) {
    return LaserPips.getLabel(suit, style, plural);
  }

  function updateRulesText(style) {
    // Suit hierarchy line
    var rankingP = document.querySelector('[data-rules-section="suit-ranking"]');
    if (rankingP) {
      rankingP.innerHTML = 'Suits are ranked: ' +
        suitToken('clubs', style) + ' ' + suitName('clubs', style, true) + ' &gt; ' +
        suitToken('spades', style) + ' ' + suitName('spades', style, true) + ' &gt; ' +
        suitToken('hearts', style) + ' ' + suitName('hearts', style, true) + ' &gt; ' +
        suitToken('diamonds', style) + ' ' + suitName('diamonds', style, true) + '.';
    }

    // Leading-a-stack line
    var leadingP = document.querySelector('[data-rules-section="leading"]');
    if (leadingP) {
      var diamondLead = (style !== 'classic')
        ? inlineLaserPipHtml('diamonds') + ' <strong>' + suitName('diamonds', style, false) + '</strong>'
        : '<strong class="suit-diamonds">&diams; Diamond</strong>';
      leadingP.innerHTML = 'The leader must play a ' + diamondLead + ' if they have one.';
    }

    // Following-suit fallback line
    var followingP = document.querySelector('[data-rules-section="following"]');
    if (followingP) {
      var clubsLabel = suitName('clubs', style, true);
      var clubsVerb = (style !== 'classic') ? 'are' : 'is';
      followingP.innerHTML = 'Otherwise, play a <strong>lower-ranked</strong> suit. If you can\'t, play the next higher suit. ' +
        clubsLabel + ' ' + clubsVerb + ' the last resort.';
    }

    // Winning-a-stack example line
    var winningP = document.querySelector('[data-rules-section="winning"]');
    if (winningP) {
      winningP.innerHTML = 'a 2' + suitToken('clubs', style) + ' beats a K' + suitToken('spades', style) +
        ', a 2' + suitToken('hearts', style) + ' beats a K' + suitToken('diamonds', style) + ', and so on.';
    }

    // Render any inline pip canvases that were just inserted
    if (style !== 'classic' && typeof LaserPips !== 'undefined') {
      var inlines = document.querySelectorAll('canvas.inline-laser-pip[data-inline-pip]');
      for (var i = 0; i < inlines.length; i++) {
        LaserPips.renderPipCanvas(inlines[i], inlines[i].getAttribute('data-inline-pip'), style);
      }
    }
  }

  // ---- Screen Management ----
  function showScreen(id) {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.remove('active');
    }
    var target = document.getElementById(id);
    if (target) target.classList.add('active');

    if (id !== 'screen-game' && canvasReady) {
      Renderer.stopLoop();
    }

    // View-mode classes only apply while the game screen is up
    updateLayoutMode();
  }

  // ---- Floating Suit Particles ----
  function createFloatingSuits() {
    var container = document.querySelector('.floating-suits');
    if (!container) return;
    var suits = ['\u2665', '\u2666', '\u2663', '\u2660'];
    for (var i = 0; i < 20; i++) {
      var el = document.createElement('div');
      el.className = 'float-suit';
      el.textContent = suits[i % 4];
      el.style.left = Math.random() * 100 + '%';
      el.style.animationDelay = Math.random() * 8 + 's';
      el.style.fontSize = (1 + Math.random() * 1.5) + 'rem';
      container.appendChild(el);
    }
  }

  // ---- Event Binding ----
  function bindEvents() {
    // Title screen
    document.getElementById('btn-play').addEventListener('click', function () {
      enterSetup();
    });
    document.getElementById('btn-how-to-play').addEventListener('click', function () {
      showScreen('screen-rules');
    });
    document.getElementById('btn-rules-back').addEventListener('click', function () {
      showScreen('screen-title');
    });

    // Options screen
    var btnOptions = document.getElementById('btn-options');
    if (btnOptions) {
      btnOptions.addEventListener('click', function () {
        syncOptionsButtons(SaveSystem.getSuitStyle());
        renderOptionButtonPips();
        showScreen('screen-options');
        renderSuitPreview();
      });
    }
    var btnOptionsBack = document.getElementById('btn-options-back');
    if (btnOptionsBack) {
      btnOptionsBack.addEventListener('click', function () { showScreen('screen-title'); });
    }
    var optChoices = document.querySelectorAll('#opt-suit-style .opt-choice');
    for (var oi = 0; oi < optChoices.length; oi++) {
      optChoices[oi].addEventListener('click', function () {
        var style = this.getAttribute('data-value');
        applySuitStyle(style);
      });
    }

    // Setup controls
    document.getElementById('btn-setup-back').addEventListener('click', function () {
      gamePhase = 'none';
      showScreen('screen-title');
    });
    document.getElementById('btn-deal').addEventListener('click', startGame);

    // Character picker
    document.getElementById('btn-picker-cancel').addEventListener('click', closePicker);

    // Bidding
    document.getElementById('bid-minus').addEventListener('click', function () {
      if (currentBidValue > 0) {
        currentBidValue--;
        document.getElementById('bid-value').textContent = currentBidValue;
      }
    });
    document.getElementById('bid-plus').addEventListener('click', function () {
      if (currentBidValue < Game.CARDS_PER_PLAYER) {
        currentBidValue++;
        document.getElementById('bid-value').textContent = currentBidValue;
      }
    });
    document.getElementById('bid-confirm').addEventListener('click', function () {
      submitHumanBid();
    });

    // Menu button (in-game). In online mode this is "leave the room".
    document.getElementById('btn-menu').addEventListener('click', function () {
      if (typeof Online !== 'undefined' && Online.isActive()) {
        openLeaveRoomConfirm();
        return;
      }
      document.getElementById('confirm-exit').style.display = 'flex';
    });
    document.getElementById('btn-confirm-yes').addEventListener('click', function () {
      document.getElementById('confirm-exit').style.display = 'none';
      gamePhase = 'none';
      Renderer.stopLoop();
      showScreen('screen-title');
    });
    document.getElementById('btn-confirm-no').addEventListener('click', function () {
      document.getElementById('confirm-exit').style.display = 'none';
    });

    // Results
    document.getElementById('btn-play-again').addEventListener('click', playAgain);
    document.getElementById('btn-new-game').addEventListener('click', function () {
      if (typeof Online !== 'undefined' && Online.isActive()) {
        openLeaveRoomConfirm();
        return;
      }
      document.getElementById('confirm-exit-results').style.display = 'flex';
    });
    document.getElementById('btn-confirm-results-yes').addEventListener('click', function () {
      document.getElementById('confirm-exit-results').style.display = 'none';
      gamePhase = 'none';
      showScreen('screen-title');
    });
    document.getElementById('btn-confirm-results-no').addEventListener('click', function () {
      document.getElementById('confirm-exit-results').style.display = 'none';
    });
  }

  // ================================================================
  //  SETUP PHASE
  // ================================================================

  function enterSetup() {
    gamePhase = 'setup';
    showScreen('screen-game');

    document.getElementById('setup-header').style.display = '';
    document.getElementById('btn-deal').style.display = '';
    document.getElementById('game-hud').style.display = 'none';
    document.getElementById('suit-stack').style.display = 'none';
    document.getElementById('trick-info').style.display = 'none';
    document.getElementById('hand-bar').style.display = 'none';
    document.getElementById('bid-overlay').style.display = 'none';

    var canvasEl = document.getElementById('game-canvas');
    var ready;
    if (!canvasReady) {
      ready = Renderer.init(canvasEl).then(function () {
        canvasReady = true;
      });
    } else {
      Renderer.resize();
      ready = Promise.resolve();
    }

    ready.then(function () {
      var felt = document.querySelector('#screen-game .table-felt');
      if (felt) felt.style.display = 'none';

      // Keep the loop running for particles/flying cards even with no game callback
      Renderer.startLoop(function () {});

      prepareSetupScreen();
    });
  }

  function prepareSetupScreen() {
    initSetupSeats();
    var title = document.getElementById('setup-title');
    title.textContent = 'Game Setup';

    playerCount = 4;
    if (!applySavedSetup()) autoFillSeats();
    renderSetupSeats();
    updateDealButton();
  }

  // Restore the last game's seat config (characters, names, human/AI)
  // instead of randomizing every time. Returns false if none/invalid.
  function applySavedSetup() {
    var saved = SaveSystem.loadSetup();
    if (!saved || !saved.length) return false;
    var animals = SpriteEngine.getAnimalList();
    var applied = 0;
    initSetupSeats();
    addOrder = [];
    for (var i = 0; i < saved.length; i++) {
      var s = saved[i];
      if (!s || typeof s.seatIndex !== 'number' || !s.animal) continue;
      if (s.seatIndex < 0 || s.seatIndex >= NUM_TABLE_SEATS) continue;
      if (animals.indexOf(s.animal) === -1) continue;
      setupSeats[s.seatIndex] = {
        occupied: true,
        animal: s.animal,
        name: s.name || getAnimalName(s.animal),
        isHuman: !!s.isHuman
      };
      addOrder.push(s.seatIndex);
      applied++;
    }
    if (applied !== 4) { initSetupSeats(); addOrder = []; return false; }
    return true;
  }

  function getRandomAnimal() {
    var animals = SpriteEngine.getAnimalList();
    var usedAnimals = setupSeats.filter(function (s) { return s.occupied; }).map(function (s) { return s.animal; });
    var available = animals.filter(function (a) { return usedAnimals.indexOf(a) === -1; });
    if (available.length === 0) available = animals;
    return available[Math.floor(Math.random() * available.length)];
  }

  // AI seat names come from the sprite engine's per-animal nickname pools
  function getAnimalName(animalId) {
    return SpriteEngine.pickNickname(animalId);
  }

  function autoFillSeats() {
    initSetupSeats();
    addOrder = [];

    // Place 4 players evenly: seats 0, 2, 4, 6
    var seatIndices = [0, 2, 4, 6];

    for (var k = 0; k < seatIndices.length; k++) {
      var idx = seatIndices[k];
      var animal = getRandomAnimal();
      setupSeats[idx].occupied = true;
      setupSeats[idx].animal = animal;
      setupSeats[idx].isHuman = (k === 0);
      setupSeats[idx].name = (k === 0) ? 'You' : getAnimalName(animal);
      addOrder.push(idx);
    }
  }

  function renderSetupSeats() {
    var ring = document.getElementById('seats-ring');
    ring.innerHTML = '';

    var positions;
    if (canvasReady) {
      positions = Renderer.getSeatPositions(NUM_TABLE_SEATS); // setup ring (bigger avatars)
    } else {
      // Pre-canvas fallback: identical tangent-orbit math, DOM-side
      var table = ring.parentElement;
      var w = table.offsetWidth || window.innerWidth;
      var h = table.offsetHeight || window.innerHeight;
      var vm = Math.min(w, h) / 100;
      var orbit = (28 + 2.5 + 3.9) * vm; // felt + wood + avatar radius
      var cx = w / 2, cy = h / 2 - 4 * vm;
      positions = [];
      for (var s = 0; s < NUM_TABLE_SEATS; s++) {
        var ang = (Math.PI / 2) + (s * 2 * Math.PI / NUM_TABLE_SEATS);
        positions.push({ x: cx + orbit * Math.cos(ang), y: cy + orbit * Math.sin(ang), angle: ang });
      }
    }

    for (var i = 0; i < NUM_TABLE_SEATS; i++) {
      var seat = setupSeats[i];
      if (!seat.occupied) continue; // Don't render empty seat slots
      var pos = positions[i];

      var el = document.createElement('div');
      el.className = 'seat';
      el.style.left = pos.x + 'px';
      el.style.top = (pos.y - getSetupAvatarSize() / 2) + 'px';
      el.dataset.seat = i;

      {
        var badge = document.createElement('div');
        badge.className = 'seat-type-badge ' + (seat.isHuman ? 'human' : 'ai');
        badge.textContent = seat.isHuman ? 'Human' : 'AI';
        badge.dataset.seat = i;
        badge.addEventListener('click', (function (idx) {
          return function (e) {
            e.stopPropagation();
            toggleHumanAI(idx);
          };
        })(i));
        el.appendChild(badge);
      }

      var avatar = document.createElement('div');
      avatar.className = 'seat-avatar';
      if (seat.animal) {
        avatar.appendChild(SpriteEngine.createSpriteImg(seat.animal));
        avatar.querySelector('img').style.width = '100%';
        avatar.querySelector('img').style.height = '100%';
      }
      el.appendChild(avatar);

      var nameEl = document.createElement('div');
      nameEl.className = 'seat-name';
      nameEl.textContent = seat.name;
      nameEl.dataset.seat = i;
      nameEl.addEventListener('click', (function (idx) {
        return function (e) {
          e.stopPropagation();
          startNameEdit(idx);
        };
      })(i));
      el.appendChild(nameEl);

      // Click to change character (no adding/removing — always 4)
      avatar.addEventListener('click', (function (idx) {
        return function () {
          if (setupSeats[idx].occupied) openPicker(idx);
        };
      })(i));

      ring.appendChild(el);
    }
  }

  function startNameEdit(seatIdx) {
    var nameEl = document.querySelector('.seat-name[data-seat="' + seatIdx + '"]');
    if (!nameEl) return;

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'seat-name-input';
    input.value = setupSeats[seatIdx].name;
    input.maxLength = 12;

    var parent = nameEl.parentElement;
    parent.replaceChild(input, nameEl);
    input.focus();
    input.select();

    function finishEdit() {
      var newName = input.value.trim() || setupSeats[seatIdx].name;
      setupSeats[seatIdx].name = newName;
      renderSetupSeats();
    }

    input.addEventListener('blur', finishEdit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = setupSeats[seatIdx].name; input.blur(); }
    });
  }

  function toggleHumanAI(seatIdx) {
    setupSeats[seatIdx].isHuman = !setupSeats[seatIdx].isHuman;
    renderSetupSeats();
    updateDealButton();
  }

  function updateDealButton() {
    var btn = document.getElementById('btn-deal');
    var occupied = setupSeats.filter(function (s) { return s.occupied; });
    var hasHuman = occupied.some(function (s) { return s.isHuman; });
    btn.disabled = occupied.length < 4 || !hasHuman;
  }

  // ---- Character Picker ----
  function openPicker(seatIdx) {
    pickerTargetSeat = seatIdx;
    var picker = document.getElementById('character-picker');
    var grid = document.getElementById('picker-grid');
    grid.innerHTML = '';

    var animals = SpriteEngine.getAnimalList();
    var usedAnimals = [];
    for (var i = 0; i < setupSeats.length; i++) {
      if (setupSeats[i].occupied && i !== seatIdx && setupSeats[i].animal) {
        usedAnimals.push(setupSeats[i].animal);
      }
    }

    for (var j = 0; j < animals.length; j++) {
      var animalId = animals[j];
      var taken = usedAnimals.indexOf(animalId) !== -1;

      var wrapper = document.createElement('div');
      wrapper.style.textAlign = 'center';

      var btn = document.createElement('div');
      btn.className = 'picker-animal' + (taken ? ' taken' : '');
      btn.appendChild(SpriteEngine.createSpriteImg(animalId));

      if (!taken) {
        btn.addEventListener('click', (function (aid) {
          return function () { selectAnimal(aid); };
        })(animalId));
      }

      wrapper.appendChild(btn);

      var label = document.createElement('div');
      label.className = 'picker-animal-name';
      label.textContent = SpriteEngine.getAnimalName(animalId);
      wrapper.appendChild(label);

      grid.appendChild(wrapper);
    }

    picker.style.display = 'flex';
  }

  function selectAnimal(animalId) {
    if (pickerTargetSeat < 0) return;
    setupSeats[pickerTargetSeat].animal = animalId;
    if (!setupSeats[pickerTargetSeat].isHuman) {
      setupSeats[pickerTargetSeat].name = getAnimalName(animalId);
    }
    closePicker();
    renderSetupSeats();
  }

  function closePicker() {
    document.getElementById('character-picker').style.display = 'none';
    pickerTargetSeat = -1;
  }

  // ================================================================
  //  GAME FLOW
  // ================================================================

  function startGame() {
    var players = [];
    var id = 0;
    var setupToSave = [];

    for (var i = 0; i < NUM_TABLE_SEATS; i++) {
      if (setupSeats[i].occupied) {
        var p = Game.createPlayer(
          id, i,
          setupSeats[i].animal,
          setupSeats[i].name,
          setupSeats[i].isHuman
        );
        players.push(p);
        id++;
        setupToSave.push({
          seatIndex: i,
          animal: setupSeats[i].animal,
          name: setupSeats[i].name,
          isHuman: setupSeats[i].isHuman
        });
      }
    }

    // Remember the table for next time
    SaveSystem.saveSetup(setupToSave);

    Game.setupGame(players);
    beginNewRound();
  }

  function beginNewRound() {
    var roundData = Game.newRound();
    startRoundFlow(roundData.dealOrder);
  }

  // Shared round flow — local play and BOTH online sides run this on
  // identical state: the shuffle is the only non-deterministic step, so
  // once the host's deck is synced, dealing/sorting/first-leader all
  // replay identically on every device.
  function startRoundFlow(dealOrder) {
    gamePhase = 'playing';
    showScreen('screen-game');
    document.getElementById('setup-header').style.display = 'none';
    document.getElementById('btn-deal').style.display = 'none';
    document.getElementById('game-hud').style.display = '';
    document.getElementById('suit-stack').style.display = '';
    document.getElementById('trick-info').style.display = '';
    document.getElementById('hand-bar').style.display = 'none';
    hideLobbyChrome();
    if (Online.isActive() && !Online.isHost()) _dealLock = true;

    // Re-render the legend now that the stack is laid out at its real size
    updateSuitStackLegend(SaveSystem.getSuitStyle());

    renderGameTable().then(function () {
      positionSuitStackAndTrickInfo();
      updateHUD();
      gameFlowLocked = true;
      setMessage('Dealing...');

      return Animations.delay(500);
    }).then(function () {
      return animateDealSequence(dealOrder);
    }).then(function () {
      Game.sortAllHands();

      // Sync hand display to sorted order (all face down on canvas)
      var gs = Game.getState();
      for (var i = 0; i < gs.players.length; i++) {
        var pid = gs.players[i].id;
        if (handDisplay[pid]) {
          var sortedHand = gs.hands[pid];
          handDisplay[pid] = [];
          for (var c = 0; c < sortedHand.length; c++) {
            handDisplay[pid].push({ card: sortedHand[c], faceUp: false });
          }
        }
      }
      Renderer.markDirty(); // post-deal re-sort renders with no tween running

      // Determine who leads: player with lowest card
      var lowest = Game.findLowestCardPlayer();
      Game.setFirstLeader(lowest.playerId);

      var leader = Game.getPlayerById(lowest.playerId);
      var verb = leader.isHuman ? ' have' : ' has';
      setMessage(leader.name + verb + ' the lowest card: ' + lowest.card.rank + lowest.card.symbol);

      return Animations.delay(1500);
    }).then(function () {
      // Show hand bar with cards visible so the human can see before bidding
      document.getElementById('hand-bar').style.display = '';
      renderHandBar();

      setMessage('Bidding phase');
      return Animations.delay(500);
    }).then(function () {
      // Start bidding
      Game.startBidding();
      _dealLock = false;
      if (Online.isActive() && !Online.isHost()) {
        guestBidPrompt();
        drainOnlineQueue();
      } else {
        processBidding();
      }
    }).catch(function (e) {
      // Surface flow errors — a silent rejection here freezes the round
      console.error('[LaserStacks] Round flow error:', e);
    });
  }

  // ---- Bidding Flow ----
  function processBidding() {
    var bidder = Game.getCurrentBidder();
    if (!bidder) {
      // All bids in — start playing
      setMessage('All bids in!');
      updateAllBidDisplays();
      return Animations.delay(1000).then(function () {
        Game.startPlaying();
        if (Online.isActive() && Online.isHost()) {
          Online.broadcastGameStateSync({ gameState: Game.serialize() });
        }
        gameFlowLocked = false;
        updateTrickInfo();
        nextTurn();
      });
    }

    highlightActivePlayer(bidder.id);

    if (bidder.isHuman) {
      // Online host: a remote human's bid arrives via player_action
      if (Online.isActive() && !Online.isMyPlayer(bidder.id)) {
        setMessage(bidder.name + ' is bidding...');
        gameFlowLocked = true;
        _waitingForRemote = true;
        return;
      }
      var humanCount = Game.getState().players.filter(function (p) { return p.isHuman; }).length;
      renderHandBar(bidder.id);
      // Show bid overlay
      currentBidValue = 0;
      document.getElementById('bid-value').textContent = '0';
      document.getElementById('bid-overlay').style.display = 'flex';
      setMessage(humanCount > 1 ? bidder.name + ' — place your bid!' : 'Place your bid!');
    } else {
      // AI bids
      setMessage(bidder.name + ' is thinking...');
      gameFlowLocked = true;

      Animations.delay(600 + Math.random() * 400).then(function () {
        var bid = Game.aiBid(bidder.id);
        Game.setBid(bidder.id, bid);
        if (Online.isActive() && Online.isHost()) {
          Online.broadcastGameAction({ type: 'action_bid', playerId: bidder.id, value: bid });
        }
        updateBidDisplay(bidder.id, bid);
        setMessage(bidder.name + ' bids ' + bid);

        return Animations.delay(600);
      }).then(function () {
        Game.advanceBid();
        processBidding();
      });
    }
  }

  function submitHumanBid() {
    document.getElementById('bid-overlay').style.display = 'none';
    var bidder = Game.getCurrentBidder();
    if (!bidder) return;

    // Online guest: the host is authoritative — send the bid and wait
    // for the echoed action_bid to advance our local state.
    if (Online.isActive() && !Online.isHost()) {
      Online.sendAction(bidder.id, { type: 'bid', value: currentBidValue });
      setMessage('You bid ' + currentBidValue);
      return;
    }

    hostApplyBid(bidder.id, currentBidValue);
  }

  // Apply a human bid on the authority (local play, or the online host
  // for both its own and remote players' bids)
  function hostApplyBid(playerId, value) {
    Game.setBid(playerId, value);
    if (Online.isActive() && Online.isHost()) {
      Online.broadcastGameAction({ type: 'action_bid', playerId: playerId, value: value });
    }
    updateBidDisplay(playerId, value);
    var bidPlayer = Game.getPlayerById(playerId);
    var mine = !Online.isActive() || Online.isMyPlayer(playerId);
    setMessage(mine ? 'You bid ' + value : bidPlayer.name + ' bids ' + value);

    Animations.delay(400).then(function () {
      Game.advanceBid();
      processBidding();
    });
  }

  // ---- Deal Animation ----
  // 30's v126 parallelized deal: cards within a round (one to each
  // player) fire with a short stagger and fly CONCURRENTLY; rounds stay
  // serialized for a clear visual rhythm. The old strictly-serial chain
  // was 40 x 200ms = ~8s per deal. Determinism note: Game.dealCardTo
  // runs inside each staggered timeout, so cards still leave the deck
  // in exact dealOrder — required for online replay.
  function animateDealSequence(dealOrder) {
    if (!dealOrder || !dealOrder.length) return Promise.resolve();

    // dealOrder is round-major (see Game.buildDealOrder): 10 rounds of
    // one card per player.
    var perRound = Math.max(1, (Game.getState().players || []).length || 4);
    var rounds = [];
    for (var r = 0; r * perRound < dealOrder.length; r++) {
      rounds.push(dealOrder.slice(r * perRound, (r + 1) * perRound));
    }

    var STAGGER = 50;            // ms between card starts within a round
    var INTER_ROUND_PAUSE = 50;  // ms breather between rounds

    function dealRound(roundIds) {
      var jobs = roundIds.map(function (playerId, idx) {
        return new Promise(function (resolve) {
          setTimeout(function () {
            var card = Game.dealCardTo(playerId);
            if (!card) { resolve(); return; }
            var player = Game.getPlayerById(playerId);
            animateCanvasDeal(card, playerId, player.seatIndex).then(resolve);
          }, idx * STAGGER);
        });
      });
      return Promise.all(jobs);
    }

    var seq = Promise.resolve();
    for (var rr = 0; rr < rounds.length; rr++) {
      (function (roundIds, isLast) {
        seq = seq.then(function () { return dealRound(roundIds); });
        if (!isLast) seq = seq.then(function () { return Animations.delay(INTER_ROUND_PAUSE); });
      })(rounds[rr], rr === rounds.length - 1);
    }
    return seq;
  }

  function animateCanvasDeal(card, playerId, seatIndex) {
    return new Promise(function (resolve) {
      var tableCenter = Renderer.getTableCenter();
      var seatPositions = Renderer.getSeatOverlayPositions(NUM_TABLE_SEATS);
      var seatPos = seatPositions[seatIndex];
      var handPos = Renderer.getHandPosition(seatPos, tableCenter);

      var fc = Renderer.addFlyingCard({
        card: card,
        faceUp: false,
        x: tableCenter.x,
        y: tableCenter.y,
        scale: getCardScale()
      });

      Renderer.animate(200, function (t) {
        var e = Renderer.easeOutCubic(t);
        fc.x = tableCenter.x + (handPos.x - tableCenter.x) * e;
        fc.y = tableCenter.y + (handPos.y - tableCenter.y) * e;
      }, function () {
        Renderer.removeFlyingCard(fc);
        if (!handDisplay[playerId]) handDisplay[playerId] = [];
        handDisplay[playerId].push({ card: card, faceUp: false });
        resolve();
      });
    });
  }

  // ---- Play Card Animation ----
  function animatePlayCard(card, playerId, seatIndex) {
    return new Promise(function (resolve) {
      var tableCenter = Renderer.getTableCenter();
      var seatPositions = Renderer.getSeatOverlayPositions(NUM_TABLE_SEATS);
      var seatPos = seatPositions[seatIndex];
      var handPos = Renderer.getHandPosition(seatPos, tableCenter);

      // Trick card position (2vmin ring — matches drawGameFrame)
      var trickOffset = 2 * getVmin();
      var trickX = tableCenter.x + Math.cos(seatPos.angle) * trickOffset;
      var trickY = tableCenter.y + Math.sin(seatPos.angle) * trickOffset;

      var fc = Renderer.addFlyingCard({
        card: card,
        faceUp: false,
        flipProgress: 0,
        x: handPos.x,
        y: handPos.y,
        scale: getCardScale()
      });

      Renderer.animate(400, function (t) {
        var e = Renderer.easeOutCubic(t);
        fc.x = handPos.x + (trickX - handPos.x) * e;
        fc.y = handPos.y + (trickY - handPos.y) * e;
        fc.flipProgress = Math.min(t * 2, 1);
      }, function () {
        Renderer.removeFlyingCard(fc);
        trickDisplay.push({ playerId: playerId, card: card, seatIndex: seatIndex });
        resolve();
      });
    });
  }

  // ---- Turn Flow ----
  function nextTurn() {
    var player = Game.getCurrentPlayer();
    if (!player) {
      endRound();
      return;
    }

    highlightActivePlayer(player.id);
    updateHUD();
    updateSuitDiagram();

    // Last stack: auto-play all cards automatically (only the authority
    // drives it — guests watch the plays arrive as action_play events)
    if (Game.isLastTrick()) {
      if (Online.isActive() && !Online.isHost()) {
        setMessage('Final Stack!');
        enableHandBar(false);
        gameFlowLocked = true;
        return;
      }
      autoPlayLastTrick(player);
      return;
    }

    if (player.isHuman) {
      // Online: another device's human — wait for their action
      if (Online.isActive() && !Online.isMyPlayer(player.id)) {
        setMessage(player.name + '\'s turn!');
        enableHandBar(false);
        gameFlowLocked = true;
        if (Online.isHost()) _waitingForRemote = true;
        return;
      }
      var humanCount = Game.getState().players.filter(function (p) { return p.isHuman; }).length;
      setMessage(humanCount > 1 ? player.name + '\'s turn!' : 'Your turn!');
      renderHandBar(player.id);
    } else {
      // Online guest: the AI runs on the host — we just watch
      if (Online.isActive() && !Online.isHost()) {
        enableHandBar(false);
        setMessage(player.name + ' is thinking...');
        gameFlowLocked = true;
        return;
      }
      enableHandBar(false);
      setMessage(player.name + ' is thinking...');
      gameFlowLocked = true;

      Animations.delay(600 + Math.random() * 600).then(function () {
        var cardIndex = Game.aiPlayCard(player.id);
        return executePlay(player.id, cardIndex);
      });
    }
  }

  // ---- Auto-play last stack ----
  function autoPlayLastTrick(firstPlayer) {
    setMessage('Final Stack!');
    gameFlowLocked = true;
    enableHandBar(false);

    function playNextCard() {
      var player = Game.getCurrentPlayer();
      if (!player) {
        endRound();
        return;
      }

      highlightActivePlayer(player.id);
      var cardIndex;
      if (player.isHuman) {
        // Auto-select the only legal play (or best one)
        var legalPlays = Game.getLegalPlays(player.id);
        cardIndex = legalPlays[0]; // Only legal cards available
      } else {
        cardIndex = Game.aiPlayCard(player.id);
      }

      Animations.delay(800).then(function () {
        return executePlay(player.id, cardIndex);
      });
    }

    playNextCard();
  }

  function humanPlayCard(cardIndex) {
    if (gameFlowLocked) return;
    var player = Game.getCurrentPlayer();
    if (!player || !player.isHuman) return;
    if (Online.isActive() && !Online.isMyPlayer(player.id)) return;

    var legalPlays = Game.getLegalPlays(player.id);
    if (legalPlays.indexOf(cardIndex) === -1) return;

    enableHandBar(false);
    gameFlowLocked = true;

    // Online guest: send to the host; our play comes back as action_play
    if (Online.isActive() && !Online.isHost()) {
      Online.sendAction(player.id, { type: 'playCard', cardIndex: cardIndex });
      return;
    }

    executePlay(player.id, cardIndex);
  }

  function executePlay(playerId, cardIndex) {
    var player = Game.getPlayerById(playerId);
    var card = Game.playCard(playerId, cardIndex);

    // Online host: let every guest replay the same play in parallel
    if (Online.isActive() && Online.isHost()) {
      Online.broadcastGameAction({
        type: 'action_play', playerId: playerId, cardIndex: cardIndex
      });
    }

    // Update hand display
    if (handDisplay[playerId]) {
      // Find and remove the card from hand display
      for (var i = 0; i < handDisplay[playerId].length; i++) {
        if (handDisplay[playerId][i].card === card ||
            (handDisplay[playerId][i].card.rank === card.rank &&
             handDisplay[playerId][i].card.suit === card.suit)) {
          handDisplay[playerId].splice(i, 1);
          break;
        }
      }
    }

    setMessage(player.name + ' plays ' + card.rank + card.symbol);

    return animatePlayCard(card, playerId, player.seatIndex).then(function () {
      // Refresh the bar with the player's own remaining hand (multi-human:
      // never flash another human's cards here)
      if (player.isHuman) renderHandBar(playerId);

      // Update tricks won display
      updateAllTrickDisplays();

      var currentTrick = Game.getCurrentTrick();

      if (currentTrick.length >= Game.getState().players.length) {
        // Trick complete — determine winner
        var trickWinnerId;
        return Animations.delay(600).then(function () {
          trickWinnerId = Game.determineTrickWinner();
          var winner = Game.getPlayerById(trickWinnerId);
          setMessage(winner.name + ' wins the Stack!');
          if (Online.isActive() && Online.isHost()) {
            Online.broadcastGameAction({
              type: 'trick_complete', winnerId: trickWinnerId, winnerName: winner.name
            });
          }

          // Highlight winner
          highlightActivePlayer(trickWinnerId);

          return Animations.delay(1200);
        }).then(function () {
          // Clear trick display
          trickDisplay = [];
          Renderer.markDirty();

          // Advance to next trick (pass the winner we already determined)
          Game.finishTrick(trickWinnerId);

          updateTrickInfo();
          updateAllTrickDisplays();

          // Online host: authoritative reconcile after every trick
          if (Online.isActive() && Online.isHost()) {
            Online.broadcastGameStateSync({ gameState: Game.serialize() });
          }

          if (Game.isRoundFinished()) {
            endRound();
          } else {
            gameFlowLocked = false;
            nextTurn();
          }
        });
      } else {
        // More players to play in this trick
        return Animations.delay(300).then(function () {
          var next = Game.advanceTrickTurn();
          if (!next) {
            endRound();
          } else if (Game.isLastTrick()) {
            // Continue auto-playing last trick
            var nextPlayer = Game.getCurrentPlayer();
            highlightActivePlayer(nextPlayer.id);
            var ci;
            if (nextPlayer.isHuman) {
              var lp = Game.getLegalPlays(nextPlayer.id);
              ci = lp[0];
            } else {
              ci = Game.aiPlayCard(nextPlayer.id);
            }
            Animations.delay(800).then(function () {
              executePlay(nextPlayer.id, ci);
            });
          } else {
            gameFlowLocked = false;
            nextTurn();
          }
        });
      }
    });
  }

  function endRound() {
    gameFlowLocked = true;
    enableHandBar(false);
    document.getElementById('hand-bar').style.display = 'none';

    Animations.delay(1000).then(function () {
      showResults();
    });
  }

  function playAgain() {
    trickDisplay = [];
    Renderer.markDirty();
    if (Online.isActive()) {
      if (!Online.isHost()) return; // guests wait for the host's deal
      onlineBeginRound();
      return;
    }
    beginNewRound();
  }

  // ================================================================
  //  HAND BAR (Human Player's Clickable Cards)
  // ================================================================

  function renderHandBar(targetPlayerId) {
    var container = document.getElementById('hand-bar-cards');
    container.innerHTML = '';

    var gs = Game.getState();
    // Find the target player (or first human)
    var humanPlayer = null;
    if (targetPlayerId !== undefined) {
      humanPlayer = Game.getPlayerById(targetPlayerId);
    } else {
      for (var i = 0; i < gs.players.length; i++) {
        if (gs.players[i].isHuman) {
          humanPlayer = gs.players[i];
          break;
        }
      }
    }
    // ONLINE: this bar is THIS device's private surface. Hands are
    // full-state-synced to every device, so rendering any other seat's
    // hand here leaks their cards — override whatever the caller asked
    // for with the local device's own player (bar stays empty for
    // unseated observers).
    if (Online.isActive()) {
      var myDevId = Online.getMyDeviceId();
      humanPlayer = null;
      for (var d = 0; d < gs.players.length; d++) {
        if (gs.players[d].deviceId === myDevId) { humanPlayer = gs.players[d]; break; }
      }
    }
    if (!humanPlayer) return;

    var hand = Game.getHand(humanPlayer.id);
    if (!hand) return;

    var legalPlays = [];
    if (gs.roundPhase === 'playing' && Game.getCurrentPlayer() &&
        Game.getCurrentPlayer().id === humanPlayer.id) {
      legalPlays = Game.getLegalPlays(humanPlayer.id);
    }

    var barSuitStyle = SaveSystem.getSuitStyle();
    var drawnStyle = barSuitStyle !== 'classic';

    for (var j = 0; j < hand.length; j++) {
      var card = hand[j];
      var isLegal = legalPlays.indexOf(j) !== -1;

      var cardEl = document.createElement('div');
      cardEl.className = 'hand-card suit-' + card.suit;
      if (isLegal) {
        cardEl.classList.add('legal');
      } else if (legalPlays.length > 0) {
        cardEl.classList.add('illegal');
      }

      // Drawn styles show the actual pip art in place of the Unicode symbol
      // (hydrated at native resolution after the loop, once in the DOM)
      var suitHtml = drawnStyle
        ? inlineLaserPipHtml(card.suit)
        : card.symbol;
      cardEl.innerHTML = '<span class="hc-rank">' + card.rank + '</span>' +
                          '<span class="hc-suit">' + suitHtml + '</span>';

      cardEl.dataset.cardIndex = j;
      // Use both click and touchend for reliable iPad/iOS support
      var cardHandler = (function (idx, legal) {
        var handled = false;
        return function (e) {
          if (handled) return;
          if (legal) {
            handled = true;
            if (e.type === 'touchend') e.preventDefault(); // prevent ghost click
            humanPlayCard(idx);
            setTimeout(function () { handled = false; }, 300);
          }
        };
      })(j, isLegal);
      cardEl.addEventListener('click', cardHandler);
      cardEl.addEventListener('touchend', cardHandler);

      container.appendChild(cardEl);
    }

    // Hydrate pip canvases at native resolution: backing store = displayed
    // rect x devicePixelRatio x2 (supersampled like the legend), so the
    // bar's pips are as crisp as the pre-rendered card faces.
    if (drawnStyle) {
      var dpr = window.devicePixelRatio || 1;
      var pips = container.querySelectorAll('canvas.inline-laser-pip[data-inline-pip]');
      for (var q = 0; q < pips.length; q++) {
        var rect = pips[q].getBoundingClientRect();
        if (rect.width > 0) {
          pips[q].width = Math.round(rect.width * dpr * 2);
          pips[q].height = Math.round(rect.height * dpr * 2);
        }
        LaserPips.renderPipCanvas(pips[q], pips[q].getAttribute('data-inline-pip'), barSuitStyle);
      }
    }
  }

  function enableHandBar(enabled) {
    if (enabled) {
      renderHandBar();
    }
    // When disabled, re-render without legal highlights
    if (!enabled) {
      var cards = document.querySelectorAll('.hand-card');
      for (var i = 0; i < cards.length; i++) {
        cards[i].classList.remove('legal');
        cards[i].classList.add('illegal');
      }
    }
  }

  // ================================================================
  //  GAME RENDERING
  // ================================================================

  function renderGameTable() {
    var canvasEl = document.getElementById('game-canvas');

    var ready;
    if (!canvasReady) {
      ready = Renderer.init(canvasEl).then(function () {
        canvasReady = true;
      });
    } else {
      Renderer.resize();
      ready = Promise.resolve();
    }

    return ready.then(function () {
      var felt = document.querySelector('#screen-game .table-felt');
      if (felt) felt.style.display = 'none';

      // Game phase is live now — apply the portrait message mode
      updateLayoutMode();

      handDisplay = {};
      trickDisplay = [];
      Renderer.clearFlyingCards();

      var ring = document.getElementById('seats-ring');
      ring.innerHTML = '';

      var players = Game.getState().players;
      var overlayPositions = Renderer.getSeatOverlayPositions(NUM_TABLE_SEATS);

      for (var i = 0; i < players.length; i++) {
        var p = players[i];
        var pos = overlayPositions[p.seatIndex];

        var seat = document.createElement('div');
        // Top & bottom seats show their statline beside the avatar
        var extra = '';
        if (p.seatIndex === 0) extra = ' seat-bottom seat-sidestat';
        else if (p.seatIndex === 4) extra = ' seat-top seat-sidestat';
        seat.className = 'game-seat' + extra;
        seat.dataset.player = p.id;
        seat.style.left = pos.x + 'px';
        seat.style.top = (pos.y - getGameAvatarSize() / 2) + 'px';

        var topRow = document.createElement('div');
        topRow.className = 'game-seat-top';

        var avatarWrap = document.createElement('div');
        avatarWrap.className = 'game-seat-avatar';
        avatarWrap.appendChild(SpriteEngine.createSpriteImg(p.animal));
        // Host recovery hatch: mid-game, the host can tap a seat to
        // reassign it (AI / host / unseated joiner). openReassignPopup
        // refuses seats held by connected guests, so this only ever
        // touches AI seats, the host's own, or orphaned seats whose
        // device dropped (page refresh) — no kicking live players.
        if (Online.isActive() && Online.isHost()) {
          avatarWrap.style.pointerEvents = 'auto';
          avatarWrap.style.cursor = 'pointer';
          avatarWrap.addEventListener('click', (function (seatIdx) {
            return function () { openReassignPopup(seatIdx); };
          })(p.seatIndex));
        }
        topRow.appendChild(avatarWrap);

        seat.appendChild(topRow);

        // Name
        var nameEl = document.createElement('div');
        nameEl.className = 'game-seat-name';
        nameEl.textContent = p.name;
        seat.appendChild(nameEl);

        // Combined bid + tricks display (single line, bigger)
        var statLine = document.createElement('div');
        statLine.className = 'game-seat-statline';
        statLine.dataset.bid = p.id;
        statLine.dataset.tricks = p.id;
        statLine.textContent = '\u00a0';
        statLine.style.visibility = 'hidden';
        seat.appendChild(statLine);

        ring.appendChild(seat);

        handDisplay[p.id] = [];
      }

      // Start render loop
      Renderer.startLoop(drawGameFrame);
    });
  }

  // ---- Canvas Render Callback ----
  function drawGameFrame(ctx, W, H) {
    var gs = Game.getState();
    if (!gs || !gs.players) return;

    var tableCenter = Renderer.getTableCenter();
    var seatPositions = Renderer.getSeatOverlayPositions(NUM_TABLE_SEATS);
    var vminPx = Math.min(W, H) / 100;
    // Proportional card sizing (30's system): same fraction of the table
    // on every device instead of huge cards on phones.
    var viewScale = Math.min(W, H) / 1080;
    var cardScale = 1.1 * viewScale;
    var cardSpacing = 28.6 * viewScale;
    var CARDS_PER_ROW = 5;
    var ROW_INSET = 26.4 * viewScale;

    // Draw deck pile at table center (only during dealing)
    if (gs.roundPhase === 'dealing') {
      Renderer.drawDeck(tableCenter.x, tableCenter.y, Game.getDeckCount());
    }

    // Draw each player's hand cards on canvas (face down for all —
    // the human's fan mirrors the count of the playable hand in the bar)
    for (var i = 0; i < gs.players.length; i++) {
      var p = gs.players[i];

      var seatPos = seatPositions[p.seatIndex];
      var handPos = Renderer.getHandPosition(seatPos, tableCenter);
      var display = handDisplay[p.id];
      if (!display || display.length === 0) continue;

      var numCards = display.length;
      var towardCenterDx = tableCenter.x - seatPos.x;
      var towardCenterDy = tableCenter.y - seatPos.y;
      var dist = Math.sqrt(towardCenterDx * towardCenterDx + towardCenterDy * towardCenterDy);
      var nDx = dist > 0 ? towardCenterDx / dist : 0;
      var nDy = dist > 0 ? towardCenterDy / dist : 0;

      var perpAngle = seatPos.angle + Math.PI / 2;
      var dx = Math.cos(perpAngle);
      var dy = Math.sin(perpAngle);

      for (var j = 0; j < numCards; j++) {
        var cd = display[j];
        var row = Math.floor(j / CARDS_PER_ROW);
        var colInRow = j % CARDS_PER_ROW;

        var rowOffsetX = nDx * row * ROW_INSET;
        var rowOffsetY = nDy * row * ROW_INSET;

        // Center each row: top 4 cards centered between bottom 5
        var rowSize = (row === 0) ? Math.min(CARDS_PER_ROW, numCards) : (numCards - CARDS_PER_ROW);
        var offset = (colInRow - (rowSize - 1) / 2) * cardSpacing;
        var cardX = handPos.x + dx * offset + rowOffsetX;
        var cardY = handPos.y + dy * offset + rowOffsetY;

        var cardRotation = seatPos.angle - Math.PI / 2;
        Renderer.drawCard(cardX, cardY, cd.card, cd.faceUp, cardRotation, cardScale, 0.3);
      }
    }

    // Draw trick cards in center (2vmin ring keeps the pile compact and
    // clear of every hand fan)
    for (var t = 0; t < trickDisplay.length; t++) {
      var td = trickDisplay[t];
      var tdSeatPos = seatPositions[td.seatIndex];
      var trickOffset = 2 * vminPx;
      var trickX = tableCenter.x + Math.cos(tdSeatPos.angle) * trickOffset;
      var trickY = tableCenter.y + Math.sin(tdSeatPos.angle) * trickOffset;
      var trickRotation = tdSeatPos.angle - Math.PI / 2;

      Renderer.drawCard(trickX, trickY, td.card, true, trickRotation, cardScale, 0.3);
    }
  }

  function positionGameOverlays() {
    var gs = Game.getState();
    if (!gs || !gs.players) return;
    var overlayPositions = Renderer.getSeatOverlayPositions(NUM_TABLE_SEATS);

    for (var i = 0; i < gs.players.length; i++) {
      var p = gs.players[i];
      var pos = overlayPositions[p.seatIndex];
      var seat = document.querySelector('.game-seat[data-player="' + p.id + '"]');
      if (seat) {
        seat.style.left = pos.x + 'px';
        seat.style.top = (pos.y - getGameAvatarSize() / 2) + 'px';
      }
    }

    // Reposition suit diagram and trick counter above their respective players
    positionSuitStackAndTrickInfo();

    // Legend pip canvases render at their CSS pixel size — refresh them
    // so a resize doesn't leave them blurry (they're vmin-sized).
    if (gamePhase === 'playing') {
      updateSuitStackLegend(SaveSystem.getSuitStyle());
    }
  }

  // Positions the suit legend above the LEFT avatar and the stack
  // counter above the RIGHT avatar — same rule on every screen size.
  function positionSuitStackAndTrickInfo() {
    var suitStack = document.getElementById('suit-stack');
    var trickInfo = document.getElementById('trick-info');

    var seatPositions = Renderer.getSeatOverlayPositions(NUM_TABLE_SEATS);
    var avatarHalf = getGameAvatarSize() / 2;
    var vmin = getVmin();
    var breathingRoom = 1.5 * vmin; // gap between panel bottom and avatar top
    // Never ride up into the HUD: on short-landscape phones the rem
    // floors make the panels taller than pure vmin proportions, so the
    // above-the-avatar spot can run out of headroom. Trading away the
    // breathing room (sliding down toward the avatar) beats overlapping
    // the HUD text.
    var hud = document.querySelector('.game-hud');
    var hudBottom = hud ? hud.getBoundingClientRect().bottom : 0;
    var minTop = Math.max(0.8 * vmin, hudBottom + 0.5 * vmin);

    // Suit hierarchy legend sits directly above the LEFT player's avatar
    // (seat 2 of the 8-slot ring; the 4-player layout uses slots 0/2/4/6)
    if (suitStack) {
      var wasHidden = suitStack.style.display === 'none';
      if (wasHidden) suitStack.style.visibility = 'hidden';
      if (wasHidden) suitStack.style.display = '';
      var ssW = suitStack.offsetWidth || 60;
      var ssH = suitStack.offsetHeight || 180;
      if (wasHidden) suitStack.style.display = 'none';
      if (wasHidden) suitStack.style.visibility = '';

      var leftSeat = seatPositions[2];
      suitStack.style.left = (leftSeat.x - ssW / 2) + 'px';
      suitStack.style.top = Math.max(minTop, leftSeat.y - avatarHalf - breathingRoom - ssH) + 'px';
    }

    // Stack counter mirrors it above the RIGHT player's avatar (seat 6),
    // keeping the felt center clear for the trick pile
    if (trickInfo) {
      var wasHidden2 = trickInfo.style.display === 'none';
      if (wasHidden2) trickInfo.style.visibility = 'hidden';
      if (wasHidden2) trickInfo.style.display = '';
      var tiW = trickInfo.offsetWidth || 80;
      var tiH = trickInfo.offsetHeight || 60;
      if (wasHidden2) trickInfo.style.display = 'none';
      if (wasHidden2) trickInfo.style.visibility = '';

      var rightSeat = seatPositions[6];
      trickInfo.style.left = (rightSeat.x - tiW / 2) + 'px';
      trickInfo.style.top = Math.max(minTop, rightSeat.y - avatarHalf - breathingRoom - tiH) + 'px';
    }
  }

  function highlightActivePlayer(playerId) {
    var seats = document.querySelectorAll('.game-seat');
    for (var i = 0; i < seats.length; i++) {
      seats[i].classList.remove('active');
      if (seats[i].dataset.player == playerId) {
        seats[i].classList.add('active');
      }
    }
  }

  function updateBidDisplay(playerId, bid) {
    updateStatLine(playerId);
  }

  function updateAllBidDisplays() {
    var gs = Game.getState();
    for (var i = 0; i < gs.players.length; i++) {
      updateStatLine(gs.players[i].id);
    }
  }

  function updateTrickDisplay(playerId) {
    updateStatLine(playerId);
  }

  function updateAllTrickDisplays() {
    var gs = Game.getState();
    for (var i = 0; i < gs.players.length; i++) {
      updateStatLine(gs.players[i].id);
    }
  }

  // Single-line combined bid + tricks display
  function updateStatLine(playerId) {
    var el = document.querySelector('.game-seat-statline[data-bid="' + playerId + '"]');
    if (!el) return;

    var bid = Game.getBids()[playerId];
    var won = Game.getTricksWon()[playerId] || 0;
    var gs = Game.getState();

    if (bid === undefined) {
      el.textContent = '\u00a0';
      el.style.visibility = 'hidden';
      return;
    }

    el.style.visibility = 'visible';
    if (gs.roundPhase === 'bidding') {
      el.innerHTML = 'Bid: <span class="stat-number">' + bid + '</span>';
    } else {
      el.innerHTML = 'Bid: <span class="stat-number">' + bid + '</span> \u00a0 <span class="stat-number">' + won + '</span>/' + bid;
    }
  }

  function updateTrickInfo() {
    var el = document.getElementById('hud-trick');
    if (el) el.textContent = Game.getTrickNumber() + 1;
  }

  function updateSuitDiagram() {
    var unlocked = Game.getUnlockedSuits();
    var items = document.querySelectorAll('.suit-stack-item');
    for (var i = 0; i < items.length; i++) {
      if (items[i].dataset.suit) {
        if (unlocked[items[i].dataset.suit]) {
          items[i].classList.add('unlocked');
          items[i].classList.remove('locked');
        } else {
          items[i].classList.add('locked');
          items[i].classList.remove('unlocked');
        }
      }
    }
  }

  function updateHUD() {
    document.getElementById('hud-round').textContent = Game.getRoundNumber();
    updateTrickInfo();
    var roomRow = document.getElementById('hud-room-row');
    if (roomRow) {
      if (Online.isActive() && gamePhase === 'playing') {
        var code = (Online.getLobbyState() && Online.getLobbyState().roomCode) || '---';
        document.getElementById('hud-room-code').textContent = code;
        roomRow.style.display = '';
      } else {
        roomRow.style.display = 'none';
      }
    }
  }

  function setMessage(msg) {
    document.getElementById('hud-message').textContent = msg;
    // Portrait mode mirrors the message just above the hand bar, where the
    // player is actually looking (the top HUD is far away on a tall phone)
    var pbarMsg = document.getElementById('pbar-message');
    if (pbarMsg) pbarMsg.textContent = msg;
  }

  // ================================================================
  //  ONLINE MODE (ported from 30 — host-authoritative)
  // ================================================================

  // Reset the online-screen forms back to a fresh / clickable state.
  function resetOnlineScreen() {
    if (typeof Online !== 'undefined' && Online.isActive && Online.isActive()) {
      try { Online.cleanup(); } catch (e) {}
    }
    var joinStatus = document.getElementById('join-status');
    var hostStatus = document.getElementById('host-status');
    if (joinStatus) { joinStatus.textContent = ''; joinStatus.className = 'online-status'; }
    if (hostStatus) { hostStatus.textContent = ''; hostStatus.className = 'online-status'; }
    var btnJoin = document.getElementById('btn-join-room');
    var btnHost = document.getElementById('btn-create-room');
    if (btnJoin) btnJoin.disabled = false;
    if (btnHost) btnHost.disabled = false;
  }

  // The full callback set — registered on BOTH host and join flows so a
  // migrated ex-host keeps receiving guest-side messages (30's v115 fix).
  function registerOnlineCallbacks() {
    Online.onGameStart(onlineBeginGame);
    Online.onAction(onlineHandleRemoteAction);
    Online.onGameAction(onlineHandleGameAction);
    Online.onGameStateSync(onlineHandleStateSync);
    Online.onMidGameEntry(enterGameInProgress);
    Online.onRenderLobby(renderOnlineLobbySeats);
    // Fired after the host reassigns a seat controller — un-stall the
    // turn/bid loop if we were waiting on the departed player.
    Online.onHostAutoPlay(function () {
      if (!Online.isHost() || gamePhase !== 'playing') return;
      if (_waitingForRemote) {
        _waitingForRemote = false;
        gameFlowLocked = false;
        if (Game.getState().roundPhase === 'bidding') processBidding();
        else nextTurn();
      }
    });
    Online.onHostTakeover(function (opts) {
      opts = opts || {};
      if (gamePhase === 'online-lobby') renderOnlineLobbySeats();
      updateHUD();
      if (opts.becameHost && gamePhase === 'playing') {
        gameFlowLocked = false;
        _waitingForRemote = false;
        if (Game.getState().roundPhase === 'bidding') processBidding();
        else nextTurn();
      }
    });
    Online.onMigrationProposal(function () { showHostRequestPopup('cascade'); });
    Online.onHostHandoffRequest(function () { showHostRequestPopup('voluntary'); });
  }

  function showHostRequestPopup(source) {
    _hostRequestSource = source;
    var overlay = document.getElementById('host-request-overlay');
    if (overlay) overlay.style.display = 'flex';
  }

  function bindOnlineEvents() {
    // Title screen — Online button
    document.getElementById('btn-online').addEventListener('click', function () {
      resetOnlineScreen();
      showScreen('screen-online');
    });

    // Username persistence + cross-form sync
    function rememberUsername(name) {
      try { localStorage.setItem('laser_stacks:lastUsername', name || ''); } catch (e) {}
    }
    (function () {
      var last = '';
      try { last = localStorage.getItem('laser_stacks:lastUsername') || ''; } catch (e) {}
      if (last) {
        var h = document.getElementById('host-username');
        var j = document.getElementById('join-username');
        if (h && !h.value) h.value = last;
        if (j && !j.value) j.value = last;
      }
    })();
    document.getElementById('host-username').addEventListener('input', function (e) {
      document.getElementById('join-username').value = e.target.value;
      rememberUsername(e.target.value);
    });
    document.getElementById('join-username').addEventListener('input', function (e) {
      document.getElementById('host-username').value = e.target.value;
      rememberUsername(e.target.value);
    });

    // Tabs
    document.getElementById('tab-host').addEventListener('click', function () {
      this.classList.add('active', 'btn-gold');
      this.classList.remove('btn-outline');
      var other = document.getElementById('tab-join');
      other.classList.remove('active', 'btn-gold');
      other.classList.add('btn-outline');
      document.getElementById('form-host').style.display = '';
      document.getElementById('form-join').style.display = 'none';
    });
    document.getElementById('tab-join').addEventListener('click', function () {
      this.classList.add('active', 'btn-gold');
      this.classList.remove('btn-outline');
      var other = document.getElementById('tab-host');
      other.classList.remove('active', 'btn-gold');
      other.classList.add('btn-outline');
      document.getElementById('form-join').style.display = '';
      document.getElementById('form-host').style.display = 'none';
    });

    // Create Room
    document.getElementById('btn-create-room').addEventListener('click', function () {
      var username = document.getElementById('host-username').value.trim();
      var status = document.getElementById('host-status');
      if (!username) {
        status.textContent = 'Please enter a username.';
        status.className = 'online-status error';
        return;
      }
      status.textContent = '';
      status.className = 'online-status';
      document.getElementById('btn-create-room').disabled = true;

      Online.hostGame(username).then(function () {
        registerOnlineCallbacks();
        enterOnlineLobby();
        Online.renderOnlineLobby();
        document.getElementById('btn-create-room').disabled = false;
      }).catch(function (err) {
        status.textContent = 'Error: ' + (err && err.message ? err.message : err);
        status.className = 'online-status error';
        document.getElementById('btn-create-room').disabled = false;
      });
    });

    // Join Room
    document.getElementById('btn-join-room').addEventListener('click', function () {
      var code = document.getElementById('join-room-code').value.trim().toUpperCase();
      var username = document.getElementById('join-username').value.trim();
      var status = document.getElementById('join-status');
      if (!code || code.length !== 3) {
        status.textContent = 'Please enter a 3-letter room code.';
        status.className = 'online-status error';
        return;
      }
      if (!username) {
        status.textContent = 'Please enter a username.';
        status.className = 'online-status error';
        return;
      }
      status.textContent = 'Connecting...';
      status.className = 'online-status';
      document.getElementById('btn-join-room').disabled = true;

      Online.onJoinResponse(function (approved, reason) {
        if (approved) {
          registerOnlineCallbacks();
          enterOnlineLobby();
          Online.renderOnlineLobby();
        } else {
          status.textContent = reason || 'Join request denied.';
          status.className = 'online-status error';
          document.getElementById('btn-join-room').disabled = false;
        }
      });

      Online.joinGame(code, username).then(function () {
        status.textContent = 'Waiting for host to accept...';
      }).catch(function (err) {
        status.textContent = (err && err.message) || 'Could not connect.';
        status.className = 'online-status error';
        document.getElementById('btn-join-room').disabled = false;
      });
    });

    // Online Deal (host only)
    document.getElementById('btn-online-deal').addEventListener('click', function () {
      if (!Online.isHost()) return;
      Online.startOnlineGame();
    });

    // Leave Room
    document.getElementById('btn-leave-room').addEventListener('click', openLeaveRoomConfirm);
    document.getElementById('btn-confirm-leave-yes').addEventListener('click', function () {
      document.getElementById('confirm-leave-room').style.display = 'none';
      Online.leaveRoom();
      gamePhase = 'none';
      if (canvasReady) Renderer.stopLoop();
      clearGameDisplay();
      showScreen('screen-title');
    });
    document.getElementById('btn-confirm-leave-no').addEventListener('click', function () {
      document.getElementById('confirm-leave-room').style.display = 'none';
    });

    // Host-request popup (cascade migration / voluntary handoff)
    document.getElementById('btn-host-request-accept').addEventListener('click', function () {
      document.getElementById('host-request-overlay').style.display = 'none';
      if (_hostRequestSource === 'voluntary') Online.respondHandoff(true);
      else if (_hostRequestSource === 'cascade') Network.acceptMigrationProposal();
      _hostRequestSource = null;
    });
    document.getElementById('btn-host-request-deny').addEventListener('click', function () {
      document.getElementById('host-request-overlay').style.display = 'none';
      if (_hostRequestSource === 'voluntary') Online.respondHandoff(false);
      else if (_hostRequestSource === 'cascade') Network.declineMigrationProposal();
      _hostRequestSource = null;
    });

    // Back button on online screen
    document.getElementById('btn-online-back').addEventListener('click', function () {
      resetOnlineScreen();
      showScreen('screen-title');
    });

    // Disband OK — land back on a fresh online screen
    document.getElementById('btn-disband-ok').addEventListener('click', function () {
      document.getElementById('disband-overlay').style.display = 'none';
      clearGameDisplay();
      resetOnlineScreen();
      showScreen('screen-online');
    });
  }

  function openLeaveRoomConfirm() {
    var sub = document.getElementById('leave-room-sub');
    if (sub) {
      sub.textContent = Online.isHost()
        ? 'The room will be disbanded for everyone.'
        : 'Your seat will need a new controller. The game keeps going for everyone else.';
    }
    document.getElementById('confirm-leave-room').style.display = 'flex';
  }

  // Reset every game-visual so a leave/disband doesn't leak stale state
  function clearGameDisplay() {
    handDisplay = {};
    trickDisplay = [];
    _waitingForRemote = false;
    _dealLock = false;
    _onlineQueue = [];
    if (canvasReady) Renderer.clearFlyingCards();
    document.getElementById('hand-bar').style.display = 'none';
    document.getElementById('bid-overlay').style.display = 'none';
    document.getElementById('game-hud').style.display = 'none';
    document.getElementById('suit-stack').style.display = 'none';
    document.getElementById('trick-info').style.display = 'none';
    hideLobbyChrome();
    var roomRow = document.getElementById('hud-room-row');
    if (roomRow) roomRow.style.display = 'none';
    var ring = document.getElementById('seats-ring');
    if (ring) ring.innerHTML = '';
  }

  function hideLobbyChrome() {
    document.getElementById('online-lobby-header').style.display = 'none';
    document.getElementById('btn-online-deal').style.display = 'none';
    document.getElementById('lobby-waiting').style.display = 'none';
    document.getElementById('join-requests').style.display = 'none';
    // The big lobby seats must never survive into the playing phase —
    // renderGameTable rebuilds the ring, but there's a window between
    // game_starting and deal_round where they'd linger over the table.
    var ring = document.getElementById('seats-ring');
    if (ring) ring.innerHTML = '';
  }

  // ---- Online lobby (renders on the game screen's canvas table) ----
  function enterOnlineLobby() {
    gamePhase = 'online-lobby';
    showScreen('screen-game');

    document.getElementById('online-lobby-header').style.display = '';
    document.getElementById('setup-header').style.display = 'none';
    document.getElementById('btn-deal').style.display = 'none';
    document.getElementById('game-hud').style.display = 'none';
    document.getElementById('suit-stack').style.display = 'none';
    document.getElementById('trick-info').style.display = 'none';
    document.getElementById('hand-bar').style.display = 'none';
    document.getElementById('bid-overlay').style.display = 'none';
    var roomRow = document.getElementById('hud-room-row');
    if (roomRow) roomRow.style.display = 'none';

    if (Online.isHost()) {
      document.getElementById('btn-online-deal').style.display = '';
      document.getElementById('lobby-waiting').style.display = 'none';
    } else {
      document.getElementById('btn-online-deal').style.display = 'none';
      document.getElementById('lobby-waiting').style.display = '';
    }

    var canvasEl = document.getElementById('game-canvas');
    var ready;
    if (!canvasReady) {
      ready = Renderer.init(canvasEl).then(function () {
        canvasReady = true;
      });
    } else {
      Renderer.resize();
      ready = Promise.resolve();
    }

    ready.then(function () {
      var felt = document.querySelector('#screen-game .table-felt');
      if (felt) felt.style.display = 'none';
      Renderer.startLoop(function () {});
      renderOnlineLobbySeats();
    });
  }

  function renderOnlineLobbySeats() {
    if (gamePhase !== 'online-lobby') return;
    var ring = document.getElementById('seats-ring');
    if (!ring || !canvasReady) return;

    // Don't wipe a rename input out from under the user (30's v114 fix)
    var activeEl = document.activeElement;
    if (activeEl && activeEl.classList && activeEl.classList.contains('seat-name-input')) {
      _pendingLobbySeatsRender = true;
      return;
    }
    _pendingLobbySeatsRender = false;
    ring.innerHTML = '';

    var positions = Renderer.getSeatPositions(NUM_TABLE_SEATS);
    var lobbyState = Online.getLobbyState();
    var myDeviceId = Online.getMyDeviceId();
    var isHost = Online.isHost();
    for (var i = 0; i < NUM_TABLE_SEATS; i++) {
      var seat = lobbyState.seats[i];
      if (!seat || !seat.occupied) continue;
      var pos = positions[i];

      var el = document.createElement('div');
      el.className = 'seat';
      el.style.left = pos.x + 'px';
      // Top is set AFTER append: the name row sits above the avatar, so
      // the avatar's offset inside the column must be MEASURED — a fixed
      // vmin estimate left the top/bottom avatars visibly off the wood
      // (the name's rem-floored height doesn't track vmin).
      el.dataset.seat = i;

      // Seat interaction rules (MK's round-3 spec):
      //  * Your own seat: rename + character picker.
      //  * Host on an AI seat: rename + character picker (until dealing).
      //  * Guest on an AI seat: tap anywhere to SIT there (claim_seat) —
      //    moving frees their previous seat back to AI.
      //  * A guest's seat is theirs alone — the host can't touch it.
      var mine = seat.deviceId === myDeviceId;
      var editable = mine || (isHost && seat.isAI);
      var claimable = !isHost && seat.isAI;

      // Editable name on top
      var nameEl = document.createElement('div');
      nameEl.className = 'seat-name';
      nameEl.textContent = seat.name;
      nameEl.dataset.seat = i;
      if (editable) {
        nameEl.addEventListener('click', (function (idx) {
          return function (e) {
            e.stopPropagation();
            startOnlineLobbyNameEdit(idx);
          };
        })(i));
      }
      el.appendChild(nameEl);

      // Avatar — picker if you control the persona, claim if sittable
      var avatar = document.createElement('div');
      avatar.className = 'seat-avatar';
      if (seat.animal) {
        avatar.appendChild(SpriteEngine.createSpriteImg(seat.animal));
        avatar.querySelector('img').style.width = '100%';
        avatar.querySelector('img').style.height = '100%';
      }
      if (editable) {
        avatar.style.cursor = 'pointer';
        avatar.addEventListener('click', (function (idx) {
          return function () { openOnlineAnimalPicker(idx); };
        })(i));
      } else if (claimable) {
        avatar.style.cursor = 'pointer';
        avatar.addEventListener('click', (function (idx) {
          return function () { Online.requestSeat(idx); };
        })(i));
      }
      el.appendChild(avatar);

      // Controller badge below the avatar. Host clicks it to reassign
      // AI/host-owned seats; guests click AI badges to sit there.
      var badge = document.createElement('div');
      badge.className = 'lobby-controller-badge';
      if (seat.isAI) {
        badge.classList.add('ai');
        badge.textContent = claimable ? 'AI · sit here' : 'AI';
      } else {
        var dev = lobbyState.devices[seat.deviceId];
        badge.classList.add('human');
        badge.textContent = dev ? dev.username : '?';
      }
      if (isHost) {
        if (seat.isAI || mine) {
          badge.style.cursor = 'pointer';
          badge.title = 'Click to change who controls this player';
          badge.addEventListener('click', (function (idx) {
            return function (e) {
              e.stopPropagation();
              openReassignPopup(idx);
            };
          })(i));
        } else {
          badge.title = 'This seat belongs to ' + badge.textContent +
            ' — only they can move';
        }
      } else if (claimable) {
        badge.style.cursor = 'pointer';
        badge.title = 'Click to sit here';
        badge.addEventListener('click', (function (idx) {
          return function (e) {
            e.stopPropagation();
            Online.requestSeat(idx);
          };
        })(i));
      }
      el.appendChild(badge);

      ring.appendChild(el);
      // Measured placement: land the avatar center exactly on the orbit
      // point regardless of how tall the name row rendered.
      el.style.top = (pos.y - avatar.offsetTop - getSetupAvatarSize() / 2) + 'px';
    }
  }

  function startOnlineLobbyNameEdit(seatIdx) {
    var nameEl = document.querySelector('.seat-name[data-seat="' + seatIdx + '"]');
    if (!nameEl) return;

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'seat-name-input';
    input.value = Online.getLobbyState().seats[seatIdx].name;
    input.maxLength = 12;

    var parent = nameEl.parentElement;
    parent.replaceChild(input, nameEl);
    input.focus();
    input.select();

    function finishEdit() {
      var newName = input.value.trim();
      if (newName) Online.sendChangeName(seatIdx, newName);
      renderOnlineLobbySeats();
      if (_pendingLobbySeatsRender) renderOnlineLobbySeats();
    }

    input.addEventListener('blur', finishEdit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = ''; input.blur(); }
    });
  }

  // Host-only: pick who controls a seat — AI, the host, or an UNSEATED
  // joiner. Seats held by CONNECTED guests never open here (only they
  // can move themselves) — but a seat whose device dropped or left
  // (page refresh, closed tab) is recoverable, in lobby AND mid-game,
  // so one dead device can't freeze the table.
  function openReassignPopup(seatIdx) {
    if (!Online.isActive() || !Online.isHost()) return;
    var lobbyState = Online.getLobbyState();
    var seat = lobbyState.seats[seatIdx];
    if (!seat || !seat.occupied) return;
    if (seat.deviceId && seat.deviceId !== Online.getMyDeviceId() &&
        Online.isDeviceActive(seat.deviceId)) return;

    var overlay = document.getElementById('reassign-overlay');
    if (!overlay) return;
    var card = document.getElementById('reassign-player-card');
    var optsEl = document.getElementById('reassign-options');
    document.getElementById('reassign-title').textContent =
      'Who controls ' + (seat.name || 'this player') + '?';

    card.innerHTML = '';
    var av = document.createElement('div');
    av.className = 'ra-avatar';
    if (seat.animal) {
      var img = SpriteEngine.createSpriteImg(seat.animal);
      img.style.width = '100%';
      img.style.height = '100%';
      av.appendChild(img);
    }
    card.appendChild(av);
    var nm = document.createElement('div');
    nm.className = 'ra-name';
    nm.textContent = seat.name;
    card.appendChild(nm);

    optsEl.innerHTML = '';
    var myDeviceId = Online.getMyDeviceId();
    function addOption(tag, label, value) {
      var btn = document.createElement('button');
      btn.className = 'reassign-option';
      if ((value === 'ai' && seat.isAI) ||
          (value !== 'ai' && !seat.isAI && seat.deviceId === value)) {
        btn.classList.add('current');
      }
      var tagSpan = document.createElement('span');
      tagSpan.className = 'ra-tag';
      tagSpan.textContent = tag;
      btn.appendChild(tagSpan);
      var labelSpan = document.createElement('span');
      labelSpan.textContent = label;
      btn.appendChild(labelSpan);
      btn.addEventListener('click', function () {
        Online.assignSeatController(seatIdx, value);
        overlay.style.display = 'none';
      });
      optsEl.appendChild(btn);
    }

    addOption('AI', 'Computer', 'ai');
    var devices = lobbyState.devices;
    function deviceHasSeat(pid) {
      return lobbyState.seats.some(function (s) {
        return s.occupied && s.deviceId === pid;
      });
    }
    Object.keys(devices).forEach(function (pid) {
      var dev = devices[pid];
      // Only connected devices can take a seat
      if (pid !== myDeviceId && !Online.isDeviceActive(pid)) return;
      // Guests already holding a seat move themselves — offering them
      // here would let the host yank them around.
      if (pid !== myDeviceId && deviceHasSeat(pid)) return;
      var tag = pid === myDeviceId ? 'Host' : 'Player';
      var label = (dev.username || 'Player') + (pid === myDeviceId ? ' (you)' : '');
      addOption(tag, label, pid);
    });

    document.getElementById('btn-reassign-cancel').onclick = function () {
      overlay.style.display = 'none';
    };
    overlay.style.display = 'flex';
  }

  // Animal picker for an online lobby seat (reuses the local picker DOM)
  function openOnlineAnimalPicker(seatIdx) {
    var picker = document.getElementById('character-picker');
    var grid = document.getElementById('picker-grid');
    grid.innerHTML = '';

    var lobbyState = Online.getLobbyState();
    var animals = SpriteEngine.getAnimalList();
    var usedAnimals = [];
    for (var i = 0; i < lobbyState.seats.length; i++) {
      var st = lobbyState.seats[i];
      if (st.occupied && i !== seatIdx && st.animal) usedAnimals.push(st.animal);
    }

    for (var j = 0; j < animals.length; j++) {
      var animalId = animals[j];
      var taken = usedAnimals.indexOf(animalId) !== -1;

      var wrapper = document.createElement('div');
      wrapper.style.textAlign = 'center';

      var btn = document.createElement('div');
      btn.className = 'picker-animal' + (taken ? ' taken' : '');
      btn.appendChild(SpriteEngine.createSpriteImg(animalId));

      if (!taken) {
        btn.addEventListener('click', (function (aid) {
          return function () {
            Online.sendChangeAnimal(seatIdx, aid);
            closePicker();
          };
        })(animalId));
      }

      wrapper.appendChild(btn);

      var label = document.createElement('div');
      label.className = 'picker-animal-name';
      label.textContent = SpriteEngine.getAnimalName(animalId);
      wrapper.appendChild(label);

      grid.appendChild(wrapper);
    }

    picker.style.display = 'flex';
  }

  // ---- Online game flow ----

  // Fired on every device when the host clicks Deal (game_starting)
  function onlineBeginGame(players) {
    gamePhase = 'playing';
    hideLobbyChrome();
    onlineBeginRound();
  }

  // Host: shuffle + broadcast the deck; guests: wait for it. Both sides
  // then run the identical deterministic startRoundFlow.
  function onlineBeginRound() {
    if (Online.isHost()) {
      Online.setGamePhase('playing');
      var roundData = Game.newRound();
      Online.broadcastGameAction({
        type: 'deal_round',
        gameState: Game.serialize(),
        dealOrder: roundData.dealOrder
      });
      startRoundFlow(roundData.dealOrder);
    } else {
      setMessage('Waiting for host to deal...');
    }
  }

  function onlineStartRoundFromDeal(data) {
    Game.deserialize(data.gameState);
    trickDisplay = [];
    startRoundFlow(data.dealOrder);
  }

  // Guest-side bid prompt, driven from the (lockstep) local state
  function guestBidPrompt() {
    var bidder = Game.getCurrentBidder();
    if (!bidder) {
      setMessage('All bids in!');
      updateAllBidDisplays();
      return; // the host's game_state_sync flips us to playing
    }
    highlightActivePlayer(bidder.id);
    if (Online.isMyPlayer(bidder.id)) {
      renderHandBar(bidder.id);
      currentBidValue = 0;
      document.getElementById('bid-value').textContent = '0';
      document.getElementById('bid-overlay').style.display = 'flex';
      setMessage('Place your bid!');
    } else {
      setMessage(bidder.name + ' is bidding...');
    }
  }

  // Guest: replay a bid the host applied (our own bids echo back too)
  function guestApplyBid(playerId, value) {
    Game.setBid(playerId, value);
    updateStatLine(playerId);
    var p = Game.getPlayerById(playerId);
    setMessage((Online.isMyPlayer(playerId) ? 'You bid ' : p.name + ' bids ') + value);
    Animations.delay(400).then(function () {
      Game.advanceBid();
      guestBidPrompt();
    });
  }

  // Guest: replay a card play the host applied
  function guestApplyPlay(playerId, cardIndex) {
    var player = Game.getPlayerById(playerId);
    if (!player) return;
    var card = Game.playCard(playerId, cardIndex);

    if (handDisplay[playerId]) {
      for (var i = 0; i < handDisplay[playerId].length; i++) {
        if (handDisplay[playerId][i].card === card ||
            (handDisplay[playerId][i].card.rank === card.rank &&
             handDisplay[playerId][i].card.suit === card.suit)) {
          handDisplay[playerId].splice(i, 1);
          break;
        }
      }
    }

    setMessage(player.name + ' plays ' + card.rank + card.symbol);

    animatePlayCard(card, playerId, player.seatIndex).then(function () {
      if (Online.isMyPlayer(playerId)) renderHandBar(playerId);
      updateAllTrickDisplays();

      var trick = Game.getCurrentTrick();
      if (trick.length >= Game.getState().players.length) {
        // Trick complete — the host's trick_complete + sync drive the rest
        return;
      }
      Game.advanceTrickTurn();
      gameFlowLocked = false;
      nextTurn();
    });
  }

  // Host: a guest's action arrived (player_action)
  function onlineHandleRemoteAction(data) {
    if (!Online.isHost() || !data || !data.action) return;
    var action = data.action;

    if (action.type === 'bid') {
      var bidder = Game.getCurrentBidder();
      if (!bidder || bidder.id !== data.playerId) return; // stale/out of turn
      _waitingForRemote = false;
      gameFlowLocked = false;
      hostApplyBid(data.playerId, action.value);
      return;
    }

    if (action.type === 'playCard') {
      var current = Game.getCurrentPlayer();
      if (!current || current.id !== data.playerId) return;
      var legal = Game.getLegalPlays(data.playerId);
      if (legal.indexOf(action.cardIndex) === -1) return;
      _waitingForRemote = false;
      gameFlowLocked = true;
      executePlay(data.playerId, action.cardIndex);
    }
  }

  // Guest: declarative events from the host (also reaches migrated
  // ex-hosts). Events during the deal replay are queued and drained
  // once the animation settles.
  function onlineHandleGameAction(data) {
    if (!data || !data.type) return;

    if (data.type === 'deal_round') {
      // New round (first deal, or Play Again from the results screen)
      onlineStartRoundFromDeal(data);
      return;
    }

    if (_dealLock) {
      _onlineQueue.push({ kind: 'action', data: data });
      return;
    }

    switch (data.type) {
      case 'action_bid':
        guestApplyBid(data.playerId, data.value);
        break;
      case 'action_play':
        guestApplyPlay(data.playerId, data.cardIndex);
        break;
      case 'trick_complete':
        setMessage(data.winnerName + ' wins the Stack!');
        highlightActivePlayer(data.winnerId);
        Animations.delay(1200).then(function () {
          trickDisplay = [];
          Renderer.markDirty();
        });
        break;
    }
  }

  // Guest: authoritative reconcile from the host
  function onlineHandleStateSync(data) {
    if (!data || !data.gameState) return;
    if (_dealLock) {
      _onlineQueue.push({ kind: 'sync', data: data });
      return;
    }
    Game.deserialize(data.gameState);
    buildDisplaysFromState();
    onlineRefreshFromState();
  }

  function drainOnlineQueue() {
    var q = _onlineQueue;
    _onlineQueue = [];
    for (var i = 0; i < q.length; i++) {
      if (q[i].kind === 'sync') onlineHandleStateSync(q[i].data);
      else onlineHandleGameAction(q[i].data);
    }
  }

  // Rebuild the canvas fans + trick pile from the deserialized state
  function buildDisplaysFromState() {
    var gs = Game.getState();
    handDisplay = {};
    for (var i = 0; i < gs.players.length; i++) {
      var pid = gs.players[i].id;
      handDisplay[pid] = [];
      var hand = gs.hands[pid] || [];
      for (var c = 0; c < hand.length; c++) {
        handDisplay[pid].push({ card: hand[c], faceUp: false });
      }
    }
    trickDisplay = [];
    var trick = gs.currentTrick || [];
    for (var t = 0; t < trick.length; t++) {
      var tp = Game.getPlayerById(trick[t].playerId);
      if (tp) trickDisplay.push({ playerId: tp.id, card: trick[t].card, seatIndex: tp.seatIndex });
    }
    // State-sync rebuild happens with no animation in flight — tell the
    // dirty-frame gate the scene changed.
    Renderer.markDirty();
  }

  // Guest: refresh prompts/HUD after a sync
  function onlineRefreshFromState() {
    updateHUD();
    updateSuitDiagram();
    updateAllBidDisplays();
    updateAllTrickDisplays();
    updateTrickInfo();

    var gs = Game.getState();
    if (gs.roundPhase === 'finished') {
      gameFlowLocked = true;
      enableHandBar(false);
      document.getElementById('hand-bar').style.display = 'none';
      Animations.delay(800).then(function () { showResults(); });
      return;
    }
    if (gs.roundPhase === 'bidding') {
      guestBidPrompt();
      return;
    }
    if (gs.roundPhase === 'playing') {
      gameFlowLocked = false;
      nextTurn();
    }
  }

  // Guest joining mid-game (approved after Deal): build the table
  // directly from state — the trailing sync fills in the details.
  function enterGameInProgress(players) {
    gamePhase = 'playing';
    showScreen('screen-game');
    hideLobbyChrome();
    document.getElementById('setup-header').style.display = 'none';
    document.getElementById('btn-deal').style.display = 'none';
    document.getElementById('game-hud').style.display = '';
    document.getElementById('suit-stack').style.display = '';
    document.getElementById('trick-info').style.display = '';
    document.getElementById('hand-bar').style.display = '';

    updateSuitStackLegend(SaveSystem.getSuitStyle());

    renderGameTable().then(function () {
      buildDisplaysFromState();
      positionSuitStackAndTrickInfo();
      onlineRefreshFromState();
    });
  }

  // ================================================================
  //  RESULTS
  // ================================================================

  // Round results — no per-round winner is declared (rounds can tie);
  // just show how everyone did plus the running totals.
  function showResults() {
    var headerDiv = document.getElementById('results-winner');
    var handsDiv = document.getElementById('results-hands');
    var scoreDiv = document.getElementById('results-scoreboard');

    var bids = Game.getBids();
    var tricksWon = Game.getTricksWon();
    var roundScores = Game.getRoundScores();
    var scores = Game.getScores();
    var players = Game.getState().players;

    headerDiv.innerHTML =
      '<div class="results-round-label">Round ' + Game.getRoundNumber() + ' Results</div>';

    // Player results, sorted by round score descending
    handsDiv.innerHTML = '';
    var sortedPlayers = players.slice().sort(function (a, b) {
      return (roundScores[b.id] || 0) - (roundScores[a.id] || 0);
    });

    for (var j = 0; j < sortedPlayers.length; j++) {
      var p = sortedPlayers[j];
      var bid = bids[p.id] || 0;
      var won = tricksWon[p.id] || 0;
      var rScore = roundScores[p.id] || 0;

      var handDiv = document.createElement('div');
      handDiv.className = 'result-hand';

      var bidStatus = '';
      var bidClass = '';
      if (bid === 0 && won === 0) {
        bidStatus = 'Perfect 0!';
        bidClass = 'bid-hit';
      } else if (won === bid) {
        bidStatus = 'Hit!';
        bidClass = 'bid-hit';
      } else if (won < bid) {
        bidStatus = 'Under';
        bidClass = 'bid-under';
      } else {
        bidStatus = '+' + (won - bid) + ' Over';
        bidClass = 'bid-over';
      }

      handDiv.innerHTML =
        '<div class="result-hand-name">' + p.name + '</div>' +
        '<div class="result-hand-bid">' +
          'Bid ' + bid + ' / Won ' + won +
          '<br><span class="' + bidClass + '">' + bidStatus + '</span>' +
        '</div>' +
        '<div class="result-hand-score ' + (rScore > 0 ? 'positive' : 'zero') + '">' +
          rScore +
        '</div>';

      handsDiv.appendChild(handDiv);
    }

    // Cumulative scoreboard, sorted by total
    var scoreRows = players.slice().sort(function (a, b) {
      return (scores[b.id] || 0) - (scores[a.id] || 0);
    });

    var maxScore = 0;
    for (var s = 0; s < scoreRows.length; s++) {
      if ((scores[scoreRows[s].id] || 0) > maxScore) maxScore = scores[scoreRows[s].id] || 0;
    }

    var tableHtml = '<div class="scoreboard-title">Scoreboard</div>' +
      '<table class="scoreboard-table"><thead><tr><th>Player</th><th>Total</th></tr></thead><tbody>';
    for (var t = 0; t < scoreRows.length; t++) {
      var sc = scores[scoreRows[t].id] || 0;
      var leading = sc === maxScore && sc > 0 ? ' class="leading"' : '';
      tableHtml += '<tr' + leading + '><td>' + scoreRows[t].name + '</td><td>' + sc + '</td></tr>';
    }
    tableHtml += '</tbody></table>';
    scoreDiv.innerHTML = tableHtml;

    // Online guests wait for the host to start the next round
    var playAgainBtn = document.getElementById('btn-play-again');
    var waitingNote = document.getElementById('results-waiting');
    var guestOnline = Online.isActive() && !Online.isHost();
    if (playAgainBtn) playAgainBtn.style.display = guestOnline ? 'none' : '';
    if (waitingNote) waitingNote.style.display = guestOnline ? '' : 'none';

    showScreen('screen-results');
  }

  // ---- Start on DOM ready ----
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    showScreen: showScreen,
    init: init
  };
})();

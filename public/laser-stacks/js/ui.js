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

  // ---- Hand-bar owner (v2.8) ----
  // Which of THIS device's players the hand bar shows. With one local
  // player it's automatic; with several (hot-seat, or an online host
  // running more than one seat) it's whoever was tapped last — the bar
  // no longer jumps to whoever's turn it is.
  var _viewedPlayerId = null;

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
  // Generation token for game-flow chains. Bumped on every exit/leave
  // (clearGameDisplay): pending timers and promise chains from the
  // abandoned game check it and die instead of mutating the next game
  // (the old flow kept running after Main Menu and e.g. prompted a bid
  // before the new deal finished).
  var _flowEpoch = 0;
  function flowStale(ep) { return ep !== _flowEpoch; }

  // ---- Responsive Helpers (30's vmin system) ----
  // DOM-side vmin — must agree with Renderer.getVmin() so canvas geometry
  // and DOM overlays land on the same points.
  function getVmin() {
    var vw = document.documentElement.clientWidth || window.innerWidth;
    var vh = document.documentElement.clientHeight || window.innerHeight;
    return Math.min(vw, vh) / 100;
  }
  // Avatar diameter (px) — the renderer's rule: 7.8vmin, or 7.8vmin x k
  // on portrait phones (published to CSS as --avatar-d). Setup, lobby
  // and game avatars are the same size (MK's v2.5 consistency ask).
  function getAvatarSize() {
    var v = viewportSize();
    return Renderer.getAvatarDiameter(v.w, v.h);
  }
  function getSetupAvatarSize() { return getAvatarSize(); }
  function getGameAvatarSize() { return getAvatarSize(); }
  // Card scale for flying/deal animations — same formula AND basis as
  // drawGameFrame (layout viewport, not window.inner*) so cards never
  // change size mid-flight. Reference: 1080p desktop.
  function getCardScale() {
    return 1.1 * (getVmin() * 100 / 1080);
  }

  // ---- View mode ----
  // One proportional layout everywhere (MK's round-3 directive), with ONE
  // phone exception (v2.8, MK's ask): on a portrait phone the board rides
  // high and the hand bar takes the bottom in two big rows. The rule is
  // Renderer.isPhonePortrait so the canvas and CSS (body.phone-portrait)
  // always agree. pbar-active additionally shows the status pill above
  // the hand while a game is live.
  function viewportSize() {
    return {
      w: document.documentElement.clientWidth || window.innerWidth,
      h: document.documentElement.clientHeight || window.innerHeight
    };
  }

  function isMobilePortrait() {
    var v = viewportSize();
    return Renderer.isPhonePortrait(v.w, v.h);
  }

  function updateLayoutMode() {
    var v = viewportSize();
    var phone = Renderer.isPhonePortrait(v.w, v.h);
    var inGame = gamePhase === 'playing' &&
      document.getElementById('screen-game').classList.contains('active');
    Renderer.refreshLayoutMetrics();
    document.body.classList.toggle('phone-portrait', phone);
    document.body.classList.toggle('pbar-active', inGame && phone);
    var rootStyle = document.documentElement.style;
    // The Deal button and lobby text center on the table, wherever it is
    var center = Renderer.computeTableCenter(v.w, v.h);
    rootStyle.setProperty('--table-cy', Math.round(center.y) + 'px');
    // Phone sizes (v2.9): avatars / names / legend scale by k (2 when the
    // board fits) — the CSS reads these so it matches the canvas exactly
    if (phone) {
      var pl = Renderer.computePhoneLayout(v.w, v.h);
      rootStyle.setProperty('--ui-k', pl.k.toFixed(3));
      rootStyle.setProperty('--legend-k', pl.legendK.toFixed(3));
      rootStyle.setProperty('--avatar-d', pl.avatarD.toFixed(2) + 'px');
    } else {
      rootStyle.removeProperty('--ui-k');
      rootStyle.removeProperty('--legend-k');
      rootStyle.removeProperty('--avatar-d');
    }
    updateRotateGate();
  }

  // ---- Phone board reserve (v2.9) ----
  // Tell the renderer which mode-dependent space the phone board must
  // leave free — the raised hot-seat status pill, the online room-code
  // row — and re-lay out the current screen if that moved the board.
  // Setup reserves for the table it is about to deal (its Human count),
  // so the board doesn't jump at Deal.
  function syncPhoneReserve() {
    var ownerLabel = false;
    if (gamePhase === 'setup') {
      ownerLabel = setupSeats.filter(function (s) { return s.occupied && s.isHuman; }).length > 1;
    } else if (gamePhase === 'playing') {
      ownerLabel = hasMultipleLocalPlayers();
    }
    var changed = Renderer.setPhoneReserve({ ownerLabel: ownerLabel, roomRow: Online.isActive() });
    if (!changed) return;
    updateLayoutMode();
    // re-centers the table texture (its key includes the center)
    if (canvasReady) Renderer.resize();
    // Seats re-place even while the renderer warms (setup has a DOM
    // fallback; the lobby renderer bails on its own without a canvas)
    if (gamePhase === 'setup') renderSetupSeats();
    else if (gamePhase === 'online-lobby') renderOnlineLobbySeats();
    else if (gamePhase === 'playing') positionGameOverlays();
  }

  // ---- Portrait-only on phones (v2.8, MK's ask) ----
  // A phone held sideways gets a full-screen "rotate to portrait" card
  // and nothing else. Uses the PHYSICAL screen orientation, not the
  // viewport's aspect ratio: an Android keyboard opening in portrait
  // shrinks the viewport to landscape proportions, and that must not
  // trigger the gate mid-typing. Tablets (short side > 500px) and mouse
  // devices are never gated.
  function isPhoneLandscape() {
    if (!window.matchMedia('(pointer: coarse)').matches) return false;
    var sw = window.screen ? Math.min(screen.width, screen.height) : 0;
    if (!sw || sw > 500) return false;
    var type = screen.orientation && screen.orientation.type;
    if (type) return type.indexOf('landscape') === 0;
    if (typeof window.orientation === 'number') return Math.abs(window.orientation) === 90;
    return window.innerWidth > window.innerHeight;
  }

  function updateRotateGate() {
    document.body.classList.toggle('rotate-required', isPhoneLandscape());
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

    // Cheap class/var sync on EVERY screen (the rotate gate must work on
    // the title screen too); the debounced canvas rebuild below only
    // matters while the game screen is up.
    var syncMode = function () { updateLayoutMode(); };
    window.addEventListener('resize', syncMode);
    window.addEventListener('orientationchange', syncMode);
    if (window.screen && screen.orientation && screen.orientation.addEventListener) {
      screen.orientation.addEventListener('change', syncMode);
    }

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
    console.log('[LaserStacks] build v2.9');
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

    // Warm the renderer while the player reads the title screen, so
    // Local/Online Play open instantly (v2.8 — see ensureRenderer)
    var warm = function () { ensureRenderer().catch(function () {}); };
    if (window.requestIdleCallback) window.requestIdleCallback(warm, { timeout: 2000 });
    else setTimeout(warm, 500);
  }

  // ---- Renderer bring-up (v2.8) ----
  // One shared promise for the PIXI app, started in idle time right
  // after the title screen paints. Even with the cheap textures, WebGL
  // start-up costs ~0.4s on Windows (ANGLE shader compiles) — paying it
  // before the click is what makes "Local Play" open instantly. Card
  // faces are baked from Cinzel, so the fonts must land first (capped
  // wait, so an offline/slow font host can't block the game).
  var _rendererPromise = null;

  function fontsReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var loads = Promise.all([
      document.fonts.load('900 28px Cinzel'),
      document.fonts.load('700 11px Cinzel'),
      document.fonts.load('400 11px Cinzel')
    ]).catch(function () {});
    var cap = new Promise(function (resolve) { setTimeout(resolve, 2500); });
    return Promise.race([loads, cap]);
  }

  function ensureRenderer() {
    if (_rendererPromise) {
      return _rendererPromise.then(function () { Renderer.resize(); });
    }
    _rendererPromise = fontsReady().then(function () {
      return Renderer.init(document.getElementById('game-canvas'));
    }).then(function () {
      canvasReady = true;
      var felt = document.querySelector('#screen-game .table-felt');
      if (felt) felt.style.display = 'none';
    }, function (err) {
      _rendererPromise = null; // let the next screen entry retry
      console.error('[LaserStacks] Renderer failed to start:', err);
      throw err;
    });
    return _rendererPromise;
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
        ', a 2' + suitToken('hearts', style) + ' beats a K' + suitToken('diamonds', style) +
        ', and so on. Aces are high.';
    }

    renderRulesPips(style);
  }

  // Draw the How to Play pips at native resolution. The screen is hidden
  // (0x0 rects) when the rules text is first built, so this re-runs each
  // time How to Play opens — otherwise the 22x28 default bitmap gets
  // stretched blurry over the larger card-chip box.
  function renderRulesPips(style) {
    if (style === 'classic' || typeof LaserPips === 'undefined') return;
    var dpr = window.devicePixelRatio || 1;
    var inlines = document.querySelectorAll('.rule-section canvas.inline-laser-pip[data-inline-pip]');
    for (var i = 0; i < inlines.length; i++) {
      var rect = inlines[i].getBoundingClientRect();
      if (rect.width > 0) {
        inlines[i].width = Math.round(rect.width * dpr * 2);
        inlines[i].height = Math.round(rect.height * dpr * 2);
      }
      LaserPips.renderPipCanvas(inlines[i], inlines[i].getAttribute('data-inline-pip'), style);
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
      document.getElementById('screen-rules').scrollTop = 0; // it scrolls now
      showScreen('screen-rules');
      renderRulesPips(SaveSystem.getSuitStyle());
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
      clearGameDisplay();
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
      clearGameDisplay();
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

    // Seats go up immediately (DOM fallback geometry if the renderer is
    // still warming); the table fades in under them once it's ready.
    prepareSetupScreen();
    syncPhoneReserve(); // leaving online / restored hot-seat table
    ensureRenderer().then(function () {
      if (gamePhase !== 'setup') return; // left before the table was ready
      // Keep the loop running for particles even with no game callback
      Renderer.startLoop(function () {});
      renderSetupSeats();
    }).catch(function () { /* logged in ensureRenderer */ });
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
      // Pre-canvas fallback (renderer still warming): the renderer's own
      // center rule on the DOM box, same tangent orbit
      var table = ring.parentElement;
      var w = table.offsetWidth || window.innerWidth;
      var h = table.offsetHeight || window.innerHeight;
      var vm = Math.min(w, h) / 100;
      // felt + wood + avatar radius (avatars are 2x on phones)
      var orbit = (28 + 2.5) * vm + Renderer.getAvatarDiameter(w, h) / 2;
      var center = Renderer.computeTableCenter(w, h);
      positions = [];
      for (var s = 0; s < NUM_TABLE_SEATS; s++) {
        var ang = (Math.PI / 2) + (s * 2 * Math.PI / NUM_TABLE_SEATS);
        positions.push({ x: center.x + orbit * Math.cos(ang), y: center.y + orbit * Math.sin(ang), angle: ang });
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
    fitSeatTextToTable(); // side names: off the table, on the screen
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
    keepInputOnScreen(input);
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
    syncPhoneReserve(); // a 2nd Human = hot-seat reserve on phones
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
    var usedAnimals = [];
    for (var i = 0; i < setupSeats.length; i++) {
      if (setupSeats[i].occupied && i !== seatIdx && setupSeats[i].animal) {
        usedAnimals.push(setupSeats[i].animal);
      }
    }
    showAnimalPicker(usedAnimals, selectAnimal);
  }

  // The 24-animal grid, shared by the local setup and online lobby
  // pickers. Animals in `takenAnimals` are greyed out and inert.
  function showAnimalPicker(takenAnimals, onPick) {
    var grid = document.getElementById('picker-grid');
    grid.innerHTML = '';
    SpriteEngine.getAnimalList().forEach(function (animalId) {
      var taken = takenAnimals.indexOf(animalId) !== -1;

      var wrapper = document.createElement('div');
      wrapper.style.textAlign = 'center';

      var btn = document.createElement('div');
      btn.className = 'picker-animal' + (taken ? ' taken' : '');
      btn.appendChild(SpriteEngine.createSpriteImg(animalId));
      if (!taken) {
        btn.addEventListener('click', function () { onPick(animalId); });
      }
      wrapper.appendChild(btn);

      var label = document.createElement('div');
      label.className = 'picker-animal-name';
      label.textContent = SpriteEngine.getAnimalName(animalId);
      wrapper.appendChild(label);

      grid.appendChild(wrapper);
    });
    document.getElementById('character-picker').style.display = 'flex';
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

    _viewedPlayerId = null; // first local player to act gets the bar
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
    var ep = _flowEpoch;
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

    // Re-render the legend now that the stack is laid out at its real size,
    // and sync lock states to the FRESH round — without this, a game
    // started after exiting another kept the old game's unlocked suits
    // showing until the first trick updated them.
    updateSuitStackLegend(SaveSystem.getSuitStyle());
    updateSuitDiagram();

    renderGameTable().then(function () {
      if (flowStale(ep)) return Promise.reject('stale');
      positionSuitStackAndTrickInfo();
      updateHUD();
      gameFlowLocked = true;
      setMessage('Dealing...');

      return Animations.delay(500);
    }).then(function () {
      return animateDealSequence(dealOrder);
    }).then(function () {
      if (flowStale(ep)) return Promise.reject('stale');
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
      if (flowStale(ep)) return Promise.reject('stale');
      // Show hand bar with cards visible so the human can see before bidding
      document.getElementById('hand-bar').style.display = '';
      renderHandBar();

      setMessage('Bidding phase');
      return Animations.delay(500);
    }).then(function () {
      if (flowStale(ep)) return Promise.reject('stale');
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
      if (e === 'stale') return; // abandoned game — intentional bail
      // Surface flow errors — a silent rejection here freezes the round
      console.error('[LaserStacks] Round flow error:', e);
    });
  }

  // ---- Bidding Flow ----
  function processBidding() {
    var ep = _flowEpoch;
    var bidder = Game.getCurrentBidder();
    if (!bidder) {
      // All bids in — start playing
      setMessage('All bids in!');
      updateAllBidDisplays();
      return Animations.delay(1000).then(function () {
        if (flowStale(ep)) return;
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
        applyParkedAction(bidder.id);
        return;
      }
      promptLocalBid(bidder, hasMultipleLocalPlayers());
    } else {
      // AI bids
      setMessage(bidder.name + ' is thinking...');
      gameFlowLocked = true;

      Animations.delay(600 + Math.random() * 400).then(function () {
        if (flowStale(ep)) return Promise.reject('stale');
        var bid = Game.aiBid(bidder.id);
        Game.setBid(bidder.id, bid);
        if (Online.isActive() && Online.isHost()) {
          Online.broadcastGameAction({ type: 'action_bid', playerId: bidder.id, value: bid });
        }
        updateStatLine(bidder.id);
        setMessage(bidder.name + ' bids ' + bid);

        return Animations.delay(600);
      }).then(function () {
        if (flowStale(ep)) return;
        Game.advanceBid();
        processBidding();
      }).catch(function (e) {
        if (e !== 'stale') throw e;
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
    var ep = _flowEpoch;
    Game.setBid(playerId, value);
    if (Online.isActive() && Online.isHost()) {
      Online.broadcastGameAction({ type: 'action_bid', playerId: playerId, value: value });
    }
    updateStatLine(playerId);
    var bidPlayer = Game.getPlayerById(playerId);
    var mine = !Online.isActive() || Online.isMyPlayer(playerId);
    setMessage(mine ? 'You bid ' + value : bidPlayer.name + ' bids ' + value);

    Animations.delay(400).then(function () {
      if (flowStale(ep)) return;
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
    var ep = _flowEpoch;

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
            if (flowStale(ep)) { resolve(); return; }
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

  // Drop a just-played card from the canvas fan (matched by value: state
  // syncs replace card objects, so identity alone isn't reliable)
  function removeFromHandDisplay(playerId, card) {
    var fan = handDisplay[playerId];
    if (!fan) return;
    for (var i = 0; i < fan.length; i++) {
      if (fan[i].card === card ||
          (fan[i].card.rank === card.rank && fan[i].card.suit === card.suit)) {
        fan.splice(i, 1);
        return;
      }
    }
  }

  // ---- Play Card Animation ----
  function animatePlayCard(card, playerId, seatIndex) {
    return new Promise(function (resolve) {
      var tableCenter = Renderer.getTableCenter();
      var seatPositions = Renderer.getSeatOverlayPositions(NUM_TABLE_SEATS);
      var seatPos = seatPositions[seatIndex];
      var handPos = Renderer.getHandPosition(seatPos, tableCenter);

      // Trick card position + size — matches drawGameFrame (2x on phones)
      var trick = Renderer.getTrickLayout();
      var trickX = tableCenter.x + Math.cos(seatPos.angle) * trick.offset;
      var trickY = tableCenter.y + Math.sin(seatPos.angle) * trick.offset;
      var fromScale = getCardScale();

      var fc = Renderer.addFlyingCard({
        card: card,
        faceUp: false,
        flipProgress: 0,
        x: handPos.x,
        y: handPos.y,
        scale: fromScale
      });

      Renderer.animate(400, function (t) {
        var e = Renderer.easeOutCubic(t);
        fc.x = handPos.x + (trickX - handPos.x) * e;
        fc.y = handPos.y + (trickY - handPos.y) * e;
        // Grows from hand size to the (2x on phones) trick size in flight
        fc.scale = fromScale + (trick.scale - fromScale) * e;
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
    var ep = _flowEpoch;
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
        if (Online.isHost()) {
          _waitingForRemote = true;
          applyParkedAction(player.id);
        }
        return;
      }
      promptLocalPlay(player, hasMultipleLocalPlayers());
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
        if (flowStale(ep)) return;
        var cardIndex = Game.aiPlayCard(player.id);
        return executePlay(player.id, cardIndex);
      });
    }
  }

  // The last stack plays itself: a human's single remaining card, or the
  // AI's pick (one card left either way, but the AI path stays general)
  function autoCardFor(player) {
    return player.isHuman ? Game.getLegalPlays(player.id)[0] : Game.aiPlayCard(player.id);
  }

  // ---- Auto-play last stack ----
  function autoPlayLastTrick(firstPlayer) {
    var ep = _flowEpoch;
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
      var cardIndex = autoCardFor(player);

      Animations.delay(800).then(function () {
        if (flowStale(ep)) return;
        return executePlay(player.id, cardIndex);
      });
    }

    playNextCard();
  }

  function humanPlayCard(cardIndex) {
    if (gameFlowLocked) return;
    var player = Game.getCurrentPlayer();
    if (!isLocalPlayer(player)) return;
    // The tapped card belongs to the bar's hand — it must be the mover's
    if (!isViewing(player.id)) return;

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
    var ep = _flowEpoch;
    var player = Game.getPlayerById(playerId);
    var card = Game.playCard(playerId, cardIndex);

    // Online host: let every guest replay the same play in parallel
    if (Online.isActive() && Online.isHost()) {
      Online.broadcastGameAction({
        type: 'action_play', playerId: playerId, cardIndex: cardIndex
      });
    }

    removeFromHandDisplay(playerId, card);
    setMessage(player.name + ' plays ' + card.rank + card.symbol);

    return animatePlayCard(card, playerId, player.seatIndex).then(function () {
      if (flowStale(ep)) return;
      // Refresh the bar (it shows the viewed local hand — never the mover's
      // unless that's who is being viewed)
      if (isLocalPlayer(player)) renderHandBar();

      // Update tricks won display
      updateAllTrickDisplays();

      var currentTrick = Game.getCurrentTrick();

      if (currentTrick.length >= Game.getState().players.length) {
        // Trick complete — determine winner
        var trickWinnerId;
        return Animations.delay(600).then(function () {
          if (flowStale(ep)) return Promise.reject('stale');
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
          if (flowStale(ep)) return;
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
        }).catch(function (e) {
          if (e !== 'stale') throw e;
        });
      } else {
        // More players to play in this trick
        return Animations.delay(300).then(function () {
          if (flowStale(ep)) return;
          var next = Game.advanceTrickTurn();
          if (!next) {
            endRound();
          } else if (Game.isLastTrick()) {
            // Continue auto-playing last trick
            var nextPlayer = Game.getCurrentPlayer();
            highlightActivePlayer(nextPlayer.id);
            var ci = autoCardFor(nextPlayer);
            Animations.delay(800).then(function () {
              if (flowStale(ep)) return;
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
    var ep = _flowEpoch;
    gameFlowLocked = true;
    enableHandBar(false);
    document.getElementById('hand-bar').style.display = 'none';

    Animations.delay(1000).then(function () {
      if (flowStale(ep)) return;
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

  // ---- Local players & the viewed hand (v2.8) ----

  // A player THIS device controls: any human seat offline; online, only
  // human seats bound to this device (hands are synced to every device,
  // so this check is what keeps other players' cards private).
  function isLocalPlayer(p) {
    if (!p || !p.isHuman) return false;
    return !Online.isActive() || Online.isMyPlayer(p.id);
  }

  function getLocalPlayers() {
    var gs = Game.getState();
    // Turn order once the round is set up, so the default pick is the
    // local player who acts first
    var order = (gs.turnOrder && gs.turnOrder.length) ? gs.turnOrder
      : gs.players.map(function (p) { return p.id; });
    var out = [];
    for (var i = 0; i < order.length; i++) {
      var p = Game.getPlayerById(order[i]);
      if (isLocalPlayer(p)) out.push(p);
    }
    return out;
  }

  function hasMultipleLocalPlayers() {
    return getLocalPlayers().length > 1;
  }

  // The player whose hand the bar shows: the last one tapped. Until
  // someone taps (or if that seat stopped being local), it's the first
  // local player to act this round — not pinned, so a fresh game's
  // first bidder gets the bar once the deal has set the turn order.
  function getViewedPlayer() {
    var locals = getLocalPlayers();
    for (var i = 0; i < locals.length; i++) {
      if (locals[i].id === _viewedPlayerId) return locals[i];
    }
    return locals[0] || null;
  }

  function isViewing(playerId) {
    var v = getViewedPlayer();
    return !!v && v.id === playerId;
  }

  // Tap on a seat avatar mid-game. A local player that isn't the one on
  // the bar → switch the bar to them. Otherwise the online host's
  // existing recovery hatch (reassign a seat) still applies.
  function onSeatAvatarTap(playerId, seatIdx) {
    if (gamePhase !== 'playing') return;
    var p = Game.getPlayerById(playerId);
    if (isLocalPlayer(p) && hasMultipleLocalPlayers() && !isViewing(playerId)) {
      selectViewedPlayer(playerId);
      return;
    }
    if (Online.isActive() && Online.isHost()) openReassignPopup(seatIdx);
  }

  function selectViewedPlayer(playerId) {
    _viewedPlayerId = playerId;
    renderHandBar();
    refreshSeatAffordances();
    resumeLocalPrompt();
  }

  // After a switch: if the newly viewed player is the one the game is
  // waiting on, hand them the controls (bid overlay / playable cards).
  function resumeLocalPrompt() {
    var gs = Game.getState();
    var multi = hasMultipleLocalPlayers();
    if (gs.roundPhase === 'bidding') {
      var bidder = Game.getCurrentBidder();
      if (bidder && isLocalPlayer(bidder) && gs.bids[bidder.id] === undefined) {
        promptLocalBid(bidder, multi);
      }
    } else if (gs.roundPhase === 'playing' && !gameFlowLocked) {
      var current = Game.getCurrentPlayer();
      if (current && isLocalPlayer(current)) promptLocalPlay(current, multi);
    }
  }

  // Bid prompt for a local bidder: the overlay only opens over the
  // bidder's OWN hand; otherwise ask for a tap on their character.
  function promptLocalBid(bidder, multi) {
    if (!isViewing(bidder.id)) {
      document.getElementById('bid-overlay').style.display = 'none';
      setMessage('Tap ' + bidder.name + ' to bid');
      return;
    }
    renderHandBar();
    currentBidValue = 0;
    document.getElementById('bid-value').textContent = '0';
    document.getElementById('bid-overlay').style.display = 'flex';
    setMessage(multi ? bidder.name + ' — place your bid!' : 'Place your bid!');
  }

  // Play prompt for a local player: cards light up only on their own
  // hand; otherwise ask for a tap on their character.
  function promptLocalPlay(player, multi) {
    renderHandBar();
    if (!isViewing(player.id)) {
      setMessage('Tap ' + player.name + ' to play');
      return;
    }
    setMessage(multi ? player.name + '\'s turn!' : 'Your turn!');
  }

  // Seat affordances: which avatars can be tapped, and which local
  // player's hand is on the bar (only marked when there's a choice).
  function refreshSeatAffordances() {
    var multi = hasMultipleLocalPlayers();
    var host = Online.isActive() && Online.isHost();
    var viewed = getViewedPlayer();
    var seats = document.querySelectorAll('.game-seat');
    for (var i = 0; i < seats.length; i++) {
      var p = Game.getPlayerById(+seats[i].dataset.player);
      var local = isLocalPlayer(p);
      seats[i].classList.toggle('tappable', !!p && ((local && multi) || host));
      seats[i].classList.toggle('viewing', !!p && multi && !!viewed && viewed.id === p.id);
    }
    var owner = document.getElementById('hand-bar-owner');
    var showOwner = multi && !!viewed;
    // Mid-round, this device can gain a 2nd seat (online device-leave
    // modal: "Host (you)") — the raised pill then needs its board reserve
    // NOW, not at the next deal. No-op when the reserve already matches.
    if (gamePhase === 'playing' && showOwner !== document.body.classList.contains('has-hand-owner')) {
      syncPhoneReserve();
    }
    if (owner) {
      // The default first-human name is "You" → "Your hand", not "You's"
      owner.textContent = showOwner
        ? (viewed.name === 'You' ? 'Your hand' : viewed.name + '\'s hand') : '';
      owner.style.display = showOwner ? '' : 'none';
    }
    document.body.classList.toggle('has-hand-owner', showOwner);
  }

  // Renders the VIEWED local player's hand. Never anyone else's: the bar
  // is this device's private surface (two past online leaks came from
  // callers passing another seat's id — there is no parameter anymore).
  function renderHandBar() {
    var container = document.getElementById('hand-bar-cards');
    container.innerHTML = '';

    var gs = Game.getState();
    var humanPlayer = getViewedPlayer();
    refreshSeatAffordances();
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

    hydrateHandPips();
  }

  // Draw the hand bar's pip canvases at native resolution: backing store
  // = displayed rect x devicePixelRatio x2 (supersampled like the legend),
  // so they're as crisp as the card faces. Also re-run on layout changes
  // (positionGameOverlays): the phone box is a square and the desktop box
  // is 1.1:1.4, so a bitmap drawn for one would be STRETCHED in the other
  // (e.g. a hand rendered behind the rotate gate, then turned back).
  function hydrateHandPips() {
    var style = SaveSystem.getSuitStyle();
    if (style === 'classic') return;
    var dpr = window.devicePixelRatio || 1;
    var pips = document.querySelectorAll('#hand-bar-cards canvas.inline-laser-pip[data-inline-pip]');
    for (var q = 0; q < pips.length; q++) {
      var rect = pips[q].getBoundingClientRect();
      if (rect.width > 0) {
        pips[q].width = Math.round(rect.width * dpr * 2);
        pips[q].height = Math.round(rect.height * dpr * 2);
      }
      LaserPips.renderPipCanvas(pips[q], pips[q].getAttribute('data-inline-pip'), style);
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
    return ensureRenderer().then(function () {
      // Settle the phone board's reserve BEFORE seats are placed
      syncPhoneReserve();
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
        // Avatar taps (onSeatAvatarTap): switch the hand bar between this
        // device's players, or — online host only — the recovery hatch
        // that reassigns a seat (AI / host / unseated joiner; refuses
        // seats held by connected guests, so no kicking live players).
        // .tappable (refreshSeatAffordances) shows which avatars respond.
        avatarWrap.addEventListener('click', (function (pid, seatIdx) {
          return function () { onSeatAvatarTap(pid, seatIdx); };
        })(p.id, p.seatIndex));
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
      refreshSeatAffordances();

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
    // Proportional card sizing (30's system): same fraction of the table
    // on every device instead of huge cards on phones.
    var viewScale = Math.min(W, H) / 1080;
    var cardScale = 1.1 * viewScale;
    var cardSpacing = 28.6 * viewScale;
    var CARDS_PER_ROW = 5;
    var ROW_INSET = 26.4 * viewScale;
    // Phones (v2.9): each hand is one face-down stack and the played
    // cards are 2x (MK's readability ask)
    var stackMode = Renderer.isStackMode();
    var trick = Renderer.getTrickLayout();

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

      if (stackMode) {
        // Thickness grows away from the center (-n), never into the trick
        Renderer.drawStack(handPos.x, handPos.y, numCards,
          seatPos.angle - Math.PI / 2, cardScale, -nDx, -nDy);
        continue;
      }

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

    // Draw trick cards in center (2vmin ring — 4vmin with 2x phone cards —
    // keeps the pile compact and clear of every hand)
    for (var t = 0; t < trickDisplay.length; t++) {
      var td = trickDisplay[t];
      var tdSeatPos = seatPositions[td.seatIndex];
      var trickX = tableCenter.x + Math.cos(tdSeatPos.angle) * trick.offset;
      var trickY = tableCenter.y + Math.sin(tdSeatPos.angle) * trick.offset;
      var trickRotation = tdSeatPos.angle - Math.PI / 2;

      Renderer.drawCard(trickX, trickY, td.card, true, trickRotation, trick.scale, 0.3);
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

    // Legend + hand-bar pip canvases render at their CSS pixel size —
    // refresh them so a resize doesn't leave them blurry or stretched
    if (gamePhase === 'playing') {
      updateSuitStackLegend(SaveSystem.getSuitStyle());
      hydrateHandPips();
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
    // Phones: the online room-code row hangs under the HUD's LEFT end —
    // the legend (also on the left) must clear it too (desktop unchanged)
    var roomRow = document.getElementById('hud-room-row');
    var minTopLeft = minTop;
    if (isPhoneLayout() && roomRow && roomRow.style.display !== 'none') {
      minTopLeft = Math.max(minTop, roomRow.getBoundingClientRect().bottom + 0.5 * vmin);
    }

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
      var ssLeft = leftSeat.x - ssW / 2;
      var ssTop = Math.max(minTopLeft, leftSeat.y - avatarHalf - breathingRoom - ssH);
      ssLeft += besideTableShift({ left: ssLeft, right: ssLeft + ssW, top: ssTop, bottom: ssTop + ssH }, -1);
      suitStack.style.left = ssLeft + 'px';
      suitStack.style.top = ssTop + 'px';
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
      var tiLeft = rightSeat.x - tiW / 2;
      var tiTop = Math.max(minTop, rightSeat.y - avatarHalf - breathingRoom - tiH);
      tiLeft += besideTableShift({ left: tiLeft, right: tiLeft + tiW, top: tiTop, bottom: tiTop + tiH }, 1);
      trickInfo.style.left = tiLeft + 'px';
      trickInfo.style.top = tiTop + 'px';
    }

    fitSeatTextToTable();
  }

  // ---- Beside the table: tangent AND on screen (v2.8, widened v2.9) ----
  // Avatars touch the table's outer wood edge exactly. The Stack box,
  // the legend, and the left/right seats' name + Bid lines are WIDER than
  // an avatar, so centered on one they cut into the circle — and with
  // 2x phone sizes they can also run off the screen edge. Each box keeps
  // its centered spot when it can, else slides just far enough to sit
  // between the screen edge and the circle (tangent to it). If even that
  // gap is too narrow, staying visible wins over touching the wood.
  var SCREEN_EDGE_PAD = 4;

  function isPhoneLayout() {
    return document.body.classList.contains('phone-portrait');
  }

  // The free span beside the table for a box covering rows top..bottom:
  // from the screen edge to the table's outer circle. side: -1 = left.
  // The screen-edge limit is PHONE-ONLY: off-phone this reproduces v2.8's
  // outward-only tangent push exactly (MK: no PC changes in v2.9).
  function besideTableRoom(top, bottom, side) {
    var c = Renderer.getTableCenter();
    var R = Renderer.getTableOuterRadius();
    var dy = Math.max(top - c.y, 0, c.y - bottom);
    var reach = dy >= R ? 0 : Math.sqrt(R * R - dy * dy);
    var phone = isPhoneLayout();
    return side < 0
      ? { lo: phone ? SCREEN_EDGE_PAD : -Infinity, hi: c.x - reach }
      : { lo: c.x + reach, hi: phone ? viewportSize().w - SCREEN_EDGE_PAD : Infinity };
  }

  function besideTableShift(rect, side) {
    var room = besideTableRoom(rect.top, rect.bottom, side);
    var w = rect.right - rect.left;
    var cx = (rect.left + rect.right) / 2;
    var target = (room.hi - room.lo >= w)
      ? Math.min(Math.max(cx, room.lo + w / 2), room.hi - w / 2)
      : (side < 0 ? room.lo + w / 2 : room.hi - w / 2);
    return target - cx;
  }

  // One text line beside the table. `scalable` lines (names, which are
  // 2x on phones) may first shrink to fit the gap — never below their
  // 1x size, since only the phone boost is optional.
  function fitBesideTable(el, side, scalable) {
    el.style.translate = '';
    el.style.fontSize = '';
    var r = el.getBoundingClientRect();
    if (!r.width) return;
    if (scalable) {
      var room = besideTableRoom(r.top, r.bottom, side);
      var avail = room.hi - room.lo;
      var k = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-k')) || 1;
      if (r.width > avail && k > 1) {
        var fs = parseFloat(getComputedStyle(el).fontSize);
        el.style.fontSize = (fs * Math.max(avail / r.width, 1 / k)) + 'px';
        r = el.getBoundingClientRect();
      }
    }
    var shift = besideTableShift(r, side);
    if (Math.abs(shift) > 0.5) el.style.translate = shift + 'px 0';
  }

  // Phones: the rename box replaces a (fitted) side name and starts out
  // centered on the 2x avatar — on the left/right seats that ran ~40px
  // off the screen. Slide it fully on screen; covering a bit of wood
  // while typing is fine (nothing is in play during setup / lobby).
  function keepInputOnScreen(input) {
    if (!isPhoneLayout()) return;
    var r = input.getBoundingClientRect();
    var vw = viewportSize().w;
    var shift = 0;
    if (r.left < SCREEN_EDGE_PAD) shift = SCREEN_EDGE_PAD - r.left;
    else if (r.right > vw - SCREEN_EDGE_PAD) shift = (vw - SCREEN_EDGE_PAD) - r.right;
    if (shift) input.style.translate = shift + 'px 0';
  }

  // Left (seat 2) and right (seat 6) players' text, on the game table AND
  // the setup/lobby ring. CSS `translate` leaves the seats' own transforms
  // alone. Re-run whenever that text changes width (updateStatLine).
  function fitSeatTextToTable() {
    if (!canvasReady) return;
    var gameSeats = document.querySelectorAll('.game-seat');
    for (var i = 0; i < gameSeats.length; i++) {
      var p = Game.getPlayerById(+gameSeats[i].dataset.player);
      if (!p || (p.seatIndex !== 2 && p.seatIndex !== 6)) continue;
      var side = p.seatIndex === 2 ? -1 : 1;
      var gName = gameSeats[i].querySelector('.game-seat-name');
      var gStat = gameSeats[i].querySelector('.game-seat-statline');
      if (gName) fitBesideTable(gName, side, true);
      if (gStat) fitBesideTable(gStat, side, false);
    }
    // Setup / lobby ring: phones only — v2.8 never moved these on PC, and
    // the ring is rebuilt from scratch on every render, so nothing lingers
    if (!isPhoneLayout()) return;
    var ringSeats = document.querySelectorAll('#seats-ring .seat');
    for (var s = 0; s < ringSeats.length; s++) {
      var idx = +ringSeats[s].dataset.seat;
      if (idx !== 2 && idx !== 6) continue;
      var rSide = idx === 2 ? -1 : 1;
      var rName = ringSeats[s].querySelector('.seat-name');
      var rBadge = ringSeats[s].querySelector('.lobby-controller-badge');
      if (rName) fitBesideTable(rName, rSide, true);
      if (rBadge) fitBesideTable(rBadge, rSide, false);
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

  function updateAllBidDisplays() {
    var gs = Game.getState();
    for (var i = 0; i < gs.players.length; i++) {
      updateStatLine(gs.players[i].id);
    }
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
    scheduleSeatFit(); // the line's width just changed
  }

  // Batch the re-fit: updateAll* touches four statlines in a row, and
  // one measure pass after all of them beats four interleaved ones.
  var _seatFitQueued = false;
  function scheduleSeatFit() {
    if (_seatFitQueued) return;
    _seatFitQueued = true;
    Promise.resolve().then(function () {
      _seatFitQueued = false;
      fitSeatTextToTable();
    });
  }

  function updateTrickInfo() {
    var el = document.getElementById('hud-trick');
    if (el) el.textContent = Game.getTrickNumber() + 1;
    // "10" is wider than "9" \u2014 keep the box tangent to the table
    if (canvasReady && gamePhase === 'playing') positionSuitStackAndTrickInfo();
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
    // Room row FIRST: updateTrickInfo re-places the legend, which must see
    // whether the row is showing (round 1 used to place it as if not)
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
    updateTrickInfo();
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

  // Reset every game-visual so a leave/disband doesn't leak stale state,
  // and cancel all pending game-flow continuations (see _flowEpoch).
  function clearGameDisplay() {
    _flowEpoch++;
    gameFlowLocked = false;
    handDisplay = {};
    trickDisplay = [];
    _waitingForRemote = false;
    _dealLock = false;
    _onlineQueue = [];
    _earlyRemoteAction = null;
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
    document.body.classList.remove('has-hand-owner');
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

    syncPhoneReserve(); // online: room-code row reserve (lobby = game board)
    ensureRenderer().then(function () {
      if (gamePhase !== 'online-lobby') return;
      Renderer.startLoop(function () {});
      renderOnlineLobbySeats();
    }).catch(function () { /* logged in ensureRenderer */ });
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
    fitSeatTextToTable(); // side names/badges: off the table, on the screen
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
    keepInputOnScreen(input);
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
    var lobbyState = Online.getLobbyState();
    var usedAnimals = [];
    for (var i = 0; i < lobbyState.seats.length; i++) {
      var st = lobbyState.seats[i];
      if (st && st.occupied && i !== seatIdx && st.animal) usedAnimals.push(st.animal);
    }
    showAnimalPicker(usedAnimals, function (animalId) {
      Online.sendChangeAnimal(seatIdx, animalId);
      closePicker();
    });
  }

  // ---- Online game flow ----

  // Fired on every device when the host clicks Deal (game_starting)
  function onlineBeginGame(players) {
    gamePhase = 'playing';
    _viewedPlayerId = null;
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
    if (isLocalPlayer(bidder)) {
      promptLocalBid(bidder, hasMultipleLocalPlayers());
    } else {
      setMessage(bidder.name + ' is bidding...');
    }
  }

  // Guest: replay a bid the host applied (our own bids echo back too)
  function guestApplyBid(playerId, value) {
    var ep = _flowEpoch;
    Game.setBid(playerId, value);
    updateStatLine(playerId);
    var p = Game.getPlayerById(playerId);
    setMessage((Online.isMyPlayer(playerId) ? 'You bid ' : p.name + ' bids ') + value);
    Animations.delay(400).then(function () {
      if (flowStale(ep)) return;
      Game.advanceBid();
      guestBidPrompt();
    });
  }

  // Guest: replay a card play the host applied
  function guestApplyPlay(playerId, cardIndex) {
    var player = Game.getPlayerById(playerId);
    if (!player) return;
    var card = Game.playCard(playerId, cardIndex);
    removeFromHandDisplay(playerId, card);
    setMessage(player.name + ' plays ' + card.rank + card.symbol);

    animatePlayCard(card, playerId, player.seatIndex).then(function () {
      if (isLocalPlayer(player)) renderHandBar();
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

  // Host: a guest move that arrived BEFORE our own replay reached that
  // guest's turn — their device finished the previous card's animation
  // first (no 300ms post-play pause on guests). It used to be dropped,
  // which froze the guest for good (their hand was already locked). It's
  // parked instead and applied when the turn comes — only within the
  // same stack / bidding round, so a stale move can never replay later.
  var _earlyRemoteAction = null;

  function parkEarlyAction(data) {
    _earlyRemoteAction = {
      data: data,
      round: Game.getRoundNumber(),
      phase: Game.getState().roundPhase,
      trick: Game.getTrickNumber()
    };
  }

  function takeEarlyAction(playerId) {
    var early = _earlyRemoteAction;
    if (!early || early.data.playerId !== playerId) return null;
    _earlyRemoteAction = null;
    var gs = Game.getState();
    if (early.round !== Game.getRoundNumber() || early.phase !== gs.roundPhase) return null;
    if (gs.roundPhase === 'playing' && early.trick !== Game.getTrickNumber()) return null;
    return early.data;
  }

  // Host: our turn loop just started waiting on a remote player — apply
  // their move if it already arrived
  function applyParkedAction(playerId) {
    var early = takeEarlyAction(playerId);
    if (early) onlineHandleRemoteAction(early);
  }

  // Host: a guest's action arrived (player_action)
  function onlineHandleRemoteAction(data) {
    if (!Online.isHost() || !data || !data.action) return;
    var action = data.action;

    if (action.type === 'bid') {
      var bidder = Game.getCurrentBidder();
      if (!bidder) return;
      if (bidder.id !== data.playerId) { parkEarlyAction(data); return; }
      _waitingForRemote = false;
      gameFlowLocked = false;
      hostApplyBid(data.playerId, action.value);
      return;
    }

    if (action.type === 'playCard') {
      var current = Game.getCurrentPlayer();
      if (!current) return;
      if (current.id !== data.playerId) { parkEarlyAction(data); return; }
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
        (function () {
          var ep = _flowEpoch;
          Animations.delay(1200).then(function () {
            if (flowStale(ep)) return;
            trickDisplay = [];
            Renderer.markDirty();
          });
        })();
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
      (function () {
        var ep = _flowEpoch;
        Animations.delay(800).then(function () {
          if (flowStale(ep)) return;
          showResults();
        });
      })();
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

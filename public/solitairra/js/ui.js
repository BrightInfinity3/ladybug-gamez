/* ============================================================
   Solitairra - UI Controller
   Screen management, canvas interaction, game render loop
   ============================================================ */

var UI = (function () {
  'use strict';

  // ---- Selection State ----
  var selection = null; // { source: 'waste'|'tableau', colIndex, cardIndex }
  var gameStarted = false;
  var lastClickTime = 0;
  var autoFoundationCooldown = 0; // timestamp of last auto-foundation move
  var glowPulse = 0;

  // ---- Illegal Move Flash ----
  var illegalFlash = null; // { x, y, startTime }

  // ---- Hit Targets (rebuilt each frame) ----
  var hitTargets = [];

  // ---- Drag State ----
  var dragState = null; // { source, colIndex, cardIndex, cards[], offsetX, offsetY, curX, curY }
  var mouseDownPos = null; // { x, y }
  var isDragging = false;
  var wasDragging = false;
  var DRAG_THRESHOLD = 5;

  // ---- Deal Animation State ----
  var dealing = false;
  var dealProgress = 0;
  var dealCards = []; // { col, row, card, faceUp, startTime }
  var dealGeneration = 0; // prevents stale timeouts from earlier deals

  // ---- Screen Management ----
  function showScreen(id) {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.remove('active');
    }
    document.getElementById(id).classList.add('active');
  }

  // ---- Suit naming: maps a standard suit to its label in the active mode ----
  var SUIT_NAMES_BY_MODE = {
    animals: { diamonds: 'Dolphins', hearts: 'Hares', spades: 'Spiders', clubs: 'Cubs' },
    laser:   { diamonds: 'Diodes',   hearts: 'Prisms', spades: 'Blades',  clubs: 'Combiners' },
    classic: { diamonds: 'Diamonds', hearts: 'Hearts', spades: 'Spades',  clubs: 'Clubs' }
  };
  function suitNameFor(suit, skins) {
    var mode = (skins && skins[suit]) || 'animals';
    var table = SUIT_NAMES_BY_MODE[mode] || SUIT_NAMES_BY_MODE.animals;
    return table[suit];
  }
  function currentSuitNames() {
    var skins = (Renderer.getSuitSkins ? Renderer.getSuitSkins().skins : null) || {};
    return {
      diamonds: suitNameFor('diamonds', skins),
      hearts:   suitNameFor('hearts', skins),
      spades:   suitNameFor('spades', skins),
      clubs:    suitNameFor('clubs', skins)
    };
  }

  // ---- How to Play: populated dynamically to match current suit style ----
  function renderRules() {
    var el = document.getElementById('rules-content');
    if (!el) return;
    var n = currentSuitNames();
    el.innerHTML =
      '<div class="rule-section">' +
        '<h3>Goal</h3>' +
        '<ul class="rule-list">' +
          '<li>Place the <strong>10 of ' + n.diamonds + '</strong> on its Foundation Stack to win.</li>' +
          '<li>Your score reflects how many cards you <strong>saved</strong>.</li>' +
        '</ul>' +
      '</div>' +
      '<div class="rule-section">' +
        '<h3>Layout</h3>' +
        '<ul class="rule-list">' +
          '<li>40-card deck (ranks 1&ndash;10), 4 suits, 6 tableau columns.</li>' +
          '<li>Only the top card of each tableau column starts face-up.</li>' +
          '<li>The remaining cards form the Stock Pile in the top-left.</li>' +
          '<li>An Active Pile and 4 Foundation Stacks also sit in the top row and start empty.</li>' +
        '</ul>' +
      '</div>' +
      '<div class="rule-section">' +
        '<h3>Controls</h3>' +
        '<ul class="rule-list">' +
          '<li>Click a card to select it, then drag the card or click a destination to move it.</li>' +
          '<li>Double-click a card to auto-send it to its Foundation Stack.</li>' +
        '</ul>' +
      '</div>' +
      '<div class="rule-section">' +
        '<h3>Building Foundations</h3>' +
        '<ul class="rule-list">' +
          '<li>Each Foundation Stack builds <strong>up by suit</strong> from 1 &ndash; 10.</li>' +
          '<li>Once a card is placed on a Foundation Stack, it <strong>cannot be removed</strong>.</li>' +
        '</ul>' +
      '</div>' +
      '<div class="rule-section">' +
        '<h3>Building Tableaus</h3>' +
        '<ul class="rule-list">' +
          '<li>Tableau columns build <strong>down by rank</strong> with a suit hierarchy.</li>' +
          '<li>A higher ranked suit cannot be placed below a lower ranked one.</li>' +
          '<li>Suit hierarchy: <strong>' + n.diamonds + ' &gt; ' + n.hearts + ' &gt; ' + n.spades + ' &gt; ' + n.clubs + '</strong></li>' +
          '<li>You can move a face-up card (and all cards below it) to another tableau column.</li>' +
          '<li>Only a 10 can be placed on an empty tableau column.</li>' +
        '</ul>' +
      '</div>' +
      '<div class="rule-section">' +
        '<h3>Stock Pile</h3>' +
        '<ul class="rule-list">' +
          '<li>Click the Stock Pile to draw one card to the top of the Active Pile.</li>' +
          '<li>The top Active Pile card can be placed on a tableau column or Foundation Stack.</li>' +
          '<li>When the Stock Pile is empty, click it again to recycle the cards.</li>' +
        '</ul>' +
      '</div>' +
      '<div class="rule-section">' +
        '<h3>Scoring</h3>' +
        '<ul class="rule-list">' +
          '<li>Your score calculates saved cards &mdash; those <em>not</em> placed on Foundation Stacks:</li>' +
          '<li><strong>Score</strong> = Saved ' + n.hearts + ' &times; 1 + Saved ' + n.spades + ' &times; 2 + Saved ' + n.clubs + ' &times; 3</li>' +
          '<li>A score of <strong>60</strong> is a perfect game (all cards saved). Higher is better!</li>' +
        '</ul>' +
      '</div>';
  }

  // ---- Initialize ----
  function init() {
    // Title screen buttons
    document.getElementById('btn-play').addEventListener('click', startNewGame);
    document.getElementById('btn-how-to-play').addEventListener('click', function () {
      renderRules();
      showScreen('screen-rules');
      var rulesPanel = document.querySelector('.rules-panel');
      if (rulesPanel) rulesPanel.scrollTop = 0;
    });
    document.getElementById('btn-rules-back').addEventListener('click', function () {
      showScreen('screen-title');
    });

    // Game screen buttons
    document.getElementById('btn-menu').addEventListener('click', function () {
      document.getElementById('confirm-exit').style.display = 'flex';
    });
    document.getElementById('btn-new-game-hud').addEventListener('click', function () {
      document.getElementById('confirm-new').style.display = 'flex';
    });
    document.getElementById('btn-confirm-yes').addEventListener('click', function () {
      document.getElementById('confirm-exit').style.display = 'none';
      exitToMenu();
    });
    document.getElementById('btn-confirm-no').addEventListener('click', function () {
      document.getElementById('confirm-exit').style.display = 'none';
    });
    document.getElementById('btn-confirm-new-yes').addEventListener('click', function () {
      document.getElementById('confirm-new').style.display = 'none';
      startNewGame();
    });
    document.getElementById('btn-confirm-new-no').addEventListener('click', function () {
      document.getElementById('confirm-new').style.display = 'none';
    });

    // Dev mode: insta-win (button hidden in HTML, kept for testing)
    var devWinBtn = document.getElementById('btn-dev-win');
    if (devWinBtn) devWinBtn.addEventListener('click', function () {
      if (!gameStarted || Game.isGameOver()) return;
      Game.devWin();
      updateHUD();
      showResults();
    });

    // Options screen buttons
    document.getElementById('btn-options').addEventListener('click', function () {
      showScreen('screen-options');
      var optionsPanel = document.querySelector('.options-panel');
      if (optionsPanel) optionsPanel.scrollTop = 0;
      renderSuitPreview();
    });
    document.getElementById('btn-options-back').addEventListener('click', function () {
      showScreen('screen-title');
    });

    // Suit mode toggle (Animals / Classic; Laser button deactivated but code preserved)
    document.getElementById('btn-mode-animals').addEventListener('click', function () {
      setAllSuitMode('animals');
    });
    var btnModeLaser = document.getElementById('btn-mode-laser');
    if (btnModeLaser) btnModeLaser.addEventListener('click', function () {
      setAllSuitMode('laser');
    });
    document.getElementById('btn-mode-classic').addEventListener('click', function () {
      setAllSuitMode('classic');
    });

    // Face card mode toggle (buttons may be hidden/commented out in HTML)
    var btnFaceOff = document.getElementById('btn-face-off');
    var btnFaceOn = document.getElementById('btn-face-on');
    if (btnFaceOff) btnFaceOff.addEventListener('click', function () {
      CardSystem.setFaceCardMode(false);
      btnFaceOff.classList.add('active');
      btnFaceOn.classList.remove('active');
      saveSuitPrefsFromUI();
      renderSuitPreview();
    });
    if (btnFaceOn) btnFaceOn.addEventListener('click', function () {
      CardSystem.setFaceCardMode(true);
      btnFaceOff.classList.remove('active');
      btnFaceOn.classList.add('active');
      saveSuitPrefsFromUI();
      renderSuitPreview();
    });

    // Variant buttons (delegated)
    var variantBtns = document.querySelectorAll('.variant-btn');
    for (var vi = 0; vi < variantBtns.length; vi++) {
      variantBtns[vi].addEventListener('click', function () {
        var suit = this.getAttribute('data-suit');
        var variant = this.getAttribute('data-variant');
        var siblings = this.parentElement.querySelectorAll('.variant-btn');
        for (var si = 0; si < siblings.length; si++) siblings[si].classList.remove('active');
        this.classList.add('active');
        if (suit === 'diamonds') {
          Renderer.setDiodeScheme(variant);
        } else if (suit === 'hearts') {
          Renderer.setPrismScheme(variant);
        } else if (suit === 'spades-style') {
          Renderer.setBladeStyle(variant);
        } else if (suit === 'spades') {
          Renderer.setBladeScheme(variant);
        } else if (suit === 'clubs') {
          Renderer.setCombinerScheme(variant);
        }
        saveSuitPrefsFromUI();
        renderSuitPreview();
      });
    }

    // Set suit options to defaults (and update UI buttons)
    resetSuitDefaults();

    // Leaderboard screen buttons
    document.getElementById('btn-leaderboard').addEventListener('click', function () {
      populateLeaderboard();
      showScreen('screen-leaderboard');
      var lbPanel = document.querySelector('.leaderboard-panel');
      if (lbPanel) lbPanel.scrollTop = 0;
    });
    document.getElementById('btn-leaderboard-back').addEventListener('click', function () {
      showScreen('screen-title');
    });

    // Results screen buttons
    document.getElementById('btn-play-again').addEventListener('click', startNewGame);
    document.getElementById('btn-results-menu').addEventListener('click', exitToMenu);

    // Leaderboard name submission
    document.getElementById('btn-submit-score').addEventListener('click', submitScore);
    document.getElementById('leaderboard-name').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submitScore();
    });

    // Canvas event handlers
    var canvas = document.getElementById('game-canvas');
    canvas.addEventListener('click', onCanvasClick);
    canvas.addEventListener('mousedown', onCanvasMouseDown);
    canvas.addEventListener('mousemove', onCanvasMouseMove);
    canvas.addEventListener('mouseup', onCanvasMouseUp);

    // Cancel drag if mouse released outside canvas (e.g. at screen edge)
    window.addEventListener('mouseup', function () {
      if (isDragging && dragState) {
        dragState = null;
        mouseDownPos = null;
        isDragging = false;
        wasDragging = true;
      }
    });

    // Touch support: convert touch events to mouse-like events
    canvas.addEventListener('touchstart', function (e) {
      e.preventDefault();
      var touch = e.changedTouches[0];
      onCanvasMouseDown({ clientX: touch.clientX, clientY: touch.clientY, target: canvas });
    }, { passive: false });
    canvas.addEventListener('touchmove', function (e) {
      e.preventDefault();
      var touch = e.changedTouches[0];
      onCanvasMouseMove({ clientX: touch.clientX, clientY: touch.clientY, target: canvas });
    }, { passive: false });
    canvas.addEventListener('touchend', function (e) {
      e.preventDefault();
      var touch = e.changedTouches[0];
      onCanvasMouseUp({ clientX: touch.clientX, clientY: touch.clientY, target: canvas });
      // Also fire click for tap/double-tap detection
      onCanvasClick({ clientX: touch.clientX, clientY: touch.clientY, target: canvas });
    }, { passive: false });

    // Window resize
    window.addEventListener('resize', function () {
      if (gameStarted) {
        Renderer.resize();
        updateHUDLayout();
      }
    });

    // Continue button disabled for now (code kept for future use)
    // if (SaveSystem.hasSave()) {
    //   var continueBtn = document.createElement('button');
    //   continueBtn.className = 'btn btn-outline btn-menu-size';
    //   continueBtn.id = 'btn-continue';
    //   continueBtn.textContent = 'Continue';
    //   var saveTime = SaveSystem.getSaveTimestamp();
    //   if (saveTime) {
    //     continueBtn.textContent = 'Continue (' + SaveSystem.timeAgo(saveTime) + ')';
    //   }
    //   continueBtn.addEventListener('click', continueGame);
    //   document.querySelector('.title-buttons').appendChild(continueBtn);
    // }

    // Floating suit symbols on title screen
    createFloatingSuits();

    // Eagerly initialize PixiJS so WebGL context and textures are ready
    // before the user clicks Play (eliminates blank screen on game start)
    var canvas = document.getElementById('game-canvas');
    Renderer.init(canvas);

    showScreen('screen-title');
  }

  // ---- Floating Suits (title screen) ----
  function createFloatingSuits() {
    var container = document.querySelector('.floating-suits');
    if (!container) return;
    var symbols = ['\u2660', '\u2665', '\u2666', '\u2663'];
    for (var i = 0; i < 20; i++) {
      var span = document.createElement('span');
      span.className = 'float-suit';
      span.textContent = symbols[i % 4];
      span.style.left = Math.random() * 100 + '%';
      span.style.animationDelay = (Math.random() * 8) + 's';
      span.style.fontSize = (1 + Math.random() * 1.5) + 'rem';
      container.appendChild(span);
    }
  }

  // ---- Reset suit options to defaults and update UI buttons ----
  function resetSuitDefaults() {
    // Default: animals mode, no face cards. Laser variants set for later use.
    CardSystem.setFaceCardMode(false);
    Renderer.setSuitSkin('diamonds', 'animals');
    Renderer.setSuitSkin('hearts', 'animals');
    Renderer.setSuitSkin('spades', 'animals');
    Renderer.setSuitSkin('clubs', 'animals');
    Renderer.setDiodeScheme('red');
    Renderer.setPrismScheme('red');
    Renderer.setBladeScheme('black');
    Renderer.setBladeStyle('fan');
    Renderer.setCombinerScheme('black');

    // Update UI buttons to reflect defaults (laser button may be hidden/removed)
    toggleMode('btn-mode-animals', true);
    toggleMode('btn-mode-laser',   false);
    toggleMode('btn-mode-classic', false);
    var laserOpts = document.getElementById('laser-options');
    if (laserOpts) laserOpts.style.display = 'none';

    // Update variant buttons (stay set even while hidden)
    var allVariantBtns = document.querySelectorAll('.variant-btn');
    for (var i = 0; i < allVariantBtns.length; i++) {
      var btn = allVariantBtns[i];
      var suit = btn.getAttribute('data-suit');
      var variant = btn.getAttribute('data-variant');
      var isActive = false;
      if (suit === 'diamonds') isActive = (variant === 'red');
      else if (suit === 'hearts') isActive = (variant === 'red');
      else if (suit === 'spades') isActive = (variant === 'black');
      else if (suit === 'spades-style') isActive = (variant === 'fan');
      else if (suit === 'clubs') isActive = (variant === 'black');
      btn.classList.toggle('active', isActive);
    }

    saveSuitPrefsFromUI();
  }

  // Shared helper: once PixiJS is ready, resize + rebuild + start loop
  function launchGame(shouldDeal) {
    Renderer.resize();
    Renderer.rebuildTextures();
    gameStarted = true;
    if (shouldDeal) {
      dealing = true;
      dealProgress = 0;
      setupDealAnimation();
    } else {
      dealing = false;
    }
    Renderer.startLoop(renderGame);
    updateHUD();
    updateHUDLayout();
  }

  // ---- Start New Game ----
  function startNewGame() {
    Game.newGame();
    selection = null;
    dragState = null;
    SaveSystem.clearSave();
    showScreen('screen-game');

    // PixiJS was initialized at page load — usually ready by now.
    // init() returns the cached promise, which resolves immediately if ready.
    var canvas = document.getElementById('game-canvas');
    Renderer.init(canvas).then(function () {
      launchGame(true);
    });
  }

  // ---- Continue Saved Game ----
  function continueGame() {
    var saved = SaveSystem.loadGame();
    if (!saved) {
      startNewGame();
      return;
    }
    Game.deserialize(saved.gameState);
    selection = null;
    dragState = null;
    showScreen('screen-game');

    var canvas = document.getElementById('game-canvas');
    Renderer.init(canvas).then(function () {
      launchGame(false);
    });
  }

  // ---- Suit Options Helpers ----
  function toggleMode(id, active) {
    var el = document.getElementById(id);
    if (el) el.classList.toggle('active', !!active);
  }
  function setAllSuitMode(mode) {
    var suits = ['diamonds', 'hearts', 'spades', 'clubs'];
    for (var i = 0; i < suits.length; i++) {
      Renderer.setSuitSkin(suits[i], mode);
    }
    // Update mode toggle buttons (laser button may be hidden/removed)
    toggleMode('btn-mode-animals', mode === 'animals');
    toggleMode('btn-mode-laser',   mode === 'laser');
    toggleMode('btn-mode-classic', mode === 'classic');
    // Show laser variant options only in laser mode
    var laserOpts = document.getElementById('laser-options');
    if (laserOpts) laserOpts.style.display = mode === 'laser' ? '' : 'none';
    saveSuitPrefsFromUI();
    renderSuitPreview();
  }

  function renderSuitPreview() {
    var canvas = document.getElementById('preview-canvas');
    if (!canvas) return;
    var c = canvas.getContext('2d');
    var w = canvas.width;
    var h = canvas.height;
    c.clearRect(0, 0, w, h);

    // Suit names — animals + classic show only the primary name (no parentheticals)
    var suits = ['diamonds', 'hearts', 'spades', 'clubs'];
    var skins = Renderer.getSuitSkins().skins;
    var mode = skins.diamonds;
    var suitNames, suitAltNames;
    if (mode === 'classic') {
      suitNames = { diamonds: 'Diamonds', hearts: 'Hearts', spades: 'Spades', clubs: 'Clubs' };
      suitAltNames = { diamonds: '', hearts: '', spades: '', clubs: '' };
    } else if (mode === 'animals') {
      suitNames = { diamonds: 'Dolphins', hearts: 'Hares', spades: 'Spiders', clubs: 'Cubs' };
      suitAltNames = { diamonds: '', hearts: '', spades: '', clubs: '' };
    } else {
      suitNames = { diamonds: 'Diodes', hearts: 'Prisms', spades: 'Blades', clubs: 'Combiners' };
      suitAltNames = { diamonds: '(Diamonds)', hearts: '(Hearts)', spades: '(Spades)', clubs: '(Clubs)' };
    }
    var sampleRank = '10';
    var cardW = 104;
    var cardH = 148;
    var gap = 18;
    var hasAltLine = !!suitAltNames[suits[0]];
    var labelLineH = 22;                        // main name line
    var altLineH = hasAltLine ? 20 : 0;         // alt name line (0 when absent)
    var labelGap = hasAltLine ? 10 : 6;         // small gap under labels; tighter for single-line modes
    var labelsH = labelLineH + altLineH + labelGap;
    var totalContentH = labelsH + cardH;
    var totalW = suits.length * cardW + (suits.length - 1) * gap;
    var startX = (w / 2 - totalW / 2);
    var startY = (h / 2 - totalContentH / 2); // center vertically

    for (var i = 0; i < suits.length; i++) {
      var cardCanvas = Renderer._renderCard(sampleRank, suits[i]);
      var dx = startX + i * (cardW + gap);
      var cx = dx + cardW / 2;

      // Main suit name above card
      c.font = '700 18px "Cinzel", serif';
      c.fillStyle = '#d4a017';
      c.textAlign = 'center';
      c.textBaseline = 'bottom';
      c.fillText(suitNames[suits[i]], cx, startY + labelLineH);

      // Alt name in parens (same bold Cinzel font, same gold)
      if (suitAltNames[suits[i]]) {
        c.font = '700 15px "Cinzel", serif';
        c.fillStyle = '#d4a017';
        c.textBaseline = 'bottom';
        c.fillText(suitAltNames[suits[i]], cx, startY + labelLineH + altLineH);
      }

      // Card
      var cardY = startY + labelsH;
      c.drawImage(cardCanvas, 0, 0, cardCanvas.width, cardCanvas.height, dx, cardY, cardW, cardH);
    }
  }

  function saveSuitPrefsFromUI() {
    var config = Renderer.getSuitSkins();
    config.faceCardMode = CardSystem.getFaceCardMode();
    SaveSystem.saveSuitPrefs(config);
  }

  function loadSavedSuitPrefs() {
    var prefs = SaveSystem.loadSuitPrefs();
    if (!prefs) return;

    // Restore face card mode
    if (prefs.faceCardMode !== undefined) {
      CardSystem.setFaceCardMode(prefs.faceCardMode);
      var fOff = document.getElementById('btn-face-off');
      var fOn = document.getElementById('btn-face-on');
      if (fOff) fOff.classList.toggle('active', !prefs.faceCardMode);
      if (fOn) fOn.classList.toggle('active', !!prefs.faceCardMode);
    }

    // Restore skins
    if (prefs.skins) {
      var suits = ['diamonds', 'hearts', 'spades', 'clubs'];
      for (var i = 0; i < suits.length; i++) {
        if (prefs.skins[suits[i]]) {
          Renderer.setSuitSkin(suits[i], prefs.skins[suits[i]]);
        }
      }
      // Update mode toggle (laser button may be hidden/removed)
      var mode = prefs.skins.diamonds || 'animals';
      toggleMode('btn-mode-animals', mode === 'animals');
      toggleMode('btn-mode-laser',   mode === 'laser');
      toggleMode('btn-mode-classic', mode === 'classic');
      var laserOpts = document.getElementById('laser-options');
      if (laserOpts) laserOpts.style.display = mode === 'laser' ? '' : 'none';
    }

    // Restore variant selections (migrate old scheme names)
    var SCHEME_MIGRATION = { standard: 'black', 'blue-glow': 'blue', broad: 'hybrid' };
    function migrateScheme(name) { return SCHEME_MIGRATION[name] || name; }
    if (prefs.diodeScheme) {
      Renderer.setDiodeScheme(migrateScheme(prefs.diodeScheme));
      var resolvedDiode = Renderer.getSuitSkins().diodeScheme;
      var dBtns = document.querySelectorAll('.variant-btn[data-suit="diamonds"]');
      for (var d = 0; d < dBtns.length; d++) {
        dBtns[d].classList.toggle('active', dBtns[d].getAttribute('data-variant') === resolvedDiode);
      }
    }
    if (prefs.prismScheme) {
      Renderer.setPrismScheme(migrateScheme(prefs.prismScheme));
      var resolvedPrism = Renderer.getSuitSkins().prismScheme;
      var pBtns = document.querySelectorAll('.variant-btn[data-suit="hearts"]');
      for (var p = 0; p < pBtns.length; p++) {
        pBtns[p].classList.toggle('active', pBtns[p].getAttribute('data-variant') === resolvedPrism);
      }
    }
    if (prefs.bladeScheme) {
      Renderer.setBladeScheme(migrateScheme(prefs.bladeScheme));
      var resolvedBlade = Renderer.getSuitSkins().bladeScheme;
      var sBtns = document.querySelectorAll('.variant-btn[data-suit="spades"]');
      for (var sb = 0; sb < sBtns.length; sb++) {
        sBtns[sb].classList.toggle('active', sBtns[sb].getAttribute('data-variant') === resolvedBlade);
      }
    }
    if (prefs.bladeStyle) {
      Renderer.setBladeStyle(prefs.bladeStyle);
      var resolvedStyle = Renderer.getSuitSkins().bladeStyle;
      var stBtns = document.querySelectorAll('.variant-btn[data-suit="spades-style"]');
      for (var st = 0; st < stBtns.length; st++) {
        stBtns[st].classList.toggle('active', stBtns[st].getAttribute('data-variant') === resolvedStyle);
      }
    }
    if (prefs.combinerScheme) {
      Renderer.setCombinerScheme(migrateScheme(prefs.combinerScheme));
      var resolvedCombiner = Renderer.getSuitSkins().combinerScheme;
      var cBtns = document.querySelectorAll('.variant-btn[data-suit="clubs"]');
      for (var cb = 0; cb < cBtns.length; cb++) {
        cBtns[cb].classList.toggle('active', cBtns[cb].getAttribute('data-variant') === resolvedCombiner);
      }
    }
  }

  // ---- Exit to Menu ----
  function exitToMenu() {
    Renderer.stopLoop();
    gameStarted = false;
    selection = null;
    dragState = null;
    SaveSystem.clearSave();

    // Remove continue button if exists
    var cb = document.getElementById('btn-continue');
    if (cb) cb.remove();

    showScreen('screen-title');
  }

  // ---- Deal Animation ----
  function setupDealAnimation() {
    dealCards = [];
    var state = Game.getState();
    var delay = 0;
    for (var col = 0; col < state.tableau.length; col++) {
      for (var row = 0; row < state.tableau[col].length; row++) {
        dealCards.push({
          col: col,
          row: row,
          card: state.tableau[col][row].card,
          faceUp: state.tableau[col][row].faceUp,
          delay: delay
        });
        delay += Animations.TIMING.DEAL_INTERVAL;
      }
    }
    dealProgress = 0;
    dealing = true;
    dealGeneration++;

    // End dealing after all cards have been dealt (guarded by generation)
    var totalDealTime = delay + Animations.TIMING.DEAL_FLIGHT;
    var gen = dealGeneration;
    setTimeout(function () {
      if (gen !== dealGeneration) return; // stale timeout from previous game
      dealing = false;
      SaveSystem.saveGame();
    }, totalDealTime);
  }

  // ---- Update HUD ----
  function updateHUD() {
    var state = Game.getState();
    document.getElementById('hud-moves').textContent = Math.min(state.moves, 999);
    document.getElementById('hud-stock').textContent = state.stock.length;
  }

  // ---- Update HUD Layout (align with game layout) ----
  function updateHUDLayout() {
    var layout = Renderer.getLayout();
    var size = Renderer.getCanvasSize();
    var hud = document.getElementById('game-hud');
    var rightEdge = layout.foundationX(3) + layout.cw / 2;
    hud.style.paddingLeft = '0';
    hud.style.paddingRight = (size.w - rightEdge) + 'px';
    hud.style.height = layout.hudH + 'px';

    // Dynamic font sizing: use the pixel gap between stock and waste left edges
    // to ensure "Moves: ###" and "Stock: ###" never overlap
    var movesLeftPx = layout.stockX - layout.cw / 2;
    var stockLeftPx = layout.wasteX - layout.cw / 2;
    var slotWidth = stockLeftPx - movesLeftPx; // px available for "Moves: ###"
    // "MOVES: 999" is ~10 characters in Cinzel uppercase; estimate ~0.7em per char
    var maxLabelRem = slotWidth / (10 * 0.7 * 16); // convert px to rem
    var labelSize = Math.max(0.5, Math.min(1.125, layout.scale * 1.0, maxLabelRem));
    var valueSize = labelSize * 1.1;
    var btnSize = Math.max(0.5, Math.min(1.0, labelSize));

    var labels = hud.querySelectorAll('.hud-label');
    for (var i = 0; i < labels.length; i++) {
      labels[i].style.fontSize = labelSize + 'rem';
    }
    var values = hud.querySelectorAll('.hud-value');
    for (var j = 0; j < values.length; j++) {
      values[j].style.fontSize = valueSize + 'rem';
    }
    var btns = hud.querySelectorAll('.btn-hud');
    // Scale button padding to fit within HUD height
    var btnPadV = Math.max(0.1, Math.min(0.3, (layout.hudH - btnSize * 16 * 1.2) / 32));
    for (var b = 0; b < btns.length; b++) {
      btns[b].style.fontSize = btnSize + 'rem';
      btns[b].style.padding = btnPadV + 'em 0.5em';
    }

    // Align "Moves:" left edge to stock pile left edge
    var movesItem = document.getElementById('hud-item-moves');
    if (movesItem) {
      movesItem.style.position = 'absolute';
      movesItem.style.left = movesLeftPx + 'px';
    }

    // Align "Stock:" left edge to active pile left edge
    var stockItem = document.getElementById('hud-item-stock');
    if (stockItem) {
      stockItem.style.position = 'absolute';
      stockItem.style.left = stockLeftPx + 'px';
    }

    // Position button group: right-aligned to last foundation right edge
    var hudGroups = hud.querySelectorAll('.hud-group');
    if (hudGroups.length > 1) {
      var btnGroup = hudGroups[1];
      btnGroup.style.position = 'absolute';
      btnGroup.style.right = (size.w - rightEdge) + 'px';
      // Tighten gap on narrow screens
      var btnGap = Math.max(0.4, Math.min(1.8, slotWidth / 80));
      btnGroup.style.gap = btnGap + 'em';
    }

    // Position dev win button between stock pile and first tableau column
    var devBtn = document.getElementById('btn-dev-win');
    if (devBtn) {
      var stockBottom = layout.stockY + layout.ch / 2;
      var tabTop = layout.tableauStartY - layout.ch / 2;
      var midY = (stockBottom + tabTop) / 2;
      devBtn.style.left = (layout.stockX - 12) + 'px';
      devBtn.style.top = midY + 'px';
    }
  }

  // ---- Hit Detection ----
  function findHit(x, y) {
    for (var i = hitTargets.length - 1; i >= 0; i--) {
      var t = hitTargets[i];
      if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) {
        return t;
      }
    }
    return null;
  }

  // ================================================================
  //  DRAG HANDLING
  // ================================================================

  function onCanvasMouseDown(e) {
    if (dealing || Game.isGameOver()) return;
    var rect = e.target.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;
    mouseDownPos = { x: x, y: y };
    isDragging = false;
  }

  function onCanvasMouseMove(e) {
    if (!mouseDownPos) return;
    var rect = e.target.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;

    if (!isDragging) {
      var dx = x - mouseDownPos.x;
      var dy = y - mouseDownPos.y;
      if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
        isDragging = true;
        startDrag(mouseDownPos.x, mouseDownPos.y);
      }
    }

    if (isDragging && dragState) {
      dragState.curX = x;
      dragState.curY = y;
    }
  }

  function onCanvasMouseUp(e) {
    if (isDragging && dragState) {
      wasDragging = true;
      var rect = e.target.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;

      var hit = findHit(x, y);
      var moved = false;
      if (hit) {
        moved = tryDragDrop(hit);
      }

      if (moved) {
        selection = null;
        updateHUD();
        SaveSystem.saveGame();
        if (Game.isWon()) showResults();
      }
      dragState = null;
    } else {
      wasDragging = false;
    }
    mouseDownPos = null;
    isDragging = false;
  }

  function startDrag(mouseX, mouseY) {
    var hit = findHit(mouseX, mouseY);
    if (!hit) return;

    var layout = Renderer.getLayout();
    var state = Game.getState();

    if (hit.type === 'waste' && state.waste.length > 0) {
      dragState = {
        source: 'waste',
        cards: [state.waste[state.waste.length - 1]],
        offsetX: mouseX - layout.wasteX,
        offsetY: mouseY - layout.wasteY,
        curX: mouseX,
        curY: mouseY
      };
      selection = null;
    } else if (hit.type === 'tableau' && hit.faceUp) {
      var col = state.tableau[hit.colIndex];
      var cards = [];
      for (var i = hit.cardIndex; i < col.length; i++) {
        cards.push(col[i].card);
      }
      // Calculate card center position
      var colX = layout.tableauX(hit.colIndex);
      var offset = 0;
      for (var k = 0; k < hit.cardIndex; k++) {
        offset += col[k].faceUp ? layout.faceUpOffset : layout.faceDownOffset;
      }
      var cardY = layout.tableauStartY + offset;

      dragState = {
        source: 'tableau',
        colIndex: hit.colIndex,
        cardIndex: hit.cardIndex,
        cards: cards,
        offsetX: mouseX - colX,
        offsetY: mouseY - cardY,
        curX: mouseX,
        curY: mouseY
      };
      selection = null;
    }
  }

  function tryDragDrop(hit) {
    if (!dragState) return false;

    // Move to foundation
    if (hit.type === 'foundation') {
      if (dragState.cards.length !== 1) return false;
      if (dragState.source === 'waste') {
        return Game.moveWasteToFoundation(hit.foundationIndex);
      } else if (dragState.source === 'tableau') {
        var col = Game.getState().tableau[dragState.colIndex];
        if (dragState.cardIndex === col.length - 1) {
          return Game.moveTableauToFoundation(dragState.colIndex, hit.foundationIndex);
        }
      }
      return false;
    }

    // Move to tableau
    if (hit.type === 'tableau' || hit.type === 'tableau-empty') {
      var toCol = hit.colIndex;
      if (dragState.source === 'waste') {
        return Game.moveWasteToTableau(toCol);
      } else if (dragState.source === 'tableau') {
        if (dragState.colIndex === toCol) return false;
        return Game.moveTableauToTableau(dragState.colIndex, dragState.cardIndex, toCol);
      }
    }

    return false;
  }

  // ================================================================
  //  CANVAS CLICK HANDLER
  // ================================================================

  function onCanvasClick(e) {
    if (wasDragging) {
      wasDragging = false;
      return;
    }
    if (dealing || Game.isGameOver()) return;

    var rect = e.target.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;

    // Check for double-click (with cooldown after auto-foundation to prevent chain sends)
    var now = Date.now();
    var isDoubleClick = (now - lastClickTime) < 350 && (now - autoFoundationCooldown) > 400;
    lastClickTime = now;

    // Find what was clicked
    var hit = findHit(x, y);

    if (!hit) {
      // Clicked empty space — deselect
      selection = null;
      return;
    }

    // Handle stock click
    if (hit.type === 'stock') {
      selection = null;
      var gs = Game.getState();
      // Prevent recycling when stock is empty and only 1 card left in waste
      if (gs.stock.length === 0 && gs.waste.length <= 1) return;
      Game.drawFromStock();
      updateHUD();
      SaveSystem.saveGame();
      return;
    }

    // Handle double-click/tap for auto-foundation (checked before selection logic)
    if (isDoubleClick) {
      var autoCard = null;
      var autoResult = false;

      if (hit.type === 'waste') {
        var waste = Game.getState().waste;
        if (waste.length > 0) {
          autoCard = waste[waste.length - 1];
          var fi = Game.findAutoFoundation(autoCard);
          if (fi >= 0) {
            autoResult = Game.moveWasteToFoundation(fi);
          }
        }
      } else if (hit.type === 'tableau') {
        var col = Game.getState().tableau[hit.colIndex];
        if (col.length > 0 && col[col.length - 1].faceUp) {
          autoCard = col[col.length - 1].card;
          var fi2 = Game.findAutoFoundation(autoCard);
          if (fi2 >= 0) {
            autoResult = Game.moveTableauToFoundation(hit.colIndex, fi2);
          }
        }
      }

      if (autoResult) {
        selection = null;
        autoFoundationCooldown = Date.now();
        updateHUD();
        SaveSystem.saveGame();
        if (Game.isWon()) showResults();
        return;
      }

      // Double-click failed — show can't symbol on the card
      if (autoCard || hit.type === 'waste' || hit.type === 'tableau') {
        var layout = Renderer.getLayout();
        var flashX, flashY;
        if (hit.type === 'waste') {
          flashX = layout.wasteX;
          flashY = layout.wasteY;
        } else {
          flashX = layout.tableauX(hit.colIndex);
          var col2 = Game.getState().tableau[hit.colIndex];
          var cardY2 = layout.tableauStartY;
          for (var ci2 = 0; ci2 < col2.length - 1; ci2++) {
            cardY2 += col2[ci2].faceUp ? layout.faceUpOffset : layout.faceDownOffset;
          }
          flashY = cardY2;
        }
        illegalFlash = { x: flashX, y: flashY, startTime: performance.now() };
        selection = null;
        return;
      }
    }

    // Handle selection logic
    if (selection) {
      // Check if clicking the same card that's already selected — just toggle off
      var isSameCard = false;
      if (selection.source === 'waste' && hit.type === 'waste') {
        isSameCard = true;
      } else if (selection.source === 'tableau' && hit.type === 'tableau' &&
                 selection.colIndex === hit.colIndex && selection.cardIndex === hit.cardIndex) {
        isSameCard = true;
      }
      if (isSameCard) {
        selection = null;
        return;
      }

      // Try to place the selected card(s)
      var moved = tryMove(hit);
      if (moved) {
        selection = null;
        updateHUD();
        SaveSystem.saveGame();
        if (Game.isWon()) showResults();
        return;
      }

      // Show illegal move flash on the destination and deselect
      if (hit.type === 'foundation' || hit.type === 'tableau' || hit.type === 'tableau-empty') {
        var layout = Renderer.getLayout();
        var flashX, flashY;
        if (hit.type === 'foundation') {
          flashX = layout.foundationX(hit.foundationIndex);
          flashY = layout.foundationY;
        } else {
          flashX = layout.tableauX(hit.colIndex);
          var col = Game.getState().tableau[hit.colIndex];
          if (col.length === 0) {
            flashY = layout.tableauStartY;
          } else {
            var cardY = layout.tableauStartY;
            for (var ci = 0; ci < col.length - 1; ci++) {
              cardY += col[ci].faceUp ? layout.faceUpOffset : layout.faceDownOffset;
            }
            flashY = cardY;
          }
        }
        illegalFlash = { x: flashX, y: flashY, startTime: performance.now() };
        selection = null;
        return;
      }

      // If clicked on a different selectable card, switch selection
      if (isSelectable(hit)) {
        setSelection(hit);
        return;
      }

      // Deselect
      selection = null;
      return;
    }

    // No selection — try to select
    if (isSelectable(hit)) {
      setSelection(hit);
    }
  }

  function isSelectable(hit) {
    if (hit.type === 'waste') {
      return Game.getState().waste.length > 0;
    }
    if (hit.type === 'tableau') {
      var col = Game.getState().tableau[hit.colIndex];
      if (hit.cardIndex >= 0 && hit.cardIndex < col.length) {
        return col[hit.cardIndex].faceUp;
      }
    }
    return false;
  }

  function setSelection(hit) {
    if (hit.type === 'waste') {
      selection = { source: 'waste' };
    } else if (hit.type === 'tableau') {
      selection = { source: 'tableau', colIndex: hit.colIndex, cardIndex: hit.cardIndex };
    }
  }

  function tryMove(hit) {
    if (!selection) return false;
    var state = Game.getState();

    // Move to foundation
    if (hit.type === 'foundation') {
      if (selection.source === 'waste') {
        return Game.moveWasteToFoundation(hit.foundationIndex);
      } else if (selection.source === 'tableau') {
        // Only top card can go to foundation
        var col = state.tableau[selection.colIndex];
        if (selection.cardIndex === col.length - 1) {
          return Game.moveTableauToFoundation(selection.colIndex, hit.foundationIndex);
        }
      }
      return false;
    }

    // Move to tableau column
    if (hit.type === 'tableau' || hit.type === 'tableau-empty') {
      var toCol = hit.colIndex;
      if (selection.source === 'waste') {
        return Game.moveWasteToTableau(toCol);
      } else if (selection.source === 'tableau') {
        if (selection.colIndex === toCol) return false; // same column
        return Game.moveTableauToTableau(selection.colIndex, selection.cardIndex, toCol);
      }
    }

    return false;
  }

  // ---- Show Results ----
  function showResults() {
    setTimeout(function () {
      var score = Game.calculateScore();
      var moves = Game.getMoves();

      document.getElementById('result-score').textContent = score;
      document.getElementById('result-moves').textContent = moves;

      // Show foundation state with suit pips and colored numbers
      var state = Game.getState();
      var foundationInfo = document.getElementById('result-foundations');
      foundationInfo.innerHTML = '';
      var suits = Game.FOUNDATION_SUITS;
      for (var i = 0; i < 4; i++) {
        var pile = state.foundations[i];
        var topRank = pile.length > 0 ? pile[pile.length - 1].rank : '-';
        var span = document.createElement('span');
        span.className = 'foundation-result';
        // Render suit pip in a fixed-height wrapper so all pips align
        var pipCanvas = Renderer._renderSuitPip(suits[i], 42);
        pipCanvas.style.display = 'block';
        var pipWrap = document.createElement('div');
        pipWrap.className = 'pip-wrapper';
        pipWrap.appendChild(pipCanvas);
        span.appendChild(pipWrap);
        // Rank number in suit color (black → white for visibility on dark bg)
        var txt = document.createElement('span');
        txt.className = 'result-rank';
        txt.textContent = topRank;
        var suitColor = Renderer.getSuitColor ? Renderer.getSuitColor(suits[i]) : '#1a1a1a';
        txt.style.color = suitColor;
        span.appendChild(txt);
        foundationInfo.appendChild(span);
      }

      // Show score formula derivation
      var formulaEl = document.getElementById('score-formula');
      var gState = Game.getState();
      var maxPerSuit = CardSystem.getMaxRank();
      var savedP = maxPerSuit - gState.foundations[1].length;
      var savedB = maxPerSuit - gState.foundations[2].length;
      var savedC = maxPerSuit - gState.foundations[3].length;
      var term1 = savedP * 1;
      var term2 = savedB * 2;
      var term3 = savedC * 3;

      // Use suit names matching current skin mode (animals / laser / classic)
      var skins = Renderer.getSuitSkins ? Renderer.getSuitSkins().skins : {};
      var nameP = suitNameFor('hearts', skins);
      var nameB = suitNameFor('spades', skins);
      var nameC = suitNameFor('clubs', skins);
      formulaEl.innerHTML =
        '<span class="formula-line">Saved: &ensp;' + nameP + ' \u00d7 1 &ensp;+&ensp; ' + nameB + ' \u00d7 2 &ensp;+&ensp; ' + nameC + ' \u00d7 3</span>' +
        '<span class="formula-line">' + savedP + ' \u00d7 1 &ensp;+&ensp; ' + savedB + ' \u00d7 2 &ensp;+&ensp; ' + savedC + ' \u00d7 3</span>' +
        '<span class="formula-line">' + term1 + ' &ensp;+&ensp; ' + term2 + ' &ensp;+&ensp; ' + term3 + ' &ensp;= &ensp;<span class="formula-result">' + score + '</span></span>';

      // Reset leaderboard entry form
      var entryDiv = document.getElementById('leaderboard-entry');
      entryDiv.classList.remove('submitted');
      document.getElementById('leaderboard-name').value = '';

      SaveSystem.clearSave();
      Renderer.stopLoop();
      gameStarted = false;
      showScreen('screen-results');
      Animations.launchConfetti();
    }, Animations.TIMING.RESULTS_DELAY);
  }

  function submitScore() {
    var nameInput = document.getElementById('leaderboard-name');
    var name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    var score = Game.calculateScore();
    var moves = Game.getMoves();
    // Disable button during submission
    var submitBtn = document.getElementById('btn-submit-score');
    submitBtn.disabled = true;
    SaveSystem.addLeaderboardEntry(name, score, moves, function () {
      document.getElementById('leaderboard-entry').classList.add('submitted');
    });
  }

  function populateLeaderboard() {
    var tbody = document.getElementById('leaderboard-body');
    var emptyMsg = document.getElementById('leaderboard-empty');
    tbody.innerHTML = '';
    emptyMsg.style.display = 'block';
    emptyMsg.textContent = 'Loading...';

    SaveSystem.getLeaderboard(function (board) {
      renderLeaderboardTable(board);
    });
  }

  function renderLeaderboardTable(board) {
    var tbody = document.getElementById('leaderboard-body');
    var emptyMsg = document.getElementById('leaderboard-empty');
    tbody.innerHTML = '';

    if (!board || board.length === 0) {
      emptyMsg.style.display = 'block';
      emptyMsg.textContent = 'No scores yet. Win a game to get on the board!';
      return;
    }
    emptyMsg.style.display = 'none';

    var max = Math.min(board.length, SaveSystem.LEADERBOARD_MAX);
    for (var i = 0; i < max; i++) {
      var entry = board[i];
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + (i + 1) + '</td>' +
        '<td>' + escapeHTML(entry.name) + '</td>' +
        '<td>' + entry.score + '</td>' +
        '<td>' + entry.moves + '</td>';
      tbody.appendChild(tr);
    }
  }

  function escapeHTML(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ================================================================
  //  GAME RENDER CALLBACK
  // ================================================================

  function renderGame(dt, W, H) {
    var layout = Renderer.getLayout();
    var state = Game.getState();
    hitTargets = [];
    glowPulse = (Math.sin(performance.now() / 500) + 1) / 2 * 0.5 + 0.5;

    // ---- Draw Foundations (always visible) ----
    var foundationSuits = Game.FOUNDATION_SUITS;
    for (var fi = 0; fi < 4; fi++) {
      var fx = layout.foundationX(fi);
      var fy = layout.foundationY;
      var fpile = state.foundations[fi];

      if (fpile.length === 0) {
        Renderer.drawPlaceholder(fx, fy, foundationSuits[fi], layout.scale);
      } else {
        // Gold border behind foundation cards
        Renderer.drawFoundationBorder(fx, fy, layout.scale);
        var topCard = fpile[fpile.length - 1];
        Renderer.drawCard(fx, fy, topCard, true, 0, layout.scale);
      }

      // Draw ">" chevron between foundation piles
      if (fi < 3) {
        var nextFx = layout.foundationX(fi + 1);
        var chevronX = (fx + nextFx) / 2;
        Renderer.drawChevron(chevronX, fy, layout.scale);
      }

      // Hit target for foundation
      hitTargets.push({
        type: 'foundation',
        foundationIndex: fi,
        x: fx - layout.cw / 2,
        y: fy - layout.ch / 2,
        w: layout.cw,
        h: layout.ch
      });
    }

    // ---- Draw Stock Pile ----
    var totalStockWaste = state.stock.length + state.waste.length;
    if (state.stock.length > 0) {
      Renderer.drawDeck(layout.stockX, layout.stockY, state.stock.length, layout.scale);
    } else if (state.waste.length > 1) {
      // Show placeholder with recycle indicator (only if more than 1 card to recycle)
      Renderer.drawPlaceholder(layout.stockX, layout.stockY, null, layout.scale);
      Renderer.drawRecycleSymbol(layout.stockX, layout.stockY, layout.scale);
    } else {
      Renderer.drawPlaceholder(layout.stockX, layout.stockY, null, layout.scale);
    }

    hitTargets.push({
      type: 'stock',
      x: layout.stockX - layout.cw / 2,
      y: layout.stockY - layout.ch / 2,
      w: layout.cw,
      h: layout.ch
    });

    // ---- Draw Waste Pile ----
    var skipWaste = dragState && dragState.source === 'waste';
    if (state.waste.length === 0) {
      Renderer.drawPlaceholder(layout.wasteX, layout.wasteY, null, layout.scale);
    } else if (skipWaste) {
      // Dragging top waste card — show card below it if available
      if (state.waste.length > 1) {
        var belowCard = state.waste[state.waste.length - 2];
        Renderer.drawCard(layout.wasteX, layout.wasteY, belowCard, true, 0, layout.scale);
      } else {
        Renderer.drawPlaceholder(layout.wasteX, layout.wasteY, null, layout.scale);
      }
    }
    if (state.waste.length > 0 && !skipWaste) {
      var wasteCard = state.waste[state.waste.length - 1];

      // Draw selection glow
      if (selection && selection.source === 'waste') {
        Renderer.drawCardGlow(layout.wasteX, layout.wasteY, 0, layout.scale, glowPulse);
      }

      Renderer.drawCard(layout.wasteX, layout.wasteY, wasteCard, true, 0, layout.scale);
    }

    if (state.waste.length > 0) {
      hitTargets.push({
        type: 'waste',
        x: layout.wasteX - layout.cw / 2,
        y: layout.wasteY - layout.ch / 2,
        w: layout.cw,
        h: layout.ch
      });
    }

    // ---- Draw Tableau ----
    if (dealing) {
      renderDealingTableau(layout, state);
    } else {
      renderTableau(layout, state);
    }

    // ---- Draw Dragged Cards (on top of everything) ----
    if (dragState) {
      var dragX = dragState.curX - dragState.offsetX;
      var dragY = dragState.curY - dragState.offsetY;
      for (var di = 0; di < dragState.cards.length; di++) {
        var cardDragY = dragY + di * layout.faceUpOffset;
        Renderer.drawCardGlow(dragX, cardDragY, 0, layout.scale, 0.6);
        Renderer.drawCard(dragX, cardDragY, dragState.cards[di], true, 0, layout.scale, 0.5);
      }
    }

    // ---- Draw Illegal Move Flash ----
    if (illegalFlash) {
      var elapsed = performance.now() - illegalFlash.startTime;
      var duration = 500;
      if (elapsed > duration) {
        illegalFlash = null;
      } else {
        var progress = elapsed / duration;
        var alpha = 1 - progress;
        var scaleUp = layout.scale * (0.8 + progress * 0.4);
        Renderer.drawIllegalMove(illegalFlash.x, illegalFlash.y, scaleUp, alpha);
      }
    }
  }

  function renderTableau(layout, state) {
    for (var ci = 0; ci < state.tableau.length; ci++) {
      var col = state.tableau[ci];
      var colX = layout.tableauX(ci);

      // Determine if cards are being dragged from this column
      var dragFromHere = dragState && dragState.source === 'tableau' && dragState.colIndex === ci;
      var dragIdx = dragFromHere ? dragState.cardIndex : col.length;

      if (col.length === 0 || dragIdx === 0) {
        // Empty column or all cards dragged — show placeholder
        Renderer.drawPlaceholder(colX, layout.tableauStartY, null, layout.scale);
        hitTargets.push({
          type: 'tableau-empty',
          colIndex: ci,
          x: colX - layout.cw * 1.5 / 2,
          y: layout.tableauStartY - layout.ch / 2,
          w: layout.cw * 1.5,
          h: layout.ch * 2
        });
        if (col.length === 0 || dragIdx === 0) continue;
      }

      for (var ri = 0; ri < col.length; ri++) {
        // Skip cards being dragged
        if (dragFromHere && ri >= dragIdx) continue;

        var entry = col[ri];
        var offset = 0;
        for (var k = 0; k < ri; k++) {
          offset += col[k].faceUp ? layout.faceUpOffset : layout.faceDownOffset;
        }
        var cardY = layout.tableauStartY + offset;

        // Check if this card is part of the selection
        var isSelected = selection && selection.source === 'tableau' &&
                         selection.colIndex === ci && ri >= selection.cardIndex;

        if (isSelected) {
          Renderer.drawCardGlow(colX, cardY, 0, layout.scale, glowPulse);
        }

        Renderer.drawCard(colX, cardY, entry.card, entry.faceUp, 0, layout.scale);

        // Hit target
        var hitH;
        var isLastVisible = (ri === col.length - 1) || (dragFromHere && ri === dragIdx - 1);
        if (isLastVisible) {
          hitH = layout.ch;
        } else {
          hitH = col[ri].faceUp ? layout.faceUpOffset : layout.faceDownOffset;
        }

        hitTargets.push({
          type: 'tableau',
          colIndex: ci,
          cardIndex: ri,
          isTop: isLastVisible,
          faceUp: entry.faceUp,
          x: colX - (isLastVisible ? layout.cw * 1.5 : layout.cw) / 2,
          y: cardY - layout.ch / 2,
          w: isLastVisible ? layout.cw * 1.5 : layout.cw,
          h: isLastVisible ? hitH + layout.ch : hitH
        });
      }
    }
  }

  function renderDealingTableau(layout, state) {
    var elapsed = performance.now() - (dealCards.length > 0 ? dealCards[0]._startTime || 0 : 0);

    // Initialize start times on first call
    if (dealCards.length > 0 && !dealCards[0]._startTime) {
      var now = performance.now();
      for (var i = 0; i < dealCards.length; i++) {
        dealCards[i]._startTime = now + dealCards[i].delay;
      }
    }

    var now2 = performance.now();

    for (var ci = 0; ci < state.tableau.length; ci++) {
      var col = state.tableau[ci];
      var colX = layout.tableauX(ci);

      for (var ri = 0; ri < col.length; ri++) {
        var entry = col[ri];
        var offset = 0;
        for (var k = 0; k < ri; k++) {
          offset += col[k].faceUp ? layout.faceUpOffset : layout.faceDownOffset;
        }
        var cardY = layout.tableauStartY + offset;

        // Find the deal card entry
        var dc = null;
        for (var di = 0; di < dealCards.length; di++) {
          if (dealCards[di].col === ci && dealCards[di].row === ri) {
            dc = dealCards[di];
            break;
          }
        }

        if (dc && dc._startTime) {
          var t = (now2 - dc._startTime) / Animations.TIMING.DEAL_FLIGHT;
          if (t < 0) continue; // Not yet started
          t = Math.min(t, 1);
          var ease = Renderer.easeOutCubic(t);

          // Animate from stock position to target
          var fromX = layout.stockX;
          var fromY = layout.stockY;
          var curX = fromX + (colX - fromX) * ease;
          var curY = fromY + (cardY - fromY) * ease;

          Renderer.drawCard(curX, curY, entry.card, t >= 1 ? entry.faceUp : false, 0, layout.scale);
        } else {
          Renderer.drawCard(colX, cardY, entry.card, entry.faceUp, 0, layout.scale);
        }
      }
    }
  }

  // ---- Boot ----
  document.addEventListener('DOMContentLoaded', init);

  return {
    showScreen: showScreen,
    startNewGame: startNewGame
  };
})();

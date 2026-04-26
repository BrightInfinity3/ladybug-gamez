/* ============================================================
   30 - UI Controller
   Screen management, rendering, event handling, game flow
   Canvas-integrated for high-quality card & table rendering
   Setup and game share a single screen with phase switching
   ============================================================ */

var UI = (function () {
  'use strict';

  // ---- Constants ----
  var NUM_TABLE_SEATS = 8;
  // Fixed seat fill order: top, bottom, left, right, top-left, bottom-right, bottom-left, top-right
  // Slot numbers (8 seats around table, 0=bottom, going counter-clockwise):
  //   0=bottom, 1=bottom-left, 2=left, 3=top-left, 4=top, 5=top-right, 6=right, 7=bottom-right
  var SEAT_FILL_ORDER = [4, 0, 2, 6, 3, 7, 1, 5];
  var DEFAULT_NAMES = ['Player 1', 'Player 2', 'Player 3', 'Player 4',
                       'Player 5', 'Player 6', 'Player 7', 'Player 8'];
  // Animal-to-name mapping — each animal has 3 possible names, chosen randomly
  var ANIMAL_NICKNAMES = {
    bear:      ['Bruno',   'Grizzly',  'Kodiak'],
    cat:       ['Shadow',  'Mittens',  'Whiskers'],
    owl:       ['Hoot',    'Sage',     'Luna'],
    penguin:   ['Waddles', 'Tux',      'Frost'],
    raccoon:   ['Bandit',  'Rascal',   'Stripe'],
    frog:      ['Ribbit',  'Lily',     'Marsh'],
    dog:       ['Buddy',   'Rex',      'Scout'],
    panda:     ['Bamboo',  'Oreo',     'Patches'],
    monkey:    ['Coco',    'Chip',     'Mango'],
    deer:      ['Dasher',  'Fawn',     'Buck'],
    hedgehog:  ['Spike',   'Bramble',  'Thistle'],
    shark:     ['Finn',    'Jaws',     'Reef'],
    octopus:   ['Inky',    'Coral',    'Squid'],
    hamster:   ['Nibbles', 'Peanut',   'Biscuit'],
    parrot:    ['Polly',   'Stella',   'Rio'],
    turtle:    ['Shelly',  'Mossy',    'Tank'],
    goat:      ['Billy',   'Cliffs',   'Bleat'],
    spider:    ['Webster', 'Silk',     'Fang'],
    ladybug:   ['Dotty',   'Pepper',   'Ruby'],
    bee:       ['Buzz',    'Abby',     'Nectar'],
    crocodile: ['Snappy',  'Chomp',    'Marsh'],
    dolphin:   ['Splash',  'Snowflake','Echo'],
    rabbit:    ['Clover',  'Hopper',   'Thumper'],
    dodo:      ['Doodle',  'Pebble',   'Waddle']
  };

  // ---- Setup State ----
  var setupSeats = []; // array of { occupied, animal, name, isHuman, isDealer, nameEdited }
  var seatPendingType = []; // 'ai' or 'human' for each unfilled seat's toggle
  var playerCount = 2;
  var pickerTargetSeat = -1;
  var pickerIsNewSeat = false; // true when picker is for adding a new player
  var addOrder = []; // tracks order players were added for removal
  var gameFlowLocked = false;
  // When false, dealer is randomly re-assigned every time a seat is added/removed.
  // When the player clicks a hollow dealer slot, this becomes true and the
  // dealer stays put until the player manually reassigns it again.
  var dealerManuallySet = false;

  // ---- Phase State ----
  var gamePhase = 'none'; // 'none' | 'setup' | 'playing'

  // ---- Player Count Button State ----
  // Gray out - at 2 players, + at 8 players
  function updatePlayerCountButtons() {
    document.getElementById('btn-fewer').disabled = (playerCount <= 2);
    document.getElementById('btn-more').disabled = (playerCount >= 8);
  }

  // ---- Responsive Avatar Size Helpers ----
  // Returns the actual CSS avatar size in pixels (vmin-based).
  function getVmin() {
    var vw = document.documentElement.clientWidth || window.innerWidth;
    var vh = document.documentElement.clientHeight || window.innerHeight;
    return Math.min(vw, vh) / 100;
  }
  function getSetupAvatarSize() {
    return 7.8 * getVmin(); // matches 7.8vmin in CSS
  }
  function getGameAvatarSize() {
    return 7.8 * getVmin(); // matches 7.8vmin in CSS (same as setup)
  }

  // ---- Dealer Chip Positioning ----
  // Positions the dealer chip to the LEFT of the avatar, edges touching, vertically centered.
  function positionDealerChip(chipEl, avatarSize) {
    var avatarR = avatarSize / 2;
    var chipSize = 3.3 * getVmin(); // matches 3.3vmin in CSS
    chipEl.style.left = 'calc(50% - ' + (avatarR + chipSize) + 'px)';
    chipEl.style.top = (avatarR - chipSize / 2) + 'px';
  }

  // ---- Remove Circle Positioning ----
  // Positions the remove circle to the RIGHT of the avatar, edges touching, vertically centered.
  function positionRemoveCircle(circleEl, avatarSize) {
    var avatarR = avatarSize / 2;
    var circleSize = 3.6 * getVmin(); // matches 3.6vmin in CSS
    circleEl.style.left = 'calc(50% + ' + avatarR + 'px)';
    circleEl.style.top = (avatarR - circleSize / 2) + 'px';
  }

  // ---- Canvas State ----
  var canvasReady = false;
  var handDisplay = {};  // playerId -> [{card, faceUp, flipProgress}]
  // v114: when a lobby seat rename input is open, defer any
  // renderOnlineLobbySeats request that comes in (a lobby_state
  // broadcast etc.) until the input loses focus. Without this, the
  // input gets destroyed mid-type and the user's name change is lost.
  var _pendingLobbySeatsRender = false;
  var glowingPlayerId = null;  // playerId to highlight cards with golden glow
  var glowStartTime = 0;      // timestamp for pulsing animation
  var resizeListenerAdded = false;

  // ---- Unified viewport-change handler (resize + orientation change) ----
  // Rebuilds the canvas renderer and re-lays out HTML overlays. Called on
  // window.resize, orientationchange, and visualViewport.resize. On iOS, the
  // orientation event fires BEFORE the final layout is known, so we re-run
  // after short delays to catch the settled dimensions.
  function handleViewportChange() {
    if (!canvasReady) return;
    if (!document.getElementById('screen-game').classList.contains('active')) return;
    Renderer.resize();
    // iPad keyboard fix (v109): when an INPUT inside a setup seat
    // has focus, the visualViewport.resize fired by the keyboard
    // opening triggers this handler. Re-rendering setup seats here
    // destroys the input element mid-typing — input loses focus,
    // keyboard immediately closes, screen jumps. Skip the seat
    // rebuild while an input is focused so the user can type. We
    // still resize the canvas; only the DOM seat-tree is preserved.
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

    // Debounce: only run handleViewportChange after the dimensions have been
    // stable for ~100ms. Prevents expensive table-texture/particle rebuilds
    // on every intermediate step during URL-bar animations, DevTools resize,
    // or window drag on desktop.
    var debounceTimer = null;
    var lastW = 0, lastH = 0;
    function schedule() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        debounceTimer = null;
        var w = window.innerWidth, h = window.innerHeight;
        if (w === lastW && h === lastH) return; // no-op if nothing changed
        lastW = w; lastH = h;
        handleViewportChange();
      }, 100);
    }

    // Standard resize
    window.addEventListener('resize', schedule);

    // iOS Safari: orientationchange fires before layout settles; re-run on a
    // series of delayed ticks to catch the correct dimensions after the URL
    // bar and status bar redraw.
    window.addEventListener('orientationchange', function () {
      // Force-run after each delay (bypass the no-op guard in schedule)
      var forceRun = function () { lastW = -1; schedule(); };
      forceRun();
      setTimeout(forceRun, 100);
      setTimeout(forceRun, 300);
      setTimeout(forceRun, 600);
    });

    // visualViewport captures changes that `resize` misses on mobile (like
    // the URL bar hiding/showing while scrolling, keyboard, pinch-zoom).
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', schedule);
    }

    // When the tab becomes visible after being backgrounded, the WebGL
    // canvas can be blank (context lost without firing the event, especially
    // on integrated-GPU Chrome). Force a full rebuild of the table texture
    // on return-to-visibility to recover.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && canvasReady &&
          document.getElementById('screen-game').classList.contains('active')) {
        // Force-run bypassing the no-op guard
        lastW = -1;
        schedule();
      }
    });
  }

  // ---- Initialize ----
  function init() {
    initSetupSeats();
    bindEvents();
    bindOnlineEvents();
    createFloatingSuits();
    blockPinchZoom();
    installKeyboardScrollReset();
    showScreen('screen-title');
    // v109: warm up card-texture canvases AND eagerly initialise
    // PIXI in the background so Local Play / Online Play / Deal
    // clicks aren't blocked by WebGL context creation. On a slow
    // desktop the first PIXI init can spend 200-500ms compiling
    // shaders and uploading textures; doing that work BEFORE the
    // first user click takes the latency off the critical path.
    // The canvas element is hidden behind the title screen, so the
    // user doesn't see the early init.
    if (typeof Renderer !== 'undefined' && Renderer.precacheCardCanvases) {
      try { Renderer.precacheCardCanvases(); } catch (e) { /* non-fatal */ }
    }
    // Use requestIdleCallback (or a small setTimeout fallback) so
    // the early init doesn't block the title screen's paint.
    var warmRenderer = function () {
      if (canvasReady) return;
      var canvasEl = document.getElementById('game-canvas');
      if (!canvasEl || !Renderer || !Renderer.init) return;
      try {
        Renderer.init(canvasEl).then(function () { canvasReady = true; });
      } catch (e) { /* non-fatal — first click will retry */ }
    };
    if (window.requestIdleCallback) {
      window.requestIdleCallback(warmRenderer, { timeout: 1500 });
    } else {
      setTimeout(warmRenderer, 600);
    }
  }

  // Belt-and-suspenders pinch-zoom / double-tap-zoom blocker. CSS
  // `touch-action: pan-x pan-y` plus the viewport meta tag's
  // `maximum-scale=1, user-scalable=no` SHOULD be enough on most
  // mobile browsers — but iPad Safari has historically ignored
  // user-scalable=no since iOS 10, and some Safari versions still
  // honor multi-touch gestures even when touch-action is set. The
  // user reported a stray two-finger touch on iPad zoomed the
  // table and they couldn't reset it. These listeners block:
  //   - gesturestart/change/end (Safari multi-touch zoom)
  //   - 2-finger touchmove (defensive: catches Android Chrome too)
  //   - touchstart with >1 finger (kills the pinch before it begins)
  //   - dblclick (legacy double-tap zoom)
  //   - wheel + ctrlKey (desktop pinch on trackpad / Ctrl+scroll)
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

  // v112: iPad keyboard scroll-persistence fix. iOS Safari, when an
  // <input> gets focus, scrolls the document up to bring the input
  // ABOVE the keyboard. The page has overflow: hidden, but iOS does
  // this scroll at the WINDOW level (not via document scroll), so
  // it ignores our overflow setting. After the keyboard closes the
  // window.scrollY can stay non-zero, leaving everything shifted
  // up permanently. We reset window scroll + the document/body
  // scroll positions whenever an input loses focus, AND on every
  // visualViewport.resize as a defensive measure (catches the
  // keyboard-just-closed event sequence).
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
        // Run twice — once immediately (catches the synchronous
        // blur) and once after a short tick (catches any delayed
        // iOS keyboard-closing scroll adjustment).
        reset();
        setTimeout(reset, 50);
        setTimeout(reset, 200);
      }
    });
    // visualViewport.resize fires on keyboard show AND keyboard
    // hide. We can't easily distinguish, but resetting scroll on
    // both is harmless because the active input wants the keyboard
    // open anyway.
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', function () {
        // Only reset when no input is focused — i.e. keyboard
        // has fully closed.
        var ae = document.activeElement;
        if (!ae || ae.tagName !== 'INPUT') reset();
      });
    }
  }

  function initSetupSeats() {
    setupSeats = [];
    seatPendingType = [];
    for (var i = 0; i < NUM_TABLE_SEATS; i++) {
      setupSeats.push({
        occupied: false,
        animal: null,
        name: '',
        isHuman: false,
        isDealer: false,
        nameEdited: false
      });
      seatPendingType.push('ai');
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

    // Stop canvas render loop when leaving game screen
    if (id !== 'screen-game' && canvasReady) {
      Renderer.stopLoop();
    }
  }

  // ============= Host-handoff UI helpers (v109) =============
  // openLeaveRoomConfirm — central entry for any "Leave Room" UI.
  // Sets the title and sub copy based on host vs guest, applies the
  // .is-host class so the 3rd "Yes, Exit (Choose New Host)" button
  // appears for hosts only, and shows the popup.
  var _hostSelectMode = null;     // { thenLeave: true|false } or null
  var _hostSelectPendingPeer = null; // peerId currently being asked
  var _hostRequestSource = null;     // 'voluntary' | 'cascade'

  function openLeaveRoomConfirm() {
    var title = document.getElementById('leave-room-title');
    var sub   = document.getElementById('leave-room-sub');
    title.textContent = 'Leave Room?';
    if (Online.isHost()) {
      // v111: simplified copy now that CHANGE HOST is a separate
      // dedicated button. If the host wants to hand off they use
      // CHANGE HOST first; clicking Leave Room is unambiguously
      // "leave AND disband the room (if I'm still host)".
      sub.textContent = 'Leaving will end the game for everyone.';
    } else {
      sub.textContent = 'Your players will leave. The game keeps going for everyone else.';
    }
    document.getElementById('confirm-leave-room').style.display = 'flex';
  }

  function openHostSelect(mode) {
    _hostSelectMode = mode || { thenLeave: false };
    _hostSelectPendingPeer = null;
    var overlay = document.getElementById('host-select-overlay');
    document.getElementById('host-select-title').textContent =
      _hostSelectMode.thenLeave ? 'Choose a New Host' : 'Change Host';
    document.getElementById('host-select-sub').textContent =
      _hostSelectMode.thenLeave
        ? 'Pick a connected player to take over hosting before you leave.'
        : 'Pick a connected player to take over hosting.';
    renderHostSelectList(new Set());
    overlay.style.display = 'flex';
  }
  function closeHostSelect() {
    document.getElementById('host-select-overlay').style.display = 'none';
  }

  // Render the list of candidates inside the host-select popup.
  // `declined` is a Set of peerIds the host has already asked who
  // declined — they're shown greyed out so the host knows not to
  // try them again this cycle.
  function renderHostSelectList(declined) {
    var list = document.getElementById('host-select-list');
    list.innerHTML = '';
    var candidates = Online.listHandoffCandidates();
    if (!candidates.length) {
      var none = document.createElement('div');
      none.className = 'host-select-row declined';
      none.innerHTML = '<span class="hs-name">No connected players to hand off to.</span>';
      list.appendChild(none);
      return;
    }
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      var row = document.createElement('div');
      row.className = 'host-select-row';
      if (declined.has(c.peerId)) row.classList.add('declined');
      if (_hostSelectPendingPeer === c.peerId) row.classList.add('pending');
      var name = document.createElement('span');
      name.className = 'hs-name';
      name.textContent = c.username;
      row.appendChild(name);
      var tag = document.createElement('span');
      tag.className = 'hs-tag';
      if (declined.has(c.peerId))      tag.textContent = 'Declined';
      else if (_hostSelectPendingPeer === c.peerId) tag.textContent = 'Asking…';
      else                              tag.textContent = 'Tap to ask';
      row.appendChild(tag);
      if (!declined.has(c.peerId) && _hostSelectPendingPeer !== c.peerId) {
        row.addEventListener('click', (function (peerId) {
          return function () { askCandidateToHost(peerId, declined); };
        })(c.peerId));
      }
      list.appendChild(row);
    }
  }

  function askCandidateToHost(peerId, declined) {
    _hostSelectPendingPeer = peerId;
    Online.requestHandoff(peerId);
    renderHostSelectList(declined);
  }

  // Set up the response listener once. Online.onHostHandoffResponse
  // fires when the candidate accepts or declines the handoff
  // request.
  function installHostHandoffListeners() {
    Online.onHostHandoffResponse(function (response) {
      var declined = new Set();
      if (!response.accepted) {
        declined.add(response.fromPeerId);
        _hostSelectPendingPeer = null;
        renderHostSelectList(declined);
      } else {
        // Candidate accepted — finalize via the server. The server
        // updates room.hostPeerId and broadcasts host_migrated; the
        // existing handleHostMigration handler runs on every device
        // (including us). We close the host-select popup; if this
        // came from the leave-room flow, we also leave the room.
        var peerId = response.fromPeerId;
        Online.finalizeHandoff(peerId);
        closeHostSelect();
        if (_hostSelectMode && _hostSelectMode.thenLeave) {
          // Tiny delay so the migration has a chance to fan out
          // before our own socket closes; not strictly necessary
          // (server completes the migration before processing our
          // leave) but feels cleaner UX-wise.
          setTimeout(function () {
            Online.leaveRoom();
            gamePhase = 'none';
            Renderer.stopLoop();
            clearGameDisplay();
            showScreen('screen-title');
          }, 200);
        }
        _hostSelectMode = null;
      }
    });

    // Candidate side: we got asked to take over.
    Online.onHostHandoffRequest(function (data) {
      _hostRequestSource = 'voluntary';
      var who = (data && data.fromHostName) || 'The host';
      document.getElementById('host-request-title').textContent = 'Become the New Host?';
      // v111: shortened to one line.
      document.getElementById('host-request-sub').textContent =
        who + ' wants you to take over.';
      document.getElementById('host-request-overlay').style.display = 'flex';
    });

    // Cascade-migration proposal: server picked us as the candidate
    // after the previous host timed out. Show the same accept/deny
    // popup, but route the response through the cascade channel.
    Online.onMigrationProposal(function (data) {
      if (!data.isMe) {
        // Not me — render a transient toast on others so they know
        // something is happening. (No popup; they just wait.)
        return;
      }
      _hostRequestSource = 'cascade';
      document.getElementById('host-request-title').textContent = 'Become the New Host?';
      // v111: shortened to one line.
      document.getElementById('host-request-sub').textContent =
        'Previous host disconnected. Take over?';
      document.getElementById('host-request-overlay').style.display = 'flex';
    });
  }
  // Install at module init time.
  installHostHandoffListeners();

  // Wipe transient per-game display state — call when leaving a room
  // or returning to the title so the next session doesn't briefly
  // render leftovers (old leader glow, old hand cards, old totals,
  // old STAY/BUST pills, mobile-portrait leader card with last
  // game's name).
  function clearGameDisplay() {
    handDisplay = {};
    // Strip leader/active classes from any seat that's still in the
    // DOM. The seats themselves get rebuilt on the next renderGameTable.
    document.querySelectorAll('.game-seat').forEach(function (seat) {
      seat.classList.remove('is-leader', 'active');
    });
    document.querySelectorAll('.game-seat-total').forEach(function (el) {
      el.classList.remove('leader');
      el.textContent = '';
      el.style.visibility = 'hidden';
    });
    document.querySelectorAll('.game-seat-status').forEach(function (el) {
      el.className = 'game-seat-status';
      el.textContent = '';
      el.style.visibility = 'hidden';
    });
    // Tear down the mobile bar's leader / current cells so leftover
    // names / scores from the previous room don't flash on entry to
    // the next one.
    var mbarLeader = document.getElementById('mbar-leader');
    var mbarCurrent = document.getElementById('mbar-current');
    if (mbarLeader && typeof fillMbarPlayer === 'function') fillMbarPlayer(mbarLeader, null);
    if (mbarCurrent && typeof fillMbarPlayer === 'function') fillMbarPlayer(mbarCurrent, null);
    document.body.classList.remove('mbar-active', 'mbar-turn-active');
    _mbarTurnActive = false;
  }

  // ---- Floating Suit Particles (Title Screen) ----
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
      el.style.fontSize = (0.8 + Math.random() * 1.2) + 'rem';
      container.appendChild(el);
    }
  }

  // ---- Mobile Fullscreen ----
  function isMobile() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
           (navigator.maxTouchPoints > 1 && window.innerWidth < 1024);
  }
  function requestFullscreen() {
    if (!isMobile()) return;
    var el = document.documentElement;
    var rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    if (rfs) {
      rfs.call(el).catch(function() { /* ignore — user gesture required */ });
    }
  }

  // ---- Event Binding ----
  function bindEvents() {
    // Title screen — Play enters setup on the game screen
    document.getElementById('btn-play').addEventListener('click', function () {
      requestFullscreen();
      enterSetup();
    });
    document.getElementById('btn-how-to-play').addEventListener('click', function () {
      showScreen('screen-rules');
    });
    document.getElementById('btn-rules-back').addEventListener('click', function () {
      showScreen('screen-title');
    });

    // Setup controls (inside game screen)
    document.getElementById('btn-setup-back').addEventListener('click', function () {
      gamePhase = 'none';
      showScreen('screen-title');
    });
    document.getElementById('btn-deal').addEventListener('click', startGame);

    // Player +/- controls — shared between local setup and the online
    // lobby (host only). In online mode we route to Online.addPlayer /
    // Online.removeFromSeat so new seats get host-controlled defaults
    // that the host can later reassign via the avatar-click popup.
    document.getElementById('btn-fewer').addEventListener('click', function () {
      if (Online.isActive() && Online.isHost()) {
        var ls = Online.getLobbyState();
        var occupied = ls.seats.map(function (s, i) { return { s: s, i: i }; })
                                .filter(function (x) { return x.s.occupied; });
        if (occupied.length <= 2) return;
        Online.removeFromSeat(occupied[occupied.length - 1].i);
        return;
      }
      if (playerCount <= 2) return;
      for (var i = addOrder.length - 1; i >= 0; i--) {
        var idx = addOrder[i];
        if (setupSeats[idx].occupied && !setupSeats[idx].isHuman) {
          removeSeat(idx);
          break;
        }
      }
    });
    document.getElementById('btn-more').addEventListener('click', function () {
      if (Online.isActive() && Online.isHost()) {
        var ls = Online.getLobbyState();
        var count = ls.seats.filter(function (s) { return s.occupied; }).length;
        if (count >= 8) return;
        // Fill next empty seat in SEAT_FILL_ORDER.
        for (var k = 0; k < SEAT_FILL_ORDER.length; k++) {
          if (!ls.seats[SEAT_FILL_ORDER[k]].occupied) {
            Online.addPlayer(SEAT_FILL_ORDER[k], false);
            return;
          }
        }
        return;
      }
      if (playerCount >= 8) return;
      for (var m = 0; m < SEAT_FILL_ORDER.length; m++) {
        if (!setupSeats[SEAT_FILL_ORDER[m]].occupied) {
          addSeat(SEAT_FILL_ORDER[m]);
          break;
        }
      }
    });

    // Character picker
    document.getElementById('btn-picker-cancel').addEventListener('click', closePicker);

    // Game actions
    document.getElementById('btn-draw').addEventListener('click', function () {
      if (!gameFlowLocked) humanAction('draw');
    });
    document.getElementById('btn-stay').addEventListener('click', function () {
      if (!gameFlowLocked) humanAction('stay');
    });

    // Menu button (in-game) — shows confirm dialog
    document.getElementById('btn-menu').addEventListener('click', function () {
      if (Online.isActive()) {
        // v109: route online sessions through the unified 3-option
        // leave-room popup. Local play still uses confirm-exit.
        openLeaveRoomConfirm();
      } else {
        var title2 = document.getElementById('exit-title');
        var sub2 = document.getElementById('exit-sub');
        title2.textContent = 'Return to Main Menu?';
        sub2.textContent = 'Your current game will be lost.';
        document.getElementById('confirm-exit').style.display = 'flex';
      }
    });

    // Confirm exit dialog
    document.getElementById('btn-confirm-yes').addEventListener('click', function () {
      document.getElementById('confirm-exit').style.display = 'none';
      if (Online.isActive()) {
        Online.leaveRoom();
      }
      gamePhase = 'none';
      Renderer.stopLoop();
      // Wipe transient per-game display state so the next room
      // doesn't briefly show the old leader / cards / pills.
      clearGameDisplay();
      showScreen('screen-title');
    });
    document.getElementById('btn-confirm-no').addEventListener('click', function () {
      document.getElementById('confirm-exit').style.display = 'none';
    });

    // Results
    document.getElementById('btn-play-again').addEventListener('click', function () {
      if (Online.isActive() && !Online.isHost()) return; // only host
      playAgain();
      if (Online.isActive()) {
        Online.setGamePhase('playing');
        Online.broadcastGameAction({ type: 'play_again' });
      }
    });
    document.getElementById('btn-new-game').addEventListener('click', function () {
      if (Online.isActive()) {
        // In online mode, show leave room confirmation
        var title = document.getElementById('exit-results-title');
        var sub = document.getElementById('exit-results-sub');
        title.textContent = 'Leave Room?';
        sub.textContent = Online.isHost()
          ? 'You\u2019re the host \u2014 leaving will end the game for everyone.'
          : 'Your players will leave. The game keeps going for everyone else.';
      }
      document.getElementById('confirm-exit-results').style.display = 'flex';
    });
    document.getElementById('btn-confirm-results-yes').addEventListener('click', function () {
      document.getElementById('confirm-exit-results').style.display = 'none';
      if (Online.isActive()) {
        Online.leaveRoom();
      }
      gamePhase = 'none';
      clearGameDisplay();
      showScreen('screen-title');
    });
    document.getElementById('btn-confirm-results-no').addEventListener('click', function () {
      document.getElementById('confirm-exit-results').style.display = 'none';
    });
  }

  // ================================================================
  //  ONLINE EVENT BINDING
  // ================================================================

  // Reset the online-screen forms back to a fresh / clickable state.
  // Called every time we re-enter the online screen so a previous join
  // attempt (stuck on "Waiting for host to accept…", or a disbanded
  // room) doesn't leave the Join button disabled or show stale status.
  function resetOnlineScreen() {
    // If there's a live Online session still lingering (e.g. we were
    // a guest and the host disbanded while we were on the lobby),
    // tear it down so Network.joinRoom starts fresh.
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

  function bindOnlineEvents() {
    // Title screen — Online button
    document.getElementById('btn-online').addEventListener('click', function () {
      requestFullscreen();
      resetOnlineScreen();
      showScreen('screen-online');
    });

    // Online screen — tabs. Usernames from whichever form was filled in
    // are copied over to the other form so toggling doesn't lose the
    // name the user typed. Also persisted to localStorage so it survives
    // page reloads.
    function rememberUsername(name) {
      try { localStorage.setItem('thirty:lastUsername', name || ''); } catch (e) {}
    }
    function loadRememberedUsername() {
      try { return localStorage.getItem('thirty:lastUsername') || ''; } catch (e) { return ''; }
    }
    // Seed both inputs on load with last-used username.
    (function () {
      var last = loadRememberedUsername();
      if (last) {
        var h = document.getElementById('host-username');
        var j = document.getElementById('join-username');
        if (h && !h.value) h.value = last;
        if (j && !j.value) j.value = last;
      }
    })();
    // Keep the fields synchronised as the user types in either.
    document.getElementById('host-username').addEventListener('input', function (e) {
      document.getElementById('join-username').value = e.target.value;
      rememberUsername(e.target.value);
    });
    document.getElementById('join-username').addEventListener('input', function (e) {
      document.getElementById('host-username').value = e.target.value;
      rememberUsername(e.target.value);
    });

    document.getElementById('tab-host').addEventListener('click', function () {
      document.getElementById('tab-host').classList.add('active');
      document.getElementById('tab-host').classList.remove('btn-outline');
      document.getElementById('tab-host').classList.add('btn-gold');
      document.getElementById('tab-join').classList.remove('active');
      document.getElementById('tab-join').classList.add('btn-outline');
      document.getElementById('tab-join').classList.remove('btn-gold');
      document.getElementById('form-host').style.display = '';
      document.getElementById('form-join').style.display = 'none';
      // Copy whatever was last typed to keep them in sync.
      var j = document.getElementById('join-username').value;
      if (j) document.getElementById('host-username').value = j;
    });
    document.getElementById('tab-join').addEventListener('click', function () {
      document.getElementById('tab-join').classList.add('active');
      document.getElementById('tab-join').classList.remove('btn-outline');
      document.getElementById('tab-join').classList.add('btn-gold');
      document.getElementById('tab-host').classList.remove('active');
      document.getElementById('tab-host').classList.add('btn-outline');
      document.getElementById('tab-host').classList.remove('btn-gold');
      document.getElementById('form-join').style.display = '';
      document.getElementById('form-host').style.display = 'none';
      var h = document.getElementById('host-username').value;
      if (h) document.getElementById('join-username').value = h;
    });

    // v96: player-count controls removed from the host/join forms.
    // Host now seats players during the lobby (local-setup style) and
    // reassigns controllers via the avatar-click reassign popup.

    // Create Room button
    document.getElementById('btn-create-room').addEventListener('click', function () {
      var username = document.getElementById('host-username').value.trim();
      if (!username) {
        document.getElementById('host-status').textContent = 'Please enter a username.';
        document.getElementById('host-status').className = 'online-status error';
        return;
      }
      document.getElementById('host-status').textContent = '';
      document.getElementById('host-status').className = 'online-status';
      document.getElementById('btn-create-room').disabled = true;

      Online.hostGame(username).then(function (code) {
        // Set up callbacks
        Online.onGameStart(function (players) {
          onlineBeginGame(players);
        });
        Online.onAction(function (data) {
          onlineHandleRemoteAction(data);
        });
        // v115: GUEST-side callbacks too. The original host might
        // hand off (voluntary CHANGE HOST) or get migrated (timeout
        // cascade) and become a guest. After that, broadcasts from
        // the new host arrive as `game_action` (deal_round /
        // action_draw / action_stay / play_again) and
        // `game_state_sync` — but if these callbacks weren't
        // registered, the messages were silently dropped, leaving
        // the former host with empty hands and a "Everyone Busted"
        // results screen. Registering them upfront covers the
        // become-guest-after-handoff case without needing extra
        // wiring at handoff time.
        Online.onGameAction(function (data) {
          onlineHandleGameAction(data);
        });
        Online.onGameStateSync(function (data) {
          onlineHandleStateSync(data);
        });
        Online.onMidGameEntry(function (players) {
          enterGameInProgress(players);
        });
        Online.onRenderLobby(function () {
          renderOnlineLobbySeats();
        });
        // v97: whenever the host changes a seat's controller (via the
        // avatar-click reassign popup OR the leave-modal's Apply), we
        // kick the turn loop to re-evaluate whose turn it is with the
        // new assignments. That's how a stalled turn resumes once the
        // host picks a new controller for the departed player.
        Online.onHostAutoPlay(function () {
          if (gamePhase === 'playing' && !gameFlowLocked) {
            nextTurn();
          }
        });
        // v112: also wire onHostTakeover on the HOST side. This is
        // critical for VOLUNTARY handoff — when the original host
        // hands off via CHANGE HOST, the migration completes and
        // we (now a guest) need to refresh HUD/buttons.
        // v117: gated the seat re-render on lobby phase. Calling
        // renderOnlineLobbySeats during GAMEPLAY wiped the game
        // seats (game-seat / score / status) and replaced them
        // with setup-style seats (dotted-D, controller badge,
        // remove X). User reported this exactly after migrating.
        Online.onHostTakeover(function (opts) {
          opts = opts || {};
          if (gamePhase === 'online-lobby') renderOnlineLobbySeats();
          updateHUD();
          if (opts.becameHost && gamePhase === 'playing') {
            gameFlowLocked = false;
            nextTurn();
          }
        });
        enterOnlineLobby();
        Online.renderOnlineLobby();
        document.getElementById('btn-create-room').disabled = false;
      }).catch(function (err) {
        document.getElementById('host-status').textContent = 'Error: ' + (err.message || err);
        document.getElementById('host-status').className = 'online-status error';
        document.getElementById('btn-create-room').disabled = false;
      });
    });

    // Join Room button
    document.getElementById('btn-join-room').addEventListener('click', function () {
      var code = document.getElementById('join-room-code').value.trim().toUpperCase();
      var username = document.getElementById('join-username').value.trim();
      if (!code || code.length !== 3) {
        document.getElementById('join-status').textContent = 'Please enter a 3-character room code.';
        document.getElementById('join-status').className = 'online-status error';
        return;
      }
      if (!username) {
        document.getElementById('join-status').textContent = 'Please enter a username.';
        document.getElementById('join-status').className = 'online-status error';
        return;
      }
      document.getElementById('join-status').textContent = 'Connecting...';
      document.getElementById('join-status').className = 'online-status';
      document.getElementById('btn-join-room').disabled = true;

      Online.onJoinResponse(function (approved, reason) {
        if (approved) {
          // Set up callbacks
          Online.onGameStart(function (players) {
            onlineBeginGame(players);
          });
          Online.onGameAction(function (data) {
            onlineHandleGameAction(data);
          });
          Online.onGameStateSync(function (data) {
            onlineHandleStateSync(data);
          });
          // Mid-game joiners skip the deal-animation flow and land
          // directly on the running game screen.
          Online.onMidGameEntry(function (players) {
            enterGameInProgress(players);
          });
          Online.onRenderLobby(function () {
            renderOnlineLobbySeats();
          });
          // Host migration: fired on EVERY device after migration
          // completes (v112). The opts arg has `becameHost: true`
          // when WE took over, otherwise we're either the outgoing
          // host (lostHost: true) or just another guest. In all
          // cases we want to refresh:
          //   - the in-game HUD's CHANGE HOST button visibility
          //     (Online.isHost() now reflects the new state)
          //   - the lobby's host-only seat treatments
          //   - if WE are the new host: kick the turn loop so any
          //     AI-converted seat plays right away
          Online.onHostTakeover(function (opts) {
            opts = opts || {};
            // v117: only re-render lobby seats during the lobby
            // phase. Calling renderOnlineLobbySeats during
            // GAMEPLAY wipes the game seats and replaces them
            // with setup-style seats (dotted-D, controller info).
            if (gamePhase === 'online-lobby') renderOnlineLobbySeats();
            updateHUD();
            if (opts.becameHost && gamePhase === 'playing') {
              gameFlowLocked = false;
              nextTurn();
            }
          });
          enterOnlineLobby();
          Online.renderOnlineLobby();
        } else {
          document.getElementById('join-status').textContent = reason || 'Join request denied.';
          document.getElementById('join-status').className = 'online-status error';
          document.getElementById('btn-join-room').disabled = false;
        }
      });

      Online.joinGame(code, username).then(function () {
        document.getElementById('join-status').textContent = 'Waiting for host to accept...';
      }).catch(function (err) {
        document.getElementById('join-status').textContent = err.message || 'Could not connect.';
        document.getElementById('join-status').className = 'online-status error';
        document.getElementById('btn-join-room').disabled = false;
      });
    });

    // Online Deal button (host only)
    document.getElementById('btn-online-deal').addEventListener('click', function () {
      if (!Online.isHost()) return;
      Online.startOnlineGame();
    });

    // Leave Room button — warn honestly about what happens when you
    // leave. Guests just leave; the game keeps going for everyone else.
    // Hosts CAN'T currently hand off the room, so their leave does end
    // the game for everyone (the server tears the room down the moment
    // the host's socket closes).
    document.getElementById('btn-leave-room').addEventListener('click', function () {
      openLeaveRoomConfirm();
    });
    document.getElementById('btn-confirm-leave-yes').addEventListener('click', function () {
      document.getElementById('confirm-leave-room').style.display = 'none';
      Online.leaveRoom();
      gamePhase = 'none';
      Renderer.stopLoop();
      clearGameDisplay();
      showScreen('screen-title');
    });
    document.getElementById('btn-confirm-leave-no').addEventListener('click', function () {
      document.getElementById('confirm-leave-room').style.display = 'none';
    });
    // CHANGE HOST button — host-only; sits below Leave Room as a
    // separate absolutely-positioned button (visible during both
    // setup and gameplay). v111: this is now the ONLY entry point
    // for voluntary host handoffs (the in-popup "Choose New Host"
    // option was removed for clarity).
    document.getElementById('btn-change-host').addEventListener('click', function () {
      openHostSelect({ thenLeave: false });
    });
    // Host-select popup Cancel button. v111: thenLeave flag is no
    // longer set (the leave-room "choose host" option was removed),
    // so cancel just closes the popup without re-opening leave-room.
    document.getElementById('btn-host-select-cancel').addEventListener('click', function () {
      closeHostSelect();
      _hostSelectMode = null;
    });
    // Host-handoff request popup buttons (shown to candidate)
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

    // Back button on online screen — clean up any lingering session so
    // a future Online Play click lands on a fresh form.
    document.getElementById('btn-online-back').addEventListener('click', function () {
      resetOnlineScreen();
      showScreen('screen-title');
    });

    // Disband OK button — return to the online screen in a fresh state
    // (not the title screen) so the user can immediately host or join
    // another room with one click, without having to navigate back in.
    document.getElementById('btn-disband-ok').addEventListener('click', function () {
      document.getElementById('disband-overlay').style.display = 'none';
      clearGameDisplay();
      resetOnlineScreen();
      showScreen('screen-online');
    });
  }

  // ================================================================
  //  ONLINE LOBBY (renders on game screen with canvas table)
  // ================================================================

  function enterOnlineLobby() {
    gamePhase = 'online-lobby';
    showScreen('screen-game');

    // Show lobby header, hide setup/game elements
    document.getElementById('online-lobby-header').style.display = '';
    document.getElementById('setup-header').style.display = 'none';
    document.getElementById('btn-deal').style.display = 'none';
    document.getElementById('game-hud').style.display = 'none';
    document.getElementById('game-actions').style.display = 'none';
    document.getElementById('deck-info').style.display = 'none';
    // hud-room-row is part of the in-game HUD — hide it during lobby
    // so a stale code from a previous game doesn't leak onto the
    // setup screen.
    var hudRoomRow = document.getElementById('hud-room-row');
    if (hudRoomRow) hudRoomRow.style.display = 'none';

    // Host gets the central "Players: +/-" counter (same control the
    // local-play setup uses) so they can add/remove seats. Joiners
    // don't see it.
    var pcc = document.getElementById('player-count-control');
    if (pcc) pcc.style.display = Online.isHost() ? '' : 'none';

    // Show appropriate bottom element
    if (Online.isHost()) {
      document.getElementById('btn-online-deal').style.display = '';
      document.getElementById('lobby-waiting').style.display = 'none';
    } else {
      document.getElementById('btn-online-deal').style.display = 'none';
      document.getElementById('lobby-waiting').style.display = '';
    }

    // Init canvas
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

      Renderer.startLoop(function () {
        Renderer.hideDeckCount();
      });

      installViewportHandlers();

      renderOnlineLobbySeats();
    });
  }

  function renderOnlineLobbySeats() {
    var ring = document.getElementById('seats-ring');
    // v114: if a rename input is currently focused, defer the
    // rebuild. Wiping the seats-ring while the user is typing
    // destroys the input element AND the synthetic onblur logic
    // that triggers Online.sendChangeName — meaning the user's
    // typed name never actually broadcasts. The user reported
    // names "resetting" and "subsequent renames not propagating"
    // — both symptoms of the input being killed by an incoming
    // lobby_state broadcast (which calls renderOnlineLobby ->
    // renderLobbyCallback -> renderOnlineLobbySeats). We replay
    // the render once the input loses focus.
    var activeEl = document.activeElement;
    if (activeEl && activeEl.classList && activeEl.classList.contains('seat-name-input')) {
      _pendingLobbySeatsRender = true;
      return;
    }
    _pendingLobbySeatsRender = false;
    ring.innerHTML = '';

    var positions;
    if (canvasReady) {
      positions = Renderer.getSeatOverlayPositions(NUM_TABLE_SEATS);
    } else {
      return; // wait for canvas
    }

    var lobbyState = Online.getLobbyState();
    var myDeviceId = Online.getMyDeviceId();
    var isHost = Online.isHost();

    // Update the central "Players:" counter + its +/- button enabled
    // states so the online host's UI mirrors the local setup screen.
    var occupiedCount = lobbyState.seats.filter(function (s) { return s.occupied; }).length;
    var pcd = document.getElementById('player-count-display');
    if (pcd) pcd.textContent = occupiedCount;
    var bf = document.getElementById('btn-fewer');
    var bm = document.getElementById('btn-more');
    if (bf) bf.disabled = (occupiedCount <= 2);
    if (bm) bm.disabled = (occupiedCount >= 8);

    // Enable/disable the Deal button based on seat count.
    var dealBtn = document.getElementById('btn-online-deal');
    if (dealBtn) dealBtn.disabled = occupiedCount < 2;
    // Every seat reserves the same top-row height above the avatar — matches
    // the local setup layout so the avatar center lands exactly at pos.y
    // (tangent to the table's outer wood edge). Empty seats get an invisible
    // placeholder row so their total height matches filled seats.
    // 3vmin row + 0.3vmin margin-bottom = 3.3vmin total vertical space.
    var lobbyTopRowOffset = 3.3 * getVmin();

    for (var i = 0; i < NUM_TABLE_SEATS; i++) {
      var seat = lobbyState.seats[i];
      var pos = positions[i];

      var el = document.createElement('div');
      el.className = 'seat' + (seat.occupied ? '' : ' seat-empty');
      el.style.position = 'absolute';
      el.style.left = pos.x + 'px';
      el.style.top = (pos.y - lobbyTopRowOffset - getSetupAvatarSize() / 2) + 'px';
      el.dataset.seat = i;

      // Top row — always present (for consistent vertical layout). Filled
      // seats fill it with a username/AI badge + optional remove button;
      // empty seats leave it blank so they reserve the same height.
      var topRow = document.createElement('div');
      topRow.className = 'seat-top-row';

      if (seat.occupied) {
        // Dealer chip (solid gold "D" if this seat is dealer; hollow
        // dashed gold slot otherwise, clickable by host to set dealer).
        // Matches the local setup screen.
        var isDealer = (lobbyState.dealerIndex === i);
        var dealerBadge = document.createElement('div');
        dealerBadge.className = isDealer ? 'seat-dealer-chip' : 'seat-dealer-slot';
        dealerBadge.textContent = 'D';
        if (!isDealer && isHost) {
          dealerBadge.title = 'Make dealer';
          dealerBadge.addEventListener('click', (function (idx) {
            return function (e) {
              e.stopPropagation();
              Online.setDealer(idx);
            };
          })(i));
        }
        topRow.appendChild(dealerBadge);

        // Controller badge (the "human/AI bubble" above the avatar).
        // Click handler (host only): opens the reassign popup so the
        // host can change who controls this seat — AI, themselves,
        // or any connected joiner.
        var badge = document.createElement('div');
        badge.className = 'seat-type-badge';
        if (seat.isAI) {
          badge.classList.add('ai');
          badge.textContent = 'AI';
        } else if (seat.deviceId) {
          var dev = lobbyState.devices[seat.deviceId];
          badge.classList.add('human');
          badge.textContent = dev ? dev.username : '?';
        } else {
          badge.classList.add('human');
          badge.textContent = '?';
        }
        if (isHost) {
          badge.style.cursor = 'pointer';
          badge.title = 'Click to change who controls this player';
          badge.addEventListener('click', (function (idx) {
            return function (e) {
              e.stopPropagation();
              openReassignPopup(idx);
            };
          })(i));
        }
        topRow.appendChild(badge);

        // Host gets a × remove circle on every occupied seat.
        if (isHost) {
          var removeCircle = document.createElement('div');
          removeCircle.className = 'seat-remove-circle';
          removeCircle.textContent = '\u00d7';
          removeCircle.title = 'Remove player';
          removeCircle.addEventListener('click', (function (idx) {
            return function (e) {
              e.stopPropagation();
              Online.removeFromSeat(idx);
            };
          })(i));
          topRow.appendChild(removeCircle);
        }
      }

      el.appendChild(topRow);

      // Avatar
      var avatar = document.createElement('div');
      avatar.className = 'seat-avatar';

      if (seat.occupied) {
        if (seat.animal) {
          avatar.appendChild(SpriteEngine.createSpriteImg(seat.animal));
          avatar.querySelector('img').style.width = '100%';
          avatar.querySelector('img').style.height = '100%';
        }
        // Avatar click — opens the animal picker for whoever controls
        // this seat (host, or the assigned joiner). Not the reassign
        // popup (that's on the badge above).
        var canPickAnimal = (seat.deviceId && seat.deviceId === myDeviceId);
        if (canPickAnimal) {
          avatar.style.cursor = 'pointer';
          avatar.addEventListener('click', (function (seatIdx) {
            return function () { openOnlineAnimalPicker(seatIdx); };
          })(i));
        }
      } else if (isHost) {
        // Empty seat — host clicks to add a new player (defaults to
        // host-controlled human; host can then reassign via the badge).
        el.style.cursor = 'pointer';
        el.addEventListener('click', (function (idx) {
          return function () { Online.addPlayer(idx, /*asAI=*/false); };
        })(i));
      }
      el.appendChild(avatar);

      // Editable name (filled seats only)
      if (seat.occupied) {
        var nameEl = document.createElement('div');
        nameEl.className = 'seat-name';
        nameEl.textContent = seat.name;
        nameEl.dataset.seat = i;
        if (seat.deviceId === myDeviceId) {
          nameEl.addEventListener('click', (function (idx) {
            return function (e) {
              e.stopPropagation();
              startOnlineLobbyNameEdit(idx);
            };
          })(i));
        }
        el.appendChild(nameEl);
      }

      ring.appendChild(el);
    }
  }

  // Host-only: open the reassign-controller popup for a given seat.
  // Offers AI, Host, or any other connected joiner as the controller.
  function openReassignPopup(seatIdx) {
    if (!Online.isActive() || !Online.isHost()) return;
    var lobbyState = Online.getLobbyState();
    var seat = lobbyState.seats[seatIdx];
    if (!seat || !seat.occupied) return;

    var overlay = document.getElementById('reassign-overlay');
    if (!overlay) return;
    var card = document.getElementById('reassign-player-card');
    var optsEl = document.getElementById('reassign-options');
    var titleEl = document.getElementById('reassign-title');
    titleEl.textContent = 'Who controls ' + (seat.name || 'this player') + '?';

    // Player card header
    card.innerHTML = '';
    var av = document.createElement('div');
    av.className = 'ra-avatar';
    if (seat.animal) {
      var img = SpriteEngine.createSpriteImg(seat.animal);
      img.style.width = '100%'; img.style.height = '100%';
      av.appendChild(img);
    }
    card.appendChild(av);
    var nm = document.createElement('div');
    nm.className = 'ra-name';
    nm.textContent = seat.name;
    card.appendChild(nm);

    // Options: AI, Host (myDeviceId), each connected joiner
    optsEl.innerHTML = '';
    var myDeviceId = Online.getMyDeviceId();
    function addOption(tag, label, value) {
      var btn = document.createElement('button');
      btn.className = 'reassign-option';
      if (
        (value === 'ai' && seat.isAI) ||
        (value !== 'ai' && !seat.isAI && seat.deviceId === value)
      ) {
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
    addOption('AI', 'AI (auto-play)', 'ai');
    var devices = lobbyState.devices || {};
    // Host always appears first among human options.
    if (devices[myDeviceId]) {
      addOption('Host', devices[myDeviceId].username + ' (host)', myDeviceId);
    }
    // Other connected devices.
    Object.keys(devices).forEach(function (pid) {
      if (pid === myDeviceId) return;
      var d = devices[pid];
      addOption('Player', d.username || pid, pid);
    });

    document.getElementById('btn-reassign-cancel').onclick = function () {
      overlay.style.display = 'none';
    };
    overlay.style.display = 'flex';
  }

  function openOnlineAnimalPicker(seatIdx) {
    var picker = document.getElementById('online-animal-picker');
    if (!picker) return;
    var grid = picker.querySelector('.picker-grid');
    if (!grid) return;
    grid.innerHTML = '';

    var lobbyState = Online.getLobbyState();
    var animals = SpriteEngine.getAnimalList();
    var usedAnimals = [];
    for (var i = 0; i < NUM_TABLE_SEATS; i++) {
      if (lobbyState.seats[i].occupied && i !== seatIdx && lobbyState.seats[i].animal) {
        usedAnimals.push(lobbyState.seats[i].animal);
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
        btn.addEventListener('click', (function (animal, seat) {
          return function () {
            Online.sendChangeAnimal(seat, animal);
            picker.style.display = 'none';
          };
        })(animalId, seatIdx));
      }

      wrapper.appendChild(btn);

      var label = document.createElement('div');
      label.className = 'picker-animal-name';
      label.textContent = SpriteEngine.getAnimalName(animalId);
      wrapper.appendChild(label);

      grid.appendChild(wrapper);
    }

    picker.style.display = 'flex';
    picker.querySelector('.btn-picker-cancel-online').onclick = function () {
      picker.style.display = 'none';
    };
  }

  function startOnlineLobbyNameEdit(seatIdx) {
    var nameEl = document.querySelector('.seat-name[data-seat="' + seatIdx + '"]');
    if (!nameEl) return;

    var lobbyState = Online.getLobbyState();
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'seat-name-input';
    input.value = lobbyState.seats[seatIdx].name;
    input.maxLength = 12;

    var parent = nameEl.parentElement;
    parent.replaceChild(input, nameEl);
    input.focus();
    input.select();

    function finishEdit() {
      var newName = input.value.trim() || lobbyState.seats[seatIdx].name;
      Online.sendChangeName(seatIdx, newName);
      // v114: replay any deferred re-render that came in while
      // we had focus. Defer to the next tick so sendChangeName's
      // own renderOnlineLobby call (host case) finishes first.
      setTimeout(function () {
        if (_pendingLobbySeatsRender) {
          _pendingLobbySeatsRender = false;
          renderOnlineLobbySeats();
        }
      }, 0);
    }

    input.addEventListener('blur', finishEdit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = lobbyState.seats[seatIdx].name; input.blur(); }
    });
  }

  // ================================================================
  //  ONLINE GAME FLOW
  // ================================================================

  function onlineBeginGame(players) {
    // Canvas is already initialized from lobby phase
    // Hide lobby elements, show game elements
    gamePhase = 'playing';
    document.getElementById('online-lobby-header').style.display = 'none';
    document.getElementById('btn-online-deal').style.display = 'none';
    document.getElementById('lobby-waiting').style.display = 'none';

    beginNewRound();
  }

  // Mid-game join: skip beginNewRound (which would try to animate a
  // deal). Transition straight to the running game screen, render
  // the seat overlays from the current Game.players, and let the
  // state-sync that follows populate the card displays. This is the
  // path for a device that joins a room AFTER the host has already
  // dealt a round.
  function enterGameInProgress(players) {
    gamePhase = 'playing';
    showScreen('screen-game');
    document.getElementById('setup-header').style.display = 'none';
    document.getElementById('player-count-control').style.display = 'none';
    document.getElementById('btn-deal').style.display = 'none';
    document.getElementById('online-lobby-header').style.display = 'none';
    document.getElementById('btn-online-deal').style.display = 'none';
    document.getElementById('lobby-waiting').style.display = 'none';
    document.getElementById('game-hud').style.display = '';
    document.getElementById('deck-info').style.display = '';
    showActionBar(false);

    var menuBtn = document.getElementById('btn-menu');
    menuBtn.textContent = 'Leave Room';

    handDisplay = {};
    renderGameTable().then(function () {
      updateHUD();
      updateDeckCount();
      // The paired game_state_sync that the host sent right after
      // mid_game_entry will rebuild each seat's handDisplay, refresh
      // totals/status pills, update leader glow, and call nextTurn
      // — so we don't need to do more here.
    });
  }

  // Host: handle action from a remote guest
  function onlineHandleRemoteAction(data) {
    var playerId = data.playerId;
    var action = data.action;
    var player = Game.getCurrentPlayer();
    // v116 diagnostic: log when host receives an action that
    // doesn't match its current player. Helps catch the "iPad
    // clicks Draw → freeze" pattern where iPad's reported
    // playerId doesn't match host's Game.getCurrentPlayer().id.
    if (!player || player.id !== playerId) {
      console.warn('[UI] onlineHandleRemoteAction: rejected action=' + action +
                   ' from playerId=' + playerId +
                   ' (host current=' + (player && player.id) + ')');
      return;
    }
    showActionBar(false);
    gameFlowLocked = true;
    executeAction(playerId, action);
  }

  // Guests holding a pending initial deal from the host. When a guest's
  // beginNewRound starts on a slow device, the host's `deal_round`
  // broadcast may have already arrived — we stash the dealOrder here
  // so beginNewRound picks it up immediately instead of re-dealing a
  // local random hand. If the guest's beginNewRound starts FIRST, we
  // stash the resolver and fire it when the broadcast arrives.
  var pendingDealOrder = null;
  var pendingDealResolve = null;
  // Set to true on the guest while animateDealSequence is mutating
  // state.deck via Game.dealCardTo. State syncs that arrive in this
  // window are queued and replayed afterwards instead of clobbering
  // the deck mid-animation (which would produce extra cards).
  var _dealAnimationLock = false;
  var _pendingDealLockSync = null;

  function waitForHostDealRound() {
    return new Promise(function (resolve) {
      if (pendingDealOrder) {
        var rd = { dealOrder: pendingDealOrder };
        pendingDealOrder = null;
        resolve(rd);
        return;
      }
      pendingDealResolve = resolve;
      // Safety timeout: if the host never broadcasts deal_round (e.g.
      // version mismatch), fall back to the Game's local state so the
      // guest doesn't hang forever. 15s is generous.
      setTimeout(function () {
        if (pendingDealResolve === resolve) {
          console.warn('[UI] waitForHostDealRound timeout — falling back to local state');
          pendingDealResolve = null;
          resolve({ dealOrder: buildDealOrderFromCurrentState() });
        }
      }, 15000);
    });
  }

  function buildDealOrderFromCurrentState() {
    var gs = Game.getState();
    var dealOrder = [];
    if (!gs || !gs.players || !gs.hands) return dealOrder;
    var turnOrder = gs.turnOrder || gs.players.map(function (p) { return p.id; });
    for (var c = 0; c < 3; c++) {
      for (var i = 0; i < turnOrder.length; i++) {
        var pid = turnOrder[i];
        var hand = gs.hands[pid];
        if (hand && hand.cards && hand.cards[c]) {
          dealOrder.push({ playerId: pid, card: hand.cards[c] });
        }
      }
    }
    return dealOrder;
  }

  // Guest: handle game action broadcast from host. These are declarative
  // "this just happened" events that let guests play the same animation
  // in parallel with the host instead of waiting for a state-sync to
  // land and silently snapping values. A host-authoritative state sync
  // still arrives at the end of the move and reconciles any drift.
  function onlineHandleGameAction(data) {
    if (data.type === 'play_again') {
      Online.setGamePhase('playing');
      playAgain();
      return;
    }
    if (data.type === 'deal_round') {
      // Host has dealt. Apply the authoritative state and feed the
      // dealOrder into our beginNewRound deal animation.
      if (data.gameState) Game.deserialize(data.gameState);
      // Any previous handDisplay (e.g. from a prior round) is now
      // stale — clear it so the deal animation renders the new cards.
      for (var pid in handDisplay) {
        handDisplay[pid] = [];
      }
      if (pendingDealResolve) {
        var resolve = pendingDealResolve;
        pendingDealResolve = null;
        resolve({ dealOrder: data.dealOrder });
      } else {
        pendingDealOrder = data.dealOrder;
      }
      return;
    }
    // While the guest is still animating the initial deal, IGNORE any
    // mid-game action broadcasts. On a fast host (e.g. mobile) the AI
    // may already have started taking turns and firing action_draw
    // events while a slow guest (e.g. desktop with PIXI texture work)
    // is still mid-deal. Without this guard, those action_draw events
    // would push cards into handDisplay in parallel with the in-flight
    // animateCanvasDeal pushes — visibly DOUBLING cards for whichever
    // players acted on host before the guest's deal finished. The
    // queued state_sync replay in beginNewRound will paint the correct
    // post-deal+post-action state once the deal lock releases.
    if (_dealAnimationLock) return;
    if (data.type === 'action_draw') {
      var pid = data.playerId;
      var player = Game.getPlayerById(pid);
      var seatIndex = (data.seatIndex !== undefined) ? data.seatIndex : (player && player.seatIndex);
      // Fly the card from the deck to the player's hand, same as the host.
      animateCanvasDraw(data.card, pid, seatIndex).then(function () {
        updateDeckCount();
        // Optimistically show the new total — state sync will reconfirm.
        var totalEl = document.querySelector('[data-total="' + pid + '"]');
        if (totalEl && data.newTotal !== undefined) {
          totalEl.textContent = data.newTotal;
          totalEl.style.visibility = 'visible';
        }
        updateLeaderGlow();
        if (data.busted) {
          var seatEl = document.querySelector('.game-seat[data-player="' + pid + '"]');
          if (seatEl) Animations.animateBust(seatEl);
          updatePlayerStatus(pid, 'busted');
        } else if (data.stayed) {
          updatePlayerStatus(pid, 'stayed');
        }
      });
      return;
    }
    if (data.type === 'action_stay') {
      var pid2 = data.playerId;
      var totalEl2 = document.querySelector('[data-total="' + pid2 + '"]');
      if (totalEl2 && data.total !== undefined) {
        totalEl2.textContent = data.total;
        totalEl2.style.visibility = 'visible';
      }
      updatePlayerStatus(pid2, 'stayed');
      updateLeaderGlow();
      return;
    }
  }

  // Guest: handle full state sync from host
  function onlineHandleStateSync(data) {
    // If we're mid-deal-animation, queue this sync — the deal flow
    // will replay it once Game.dealCardTo is done mutating state.
    // (See _dealAnimationLock / replay block in beginNewRound.)
    if (_dealAnimationLock) {
      _pendingDealLockSync = data;
      return;
    }
    if (data.gameState) {
      Game.deserialize(data.gameState);
    }
    // Refresh display
    var gs = Game.getState();

    // Rebuild hand display from deserialized state. We used to bail out
    // when lengths matched, but that was wrong: the guest's own
    // Game.newRound() at deal time produces a RANDOM local hand (guest's
    // deck shuffle ≠ host's deck shuffle), so the lengths still match
    // while the actual card ranks/suits differ. We now compare card by
    // card and rebuild when ANY position doesn't match.
    for (var i = 0; i < gs.players.length; i++) {
      var pid = gs.players[i].id;
      var hand = Game.getHand(pid);
      var existing = handDisplay[pid];
      var needsRebuild = !existing || existing.length !== hand.cards.length;
      if (!needsRebuild) {
        for (var k = 0; k < hand.cards.length; k++) {
          var ex = existing[k] && existing[k].card;
          var want = hand.cards[k];
          if (!ex || !want || ex.rank !== want.rank || ex.suit !== want.suit) {
            needsRebuild = true;
            break;
          }
        }
      }
      if (needsRebuild) {
        handDisplay[pid] = [];
        for (var c = 0; c < hand.cards.length; c++) {
          handDisplay[pid].push({ card: hand.cards[c], faceUp: true });
        }
      }
      updatePlayerTotal(pid);
      // ALWAYS reconcile the status pill against authoritative state —
      // not just when busted/stayed is true. Without an explicit clear
      // case, a stale STAY pill from an earlier optimistic action_stay
      // (or a guest's local autostay logic that doesn't match the host)
      // would remain visible after the state sync. The fourth call here
      // hides the pill via updatePlayerStatus(_, null/undefined).
      if (hand.busted) updatePlayerStatus(pid, 'busted');
      else if (hand.stayed) updatePlayerStatus(pid, 'stayed');
      else updatePlayerStatus(pid, null);
    }
    updateHUD();
    updateDeckCount();

    if (gs.roundPhase === 'finished') {
      var winnerResult = Game.determineWinner();
      var results = Game.getResults();
      Animations.delay(Animations.TIMING.RESULTS_DELAY).then(function () {
        showResults(winnerResult, results);
      });
    } else if (gs.roundPhase === 'playing') {
      gameFlowLocked = false;
      nextTurn();
    }
  }

  // Host: send full game state to all guests
  function syncGameStateToGuests() {
    if (!Online.isActive() || !Online.isHost()) return;
    Online.broadcastGameStateSync({
      gameState: Game.serialize()
    });
  }

  // ================================================================
  //  SETUP PHASE (runs on the game screen with canvas background)
  // ================================================================

  function enterSetup() {
    gamePhase = 'setup';
    showScreen('screen-game');

    // Show setup elements, hide game/online elements
    document.getElementById('setup-header').style.display = '';
    document.getElementById('player-count-control').style.display = '';
    document.getElementById('btn-deal').style.display = '';
    document.getElementById('game-hud').style.display = 'none';
    document.getElementById('game-actions').style.display = 'none';
    document.getElementById('deck-info').style.display = 'none';
    document.getElementById('online-lobby-header').style.display = 'none';
    document.getElementById('btn-online-deal').style.display = 'none';
    document.getElementById('lobby-waiting').style.display = 'none';

    // Init canvas if needed
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
      // Hide the CSS table-felt since canvas renders the table
      var felt = document.querySelector('#screen-game .table-felt');
      if (felt) felt.style.display = 'none';

      // Start render loop with callback that hides deck count during setup
      Renderer.startLoop(function () {
        Renderer.hideDeckCount();
      });

      installViewportHandlers();

      prepareSetupScreen();
    });
  }

  function prepareSetupScreen() {
    initSetupSeats();
    var title = document.getElementById('setup-title');
    title.textContent = 'Game Setup';

    playerCount = 2;
    autoFillSeats();
    renderSetupSeats();
    updateDealButton();
    updatePlayerCountButtons();
  }

  function getRandomAnimal() {
    var animals = SpriteEngine.getAnimalList();
    var usedAnimals = setupSeats.filter(function (s) { return s.occupied; }).map(function (s) { return s.animal; });
    var available = animals.filter(function (a) { return usedAnimals.indexOf(a) === -1; });
    if (available.length === 0) available = animals;
    return available[Math.floor(Math.random() * available.length)];
  }

  function getAnimalName(animalId) {
    var names = ANIMAL_NICKNAMES[animalId];
    if (names) {
      return names[Math.floor(Math.random() * names.length)];
    }
    return SpriteEngine.getAnimalName(animalId);
  }

  // Pick a random occupied seat to be the dealer (current dealer is included
  // in the shuffle so it may or may not change).
  function randomizeDealer() {
    var occupied = [];
    for (var i = 0; i < setupSeats.length; i++) {
      if (setupSeats[i].occupied) occupied.push(i);
    }
    if (occupied.length === 0) return;
    for (var j = 0; j < setupSeats.length; j++) setupSeats[j].isDealer = false;
    var pick = occupied[Math.floor(Math.random() * occupied.length)];
    setupSeats[pick].isDealer = true;
  }

  function autoFillSeats() {
    initSetupSeats();
    addOrder = [];
    dealerManuallySet = false;

    // Use fixed seat fill order
    var finalSeats = SEAT_FILL_ORDER.slice(0, playerCount);

    // Slot 0 (bottom) is always the human; all other slots are AI.
    // Each player gets a random animal.
    for (var k = 0; k < finalSeats.length; k++) {
      var idx = finalSeats[k];
      var animal = getRandomAnimal();
      setupSeats[idx].occupied = true;
      setupSeats[idx].animal = animal;
      setupSeats[idx].isHuman = (idx === 0);
      setupSeats[idx].name = getAnimalName(animal);
      setupSeats[idx].isDealer = false; // no dealer pre-assigned
      addOrder.push(idx);
    }

    // No dealer is auto-selected in setup. All occupied seats show a hollow
    // dashed "D" slot; the player can click one to pre-pick. When they click
    // Deal, a random dealer is chosen if none was manually set.
    document.getElementById('player-count-display').textContent = playerCount;
  }

  function renderSetupSeats() {
    var ring = document.getElementById('seats-ring');
    ring.innerHTML = '';

    // Use Renderer overlay positions when canvas is ready for consistent positioning
    var positions;
    if (canvasReady) {
      positions = Renderer.getSeatOverlayPositions(NUM_TABLE_SEATS);
    } else {
      var table = ring.parentElement;
      var w = table.offsetWidth;
      var h = table.offsetHeight;
      positions = Animations.getSeatPositions(w, h, NUM_TABLE_SEATS);
    }

    for (var i = 0; i < NUM_TABLE_SEATS; i++) {
      var seat = setupSeats[i];
      var pos = positions[i];

      var el = document.createElement('div');
      el.className = 'seat' + (seat.occupied ? '' : ' seat-empty');
      el.style.left = pos.x + 'px';
      // Seat's visible top is the top-row (badges sit above the avatar).
      // The row is rendered in-flow so account for its reserved height.
      // .seat-top-row is 3vmin fixed + 0.3vmin margin-bottom. Using 3.3
      // instead of just 3 puts the avatar center EXACTLY on the tangent
      // orbit; 3 alone leaves a 0.3vmin visible gap on bottom seats.
      var setupTopRowOffset = 3.3 * getVmin();
      el.style.top = (pos.y - setupTopRowOffset - getSetupAvatarSize() / 2) + 'px';
      el.dataset.seat = i;

      // Top row: [dealer / dealer-slot] [AI/Human badge] [remove X]
      // Occupied seats get all three. Empty seats get only the badge.
      var topRow = document.createElement('div');
      topRow.className = 'seat-top-row';

      if (seat.occupied) {
        // Dealer chip (solid if dealer, hollow/dashed if not — click to set)
        var dealerBadge = document.createElement('div');
        dealerBadge.className = seat.isDealer ? 'seat-dealer-chip' : 'seat-dealer-slot';
        dealerBadge.textContent = 'D';
        if (!seat.isDealer) {
          dealerBadge.title = 'Make dealer';
          dealerBadge.addEventListener('click', (function (idx) {
            return function (e) {
              e.stopPropagation();
              setDealer(idx);
            };
          })(i));
        }
        topRow.appendChild(dealerBadge);

        // AI/Human badge (toggle)
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
        topRow.appendChild(badge);

        // Remove X (dashed red circle)
        var removeCircle = document.createElement('div');
        removeCircle.className = 'seat-remove-circle';
        removeCircle.textContent = '\u00d7';
        removeCircle.title = 'Remove player';
        removeCircle.addEventListener('click', (function (idx) {
          return function (e) {
            e.stopPropagation();
            removeSeat(idx);
          };
        })(i));
        topRow.appendChild(removeCircle);
      } else {
        // Empty slot — just the AI/Human toggle badge
        var emptyBadge = document.createElement('div');
        var pt = seatPendingType[i] || 'ai';
        emptyBadge.className = 'seat-type-badge ' + (pt === 'human' ? 'human' : 'ai');
        emptyBadge.textContent = pt === 'human' ? 'Human' : 'AI';
        emptyBadge.dataset.seat = i;
        emptyBadge.addEventListener('click', (function (idx) {
          return function (e) {
            e.stopPropagation();
            seatPendingType[idx] = seatPendingType[idx] === 'human' ? 'ai' : 'human';
            renderSetupSeats();
          };
        })(i));
        topRow.appendChild(emptyBadge);
      }

      el.appendChild(topRow);

      // Avatar
      var avatar = document.createElement('div');
      avatar.className = 'seat-avatar';
      if (seat.occupied && seat.animal) {
        avatar.appendChild(SpriteEngine.createSpriteImg(seat.animal));
        avatar.querySelector('img').style.width = '100%';
        avatar.querySelector('img').style.height = '100%';
      }
      el.appendChild(avatar);

      if (seat.occupied) {
        // Editable name
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
      }

      // Click to select character or add player
      avatar.addEventListener('click', (function (idx) {
        return function () { onSeatClick(idx); };
      })(i));

      // Right-click to set dealer
      el.addEventListener('contextmenu', (function (idx) {
        return function (e) {
          e.preventDefault();
          if (setupSeats[idx].occupied) setDealer(idx);
        };
      })(i));

      ring.appendChild(el);
    }
  }

  // ---- Inline Name Editing ----
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
      setupSeats[seatIdx].nameEdited = true;
      renderSetupSeats();
    }

    input.addEventListener('blur', finishEdit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
      if (e.key === 'Escape') {
        input.value = setupSeats[seatIdx].name;
        input.blur();
      }
    });
  }

  function onSeatClick(seatIdx) {
    // Click empty to add, click occupied to change character
    if (setupSeats[seatIdx].occupied) {
      pickerIsNewSeat = false;
      openPicker(seatIdx);
    } else {
      addSeat(seatIdx);
    }
  }

  function addSeat(seatIdx, forceType) {
    var occupiedCount = setupSeats.filter(function (s) { return s.occupied; }).length;
    if (occupiedCount >= 8) return;

    var type = forceType || seatPendingType[seatIdx] || 'ai';

    // If human type, open picker to let user choose animal
    if (type === 'human') {
      pickerIsNewSeat = true;
      openPicker(seatIdx);
      return;
    }

    var animal = getRandomAnimal();

    setupSeats[seatIdx].occupied = true;
    setupSeats[seatIdx].animal = animal;
    setupSeats[seatIdx].name = getAnimalName(animal);
    // Slot 0 (bottom) is always the human if no human exists yet
    var hasHuman = setupSeats.some(function (s) { return s.occupied && s.isHuman; });
    setupSeats[seatIdx].isHuman = (seatIdx === 0 && !hasHuman);
    setupSeats[seatIdx].nameEdited = false;
    setupSeats[seatIdx].isDealer = false;
    // No auto-assign. Dealer is chosen either by clicking a hollow "D" slot
    // during setup, or randomly at deal-time if none was picked.

    addOrder.push(seatIdx);
    playerCount = setupSeats.filter(function (s) { return s.occupied; }).length;
    document.getElementById('player-count-display').textContent = playerCount;

    renderSetupSeats();
    updateDealButton();
    updatePlayerCountButtons();
  }

  function removeSeat(seatIdx) {
    var occupiedCount = setupSeats.filter(function (s) { return s.occupied; }).length;
    if (occupiedCount <= 2) return; // Minimum 2 players

    var wasDealer = setupSeats[seatIdx].isDealer;
    setupSeats[seatIdx] = {
      occupied: false, animal: null, name: '', isHuman: false, isDealer: false, nameEdited: false
    };

    // Remove from addOrder tracking
    var orderIdx = addOrder.indexOf(seatIdx);
    if (orderIdx !== -1) addOrder.splice(orderIdx, 1);

    // If the manually-chosen dealer was removed, clear the manual flag so
    // the game picks a random dealer at deal time.
    if (wasDealer) {
      dealerManuallySet = false;
    }

    playerCount = setupSeats.filter(function (s) { return s.occupied; }).length;
    document.getElementById('player-count-display').textContent = playerCount;

    renderSetupSeats();
    updateDealButton();
    updatePlayerCountButtons();
  }

  function toggleHumanAI(seatIdx) {
    setupSeats[seatIdx].isHuman = !setupSeats[seatIdx].isHuman;
    renderSetupSeats();
    updateDealButton();
  }

  function setDealer(seatIdx) {
    for (var i = 0; i < setupSeats.length; i++) {
      setupSeats[i].isDealer = false;
    }
    setupSeats[seatIdx].isDealer = true;
    dealerManuallySet = true; // user picked — stop the random reshuffle
    renderSetupSeats();
  }

  function updateDealButton() {
    var btn = document.getElementById('btn-deal');
    var occupied = setupSeats.filter(function (s) { return s.occupied; });
    var hasHuman = occupied.some(function (s) { return s.isHuman; });
    // No dealer requirement — one is picked at random on Deal if none chosen
    btn.disabled = occupied.length < 2 || !hasHuman;
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

    if (pickerIsNewSeat) {
      // Adding a new human player via picker
      setupSeats[pickerTargetSeat].occupied = true;
      setupSeats[pickerTargetSeat].animal = animalId;
      setupSeats[pickerTargetSeat].name = getAnimalName(animalId);
      setupSeats[pickerTargetSeat].isHuman = true;
      setupSeats[pickerTargetSeat].nameEdited = false;
      setupSeats[pickerTargetSeat].isDealer = false;
      // No auto-assign; dealer chosen by click or at deal-time.

      addOrder.push(pickerTargetSeat);
      playerCount = setupSeats.filter(function (s) { return s.occupied; }).length;
      document.getElementById('player-count-display').textContent = playerCount;
      updatePlayerCountButtons();
      updateDealButton();
    } else {
      // Changing animal on existing seat — preserve edited names
      setupSeats[pickerTargetSeat].animal = animalId;
      if (!setupSeats[pickerTargetSeat].nameEdited) {
        setupSeats[pickerTargetSeat].name = getAnimalName(animalId);
      }
    }

    closePicker();
    renderSetupSeats();
  }

  function closePicker() {
    document.getElementById('character-picker').style.display = 'none';
    pickerTargetSeat = -1;
    pickerIsNewSeat = false;
  }

  // ================================================================
  //  GAME FLOW
  // ================================================================

  function startGame() {
    // If no dealer was chosen during setup, pick a random one now.
    var hasDealer = setupSeats.some(function (s) { return s.occupied && s.isDealer; });
    if (!hasDealer) {
      randomizeDealer();
    }

    // Build players from setup
    var players = [];
    var dealerIdx = 0;
    var id = 0;

    for (var i = 0; i < NUM_TABLE_SEATS; i++) {
      if (setupSeats[i].occupied) {
        var p = Game.createPlayer(
          id, i,
          setupSeats[i].animal,
          setupSeats[i].name,
          setupSeats[i].isHuman,
          setupSeats[i].isDealer
        );
        if (setupSeats[i].isDealer) dealerIdx = id;
        players.push(p);
        id++;
      }
    }

    Game.setupGame(players, dealerIdx);
    beginNewRound();
  }

  function beginNewRound() {
    var isOnline = Online.isActive();
    var isOnlineGuest = isOnline && !Online.isHost();
    var isOnlineHost  = isOnline && Online.isHost();

    // Authoritative dealing:
    //   Host (online or local): calls Game.newRound() locally and gets
    //     the dealOrder back. If online, it also broadcasts deal_round
    //     immediately so every guest animates the SAME cards.
    //   Online guest: does NOT call Game.newRound() — that would re-
    //     shuffle a local deck and deal RANDOM cards that look wrong
    //     briefly and then snap to the host's cards when state sync
    //     lands. Instead, waits for the host's deal_round broadcast,
    //     applies the state it carries, and animates the host's deal.
    var roundDataPromise;
    if (isOnlineGuest) {
      roundDataPromise = waitForHostDealRound();
    } else {
      var roundData = Game.newRound();
      if (isOnlineHost) {
        Online.broadcastGameAction({
          type: 'deal_round',
          dealOrder: roundData.dealOrder,
          gameState: Game.serialize()
        });
      }
      roundDataPromise = Promise.resolve(roundData);
    }

    // Switch to playing phase (stays on game screen)
    gamePhase = 'playing';
    showScreen('screen-game');
    document.getElementById('setup-header').style.display = 'none';
    document.getElementById('player-count-control').style.display = 'none';
    document.getElementById('btn-deal').style.display = 'none';
    document.getElementById('online-lobby-header').style.display = 'none';
    document.getElementById('btn-online-deal').style.display = 'none';
    document.getElementById('lobby-waiting').style.display = 'none';
    document.getElementById('game-hud').style.display = '';
    document.getElementById('deck-info').style.display = '';
    showActionBar(false);

    // Update menu button text for online mode
    var menuBtn = document.getElementById('btn-menu');
    menuBtn.textContent = isOnline ? 'Leave Room' : 'Main Menu';

    // Guests: keep local state pristine so no stale hands render while
    // we're waiting for the host's deal.
    if (isOnlineGuest) {
      handDisplay = {};
    }

    var _roundData; // captured for later stages
    // Guard against `game_state_sync` clobbering Game state DURING the
    // local deal animation. The host's syncGameStateToGuests fires
    // right after its own deal completes; on a fast mobile host, that
    // sync can arrive while a slower guest (e.g. a desktop with PIXI
    // texture work) is still mid-animation. If we let the sync apply
    // mid-deal, it overwrites state.deck and state.hands with the
    // post-deal snapshot, then our in-flight `Game.dealCardTo` calls
    // pop ANOTHER set of cards off that snapshot deck and shovel them
    // into the now-already-populated hands — producing visibly extra
    // cards on the slow device. We set this flag on the guest before
    // animateDealSequence and clear it after the deal finishes; the
    // state-sync handler queues any sync that arrives during this
    // window and replays it once we're done.
    renderGameTable().then(function () {
      updateHUD();
      // Animate dealing
      gameFlowLocked = true;
      setMessage('Dealing...');
      return Animations.delay(500);
    }).then(function () {
      // Guests block here until deal_round arrives. Hosts resolve
      // immediately with the locally-computed dealOrder.
      return roundDataPromise;
    }).then(function (roundData) {
      _roundData = roundData;
      if (isOnlineGuest) _dealAnimationLock = true;
      return animateDealSequence(roundData.dealOrder);
    }).then(function () {
      // Flip all cards face up on canvas
      return animateFlipAllCards();
    }).then(function () {
      return Animations.delay(300);
    }).then(function () {
      // Show totals for all players after dealing
      var players = Game.getState().players;
      for (var i = 0; i < players.length; i++) {
        updatePlayerTotal(players[i].id);
      }

      // Auto-stay any players dealt a natural 30 (can't improve)
      if (Game.checkNatural30()) {
        var allPlayers = Game.getState().players;
        for (var n = 0; n < allPlayers.length; n++) {
          var nid = allPlayers[n].id;
          if (CardSystem.handTotal(Game.getHand(nid).cards) === 30) {
            Game.stay(nid);
            updatePlayerStatus(nid, 'stayed');
          }
        }
      }

      setMessage('');
      Game.startPlaying();
      // Host syncs initial game state after dealing
      if (Online.isActive() && Online.isHost()) syncGameStateToGuests();
      gameFlowLocked = false;
      // Drop the deal-animation lock on the guest (so subsequent
      // state-syncs apply immediately) and replay any sync that
      // arrived during the deal — the latest one is the winner.
      if (isOnlineGuest) {
        _dealAnimationLock = false;
        if (_pendingDealLockSync) {
          var queued = _pendingDealLockSync;
          _pendingDealLockSync = null;
          onlineHandleStateSync(queued);
        }
      }
      nextTurn();
    });
  }

  // ---- Canvas Deal Animation ----
  function animateDealSequence(dealOrder) {
    var promise = Promise.resolve();

    for (var i = 0; i < dealOrder.length; i++) {
      (function (playerId) {
        promise = promise.then(function () {
          var card = Game.dealCardTo(playerId);
          if (!card) return;

          var player = Game.getPlayerById(playerId);
          return animateCanvasDeal(card, playerId, player.seatIndex).then(function () {
            updateDeckCount();
          });
        });
      })(dealOrder[i]);
    }

    return promise;
  }

  // Viewport-proportional card scale (matches drawGameFrame)
  function getCardScale() {
    var W = window.innerWidth;
    var H = window.innerHeight;
    return 1.1 * (Math.min(W, H) / 1080);
  }

  function animateCanvasDeal(card, playerId, seatIndex) {
    return new Promise(function (resolve) {
      var tableCenter = Renderer.getTableCenter();
      var seatPositions = Renderer.getSeatPositions(NUM_TABLE_SEATS);
      var seatPos = seatPositions[seatIndex];
      var handPos = Renderer.getHandPosition(seatPos, tableCenter);

      var fc = Renderer.addFlyingCard({
        card: card,
        faceUp: false,
        x: tableCenter.x,
        y: tableCenter.y,
        scale: getCardScale()
      });

      Renderer.animate(350, function (t) {
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

  // ---- Canvas Draw Animation (during play) ----
  function animateCanvasDraw(card, playerId, seatIndex) {
    return new Promise(function (resolve) {
      var tableCenter = Renderer.getTableCenter();
      var seatPositions = Renderer.getSeatPositions(NUM_TABLE_SEATS);
      var seatPos = seatPositions[seatIndex];
      var handPos = Renderer.getHandPosition(seatPos, tableCenter);

      var fc = Renderer.addFlyingCard({
        card: card,
        faceUp: false,
        flipProgress: 0,
        x: tableCenter.x,
        y: tableCenter.y,
        scale: getCardScale()
      });

      Renderer.animate(500, function (t) {
        var e = Renderer.easeOutCubic(t);
        fc.x = tableCenter.x + (handPos.x - tableCenter.x) * e;
        fc.y = tableCenter.y + (handPos.y - tableCenter.y) * e;
        // Flip halfway through flight
        fc.flipProgress = Math.min(t * 2, 1);
      }, function () {
        Renderer.removeFlyingCard(fc);
        if (!handDisplay[playerId]) handDisplay[playerId] = [];
        // Guard against the slow-device race that produced visibly
        // doubled cards on Windows desktops: while a 500ms
        // animateCanvasDraw is in flight on a slow guest, the host's
        // post-action `game_state_sync` can arrive and run
        // onlineHandleStateSync, which rebuilds handDisplay from
        // authoritative state — adding THIS card to handDisplay
        // before our completion callback runs. When the animation
        // then finishes and pushes the card again unconditionally,
        // the visual doubles up. Decks have unique cards within a
        // round, so a same-rank-same-suit match is always the same
        // card — safe to skip the push.
        var alreadyHas = handDisplay[playerId].some(function (entry) {
          return entry && entry.card && card &&
                 entry.card.rank === card.rank &&
                 entry.card.suit === card.suit;
        });
        if (!alreadyHas) {
          handDisplay[playerId].push({ card: card, faceUp: true });
        }
        resolve();
      });
    });
  }

  // ---- Canvas Flip All Cards ----
  function animateFlipAllCards() {
    var allCardRefs = [];
    var gs = Game.getState();

    for (var i = 0; i < gs.players.length; i++) {
      var pid = gs.players[i].id;
      var display = handDisplay[pid];
      if (!display) continue;
      for (var j = 0; j < display.length; j++) {
        allCardRefs.push(display[j]);
      }
    }

    var promises = [];
    var stagger = 40;
    var flipDuration = 400;

    for (var k = 0; k < allCardRefs.length; k++) {
      (function (cd, delayMs) {
        promises.push(new Promise(function (resolve) {
          setTimeout(function () {
            cd.flipProgress = 0;
            Renderer.animate(flipDuration, function (t) {
              cd.flipProgress = t;
            }, function () {
              cd.faceUp = true;
              cd.flipProgress = undefined;
              resolve();
            });
          }, delayMs);
        }));
      })(allCardRefs[k], k * stagger);
    }

    return Promise.all(promises);
  }

  function nextTurn() {
    var player = Game.getCurrentPlayer();
    if (!player) {
      // Round is over
      endRound();
      return;
    }

    highlightActivePlayer(player.id);
    updateHUD();

    // Auto-end: last active player with the best score — drawing can only hurt
    if (Game.shouldAutoEnd(player.id)) {
      gameFlowLocked = true;
      setMessage(player.name + '\'s turn!');
      showActionBar(false);
      // Pause so humans can see the situation, then auto-stay and end
      Animations.delay(1500).then(function () {
        Game.stay(player.id);
        var stayTotal = CardSystem.handTotal(Game.getHand(player.id).cards);
        setMessage(player.name + ' stays with ' + stayTotal + '.');
        updatePlayerStatus(player.id, 'stayed');
        if (Online.isActive() && Online.isHost()) syncGameStateToGuests();
        return Animations.delay(Animations.TIMING.MESSAGE_DURATION);
      }).then(function () {
        endRound();
      });
      return;
    }

    if (player.isHuman) {
      // Online mode: only show buttons if this player belongs to this device
      if (Online.isActive() && !Online.isMyPlayer(player.id)) {
        // Remote human. If we're the host AND that player's device is
        // currently paused (screen off, network dropped, etc.), WE play
        // an AI move so the game doesn't stall. When they wake back up,
        // the device sees isDevicePaused flip off and normal control
        // resumes on their next turn.
        if (Online.isHost() && Online.shouldHostAutoPlay(player.id)) {
          setMessage(player.name + ' (paused — AI playing)');
          showActionBar(false);
          gameFlowLocked = true;
          Animations.delay(Animations.TIMING.AI_THINK).then(function () {
            // Re-check in case they resumed during the think delay
            if (!Online.shouldHostAutoPlay(player.id)) {
              gameFlowLocked = false;
              nextTurn();
              return;
            }
            var decision = Game.aiDecision(player.id);
            return executeAction(player.id, decision);
          }).catch(function (err) {
            console.error('[UI] Host-AI turn error:', err);
            gameFlowLocked = false;
            advanceToNext();
          });
        } else {
          setMessage(player.name + '\'s turn!');
          showActionBar(false);
          // Remote player — wait for their action via network
        }
      } else {
        setMessage(player.name + '\'s turn!');
        showActionBar(true, false);
      }
    } else {
      showActionBar(false);
      // AI: only the host processes AI decisions
      if (Online.isActive() && !Online.isHost()) {
        setMessage(player.name + ' is thinking...');
        // Guest waits — host will process AI and sync
      } else {
        setMessage(player.name + ' is thinking...');
        gameFlowLocked = true;

        Animations.delay(Animations.TIMING.AI_THINK).then(function () {
          var decision = Game.aiDecision(player.id);
          return executeAction(player.id, decision);
        }).catch(function (err) {
          console.error('[UI] AI turn error:', err);
          // Recover from error — advance to next player
          gameFlowLocked = false;
          advanceToNext();
        });
      }
    }
  }

  function humanAction(action) {
    var player = Game.getCurrentPlayer();
    if (!player || !player.isHuman) return;
    // v116 diagnostic: log who's clicking and whether the state
    // matches. Helps catch the "Draw click does nothing" freeze
    // that's been reported on devices that just had a seat
    // reassigned to them. If isMyPlayer returns false, the click
    // would be swallowed silently — log to make this visible.
    if (Online.isActive()) {
      var isMine = Online.isMyPlayer(player.id);
      console.log('[UI] humanAction(' + action + ') player=' + player.id +
                  ' deviceId=' + player.deviceId + ' isMyPlayer=' + isMine +
                  ' isHost=' + Online.isHost());
      if (!isMine && !Online.isHost()) {
        // Click was made but state thinks this isn't our player.
        // Log + bail (matches prior silent-bail behaviour).
        console.warn('[UI] humanAction: click rejected — Game.players state thinks this seat is not ours');
        return;
      }
    }
    showActionBar(false);
    gameFlowLocked = true;

    // Online guest: send action to host instead of processing locally
    if (Online.isActive() && !Online.isHost()) {
      Online.sendAction(player.id, action);
      // Host will process and sync state back
      return;
    }

    executeAction(player.id, action);
  }

  function executeAction(playerId, action) {
    try {
    var player = Game.getPlayerById(playerId);

    if (action === 'draw') {
      var result = Game.drawCard(playerId);

      setMessage(player.name + ' draws!');

      // Broadcast the draw action so every guest can run the SAME card-
      // flying animation in parallel, using the host's card data. The
      // guest's onlineHandleGameAction handler picks this up.
      if (Online.isActive() && Online.isHost() && result.action !== 'forced_stay') {
        Online.broadcastGameAction({
          type: 'action_draw',
          playerId: playerId,
          card: result.card,
          seatIndex: player.seatIndex,
          newTotal: result.total,
          busted: !!result.busted,
          stayed: (result.total === 30)
        });
      }

      if (result.action === 'forced_stay') {
        // Deck empty, force stay
        setMessage('Deck empty! ' + player.name + ' must stay.');
        Game.stay(playerId);
        return Animations.delay(Animations.TIMING.MESSAGE_DURATION).then(function () {
          updatePlayerStatus(playerId, 'stayed');
          advanceToNext();
        });
      }

      return animateCanvasDraw(result.card, playerId, player.seatIndex).then(function () {
        updateDeckCount();
        updatePlayerTotal(playerId);

        if (result.busted) {
          setMessage(player.name + ' busts with ' + result.total + '!');
          var seatEl = document.querySelector('.game-seat[data-player="' + playerId + '"]');
          Animations.animateBust(seatEl);
          updatePlayerStatus(playerId, 'busted');
          return Animations.delay(Animations.TIMING.MESSAGE_DURATION).then(function () {
            advanceToNext();
          });
        } else if (result.total === 30) {
          // Hit 30 on draw — auto-stay (can't improve), but don't end round
          // since another player could tie and win on tiebreaker
          Game.stay(playerId);
          setMessage(player.name + ' hits 30!');
          updatePlayerStatus(playerId, 'stayed');
          return Animations.delay(Animations.TIMING.MESSAGE_DURATION).then(function () {
            advanceToNext();
          });
        } else {
          return Animations.delay(400).then(function () {
            advanceToNext();
          });
        }
      }).catch(function (err) {
        console.error('[UI] executeAction draw error:', err);
        gameFlowLocked = false;
        advanceToNext();
      });
    } else {
      // Stay: lock in hand permanently
      Game.stay(playerId);
      var stayTotal = CardSystem.handTotal(Game.getHand(playerId).cards);
      setMessage(player.name + ' stays with ' + stayTotal + '.');
      updatePlayerStatus(playerId, 'stayed');

      // Mirror the "Stayed" visual onto guests immediately (rather than
      // waiting for the next state sync, which happens after the delay).
      if (Online.isActive() && Online.isHost()) {
        Online.broadcastGameAction({
          type: 'action_stay',
          playerId: playerId,
          total: stayTotal
        });
      }

      return Animations.delay(Animations.TIMING.MESSAGE_DURATION).then(function () {
        advanceToNext();
      });
    }
    } catch (err) {
      console.error('[UI] executeAction exception:', err);
      gameFlowLocked = false;
      advanceToNext();
    }
  }

  function advanceToNext() {
    var next = Game.advanceTurn();
    // Sync state after advancing (host broadcasts to guests)
    if (Online.isActive() && Online.isHost()) syncGameStateToGuests();
    if (!next) {
      endRound();
    } else {
      gameFlowLocked = false;
      nextTurn();
    }
  }

  function endRound() {
    gameFlowLocked = true;
    showActionBar(false);
    var winnerResult = Game.determineWinner();
    var results = Game.getResults();

    Animations.delay(Animations.TIMING.RESULTS_DELAY).then(function () {
      showResults(winnerResult, results);
    });
  }

  function playAgain() {
    beginNewRound();
  }

  // ================================================================
  //  GAME RENDERING (Canvas + HTML overlays)
  // ================================================================

  function renderGameTable() {
    var canvasEl = document.getElementById('game-canvas');

    // Initialize or resize canvas renderer (async for PixiJS)
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
      // Hide CSS table-felt (canvas renders the table)
      var felt = document.querySelector('#screen-game .table-felt');
      if (felt) felt.style.display = 'none';

      installViewportHandlers();

      // Reset hand display
      handDisplay = {};
      Renderer.clearFlyingCards();

      // Create HTML overlays for player info (using unified seats-ring)
      var ring = document.getElementById('seats-ring');
      ring.innerHTML = '';

      var players = Game.getState().players;
      var overlayPositions = Renderer.getSeatOverlayPositions(NUM_TABLE_SEATS);

      for (var i = 0; i < players.length; i++) {
        var p = players[i];
        var pos = overlayPositions[p.seatIndex];

        // Seat container
        var seat = document.createElement('div');
        seat.className = 'game-seat';
        seat.dataset.player = p.id;
        seat.style.left = pos.x + 'px';
        // The avatar sits UNDER the .game-seat-top-row (dealer + score + status),
        // so the seat's top must be shifted up by that row's reserved height
        // so the avatar itself is centered at pos.y (tangent to the table's
        // outer edge). Row height is fixed at 2.4vmin + 0.3vmin margin-bottom.
        var topRowOffset = 2.7 * getVmin();
        seat.style.top = (pos.y - topRowOffset - getGameAvatarSize() / 2) + 'px';

        // Top row: [dealer chip] [score] [status pill]
        // Dealer chip is tangent to the LEFT of the score, status to the RIGHT.
        // This keeps the widest vertical cross-section at just the avatar
        // width, making the overall seat footprint narrower.
        var topRow = document.createElement('div');
        topRow.className = 'game-seat-top-row';

        if (p.isDealer) {
          var chip = document.createElement('div');
          chip.className = 'seat-dealer-chip';
          chip.textContent = 'D';
          topRow.appendChild(chip);
        }

        var totalEl = document.createElement('div');
        totalEl.className = 'game-seat-total';
        totalEl.dataset.total = p.id;
        totalEl.textContent = '\u00a0';
        totalEl.style.visibility = 'hidden';
        topRow.appendChild(totalEl);

        var statusEl = document.createElement('div');
        statusEl.className = 'game-seat-status';
        statusEl.dataset.status = p.id;
        statusEl.textContent = '\u00a0';
        statusEl.style.visibility = 'hidden';
        topRow.appendChild(statusEl);

        seat.appendChild(topRow);

        // Avatar (the circle) — no more wrap needed now that chips are in top row
        var avatarEl = document.createElement('div');
        avatarEl.className = 'game-seat-avatar';
        avatarEl.appendChild(SpriteEngine.createSpriteImg(p.animal));
        // v97: host clicks ANY avatar mid-game to open the reassign
        // popup (AI / Host / any connected joiner). Works for all seats
        // including AI ones, so the host can swap controllers on the
        // fly as the game progresses.
        if (Online.isActive() && Online.isHost()) {
          avatarEl.style.cursor = 'pointer';
          avatarEl.title = 'Click to change who controls this player';
          avatarEl.addEventListener('click', (function (seatIdx) {
            return function (e) {
              e.stopPropagation();
              openReassignPopup(seatIdx);
            };
          })(p.seatIndex));
        }
        seat.appendChild(avatarEl);

        // Name — below avatar, centered
        var nameEl = document.createElement('div');
        nameEl.className = 'game-seat-name';
        nameEl.textContent = p.name;
        seat.appendChild(nameEl);

        ring.appendChild(seat);

        // Initialize hand display
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
    var seatPositions = Renderer.getSeatPositions(NUM_TABLE_SEATS);
    // Card dimensions scale proportionally with viewport so they look the same
    // relative to table on every device (not comically huge on mobile).
    var vmin = Math.min(W, H);
    var viewScale = vmin / 1080; // reference: 1080p desktop
    var cardScale = 1.1 * viewScale;
    var cardSpacing = 28.6 * viewScale;
    var CARDS_PER_ROW = 3;
    var ROW_INSET = 26.4 * viewScale; // how far inward each new row shifts toward center

    // Draw deck pile at table center
    Renderer.drawDeck(tableCenter.x, tableCenter.y, Game.getDeckCount());

    // Draw each player's hand
    for (var i = 0; i < gs.players.length; i++) {
      var p = gs.players[i];
      var seatPos = seatPositions[p.seatIndex];
      var handPos = Renderer.getHandPosition(seatPos, tableCenter);
      var display = handDisplay[p.id];
      if (!display || display.length === 0) continue;

      var numCards = display.length;
      // Direction from seat toward center (for row stacking)
      var towardCenterDx = tableCenter.x - seatPos.x;
      var towardCenterDy = tableCenter.y - seatPos.y;
      var dist = Math.sqrt(towardCenterDx * towardCenterDx + towardCenterDy * towardCenterDy);
      var nDx = dist > 0 ? towardCenterDx / dist : 0;
      var nDy = dist > 0 ? towardCenterDy / dist : 0;

      // Fan cards perpendicular to the line from center to seat
      var perpAngle = seatPos.angle + Math.PI / 2;
      var dx = Math.cos(perpAngle);
      var dy = Math.sin(perpAngle);

      // Use consistent base row size so overlay cards align with base cards
      // 4th lands on 1st, 5th on 2nd, 6th on 3rd, 7th on 4th, etc.
      var baseRowSize = Math.min(CARDS_PER_ROW, numCards);

      for (var j = 0; j < numCards; j++) {
        var cd = display[j];
        var row = Math.floor(j / CARDS_PER_ROW);
        var colInRow = j % CARDS_PER_ROW;

        // Row offset: each row shifts toward the center
        var rowOffsetX = nDx * row * ROW_INSET;
        var rowOffsetY = nDy * row * ROW_INSET;

        // Card fan offset within this row (always use baseRowSize for alignment)
        var offset = (colInRow - (baseRowSize - 1) / 2) * cardSpacing;
        var cardX = handPos.x + dx * offset + rowOffsetX;
        var cardY = handPos.y + dy * offset + rowOffsetY;

        // Rotate cards to face each player from their perspective
        var cardRotation = seatPos.angle - Math.PI / 2;

        // Golden glow behind winning player's cards
        if (glowingPlayerId === p.id) {
          var elapsed = (Date.now() - glowStartTime) / 1000;
          var pulseAlpha = 0.6 + 0.4 * Math.sin(elapsed * 3);
          Renderer.drawCardGlow(cardX, cardY, cardRotation, cardScale, pulseAlpha);
        }

        if (cd.flipProgress !== undefined) {
          Renderer.drawCardFlipping(cardX, cardY, cd.card, cd.flipProgress, cardScale, cardRotation);
        } else {
          Renderer.drawCard(cardX, cardY, cd.card, cd.faceUp, cardRotation, cardScale, 0.3);
        }
      }
    }
  }

  // ---- Reposition HTML overlays on resize ----
  function positionGameOverlays() {
    var gs = Game.getState();
    if (!gs || !gs.players) return;
    var overlayPositions = Renderer.getSeatOverlayPositions(NUM_TABLE_SEATS);
    // MUST match the top calc in renderGameTable: the seat contains a
    // .game-seat-top-row (height 2.4vmin + 0.3vmin margin = 2.7vmin) ABOVE
    // the avatar, so the seat's style.top is offset by that much so the
    // avatar center lands at pos.y (tangent to table's outer wood edge).
    // Omitting this offset pushes every avatar 2.7vmin off the tangent
    // orbit on resize.
    var topRowOffset = 2.7 * getVmin();

    for (var i = 0; i < gs.players.length; i++) {
      var p = gs.players[i];
      var pos = overlayPositions[p.seatIndex];
      var seat = document.querySelector('.game-seat[data-player="' + p.id + '"]');
      if (seat) {
        seat.style.left = pos.x + 'px';
        seat.style.top = (pos.y - topRowOffset - getGameAvatarSize() / 2) + 'px';
      }
    }

    // Action buttons are now CSS-positioned at center, no JS repositioning needed
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

  function updatePlayerTotal(playerId) {
    var hand = Game.getHand(playerId);
    if (!hand) return;
    var total = CardSystem.handTotal(hand.cards);
    var el = document.querySelector('[data-total="' + playerId + '"]');
    if (el) {
      el.textContent = total;
      el.style.visibility = 'visible';
    }
    // Re-evaluate the leader across all scores after this update
    updateLeaderGlow();
    // Keep mobile bar in sync with live scores; pass undefined so it
    // doesn't touch the buttons' visibility (showActionBar owns that).
    if (typeof updateMobileActionBar === 'function') updateMobileActionBar();
  }

  // Add a golden glow to the score of THE SINGLE player currently leading.
  // Ties are broken using the game's tiebreaker rules: more cards wins, then
  // most-recent draw wins. Ensures only one seat glows at a time.
  function updateLeaderGlow() {
    var state = Game.getState && Game.getState();
    if (!state || !state.players || !state.hands) return;
    var candidates = [];
    for (var i = 0; i < state.players.length; i++) {
      var p = state.players[i];
      var hand = state.hands[p.id];
      if (!hand || hand.busted) continue;
      var t = CardSystem.handTotal(hand.cards);
      if (t <= 0) continue;
      candidates.push({
        id: p.id,
        total: t,
        cards: hand.cards.length,
        lastDrawOrder: (hand.lastDrawOrder !== undefined ? hand.lastDrawOrder : -1),
        turnPos: state.turnOrder.indexOf(p.id)
      });
    }
    // Tiebreaker order matching Game.determineWinner:
    //   1) highest total   2) more cards   3) more recent draw   4) turn position
    candidates.sort(function (a, b) {
      if (b.total !== a.total) return b.total - a.total;
      if (b.cards !== a.cards) return b.cards - a.cards;
      if (b.lastDrawOrder !== a.lastDrawOrder) return b.lastDrawOrder - a.lastDrawOrder;
      return a.turnPos - b.turnPos;
    });
    var leaderId = candidates.length ? candidates[0].id : null;
    document.querySelectorAll('.game-seat-total').forEach(function (el) {
      var pid = el.dataset.total;
      if (leaderId !== null && pid !== undefined && Number(pid) === leaderId) {
        el.classList.add('leader');
      } else {
        el.classList.remove('leader');
      }
    });
    // Also tag the seat itself with .is-leader so the avatar's ring
    // turns gold (instead of the default wood-mid border) and, when
    // the leader is also the active player, the silver halo pulse
    // alternates with a gold pulse via .game-seat.active.is-leader.
    document.querySelectorAll('.game-seat').forEach(function (seatEl) {
      var pid = seatEl.dataset.player;
      if (leaderId !== null && pid !== undefined && Number(pid) === leaderId) {
        seatEl.classList.add('is-leader');
      } else {
        seatEl.classList.remove('is-leader');
      }
    });
  }

  function updatePlayerStatus(playerId, status) {
    var el = document.querySelector('[data-status="' + playerId + '"]');
    if (!el) return;

    el.className = 'game-seat-status';
    el.style.visibility = 'visible';
    if (status === 'stayed') {
      el.classList.add('stayed');
      el.textContent = 'Stay';
    } else if (status === 'busted') {
      el.classList.add('busted');
      el.textContent = 'Bust';
    } else if (status === 'winner') {
      el.classList.add('winner');
      el.textContent = 'Winner';
    } else {
      el.textContent = '\u00a0';
      el.style.visibility = 'hidden';
    }
  }

  function updateDeckCount() {
    var count = Game.getDeckCount();
    document.getElementById('hud-deck').textContent = count;
  }

  function updateHUD() {
    document.getElementById('hud-round').textContent = Game.getRoundNumber();
    updateDeckCount();
    // Room-code row — visible whenever we're in an online session.
    var roomRow = document.getElementById('hud-room-row');
    var roomCodeEl = document.getElementById('hud-room-code');
    if (roomRow && roomCodeEl) {
      if (Online.isActive()) {
        var code = (Online.getLobbyState && Online.getLobbyState().roomCode) || '---';
        roomCodeEl.textContent = code;
        roomRow.style.display = '';
      } else {
        roomRow.style.display = 'none';
      }
    }
    // v109: Change Host button — host-only, online-only. Updated
    // here so it tracks live across migrations (a guest who got
    // promoted picks up the button without a manual refresh).
    var changeHostBtn = document.getElementById('btn-change-host');
    if (changeHostBtn) {
      changeHostBtn.style.display = (Online.isActive() && Online.isHost()) ? '' : 'none';
    }
  }

  function setMessage(msg) {
    document.getElementById('hud-message').textContent = msg;
  }

  function showActionBar(visible, disableStay) {
    var container = document.getElementById('game-actions');
    if (!visible) {
      container.style.display = 'none';
    } else {
      container.style.display = 'flex';
      var stayBtn = document.getElementById('btn-stay');
      stayBtn.disabled = !!disableStay;
    }
    // Mirror visible/disabled state onto the mobile-portrait action
    // bar buttons. The on-table bar is auto-hidden on mobile portrait
    // via CSS when body has .mbar-active.
    updateMobileActionBar(visible, disableStay);
  }

  // Detect mobile portrait — narrow phones in portrait only.
  function isMobilePortrait() {
    return window.matchMedia('(orientation: portrait) and (max-width: 480px)').matches;
  }

  // Detect any landscape viewport (phone, tablet, desktop). v109
  // shows the leader/active-player side panels in landscape across
  // every device class — there's plenty of horizontal space on
  // either side of the centered card table.
  function isLandscapeView() {
    return window.matchMedia('(orientation: landscape)').matches;
  }

  // Track the latest "is it my turn" state so updatePlayerTotal can
  // re-render the bar without changing visibility.
  var _mbarTurnActive = false;

  // Rebuild the mobile portrait display panel.
  //   * Leader card — visible whenever (gamePhase === 'playing' AND
  //     viewport is mobile portrait), regardless of whose turn it is.
  //   * Turn card + Draw/Stay buttons — only visible when ALSO this
  //     device's player is on turn (showActionBar(true)).
  // `visible` / `disableStay` come from showActionBar and set the
  // turn-section visibility. A subsequent updatePlayerTotal() call
  // (visible === undefined) just refreshes leader / score info
  // without touching the turn-section gate.
  function updateMobileActionBar(visible, disableStay) {
    var bar = document.getElementById('mobile-action-bar');
    if (!bar) return;
    if (visible !== undefined) _mbarTurnActive = !!visible;
    var phaseOk = (gamePhase === 'playing');
    var portrait = isMobilePortrait();
    var landscape = isLandscapeView();
    var portraitShow = phaseOk && portrait;
    var landscapeShow = phaseOk && landscape;
    var shouldShow = portraitShow || landscapeShow;
    document.body.classList.toggle('mbar-active', portraitShow);
    document.body.classList.toggle('lbar-active', landscapeShow);
    // v112: mbar-turn-active is now toggled regardless of orientation
    // (was previously gated on portraitShow only, which meant the
    // landscape turn-section never received the class and stayed
    // hidden — bug from v111). The CSS rules already gate the
    // turn-section on (mbar-active OR lbar-active) AND mbar-turn-
    // active, so this single toggle covers both.
    document.body.classList.toggle('mbar-turn-active', shouldShow && _mbarTurnActive);
    // Section visibility is handled by body.{mbar,lbar}-active /
    // body.mbar-turn-active CSS rules. Bail early when not visible
    // to avoid unnecessary fillMbarPlayer work.
    if (!shouldShow) return;

    var gs = Game.getState && Game.getState();
    if (!gs || !gs.players || !gs.players.length) return;

    // Always-visible: current leader (same tiebreaker chain as
    // updateLeaderGlow).
    var leader = findCurrentLeader();
    fillMbarPlayer(document.getElementById('mbar-leader'), leader);

    // Turn section: current active player + (in mobile portrait)
    // Draw/Stay buttons. v111 — gate the section on the local-turn
    // flag for ALL device classes (was previously only mobile
    // portrait; landscape used to show it always). The user wants
    // the active-player display to appear ONLY on the device
    // controlling that character, matching the mbar-turn-active
    // CSS gate that already exists for both portrait + landscape.
    if (_mbarTurnActive) {
      var current = (typeof Game.getCurrentPlayer === 'function') ? Game.getCurrentPlayer() : null;
      fillMbarPlayer(document.getElementById('mbar-current'), current);
      var drawBtn = document.getElementById('mbar-btn-draw');
      var stayBtn = document.getElementById('mbar-btn-stay');
      if (drawBtn) drawBtn.disabled = false;
      if (stayBtn) stayBtn.disabled = !!disableStay;
    }
  }

  function findCurrentLeader() {
    var state = Game.getState && Game.getState();
    if (!state || !state.players || !state.hands) return null;
    var candidates = [];
    for (var i = 0; i < state.players.length; i++) {
      var p = state.players[i];
      var h = state.hands[p.id];
      if (!h || h.busted) continue;
      var t = CardSystem.handTotal(h.cards);
      if (t <= 0) continue;
      candidates.push({
        player: p,
        total: t,
        cards: h.cards.length,
        lastDrawOrder: h.lastDrawOrder !== undefined ? h.lastDrawOrder : -1,
        turnPos: state.turnOrder.indexOf(p.id)
      });
    }
    candidates.sort(function (a, b) {
      if (b.total !== a.total) return b.total - a.total;
      if (b.cards !== a.cards) return b.cards - a.cards;
      if (b.lastDrawOrder !== a.lastDrawOrder) return b.lastDrawOrder - a.lastDrawOrder;
      return a.turnPos - b.turnPos;
    });
    return candidates.length ? candidates[0].player : null;
  }

  function fillMbarPlayer(container, player) {
    if (!container) return;
    // v102 layout — top row uses 1fr-auto-1fr grid so the score is
    // exactly centered above the avatar. Dealer chip goes in the
    // LEFT badges slot, stay/bust pill goes in the RIGHT slot —
    // mirroring .game-seat-top-row, where dealer-chip justify-end
    // (left of score) and status pill justify-start (right of score).
    // v109 also populates an optional .mbar-cards element for the
    // active-player section (cards stack to the LEFT of the avatar).
    var avatarEl   = container.querySelector('.mbar-avatar');
    var cardsEl    = container.querySelector('.mbar-cards');
    var badgesLeft = container.querySelector('.mbar-top .mbar-badges-left');
    var badgesRight= container.querySelector('.mbar-top .mbar-badges-right');
    var scoreEl    = container.querySelector('.mbar-top .mbar-score');
    var nameEl     = container.querySelector('.mbar-name');
    if (!player) {
      if (avatarEl) avatarEl.innerHTML = '';
      if (cardsEl) cardsEl.innerHTML = '';
      if (badgesLeft) badgesLeft.innerHTML = '';
      if (badgesRight) badgesRight.innerHTML = '';
      if (scoreEl) scoreEl.textContent = '';
      if (nameEl) nameEl.textContent = '';
      return;
    }
    avatarEl.innerHTML = '';
    var img = SpriteEngine.createSpriteImg(player.animal);
    img.style.width = '100%'; img.style.height = '100%';
    avatarEl.appendChild(img);
    nameEl.textContent = player.name;
    var hand = (typeof Game.getHand === 'function') ? Game.getHand(player.id) : null;
    var total = (hand && hand.cards) ? CardSystem.handTotal(hand.cards) : '';
    scoreEl.textContent = total || '';
    badgesLeft.innerHTML = '';
    badgesRight.innerHTML = '';
    if (player.isDealer) {
      var d = document.createElement('span');
      d.className = 'mbar-badge dealer'; d.textContent = 'D';
      badgesLeft.appendChild(d);
    }
    if (hand && hand.busted) {
      var b = document.createElement('span');
      b.className = 'mbar-badge bust'; b.textContent = 'Bust';
      badgesRight.appendChild(b);
    } else if (hand && hand.stayed) {
      var s = document.createElement('span');
      s.className = 'mbar-badge stay'; s.textContent = 'Stay';
      badgesRight.appendChild(s);
    }
    // v109: render the player's cards next to the avatar in the
    // active-player section. Only the .mbar-current container has
    // a .mbar-cards element; the leader card omits it so the
    // leader-section stays compact at the top of the screen.
    if (cardsEl) {
      cardsEl.innerHTML = '';
      var cards = (hand && hand.cards) ? hand.cards : [];
      for (var ci = 0; ci < cards.length; ci++) {
        var c = cards[ci];
        var ce = document.createElement('div');
        ce.className = 'mbar-card suit-' + c.color;
        var rankSpan = document.createElement('span');
        rankSpan.className = 'mbar-card-rank';
        rankSpan.textContent = c.rank;
        var suitSpan = document.createElement('span');
        suitSpan.className = 'mbar-card-suit';
        suitSpan.textContent = suitSymbol(c.suit);
        ce.appendChild(rankSpan);
        ce.appendChild(suitSpan);
        cardsEl.appendChild(ce);
      }
    }
  }

  // Tiny helper for suit -> unicode symbol. Mirrors CardSystem's
  // internal mapping but is safe to call without depending on
  // module internals.
  function suitSymbol(suit) {
    if (suit === 'hearts')   return '♥';
    if (suit === 'diamonds') return '♦';
    if (suit === 'clubs')    return '♣';
    if (suit === 'spades')   return '♠';
    return '';
  }

  // Wire mobile bar's Draw / Stay once at init to the same handlers.
  (function wireMobileBar() {
    var d = document.getElementById('mbar-btn-draw');
    var s = document.getElementById('mbar-btn-stay');
    if (d) d.addEventListener('click', function () {
      if (!gameFlowLocked) humanAction('draw');
    });
    if (s) s.addEventListener('click', function () {
      if (!gameFlowLocked) humanAction('stay');
    });
    // Refresh the bar when the viewport changes orientation.
    window.addEventListener('resize', function () {
      if (gamePhase === 'playing') updateMobileActionBar();
    });
  })();

  // ================================================================
  //  RESULTS
  // ================================================================

  // If any player's card row is wider than the space the grid gives it
  // (typically when someone has drawn many cards and/or names are long),
  // shrink ALL mini-cards proportionally via a CSS custom property so
  // every row still aligns to the same column edges.
  function fitResultCards(handsDiv) {
    if (!handsDiv) return;
    handsDiv.style.setProperty('--card-scale', 1);
    var rows = handsDiv.querySelectorAll('.result-hand-cards');
    if (!rows.length) return;
    var worstOverflow = 1;
    rows.forEach(function (row) {
      var avail = row.clientWidth;
      var actual = row.scrollWidth;
      if (avail > 0 && actual > avail) {
        worstOverflow = Math.max(worstOverflow, actual / avail);
      }
    });
    if (worstOverflow > 1) {
      // Shrink a bit beyond what's needed so there's a hair of breathing room
      handsDiv.style.setProperty('--card-scale', 1 / worstOverflow * 0.95);
    }
  }

  function showResults(winnerResult, results) {
    var winnerDiv = document.getElementById('results-winner');
    var handsDiv = document.getElementById('results-hands');
    var scoreDiv = document.getElementById('results-scoreboard');

    // Winner display
    if (winnerResult) {
      var winner = Game.getPlayerById(winnerResult.winnerId);
      winnerDiv.innerHTML =
        '<div class="winner-avatar"><img src="' + SpriteEngine.getSprite(winner.animal) + '" alt="' + winner.name + '"></div>' +
        '<div class="winner-name">' + winner.name + ' Wins!</div>' +
        '<div class="winner-detail">' + winnerResult.total + ' points with ' + winnerResult.cardCount + ' cards' +
        (winnerResult.tiebreaker ? '<br>' + winnerResult.tiebreaker : '') + '</div>';
      Animations.launchConfetti();
    } else {
      winnerDiv.innerHTML = '<div class="all-busted-msg">Everyone Busted!</div>' +
        '<div class="winner-detail">No winner this round</div>';
    }

    // All hands — sorted by ranking, no position labels (just name + cards + total)
    handsDiv.innerHTML = '';

    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var handDiv = document.createElement('div');
      handDiv.className = 'result-hand';
      if (winnerResult && r.player.id === winnerResult.winnerId) handDiv.classList.add('winner-hand');
      if (r.busted) handDiv.classList.add('busted-hand');

      var nameHtml = '<div class="result-hand-name">' + r.player.name + '</div>';

      var cardsHtml = '<div class="result-hand-cards">';
      for (var c = 0; c < r.cards.length; c++) {
        var card = r.cards[c];
        cardsHtml += '<div class="result-mini-card suit-' + card.color + '">' +
          '<span>' + card.rank + '</span><span>' +
          card.symbol + '</span></div>';
      }
      cardsHtml += '</div>';

      var totalClass = r.busted ? 'busted' : (winnerResult && r.player.id === winnerResult.winnerId ? 'winner' : '');
      // "Bust" label goes to the LEFT of the number, both on the same line.
      var totalInner = r.busted
        ? '<span class="bust-label">Bust</span><span class="total-value">' + r.total + '</span>'
        : '<span class="total-value">' + r.total + '</span>';
      var totalHtml = '<div class="result-hand-total ' + totalClass + '">' + totalInner + '</div>';

      handDiv.innerHTML = nameHtml + cardsHtml + totalHtml;
      handsDiv.appendChild(handDiv);
    }

    // After the rows are in the DOM, if any card row overflows its column,
    // scale all mini-cards down proportionally so they fit and the grid
    // columns stay aligned.
    requestAnimationFrame(function () { fitResultCards(handsDiv); });

    // Scoreboard
    var scores = Game.getScores();
    var players = Game.getState().players;
    var lastWinRounds = Game.getLastWinRounds();
    var scoreRows = players.slice().sort(function (a, b) {
      var diff = (scores[b.id] || 0) - (scores[a.id] || 0);
      if (diff !== 0) return diff;
      // Tiebreaker: most recent round won
      return (lastWinRounds[b.id] || 0) - (lastWinRounds[a.id] || 0);
    });

    var maxScore = 0;
    for (var s = 0; s < scoreRows.length; s++) {
      if ((scores[scoreRows[s].id] || 0) > maxScore) maxScore = scores[scoreRows[s].id] || 0;
    }

    var tableHtml = '<div class="scoreboard-title">Scoreboard</div>' +
      '<table class="scoreboard-table"><thead><tr><th>Player</th><th>Wins</th></tr></thead><tbody>';
    for (var t = 0; t < scoreRows.length; t++) {
      var sc = scores[scoreRows[t].id] || 0;
      var leading = sc === maxScore && sc > 0 ? ' class="leading"' : '';
      tableHtml += '<tr' + leading + '><td>' + scoreRows[t].name + '</td><td>' + sc + '</td></tr>';
    }
    tableHtml += '</tbody></table>';
    scoreDiv.innerHTML = tableHtml;

    // Online mode: only host can play again; change "Main Menu" to "Leave Room"
    if (Online.isActive()) {
      Online.setGamePhase('results');
      document.getElementById('btn-play-again').style.display = Online.isHost() ? '' : 'none';
      document.getElementById('btn-new-game').textContent = 'Leave Room';
    } else {
      document.getElementById('btn-play-again').style.display = '';
      document.getElementById('btn-new-game').textContent = 'Main Menu';
    }

    showScreen('screen-results');
  }

  // ================================================================
  //  SAVE/LOAD
  // ================================================================

  function loadSavedGame() {
    var data = SaveSystem.loadGame();
    if (!data) return;

    Game.deserialize(data.gameState);
    var gs = Game.getState();

    // Switch to game screen in playing phase
    gamePhase = 'playing';
    showScreen('screen-game');
    document.getElementById('setup-header').style.display = 'none';
    document.getElementById('player-count-control').style.display = 'none';
    document.getElementById('btn-deal').style.display = 'none';
    document.getElementById('game-hud').style.display = '';
    document.getElementById('deck-info').style.display = '';
    showActionBar(false);

    renderGameTable().then(function () {
      updateHUD();

      // Populate hand display from game state (all face up for in-progress game)
      for (var i = 0; i < gs.players.length; i++) {
        var pid = gs.players[i].id;
        var hand = Game.getHand(pid);
        handDisplay[pid] = [];
        for (var c = 0; c < hand.cards.length; c++) {
          handDisplay[pid].push({ card: hand.cards[c], faceUp: true });
        }
        // Restore totals and statuses
        updatePlayerTotal(pid);
        if (hand.busted) updatePlayerStatus(pid, 'busted');
        else if (hand.stayed) updatePlayerStatus(pid, 'stayed');
      }

      if (gs.roundPhase === 'finished') {
        var winnerResult = Game.determineWinner();
        var results = Game.getResults();
        showResults(winnerResult, results);
      } else if (gs.roundPhase === 'playing') {
        gameFlowLocked = false;
        nextTurn();
      }
    });
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

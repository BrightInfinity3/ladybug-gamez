/* ============================================================
   Laser Stacks - UI Controller
   Screen management, rendering, event handling, game flow
   Trick-taking card game with bidding
   ============================================================ */

var UI = (function () {
  'use strict';

  // ---- Constants ----
  var NUM_TABLE_SEATS = 8;
  var ANIMAL_NICKNAMES = {
    bear: 'Bruno', cat: 'Shadow', owl: 'Hoot', penguin: 'Waddles',
    raccoon: 'Bandit', frog: 'Ribbit', dog: 'Buddy', panda: 'Bamboo',
    monkey: 'Coco', deer: 'Dasher', hedgehog: 'Spike', shark: 'Finn',
    octopus: 'Inky', hamster: 'Nibbles', parrot: 'Polly', turtle: 'Shelly'
  };

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

  // ---- Canvas State ----
  var canvasReady = false;
  var handDisplay = {};    // playerId -> [{card, faceUp}]
  var trickDisplay = [];   // [{playerId, card, seatIndex}] current trick cards on table
  var resizeListenerAdded = false;

  // ---- Responsive Helpers ----
  function getSetupAvatarSize() {
    var w = document.documentElement.clientWidth || window.innerWidth;
    if (w <= 480) return 72;
    if (w <= 768) return 88;
    return 112;
  }
  function getGameAvatarSize() {
    var w = document.documentElement.clientWidth || window.innerWidth;
    if (w <= 480) return 64;
    if (w <= 768) return 76;
    return 96;
  }

  function positionDealerChip(chipEl, chipSize, avatarSize) {
    var avatarR = avatarSize / 2;
    chipEl.style.left = 'calc(50% - ' + (avatarR + chipSize) + 'px)';
    chipEl.style.top = (avatarR - chipSize / 2) + 'px';
  }

  function positionRemoveCircle(circleEl, circleSize, avatarSize) {
    var avatarR = avatarSize / 2;
    circleEl.style.left = 'calc(50% + ' + avatarR + 'px)';
    circleEl.style.top = (avatarR - circleSize / 2) + 'px';
  }

  // ---- Initialize ----
  function init() {
    initSetupSeats();
    bindEvents();
    createFloatingSuits();
    // Apply saved suit-style preference before any rendering happens
    var savedStyle = SaveSystem.getSuitStyle();
    if (Renderer && Renderer.setSuitStyle) Renderer.setSuitStyle(savedStyle);
    applySuitStyleToDom(savedStyle);
    syncOptionsButtons(savedStyle);
    showScreen('screen-title');
  }

  function initSetupSeats() {
    setupSeats = [];
    for (var i = 0; i < NUM_TABLE_SEATS; i++) {
      setupSeats.push({
        occupied: false, animal: null, name: '', isHuman: false, isDealer: false
      });
    }
  }

  // ---- Suit style (Options) ----
  function applySuitStyle(style) {
    style = (style === 'laser') ? 'laser' : 'classic';
    SaveSystem.setSuitStyle(style);
    if (Renderer && Renderer.setSuitStyle) Renderer.setSuitStyle(style);
    if (Renderer && Renderer.rebuildCardTextures && canvasReady) Renderer.rebuildCardTextures();
    applySuitStyleToDom(style);
    syncOptionsButtons(style);
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

  function applySuitStyleToDom(style) {
    document.documentElement.setAttribute('data-suit-style', style);
    updateSuitStackLegend(style);
    updateRulesText(style);
  }

  function updateSuitStackLegend(style) {
    var items = document.querySelectorAll('#suit-stack .suit-stack-item');
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var suit = item.getAttribute('data-suit');
      var canvas = item.querySelector('canvas.suit-pip-canvas');
      if (style === 'laser' && typeof LaserPips !== 'undefined') {
        if (!canvas) {
          canvas = document.createElement('canvas');
          canvas.className = 'suit-pip-canvas';
          item.appendChild(canvas);
        }
        // Match container's pixel size so the pip is drawn at native resolution
        var rect = item.getBoundingClientRect();
        var px = Math.max(32, Math.round(rect.width || 64));
        var py = Math.max(32, Math.round(rect.height || 64));
        canvas.width = px;
        canvas.height = py;
        LaserPips.renderPipCanvas(canvas, suit);
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
    if (style === 'laser') return inlineLaserPipHtml(suit);
    var sym = { clubs: '&clubs;', spades: '&spades;', hearts: '&hearts;', diamonds: '&diams;' };
    return '<strong class="suit-' + suit + '">' + sym[suit] + '</strong>';
  }

  function suitName(suit, style, plural) {
    if (typeof LaserPips !== 'undefined') return LaserPips.getLabel(suit, style, plural);
    var p = { clubs: 'Clubs', spades: 'Spades', hearts: 'Hearts', diamonds: 'Diamonds' };
    var s = { clubs: 'Club', spades: 'Spade', hearts: 'Heart', diamonds: 'Diamond' };
    return (plural ? p : s)[suit];
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
      var diamondLead = (style === 'laser')
        ? inlineLaserPipHtml('diamonds') + ' <strong>Diode</strong>'
        : '<strong class="suit-diamonds">&diams; Diamond</strong>';
      leadingP.innerHTML = 'The leader must play a ' + diamondLead + ' if they have one.';
    }

    // Following-suit fallback line
    var followingP = document.querySelector('[data-rules-section="following"]');
    if (followingP) {
      var clubsLabel = suitName('clubs', style, true);
      var clubsVerb = (style === 'laser') ? 'are' : 'is';
      followingP.innerHTML = 'Otherwise, play a <strong>lower-ranked</strong> suit. If you can\'t, play the next higher suit. ' +
        clubsLabel + ' ' + clubsVerb + ' the last resort.';
    }

    // Winning-a-stack example line
    var winningP = document.querySelector('[data-rules-section="winning"]');
    if (winningP) {
      winningP.innerHTML = 'a 2' + suitToken('clubs', style) + ' beats a K' + suitToken('spades', style) +
        ', a 2' + suitToken('hearts', style) + ' beats a K' + suitToken('diamonds', style) + ', and so on.';
    }

    // Render any inline laser pip canvases that were just inserted
    if (style === 'laser' && typeof LaserPips !== 'undefined') {
      var inlines = document.querySelectorAll('canvas.inline-laser-pip[data-inline-pip]');
      for (var i = 0; i < inlines.length; i++) {
        LaserPips.renderPipCanvas(inlines[i], inlines[i].getAttribute('data-inline-pip'));
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
        showScreen('screen-options');
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

    // Player count buttons (hidden but kept for structure)
    document.getElementById('btn-fewer').addEventListener('click', function () {});
    document.getElementById('btn-more').addEventListener('click', function () {});

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
      if (currentBidValue < 9) {
        currentBidValue++;
        document.getElementById('bid-value').textContent = currentBidValue;
      }
    });
    document.getElementById('bid-confirm').addEventListener('click', function () {
      submitHumanBid();
    });

    // Menu button (in-game)
    document.getElementById('btn-menu').addEventListener('click', function () {
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
    document.getElementById('player-count-control').style.display = 'none'; // Always 4
    document.getElementById('btn-deal').style.display = '';
    document.getElementById('game-hud').style.display = 'none';
    document.getElementById('suit-stack').style.display = 'none';
    document.getElementById('trick-info').style.display = 'none';
    document.getElementById('hand-bar').style.display = 'none';

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

      if (!resizeListenerAdded) {
        window.addEventListener('resize', function () {
          if (canvasReady && document.getElementById('screen-game').classList.contains('active')) {
            Renderer.resize();
            if (gamePhase === 'setup') {
              renderSetupSeats();
            } else {
              positionGameOverlays();
            }
          }
        });
        resizeListenerAdded = true;
      }

      prepareSetupScreen();
    });
  }

  function prepareSetupScreen() {
    initSetupSeats();
    var title = document.getElementById('setup-title');
    title.textContent = 'Game Setup';

    playerCount = 4;
    autoFillSeats();
    renderSetupSeats();
    updateDealButton();
  }

  function getRandomAnimal() {
    var animals = SpriteEngine.getAnimalList();
    var usedAnimals = setupSeats.filter(function (s) { return s.occupied; }).map(function (s) { return s.animal; });
    var available = animals.filter(function (a) { return usedAnimals.indexOf(a) === -1; });
    if (available.length === 0) available = animals;
    return available[Math.floor(Math.random() * available.length)];
  }

  function getAnimalName(animalId) {
    return ANIMAL_NICKNAMES[animalId] || SpriteEngine.getAnimalName(animalId);
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
      positions = Renderer.getSeatOverlayPositions(NUM_TABLE_SEATS);
    } else {
      var table = ring.parentElement;
      var w = table.offsetWidth;
      var h = table.offsetHeight;
      positions = Animations.getSeatPositions(w, h, NUM_TABLE_SEATS);
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

    for (var i = 0; i < NUM_TABLE_SEATS; i++) {
      if (setupSeats[i].occupied) {
        var p = Game.createPlayer(
          id, i,
          setupSeats[i].animal,
          setupSeats[i].name,
          setupSeats[i].isHuman,
          false // no dealer
        );
        players.push(p);
        id++;
      }
    }

    Game.setupGame(players);
    beginNewRound();
  }

  function beginNewRound() {
    var roundData = Game.newRound();

    gamePhase = 'playing';
    showScreen('screen-game');
    document.getElementById('setup-header').style.display = 'none';
    document.getElementById('player-count-control').style.display = 'none';
    document.getElementById('btn-deal').style.display = 'none';
    document.getElementById('game-hud').style.display = '';
    document.getElementById('suit-stack').style.display = '';
    document.getElementById('trick-info').style.display = '';
    document.getElementById('hand-bar').style.display = 'none';

    // Re-render the legend now that the stack is laid out at its real size
    updateSuitStackLegend(SaveSystem.getSuitStyle());

    renderGameTable().then(function () {
      positionSuitStackAndTrickInfo();
      updateHUD();
      gameFlowLocked = true;
      setMessage('Dealing...');

      return Animations.delay(500);
    }).then(function () {
      return animateDealSequence(roundData.dealOrder);
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

      // Determine who leads: player with lowest card
      var lowest = Game.findLowestCardPlayer();
      Game.setFirstLeader(lowest.playerId);

      var leader = Game.getPlayerById(lowest.playerId);
      var verb = leader.isHuman ? ' have' : ' has';
      setMessage(leader.name + verb + ' the lowest card: ' + lowest.card.rank + lowest.card.symbol);

      return Animations.delay(1500);
    }).then(function () {
      // Show hand bar with cards visible so human can see before bidding
      document.getElementById('hand-bar').style.display = '';
      var gs2 = Game.getState();
      var humanCount = gs2.players.filter(function (p) { return p.isHuman; }).length;
      if (humanCount <= 1) {
        renderHandBar(); // Single human: show face-up
      }
      // Multi-human: processBidding() will handle per-player reveal

      setMessage('Bidding phase');
      return Animations.delay(500);
    }).then(function () {
      // Start bidding
      Game.startBidding();
      processBidding();
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
        gameFlowLocked = false;
        updateTrickInfo();
        nextTurn();
      });
    }

    highlightActivePlayer(bidder.id);

    if (bidder.isHuman) {
      // Multi-human: show reveal toggle so each player sees only their cards
      var humanCount = Game.getState().players.filter(function (p) { return p.isHuman; }).length;
      if (humanCount > 1) {
        showRevealToggle(bidder);
      } else {
        renderHandBar(bidder.id);
      }
      // Show bid overlay
      currentBidValue = 0;
      document.getElementById('bid-value').textContent = '0';
      document.getElementById('bid-overlay').style.display = 'flex';
      setMessage(humanCount > 1 ? bidder.name + ' — reveal cards to bid!' : 'Place your bid!');
    } else {
      // AI bids
      setMessage(bidder.name + ' is thinking...');
      gameFlowLocked = true;

      Animations.delay(600 + Math.random() * 400).then(function () {
        var bid = Game.aiBid(bidder.id);
        Game.setBid(bidder.id, bid);
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

    Game.setBid(bidder.id, currentBidValue);
    updateBidDisplay(bidder.id, currentBidValue);
    var humanCount = Game.getState().players.filter(function (p) { return p.isHuman; }).length;
    setMessage(humanCount > 1 ? bidder.name + ' bids ' + currentBidValue : 'You bid ' + currentBidValue);

    Animations.delay(400).then(function () {
      Game.advanceBid();
      processBidding();
    });
  }

  // ---- Deal Animation ----
  function animateDealSequence(dealOrder) {
    var promise = Promise.resolve();

    for (var i = 0; i < dealOrder.length; i++) {
      (function (playerId) {
        promise = promise.then(function () {
          var card = Game.dealCardTo(playerId);
          if (!card) return;

          var player = Game.getPlayerById(playerId);
          return animateCanvasDeal(card, playerId, player.seatIndex);
        });
      })(dealOrder[i]);
    }

    return promise;
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
        scale: 1.45
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
      var seatPositions = Renderer.getSeatPositions(NUM_TABLE_SEATS);
      var seatPos = seatPositions[seatIndex];
      var handPos = Renderer.getHandPosition(seatPos, tableCenter);

      // Trick card position (offset from center based on seat angle)
      var trickOffset = 45;
      var trickX = tableCenter.x + Math.cos(seatPos.angle) * trickOffset * 0.4;
      var trickY = tableCenter.y + Math.sin(seatPos.angle) * trickOffset * 0.4;

      var fc = Renderer.addFlyingCard({
        card: card,
        faceUp: false,
        flipProgress: 0,
        x: handPos.x,
        y: handPos.y,
        scale: 1.45
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

    // Last stack: auto-play all cards automatically
    if (Game.isLastTrick()) {
      autoPlayLastTrick(player);
      return;
    }

    if (player.isHuman) {
      // Multi-human: check if we need a reveal toggle
      var humanCount = Game.getState().players.filter(function (p) { return p.isHuman; }).length;
      if (humanCount > 1) {
        showRevealToggle(player);
      } else {
        setMessage('Your turn!');
        renderHandBar(player.id);
        enableHandBar(true);
      }
    } else {
      enableHandBar(false);
      hideRevealToggle();
      setMessage(player.name + ' is thinking...');
      gameFlowLocked = true;

      Animations.delay(600 + Math.random() * 600).then(function () {
        var cardIndex = Game.aiPlayCard(player.id);
        return executePlay(player.id, cardIndex);
      });
    }
  }

  // ---- Multi-human: reveal toggle ----
  var cardsRevealed = false;

  function showRevealToggle(player) {
    cardsRevealed = false;
    enableHandBar(false);
    setMessage(player.name + '\'s turn — reveal your cards!');

    var container = document.getElementById('hand-bar-cards');
    container.innerHTML = '';
    var btn = document.createElement('button');
    btn.className = 'btn btn-gold reveal-toggle-btn';
    btn.textContent = 'Reveal Cards';
    btn.addEventListener('click', function () {
      if (!cardsRevealed) {
        cardsRevealed = true;
        btn.textContent = 'Hide Cards';
        renderHandBar(player.id);
        enableHandBar(true);
        setMessage(player.name + '\'s turn!');
      } else {
        cardsRevealed = false;
        btn.textContent = 'Reveal Cards';
        showHiddenHandBar(player.id);
        enableHandBar(false);
      }
    });
    container.appendChild(btn);
  }

  function showHiddenHandBar(playerId) {
    var container = document.getElementById('hand-bar-cards');
    var hand = Game.getHand(playerId);
    if (!hand) return;

    // Keep the toggle button (first child), rebuild cards as face-down
    var existingBtn = container.querySelector('.reveal-toggle-btn');
    container.innerHTML = '';
    if (existingBtn) container.appendChild(existingBtn);

    for (var j = 0; j < hand.length; j++) {
      var cardEl = document.createElement('div');
      cardEl.className = 'hand-card card-hidden';
      cardEl.innerHTML = '<span class="hc-rank">L<br>S</span>';
      container.appendChild(cardEl);
    }
  }

  function hideRevealToggle() {
    cardsRevealed = false;
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

    var legalPlays = Game.getLegalPlays(player.id);
    if (legalPlays.indexOf(cardIndex) === -1) return;

    enableHandBar(false);
    gameFlowLocked = true;
    executePlay(player.id, cardIndex);
  }

  function executePlay(playerId, cardIndex) {
    var player = Game.getPlayerById(playerId);
    var card = Game.playCard(playerId, cardIndex);

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
      // Update hand bar if human
      if (player.isHuman) renderHandBar();

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

          // Highlight winner
          highlightActivePlayer(trickWinnerId);

          return Animations.delay(1200);
        }).then(function () {
          // Clear trick display
          trickDisplay = [];

          // Advance to next trick (pass the winner we already determined)
          Game.finishTrick(trickWinnerId);

          updateTrickInfo();
          updateAllTrickDisplays();

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
    if (!humanPlayer) return;

    var hand = Game.getHand(humanPlayer.id);
    if (!hand) return;

    var legalPlays = [];
    if (gs.roundPhase === 'playing' && Game.getCurrentPlayer() &&
        Game.getCurrentPlayer().id === humanPlayer.id) {
      legalPlays = Game.getLegalPlays(humanPlayer.id);
    }

    for (var j = 0; j < hand.length; j++) {
      var card = hand[j];
      var isLegal = legalPlays.indexOf(j) !== -1;

      var cardEl = document.createElement('div');
      cardEl.className = 'hand-card suit-' + card.color;
      if (isLegal) {
        cardEl.classList.add('legal');
      } else if (legalPlays.length > 0) {
        cardEl.classList.add('illegal');
      }

      cardEl.innerHTML = '<span class="hc-rank">' + card.rank + '</span>' +
                          '<span class="hc-suit">' + card.symbol + '</span>';

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

      if (!resizeListenerAdded) {
        window.addEventListener('resize', function () {
          if (canvasReady && document.getElementById('screen-game').classList.contains('active')) {
            Renderer.resize();
            if (gamePhase === 'setup') {
              renderSetupSeats();
            } else {
              positionGameOverlays();
            }
          }
        });
        resizeListenerAdded = true;
      }

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
        seat.className = 'game-seat';
        seat.dataset.player = p.id;
        seat.style.left = pos.x + 'px';
        seat.style.top = (pos.y - getGameAvatarSize() / 2) + 'px';

        var topRow = document.createElement('div');
        topRow.className = 'game-seat-top';

        var avatarWrap = document.createElement('div');
        avatarWrap.className = 'game-seat-avatar';
        avatarWrap.appendChild(SpriteEngine.createSpriteImg(p.animal));
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
    var seatPositions = Renderer.getSeatPositions(NUM_TABLE_SEATS);
    var cardScale = 1.2;
    var cardSpacing = 32;
    var CARDS_PER_ROW = 5;
    var ROW_INSET = 28;

    // Draw deck pile at table center (only during dealing)
    if (gs.roundPhase === 'dealing') {
      Renderer.drawDeck(tableCenter.x, tableCenter.y, Game.getDeckCount());
    }

    // Draw each player's hand cards on canvas (face down for all)
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

    // Draw trick cards in center
    for (var t = 0; t < trickDisplay.length; t++) {
      var td = trickDisplay[t];
      var tdSeatPos = seatPositions[td.seatIndex];
      var trickOffset = 55;
      var trickX = tableCenter.x + Math.cos(tdSeatPos.angle) * trickOffset * 0.4;
      var trickY = tableCenter.y + Math.sin(tdSeatPos.angle) * trickOffset * 0.4;
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
  }

  function positionSuitStackAndTrickInfo() {
    var tableCenter = Renderer.getTableCenter();
    var tableR = Renderer.getTableRadii().rx;

    // Vertical reference for the right-side trick counter (~25% from top of felt)
    var targetY = tableCenter.y - tableR * 0.5;

    // Suit hierarchy legend sits directly above the left player's avatar
    var suitStack = document.getElementById('suit-stack');
    if (suitStack) {
      var wasHidden = suitStack.style.display === 'none';
      if (wasHidden) suitStack.style.visibility = 'hidden';
      if (wasHidden) suitStack.style.display = '';
      var ssW = suitStack.offsetWidth || 60;
      var ssH = suitStack.offsetHeight || 180;
      if (wasHidden) suitStack.style.display = 'none';
      if (wasHidden) suitStack.style.visibility = '';

      // Left seat is index 2 of the 8-seat ring (4-player layout uses seats 0/2/4/6)
      var seatPositions = Renderer.getSeatOverlayPositions(NUM_TABLE_SEATS);
      var leftSeat = seatPositions[2];
      var avatarHalf = getGameAvatarSize() / 2;
      var breathingRoom = 18; // gap between legend bottom and avatar top
      var minTop = 8;         // minimum space from top of viewport

      suitStack.style.left = (leftSeat.x - ssW / 2) + 'px';
      suitStack.style.top = Math.max(minTop, leftSeat.y - avatarHalf - breathingRoom - ssH) + 'px';
    }

    // Stack counter on the right side, vertically centered with suit diagram middle
    var trickInfo = document.getElementById('trick-info');
    if (trickInfo) {
      var wasHidden2 = trickInfo.style.display === 'none';
      if (wasHidden2) trickInfo.style.visibility = 'hidden';
      if (wasHidden2) trickInfo.style.display = '';
      var tiW = trickInfo.offsetWidth || 80;
      var tiH = trickInfo.offsetHeight || 60;
      if (wasHidden2) trickInfo.style.display = 'none';
      if (wasHidden2) trickInfo.style.visibility = '';

      trickInfo.style.left = (tableCenter.x + tableR * 0.65 - tiW / 2) + 'px';
      trickInfo.style.top = (targetY - tiH / 2) + 'px';
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
  }

  function setMessage(msg) {
    document.getElementById('hud-message').textContent = msg;
  }

  // ================================================================
  //  RESULTS
  // ================================================================

  function showResults() {
    var winnerDiv = document.getElementById('results-winner');
    var handsDiv = document.getElementById('results-hands');
    var scoreDiv = document.getElementById('results-scoreboard');

    var bids = Game.getBids();
    var tricksWon = Game.getTricksWon();
    var roundScores = Game.getRoundScores();
    var scores = Game.getScores();
    var roundsWon = Game.getRoundsWon();
    var players = Game.getState().players;

    // Round winner (determined by game.js with tiebreaking)
    var roundWinnerId = Game.getLastRoundWinnerId();
    var bestRoundScore = roundWinnerId !== null ? (roundScores[roundWinnerId] || 0) : 0;

    // Winner display
    if (roundWinnerId !== null && bestRoundScore > 0) {
      var winner = Game.getPlayerById(roundWinnerId);
      winnerDiv.innerHTML =
        '<div class="winner-avatar"><img src="' + SpriteEngine.getSprite(winner.animal) + '" alt="' + winner.name + '"></div>' +
        '<div class="winner-name">' + (winner.isHuman ? winner.name + ' Win!' : winner.name + ' Wins!') + '</div>' +
        '<div class="winner-detail">' + bestRoundScore + ' points this round</div>';
      Animations.launchConfetti();
    } else {
      winnerDiv.innerHTML = '<div class="all-busted-msg">Rough Round!</div>' +
        '<div class="winner-detail">Nobody scored this round</div>';
    }

    // Player results
    handsDiv.innerHTML = '';

    // Sort by round score descending
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
      if (p.id === roundWinnerId && bestRoundScore > 0) handDiv.classList.add('winner-hand');

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

    // Scoreboard (cumulative) with rounds won column
    // Sort: total score desc, then rounds won desc, then last round winner
    var lastRoundWinnerId = Game.getLastRoundWinnerId();
    var scoreRows = players.slice().sort(function (a, b) {
      var sa = scores[a.id] || 0;
      var sb = scores[b.id] || 0;
      if (sb !== sa) return sb - sa;
      var rwa = roundsWon[a.id] || 0;
      var rwb = roundsWon[b.id] || 0;
      if (rwb !== rwa) return rwb - rwa;
      // Last round winner wins tie
      if (b.id === lastRoundWinnerId) return 1;
      if (a.id === lastRoundWinnerId) return -1;
      return 0;
    });

    var maxScore = 0;
    for (var s = 0; s < scoreRows.length; s++) {
      if ((scores[scoreRows[s].id] || 0) > maxScore) maxScore = scores[scoreRows[s].id] || 0;
    }

    var tableHtml = '<div class="scoreboard-title">Scoreboard</div>' +
      '<table class="scoreboard-table"><thead><tr><th>Player</th><th>Rounds</th><th>Total</th></tr></thead><tbody>';
    for (var t = 0; t < scoreRows.length; t++) {
      var sc = scores[scoreRows[t].id] || 0;
      var rw = roundsWon[scoreRows[t].id] || 0;
      var leading = sc === maxScore && sc > 0 ? ' class="leading"' : '';
      tableHtml += '<tr' + leading + '><td>' + scoreRows[t].name + '</td><td>' + rw + '</td><td>' + sc + '</td></tr>';
    }
    tableHtml += '</tbody></table>';
    scoreDiv.innerHTML = tableHtml;

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

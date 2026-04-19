/* ============================================================
   30 - Animation System
   Card dealing, drawing, flipping, bust, win celebrations
   ============================================================ */

var Animations = (function () {
  'use strict';

  var TIMING = {
    DEAL_INTERVAL: 120,
    DEAL_FLIGHT: 400,
    FLIP_DELAY: 300,
    FLIP_DURATION: 500,
    DRAW_FLIGHT: 400,
    AI_THINK: 800,
    PASS_FADE: 300,
    BUST_SHAKE: 400,
    RESULTS_DELAY: 1000,
    MESSAGE_DURATION: 1500
  };

  // ---- Utility: get element center position ----
  function getCenter(el) {
    var rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  // ---- Utility: promise-based delay ----
  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // ---- Deal Animation ----
  // Animates a card flying from the deck to a target position
  function animateDealCard(card, deckEl, targetEl, faceUp) {
    return new Promise(function (resolve) {
      var deckPos = getCenter(deckEl);
      var targetPos = getCenter(targetEl);

      // Create flying card element
      var cardEl = CardSystem.createCardEl(card, false);
      cardEl.classList.add('card-flying');
      cardEl.style.position = 'fixed';
      cardEl.style.left = (deckPos.x - 30) + 'px';
      cardEl.style.top = (deckPos.y - 42) + 'px';
      cardEl.style.zIndex = '100';
      cardEl.style.transition = 'none';
      document.body.appendChild(cardEl);

      // Force reflow
      cardEl.offsetHeight;

      // Animate to target
      cardEl.style.transition = 'all ' + TIMING.DEAL_FLIGHT + 'ms cubic-bezier(0.25, 0.8, 0.25, 1)';
      cardEl.style.left = (targetPos.x - 30) + 'px';
      cardEl.style.top = (targetPos.y - 42) + 'px';

      setTimeout(function () {
        // Remove flying card
        if (cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
        resolve();
      }, TIMING.DEAL_FLIGHT);
    });
  }

  // ---- Draw Card Animation ----
  function animateDrawCard(card, deckEl, targetEl) {
    return new Promise(function (resolve) {
      var deckPos = getCenter(deckEl);
      var targetPos = getCenter(targetEl);

      var cardEl = CardSystem.createCardEl(card, false);
      cardEl.classList.add('card-flying');
      cardEl.style.position = 'fixed';
      cardEl.style.left = (deckPos.x - 30) + 'px';
      cardEl.style.top = (deckPos.y - 42) + 'px';
      cardEl.style.zIndex = '100';
      cardEl.style.transition = 'none';
      document.body.appendChild(cardEl);

      cardEl.offsetHeight;

      // Fly and flip simultaneously
      cardEl.style.transition = 'all ' + TIMING.DRAW_FLIGHT + 'ms cubic-bezier(0.25, 0.8, 0.25, 1)';
      cardEl.style.left = (targetPos.x - 30) + 'px';
      cardEl.style.top = (targetPos.y - 42) + 'px';

      // Flip partway through
      setTimeout(function () {
        cardEl.classList.add('flipped');
      }, TIMING.DRAW_FLIGHT * 0.3);

      setTimeout(function () {
        if (cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
        resolve();
      }, TIMING.DRAW_FLIGHT);
    });
  }

  // ---- Flip All Cards ----
  function flipAllCards(containerSelector) {
    var cards = document.querySelectorAll(containerSelector + ' .card:not(.flipped)');
    var promises = [];
    for (var i = 0; i < cards.length; i++) {
      (function (card, index) {
        promises.push(new Promise(function (resolve) {
          setTimeout(function () {
            card.classList.add('flipped');
            setTimeout(resolve, TIMING.FLIP_DURATION);
          }, index * 50); // stagger slightly
        }));
      })(cards[i], i);
    }
    return Promise.all(promises);
  }

  // ---- Bust Animation ----
  function animateBust(seatEl) {
    if (seatEl) {
      seatEl.classList.add('bust-shake');
      setTimeout(function () {
        seatEl.classList.remove('bust-shake');
      }, TIMING.BUST_SHAKE);
    }
  }

  // ---- Confetti ----
  function launchConfetti() {
    var container = document.getElementById('confetti-container');
    if (!container) return;
    container.innerHTML = '';

    var colors = ['#ffd700', '#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#ff9ff3', '#54a0ff'];
    var count = 60;

    for (var i = 0; i < count; i++) {
      var piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + '%';
      piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDelay = (Math.random() * 2) + 's';
      piece.style.animationDuration = (2 + Math.random() * 2) + 's';

      // Random shapes
      if (Math.random() > 0.5) {
        piece.style.borderRadius = '50%';
      } else {
        piece.style.width = (4 + Math.random() * 8) + 'px';
        piece.style.height = (4 + Math.random() * 8) + 'px';
      }

      container.appendChild(piece);
    }

    // Clean up after animation
    setTimeout(function () {
      container.innerHTML = '';
    }, 5000);
  }

  // ---- Seat Positions ----
  // Calculate 8 seat positions around an ellipse
  function getSeatPositions(containerWidth, containerHeight, numSeats) {
    var positions = [];
    var cx = containerWidth / 2;
    var cy = containerHeight / 2;
    // Circular: use the smaller dimension
    var r = Math.min(containerWidth, containerHeight) * 0.44;

    for (var i = 0; i < numSeats; i++) {
      // Start from bottom (PI/2) and go clockwise
      var angle = (Math.PI / 2) + (i * 2 * Math.PI / numSeats);
      positions.push({
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        angle: angle
      });
    }
    return positions;
  }

  // ---- Hand Position Offsets ----
  // Returns position for cards relative to a seat
  function getHandOffset(seatAngle, cardIndex, totalCards) {
    // Cards fan out perpendicular to the seat angle
    var spread = Math.min(totalCards * 18, 80);
    var startX = -(spread / 2);
    var offsetX = startX + cardIndex * (spread / Math.max(totalCards - 1, 1));
    if (totalCards === 1) offsetX = 0;

    // Cards go toward center of table from the seat
    var towardCenter = -60;
    var dx = Math.cos(seatAngle) * towardCenter + Math.cos(seatAngle + Math.PI / 2) * offsetX;
    var dy = Math.sin(seatAngle) * towardCenter + Math.sin(seatAngle + Math.PI / 2) * offsetX;

    return { x: dx, y: dy };
  }

  return {
    TIMING: TIMING,
    delay: delay,
    getCenter: getCenter,
    animateDealCard: animateDealCard,
    animateDrawCard: animateDrawCard,
    flipAllCards: flipAllCards,
    animateBust: animateBust,
    launchConfetti: launchConfetti,
    getSeatPositions: getSeatPositions,
    getHandOffset: getHandOffset
  };
})();

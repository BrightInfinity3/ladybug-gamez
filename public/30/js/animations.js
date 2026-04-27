/* ============================================================
   30 - Animation System
   Bust shake, confetti, seat-position math, promise-based delays.
   (Card deal/draw/flip animations live in renderer.js — they're
   drawn directly on the PixiJS canvas now. This module only owns
   the side-effects that still rely on DOM/CSS classes.)
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

  // ---- Bust Animation ----
  function animateBust(seatEl) {
    if (!seatEl) return;
    seatEl.classList.add('bust-shake');
    setTimeout(function () {
      seatEl.classList.remove('bust-shake');
    }, TIMING.BUST_SHAKE);
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
  // Calculate 8 seat positions around a circle. Used by some legacy DOM
  // measurements; the canvas renderer has its own seat math.
  function getSeatPositions(containerWidth, containerHeight, numSeats) {
    var positions = [];
    var cx = containerWidth / 2;
    var cy = containerHeight / 2;
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

  return {
    TIMING: TIMING,
    delay: delay,
    getCenter: getCenter,
    animateBust: animateBust,
    launchConfetti: launchConfetti,
    getSeatPositions: getSeatPositions
  };
})();

/* ============================================================
   Solitairra - Animation System
   Card movement, confetti, timing helpers
   ============================================================ */

var Animations = (function () {
  'use strict';

  var TIMING = {
    DEAL_INTERVAL: 60,
    DEAL_FLIGHT: 300,
    CARD_MOVE: 250,
    FLIP_DURATION: 300,
    RESULTS_DELAY: 800
  };

  // ---- Utility: promise-based delay ----
  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
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

      if (Math.random() > 0.5) {
        piece.style.borderRadius = '50%';
      } else {
        piece.style.width = (4 + Math.random() * 8) + 'px';
        piece.style.height = (4 + Math.random() * 8) + 'px';
      }

      container.appendChild(piece);
    }

    setTimeout(function () {
      container.innerHTML = '';
    }, 5000);
  }

  return {
    TIMING: TIMING,
    delay: delay,
    launchConfetti: launchConfetti
  };
})();

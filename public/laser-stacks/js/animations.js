/* ============================================================
   Laser Stacks - Animation Helpers
   Timing utilities (card flight animations live in ui.js via
   Renderer.addFlyingCard; confetti retired with the round-winner
   banner in the 2026-07 round-2 refinements)
   ============================================================ */

var Animations = (function () {
  'use strict';

  // ---- Utility: promise-based delay ----
  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  return {
    delay: delay
  };
})();

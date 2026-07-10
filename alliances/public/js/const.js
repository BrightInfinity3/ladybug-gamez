/*
 * Shared client constants — the single source of truth for faction colors, alliance
 * metals, and battle pacing. Loaded FIRST (before every other js module).
 * Seat-indexed: seat 0 = Crimson, seat 1 = Azure, ...
 */
(function () {
  "use strict";

  var CONST = {
    COLORS: ["#ff4655", "#2e9bff", "#ffb020", "#3ddc84", "#a86bff", "#ff6ec7"],
    COLOR_NAMES: ["Crimson", "Azure", "Amber", "Emerald", "Violet", "Rose"],

    // Alliances are assigned metals in formation order (max 3 alliances with 6 players).
    METALS: [
      { id: "gold",   color: "#f5c84c", sigil: "◆" }, // ◆
      { id: "silver", color: "#c9d6e8", sigil: "▲" }, // ▲
      { id: "bronze", color: "#d08a4e", sigil: "●" }  // ●
    ],

    // Battle pacing: multiplier on the cinematic timeline (instant = skip to verdict).
    SPEEDS: { cinematic: 1, brisk: 0.4, instant: 0 },

    WS_PATH: "/ws",
    MAX_NAME_LEN: 20,
    MAX_ALLIANCE_NAME_LEN: 24
  };

  if (typeof window !== "undefined") window.AlliancesConst = CONST;
  if (typeof module !== "undefined" && module.exports) module.exports = CONST;
})();

/*
 * Hexfield — 60 identical hexagons.
 * Centered-hexagon board of radius 4 (61 cells) minus the center cell ("the Eye") = exactly 60.
 * Generated at module load: pure deterministic math, nothing to hand-tune.
 * Pointy-top hexes, axial coordinates (q, r). Rows A–I top to bottom, numbered west to east;
 * E5 (the center) is skipped — the Eye is decor, not a territory.
 */
(function () {
  "use strict";

  var SIZE = 40;          // hex circumradius — every other measurement derives from this
  var OX = 350, OY = 320; // board center in viewBox coords
  var R = 4;              // board radius in hexes

  function center(q, r) {
    return {
      x: OX + SIZE * Math.sqrt(3) * (q + r / 2),
      y: OY + SIZE * 1.5 * r
    };
  }

  function hexPath(q, r, size) {
    var c = center(q, r);
    var pts = [];
    for (var k = 0; k < 6; k++) {
      var a = (Math.PI / 180) * (60 * k - 30); // pointy-top corners
      pts.push((c.x + size * Math.cos(a)).toFixed(1) + "," + (c.y + size * Math.sin(a)).toFixed(1));
    }
    return "M" + pts.join("L") + "Z";
  }

  function inBoard(q, r) {
    return Math.abs(q) <= R && Math.abs(r) <= R && Math.abs(q + r) <= R;
  }
  function isEye(q, r) { return q === 0 && r === 0; }

  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];

  // id scheme: row letter A–I from r=-4..4; number = position from row's west end,
  // counting the Eye's slot so the center row reads E1–E4, E6–E9 (E5 skipped — lore, not a bug).
  function idFor(q, r) {
    var letter = String.fromCharCode(65 + r + R);
    var qmin = Math.max(-R, -R - r);
    return letter + (q - qmin + 1);
  }

  var territories = [];
  for (var r = -R; r <= R; r++) {
    var qmin = Math.max(-R, -R - r), qmax = Math.min(R, R - r);
    for (var q = qmin; q <= qmax; q++) {
      if (isEye(q, r)) continue;
      var adj = [];
      for (var d = 0; d < DIRS.length; d++) {
        var nq = q + DIRS[d][0], nr = r + DIRS[d][1];
        if (inBoard(nq, nr) && !isEye(nq, nr)) adj.push(idFor(nq, nr));
      }
      var c = center(q, r);
      var ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
      territories.push({
        id: idFor(q, r),
        name: "Sector " + idFor(q, r),
        label: idFor(q, r),
        path: hexPath(q, r, SIZE),
        anchor: [Math.round(c.x * 10) / 10, Math.round(c.y * 10) / 10],
        leader: null,
        region: "ring" + ring,
        adjacent: adj
      });
    }
  }

  var MAP = {
    id: "hexfield",
    name: "Hexfield",
    description: "60 identical hexes around the silent Eye. Pure strategy.",
    viewBox: { x: 0, y: 0, w: 700, h: 640 },
    decor: [
      { type: "path", d: hexPath(0, 0, SIZE * 0.92), class: "the-eye" }
    ],
    links: [],
    territories: territories
  };

  if (typeof module !== "undefined" && module.exports) module.exports = MAP;
  if (typeof window !== "undefined") {
    window.ALLIANCES_MAPS = window.ALLIANCES_MAPS || {};
    window.ALLIANCES_MAPS[MAP.id] = MAP;
  }
})();

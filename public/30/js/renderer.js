/* ============================================================
   30 - PixiJS Renderer
   WebGL-accelerated rendering via PixiJS v8
   Card/table textures pre-rendered with Canvas 2D
   ============================================================ */

var Renderer = (function () {
  'use strict';

  // ---- PixiJS State ----
  var app = null;
  var W = 0, H = 0;
  var dpr = 1;
  var initPromise = null;

  // Scene containers
  var tableSprite = null;
  var particleContainer = null;
  var gameLayer = null;
  var flyingCardsLayer = null;

  // ---- Card dimensions ----
  var CARD_W = 70;
  var CARD_H = 100;
  var CARD_R = 7;
  var TEX_SCALE = 2; // pre-render textures at 2x for crisp display

  // ---- Colors ----
  var FELT_DARK = '#0a4420';
  var FELT_MID = '#147a3a';
  var FELT_LIGHT = '#1a9848';
  var WOOD_DARK = '#2a1206';
  var WOOD_MID = '#5c2e10';
  var WOOD_LIGHT = '#8b5a2b';
  var CARD_BG = '#f8f6f0';
  var CARD_BORDER = '#c8c4b8';
  var SUIT_RED = '#b71c1c';
  var SUIT_BLACK = '#1a1a1a';
  var BACK_DARK = '#0d1a3d';
  var BACK_LIGHT = '#1a2a5c';

  // ---- Suit symbols ----
  var SUIT_SYM = { hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663', spades: '\u2660' };
  var SUIT_COLORS = { hearts: SUIT_RED, diamonds: SUIT_RED, clubs: SUIT_BLACK, spades: SUIT_BLACK };

  // ---- Pip Layouts ----
  var PIP_LAYOUTS = {
    1:  [[0.5, 0.5, false]],
    2:  [[0.5, 0.2, false], [0.5, 0.8, true]],
    3:  [[0.5, 0.2, false], [0.5, 0.5, false], [0.5, 0.8, true]],
    4:  [[0.3, 0.2, false], [0.7, 0.2, false], [0.3, 0.8, true], [0.7, 0.8, true]],
    5:  [[0.3, 0.2, false], [0.7, 0.2, false], [0.5, 0.5, false], [0.3, 0.8, true], [0.7, 0.8, true]],
    6:  [[0.3, 0.2, false], [0.7, 0.2, false], [0.3, 0.5, false], [0.7, 0.5, false], [0.3, 0.8, true], [0.7, 0.8, true]],
    7:  [[0.3, 0.2, false], [0.7, 0.2, false], [0.3, 0.5, false], [0.7, 0.5, false], [0.5, 0.35, false], [0.3, 0.8, true], [0.7, 0.8, true]],
    8:  [[0.3, 0.2, false], [0.7, 0.2, false], [0.3, 0.5, false], [0.7, 0.5, false], [0.5, 0.35, false], [0.5, 0.65, true], [0.3, 0.8, true], [0.7, 0.8, true]],
    9:  [[0.3, 0.18, false], [0.7, 0.18, false], [0.3, 0.39, false], [0.7, 0.39, false], [0.5, 0.5, false], [0.3, 0.61, true], [0.7, 0.61, true], [0.3, 0.82, true], [0.7, 0.82, true]],
    10: [[0.3, 0.18, false], [0.7, 0.18, false], [0.5, 0.28, false], [0.3, 0.39, false], [0.7, 0.39, false], [0.3, 0.61, true], [0.7, 0.61, true], [0.5, 0.72, true], [0.3, 0.82, true], [0.7, 0.82, true]]
  };

  // ---- Textures ----
  var cardTextures = {};    // rank_suit -> PIXI.Texture
  var backTexture = null;
  var shadowTexture = null;
  var glowTexture = null;
  var particleTex = null;
  var particleTextures = [];

  // ---- Sprite pool (for per-frame card drawing in gameLayer) ----
  var spritePool = [];
  var poolIndex = 0;

  // ---- Flying cards ----
  var flyingCards = [];  // array of { obj, sprite, shadowSprite }

  // ---- Particles ----
  var particles = [];
  var PARTICLE_COUNT = 100;

  // ---- Deck count text ----
  var deckCountText = null;

  // ---- Render callback ----
  var gameRenderCallback = null;
  var tickerFn = null;

  // ================================================================
  //  CANVAS 2D HELPERS (for pre-rendering textures)
  // ================================================================

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.arcTo(x + w, y, x + w, y + r, r);
    c.lineTo(x + w, y + h - r);
    c.arcTo(x + w, y + h, x + w - r, y + h, r);
    c.lineTo(x + r, y + h);
    c.arcTo(x, y + h, x, y + h - r, r);
    c.lineTo(x, y + r);
    c.arcTo(x, y, x + r, y, r);
    c.closePath();
  }

  function drawEllipse(c, cx, cy, rx, ry) {
    c.beginPath();
    c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    c.closePath();
  }

  // ================================================================
  //  CARD FACE PRE-RENDERING (Canvas 2D -> offscreen canvas)
  // ================================================================

  function renderCardToImage(rank, suit) {
    var scale = TEX_SCALE;
    var cw = CARD_W * scale;
    var ch = CARD_H * scale;

    var off = document.createElement('canvas');
    off.width = cw;
    off.height = ch;
    var c = off.getContext('2d');
    c.scale(scale, scale);

    // Card shape with warm paper background
    roundRect(c, 0.5, 0.5, CARD_W - 1, CARD_H - 1, CARD_R);
    var bgGrad = c.createLinearGradient(0, 0, 0, CARD_H);
    bgGrad.addColorStop(0, '#fffef8');
    bgGrad.addColorStop(0.5, '#faf6ee');
    bgGrad.addColorStop(1, '#f2ece0');
    c.fillStyle = bgGrad;
    c.fill();

    // Linen paper texture overlay
    c.save();
    roundRect(c, 0.5, 0.5, CARD_W - 1, CARD_H - 1, CARD_R);
    c.clip();
    Textures.paperTexture(c, CARD_W, CARD_H);
    c.restore();

    // Gold double border
    Textures.drawGoldBorder(c, 1, 1, CARD_W - 2, CARD_H - 2, CARD_R, 0.8);

    // Corner flourishes
    var fs = 10;
    Textures.drawCornerFlourish(c, 5, 5, fs, 0);
    Textures.drawCornerFlourish(c, CARD_W - 5, 5, fs, Math.PI / 2);
    Textures.drawCornerFlourish(c, CARD_W - 5, CARD_H - 5, fs, Math.PI);
    Textures.drawCornerFlourish(c, 5, CARD_H - 5, fs, Math.PI * 1.5);

    var color = SUIT_COLORS[suit];
    var sym = SUIT_SYM[suit];

    // Corner rank font: Georgia for numeric ranks and J/K (Cinzel's "1"
    // reads as capital "I" and Cinzel's J has a long descender that hangs
    // oddly in a tight corner). Cinzel for A and Q only.
    var isNumeric = !isNaN(parseInt(rank));
    var cornerFont = (isNumeric || rank === 'J' || rank === 'K')
      ? 'bold 11px Georgia, serif'
      : 'bold 11px Cinzel, Georgia, serif';

    // Top-left rank + suit with subtle shadow
    c.save();
    c.font = cornerFont;
    c.textAlign = 'center';
    // Shadow
    c.fillStyle = 'rgba(0,0,0,0.1)';
    c.fillText(rank, 10.5, 16.5);
    // Main
    c.fillStyle = color;
    c.fillText(rank, 10, 16);
    c.font = '10px serif';
    c.fillStyle = 'rgba(0,0,0,0.1)';
    c.fillText(sym, 10.5, 27.5);
    c.fillStyle = color;
    c.fillText(sym, 10, 27);
    c.restore();

    // Bottom-right rank + suit (inverted)
    c.save();
    c.translate(CARD_W - 10, CARD_H - 8);
    c.rotate(Math.PI);
    c.font = cornerFont;
    c.textAlign = 'center';
    c.fillStyle = 'rgba(0,0,0,0.1)';
    c.fillText(rank, 0.5, 8.5);
    c.fillStyle = color;
    c.fillText(rank, 0, 8);
    c.font = '10px serif';
    c.fillStyle = 'rgba(0,0,0,0.1)';
    c.fillText(sym, 0.5, 19.5);
    c.fillStyle = color;
    c.fillText(sym, 0, 19);
    c.restore();

    // Center area for pips
    var area = { x: 14, y: 18, w: CARD_W - 28, h: CARD_H - 36 };
    var numericRank = parseInt(rank);

    if (!isNaN(numericRank) && PIP_LAYOUTS[numericRank]) {
      renderPips(c, area, suit, numericRank);
    } else {
      renderFaceCard(c, area, rank, suit);
    }

    return off;
  }

  function renderPips(c, area, suit, count) {
    var sym = SUIT_SYM[suit];
    var color = SUIT_COLORS[suit];
    var layout = PIP_LAYOUTS[count];
    if (!layout) return;

    var fontSize = count <= 3 ? 20 : 16;
    c.save();
    c.font = fontSize + 'px serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';

    for (var i = 0; i < layout.length; i++) {
      var px = area.x + layout[i][0] * area.w;
      var py = area.y + layout[i][1] * area.h;
      var flip = layout[i][2];

      c.save();
      c.translate(px, py);
      if (flip) c.rotate(Math.PI);

      // Micro shadow behind pip
      c.fillStyle = 'rgba(0,0,0,0.12)';
      c.fillText(sym, 0.6, 0.8);

      // Main pip with suit color
      c.fillStyle = color;
      c.fillText(sym, 0, 0);

      c.restore();
    }
    c.restore();
  }

  // Face-card renderer — 5-layer sandwich from Solitairra face-card-reference.md:
  //   frame → chess-piece watermark → letter shadow → gold-foil overlay →
  //   solid suit-colour letter → suit pip below → four corner flourishes.
  //
  // Font choices (critical): A/Q use Cinzel 900 for decorative Roman serifs,
  // J/K use Georgia 900. Cinzel's J has a long descender that hangs into the
  // suit pip below — Georgia's J sits cleanly on the baseline, so we never
  // use Cinzel for J or K.
  function renderFaceCard(c, area, rank, suit) {
    var sym   = SUIT_SYM[suit];
    var color = SUIT_COLORS[suit];
    var cx    = area.x + area.w / 2;
    var cy    = area.y + area.h / 2;

    // 1. Inner decorative frame (very faint gold rounded-rect stroke)
    c.save();
    var frameInset = 2;
    var frameR = 3;
    roundRect(c, area.x + frameInset, area.y + frameInset,
      area.w - frameInset * 2, area.h - frameInset * 2, frameR);
    c.strokeStyle = '#c9952a';
    c.globalAlpha = 0.2;
    c.lineWidth = 0.6;
    c.stroke();
    c.restore();

    // 2. Shared vertical alignment — Q gets +2 to compensate for its
    //    descender tail pulling the visual centre up.
    var rankCenterY = cy - 4;
    var qDescenderOffset = (rank === 'Q') ? 2 : 0;
    var rankY = rankCenterY + qDescenderOffset;

    // 3. Chess-piece watermark (very faint, behind the letter)
    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    var chessSym = rank === 'K' ? '\u265A'   // black king
                 : rank === 'Q' ? '\u265B'   // black queen
                 : rank === 'J' ? '\u2658'   // white knight (outline reads cleaner at small sizes)
                 :                '\u2726';  // four-pointed star for A
    c.font = 'bold 30px serif';
    c.fillStyle = color;
    c.globalAlpha = 0.08;
    c.fillText(chessSym, cx, rankY);
    c.globalAlpha = 1;
    c.restore();

    // 4. Three-pass gilded rank letter: shadow → gold-foil → solid suit colour.
    //    Font: Cinzel for A/Q (decorative), Georgia for J/K (clean, no long
    //    descender on J).
    var faceFont = (rank === 'A' || rank === 'Q')
      ? '900 28px Cinzel, Georgia, serif'
      : '900 28px Georgia, serif';
    c.save();
    c.font = faceFont;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    // Pass 1 — drop shadow
    c.fillStyle = 'rgba(0,0,0,0.15)';
    c.fillText(rank, cx + 1, rankY + 1);
    // Pass 2 — gold-foil sheen
    var goldGrad = Textures.goldFoilGradient(c, cx - 14, rankY - 14, 28, 28);
    c.fillStyle = goldGrad;
    c.globalAlpha = 0.3;
    c.fillText(rank, cx, rankY);
    c.globalAlpha = 1;
    // Pass 3 — solid suit colour
    c.fillStyle = color;
    c.fillText(rank, cx, rankY);
    c.restore();

    // 5. Suit pip below the letter — positioned 24px below rankCenterY so
    //    it lands at the same visual distance regardless of Q's offset.
    var suitPipY = rankCenterY + 24;
    c.save();
    c.font = '20px serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = 'rgba(0,0,0,0.1)';
    c.fillText(sym, cx + 0.5, suitPipY + 0.5);
    c.fillStyle = color;
    c.fillText(sym, cx, suitPipY);
    c.restore();

    // 6. Four corner flourishes (quarter-circle gold curls inside the frame)
    c.save();
    c.strokeStyle = '#c9952a';
    c.globalAlpha = 0.18;
    c.lineWidth = 0.8;
    // top-left
    c.beginPath();
    c.moveTo(area.x + 2, area.y + 12);
    c.quadraticCurveTo(area.x + 2, area.y + 2, area.x + 12, area.y + 2);
    c.stroke();
    // top-right
    c.beginPath();
    c.moveTo(area.x + area.w - 2, area.y + 12);
    c.quadraticCurveTo(area.x + area.w - 2, area.y + 2, area.x + area.w - 12, area.y + 2);
    c.stroke();
    // bottom-left
    c.beginPath();
    c.moveTo(area.x + 2, area.y + area.h - 12);
    c.quadraticCurveTo(area.x + 2, area.y + area.h - 2, area.x + 12, area.y + area.h - 2);
    c.stroke();
    // bottom-right
    c.beginPath();
    c.moveTo(area.x + area.w - 2, area.y + area.h - 12);
    c.quadraticCurveTo(area.x + area.w - 2, area.y + area.h - 2, area.x + area.w - 12, area.y + area.h - 2);
    c.stroke();
    c.restore();
  }

  // ================================================================
  //  CARD BACK PRE-RENDERING
  // ================================================================

  function renderCardBackToImage() {
    var scale = TEX_SCALE;
    var cw = CARD_W * scale;
    var ch = CARD_H * scale;

    var off = document.createElement('canvas');
    off.width = cw;
    off.height = ch;
    var c = off.getContext('2d');
    c.scale(scale, scale);

    // Card shape with rich gradient
    roundRect(c, 0.5, 0.5, CARD_W - 1, CARD_H - 1, CARD_R);
    var bgGrad = c.createRadialGradient(CARD_W / 2, CARD_H / 2, 5, CARD_W / 2, CARD_H / 2, CARD_W * 0.7);
    bgGrad.addColorStop(0, '#1e3a6e');
    bgGrad.addColorStop(0.5, BACK_LIGHT);
    bgGrad.addColorStop(1, BACK_DARK);
    c.fillStyle = bgGrad;
    c.fill();

    // Outer edge stroke
    c.strokeStyle = 'rgba(100, 140, 220, 0.3)';
    c.lineWidth = 0.8;
    c.stroke();

    // Gold double inner frame
    Textures.drawGoldBorder(c, 3, 3, CARD_W - 6, CARD_H - 6, CARD_R - 1, 0.6);

    // Interlocking geometric star pattern (replaces crosshatch)
    c.save();
    roundRect(c, 7, 7, CARD_W - 14, CARD_H - 14, CARD_R - 3);
    c.clip();

    var spacing = 10;
    var halfS = spacing / 2;
    for (var gx = 7; gx < CARD_W - 7; gx += spacing) {
      for (var gy = 7; gy < CARD_H - 7; gy += spacing) {
        // 4-pointed star
        c.fillStyle = 'rgba(180, 200, 255, 0.03)';
        c.beginPath();
        c.moveTo(gx + halfS, gy);
        c.lineTo(gx + halfS + 2, gy + halfS);
        c.lineTo(gx + halfS, gy + spacing);
        c.lineTo(gx + halfS - 2, gy + halfS);
        c.closePath();
        c.fill();

        // Rotated star overlay
        c.fillStyle = 'rgba(200, 220, 255, 0.02)';
        c.beginPath();
        c.moveTo(gx, gy + halfS);
        c.lineTo(gx + halfS, gy + halfS + 2);
        c.lineTo(gx + spacing, gy + halfS);
        c.lineTo(gx + halfS, gy + halfS - 2);
        c.closePath();
        c.fill();

        // Tiny center diamond
        c.fillStyle = 'rgba(255, 255, 255, 0.03)';
        c.beginPath();
        c.moveTo(gx + halfS, gy + halfS - 1.5);
        c.lineTo(gx + halfS + 1.5, gy + halfS);
        c.lineTo(gx + halfS, gy + halfS + 1.5);
        c.lineTo(gx + halfS - 1.5, gy + halfS);
        c.closePath();
        c.fill();
      }
    }

    // Fine connecting lines between stars
    c.strokeStyle = 'rgba(150, 180, 255, 0.04)';
    c.lineWidth = 0.3;
    for (var lx = 7 + halfS; lx < CARD_W - 7; lx += spacing) {
      c.beginPath();
      c.moveTo(lx, 7);
      c.lineTo(lx, CARD_H - 7);
      c.stroke();
    }
    for (var ly = 7 + halfS; ly < CARD_H - 7; ly += spacing) {
      c.beginPath();
      c.moveTo(7, ly);
      c.lineTo(CARD_W - 7, ly);
      c.stroke();
    }

    c.restore();

    // Corner suit symbols in gold
    var cornerSyms = ['\u2660', '\u2665', '\u2666', '\u2663'];
    var cornerPositions = [
      [11, 13], [CARD_W - 11, 13],
      [11, CARD_H - 9], [CARD_W - 11, CARD_H - 9]
    ];
    c.save();
    c.font = '7px serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#c9952a';
    c.globalAlpha = 0.35;
    for (var si = 0; si < 4; si++) {
      c.fillText(cornerSyms[si], cornerPositions[si][0], cornerPositions[si][1]);
    }
    c.restore();

    // Center "30" in gold with glow (doubled boldness).
    // v124: bumped 30% larger (18/19/20 → 23/25/26) so the centerpiece
    // reads more strongly on the deck stack.
    c.save();
    c.font = '900 23px Cinzel, Georgia, serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    var midX = CARD_W / 2;
    var midY = CARD_H / 2 - 1; // nudge up 1px for visual centering

    // Glow layers (multiple renders at decreasing alpha)
    c.fillStyle = '#d4a849';
    c.globalAlpha = 0.08;
    c.fillText('30', midX, midY);
    c.font = '900 25px Cinzel, Georgia, serif';
    c.globalAlpha = 0.06;
    c.fillText('30', midX, midY);
    c.font = '900 26px Cinzel, Georgia, serif';
    c.globalAlpha = 0.04;
    c.fillText('30', midX, midY);

    // Main gold "30"
    c.font = '900 23px Cinzel, Georgia, serif';
    var goldG = Textures.goldFoilGradient(c, midX - 16, midY - 13, 32, 26);
    c.fillStyle = goldG;
    c.globalAlpha = 0.50;
    c.fillText('30', midX, midY);
    c.restore();

    // Subtle vignette
    var vignette = c.createRadialGradient(CARD_W / 2, CARD_H / 2, 10, CARD_W / 2, CARD_H / 2, CARD_W * 0.7);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.25)');
    roundRect(c, 0.5, 0.5, CARD_W - 1, CARD_H - 1, CARD_R);
    c.fillStyle = vignette;
    c.fill();

    return off;
  }

  // ================================================================
  //  TABLE PRE-RENDERING
  // ================================================================

  function renderTableToCanvas() {
    var tableCanvas = document.createElement('canvas');
    tableCanvas.width = W * dpr;
    tableCanvas.height = H * dpr;
    var c = tableCanvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);

    var center = getTableCenter();
    var cx = center.x;
    var cy = center.y;
    var radii = getTableRadii();
    var rx = radii.rx;
    var ry = radii.ry;
    var wb = getWoodBorder();       // wood border thickness
    var innerEdge = 0.5 * getVmin(); // thin shadow ring just outside felt
    var filigree = 0.3 * getVmin();
    var highlight = wb * 0.92;

    // Dark background
    c.fillStyle = '#080c0a';
    c.fillRect(0, 0, W, H);

    // Outer ambient glow — extended to fill full canvas with rich warmth
    var maxR = Math.max(rx, ry);
    var ambientGlow = c.createRadialGradient(cx, cy, 0, cx, cy, maxR * 2.5);
    ambientGlow.addColorStop(0, 'rgba(30, 90, 45, 0.40)');
    ambientGlow.addColorStop(0.3, 'rgba(20, 70, 35, 0.25)');
    ambientGlow.addColorStop(0.55, 'rgba(15, 50, 25, 0.15)');
    ambientGlow.addColorStop(0.75, 'rgba(10, 30, 15, 0.08)');
    ambientGlow.addColorStop(1, 'rgba(5, 15, 8, 0)');
    c.fillStyle = ambientGlow;
    c.fillRect(0, 0, W, H);

    // Subtle corner warmth — gives the dark outer area a richer feel
    var cornerWarmth = c.createRadialGradient(cx, cy, maxR * 1.2, cx, cy, Math.max(W, H) * 0.8);
    cornerWarmth.addColorStop(0, 'rgba(0, 0, 0, 0)');
    cornerWarmth.addColorStop(0.5, 'rgba(12, 25, 15, 0.06)');
    cornerWarmth.addColorStop(1, 'rgba(8, 20, 12, 0.04)');
    c.fillStyle = cornerWarmth;
    c.fillRect(0, 0, W, H);

    // Wood border (outer ring)
    drawEllipse(c, cx, cy, rx + wb, ry + wb);
    var woodGrad = c.createRadialGradient(cx - rx * 0.3, cy - ry * 0.3, 0, cx, cy, Math.max(rx, ry) + wb * 1.25);
    woodGrad.addColorStop(0, WOOD_LIGHT);
    woodGrad.addColorStop(0.4, WOOD_MID);
    woodGrad.addColorStop(1, WOOD_DARK);
    c.fillStyle = woodGrad;
    c.fill();

    // Perlin noise wood grain (replaces random ellipses)
    c.save();
    drawEllipse(c, cx, cy, rx + wb, ry + wb);
    c.clip();
    Textures.woodGrainTexture(c, W, H, cx, cy);
    c.restore();

    // Inner wood edge (deeper shadow for dimension)
    drawEllipse(c, cx, cy, rx + innerEdge, ry + innerEdge);
    var edgeShadow = c.createRadialGradient(cx, cy, Math.max(rx, ry), cx, cy, Math.max(rx, ry) + innerEdge * 1.2);
    edgeShadow.addColorStop(0, WOOD_DARK);
    edgeShadow.addColorStop(1, 'rgba(15, 8, 2, 0.8)');
    c.fillStyle = edgeShadow;
    c.fill();

    // Gold filigree ring at felt/wood junction
    Textures.drawFiligree(c, cx, cy, rx + filigree, ry + filigree);

    // Felt surface
    drawEllipse(c, cx, cy, rx, ry);
    var feltGrad = c.createRadialGradient(cx - rx * 0.15, cy - ry * 0.25, 0, cx, cy, Math.max(rx, ry));
    feltGrad.addColorStop(0, FELT_LIGHT);
    feltGrad.addColorStop(0.5, FELT_MID);
    feltGrad.addColorStop(1, FELT_DARK);
    c.fillStyle = feltGrad;
    c.fill();

    // Perlin noise felt texture (replaces random dots)
    c.save();
    drawEllipse(c, cx, cy, rx, ry);
    c.clip();
    Textures.feltTexture(c, W, H);
    c.restore();

    // Primary spotlight (warm, from above-center)
    var spotGrad = c.createRadialGradient(cx, cy - ry * 0.15, 0, cx, cy, Math.max(rx, ry) * 0.65);
    spotGrad.addColorStop(0, 'rgba(255, 250, 220, 0.08)');
    spotGrad.addColorStop(0.5, 'rgba(255, 245, 200, 0.03)');
    spotGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    drawEllipse(c, cx, cy, rx, ry);
    c.save();
    c.clip();
    c.fillStyle = spotGrad;
    c.fillRect(0, 0, W, H);

    // Secondary off-center highlight for depth
    var spot2 = c.createRadialGradient(cx + rx * 0.2, cy - ry * 0.3, 0, cx + rx * 0.2, cy - ry * 0.3, Math.max(rx, ry) * 0.4);
    spot2.addColorStop(0, 'rgba(255, 240, 200, 0.04)');
    spot2.addColorStop(1, 'rgba(0, 0, 0, 0)');
    c.fillStyle = spot2;
    c.fillRect(0, 0, W, H);
    c.restore();

    // Inner shadow on felt edge (thicker for more depth)
    drawEllipse(c, cx, cy, rx, ry);
    c.save();
    c.clip();
    var innerShadow = c.createRadialGradient(cx, cy, Math.max(rx, ry) * 0.7, cx, cy, Math.max(rx, ry));
    innerShadow.addColorStop(0, 'rgba(0,0,0,0)');
    innerShadow.addColorStop(0.7, 'rgba(0,0,0,0.1)');
    innerShadow.addColorStop(1, 'rgba(0,0,0,0.4)');
    c.fillStyle = innerShadow;
    c.fillRect(0, 0, W, H);
    c.restore();

    // "30" watermark (gold-tinted, strong visibility)
    c.save();
    c.font = '900 ' + Math.round(rx * 0.13) + 'px Cinzel, Georgia, serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = 'rgba(200, 220, 180, 0.64)';
    c.fillText('30', cx, cy);
    c.restore();

    // Outer wood highlight (top edge reflection — warmer)
    c.save();
    drawEllipse(c, cx, cy, rx + highlight, ry + highlight);
    c.clip();
    var highlightGrad = c.createLinearGradient(cx, cy - ry - wb * 1.25, cx, cy - ry + wb * 0.5);
    highlightGrad.addColorStop(0, 'rgba(255,220,160,0.18)');
    highlightGrad.addColorStop(1, 'rgba(255,220,160,0)');
    c.fillStyle = highlightGrad;
    c.fillRect(cx - rx - wb * 1.25, cy - ry - wb * 1.25, (rx + wb * 1.25) * 2, wb * 2.3);
    c.restore();

    // Bottom edge subtle reflection
    c.save();
    drawEllipse(c, cx, cy, rx + highlight, ry + highlight);
    c.clip();
    var bottomHighlight = c.createLinearGradient(cx, cy + ry - innerEdge, cx, cy + ry + wb);
    bottomHighlight.addColorStop(0, 'rgba(255,200,140,0)');
    bottomHighlight.addColorStop(1, 'rgba(255,200,140,0.06)');
    c.fillStyle = bottomHighlight;
    c.fillRect(cx - rx - wb * 1.25, cy + ry - innerEdge, (rx + wb * 1.25) * 2, wb * 1.7);
    c.restore();

    return tableCanvas;
  }

  // ================================================================
  //  TEXTURE BUILDING (Canvas 2D -> PIXI.Texture)
  // ================================================================

  // Pre-rendered card canvases cache (can be built before PIXI init).
  // Populated either lazily inside buildCardTextures, or ahead of time by precacheCardCanvases.
  var _cardCanvasCache = {};
  var _backCanvasCache = null;

  function buildCardTextures() {
    var suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    var ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    for (var s = 0; s < suits.length; s++) {
      for (var r = 0; r < ranks.length; r++) {
        var key = ranks[r] + '_' + suits[s];
        var canvas = _cardCanvasCache[key] || renderCardToImage(ranks[r], suits[s]);
        _cardCanvasCache[key] = canvas;
        cardTextures[key] = PIXI.Texture.from(canvas);
      }
    }
    if (!_backCanvasCache) _backCanvasCache = renderCardBackToImage();
    backTexture = PIXI.Texture.from(_backCanvasCache);
  }

  // Render all card canvases in the background so buildCardTextures is fast.
  // Spreads work across frames using requestAnimationFrame to avoid blocking the UI.
  function precacheCardCanvases() {
    var suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    var ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    var tasks = [];
    for (var s = 0; s < suits.length; s++) {
      for (var r = 0; r < ranks.length; r++) {
        (function (rank, suit) {
          var key = rank + '_' + suit;
          tasks.push(function () {
            if (!_cardCanvasCache[key]) {
              _cardCanvasCache[key] = renderCardToImage(rank, suit);
            }
          });
        })(ranks[r], suits[s]);
      }
    }
    tasks.push(function () {
      if (!_backCanvasCache) _backCanvasCache = renderCardBackToImage();
    });

    // Process a couple of textures per frame until done
    function step() {
      var frameDeadline = performance.now() + 8; // cap work at ~8ms per frame
      while (tasks.length > 0 && performance.now() < frameDeadline) {
        tasks.shift()();
      }
      if (tasks.length > 0) {
        requestAnimationFrame(step);
      }
    }
    // Use idle callback if available, else kick off immediately
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(function () { requestAnimationFrame(step); });
    } else {
      requestAnimationFrame(step);
    }
  }

  function buildShadowTexture() {
    var pad = 16;
    var sw = (CARD_W + pad * 2) * TEX_SCALE;
    var sh = (CARD_H + pad * 2) * TEX_SCALE;
    var off = document.createElement('canvas');
    off.width = sw;
    off.height = sh;
    var c = off.getContext('2d');
    c.scale(TEX_SCALE, TEX_SCALE);

    // Draw blurred shadow shape
    c.shadowColor = 'rgba(0, 0, 0, 0.6)';
    c.shadowBlur = 8;
    c.shadowOffsetX = 0;
    c.shadowOffsetY = 0;
    c.fillStyle = 'rgba(0, 0, 0, 0.35)';
    roundRect(c, pad, pad, CARD_W, CARD_H, CARD_R);
    c.fill();

    shadowTexture = PIXI.Texture.from(off);
  }

  function buildGlowTexture() {
    var pad = 28;
    var sw = (CARD_W + pad * 2) * TEX_SCALE;
    var sh = (CARD_H + pad * 2) * TEX_SCALE;
    var off = document.createElement('canvas');
    off.width = sw;
    off.height = sh;
    var c = off.getContext('2d');
    c.scale(TEX_SCALE, TEX_SCALE);

    // Draw golden glow shape
    c.shadowColor = 'rgba(212, 160, 23, 1)';
    c.shadowBlur = 20;
    c.shadowOffsetX = 0;
    c.shadowOffsetY = 0;
    c.fillStyle = 'rgba(212, 160, 23, 0.6)';
    roundRect(c, pad, pad, CARD_W, CARD_H, CARD_R);
    c.fill();
    // Second pass for extra intensity
    c.shadowBlur = 12;
    c.fillStyle = 'rgba(255, 200, 50, 0.3)';
    roundRect(c, pad, pad, CARD_W, CARD_H, CARD_R);
    c.fill();

    glowTexture = PIXI.Texture.from(off);
  }

  function buildParticleTexture() {
    // Create multiple particle textures for color variety
    particleTextures = [];
    var colors = [
      [255, 240, 200], // warm gold (70%)
      [255, 240, 200],
      [255, 240, 200],
      [255, 240, 200],
      [255, 240, 200],
      [255, 240, 200],
      [255, 240, 200],
      [200, 240, 200], // pale green (20%)
      [200, 240, 200],
      [255, 255, 255]  // white sparkle (10%)
    ];
    for (var ci = 0; ci < colors.length; ci++) {
      var size = 8;
      var off = document.createElement('canvas');
      off.width = size;
      off.height = size;
      var c = off.getContext('2d');
      var col = colors[ci];
      var grad = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',1)');
      grad.addColorStop(1, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',0)');
      c.fillStyle = grad;
      c.fillRect(0, 0, size, size);
      particleTextures.push(PIXI.Texture.from(off));
    }
    particleTex = particleTextures[0]; // default fallback
  }

  // Reusable holder for older textures to destroy on the NEXT texture swap,
  // so we don't free a texture that might still be referenced by the current
  // frame's draw calls (which was the source of intermittent blank-screen
  // glitches — destroy(true) synchronously freed GPU memory out from under
  // the active batch).
  var _tableTexToDestroy = null;

  function updateTableTexture() {
    if (!tableSprite || !W || !H) return;
    try {
      var tableCanvas = renderTableToCanvas();
      if (!tableCanvas) return;
      var oldTex = tableSprite.texture;
      // Create the new texture BEFORE releasing the old one
      var newTex = PIXI.Texture.from(tableCanvas);
      tableSprite.texture = newTex;
      tableSprite.width = W;
      tableSprite.height = H;
      tableSprite.renderable = true;
      // Destroy the *previous* pending-destroy texture now — it's had at least
      // one full frame to be unreferenced by anything in flight.
      if (_tableTexToDestroy && _tableTexToDestroy !== newTex && _tableTexToDestroy !== PIXI.Texture.EMPTY) {
        try { _tableTexToDestroy.destroy(true); } catch (e) { /* ignore */ }
      }
      _tableTexToDestroy = (oldTex !== newTex && oldTex !== PIXI.Texture.EMPTY) ? oldTex : null;
    } catch (e) {
      // Never let a table-texture update crash the render loop
      console && console.warn && console.warn('updateTableTexture failed:', e);
    }
  }

  // ================================================================
  //  INITIALIZATION (async - returns Promise)
  // ================================================================

  function init(canvasEl) {
    if (initPromise) {
      return initPromise.then(function () {
        resize();
      });
    }

    app = new PIXI.Application();
    dpr = window.devicePixelRatio || 1;

    // Use window dimensions directly — canvas parent can be 0x0 during CSS
    // screen transitions, which would initialize the app at 0x0.
    W = window.innerWidth;
    H = window.innerHeight;

    // WebGL context loss handler — prevent the browser from treating the
    // loss as final so it can be restored. Without this, if the GPU is
    // stressed or the tab is backgrounded too long, the canvas goes blank
    // permanently and the game never recovers.
    canvasEl.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
    }, false);
    canvasEl.addEventListener('webglcontextrestored', function () {
      // Rebuild everything the GPU needs
      try {
        _cardCanvasCache = {};
        _backCanvasCache = null;
        cardTextures = {};
        backTexture = null;
        buildCardTextures();
        buildShadowTexture();
        buildGlowTexture();
        buildParticleTexture();
        updateTableTexture();
        initPixiParticles();
      } catch (err) { /* ignore — render loop will retry */ }
    }, false);

    initPromise = app.init({
      canvas: canvasEl,
      width: W,
      height: H,
      resolution: dpr,
      autoDensity: true,
      backgroundAlpha: 0,
      antialias: true
    }).then(function () {
      // Pre-render all textures
      buildCardTextures();
      buildShadowTexture();
      buildGlowTexture();
      buildParticleTexture();

      // Scene hierarchy
      tableSprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
      app.stage.addChild(tableSprite);

      particleContainer = new PIXI.Container();
      app.stage.addChild(particleContainer);

      gameLayer = new PIXI.Container();
      app.stage.addChild(gameLayer);

      flyingCardsLayer = new PIXI.Container();
      app.stage.addChild(flyingCardsLayer);

      // Deck count text
      deckCountText = new PIXI.Text({
        text: '',
        style: {
          fontSize: 14,
          fontFamily: 'Cinzel, Georgia, serif',
          fontWeight: 'bold',
          fill: 0xc8c8c8
        }
      });
      deckCountText.anchor.set(0.5, 0);
      deckCountText.alpha = 0.5;
      deckCountText.visible = false;
      gameLayer.addChild(deckCountText);

      // Render table and particles
      updateTableTexture();
      initPixiParticles();
    });

    return initPromise;
  }

  function resize() {
    if (!app || !app.renderer) return;
    // Use window dimensions directly. The canvas parent can briefly report 0
    // during CSS screen transitions, which would render the table blank.
    W = window.innerWidth;
    H = window.innerHeight;
    if (W === 0 || H === 0) return;
    app.renderer.resize(W, H);
    updateTableTexture();
    initPixiParticles();
  }

  // ================================================================
  //  SPRITE POOL (for per-frame card rendering in gameLayer)
  // ================================================================

  function acquireSprite() {
    var s;
    if (poolIndex < spritePool.length) {
      s = spritePool[poolIndex];
    } else {
      s = new PIXI.Sprite();
      s.anchor.set(0.5, 0.5);
      gameLayer.addChild(s);
      spritePool.push(s);
    }
    s.visible = true;
    s.alpha = 1;
    s.rotation = 0;
    s.scale.set(1, 1);
    s.tint = 0xFFFFFF;
    poolIndex++;
    return s;
  }

  // ================================================================
  //  CARD DRAWING (called from gameRenderCallback each frame)
  // ================================================================

  function drawCard(x, y, card, faceUp, rotation, scale, shadowAlpha) {
    rotation = rotation || 0;
    scale = scale || 1;
    shadowAlpha = shadowAlpha !== undefined ? shadowAlpha : 0.3;

    var texScale = scale / TEX_SCALE;

    // Shadow sprite
    if (shadowAlpha > 0) {
      var shadow = acquireSprite();
      shadow.texture = shadowTexture;
      shadow.position.set(x + 2 * scale, y + 3 * scale);
      shadow.rotation = rotation;
      shadow.scale.set(texScale);
      shadow.alpha = shadowAlpha;
    }

    // Card sprite
    var s = acquireSprite();
    var tex = (faceUp && card) ? cardTextures[card.rank + '_' + card.suit] : backTexture;
    s.texture = tex;
    s.position.set(x, y);
    s.rotation = rotation;
    s.scale.set(texScale);
  }

  function drawCardGlow(x, y, rotation, scale, pulseAlpha) {
    scale = scale || 1;
    rotation = rotation || 0;
    pulseAlpha = pulseAlpha !== undefined ? pulseAlpha : 1;
    var texScale = scale / TEX_SCALE;
    // Glow texture is slightly larger due to bigger padding
    var glowScale = texScale * (CARD_W + 56) / (CARD_W + 32);
    var g = acquireSprite();
    g.texture = glowTexture;
    g.position.set(x, y);
    g.rotation = rotation;
    g.scale.set(glowScale);
    g.alpha = pulseAlpha;
  }

  function drawCardFlipping(x, y, card, flipProgress, scale, rotation) {
    scale = scale || 1;
    rotation = rotation || 0;
    var scaleX = Math.abs(Math.cos(flipProgress * Math.PI));
    if (scaleX < 0.02) scaleX = 0.02;
    var showFace = flipProgress > 0.5;

    var texScale = scale / TEX_SCALE;

    // Shadow
    var shadow = acquireSprite();
    shadow.texture = shadowTexture;
    shadow.position.set(x + 2 * scale, y + 3 * scale);
    shadow.rotation = rotation;
    shadow.scale.set(texScale * scaleX, texScale);
    shadow.alpha = 0.3;

    // Card
    var s = acquireSprite();
    var tex = showFace ? cardTextures[card.rank + '_' + card.suit] : backTexture;
    s.texture = tex;
    s.position.set(x, y);
    s.rotation = rotation;
    s.scale.set(texScale * scaleX, texScale);
  }

  function drawDeck(x, y, count) {
    var stackHeight = Math.min(count, 10);
    // Deck scales proportionally with viewport (matches the dealt
    // card scale). v109 briefly bumped this to 1.32 because the
    // user thought the deck looked smaller than the fanned hands;
    // v115 reverted to 1.1 — the perception was an optical
    // illusion from the overlapped stack visualisation, the cards
    // were always the same physical size as the dealt cards.
    var deckScale = 1.1 * (Math.min(W, H) / 1080);
    var texScale = deckScale / TEX_SCALE;
    var stepPx = 0.8 * deckScale; // offset between stacked cards
    // The TOP (visible) card is rendered last; lay out the stack so THAT
    // card sits at (x, y). The cards below it fan down-and-right from there.
    var topOffset = (stackHeight > 0 ? stackHeight - 1 : 0) * stepPx;

    // Bottom shadow — anchored near the bottom card's position
    if (stackHeight > 0) {
      var shadow = acquireSprite();
      shadow.texture = shadowTexture;
      shadow.position.set(x + topOffset + 3 * deckScale, y + topOffset + 5 * deckScale);
      shadow.scale.set(texScale);
      shadow.alpha = 0.2;
    }

    for (var i = 0; i < stackHeight; i++) {
      // depthFromTop: 0 for top card, (stackHeight-1) for bottom card
      var depthFromTop = stackHeight - 1 - i;
      var offset = depthFromTop * stepPx;
      var s = acquireSprite();
      s.texture = backTexture;
      s.position.set(x + offset, y + offset);
      s.scale.set(texScale);
    }

    // Deck count text removed — redundant with HUD display
    deckCountText.visible = false;
  }

  // ================================================================
  //  FLYING CARDS (animated cards in transit)
  // ================================================================

  function addFlyingCard(obj) {
    var texScale = (obj.scale || 1) / TEX_SCALE;
    var tex = (obj.faceUp && obj.card) ? cardTextures[obj.card.rank + '_' + obj.card.suit] : backTexture;

    // Shadow sprite (added first = behind)
    var shadowSprite = new PIXI.Sprite(shadowTexture);
    shadowSprite.anchor.set(0.5, 0.5);
    shadowSprite.scale.set(texScale);
    shadowSprite.alpha = 0.3;
    shadowSprite.position.set(obj.x + 2, obj.y + 3);
    flyingCardsLayer.addChild(shadowSprite);

    // Card sprite
    var sprite = new PIXI.Sprite(tex);
    sprite.anchor.set(0.5, 0.5);
    sprite.scale.set(texScale);
    sprite.position.set(obj.x, obj.y);
    flyingCardsLayer.addChild(sprite);

    var entry = { obj: obj, sprite: sprite, shadowSprite: shadowSprite };
    flyingCards.push(entry);
    return obj;
  }

  function removeFlyingCard(obj) {
    for (var i = 0; i < flyingCards.length; i++) {
      if (flyingCards[i].obj === obj) {
        flyingCardsLayer.removeChild(flyingCards[i].sprite);
        flyingCardsLayer.removeChild(flyingCards[i].shadowSprite);
        flyingCards[i].sprite.destroy();
        flyingCards[i].shadowSprite.destroy();
        flyingCards.splice(i, 1);
        return;
      }
    }
  }

  function clearFlyingCards() {
    for (var i = 0; i < flyingCards.length; i++) {
      flyingCardsLayer.removeChild(flyingCards[i].sprite);
      flyingCardsLayer.removeChild(flyingCards[i].shadowSprite);
      flyingCards[i].sprite.destroy();
      flyingCards[i].shadowSprite.destroy();
    }
    flyingCards = [];
  }

  function syncFlyingCard(entry) {
    var obj = entry.obj;
    var sprite = entry.sprite;
    var shadowSprite = entry.shadowSprite;
    var scale = (obj.scale || 1) / TEX_SCALE;

    sprite.position.set(obj.x, obj.y);
    sprite.rotation = obj.rotation || 0;

    if (obj.flipProgress !== undefined) {
      var scaleX = Math.abs(Math.cos(obj.flipProgress * Math.PI));
      if (scaleX < 0.02) scaleX = 0.02;
      var showFace = obj.flipProgress > 0.5;
      sprite.texture = showFace ? cardTextures[obj.card.rank + '_' + obj.card.suit] : backTexture;
      sprite.scale.set(scale * scaleX, scale);
    } else {
      sprite.texture = (obj.faceUp && obj.card) ? cardTextures[obj.card.rank + '_' + obj.card.suit] : backTexture;
      sprite.scale.set(scale);
    }

    // Shadow follows card
    shadowSprite.position.set(obj.x + 2, obj.y + 3);
    shadowSprite.scale.set(sprite.scale.x, sprite.scale.y);
    shadowSprite.rotation = sprite.rotation;
  }

  function syncAllFlyingCards() {
    for (var i = 0; i < flyingCards.length; i++) {
      syncFlyingCard(flyingCards[i]);
    }
  }

  // ================================================================
  //  PARTICLES (PixiJS sprites with shared texture)
  // ================================================================

  function initPixiParticles() {
    if (!particleContainer) return;
    particleContainer.removeChildren();
    particles = [];

    var texCount = particleTextures.length || 1;
    for (var i = 0; i < PARTICLE_COUNT; i++) {
      var tex = texCount > 1 ? particleTextures[i % texCount] : particleTex;
      var sprite = new PIXI.Sprite(tex);
      sprite.anchor.set(0.5, 0.5);
      var size = 0.4 + Math.random() * 2.2; // wider range for depth
      sprite.scale.set(size / 4); // particle texture is 8px
      sprite.alpha = Math.random() * 0.15;
      sprite.position.set(Math.random() * W, Math.random() * H);

      particleContainer.addChild(sprite);
      particles.push({
        sprite: sprite,
        speedX: (Math.random() - 0.5) * 0.25,
        speedY: -0.08 - Math.random() * 0.35,
        maxAlpha: 0.04 + Math.random() * 0.12
      });
    }
  }

  function updateParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var s = p.sprite;
      s.x += p.speedX;
      s.y += p.speedY;
      if (s.alpha < p.maxAlpha) s.alpha += 0.001;
      if (s.y < -10 || s.x < -10 || s.x > W + 10) {
        s.x = Math.random() * W;
        s.y = H + 10;
        s.alpha = 0;
      }
    }
  }

  // ================================================================
  //  RENDER LOOP (PixiJS ticker)
  // ================================================================

  // Health check: periodically verify the table sprite has a real texture.
  // If not (e.g. after a silent WebGL context loss, or a race where PIXI
  // init finished but the first updateTableTexture ran at 0x0 dimensions),
  // rebuild it. Runs every 60 frames (~1s at 60fps) with a cooldown so it
  // can't thrash if rebuilds also fail.
  var _healthFrameCounter = 0;
  var _healthCooldownFrames = 0;
  function checkTableHealth() {
    _healthFrameCounter++;
    if (_healthCooldownFrames > 0) { _healthCooldownFrames--; return; }
    if (_healthFrameCounter < 60) return;
    _healthFrameCounter = 0;
    if (!tableSprite || !W || !H) return;
    var tex = tableSprite.texture;
    var needsRebuild =
      !tex ||
      tex === PIXI.Texture.EMPTY ||
      !tex.source ||
      (tex.source.width || 0) === 0 ||
      (tex.source.height || 0) === 0;
    if (needsRebuild) {
      try { updateTableTexture(); } catch (e) { /* ignore */ }
      _healthCooldownFrames = 120; // don't retry for 2s
    }
  }

  function startLoop(callback) {
    gameRenderCallback = callback;
    if (tickerFn) app.ticker.remove(tickerFn);
    tickerFn = function () {
      try {
        // Periodic self-heal for canvas rendering
        checkTableHealth();

        // Reset sprite pool
        poolIndex = 0;

        // Update particles
        updateParticles();

        // Call game render callback (populates gameLayer via drawCard/drawDeck calls)
        if (gameRenderCallback) {
          gameRenderCallback(null, W, H);
        }

        // Move deck count text to top of game layer
        if (deckCountText && deckCountText.parent !== gameLayer) {
          gameLayer.addChild(deckCountText);
        }

        // Hide unused pool sprites
        for (var i = poolIndex; i < spritePool.length; i++) {
          spritePool[i].visible = false;
        }

        // Sync flying card sprite positions
        syncAllFlyingCards();
      } catch (err) {
        // Swallow render errors so the ticker keeps running. Without this,
        // a single bad frame (e.g. during a resize) can halt the ticker and
        // the game appears "stuck" with a blank table.
        console && console.warn && console.warn('render frame error:', err);
      }
    };
    app.ticker.add(tickerFn);
  }

  function stopLoop() {
    if (tickerFn && app) {
      app.ticker.remove(tickerFn);
    }
    tickerFn = null;
    gameRenderCallback = null;
  }

  // ================================================================
  //  ANIMATION HELPERS
  // ================================================================

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // Uses setTimeout for consistent timing regardless of tab visibility
  function animate(duration, onUpdate, onComplete) {
    var start = performance.now();
    var interval = 16; // ~60fps
    function tick() {
      var now = performance.now();
      var t = Math.min((now - start) / duration, 1);
      onUpdate(t);
      if (t < 1) {
        setTimeout(tick, interval);
      } else {
        if (onComplete) onComplete();
      }
    }
    setTimeout(tick, interval);
  }

  // ================================================================
  //  TABLE GEOMETRY (seat positions, etc.)
  // ================================================================

  // Universal scale unit: 1 vmin in pixels. All game dimensions use this.
  function getVmin() {
    return Math.min(W, H) / 100;
  }

  // Wood border thickness, in pixels (proportional to vmin for consistent look)
  function getWoodBorder() {
    return 2.5 * getVmin();
  }

  function getTableCenter() {
    // Shift down 1.5vmin. With the smaller 32vmin felt and bigger HUD text,
    // this balances top margin (for HUD above top character) and bottom
    // margin (for the name below the bottom character) on landscape phones.
    // (v122 tried shifting to 5vmin on tablet landscape to dodge Safari's
    // tabs strip; v124 reverts that — see CLAUDE.md.)
    return { x: W / 2, y: H / 2 + 1.5 * getVmin() };
  }

  // Table felt radius. Kept slightly smaller than the absolute max so that on
  // narrow-aspect viewports (landscape phone, 16:9 desktop) the larger HUD
  // bar at the top still has room above the top character's score row.
  //   32vmin felt + 2.5vmin wood = 34.5vmin outer radius.
  //   Avatar tangent: orbit = 34.5 + 3.9 = 38.4vmin.
  //   Avatar far edge from center = 42.3vmin.
  //   Top seat top-row top = cy - 44.7vmin.
  function getTableRadii() {
    var r = 32 * getVmin();
    return { rx: r, ry: r };
  }

  // Returns the outer radius of the table (felt + wood border).
  function getTableOuterRadius() {
    var radii = getTableRadii();
    return radii.rx + getWoodBorder();
  }

  // Setup seat avatar radius (matches .seat-avatar CSS: 7.8vmin)
  function getSetupAvatarRadius() {
    return 3.9 * getVmin();
  }

  // Game seat avatar radius (matches .game-seat-avatar CSS: 7.8vmin — same as setup)
  function getGameAvatarRadius() {
    return 3.9 * getVmin();
  }

  // Setup seats — avatar's inner edge tangent to table's outer edge (avatar fully outside table).
  function getSeatPositions(numSeats) {
    var center = getTableCenter();
    var orbit = getTableOuterRadius() + getSetupAvatarRadius();
    var positions = [];
    for (var i = 0; i < numSeats; i++) {
      var angle = (Math.PI / 2) + (i * 2 * Math.PI / numSeats);
      positions.push({
        x: center.x + orbit * Math.cos(angle),
        y: center.y + orbit * Math.sin(angle),
        angle: angle
      });
    }
    return positions;
  }

  function getHandPosition(seatPos, tableCenter) {
    // Hand position is 34% of the way from the seat toward the center.
    // Tuned so the top character's name sits just above their top card row
    // without overlap while leaving comfortable space between the card fan
    // and the wood border.
    return {
      x: seatPos.x + (tableCenter.x - seatPos.x) * 0.34,
      y: seatPos.y + (tableCenter.y - seatPos.y) * 0.34
    };
  }

  // Game seats — same rule: avatar's inner edge tangent to table's outer edge.
  function getSeatOverlayPositions(numSeats) {
    var positions = [];
    var center = getTableCenter();
    var orbit = getTableOuterRadius() + getGameAvatarRadius();
    for (var i = 0; i < numSeats; i++) {
      var angle = (Math.PI / 2) + (i * 2 * Math.PI / numSeats);
      positions.push({
        x: center.x + orbit * Math.cos(angle),
        y: center.y + orbit * Math.sin(angle),
        angle: angle
      });
    }
    return positions;
  }

  function getCanvasSize() {
    return { w: W, h: H };
  }

  // ================================================================
  //  PUBLIC API
  // ================================================================

  return {
    init: init,
    resize: resize,
    precacheCardCanvases: precacheCardCanvases,
    drawCard: drawCard,
    drawCardGlow: drawCardGlow,
    drawCardFlipping: drawCardFlipping,
    drawDeck: drawDeck,
    startLoop: startLoop,
    stopLoop: stopLoop,
    addFlyingCard: addFlyingCard,
    removeFlyingCard: removeFlyingCard,
    clearFlyingCards: clearFlyingCards,
    animate: animate,
    easeOutCubic: easeOutCubic,
    easeInOutCubic: easeInOutCubic,
    getTableCenter: getTableCenter,
    getTableRadii: getTableRadii,
    getSeatPositions: getSeatPositions,
    getHandPosition: getHandPosition,
    getSeatOverlayPositions: getSeatOverlayPositions,
    hideDeckCount: function () { if (deckCountText) deckCountText.visible = false; },
    getCanvasSize: getCanvasSize,
    CARD_W: CARD_W,
    CARD_H: CARD_H
  };
})();

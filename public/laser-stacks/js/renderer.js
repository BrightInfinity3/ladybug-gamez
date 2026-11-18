/* ============================================================
   Laser Stacks - PixiJS Renderer
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

  // ---- Suit style: 'classic' Unicode pips, 'laser' (SoloTerra art),
  //      or 'animals' (Solitairra art) ----
  var suitStyle = 'laser';
  function setSuitStyle(style) {
    suitStyle = (style === 'classic' || style === 'animals') ? style : 'laser';
  }
  function getSuitStyle() { return suitStyle; }
  // In laser/animals mode every suit is "custom" (drawn pip art; the
  // solitaire games have per-suit skins — Laser Stacks collapses that
  // to the single Options toggle)
  function isCustomSuit(suit) {
    return suitStyle !== 'classic';
  }
  function getSuitColor(suit) {
    if (isCustomSuit(suit)) return LaserPips.getSuitColor(suit, suitStyle);
    return SUIT_COLORS[suit];
  }

  // ---- Textures ----
  var cardTextures = {};    // rank_suit -> PIXI.Texture
  var backTexture = null;
  var shadowTexture = null;
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

  // The linen grain is identical on every card face (deterministic noise
  // on the same 70x100 grid), so it's rendered ONCE onto a transparent
  // canvas and blitted per card. Source-over is associative, so this
  // composites exactly like drawing the grain on each card did — at 1/52
  // of the cost (~110ms → ~2ms per deck on Windows).
  var _paperOverlay = null;
  function getPaperOverlay() {
    if (_paperOverlay) return _paperOverlay;
    var off = document.createElement('canvas');
    off.width = CARD_W * TEX_SCALE;
    off.height = CARD_H * TEX_SCALE;
    var c = off.getContext('2d');
    c.scale(TEX_SCALE, TEX_SCALE);
    Textures.paperTexture(c, CARD_W, CARD_H);
    _paperOverlay = off;
    return off;
  }

  // Corner side-pip size: ~7.5px for laser (the 11px rank's cap height).
  // Animals scale by the same per-suit boost the center pips use, since
  // their art carries more internal padding.
  function getCornerPipSize(suit) {
    var base = 7.5;
    if (suitStyle === 'animals') {
      return base * LaserPips.getCustomPipSize(suit, 5, 'animals') / 16;
    }
    return base;
  }

  function renderCardToImage(rank, suit) {
    var scale = TEX_SCALE;
    var cw = CARD_W * scale;
    var ch = CARD_H * scale;

    var off = document.createElement('canvas');
    off.width = cw;
    off.height = ch;
    var c = off.getContext('2d');
    c.scale(scale, scale);

    roundRect(c, 0.5, 0.5, CARD_W - 1, CARD_H - 1, CARD_R);
    var bgGrad = c.createLinearGradient(0, 0, 0, CARD_H);
    bgGrad.addColorStop(0, '#fffef8');
    bgGrad.addColorStop(0.5, '#faf6ee');
    bgGrad.addColorStop(1, '#f2ece0');
    c.fillStyle = bgGrad;
    c.fill();

    c.save();
    roundRect(c, 0.5, 0.5, CARD_W - 1, CARD_H - 1, CARD_R);
    c.clip();
    c.drawImage(getPaperOverlay(), 0, 0, CARD_W, CARD_H);
    c.restore();

    Textures.drawGoldBorder(c, 1, 1, CARD_W - 2, CARD_H - 2, CARD_R, 0.8);

    var fs = 10;
    Textures.drawCornerFlourish(c, 5, 5, fs, 0);
    Textures.drawCornerFlourish(c, CARD_W - 5, 5, fs, Math.PI / 2);
    Textures.drawCornerFlourish(c, CARD_W - 5, CARD_H - 5, fs, Math.PI);
    Textures.drawCornerFlourish(c, 5, CARD_H - 5, fs, Math.PI * 1.5);

    var color = getSuitColor(suit);
    var sym = SUIT_SYM[suit];
    var isCustom = isCustomSuit(suit);
    var numericRank = parseInt(rank);

    // Corner insets (symmetric from card edges)
    var cornerX = 10;
    var rankY = 5;   // distance from edge to top/bottom of rank text
    var symY = 17;   // distance from edge to top/bottom of suit symbol

    // Use Georgia for numeric ranks (Cinzel digits read like capitals) and for J & K
    var isNumeric = !isNaN(numericRank);
    var useGeorgia = isNumeric || rank === 'J' || rank === 'K';
    var rankFont = useGeorgia ? 'bold 11px Georgia, serif' : 'bold 11px Cinzel, Georgia, serif';
    var cornerSymSize = 10;

    // Top-left corner: rank then suit below (laser suits show rank only)
    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.font = rankFont;
    c.fillStyle = 'rgba(0,0,0,0.1)';
    c.fillText(rank, cornerX + 0.5, rankY + 0.5);
    c.fillStyle = color;
    c.fillText(rank, cornerX, rankY);
    if (!isCustom) {
      c.font = cornerSymSize + 'px serif';
      c.fillStyle = 'rgba(0,0,0,0.1)';
      c.fillText(sym, cornerX + 0.5, symY + 0.5);
      c.fillStyle = color;
      c.fillText(sym, cornerX, symY);
    }
    c.restore();

    // Bottom-right corner: suit then rank below (rank closest to corner)
    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'bottom';
    c.font = rankFont;
    c.fillStyle = 'rgba(0,0,0,0.1)';
    c.fillText(rank, CARD_W - cornerX + 0.5, CARD_H - rankY + 0.5);
    c.fillStyle = color;
    c.fillText(rank, CARD_W - cornerX, CARD_H - rankY);
    if (!isCustom) {
      c.font = cornerSymSize + 'px serif';
      c.fillStyle = 'rgba(0,0,0,0.1)';
      c.fillText(sym, CARD_W - cornerX + 0.5, CARD_H - symY + 0.5);
      c.fillStyle = color;
      c.fillText(sym, CARD_W - cornerX, CARD_H - symY);
    }
    c.restore();

    // Drawn styles (laser/animals): a mini pip BESIDE each corner rank
    // (v2.8, MK's ask). Cards buried in the trick pile only show a sliver
    // of edge, and the rank alone couldn't say which suit it was. The pip
    // sits in the band above the top pip row; the bottom-right one is the
    // same drawing rotated 180° about the card center (left of its rank).
    if (isCustom) {
      c.save();
      c.font = rankFont;
      var rankHalfW = c.measureText(rank).width / 2;
      var sidePip = getCornerPipSize(suit);
      var sideX = cornerX + rankHalfW + 1 + sidePip / 2;
      var sideY = rankY + 4.6;
      // The two-digit 10 would push its pip right over the 10 layouts'
      // top pip pair (y 0.02, x 0.25) — every 10 layout leaves the strip
      // UNDER the corner rank empty instead, so the 10 uses the classic
      // index (pip below the rank).
      if (rank === '10') {
        sidePip *= 0.9;
        sideX = cornerX;
        sideY = rankY + 15;
      }
      LaserPips.drawPip(c, sideX, sideY, suit, sidePip, false, suitStyle);
      c.translate(CARD_W, CARD_H);
      c.rotate(Math.PI);
      LaserPips.drawPip(c, sideX, sideY, suit, sidePip, false, suitStyle);
      c.restore();
    }

    // Pip area — vertically centered with equal top/bottom margins
    var pipMarginX = 14;
    var pipMarginY = 18;
    var area = { x: pipMarginX, y: pipMarginY, w: CARD_W - pipMarginX * 2, h: CARD_H - pipMarginY * 2 };

    if (!isNaN(numericRank) && numericRank >= 2 && numericRank <= 10) {
      renderPips(c, area, suit, numericRank);
    } else {
      renderFaceCard(c, area, rank, suit);
    }

    return off;
  }

  function renderPips(c, area, suit, count) {
    var sym = SUIT_SYM[suit];
    var color = getSuitColor(suit);
    var isCustom = isCustomSuit(suit);
    var layout = LaserPips.getLayout(suit, count, isCustom);
    if (!layout) return;

    var fontSize = 20; // uniform 20px for classic pips (all ranks)
    var customSize = LaserPips.getCustomPipSize(suit, count, suitStyle);

    c.save();
    if (!isCustom) {
      c.font = fontSize + 'px serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
    }

    for (var i = 0; i < layout.length; i++) {
      var px = area.x + layout[i][0] * area.w;
      var py = area.y + layout[i][1] * area.h;

      if (isCustom) {
        LaserPips.drawPip(c, px, py, suit, customSize, false, suitStyle);
      } else {
        c.save();
        c.translate(px, py);
        c.fillStyle = 'rgba(0,0,0,0.12)';
        c.fillText(sym, 0.6, 0.8);
        c.fillStyle = color;
        c.fillText(sym, 0, 0);
        c.restore();
      }
    }
    c.restore();
  }

  function renderFaceCard(c, area, rank, suit) {
    var sym = SUIT_SYM[suit];
    var color = getSuitColor(suit);
    var cx = area.x + area.w / 2;
    var cy = area.y + area.h / 2;

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

    // All face card ranks positioned at the same vertical center
    // Q's descender tail hangs below \u2014 textBaseline 'middle' includes tail,
    // so the O-body sits too high. Push Q DOWN to align O-body with A/J/K.
    var rankCenterY = cy - 4;
    var qDescenderOffset = (rank === 'Q') ? 2 : 0;
    var rankY = rankCenterY + qDescenderOffset;

    // Background watermark (chess glyphs for J/Q/K, a star for A)
    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    var chessSym = rank === 'K' ? '\u265A' : rank === 'Q' ? '\u265B' : rank === 'J' ? '\u2658' : '\u2726';
    c.font = 'bold 30px serif';
    c.fillStyle = color;
    c.globalAlpha = 0.08;
    c.fillText(chessSym, cx, rankY);
    c.globalAlpha = 1;
    c.restore();

    c.save();
    // A & Q use Cinzel for decorative serifs; J & K use Georgia for classic letterforms
    var faceFont = (rank === 'A' || rank === 'Q') ? '900 28px Cinzel, Georgia, serif' : '900 28px Georgia, serif';
    c.font = faceFont;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = 'rgba(0,0,0,0.15)';
    c.fillText(rank, cx + 1, rankY + 1);
    var goldGrad = Textures.goldFoilGradient(c, cx - 14, rankY - 14, 28, 28);
    c.fillStyle = goldGrad;
    c.globalAlpha = 0.3;
    c.fillText(rank, cx, rankY);
    c.globalAlpha = 1;
    c.fillStyle = color;
    c.fillText(rank, cx, rankY);
    c.restore();

    // Suit symbol below rank on face cards
    var suitPipY = rankCenterY + 24;
    if (isCustomSuit(suit)) {
      LaserPips.drawPip(c, cx, suitPipY, suit, LaserPips.getFaceCardPipSize(suit, suitStyle), false, suitStyle);
    } else {
      c.save();
      c.font = '18px serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = 'rgba(0,0,0,0.1)';
      c.fillText(sym, cx + 0.5, suitPipY + 0.5);
      c.fillStyle = color;
      c.fillText(sym, cx, suitPipY);
      c.restore();
    }

    // Decorative corner accents (gold tinted)
    c.save();
    c.strokeStyle = '#c9952a';
    c.globalAlpha = 0.18;
    c.lineWidth = 0.8;
    c.beginPath();
    c.moveTo(area.x + 2, area.y + 12);
    c.quadraticCurveTo(area.x + 2, area.y + 2, area.x + 12, area.y + 2);
    c.stroke();
    c.beginPath();
    c.moveTo(area.x + area.w - 2, area.y + 12);
    c.quadraticCurveTo(area.x + area.w - 2, area.y + 2, area.x + area.w - 12, area.y + 2);
    c.stroke();
    c.beginPath();
    c.moveTo(area.x + 2, area.y + area.h - 12);
    c.quadraticCurveTo(area.x + 2, area.y + area.h - 2, area.x + 12, area.y + area.h - 2);
    c.stroke();
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

    // Center "Laser" / "Stacks" in gold (two lines, SoloTerra's larger sizing)
    c.save();
    c.font = '900 14px Cinzel, Georgia, serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    var midX = CARD_W / 2;
    var midY = CARD_H / 2;
    var lineH = 16;

    c.fillStyle = '#d4a849';
    c.globalAlpha = 0.08;
    c.fillText('Laser', midX, midY - lineH / 2);
    c.fillText('Stacks', midX, midY + lineH / 2);
    c.font = '900 15px Cinzel, Georgia, serif';
    c.globalAlpha = 0.06;
    c.fillText('Laser', midX, midY - lineH / 2);
    c.fillText('Stacks', midX, midY + lineH / 2);

    c.font = '900 14px Cinzel, Georgia, serif';
    var goldG = Textures.goldFoilGradient(c, midX - 26, midY - 17, 52, 34);
    c.fillStyle = goldG;
    c.globalAlpha = 0.50;
    c.fillText('Laser', midX, midY - lineH / 2);
    c.fillText('Stacks', midX, midY + lineH / 2);
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
  //  DIRTY-FRAME RENDERING (30's v125 perf pass, ported)
  // ================================================================
  // The ticker's conditional pass (full scene rebuild: sprite pool +
  // every resting card + flying-card sync) only runs when something
  // actually changed. Anything inherently animating (flying cards,
  // active animate() tweens) forces the pass; discrete state changes
  // call markDirty(). Set window.DEBUG_RENDER_FORCE = true to disable
  // the gating when bisecting a missed-redraw bug.
  var _dirty = true;
  function markDirty() { _dirty = true; }
  // Count of in-flight animate() tweens — keeps the conditional pass
  // running for their whole duration.
  var _activeAnims = 0;

  // ================================================================
  //  TABLE PRE-RENDERING
  // ================================================================

  // (E) Cap the felt canvas at 1080p (30's v126). The FBM noise cost is
  // quadratic in pixels and invisible past this resolution — PIXI
  // sprite-scales the texture to the viewport with no visible change.
  var TABLE_TEX_MAX_W = 1920;
  var TABLE_TEX_MAX_H = 1080;

  function renderTableToCanvas() {
    var renderScale = Math.min(dpr, TABLE_TEX_MAX_W / W, TABLE_TEX_MAX_H / H);
    var tableCanvas = document.createElement('canvas');
    tableCanvas.width = Math.round(W * renderScale);
    tableCanvas.height = Math.round(H * renderScale);
    var c = tableCanvas.getContext('2d');
    c.setTransform(renderScale, 0, 0, renderScale, 0, 0);

    var center = getTableCenter();
    var cx = center.x;
    var cy = center.y;
    var radii = getTableRadii();
    var rx = radii.rx;
    var ry = radii.ry;
    var wood = getWoodBorder();

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
    drawEllipse(c, cx, cy, rx + wood, ry + wood);
    var woodGrad = c.createRadialGradient(cx - rx * 0.3, cy - ry * 0.3, 0, cx, cy, Math.max(rx, ry) + wood * 1.25);
    woodGrad.addColorStop(0, WOOD_LIGHT);
    woodGrad.addColorStop(0.4, WOOD_MID);
    woodGrad.addColorStop(1, WOOD_DARK);
    c.fillStyle = woodGrad;
    c.fill();

    // Perlin noise wood grain (replaces random ellipses)
    c.save();
    drawEllipse(c, cx, cy, rx + wood, ry + wood);
    c.clip();
    // Only the visible wood ring gets grain — the felt covers the inside
    Textures.woodGrainTexture(c, W, H, cx, cy, { cx: cx, cy: cy, rIn: rx, rOut: rx + wood });
    c.restore();

    // Inner wood edge (deeper shadow for dimension)
    drawEllipse(c, cx, cy, rx + wood * 0.2, ry + wood * 0.2);
    var edgeShadow = c.createRadialGradient(cx, cy, Math.max(rx, ry), cx, cy, Math.max(rx, ry) + 6);
    edgeShadow.addColorStop(0, WOOD_DARK);
    edgeShadow.addColorStop(1, 'rgba(15, 8, 2, 0.8)');
    c.fillStyle = edgeShadow;
    c.fill();

    // Gold filigree ring at felt/wood junction
    Textures.drawFiligree(c, cx, cy, rx + wood * 0.12, ry + wood * 0.12);

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
    Textures.feltTexture(c, W, H, { cx: cx, cy: cy, rIn: 0, rOut: rx });
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

    // "Laser Stacks" watermark (gold-tinted, two lines)
    c.save();
    var logoSize = Math.min(rx * 0.22, 36);
    c.font = '900 ' + logoSize + 'px Cinzel, Georgia, serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = 'rgba(200, 220, 180, 0.64)';
    c.fillText('Laser', cx, cy - logoSize * 0.6);
    c.fillText('Stacks', cx, cy + logoSize * 0.6);
    c.restore();

    // Outer wood highlight (top edge reflection — warmer)
    c.save();
    drawEllipse(c, cx, cy, rx + wood * 0.9, ry + wood * 0.9);
    c.clip();
    var highlightGrad = c.createLinearGradient(cx, cy - ry - 30, cx, cy - ry + 12);
    highlightGrad.addColorStop(0, 'rgba(255,220,160,0.18)');
    highlightGrad.addColorStop(1, 'rgba(255,220,160,0)');
    c.fillStyle = highlightGrad;
    c.fillRect(cx - rx - wood * 1.25, cy - ry - wood * 1.25, (rx + wood * 1.25) * 2, 55);
    c.restore();

    // Bottom edge subtle reflection
    c.save();
    drawEllipse(c, cx, cy, rx + wood * 0.9, ry + wood * 0.9);
    c.clip();
    var bottomHighlight = c.createLinearGradient(cx, cy + ry - 5, cx, cy + ry + 25);
    bottomHighlight.addColorStop(0, 'rgba(255,200,140,0)');
    bottomHighlight.addColorStop(1, 'rgba(255,200,140,0.06)');
    c.fillStyle = bottomHighlight;
    c.fillRect(cx - rx - wood * 1.25, cy + ry - 5, (rx + wood * 1.25) * 2, 40);
    c.restore();

    return tableCanvas;
  }

  // ================================================================
  //  TEXTURE BUILDING (Canvas 2D -> PIXI.Texture)
  // ================================================================

  // 30's v126 card ATLAS: composite all 53 card canvases into one
  // texture so the GPU sees a single upload instead of 53 (1-3ms each
  // on integrated GPUs, worse on Windows). Sub-textures share the
  // atlas source via frame rectangles.
  // Layout: 13 ranks x (4 suits + 1 back row); back uses cell (0, 4).
  var _atlasSource = null;
  function buildCardTextures() {
    var suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    var ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    var cellW = CARD_W * TEX_SCALE;
    var cellH = CARD_H * TEX_SCALE;
    var atlasCanvas = document.createElement('canvas');
    atlasCanvas.width = cellW * ranks.length;
    atlasCanvas.height = cellH * (suits.length + 1);
    var ac = atlasCanvas.getContext('2d');
    for (var s = 0; s < suits.length; s++) {
      for (var r = 0; r < ranks.length; r++) {
        ac.drawImage(renderCardToImage(ranks[r], suits[s]), r * cellW, s * cellH);
      }
    }
    ac.drawImage(renderCardBackToImage(), 0, suits.length * cellH);

    // Single GPU upload, then per-card views into it. skipCache: PIXI's
    // Texture.from otherwise files every canvas in its global Cache
    // forever, so each suit-style switch leaked a whole atlas. The old
    // atlas is freed a second later — by then every pooled/flying sprite
    // has been re-pointed at the new one (they re-texture each frame).
    var atlasTex = PIXI.Texture.from(atlasCanvas, true);
    var src = atlasTex.source;
    var oldAtlas = _atlasSource;
    _atlasSource = src;
    if (oldAtlas && oldAtlas !== src) {
      setTimeout(function () {
        try { oldAtlas.destroy(); } catch (e) { /* already gone */ }
      }, 1000);
    }
    cardTextures = {};
    for (var s2 = 0; s2 < suits.length; s2++) {
      for (var r2 = 0; r2 < ranks.length; r2++) {
        cardTextures[ranks[r2] + '_' + suits[s2]] = new PIXI.Texture({
          source: src,
          frame: new PIXI.Rectangle(r2 * cellW, s2 * cellH, cellW, cellH)
        });
      }
    }
    backTexture = new PIXI.Texture({
      source: src,
      frame: new PIXI.Rectangle(0, suits.length * cellH, cellW, cellH)
    });
  }

  function rebuildCardTextures() { buildCardTextures(); markDirty(); }

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

    shadowTexture = PIXI.Texture.from(off, true);
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
      particleTextures.push(PIXI.Texture.from(off, true));
    }
    particleTex = particleTextures[0]; // default fallback
  }

  // 30's v125 felt cache: the procedural FBM felt is the most expensive
  // single asset (40-80ms at 1080p) and only depends on (W, H, dpr) —
  // skip the regen entirely when the size hasn't changed. This is the
  // tab-return hot path: visibilitychange forces a resize()+regen, and
  // on an unchanged viewport this now no-ops.
  var _cachedTableTexKey = null;
  var _tableTexToDestroy = null; // destroy one frame late (see below)
  function _tableTexKey() {
    return W + 'x' + H + '@' + dpr.toFixed(2);
  }
  function invalidateTableTextureCache() { _cachedTableTexKey = null; }

  function updateTableTexture(force) {
    if (!tableSprite || W === 0 || H === 0) return;
    var key = _tableTexKey();
    if (!force && key === _cachedTableTexKey) return;
    try {
      var tableCanvas = renderTableToCanvas();
      var oldTex = tableSprite.texture;
      var newTex = PIXI.Texture.from(tableCanvas, true);
      tableSprite.texture = newTex;
      tableSprite.width = W;
      tableSprite.height = H;
      _cachedTableTexKey = key;
      markDirty();
      // Destroying the old texture synchronously can free GPU memory out
      // from under the in-flight draw batch (intermittent blank table on
      // 30) — hold it one swap and destroy the PREVIOUS held texture.
      if (_tableTexToDestroy && _tableTexToDestroy !== newTex && _tableTexToDestroy !== PIXI.Texture.EMPTY) {
        try { _tableTexToDestroy.destroy(true); } catch (e) { /* ignore */ }
      }
      _tableTexToDestroy = (oldTex !== newTex && oldTex !== PIXI.Texture.EMPTY) ? oldTex : null;
    } catch (e) {
      console && console.warn && console.warn('updateTableTexture failed:', e);
    }
  }

  // Every GPU-side texture, rebuilt from scratch. Shared by WebGL
  // context restore and the pixel probe below.
  function rebuildAllGpuState() {
    try {
      invalidateTableTextureCache();
      buildCardTextures();
      buildShadowTexture();
      buildParticleTexture();
      updateTableTexture(true);
      initPixiParticles();
      markDirty();
    } catch (err) { /* ignore — the health check will retry */ }
  }

  // Pixel probe (v2.8 white-canvas guard). Runs at UTILITY priority, i.e.
  // right AFTER PIXI draws the frame, while the drawing buffer is still
  // readable. Every ~2s it reads one corner pixel — always the near-black
  // backdrop. If that ever comes back near-white, the GPU state is
  // corrupt: rebuild every texture (capped, so a broken driver can't
  // make us thrash). Renderer.getHealthInfo() exposes it for debugging.
  var _probeFrames = 0;
  var _probeHeals = 0;
  var _probePx = new Uint8Array(4);
  function probeCanvasHealth() {
    if (++_probeFrames < 120) return;
    _probeFrames = 0;
    var gl = app && app.renderer && app.renderer.gl;
    if (!gl || !tableSprite || !W || !H || gl.isContextLost()) return;
    try {
      if (gl.getParameter(gl.FRAMEBUFFER_BINDING) !== null) return; // not the screen
      gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, _probePx);
    } catch (e) { return; }
    if (_probePx[0] > 200 && _probePx[1] > 200 && _probePx[2] > 200 && _probeHeals < 3) {
      _probeHeals++;
      console.warn('[LaserStacks] canvas probe read white — rebuilding GPU textures');
      rebuildAllGpuState();
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
    // 30's v125 DPR cap: past 1.5x the extra sharpness is imperceptible
    // for a procedural felt + card sprites, but per-frame GPU work
    // scales quadratically with resolution. Windows laptops commonly
    // report 1.5-2.0 — uncapped they render ~4x the pixels.
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    var parent = canvasEl.parentElement;
    W = parent.clientWidth;
    H = parent.clientHeight;

    // WebGL context-loss recovery (30's v125): without preventDefault
    // the loss is final — blank canvas forever after a long background
    // stint or GPU reset. On restore, every GPU-side texture is gone.
    canvasEl.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
    }, false);
    canvasEl.addEventListener('webglcontextrestored', function () {
      rebuildAllGpuState();
    }, false);

    initPromise = app.init({
      canvas: canvasEl,
      width: W,
      height: H,
      resolution: dpr,
      autoDensity: true,
      // White-canvas fix (v2.8). PIXI's default order is webgl → webgpu:
      // if WebGL is momentarily unavailable at startup (e.g. Chrome's GPU
      // process restarting), it silently picks WebGPU for the whole
      // session — the renderer behind the known "blank white canvas on
      // Windows Chrome" reports. Never WebGPU; Canvas 2D is the fallback.
      preference: ['webgl', 'canvas'],
      // Opaque: the table texture paints every pixel anyway, and an
      // opaque layer spares the compositor the alpha blend over the page.
      background: '#080c0a',
      backgroundAlpha: 1,
      antialias: true,
      eventMode: 'none',
      eventFeatures: {
        move: false,
        globalMove: false,
        click: false,
        wheel: false
      }
    }).then(function () {
      console.log('[LaserStacks] renderer: ' + app.renderer.name);
      // Only draw while the game screen is up (startLoop/stopLoop) — the
      // ticker used to repaint the hidden table behind every menu.
      app.ticker.stop();
      app.ticker.add(probeCanvasHealth, null, PIXI.UPDATE_PRIORITY.UTILITY);

      // Pre-render all textures
      buildCardTextures();
      buildShadowTexture();
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

      // Render table and particles
      updateTableTexture();
      initPixiParticles();
    });

    return initPromise;
  }

  function resize() {
    if (!app || !app.renderer) return;
    // Size the bitmap from the canvas parent's CLIENT box so canvas pixels
    // and DOM overlay pixels share one coordinate space. On iPad Safari,
    // window.innerHeight includes the collapsing URL-bar zone while the
    // layout viewport doesn't — sizing from window.inner* there squashed
    // the drawn table vertically under the CSS box, so the top/bottom
    // avatars floated off the wood while left/right stayed tangent.
    // Fall back to window.inner* if the parent briefly reports 0 during
    // CSS screen transitions.
    var parent = app.canvas.parentElement;
    var newW = (parent && parent.clientWidth) || window.innerWidth;
    var newH = (parent && parent.clientHeight) || window.innerHeight;
    if (newW === 0 || newH === 0) return;
    W = newW;
    H = newH;
    refreshLayoutMetrics();
    app.renderer.resize(W, H);
    updateTableTexture(); // cache-guarded — no-op when the size is unchanged
    initPixiParticles();
    markDirty();
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

  function drawDeck(x, y, count) {
    var stackHeight = Math.min(count, 10);
    var deckScale = 1.1 * (Math.min(W, H) / 1080);
    var texScale = deckScale / TEX_SCALE;

    // Bottom shadow for the whole stack
    if (stackHeight > 0) {
      var shadow = acquireSprite();
      shadow.texture = shadowTexture;
      shadow.position.set(x + 3, y + 5);
      shadow.scale.set(texScale);
      shadow.alpha = 0.2;
    }

    for (var i = 0; i < stackHeight; i++) {
      var offset = i * 0.8;
      var s = acquireSprite();
      s.texture = backTexture;
      s.position.set(x - offset, y - offset);
      s.scale.set(texScale);
    }
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
        markDirty(); // the frame after a landing must redraw the resting card
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
    markDirty();
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

  // Health check (30's v126): every ~60 frames verify the table sprite
  // still has a real texture — a silent context loss or a 0x0-race can
  // leave it empty. Cooldown prevents rebuild thrash.
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
      try { updateTableTexture(true); } catch (e) { /* ignore */ }
      _healthCooldownFrames = 120;
    }
  }

  function startLoop(callback) {
    gameRenderCallback = callback;
    _dirty = true; // first frame always renders
    if (tickerFn) app.ticker.remove(tickerFn);
    tickerFn = function () {
      try {
        // ALWAYS-RUN PASS — cheap fixed-cost work: ambient particle
        // drift and the health check (context-loss recovery must never
        // be gated out).
        checkTableHealth();
        updateParticles();

        // CONDITIONAL PASS — the full scene rebuild. Skipped when
        // nothing changed since the last render (30's v125 gate); this
        // is what makes an idle table cost ~nothing per frame.
        var forceRender = (typeof window !== 'undefined' && window.DEBUG_RENDER_FORCE);
        var needsCondPass = forceRender || _dirty || flyingCards.length > 0 || _activeAnims > 0;
        if (!needsCondPass) {
          return;
        }
        _dirty = false;

        // Reset sprite pool
        poolIndex = 0;

        // Call game render callback (populates gameLayer via drawCard/drawDeck calls)
        if (gameRenderCallback) {
          gameRenderCallback(null, W, H);
        }

        // Hide unused pool sprites
        for (var i = poolIndex; i < spritePool.length; i++) {
          spritePool[i].visible = false;
        }

        // Sync flying card sprite positions
        syncAllFlyingCards();
      } catch (err) {
        // Keep the ticker alive through a bad frame (e.g. mid-resize),
        // and retry next frame rather than locking into a skip state.
        console && console.warn && console.warn('render frame error:', err);
        _dirty = true;
      }
    };
    app.ticker.add(tickerFn);
    app.ticker.start();
  }

  function stopLoop() {
    if (tickerFn && app) {
      app.ticker.remove(tickerFn);
    }
    tickerFn = null;
    gameRenderCallback = null;
    // Nothing on the menus needs the canvas — stop drawing it entirely
    if (app && app.ticker) app.ticker.stop();
  }

  // ================================================================
  //  ANIMATION HELPERS
  // ================================================================

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  // Uses setTimeout with elapsed-time progress, so throttled frames
  // never slow the animation clock. Tracks _activeAnims so the
  // dirty-frame gate keeps rendering for the tween's whole duration.
  function animate(duration, onUpdate, onComplete) {
    var start = performance.now();
    var interval = 16; // ~60fps
    _activeAnims++;
    function tick() {
      var now = performance.now();
      var t = Math.min((now - start) / duration, 1);
      onUpdate(t);
      markDirty();
      if (t < 1) {
        setTimeout(tick, interval);
      } else {
        _activeAnims = Math.max(0, _activeAnims - 1);
        markDirty();
        if (onComplete) onComplete();
      }
    }
    setTimeout(tick, interval);
  }

  // ================================================================
  //  TABLE GEOMETRY (30's vmin system, adapted for the bottom hand-bar)
  // ================================================================

  // Universal scale unit: 1 vmin in pixels. All table-world dimensions
  // derive from this so the layout stays proportional on every screen.
  // ui.js has an identical DOM-side getVmin() — keep the two in sync.
  function getVmin() {
    return Math.min(W, H) / 100;
  }

  // Wood border thickness (proportional for a consistent look)
  function getWoodBorder() {
    return 2.5 * getVmin();
  }

  // ---- Phone-portrait board (v2.8, MK's ask) ----
  // A portrait phone has far more height than the round table needs, so
  // the board is pinned near the top and the hand bar takes the whole
  // bottom in two big rows. Pure function of the viewport size — ui.js
  // asks the same question (body.phone-portrait) so CSS and canvas agree.
  function isPhonePortrait(w, h) {
    return w <= 500 && h >= w * 1.3;
  }

  function getRemPx() {
    return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  }

  // env(safe-area-inset-*) isn't readable from JS directly; a hidden
  // probe padded with those insets reports them (notch / home bar).
  var _safeProbe = null;
  function getSafeAreaInsets() {
    if (!_safeProbe) {
      _safeProbe = document.createElement('div');
      _safeProbe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;' +
        'visibility:hidden;pointer-events:none;' +
        'padding-top:env(safe-area-inset-top, 0px);padding-bottom:env(safe-area-inset-bottom, 0px)';
      document.body.appendChild(_safeProbe);
    }
    var cs = getComputedStyle(_safeProbe);
    return { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  }

  // getTableCenter runs every animated frame — cache the DOM reads (a
  // style recalc per frame otherwise); resize() refreshes them.
  var _metrics = null;
  function getLayoutMetrics() {
    if (!_metrics) {
      var safe = getSafeAreaInsets();
      _metrics = { rem: getRemPx(), safeTop: safe.top, safeBottom: safe.bottom };
    }
    return _metrics;
  }
  function refreshLayoutMetrics() { _metrics = null; }

  function computeTableCenter(w, h) {
    var v = Math.min(w, h) / 100;
    if (isPhonePortrait(w, h)) {
      var m = getLayoutMetrics();
      var rem = m.rem;
      // The hand block — MIRRORS the body.phone-portrait CSS (--hc-gap,
      // --hc-w, --hc-h, --hand-top); change both together.
      var gap = 0.45 * rem;
      var cardW = Math.min((w - 1.4 * rem - 4 * gap) / 5, 5.6 * rem);
      var handTop = h - m.safeBottom - 0.7 * rem - 2 * (cardW * 1.4) - gap;
      // Free band between the HUD row and the status pill over the hand
      var bandTop = m.safeTop + 3.3 * rem;
      var bandBottom = handTop - 2.6 * rem;
      // Board extent: avatar orbit reach (34.4 + 3.9vmin) plus the setup
      // badge / lobby name above the top avatar and the name below the
      // bottom one
      var topReach = 38.3 * v + 1.9 * rem;
      var bottomReach = 38.3 * v + 1.4 * rem;
      var slack = bandBottom - bandTop - topReach - bottomReach;
      var centered = bandTop + slack / 2 + topReach;
      // Never above the highest spot that still clears the HUD
      return { x: w / 2, y: Math.max(bandTop + topReach, centered) };
    }
    // Shifted UP (30 shifts down 1.5vmin): Laser Stacks spends its bottom
    // band on the DOM hand-bar, so the table yields space at the bottom.
    return { x: w / 2, y: h / 2 - 4 * v };
  }

  function getTableCenter() {
    return computeTableCenter(W, H);
  }

  // Felt radius 28vmin (30 uses 32) — the difference is the hand-bar's home.
  //   28vmin felt + 2.5vmin wood = 30.5vmin outer radius.
  //   Avatar tangent: orbit = 30.5 + 3.9 = 34.4vmin.
  function getTableRadii() {
    var r = 28 * getVmin();
    return { rx: r, ry: r };
  }

  function getTableOuterRadius() {
    return getTableRadii().rx + getWoodBorder();
  }

  // Setup/lobby avatar radius (matches .seat-avatar CSS: 7.8vmin
  // diameter — same as in-game per MK's v2.5 consistency ask; both
  // screens now share the 34.4vmin tangent orbit)
  function getSetupAvatarRadius() {
    return 3.9 * getVmin();
  }

  // Game avatar radius (matches .game-seat-avatar CSS: 7.8vmin diameter)
  function getGameAvatarRadius() {
    return 3.9 * getVmin();
  }

  // Setup seats — avatar's inner edge exactly tangent to the table's
  // outer wood edge: adjacent to the table, never overlapping the felt.
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
    // 38% of the way from the seat toward the center (30 uses 34%) —
    // keeps the 5-wide fan's outer row clear of the seat statline while
    // leaving the trick pile room in the middle.
    return {
      x: seatPos.x + (tableCenter.x - seatPos.x) * 0.38,
      y: seatPos.y + (tableCenter.y - seatPos.y) * 0.38
    };
  }

  // Game seats — same tangency rule as setup, with the game avatar size.
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

  // ================================================================
  //  PUBLIC API
  // ================================================================

  return {
    init: init,
    resize: resize,
    drawCard: drawCard,
    drawDeck: drawDeck,
    startLoop: startLoop,
    stopLoop: stopLoop,
    addFlyingCard: addFlyingCard,
    removeFlyingCard: removeFlyingCard,
    clearFlyingCards: clearFlyingCards,
    animate: animate,
    easeOutCubic: easeOutCubic,
    getTableCenter: getTableCenter,
    computeTableCenter: computeTableCenter,
    isPhonePortrait: isPhonePortrait,
    refreshLayoutMetrics: refreshLayoutMetrics,
    getTableOuterRadius: getTableOuterRadius,
    getTableRadii: getTableRadii,
    getSeatPositions: getSeatPositions,
    getHandPosition: getHandPosition,
    getSeatOverlayPositions: getSeatOverlayPositions,
    setSuitStyle: setSuitStyle,
    getSuitStyle: getSuitStyle,
    getSuitColor: getSuitColor,
    rebuildCardTextures: rebuildCardTextures,
    markDirty: markDirty,
    // Exposed for card-viewer/visual-QA use (offscreen canvases)
    renderCardToImage: renderCardToImage,
    renderCardBackToImage: renderCardBackToImage,
    // Force a synchronous render and return the frame as a data URL
    // (WebGL back-buffers don't survive to async readback)
    captureFrame: function () {
      if (!app || !app.renderer) return null;
      if (tickerFn) tickerFn();
      app.renderer.render(app.stage);
      return app.canvas.toDataURL('image/png');
    },
    // Console diagnostics for the white-canvas guard
    getHealthInfo: function () {
      return {
        renderer: app && app.renderer ? app.renderer.name : null,
        tickerRunning: !!(app && app.ticker && app.ticker.started),
        lastProbeRGBA: Array.prototype.slice.call(_probePx),
        heals: _probeHeals
      };
    },
    CARD_W: CARD_W,
    CARD_H: CARD_H
  };
})();

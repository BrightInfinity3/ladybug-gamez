/* ============================================================
   Solitairra - PixiJS Renderer
   WebGL-accelerated rendering for Klondike solitaire
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

  // ---- Card dimensions ----
  var CARD_W = 70;
  var CARD_H = 100;
  var CARD_R = 7;
  var TEX_SCALE = 2;

  // ---- Colors ----
  var FELT_DARK = '#0a4420';
  var FELT_MID = '#147a3a';
  var FELT_LIGHT = '#1a9848';
  var SUIT_RED = '#b71c1c';
  var SUIT_BLACK = '#1a1a1a';
  var SUIT_BLUE = '#1565C0';
  var BACK_DARK = '#0d1a3d';
  var BACK_LIGHT = '#1a2a5c';

  // ---- Suit symbols ----
  var SUIT_SYM = { hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663', spades: '\u2660' };
  var SUIT_GREEN = '#1B5E20';
  var SUIT_RED = '#8B0000';
  var SUIT_COLORS = { hearts: SUIT_GREEN, diamonds: SUIT_BLUE, clubs: SUIT_BLACK, spades: SUIT_RED };

  // ---- Suit Skin Configuration ----
  // 'animals' = custom drawn animal pips (default), 'laser' = laser pips, 'classic' = standard Unicode symbols
  var suitSkins = {
    diamonds: 'animals',  // Dolphins (animals) / Diodes (laser) / diamonds (classic)
    hearts: 'animals',    // Hares (animals) / Prisms (laser) / hearts (classic)
    spades: 'animals',    // Spiders (animals) / Blades (laser) / spades (classic)
    clubs: 'animals'      // Cubs (animals) / Combiners (laser) / clubs (classic)
  };

  // Animal suit colors (single default scheme — no variants yet)
  var ANIMAL_COLORS = {
    diamonds: '#1565C0',  // Dolphin blue
    hearts:   '#8B4513',  // Hare saddle brown
    spades:   '#1a1a1a',  // Spider black
    clubs:    '#3E2723'   // Cub dark brown
  };

  // Diode color schemes
  var DIODE_SCHEMES = {
    red: {
      color: '#b71c1c',
      glow: ['rgba(255, 100, 100, 0.35)', 'rgba(255, 60, 60, 0.12)', 'rgba(255, 40, 40, 0)'],
      body: ['#ffa0a0', '#ff4a4a', '#b71c1c', '#7f0000'],
      outline: 'rgba(127, 0, 0, 0.6)',
      highlight: ['rgba(255, 255, 255, 0.7)', 'rgba(255, 180, 180, 0.3)', 'rgba(255, 100, 100, 0)']
    },
    blue: {
      color: '#1565C0',
      glow: ['rgba(100, 180, 255, 0.35)', 'rgba(60, 140, 255, 0.12)', 'rgba(40, 120, 255, 0)'],
      body: ['#a0d4ff', '#4a9eff', '#1565C0', '#0d47a1'],
      outline: 'rgba(13, 71, 161, 0.6)',
      highlight: ['rgba(255, 255, 255, 0.7)', 'rgba(180, 220, 255, 0.3)', 'rgba(100, 180, 255, 0)']
    },
    orange: {
      color: '#e65100',
      glow: ['rgba(255, 160, 50, 0.35)', 'rgba(255, 130, 30, 0.12)', 'rgba(255, 110, 10, 0)'],
      body: ['#ffcc80', '#ff9800', '#e65100', '#bf360c'],
      outline: 'rgba(191, 54, 12, 0.6)',
      highlight: ['rgba(255, 255, 255, 0.7)', 'rgba(255, 220, 180, 0.3)', 'rgba(255, 160, 80, 0)']
    },
    green: {
      color: '#2E7D32',
      glow: ['rgba(100, 220, 100, 0.35)', 'rgba(60, 180, 60, 0.12)', 'rgba(40, 160, 40, 0)'],
      body: ['#a5d6a7', '#66bb6a', '#2E7D32', '#1B5E20'],
      outline: 'rgba(27, 94, 32, 0.6)',
      highlight: ['rgba(255, 255, 255, 0.7)', 'rgba(180, 255, 180, 0.3)', 'rgba(100, 220, 100, 0)']
    }
  };

  // Prism color schemes
  var PRISM_SCHEMES = {
    red: {
      color: '#c62828',
      beamColors: ['#8B0000', '#c62828', '#ff6666'],  // dark red, red, light red
      beamLabel: 'Red'
    },
    blue: {
      color: '#1565C0',
      beamColors: ['#0D47A1', '#1565C0', '#64B5F6'],  // dark blue, blue, light blue
      beamLabel: 'Blue'
    },
    warm: {
      color: '#ff6d00',
      beamColors: ['#c62828', '#ff6d00', '#f9a825'],
      beamLabel: 'Warm'
    },
    cool: {
      color: '#4527A0',
      beamColors: ['#1565C0', '#4527A0', '#7B1FA2'],
      beamLabel: 'Cool'
    },
    hybrid: {
      color: '#1B5E20',
      beamColors: ['#c62828', '#1B6B1B', '#1565C0'],
      beamLabel: 'Hybrid'
    }
  };

  // Blade color schemes
  var BLADE_SCHEMES = {
    black: {
      color: '#1a1a1a',
      hasGlow: false,
      glowColor: null
    },
    red: {
      color: '#8B0000',
      hasGlow: true,
      glowColor: [255, 50, 50]
    },
    blue: {
      color: '#1565C0',
      hasGlow: true,
      glowColor: [50, 100, 255]
    }
  };

  // Combiner color schemes
  var COMBINER_SCHEMES = {
    black: {
      color: '#1a1a1a',
      beamColors: ['#1a1a1a', '#1a1a1a'],
      outputColor: '#ffffff',
      outputBorder: '#1a1a1a',
      beamLabel: 'Black'
    },
    red: {
      color: '#c62828',
      beamColors: ['#c62828', '#c62828'],
      outputColor: '#c62828',
      beamLabel: 'Red'
    },
    blue: {
      color: '#1565C0',
      beamColors: ['#1565C0', '#1565C0'],
      outputColor: '#1565C0',
      beamLabel: 'Blue'
    },
    warm: {
      color: '#ff6d00',
      beamColors: ['#c62828', '#f9a825'],
      outputColor: '#ff6d00',
      beamLabel: 'Warm'
    },
    cool: {
      color: '#4527A0',
      beamColors: ['#1565C0', '#7B1FA2'],
      outputColor: '#4527A0',
      beamLabel: 'Cool'
    },
    hybrid: {
      color: '#1a1a1a',
      beamColors: ['#c62828', '#1565C0'],
      outputColor: '#ffffff',
      outputBorder: null,
      hybridOutput: true,
      beamLabel: 'Hybrid'
    }
  };

  // Active scheme selections
  var activeDiodeScheme = 'red';
  var activePrismScheme = 'red';
  var activeBladeScheme = 'black';
  var activeCombinerScheme = 'black';
  var activeBladeStyle = 'fan'; // 'blade', 'sai', or 'fan'

  function setSuitSkin(suit, skin) {
    suitSkins[suit] = skin;
  }

  function setDiodeScheme(scheme) {
    activeDiodeScheme = DIODE_SCHEMES[scheme] ? scheme : 'blue';
  }

  function setPrismScheme(scheme) {
    activePrismScheme = PRISM_SCHEMES[scheme] ? scheme : 'red';
  }

  function setBladeScheme(scheme) {
    activeBladeScheme = BLADE_SCHEMES[scheme] ? scheme : 'black';
  }

  function setBladeStyle(style) {
    activeBladeStyle = (style === 'sai' || style === 'fan') ? style : 'blade';
  }

  function setCombinerScheme(scheme) {
    activeCombinerScheme = COMBINER_SCHEMES[scheme] ? scheme : 'black';
  }

  function getSuitSkins() {
    return { skins: suitSkins, diodeScheme: activeDiodeScheme, prismScheme: activePrismScheme, bladeScheme: activeBladeScheme, bladeStyle: activeBladeStyle, combinerScheme: activeCombinerScheme };
  }

  function isCustomSuit(suit) {
    return suitSkins[suit] === 'laser';
  }

  function isAnimalsSuit(suit) {
    return suitSkins[suit] === 'animals';
  }

  function getSuitColor(suit) {
    if (suitSkins[suit] === 'animals') {
      // Rank text for Hares (hearts) is pink, not the brown of the illustration itself.
      if (suit === 'hearts') return '#E91E63';
      return ANIMAL_COLORS[suit];
    }
    if (suit === 'diamonds' && suitSkins.diamonds === 'laser') {
      return DIODE_SCHEMES[activeDiodeScheme].color;
    }
    if (suit === 'hearts' && suitSkins.hearts === 'laser') {
      return PRISM_SCHEMES[activePrismScheme].color;
    }
    if (suit === 'spades' && suitSkins.spades === 'laser') return BLADE_SCHEMES[activeBladeScheme].color;
    if (suit === 'clubs' && suitSkins.clubs === 'laser') return COMBINER_SCHEMES[activeCombinerScheme].color;
    if (suit === 'clubs') return SUIT_BLACK;
    // Classic suits
    if (suit === 'diamonds') return '#c41e1e';
    if (suit === 'hearts') return '#c41e1e';
    if (suit === 'spades') return SUIT_BLACK;
    return SUIT_COLORS[suit];
  }

  // ---- Mini corner pip for laser/animals suits ----
  function drawCornerPip(c, x, y, suit, flip) {
    var miniSize = 7;
    if (isAnimalsSuit(suit)) {
      drawAnimalPip(c, x, y, miniSize, suit, flip);
      return;
    }
    if (suit === 'diamonds') {
      drawDiodePip(c, x, y, miniSize, flip);
    } else if (suit === 'hearts') {
      drawPrismPip(c, x, y, miniSize, flip, false);
    } else if (suit === 'spades') {
      drawBladeAny(c, x, y, miniSize, flip);
    } else if (suit === 'clubs') {
      drawCombinerPip(c, x, y, miniSize, flip, false);
    }
  }

  // ---- Diode (LED) pip drawing ----
  function drawDiodePip(c, x, y, size, flip) {
    var scheme = DIODE_SCHEMES[activeDiodeScheme];
    c.save();
    c.translate(x, y);
    if (flip) c.rotate(Math.PI);

    var s = size / 20; // normalize to base size of 20

    // LED body (dome/capsule)
    var bodyW = 6.84 * s;
    var bodyH = 11 * s;
    var domeR = bodyW;
    var rawBodyTop = -bodyH * 0.35;
    var rawBodyBot = bodyH * 0.35;
    var rawLegBot = rawBodyBot + 1.5 * s + 4 * s + 1 * s; // legTop + legLen + extra
    var rawDomeTop = rawBodyTop - domeR;
    var centerOffset = (rawDomeTop + rawLegBot) / 2;
    c.translate(0, -centerOffset);
    var bodyTop = rawBodyTop;
    var bodyBot = rawBodyBot;

    // Outer glow
    var glowGrad = c.createRadialGradient(0, bodyTop - 1 * s, 1 * s, 0, bodyTop, domeR * 1.6);
    glowGrad.addColorStop(0, scheme.glow[0]);
    glowGrad.addColorStop(0.5, scheme.glow[1]);
    glowGrad.addColorStop(1, scheme.glow[2]);
    c.fillStyle = glowGrad;
    c.beginPath();
    c.arc(0, bodyTop, domeR * 1.5, 0, Math.PI * 2);
    c.fill();

    // Glass dome (top rounded part)
    c.beginPath();
    c.arc(0, bodyTop, domeR, Math.PI, 0); // top semicircle
    c.lineTo(bodyW, bodyBot); // right side
    c.lineTo(-bodyW, bodyBot); // bottom to left
    c.closePath();

    var bodyGrad = c.createLinearGradient(-bodyW, bodyTop - domeR, bodyW, bodyBot);
    bodyGrad.addColorStop(0, scheme.body[0]);
    bodyGrad.addColorStop(0.3, scheme.body[1]);
    bodyGrad.addColorStop(0.6, scheme.body[2]);
    bodyGrad.addColorStop(1, scheme.body[3]);
    c.fillStyle = bodyGrad;
    c.fill();

    // Outline
    c.strokeStyle = scheme.outline;
    c.lineWidth = 0.6 * s;
    c.stroke();

    // Inner highlight (bright spot)
    var hlGrad = c.createRadialGradient(-1 * s, bodyTop - 2 * s, 0.5 * s, 0, bodyTop, domeR * 0.7);
    hlGrad.addColorStop(0, scheme.highlight[0]);
    hlGrad.addColorStop(0.3, scheme.highlight[1]);
    hlGrad.addColorStop(1, scheme.highlight[2]);
    c.fillStyle = hlGrad;
    c.beginPath();
    c.arc(0, bodyTop, domeR * 0.85, Math.PI, 0);
    c.lineTo(bodyW * 0.85, bodyBot * 0.5);
    c.lineTo(-bodyW * 0.85, bodyBot * 0.5);
    c.closePath();
    c.fill();

    // Base/rim at bottom of LED body
    c.fillStyle = '#546E7A';
    c.fillRect(-bodyW * 0.9, bodyBot - 1 * s, bodyW * 1.8, 2.5 * s);
    c.strokeStyle = 'rgba(0,0,0,0.2)';
    c.lineWidth = 0.3 * s;
    c.strokeRect(-bodyW * 0.9, bodyBot - 1 * s, bodyW * 1.8, 2.5 * s);

    // Wire leads (two legs)
    var legTop = bodyBot + 1.5 * s;
    var legLen = 4 * s;
    c.strokeStyle = '#78909C';
    c.lineWidth = 0.8 * s;
    c.lineCap = 'round';

    // Left leg (shorter, with bend)
    c.beginPath();
    c.moveTo(-2.5 * s, legTop);
    c.lineTo(-2.5 * s, legTop + legLen * 0.6);
    c.lineTo(-3.5 * s, legTop + legLen);
    c.stroke();

    // Right leg (longer)
    c.beginPath();
    c.moveTo(2.5 * s, legTop);
    c.lineTo(2.5 * s, legTop + legLen);
    c.lineTo(3.5 * s, legTop + legLen + 1 * s);
    c.stroke();

    c.restore();
  }

  // Draw a small diode for corner symbol
  function drawCornerDiode(c, x, y, size) {
    drawDiodePip(c, x, y, size, false);
  }

  // ---- Prism (replaces Hearts) pip drawing ----
  function drawPrismPip(c, x, y, size, flip, dimGlow) {
    c.save();
    c.translate(x, y);
    if (flip) c.rotate(Math.PI);

    var s = size / 20;

    // Prism triangle (equilateral, reduced 10%)
    var pw = 6.84 * s;     // half-width at base
    var ph = 13.68 * s;    // height
    var topY = -ph * 0.42;
    var botY = ph * 0.42;

    // Offset prism slightly up-left so beams feel centered
    var prismOX = -0.5 * s;
    var prismOY = -0.5 * s;

    // Beam parameters (reduced 20% from original 1.6)
    var beamW = 1.28 * s;

    // Convergence point (center of prism)
    var convX = prismOX;
    var convY = prismOY + botY * 0.15;

    // Beam colors from active scheme
    var pScheme = PRISM_SCHEMES[activePrismScheme];
    var inColors = pScheme.beamColors;
    // Beam widths: uniform for all 3 incoming beams and single outgoing beam
    var beamWidths = [beamW, beamW, beamW];
    // Broad outgoing beam keeps original bolder widths for its colored borders
    var hybridBorderWidths = [beamW * 1.4, beamW * 1.4, beamW * 1.3];

    // Outgoing beam Y positions (red=-beamW, green=0, blue=+beamW)
    // Red top edge at convY - beamW - beamW/2 = convY - 1.5*beamW
    var outYs = [convY - beamW, convY, convY + beamW];

    // Incoming beams start X and end at convergence (clipped 5%: 2.5% each side, then rays shortened 10%)
    var totalBeamW = pw * 3;
    var clipAmount = totalBeamW * 0.025;
    var fullInStartX = prismOX - pw * 1.5 + clipAmount;
    var fullOutEndX = prismOX + pw * 1.5 - clipAmount;
    var inRayLen = convX - fullInStartX;
    var outRayLen = fullOutEndX - convX;
    var inStartX = fullInStartX + inRayLen * 0.1;
    var outEndX = fullOutEndX + outRayLen * 0.08; // extended 20% beyond original

    // Incoming beam spread — shallower angle
    // Red arrives so its top edge aligns with outgoing red top edge
    // Red outgoing center = convY - beamW, top = convY - beamW - beamW/2
    // So incoming red should arrive at convY - beamW (same center as outgoing)
    var inSpread = 2.1 * s; // spread between beams at left edge (steeper angle of incidence)
    var inYs = [convY - inSpread * 2.5, convY, convY + inSpread * 2.5];

    // --- Draw order: shadow, prism body, beams ON TOP of prism, then white glow on top ---

    // Drop shadow behind prism
    c.save();
    c.beginPath();
    c.moveTo(prismOX + 1.5 * s, topY + prismOY + 2 * s);
    c.lineTo(pw + prismOX + 1.5 * s, botY + prismOY + 2 * s);
    c.lineTo(-pw + prismOX + 1.5 * s, botY + prismOY + 2 * s);
    c.closePath();
    c.fillStyle = 'rgba(0, 0, 0, 0.12)';
    c.fill();
    c.restore();

    // Prism body (triangle)
    c.beginPath();
    c.moveTo(prismOX, topY + prismOY);
    c.lineTo(pw + prismOX, botY + prismOY);
    c.lineTo(-pw + prismOX, botY + prismOY);
    c.closePath();

    // Glass fill
    var glassGrad = c.createLinearGradient(-pw + prismOX, topY + prismOY, pw + prismOX, botY + prismOY);
    glassGrad.addColorStop(0, 'rgba(210, 230, 250, 0.8)');
    glassGrad.addColorStop(0.25, 'rgba(185, 210, 240, 0.65)');
    glassGrad.addColorStop(0.5, 'rgba(160, 195, 230, 0.55)');
    glassGrad.addColorStop(0.75, 'rgba(135, 175, 215, 0.5)');
    glassGrad.addColorStop(1, 'rgba(110, 155, 200, 0.65)');
    c.fillStyle = glassGrad;
    c.fill();

    // Prism outline
    c.strokeStyle = 'rgba(40, 70, 110, 0.6)';
    c.lineWidth = 0.8 * s;
    c.lineJoin = 'round';
    c.stroke();

    // Left face highlight
    c.beginPath();
    c.moveTo(prismOX, topY + prismOY + 1.5 * s);
    c.lineTo(-pw + prismOX + 2 * s, botY + prismOY - 1 * s);
    c.lineTo(-pw + prismOX + 4 * s, botY + prismOY - 1 * s);
    c.lineTo(prismOX + 1.2 * s, topY + prismOY + 2.5 * s);
    c.closePath();
    c.fillStyle = 'rgba(255, 255, 255, 0.35)';
    c.fill();

    // Right face darker tint
    c.beginPath();
    c.moveTo(prismOX + 1 * s, topY + prismOY + 3 * s);
    c.lineTo(pw + prismOX - 1 * s, botY + prismOY - 1 * s);
    c.lineTo(pw + prismOX, botY + prismOY);
    c.lineTo(prismOX, topY + prismOY);
    c.closePath();
    c.fillStyle = 'rgba(30, 60, 100, 0.08)';
    c.fill();

    // --- Beams drawn ON TOP of prism body ---

    // Incoming beams (left — R, G, B converging into prism center, shallower angle)
    // For placeholder (dimGlow), extend each beam until it touches the opaque core circle
    var coreR = 2.4 * s;
    c.save();
    c.globalAlpha = 0.85;
    for (var bi = 0; bi < 3; bi++) {
      var beamEndX = convX;
      var beamEndY = outYs[bi];
      if (dimGlow) {
        // Find where the beam line intersects the core circle centered at (convX, convY)
        // Beam goes from (inStartX, inYs[bi]) toward (convX, outYs[bi])
        // Parameterize: P(t) = start + t*(end-start), find t where |P(t) - center|^2 = coreR^2
        var dx = beamEndX - inStartX;
        var dy = beamEndY - inYs[bi];
        var fx = inStartX - convX;
        var fy = inYs[bi] - convY;
        var a = dx * dx + dy * dy;
        var b = 2 * (fx * dx + fy * dy);
        var cc = fx * fx + fy * fy - coreR * coreR;
        var disc = b * b - 4 * a * cc;
        if (disc >= 0) {
          var t = (-b - Math.sqrt(disc)) / (2 * a);
          beamEndX = inStartX + dx * t;
          beamEndY = inYs[bi] + dy * t;
        }
      }
      c.beginPath();
      c.moveTo(inStartX, inYs[bi]);
      c.lineTo(beamEndX, beamEndY);
      c.strokeStyle = inColors[bi];
      c.lineWidth = beamWidths[bi];
      c.lineCap = 'butt';
      c.stroke();
    }
    c.restore();

    // Outgoing beam(s) on right side
    // For placeholder (dimGlow), start outgoing beams at edge of opaque core circle
    var outStartX = dimGlow ? convX + coreR : convX;
    c.save();
    c.globalAlpha = 0.85;
    if (activePrismScheme === 'hybrid') {
      // Hybrid: wide merged white beam with colored borders (uses original bolder widths)
      var outTopY = outYs[0] - hybridBorderWidths[0] / 2;
      var outBotY = outYs[2] + hybridBorderWidths[2] / 2;
      var halfRedW = hybridBorderWidths[0] / 2;
      var halfBlueW = hybridBorderWidths[2] / 2;
      c.beginPath();
      c.rect(outStartX, outTopY, outEndX - outStartX, outBotY - outTopY);
      c.fillStyle = dimGlow ? 'rgba(255, 255, 255, 0.4)' : '#ffffff';
      c.fill();
      c.beginPath();
      c.moveTo(outStartX, outTopY + halfRedW / 2);
      c.lineTo(outEndX, outTopY + halfRedW / 2);
      c.strokeStyle = inColors[0];
      c.lineWidth = halfRedW;
      c.lineCap = 'butt';
      c.stroke();
      c.beginPath();
      c.moveTo(outStartX, outBotY - halfBlueW / 2);
      c.lineTo(outEndX, outBotY - halfBlueW / 2);
      c.strokeStyle = inColors[2];
      c.lineWidth = halfBlueW;
      c.lineCap = 'butt';
      c.stroke();
    } else {
      // Warm/Cool: single output beam matching the middle input beam
      c.beginPath();
      c.moveTo(outStartX, convY);
      c.lineTo(outEndX, convY);
      c.strokeStyle = inColors[1]; // middle beam color (orange for warm, indigo for cool)
      c.lineWidth = beamWidths[1];
      c.lineCap = 'butt';
      c.stroke();
    }
    c.restore();

    // --- White glow on top of everything (obscures beam merge) ---
    // Larger, brighter glow for placeholder (dimGlow) to fully hide beam ends
    var glowR = dimGlow ? 10 * s : 7.5 * s;
    var convGlow = c.createRadialGradient(convX, convY, 0, convX, convY, glowR);
    if (dimGlow) {
      convGlow.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
      convGlow.addColorStop(0.2, 'rgba(255, 255, 255, 1.0)');
      convGlow.addColorStop(0.4, 'rgba(255, 255, 255, 0.85)');
      convGlow.addColorStop(0.6, 'rgba(240, 248, 255, 0.5)');
      convGlow.addColorStop(0.8, 'rgba(220, 235, 255, 0.15)');
      convGlow.addColorStop(1, 'rgba(200, 220, 255, 0)');
    } else {
      convGlow.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
      convGlow.addColorStop(0.15, 'rgba(255, 255, 255, 1.0)');
      convGlow.addColorStop(0.3, 'rgba(255, 255, 255, 1.0)');
      convGlow.addColorStop(0.5, 'rgba(240, 248, 255, 0.53)');
      convGlow.addColorStop(0.75, 'rgba(220, 235, 255, 0.15)');
      convGlow.addColorStop(1, 'rgba(200, 220, 255, 0)');
    }
    c.fillStyle = convGlow;
    c.beginPath();
    c.arc(convX, convY, glowR, 0, Math.PI * 2);
    c.fill();

    // Small solid white core for placeholder to fully hide beam ends at convergence
    if (dimGlow) {
      c.save();
      c.globalAlpha = 1.0;
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(convX, convY, 2.4 * s, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }

    // Apex highlight (bright point at top)
    var apexGlow = c.createRadialGradient(prismOX, topY + prismOY + 2 * s, 0, prismOX, topY + prismOY + 2 * s, 3 * s);
    apexGlow.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
    apexGlow.addColorStop(0.5, 'rgba(220, 240, 255, 0.15)');
    apexGlow.addColorStop(1, 'rgba(200, 220, 255, 0)');
    c.fillStyle = apexGlow;
    c.beginPath();
    c.arc(prismOX, topY + prismOY + 2 * s, 3 * s, 0, Math.PI * 2);
    c.fill();

    // Bottom edge subtle highlight line
    c.beginPath();
    c.moveTo(-pw + prismOX + 2 * s, botY + prismOY - 0.5 * s);
    c.lineTo(pw + prismOX - 2 * s, botY + prismOY - 0.5 * s);
    c.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    c.lineWidth = 0.4 * s;
    c.lineCap = 'round';
    c.stroke();

    c.restore();
  }

  function drawCornerPrism(c, x, y, size) {
    drawPrismPip(c, x, y, size * 1.3, false);
  }

  // ---- Blade (replaces Spades) pip drawing ----
  function drawBladePip(c, x, y, size, flip) {
    c.save();
    c.translate(x, y);
    if (flip) c.rotate(Math.PI);

    var s = size / 20;

    // Vertical sword: handle at bottom, blade pointing up
    // Bigger overall proportions

    // Dimensions
    var bladeHW = 2.14 * s;   // blade half-width (reduced 15%)
    var bladeLen = 16 * s;    // rectangular portion length
    var tipLen = 4 * s;       // triangle tip length
    var guardHW = 4.28 * s;   // crossguard half-width (reduced 15%)
    var guardH = 1.8 * s;     // crossguard height
    var gripHW = 1.37 * s;    // grip half-width (reduced 15%)
    var gripLen = 7 * s;      // grip length

    // Center the sword vertically: shift so visual center is at y=0
    var rawTipTop = -bladeLen - tipLen + 2 * s;
    var rawGripBot = 2 * s + guardH + gripLen;
    var centerOffset = (rawTipTop + rawGripBot) / 2;
    c.translate(0, -centerOffset);

    // Y positions (original coordinates, centering handled by translate)
    var tipTop = -bladeLen - tipLen + 2 * s;
    var bladeTop = -bladeLen + 2 * s;
    var bladeBot = 2 * s;     // where blade meets crossguard
    var guardTop = bladeBot;
    var guardBot = guardTop + guardH;
    var gripTop = guardBot;
    var gripBot = gripTop + gripLen;

    // --- Edge glow (conditional on blade scheme) ---
    var bScheme = BLADE_SCHEMES[activeBladeScheme];
    if (bScheme.hasGlow) {
      var gR = bScheme.glowColor[0], gG = bScheme.glowColor[1], gB = bScheme.glowColor[2];
      c.save();
      c.globalAlpha = 0.4;
      var glowW = 4 * s;
      var leftGlow = c.createLinearGradient(-bladeHW - glowW, 0, -bladeHW, 0);
      leftGlow.addColorStop(0, 'rgba(' + gR + ',' + gG + ',' + gB + ',0)');
      leftGlow.addColorStop(1, 'rgba(' + gR + ',' + gG + ',' + gB + ',1)');
      c.fillStyle = leftGlow;
      c.beginPath();
      c.moveTo(0, tipTop);
      c.lineTo(-glowW, tipTop);
      c.lineTo(-bladeHW - glowW, bladeTop);
      c.lineTo(-bladeHW - glowW, bladeBot);
      c.lineTo(-bladeHW, bladeBot);
      c.lineTo(-bladeHW, bladeTop);
      c.closePath();
      c.fill();
      var rightGlow = c.createLinearGradient(bladeHW, 0, bladeHW + glowW, 0);
      rightGlow.addColorStop(0, 'rgba(' + gR + ',' + gG + ',' + gB + ',1)');
      rightGlow.addColorStop(1, 'rgba(' + gR + ',' + gG + ',' + gB + ',0)');
      c.fillStyle = rightGlow;
      c.beginPath();
      c.moveTo(0, tipTop);
      c.lineTo(glowW, tipTop);
      c.lineTo(bladeHW + glowW, bladeTop);
      c.lineTo(bladeHW + glowW, bladeBot);
      c.lineTo(bladeHW, bladeBot);
      c.lineTo(bladeHW, bladeTop);
      c.closePath();
      c.fill();
      var tipGlow = c.createRadialGradient(0, tipTop, 0, 0, tipTop, 5 * s);
      tipGlow.addColorStop(0, 'rgba(' + gR + ',' + gG + ',' + gB + ',0.7)');
      tipGlow.addColorStop(0.4, 'rgba(' + gR + ',' + gG + ',' + gB + ',0.3)');
      tipGlow.addColorStop(1, 'rgba(' + gR + ',' + gG + ',' + gB + ',0)');
      c.fillStyle = tipGlow;
      c.beginPath();
      c.arc(0, tipTop, 5 * s, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }

    // --- Blade body (rectangle + triangle tip) ---
    c.beginPath();
    // Triangle tip
    c.moveTo(0, tipTop);                    // sharp point
    c.lineTo(bladeHW, bladeTop);            // right shoulder
    // Rectangular body
    c.lineTo(bladeHW, bladeBot);            // right bottom
    c.lineTo(-bladeHW, bladeBot);           // left bottom
    c.lineTo(-bladeHW, bladeTop);           // left shoulder
    c.closePath();

    // Steel/dark blade gradient
    var bladeGrad = c.createLinearGradient(-bladeHW, 0, bladeHW, 0);
    bladeGrad.addColorStop(0, '#888888');
    bladeGrad.addColorStop(0.15, '#aaaaaa');
    bladeGrad.addColorStop(0.4, '#cccccc');
    bladeGrad.addColorStop(0.5, '#dddddd');
    bladeGrad.addColorStop(0.6, '#cccccc');
    bladeGrad.addColorStop(0.85, '#aaaaaa');
    bladeGrad.addColorStop(1, '#888888');
    c.fillStyle = bladeGrad;
    c.fill();

    // Blade outline
    c.strokeStyle = 'rgba(40, 40, 40, 0.6)';
    c.lineWidth = 0.5 * s;
    c.lineJoin = 'round';
    c.stroke();

    // Center fuller (groove down blade center)
    c.beginPath();
    c.moveTo(0, tipTop + 3 * s);
    c.lineTo(0, bladeBot - 1 * s);
    c.strokeStyle = 'rgba(0, 0, 0, 0.12)';
    c.lineWidth = 1.2 * s;
    c.stroke();
    // Fuller highlight
    c.beginPath();
    c.moveTo(0.4 * s, tipTop + 3.5 * s);
    c.lineTo(0.4 * s, bladeBot - 1.5 * s);
    c.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    c.lineWidth = 0.4 * s;
    c.stroke();

    // Subtle edge lines (along full blade including tip) — only for glow variants
    if (bScheme.hasGlow) {
      var eR = bScheme.glowColor[0], eG = bScheme.glowColor[1], eB = bScheme.glowColor[2];
      c.beginPath();
      c.moveTo(0, tipTop);
      c.lineTo(-bladeHW, bladeTop);
      c.lineTo(-bladeHW, bladeBot);
      c.strokeStyle = 'rgba(' + eR + ',' + eG + ',' + eB + ',0.35)';
      c.lineWidth = 0.7 * s;
      c.stroke();
      c.beginPath();
      c.moveTo(0, tipTop);
      c.lineTo(bladeHW, bladeTop);
      c.lineTo(bladeHW, bladeBot);
      c.strokeStyle = 'rgba(' + eR + ',' + eG + ',' + eB + ',0.35)';
      c.lineWidth = 0.7 * s;
      c.stroke();
    }

    // --- Crossguard ---
    c.beginPath();
    c.rect(-guardHW, guardTop, guardHW * 2, guardH);
    var guardGrad = c.createLinearGradient(0, guardTop, 0, guardBot);
    guardGrad.addColorStop(0, '#3a3a3a');
    guardGrad.addColorStop(0.3, '#555555');
    guardGrad.addColorStop(0.5, '#606060');
    guardGrad.addColorStop(0.7, '#555555');
    guardGrad.addColorStop(1, '#3a3a3a');
    c.fillStyle = guardGrad;
    c.fill();
    c.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    c.lineWidth = 0.3 * s;
    c.stroke();

    // Guard end caps
    c.beginPath();
    c.arc(-guardHW, guardTop + guardH / 2, guardH * 0.4, 0, Math.PI * 2);
    c.fillStyle = '#4a4a4a';
    c.fill();
    c.beginPath();
    c.arc(guardHW, guardTop + guardH / 2, guardH * 0.4, 0, Math.PI * 2);
    c.fillStyle = '#4a4a4a';
    c.fill();

    // --- Handle/grip ---
    c.beginPath();
    c.rect(-gripHW, gripTop, gripHW * 2, gripLen);
    var handleGrad = c.createLinearGradient(-gripHW, 0, gripHW, 0);
    handleGrad.addColorStop(0, '#1a1a1a');
    handleGrad.addColorStop(0.3, '#333333');
    handleGrad.addColorStop(0.5, '#3a3a3a');
    handleGrad.addColorStop(0.7, '#333333');
    handleGrad.addColorStop(1, '#1a1a1a');
    c.fillStyle = handleGrad;
    c.fill();
    c.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    c.lineWidth = 0.3 * s;
    c.stroke();

    // Grip wrapping lines
    c.save();
    c.strokeStyle = 'rgba(80, 80, 80, 0.4)';
    c.lineWidth = 0.3 * s;
    for (var wi = 0; wi < 5; wi++) {
      var wy = gripTop + 1 * s + wi * 1.4 * s;
      c.beginPath();
      c.moveTo(-gripHW, wy);
      c.lineTo(gripHW, wy + 1 * s);
      c.stroke();
    }
    c.restore();

    // Pommel (bottom end cap)
    c.beginPath();
    c.arc(0, gripBot, gripHW * 0.7, 0, Math.PI * 2);
    c.fillStyle = '#2a2a2a';
    c.fill();
    c.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    c.lineWidth = 0.3 * s;
    c.stroke();

    c.restore();
  }

  // Draw a blade for corner symbol (already vertical, just scale up)
  function drawCornerBlade(c, x, y, size) {
    drawBladePip(c, x, y, size * 1.3, false);
  }

  // ---- Sai pip drawing ----
  function drawSaiPip(c, x, y, size, flip) {
    c.save();
    c.translate(x, y);
    if (flip) c.rotate(Math.PI);

    var s = size / 20;
    var bScheme = BLADE_SCHEMES[activeBladeScheme];

    // Dimensions
    var prongW = 1.28 * s;       // central prong half-width (reduced 15%)
    var prongLen = 22 * s;       // central prong length (longer)
    var tipLen = 3.5 * s;        // pointed tip length
    var yokeY = 4 * s;           // where side prongs branch
    var yokeSpread = 6.41 * s;   // how far side prongs go out (reduced 15%)
    var yokeCurveUp = 7 * s;     // how far side prong tips curve back up
    var yokeW = 1.54 * s;        // side prong half-width (reduced 15%)
    var gripHW = 1.54 * s;       // grip half-width (reduced 15%)
    var gripLen = 7 * s;         // grip length
    var gripTop = yokeY + 1 * s;

    // Center the sai vertically: shift so visual center is at y=0
    var rawTipTop = -prongLen / 2 + 2 * s;
    var rawGripBot = gripTop + gripLen;
    var centerOffset = (rawTipTop + rawGripBot) / 2;
    c.translate(0, -centerOffset);

    // Y positions
    var tipTop = -prongLen / 2 + 2 * s;
    var prongTop = tipTop + tipLen;
    var prongBot = yokeY;

    // --- Glow effect ---
    if (bScheme.hasGlow) {
      var gR = bScheme.glowColor[0], gG = bScheme.glowColor[1], gB = bScheme.glowColor[2];
      c.save();
      c.globalAlpha = 0.35;
      var glowW = 3.5 * s;
      var leftG = c.createLinearGradient(-prongW - glowW, 0, -prongW, 0);
      leftG.addColorStop(0, 'rgba(' + gR + ',' + gG + ',' + gB + ',0)');
      leftG.addColorStop(1, 'rgba(' + gR + ',' + gG + ',' + gB + ',1)');
      c.fillStyle = leftG;
      c.fillRect(-prongW - glowW, prongTop, glowW, prongBot - prongTop);
      var rightG = c.createLinearGradient(prongW, 0, prongW + glowW, 0);
      rightG.addColorStop(0, 'rgba(' + gR + ',' + gG + ',' + gB + ',1)');
      rightG.addColorStop(1, 'rgba(' + gR + ',' + gG + ',' + gB + ',0)');
      c.fillStyle = rightG;
      c.fillRect(prongW, prongTop, glowW, prongBot - prongTop);
      var tipGlow = c.createRadialGradient(0, tipTop, 0, 0, tipTop, 4 * s);
      tipGlow.addColorStop(0, 'rgba(' + gR + ',' + gG + ',' + gB + ',0.7)');
      tipGlow.addColorStop(0.4, 'rgba(' + gR + ',' + gG + ',' + gB + ',0.3)');
      tipGlow.addColorStop(1, 'rgba(' + gR + ',' + gG + ',' + gB + ',0)');
      c.fillStyle = tipGlow;
      c.beginPath();
      c.arc(0, tipTop, 4 * s, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }

    // Steel gradient for metal parts
    var steelGrad = c.createLinearGradient(-prongW * 2, 0, prongW * 2, 0);
    steelGrad.addColorStop(0, '#888888');
    steelGrad.addColorStop(0.15, '#aaaaaa');
    steelGrad.addColorStop(0.4, '#cccccc');
    steelGrad.addColorStop(0.5, '#dddddd');
    steelGrad.addColorStop(0.6, '#cccccc');
    steelGrad.addColorStop(0.85, '#aaaaaa');
    steelGrad.addColorStop(1, '#888888');

    // --- Side prongs (yoku) as filled pointed shapes ---
    // Each side prong: starts at guard, curves outward and up, ends in a point
    var yokeTipY = yokeY - yokeCurveUp;
    var yokeCtrlY = yokeY + 3.5 * s;  // control point for curve

    // Left side prong (filled shape with pointed tip)
    c.beginPath();
    // Inner edge (closer to center)
    c.moveTo(-prongW * 0.3, yokeY - 1.5 * s);
    c.quadraticCurveTo(-yokeSpread * 0.5, yokeCtrlY - yokeW, -yokeSpread, yokeTipY);
    // Outer edge (farther from center)
    c.quadraticCurveTo(-yokeSpread * 0.6, yokeCtrlY + yokeW, -prongW * 0.8, yokeY + 0.5 * s);
    c.closePath();
    c.fillStyle = steelGrad;
    c.fill();
    c.strokeStyle = 'rgba(40, 40, 40, 0.5)';
    c.lineWidth = 0.35 * s;
    c.stroke();

    // Right side prong (mirror)
    c.beginPath();
    c.moveTo(prongW * 0.3, yokeY - 1.5 * s);
    c.quadraticCurveTo(yokeSpread * 0.5, yokeCtrlY - yokeW, yokeSpread, yokeTipY);
    c.quadraticCurveTo(yokeSpread * 0.6, yokeCtrlY + yokeW, prongW * 0.8, yokeY + 0.5 * s);
    c.closePath();
    c.fillStyle = steelGrad;
    c.fill();
    c.strokeStyle = 'rgba(40, 40, 40, 0.5)';
    c.lineWidth = 0.35 * s;
    c.stroke();

    // --- Central prong (rectangle + triangle tip) ---
    c.beginPath();
    c.moveTo(0, tipTop);
    c.lineTo(prongW, prongTop);
    c.lineTo(prongW, prongBot);
    c.lineTo(-prongW, prongBot);
    c.lineTo(-prongW, prongTop);
    c.closePath();
    c.fillStyle = steelGrad;
    c.fill();
    c.strokeStyle = 'rgba(40, 40, 40, 0.6)';
    c.lineWidth = 0.4 * s;
    c.lineJoin = 'round';
    c.stroke();

    // Center fuller
    c.beginPath();
    c.moveTo(0, tipTop + 2.5 * s);
    c.lineTo(0, prongBot - 0.5 * s);
    c.strokeStyle = 'rgba(0, 0, 0, 0.1)';
    c.lineWidth = 0.8 * s;
    c.stroke();

    // --- Guard area ---
    c.beginPath();
    var guardW = 3.5 * s;
    c.ellipse(0, yokeY, guardW, 1.8 * s, 0, 0, Math.PI * 2);
    var guardGrad = c.createLinearGradient(-guardW, yokeY, guardW, yokeY);
    guardGrad.addColorStop(0, '#888888');
    guardGrad.addColorStop(0.3, '#b0b0b0');
    guardGrad.addColorStop(0.5, '#cccccc');
    guardGrad.addColorStop(0.7, '#b0b0b0');
    guardGrad.addColorStop(1, '#888888');
    c.fillStyle = guardGrad;
    c.fill();
    c.strokeStyle = 'rgba(40, 40, 40, 0.4)';
    c.lineWidth = 0.3 * s;
    c.stroke();

    // --- Handle/grip (black hilt) ---
    c.beginPath();
    c.rect(-gripHW, gripTop, gripHW * 2, gripLen);
    var handleGrad = c.createLinearGradient(-gripHW, 0, gripHW, 0);
    handleGrad.addColorStop(0, '#0a0a0a');
    handleGrad.addColorStop(0.3, '#1a1a1a');
    handleGrad.addColorStop(0.5, '#222222');
    handleGrad.addColorStop(0.7, '#1a1a1a');
    handleGrad.addColorStop(1, '#0a0a0a');
    c.fillStyle = handleGrad;
    c.fill();
    c.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    c.lineWidth = 0.3 * s;
    c.stroke();

    // Black wrapping bands (subtle dark lines)
    c.save();
    c.strokeStyle = 'rgba(60, 60, 60, 0.5)';
    c.lineWidth = 0.5 * s;
    for (var wi = 0; wi < 5; wi++) {
      var wy = gripTop + 1.2 * s + wi * 1.3 * s;
      c.beginPath();
      c.moveTo(-gripHW, wy);
      c.lineTo(gripHW, wy + 0.6 * s);
      c.stroke();
    }
    c.restore();

    // Pommel (dark)
    c.beginPath();
    c.arc(0, gripTop + gripLen, gripHW * 0.7, 0, Math.PI * 2);
    c.fillStyle = '#2a2a2a';
    c.fill();
    c.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    c.lineWidth = 0.3 * s;
    c.stroke();

    // Glow edge lines on central prong
    if (bScheme.hasGlow) {
      var eR = bScheme.glowColor[0], eG = bScheme.glowColor[1], eB = bScheme.glowColor[2];
      c.beginPath();
      c.moveTo(0, tipTop);
      c.lineTo(-prongW, prongTop);
      c.lineTo(-prongW, prongBot);
      c.strokeStyle = 'rgba(' + eR + ',' + eG + ',' + eB + ',0.3)';
      c.lineWidth = 0.6 * s;
      c.stroke();
      c.beginPath();
      c.moveTo(0, tipTop);
      c.lineTo(prongW, prongTop);
      c.lineTo(prongW, prongBot);
      c.strokeStyle = 'rgba(' + eR + ',' + eG + ',' + eB + ',0.3)';
      c.lineWidth = 0.6 * s;
      c.stroke();
    }

    c.restore();
  }

  function drawCornerSai(c, x, y, size) {
    drawSaiPip(c, x, y, size * 1.3, false);
  }

  // ---- Fan Blade pip drawing (V1, hidden/deactivated alternate — 5 blades, angled) ----
  function drawFanPip(c, x, y, size, flip) {
    c.save();
    c.translate(x, y);
    if (flip) c.rotate(Math.PI);
    var s = (size * 1.3) / 20;  // 30% larger
    var bScheme = BLADE_SCHEMES[activeBladeScheme];
    var numBlades = 4;
    var fanR = 10 * s;
    var bladeW = 3.6 * s;
    var rivetR = 2.2 * s;
    var sweep = Math.PI * 0.7;          // 126° spread
    var startAngle = -Math.PI / 2 - sweep / 2;  // centered upright
    // Vertical centering: fan extends from -fanR (top) to rivetR (bottom)
    var topExtent = -fanR * 0.95;
    var botExtent = rivetR * 0.8;
    c.translate(0, -(topExtent + botExtent) / 2);
    if (bScheme.hasGlow) {
      var gR = bScheme.glowColor[0], gG = bScheme.glowColor[1], gB = bScheme.glowColor[2];
      c.save(); c.globalAlpha = 0.3;
      var gg = c.createRadialGradient(0, 0, rivetR, 0, 0, fanR * 1.3);
      gg.addColorStop(0, 'rgba(' + gR + ',' + gG + ',' + gB + ',0.5)');
      gg.addColorStop(1, 'rgba(' + gR + ',' + gG + ',' + gB + ',0)');
      c.fillStyle = gg; c.beginPath(); c.arc(0, 0, fanR * 1.3, 0, Math.PI * 2); c.fill();
      c.restore();
    }
    for (var bi = 0; bi < numBlades; bi++) {
      var angle = startAngle + (bi / (numBlades - 1)) * sweep;
      c.save(); c.rotate(angle);
      var tipX = fanR, halfW = bladeW / 2;
      c.beginPath();
      c.moveTo(rivetR * 0.7, 0);
      c.bezierCurveTo(rivetR + fanR * 0.2, -halfW, fanR * 0.65, -halfW * 0.8, tipX, 0);
      c.bezierCurveTo(fanR * 0.65, halfW * 0.8, rivetR + fanR * 0.2, halfW, rivetR * 0.7, 0);
      c.closePath();
      var grad = c.createLinearGradient(0, -halfW, 0, halfW);
      grad.addColorStop(0, '#888'); grad.addColorStop(0.5, '#ddd'); grad.addColorStop(1, '#888');
      c.fillStyle = grad; c.fill();
      c.strokeStyle = 'rgba(40,40,40,0.5)'; c.lineWidth = 0.4 * s; c.stroke();
      c.restore();
    }
    c.beginPath(); c.arc(0, 0, rivetR, 0, Math.PI * 2);
    var rg = c.createRadialGradient(-rivetR * 0.3, -rivetR * 0.3, 0, 0, 0, rivetR);
    rg.addColorStop(0, '#b0b0b0'); rg.addColorStop(1, '#3a3a3a');
    c.fillStyle = rg; c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 0.5 * s; c.stroke();
    c.restore();
  }

  // ---- Fan Blade pip drawing (V3 — ~160° dark semicircle with 4 blade tips, deactivated for future) ----
  function drawFanPipV3(c, x, y, size, flip) {
    c.save();
    c.translate(x, y);
    if (flip) c.rotate(Math.PI);

    var s = (size * 1.5) / 20;   // 50% larger overall
    var bScheme = BLADE_SCHEMES[activeBladeScheme];

    // Fan parameters
    var arcR = 2.756 * s;         // radius of the dark arc body (reduced 25% again)
    var bladeProtrude = 3.0 * s;  // how far blade tips stick out beyond arc
    var bladeW = 4.68 * s;        // blade width at widest (increased 25% again)
    var pivotR = 1.8 * s;         // small pivot rivet at bottom
    var arcDeg = 160;              // degrees of the arc
    var numBlades = 4;

    // Arc geometry: 160° centered at top, pivot at bottom
    var arcRad = arcDeg * Math.PI / 180;
    var arcStart = -Math.PI / 2 - arcRad / 2;  // start angle (left side)
    var arcEnd = -Math.PI / 2 + arcRad / 2;    // end angle (right side)

    // Vertical centering: arc top is at -arcR, pivot bottom is at pivotR
    var topExtent = -arcR - bladeProtrude * 0.6;
    var botExtent = pivotR;
    var centerY = (topExtent + botExtent) / 2;
    c.translate(0, -centerY);

    // --- Glow effect ---
    if (bScheme.hasGlow) {
      var gR = bScheme.glowColor[0], gG = bScheme.glowColor[1], gB = bScheme.glowColor[2];
      c.save();
      c.globalAlpha = 0.3;
      var glowGrad = c.createRadialGradient(0, 0, arcR * 0.5, 0, 0, (arcR + bladeProtrude) * 1.2);
      glowGrad.addColorStop(0, 'rgba(' + gR + ',' + gG + ',' + gB + ',0.4)');
      glowGrad.addColorStop(0.5, 'rgba(' + gR + ',' + gG + ',' + gB + ',0.15)');
      glowGrad.addColorStop(1, 'rgba(' + gR + ',' + gG + ',' + gB + ',0)');
      c.fillStyle = glowGrad;
      c.beginPath();
      c.arc(0, 0, (arcR + bladeProtrude) * 1.2, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }

    // --- Draw blade tips (behind the arc body) ---
    for (var bi = 0; bi < numBlades; bi++) {
      // Spread blades evenly across the arc
      var t = (bi + 0.5) / numBlades;
      var bladeAngle = arcStart + t * arcRad;

      c.save();
      c.rotate(bladeAngle);

      // Blade shape: from inside arc out to tip
      var bladeStart = arcR * 0.7;
      var tipX = arcR + bladeProtrude;
      var halfW = bladeW / 2;
      c.beginPath();
      c.moveTo(bladeStart, 0);
      c.bezierCurveTo(arcR * 0.85, -halfW * 0.9, arcR, -halfW * 0.7, tipX, 0);
      c.bezierCurveTo(arcR, halfW * 0.7, arcR * 0.85, halfW * 0.9, bladeStart, 0);
      c.closePath();

      // Steel gradient across blade width
      var grad = c.createLinearGradient(0, -halfW, 0, halfW);
      grad.addColorStop(0, '#888888');
      grad.addColorStop(0.15, '#aaaaaa');
      grad.addColorStop(0.4, '#cccccc');
      grad.addColorStop(0.5, '#dddddd');
      grad.addColorStop(0.6, '#cccccc');
      grad.addColorStop(0.85, '#aaaaaa');
      grad.addColorStop(1, '#888888');
      c.fillStyle = grad;
      c.fill();

      c.strokeStyle = 'rgba(40, 40, 40, 0.5)';
      c.lineWidth = 0.35 * s;
      c.stroke();

      // Center ridge on blade tip
      c.beginPath();
      c.moveTo(arcR * 0.85, 0);
      c.lineTo(tipX * 0.9, 0);
      c.strokeStyle = 'rgba(0, 0, 0, 0.1)';
      c.lineWidth = 0.5 * s;
      c.stroke();

      // Glow edge on blade
      if (bScheme.hasGlow) {
        var eR = bScheme.glowColor[0], eG = bScheme.glowColor[1], eB = bScheme.glowColor[2];
        c.beginPath();
        c.moveTo(bladeStart, 0);
        c.bezierCurveTo(arcR * 0.85, -halfW * 0.9, arcR, -halfW * 0.7, tipX, 0);
        c.strokeStyle = 'rgba(' + eR + ',' + eG + ',' + eB + ',0.3)';
        c.lineWidth = 0.5 * s;
        c.stroke();
      }

      c.restore();
    }

    // --- Dark arc body (covers blade bases) ---
    c.beginPath();
    c.moveTo(0, 0);
    c.arc(0, 0, arcR, arcStart, arcEnd);
    c.closePath();

    var bodyGrad = c.createRadialGradient(0, -arcR * 0.3, arcR * 0.1, 0, 0, arcR);
    bodyGrad.addColorStop(0, '#3a3a3a');
    bodyGrad.addColorStop(0.3, '#2a2a2a');
    bodyGrad.addColorStop(0.6, '#1a1a1a');
    bodyGrad.addColorStop(1, '#0e0e0e');
    c.fillStyle = bodyGrad;
    c.fill();

    c.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    c.lineWidth = 0.5 * s;
    c.stroke();

    // Subtle arc edge highlight (inner ring near top)
    c.beginPath();
    c.arc(0, 0, arcR * 0.85, arcStart + 0.1, arcEnd - 0.1);
    c.strokeStyle = 'rgba(80, 80, 80, 0.25)';
    c.lineWidth = 0.4 * s;
    c.stroke();

    // --- Pivot rivet at bottom ---
    c.beginPath();
    c.arc(0, 0, pivotR, 0, Math.PI * 2);
    var rivetGrad = c.createRadialGradient(-pivotR * 0.3, -pivotR * 0.3, 0, 0, 0, pivotR);
    rivetGrad.addColorStop(0, '#555555');
    rivetGrad.addColorStop(0.5, '#333333');
    rivetGrad.addColorStop(1, '#1a1a1a');
    c.fillStyle = rivetGrad;
    c.fill();
    c.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    c.lineWidth = 0.4 * s;
    c.stroke();

    c.restore();
  }

  // Dispatch blade drawing based on active style
  function drawBladeAny(c, x, y, size, flip) {
    if (activeBladeStyle === 'fan') {
      drawFanPip(c, x, y, size, flip);
    } else if (activeBladeStyle === 'sai') {
      drawSaiPip(c, x, y, size, flip);
    } else {
      drawBladePip(c, x, y, size, flip);
    }
  }

  // ---- Combiner pip drawing (V1 style: bottom + bottom-right inputs, single circle, single output) ----
  function drawCombinerPip(c, x, y, size, flip, dimGlow) {
    c.save();
    c.translate(x, y);
    if (flip) c.rotate(Math.PI);

    var s = size / 20;
    var cScheme = COMBINER_SCHEMES[activeCombinerScheme];
    var beamColors = cScheme.beamColors;

    // Square dimensions
    var rectHW = 5.13 * s;
    var rectHH = 5.13 * s;
    var rectOX = 0;
    var rectOY = 0;

    // Beam parameters (reduced 20% from prism: 1.6 * 0.8 = 1.28)
    var beamW = 1.28 * s;
    var outBeamW = beamW * 1.4;

    // Convergence point (center of rectangle)
    var convX = rectOX;
    var convY = rectOY;

    // Input/output beam lengths
    var beamLen = rectHW * 1.5;
    var outTopY = rectOY - rectHH - beamLen;
    outTopY = outTopY + (rectOY - rectHH - outTopY) * 0.25;

    // Input beams: one from bottom (straight up), one from middle-right (horizontal)
    var inLen = beamLen * 1.728;  // undid last 10% extension
    var inStartOffsets = [
      { x: 0, y: inLen },       // bottom (straight up)
      { x: inLen, y: 0 }        // middle-right (horizontal, right angle with bottom beam)
    ];
    var inBeamColors = [beamColors[0], beamColors[beamColors.length - 1]];

    // Wave parameters
    var waveAmp = 0.625 * s;  // increased 25%
    var waveFreq = 2.5;
    var waveSteps = 30;

    // --- Draw order: shadow, rect body, beams ON TOP, then glow ---

    // Drop shadow
    c.save();
    c.beginPath();
    c.rect(rectOX - rectHW + 1.5 * s, rectOY - rectHH + 2 * s, rectHW * 2, rectHH * 2);
    c.fillStyle = 'rgba(0, 0, 0, 0.12)';
    c.fill();
    c.restore();

    // Rectangle body
    c.beginPath();
    c.rect(rectOX - rectHW, rectOY - rectHH, rectHW * 2, rectHH * 2);

    // Glass fill
    var glassGrad = c.createLinearGradient(rectOX - rectHW, rectOY - rectHH, rectOX + rectHW, rectOY + rectHH);
    glassGrad.addColorStop(0, 'rgba(210, 230, 250, 0.8)');
    glassGrad.addColorStop(0.25, 'rgba(185, 210, 240, 0.65)');
    glassGrad.addColorStop(0.5, 'rgba(160, 195, 230, 0.55)');
    glassGrad.addColorStop(0.75, 'rgba(135, 175, 215, 0.5)');
    glassGrad.addColorStop(1, 'rgba(110, 155, 200, 0.65)');
    c.fillStyle = glassGrad;
    c.fill();

    // Rectangle outline
    c.strokeStyle = 'rgba(40, 70, 110, 0.6)';
    c.lineWidth = 0.8 * s;
    c.lineJoin = 'round';
    c.stroke();

    // Left face highlight
    c.beginPath();
    c.rect(rectOX - rectHW + 1.5 * s, rectOY - rectHH + 1.5 * s, rectHW * 0.35, rectHH * 2 - 3 * s);
    c.fillStyle = 'rgba(255, 255, 255, 0.3)';
    c.fill();

    // Right face darker tint
    c.beginPath();
    c.rect(rectOX + rectHW * 0.3, rectOY - rectHH + 1 * s, rectHW * 0.65, rectHH * 2 - 2 * s);
    c.fillStyle = 'rgba(30, 60, 100, 0.08)';
    c.fill();

    // --- Incoming sinusoidal beams ---
    c.save();
    c.globalAlpha = 0.85;
    for (var ib = 0; ib < 2; ib++) {
      var startX = rectOX + inStartOffsets[ib].x;
      var startY = rectOY + inStartOffsets[ib].y;
      var endX = rectOX;
      var endY = rectOY;

      c.beginPath();
      var tStart = 0.15;
      for (var wi = 0; wi <= waveSteps; wi++) {
        var t = tStart + (wi / waveSteps) * (1 - tStart);
        var baseX = startX + (endX - startX) * t;
        var baseY = startY + (endY - startY) * t;
        var dx = endX - startX;
        var dy = endY - startY;
        var len = Math.sqrt(dx * dx + dy * dy);
        var perpX = -dy / len;
        var perpY = dx / len;
        var taper = 1 - t * t;
        // Mirror the right beam for symmetry
        var waveSign = (ib === 1) ? -1 : 1;
        var wave = Math.sin(t * waveFreq * Math.PI * 2) * waveAmp * taper * waveSign;
        var px = baseX + perpX * wave;
        var py = baseY + perpY * wave;
        if (wi === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.strokeStyle = inBeamColors[ib];
      c.lineWidth = beamW;
      c.lineCap = 'butt';
      c.stroke();
    }
    c.restore();

    // --- Output beam going straight up from rectangle top ---
    c.save();
    c.globalAlpha = 0.85;
    if (cScheme.hybridOutput) {
      var outStartY = rectOY - rectHH * 0.5;
      var hybridW = outBeamW * 3;
      var halfHybridW = hybridW / 2;
      var halfRedW = outBeamW * 0.6;
      var halfBlueW = outBeamW * 0.6;
      c.beginPath();
      c.rect(rectOX - halfHybridW, outTopY, hybridW, outStartY - outTopY);
      c.fillStyle = dimGlow ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.65)';
      c.fill();
      c.beginPath();
      c.moveTo(rectOX - halfHybridW + halfRedW / 2, outStartY);
      c.lineTo(rectOX - halfHybridW + halfRedW / 2, outTopY);
      c.strokeStyle = dimGlow ? 'rgba(198, 40, 40, 0.5)' : '#c62828';
      c.lineWidth = halfRedW;
      c.lineCap = 'butt';
      c.stroke();
      c.beginPath();
      c.moveTo(rectOX + halfHybridW - halfBlueW / 2, outStartY);
      c.lineTo(rectOX + halfHybridW - halfBlueW / 2, outTopY);
      c.strokeStyle = dimGlow ? 'rgba(21, 101, 192, 0.5)' : '#1565C0';
      c.lineWidth = halfBlueW;
      c.lineCap = 'butt';
      c.stroke();
    } else if (cScheme.outputBorder) {
      c.beginPath();
      c.moveTo(rectOX, rectOY - rectHH * 0.5);
      c.lineTo(rectOX, outTopY);
      c.strokeStyle = cScheme.outputBorder;
      c.lineWidth = outBeamW + 0.75 * s;
      c.lineCap = 'butt';
      c.stroke();
      c.beginPath();
      c.moveTo(rectOX, rectOY - rectHH * 0.5);
      c.lineTo(rectOX, outTopY);
      c.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      c.lineWidth = outBeamW * 2.5;
      c.lineCap = 'round';
      c.stroke();
    }
    if (!cScheme.hybridOutput) {
      c.beginPath();
      c.moveTo(rectOX, rectOY - rectHH * 0.5);
      c.lineTo(rectOX, outTopY);
      c.strokeStyle = cScheme.outputColor;
      c.lineWidth = outBeamW;
      c.lineCap = 'butt';
      c.stroke();
    }
    c.restore();

    // --- White glow at rectangle center ---
    var glowR = dimGlow ? 10 * s : 7.5 * s;
    var convGlow = c.createRadialGradient(convX, convY, 0, convX, convY, glowR);
    if (dimGlow) {
      convGlow.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
      convGlow.addColorStop(0.2, 'rgba(255, 255, 255, 1.0)');
      convGlow.addColorStop(0.4, 'rgba(255, 255, 255, 0.85)');
      convGlow.addColorStop(0.6, 'rgba(240, 248, 255, 0.5)');
      convGlow.addColorStop(0.8, 'rgba(220, 235, 255, 0.15)');
      convGlow.addColorStop(1, 'rgba(200, 220, 255, 0)');
    } else {
      convGlow.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
      convGlow.addColorStop(0.15, 'rgba(255, 255, 255, 1.0)');
      convGlow.addColorStop(0.3, 'rgba(255, 255, 255, 1.0)');
      convGlow.addColorStop(0.5, 'rgba(240, 248, 255, 0.53)');
      convGlow.addColorStop(0.75, 'rgba(220, 235, 255, 0.15)');
      convGlow.addColorStop(1, 'rgba(200, 220, 255, 0)');
    }
    c.fillStyle = convGlow;
    c.beginPath();
    c.arc(convX, convY, glowR, 0, Math.PI * 2);
    c.fill();

    // Small solid white core for placeholder
    if (dimGlow) {
      c.save();
      c.globalAlpha = 1.0;
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(convX, convY, 2.4 * s, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }

    c.restore();
  }

  // ---- Combiner pip V1 (legacy, kept for card-viewer reference) ----
  function drawCombinerPipV1(c, x, y, size, flip, dimGlow) {
    c.save();
    c.translate(x, y);
    if (flip) c.rotate(Math.PI);

    var s = size / 20;
    var cScheme = COMBINER_SCHEMES[activeCombinerScheme];
    var beamColors = cScheme.beamColors;
    var rectHW = 5.13 * s;
    var rectHH = 5.13 * s;
    var rectOX = 0, rectOY = 0;
    var beamW = 1.6 * s;
    var outBeamW = beamW * 1.4;
    var convX = rectOX, convY = rectOY;
    var beamLen = rectHW * 1.5;
    var outTopY = rectOY - rectHH - beamLen;
    outTopY = outTopY + (rectOY - rectHH - outTopY) * 0.25;
    var inLen = beamLen * 1.2;
    var inStartOffsets = [{ x: -inLen, y: inLen }, { x: inLen, y: inLen }];
    var inBeamColors = [beamColors[0], beamColors[beamColors.length - 1]];
    var waveAmp = 2 * s, waveFreq = 2.5, waveSteps = 30;

    // Drop shadow
    c.save();
    c.beginPath();
    c.rect(rectOX - rectHW + 1.5 * s, rectOY - rectHH + 2 * s, rectHW * 2, rectHH * 2);
    c.fillStyle = 'rgba(0, 0, 0, 0.12)';
    c.fill();
    c.restore();

    // Rectangle body
    c.beginPath();
    c.rect(rectOX - rectHW, rectOY - rectHH, rectHW * 2, rectHH * 2);
    var glassGrad = c.createLinearGradient(rectOX - rectHW, rectOY - rectHH, rectOX + rectHW, rectOY + rectHH);
    glassGrad.addColorStop(0, 'rgba(210, 230, 250, 0.8)');
    glassGrad.addColorStop(0.5, 'rgba(160, 195, 230, 0.55)');
    glassGrad.addColorStop(1, 'rgba(110, 155, 200, 0.65)');
    c.fillStyle = glassGrad;
    c.fill();
    c.strokeStyle = 'rgba(40, 70, 110, 0.6)';
    c.lineWidth = 0.8 * s;
    c.stroke();

    // Incoming beams
    c.save();
    c.globalAlpha = 0.85;
    for (var ib = 0; ib < 2; ib++) {
      var startX = rectOX + inStartOffsets[ib].x;
      var startY = rectOY + inStartOffsets[ib].y;
      c.beginPath();
      for (var wi = 0; wi <= waveSteps; wi++) {
        var t = 0.15 + (wi / waveSteps) * 0.85;
        var bx = startX + (rectOX - startX) * t;
        var by = startY + (rectOY - startY) * t;
        var dx = rectOX - startX, dy = rectOY - startY;
        var ln = Math.sqrt(dx * dx + dy * dy);
        var px2 = -dy / ln, py2 = dx / ln;
        var wave = Math.sin(t * waveFreq * Math.PI * 2) * waveAmp * (1 - t * t) * ((ib === 1) ? -1 : 1);
        var fx = bx + px2 * wave, fy = by + py2 * wave;
        if (wi === 0) c.moveTo(fx, fy); else c.lineTo(fx, fy);
      }
      c.strokeStyle = inBeamColors[ib];
      c.lineWidth = beamW * 1.2;
      c.stroke();
    }
    c.restore();

    // Output beam
    c.save();
    c.globalAlpha = 0.85;
    c.beginPath();
    c.moveTo(rectOX, rectOY - rectHH * 0.5);
    c.lineTo(rectOX, outTopY);
    c.strokeStyle = cScheme.outputColor || '#ffffff';
    c.lineWidth = outBeamW;
    c.stroke();
    c.restore();

    // Glow
    var glowR = 7.5 * s;
    var cg = c.createRadialGradient(convX, convY, 0, convX, convY, glowR);
    cg.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    cg.addColorStop(0.3, 'rgba(255, 255, 255, 1.0)');
    cg.addColorStop(0.5, 'rgba(240, 248, 255, 0.53)');
    cg.addColorStop(1, 'rgba(200, 220, 255, 0)');
    c.fillStyle = cg;
    c.beginPath();
    c.arc(convX, convY, glowR, 0, Math.PI * 2);
    c.fill();

    c.restore();
  }

  // ================================================================
  //  ANIMAL PIPS (Solitairra default suit style)
  //  Dolphins = diamonds, Hares = hearts, Spiders = spades, Cubs = clubs
  //  All normalize to s = size / 20, target visual footprint ~14*s
  //  No ground shadows — silhouettes only.
  // ================================================================

  // ----------------------------------------------------------------
  // Dolphin pip. The chosen design for Solitairra is variant V11
  // "Iconic leaping (emoji style)" — see DOLPHIN_VARIANTS[10] below.
  // The array also holds a bunch of alternate designs the card-viewer
  // can cycle through for future iteration.
  // ----------------------------------------------------------------

  var DEFAULT_DOLPHIN_VARIANT = 10;  // V11 "Iconic leaping (emoji style)"
  var _activeDolphinVariant = DEFAULT_DOLPHIN_VARIANT;
  function setDolphinVariant(idx) {
    if (idx === null || idx === undefined || idx < 0) {
      _activeDolphinVariant = DEFAULT_DOLPHIN_VARIANT;
    } else if (idx < DOLPHIN_VARIANTS.length) {
      _activeDolphinVariant = idx;
    }
  }
  function getDolphinVariantCount() { return DOLPHIN_VARIANTS.length; }
  function getDolphinVariantName(i) {
    var v = DOLPHIN_VARIANTS[i];
    return v ? v.name : '';
  }

  // Main dispatcher
  function drawDolphinPip(c, x, y, size, flip) {
    return DOLPHIN_VARIANTS[_activeDolphinVariant].draw(c, x, y, size, flip);
  }

  // --- DOLPHIN_VARIANTS — one fresh design per entry ---
  var DOLPHIN_VARIANTS = [
    // ----- V1: Front-facing baby dolphin head -----
    {
      name: 'Front-facing baby face',
      draw: function (c, x, y, size, flip) {
        c.save();
        c.translate(x, y);
        if (flip) c.rotate(Math.PI);
        var s = size / 20;

        // Domed forehead (round melon, facing viewer)
        c.beginPath();
        c.arc(0, -1.5 * s, 5.2 * s, 0, Math.PI * 2);
        var headGrad = c.createRadialGradient(-1.5 * s, -3 * s, 0.5 * s, 0, -1.5 * s, 6 * s);
        headGrad.addColorStop(0, '#5b7fa5');
        headGrad.addColorStop(0.6, '#1a3f6e');
        headGrad.addColorStop(1, '#0d2c52');
        c.fillStyle = headGrad;
        c.fill();
        c.strokeStyle = 'rgba(8, 30, 70, 0.9)';
        c.lineWidth = 0.5 * s;
        c.stroke();

        // Short rostrum (snout) pointing down
        c.beginPath();
        c.moveTo(-1.6 * s, 2.2 * s);
        c.quadraticCurveTo(0, 4.8 * s, 1.6 * s, 2.2 * s);
        c.quadraticCurveTo(0, 3 * s, -1.6 * s, 2.2 * s);
        c.closePath();
        c.fillStyle = '#4a6b96';
        c.fill();
        c.strokeStyle = 'rgba(8, 30, 70, 0.9)';
        c.lineWidth = 0.4 * s;
        c.stroke();

        // Lighter belly patch (lower chin)
        c.save();
        c.beginPath();
        c.ellipse(0, 3 * s, 1.8 * s, 0.8 * s, 0, 0, Math.PI * 2);
        c.fillStyle = '#b8cee3';
        c.fill();
        c.restore();

        // Eyes
        c.fillStyle = '#041124';
        c.beginPath(); c.arc(-2 * s, -1.5 * s, 0.7 * s, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc( 2 * s, -1.5 * s, 0.7 * s, 0, Math.PI * 2); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.9)';
        c.beginPath(); c.arc(-1.8 * s, -1.7 * s, 0.24 * s, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc( 2.2 * s, -1.7 * s, 0.24 * s, 0, Math.PI * 2); c.fill();

        // Smile
        c.beginPath();
        c.arc(0, 2.5 * s, 1.2 * s, 0.15 * Math.PI, 0.85 * Math.PI);
        c.strokeStyle = 'rgba(8, 30, 70, 0.95)';
        c.lineWidth = 0.35 * s;
        c.lineCap = 'round';
        c.stroke();

        c.restore();
      }
    },

    // ----- V2: Single-stroke swoosh — one bold curve evokes a leaping dolphin -----
    {
      name: 'Single-stroke swoosh',
      draw: function (c, x, y, size, flip) {
        c.save();
        c.translate(x, y);
        if (flip) c.rotate(Math.PI);
        var s = size / 20;

        // Big sweeping curve from bottom-left to bottom-right arcing over the top
        c.beginPath();
        c.moveTo(-6 * s, 4 * s);
        c.bezierCurveTo(-8 * s, -2 * s, 2 * s, -7 * s, 6 * s, -4 * s);
        c.strokeStyle = '#1a3f6e';
        c.lineWidth = 1.6 * s;
        c.lineCap = 'round';
        c.stroke();

        // Short secondary curve suggesting a tail-fluke
        c.beginPath();
        c.moveTo(-6 * s, 4 * s);
        c.quadraticCurveTo(-4.5 * s, 3 * s, -2.5 * s, 3.6 * s);
        c.strokeStyle = '#1a3f6e';
        c.lineWidth = 1.3 * s;
        c.lineCap = 'round';
        c.stroke();

        // Tiny dorsal hint on top of arc
        c.beginPath();
        c.moveTo(-1.2 * s, -6.3 * s);
        c.lineTo(0.5 * s, -7.4 * s);
        c.strokeStyle = '#1a3f6e';
        c.lineWidth = 1.2 * s;
        c.lineCap = 'round';
        c.stroke();

        // Eye dot near the curve's "head" end
        c.beginPath();
        c.arc(5.2 * s, -4.6 * s, 0.5 * s, 0, Math.PI * 2);
        c.fillStyle = '#fff';
        c.fill();
        c.strokeStyle = '#1a3f6e';
        c.lineWidth = 0.35 * s;
        c.stroke();

        c.restore();
      }
    },

    // ----- V3: Infinity loop — body forms a continuous ∞ -----
    {
      name: 'Infinity loop',
      draw: function (c, x, y, size, flip) {
        c.save();
        c.translate(x, y);
        if (flip) c.rotate(Math.PI);
        var s = size / 20;

        // Trace an infinity / lemniscate shape with thick stroke
        c.beginPath();
        // Left loop
        c.moveTo(0, 0);
        c.bezierCurveTo(-3 * s, -3.5 * s, -7 * s, -3.5 * s, -7 * s, 0);
        c.bezierCurveTo(-7 * s, 3.5 * s, -3 * s, 3.5 * s, 0, 0);
        // Right loop
        c.bezierCurveTo(3 * s, -3.5 * s, 7 * s, -3.5 * s, 7 * s, 0);
        c.bezierCurveTo(7 * s, 3.5 * s, 3 * s, 3.5 * s, 0, 0);
        c.closePath();
        c.fillStyle = '#1a3f6e';
        c.fill();
        c.strokeStyle = '#0d2c52';
        c.lineWidth = 0.5 * s;
        c.stroke();

        // A hint of "head" (dolphin melon) at the right outer loop end
        c.beginPath();
        c.arc(6.8 * s, 0, 1.1 * s, 0, Math.PI * 2);
        c.fillStyle = '#0d2c52';
        c.fill();

        // Tail-fluke accent at the left outer loop end
        c.beginPath();
        c.moveTo(-6.8 * s, -0.2 * s);
        c.lineTo(-8.8 * s, -1.8 * s);
        c.lineTo(-6.8 * s, -0.6 * s);
        c.lineTo(-8.8 * s, 1.6 * s);
        c.lineTo(-6.8 * s, 0.2 * s);
        c.closePath();
        c.fillStyle = '#0d2c52';
        c.fill();

        // Eye (on the right head)
        c.beginPath();
        c.arc(6.8 * s, -0.3 * s, 0.25 * s, 0, Math.PI * 2);
        c.fillStyle = '#fff';
        c.fill();

        c.restore();
      }
    },

    // ----- V4: Monogram "D" — stylized letter D with dolphin tail forming the curve -----
    {
      name: 'Monogram D',
      draw: function (c, x, y, size, flip) {
        c.save();
        c.translate(x, y);
        if (flip) c.rotate(Math.PI);
        var s = size / 20;

        // Vertical stem of the D
        c.beginPath();
        c.rect(-5 * s, -6 * s, 2.2 * s, 12 * s);
        c.fillStyle = '#1a3f6e';
        c.fill();
        c.strokeStyle = '#0d2c52';
        c.lineWidth = 0.4 * s;
        c.stroke();

        // Curve of the D — thick arc from top-right to bottom-right
        c.beginPath();
        c.moveTo(-2.8 * s, -6 * s);
        c.bezierCurveTo(5 * s, -6 * s, 6.2 * s, -3 * s, 6.2 * s, 0);
        c.bezierCurveTo(6.2 * s, 3 * s, 5 * s, 6 * s, -2.8 * s, 6 * s);
        c.closePath();
        c.fillStyle = '#1a3f6e';
        c.fill();
        c.strokeStyle = '#0d2c52';
        c.lineWidth = 0.4 * s;
        c.stroke();

        // Cutout: smaller inner D shape
        c.save();
        c.beginPath();
        c.moveTo(-2.8 * s, -3.5 * s);
        c.bezierCurveTo(2.5 * s, -3.5 * s, 3.5 * s, -1.5 * s, 3.5 * s, 0);
        c.bezierCurveTo(3.5 * s, 1.5 * s, 2.5 * s, 3.5 * s, -2.8 * s, 3.5 * s);
        c.closePath();
        c.fillStyle = '#faf6ee';  // match card background
        c.fill();
        c.restore();

        // Tail fluke extending down-left from the stem base
        c.beginPath();
        c.moveTo(-5 * s, 6 * s);
        c.lineTo(-7.5 * s, 7.5 * s);
        c.lineTo(-3.8 * s, 5 * s);
        c.closePath();
        c.fillStyle = '#1a3f6e';
        c.fill();
        c.strokeStyle = '#0d2c52';
        c.lineWidth = 0.4 * s;
        c.stroke();

        c.restore();
      }
    },

    // ----- V5: Dotwork silhouette — pointillism-style dolphin -----
    {
      name: 'Dotwork silhouette',
      draw: function (c, x, y, size, flip) {
        c.save();
        c.translate(x, y);
        if (flip) c.rotate(Math.PI);
        c.rotate(-Math.PI * 0.22);
        var s = size / 20;

        // Shape bounds (approx. dolphin outline, centred)
        function insideDolphin(px, py) {
          // Approximate body as ellipse + tail triangle + dorsal triangle
          // Main ellipse
          var ex = px / 7, ey = py / 3;
          var inBody = (ex * ex + ey * ey) < 1;
          // Tail
          var inTail = (px < -5 * s) && (Math.abs(py) < 2.5 * s + 0.5 * (px + 8 * s));
          // Dorsal
          var inDorsal = (px > -4 * s && px < -0.5 * s && py < -2 * s && py > -5.5 * s)
                         && (py > -5.5 * s + 1.5 * (px + 2 * s));
          return inBody || inTail || inDorsal;
        }

        c.fillStyle = '#1a3f6e';
        var step = 1 * s;
        for (var px = -10 * s; px <= 10 * s; px += step) {
          for (var py = -6 * s; py <= 4 * s; py += step) {
            // Slight jitter
            var jx = px + (Math.sin(px * 1.3 + py * 0.7) * 0.3 * s);
            var jy = py + (Math.cos(px * 0.9 - py * 1.1) * 0.3 * s);
            if (insideDolphin(jx, jy)) {
              // Dot size varies with density
              var r = 0.28 * s + (Math.abs(Math.sin(px * 0.5)) * 0.15 * s);
              c.beginPath();
              c.arc(jx, jy, r, 0, Math.PI * 2);
              c.fill();
            }
          }
        }

        // Eye highlight (larger white dot)
        c.beginPath();
        c.arc(5 * s, -1.2 * s, 0.6 * s, 0, Math.PI * 2);
        c.fillStyle = '#fff';
        c.fill();

        c.restore();
      }
    },

    // ----- V6: Stamp/seal — dolphin in a circular ornamental border -----
    {
      name: 'Postage stamp',
      draw: function (c, x, y, size, flip) {
        c.save();
        c.translate(x, y);
        if (flip) c.rotate(Math.PI);
        var s = size / 20;

        // Perforated outer ring (little dots around a circle)
        c.fillStyle = '#1a3f6e';
        var ringR = 7.5 * s;
        var dotCount = 24;
        for (var i = 0; i < dotCount; i++) {
          var ang = (i / dotCount) * Math.PI * 2;
          c.beginPath();
          c.arc(Math.cos(ang) * ringR, Math.sin(ang) * ringR, 0.35 * s, 0, Math.PI * 2);
          c.fill();
        }

        // Inner circle outline
        c.beginPath();
        c.arc(0, 0, 6 * s, 0, Math.PI * 2);
        c.strokeStyle = '#1a3f6e';
        c.lineWidth = 0.4 * s;
        c.stroke();

        // Tiny dolphin silhouette inside
        c.save();
        c.scale(0.5, 0.5);
        c.rotate(-Math.PI * 0.22);
        c.beginPath();
        c.moveTo(8 * s, -0.6 * s);
        c.bezierCurveTo(7 * s, -3.5 * s, 3 * s, -4.2 * s, -1 * s, -3.6 * s);
        c.lineTo(-2 * s, -6.8 * s);
        c.lineTo(-4 * s, -2.5 * s);
        c.bezierCurveTo(-6 * s, -1 * s, -7.5 * s, 0 * s, -7 * s, 0.5 * s);
        c.lineTo(-9 * s, -0.8 * s);
        c.bezierCurveTo(-7.5 * s, 1.2 * s, -7 * s, 2 * s, -6.5 * s, 2.5 * s);
        c.lineTo(-8.5 * s, 3.5 * s);
        c.bezierCurveTo(-5 * s, 2.4 * s, 0 * s, 2.6 * s, 4 * s, 1.8 * s);
        c.bezierCurveTo(6 * s, 1 * s, 7.5 * s, 0 * s, 8 * s, -0.6 * s);
        c.closePath();
        c.fillStyle = '#1a3f6e';
        c.fill();
        c.restore();

        c.restore();
      }
    },

    // ----- V7: Wave jumper — a bold wave on the bottom + small dolphin above -----
    {
      name: 'Wave jumper',
      draw: function (c, x, y, size, flip) {
        c.save();
        c.translate(x, y);
        if (flip) c.rotate(Math.PI);
        var s = size / 20;

        // Stylised wave across bottom half of pip
        c.beginPath();
        c.moveTo(-8 * s, 2 * s);
        c.bezierCurveTo(-6 * s, -0.5 * s, -3 * s, -0.5 * s, -1 * s, 2 * s);
        c.bezierCurveTo(1 * s, 4 * s, 4 * s, 4 * s, 6 * s, 2 * s);
        c.bezierCurveTo(7 * s, 1 * s, 8 * s, 1 * s, 8 * s, 3 * s);
        c.lineTo(8 * s, 6 * s);
        c.lineTo(-8 * s, 6 * s);
        c.closePath();
        var wg = c.createLinearGradient(0, 0, 0, 6 * s);
        wg.addColorStop(0, '#4a6b96');
        wg.addColorStop(1, '#0d2c52');
        c.fillStyle = wg;
        c.fill();
        c.strokeStyle = '#0d2c52';
        c.lineWidth = 0.4 * s;
        c.stroke();

        // Wave crest foam (lighter curve on top of wave)
        c.beginPath();
        c.moveTo(-4 * s, 0.5 * s);
        c.bezierCurveTo(-2 * s, 2 * s, 1 * s, 3 * s, 3 * s, 2 * s);
        c.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        c.lineWidth = 0.4 * s;
        c.lineCap = 'round';
        c.stroke();

        // Tiny dolphin leaping above wave
        c.save();
        c.translate(0.5 * s, -3 * s);
        c.rotate(-Math.PI * 0.3);
        c.scale(0.42, 0.42);
        c.beginPath();
        c.moveTo(8 * s, -0.6 * s);
        c.bezierCurveTo(7 * s, -3.5 * s, 3 * s, -4.2 * s, -1 * s, -3.6 * s);
        c.lineTo(-2 * s, -6.8 * s);
        c.lineTo(-4 * s, -2.5 * s);
        c.bezierCurveTo(-6 * s, -1 * s, -7.5 * s, 0 * s, -7 * s, 0.5 * s);
        c.lineTo(-9 * s, -0.8 * s);
        c.bezierCurveTo(-7.5 * s, 1.2 * s, -7 * s, 2 * s, -6.5 * s, 2.5 * s);
        c.lineTo(-8.5 * s, 3.5 * s);
        c.bezierCurveTo(-5 * s, 2.4 * s, 0 * s, 2.6 * s, 4 * s, 1.8 * s);
        c.bezierCurveTo(6 * s, 1 * s, 7.5 * s, 0 * s, 8 * s, -0.6 * s);
        c.closePath();
        c.fillStyle = '#0d2c52';
        c.fill();
        c.restore();

        c.restore();
      }
    },

    // ----- V8: Pixel-art 8-bit dolphin -----
    {
      name: 'Pixel 8-bit',
      draw: function (c, x, y, size, flip) {
        c.save();
        c.translate(x, y);
        if (flip) c.rotate(Math.PI);
        var s = size / 20;
        var px = 1.2 * s;   // pixel size

        // Pixel grid: 1 = body (mid), 2 = darker, 3 = belly light. 0 = empty.
        // 14 wide × 10 tall grid, y- at top.
        var grid = [
          '..............',
          '........1111..',
          '.......111111.',
          '......11112111',
          '1111111111111.',
          '1113333111111.',
          '.133333111111.',
          '..1331111...11',
          '...1111.......',
          '.....1........'
        ];
        var cols = { '1': '#1a3f6e', '2': '#fff', '3': '#b8cee3' };
        var gw = grid[0].length;
        var gh = grid.length;
        var ox = -(gw * px) / 2;
        var oy = -(gh * px) / 2;
        for (var row = 0; row < gh; row++) {
          for (var col = 0; col < gw; col++) {
            var ch = grid[row][col];
            if (ch === '.') continue;
            c.fillStyle = cols[ch] || '#1a3f6e';
            c.fillRect(ox + col * px, oy + row * px, px + 0.3, px + 0.3);
          }
        }

        c.restore();
      }
    },

    // ----- V9: Celtic knot-style intertwined dolphins -----
    {
      name: 'Celtic knot pair',
      draw: function (c, x, y, size, flip) {
        c.save();
        c.translate(x, y);
        if (flip) c.rotate(Math.PI);
        var s = size / 20;

        // Two intertwining bands forming a knot
        function band(color, phase) {
          c.save();
          c.rotate(phase);
          c.beginPath();
          // Outer loop
          c.moveTo(-6 * s, 0);
          c.bezierCurveTo(-6 * s, -5 * s, 6 * s, -5 * s, 6 * s, 0);
          c.bezierCurveTo(6 * s, 3 * s, 3 * s, 3 * s, 0, 0);
          c.bezierCurveTo(-3 * s, -3 * s, -6 * s, -3 * s, -6 * s, 0);
          c.strokeStyle = color;
          c.lineWidth = 1.4 * s;
          c.lineCap = 'round';
          c.lineJoin = 'round';
          c.stroke();
          c.restore();
        }
        band('#1a3f6e', 0);
        band('#4a6b96', Math.PI);

        // Two small dolphin heads at either end
        function head(cx, cy, ang, color) {
          c.save();
          c.translate(cx, cy);
          c.rotate(ang);
          c.beginPath();
          c.arc(0, 0, 1.4 * s, 0, Math.PI * 2);
          c.fillStyle = color;
          c.fill();
          // rostrum
          c.beginPath();
          c.moveTo(1.3 * s, -0.3 * s);
          c.lineTo(2.6 * s, 0.2 * s);
          c.lineTo(1.3 * s, 0.6 * s);
          c.closePath();
          c.fillStyle = color;
          c.fill();
          // eye
          c.beginPath();
          c.arc(0.2 * s, -0.3 * s, 0.25 * s, 0, Math.PI * 2);
          c.fillStyle = '#fff';
          c.fill();
          c.restore();
        }
        head( 6 * s, -1.5 * s,  0.2, '#0d2c52');
        head(-6 * s,  1.5 * s,  Math.PI - 0.2, '#0d2c52');

        c.restore();
      }
    },

    // ----- V10: Art Nouveau — elegant flowing decorative silhouette -----
    {
      name: 'Art Nouveau flourish',
      draw: function (c, x, y, size, flip) {
        c.save();
        c.translate(x, y);
        if (flip) c.rotate(Math.PI);
        c.rotate(-Math.PI * 0.18);
        var s = size / 20;

        // Main body — slender, S-curve
        c.beginPath();
        c.moveTo(8 * s, -1 * s);
        c.bezierCurveTo(7.5 * s, -3 * s, 4 * s, -4.5 * s, 0 * s, -3.5 * s);
        c.bezierCurveTo(-3 * s, -2.5 * s, -4 * s, -1 * s, -5 * s, 0);
        c.bezierCurveTo(-7 * s, 1.5 * s, -8.5 * s, 2 * s, -9 * s, 3 * s);
        c.bezierCurveTo(-5 * s, 1.8 * s, -2 * s, 2.4 * s, 2 * s, 1.8 * s);
        c.bezierCurveTo(5 * s, 1.2 * s, 7 * s, 0.2 * s, 8 * s, -1 * s);
        c.closePath();
        c.fillStyle = '#1a3f6e';
        c.fill();
        c.strokeStyle = '#0d2c52';
        c.lineWidth = 0.4 * s;
        c.stroke();

        // Decorative swirl above the head
        c.beginPath();
        c.moveTo(5 * s, -3.5 * s);
        c.bezierCurveTo(4 * s, -6 * s, 1 * s, -7 * s, -1 * s, -6 * s);
        c.bezierCurveTo(-0.5 * s, -5 * s, 1 * s, -4 * s, 2 * s, -4.5 * s);
        c.strokeStyle = '#1a3f6e';
        c.lineWidth = 0.5 * s;
        c.lineCap = 'round';
        c.stroke();

        // Flourish near tail
        c.beginPath();
        c.moveTo(-8 * s, 2 * s);
        c.bezierCurveTo(-9.5 * s, 0 * s, -10 * s, -2 * s, -8.5 * s, -3 * s);
        c.strokeStyle = '#1a3f6e';
        c.lineWidth = 0.5 * s;
        c.lineCap = 'round';
        c.stroke();

        // Eye
        c.beginPath();
        c.arc(5.5 * s, -2.5 * s, 0.35 * s, 0, Math.PI * 2);
        c.fillStyle = '#fff';
        c.fill();

        c.restore();
      }
    },

    // ----- V11: Apple-emoji-inspired leaping dolphin -----
    // Per Emojipedia: "light-blue dolphin with a white belly in full profile,
    // leaping… short snout curving down to a prominent dorsal fin and tail."
    // Key recognition features: domed melon (not pointed like a fish), smile line,
    // dorsal fin, pectoral fin visible below body, flukes spread at the tail.
    {
      name: 'Iconic leaping (emoji style)',
      draw: function (c, x, y, size, flip) {
        c.save();
        c.translate(x, y);
        if (flip) c.rotate(Math.PI);
        c.rotate(-Math.PI * 0.18);
        var s = size / 20;
        c.translate(-0.3 * s, 1 * s);

        // Body silhouette — melon-forward leaping arc.
        c.beginPath();
        // Rostrum tip (front of short snout)
        c.moveTo(8.5 * s, 0.4 * s);
        // Upper rostrum curving up into the domed MELON (key dolphin feature)
        c.bezierCurveTo(8.3 * s, -1 * s, 7.6 * s, -2.2 * s, 6.2 * s, -3 * s);
        // Rounded crown of the melon — arches over the head
        c.bezierCurveTo(4 * s, -4 * s, 1.5 * s, -4.2 * s, -0.5 * s, -3.5 * s);
        // Along the back toward the dorsal fin base
        c.bezierCurveTo(-1.2 * s, -3.2 * s, -1.6 * s, -3 * s, -2 * s, -2.8 * s);
        // Classic falcate (swept-back) dorsal fin
        c.bezierCurveTo(-1.8 * s, -5.8 * s, -2.4 * s, -6.4 * s, -3.2 * s, -5.6 * s);
        c.bezierCurveTo(-3 * s, -4.4 * s, -3.6 * s, -3.4 * s, -4 * s, -2.6 * s);
        // Back tapering toward the peduncle (tail base)
        c.bezierCurveTo(-5.4 * s, -1.8 * s, -6.6 * s, -1 * s, -7 * s, -0.2 * s);
        // Peduncle wrist
        c.bezierCurveTo(-7.1 * s, 0.2 * s, -7 * s, 0.5 * s, -6.8 * s, 0.8 * s);
        // --- Horizontal tail flukes: two lobes splayed outward ---
        // Upper fluke tip (back-up)
        c.lineTo(-9.5 * s, -0.6 * s);
        // Fluke notch (between the two lobes)
        c.bezierCurveTo(-8.3 * s, 0.6 * s, -7.4 * s, 1.2 * s, -6.8 * s, 1.6 * s);
        // Lower fluke tip (back-down)
        c.lineTo(-9.4 * s, 3.2 * s);
        // Return along underside to belly
        c.bezierCurveTo(-6.6 * s, 2.2 * s, -4 * s, 2 * s, -1.5 * s, 2 * s);
        // Chin + throat curving up to rostrum
        c.bezierCurveTo(2 * s, 2.2 * s, 5 * s, 1.8 * s, 7.5 * s, 1 * s);
        c.bezierCurveTo(8 * s, 0.8 * s, 8.4 * s, 0.6 * s, 8.5 * s, 0.4 * s);
        c.closePath();

        // Counter-shaded light-blue body with white belly (emoji palette)
        var g = c.createLinearGradient(0, -5 * s, 0, 3 * s);
        g.addColorStop(0,    '#1565a8');      // medium-blue back
        g.addColorStop(0.55, '#6aa6d5');      // flank
        g.addColorStop(0.85, '#c8e0f2');      // upper belly
        g.addColorStop(1,    '#ffffff');      // white belly
        c.fillStyle = g;
        c.fill();
        c.strokeStyle = '#0a3265';
        c.lineWidth = 0.5 * s;
        c.lineJoin = 'round';
        c.stroke();

        // Visible pectoral fin (curved, hanging down-forward from chest)
        c.save();
        c.beginPath();
        c.moveTo(3.4 * s, 1.3 * s);
        c.bezierCurveTo(4.8 * s, 2.3 * s, 5.2 * s, 4 * s, 3.8 * s, 4.6 * s);
        c.bezierCurveTo(3 * s, 3.8 * s, 2.2 * s, 2.4 * s, 2.2 * s, 1.6 * s);
        c.bezierCurveTo(2.4 * s, 1.2 * s, 3 * s, 1.2 * s, 3.4 * s, 1.3 * s);
        c.closePath();
        var pg = c.createLinearGradient(2 * s, 1 * s, 5 * s, 4.5 * s);
        pg.addColorStop(0, '#1565a8');
        pg.addColorStop(1, '#0a3265');
        c.fillStyle = pg;
        c.fill();
        c.strokeStyle = '#0a3265';
        c.lineWidth = 0.35 * s;
        c.stroke();
        c.restore();

        // Upturned smile — moved up to sit just under the eye.
        c.beginPath();
        c.moveTo(7.4 * s, -0.4 * s);
        c.bezierCurveTo(6.4 * s, 0.3 * s, 5 * s, 0.4 * s, 3.8 * s, 0 * s);
        c.strokeStyle = '#0a3265';
        c.lineWidth = 0.4 * s;
        c.lineCap = 'round';
        c.stroke();

        // Eye
        c.beginPath();
        c.arc(5.4 * s, -1.8 * s, 0.45 * s, 0, Math.PI * 2);
        c.fillStyle = '#041124';
        c.fill();
        c.beginPath();
        c.arc(5.58 * s, -2 * s, 0.17 * s, 0, Math.PI * 2);
        c.fillStyle = 'rgba(255, 255, 255, 0.95)';
        c.fill();

        c.restore();
      }
    },

    // ----- V12: Heraldic "embowed naiant" — medieval-style horizontal dolphin -----
    // Historical heraldic dolphins are shown horizontally ("naiant") with the back
    // arched upward ("embowed"), often more fish-like than realistic. Stylised and
    // elegant — looks like an ornament on a coat of arms.
    {
      name: 'Heraldic embowed',
      draw: function (c, x, y, size, flip) {
        c.save();
        c.translate(x, y);
        if (flip) c.rotate(Math.PI);
        var s = size / 20;

        // Main body — horizontal fish-like shape, back arched upward
        c.beginPath();
        // Nose tip on the right
        c.moveTo(8.5 * s, 0);
        // Upper rostrum curving up into the arched back
        c.bezierCurveTo(8 * s, -2 * s, 5 * s, -4 * s, 1 * s, -4.2 * s);
        c.bezierCurveTo(-3 * s, -4.2 * s, -5 * s, -3 * s, -6.5 * s, -1.2 * s);
        // Curled tail — sweeping back and under
        c.bezierCurveTo(-7.5 * s, -1.6 * s, -8.5 * s, -0.8 * s, -8 * s, 0.4 * s);
        c.lineTo(-6.5 * s, -0.2 * s);
        // Lower body / belly
        c.bezierCurveTo(-5.5 * s, 1.5 * s, -3 * s, 2.5 * s, 0, 2.8 * s);
        c.bezierCurveTo(3 * s, 3 * s, 6 * s, 2 * s, 8.5 * s, 0);
        c.closePath();
        c.fillStyle = '#1a3f6e';
        c.fill();
        c.strokeStyle = '#0d2c52';
        c.lineWidth = 0.5 * s;
        c.lineJoin = 'round';
        c.stroke();

        // Small triangular dorsal fin on the arched back
        c.beginPath();
        c.moveTo(-1 * s, -4.1 * s);
        c.lineTo(-1.5 * s, -6.5 * s);
        c.lineTo(-3 * s, -3.8 * s);
        c.closePath();
        c.fillStyle = '#0d2c52';
        c.fill();
        c.strokeStyle = '#0d2c52';
        c.lineWidth = 0.35 * s;
        c.stroke();

        // Curled tail fluke — elegant heraldic swoosh back and up
        c.beginPath();
        c.moveTo(-8 * s, 0.4 * s);
        c.bezierCurveTo(-10.5 * s, 1.5 * s, -10.5 * s, -2 * s, -8.5 * s, -2.2 * s);
        c.bezierCurveTo(-7.5 * s, -1.2 * s, -7.5 * s, 0, -8 * s, 0.4 * s);
        c.closePath();
        c.fillStyle = '#1a3f6e';
        c.fill();
        c.strokeStyle = '#0d2c52';
        c.lineWidth = 0.4 * s;
        c.stroke();

        // Pectoral fin tucked under the body
        c.beginPath();
        c.moveTo(3 * s, 2.2 * s);
        c.bezierCurveTo(3.5 * s, 3.5 * s, 2 * s, 4.5 * s, 0.5 * s, 4 * s);
        c.bezierCurveTo(1 * s, 3 * s, 2 * s, 2.3 * s, 3 * s, 2.2 * s);
        c.closePath();
        c.fillStyle = '#0d2c52';
        c.fill();

        // Decorative fish-scale hint (a few curved lines on the flank)
        c.save();
        c.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        c.lineWidth = 0.25 * s;
        c.lineCap = 'round';
        for (var i = 0; i < 3; i++) {
          c.beginPath();
          c.arc(-1 + i * 2 * s, 0, 0.8 * s, Math.PI * 1.15, Math.PI * 1.85);
          c.stroke();
        }
        c.restore();

        // Eye
        c.beginPath();
        c.arc(6.5 * s, -1 * s, 0.35 * s, 0, Math.PI * 2);
        c.fillStyle = '#fff';
        c.fill();
        c.beginPath();
        c.arc(6.5 * s, -1 * s, 0.18 * s, 0, Math.PI * 2);
        c.fillStyle = '#041124';
        c.fill();

        // Smile line
        c.beginPath();
        c.moveTo(8 * s, 0.4 * s);
        c.bezierCurveTo(7.5 * s, 1 * s, 6.5 * s, 1.2 * s, 5.5 * s, 0.8 * s);
        c.strokeStyle = '#0d2c52';
        c.lineWidth = 0.3 * s;
        c.lineCap = 'round';
        c.stroke();

        c.restore();
      }
    },

    // ----- V13: Minimalist bottlenose — clean silhouette, melon + flukes emphasized -----
    // Strips everything except the three features that distinguish a dolphin from a fish:
    // (1) a rounded MELON rather than a pointed head, (2) a swept-back DORSAL fin, and
    // (3) a pair of HORIZONTAL tail flukes at the end of a narrow peduncle.
    {
      name: 'Minimalist bottlenose',
      draw: function (c, x, y, size, flip) {
        c.save();
        c.translate(x, y);
        if (flip) c.rotate(Math.PI);
        c.rotate(-Math.PI * 0.16);
        var s = size / 20;
        c.translate(-0.3 * s, 0.7 * s);

        // Single-tone silhouette
        c.beginPath();
        c.moveTo(8.6 * s, 0.6 * s);
        // Short rostrum
        c.bezierCurveTo(8.5 * s, -0.8 * s, 7.6 * s, -1.6 * s, 6.2 * s, -1.8 * s);
        // Strongly-domed melon (the key feature)
        c.bezierCurveTo(3.8 * s, -2.4 * s, 0.5 * s, -3.4 * s, -1 * s, -3.2 * s);
        // Back toward dorsal base
        c.bezierCurveTo(-1.6 * s, -3 * s, -1.8 * s, -2.8 * s, -2 * s, -2.6 * s);
        // Falcate dorsal fin (swept back)
        c.bezierCurveTo(-1.6 * s, -5 * s, -2.4 * s, -5.6 * s, -3.4 * s, -4.8 * s);
        c.bezierCurveTo(-3 * s, -3.6 * s, -3.6 * s, -3 * s, -4 * s, -2.2 * s);
        // Back to peduncle (narrowing tail stalk)
        c.bezierCurveTo(-5.4 * s, -1.4 * s, -6.6 * s, -0.6 * s, -7 * s, 0);
        // Horizontal fluke spread (two lobes)
        c.lineTo(-9.4 * s, -0.8 * s);
        c.bezierCurveTo(-8.4 * s, 0.4 * s, -7.6 * s, 1 * s, -7 * s, 1.4 * s);
        c.lineTo(-9.4 * s, 3 * s);
        // Belly back to rostrum
        c.bezierCurveTo(-6.5 * s, 2.2 * s, -3 * s, 2 * s, 0, 2.2 * s);
        c.bezierCurveTo(4 * s, 2.2 * s, 7 * s, 1.6 * s, 8.6 * s, 0.6 * s);
        c.closePath();
        c.fillStyle = '#1a3f6e';
        c.fill();

        // Small white belly curve — single defining detail
        c.save();
        c.beginPath();
        c.moveTo(6 * s, 1.8 * s);
        c.bezierCurveTo(3 * s, 2.3 * s, -1 * s, 2.3 * s, -4 * s, 2.1 * s);
        c.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        c.lineWidth = 0.5 * s;
        c.lineCap = 'round';
        c.stroke();
        c.restore();

        // Eye
        c.beginPath();
        c.arc(5.5 * s, -1 * s, 0.35 * s, 0, Math.PI * 2);
        c.fillStyle = '#fff';
        c.fill();

        c.restore();
      }
    },

    // ----- V14: Reference-image leaping — cartoon illustration style with splash -----
    // Emulates a user-supplied dolphin illustration: deep navy body, pale belly,
    // pronounced melon and smile, big pectoral fin, visible tail flukes, and a
    // water splash trailing below the tail.
    {
      name: 'Splashing leap (illustration style)',
      draw: function (c, x, y, size, flip) {
        c.save();
        c.translate(x, y);
        if (flip) c.rotate(Math.PI);
        c.rotate(-Math.PI * 0.22);
        var s = size / 20;
        c.translate(-0.2 * s, 0.8 * s);

        var navyDeep = '#0e2a4c';
        var navyMid  = '#1e4478';
        var navyUp   = '#3a67a0';
        var blueBelly= '#a8c6e0';

        // --- Water splash below the tail (drawn first, behind body) ---
        c.save();
        c.translate(-7 * s, 2.5 * s);
        // Big splash shape (light blue, watery)
        c.beginPath();
        c.moveTo(-3 * s, 0);
        c.bezierCurveTo(-3.5 * s, -1.5 * s, -2 * s, -2.5 * s, 0, -2 * s);
        c.bezierCurveTo(1 * s, -1 * s, 0.5 * s, 0.5 * s, -0.5 * s, 1.2 * s);
        c.bezierCurveTo(-1.5 * s, 1.6 * s, -2.5 * s, 1.2 * s, -3 * s, 0);
        c.closePath();
        c.fillStyle = 'rgba(168, 198, 224, 0.85)';
        c.fill();
        c.strokeStyle = 'rgba(14, 42, 76, 0.6)';
        c.lineWidth = 0.3 * s;
        c.stroke();
        // Small droplets scattered around
        c.fillStyle = 'rgba(168, 198, 224, 0.85)';
        var drops = [
          [-4 * s, -1 * s, 0.25 * s],
          [-4.5 * s, 0.5 * s, 0.3 * s],
          [-2 * s, -3 * s, 0.35 * s],
          [ 1.2 * s, -2.6 * s, 0.28 * s],
          [ 1.5 * s, 0.8 * s, 0.22 * s],
          [-3.2 * s, 1.8 * s, 0.32 * s],
          [-0.5 * s, 2 * s, 0.25 * s],
          [ 0.6 * s, 1.5 * s, 0.2 * s]
        ];
        for (var di = 0; di < drops.length; di++) {
          c.beginPath();
          c.arc(drops[di][0], drops[di][1], drops[di][2], 0, Math.PI * 2);
          c.fill();
        }
        // A short splash streak
        c.save();
        c.strokeStyle = 'rgba(168, 198, 224, 0.7)';
        c.lineWidth = 0.25 * s;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(-4.5 * s, 1.2 * s);
        c.bezierCurveTo(-3 * s, 1.4 * s, -2 * s, 1.6 * s, -1 * s, 1.5 * s);
        c.stroke();
        c.beginPath();
        c.moveTo(-5.5 * s, -0.5 * s);
        c.bezierCurveTo(-4.5 * s, -0.3 * s, -3.5 * s, -0.2 * s, -3 * s, 0);
        c.stroke();
        c.restore();
        c.restore();

        // --- Main body silhouette ---
        c.beginPath();
        // Rostrum tip
        c.moveTo(8.6 * s, 0.6 * s);
        // Upper rostrum into melon
        c.bezierCurveTo(8.4 * s, -0.9 * s, 7.5 * s, -2.2 * s, 6 * s, -3 * s);
        // Rounded crown of the melon
        c.bezierCurveTo(3.8 * s, -4 * s, 1 * s, -4.2 * s, -0.8 * s, -3.5 * s);
        // Pre-dorsal back
        c.bezierCurveTo(-1.4 * s, -3.2 * s, -1.8 * s, -3 * s, -2.1 * s, -2.8 * s);
        // Falcate dorsal fin — swept back, pointier at the peak
        c.bezierCurveTo(-1.8 * s, -5 * s, -2.4 * s, -5.9 * s, -3.2 * s, -5.4 * s);
        c.bezierCurveTo(-3 * s, -4.3 * s, -3.6 * s, -3.4 * s, -4 * s, -2.6 * s);
        // Back tapering to peduncle
        c.bezierCurveTo(-5.4 * s, -1.8 * s, -6.6 * s, -1 * s, -7 * s, -0.2 * s);
        // Peduncle wrist
        c.bezierCurveTo(-7.1 * s, 0.2 * s, -7 * s, 0.5 * s, -6.8 * s, 0.8 * s);
        // Upper fluke
        c.lineTo(-9.4 * s, -0.6 * s);
        // Fluke notch
        c.bezierCurveTo(-8.2 * s, 0.5 * s, -7.4 * s, 1.1 * s, -6.8 * s, 1.5 * s);
        // Lower fluke
        c.lineTo(-9.3 * s, 2.9 * s);
        // Underside back to belly
        c.bezierCurveTo(-6.4 * s, 2 * s, -4 * s, 1.9 * s, -1.5 * s, 2 * s);
        // Chin to rostrum
        c.bezierCurveTo(2 * s, 2.2 * s, 5 * s, 1.8 * s, 7.5 * s, 1.1 * s);
        c.bezierCurveTo(8.1 * s, 0.9 * s, 8.4 * s, 0.7 * s, 8.6 * s, 0.6 * s);
        c.closePath();

        // Counter-shaded navy body (deep navy top → pale blue belly)
        var bodyGrad = c.createLinearGradient(0, -5 * s, 0, 3 * s);
        bodyGrad.addColorStop(0,    navyDeep);
        bodyGrad.addColorStop(0.45, navyMid);
        bodyGrad.addColorStop(0.82, navyUp);
        bodyGrad.addColorStop(1,    blueBelly);
        c.fillStyle = bodyGrad;
        c.fill();
        c.strokeStyle = navyDeep;
        c.lineWidth = 0.5 * s;
        c.lineJoin = 'round';
        c.stroke();

        // Belly line — pale curve separating light belly from body flank
        c.save();
        c.beginPath();
        c.moveTo(7 * s, 1 * s);
        c.bezierCurveTo(4 * s, 1.7 * s, 0 * s, 1.9 * s, -3 * s, 1.8 * s);
        c.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        c.lineWidth = 0.35 * s;
        c.lineCap = 'round';
        c.stroke();
        c.restore();

        // Back highlight — thin lighter band along the upper flank
        c.save();
        c.beginPath();
        c.moveTo(5.5 * s, -2.8 * s);
        c.bezierCurveTo(3 * s, -3.4 * s, 0 * s, -3.4 * s, -1.5 * s, -3 * s);
        c.strokeStyle = 'rgba(130, 165, 210, 0.55)';
        c.lineWidth = 0.3 * s;
        c.lineCap = 'round';
        c.stroke();
        c.restore();

        // --- Big, clearly-visible pectoral fin ---
        c.save();
        c.beginPath();
        c.moveTo(3.2 * s, 1 * s);
        c.bezierCurveTo(5 * s, 2 * s, 5.7 * s, 4 * s, 4.5 * s, 5 * s);
        c.bezierCurveTo(3.5 * s, 4.6 * s, 2.4 * s, 3 * s, 2 * s, 1.8 * s);
        c.bezierCurveTo(2 * s, 1.2 * s, 2.6 * s, 0.9 * s, 3.2 * s, 1 * s);
        c.closePath();
        var pg = c.createLinearGradient(2 * s, 1 * s, 5 * s, 5 * s);
        pg.addColorStop(0, navyMid);
        pg.addColorStop(1, navyDeep);
        c.fillStyle = pg;
        c.fill();
        c.strokeStyle = navyDeep;
        c.lineWidth = 0.4 * s;
        c.stroke();
        c.restore();

        // Smile
        c.beginPath();
        c.moveTo(7.6 * s, 0.5 * s);
        c.bezierCurveTo(6.6 * s, 1.2 * s, 5.2 * s, 1.4 * s, 3.8 * s, 1 * s);
        c.strokeStyle = navyDeep;
        c.lineWidth = 0.4 * s;
        c.lineCap = 'round';
        c.stroke();

        // Eye
        c.beginPath();
        c.arc(5.4 * s, -1.8 * s, 0.45 * s, 0, Math.PI * 2);
        c.fillStyle = '#041124';
        c.fill();
        c.beginPath();
        c.arc(5.55 * s, -2 * s, 0.16 * s, 0, Math.PI * 2);
        c.fillStyle = 'rgba(255, 255, 255, 0.95)';
        c.fill();

        c.restore();
      }
    }
  ];

  // Hare — face only: tall ears ABOVE the head, bottoms tangent with face top, smiling.
  function drawHarePip(c, x, y, size, flip) {
    c.save();
    c.translate(x, y);
    if (flip) c.rotate(Math.PI);
    var s = size / 20;
    // Shift drawing so the visual centre (midpoint between ear tops and face bottom)
    // lands on the pip's drawing origin → equal top and bottom margins on the card.
    c.translate(0, 2.1 * s);
    var color = ANIMAL_COLORS.hearts;
    var light = '#c48a5a';
    var dark = '#5a2b0d';

    // Face — rx 5.082*s, ry 5.566*s.
    var faceCy = 1 * s;
    var faceRx = 5.082 * s;
    var faceRy = 5.566 * s;
    var faceTopY = faceCy - faceRy;   // ≈ -4.57*s

    // Ears: 10% wider than previous (1.15 → 1.265*s), and spread further apart
    // on the head (centres moved from ±1.5*s to ±2.1*s).
    var earHalfW = 1.265 * s;
    var earHalfH = 3.2 * s;
    var earCy = faceTopY - earHalfH + 0.2 * s;   // bottoms tangent with head top
    function drawEar(cx, tilt) {
      c.save();
      c.translate(cx, earCy);
      c.rotate(tilt);
      c.beginPath();
      c.ellipse(0, 0, earHalfW, earHalfH, 0, 0, Math.PI * 2);
      c.fillStyle = color;
      c.fill();
      c.strokeStyle = 'rgba(60, 30, 10, 0.65)';
      c.lineWidth = 0.4 * s;
      c.stroke();
      // Inner ear (pink) — narrow oval pushed toward the tip
      c.beginPath();
      c.ellipse(0, -0.3 * s, earHalfW * 0.4, earHalfH * 0.72, 0, 0, Math.PI * 2);
      c.fillStyle = '#e59fae';
      c.fill();
      c.restore();
    }
    drawEar(-2.1 * s, -0.18);
    drawEar( 2.1 * s,  0.18);

    // Face (opaque, covers ear roots)
    c.save();
    c.beginPath();
    c.ellipse(0, faceCy, faceRx, faceRy, 0, 0, Math.PI * 2);
    var faceGrad = c.createRadialGradient(-1.3 * s, -0.3 * s, 0.4 * s, 0, faceCy, 5.5 * s);
    faceGrad.addColorStop(0, light);
    faceGrad.addColorStop(0.6, color);
    faceGrad.addColorStop(1, dark);
    c.fillStyle = faceGrad;
    c.fill();
    c.strokeStyle = 'rgba(60, 30, 10, 0.7)';
    c.lineWidth = 0.45 * s;
    c.stroke();
    c.restore();

    // Eyes (scaled out slightly with the face)
    c.fillStyle = '#0a0a0a';
    c.beginPath();
    c.arc(-1.75 * s, 0.2 * s, 0.6 * s, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc( 1.75 * s, 0.2 * s, 0.6 * s, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.beginPath();
    c.arc(-1.58 * s, 0, 0.2 * s, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc( 1.92 * s, 0, 0.2 * s, 0, Math.PI * 2);
    c.fill();

    // Muzzle patch (lighter around nose) — 25% bigger than before.
    c.save();
    c.beginPath();
    c.ellipse(0, 2.6 * s, 2.3125 * s, 1.625 * s, 0, 0, Math.PI * 2);
    c.fillStyle = 'rgba(245, 225, 200, 0.55)';
    c.fill();
    c.restore();

    // Nose
    c.beginPath();
    c.moveTo(-0.5 * s, 2.05 * s);
    c.lineTo( 0.5 * s, 2.05 * s);
    c.lineTo(0, 2.55 * s);
    c.closePath();
    c.fillStyle = '#3a1a0a';
    c.fill();

    // Smile — moved up another smidge (2.45→2.2*s).
    c.beginPath();
    c.arc(0, 2.2 * s, 1.6 * s, 0.08 * Math.PI, 0.92 * Math.PI);
    c.strokeStyle = 'rgba(40, 20, 5, 0.9)';
    c.lineWidth = 0.368 * s;
    c.lineCap = 'round';
    c.stroke();

    // Whiskers — start at the muzzle edge (muzzle is centred at (0, 2.6*s) with
    // rx=2.3125*s, ry=1.625*s; the ellipse intersection at these whisker y-values
    // is ≈ ±2.25*s), then extend outward past the face.
    c.save();
    c.strokeStyle = 'rgba(40, 20, 5, 0.55)';
    c.lineWidth = 0.18 * s;
    c.lineCap = 'round';
    var wy = [2.4 * s, 3 * s];
    for (var wi = 0; wi < wy.length; wi++) {
      c.beginPath();
      c.moveTo(-2.25 * s, wy[wi]);
      c.lineTo(-4.6 * s, wy[wi] - 0.25 * s);
      c.moveTo( 2.25 * s, wy[wi]);
      c.lineTo( 4.6 * s, wy[wi] - 0.25 * s);
      c.stroke();
    }
    c.restore();

    c.restore();
  }

  // Spider — top-down, 8 legs radiating, black
  function drawSpiderPip(c, x, y, size, flip) {
    c.save();
    c.translate(x, y);
    if (flip) c.rotate(Math.PI);
    var s = size / 20;
    var color = ANIMAL_COLORS.spades;

    // Draw legs first (behind body). 4 per side, each with elbow bend.
    // Coordinates as [hipX, hipY, elbowX, elbowY, footX, footY]
    var legs = [
      // Left side (x negative)
      [-1.5 * s, -1.5 * s, -5 * s, -4 * s, -6.5 * s, -5.5 * s],   // front-top
      [-1.8 * s, -0.2 * s, -5.8 * s, -1.8 * s, -7.2 * s, -0.5 * s], // upper-middle
      [-1.8 * s,  0.8 * s, -5.8 * s,  1.2 * s, -7.2 * s,  2.5 * s], // lower-middle
      [-1.5 * s,  2 * s,   -5 * s,   4.2 * s, -6 * s,    6 * s],    // back
      // Right side (mirror)
      [ 1.5 * s, -1.5 * s,  5 * s, -4 * s,   6.5 * s, -5.5 * s],
      [ 1.8 * s, -0.2 * s,  5.8 * s, -1.8 * s,  7.2 * s, -0.5 * s],
      [ 1.8 * s,  0.8 * s,  5.8 * s,  1.2 * s,  7.2 * s,  2.5 * s],
      [ 1.5 * s,  2 * s,    5 * s,   4.2 * s,  6 * s,    6 * s]
    ];
    c.save();
    c.strokeStyle = color;
    c.lineWidth = 0.95 * s;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (var i = 0; i < legs.length; i++) {
      var L = legs[i];
      c.beginPath();
      c.moveTo(L[0], L[1]);
      c.lineTo(L[2], L[3]);
      c.lineTo(L[4], L[5]);
      c.stroke();
    }
    c.restore();

    // Abdomen (larger, lower)
    c.save();
    c.beginPath();
    c.ellipse(0, 2.2 * s, 3 * s, 3.6 * s, 0, 0, Math.PI * 2);
    var abGrad = c.createRadialGradient(-0.8 * s, 1 * s, 0.3 * s, 0, 2.2 * s, 4 * s);
    abGrad.addColorStop(0, '#4a4a4a');
    abGrad.addColorStop(0.6, '#1a1a1a');
    abGrad.addColorStop(1, '#000000');
    c.fillStyle = abGrad;
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.85)';
    c.lineWidth = 0.4 * s;
    c.stroke();
    c.restore();

    // Cephalothorax (head/front)
    c.save();
    c.beginPath();
    c.ellipse(0, -1.8 * s, 2.2 * s, 2 * s, 0, 0, Math.PI * 2);
    var cephGrad = c.createRadialGradient(-0.6 * s, -2.5 * s, 0.2 * s, 0, -1.8 * s, 2.5 * s);
    cephGrad.addColorStop(0, '#505050');
    cephGrad.addColorStop(0.7, '#1a1a1a');
    cephGrad.addColorStop(1, '#000000');
    c.fillStyle = cephGrad;
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.85)';
    c.lineWidth = 0.4 * s;
    c.stroke();
    c.restore();

    // Eyes — 4 small red/white dots on cephalothorax
    c.fillStyle = '#ffeb3b';
    c.beginPath();
    c.arc(-0.9 * s, -2.5 * s, 0.28 * s, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc(0.9 * s, -2.5 * s, 0.28 * s, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.arc(-0.3 * s, -2.1 * s, 0.22 * s, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc(0.3 * s, -2.1 * s, 0.22 * s, 0, Math.PI * 2);
    c.fill();

    c.restore();
  }

  // Bear Cub — face only. Ears sit at the upper-side head corners and are hidden
  // behind a fully-opaque head; only the outer portion of each ear pokes out
  // (classic teddy-bear silhouette). Smiling.
  function drawCubPip(c, x, y, size, flip) {
    c.save();
    c.translate(x, y);
    if (flip) c.rotate(Math.PI);
    var s = size / 20;
    var color = ANIMAL_COLORS.clubs;
    var light = '#6d4c3a';
    var dark = '#1b0f08';

    var headCy = 0.6 * s;
    var headR = 5 * s;
    var earR = 2.1 * s;

    // Ears drawn first at the head's upper-side corners (x = ±3.8*s, y = -3.5*s).
    // Because the head is drawn opaque on top, only the outer crescent of each
    // ear is visible — like a teddy bear.
    function drawEar(cx) {
      c.save();
      c.beginPath();
      c.arc(cx, -3.5 * s, earR, 0, Math.PI * 2);
      c.fillStyle = color;
      c.fill();
      c.strokeStyle = 'rgba(20, 10, 5, 0.7)';
      c.lineWidth = 0.4 * s;
      c.stroke();
      // Inner ear — a smaller lighter circle toward the center of the face
      c.beginPath();
      c.arc(cx * 0.72, -3.2 * s, 0.95 * s, 0, Math.PI * 2);
      c.fillStyle = '#b08870';
      c.fill();
      c.restore();
    }
    drawEar(-3.8 * s);
    drawEar( 3.8 * s);

    // Head — fully opaque, hides inner halves of the ears
    c.save();
    c.beginPath();
    c.arc(0, headCy, headR, 0, Math.PI * 2);
    var headGrad = c.createRadialGradient(-1.4 * s, -0.6 * s, 0.4 * s, 0, headCy, 6 * s);
    headGrad.addColorStop(0, light);
    headGrad.addColorStop(0.6, color);
    headGrad.addColorStop(1, dark);
    c.fillStyle = headGrad;
    c.fill();
    c.strokeStyle = 'rgba(20, 10, 5, 0.7)';
    c.lineWidth = 0.45 * s;
    c.stroke();
    c.restore();

    // Muzzle (lighter patch on lower half of face)
    c.save();
    c.beginPath();
    c.ellipse(0, 2.2 * s, 2.6 * s, 1.9 * s, 0, 0, Math.PI * 2);
    c.fillStyle = '#d8b593';
    c.fill();
    c.strokeStyle = 'rgba(20, 10, 5, 0.35)';
    c.lineWidth = 0.3 * s;
    c.stroke();
    c.restore();

    // Nose
    c.save();
    c.beginPath();
    c.ellipse(0, 1.4 * s, 0.9 * s, 0.65 * s, 0, 0, Math.PI * 2);
    c.fillStyle = '#0a0a0a';
    c.fill();
    c.beginPath();
    c.arc(-0.25 * s, 1.2 * s, 0.18 * s, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fill();
    c.restore();

    // Smile
    c.beginPath();
    c.arc(0, 2.3 * s, 1.3 * s, 0.1 * Math.PI, 0.9 * Math.PI);
    c.strokeStyle = 'rgba(20, 10, 5, 0.9)';
    c.lineWidth = 0.3 * s;
    c.lineCap = 'round';
    c.stroke();

    // Eyes
    c.fillStyle = '#0a0a0a';
    c.beginPath();
    c.arc(-1.8 * s, -0.4 * s, 0.55 * s, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc( 1.8 * s, -0.4 * s, 0.55 * s, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.beginPath();
    c.arc(-1.65 * s, -0.6 * s, 0.2 * s, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc( 1.95 * s, -0.6 * s, 0.2 * s, 0, Math.PI * 2);
    c.fill();

    c.restore();
  }

  // Dispatch animal pip drawing by suit
  function drawAnimalPip(c, x, y, size, suit, flip) {
    if (suit === 'diamonds') drawDolphinPip(c, x, y, size, flip);
    else if (suit === 'hearts') drawHarePip(c, x, y, size, flip);
    else if (suit === 'spades') drawSpiderPip(c, x, y, size, flip);
    else if (suit === 'clubs') drawCubPip(c, x, y, size, flip);
  }

  // ---- Pip Layouts ----
  // [relativeX, relativeY, isFlipped]
  // 3 = triangle: 1 top center, 2 bottom row
  // 10 = top 5 offset right, bottom 5 offset left (for wider "10" text)
  // Standard layouts for text-based suits (clubs)
  // Classic pip layouts — designed for 20px pips in 42×64 area
  // Top rows at y=0.12, bottom rows at y=0.88 (consistent edges across all ranks)
  // X columns at 0.2/0.8 for 2-col, 0.5 for center
  var PIP_LAYOUTS = {
    1:  [[0.5, 0.5, false]],
    2:  [[0.5, 0.12, false], [0.5, 0.88, true]],
    3:  [[0.5, 0.12, false], [0.5, 0.5, false], [0.5, 0.88, true]],
    4:  [[0.2, 0.12, false], [0.8, 0.12, false], [0.2, 0.88, true], [0.8, 0.88, true]],
    5:  [[0.2, 0.12, false], [0.8, 0.12, false], [0.5, 0.5, false], [0.2, 0.88, true], [0.8, 0.88, true]],
    6:  [[0.2, 0.12, false], [0.8, 0.12, false], [0.2, 0.5, false], [0.8, 0.5, false], [0.2, 0.88, true], [0.8, 0.88, true]],
    7:  [[0.2, 0.12, false], [0.8, 0.12, false], [0.2, 0.5, false], [0.8, 0.5, false], [0.5, 0.31, false], [0.2, 0.88, true], [0.8, 0.88, true]],
    8:  [[0.2, 0.12, false], [0.8, 0.12, false], [0.2, 0.5, false], [0.8, 0.5, false], [0.5, 0.31, false], [0.5, 0.69, true], [0.2, 0.88, true], [0.8, 0.88, true]],
    9:  [[0.2, 0.08, false], [0.8, 0.08, false], [0.2, 0.34, false], [0.8, 0.34, false], [0.5, 0.5, false], [0.2, 0.66, true], [0.8, 0.66, true], [0.2, 0.92, true], [0.8, 0.92, true]],
    10: [[0.2, 0.08, false], [0.8, 0.08, false], [0.5, 0.21, false], [0.2, 0.34, false], [0.8, 0.34, false], [0.2, 0.66, true], [0.8, 0.66, true], [0.5, 0.79, true], [0.2, 0.92, true], [0.8, 0.92, true]]
  };

  // Custom pip layouts for laser suits (drawn symbols need more room)
  // 2,3 = horizontal center line; 6 = 2×3; 7 = 2-3-2; 8 = 3-2-3; 9 = 3×3; 10 = 2-3-3-2
  // Wide horizontal spread: 3-col = 0.08/0.50/0.92, 2-col = 0.15/0.85
  var CUSTOM_PIP_LAYOUTS = {
    1:  [[0.5, 0.5, false]],
    2:  [[0.2, 0.5, false], [0.8, 0.5, false]],
    3:  [[0.5, 0.2, false], [0.2, 0.78, false], [0.8, 0.78, false]],
    4:  [[0.15, 0.15, false], [0.85, 0.15, false], [0.15, 0.85, true], [0.85, 0.85, true]],
    5:  [[0.15, 0.12, false], [0.85, 0.12, false], [0.5, 0.5, false], [0.15, 0.88, true], [0.85, 0.88, true]],
    6:  [[0.08, 0.22, false], [0.5, 0.22, false], [0.92, 0.22, false],
         [0.08, 0.78, true],  [0.5, 0.78, true],  [0.92, 0.78, true]],
    7:  [[0.25, 0.12, false], [0.75, 0.12, false],
         [0.08, 0.5, false],  [0.5, 0.5, false],  [0.92, 0.5, false],
         [0.25, 0.88, true],  [0.75, 0.88, true]],
    8:  [[0.08, 0.12, false], [0.5, 0.12, false], [0.92, 0.12, false],
         [0.25, 0.5, false],  [0.75, 0.5, false],
         [0.08, 0.88, true],  [0.5, 0.88, true],  [0.92, 0.88, true]],
    9:  [[0.08, 0.12, false], [0.5, 0.12, false], [0.92, 0.12, false],
         [0.08, 0.5, false],  [0.5, 0.5, false],  [0.92, 0.5, false],
         [0.08, 0.88, true],  [0.5, 0.88, true],  [0.92, 0.88, true]],
    10: [[0.25, 0.02, false], [0.75, 0.02, false],
         [0.08, 0.34, false], [0.5, 0.34, false], [0.92, 0.34, false],
         [0.08, 0.66, true],  [0.5, 0.66, true],  [0.92, 0.66, true],
         [0.25, 0.98, true],  [0.75, 0.98, true]]
  };

  // Prisms use vertical arrangement for 2-card
  var PRISM_2_LAYOUT = [[0.5, 0.2, false], [0.5, 0.8, false]];

  // Prism-specific layouts: rows of 3 have 0.5 gap between pips (matching rows of 2 at 0.25/0.75), so x = 0.0 / 0.5 / 1.0
  var PRISM_6_LAYOUT = [[0.2, 0.12, false], [0.8, 0.12, false],
       [0.2, 0.5, false],  [0.8, 0.5, false],
       [0.2, 0.88, false], [0.8, 0.88, false]];
  var PRISM_7_LAYOUT = [[0.25, 0.12, false], [0.75, 0.12, false],
       [0.0, 0.5, false],  [0.5, 0.5, false],  [1.0, 0.5, false],
       [0.25, 0.88, true],  [0.75, 0.88, true]];
  var PRISM_8_LAYOUT = [[0.0, 0.12, false], [0.5, 0.12, false], [1.0, 0.12, false],
       [0.25, 0.5, false],  [0.75, 0.5, false],
       [0.0, 0.88, true],  [0.5, 0.88, true],  [1.0, 0.88, true]];
  var PRISM_9_LAYOUT = [[0.0, 0.12, false], [0.5, 0.12, false], [1.0, 0.12, false],
       [0.0, 0.5, false],  [0.5, 0.5, false],  [1.0, 0.5, false],
       [0.0, 0.88, true],  [0.5, 0.88, true],  [1.0, 0.88, true]];
  var PRISM_10_LAYOUT = [[0.25, 0.02, false], [0.75, 0.02, false],
       [0.0, 0.34, false], [0.5, 0.34, false], [1.0, 0.34, false],
       [0.0, 0.66, true],  [0.5, 0.66, true],  [1.0, 0.66, true],
       [0.25, 0.98, true],  [0.75, 0.98, true]];

  // Diodes & Prisms use 3 rows of 2 for 6-card (wider symbols need vertical stacking)
  var WIDE_6_LAYOUT = [[0.2, 0.12, false], [0.8, 0.12, false],
       [0.2, 0.5, false],  [0.8, 0.5, false],
       [0.2, 0.88, false], [0.8, 0.88, false]];

  // Diode-specific 10: rows of 2 pushed further from rows of 3
  var DIODE_10_LAYOUT = [[0.25, 0.02, false], [0.75, 0.02, false],
       [0.08, 0.34, false], [0.5, 0.34, false], [0.92, 0.34, false],
       [0.08, 0.66, false], [0.5, 0.66, false], [0.92, 0.66, false],
       [0.25, 0.98, false], [0.75, 0.98, false]];

  // Blade-specific 10: 3-4-3 rows, all centered
  var BLADE_10_LAYOUT = [[0.15, 0.08, false], [0.50, 0.08, false], [0.85, 0.08, false],
       [-0.025, 0.50, false], [0.325, 0.50, false], [0.675, 0.50, false], [1.025, 0.50, false],
       [0.15, 0.92, false], [0.50, 0.92, false], [0.85, 0.92, false]];

  // Combiner-specific layouts: rows of 3 at 0.0/0.5/1.0 (wider than standard 0.08/0.50/0.92)
  var COMBINER_7_LAYOUT = [[0.25, 0.12, false], [0.75, 0.12, false],
       [0.0, 0.5, false],  [0.5, 0.5, false],  [1.0, 0.5, false],
       [0.25, 0.88, true],  [0.75, 0.88, true]];
  var COMBINER_8_LAYOUT = [[0.0, 0.12, false], [0.5, 0.12, false], [1.0, 0.12, false],
       [0.25, 0.5, false],  [0.75, 0.5, false],
       [0.0, 0.88, true],  [0.5, 0.88, true],  [1.0, 0.88, true]];
  var COMBINER_9_LAYOUT = [[0.0, 0.12, false], [0.5, 0.12, false], [1.0, 0.12, false],
       [0.0, 0.5, false],  [0.5, 0.5, false],  [1.0, 0.5, false],
       [0.0, 0.88, true],  [0.5, 0.88, true],  [1.0, 0.88, true]];
  var COMBINER_10_LAYOUT = [[0.25, 0.02, false], [0.75, 0.02, false],
       [0.0, 0.34, false], [0.5, 0.34, false], [1.0, 0.34, false],
       [0.0, 0.66, true],  [0.5, 0.66, true],  [1.0, 0.66, true],
       [0.25, 0.98, true],  [0.75, 0.98, true]];

  // Blade-specific layouts with more vertical spacing
  var BLADE_4_LAYOUT = [[0.15, 0.1, false], [0.85, 0.1, false], [0.15, 0.9, false], [0.85, 0.9, false]];
  var BLADE_6_LAYOUT = [[0.2, 0.08, false], [0.8, 0.08, false],
       [0.2, 0.5, false],  [0.8, 0.5, false],
       [0.2, 0.92, false], [0.8, 0.92, false]];
  var BLADE_5_LAYOUT = [[0.15, 0.08, false], [0.85, 0.08, false], [0.5, 0.5, false], [0.15, 0.92, false], [0.85, 0.92, false]];
  var BLADE_7_LAYOUT = [[0.25, 0.08, false], [0.75, 0.08, false],
       [0.08, 0.5, false],  [0.5, 0.5, false],  [0.92, 0.5, false],
       [0.25, 0.92, false], [0.75, 0.92, false]];
  var BLADE_8_LAYOUT = [[0.08, 0.08, false], [0.5, 0.08, false], [0.92, 0.08, false],
       [0.25, 0.5, false],  [0.75, 0.5, false],
       [0.08, 0.92, false], [0.5, 0.92, false], [0.92, 0.92, false]];
  var BLADE_9_LAYOUT = [[0.08, 0.08, false], [0.5, 0.08, false], [0.92, 0.08, false],
       [0.08, 0.5, false],  [0.5, 0.5, false],  [0.92, 0.5, false],
       [0.08, 0.92, false], [0.5, 0.92, false], [0.92, 0.92, false]];

  // ---- Textures ----
  var cardTextures = {};
  var backTexture = null;
  var shadowTexture = null;
  var glowTexture = null;
  var foundationBorderTexture = null;
  var illegalMoveTexture = null;
  var placeholderTextures = {};
  var emptyPlaceholderTexture = null;
  var particleTex = null;
  var particleTextures = [];

  // ---- Sprite pool ----
  var spritePool = [];
  var poolIndex = 0;

  // ---- Particles ----
  var particles = [];
  var PARTICLE_COUNT = 80;

  // ---- Render callback ----
  var gameRenderCallback = null;
  var tickerFn = null;

  // ================================================================
  //  CANVAS 2D HELPERS
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

  // ================================================================
  //  CARD FACE PRE-RENDERING
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
    Textures.paperTexture(c, CARD_W, CARD_H);
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
    var isAnimals = isAnimalsSuit(suit);
    var hideCornerSym = isCustom || isAnimals;
    var numericRank = parseInt(rank);
    var isOne = (numericRank === 1);

    // Corner insets (symmetric from card edges)
    var cornerX = isOne ? 14 : 10;
    var rankY = isOne ? 6 : 5;   // distance from edge to top/bottom of rank text
    var symY = isOne ? 22 : 17;  // distance from edge to top/bottom of suit symbol

    // Use Georgia for numeric ranks (Cinzel "1" looks like capital I) and for J & K
    var isNumeric = !isNaN(numericRank);
    var useGeorgia = isNumeric || rank === 'J' || rank === 'K';
    var rankFontSize = isOne ? 22 : 11;
    var rankFont = useGeorgia ? 'bold ' + rankFontSize + 'px Georgia, serif' : 'bold ' + rankFontSize + 'px Cinzel, Georgia, serif';
    var cornerSymSize = isOne ? 20 : 10;

    // Top-left corner: rank then suit below
    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.font = rankFont;
    c.fillStyle = 'rgba(0,0,0,0.1)';
    c.fillText(rank, cornerX + 0.5, rankY + 0.5);
    c.fillStyle = color;
    c.fillText(rank, cornerX, rankY);
    if (!hideCornerSym) {
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
    if (!hideCornerSym) {
      c.font = cornerSymSize + 'px serif';
      c.fillStyle = 'rgba(0,0,0,0.1)';
      c.fillText(sym, CARD_W - cornerX + 0.5, CARD_H - symY + 0.5);
      c.fillStyle = color;
      c.fillText(sym, CARD_W - cornerX, CARD_H - symY);
    }
    c.restore();

    // Pip area — vertically centered with equal top/bottom margins
    var pipMarginX = 14;
    var pipMarginY = 18;
    var area = { x: pipMarginX, y: pipMarginY, w: CARD_W - pipMarginX * 2, h: CARD_H - pipMarginY * 2 };

    if (!isNaN(numericRank) && PIP_LAYOUTS[numericRank]) {
      renderPips(c, area, suit, numericRank);
    } else {
      renderFaceCard(c, area, rank, suit);
    }

    return off;
  }

  function renderPips(c, area, suit, count) {
    var sym = SUIT_SYM[suit];
    var color = getSuitColor(suit);
    var layout = PIP_LAYOUTS[count];
    if (!layout) return;

    var isCustom = isCustomSuit(suit);
    var isAnimals = isAnimalsSuit(suit);
    var useWideLayout = isCustom || isAnimals;
    var fontSize = 20;     // uniform 20px for classic pips (all ranks)
    // Rank-1 pip size diverges by mode:
    //   Laser (isCustom): 57.5 × 0.85 = 48.875 (slightly smaller)
    //   Animals:         57.5 × 1.15 = 66.125 (slightly larger)
    var customSize = (count === 1) ? (isAnimals ? 66.125 : 48.875) : 16;
    if (suit === 'hearts' && isCustom && count > 2) customSize = 15.2; // prisms 5% smaller for 3+
    // Animals 2-10 get a +10% baseline boost, applied before per-suit specifics.
    if (isAnimals && count > 1) {
      customSize = customSize * 1.10;
    }
    // Per-suit size boosts for Animals mode, counts 2-10:
    //   Hares (hearts): 25%
    //   Dolphins (diamonds) & Spiders (spades): 10%
    //   Cubs (clubs): 25% + 10% + 10% = 51.25% (stacked on the prior boosts)
    if (isAnimals && suit === 'hearts' && count > 1) {
      customSize = customSize * 1.25;
    }
    if (isAnimals && suit === 'diamonds' && count > 1) {
      customSize = customSize * 1.10;
    }
    if (isAnimals && suit === 'spades' && count > 1) {
      customSize = customSize * 1.10;
    }
    if (isAnimals && suit === 'clubs' && count > 1) {
      customSize = customSize * 1.25 * 1.10 * 1.10;
    }

    // Classic 1-cards: double-sized centre pip, scaled +25%, +15%, +25%, then -15%
    // (40 → 50 → 57.5 → 71.875 → 61.09375)
    var classicOneSize = (count === 1) ? 61.09375 : fontSize;

    // Use spread-out layouts for custom (laser) and animals suits
    if (useWideLayout && CUSTOM_PIP_LAYOUTS[count]) {
      layout = CUSTOM_PIP_LAYOUTS[count];
      // Suit-specific layout overrides
      if (count === 6 && (suit === 'diamonds' || suit === 'spades' || suit === 'clubs')) {
        layout = WIDE_6_LAYOUT;
      } else if (suit === 'hearts') {
        if (count === 6) layout = PRISM_6_LAYOUT;
        else if (count === 7) layout = PRISM_7_LAYOUT;
        else if (count === 8) layout = PRISM_8_LAYOUT;
        else if (count === 9) layout = PRISM_9_LAYOUT;
        else if (count === 10) layout = PRISM_10_LAYOUT;
      } else if (count === 10 && suit === 'diamonds') {
        layout = DIODE_10_LAYOUT;
      } else if (suit === 'clubs') {
        if (count === 7) layout = COMBINER_7_LAYOUT;
        else if (count === 8) layout = COMBINER_8_LAYOUT;
        else if (count === 9) layout = COMBINER_9_LAYOUT;
        else if (count === 10) layout = COMBINER_10_LAYOUT;
      } else if (suit === 'spades' && activeBladeStyle === 'fan') {
        // Fan uses same wider spacing as prisms/combiners (0.0/0.5/1.0 for rows of 3)
        if (count === 7) layout = PRISM_7_LAYOUT;
        else if (count === 8) layout = PRISM_8_LAYOUT;
        else if (count === 9) layout = PRISM_9_LAYOUT;
        else if (count === 10) layout = PRISM_10_LAYOUT;
      } else if (suit === 'spades' && activeBladeStyle !== 'fan') {
        // Sai/Sword use blade-specific layouts
        if (count === 6) layout = BLADE_6_LAYOUT;
        else if (count === 4) layout = BLADE_4_LAYOUT;
        else if (count === 5) layout = BLADE_5_LAYOUT;
        else if (count === 7) layout = BLADE_7_LAYOUT;
        else if (count === 8) layout = BLADE_8_LAYOUT;
        else if (count === 9) layout = BLADE_9_LAYOUT;
        else if (count === 10) layout = BLADE_10_LAYOUT;
      }
      // Fan blades use CUSTOM_PIP_LAYOUTS (2-3-3-2 for 10)
    }

    c.save();
    if (!isCustom && !isAnimals) {
      c.font = classicOneSize + 'px serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
    }

    for (var i = 0; i < layout.length; i++) {
      var px = area.x + layout[i][0] * area.w;
      var py = area.y + layout[i][1] * area.h;
      var flip = layout[i][2];

      if (isAnimals) {
        drawAnimalPip(c, px, py, customSize, suit, false);
      } else if (isCustom && suit === 'diamonds') {
        drawDiodePip(c, px, py, customSize, false);
      } else if (isCustom && suit === 'hearts') {
        drawPrismPip(c, px, py, customSize, false);
      } else if (isCustom && suit === 'spades') {
        drawBladeAny(c, px, py, customSize, false);
      } else if (isCustom && suit === 'clubs') {
        drawCombinerPip(c, px, py, customSize, false);
      } else {
        c.save();
        if (count !== 1) c.font = fontSize + 'px serif';
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
    // Q's descender tail hangs below — textBaseline 'middle' includes tail,
    // so the O-body sits too high. Push Q DOWN to align O-body with A/J/K.
    var rankCenterY = cy - 4;
    var qDescenderOffset = (rank === 'Q') ? 2 : 0;
    var rankY = rankCenterY + qDescenderOffset;

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

    // Suit symbol below rank on face cards — matches the 2-10 pip sizing so face
    // cards and number cards have a consistent pip size per suit.
    var suitPipY = rankCenterY + 24;
    // Base (counts 2+) is 16; apply the same suit-specific scaling renderPips uses.
    var faceCardPipSize = 16;
    if (isCustomSuit(suit) && suit === 'hearts') faceCardPipSize = 15.2;
    if (isAnimalsSuit(suit) && suit === 'diamonds') faceCardPipSize = 16 * 1.10;
    if (isAnimalsSuit(suit) && suit === 'hearts')   faceCardPipSize = 16 * 1.25;
    if (isAnimalsSuit(suit) && suit === 'spades')   faceCardPipSize = 16 * 1.10;
    if (isAnimalsSuit(suit) && suit === 'clubs')    faceCardPipSize = 16 * 1.25 * 1.10 * 1.10;
    var classicFacePipSize = 20;  // matches classic 2-10 font size
    if (isAnimalsSuit(suit)) {
      drawAnimalPip(c, cx, suitPipY, faceCardPipSize, suit, false);
    } else if (isCustomSuit(suit) && suit === 'diamonds') {
      drawDiodePip(c, cx, suitPipY, faceCardPipSize, false);
    } else if (isCustomSuit(suit) && suit === 'hearts') {
      drawPrismPip(c, cx, suitPipY, faceCardPipSize, false);
    } else if (isCustomSuit(suit) && suit === 'spades') {
      drawBladeAny(c, cx, suitPipY, faceCardPipSize, false);
    } else if (isCustomSuit(suit) && suit === 'clubs') {
      drawCombinerPip(c, cx, suitPipY, faceCardPipSize, false);
    } else {
      c.save();
      c.font = classicFacePipSize + 'px serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = 'rgba(0,0,0,0.1)';
      c.fillText(sym, cx + 0.5, suitPipY + 0.5);
      c.fillStyle = color;
      c.fillText(sym, cx, suitPipY);
      c.restore();
    }

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

    roundRect(c, 0.5, 0.5, CARD_W - 1, CARD_H - 1, CARD_R);
    var bgGrad = c.createRadialGradient(CARD_W / 2, CARD_H / 2, 5, CARD_W / 2, CARD_H / 2, CARD_W * 0.7);
    bgGrad.addColorStop(0, '#1e3a6e');
    bgGrad.addColorStop(0.5, BACK_LIGHT);
    bgGrad.addColorStop(1, BACK_DARK);
    c.fillStyle = bgGrad;
    c.fill();

    c.strokeStyle = 'rgba(100, 140, 220, 0.3)';
    c.lineWidth = 0.8;
    c.stroke();

    Textures.drawGoldBorder(c, 3, 3, CARD_W - 6, CARD_H - 6, CARD_R - 1, 0.6);

    c.save();
    roundRect(c, 7, 7, CARD_W - 14, CARD_H - 14, CARD_R - 3);
    c.clip();

    var spacing = 10;
    var halfS = spacing / 2;
    for (var gx = 7; gx < CARD_W - 7; gx += spacing) {
      for (var gy = 7; gy < CARD_H - 7; gy += spacing) {
        c.fillStyle = 'rgba(180, 200, 255, 0.03)';
        c.beginPath();
        c.moveTo(gx + halfS, gy);
        c.lineTo(gx + halfS + 2, gy + halfS);
        c.lineTo(gx + halfS, gy + spacing);
        c.lineTo(gx + halfS - 2, gy + halfS);
        c.closePath();
        c.fill();

        c.fillStyle = 'rgba(200, 220, 255, 0.02)';
        c.beginPath();
        c.moveTo(gx, gy + halfS);
        c.lineTo(gx + halfS, gy + halfS + 2);
        c.lineTo(gx + spacing, gy + halfS);
        c.lineTo(gx + halfS, gy + halfS - 2);
        c.closePath();
        c.fill();

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

    // Big centered "S" monogram on card back
    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    var midX = CARD_W / 2;
    var midY = CARD_H / 2;

    c.font = '900 46px Cinzel, Georgia, serif';
    // Soft outer glow
    c.fillStyle = '#d4a849';
    c.globalAlpha = 0.08;
    c.fillText('S', midX, midY);
    c.font = '900 48px Cinzel, Georgia, serif';
    c.globalAlpha = 0.06;
    c.fillText('S', midX, midY);

    // Gold foil fill
    c.font = '900 46px Cinzel, Georgia, serif';
    var goldG = Textures.goldFoilGradient(c, midX - 20, midY - 24, 40, 48);
    c.fillStyle = goldG;
    c.globalAlpha = 0.65;
    c.fillText('S', midX, midY);
    c.restore();

    var vignette = c.createRadialGradient(CARD_W / 2, CARD_H / 2, 10, CARD_W / 2, CARD_H / 2, CARD_W * 0.7);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.25)');
    roundRect(c, 0.5, 0.5, CARD_W - 1, CARD_H - 1, CARD_R);
    c.fillStyle = vignette;
    c.fill();

    return off;
  }

  // ================================================================
  //  FOUNDATION PLACEHOLDER PRE-RENDERING
  // ================================================================

  function renderPlaceholder(suit) {
    var scale = TEX_SCALE;
    var cw = CARD_W * scale;
    var ch = CARD_H * scale;

    var off = document.createElement('canvas');
    off.width = cw;
    off.height = ch;
    var c = off.getContext('2d');
    c.scale(scale, scale);

    // Rounded rect outline
    roundRect(c, 1, 1, CARD_W - 2, CARD_H - 2, CARD_R);
    c.fillStyle = 'rgba(255, 255, 255, 0.04)';
    c.fill();
    c.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    c.lineWidth = 1.5;
    c.setLineDash([4, 4]);
    c.stroke();
    c.setLineDash([]);

    // Suit symbol in center (2x size for visibility)
    if (suit) {
      // Animal placeholders use a slightly bigger pip (+20%) since the silhouettes
      // read better at larger size, especially with the 0.55 alpha blit.
      var phPipSize = isAnimalsSuit(suit) ? 57.6 : 48;
      if (isAnimalsSuit(suit)) {
        // Render the pip opaquely to an offscreen canvas first, THEN blit
        // that single image at reduced alpha. This keeps each sub-shape
        // inside the pip (ears, head, body, fin…) fully opaque so inner
        // shapes get properly covered instead of bleeding through when the
        // placeholder is drawn semi-transparent.
        // NOTE: name this `pipCanvas`, NOT `off` — `var off` would shadow the
        // outer placeholder canvas and break the whole placeholder texture.
        var pipCanvas = document.createElement('canvas');
        pipCanvas.width = CARD_W;
        pipCanvas.height = CARD_H;
        var pipCtx = pipCanvas.getContext('2d');
        drawAnimalPip(pipCtx, CARD_W / 2, CARD_H / 2, phPipSize, suit, false);
        c.save();
        c.globalAlpha = 0.55;
        c.drawImage(pipCanvas, 0, 0);
        c.restore();
      } else if (isCustomSuit(suit) && suit === 'diamonds') {
        c.save();
        c.globalAlpha = 0.45;
        drawDiodePip(c, CARD_W / 2, CARD_H / 2, phPipSize, false);
        c.restore();
      } else if (isCustomSuit(suit) && suit === 'hearts') {
        c.save();
        c.globalAlpha = 0.6;
        drawPrismPip(c, CARD_W / 2, CARD_H / 2, phPipSize, false, true);
        c.restore();
      } else if (isCustomSuit(suit) && suit === 'spades') {
        c.save();
        c.globalAlpha = 0.45;
        drawBladeAny(c, CARD_W / 2, CARD_H / 2, phPipSize, false);
        c.restore();
      } else if (isCustomSuit(suit) && suit === 'clubs') {
        c.save();
        c.globalAlpha = 0.6;
        drawCombinerPip(c, CARD_W / 2, CARD_H / 2, phPipSize, false, true);
        c.restore();
      } else {
        var sym = SUIT_SYM[suit];
        var color = getSuitColor(suit);
        c.save();
        c.font = '48px serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = color;
        c.globalAlpha = 0.25;
        c.fillText(sym, CARD_W / 2, CARD_H / 2);
        c.restore();
      }
    }

    return off;
  }

  function renderEmptyPlaceholder() {
    var scale = TEX_SCALE;
    var cw = CARD_W * scale;
    var ch = CARD_H * scale;

    var off = document.createElement('canvas');
    off.width = cw;
    off.height = ch;
    var c = off.getContext('2d');
    c.scale(scale, scale);

    roundRect(c, 1, 1, CARD_W - 2, CARD_H - 2, CARD_R);
    c.fillStyle = 'rgba(255, 255, 255, 0.03)';
    c.fill();
    c.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    c.lineWidth = 1;
    c.setLineDash([4, 4]);
    c.stroke();
    c.setLineDash([]);

    return off;
  }

  // ================================================================
  //  TABLE RENDERING (full-screen green felt)
  // ================================================================

  function renderTableToCanvas() {
    var tableCanvas = document.createElement('canvas');
    tableCanvas.width = W * dpr;
    tableCanvas.height = H * dpr;
    var c = tableCanvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Dark background
    c.fillStyle = '#080c0a';
    c.fillRect(0, 0, W, H);

    // Full-screen felt gradient
    var feltGrad = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    feltGrad.addColorStop(0, FELT_LIGHT);
    feltGrad.addColorStop(0.5, FELT_MID);
    feltGrad.addColorStop(1, FELT_DARK);
    c.fillStyle = feltGrad;
    c.fillRect(0, 0, W, H);

    // Felt texture
    Textures.feltTexture(c, W, H);

    // Spotlight from above
    var spotGrad = c.createRadialGradient(W / 2, H * 0.3, 0, W / 2, H / 2, Math.max(W, H) * 0.5);
    spotGrad.addColorStop(0, 'rgba(255, 250, 220, 0.06)');
    spotGrad.addColorStop(0.5, 'rgba(255, 245, 200, 0.02)');
    spotGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    c.fillStyle = spotGrad;
    c.fillRect(0, 0, W, H);

    // Edge vignette
    var vignette = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(0.7, 'rgba(0,0,0,0.1)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.35)');
    c.fillStyle = vignette;
    c.fillRect(0, 0, W, H);

    // "Solitairra" watermark fixed near bottom of screen
    c.save();
    var wmSize = Math.min(W * 0.05, 40);
    c.font = '900 ' + wmSize + 'px Cinzel, Georgia, serif';
    c.textAlign = 'center';
    c.textBaseline = 'bottom';
    c.lineWidth = 2;
    c.strokeStyle = 'rgba(200, 220, 180, 0.12)';
    c.strokeText('Solitairra', W / 2, H - wmSize * 0.5);
    c.fillStyle = 'rgba(200, 220, 180, 0.24)';
    c.fillText('Solitairra', W / 2, H - wmSize * 0.5);
    c.restore();

    return tableCanvas;
  }

  // ================================================================
  //  TEXTURE BUILDING
  // ================================================================

  function buildCardTextures() {
    var suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    var ranks = CardSystem.getRanks();
    for (var s = 0; s < suits.length; s++) {
      for (var r = 0; r < ranks.length; r++) {
        var key = ranks[r] + '_' + suits[s];
        cardTextures[key] = PIXI.Texture.from(renderCardToImage(ranks[r], suits[s]));
      }
    }
    backTexture = PIXI.Texture.from(renderCardBackToImage());
  }

  function buildPlaceholderTextures() {
    var suits = ['clubs', 'spades', 'hearts', 'diamonds'];
    for (var i = 0; i < suits.length; i++) {
      placeholderTextures[suits[i]] = PIXI.Texture.from(renderPlaceholder(suits[i]));
    }
    emptyPlaceholderTexture = PIXI.Texture.from(renderEmptyPlaceholder());
  }

  function rebuildTextures() {
    buildCardTextures();
    buildPlaceholderTextures();
    buildChevronTexture();
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

    c.shadowColor = 'rgba(0, 0, 0, 0.6)';
    c.shadowBlur = 8;
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

    c.shadowColor = 'rgba(212, 160, 23, 1)';
    c.shadowBlur = 20;
    c.fillStyle = 'rgba(212, 160, 23, 0.6)';
    roundRect(c, pad, pad, CARD_W, CARD_H, CARD_R);
    c.fill();
    c.shadowBlur = 12;
    c.fillStyle = 'rgba(255, 200, 50, 0.3)';
    roundRect(c, pad, pad, CARD_W, CARD_H, CARD_R);
    c.fill();

    glowTexture = PIXI.Texture.from(off);
  }

  function buildFoundationBorderTexture() {
    var pad = 6;
    var sw = (CARD_W + pad * 2) * TEX_SCALE;
    var sh = (CARD_H + pad * 2) * TEX_SCALE;
    var off = document.createElement('canvas');
    off.width = sw;
    off.height = sh;
    var c = off.getContext('2d');
    c.scale(TEX_SCALE, TEX_SCALE);

    c.strokeStyle = '#d4a017';
    c.lineWidth = 2;
    roundRect(c, pad, pad, CARD_W, CARD_H, CARD_R);
    c.stroke();

    foundationBorderTexture = PIXI.Texture.from(off);
  }

  function drawFoundationBorder(x, y, scale) {
    scale = scale || 1;
    var texScale = scale / TEX_SCALE;
    var borderScale = texScale * (CARD_W + 12) / (CARD_W + 12);
    var s = acquireSprite();
    s.texture = foundationBorderTexture;
    s.position.set(x, y);
    s.scale.set(texScale);
    s.alpha = 0.9;
  }

  function buildIllegalMoveTexture() {
    var size = 48;
    var sw = size * TEX_SCALE;
    var off = document.createElement('canvas');
    off.width = sw;
    off.height = sw;
    var c = off.getContext('2d');
    c.scale(TEX_SCALE, TEX_SCALE);
    var cx = size / 2;
    var cy = size / 2;
    var r = size / 2 - 3;
    // Red circle
    c.strokeStyle = '#e53935';
    c.lineWidth = 4;
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.stroke();
    // Diagonal slash
    c.beginPath();
    var dx = r * Math.cos(Math.PI / 4);
    var dy = r * Math.sin(Math.PI / 4);
    c.moveTo(cx - dx, cy - dy);
    c.lineTo(cx + dx, cy + dy);
    c.stroke();
    illegalMoveTexture = PIXI.Texture.from(off);
  }

  function drawIllegalMove(x, y, scale, alpha) {
    scale = scale || 1;
    var s = acquireSprite();
    s.texture = illegalMoveTexture;
    s.position.set(x, y);
    s.scale.set(scale / TEX_SCALE);
    s.alpha = alpha;
  }

  function buildParticleTexture() {
    particleTextures = [];
    var colors = [
      [255, 240, 200], [255, 240, 200], [255, 240, 200], [255, 240, 200],
      [255, 240, 200], [255, 240, 200], [255, 240, 200],
      [200, 240, 200], [200, 240, 200],
      [255, 255, 255]
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
    particleTex = particleTextures[0];
  }

  function updateTableTexture() {
    if (!tableSprite || W === 0 || H === 0) return;
    var tableCanvas = renderTableToCanvas();
    var oldTex = tableSprite.texture;
    tableSprite.texture = PIXI.Texture.from(tableCanvas);
    tableSprite.width = W;
    tableSprite.height = H;
    if (oldTex && oldTex !== PIXI.Texture.EMPTY) {
      oldTex.destroy(true);
    }
  }

  // ================================================================
  //  INITIALIZATION
  // ================================================================

  // initReady resolves once the PixiJS app, textures, and stage are set up.
  // Call init() early (at page load) so everything is ready before user clicks Play.
  var initReady = null;

  function init(canvasEl) {
    // Already initialized — just resize for current screen dimensions
    if (initReady) {
      resize();
      return initReady;
    }

    app = new PIXI.Application();
    dpr = window.devicePixelRatio || 1;

    // Use window dimensions as the canvas fills the viewport
    W = window.innerWidth;
    H = window.innerHeight;

    initReady = app.init({
      canvas: canvasEl,
      width: W,
      height: H,
      resolution: dpr,
      autoDensity: true,
      backgroundAlpha: 0,
      antialias: true
    }).then(function () {
      buildCardTextures();
      buildPlaceholderTextures();
      buildShadowTexture();
      buildGlowTexture();
      buildFoundationBorderTexture();
      buildIllegalMoveTexture();
      buildParticleTexture();

      tableSprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
      app.stage.addChild(tableSprite);

      particleContainer = new PIXI.Container();
      app.stage.addChild(particleContainer);

      gameLayer = new PIXI.Container();
      app.stage.addChild(gameLayer);

      updateTableTexture();
      initPixiParticles();
    });

    return initReady;
  }

  function resize() {
    if (!app || !app.renderer) return;
    W = window.innerWidth;
    H = window.innerHeight;
    app.renderer.resize(W, H);
    updateTableTexture();
    initPixiParticles();
  }

  // ================================================================
  //  SPRITE POOL
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
  //  DRAWING METHODS
  // ================================================================

  function drawCard(x, y, card, faceUp, rotation, scale, shadowAlpha) {
    rotation = rotation || 0;
    scale = scale || 1;
    shadowAlpha = shadowAlpha !== undefined ? shadowAlpha : 0.3;

    var texScale = scale / TEX_SCALE;

    if (shadowAlpha > 0) {
      var shadow = acquireSprite();
      shadow.texture = shadowTexture;
      shadow.position.set(x + 2 * scale, y + 3 * scale);
      shadow.rotation = rotation;
      shadow.scale.set(texScale);
      shadow.alpha = shadowAlpha;
    }

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
    var glowScale = texScale * (CARD_W + 56) / (CARD_W + 32);
    var g = acquireSprite();
    g.texture = glowTexture;
    g.position.set(x, y);
    g.rotation = rotation;
    g.scale.set(glowScale);
    g.alpha = pulseAlpha;
  }

  function drawPlaceholder(x, y, suit, scale) {
    scale = scale || 1;
    var texScale = scale / TEX_SCALE;
    var s = acquireSprite();
    s.texture = suit ? placeholderTextures[suit] : emptyPlaceholderTexture;
    s.position.set(x, y);
    s.scale.set(texScale);
  }

  function drawDeck(x, y, count, scale) {
    scale = scale || 1;
    var texScale = scale / TEX_SCALE;
    var stackHeight = Math.min(count, 6);

    if (stackHeight > 0) {
      var shadow = acquireSprite();
      shadow.texture = shadowTexture;
      shadow.position.set(x + 2, y + 3);
      shadow.scale.set(texScale);
      shadow.alpha = 0.2;
    }

    for (var i = 0; i < stackHeight; i++) {
      var offset = i * 0.6;
      var s = acquireSprite();
      s.texture = backTexture;
      s.position.set(x - offset, y - offset);
      s.scale.set(texScale);
    }
  }

  // Draw a recycle symbol for empty stock
  var recycleTexture = null;

  function buildRecycleTexture() {
    var scale = TEX_SCALE;
    var cw = CARD_W * scale;
    var ch = CARD_H * scale;

    var off = document.createElement('canvas');
    off.width = cw;
    off.height = ch;
    var c = off.getContext('2d');
    c.scale(scale, scale);

    // Clockwise circular arrow — no placeholder background
    var cx = CARD_W / 2;
    var cy = CARD_H / 2;
    var r = 13;
    // Gap at top-left for the arrowhead
    var gapAngle = 0.18 * Math.PI;
    var startAngle = -0.5 * Math.PI + gapAngle / 2;
    var endAngle = -0.5 * Math.PI - gapAngle / 2 + 2 * Math.PI;

    // Draw full circle arc (no gap — continuous line)
    c.beginPath();
    c.arc(cx, cy, r, startAngle, endAngle, false);
    c.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    c.lineWidth = 2;
    c.lineCap = 'round';
    c.stroke();

    // Arrowhead tip position (on the arc at endAngle, pushed forward along tangent)
    var tangent = endAngle + Math.PI / 2;
    var tipOffset = 4;
    var tipX = cx + r * Math.cos(endAngle) + tipOffset * Math.cos(tangent);
    var tipY = cy + r * Math.sin(endAngle) + tipOffset * Math.sin(tangent);
    var aLen = 9;
    var aSpread = 0.55;

    // Draw arrowhead
    c.beginPath();
    c.moveTo(tipX + aLen * Math.cos(tangent - Math.PI + aSpread), tipY + aLen * Math.sin(tangent - Math.PI + aSpread));
    c.lineTo(tipX, tipY);
    c.lineTo(tipX + aLen * Math.cos(tangent - Math.PI - aSpread), tipY + aLen * Math.sin(tangent - Math.PI - aSpread));
    c.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    c.lineWidth = 2;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.stroke();

    recycleTexture = PIXI.Texture.from(off);
  }

  function drawRecycleSymbol(x, y, scale) {
    if (!recycleTexture) buildRecycleTexture();
    scale = scale || 1;
    var texScale = scale / TEX_SCALE;
    var s = acquireSprite();
    s.texture = recycleTexture;
    s.position.set(x, y);
    s.scale.set(texScale);
  }

  // Draw a gold ">" chevron between foundation piles
  var chevronTexture = null;

  function buildChevronTexture() {
    var size = 20;
    var scale = TEX_SCALE;
    var off = document.createElement('canvas');
    off.width = size * scale;
    off.height = size * scale;
    var c = off.getContext('2d');
    c.scale(scale, scale);

    var cx = size / 2;
    var cy = size / 2;
    var hw = 4;  // half-width of chevron
    var hh = 6;  // half-height of chevron

    c.beginPath();
    c.moveTo(cx - hw, cy - hh);
    c.lineTo(cx + hw, cy);
    c.lineTo(cx - hw, cy + hh);
    c.strokeStyle = '#f0d060';
    c.lineWidth = 2;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.stroke();

    chevronTexture = PIXI.Texture.from(off);
  }

  function drawChevron(x, y, scale) {
    if (!chevronTexture) buildChevronTexture();
    scale = scale || 1;
    var texScale = scale / TEX_SCALE;
    var s = acquireSprite();
    s.texture = chevronTexture;
    s.position.set(x, y);
    s.scale.set(texScale);
    s.alpha = 0.5;
  }

  // ================================================================
  //  PARTICLES
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
      var size = 0.4 + Math.random() * 2.2;
      sprite.scale.set(size / 4);
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
  //  RENDER LOOP
  // ================================================================

  function startLoop(callback) {
    gameRenderCallback = callback;
    if (tickerFn) app.ticker.remove(tickerFn);
    tickerFn = function () {
      poolIndex = 0;
      updateParticles();
      if (gameRenderCallback) {
        gameRenderCallback(null, W, H);
      }
      for (var i = poolIndex; i < spritePool.length; i++) {
        spritePool[i].visible = false;
      }
    };
    app.ticker.add(tickerFn);
    // Ensure ticker is running (PixiJS may auto-stop when listeners are removed)
    if (!app.ticker.started) app.ticker.start();
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

  function animate(duration, onUpdate, onComplete) {
    var start = performance.now();
    var interval = 16;
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
  //  LAYOUT HELPERS
  // ================================================================

  function getCanvasSize() {
    return { w: W, h: H };
  }

  // Calculate solitaire layout positions
  // Top row: stock, waste, 4 foundations (always 6 positions)
  // Tableau: 6 columns (no face cards) or 7 columns (face cards)
  function getLayout() {
    var numCols = CardSystem.getNumColumns(); // 6 or 7
    var margin = Math.min(W * 0.03, 20);
    var gap = Math.min(W * 0.015, 12);

    // HUD height reservation — must fit buttons; min 32px even on tiny screens
    var hudH = Math.max(32, Math.min(48, H * 0.07));

    // Width based on max(7, numCols) columns for consistent sizing
    var layoutCols = Math.max(7, numCols);
    var availW = W - margin * 2;
    var naturalWidth = CARD_W * layoutCols + gap * (layoutCols - 1);
    var scaleW = availW / naturalWidth;

    // Height constraint: top row card + gap + deepest tableau at deal time
    // Deepest column has (numCols-1) face-down cards + 1 face-up card visible
    var maxFaceDown = numCols - 1; // 5 for 6-col
    var estimatedFaceDownOff = 20; // rough offset per face-down card at scale=1
    var estimatedFaceUpOff = 30;
    var bottomPad = margin + 10; // breathing room at bottom
    var availH = H - hudH - margin - bottomPad;
    // Need: cardH(top row) + gap*2.5 + maxFaceDown*faceDownOff + 2*faceUpOff + cardH(bottom card)
    var naturalHeight = CARD_H + gap * 2.5 + maxFaceDown * estimatedFaceDownOff + 2 * estimatedFaceUpOff + CARD_H;
    var scaleH = availH / naturalHeight;

    var scale = Math.min(1.2, scaleW, scaleH);

    var cw = CARD_W * scale;
    var ch = CARD_H * scale;
    var g = gap * scale;

    // Center a layoutCols-column-width area
    var totalWidth = cw * layoutCols + g * (layoutCols - 1);
    var startX = (W - totalWidth) / 2 + cw / 2; // center of first card

    // Top row positions: stock, waste, then 4 foundations
    // All 6 positions evenly spaced across the layout width
    var topRowSpacing = (totalWidth - cw) / 5; // 6 positions, 5 gaps

    // Tableau column spacing (numCols positions across same width)
    var tabColSpacing = numCols > 1 ? (totalWidth - cw) / (numCols - 1) : 0;

    var topY = hudH + margin + ch / 2;
    var tableauY = topY + ch + g * 2.5;

    var faceDownOffset = Math.max(20 * scale, 10);
    var faceUpOffset = Math.max(30 * scale, 16);

    // Top row X positions (6 evenly spaced)
    function topRowX(i) { return startX + i * topRowSpacing; }
    // Tableau X positions (numCols evenly spaced)
    function tableauColX(i) { return startX + i * tabColSpacing; }

    return {
      scale: scale,
      cw: cw,
      ch: ch,
      gap: g,
      startX: startX,
      topY: topY,
      tableauY: tableauY,
      faceDownOffset: faceDownOffset,
      faceUpOffset: faceUpOffset,
      numCols: numCols,
      hudH: hudH,

      // Stock position (slot 0)
      stockX: topRowX(0),
      stockY: topY,

      // Waste position (slot 1)
      wasteX: topRowX(1),
      wasteY: topY,

      // Foundation positions (slots 2-5, left to right: D, P, B, C)
      foundationX: function (i) { return topRowX(i + 2); },
      foundationY: topY,

      // Tableau columns aligned evenly across layout width
      tableauX: function (i) { return tableauColX(i); },
      tableauStartY: tableauY,

      // Card size at current scale (for hit testing)
      cardW: cw,
      cardH: ch
    };
  }

  // ================================================================
  //  PUBLIC API
  // ================================================================

  return {
    init: init,
    resize: resize,
    drawCard: drawCard,
    drawCardGlow: drawCardGlow,
    drawPlaceholder: drawPlaceholder,
    drawDeck: drawDeck,
    drawRecycleSymbol: drawRecycleSymbol,
    drawChevron: drawChevron,
    drawFoundationBorder: drawFoundationBorder,
    drawIllegalMove: drawIllegalMove,
    startLoop: startLoop,
    stopLoop: stopLoop,
    animate: animate,
    easeOutCubic: easeOutCubic,
    getCanvasSize: getCanvasSize,
    getLayout: getLayout,
    rebuildTextures: rebuildTextures,
    setSuitSkin: setSuitSkin,
    setDiodeScheme: setDiodeScheme,
    setPrismScheme: setPrismScheme,
    setBladeScheme: setBladeScheme,
    setBladeStyle: setBladeStyle,
    setCombinerScheme: setCombinerScheme,
    setDolphinVariant: setDolphinVariant,
    getDolphinVariantCount: getDolphinVariantCount,
    getDolphinVariantName: getDolphinVariantName,
    getSuitSkins: getSuitSkins,
    getSuitColor: getSuitColor,
    CARD_W: CARD_W,
    CARD_H: CARD_H,
    _renderCard: renderCardToImage,
    _renderSuitPip: function(suit, size) {
      // Draw on an oversized canvas to avoid clipping, then trim to content
      var pad = Math.ceil(size * 0.5);
      var canvasSize = size + pad * 2;
      var canvas = document.createElement('canvas');
      canvas.width = canvasSize;
      canvas.height = canvasSize;
      var c = canvas.getContext('2d');
      var cx = canvasSize / 2;
      var cy = canvasSize / 2;
      var drawSize = size * 0.9;
      if (isAnimalsSuit(suit)) {
        drawAnimalPip(c, cx, cy, drawSize, suit, false);
      } else if (isCustomSuit(suit) && suit === 'diamonds') {
        drawDiodePip(c, cx, cy, drawSize, false);
      } else if (isCustomSuit(suit) && suit === 'hearts') {
        drawPrismPip(c, cx, cy, drawSize, false);
      } else if (isCustomSuit(suit) && suit === 'spades') {
        drawBladeAny(c, cx, cy, drawSize, false);
      } else if (isCustomSuit(suit) && suit === 'clubs') {
        drawCombinerPip(c, cx, cy, drawSize, false);
      } else {
        // Classic suit symbol
        var sym = SUIT_SYM[suit];
        var color = getSuitColor(suit);
        c.font = (size * 0.7) + 'px serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = color;
        c.fillText(sym, cx, cy);
      }
      // Trim canvas to actual drawn content bounds
      var imgData = c.getImageData(0, 0, canvasSize, canvasSize);
      var d = imgData.data;
      var minX = canvasSize, maxX = 0, minY = canvasSize, maxY = 0;
      for (var y = 0; y < canvasSize; y++) {
        for (var x = 0; x < canvasSize; x++) {
          if (d[(y * canvasSize + x) * 4 + 3] > 5) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      // Create trimmed canvas with 2px margin
      var margin = 2;
      var tw = (maxX - minX + 1) + margin * 2;
      var th = (maxY - minY + 1) + margin * 2;
      var trimmed = document.createElement('canvas');
      trimmed.width = tw;
      trimmed.height = th;
      var tc = trimmed.getContext('2d');
      tc.drawImage(canvas, minX - margin, minY - margin, tw, th, 0, 0, tw, th);
      // Scale display so the larger dimension equals requested size
      var scale = size / Math.max(tw, th);
      trimmed.style.width = Math.round(tw * scale) + 'px';
      trimmed.style.height = Math.round(th * scale) + 'px';
      return trimmed;
    }
  };
})();

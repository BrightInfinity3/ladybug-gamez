/* ============================================================
   Laser Stacks - Laser Suit Art
   Canvas2D pip drawers (Diodes, Prisms, Blades, Combiners),
   color schemes, and pip layout tables.

   PORTED FROM soloterra/js/renderer.js — the drawers, schemes,
   and layout tables are verbatim copies; keep them in sync when
   SoloTerra's card art evolves.

   Laser Stacks scheme defaults differ deliberately: the diode is
   BLUE here (SoloTerra defaults to red) so that all four suits
   stay visually distinct in a suit-hierarchy game.

   The 'animals' style (Dolphins/Hares/Spiders/Cubs) is ported
   verbatim from Solitairra/js/renderer.js — keep in sync too.
   ============================================================ */

var LaserPips = (function () {
  'use strict';

  // Suit -> laser-name mapping used in rules text and screen labels
  var SUIT_LABELS = {
    classic: { clubs: 'Clubs', spades: 'Spades', hearts: 'Hearts', diamonds: 'Diamonds' },
    laser:   { clubs: 'Combiners', spades: 'Blades', hearts: 'Prisms', diamonds: 'Diodes' },
    animals: { clubs: 'Cubs', spades: 'Spiders', hearts: 'Hares', diamonds: 'Dolphins' }
  };
  var SUIT_LABELS_SINGULAR = {
    classic: { clubs: 'Club', spades: 'Spade', hearts: 'Heart', diamonds: 'Diamond' },
    laser:   { clubs: 'Combiner', spades: 'Blade', hearts: 'Prism', diamonds: 'Diode' },
    animals: { clubs: 'Cub', spades: 'Spider', hearts: 'Hare', diamonds: 'Dolphin' }
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


  // Active scheme selections (Laser Stacks defaults; see header note)
  var activeDiodeScheme = 'blue';
  var activePrismScheme = 'red';
  var activeBladeScheme = 'black';
  var activeCombinerScheme = 'black';
  var activeBladeStyle = 'fan'; // 'blade' (sword), 'sai', or 'fan'

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

  // Card-text/DOM color for each suit. style: 'laser' (default) | 'animals'
  function getSuitColor(suit, style) {
    if (style === 'animals') {
      // Rank text for Hares is pink, not the brown of the illustration itself
      if (suit === 'hearts') return '#E91E63';
      return ANIMAL_COLORS[suit];
    }
    if (suit === 'diamonds') return DIODE_SCHEMES[activeDiodeScheme].color;
    if (suit === 'hearts') return PRISM_SCHEMES[activePrismScheme].color;
    if (suit === 'spades') return BLADE_SCHEMES[activeBladeScheme].color;
    return COMBINER_SCHEMES[activeCombinerScheme].color;
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
  // ================================================================
  //  ANIMAL PIPS (ported verbatim from Solitairra/js/renderer.js;
  //  the dolphin is Solitairra's V11 "Iconic leaping, emoji style")
  // ================================================================

  function drawDolphinPip(c, x, y, size, flip) {
        c.save();
        var s = size / 20;
        // Screen-space lift so the visual centre of the rotated dolphin sits
        // on the (x, y) origin. Without this, the body's centre-of-mass lands
        // ~1.8s below the origin (rows of pips and the foundation placeholder
        // would have a too-thick top margin and a too-thin bottom margin).
        c.translate(x, y - 1.8 * s);
        if (flip) c.rotate(Math.PI);
        c.rotate(-Math.PI * 0.18);
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

  // ---- Layout selection (extracted from SoloTerra's renderPips) ----
  // Returns the pip layout for a rank count. isCustom=true selects the
  // wide-spread laser layouts with per-suit overrides.
  function getLayout(suit, count, isCustom) {
    var layout = PIP_LAYOUTS[count];
    if (!layout) return null;

    if (isCustom && CUSTOM_PIP_LAYOUTS[count]) {
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
      // Fan blades otherwise use CUSTOM_PIP_LAYOUTS (2-3-3-2 for 10)
    }

    return layout;
  }

  // Pip size for the drawn suits. Laser sizes are SoloTerra's; animal
  // sizes carry Solitairra's +10% baseline and per-suit boosts.
  function getCustomPipSize(suit, count, style) {
    var customSize = 16;
    if (style === 'animals') {
      customSize = 16 * 1.10; // animals baseline boost
      if (suit === 'hearts') customSize *= 1.25;
      else if (suit === 'diamonds') customSize *= 1.10;
      else if (suit === 'spades') customSize *= 1.10;
      else if (suit === 'clubs') customSize *= 1.25 * 1.10 * 1.10;
      return customSize;
    }
    if (count === 1) customSize = 32;
    else if (suit === 'hearts' && count > 2) customSize = 15.2; // prisms 5% smaller for 3+
    return customSize;
  }

  // Face-card center pip size (below the big rank letter). Laser keeps
  // SoloTerra's 14; animals use Solitairra's boosted table.
  function getFaceCardPipSize(suit, style) {
    if (style === 'animals') {
      if (suit === 'hearts') return 16 * 1.10 * 1.25;
      if (suit === 'clubs') return 16 * 1.10 * 1.25 * 1.10 * 1.10;
      return 16 * 1.10 * 1.10; // dolphins & spiders
    }
    return 14;
  }

  // Suit-aware dispatcher. style: 'laser' (default) | 'animals'
  function drawPip(c, x, y, suit, size, flip, style) {
    if (style === 'animals') {
      drawAnimalPip(c, x, y, size, suit, flip);
      return;
    }
    if (suit === 'diamonds')      drawDiodePip(c, x, y, size, flip);
    else if (suit === 'hearts')   drawPrismPip(c, x, y, size, flip, false);
    else if (suit === 'spades')   drawBladeAny(c, x, y, size, flip);
    else if (suit === 'clubs')    drawCombinerPip(c, x, y, size, flip, false);
  }

  // Render a drawn pip onto an HTML <canvas> element of any size, useful for
  // legend chips and inline rule badges. Sizes pip ~70% of canvas extent.
  function renderPipCanvas(canvas, suit, style) {
    var w = canvas.width;
    var h = canvas.height;
    var c = canvas.getContext('2d');
    c.clearRect(0, 0, w, h);
    var size = Math.min(w, h) * 0.7;
    drawPip(c, w / 2, h / 2, suit, size, false, style);
  }

  function getLabel(suit, style, plural) {
    var table = plural ? SUIT_LABELS : SUIT_LABELS_SINGULAR;
    return (table[style] && table[style][suit]) || suit;
  }

  return {
    drawDiodePip: drawDiodePip,
    drawPrismPip: drawPrismPip,
    drawBladePip: drawBladePip,
    drawSaiPip: drawSaiPip,
    drawFanPip: drawFanPip,
    drawBladeAny: drawBladeAny,
    drawCombinerPip: drawCombinerPip,
    drawDolphinPip: drawDolphinPip,
    drawHarePip: drawHarePip,
    drawSpiderPip: drawSpiderPip,
    drawCubPip: drawCubPip,
    drawAnimalPip: drawAnimalPip,
    drawPip: drawPip,
    renderPipCanvas: renderPipCanvas,
    getLayout: getLayout,
    getCustomPipSize: getCustomPipSize,
    getFaceCardPipSize: getFaceCardPipSize,
    getSuitColor: getSuitColor,
    setDiodeScheme: setDiodeScheme,
    setPrismScheme: setPrismScheme,
    setBladeScheme: setBladeScheme,
    setBladeStyle: setBladeStyle,
    setCombinerScheme: setCombinerScheme,
    getLabel: getLabel,
    SUIT_LABELS: SUIT_LABELS,
    SUIT_LABELS_SINGULAR: SUIT_LABELS_SINGULAR
  };
})();

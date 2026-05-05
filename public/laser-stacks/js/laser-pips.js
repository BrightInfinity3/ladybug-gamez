/* ============================================================
   Laser Stacks - Laser Pip Drawing
   Canvas2D drawing of laser-themed suit pips, ported from
   SoloTerra's renderer (Diodes, Prisms, Blades, Combiners).
   ============================================================ */

var LaserPips = (function () {
  'use strict';

  // Suit -> laser-name mapping used in rules text and screen labels
  var SUIT_LABELS = {
    classic: { clubs: 'Clubs', spades: 'Spades', hearts: 'Hearts', diamonds: 'Diamonds' },
    laser:   { clubs: 'Combiners', spades: 'Blades', hearts: 'Prisms', diamonds: 'Diodes' }
  };
  var SUIT_LABELS_SINGULAR = {
    classic: { clubs: 'Club', spades: 'Spade', hearts: 'Heart', diamonds: 'Diamond' },
    laser:   { clubs: 'Combiner', spades: 'Blade', hearts: 'Prism', diamonds: 'Diode' }
  };

  // Approximate laser-mode card text colors (kept close to classic suit colors so
  // the rank corners read clearly against the cream card background).
  var LASER_TEXT_COLORS = {
    diamonds: '#1565C0', // Diode - blue
    hearts:   '#c62828', // Prism - red
    spades:   '#1a1a1a', // Blade - dark
    clubs:    '#1a1a1a'  // Combiner - dark
  };

  // ---- Diode (red) ----
  var DIODE = {
    glow:      ['rgba(255, 100, 100, 0.35)', 'rgba(255, 60, 60, 0.12)', 'rgba(255, 40, 40, 0)'],
    body:      ['#ffa0a0', '#ff4a4a', '#b71c1c', '#7f0000'],
    outline:   'rgba(127, 0, 0, 0.6)',
    highlight: ['rgba(255, 255, 255, 0.7)', 'rgba(255, 180, 180, 0.3)', 'rgba(255, 100, 100, 0)']
  };

  // ---- Prism (red beam scheme, like SoloTerra default) ----
  var PRISM = {
    beamColors: ['#8B0000', '#c62828', '#ff6666']
  };

  // ---- Blade (black, no glow) ----
  var BLADE = {
    hasGlow:   false,
    glowColor: null
  };

  // ---- Combiner (black scheme) ----
  var COMBINER = {
    beamColors:   ['#1a1a1a', '#1a1a1a'],
    outputColor:  '#ffffff',
    outputBorder: '#1a1a1a',
    hybridOutput: false
  };

  // ---- Diode pip ----
  function drawDiodePip(c, x, y, size, flip) {
    var scheme = DIODE;
    c.save();
    c.translate(x, y);
    if (flip) c.rotate(Math.PI);

    var s = size / 20;

    var bodyW = 6.84 * s;
    var bodyH = 11 * s;
    var domeR = bodyW;
    var rawBodyTop = -bodyH * 0.35;
    var rawBodyBot = bodyH * 0.35;
    var rawLegBot = rawBodyBot + 1.5 * s + 4 * s + 1 * s;
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

    // Glass dome
    c.beginPath();
    c.arc(0, bodyTop, domeR, Math.PI, 0);
    c.lineTo(bodyW, bodyBot);
    c.lineTo(-bodyW, bodyBot);
    c.closePath();

    var bodyGrad = c.createLinearGradient(-bodyW, bodyTop - domeR, bodyW, bodyBot);
    bodyGrad.addColorStop(0, scheme.body[0]);
    bodyGrad.addColorStop(0.3, scheme.body[1]);
    bodyGrad.addColorStop(0.6, scheme.body[2]);
    bodyGrad.addColorStop(1, scheme.body[3]);
    c.fillStyle = bodyGrad;
    c.fill();

    c.strokeStyle = scheme.outline;
    c.lineWidth = 0.6 * s;
    c.stroke();

    // Inner highlight
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

    // Base/rim
    c.fillStyle = '#546E7A';
    c.fillRect(-bodyW * 0.9, bodyBot - 1 * s, bodyW * 1.8, 2.5 * s);
    c.strokeStyle = 'rgba(0,0,0,0.2)';
    c.lineWidth = 0.3 * s;
    c.strokeRect(-bodyW * 0.9, bodyBot - 1 * s, bodyW * 1.8, 2.5 * s);

    // Legs
    var legTop = bodyBot + 1.5 * s;
    var legLen = 4 * s;
    c.strokeStyle = '#78909C';
    c.lineWidth = 0.8 * s;
    c.lineCap = 'round';

    c.beginPath();
    c.moveTo(-2.5 * s, legTop);
    c.lineTo(-2.5 * s, legTop + legLen * 0.6);
    c.lineTo(-3.5 * s, legTop + legLen);
    c.stroke();

    c.beginPath();
    c.moveTo(2.5 * s, legTop);
    c.lineTo(2.5 * s, legTop + legLen);
    c.lineTo(3.5 * s, legTop + legLen + 1 * s);
    c.stroke();

    c.restore();
  }

  // ---- Prism pip ----
  function drawPrismPip(c, x, y, size, flip, dimGlow) {
    c.save();
    c.translate(x, y);
    if (flip) c.rotate(Math.PI);

    var s = size / 20;

    var pw = 6.84 * s;
    var ph = 13.68 * s;
    var topY = -ph * 0.42;
    var botY = ph * 0.42;

    var prismOX = -0.5 * s;
    var prismOY = -0.5 * s;

    var beamW = 1.28 * s;

    var convX = prismOX;
    var convY = prismOY + botY * 0.15;

    var inColors = PRISM.beamColors;
    var beamWidths = [beamW, beamW, beamW];

    var outYs = [convY - beamW, convY, convY + beamW];

    var totalBeamW = pw * 3;
    var clipAmount = totalBeamW * 0.025;
    var fullInStartX = prismOX - pw * 1.5 + clipAmount;
    var fullOutEndX = prismOX + pw * 1.5 - clipAmount;
    var inRayLen = convX - fullInStartX;
    var outRayLen = fullOutEndX - convX;
    var inStartX = fullInStartX + inRayLen * 0.1;
    var outEndX = fullOutEndX + outRayLen * 0.08;

    var inSpread = 2.1 * s;
    var inYs = [convY - inSpread * 2.5, convY, convY + inSpread * 2.5];

    // Drop shadow
    c.save();
    c.beginPath();
    c.moveTo(prismOX + 1.5 * s, topY + prismOY + 2 * s);
    c.lineTo(pw + prismOX + 1.5 * s, botY + prismOY + 2 * s);
    c.lineTo(-pw + prismOX + 1.5 * s, botY + prismOY + 2 * s);
    c.closePath();
    c.fillStyle = 'rgba(0, 0, 0, 0.12)';
    c.fill();
    c.restore();

    // Prism body
    c.beginPath();
    c.moveTo(prismOX, topY + prismOY);
    c.lineTo(pw + prismOX, botY + prismOY);
    c.lineTo(-pw + prismOX, botY + prismOY);
    c.closePath();

    var glassGrad = c.createLinearGradient(-pw + prismOX, topY + prismOY, pw + prismOX, botY + prismOY);
    glassGrad.addColorStop(0, 'rgba(210, 230, 250, 0.8)');
    glassGrad.addColorStop(0.25, 'rgba(185, 210, 240, 0.65)');
    glassGrad.addColorStop(0.5, 'rgba(160, 195, 230, 0.55)');
    glassGrad.addColorStop(0.75, 'rgba(135, 175, 215, 0.5)');
    glassGrad.addColorStop(1, 'rgba(110, 155, 200, 0.65)');
    c.fillStyle = glassGrad;
    c.fill();

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

    // Incoming beams
    var coreR = 2.4 * s;
    c.save();
    c.globalAlpha = 0.85;
    for (var bi = 0; bi < 3; bi++) {
      var beamEndX = convX;
      var beamEndY = outYs[bi];
      if (dimGlow) {
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

    // Outgoing beam (single, middle color for non-hybrid scheme)
    var outStartX = dimGlow ? convX + coreR : convX;
    c.save();
    c.globalAlpha = 0.85;
    c.beginPath();
    c.moveTo(outStartX, convY);
    c.lineTo(outEndX, convY);
    c.strokeStyle = inColors[1];
    c.lineWidth = beamWidths[1];
    c.lineCap = 'butt';
    c.stroke();
    c.restore();

    // White glow at convergence
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

    if (dimGlow) {
      c.save();
      c.globalAlpha = 1.0;
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(convX, convY, 2.4 * s, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }

    // Apex highlight
    var apexGlow = c.createRadialGradient(prismOX, topY + prismOY + 2 * s, 0, prismOX, topY + prismOY + 2 * s, 3 * s);
    apexGlow.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
    apexGlow.addColorStop(0.5, 'rgba(220, 240, 255, 0.15)');
    apexGlow.addColorStop(1, 'rgba(200, 220, 255, 0)');
    c.fillStyle = apexGlow;
    c.beginPath();
    c.arc(prismOX, topY + prismOY + 2 * s, 3 * s, 0, Math.PI * 2);
    c.fill();

    // Bottom edge highlight line
    c.beginPath();
    c.moveTo(-pw + prismOX + 2 * s, botY + prismOY - 0.5 * s);
    c.lineTo(pw + prismOX - 2 * s, botY + prismOY - 0.5 * s);
    c.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    c.lineWidth = 0.4 * s;
    c.lineCap = 'round';
    c.stroke();

    c.restore();
  }

  // ---- Blade pip ----
  function drawBladePip(c, x, y, size, flip) {
    c.save();
    c.translate(x, y);
    if (flip) c.rotate(Math.PI);

    var s = size / 20;

    var bladeHW = 2.14 * s;
    var bladeLen = 16 * s;
    var tipLen = 4 * s;
    var guardHW = 4.28 * s;
    var guardH = 1.8 * s;
    var gripHW = 1.37 * s;
    var gripLen = 7 * s;

    var rawTipTop = -bladeLen - tipLen + 2 * s;
    var rawGripBot = 2 * s + guardH + gripLen;
    var centerOffset = (rawTipTop + rawGripBot) / 2;
    c.translate(0, -centerOffset);

    var tipTop = -bladeLen - tipLen + 2 * s;
    var bladeTop = -bladeLen + 2 * s;
    var bladeBot = 2 * s;
    var guardTop = bladeBot;
    var guardBot = guardTop + guardH;
    var gripTop = guardBot;
    var gripBot = gripTop + gripLen;

    // Edge glow (only if scheme has glow — 'black' default has none)
    if (BLADE.hasGlow) {
      var gR = BLADE.glowColor[0], gG = BLADE.glowColor[1], gB = BLADE.glowColor[2];
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

    // Blade body
    c.beginPath();
    c.moveTo(0, tipTop);
    c.lineTo(bladeHW, bladeTop);
    c.lineTo(bladeHW, bladeBot);
    c.lineTo(-bladeHW, bladeBot);
    c.lineTo(-bladeHW, bladeTop);
    c.closePath();

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

    c.strokeStyle = 'rgba(40, 40, 40, 0.6)';
    c.lineWidth = 0.5 * s;
    c.lineJoin = 'round';
    c.stroke();

    // Center fuller
    c.beginPath();
    c.moveTo(0, tipTop + 3 * s);
    c.lineTo(0, bladeBot - 1 * s);
    c.strokeStyle = 'rgba(0, 0, 0, 0.12)';
    c.lineWidth = 1.2 * s;
    c.stroke();
    c.beginPath();
    c.moveTo(0.4 * s, tipTop + 3.5 * s);
    c.lineTo(0.4 * s, bladeBot - 1.5 * s);
    c.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    c.lineWidth = 0.4 * s;
    c.stroke();

    // Crossguard
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

    c.beginPath();
    c.arc(-guardHW, guardTop + guardH / 2, guardH * 0.4, 0, Math.PI * 2);
    c.fillStyle = '#4a4a4a';
    c.fill();
    c.beginPath();
    c.arc(guardHW, guardTop + guardH / 2, guardH * 0.4, 0, Math.PI * 2);
    c.fillStyle = '#4a4a4a';
    c.fill();

    // Grip
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

    // Pommel
    c.beginPath();
    c.arc(0, gripBot, gripHW * 0.7, 0, Math.PI * 2);
    c.fillStyle = '#2a2a2a';
    c.fill();
    c.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    c.lineWidth = 0.3 * s;
    c.stroke();

    c.restore();
  }

  // ---- Combiner pip ----
  function drawCombinerPip(c, x, y, size, flip, dimGlow) {
    c.save();
    c.translate(x, y);
    if (flip) c.rotate(Math.PI);

    var s = size / 20;
    var beamColors = COMBINER.beamColors;

    var rectHW = 5.13 * s;
    var rectHH = 5.13 * s;
    var rectOX = 0;
    var rectOY = 0;

    var beamW = 1.28 * s;
    var outBeamW = beamW * 1.4;

    var convX = rectOX;
    var convY = rectOY;

    var beamLen = rectHW * 1.5;
    var outTopY = rectOY - rectHH - beamLen;
    outTopY = outTopY + (rectOY - rectHH - outTopY) * 0.25;

    var inLen = beamLen * 1.728;
    var inStartOffsets = [
      { x: 0, y: inLen },
      { x: inLen, y: 0 }
    ];
    var inBeamColors = [beamColors[0], beamColors[beamColors.length - 1]];

    var waveAmp = 0.625 * s;
    var waveFreq = 2.5;
    var waveSteps = 30;

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
    glassGrad.addColorStop(0.25, 'rgba(185, 210, 240, 0.65)');
    glassGrad.addColorStop(0.5, 'rgba(160, 195, 230, 0.55)');
    glassGrad.addColorStop(0.75, 'rgba(135, 175, 215, 0.5)');
    glassGrad.addColorStop(1, 'rgba(110, 155, 200, 0.65)');
    c.fillStyle = glassGrad;
    c.fill();

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

    // Sinusoidal incoming beams
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

    // Output beam straight up
    c.save();
    c.globalAlpha = 0.85;
    if (COMBINER.outputBorder) {
      c.beginPath();
      c.moveTo(rectOX, rectOY - rectHH * 0.5);
      c.lineTo(rectOX, outTopY);
      c.strokeStyle = COMBINER.outputBorder;
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
    c.beginPath();
    c.moveTo(rectOX, rectOY - rectHH * 0.5);
    c.lineTo(rectOX, outTopY);
    c.strokeStyle = COMBINER.outputColor;
    c.lineWidth = outBeamW;
    c.lineCap = 'butt';
    c.stroke();
    c.restore();

    // White glow at center
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

  // Suit-aware dispatcher for the four laser pips
  function drawPip(c, x, y, suit, size, flip) {
    if (suit === 'diamonds')      drawDiodePip(c, x, y, size, flip);
    else if (suit === 'hearts')   drawPrismPip(c, x, y, size, flip, false);
    else if (suit === 'spades')   drawBladePip(c, x, y, size, flip);
    else if (suit === 'clubs')    drawCombinerPip(c, x, y, size, flip, false);
  }

  // Render a laser pip onto an HTML <canvas> element of any size, useful for
  // legend chips and inline rule badges. Sizes pip ~70% of canvas extent.
  function renderPipCanvas(canvas, suit) {
    var w = canvas.width;
    var h = canvas.height;
    var c = canvas.getContext('2d');
    c.clearRect(0, 0, w, h);
    var size = Math.min(w, h) * 0.7;
    drawPip(c, w / 2, h / 2, suit, size, false);
  }

  function getLabel(suit, style, plural) {
    var table = plural ? SUIT_LABELS : SUIT_LABELS_SINGULAR;
    return (table[style] && table[style][suit]) || suit;
  }

  return {
    drawDiodePip: drawDiodePip,
    drawPrismPip: drawPrismPip,
    drawBladePip: drawBladePip,
    drawCombinerPip: drawCombinerPip,
    drawPip: drawPip,
    renderPipCanvas: renderPipCanvas,
    getLabel: getLabel,
    LASER_TEXT_COLORS: LASER_TEXT_COLORS,
    SUIT_LABELS: SUIT_LABELS,
    SUIT_LABELS_SINGULAR: SUIT_LABELS_SINGULAR
  };
})();

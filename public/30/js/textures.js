/* ============================================================
   30 - Procedural Texture Library
   Perlin noise, material generators, decorative drawing
   ============================================================ */

var Textures = (function () {
  'use strict';

  // ================================================================
  //  PERLIN NOISE (classic 2D)
  // ================================================================

  // Permutation table (doubled for wrapping)
  var perm = [];
  var grad2 = [
    [1, 1], [-1, 1], [1, -1], [-1, -1],
    [1, 0], [-1, 0], [0, 1], [0, -1]
  ];

  (function initPerm() {
    var p = [];
    for (var i = 0; i < 256; i++) p[i] = i;
    // Fisher-Yates shuffle with fixed seed for consistency
    var seed = 42;
    for (var i = 255; i > 0; i--) {
      seed = (seed * 16807 + 0) % 2147483647;
      var j = seed % (i + 1);
      var tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    for (var i = 0; i < 512; i++) perm[i] = p[i & 255];
  })();

  function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function lerp(a, b, t) {
    return a + t * (b - a);
  }

  function dot2(g, x, y) {
    return g[0] * x + g[1] * y;
  }

  /** Classic 2D Perlin noise, returns value in [-1, 1] */
  function noise2d(x, y) {
    var X = Math.floor(x) & 255;
    var Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    var u = fade(x);
    var v = fade(y);

    var aa = perm[perm[X] + Y] & 7;
    var ab = perm[perm[X] + Y + 1] & 7;
    var ba = perm[perm[X + 1] + Y] & 7;
    var bb = perm[perm[X + 1] + Y + 1] & 7;

    return lerp(
      lerp(dot2(grad2[aa], x, y), dot2(grad2[ba], x - 1, y), u),
      lerp(dot2(grad2[ab], x, y - 1), dot2(grad2[bb], x - 1, y - 1), u),
      v
    );
  }

  /** Fractal Brownian Motion — layered noise */
  function fbm(x, y, octaves, lacunarity, gain) {
    octaves = octaves || 4;
    lacunarity = lacunarity || 2.0;
    gain = gain || 0.5;
    var sum = 0;
    var amp = 1;
    var freq = 1;
    var maxAmp = 0;
    for (var i = 0; i < octaves; i++) {
      sum += noise2d(x * freq, y * freq) * amp;
      maxAmp += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / maxAmp; // normalized to [-1, 1]
  }

  // ================================================================
  //  TEXTURE GENERATORS
  // ================================================================

  /**
   * Warm linen paper texture — draws over existing content
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} w - canvas logical width
   * @param {number} h - canvas logical height
   */
  function paperTexture(ctx, w, h) {
    // Noise grain layer
    var step = 2; // sample every 2px for performance
    for (var py = 0; py < h; py += step) {
      for (var px = 0; px < w; px += step) {
        var n = fbm(px * 0.08, py * 0.08, 3, 2.0, 0.5);
        var brightness = n * 0.04; // very subtle
        if (brightness > 0) {
          ctx.fillStyle = 'rgba(180, 160, 120, ' + brightness + ')';
        } else {
          ctx.fillStyle = 'rgba(60, 40, 20, ' + Math.abs(brightness) + ')';
        }
        ctx.fillRect(px, py, step, step);
      }
    }

    // Linen fiber lines (horizontal emphasis)
    ctx.save();
    ctx.globalAlpha = 0.025;
    for (var fy = 0; fy < h; fy += 3) {
      var n2 = noise2d(fy * 0.3, 0.5) * 0.5;
      ctx.strokeStyle = n2 > 0 ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 0.3 + Math.abs(n2) * 0.5;
      ctx.beginPath();
      ctx.moveTo(0, fy + n2);
      ctx.lineTo(w, fy + n2 + noise2d(w * 0.1, fy * 0.2) * 0.8);
      ctx.stroke();
    }
    ctx.restore();

    // Micro-creases (faint diagonal lines)
    ctx.save();
    ctx.globalAlpha = 0.012;
    ctx.strokeStyle = '#8B7355';
    ctx.lineWidth = 0.4;
    for (var ci = 0; ci < 6; ci++) {
      var cx1 = (noise2d(ci * 3.7, 0) * 0.5 + 0.5) * w;
      var cy1 = (noise2d(0, ci * 3.7) * 0.5 + 0.5) * h;
      var cx2 = cx1 + (noise2d(ci * 2.1, 1) * 0.3) * w;
      var cy2 = cy1 + (noise2d(1, ci * 2.1) * 0.3) * h;
      ctx.beginPath();
      ctx.moveTo(cx1, cy1);
      ctx.lineTo(cx2, cy2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Dense felt texture using Perlin noise
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} w
   * @param {number} h
   */
  function feltTexture(ctx, w, h) {
    var step = 2;
    for (var py = 0; py < h; py += step) {
      for (var px = 0; px < w; px += step) {
        var n = fbm(px * 0.03, py * 0.03, 4, 2.2, 0.45);
        var brightness = n * 0.06;
        if (brightness > 0) {
          ctx.fillStyle = 'rgba(200, 255, 200, ' + brightness + ')';
        } else {
          ctx.fillStyle = 'rgba(0, 20, 0, ' + Math.abs(brightness) * 1.2 + ')';
        }
        ctx.fillRect(px, py, step, step);
      }
    }

    // Directional fibers (slightly angled)
    ctx.save();
    ctx.globalAlpha = 0.02;
    for (var fi = 0; fi < 300; fi++) {
      var fx = (noise2d(fi * 0.73, 0.5) * 0.5 + 0.5) * w;
      var fy = (noise2d(0.5, fi * 0.73) * 0.5 + 0.5) * h;
      var angle = noise2d(fx * 0.01, fy * 0.01) * 0.4 + 0.1; // mostly horizontal
      var len = 4 + Math.abs(noise2d(fi * 1.1, 0.3)) * 10;
      ctx.strokeStyle = noise2d(fi * 0.5, 0.7) > 0
        ? 'rgba(255,255,255,0.6)'
        : 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 0.3 + Math.abs(noise2d(fi * 0.3, 0.9)) * 0.4;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + Math.cos(angle) * len, fy + Math.sin(angle) * len);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Realistic wood grain using noise bands
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} w
   * @param {number} h
   * @param {number} cx - center x of the wood ring pattern
   * @param {number} cy - center y
   */
  function woodGrainTexture(ctx, w, h, cx, cy) {
    var step = 2;
    for (var py = 0; py < h; py += step) {
      for (var px = 0; px < w; px += step) {
        // Distance from center creates ring pattern
        var dx = (px - cx) / w;
        var dy = (py - cy) / h;
        var dist = Math.sqrt(dx * dx + dy * dy);

        // Noise-warped rings
        var warp = fbm(px * 0.008, py * 0.008, 3, 2.0, 0.5) * 0.15;
        var ring = Math.sin((dist + warp) * 80);

        // Convert ring to brightness variation
        var bright = ring * 0.04;
        if (bright > 0) {
          ctx.fillStyle = 'rgba(180, 120, 60, ' + bright + ')';
        } else {
          ctx.fillStyle = 'rgba(0, 0, 0, ' + Math.abs(bright) * 0.8 + ')';
        }
        ctx.fillRect(px, py, step, step);
      }
    }

    // Fine grain streaks
    ctx.save();
    ctx.globalAlpha = 0.03;
    for (var gi = 0; gi < 60; gi++) {
      var gx = (noise2d(gi * 1.3, 10) * 0.5 + 0.5) * w;
      var gy = (noise2d(10, gi * 1.3) * 0.5 + 0.5) * h;
      var gAngle = Math.atan2(gy - cy, gx - cx) + Math.PI / 2; // perpendicular to radius
      var gLen = 15 + Math.abs(noise2d(gi * 0.7, 5)) * 50;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 0.4 + Math.abs(noise2d(gi * 0.5, 3)) * 0.8;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + Math.cos(gAngle) * gLen, gy + Math.sin(gAngle) * gLen);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ================================================================
  //  DECORATIVE DRAWING HELPERS
  // ================================================================

  /**
   * Returns a gold foil linear gradient
   */
  function goldFoilGradient(ctx, x, y, w, h) {
    var g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, '#d4a849');
    g.addColorStop(0.25, '#f5d78e');
    g.addColorStop(0.5, '#c9952a');
    g.addColorStop(0.75, '#f0d070');
    g.addColorStop(1, '#b8860b');
    return g;
  }

  /**
   * Draw a double-line gold border with inner glow
   */
  function drawGoldBorder(ctx, x, y, w, h, r, thickness) {
    thickness = thickness || 1.5;
    ctx.save();

    // Outer gold line
    ctx.strokeStyle = '#c9952a';
    ctx.lineWidth = thickness;
    roundRect(ctx, x, y, w, h, r);
    ctx.stroke();

    // Inner gold line (slightly inset)
    var inset = thickness + 1.5;
    ctx.strokeStyle = '#d4a849';
    ctx.lineWidth = thickness * 0.6;
    roundRect(ctx, x + inset, y + inset, w - inset * 2, h - inset * 2, Math.max(r - inset, 1));
    ctx.stroke();

    // Subtle inner glow between the two lines
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = '#f5d78e';
    ctx.lineWidth = inset;
    roundRect(ctx, x + inset / 2, y + inset / 2, w - inset, h - inset, Math.max(r - inset / 2, 1));
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Ornate corner flourish swirl
   * @param {number} rotation — 0=top-left, PI/2=top-right, PI=bottom-right, 3PI/2=bottom-left
   */
  function drawCornerFlourish(ctx, x, y, size, rotation) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation || 0);

    var s = size || 8;
    ctx.strokeStyle = '#c9952a';
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.3;

    // Main curl
    ctx.beginPath();
    ctx.moveTo(0, s * 0.1);
    ctx.quadraticCurveTo(s * 0.05, s * 0.05, s * 0.1, 0);
    ctx.stroke();

    // Leaf stroke
    ctx.beginPath();
    ctx.moveTo(s * 0.05, s * 0.05);
    ctx.quadraticCurveTo(s * 0.3, s * 0.02, s * 0.4, s * 0.08);
    ctx.quadraticCurveTo(s * 0.3, s * 0.06, s * 0.05, s * 0.05);
    ctx.fillStyle = 'rgba(201, 149, 42, 0.15)';
    ctx.fill();
    ctx.stroke();

    // Secondary curl
    ctx.beginPath();
    ctx.moveTo(s * 0.05, s * 0.05);
    ctx.quadraticCurveTo(s * 0.02, s * 0.3, s * 0.08, s * 0.4);
    ctx.quadraticCurveTo(s * 0.06, s * 0.3, s * 0.05, s * 0.05);
    ctx.fillStyle = 'rgba(201, 149, 42, 0.15)';
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Decorative filigree ring (for table felt/wood junction)
   */
  function drawFiligree(ctx, cx, cy, rx, ry) {
    ctx.save();
    var segments = 36;
    var dotSize = 2;

    // Gold ring (subtle solid base)
    ctx.strokeStyle = '#b8860b';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.2;

    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Ornamental dots along the ring
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#d4a849';
    for (var i = 0; i < segments; i++) {
      var angle = (i / segments) * Math.PI * 2;
      var dx = cx + rx * Math.cos(angle);
      var dy = cy + ry * Math.sin(angle);
      ctx.beginPath();
      ctx.arc(dx, dy, dotSize, 0, Math.PI * 2);
      ctx.fill();
    }

    // Small diamond accents every 4th dot
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = '#f5d78e';
    for (var i = 0; i < segments; i += 4) {
      var angle = (i / segments) * Math.PI * 2;
      var dx = cx + rx * Math.cos(angle);
      var dy = cy + ry * Math.sin(angle);
      ctx.save();
      ctx.translate(dx, dy);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, -4);
      ctx.lineTo(2.5, 0);
      ctx.lineTo(0, 4);
      ctx.lineTo(-2.5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  // Helper: rounded rect path (shared with renderer)
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
  //  PUBLIC API
  // ================================================================

  return {
    noise2d: noise2d,
    fbm: fbm,
    paperTexture: paperTexture,
    feltTexture: feltTexture,
    woodGrainTexture: woodGrainTexture,
    goldFoilGradient: goldFoilGradient,
    drawGoldBorder: drawGoldBorder,
    drawCornerFlourish: drawCornerFlourish,
    drawFiligree: drawFiligree
  };
})();

/* ============================================================
   30 - Performance Instrumentation
   Lightweight click-to-state-change timing for tuning the game's
   responsiveness across platforms (Windows tends to be slower than
   mobile — see CLAUDE.md "Performance" section).

   Usage:
     Perf.markClick();                  // user clicked a button
     Perf.mark('state-updated');        // game state mutation done
     Perf.mark('score-rendered');       // updatePlayerTotal completed
     Perf.mark('animation-done');       // canvas animation finished
     Perf.endClick();                   // logs the timeline to console

   The instrumentation is OFF by default. Enable from the browser
   console with:  Perf.enable()
   Disable again with:  Perf.disable()

   Setting `localStorage.setItem('PERF', '1')` persists it across
   reloads — handy when measuring on a real device where you can't
   keep the console open between actions.
   ============================================================ */

var Perf = (function () {
  'use strict';

  var enabled = false;
  try {
    if (window.localStorage && window.localStorage.getItem('PERF') === '1') {
      enabled = true;
    }
  } catch (e) {}

  // Per-click event accumulator. Each call to markClick() resets it; each
  // mark() appends. endClick() prints + clears.
  var current = null;
  // Optional running stats so we can spot drift over a session.
  var stats = {};

  function now() {
    if (typeof performance !== 'undefined' && performance.now) return performance.now();
    return Date.now();
  }

  function enable() {
    enabled = true;
    try { window.localStorage.setItem('PERF', '1'); } catch (e) {}
    console.log('[Perf] enabled. Trigger a Draw/Stay click to see timings.');
  }

  function disable() {
    enabled = false;
    try { window.localStorage.removeItem('PERF'); } catch (e) {}
    console.log('[Perf] disabled.');
  }

  // Begin a click-to-state-change timeline.
  function markClick(label) {
    if (!enabled) return;
    current = {
      label: label || 'click',
      start: now(),
      marks: []
    };
  }

  // Append a labelled mark to the active timeline.
  function mark(label) {
    if (!enabled || !current) return;
    current.marks.push({ label: label, t: now() });
  }

  // Finalise the timeline. Logs a single line like:
  //   [Perf] click=draw total=512ms | state-updated +0.4ms | score-rendered +0.6ms | animation-done +511ms
  // and updates running stats so we can spot regressions.
  function endClick() {
    if (!enabled || !current) return;
    var total = now() - current.start;
    var parts = [];
    var prev = current.start;
    for (var i = 0; i < current.marks.length; i++) {
      var m = current.marks[i];
      var dt = (m.t - prev).toFixed(1);
      parts.push(m.label + ' +' + dt + 'ms');
      prev = m.t;
    }
    console.log('[Perf] click=' + current.label + ' total=' + total.toFixed(1) + 'ms | ' + parts.join(' | '));

    // Track running average per label for at-a-glance regression spotting.
    var key = current.label;
    if (!stats[key]) stats[key] = { n: 0, sum: 0, max: 0 };
    stats[key].n += 1;
    stats[key].sum += total;
    if (total > stats[key].max) stats[key].max = total;

    current = null;
  }

  // Print the running stats (one row per click label).
  function dump() {
    if (!enabled) {
      console.log('[Perf] disabled. Call Perf.enable() first.');
      return;
    }
    var rows = [];
    for (var k in stats) {
      if (stats.hasOwnProperty(k)) {
        var s = stats[k];
        rows.push({
          label: k,
          count: s.n,
          avg_ms: (s.sum / s.n).toFixed(1),
          max_ms: s.max.toFixed(1)
        });
      }
    }
    if (console.table) console.table(rows);
    else console.log('[Perf]', rows);
  }

  // Frame-rate sampler — samples requestAnimationFrame deltas while
  // running and reports rolling average + worst frame. Used to detect
  // dropped frames between actions (the kind of "the game feels laggy
  // even when nothing is happening" sluggishness on Windows).
  var fpsSamples = [];
  var fpsRaf = null;
  var fpsLast = 0;
  function startFpsSampler() {
    if (!enabled) return;
    if (fpsRaf) return;
    fpsLast = now();
    fpsSamples = [];
    function tick() {
      var t = now();
      var dt = t - fpsLast;
      fpsLast = t;
      fpsSamples.push(dt);
      if (fpsSamples.length > 240) fpsSamples.shift(); // ~4s rolling window
      fpsRaf = requestAnimationFrame(tick);
    }
    fpsRaf = requestAnimationFrame(tick);
    console.log('[Perf] FPS sampler started. Call Perf.fps() for a reading.');
  }
  function stopFpsSampler() {
    if (fpsRaf) cancelAnimationFrame(fpsRaf);
    fpsRaf = null;
  }
  function fps() {
    if (!fpsSamples.length) {
      console.log('[Perf] No samples yet. Call Perf.startFpsSampler() first.');
      return;
    }
    var sum = 0, max = 0;
    for (var i = 0; i < fpsSamples.length; i++) {
      sum += fpsSamples[i];
      if (fpsSamples[i] > max) max = fpsSamples[i];
    }
    var avg = sum / fpsSamples.length;
    console.log('[Perf] FPS over last ' + fpsSamples.length + ' frames: avg=' +
                (1000 / avg).toFixed(1) + ' worst-frame=' + max.toFixed(1) + 'ms');
  }

  return {
    enable: enable,
    disable: disable,
    isEnabled: function () { return enabled; },
    markClick: markClick,
    mark: mark,
    endClick: endClick,
    dump: dump,
    startFpsSampler: startFpsSampler,
    stopFpsSampler: stopFpsSampler,
    fps: fps
  };
})();

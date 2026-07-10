/*
 * Animations — the battle cinematic queue (window.Battle) and the big set
 * pieces (window.Anim: elimination + ceremony). Everything lives inside
 * #fx-root, which is pointer-events:none at rest; each overlay manages its
 * own pointer-events so the map underneath is only ever blocked on purpose.
 *
 * One-way dependency rule: this module may call Renderer/Sound/Save, never
 * Net/Game — ui.js is the orchestrator that feeds events in.
 */
(function () {
  "use strict";

  var CONST = (typeof window !== "undefined" && window.AlliancesConst) ||
    { SPEEDS: { cinematic: 1, brisk: 0.4, instant: 0 }, METALS: [] };

  // ---- shared helpers --------------------------------------------------------

  function fxRoot() { return document.getElementById("fx-root"); }

  function reducedMotion() {
    try {
      return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) { return false; }
  }

  function prefSpeed() {
    try {
      var p = window.Save && window.Save.prefs && window.Save.prefs();
      if (p && p.battleSpeed && CONST.SPEEDS.hasOwnProperty(p.battleSpeed)) return p.battleSpeed;
    } catch (e) {}
    return "cinematic";
  }

  function sfx(name) {
    try { if (window.Sound) window.Sound.play(name); } catch (e) {}
  }

  function el(tag, cls, parent, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text != null) d.textContent = text;
    if (parent) parent.appendChild(d);
    return d;
  }

  function sum(arr) {
    var s = 0;
    for (var i = 0; i < (arr ? arr.length : 0); i++) s += arr[i];
    return s;
  }

  // Speed policy as a pure function (also exported for node tests):
  // backlog > 2 -> instant (spectators must catch up);
  // 3rd+ attack of a turn downgrades cinematic to brisk (spree fatigue);
  // reduced-motion always wins.
  function pickSpeed(pref, attackIndexInTurn, backlog, reduced) {
    if (reduced) return "instant";
    if (backlog > 2) return "instant";
    if ((attackIndexInTurn | 0) >= 3 && pref === "cinematic") return "brisk";
    return pref;
  }

  function applyToMap(b) {
    try {
      if (window.Renderer) {
        return window.Renderer.applyBattleResult({
          from: b.from, to: b.to,
          fromAfter: b.fromAfter, toAfter: b.toAfter,
          won: b.won, attackerColor: b.attackerColor
        });
      }
    } catch (e) {}
    return Promise.resolve();
  }

  // ============================ BATTLE ==========================================

  var queue = [];
  var busy = false;
  var drainCbs = [];

  function enqueue(b) {
    queue.push(b);
    pump();
  }

  function onQueueDrained(cb) { drainCbs.push(cb); }

  function pump() {
    if (busy) return;
    var b = queue.shift();
    if (!b) {
      for (var i = 0; i < drainCbs.length; i++) {
        try { drainCbs[i](); } catch (e) {}
      }
      return;
    }
    busy = true;
    var speed = pickSpeed(prefSpeed(), b.attackIndexInTurn, queue.length, reducedMotion());
    playBattle(b, speed).then(function () {
      busy = false;
      if (queue.length) setTimeout(pump, 250); // breath between back-to-back battles
      else pump();                             // empty pump fires the drained callbacks
    });
  }

  // Instant mode: no theater — a 400ms verdict card while the map animates.
  function playInstant(b, root, resolve) {
    applyToMap(b);
    sfx(b.won ? "capture" : "repel");
    var card = el("div", "battle-flash", root);
    var line = el("div", "bf-line", card);
    var an = el("b", null, line, b.attackerName || "Attacker");
    an.style.color = b.attackerColor || "";
    el("span", null, line, " " + sum(b.attackerDice) + " — " + sum(b.defenderDice) + " ");
    var dn = el("b", null, line, b.defenderName || "Defender");
    dn.style.color = b.defenderColor || "";
    var stamp = el("div", "bf-stamp", card, b.won ? "CAPTURED" : "REPELLED");
    stamp.style.color = b.won ? (b.attackerColor || "#fff") : (b.defenderColor || "#fff");
    requestAnimationFrame(function () { card.classList.add("in"); });
    setTimeout(function () {
      card.classList.add("out");
      setTimeout(function () {
        if (card.parentNode) card.parentNode.removeChild(card);
        resolve();
      }, 180);
    }, 420);
  }

  function buildDice(parent, dice, color) {
    var made = [];
    var shown = Math.min(10, dice.length);
    var row = el("div", "bp-dice", parent);
    for (var i = 0; i < shown; i++) {
      var d = el("div", "die die--" + dice[i], row);
      d.style.borderColor = color || "";
      d._final = dice[i];
      made.push(d);
    }
    if (dice.length > shown) {
      // spectacle is bounded but the math stays honest: totals use ALL dice
      el("div", "die-stack", row, "+" + (dice.length - shown) + " more");
    }
    return made;
  }

  function playBattle(b, speedName) {
    return new Promise(function (resolve) {
      var root = fxRoot();
      if (!root) { applyToMap(b).then(resolve); return; }
      if (speedName === "instant") { playInstant(b, root, resolve); return; }

      var m = CONST.SPEEDS[speedName] || 1;
      var aTotal = sum(b.attackerDice), dTotal = sum(b.defenderDice);

      // ---- DOM -------------------------------------------------------------
      var overlay = el("div", "battle-overlay", root);
      el("div", "battle-scrim", overlay);
      el("div", "battle-bar battle-bar--top", overlay);
      el("div", "battle-bar battle-bar--bot", overlay);
      var stage = el("div", "battle-stage", overlay);

      function panel(side, name, terrName, dice, color) {
        var p = el("div", "battle-panel battle-panel--" + side, stage);
        p.style.borderTopColor = color || "";
        var nm = el("div", "bp-name", p, name || (side === "att" ? "ATTACKER" : "DEFENDER"));
        nm.style.color = color || "";
        el("div", "bp-terr", p, terrName || "");
        el("div", "bp-sub", p, dice.length + (dice.length === 1 ? " die" : " dice"));
        var dieEls = buildDice(p, dice, color);
        var tot = el("div", "bp-total", p, "0");
        return { root: p, dice: dieEls, total: tot };
      }

      var att = panel("att", b.attackerName, b.fromName, b.attackerDice, b.attackerColor);
      el("div", "battle-versus", stage, "VS");
      var def = panel("def", b.defenderName, b.toName, b.defenderDice, b.defenderColor);
      var verdict = el("div", "battle-verdict", stage, b.won ? "CAPTURED!" : "REPELLED!");
      verdict.style.color = b.won ? (b.attackerColor || "#fff") : (b.defenderColor || "#fff");

      requestAnimationFrame(function () { overlay.classList.add("in"); });

      // ---- timeline --------------------------------------------------------
      var timers = [], rafs = [], tumbler = null;
      var verdictDone = false, finished = false;
      var tumbling = []; // dice still cycling faces

      function at(t, fn) { timers.push(setTimeout(fn, t)); }
      function clearAll() {
        timers.forEach(clearTimeout);
        timers = [];
        rafs.forEach(cancelAnimationFrame);
        rafs = [];
        if (tumbler) { clearInterval(tumbler); tumbler = null; }
      }

      var pourGap = Math.max(18, 40 * m);
      var pourStart = 380 * m;
      var shownCount = att.dice.length + def.dice.length;
      var settleStart = Math.max(1050 * m, pourStart + Math.max(att.dice.length, def.dice.length) * pourGap + 160 * m);
      var settleSpan = 750 * m;
      var tVerdict = settleStart + settleSpan + 180 * m;
      var hold = 520 * m + 220;

      function setFace(d, v) {
        d.className = d.className.replace(/die--\d/g, "").trim() + " die--" + v;
      }

      function settleDie(d, playTick) {
        var idx = tumbling.indexOf(d);
        if (idx !== -1) tumbling.splice(idx, 1);
        setFace(d, d._final);
        d.style.transform = "";
        d.classList.add("settled");
        if (playTick) sfx("settle");
      }

      function settleAllNow() {
        while (tumbling.length) settleDie(tumbling[0], false);
        att.total.textContent = aTotal;
        def.total.textContent = dTotal;
      }

      function odometer(elTot, total, dur) {
        var start = performance.now();
        function step(now) {
          var t = Math.min(1, (now - start) / dur);
          elTot.textContent = Math.round(total * t);
          if (t < 1) rafs.push(requestAnimationFrame(step));
          else elTot.textContent = total;
        }
        rafs.push(requestAnimationFrame(step));
      }

      function doVerdict(quick) {
        if (verdictDone) return;
        verdictDone = true;
        clearAll();
        settleAllNow();
        verdict.classList.add("show");
        stage.classList.add("shake");
        (b.won ? def : att).root.classList.add("desat");
        overlay.style.pointerEvents = "none"; // map unlocks the moment the verdict lands
        sfx(b.won ? "capture" : "repel");
        applyToMap(b);
        var wait = quick ? 420 : hold;
        setTimeout(function () {
          overlay.classList.add("out");
          setTimeout(finish, 340);
        }, wait);
      }

      function finish() {
        if (finished) return;
        finished = true;
        clearAll();
        document.removeEventListener("keydown", onKey, true);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve();
      }

      function skip() { if (!verdictDone) doVerdict(true); }

      function onKey(e) {
        if (e.code === "Space" || e.key === " ") {
          if (!verdictDone) {
            e.preventDefault();
            skip();
          }
        }
      }
      overlay.addEventListener("click", skip);
      document.addEventListener("keydown", onKey, true);

      // pour the dice in
      var allDice = att.dice.concat(def.dice);
      at(pourStart - 60 * m, function () { sfx("dice"); });
      if (m >= 0.9) at(pourStart + 420, function () { sfx("dice"); });
      allDice.forEach(function (d, i) {
        var side = i < att.dice.length ? i : i - att.dice.length;
        at(pourStart + side * pourGap, function () {
          d.classList.add("in");
          tumbling.push(d);
        });
      });

      // tumble: cycle random faces with rotation jitter until each die settles
      tumbler = setInterval(function () {
        for (var i = 0; i < tumbling.length; i++) {
          var d = tumbling[i];
          setFace(d, 1 + Math.floor(Math.random() * 6));
          d.style.transform = "rotate(" + (Math.random() * 28 - 14).toFixed(1) + "deg)" +
            " translate(" + (Math.random() * 4 - 2).toFixed(1) + "px," + (Math.random() * 4 - 2).toFixed(1) + "px)";
        }
      }, 70);

      // settle one-by-one, interleaving sides so both columns finish together
      var order = [];
      for (var k = 0; k < Math.max(att.dice.length, def.dice.length); k++) {
        if (att.dice[k]) order.push(att.dice[k]);
        if (def.dice[k]) order.push(def.dice[k]);
      }
      var perDie = order.length ? settleSpan / order.length : settleSpan;
      var throttleTicks = shownCount > 12; // 20 ticks is noise, not charm
      order.forEach(function (d, i) {
        at(settleStart + i * perDie, function () {
          settleDie(d, !throttleTicks || i % 2 === 0);
        });
      });

      at(settleStart, function () {
        odometer(att.total, aTotal, settleSpan);
        odometer(def.total, dTotal, settleSpan);
      });

      at(tVerdict, function () { doVerdict(false); });
    });
  }

  // ============================ ELIMINATION ======================================

  function elimination(opts) {
    return new Promise(function (resolve) {
      opts = opts || {};
      var root = fxRoot();
      // the full-screen stamp is for YOUR death only — others learn from the log
      if (!opts.isMe || !root) { resolve(); return; }
      sfx("eliminated");
      var overlay = el("div", "elim-overlay", root);
      el("div", "elim-stamp", overlay, "ELIMINATED");
      el("div", "elim-sub", overlay,
        (opts.name || "You") + " — wiped from the map on turn " + (opts.turnNumber != null ? opts.turnNumber : "?") +
        ". You remain as a spectator.");
      requestAnimationFrame(function () { overlay.classList.add("in"); });
      setTimeout(function () {
        overlay.classList.add("out");
        setTimeout(function () {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          resolve();
        }, 380);
      }, 2000);
    });
  }

  // ============================ CEREMONY =========================================

  // Accepts scoreboard as [{seat, winPoints|points, name?}] or {seat: points}.
  function normScores(scoreboard, names) {
    var rows = [];
    if (Array.isArray(scoreboard)) {
      scoreboard.forEach(function (s) {
        rows.push({
          seat: s.seat,
          name: s.name || (names && names[s.seat]) || ("Seat " + s.seat),
          points: (s.winPoints != null ? s.winPoints : s.points) || 0
        });
      });
    } else if (scoreboard && typeof scoreboard === "object") {
      Object.keys(scoreboard).forEach(function (k) {
        rows.push({
          seat: +k,
          name: (names && names[+k]) || ("Seat " + k),
          points: scoreboard[k] || 0
        });
      });
    }
    return rows;
  }

  // Rank arrows: compare each player's rank before this round's award vs after.
  function rankMoves(rows, winnerSeats, awardOf) {
    function ranksOf(list, key) {
      var sorted = list.slice().sort(function (a, b) { return b[key] - a[key] || a.seat - b.seat; });
      var r = {};
      sorted.forEach(function (row, i) { r[row.seat] = i; });
      return r;
    }
    var withPrev = rows.map(function (r) {
      var won = winnerSeats.indexOf(r.seat) !== -1;
      return { seat: r.seat, points: r.points, prev: r.points - (won ? awardOf(r.seat) : 0) };
    });
    var before = ranksOf(withPrev, "prev");
    var after = ranksOf(withPrev, "points");
    var moves = {};
    withPrev.forEach(function (r) {
      moves[r.seat] = before[r.seat] > after[r.seat] ? 1 : (before[r.seat] < after[r.seat] ? -1 : 0);
    });
    return moves;
  }

  function ceremony(opts) {
    return new Promise(function (resolve) {
      opts = opts || {};
      var root = fxRoot();
      if (!root) { resolve(); return; }

      var winner = opts.winner || { type: "solo", seats: [] };
      var seats = winner.seats || [];
      var names = opts.names || [];
      var colors = opts.colors || [];
      // pointsAwarded arrives as a {seat: pts} map (Spoils of War can split
      // unevenly); a bare number or nothing falls back to an even split.
      var awardMap = (opts.pointsAwarded && typeof opts.pointsAwarded === "object")
        ? opts.pointsAwarded : null;
      var per = typeof opts.pointsAwarded === "number" ? opts.pointsAwarded
        : (seats.length ? Math.round(60 / seats.length) : 0);
      function awardOf(s) {
        return awardMap ? (awardMap[s] != null ? awardMap[s] : 0) : per;
      }
      var rows = normScores(opts.scoreboard, names);
      var moves = rankMoves(rows, seats, awardOf);
      var t0 = Date.now();

      sfx("ceremony");

      // ---- DOM -------------------------------------------------------------
      var overlay = el("div", "cer-overlay", root); // blocks input by design
      el("div", "cer-sweep", overlay);
      var stagePane = el("div", "cer-stage", overlay);
      var stamp = el("div", "cer-stamp", stagePane, "VICTORY");

      var banner = el("div", "cer-banner", stagePane);
      if (winner.type === "alliance") {
        var metal = (CONST.METALS && CONST.METALS[winner.metalIndex]) || CONST.METALS[0] ||
          { color: "#f5c84c", sigil: "◆" };
        var sig = el("span", "cer-sigil", banner, metal.sigil + " ");
        sig.style.color = metal.color;
        el("span", "cer-alliance-name", banner, winner.allianceName || "The Alliance");
        var members = el("div", "cer-members", banner);
        seats.forEach(function (s) {
          var chipWrap = el("span", "cer-member", members);
          var chip = el("span", "cer-chip", chipWrap);
          chip.style.background = colors[s] || "#888";
          el("span", null, chipWrap, names[s] || ("Seat " + s));
        });
      } else {
        var s0 = seats[0];
        var chip0 = el("span", "cer-chip cer-chip--big", banner);
        chip0.style.background = (s0 != null && colors[s0]) || "#888";
        el("span", "cer-solo-name", banner, (s0 != null && names[s0]) || "The Victor");
      }
      var awardVals = seats.map(awardOf);
      var awardsEqual = awardVals.every(function (v) { return v === awardVals[0]; });
      el("div", "cer-points-line", banner,
        seats.length > 1
          ? (awardsEqual ? "+" + awardVals[0] + " points each" : "the spoils, divided by force")
          : "+" + (awardVals[0] != null ? awardVals[0] : per) + " points");

      // per-winner columns the pips fly into
      var cols = el("div", "cer-columns", stagePane);
      var counters = [], counts = [];
      seats.forEach(function (s) {
        var col = el("div", "cer-col", cols);
        col.style.borderTopColor = colors[s] || "#888";
        el("div", "cer-col-name", col, names[s] || ("Seat " + s));
        counters.push(el("div", "cer-count", col, "0"));
        counts.push(0);
      });

      // scoreboard (built now, revealed later)
      var board = el("div", "cer-board", stagePane);
      el("div", "cer-board-title", board, "WAR STANDINGS");
      rows.slice().sort(function (a, b) { return b.points - a.points || a.seat - b.seat; })
        .forEach(function (r, i) {
          var row = el("div", "cer-row", board);
          el("span", "cer-rank", row, "#" + (i + 1));
          var mv = moves[r.seat] || 0;
          el("span", "cer-arrow " + (mv > 0 ? "up" : mv < 0 ? "down" : "flat"), row,
            mv > 0 ? "▲" : mv < 0 ? "▼" : "—");
          var chip = el("span", "cer-chip", row);
          chip.style.background = colors[r.seat] || "#888";
          el("span", "cer-row-name", row, r.name);
          el("span", "cer-row-pts", row, r.points);
        });

      var btn = el("button", "cer-btn", stagePane, "CONTINUE");
      btn.type = "button";

      // ---- animation machinery ----------------------------------------------
      var timers = [], rafs = [], pipEls = [];
      var done = false, resolved = false;

      function at(t, fn) { timers.push(setTimeout(fn, t)); }
      function clearAll() {
        timers.forEach(clearTimeout);
        rafs.forEach(cancelAnimationFrame);
        timers = []; rafs = [];
        pipEls.forEach(function (p) { if (p.parentNode) p.parentNode.removeChild(p); });
        pipEls = [];
      }

      function finishAll() {
        if (done) return;
        done = true;
        clearAll();
        overlay.classList.add("in");
        stamp.classList.add("in");
        banner.classList.add("in");
        cols.classList.add("in");
        counters.forEach(function (c, i) { c.textContent = awardOf(seats[i]); });
        board.classList.add("in");
        btn.classList.add("in");
      }

      function launchPips() {
        if (!seats.length || done) return;
        var stampRect = stamp.getBoundingClientRect();
        var sx = stampRect.left + stampRect.width / 2;
        var sy = stampRect.top + stampRect.height / 2;
        var targets = counters.map(function (c) {
          var r = c.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        // One pip per point, per winner — the split made physical. Interleave
        // the columns by fractional progress so uneven Spoils splits still
        // read as parallel streams rather than one column hogging the sky.
        var pipCols = [];
        seats.forEach(function (s2, w2) {
          var n = Math.max(0, Math.min(60, awardOf(s2)));
          for (var k = 0; k < n; k++) pipCols.push({ w: w2, frac: (k + 0.5) / Math.max(1, n) });
        });
        pipCols.sort(function (a, b) { return a.frac - b.frac || a.w - b.w; });
        var totalPips = Math.min(60, pipCols.length);
        for (var i = 0; i < totalPips; i++) {
          (function (i) {
            var w = pipCols[i].w;
            at(i * 22, function () {
              if (done) return;
              var pip = el("div", "cer-pip", overlay);
              pipEls.push(pip);
              var tx = targets[w].x, ty = targets[w].y;
              // control point bows each flight differently so the stream arcs
              var cxp = (sx + tx) / 2 + (Math.random() * 160 - 80);
              var cyp = Math.min(sy, ty) - 60 - Math.random() * 90;
              var start = performance.now(), dur = 620 + Math.random() * 160;
              function step(now) {
                if (done) return;
                var t = Math.min(1, (now - start) / dur);
                var u = 1 - t;
                var x = u * u * sx + 2 * u * t * cxp + t * t * tx;
                var y = u * u * sy + 2 * u * t * cyp + t * t * ty;
                pip.style.transform = "translate(" + x + "px," + y + "px)";
                if (t < 1) { rafs.push(requestAnimationFrame(step)); return; }
                if (pip.parentNode) pip.parentNode.removeChild(pip);
                var idx = pipEls.indexOf(pip);
                if (idx !== -1) pipEls.splice(idx, 1);
                counts[w]++;
                counters[w].textContent = counts[w]; // each pip = exactly 1 point
                counters[w].classList.remove("tick");
                void counters[w].offsetWidth;
                counters[w].classList.add("tick");
              }
              rafs.push(requestAnimationFrame(step));
            });
          })(i);
        }
      }

      requestAnimationFrame(function () { overlay.classList.add("in"); });

      if (reducedMotion()) {
        finishAll();
      } else {
        at(300, function () { stamp.classList.add("in"); });
        at(750, function () { banner.classList.add("in"); });
        at(950, function () { cols.classList.add("in"); });
        at(1250, launchPips);
        var flightEnd = 1250 + 60 * 22 + 850;
        at(flightEnd - 350, function () { board.classList.add("in"); });
        at(flightEnd, function () { btn.classList.add("in"); });
      }

      // skippable after 2s; CONTINUE is the only exit
      overlay.addEventListener("click", function (e) {
        if (e.target === btn) return;
        if (Date.now() - t0 > 2000) finishAll();
      });
      btn.addEventListener("click", function () {
        if (resolved) return;
        resolved = true;
        finishAll();
        sfx("click");
        overlay.classList.add("out");
        setTimeout(function () {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          resolve();
        }, 320);
      });
    });
  }

  // ---- export -------------------------------------------------------------------

  if (typeof window !== "undefined") {
    window.Battle = { enqueue: enqueue, onQueueDrained: onQueueDrained };
    window.Anim = { elimination: elimination, ceremony: ceremony };
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      __test: { pickSpeed: pickSpeed, sum: sum, normScores: normScores, rankMoves: rankMoves }
    };
  }
})();

/*
 * Renderer — inline SVG renderer for the shared Alliances map format.
 *
 * One renderer draws all three maps: it consumes the map module shape
 * (viewBox / decor / links / territories with SVG path + anchor) and never
 * touches game logic — ui.js feeds it state and listens for clicks.
 *
 * Visual state is written as SVG presentation ATTRIBUTES (fill/stroke), not
 * inline style: any CSS rule beats a presentation attribute, so fx.css state
 * classes (.selected / .attackable / .dimmed) can restyle territories without
 * fighting JS. Pan/zoom is pure viewBox math — the view rect is kept locked to
 * the container's aspect ratio so screen<->map conversion stays a simple
 * linear mapping (no letterbox correction anywhere).
 */
(function () {
  "use strict";

  var CONST = (typeof window !== "undefined" && window.AlliancesConst) || { COLORS: [] };

  var UNOWNED_FILL = "#1a2230";
  var UNOWNED_STROKE = "rgba(190,205,230,0.20)";
  var ROLL_MS = 360;     // garrison badge odometer duration
  var STAGGER_MS = 15;   // deal-out cascade per-territory delay

  // ---- pure helpers (also exported for node tests) -------------------------

  // 30% alpha over --bg-map: the svg background IS --bg-map, so a 0x4D-alpha
  // fill composites to exactly the spec'd look.
  function fillFor(color) {
    return /^#[0-9a-fA-F]{6}$/.test(color) ? color + "4d" : color;
  }

  // Badge radius 10..16, saturating around value 10 — big garrisons read as
  // big without ever swallowing a small territory.
  function badgeRadius(value) {
    var v = Math.max(1, value | 0);
    return Math.round((10 + 6 * Math.min(1, (v - 1) / 9)) * 10) / 10;
  }

  // Link path between two anchors: explicit 'via' control point when the map
  // author placed one, otherwise a gentle 12% perpendicular bow.
  function linkPathD(a, b, via) {
    if (via) {
      return "M" + a[0] + " " + a[1] + " Q" + via[0] + " " + via[1] + " " + b[0] + " " + b[1];
    }
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var k = len * 0.12;
    var mx = (a[0] + b[0]) / 2 - (dy / len) * k;
    var my = (a[1] + b[1]) / 2 + (dx / len) * k;
    return "M" + a[0] + " " + a[1] + " Q" + mx.toFixed(1) + " " + my.toFixed(1) + " " + b[0] + " " + b[1];
  }

  function easeOutCubic(t) { var u = 1 - t; return 1 - u * u * u; }

  function reducedMotion() {
    try {
      return typeof window !== "undefined" && window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) { return false; }
  }

  // ---- module state ---------------------------------------------------------

  var container = null, svg = null, map = null, controlsEl = null, resizeObs = null;
  var layers = {};   // decor / terr / metal / links / labels / fx groups
  var els = {};      // per territory id: {terr, path, metal, badgeG, badgeInner, halo, bg, ring, text, _rollRaf}
  var prefix = "";   // unique per init — keeps clipPath ids collision-free across re-inits
  var seq = 0;

  var cur = { territories: {}, seatMeta: [] };
  var curHighlight = null;     // null | array of seats
  var clickCb = null, hoverCb = null;   // survive re-init: ui registers once at boot
  var hoverId = null;

  var view = null, fitView = null;     // {x,y,w,h} in map units
  var pointers = {}, pointerCount = 0; // active pointers for pan/pinch
  var panFrom = null, pinchLast = null, dragDist = 0;
  var winRelease = null;               // window-level pointerup handler (see bindInput)

  var SVGNS = "http://www.w3.org/2000/svg";

  function mk(tag, attrs, parent) {
    var el = document.createElementNS(SVGNS, tag);
    if (attrs) {
      for (var k in attrs) {
        if (attrs[k] != null) el.setAttribute(k, attrs[k]);
      }
    }
    if (parent) parent.appendChild(el);
    return el;
  }

  function colorOf(owner) {
    var meta = owner != null && cur.seatMeta[owner];
    return meta ? meta.color : null;
  }

  // ---- init ------------------------------------------------------------------

  function init(containerEl, mapData) {
    teardown();
    container = containerEl;
    map = mapData;
    prefix = "al" + (++seq);
    els = {};
    cur = { territories: {}, seatMeta: [] };
    curHighlight = null;
    hoverId = null;

    container.classList.add("map-host");

    svg = mk("svg", {
      "class": "alliances-map",
      preserveAspectRatio: "xMidYMid meet",
      role: "img",
      "aria-label": map.name
    });

    // clip paths: reused by both the inner alliance stroke and the capture wipe
    var defs = mk("defs", null, svg);
    map.territories.forEach(function (t) {
      var cp = mk("clipPath", { id: prefix + "-clip-" + t.id }, defs);
      mk("path", { d: t.path }, cp);
    });

    // Vertical fade paint server for decor class "north-fade" (a trimmed map edge
    // reads as "the world continues" instead of a hard cut). Fixed id on purpose:
    // fx.css references url(#alc-fade-y); the old def dies with teardown().
    var fade = mk("linearGradient", { id: "alc-fade-y", x1: "0", y1: "0", x2: "0", y2: "1" }, defs);
    mk("stop", { offset: "0", "stop-color": "#07090f", "stop-opacity": "1" }, fade);
    mk("stop", { offset: "1", "stop-color": "#07090f", "stop-opacity": "0" }, fade);

    layers.decor = mk("g", { "class": "layer-decor" }, svg);
    layers.terr = mk("g", { "class": "layer-territories" }, svg);
    layers.metal = mk("g", { "class": "layer-metals" }, layers.terr); // above all fills, below links
    layers.links = mk("g", { "class": "layer-links" }, svg);
    layers.labels = mk("g", { "class": "layer-labels" }, svg);
    layers.fx = mk("g", { "class": "layer-fx" }, svg);

    buildDecor(layers.decor, map);
    buildTerritories();
    buildLinks(layers.links, map);
    buildLabels();

    container.appendChild(svg);
    buildControls();
    bindInput();

    if (typeof ResizeObserver !== "undefined") {
      resizeObs = new ResizeObserver(function () { syncAspect(); });
      resizeObs.observe(container);
    }
    fit();
  }

  function teardown() {
    if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
    if (winRelease) {
      window.removeEventListener("pointerup", winRelease);
      window.removeEventListener("pointercancel", winRelease);
      winRelease = null;
    }
    if (svg && svg.parentNode) svg.parentNode.removeChild(svg);
    if (controlsEl && controlsEl.parentNode) controlsEl.parentNode.removeChild(controlsEl);
    svg = null; controlsEl = null;
    pointers = {}; pointerCount = 0; panFrom = null; pinchLast = null;
  }

  function buildDecor(group, mapData) {
    (mapData.decor || []).forEach(function (d) {
      if (d.type === "rect") {
        mk("rect", { x: d.x, y: d.y, width: d.w, height: d.h, "class": "decor " + (d.class || "") }, group);
      } else {
        mk("path", { d: d.d, "class": "decor " + (d.class || "") }, group);
      }
    });
  }

  function buildTerritories() {
    // Array order is the paint order: maps are pre-sorted area-descending so
    // small shapes paint last and win clicks. Do NOT sort here.
    map.territories.forEach(function (t) {
      var p = mk("path", {
        d: t.path,
        "class": "terr",
        "data-id": t.id,
        fill: UNOWNED_FILL,
        stroke: UNOWNED_STROKE,
        "stroke-width": 1.25
      }, layers.terr);
      // Alliance trim: same path, stroke 4 clipped to the shape = true 2px
      // inner dashed stroke that never bleeds onto a neighbor.
      var m = mk("path", {
        d: t.path,
        "class": "terr-metal",
        "clip-path": "url(#" + prefix + "-clip-" + t.id + ")"
      }, layers.metal);
      els[t.id] = { terr: t, path: p, metal: m };
    });
    layers.terr.insertBefore(layers.metal, null); // keep metals last inside terr layer
  }

  function buildLinks(group, mapData) {
    var anchors = {};
    mapData.territories.forEach(function (t) { anchors[t.id] = t.anchor; });
    (mapData.links || []).forEach(function (l) {
      var a = anchors[l.from], b = anchors[l.to];
      if (!a || !b) return;
      mk("path", { d: linkPathD(a, b, l.via), "class": "link link--" + (l.style || "plain") }, group);
    });
  }

  function buildLabels() {
    map.territories.forEach(function (t) {
      var e = els[t.id];
      // Map contract: leader is { chip: [x, y] } — accept a bare [x, y] too.
      // (Reading t.leader[0] off the object form put every chip at (0,0),
      // stacking them in the corner with hairlines fanning across the map.)
      var chip = t.leader ? (t.leader.chip || t.leader) : null;
      if (chip && (typeof chip[0] !== "number" || typeof chip[1] !== "number")) chip = null;
      var pos = chip || t.anchor;
      if (chip) {
        // hairline from the territory out to its just-offshore chip
        mk("line", {
          x1: t.anchor[0], y1: t.anchor[1], x2: chip[0], y2: chip[1],
          "class": "leader-line"
        }, layers.labels);
      }
      var g = mk("g", {
        "class": "badge empty",
        "data-id": t.id,
        transform: "translate(" + pos[0] + "," + pos[1] + ")"
      }, layers.labels);
      // inner group exists so pop animations can use CSS transform without
      // clobbering the positioning transform on the outer group
      var inner = mk("g", { "class": "badge-inner" }, g);
      var halo = mk("circle", { "class": "badge-halo", r: 15.5 }, inner);
      var bg = mk("circle", { "class": "badge-bg", r: 12 }, inner);
      var ring = mk("circle", { "class": "badge-ring", r: 12 }, inner);
      var text = mk("text", { "class": "badge-val", "text-anchor": "middle", dy: "0.35em" }, inner);
      if (chip && t.label) {
        mk("text", {
          "class": "badge-tag", "text-anchor": "middle", y: -19
        }, inner).textContent = t.label;
      }
      e.badgeG = g; e.badgeInner = inner; e.halo = halo; e.bg = bg; e.ring = ring; e.text = text;
    });
  }

  function buildControls() {
    controlsEl = document.createElement("div");
    controlsEl.className = "map-controls";
    [
      { label: "+", title: "Zoom in", fn: function () { zoomAtScreenCenter(1 / 1.3); } },
      { label: "−", title: "Zoom out", fn: function () { zoomAtScreenCenter(1.3); } },
      { label: "⌖", title: "Fit map", fn: fit }
    ].forEach(function (b) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "map-ctl-btn";
      btn.title = b.title;
      btn.textContent = b.label;
      btn.addEventListener("click", b.fn);
      controlsEl.appendChild(btn);
    });
    container.appendChild(controlsEl);
  }

  // ---- pan / zoom -------------------------------------------------------------

  function applyView() {
    if (!svg || !view) return;
    // loose clamp: the view CENTER may not leave the map bounds, so you can
    // pan to an edge but never lose the map entirely
    var vb = map.viewBox;
    var cx = Math.min(Math.max(view.x + view.w / 2, vb.x), vb.x + vb.w);
    var cy = Math.min(Math.max(view.y + view.h / 2, vb.y), vb.y + vb.h);
    view.x = cx - view.w / 2;
    view.y = cy - view.h / 2;
    svg.setAttribute("viewBox", view.x + " " + view.y + " " + view.w + " " + view.h);
  }

  function containerAspect() {
    var r = svg.getBoundingClientRect();
    return (r.width > 1 && r.height > 1) ? r.width / r.height : map.viewBox.w / map.viewBox.h;
  }

  function syncAspect() {
    if (!view) return;
    var cx = view.x + view.w / 2, cy = view.y + view.h / 2;
    view.h = view.w / containerAspect();
    view.x = cx - view.w / 2;
    view.y = cy - view.h / 2;
    applyView();
  }

  function fit() {
    if (!svg || !map) return;
    var vb = map.viewBox;
    var pad = Math.max(vb.w, vb.h) * 0.035;
    var bw = vb.w + pad * 2, bh = vb.h + pad * 2;
    var ar = containerAspect();
    var w = bw, h = bw / ar;
    if (h < bh) { h = bh; w = h * ar; }
    view = {
      x: vb.x - pad - (w - bw) / 2,
      y: vb.y - pad - (h - bh) / 2,
      w: w, h: h
    };
    fitView = { x: view.x, y: view.y, w: view.w, h: view.h };
    applyView();
  }

  function unitsPerPx() {
    var r = svg.getBoundingClientRect();
    return r.width > 1 ? view.w / r.width : 1;
  }

  function screenToMap(cx, cy) {
    var r = svg.getBoundingClientRect();
    var u = unitsPerPx();
    return { x: view.x + (cx - r.left) * u, y: view.y + (cy - r.top) * u };
  }

  function clampZoomW(w) {
    if (!fitView) return w;
    return Math.min(Math.max(w, fitView.w / 9), fitView.w * 1.4);
  }

  // f > 1 zooms OUT (view widens); the map point under (cx,cy) stays put
  function zoomAtScreen(f, cx, cy) {
    var p = screenToMap(cx, cy);
    var nw = clampZoomW(view.w * f);
    f = nw / view.w;
    view.x = p.x - (p.x - view.x) * f;
    view.y = p.y - (p.y - view.y) * f;
    view.w = nw;
    view.h *= f;
    applyView();
  }

  function zoomAtScreenCenter(f) {
    var r = svg.getBoundingClientRect();
    zoomAtScreen(f, r.left + r.width / 2, r.top + r.height / 2);
  }

  function bindInput() {
    svg.addEventListener("wheel", function (e) {
      e.preventDefault();
      zoomAtScreen(e.deltaY < 0 ? 1 / 1.18 : 1.18, e.clientX, e.clientY);
    }, { passive: false });

    svg.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // NO setPointerCapture here: capture retargets the eventual click event
      // to the <svg> itself, so territory clicks would never reach the paths.
      // Capture is engaged in pointermove only once a real drag has begun.
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      // Derived, not incremented: an uncaptured mouse released off-window can
      // miss its pointerup — a stale count would lock the map into "pinch".
      pointerCount = Object.keys(pointers).length;
      if (pointerCount >= 2) {
        // A pinch is never a click — and capture is safe here because the
        // click suppression below is already guaranteed by dragDist.
        dragDist = 999;
        try { svg.setPointerCapture(e.pointerId); } catch (err) {}
      } else {
        dragDist = 0;
      }
      pinchLast = null;
      panFrom = pointerCount === 1 ? { x: e.clientX, y: e.clientY } : null;
    });

    svg.addEventListener("pointermove", function (e) {
      var pt = pointers[e.pointerId];
      if (!pt) return;
      pt.x = e.clientX; pt.y = e.clientY;
      if (pointerCount >= 2) {
        pinchUpdate();
      } else if (panFrom) {
        var u = unitsPerPx();
        var dx = e.clientX - panFrom.x, dy = e.clientY - panFrom.y;
        dragDist += Math.abs(dx) + Math.abs(dy);
        if (dragDist > 6) {
          // A real pan: capture so dragging keeps tracking outside the map,
          // and show it. A plain press-release never reaches this branch, so
          // its click lands untouched on the territory path.
          try { svg.setPointerCapture(e.pointerId); } catch (err) {}
          svg.classList.add("panning");
        }
        view.x -= dx * u;
        view.y -= dy * u;
        panFrom = { x: e.clientX, y: e.clientY };
        applyView();
      }
    });

    function release(e) {
      if (!pointers[e.pointerId]) return;
      delete pointers[e.pointerId];
      pointerCount = Object.keys(pointers).length;
      pinchLast = null;
      if (pointerCount === 1) {
        // pinch ended with one finger down: continue as a pan from that finger
        for (var id in pointers) panFrom = { x: pointers[id].x, y: pointers[id].y };
      } else if (pointerCount === 0) {
        panFrom = null;
        if (svg) svg.classList.remove("panning");
      }
    }
    // Releases land on WINDOW: an uncaptured mouse can be released outside the
    // svg (press near the map edge, drift, let go) and the svg would never
    // hear the pointerup — leaked pointers turned every later press into a
    // phantom "pinch" that suppressed all clicks until the next round.
    winRelease = release;
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);

    // click + hover are delegated so 60 territories share 3 listeners
    svg.addEventListener("click", function (e) {
      if (dragDist > 6) return; // that was a pan, not a click
      var t = e.target.closest ? e.target.closest(".terr") : null;
      if (t && clickCb) clickCb(t.getAttribute("data-id"));
    });
    svg.addEventListener("pointerover", function (e) { emitHover(e.target); });
    svg.addEventListener("pointerout", function (e) { emitHover(e.relatedTarget); });
  }

  function pinchUpdate() {
    var ids = Object.keys(pointers);
    if (ids.length < 2) return;
    var a = pointers[ids[0]], b = pointers[ids[1]];
    var cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    var dx = a.x - b.x, dy = a.y - b.y;
    var dist = Math.max(20, Math.sqrt(dx * dx + dy * dy));
    if (!pinchLast) { pinchLast = { d: dist, x: cx, y: cy }; return; }
    zoomAtScreen(pinchLast.d / dist, cx, cy);
    var u = unitsPerPx();
    view.x -= (cx - pinchLast.x) * u;
    view.y -= (cy - pinchLast.y) * u;
    applyView();
    pinchLast = { d: dist, x: cx, y: cy };
  }

  function emitHover(target) {
    var t = target && target.closest ? target.closest(".terr") : null;
    var id = t ? t.getAttribute("data-id") : null;
    if (id !== hoverId) {
      hoverId = id;
      if (hoverCb) hoverCb(id);
    }
  }

  // ---- state -----------------------------------------------------------------

  function setBadgeValue(id, value) {
    var e = els[id];
    var r = badgeRadius(value);
    e.bg.setAttribute("r", r);
    e.ring.setAttribute("r", r);
    e.halo.setAttribute("r", r + 3.5);
    e.text.setAttribute("font-size", Math.round(r * 1.05));
    e.text.textContent = value;
  }

  function ringFlash(id) {
    var ring = els[id].ring;
    ring.classList.remove("ring-flash");
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { ring.classList.add("ring-flash"); });
    });
  }

  function rollBadge(id, from, to) {
    var e = els[id];
    if (e._rollRaf) cancelAnimationFrame(e._rollRaf);
    if (reducedMotion() || from === to) { setBadgeValue(id, to); return; }
    var start = performance.now();
    function step(now) {
      var t = Math.min(1, (now - start) / ROLL_MS);
      setBadgeValue(id, Math.round(from + (to - from) * easeOutCubic(t)));
      if (t < 1) {
        e._rollRaf = requestAnimationFrame(step);
      } else {
        e._rollRaf = null;
        setBadgeValue(id, to);
        ringFlash(id);
      }
    }
    e._rollRaf = requestAnimationFrame(step);
  }

  function applyDim(id) {
    var e = els[id];
    var st = cur.territories[id];
    var dim = curHighlight != null &&
      (!st || st.owner == null || curHighlight.indexOf(st.owner) === -1);
    e.path.classList.toggle("dimmed", dim);
    e.metal.classList.toggle("dimmed", dim);
    if (e.badgeG) e.badgeG.classList.toggle("dimmed", dim);
  }

  function setTerrState(id, owner, value, animateRoll) {
    var e = els[id];
    if (!e) return;
    var meta = owner != null ? cur.seatMeta[owner] : null;
    var color = meta ? meta.color : null;

    e.path.setAttribute("fill", color ? fillFor(color) : UNOWNED_FILL);
    e.path.setAttribute("stroke", color || UNOWNED_STROKE);

    var metal = meta && meta.allianceMetal;
    if (metal) {
      e.metal.setAttribute("stroke", metal.color);
      e.metal.classList.add("on");
      e.halo.setAttribute("stroke", metal.color);
      e.badgeG.classList.add("allied");
    } else {
      e.metal.classList.remove("on");
      e.badgeG.classList.remove("allied");
    }

    e.badgeG.classList.remove("empty");
    e.ring.setAttribute("stroke", color || UNOWNED_STROKE);

    var prev = cur.territories[id];
    cur.territories[id] = { owner: owner, value: value };
    if (animateRoll && prev && prev.value !== value) rollBadge(id, prev.value, value);
    else setBadgeValue(id, value);
    applyDim(id);
  }

  function setState(territories, seatMeta) {
    if (!svg) return;
    if (seatMeta) cur.seatMeta = seatMeta;
    map.territories.forEach(function (t) {
      var st = territories && territories[t.id];
      if (st) setTerrState(t.id, st.owner, st.value, true);
    });
  }

  // ---- interaction spec --------------------------------------------------------

  function setInteractive(spec) {
    if (!svg) return;
    map.territories.forEach(function (t) {
      var cl = els[t.id].path.classList;
      cl.remove("own-selectable");
      cl.remove("selected");
      cl.remove("attackable");
    });
    svg.classList.toggle("interactive", !!spec);
    if (!spec) return;
    (spec.sources || []).forEach(function (id) {
      if (els[id]) els[id].path.classList.add("own-selectable");
    });
    if (spec.armed && els[spec.armed]) els[spec.armed].path.classList.add("selected");
    (spec.targets || []).forEach(function (id) {
      if (els[id]) els[id].path.classList.add("attackable");
    });
  }

  function onTerritoryClick(cb) { clickCb = cb; }
  function onTerritoryHover(cb) { hoverCb = cb; }

  function highlightSeats(seats) {
    curHighlight = seats == null ? null : seats.slice();
    if (!svg) return;
    map.territories.forEach(function (t) { applyDim(t.id); });
  }

  function highlightSeat(seat) {
    highlightSeats(seat == null ? null : [seat]);
  }

  function flashTerritory(id) {
    var e = els[id];
    if (!e) return;
    e.path.classList.remove("flash");
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { e.path.classList.add("flash"); });
    });
    setTimeout(function () { e.path.classList.remove("flash"); }, 1000);
  }

  // ---- battle + deal-out animations ---------------------------------------------

  function radialWipe(id, color, done) {
    var e = els[id];
    var t = e.terr;
    var bbox;
    try { bbox = e.path.getBBox(); } catch (err) { bbox = null; }
    var ax = t.anchor[0], ay = t.anchor[1];
    var R = 60;
    if (bbox) {
      // radius that covers the farthest corner of the shape from the anchor
      var corners = [
        [bbox.x, bbox.y], [bbox.x + bbox.width, bbox.y],
        [bbox.x, bbox.y + bbox.height], [bbox.x + bbox.width, bbox.y + bbox.height]
      ];
      R = 0;
      corners.forEach(function (c) {
        var dx = c[0] - ax, dy = c[1] - ay;
        R = Math.max(R, Math.sqrt(dx * dx + dy * dy));
      });
      R += 4;
    }
    var g = mk("g", { "clip-path": "url(#" + prefix + "-clip-" + id + ")" }, layers.fx);
    var circle = mk("circle", { cx: ax, cy: ay, r: 0, fill: color, opacity: 0.55, "class": "wipe" }, g);
    var start = performance.now();
    var GROW = 380, FADE = 240;
    function step(now) {
      var t1 = Math.min(1, (now - start) / GROW);
      circle.setAttribute("r", R * easeOutCubic(t1));
      if (t1 < 1) { requestAnimationFrame(step); return; }
      circle.setAttribute("opacity", 0.55);
      circle.style.transition = "opacity " + FADE + "ms ease";
      requestAnimationFrame(function () { circle.style.opacity = "0"; });
      setTimeout(function () {
        if (g.parentNode) g.parentNode.removeChild(g);
        if (done) done();
      }, FADE + 30);
    }
    requestAnimationFrame(step);
  }

  function applyBattleResult(r) {
    return new Promise(function (resolve) {
      if (!svg || !els[r.from] || !els[r.to]) { resolve(); return; }
      // attacker garrison collapses to 1 — the cost of the assault
      setTerrState(r.from, r.fromAfter.owner, r.fromAfter.value, true);

      if (reducedMotion()) {
        setTerrState(r.to, r.toAfter.owner, r.toAfter.value, false);
        resolve();
        return;
      }

      if (r.won) {
        radialWipe(r.to, r.attackerColor || colorOf(r.toAfter.owner) || "#ffffff", null);
        // recolor under the wipe just after it starts expanding — the wipe
        // sells the takeover, the fill transition lands beneath it
        setTimeout(function () {
          setTerrState(r.to, r.toAfter.owner, r.toAfter.value, true);
        }, 140);
        setTimeout(resolve, 700);
      } else {
        setTerrState(r.to, r.toAfter.owner, r.toAfter.value, true);
        var p = els[r.to].path;
        p.classList.add("repel-pulse");
        setTimeout(function () { p.classList.remove("repel-pulse"); }, 750);
        setTimeout(resolve, 600);
      }
    });
  }

  function dealOutAnimation(territories, seatMeta) {
    return new Promise(function (resolve) {
      if (!svg) { resolve(); return; }
      if (seatMeta) cur.seatMeta = seatMeta;
      var ids = map.territories.map(function (t) { return t.id; });

      if (reducedMotion()) {
        ids.forEach(function (id) {
          var st = territories[id];
          if (st) setTerrState(id, st.owner, st.value, false);
        });
        resolve();
        return;
      }

      ids.forEach(function (id, i) {
        setTimeout(function () {
          var st = territories[id];
          if (!st || !els[id]) return;
          setTerrState(id, st.owner, st.value, false);
          els[id].path.classList.add("deal-pop");
          els[id].badgeInner.classList.add("badge-pop");
        }, i * STAGGER_MS);
      });
      setTimeout(function () {
        ids.forEach(function (id) {
          if (!els[id]) return;
          els[id].path.classList.remove("deal-pop");
          els[id].badgeInner.classList.remove("badge-pop");
        });
        resolve();
      }, ids.length * STAGGER_MS + 480);
    });
  }

  // ---- lobby mini preview ---------------------------------------------------------

  function miniPreview(mapData, w, h) {
    var s = mk("svg", {
      "class": "map-mini",
      viewBox: mapData.viewBox.x + " " + mapData.viewBox.y + " " + mapData.viewBox.w + " " + mapData.viewBox.h,
      width: w,
      height: h,
      preserveAspectRatio: "xMidYMid meet"
    });
    buildDecor(mk("g", null, s), mapData);
    var g = mk("g", null, s);
    mapData.territories.forEach(function (t) {
      mk("path", { d: t.path, "class": "mini-terr" }, g);
    });
    buildLinks(mk("g", null, s), mapData);
    return s;
  }

  // ---- export ----------------------------------------------------------------------

  var API = {
    init: init,
    setState: setState,
    setInteractive: setInteractive,
    onTerritoryClick: onTerritoryClick,
    onTerritoryHover: onTerritoryHover,
    highlightSeat: highlightSeat,
    highlightSeats: highlightSeats,
    flashTerritory: flashTerritory,
    applyBattleResult: applyBattleResult,
    dealOutAnimation: dealOutAnimation,
    fit: fit,
    miniPreview: miniPreview
  };

  if (typeof window !== "undefined") window.Renderer = API;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      __test: { fillFor: fillFor, badgeRadius: badgeRadius, linkPathD: linkPathD }
    };
  }
})();

/*
 * UI — the orchestrator of the Midnight War Room.
 * Owns: screen routing, landing/lobby/game/ceremony/scoreboard chrome, the
 * capture flow, diplomacy sheet, dispatches inbox, battle log, toasts,
 * tooltips, modals, settings, reconnect scrim, title-flash notifications.
 *
 * Division of labor (pinned contract):
 *   - ui.js is the ONLY module that talks to both Net/Game AND Renderer/
 *     Battle/Anim/Sound. FX modules never call Net or Game.
 *   - on attack_resolved: update the Game mirror, hand the cinematic to
 *     Battle.enqueue — do NOT Renderer.setState (the battle animates it).
 *     After Battle's queue drains, one setState true-up.
 *   - every other state event: Game.applyEvent + Renderer.setState.
 */
(function () {
  "use strict";

  var C = window.AlliancesConst || {};
  var COLORS = C.COLORS || [];
  var METALS = C.METALS || [];
  var MAP_ORDER = ["north-america", "hexfield", "riven-realm"];
  var BASE_TITLE = "Alliances — Forge pacts. Break them.";

  // ---------- tiny DOM helpers ----------
  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function el(tag, cls, html) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  }

  // FX modules are built by another agent against the same contract; guard
  // every call so a partially-integrated build still runs the shell.
  function R() { return window.Renderer || null; }
  function snd(name) {
    try { if (window.Sound && window.Sound.play) window.Sound.play(name); } catch (e) { /* sound is garnish */ }
  }

  // ---------- inline SVG icons (no image assets, ever) ----------
  var SVG_OPEN = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  var ICONS = {
    crown: SVG_OPEN + '<path d="M3 18h18M4 17l-1-9 5 4 4-7 4 7 5-4-1 9z"/></svg>',
    skull: SVG_OPEN + '<path d="M12 2a8 8 0 0 0-8 8c0 3 1.5 5 3 6v3h10v-3c1.5-1 3-3 3-6a8 8 0 0 0-8-8z"/><circle cx="9" cy="11" r="1.3"/><circle cx="15" cy="11" r="1.3"/><path d="M10 19v2M14 19v2"/></svg>',
    pact: SVG_OPEN + '<path d="M11 17l-2 2a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0"/><path d="M13 7l2-2a3 3 0 0 1 4 4l-4 4a3 3 0 0 1-4 0"/></svg>',
    chain: SVG_OPEN + '<path d="M11 17l-2 2a3 3 0 0 1-4-4l2-2"/><path d="M13 7l2-2a3 3 0 0 1 4 4l-2 2"/><path d="M9 9l-1.5-3M15 15l1.5 3M8 13l-3 .5M16 11l3-.5"/></svg>',
    swords: SVG_OPEN + '<path d="M5 4l14 14M19 4L5 18"/><path d="M3 16l5 5M21 16l-5 5"/></svg>',
    envelope: SVG_OPEN + '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
    bot: SVG_OPEN + '<rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 8V4M9 4h6"/><circle cx="9.5" cy="13" r="0.5"/><circle cx="14.5" cy="13" r="0.5"/><path d="M9 16.5h6"/></svg>',
    pencil: SVG_OPEN + '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>',
    info: SVG_OPEN + '<circle cx="12" cy="12" r="10"/><path d="M12 8h.01M12 11v5"/></svg>',
    flag: SVG_OPEN + '<path d="M5 21V4"/><path d="M5 4h13l-2.5 4L18 12H5"/></svg>'
  };

  // ---------- local UI state ----------
  var currentScreen = "screen-landing";
  var prevScreenForScoreboard = "screen-landing";
  var prefs = { name: "", soundOn: true, battleSpeed: "cinematic", quickAttack: false };

  var armedSource = null;        // capture flow: armed territory id
  var armedTargets = [];
  var attackIndexInTurn = 0;     // resets every turn_began; drives Battle pacing
  var battlesPending = 0;        // enqueued battles not yet drained

  var infoDispatches = [];       // informational inbox cards (client-side)
  var dispatchCounter = 0;
  var lastActionableCount = 0;

  var rendererMapId = null;      // which map Renderer.init was last run for
  var lastPointer = { x: 0, y: 0 };
  var lastCounts = {};           // seat -> "terr/force" for the count-pop animation
  var myElimTurn = null;
  var turnStartedAt = 0;
  var standingsAtRoundStart = null; // seat -> rank (for ceremony rank arrows)
  var pendingName = "";          // name sent with create_room (room_created has no state)
  var titleFlashTimer = null;
  var netStatus = "connecting";
  var faviconNormal = null;
  var FAVICON_BADGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%2307090f'/%3E%3Cg stroke='%23f5c84c' stroke-linecap='round' fill='none'%3E%3Cpath d='M19 13 L45 43' stroke-width='5'/%3E%3Cpath d='M45 13 L19 43' stroke-width='5'/%3E%3Cpath d='M14 38 L26 46' stroke-width='4'/%3E%3Cpath d='M50 38 L38 46' stroke-width='4'/%3E%3C/g%3E%3Ccircle cx='48' cy='16' r='12' fill='%23ff4655'/%3E%3C/svg%3E";

  var NAME_ADJ = ["Iron", "Crimson", "Silent", "Golden", "Broken", "Northern", "Shattered", "Eternal", "Midnight", "Thorned", "Burning", "Hollow", "Sworn", "Gilded", "Black", "Storm"];
  var NAME_NOUN = ["Accord", "Pact", "Covenant", "Concord", "League", "Compact", "Union", "Vanguard", "Order", "Coalition", "Front", "Circle", "Crown", "Oath", "Banner", "Court"];

  var REJECT_COPY = {
    NOT_YOUR_TURN: "Not your turn.",
    ATTACK_LIMIT: "All 3 attacks launched this turn.",
    ENVOY_OUT: "Your armies hold while your offer is out — rescind it or await the answer.",
    TARGET_IS_ALLY: "They are your ally. Defect first if you must.",
    OFFER_RESOLVED: "That offer was already resolved.",
    NOT_ADJACENT: "Those territories do not share a border.",
    TOO_WEAK: "You need at least 2 force to attack.",
    NOT_YOURS: "You do not control that territory.",
    OWN_TERRITORY: "That territory is already yours.",
    SELF_TARGET: "You cannot target yourself.",
    JOIN_USED: "Join action already used this turn.",
    DEFECT_USED: "You already defected this turn.",
    ALREADY_IN_ALLIANCE: "You are already in an alliance.",
    NOT_MEMBER: "You are not in that alliance.",
    PENDING_OFFER_EXISTS: "You already have a pending offer. Rescind it first.",
    RENAME_PENDING: "A rename proposal is already pending for this alliance.",
    NOT_HOST: "Only the host can do that.",
    BAD_PHASE: "You cannot do that right now.",
    ROOM_NOT_READY: "All seats must be filled to start.",
    PLAYER_COUNT_LOCKED: "Player count is locked once the first round has been fought.",
    TARGET_IN_ALLIANCE: "They are already in an alliance.",
    TARGET_ELIMINATED: "That commander has fallen.",
    ELIMINATED: "You have fallen — spectators cannot act.",
    VALVE_CLOSED: "Conditions for that are not met yet."
  };

  var JOIN_FAIL_COPY = {
    ROOM_NOT_FOUND: "No war room with that code.",
    ROOM_FULL: "That war room is full.",
    GAME_IN_PROGRESS: "That war is already underway.",
    BAD_TOKEN: "Your session expired.",
    CODE_NOT_FOUND: "No commander with that code — personal codes are shown in your game's lobby and settings.",
    NAME_TAKEN: "That name is already taken in this room."
  };

  // ---------- toasts ----------
  function toast(msg, type, ms) {
    var root = $("toast-root");
    if (!root) return;
    var node = el("div", "toast toast-" + (type || "info"), msg);
    root.appendChild(node);
    while (root.children.length > 4) root.removeChild(root.firstChild);
    setTimeout(function () {
      node.classList.add("out");
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 320);
    }, ms || 3800);
  }

  // ---------- tooltip ----------
  var tipNode = null;
  function showTipAt(html, x, y) {
    hideTip();
    tipNode = el("div", "tooltip", html);
    $("tooltip-root").appendChild(tipNode);
    var rect = tipNode.getBoundingClientRect();
    var left = Math.min(Math.max(8, x - rect.width / 2), window.innerWidth - rect.width - 8);
    var top = y - rect.height - 12;
    if (top < 8) top = y + 18;
    tipNode.style.left = left + "px";
    tipNode.style.top = top + "px";
  }
  function hideTip() {
    if (tipNode && tipNode.parentNode) tipNode.parentNode.removeChild(tipNode);
    tipNode = null;
  }

  function bindTooltips() {
    document.addEventListener("mouseover", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-tip]") : null;
      if (!t) return;
      var text = t.getAttribute("data-tip");
      if (!text) return;
      var r = t.getBoundingClientRect();
      showTipAt(text, r.left + r.width / 2, r.top);
    });
    document.addEventListener("mouseout", function (e) {
      if (e.target && e.target.closest && e.target.closest("[data-tip]")) hideTip();
    });
    document.addEventListener("mousemove", function (e) {
      lastPointer.x = e.clientX;
      lastPointer.y = e.clientY;
    }, { passive: true });
  }

  // ---------- modal ----------
  var modalClose = null;
  function openModal(opts) {
    closeModal();
    var root = $("modal-root");
    root.classList.remove("hidden");
    var box = el("div", "modal");
    if (opts.title) box.appendChild(el("h3", "modal-title", esc(opts.title)));
    var body = el("div", "modal-body");
    if (opts.bodyHtml) body.innerHTML = opts.bodyHtml;
    if (opts.buildBody) opts.buildBody(body);
    box.appendChild(body);
    var actions = el("div", "modal-actions");
    (opts.actions || []).forEach(function (a) {
      var b = el("button", "btn " + (a.cls || ""), esc(a.label));
      b.addEventListener("click", function () {
        if (a.cb) a.cb();
        if (!a.keepOpen) closeModal();
      });
      actions.appendChild(b);
    });
    box.appendChild(actions);
    root.innerHTML = "";
    root.appendChild(box);
    var backdropHandler = function (e) { if (e.target === root && opts.dismissable !== false) closeModal(); };
    root.addEventListener("click", backdropHandler);
    modalClose = function () {
      root.removeEventListener("click", backdropHandler);
      root.classList.add("hidden");
      root.innerHTML = "";
      modalClose = null;
    };
    return modalClose;
  }
  function closeModal() { if (modalClose) modalClose(); }

  function confirmModal(title, bodyHtml, confirmLabel, confirmCls, onConfirm) {
    openModal({
      title: title,
      bodyHtml: bodyHtml,
      actions: [
        { label: "CANCEL", cls: "btn-outline" },
        { label: confirmLabel, cls: confirmCls || "btn-command", cb: onConfirm }
      ]
    });
  }

  // ---------- screen router ----------
  function showScreen(id) {
    if (currentScreen === id) return;
    if (id === "screen-scoreboard") prevScreenForScoreboard = currentScreen;
    currentScreen = id;
    var screens = document.querySelectorAll(".screen");
    for (var i = 0; i < screens.length; i++) screens[i].classList.remove("active");
    var node = $(id);
    if (node) node.classList.add("active");
    hideTip();
    hideAttackConfirm();
    closeFlyout();
  }

  // ---------- formatting helpers ----------
  function seatColor(seat) {
    var p = window.Game && Game.player ? Game.player(seat) : null;
    var idx = p && typeof p.colorIndex === "number" ? p.colorIndex : seat;
    return COLORS[idx] || "#8a93a8";
  }
  function seatName(seat) {
    var p = window.Game && Game.player(seat);
    return p ? p.name : "Seat " + seat;
  }
  function mapTerr(id) {
    var m = window.Game && Game.map;
    if (!m) return null;
    for (var i = 0; i < m.territories.length; i++) {
      if (m.territories[i].id === id) return m.territories[i];
    }
    return null;
  }
  function terrName(id) {
    var t = mapTerr(id);
    return t ? t.name : id;
  }
  function metalFor(alliance) {
    if (!alliance) return METALS[0] || { color: "#f5c84c", sigil: "*" };
    var idx = (typeof alliance.metalIndex === "number") ? alliance.metalIndex : 0;
    return METALS[idx % METALS.length] || METALS[0];
  }
  function allianceLabel(allianceId) {
    var s = Game.state;
    var a = s && s.round && s.round.alliances ? s.round.alliances[allianceId] : null;
    return a ? a.name : "an alliance";
  }
  function nameSpan(seat) {
    return '<b style="color:' + seatColor(seat) + '">' + esc(seatName(seat)) + "</b>";
  }

  function suggestPactName() {
    for (var tries = 0; tries < 10; tries++) {
      var n = "The " + NAME_ADJ[Math.floor(Math.random() * NAME_ADJ.length)] + " " +
        NAME_NOUN[Math.floor(Math.random() * NAME_NOUN.length)];
      if (n.length <= (C.MAX_ALLIANCE_NAME_LEN || 24)) return n;
    }
    return "The Iron Pact";
  }

  // ---------- title flash + favicon badge ----------
  function flashTitle(msg) {
    if (!document.hidden) return;
    clearTitleFlash(false);
    var on = true;
    document.title = msg;
    var fav = $("favicon");
    if (fav) fav.setAttribute("href", FAVICON_BADGE);
    titleFlashTimer = setInterval(function () {
      on = !on;
      document.title = on ? msg : BASE_TITLE;
    }, 1100);
  }
  function clearTitleFlash(restoreFav) {
    if (titleFlashTimer) { clearInterval(titleFlashTimer); titleFlashTimer = null; }
    document.title = BASE_TITLE;
    if (restoreFav !== false) {
      var fav = $("favicon");
      if (fav && faviconNormal) fav.setAttribute("href", faviconNormal);
    }
  }

  // ---------- seat meta for the renderer ----------
  function buildSeatMeta() {
    var s = Game.state;
    var meta = [];
    if (!s) return meta;
    (s.players || []).forEach(function (p) {
      var m = { color: seatColor(p.seat), allianceMetal: null, eliminated: !!p.eliminated };
      if (p.allianceId && s.round && s.round.alliances && s.round.alliances[p.allianceId]) {
        var metal = metalFor(s.round.alliances[p.allianceId]);
        m.allianceMetal = { id: metal.id, color: metal.color, sigil: metal.sigil };
      }
      meta[p.seat] = m;
    });
    return meta;
  }

  function syncMapState() {
    var r = R();
    var s = Game.state;
    if (!r || !s || !s.round) return;
    // While battles are animating, the queue-drained true-up owns setState —
    // a mid-queue sync would pre-empt the cinematic's reveal.
    if (battlesPending > 0) return;
    r.setState(s.round.territories, buildSeatMeta());
  }

  function updateInteractive() {
    var r = R();
    if (!r) return;
    var s = Game.state;
    if (!s || s.phase !== "playing" || !Game.isMyTurn()) {
      r.setInteractive(null);
      return;
    }
    // Out of attacks, or an envoy is out: the map goes inert for capturing.
    if ((s.round.turn.attacksMade || 0) >= 3 || myPendingOutgoingOffer()) {
      r.setInteractive(null);
      return;
    }
    r.setInteractive({
      sources: Game.legalSources(),
      armed: armedSource,
      targets: armedSource ? armedTargets : []
    });
  }

  function ensureRenderer(withDeal) {
    var r = R();
    var map = Game.map;
    var s = Game.state;
    if (!r || !map || !s || !s.round) return Promise.resolve();
    var container = $("map-container");
    if (rendererMapId !== map.id) {
      r.init(container, map);
      rendererMapId = map.id;
      r.onTerritoryClick(onTerritoryClick);
      r.onTerritoryHover(onTerritoryHover);
    }
    var meta = buildSeatMeta();
    if (withDeal && r.dealOutAnimation) {
      return r.dealOutAnimation(s.round.territories, meta).then(function () {
        syncMapState();
        updateInteractive();
      });
    }
    syncMapState();
    updateInteractive();
    return Promise.resolve();
  }

  // ---------- edge glow ----------
  function syncEdgeGlow() {
    var glow = $("edge-glow");
    var s = Game.state;
    if (!glow) return;
    if (!s || s.phase !== "playing" || !s.round || !s.round.turn) {
      glow.classList.remove("on", "mine");
      return;
    }
    var seat = s.round.turn.seat;
    document.documentElement.style.setProperty("--active-color", seatColor(seat));
    glow.classList.add("on");
    glow.classList.toggle("mine", Game.isMyTurn());
  }

  // ============================================================
  // CAPTURE FLOW
  // ============================================================
  function arm(id) {
    armedSource = id;
    armedTargets = Game.targetsFor(id);
    updateInteractive();
    snd("click");
  }

  function disarm() {
    armedSource = null;
    armedTargets = [];
    hideAttackConfirm();
    updateInteractive();
  }

  function onTerritoryClick(id) {
    hideAttackConfirm();
    var s = Game.state;
    if (!s || s.phase !== "playing") return;
    if (!Game.isMyTurn()) return;
    if (armedSource) {
      if (id === armedSource) { disarm(); return; }
      if (armedTargets.indexOf(id) >= 0) { beginAttackConfirm(id); return; }
      if (Game.legalSources().indexOf(id) >= 0) { arm(id); return; }
      disarm();
      return;
    }
    if (Game.legalSources().indexOf(id) >= 0) arm(id);
  }

  function onTerritoryHover(id) {
    if (!id) { hideTip(); return; }
    var s = Game.state;
    if (!s || !s.round) return;
    var t = s.round.territories[id];
    if (!t) return;
    var ownerHtml = (t.owner == null) ? '<span class="tt-dim">unclaimed</span>' : nameSpan(t.owner);
    var html = "<b>" + esc(terrName(id)) + "</b><br>" + ownerHtml +
      ' <span class="tt-dim">&middot; force ' + t.value + "</span>";
    if (armedSource && armedTargets.indexOf(id) >= 0) {
      var from = s.round.territories[armedSource];
      var odds = Game.attackOdds(from.value - 1, t.value);
      html += '<br><span class="tt-dim">' + (from.value - 1) + " dice vs " + t.value + " — " + odds + "</span>";
    }
    showTipAt(html, lastPointer.x, lastPointer.y - 6);
  }

  function beginAttackConfirm(targetId) {
    var s = Game.state;
    var from = s.round.territories[armedSource];
    var to = s.round.territories[targetId];
    if (!from || !to) return;
    var aDice = from.value - 1, dDice = to.value;
    if (prefs.quickAttack) { sendAttack(targetId); return; }

    var box = $("attack-confirm");
    var odds = Game.attackOdds(aDice, dDice);
    box.innerHTML =
      '<div class="ac-line">' + aDice + " DICE VS " + dDice +
      ' <span class="ac-odds ' + odds + '">' + odds.toUpperCase() + "</span></div>" +
      '<div class="ac-route">' + esc(terrName(armedSource)) + " &rarr; " + esc(terrName(targetId)) + "</div>" +
      '<div class="ac-buttons">' +
      '<button id="ac-go" class="btn btn-command btn-sm">ATTACK</button>' +
      '<button id="ac-cancel" class="btn btn-outline btn-sm">CANCEL</button></div>';
    box.classList.remove("hidden");
    // anchor near the click, clamped to the viewport
    var w = box.offsetWidth, h = box.offsetHeight;
    var x = Math.min(Math.max(8, lastPointer.x - w / 2), window.innerWidth - w - 8);
    var y = lastPointer.y - h - 16;
    if (y < 60) y = lastPointer.y + 18;
    box.style.left = x + "px";
    box.style.top = y + "px";
    $("ac-go").addEventListener("click", function () { sendAttack(targetId); });
    $("ac-cancel").addEventListener("click", function () { hideAttackConfirm(); });
  }

  function hideAttackConfirm() {
    var box = $("attack-confirm");
    if (box) box.classList.add("hidden");
  }

  var reqCounter = 0;
  function sendAttack(targetId) {
    hideAttackConfirm();
    if (!armedSource) return;
    Net.send("attack", { from: armedSource, to: targetId }, "r" + (++reqCounter));
    // Disarm; the map unlocks the moment the verdict lands (attack_resolved
    // recomputes legality — the source just dropped to 1).
    armedSource = null;
    armedTargets = [];
    updateInteractive();
  }

  // ============================================================
  // BATTLE QUEUE
  // ============================================================
  function enqueueBattle(d) {
    attackIndexInTurn++;
    var payload = {};
    for (var k in d) payload[k] = d[k];
    payload.attackerName = seatName(d.attackerSeat);
    payload.defenderName = seatName(d.defenderSeat);
    payload.attackerColor = seatColor(d.attackerSeat);
    payload.defenderColor = seatColor(d.defenderSeat);
    payload.fromName = terrName(d.from);
    payload.toName = terrName(d.to);
    payload.attackIndexInTurn = attackIndexInTurn;

    if (window.Battle && window.Battle.enqueue) {
      battlesPending++;
      window.Battle.enqueue(payload);
      return;
    }
    // Graceful degradation if the FX module is absent: badge animation only.
    var r = R();
    if (r && r.applyBattleResult) {
      battlesPending++;
      r.applyBattleResult({
        from: d.from, to: d.to, fromAfter: d.fromAfter, toAfter: d.toAfter,
        won: d.won, attackerColor: seatColor(d.attackerSeat)
      }).then(afterBattlesDrained, afterBattlesDrained);
    } else {
      afterBattlesDrained();
    }
  }

  function afterBattlesDrained() {
    battlesPending = 0;
    syncMapState();
    updateInteractive();
    renderGame();
  }

  // ============================================================
  // GAME SCREEN RENDERING
  // ============================================================
  function renderGame() {
    var s = Game.state;
    if (!s || !s.round) return;
    renderBanner();
    renderActionBar();
    renderRoster();
    renderDispatches();
    renderLog();
    renderPendingChip();
    renderSpectator();
    updateForceEnd();
  }

  function renderBanner() {
    var s = Game.state;
    var turn = s.round.turn || { seat: 0, turnNumber: 1 };
    $("tb-turn").textContent = "TURN " + (turn.turnNumber || 1);
    $("tb-name").textContent = seatName(turn.seat) + (Game.isMyTurn() ? " (YOU)" : "");
    $("tb-player").classList.toggle("my-turn", Game.isMyTurn());
    var dot = $("tb-dot");
    dot.style.background = seatColor(turn.seat);
    dot.style.boxShadow = "0 0 10px " + seatColor(turn.seat);
    $("tb-room").textContent = s.roomCode || "";

    var chipJoin = $("chip-join"), chipDefect = $("chip-defect"), chipCombat = $("chip-combat");
    var made = turn.attacksMade || 0;
    var envoyOut = turn.seat === Game.mySeat ? !!myPendingOutgoingOffer() : false;
    chipJoin.classList.toggle("locked", !!turn.hasJoined);
    chipJoin.setAttribute("data-tip", turn.hasJoined
      ? "Join action used this turn (a rescind refunds it)."
      : "Join action available — any time during the turn.");
    chipDefect.classList.toggle("locked", !!turn.hasDefected);
    chipDefect.setAttribute("data-tip", turn.hasDefected
      ? "Defect action used this turn."
      : "Defect action available — any time during the turn.");
    chipCombat.textContent = "⚔ " + made + "/3";
    chipCombat.classList.toggle("engaged", made > 0 && made < 3);
    chipCombat.classList.toggle("locked", made >= 3 || envoyOut);
    chipCombat.setAttribute("data-tip", made >= 3 ? "All 3 attacks launched this turn."
      : envoyOut ? "Armies holding — your alliance offer is still out."
      : made + " of 3 attacks launched this turn.");
  }

  function myPendingOutgoingOffer() {
    var s = Game.state;
    if (!s || !s.round || !s.round.offers) return null;
    for (var id in s.round.offers) {
      var o = s.round.offers[id];
      if (o && o.from === Game.mySeat && o.status === "pending" && o.kind !== "rename") return o;
    }
    return null;
  }

  function singlesAvailable() {
    var s = Game.state;
    return (s.players || []).filter(function (p) {
      return !p.eliminated && !p.allianceId && p.seat !== Game.mySeat;
    });
  }

  function alliancesAvailable() {
    var s = Game.state;
    var out = [];
    if (s.round && s.round.alliances) {
      for (var id in s.round.alliances) out.push(s.round.alliances[id]);
    }
    return out;
  }

  function joinDisabledReason() {
    var s = Game.state;
    var me = Game.player(Game.mySeat);
    var turn = s.round.turn;
    if (me && me.allianceId) return "You are already in an alliance — defect first.";
    if (myPendingOutgoingOffer()) return "You have a pending offer. Rescind it to court someone else.";
    if (turn.hasJoined) return "Join action already used this turn.";
    if (!singlesAvailable().length && !alliancesAvailable().length) return "No one to court — no free agents or alliances remain.";
    return null;
  }

  function defectDisabledReason() {
    var me = Game.player(Game.mySeat);
    var turn = Game.state.round.turn;
    if (!me || !me.allianceId) return "You are not in an alliance.";
    if (turn.hasDefected) return "You already defected this turn.";
    return null;
  }

  function captureDisabledReason() {
    var turn = Game.state.round.turn;
    if ((turn.attacksMade || 0) >= 3) return "All 3 attacks launched this turn.";
    if (myPendingOutgoingOffer()) return "Your armies hold while your offer is out — rescind it or await the answer.";
    if (!Game.legalSources().length) return "No territory with 2+ force borders an enemy.";
    return null;
  }

  function setAbButton(wrapId, btnId, reason, enabledTip) {
    var wrap = $(wrapId), btn = $(btnId);
    btn.disabled = !!reason;
    wrap.setAttribute("data-tip", reason || enabledTip || "");
  }

  function renderActionBar() {
    var s = Game.state;
    var me = Game.player(Game.mySeat);
    var buttons = $("ab-buttons"), offturn = $("ab-offturn");
    var eliminated = me && me.eliminated;

    if (s.phase !== "playing" || !s.round.turn) {
      buttons.classList.add("hidden");
      offturn.classList.add("hidden");
      return;
    }

    if (!Game.isMyTurn()) {
      buttons.classList.add("hidden");
      offturn.classList.remove("hidden");
      var seat = s.round.turn.seat;
      offturn.innerHTML = '<i class="seat-dot" style="background:' + seatColor(seat) +
        ";box-shadow:0 0 10px " + seatColor(seat) + '"></i>' +
        (eliminated ? esc(seatName(seat)) + " is moving&hellip;"
          : esc(seatName(seat)) + " is moving&hellip; <span style=\"color:var(--text-dim)\">dispatches stay open</span>");
      return;
    }

    buttons.classList.remove("hidden");
    offturn.classList.add("hidden");
    setAbButton("wrap-join", "btn-action-join", joinDisabledReason(),
      "Open the diplomacy sheet — propose a pact or request to join one.");
    setAbButton("wrap-defect", "btn-action-defect", defectDisabledReason(),
      "Abandon your alliance. Your allies will be notified.");
    setAbButton("wrap-capture", "btn-action-capture", captureDisabledReason(),
      "Click one of your glowing territories, then a red-rimmed target.");
    setAbButton("wrap-end", "btn-action-end", null, "End your turn and pass command.");
  }

  function renderRoster() {
    var s = Game.state;
    var rail = $("roster-rail");
    rail.innerHTML = "";
    var turnSeat = s.round.turn ? s.round.turn.seat : -1;
    var counts = {};
    var terr = s.round.territories;
    for (var id in terr) {
      var t = terr[id];
      if (t.owner == null) continue;
      counts[t.owner] = counts[t.owner] || { n: 0, f: 0 };
      counts[t.owner].n++;
      counts[t.owner].f += t.value;
    }

    // Turn order is shuffled fresh each round — the little badge keeps it legible.
    var turnOrder = (s.round.turnOrder || []).slice();
    function orderPos(seat) {
      var i = turnOrder.indexOf(seat);
      return i === -1 ? 99 : i;
    }

    function playerCard(p) {
      var card = el("div", "roster-card");
      card.style.setProperty("--seat-color", seatColor(p.seat));
      if (p.seat === turnSeat) card.classList.add("active-turn");
      if (!p.connected) card.classList.add("disconnected");
      if (p.eliminated) card.classList.add("eliminated");
      var c = counts[p.seat] || { n: 0, f: 0 };
      var key = c.n + "/" + c.f;
      var pop = lastCounts[p.seat] && lastCounts[p.seat] !== key;
      lastCounts[p.seat] = key;
      var pos = orderPos(p.seat);
      var nameBits = (pos < 99 ? '<span class="rc-order" data-tip="Turn order this round">' + (pos + 1) + "</span> " : "") + esc(p.name);
      if (p.seat === s.hostSeat) nameBits += ' <span class="crown" data-tip="Host">' + ICONS.crown + "</span>";
      if (p.seat === Game.mySeat) nameBits += ' <span class="you-tag">YOU</span>';
      var popCls = pop ? "count-pop" : "";
      card.innerHTML =
        '<div class="rc-main"><div class="rc-name">' + nameBits + "</div>" +
        '<div class="rc-counts"><b class="' + popCls + '">' + c.n + '</b> terr &middot; <b class="' +
        popCls + '">' + c.f + "</b> force</div></div>" +
        (p.eliminated ? '<span class="rc-skull" data-tip="Eliminated">' + ICONS.skull + "</span>"
          : p.isBot ? '<span class="bot-chip" data-tip="AI commander">' + ICONS.bot + "</span>"
          : '<span class="presence-dot ' + (p.connected ? "" : "off") + '" data-tip="' +
            (p.connected ? "Connected" : "Connection lost") + '"></span>');
      card.addEventListener("mouseenter", function () { var r = R(); if (r) r.highlightSeat(p.seat); });
      card.addEventListener("mouseleave", function () { var r = R(); if (r) r.highlightSeat(null); });
      return card;
    }

    // alliance blocs first (metal-trimmed brackets), then free agents
    var alliances = alliancesAvailable().sort(function (a, b) {
      return (a.metalIndex || 0) - (b.metalIndex || 0);
    });
    var inBloc = {};
    alliances.forEach(function (a) {
      var metal = metalFor(a);
      var bloc = el("div", "roster-bloc");
      bloc.style.setProperty("--metal-color", metal.color);
      var head = el("div", "bloc-head");
      var pendingRename = pendingRenameFor(a.id);
      head.innerHTML = '<span class="bloc-sigil">' + esc(metal.sigil) + '</span>' +
        '<span class="bloc-name">' + esc(a.name) + "</span>";
      if ((a.members || []).indexOf(Game.mySeat) >= 0) {
        var pencil = el("button", "bloc-pencil", ICONS.pencil);
        pencil.disabled = !!pendingRename;
        pencil.setAttribute("data-tip", pendingRename ? "A rename is already pending for this alliance."
          : "Propose a new name (all members must approve).");
        pencil.addEventListener("click", function (e) { e.stopPropagation(); openRenameModal(a.id); });
        head.appendChild(pencil);
      }
      head.addEventListener("mouseenter", function () { var r = R(); if (r) r.highlightSeats(a.members || []); });
      head.addEventListener("mouseleave", function () { var r = R(); if (r) r.highlightSeats(null); });
      bloc.appendChild(head);
      if (pendingRename) {
        var appr = offerApprovals(pendingRename);
        bloc.appendChild(el("div", "bloc-rename-strip",
          'Rename &rarr; &ldquo;' + esc(pendingRename.proposedName || "") + "&rdquo; (" + appr.approved + "/" + appr.total + ")"));
      }
      (a.members || []).slice().sort(function (x, y) { return orderPos(x) - orderPos(y); })
        .forEach(function (seat) {
          var p = Game.player(seat);
          if (!p) return;
          inBloc[seat] = true;
          bloc.appendChild(playerCard(p));
        });
      rail.appendChild(bloc);
    });

    (s.players || []).slice().sort(function (x, y) { return orderPos(x.seat) - orderPos(y.seat); })
      .forEach(function (p) {
        if (inBloc[p.seat]) return;
        rail.appendChild(playerCard(p));
      });
  }

  function pendingRenameFor(allianceId) {
    var s = Game.state;
    if (!s.round || !s.round.offers) return null;
    for (var id in s.round.offers) {
      var o = s.round.offers[id];
      if (o && o.kind === "rename" && o.allianceId === allianceId && o.status === "pending") return o;
    }
    return null;
  }

  function offerApprovals(o) {
    var total = (o.to && o.to.length) || 0;
    var approved = 0;
    if (o.responses) {
      if (Object.prototype.toString.call(o.responses) === "[object Array]") {
        o.responses.forEach(function (r) { if (r && (r.accept === true || r === true)) approved++; });
      } else {
        for (var k in o.responses) { if (o.responses[k] === true || (o.responses[k] && o.responses[k].accept === true)) approved++; }
      }
    }
    return { approved: approved, total: total };
  }

  // ---------- everyone-alliance warning ----------
  function factionOf(seat) {
    var a = Game.allianceOf(seat);
    return a ? (a.members || [seat]).slice() : [seat];
  }

  function wouldUniteAll(offer) {
    var alive = Game.aliveSeats();
    if (alive.length < 2) return false;
    var union = {};
    factionOf(offer.from).forEach(function (x) { union[x] = true; });
    if (offer.kind === "make_alliance") {
      (offer.to || []).forEach(function (seat) {
        factionOf(seat).forEach(function (x) { union[x] = true; });
      });
    } else if (offer.kind === "join_alliance") {
      var s = Game.state;
      var a = s.round && s.round.alliances ? s.round.alliances[offer.allianceId] : null;
      ((a && a.members) || []).forEach(function (x) { union[x] = true; });
    } else {
      return false;
    }
    for (var i = 0; i < alive.length; i++) {
      if (!union[alive[i]]) return false;
    }
    return true;
  }

  var UNITE_ALL_WARNING = "Forming this pact ends the round immediately in shared victory.";

  // ---------- dispatches ----------
  function addInfo(iconKey, html, cls) {
    infoDispatches.unshift({
      id: "i" + (++dispatchCounter), t: Date.now(),
      icon: ICONS[iconKey] || ICONS.info, html: html, cls: cls || ""
    });
    if (infoDispatches.length > 40) infoDispatches.length = 40;
    if (currentScreen === "screen-game") renderDispatches();
  }

  function actionableOffers() {
    var s = Game.state;
    var out = [];
    if (!s || !s.round || !s.round.offers) return out;
    for (var id in s.round.offers) {
      var o = s.round.offers[id];
      if (!o || o.status !== "pending") continue;
      if (o.from === Game.mySeat) continue;
      if (!o.to || o.to.indexOf(Game.mySeat) < 0) continue;
      // already answered? (responses keyed by seat)
      var mine = o.responses ? o.responses[Game.mySeat] : undefined;
      if (mine === undefined && o.responses) mine = o.responses[String(Game.mySeat)];
      if (mine !== undefined && mine !== null) continue;
      out.push(o);
    }
    return out;
  }

  function fmtClock(t) {
    var d = new Date(t);
    var h = d.getHours(), m = d.getMinutes();
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }

  function renderDispatches() {
    var list = $("dispatch-list");
    if (!list) return;
    list.innerHTML = "";
    var actionable = actionableOffers();

    actionable.forEach(function (o) {
      var card = el("div", "dispatch-card actionable");
      var kindLabel, text, warn = "";
      if (o.kind === "make_alliance") {
        kindLabel = "PACT OFFER";
        text = nameSpan(o.from) + " proposes a pact: <b>&ldquo;" + esc(o.proposedName || "Alliance") + "&rdquo;</b>";
      } else if (o.kind === "join_alliance") {
        kindLabel = "JOIN REQUEST";
        var appr = offerApprovals(o);
        text = nameSpan(o.from) + " requests to join <b>" + esc(allianceLabel(o.allianceId)) + "</b>" +
          '<div class="dc-ticks">All ' + appr.total + " must approve &middot; " + appr.approved + "/" + appr.total + " so far</div>";
      } else if (o.kind === "rename") {
        kindLabel = "RENAME PROPOSAL";
        text = nameSpan(o.from) + " proposes renaming <b>" + esc(allianceLabel(o.allianceId)) +
          "</b> to <b>&ldquo;" + esc(o.proposedName || "") + "&rdquo;</b>";
      } else {
        kindLabel = "DISPATCH";
        text = "An offer awaits your answer.";
      }
      if (o.kind !== "rename" && wouldUniteAll(o)) {
        warn = '<div class="dc-warn">' + UNITE_ALL_WARNING + "</div>";
        card.classList.add("warning-card");
      }
      // Turn-bound expiry: make/join offers die when the offerer attacks or
      // ends their turn — tell the recipient the clock is real.
      var expiry = o.kind === "rename" ? "" :
        '<div class="dc-expiry">Expires if ' + esc(seatName(o.from)) + " attacks or ends their turn.</div>";
      card.innerHTML =
        '<div class="dc-head"><span class="dc-icon">' + ICONS.envelope + '</span>' +
        '<span class="dc-kind">' + kindLabel + '</span><span class="dc-time">' + fmtClock(o.t || Date.now()) + "</span></div>" +
        '<div class="dc-text">' + text + "</div>" + expiry + warn +
        '<div class="dc-actions">' +
        '<button class="btn btn-command btn-sm dc-accept">ACCEPT</button>' +
        '<button class="btn btn-outline btn-sm dc-decline">DECLINE</button></div>';
      card.querySelector(".dc-accept").addEventListener("click", function () {
        Net.send("respond_offer", { offerId: o.id, accept: true }, "r" + (++reqCounter));
      });
      card.querySelector(".dc-decline").addEventListener("click", function () {
        Net.send("respond_offer", { offerId: o.id, accept: false }, "r" + (++reqCounter));
      });
      list.appendChild(card);
    });

    infoDispatches.forEach(function (d) {
      var card = el("div", "dispatch-card " + d.cls);
      card.innerHTML =
        '<div class="dc-head"><span class="dc-icon dim">' + d.icon + '</span>' +
        '<span class="dc-kind">INTEL</span><span class="dc-time">' + fmtClock(d.t) + "</span></div>" +
        '<div class="dc-text">' + d.html + "</div>";
      list.appendChild(card);
    });

    if (!list.children.length) {
      list.appendChild(el("div", "rail-empty", "No dispatches. The wire is quiet&hellip; for now."));
    }

    // badge bookkeeping
    var badge = $("dispatch-badge");
    var dot = $("rail-toggle-badge");
    if (actionable.length > 0) {
      badge.textContent = actionable.length;
      badge.classList.remove("hidden");
      if (dot) dot.classList.remove("hidden");
      if (actionable.length > lastActionableCount) {
        badge.classList.remove("ping");
        void badge.offsetWidth; // restart the ping animation
        badge.classList.add("ping");
      }
    } else {
      badge.classList.add("hidden");
      if (dot) dot.classList.add("hidden");
    }
    lastActionableCount = actionable.length;
  }

  // ---------- battle log ----------
  function renderLog() {
    var list = $("log-list");
    if (!list) return;
    var s = Game.state;
    list.innerHTML = "";
    if (!s || !s.log || !s.log.length) {
      list.appendChild(el("div", "rail-empty", "The war has no history yet."));
      return;
    }
    for (var i = s.log.length - 1; i >= 0; i--) {
      var node = logEntryNode(s.log[i]);
      if (node) list.appendChild(node);
    }
  }

  // Live attack_resolved events carry full dice ARRAYS; snapshot log entries carry
  // dice COUNTS. Totals sit at top level (attackerTotal) with a legacy fallback.
  function battleTotals(d) {
    return {
      a: d.attackerTotal != null ? d.attackerTotal : (d.totals ? d.totals.attacker : "?"),
      b: d.defenderTotal != null ? d.defenderTotal : (d.totals ? d.totals.defender : "?")
    };
  }

  function diceTip(d) {
    var t = battleTotals(d);
    var ad = Array.isArray(d.attackerDice) ? d.attackerDice.join(", ") : (d.attackerDice + " dice");
    var dd = Array.isArray(d.defenderDice) ? d.defenderDice.join(", ") : (d.defenderDice + " dice");
    return "Attacker: " + ad + " = " + t.a + " &middot; Defender: " + dd + " = " + t.b + " (ties defend)";
  }

  function logEntryNode(entry) {
    var d = entry.data || {};
    var node;
    switch (entry.kind) {
      case "turn":
        node = el("div", "log-turn-divider", "TURN " + (d.turnNumber || "") + " &middot; " + esc(seatName(d.seat)));
        return node;
      case "attack":
      case "battle": // server snapshot log kind for the same event
        node = el("div", "log-entry clickable");
        var tot = battleTotals(d);
        var aTot = tot.a;
        var dTot = tot.b;
        if (d.won) {
          node.innerHTML = nameSpan(d.attackerSeat) + ' <span class="lg-cap">captured</span> <b>' +
            esc(terrName(d.to)) + "</b> from " + nameSpan(d.defenderSeat) + " (" + aTot + "&ndash;" + dTot + ")";
        } else {
          node.innerHTML = nameSpan(d.defenderSeat) + ' <span class="lg-rep">repelled</span> ' +
            nameSpan(d.attackerSeat) + " at <b>" + esc(terrName(d.to)) + "</b> (" + aTot + "&ndash;" + dTot + ")";
        }
        node.setAttribute("data-tip", diceTip(d));
        node.addEventListener("click", function () {
          var r = R();
          if (r) { r.flashTerritory(d.from); r.flashTerritory(d.to); }
        });
        return node;
      case "alliance_formed":
      case "formed": // server snapshot log kind
        return el("div", "log-entry", '<span class="lg-gold">Pact sealed:</span> <b>' + esc(d.name || (d.alliance && d.alliance.name) || "") + "</b> &mdash; " +
          ((d.members || (d.alliance && d.alliance.members) || [])).map(function (x) { return esc(seatName(x)); }).join(", "));
      case "member_joined":
      case "joined": // server snapshot log kind
        return el("div", "log-entry", nameSpan(d.seat) + ' <span class="lg-gold">joined</span> <b>' + esc(allianceLabel(d.allianceId)) + "</b>");
      case "defected": // server snapshot log kind (always a defection)
        return el("div", "log-entry", nameSpan(d.seat) + ' <span class="lg-rep">defected from</span> <b>' + esc(allianceLabel(d.allianceId)) + "</b>");
      case "member_left":
        return el("div", "log-entry", nameSpan(d.seat) + ' <span class="lg-rep">' +
          (d.reason === "eliminated" ? "fell out of" : "defected from") + "</span> <b>" + esc(allianceLabel(d.allianceId)) + "</b>");
      case "dissolved":
        return el("div", "log-entry", "<b>" + esc(d.name || "An alliance") + '</b> <span class="lg-warn">dissolved</span>');
      case "renamed":
        // Live entries carry {from, to}; server snapshot entries carry {allianceId, name}.
        if (d.to) return el("div", "log-entry", "<b>" + esc(d.from || "") + '</b> is now <b class="lg-gold">' + esc(d.to) + "</b>");
        return el("div", "log-entry", "<b>" + esc(d.name || allianceLabel(d.allianceId)) + '</b> <span class="lg-gold">&mdash; new banner adopted</span>');
      case "eliminated":
        return el("div", "log-entry", nameSpan(d.seat) + ' was <span class="lg-rep">eliminated</span> on turn ' + (d.turnNumber || entry.turnNumber || "?"));
      case "round_end":
        return el("div", "log-entry", '<span class="lg-gold">The round is over.</span>');
      case "round_start":
        return el("div", "log-turn-divider", "ROUND " + (d.number || "") + " BEGINS");
      default:
        // Unknown server log kinds render as raw intel rather than vanishing.
        var txt = d && d.text ? esc(d.text) : esc(entry.kind || "event");
        return el("div", "log-entry", '<span style="color:var(--text-dim)">' + txt + "</span>");
    }
  }

  // ---------- pending outgoing offer chip ----------
  function renderPendingChip() {
    var chip = $("pending-offer-chip");
    var o = myPendingOutgoingOffer();
    if (!o) { chip.classList.add("hidden"); return; }
    var appr = offerApprovals(o);
    var text;
    if (o.kind === "make_alliance") {
      text = "Pact offered to " + nameSpan((o.to || [])[0]) + ": &ldquo;" + esc(o.proposedName || "") + "&rdquo;";
    } else {
      text = "Join request to <b>" + esc(allianceLabel(o.allianceId)) + "</b>";
    }
    var ticks = "";
    for (var i = 0; i < appr.total; i++) {
      ticks += '<span class="poc-tick ' + (i < appr.approved ? "yes" : "") + '">&#10003;</span>';
    }
    chip.innerHTML = '<span class="poc-text">' + text + "</span>" +
      '<span class="poc-ticks" data-tip="' + appr.approved + "/" + appr.total + ' approved">' + ticks + "</span>" +
      '<button id="poc-rescind" class="btn btn-outline btn-sm" data-tip="Rescinding refunds your join action this turn.">RESCIND</button>';
    chip.classList.remove("hidden");
    $("poc-rescind").addEventListener("click", function () {
      Net.send("rescind_offer", { offerId: o.id }, "r" + (++reqCounter));
    });
  }

  // ---------- spectator ribbon ----------
  function renderSpectator() {
    var ribbon = $("spectator-ribbon");
    var me = Game.player(Game.mySeat);
    var s = Game.state;
    if (!me || !me.eliminated || s.phase !== "playing") {
      ribbon.classList.add("hidden");
      return;
    }
    if (myElimTurn == null && s.log) {
      for (var i = s.log.length - 1; i >= 0; i--) {
        var e = s.log[i];
        if (e.kind === "eliminated" && e.data && e.data.seat === Game.mySeat) {
          myElimTurn = e.data.turnNumber || e.turnNumber;
          break;
        }
      }
    }
    ribbon.innerHTML = "SPECTATING &mdash; YOU FELL ON TURN " + (myElimTurn || "?") +
      '<span class="seg-group" id="spec-speed">' +
      '<button class="seg-btn" data-speed="cinematic">CINE</button>' +
      '<button class="seg-btn" data-speed="brisk">BRISK</button>' +
      '<button class="seg-btn" data-speed="instant">SKIP</button></span>';
    ribbon.classList.remove("hidden");
    bindSpeedGroup($("spec-speed"));
  }

  function bindSpeedGroup(group) {
    if (!group) return;
    var btns = group.querySelectorAll(".seg-btn");
    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        b.classList.toggle("active", b.getAttribute("data-speed") === prefs.battleSpeed);
        b.addEventListener("click", function () {
          prefs = window.Save.patchPrefs({ battleSpeed: b.getAttribute("data-speed") });
          syncSettingsUI();
          renderSpectator();
        });
      })(btns[i]);
    }
  }

  // ---------- force end turn (host stall valve) ----------
  function updateForceEnd() {
    var btn = $("btn-force-end");
    var s = Game.state;
    var show = false;
    if (s && s.phase === "playing" && s.round && s.round.turn &&
        Game.mySeat === s.hostSeat && s.round.turn.seat !== Game.mySeat) {
      var active = Game.player(s.round.turn.seat);
      var stalled = turnStartedAt && (Date.now() - turnStartedAt > 180000);
      if ((active && !active.connected) || stalled) show = true;
    }
    btn.classList.toggle("hidden", !show);
  }

  // ============================================================
  // DIPLOMACY SHEET / DEFECT / RENAME
  // ============================================================
  function openDiplomacySheet() {
    var singles = singlesAvailable();
    var alliances = alliancesAvailable();
    var suggestion = suggestPactName();

    openModal({
      title: "Diplomacy",
      buildBody: function (body) {
        var meSingle = !(Game.player(Game.mySeat) || {}).allianceId;

        var sec1 = el("div", "diplo-section");
        sec1.appendChild(el("div", "diplo-section-title", "FORGE A NEW PACT"));
        if (!meSingle) {
          sec1.appendChild(el("div", "diplo-empty", "You are already aligned — defect before courting anyone new."));
        } else if (!singles.length) {
          sec1.appendChild(el("div", "diplo-empty", "No unaligned commanders remain."));
        } else {
          var nameRow = el("div", "diplo-name-row");
          var nameInput = el("input", "text-input");
          nameInput.type = "text";
          nameInput.maxLength = C.MAX_ALLIANCE_NAME_LEN || 24;
          nameInput.value = suggestion;
          nameInput.setAttribute("spellcheck", "false");
          var rerollBtn = el("button", "btn btn-sm", "REROLL");
          rerollBtn.setAttribute("data-tip", "Generate another pact name.");
          rerollBtn.addEventListener("click", function () { nameInput.value = suggestPactName(); });
          nameRow.appendChild(nameInput);
          nameRow.appendChild(rerollBtn);
          sec1.appendChild(nameRow);

          singles.forEach(function (p) {
            var card = el("div", "diplo-card");
            card.style.setProperty("--seat-color", seatColor(p.seat));
            var unite = wouldUniteAll({ kind: "make_alliance", from: Game.mySeat, to: [p.seat] });
            card.innerHTML = '<div class="diplo-card-main"><div class="diplo-card-name">' + esc(p.name) + "</div>" +
              '<div class="diplo-card-sub">Free agent &middot; they must accept</div>' +
              (unite ? '<div class="diplo-card-warn">' + UNITE_ALL_WARNING + "</div>" : "") +
              "</div>";
            var offerBtn = el("button", "btn btn-command btn-sm", "OFFER");
            offerBtn.addEventListener("click", function () {
              var allianceName = (nameInput.value || "").trim() || suggestion;
              Net.send("offer_alliance", { targetSeat: p.seat, allianceName: allianceName }, "r" + (++reqCounter));
              closeModal();
            });
            card.appendChild(offerBtn);
            sec1.appendChild(card);
          });
        }
        body.appendChild(sec1);

        var sec2 = el("div", "diplo-section");
        sec2.appendChild(el("div", "diplo-section-title", "REQUEST TO JOIN"));
        if (!meSingle) {
          sec2.appendChild(el("div", "diplo-empty", "One alliance per commander."));
        } else if (!alliances.length) {
          sec2.appendChild(el("div", "diplo-empty", "No alliances exist yet."));
        } else {
          alliances.forEach(function (a) {
            var metal = metalFor(a);
            var members = (a.members || []).map(function (x) { return esc(seatName(x)); }).join(", ");
            var unite = wouldUniteAll({ kind: "join_alliance", from: Game.mySeat, allianceId: a.id });
            var card = el("div", "diplo-card");
            card.style.setProperty("--seat-color", metal.color);
            card.innerHTML = '<div class="diplo-card-main"><div class="diplo-card-name">' +
              '<span style="color:' + metal.color + '">' + esc(metal.sigil) + "</span> " + esc(a.name) + "</div>" +
              '<div class="diplo-card-sub">' + members + " &middot; all " + (a.members || []).length + " must approve</div>" +
              (unite ? '<div class="diplo-card-warn">' + UNITE_ALL_WARNING + "</div>" : "") +
              "</div>";
            var reqBtn = el("button", "btn btn-command btn-sm", "REQUEST");
            reqBtn.addEventListener("click", function () {
              Net.send("request_join", { allianceId: a.id }, "r" + (++reqCounter));
              closeModal();
            });
            card.appendChild(reqBtn);
            sec2.appendChild(card);
          });
        }
        body.appendChild(sec2);
      },
      actions: [{ label: "CLOSE", cls: "btn-outline" }]
    });
  }

  function openDefectConfirm() {
    var a = Game.allianceOf(Game.mySeat);
    var name = a ? a.name : "your alliance";
    confirmModal("Defect",
      "Abandon <b>" + esc(name) + "</b>? Your former allies will be notified — and their borders open to you.",
      "DEFECT", "btn-danger", function () {
        Net.send("defect", {}, "r" + (++reqCounter));
      });
  }

  function openColorModal(seat) {
    var s = Game.state;
    if (!s) return;
    var taken = {};
    (s.players || []).forEach(function (p) { if (p.seat !== seat) taken[p.colorIndex] = true; });
    var target = Game.player(seat);
    openModal({
      title: "Banner color" + (target && target.isBot ? " — " + target.name : ""),
      buildBody: function (body) {
        var row = el("div", "color-pick-row");
        COLORS.forEach(function (hex, idx) {
          var dot = el("button", "color-pick-dot");
          dot.style.background = hex;
          if (taken[idx]) {
            dot.disabled = true;
            dot.classList.add("taken");
            dot.setAttribute("data-tip", "Another commander flies this color.");
          } else {
            dot.addEventListener("click", function () {
              Net.send("pick_color", { colorIndex: idx, seat: seat }, "r" + (++reqCounter));
              closeModal();
            });
          }
          row.appendChild(dot);
        });
        body.appendChild(row);
      },
      actions: [{ label: "CANCEL", cls: "btn-outline" }]
    });
  }

  function openBotRenameModal(seat) {
    var p = Game.player(seat);
    if (!p) return;
    var input;
    openModal({
      title: "Rename AI commander",
      buildBody: function (body) {
        input = el("input", "text-input");
        input.type = "text";
        input.maxLength = C.MAX_NAME_LEN || 20;
        input.value = p.name;
        body.appendChild(input);
      },
      actions: [
        { label: "CANCEL", cls: "btn-outline" },
        {
          label: "RENAME", cls: "btn-command", cb: function () {
            var name = (input.value || "").trim();
            if (!name || name === p.name) return;
            Net.send("rename_bot", { seat: seat, name: name }, "r" + (++reqCounter));
          }
        }
      ]
    });
  }

  function openRenameModal(allianceId) {
    var s = Game.state;
    var a = s.round && s.round.alliances ? s.round.alliances[allianceId] : null;
    if (!a) return;
    var input;
    openModal({
      title: "Rename " + a.name,
      buildBody: function (body) {
        body.appendChild(el("p", null, "All members must approve the new name."));
        input = el("input", "text-input");
        input.type = "text";
        input.maxLength = C.MAX_ALLIANCE_NAME_LEN || 24;
        input.value = a.name;
        input.style.marginTop = "0.7em";
        body.appendChild(input);
      },
      actions: [
        { label: "CANCEL", cls: "btn-outline" },
        {
          label: "PROPOSE", cls: "btn-command", cb: function () {
            var newName = (input.value || "").trim();
            if (!newName || newName === a.name) return;
            Net.send("propose_rename", { allianceId: allianceId, newName: newName }, "r" + (++reqCounter));
          }
        }
      ]
    });
  }

  // ============================================================
  // LOBBY
  // ============================================================

  // When the game is opened on THIS machine (localhost), invite links must use
  // the machine's Wi-Fi address instead — "localhost" on a friend's phone
  // points at their phone. The server tells us its LAN address via /info.
  var lanInfo = null; // null = not asked yet; {} = asked (maybe empty)
  function isLoopbackOrigin() {
    var h = window.location.hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
  }
  function bestLanUrl() {
    var urls = (lanInfo && lanInfo.lanUrls) || [];
    // Home-router addresses first; corporate/VPN ranges as fallback.
    var sorted = urls.slice().sort(function (a, b) {
      function rank(u) { return /\/\/192\.168\./.test(u) ? 0 : /\/\/10\./.test(u) ? 1 : 2; }
      return rank(a) - rank(b);
    });
    return sorted[0] || null;
  }
  function shareBaseUrl() {
    if (isLoopbackOrigin() && bestLanUrl()) return bestLanUrl() + "/";
    return window.location.origin + window.location.pathname;
  }
  function loadLanInfo() {
    if (lanInfo !== null || !isLoopbackOrigin()) return;
    lanInfo = {}; // sentinel: never fetch twice
    fetch("info").then(function (r) { return r.json(); }).then(function (d) {
      lanInfo = d || {};
      renderLanHint();
    }).catch(function () { /* hint simply stays hidden */ });
  }
  function renderLanHint() {
    var hint = $("lan-hint");
    if (!hint) return;
    var url = isLoopbackOrigin() ? bestLanUrl() : null;
    if (!url) { hint.classList.add("hidden"); return; }
    hint.classList.remove("hidden");
    hint.innerHTML = 'Friends on your Wi-Fi join at <b>' + esc(url) +
      "</b> &mdash; or just send them the invite link.";
  }

  function renderLobby() {
    var s = Game.state;
    if (!s) return;
    $("room-code").textContent = s.roomCode || "———";
    loadLanInfo();
    renderLanHint();

    var codeLine = $("my-code-line");
    if (s.yourCode) {
      codeLine.classList.remove("hidden");
      codeLine.innerHTML = "Your personal re-entry code: <b>" + esc(s.yourCode) +
        "</b> — type it on the home screen to pick this game up from any device, any day.";
    } else {
      codeLine.classList.add("hidden");
    }

    var isHost = Game.mySeat === s.hostSeat;
    var playerCount = (s.settings && s.settings.playerCount) || 2;
    var players = (s.players || []).slice().sort(function (a, b) { return a.seat - b.seat; });

    // seat cards
    var wrap = $("seat-cards");
    wrap.innerHTML = "";
    var bySeat = {};
    players.forEach(function (p) { bySeat[p.seat] = p; });
    var shown = 0;
    for (var seat = 0; seat < 6 && shown < playerCount; seat++) {
      var p = bySeat[seat];
      if (!p && players.length >= playerCount && seat >= playerCount) break;
      var card = el("div", "seat-card" + (p ? "" : " empty"));
      shown++;
      if (p) {
        card.style.setProperty("--seat-color", seatColor(p.seat));
        card.innerHTML =
          '<span class="seat-order">' + (p.seat + 1) + "</span>" +
          (p.isBot ? '<span class="bot-chip" data-tip="AI commander">' + ICONS.bot + "</span>"
                   : '<span class="presence-dot ' + (p.connected ? "" : "off") + '"></span>') +
          '<span class="seat-name">' + esc(p.name) + "</span>" +
          (p.seat === s.hostSeat ? '<span class="crown" data-tip="Host">' + ICONS.crown + "</span>" : "") +
          (p.seat === Game.mySeat ? '<span class="seat-you">YOU</span>' : "") +
          (p.winPoints ? '<span class="seat-points">' + p.winPoints + " pts</span>" : "");

        // Banner color: your own is clickable; the host may recolor AIs.
        var canRecolor = p.seat === Game.mySeat || (isHost && p.isBot);
        var swatch = el("button", "seat-swatch" + (canRecolor ? " clickable" : ""));
        swatch.style.background = seatColor(p.seat);
        swatch.setAttribute("data-tip", canRecolor ? "Choose a banner color" : "Banner color");
        if (canRecolor) {
          (function (seatN) {
            swatch.addEventListener("click", function () { openColorModal(seatN); });
          })(p.seat);
        } else {
          swatch.disabled = true;
        }
        card.appendChild(swatch);

        if (p.isBot && isHost) {
          var pen = el("button", "btn btn-sm seat-edit-bot", ICONS.pencil);
          pen.setAttribute("data-tip", "Rename this AI commander");
          (function (botSeat) {
            pen.addEventListener("click", function () { openBotRenameModal(botSeat); });
          })(p.seat);
          card.appendChild(pen);
          var rm = el("button", "btn btn-sm seat-remove-bot", "✕");
          rm.setAttribute("data-tip", "Remove this AI commander");
          (function (botSeat) {
            rm.addEventListener("click", function () {
              Net.send("remove_bot", { seat: botSeat }, "r" + (++reqCounter));
            });
          })(p.seat);
          card.appendChild(rm);
        }
      } else {
        card.innerHTML = '<span class="seat-order">' + (shown) + "</span>" +
          '<span class="seat-name">Awaiting commander&hellip;</span>';
        if (isHost) {
          var add = el("button", "btn btn-sm seat-add-bot", "+ ADD AI");
          add.setAttribute("data-tip", "Fill this seat with an AI commander");
          add.addEventListener("click", function () {
            Net.send("add_bot", {}, "r" + (++reqCounter));
          });
          card.appendChild(add);
        }
      }
      wrap.appendChild(card);
    }

    // player count picker
    var pcRow = $("player-count-row");
    pcRow.innerHTML = '<span class="pc-label">SEATS</span>';
    var countLocked = players.some(function (p) { return p.winPoints > 0; });
    for (var n = 2; n <= 6; n++) {
      var b = el("button", "pc-btn" + (n === playerCount ? " active" : ""), String(n));
      if (!isHost || countLocked) {
        b.disabled = n !== playerCount;
        b.setAttribute("data-tip", countLocked ? "Seat count locks after the first round."
          : "Only the host sets the seat count.");
      } else if (n < players.length) {
        b.disabled = true;
        b.setAttribute("data-tip", "Commanders are already seated past that count.");
      } else {
        (function (count) {
          b.addEventListener("click", function () {
            s.settings.playerCount = count;
            Net.send("set_settings", { mapId: s.settings.mapId, playerCount: count });
            renderLobby();
          });
        })(n);
      }
      pcRow.appendChild(b);
    }

    renderMapCards($("map-cards"), isHost && !countLocked);

    // Victory-spoils scheme (host picks; everyone sees the current setting).
    var scheme = (s.settings && s.settings.pointsScheme) || "equal";
    Array.prototype.forEach.call($("opt-points").querySelectorAll(".seg-btn"), function (b) {
      b.classList.toggle("active", b.getAttribute("data-scheme") === scheme);
      b.disabled = !isHost;
    });

    // start gating
    var startBtn = $("btn-start");
    var hint = $("start-hint");
    var full = players.length >= playerCount;
    if (isHost) {
      startBtn.classList.remove("hidden");
      startBtn.disabled = !full;
      hint.textContent = full ? "All commanders present. Launch when ready."
        : "Waiting for commanders (" + players.length + "/" + playerCount + ")…";
    } else {
      startBtn.classList.remove("hidden");
      startBtn.disabled = true;
      hint.textContent = full ? "Waiting for the host to start the war…"
        : "Waiting for commanders (" + players.length + "/" + playerCount + ")…";
    }

    // scoreboard strip (persistent war record across rounds)
    var strip = $("lobby-scoreboard");
    var anyPoints = players.some(function (p) { return p.winPoints > 0; });
    if (anyPoints) {
      var bits = players.slice().sort(function (a, b) { return b.winPoints - a.winPoints; })
        .map(function (p) { return esc(p.name) + " <b>" + p.winPoints + "</b>"; });
      strip.innerHTML = "WAR RECORD &middot; " + bits.join(" &middot; ");
      strip.classList.remove("hidden");
    } else {
      strip.classList.add("hidden");
    }
  }

  function renderMapCards(container, interactive) {
    var s = Game.state;
    if (!container || !s) return;
    container.innerHTML = "";
    var reg = window.ALLIANCES_MAPS || {};
    MAP_ORDER.forEach(function (id) {
      var m = reg[id];
      if (!m) return;
      var card = el("div", "map-card" + (s.settings.mapId === id ? " selected" : "") + (interactive ? "" : " readonly"));
      var thumb = el("div", "map-thumb");
      var r = R();
      var preview = null;
      if (r && r.miniPreview) {
        try { preview = r.miniPreview(m, 132, 88); } catch (e) { preview = null; }
      }
      if (preview) thumb.appendChild(preview);
      else thumb.appendChild(el("span", "map-thumb-placeholder", esc(m.name)));
      card.appendChild(thumb);
      var meta = el("div", "map-meta");
      meta.innerHTML = '<div class="map-name">' + esc(m.name) + '</div>' +
        '<div class="map-desc">' + esc(m.description || "") + " &middot; " + m.territories.length + " territories</div>";
      card.appendChild(meta);
      if (interactive) {
        card.addEventListener("click", function () {
          s.settings.mapId = id; // optimistic; lobby_update confirms
          Net.send("set_settings", { mapId: id, playerCount: s.settings.playerCount });
          renderLobby();
          renderCeremonyMapPick();
        });
      } else if (!interactive && container.id === "map-cards") {
        card.setAttribute("data-tip", "Only the host picks the theater.");
      }
      container.appendChild(card);
    });
    if (!container.children.length) {
      container.appendChild(el("div", "diplo-empty", "No maps loaded."));
    }
  }

  // ============================================================
  // CEREMONY + SCOREBOARD
  // ============================================================
  function normalizeWinner(w) {
    if (!w) return { type: "none", seats: [], allianceName: null };
    if (typeof w === "number") return { type: "solo", seats: [w], allianceName: null };
    var seats = w.seats || (typeof w.seat === "number" ? [w.seat] : null) || (w.members ? w.members.slice() : []);
    var type = w.type || (seats.length > 1 ? "alliance" : seats.length === 1 ? "solo" : "none");
    var allianceName = w.allianceName || null;
    if (!allianceName && w.allianceId) allianceName = allianceLabel(w.allianceId);
    return { type: type, seats: seats || [], allianceName: allianceName };
  }

  function showCeremonyChrome(winner, awards) {
    var s = Game.state;
    if (!s) return;
    showScreen("screen-ceremony");
    var isHost = Game.mySeat === s.hostSeat;
    // Rejoins arrive without the round_ended event — recover awards from the log.
    if (!awards && s.log) {
      for (var li = s.log.length - 1; li >= 0; li--) {
        if (s.log[li].kind === "round_end") {
          awards = normalizeAwards(s.log[li].data || {}, winner);
          break;
        }
      }
    }
    awards = awards || {};

    var title = $("cer-title"), summary = $("cer-summary");
    if (!winner || winner.type === "none" || !winner.seats.length) {
      title.textContent = "ROUND ABORTED";
      summary.innerHTML = "No points awarded. The scoreboard stands.";
    } else if (winner.type === "alliance") {
      title.textContent = (winner.allianceName || "THE ALLIANCE") + " REIGNS";
      var vals = winner.seats.map(function (x) { return awards[x]; });
      var allEqual = vals.every(function (v) { return v === vals[0]; });
      if (allEqual) {
        summary.innerHTML = winner.seats.map(function (x) { return nameSpan(x); }).join(" &middot; ") +
          " split the spoils — <b>+" + (vals[0] != null ? vals[0] : Math.floor(60 / winner.seats.length)) +
          "</b> war points each.";
      } else {
        // Spoils of War: shares differ — name each commander's cut.
        summary.innerHTML = winner.seats.map(function (x) {
          return nameSpan(x) + " <b>+" + (awards[x] != null ? awards[x] : "?") + "</b>";
        }).join(" &middot; ") + " — spoils divided by the force each commanded.";
      }
    } else {
      title.textContent = esc(seatName(winner.seats[0])).toUpperCase() + " CONQUERS ALL";
      summary.innerHTML = nameSpan(winner.seats[0]) + " takes the full <b>+" +
        (awards[winner.seats[0]] != null ? awards[winner.seats[0]] : 60) + "</b> war points.";
    }

    renderScoreTable($("cer-scoreboard"));
    renderCeremonyMapPick();

    $("btn-play-again").classList.toggle("hidden", !isHost);
    $("cer-waiting").classList.toggle("hidden", isHost);
    updateCeremonyControls();
  }

  // A seat vacated between rounds must be refillable from the ceremony screen
  // (the server allows add_bot at round_end), or PLAY AGAIN could never launch.
  function updateCeremonyControls() {
    var s = Game.state;
    if (!s || currentScreen !== "screen-ceremony") return;
    var isHost = Game.mySeat === s.hostSeat;
    var seatsShort = (s.players || []).length < ((s.settings && s.settings.playerCount) || 2);
    $("btn-cer-addbot").classList.toggle("hidden", !(isHost && seatsShort));
    var again = $("btn-play-again");
    again.disabled = seatsShort;
    if (seatsShort) again.setAttribute("data-tip", "A seat is empty — add an AI or wait for a commander to join.");
    else again.removeAttribute("data-tip");
  }

  function renderCeremonyMapPick() {
    var s = Game.state;
    if (!s || currentScreen !== "screen-ceremony") return;
    var isHost = Game.mySeat === s.hostSeat;
    var pick = $("cer-map-pick");
    if (isHost) {
      pick.classList.remove("hidden");
      renderMapCards($("cer-map-cards"), true);
    } else {
      pick.classList.add("hidden");
    }
  }

  function renderScoreTable(container) {
    var s = Game.state;
    if (!container) return;
    container.innerHTML = "";
    if (!s || !s.players || !s.players.length) {
      container.appendChild(el("div", "score-empty", "No war room joined. The record awaits its first battle."));
      return;
    }
    var rows = s.players.slice().sort(function (a, b) { return b.winPoints - a.winPoints || a.seat - b.seat; });
    var html = '<table class="score-table"><thead><tr><th></th><th>Commander</th><th>War Points</th></tr></thead><tbody>';
    rows.forEach(function (p, i) {
      var arrow = "";
      if (standingsAtRoundStart && standingsAtRoundStart[p.seat] != null) {
        var was = standingsAtRoundStart[p.seat];
        if (i < was) arrow = ' <span class="st-arrow-up">&#9650;</span>';
        else if (i > was) arrow = ' <span class="st-arrow-down">&#9660;</span>';
      }
      html += '<tr class="' + (p.seat === Game.mySeat ? "st-me" : "") + '">' +
        '<td class="st-rank">' + (i + 1) + arrow + "</td>" +
        '<td><span class="st-name"><i class="seat-dot" style="background:' + seatColor(p.seat) +
        ';box-shadow:none"></i>' + esc(p.name) + (p.eliminated ? " " + ICONS.skull : "") + "</span></td>" +
        '<td class="st-points">' + p.winPoints + "</td></tr>";
    });
    html += "</tbody></table>";
    container.innerHTML = html;
  }

  function captureStandings() {
    var s = Game.state;
    if (!s || !s.players) { standingsAtRoundStart = null; return; }
    var rows = s.players.slice().sort(function (a, b) { return b.winPoints - a.winPoints || a.seat - b.seat; });
    standingsAtRoundStart = {};
    rows.forEach(function (p, i) { standingsAtRoundStart[p.seat] = i; });
  }

  // ============================================================
  // ROUTING + CONNECTION CHROME
  // ============================================================
  function routeByPhase() {
    var s = Game.state;
    if (!s) { showScreen("screen-landing"); return; }
    if (s.phase === "lobby") {
      showScreen("screen-lobby");
      renderLobby();
    } else if (s.phase === "playing") {
      showScreen("screen-game");
      ensureRenderer(false);
      renderGame();
      syncEdgeGlow();
    } else if (s.phase === "round_end") {
      var winner = s.round ? normalizeWinner(s.round.winner) : null;
      showCeremonyChrome(winner, null);
    }
  }

  function leaveRoom() {
    Net.send("leave_room", {});
    window.Save.clearSession();
    Game.applyEvent("room_disbanded", {});
    myElimTurn = null;
    rendererMapId = null;
    infoDispatches = [];
    showScreen("screen-landing");
    updateNetPill();
  }

  function updateScrim() {
    var scrim = $("reconnect-scrim");
    var retry = $("btn-scrim-retry");
    var text = $("scrim-text");
    var inRoom = !!(window.Save.session());
    if (netStatus === "elsewhere") {
      scrim.classList.remove("hidden");
      text.textContent = "YOU ARE COMMANDING FROM ANOTHER DEVICE";
      retry.textContent = "RESUME HERE";
      retry.classList.remove("hidden");
    } else if (netStatus === "dead") {
      scrim.classList.remove("hidden");
      text.textContent = "CONNECTION LOST";
      retry.textContent = "RETRY";
      retry.classList.remove("hidden");
    } else if ((netStatus === "reconnecting" || netStatus === "connecting") && inRoom) {
      scrim.classList.remove("hidden");
      text.textContent = "RECONNECTING TO WAR ROOM…";
      retry.classList.add("hidden");
    } else {
      scrim.classList.add("hidden");
    }
  }

  function updateNetPill() {
    var pill = $("net-pill");
    if (!pill) return;
    if (netStatus === "open" || window.Save.session()) {
      pill.classList.add("hidden");
      return;
    }
    pill.classList.remove("hidden");
    pill.textContent = netStatus === "dead" ? "SERVER UNREACHABLE" :
      netStatus === "reconnecting" ? "RECONNECTING…" : "CONNECTING…";
  }

  // ============================================================
  // NETWORK EVENT WIRING
  // ============================================================
  function wireNet() {
    Net.onStatus(function (st) {
      netStatus = st;
      updateScrim();
      updateNetPill();
    });

    Net.on("room_created", function (d) {
      window.Save.setSession({ roomCode: d.roomCode, token: d.token, seat: d.seat, name: pendingName });
      Game.applyEvent("room_created", { roomCode: d.roomCode, seat: d.seat, name: pendingName });
      showScreen("screen-lobby");
      renderLobby();
      Net.send("request_state", {}); // pull canonical settings (room_created has no snapshot)
      cleanUrl();
    });

    Net.on("room_joined", function (d) {
      Game.applyEvent("room_joined", d);
      var s = Game.state;
      var myName = "";
      if (s) {
        var me = Game.player(d.seat);
        myName = me ? me.name : "";
      }
      window.Save.setSession({ roomCode: d.roomCode, token: d.token, seat: d.seat, name: myName });
      updateScrim();
      routeByPhase();
      if (d._viaRejoin) toast("Command link re-established.", "ok");
      cleanUrl();
    });

    Net.on("join_failed", function (d) {
      var msg = JOIN_FAIL_COPY[d.reason] || d.message || "Could not join.";
      updateScrim();
      updateNetPill();
      if (d._wasRejoin) {
        showScreen("screen-landing");
        toast("Your previous war room is gone — session cleared.", "warn");
      } else {
        toast(msg, "error");
        shake($("join-code"));
      }
    });

    Net.on("lobby_update", function (d) {
      Game.applyEvent("lobby_update", d);
      if (currentScreen === "screen-lobby") renderLobby();
      else if (currentScreen === "screen-ceremony") { renderCeremonyMapPick(); updateCeremonyControls(); }
      else if (Game.state && Game.state.phase === "lobby") routeByPhase();
    });

    Net.on("round_started", function (d) {
      Game.applyEvent("round_started", d);
      captureStandings();
      myElimTurn = null;
      attackIndexInTurn = 0;
      battlesPending = 0;
      infoDispatches = [];
      lastCounts = {};
      disarm();
      showScreen("screen-game");
      rendererMapId = null; // force a fresh init (new round may bring a new map)
      ensureRenderer(true);
      renderGame();
      syncEdgeGlow();
    });

    Net.on("state", function (d) {
      Game.applyEvent("state", d);
      routeByPhase();
    });

    Net.on("turn_began", function (d) {
      Game.applyEvent("turn_began", d);
      attackIndexInTurn = 0;
      turnStartedAt = Date.now();
      disarm();
      if (Game.isMyTurn()) {
        snd("turn");
        flashTitle("YOUR TURN — Alliances");
        localNotify("Alliances — your turn!", "It's your move in war room " + (Game.state.roomCode || "") + ".");
      }
      syncMapState(); // alliances may have formed in the end-turn pipeline
      renderGame();
      updateInteractive();
      syncEdgeGlow();
    });

    Net.on("attack_resolved", function (d) {
      Game.applyEvent("attack_resolved", d); // mirror first — contract
      enqueueBattle(d);                       // cinematic owns the map reveal
      renderGame();                           // chrome (chips/roster/log) updates now
      updateInteractive();                    // map unlocks the moment the verdict lands
    });

    Net.on("offer_created", function (d) {
      Game.applyEvent("offer_created", d);
      var o = d.offer || d;
      if (o && o.to && o.to.indexOf(Game.mySeat) >= 0 && o.from !== Game.mySeat) {
        snd("dispatch");
        flashTitle("NEW DISPATCH — Alliances");
        localNotify("Alliances — a pact is offered",
          seatName(o.from) + " proposes an alliance. It expires when their turn ends!");
        if (window.innerWidth <= 1100) toast("New dispatch — open the rail to answer.", "info");
      }
      renderGame();
    });

    Net.on("offer_updated", function (d) {
      Game.applyEvent("offer_updated", d);
      var o = d.offer || d;
      if (o) {
        var mineOut = o.from === Game.mySeat;
        var involvesMe = mineOut || (o.to && o.to.indexOf(Game.mySeat) >= 0);
        if (involvesMe) {
          if (o.status === "declined" && mineOut) addInfo("envelope", "Your offer was <b>declined</b>.");
          else if (o.status === "rescinded" && !mineOut) addInfo("envelope", nameSpan(o.from) + " rescinded their offer.");
          else if (o.status === "void" || o.status === "voided") {
            // Turn-bound expiry gets its own plain-language card; other voids
            // keep the generic "circumstances changed" copy.
            if (d.reason === "offerer_attacked") {
              addInfo("envelope", mineOut ? "Your offer <b>expired</b> — you marched to war."
                                          : "The offer from " + nameSpan(o.from) + " <b>expired</b> — they marched to war.");
            } else if (d.reason === "turn_ended") {
              addInfo("envelope", mineOut ? "Your offer <b>expired</b> unanswered when your turn ended."
                                          : "The offer from " + nameSpan(o.from) + " <b>expired</b> with their turn.");
            } else {
              addInfo("envelope", "An offer was <b>voided</b> — circumstances changed.");
            }
          }
        }
      }
      renderGame();
    });

    Net.on("alliance_formed", function (d) {
      Game.applyEvent("alliance_formed", d);
      var a = d.alliance || d;
      snd("pact");
      var metal = metalFor(a);
      addInfo("pact", '<span style="color:' + metal.color + '">' + esc(metal.sigil) + "</span> <b>" +
        esc(a.name || "A pact") + "</b> is sealed: " +
        (a.members || []).map(function (x) { return nameSpan(x); }).join(", "));
      syncMapState();
      renderGame();
      updateInteractive(); // allied borders just closed
    });

    Net.on("member_joined", function (d) {
      Game.applyEvent("member_joined", d);
      snd("pact");
      addInfo("pact", nameSpan(d.seat) + " joined <b>" + esc(allianceLabel(d.allianceId || (d.alliance && d.alliance.id))) + "</b>.");
      syncMapState();
      renderGame();
      updateInteractive();
    });

    Net.on("member_left", function (d) {
      Game.applyEvent("member_left", d);
      if (d.reason !== "eliminated") {
        snd("defect");
        addInfo("chain", nameSpan(d.seat) + " <b>defected</b> from " + esc(allianceLabel(d.allianceId)) +
          " — their borders are open.", "warning-card");
      }
      syncMapState();
      renderGame();
      updateInteractive();
    });

    Net.on("dissolved", function (d) {
      Game.applyEvent("dissolved", d);
      addInfo("chain", "An alliance has <b>dissolved</b>.");
      syncMapState();
      renderGame();
      updateInteractive();
    });

    Net.on("renamed", function (d) {
      Game.applyEvent("renamed", d);
      addInfo("pencil", "The alliance now flies the name <b>&ldquo;" +
        esc(d.name || d.newName || "") + "&rdquo;</b>.");
      renderGame();
    });

    Net.on("player_eliminated", function (d) {
      Game.applyEvent("player_eliminated", d);
      snd("eliminated");
      if (d.seat === Game.mySeat) myElimTurn = d.turnNumber;
      var after = function () {
        addInfo("skull", nameSpan(d.seat) + " was <b>eliminated</b> on turn " + (d.turnNumber || "?") + ".");
        syncMapState();
        renderGame();
        updateInteractive();
      };
      if (window.Anim && window.Anim.elimination) {
        window.Anim.elimination({
          name: seatName(d.seat),
          turnNumber: d.turnNumber,
          isMe: d.seat === Game.mySeat
        }).then(after, after);
      } else {
        after();
      }
    });

    Net.on("player_connection", function (d) {
      Game.applyEvent("player_connection", d);
      var nm = seatName(d.seat);
      if (d.seat !== Game.mySeat) {
        toast(esc(nm) + (d.connected ? " reconnected to the war room." : " lost connection."),
          d.connected ? "ok" : "warn", 2600);
      }
      if (currentScreen === "screen-lobby") renderLobby();
      else if (currentScreen === "screen-game") { renderRoster(); updateForceEnd(); }
    });

    Net.on("round_ended", function (d) {
      Game.applyEvent("round_ended", d);
      disarm();
      hideAttackConfirm();
      var winner = normalizeWinner(d.winner);
      var s = Game.state;
      var names = [], colors = [];
      ((s && s.players) || []).forEach(function (p) {
        names[p.seat] = p.name;
        colors[p.seat] = seatColor(p.seat);
      });
      var scoreboard = ((s && s.players) || []).map(function (p) {
        return { seat: p.seat, name: p.name, winPoints: p.winPoints };
      });
      var awards = normalizeAwards(d, winner);
      var finish = function () { showCeremonyChrome(winner, awards); };
      // Alliance wins carry their metal sigil into the ceremony (alliances are
      // still in the mirror at round end — match by name, default gold).
      var metalIndex = 0;
      if (winner.type === "alliance" && s && s.round && s.round.alliances) {
        Object.keys(s.round.alliances).some(function (id) {
          var a = s.round.alliances[id];
          if (a && a.name === winner.allianceName) { metalIndex = a.metalIndex || 0; return true; }
          return false;
        });
      }
      if (winner.seats.length && window.Anim && window.Anim.ceremony) {
        snd("ceremony");
        window.Anim.ceremony({
          winner: { type: winner.type, seats: winner.seats, allianceName: winner.allianceName, metalIndex: metalIndex },
          pointsAwarded: awards,
          scoreboard: scoreboard,
          names: names,
          colors: colors
        }).then(finish, finish);
      } else {
        finish();
      }
    });

    Net.on("room_disbanded", function () {
      window.Save.clearSession();
      Game.applyEvent("room_disbanded", {});
      toast("The war room was disbanded.", "warn");
      showScreen("screen-landing");
      updateNetPill();
    });

    Net.on("action_rejected", function (d) {
      var msg = REJECT_COPY[d.code] || d.message || "Action rejected.";
      toast(msg, "error");
      renderGame(); // re-gray buttons in case our mirror drifted
    });
  }

  // ============================================================
  // NOTIFICATIONS (opt-in)
  // Two delivery tiers: web push through the service worker when the page is
  // served over HTTPS/localhost (works with the tab CLOSED — the server pushes
  // to disconnected players), plus plain browser notifications from this very
  // page when it's open-but-hidden. Email would need someone's SMTP account,
  // so this is the no-secrets path that does the same job.
  // ============================================================
  function pushSupported() {
    return "serviceWorker" in navigator && "PushManager" in window && window.isSecureContext;
  }

  function urlB64ToUint8(base64) {
    var padding = "=".repeat((4 - (base64.length % 4)) % 4);
    var raw = window.atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  function enableNotifications() {
    if (!("Notification" in window)) {
      toast("This browser does not support notifications.", "warn", 3200);
      return;
    }
    Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") {
        toast("Notifications are blocked by the browser — allow them for this site to opt in.", "warn", 4200);
        return;
      }
      if (!pushSupported()) {
        // LAN over plain http: no service worker, but hidden-tab notifications
        // from this page still work while the tab is open.
        Net.send("set_notify", { enabled: true }, "r" + (++reqCounter));
        toast("Notifications on (while the game tab is open). Closed-tab alerts need the published HTTPS version.", "info", 5200);
        return;
      }
      navigator.serviceWorker.register("sw.js").then(function (reg) {
        return fetch("push/key").then(function (r) { return r.json(); }).then(function (d) {
          if (!d.key) throw new Error("push unavailable on server");
          return reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlB64ToUint8(d.key)
          });
        });
      }).then(function (sub) {
        Net.send("set_notify", { enabled: true, subscription: sub.toJSON() }, "r" + (++reqCounter));
        toast("Notifications on — you'll be pinged even with the game closed.", "ok", 3600);
      }).catch(function () {
        Net.send("set_notify", { enabled: true }, "r" + (++reqCounter));
        toast("Notifications on (while the game tab is open).", "info", 3600);
      });
    });
  }

  // Open-but-hidden tab: this page raises its own notification.
  function localNotify(title, body) {
    if (!window.Game || !Game.state || !Game.state.notifyOptIn) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (!document.hidden) return;
    try {
      new Notification(title, { body: body, tag: "alliances" });
    } catch (e) { /* some platforms require the SW path; the title flash still runs */ }
  }

  // pointsAwarded arrives as {seat: pts}; older shapes (a single number) are
  // normalized so every consumer sees one map.
  function normalizeAwards(d, winner) {
    var out = {};
    if (d && d.pointsAwarded && typeof d.pointsAwarded === "object") {
      for (var k in d.pointsAwarded) out[k] = d.pointsAwarded[k];
      return out;
    }
    var per = typeof (d && d.pointsAwarded) === "number" ? d.pointsAwarded
      : (winner && winner.seats.length ? Math.floor(60 / winner.seats.length) : 0);
    ((winner && winner.seats) || []).forEach(function (s2) { out[s2] = per; });
    return out;
  }

  function shake(input) {
    if (!input) return;
    input.classList.remove("shake");
    void input.offsetWidth;
    input.classList.add("shake");
  }

  function cleanUrl() {
    if (window.location.search && window.history && window.history.replaceState) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }

  // ============================================================
  // SETTINGS FLYOUT
  // ============================================================
  function syncSettingsUI() {
    var codeRow = $("flyout-code-row");
    var yourCode = window.Game && Game.state ? Game.state.yourCode : null;
    if (yourCode) {
      codeRow.classList.remove("hidden");
      $("flyout-code").textContent = yourCode;
    } else {
      codeRow.classList.add("hidden");
    }
    var notifyBtn = $("set-notify");
    var optIn = !!(window.Game && Game.state && Game.state.notifyOptIn);
    notifyBtn.textContent = optIn ? "ON" : "OFF";
    notifyBtn.classList.toggle("on", optIn);
    notifyBtn.setAttribute("aria-checked", String(optIn));

    var soundBtn = $("set-sound");
    soundBtn.textContent = prefs.soundOn ? "ON" : "OFF";
    soundBtn.classList.toggle("on", prefs.soundOn);
    soundBtn.setAttribute("aria-checked", String(prefs.soundOn));
    var quickBtn = $("set-quick");
    quickBtn.textContent = prefs.quickAttack ? "ON" : "OFF";
    quickBtn.classList.toggle("on", prefs.quickAttack);
    quickBtn.setAttribute("aria-checked", String(prefs.quickAttack));
    var speedBtns = $("set-speed").querySelectorAll(".seg-btn");
    for (var i = 0; i < speedBtns.length; i++) {
      speedBtns[i].classList.toggle("active", speedBtns[i].getAttribute("data-speed") === prefs.battleSpeed);
    }
  }

  function toggleFlyout() {
    var fly = $("settings-flyout");
    var s = Game.state;
    var hostTools = $("flyout-host-tools");
    hostTools.classList.toggle("hidden",
      !(s && s.phase === "playing" && Game.mySeat === s.hostSeat));
    fly.classList.toggle("hidden");
    if (!fly.classList.contains("hidden")) syncSettingsUI();
  }

  function closeFlyout() {
    var fly = $("settings-flyout");
    if (fly) fly.classList.add("hidden");
  }

  // ============================================================
  // BOOT
  // ============================================================
  function bindControls() {
    // --- landing ---
    var nameInput = $("commander-name");
    nameInput.value = prefs.name || "";
    nameInput.addEventListener("change", function () {
      prefs = window.Save.patchPrefs({ name: nameInput.value.trim() });
    });

    function requireName() {
      var n = nameInput.value.trim();
      if (!n) { shake(nameInput); nameInput.focus(); return null; }
      prefs = window.Save.patchPrefs({ name: n });
      return n;
    }

    $("btn-create").addEventListener("click", function () {
      var n = requireName();
      if (!n) return;
      pendingName = n;
      Net.send("create_room", { name: n });
      if (netStatus !== "open") toast("Connecting to the server…", "info", 2200);
    });

    $("btn-join-toggle").addEventListener("click", function () {
      $("join-row").classList.toggle("hidden");
      if (!$("join-row").classList.contains("hidden")) $("join-code").focus();
    });

    function doJoin() {
      var n = requireName();
      if (!n) return;
      var code = ($("join-code").value || "").trim().toUpperCase();
      if (code.length !== 3) { shake($("join-code")); return; }
      pendingName = n;
      Net.send("join_room", { roomCode: code, name: n });
      if (netStatus !== "open") toast("Connecting to the server…", "info", 2200);
    }
    $("btn-join").addEventListener("click", doJoin);
    $("join-code").addEventListener("keydown", function (e) { if (e.key === "Enter") doJoin(); });
    nameInput.addEventListener("keydown", function (e) { if (e.key === "Enter") $("btn-create").click(); });

    // Personal re-entry: your own 3-char code drops you back into your seat —
    // no name needed, works from any device (this is the weeks-long-game door).
    $("btn-reenter-toggle").addEventListener("click", function () {
      $("reenter-row").classList.toggle("hidden");
      if (!$("reenter-row").classList.contains("hidden")) $("reenter-code").focus();
    });
    function doReenter() {
      var code = ($("reenter-code").value || "").trim().toUpperCase();
      if (code.length !== 3) { shake($("reenter-code")); return; }
      Net.send("reenter", { playerCode: code });
      if (netStatus !== "open") toast("Connecting to the server…", "info", 2200);
    }
    $("btn-reenter").addEventListener("click", doReenter);
    $("reenter-code").addEventListener("keydown", function (e) { if (e.key === "Enter") doReenter(); });

    // Victory-spoils scheme buttons (host-gated in renderLobby).
    Array.prototype.forEach.call($("opt-points").querySelectorAll(".seg-btn"), function (b) {
      b.addEventListener("click", function () {
        Net.send("set_settings", { pointsScheme: b.getAttribute("data-scheme") }, "r" + (++reqCounter));
      });
    });

    $("btn-howto").addEventListener("click", function () { $("howto-panel").classList.remove("hidden"); });
    $("btn-howto-close").addEventListener("click", function () { $("howto-panel").classList.add("hidden"); });
    $("btn-scoreboard-landing").addEventListener("click", function () {
      renderScoreTable($("scoreboard-table"));
      showScreen("screen-scoreboard");
    });

    // --- lobby ---
    $("btn-copy-code").addEventListener("click", function () {
      copyText((Game.state && Game.state.roomCode) || "");
      toast("Code copied.", "ok", 1800);
    });
    $("btn-copy-link").addEventListener("click", function () {
      var code = (Game.state && Game.state.roomCode) || "";
      copyText(shareBaseUrl() + "?room=" + code);
      toast("Invite link copied.", "ok", 1800);
    });
    $("btn-start").addEventListener("click", function () { Net.send("start_round", {}); });
    $("btn-leave-lobby").addEventListener("click", function () {
      confirmModal("Leave", "Leave this war room?", "LEAVE", "btn-danger", leaveRoom);
    });

    // --- game: action bar ---
    $("btn-action-join").addEventListener("click", openDiplomacySheet);
    $("btn-action-defect").addEventListener("click", openDefectConfirm);
    $("btn-action-capture").addEventListener("click", function () {
      var sources = Game.legalSources();
      var r = R();
      if (r) sources.forEach(function (id) { r.flashTerritory(id); });
      toast("Click one of your glowing territories, then a red-rimmed target.", "info", 2600);
    });
    $("btn-action-end").addEventListener("click", function () {
      disarm();
      Net.send("end_turn", {}, "r" + (++reqCounter));
    });
    $("btn-force-end").addEventListener("click", function () {
      Net.send("force_end_turn", {}, "r" + (++reqCounter));
    });

    // --- game: rails ---
    $("tab-dispatches").addEventListener("click", function () {
      $("tab-dispatches").classList.add("active");
      $("tab-log").classList.remove("active");
      $("dispatch-list").classList.remove("hidden");
      $("log-list").classList.add("hidden");
    });
    $("tab-log").addEventListener("click", function () {
      $("tab-log").classList.add("active");
      $("tab-dispatches").classList.remove("active");
      $("log-list").classList.remove("hidden");
      $("dispatch-list").classList.add("hidden");
    });
    $("btn-rail-toggle").addEventListener("click", function () {
      $("right-rail").classList.toggle("open");
    });
    $("map-stage").addEventListener("click", function () {
      if (window.innerWidth <= 1100) $("right-rail").classList.remove("open");
    });

    // --- settings flyout ---
    $("btn-settings").addEventListener("click", function (e) {
      e.stopPropagation();
      toggleFlyout();
    });
    document.addEventListener("click", function (e) {
      var fly = $("settings-flyout");
      if (!fly.classList.contains("hidden") &&
          !fly.contains(e.target) && e.target !== $("btn-settings") && !$("btn-settings").contains(e.target)) {
        closeFlyout();
      }
    });
    $("set-sound").addEventListener("click", function () {
      prefs = window.Save.patchPrefs({ soundOn: !prefs.soundOn });
      if (window.Sound && window.Sound.setMuted) window.Sound.setMuted(!prefs.soundOn);
      syncSettingsUI();
    });
    $("set-quick").addEventListener("click", function () {
      prefs = window.Save.patchPrefs({ quickAttack: !prefs.quickAttack });
      syncSettingsUI();
    });
    $("set-notify").addEventListener("click", function () {
      var on = !!(window.Game && Game.state && Game.state.notifyOptIn);
      if (on) Net.send("set_notify", { enabled: false }, "r" + (++reqCounter));
      else enableNotifications();
    });
    Net.on("notify_state", function (d) {
      if (Game.state) Game.state.notifyOptIn = !!(d && d.enabled);
      syncSettingsUI();
      if (d && !d.enabled) toast("Notifications off.", "info", 2200);
    });
    bindSpeedGroup($("set-speed"));
    $("btn-howto-game").addEventListener("click", function () {
      closeFlyout();
      $("howto-panel").classList.remove("hidden");
    });
    $("btn-scoreboard-game").addEventListener("click", function () {
      closeFlyout();
      renderScoreTable($("scoreboard-table"));
      showScreen("screen-scoreboard");
    });
    $("btn-abort-round").addEventListener("click", function () {
      closeFlyout();
      confirmModal("Abort Round",
        "Abort this round? <b>No points will be awarded.</b> The scoreboard survives.",
        "ABORT ROUND", "btn-danger", function () {
          Net.send("abort_round", {}, "r" + (++reqCounter));
        });
    });

    // --- ceremony / scoreboard ---
    $("btn-play-again").addEventListener("click", function () { Net.send("start_round", {}); });
    $("btn-cer-addbot").addEventListener("click", function () {
      Net.send("add_bot", {}, "r" + (++reqCounter));
    });
    $("btn-cer-leave").addEventListener("click", function () {
      confirmModal("Leave", "Leave this war room? Your war points stay on its record.", "LEAVE", "btn-danger", leaveRoom);
    });
    $("btn-scoreboard-back").addEventListener("click", function () {
      showScreen(prevScreenForScoreboard);
    });
    $("btn-scrim-retry").addEventListener("click", function () { Net.connect(); });

    // --- global ---
    document.addEventListener("pointerdown", function armSound() {
      document.removeEventListener("pointerdown", armSound);
      try {
        if (window.Sound && window.Sound.arm) window.Sound.arm();
        if (window.Sound && window.Sound.setMuted) window.Sound.setMuted(!prefs.soundOn);
      } catch (e) { /* sound is optional */ }
    });
    document.addEventListener("click", function (e) {
      if (e.target && e.target.closest && e.target.closest("button:not(:disabled)")) snd("click");
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) clearTitleFlash(true);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        hideAttackConfirm();
        closeFlyout();
        if (!$("howto-panel").classList.contains("hidden")) $("howto-panel").classList.add("hidden");
      }
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () { legacyCopy(text); });
    } else {
      legacyCopy(text);
    }
  }
  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) { /* clipboard unavailable */ }
    document.body.removeChild(ta);
  }

  function boot() {
    prefs = window.Save.prefs();
    var fav = $("favicon");
    faviconNormal = fav ? fav.getAttribute("href") : null;

    bindControls();
    bindTooltips();
    wireNet();
    syncSettingsUI();

    // Battle queue true-up (pinned contract: one setState after drain)
    if (window.Battle && window.Battle.onQueueDrained) {
      window.Battle.onQueueDrained(afterBattlesDrained);
    }

    // Deep link: ?room=CODE prefills the join flow (a stored session for an
    // ongoing game takes precedence — auto-rejoin handles it on socket open).
    var params = new URLSearchParams(window.location.search);
    var roomParam = (params.get("room") || "").toUpperCase();
    if (roomParam.length !== 3) roomParam = ""; // stale/foreign links: ignore, don't confuse
    if (roomParam && !window.Save.session()) {
      $("join-row").classList.remove("hidden");
      $("join-code").value = roomParam;
      if (prefs.name) { /* name prefilled; one click to join */ }
    }

    // If a session exists, the scrim shows until rejoin resolves.
    if (window.Save.session()) updateScrim();

    // host stall valve — periodically re-check force-end conditions
    setInterval(function () {
      if (currentScreen === "screen-game") updateForceEnd();
    }, 15000);

    Net.connect();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

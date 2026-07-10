/*
 * Boot-time map validation. The server refuses to start on a broken map — a bad
 * adjacency table found at boot is a one-line fix; found mid-game it's a corrupted round.
 */
"use strict";

// Hand-committed expectations; asserted only when a map id appears here.
// North America's canonical table: 105 lower-48 land borders + 2 sea routes (AK-WA,
// HI-CA) + 17 US-Canada crossings + 11 intra-Canada = 135 undirected edges.
var EXPECTED_EDGES = { "north-america": 135 };

function validateMap(map) {
  var errors = [];
  if (!map || typeof map !== "object") return ["map is not an object"];

  var t = map.territories;
  if (!Array.isArray(t)) return ["territories is not an array"];
  if (t.length !== 60) errors.push("expected 60 territories, found " + t.length);

  var byId = {};
  t.forEach(function (terr) {
    if (!terr.id) { errors.push("territory missing id"); return; }
    if (byId[terr.id]) errors.push("duplicate id: " + terr.id);
    byId[terr.id] = terr;
    if (!terr.name) errors.push(terr.id + ": missing name");
    if (!terr.label) errors.push(terr.id + ": missing label");
    if (!terr.path) errors.push(terr.id + ": missing path");
    if (!Array.isArray(terr.anchor) || terr.anchor.length !== 2) errors.push(terr.id + ": bad anchor");
    if (!Array.isArray(terr.adjacent) || terr.adjacent.length === 0) errors.push(terr.id + ": empty adjacency");
  });

  // adjacency references + symmetry (the #1 hand-editing bug)
  var edgeCount = 0;
  t.forEach(function (terr) {
    (terr.adjacent || []).forEach(function (other) {
      edgeCount++;
      if (other === terr.id) errors.push(terr.id + ": adjacent to itself");
      var o = byId[other];
      if (!o) { errors.push(terr.id + ": adjacent to unknown '" + other + "'"); return; }
      if ((o.adjacent || []).indexOf(terr.id) === -1) {
        errors.push("asymmetric adjacency: " + terr.id + " -> " + other + " but not back");
      }
    });
  });
  if (edgeCount % 2 !== 0) errors.push("odd directed-edge count " + edgeCount + " (asymmetry)");
  var undirected = edgeCount / 2;
  if (EXPECTED_EDGES[map.id] != null && undirected !== EXPECTED_EDGES[map.id]) {
    errors.push("expected " + EXPECTED_EDGES[map.id] + " edges, found " + undirected);
  }

  // connectivity — every round must be winnable from anywhere
  if (t.length && Object.keys(byId).length === t.length) {
    var seen = {};
    var queue = [t[0].id];
    seen[t[0].id] = true;
    while (queue.length) {
      var cur = byId[queue.pop()];
      (cur.adjacent || []).forEach(function (n) {
        if (!seen[n] && byId[n]) { seen[n] = true; queue.push(n); }
      });
    }
    var reached = Object.keys(seen).length;
    if (reached !== t.length) errors.push("graph not connected: reached " + reached + "/" + t.length);
  }

  // every visual link must be a real adjacency (links are rendering metadata only)
  (map.links || []).forEach(function (l) {
    var a = byId[l.from], b = byId[l.to];
    if (!a || !b) { errors.push("link references unknown territory: " + l.from + "-" + l.to); return; }
    if (a.adjacent.indexOf(l.to) === -1) errors.push("link " + l.from + "-" + l.to + " missing from adjacency");
  });

  if (!map.viewBox || typeof map.viewBox.w !== "number") errors.push("missing/bad viewBox");
  return errors;
}

/** Validates every map in the registry; throws (refusing boot) if any playable map is broken. */
function validateAllOrThrow(maps) {
  var ok = [];
  Object.keys(maps).forEach(function (id) {
    var errs = validateMap(maps[id]);
    if (errs.length) {
      throw new Error("Map '" + id + "' failed validation:\n  - " + errs.join("\n  - "));
    }
    ok.push(id);
  });
  if (ok.length === 0) throw new Error("No playable maps found");
  return ok;
}

module.exports = { validateMap: validateMap, validateAllOrThrow: validateAllOrThrow, EXPECTED_EDGES: EXPECTED_EDGES };

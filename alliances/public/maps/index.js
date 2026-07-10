/*
 * Node-side map registry. The BROWSER does not load this file — index.html includes each
 * map module as its own <script> tag and they self-register on window.ALLIANCES_MAPS.
 * Missing maps warn instead of crashing so the server stays bootable while maps are
 * still being authored; validate-maps.js decides what is actually playable.
 */
"use strict";

var MAP_IDS = ["north-america", "hexfield", "riven-realm"];
var maps = {};

MAP_IDS.forEach(function (id) {
  try {
    maps[id] = require("./" + id + ".js");
  } catch (e) {
    console.warn("[maps] not available: " + id + " (" + e.message + ")");
  }
});

module.exports = maps;

/*
 * setup.js — round setup: deal territories + distribute the 240 value points.
 * Pure: takes territory ids + player count + an injectable randInt so tests
 * are deterministic. Production callers omit randInt and get crypto randomness.
 */
"use strict";

var crypto = require("crypto");

var TOTAL_VALUE = 240; // map total — constant forever ("defender absorbs")
var SOFT_CAP = 8;      // setup-time cap only; battle absorbs may exceed it

function defaultRandInt(maxExclusive) {
  return crypto.randomInt(maxExclusive);
}

/*
 * Fisher-Yates deal: each seat gets exactly 60/n territories, all start at
 * value 1, then each seat's remaining budget (240/n - 60/n) is scattered one
 * point at a time into random owned territories below the soft cap. The cap is
 * always satisfiable: worst case (n=2) needs 90 extra points across 30
 * territories with 7 spare capacity each (210).
 */
function deal(territoryIds, playerCount, randInt) {
  randInt = randInt || defaultRandInt;
  if (!Array.isArray(territoryIds) || territoryIds.length !== 60) {
    throw new Error("setup.deal: expected exactly 60 territory ids");
  }
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 6) {
    throw new Error("setup.deal: playerCount must be 2..6");
  }

  var ids = territoryIds.slice();
  for (var i = ids.length - 1; i > 0; i--) {
    var j = randInt(i + 1);
    var tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
  }

  var perSeat = 60 / playerCount;
  var territories = {};
  ids.forEach(function (id, idx) {
    territories[id] = { owner: Math.floor(idx / perSeat), value: 1 };
  });

  var budget = TOTAL_VALUE / playerCount - perSeat;
  for (var seat = 0; seat < playerCount; seat++) {
    var own = ids.slice(seat * perSeat, (seat + 1) * perSeat);
    for (var k = 0; k < budget; k++) {
      var open = own.filter(function (id) { return territories[id].value < SOFT_CAP; });
      territories[open[randInt(open.length)]].value += 1;
    }
  }

  assertInvariants(territories, playerCount);
  return territories;
}

// Asserted at round start; they hold forever after by construction of battle math.
function assertInvariants(territories, playerCount) {
  var sum = 0;
  var perSeatValue = {};
  var perSeatCount = {};
  for (var id in territories) {
    var t = territories[id];
    if (t.value < 1) throw new Error("setup invariant: " + id + " below value 1");
    sum += t.value;
    perSeatValue[t.owner] = (perSeatValue[t.owner] || 0) + t.value;
    perSeatCount[t.owner] = (perSeatCount[t.owner] || 0) + 1;
  }
  if (sum !== TOTAL_VALUE) throw new Error("setup invariant: total " + sum + " !== " + TOTAL_VALUE);
  for (var seat = 0; seat < playerCount; seat++) {
    if (perSeatValue[seat] !== TOTAL_VALUE / playerCount) {
      throw new Error("setup invariant: seat " + seat + " value " + perSeatValue[seat]);
    }
    if (perSeatCount[seat] !== 60 / playerCount) {
      throw new Error("setup invariant: seat " + seat + " count " + perSeatCount[seat]);
    }
  }
}

module.exports = {
  deal: deal,
  assertInvariants: assertInvariants,
  TOTAL_VALUE: TOTAL_VALUE,
  SOFT_CAP: SOFT_CAP
};

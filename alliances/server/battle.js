/*
 * battle.js — dice + resolution math. The server rolls ALL dice (crypto-random)
 * so DevTools can't cheat and every client animates identical rolls.
 *
 * Rules (designer revision, playtest 1): attacker rolls (value-1) d6, defender
 * rolls (value) d6, higher total wins, tie goes to the DEFENDER. Defeated
 * troops are ELIMINATED from the board:
 *   - attacker wins:  attacking territory -> 1, attacked territory -> (A - 1)
 *                     and flips — the defenders are wiped out, the attacking
 *                     force marches in.
 *   - attacker loses: attacking territory -> 1, attacked territory UNCHANGED —
 *                     the attacking force is wiped out where it stood.
 * The map's total force starts at 240 and only ever shrinks; every territory
 * still holds at least 1.
 */
"use strict";

var crypto = require("crypto");

function defaultRandInt(maxExclusive) {
  return crypto.randomInt(maxExclusive);
}

function rollDice(count, randInt) {
  var dice = [];
  for (var i = 0; i < count; i++) dice.push(1 + randInt(6));
  return dice;
}

function sum(arr) {
  var s = 0;
  for (var i = 0; i < arr.length; i++) s += arr[i];
  return s;
}

/*
 * Applies the resolution to round.territories atomically and returns the
 * attack_resolved broadcast payload. Caller has already validated legality.
 */
function resolveAttack(round, fromId, toId, randInt) {
  randInt = randInt || defaultRandInt;
  var from = round.territories[fromId];
  var to = round.territories[toId];
  var attackerSeat = from.owner;
  var defenderSeat = to.owner;
  var a = from.value;
  var d = to.value;

  var attackerDice = rollDice(a - 1, randInt);
  var defenderDice = rollDice(d, randInt);
  var attackerTotal = sum(attackerDice);
  var defenderTotal = sum(defenderDice);
  var won = attackerTotal > defenderTotal; // tie -> defender

  from.value = 1;
  if (won) {
    to.value = a - 1;   // the attacking force (minus the garrison) marches in
    to.owner = attackerSeat;
  }
  // on a loss the defender stands untouched — the attackers are simply gone

  return {
    from: fromId,
    to: toId,
    attackerSeat: attackerSeat,
    defenderSeat: defenderSeat,
    attackerDice: attackerDice,
    defenderDice: defenderDice,
    attackerTotal: attackerTotal,
    defenderTotal: defenderTotal,
    won: won,
    fromAfter: { owner: from.owner, value: from.value },
    toAfter: { owner: to.owner, value: to.value }
  };
}

module.exports = {
  rollDice: rollDice,
  resolveAttack: resolveAttack
};

/* ============================================================
   30 - Card System
   Deck creation, shuffling, card value calculation, card DOM
   ============================================================ */

var CardSystem = (function () {
  'use strict';

  var SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
  var SUIT_SYMBOLS = { hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663', spades: '\u2660' };
  var SUIT_COLORS = { hearts: 'red', diamonds: 'red', clubs: 'black', spades: 'black' };
  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var RANK_VALUES = {
    'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
    '8': 8, '9': 9, '10': 10, 'J': 10, 'Q': 10, 'K': 10
  };

  function createDeck() {
    var deck = [];
    for (var s = 0; s < SUITS.length; s++) {
      for (var r = 0; r < RANKS.length; r++) {
        deck.push({
          suit: SUITS[s],
          rank: RANKS[r],
          value: RANK_VALUES[RANKS[r]],
          symbol: SUIT_SYMBOLS[SUITS[s]],
          color: SUIT_COLORS[SUITS[s]]
        });
      }
    }
    return deck;
  }

  // Fisher-Yates shuffle
  function shuffle(deck) {
    var arr = deck.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = arr[i];
      arr[i] = arr[j];
      arr[j] = temp;
    }
    return arr;
  }

  function handTotal(cards) {
    var total = 0;
    for (var i = 0; i < cards.length; i++) {
      total += cards[i].value;
    }
    return total;
  }

  return {
    createDeck: createDeck,
    shuffle: shuffle,
    handTotal: handTotal
  };
})();

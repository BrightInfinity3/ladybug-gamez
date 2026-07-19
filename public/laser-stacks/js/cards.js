/* ============================================================
   Laser Stacks - Card System
   Deck creation, shuffling, suit ranking, trick comparison
   ============================================================ */

var CardSystem = (function () {
  'use strict';

  var SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
  var SUIT_SYMBOLS = { hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663', spades: '\u2660' };
  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  // ---- Laser Stacks Suit Ranking (low to high) ----
  // Diamonds (worst) < Hearts < Spades < Clubs (best)
  var SUIT_RANK = { diamonds: 0, hearts: 1, spades: 2, clubs: 3 };
  var SUIT_ORDER = ['diamonds', 'hearts', 'spades', 'clubs'];

  // Card rank order for trick comparison (2=2 low, A=14 high — aces trump kings)
  var RANK_ORDER = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
    '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
  };

  function createDeck() {
    var deck = [];
    for (var s = 0; s < SUITS.length; s++) {
      for (var r = 0; r < RANKS.length; r++) {
        deck.push({
          suit: SUITS[s],
          rank: RANKS[r],
          symbol: SUIT_SYMBOLS[SUITS[s]]
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

  // Compare two cards for trick winning:
  // Higher suit rank wins. Within same suit, higher card rank wins.
  function compareCards(a, b) {
    if (SUIT_RANK[a.suit] !== SUIT_RANK[b.suit]) {
      return SUIT_RANK[a.suit] - SUIT_RANK[b.suit];
    }
    return RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
  }

  // Sort a hand by suit rank (low to high), then by card rank
  function sortHand(cards) {
    return cards.slice().sort(function (a, b) {
      if (SUIT_RANK[a.suit] !== SUIT_RANK[b.suit]) {
        return SUIT_RANK[a.suit] - SUIT_RANK[b.suit];
      }
      return RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
    });
  }

  return {
    createDeck: createDeck,
    shuffle: shuffle,
    compareCards: compareCards,
    sortHand: sortHand,
    SUITS: SUITS,
    RANKS: RANKS,
    SUIT_SYMBOLS: SUIT_SYMBOLS,
    SUIT_RANK: SUIT_RANK,
    SUIT_ORDER: SUIT_ORDER,
    RANK_ORDER: RANK_ORDER
  };
})();

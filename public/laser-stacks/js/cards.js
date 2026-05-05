/* ============================================================
   Laser Stacks - Card System
   Deck creation, shuffling, suit ranking, trick comparison
   ============================================================ */

var CardSystem = (function () {
  'use strict';

  var SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
  var SUIT_SYMBOLS = { hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663', spades: '\u2660' };
  var SUIT_COLORS = { hearts: 'red', diamonds: 'red', clubs: 'black', spades: 'black' };
  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  // Original values (kept for compatibility)
  var RANK_VALUES = {
    'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
    '8': 8, '9': 9, '10': 10, 'J': 10, 'Q': 10, 'K': 10
  };

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

  // Create a card DOM element
  function createCardEl(card, faceUp) {
    var el = document.createElement('div');
    el.className = 'card suit-' + card.color;
    if (faceUp) el.classList.add('flipped');

    // Front face
    var face = document.createElement('div');
    face.className = 'card-face';

    // Top-left corner
    var tlCorner = document.createElement('div');
    tlCorner.className = 'card-corner card-corner-tl';
    tlCorner.innerHTML = '<span class="card-rank">' + card.rank + '</span>' +
                         '<span class="card-suit-small">' + card.symbol + '</span>';
    face.appendChild(tlCorner);

    // Bottom-right corner
    var brCorner = document.createElement('div');
    brCorner.className = 'card-corner card-corner-br';
    brCorner.innerHTML = '<span class="card-rank">' + card.rank + '</span>' +
                         '<span class="card-suit-small">' + card.symbol + '</span>';
    face.appendChild(brCorner);

    // Center suit
    var center = document.createElement('div');
    center.className = 'card-center-suit';
    center.textContent = card.symbol;
    face.appendChild(center);

    el.appendChild(face);

    // Back side
    var back = document.createElement('div');
    back.className = 'card-back-side';
    el.appendChild(back);

    // Store card data on element
    el._card = card;

    return el;
  }

  // Create a mini card for results display
  function createMiniCardEl(card) {
    var el = document.createElement('div');
    el.className = 'result-mini-card suit-' + card.color;
    el.innerHTML = '<span>' + card.rank + '</span><span>' + card.symbol + '</span>';
    return el;
  }

  return {
    createDeck: createDeck,
    shuffle: shuffle,
    handTotal: handTotal,
    compareCards: compareCards,
    sortHand: sortHand,
    createCardEl: createCardEl,
    createMiniCardEl: createMiniCardEl,
    SUITS: SUITS,
    RANKS: RANKS,
    RANK_VALUES: RANK_VALUES,
    SUIT_SYMBOLS: SUIT_SYMBOLS,
    SUIT_RANK: SUIT_RANK,
    SUIT_ORDER: SUIT_ORDER,
    RANK_ORDER: RANK_ORDER
  };
})();

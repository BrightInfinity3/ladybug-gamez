/* ============================================================
   Solitairra - Card System
   Deck creation, shuffling, card helpers for Klondike solitaire
   ============================================================ */

var CardSystem = (function () {
  'use strict';

  var SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
  var SUIT_SYMBOLS = { hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663', spades: '\u2660' };
  var SUIT_COLORS = { hearts: 'green', diamonds: 'blue', clubs: 'black', spades: 'red' };

  // Standard (no face cards) ranks
  var RANKS_STANDARD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
  var RANK_INDEX_STANDARD = {
    '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
    '8': 8, '9': 9, '10': 10
  };

  // Face card ranks (A replaces 1, adds J/Q/K)
  var RANKS_FACE = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var RANK_INDEX_FACE = {
    'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
    '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13
  };

  // Active mode (default: no face cards)
  var faceCardMode = false;

  // Dynamic accessors
  function getRanks() { return faceCardMode ? RANKS_FACE : RANKS_STANDARD; }
  function getRankIndex() { return faceCardMode ? RANK_INDEX_FACE : RANK_INDEX_STANDARD; }
  function getMaxRank() { return faceCardMode ? 13 : 10; }
  function getHighestRank() { return faceCardMode ? 'K' : '10'; }
  function getNumColumns() { return faceCardMode ? 7 : 6; }
  var RANKS = RANKS_STANDARD; // legacy alias, updated by setFaceCardMode
  var RANK_INDEX = RANK_INDEX_STANDARD; // legacy alias

  function setFaceCardMode(enabled) {
    faceCardMode = !!enabled;
    RANKS = faceCardMode ? RANKS_FACE : RANKS_STANDARD;
    RANK_INDEX = faceCardMode ? RANK_INDEX_FACE : RANK_INDEX_STANDARD;
  }

  function getFaceCardMode() { return faceCardMode; }

  function createDeck() {
    var ranks = getRanks();
    var rankIdx = getRankIndex();
    var deck = [];
    for (var s = 0; s < SUITS.length; s++) {
      for (var r = 0; r < ranks.length; r++) {
        deck.push({
          suit: SUITS[s],
          rank: ranks[r],
          value: rankIdx[ranks[r]],
          symbol: SUIT_SYMBOLS[SUITS[s]],
          color: SUIT_COLORS[SUITS[s]],
          rankIndex: rankIdx[ranks[r]]
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

  // Check if two cards have opposite colors
  function oppositeColor(card1, card2) {
    return card1.color !== card2.color;
  }

  // Create a card DOM element (used for results display)
  function createCardEl(card, faceUp) {
    var el = document.createElement('div');
    el.className = 'card suit-' + card.color;
    if (faceUp) el.classList.add('flipped');

    var face = document.createElement('div');
    face.className = 'card-face';

    var tlCorner = document.createElement('div');
    tlCorner.className = 'card-corner card-corner-tl';
    tlCorner.innerHTML = '<span class="card-rank">' + card.rank + '</span>' +
                         '<span class="card-suit-small">' + card.symbol + '</span>';
    face.appendChild(tlCorner);

    var brCorner = document.createElement('div');
    brCorner.className = 'card-corner card-corner-br';
    brCorner.innerHTML = '<span class="card-rank">' + card.rank + '</span>' +
                         '<span class="card-suit-small">' + card.symbol + '</span>';
    face.appendChild(brCorner);

    var center = document.createElement('div');
    center.className = 'card-center-suit';
    center.textContent = card.symbol;
    face.appendChild(center);

    el.appendChild(face);

    var back = document.createElement('div');
    back.className = 'card-back-side';
    el.appendChild(back);

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
    oppositeColor: oppositeColor,
    createCardEl: createCardEl,
    createMiniCardEl: createMiniCardEl,
    setFaceCardMode: setFaceCardMode,
    getFaceCardMode: getFaceCardMode,
    getRanks: getRanks,
    getRankIndex: getRankIndex,
    getMaxRank: getMaxRank,
    getHighestRank: getHighestRank,
    getNumColumns: getNumColumns,
    SUITS: SUITS,
    get RANKS() { return RANKS; },
    get RANK_INDEX() { return RANK_INDEX; },
    SUIT_SYMBOLS: SUIT_SYMBOLS,
    SUIT_COLORS: SUIT_COLORS
  };
})();

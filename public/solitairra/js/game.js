/* ============================================================
   Solitairra - Game Logic
   Klondike solitaire state management and move validation
   Foundations ordered: Diamonds, Hearts, Spades, Clubs
   ============================================================ */

var Game = (function () {
  'use strict';

  // Foundation suit order: left to right (Diodes, Prisms, Blades, Clubs)
  var FOUNDATION_SUITS = ['diamonds', 'hearts', 'spades', 'clubs'];

  // Suit hierarchy for tableau stacking (higher number = must be placed on top)
  // Diode(4) > Prism(3) > Blade(2) > Club(1)
  var SUIT_RANK = { diamonds: 4, hearts: 3, spades: 2, clubs: 1 };

  // ---- State ----
  var state = {
    stock: [],              // cards in stock pile (face down)
    waste: [],              // cards in waste pile (face up)
    foundations: [[], [], [], []], // 0=clubs, 1=spades, 2=hearts, 3=diamonds
    tableau: [],            // 7 arrays of { card, faceUp }
    moves: 0,
    gameOver: false,
    won: false,
    stuck: false
  };

  // ---- New Game ----
  function newGame() {
    var deck = CardSystem.shuffle(CardSystem.createDeck());
    var numCols = CardSystem.getNumColumns();
    state.stock = [];
    state.waste = [];
    state.foundations = [[], [], [], []];
    state.tableau = [];
    state.moves = 0;
    state.gameOver = false;
    state.won = false;
    state.stuck = false;

    // Deal tableau columns:
    //   No face cards (6 cols): column i gets i+1 cards (0-5 hidden + 1 face up)
    //   Face cards (7 cols): column i gets i+1 cards (0-6 hidden + 1 face up)
    for (var i = 0; i < numCols; i++) {
      state.tableau[i] = [];
      var numCards = i + 1;
      for (var j = 0; j < numCards; j++) {
        state.tableau[i].push({
          card: deck.shift(),
          faceUp: j === numCards - 1
        });
      }
    }

    // Remaining cards go to stock
    state.stock = deck;
  }

  // ---- Stock/Waste ----
  function drawFromStock() {
    if (state.gameOver) return false;

    if (state.stock.length === 0) {
      // Recycle waste back to stock
      if (state.waste.length === 0) return false;
      state.stock = state.waste.slice().reverse();
      state.waste = [];
      state.moves++;
      return 'reset';
    }

    // Draw one card from stock to waste
    state.waste.push(state.stock.pop());
    state.moves++;
    return true;
  }

  // ---- Foundation Helpers ----
  function getFoundationIndex(suit) {
    return FOUNDATION_SUITS.indexOf(suit);
  }

  function canMoveToFoundation(card, foundationIndex) {
    if (card.suit !== FOUNDATION_SUITS[foundationIndex]) return false;
    var pile = state.foundations[foundationIndex];
    if (pile.length === 0) {
      return card.rankIndex === 1; // Only lowest rank (1 or A) can start a foundation
    }
    var top = pile[pile.length - 1];
    return card.rankIndex === top.rankIndex + 1;
  }

  // ---- Tableau Helpers ----
  function canMoveToTableau(card, columnIndex) {
    var col = state.tableau[columnIndex];
    if (col.length === 0) {
      return card.rank === CardSystem.getHighestRank(); // Only highest rank on empty columns
    }
    var topEntry = col[col.length - 1];
    if (!topEntry.faceUp) return false;
    var topCard = topEntry.card;
    if (card.rankIndex !== topCard.rankIndex - 1) return false;
    // Suit hierarchy: can't place a higher-rank suit below a lower-rank suit
    // Diode(4) can't go below anything, Prism(3) can't go below Blade(2) or Club(1), etc.
    if (SUIT_RANK[card.suit] > SUIT_RANK[topCard.suit]) return false;
    return true;
  }

  // ---- Move: Waste to Foundation ----
  function moveWasteToFoundation(foundationIndex) {
    if (state.gameOver) return false;
    if (state.waste.length === 0) return false;
    var card = state.waste[state.waste.length - 1];
    if (!canMoveToFoundation(card, foundationIndex)) return false;
    state.foundations[foundationIndex].push(state.waste.pop());
    state.moves++;
    checkWin();
    return true;
  }

  // ---- Move: Waste to Tableau ----
  function moveWasteToTableau(columnIndex) {
    if (state.gameOver) return false;
    if (state.waste.length === 0) return false;
    var card = state.waste[state.waste.length - 1];
    if (!canMoveToTableau(card, columnIndex)) return false;
    state.tableau[columnIndex].push({ card: state.waste.pop(), faceUp: true });
    state.moves++;
    return true;
  }

  // ---- Move: Tableau to Tableau ----
  function moveTableauToTableau(fromCol, cardIndex, toCol) {
    if (state.gameOver) return false;
    var from = state.tableau[fromCol];
    if (cardIndex < 0 || cardIndex >= from.length) return false;
    if (!from[cardIndex].faceUp) return false;

    var movingCard = from[cardIndex].card;
    if (!canMoveToTableau(movingCard, toCol)) return false;

    // Move all cards from cardIndex onward
    var movingCards = from.splice(cardIndex);
    for (var i = 0; i < movingCards.length; i++) {
      state.tableau[toCol].push(movingCards[i]);
    }

    // Flip new top card
    flipTopCard(fromCol);
    state.moves++;
    return true;
  }

  // ---- Move: Tableau to Foundation ----
  function moveTableauToFoundation(colIndex, foundationIndex) {
    if (state.gameOver) return false;
    var col = state.tableau[colIndex];
    if (col.length === 0) return false;
    var topEntry = col[col.length - 1];
    if (!topEntry.faceUp) return false;
    if (!canMoveToFoundation(topEntry.card, foundationIndex)) return false;

    state.foundations[foundationIndex].push(col.pop().card);
    flipTopCard(colIndex);
    state.moves++;
    checkWin();
    return true;
  }

  // ---- Flip face-down top card ----
  function flipTopCard(colIndex) {
    var col = state.tableau[colIndex];
    if (col.length > 0 && !col[col.length - 1].faceUp) {
      col[col.length - 1].faceUp = true;
    }
  }

  // ---- Auto-move: find foundation for a card ----
  function findAutoFoundation(card) {
    var fi = getFoundationIndex(card.suit);
    if (canMoveToFoundation(card, fi)) return fi;
    return -1;
  }

  // ---- Win Check ----
  function checkWin() {
    // Game won when highest rank of Diodes (diamonds) is placed on its foundation
    var winRank = CardSystem.getHighestRank();
    var diamondPile = state.foundations[0];
    if (diamondPile.length > 0 && diamondPile[diamondPile.length - 1].rank === winRank) {
      state.won = true;
      state.gameOver = true;
    }
  }

  // ---- Score Calculation ----
  // Score = saved_prisms*1 + saved_blades*2 + saved_combiners*3
  // Lower is better; 0 is a perfect game (all cards placed)
  function calculateScore() {
    var maxPerSuit = CardSystem.getMaxRank(); // 10 or 13
    var savedP = maxPerSuit - state.foundations[1].length;
    var savedB = maxPerSuit - state.foundations[2].length;
    var savedC = maxPerSuit - state.foundations[3].length;
    return savedP * 1 + savedB * 2 + savedC * 3;
  }

  function getFoundationTopRank(index) {
    var pile = state.foundations[index];
    if (pile.length === 0) return 0;
    return pile[pile.length - 1].rankIndex;
  }

  // ---- Check if any moves remain ----
  function hasMovesRemaining() {
    // Check stock/waste
    if (state.stock.length > 0) return true;

    // Check waste to foundation or tableau
    var numCols = state.tableau.length;
    if (state.waste.length > 0) {
      var wasteCard = state.waste[state.waste.length - 1];
      for (var fi = 0; fi < 4; fi++) {
        if (canMoveToFoundation(wasteCard, fi)) return true;
      }
      for (var ti = 0; ti < numCols; ti++) {
        if (canMoveToTableau(wasteCard, ti)) return true;
      }
    }

    // Check tableau to foundation or tableau
    for (var ci = 0; ci < numCols; ci++) {
      var col = state.tableau[ci];
      if (col.length === 0) continue;

      // Check top card to foundation
      var topEntry = col[col.length - 1];
      if (topEntry.faceUp) {
        for (var fi2 = 0; fi2 < 4; fi2++) {
          if (canMoveToFoundation(topEntry.card, fi2)) return true;
        }
      }

      // Check face-up sequences to other tableau columns
      for (var ci2 = 0; ci2 < col.length; ci2++) {
        if (!col[ci2].faceUp) continue;
        var card = col[ci2].card;
        for (var tj = 0; tj < numCols; tj++) {
          if (tj === ci) continue;
          if (canMoveToTableau(card, tj)) return true;
        }
      }
    }

    // Check if waste can be recycled
    if (state.waste.length > 0 && state.stock.length === 0) {
      // Recycling is possible, check if it would help (simplified: always true)
      return true;
    }

    return false;
  }

  // ---- State Accessors ----
  function getState() { return state; }
  function getMoves() { return state.moves; }
  function isGameOver() { return state.gameOver; }
  function isWon() { return state.won; }
  function getFoundationSuits() { return FOUNDATION_SUITS; }

  // ---- Serialization ----
  function serialize() {
    var data = JSON.parse(JSON.stringify(state));
    data.faceCardMode = CardSystem.getFaceCardMode();
    return data;
  }

  function deserialize(saved) {
    // Restore face card mode before anything else
    if (saved.faceCardMode !== undefined) {
      CardSystem.setFaceCardMode(saved.faceCardMode);
    }
    state.stock = saved.stock || [];
    state.waste = saved.waste || [];
    state.foundations = saved.foundations || [[], [], [], []];
    state.tableau = saved.tableau || [];
    state.moves = saved.moves || 0;
    state.gameOver = saved.gameOver || false;
    state.won = saved.won || false;
    state.stuck = saved.stuck || false;
  }

  // ---- Dev Mode: Insta-Win ----
  // Places varying amounts on each foundation for a realistic-looking win
  function devWin() {
    var ranks = CardSystem.getRanks();
    var rankIdx = CardSystem.getRankIndex();
    var maxRank = CardSystem.getMaxRank();
    // Diodes: all placed (required for win). Others: random 4-max placed
    var placeCounts = [maxRank]; // diamonds always full
    for (var i = 1; i < 4; i++) {
      placeCounts.push(Math.floor(Math.random() * (maxRank - 3)) + 4);
    }
    for (var fi = 0; fi < 4; fi++) {
      state.foundations[fi] = [];
      var suit = FOUNDATION_SUITS[fi];
      for (var r = 0; r < placeCounts[fi]; r++) {
        state.foundations[fi].push({
          suit: suit,
          rank: ranks[r],
          rankIndex: rankIdx[ranks[r]],
          value: rankIdx[ranks[r]],
          symbol: CardSystem.SUIT_SYMBOLS[suit],
          color: CardSystem.SUIT_COLORS[suit]
        });
      }
    }
    state.tableau = state.tableau.map(function() { return []; });
    state.stock = [];
    state.waste = [];
    state.moves = Math.floor(Math.random() * 80) + 40;
    state.won = true;
    state.gameOver = true;
  }

  return {
    FOUNDATION_SUITS: FOUNDATION_SUITS,
    devWin: devWin,
    newGame: newGame,
    drawFromStock: drawFromStock,
    getFoundationIndex: getFoundationIndex,
    canMoveToFoundation: canMoveToFoundation,
    canMoveToTableau: canMoveToTableau,
    moveWasteToFoundation: moveWasteToFoundation,
    moveWasteToTableau: moveWasteToTableau,
    moveTableauToTableau: moveTableauToTableau,
    moveTableauToFoundation: moveTableauToFoundation,
    findAutoFoundation: findAutoFoundation,
    calculateScore: calculateScore,
    getFoundationTopRank: getFoundationTopRank,
    hasMovesRemaining: hasMovesRemaining,
    getState: getState,
    getMoves: getMoves,
    isGameOver: isGameOver,
    isWon: isWon,
    getFoundationSuits: getFoundationSuits,
    serialize: serialize,
    deserialize: deserialize
  };
})();

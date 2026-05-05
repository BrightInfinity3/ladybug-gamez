/* ============================================================
   Laser Stacks - Game Logic
   Trick-taking card game with suit ranking, bidding, and scoring
   ============================================================ */

var Game = (function () {
  'use strict';

  var CARDS_PER_PLAYER = 9;
  var NUM_PLAYERS = 4;
  var POINTS_PER_STACK = 11;
  var PERFECT_ZERO_BONUS = 99;

  // ---- State ----
  var state = {
    players: [],
    dealerIndex: 0,
    deck: [],
    hands: {},             // playerId -> [cards]
    bids: {},              // playerId -> number (0-9)
    tricksWon: {},         // playerId -> count
    currentTrick: [],      // [{playerId, card}]
    trickNumber: 0,        // 0-8
    unlockedSuits: {},     // suitName -> boolean
    turnOrder: [],         // player IDs in clockwise order from dealer's left
    currentTurnIndex: -1,
    trickLeaderIndex: -1,  // index in turnOrder who leads current trick
    roundPhase: 'idle',    // idle | dealing | bidding | playing | finished
    scores: {},            // playerId -> cumulative total score
    roundScores: {},       // playerId -> score for current round
    roundNumber: 0,
    bidOrder: [],          // order in which players bid (clockwise from dealer's left)
    currentBidIndex: -1,
    lastTrickWinnerId: null, // who won the last trick this round (for tiebreaking)
    roundsWon: {},          // playerId -> count of rounds won
    lastRoundWinnerId: null  // who won the most recent round (for scoreboard tiebreak)
  };

  // ---- Player Factory ----
  function createPlayer(id, seatIndex, animal, name, isHuman, isDealer) {
    return {
      id: id,
      seatIndex: seatIndex,
      animal: animal,
      name: name,
      isHuman: isHuman,
      isDealer: isDealer
    };
  }

  // ---- Setup ----
  function setupGame(players) {
    state.players = players;
    state.scores = {};
    state.roundsWon = {};
    state.lastRoundWinnerId = null;
    state.roundNumber = 0;
    for (var i = 0; i < players.length; i++) {
      state.scores[players[i].id] = 0;
      state.roundsWon[players[i].id] = 0;
    }
  }

  // ---- Build Turn Order ----
  // Clockwise from dealer's left
  function buildTurnOrder() {
    var players = state.players;
    var dealerSeat = players[state.dealerIndex].seatIndex;
    var sorted = players.slice().sort(function (a, b) { return a.seatIndex - b.seatIndex; });

    var dealerPos = -1;
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i].seatIndex === dealerSeat) {
        dealerPos = i;
        break;
      }
    }

    var order = [];
    for (var j = 1; j <= sorted.length; j++) {
      var idx = (dealerPos + j) % sorted.length;
      order.push(sorted[idx].id);
    }
    return order;
  }

  // ---- Build Deal Order (9 cards each, one at a time) ----
  function buildDealOrder() {
    var turnOrder = state.turnOrder;
    var dealOrder = [];
    for (var round = 0; round < CARDS_PER_PLAYER; round++) {
      for (var i = 0; i < turnOrder.length; i++) {
        dealOrder.push(turnOrder[i]);
      }
    }
    return dealOrder;
  }

  // ---- New Round ----
  function newRound() {
    state.roundNumber++;

    state.deck = CardSystem.shuffle(CardSystem.createDeck());
    state.hands = {};
    state.bids = {};
    state.tricksWon = {};
    state.currentTrick = [];
    state.trickNumber = 0;
    state.unlockedSuits = {};

    // Simple clockwise dealing order from first player by seat
    var sorted = state.players.slice().sort(function (a, b) { return a.seatIndex - b.seatIndex; });
    state.turnOrder = sorted.map(function (p) { return p.id; });
    state.bidOrder = state.turnOrder.slice();

    state.currentTurnIndex = -1;
    state.currentBidIndex = -1;
    state.trickLeaderIndex = 0;
    state.roundPhase = 'dealing';
    state.roundScores = {};

    for (var i = 0; i < state.players.length; i++) {
      var pid = state.players[i].id;
      state.hands[pid] = [];
      state.tricksWon[pid] = 0;
    }

    return {
      dealOrder: buildDealOrder(),
      deck: state.deck,
      hands: state.hands
    };
  }

  // ---- Deal a single card to a player ----
  function dealCardTo(playerId) {
    if (state.deck.length === 0) return null;
    var card = state.deck.shift();
    state.hands[playerId].push(card);
    return card;
  }

  // ---- Sort all hands after dealing ----
  function sortAllHands() {
    for (var pid in state.hands) {
      state.hands[pid] = CardSystem.sortHand(state.hands[pid]);
    }
  }

  // ================================================================
  //  BIDDING
  // ================================================================

  function startBidding() {
    state.roundPhase = 'bidding';
    state.currentBidIndex = 0;
  }

  function getCurrentBidder() {
    if (state.currentBidIndex < 0 || state.currentBidIndex >= state.bidOrder.length) return null;
    var id = state.bidOrder[state.currentBidIndex];
    return getPlayerById(id);
  }

  function setBid(playerId, bid) {
    state.bids[playerId] = Math.max(0, Math.min(9, bid));
  }

  function advanceBid() {
    state.currentBidIndex++;
    if (state.currentBidIndex >= state.bidOrder.length) {
      return null; // all bids in
    }
    return getCurrentBidder();
  }

  function allBidsIn() {
    return state.currentBidIndex >= state.bidOrder.length;
  }

  // AI bidding: estimate tricks based on hand strength
  function aiBid(playerId) {
    var hand = state.hands[playerId];
    var estimate = 0;

    for (var i = 0; i < hand.length; i++) {
      var card = hand[i];
      var suitRank = CardSystem.SUIT_RANK[card.suit];
      var cardRank = CardSystem.RANK_ORDER[card.rank];

      // Clubs (rank 3) are almost guaranteed winners
      if (suitRank === 3) {
        if (cardRank >= 8) estimate += 1;
        else if (cardRank >= 5) estimate += 0.6;
        else estimate += 0.3;
      }
      // Spades (rank 2) win unless clubs are played
      else if (suitRank === 2) {
        if (cardRank >= 10) estimate += 0.7;
        else if (cardRank >= 7) estimate += 0.3;
      }
      // Hearts (rank 1) win if no spades/clubs
      else if (suitRank === 1) {
        if (cardRank >= 11) estimate += 0.3;
      }
      // Diamonds (rank 0) rarely win
    }

    var bid = Math.round(estimate);
    // Add some randomness
    if (Math.random() < 0.2) bid += (Math.random() < 0.5 ? 1 : -1);
    bid = Math.max(0, Math.min(9, bid));

    return bid;
  }

  // ================================================================
  //  PLAYING
  // ================================================================

  function startPlaying() {
    state.roundPhase = 'playing';
    state.trickNumber = 0;
    state.trickLeaderIndex = 0;
    state.currentTurnIndex = state.trickLeaderIndex;
    state.currentTrick = [];
  }

  function getCurrentPlayer() {
    if (state.currentTurnIndex < 0 || state.roundPhase !== 'playing') return null;
    var id = state.turnOrder[state.currentTurnIndex];
    return getPlayerById(id);
  }

  function getPlayerById(id) {
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].id === id) return state.players[i];
    }
    return null;
  }

  function getPlayerIndex(id) {
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].id === id) return i;
    }
    return -1;
  }

  // ---- Get Lead Suit ----
  function getLeadSuit() {
    if (state.currentTrick.length === 0) return null;
    return state.currentTrick[0].card.suit;
  }

  // ---- Get Legal Plays ----
  function getLegalPlays(playerId) {
    var hand = state.hands[playerId];
    if (!hand || hand.length === 0) return [];

    if (state.currentTrick.length === 0) {
      return getLeadingLegalPlays(playerId);
    } else {
      return getFollowingLegalPlays(playerId);
    }
  }

  function getLeadingLegalPlays(playerId) {
    var hand = state.hands[playerId];
    var suitOrder = CardSystem.SUIT_ORDER;

    if (state.trickNumber === 0) {
      // First trick: must play lowest suit available
      for (var s = 0; s < suitOrder.length; s++) {
        var indices = getCardsOfSuit(hand, suitOrder[s]);
        if (indices.length > 0) return indices;
      }
    } else {
      // Subsequent tricks: can play any unlocked suit
      var legalCards = [];
      for (var i = 0; i < hand.length; i++) {
        if (state.unlockedSuits[hand[i].suit]) {
          legalCards.push(i);
        }
      }
      if (legalCards.length > 0) return legalCards;

      // No unlocked suits: play lowest available suit (unlocks it)
      for (var s2 = 0; s2 < suitOrder.length; s2++) {
        var idx = getCardsOfSuit(hand, suitOrder[s2]);
        if (idx.length > 0) return idx;
      }
    }

    // Fallback: any card
    return hand.map(function (_, i) { return i; });
  }

  function getFollowingLegalPlays(playerId) {
    var hand = state.hands[playerId];
    var leadSuit = getLeadSuit();
    var leadSuitRank = CardSystem.SUIT_RANK[leadSuit];
    var suitOrder = CardSystem.SUIT_ORDER;

    // Must follow suit: if you have the lead suit, you must play it
    var sameSuit = getCardsOfSuit(hand, leadSuit);
    if (sameSuit.length > 0) return sameSuit;

    // Don't have lead suit: try lower ranked suit
    var legalCards = [];
    for (var i = 0; i < hand.length; i++) {
      if (CardSystem.SUIT_RANK[hand[i].suit] < leadSuitRank) {
        legalCards.push(i);
      }
    }
    if (legalCards.length > 0) return legalCards;

    // Can't play same or lower: play next higher suit available
    for (var s = leadSuitRank + 1; s < suitOrder.length; s++) {
      var indices = getCardsOfSuit(hand, suitOrder[s]);
      if (indices.length > 0) return indices;
    }

    // Fallback: any card
    return hand.map(function (_, i) { return i; });
  }

  function getCardsOfSuit(hand, suit) {
    var indices = [];
    for (var i = 0; i < hand.length; i++) {
      if (hand[i].suit === suit) indices.push(i);
    }
    return indices;
  }

  // ---- Play a Card ----
  function playCard(playerId, cardIndex) {
    var card = state.hands[playerId][cardIndex];
    state.hands[playerId].splice(cardIndex, 1);
    state.currentTrick.push({ playerId: playerId, card: card });

    // Unlock the suit
    state.unlockedSuits[card.suit] = true;

    return card;
  }

  // ---- Advance to Next Player in Trick ----
  function advanceTrickTurn() {
    // Check if trick is complete (all players have played)
    if (state.currentTrick.length >= state.players.length) {
      return null; // trick complete
    }

    state.currentTurnIndex = (state.currentTurnIndex + 1) % state.turnOrder.length;
    return getCurrentPlayer();
  }

  // ---- Determine Trick Winner ----
  function determineTrickWinner() {
    if (state.currentTrick.length === 0) return null;

    var bestIdx = 0;
    for (var i = 1; i < state.currentTrick.length; i++) {
      if (CardSystem.compareCards(state.currentTrick[i].card, state.currentTrick[bestIdx].card) > 0) {
        bestIdx = i;
      }
    }

    var winnerId = state.currentTrick[bestIdx].playerId;
    state.tricksWon[winnerId] = (state.tricksWon[winnerId] || 0) + 1;
    state.lastTrickWinnerId = winnerId;

    return winnerId;
  }

  // ---- Finish Trick and Set Up Next ----
  function finishTrick(winnerId) {
    state.trickNumber++;
    state.currentTrick = [];

    if (state.trickNumber >= CARDS_PER_PLAYER) {
      state.roundPhase = 'finished';
      calculateRoundScores();
      return null; // round over
    }

    // Winner leads next trick
    for (var i = 0; i < state.turnOrder.length; i++) {
      if (state.turnOrder[i] === winnerId) {
        state.trickLeaderIndex = i;
        break;
      }
    }
    state.currentTurnIndex = state.trickLeaderIndex;

    return getCurrentPlayer();
  }

  // ---- Find Player with Lowest Card (for determining first leader) ----
  function findLowestCardPlayer() {
    var lowestPlayerId = null;
    var lowestCard = null;

    for (var i = 0; i < state.players.length; i++) {
      var pid = state.players[i].id;
      var hand = state.hands[pid];

      for (var j = 0; j < hand.length; j++) {
        var card = hand[j];
        if (lowestCard === null || CardSystem.compareCards(card, lowestCard) < 0) {
          lowestCard = card;
          lowestPlayerId = pid;
        }
      }
    }

    return { playerId: lowestPlayerId, card: lowestCard };
  }

  // ---- Set first leader and rebuild turn/bid order clockwise from them ----
  function setFirstLeader(leaderId) {
    var sorted = state.players.slice().sort(function (a, b) { return a.seatIndex - b.seatIndex; });

    var leaderPos = -1;
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i].id === leaderId) {
        leaderPos = i;
        break;
      }
    }

    var order = [];
    for (var j = 0; j < sorted.length; j++) {
      var idx = (leaderPos + j) % sorted.length;
      order.push(sorted[idx].id);
    }

    state.turnOrder = order;
    state.bidOrder = order.slice();
    state.trickLeaderIndex = 0;
  }

  // ================================================================
  //  SCORING
  // ================================================================

  function calculateRoundScores() {
    state.roundScores = {};

    for (var i = 0; i < state.players.length; i++) {
      var pid = state.players[i].id;
      var bid = state.bids[pid] || 0;
      var won = state.tricksWon[pid] || 0;
      var score = 0;

      if (bid === 0 && won === 0) {
        // Perfect zero: bonus!
        score = PERFECT_ZERO_BONUS;
      } else if (won < bid) {
        // Didn't meet bid: score 0
        score = 0;
      } else if (won === bid) {
        // Met bid exactly
        score = won * POINTS_PER_STACK;
      } else {
        // Went over: earn points for bid amount, lose compiling penalty
        var base = bid * POINTS_PER_STACK;
        var overage = won - bid;
        // Penalty: 11 for 1st over, 22 for 2nd, 33 for 3rd, etc.
        var penalty = 0;
        for (var p = 1; p <= overage; p++) {
          penalty += p * POINTS_PER_STACK;
        }
        score = base - penalty;
      }

      // Minimum score per round is 0
      score = Math.max(0, score);
      state.roundScores[pid] = score;
      state.scores[pid] = (state.scores[pid] || 0) + score;
    }

    // Determine round winner with tiebreaking
    var roundWinnerId = determineRoundWinner();
    if (roundWinnerId !== null) {
      state.roundsWon[roundWinnerId] = (state.roundsWon[roundWinnerId] || 0) + 1;
      state.lastRoundWinnerId = roundWinnerId;
    }
  }

  // ---- Round Winner Tiebreaking ----
  // Priority: 1) perfect zero (bid 0 won 0), 2) least gap bid-won, 3) most stacks, 4) last stack winner
  function determineRoundWinner() {
    var bestScore = -1;
    for (var i = 0; i < state.players.length; i++) {
      var rs = state.roundScores[state.players[i].id] || 0;
      if (rs > bestScore) bestScore = rs;
    }
    if (bestScore <= 0) return null;

    // Collect players tied for the top round score
    var candidates = [];
    for (var j = 0; j < state.players.length; j++) {
      if ((state.roundScores[state.players[j].id] || 0) === bestScore) {
        candidates.push(state.players[j].id);
      }
    }
    if (candidates.length === 1) return candidates[0];

    // Tiebreak 1: perfect zero (bid 0, won 0) beats all
    var perfectZeros = candidates.filter(function (pid) {
      return state.bids[pid] === 0 && (state.tricksWon[pid] || 0) === 0;
    });
    if (perfectZeros.length === 1) return perfectZeros[0];
    if (perfectZeros.length > 1) candidates = perfectZeros;

    // Tiebreak 2: least gap between bid and won
    var minGap = Infinity;
    for (var k = 0; k < candidates.length; k++) {
      var gap = Math.abs((state.tricksWon[candidates[k]] || 0) - (state.bids[candidates[k]] || 0));
      if (gap < minGap) minGap = gap;
    }
    var leastGap = candidates.filter(function (pid) {
      return Math.abs((state.tricksWon[pid] || 0) - (state.bids[pid] || 0)) === minGap;
    });
    if (leastGap.length === 1) return leastGap[0];
    candidates = leastGap;

    // Tiebreak 3: most stacks won
    var maxWon = -1;
    for (var m = 0; m < candidates.length; m++) {
      var w = state.tricksWon[candidates[m]] || 0;
      if (w > maxWon) maxWon = w;
    }
    var mostStacks = candidates.filter(function (pid) {
      return (state.tricksWon[pid] || 0) === maxWon;
    });
    if (mostStacks.length === 1) return mostStacks[0];
    candidates = mostStacks;

    // Tiebreak 4: whoever won the last stack of the round
    if (state.lastTrickWinnerId !== null && candidates.indexOf(state.lastTrickWinnerId) !== -1) {
      return state.lastTrickWinnerId;
    }

    // Still tied: return first candidate
    return candidates[0];
  }

  // ================================================================
  //  AI PLAY
  // ================================================================

  function aiPlayCard(playerId) {
    var hand = state.hands[playerId];
    var legalIndices = getLegalPlays(playerId);
    if (legalIndices.length === 0) return -1;

    var bid = state.bids[playerId] || 0;
    var won = state.tricksWon[playerId] || 0;
    var needMore = won < bid;
    var atBid = won === bid;
    var overBid = won > bid;

    // Sort legal plays by card strength
    var sortedLegal = legalIndices.slice().sort(function (a, b) {
      return CardSystem.compareCards(hand[a], hand[b]);
    });

    if (state.currentTrick.length === 0) {
      // Leading: if need more wins, lead high; if at/over bid, lead low
      if (needMore) {
        return sortedLegal[sortedLegal.length - 1]; // highest
      } else {
        return sortedLegal[0]; // lowest
      }
    } else {
      // Following
      if (needMore) {
        // Try to win: play highest card
        return sortedLegal[sortedLegal.length - 1];
      } else if (atBid || overBid) {
        // Try to lose: play lowest card
        return sortedLegal[0];
      } else {
        // Default: play middle card
        return sortedLegal[Math.floor(sortedLegal.length / 2)];
      }
    }
  }

  // ================================================================
  //  STATE ACCESSORS
  // ================================================================

  function getState() { return state; }
  function getHand(playerId) { return state.hands[playerId]; }
  function getScores() { return state.scores; }
  function getRoundScores() { return state.roundScores; }
  function getBids() { return state.bids; }
  function getTricksWon() { return state.tricksWon; }
  function getDeckCount() { return state.deck.length; }
  function getRoundNumber() { return state.roundNumber; }
  function getTrickNumber() { return state.trickNumber; }
  function getCurrentTrick() { return state.currentTrick; }
  function getUnlockedSuits() { return state.unlockedSuits; }
  function isRoundFinished() { return state.roundPhase === 'finished'; }
  function getRoundsWon() { return state.roundsWon; }
  function getLastRoundWinnerId() { return state.lastRoundWinnerId; }
  function getLastTrickWinnerId() { return state.lastTrickWinnerId; }
  function isLastTrick() { return state.trickNumber === CARDS_PER_PLAYER - 1; }

  // ---- Serialization ----
  function serialize() {
    return JSON.parse(JSON.stringify(state));
  }

  function deserialize(saved) {
    state.players = saved.players;
    state.dealerIndex = saved.dealerIndex;
    state.deck = saved.deck;
    state.hands = saved.hands;
    state.bids = saved.bids || {};
    state.tricksWon = saved.tricksWon || {};
    state.currentTrick = saved.currentTrick || [];
    state.trickNumber = saved.trickNumber || 0;
    state.unlockedSuits = saved.unlockedSuits || {};
    state.turnOrder = saved.turnOrder;
    state.currentTurnIndex = saved.currentTurnIndex;
    state.trickLeaderIndex = saved.trickLeaderIndex || 0;
    state.roundPhase = saved.roundPhase;
    state.scores = saved.scores;
    state.roundScores = saved.roundScores || {};
    state.roundNumber = saved.roundNumber;
    state.bidOrder = saved.bidOrder || saved.turnOrder;
    state.currentBidIndex = saved.currentBidIndex || 0;
    state.lastTrickWinnerId = saved.lastTrickWinnerId || null;
    state.roundsWon = saved.roundsWon || {};
    state.lastRoundWinnerId = saved.lastRoundWinnerId || null;
  }

  return {
    CARDS_PER_PLAYER: CARDS_PER_PLAYER,
    NUM_PLAYERS: NUM_PLAYERS,
    POINTS_PER_STACK: POINTS_PER_STACK,
    createPlayer: createPlayer,
    setupGame: setupGame,
    newRound: newRound,
    dealCardTo: dealCardTo,
    sortAllHands: sortAllHands,
    startBidding: startBidding,
    getCurrentBidder: getCurrentBidder,
    setBid: setBid,
    advanceBid: advanceBid,
    allBidsIn: allBidsIn,
    aiBid: aiBid,
    startPlaying: startPlaying,
    getCurrentPlayer: getCurrentPlayer,
    getPlayerById: getPlayerById,
    getPlayerIndex: getPlayerIndex,
    getLeadSuit: getLeadSuit,
    getLegalPlays: getLegalPlays,
    playCard: playCard,
    advanceTrickTurn: advanceTrickTurn,
    determineTrickWinner: determineTrickWinner,
    finishTrick: finishTrick,
    aiPlayCard: aiPlayCard,
    findLowestCardPlayer: findLowestCardPlayer,
    setFirstLeader: setFirstLeader,
    getState: getState,
    getHand: getHand,
    getScores: getScores,
    getRoundScores: getRoundScores,
    getBids: getBids,
    getTricksWon: getTricksWon,
    getDeckCount: getDeckCount,
    getRoundNumber: getRoundNumber,
    getTrickNumber: getTrickNumber,
    getCurrentTrick: getCurrentTrick,
    getUnlockedSuits: getUnlockedSuits,
    isRoundFinished: isRoundFinished,
    getRoundsWon: getRoundsWon,
    getLastRoundWinnerId: getLastRoundWinnerId,
    getLastTrickWinnerId: getLastTrickWinnerId,
    isLastTrick: isLastTrick,
    serialize: serialize,
    deserialize: deserialize
  };
})();

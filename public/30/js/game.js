/* ============================================================
   30 - Game Logic
   State management, turn flow, AI, winner determination
   ============================================================ */

var Game = (function () {
  'use strict';

  // ---- State ----
  var state = {
    players: [],           // array of player objects
    dealerIndex: 0,        // which player is dealer
    deck: [],
    hands: {},             // playerId -> { cards, stayed, busted, lastDrawOrder }
    turnOrder: [],          // player ids in play order
    currentTurnIndex: -1,
    roundPhase: 'idle',    // 'idle' | 'dealing' | 'playing' | 'finished'
    scores: {},            // playerId -> win count
    lastWinRound: {},      // playerId -> round number of most recent win
    roundNumber: 0,
    drawCounter: 0         // global draw counter for tiebreaker
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
  function setupGame(players, dealerIndex) {
    state.players = players;
    // Use the dealer chosen during setup. Fall back to a random dealer only
    // if the caller didn't pass one (defensive).
    if (typeof dealerIndex === 'number' && dealerIndex >= 0 && dealerIndex < players.length) {
      state.dealerIndex = dealerIndex;
    } else {
      state.dealerIndex = Math.floor(Math.random() * players.length);
    }
    state.scores = {};
    state.lastWinRound = {};
    state.roundNumber = 0;
    // Set isDealer flags
    for (var i = 0; i < players.length; i++) {
      players[i].isDealer = (i === state.dealerIndex);
      state.scores[players[i].id] = 0;
      state.lastWinRound[players[i].id] = 0;
    }
  }

  // ---- Build Turn Order ----
  // Play order: the player immediately clockwise from the dealer acts
  // first; play continues clockwise; dealer goes last.
  //
  // Seat layout (slot 0=bottom, 1=BL, 2=L, 3=TL, 4=T, 5=TR, 6=R, 7=BR).
  // The next slot index up from the dealer is the player one position
  // clockwise around the felt — e.g. dealer at slot 0 (bottom) → slot 1
  // (bottom-left) acts first; dealer at slot 6 (right) → slot 7
  // (bottom-right) acts first. We only consider OCCUPIED seats, so
  // unfilled slots are skipped naturally by sorting + indexing.
  function buildTurnOrder() {
    var players = state.players;
    var dealerSeat = players[state.dealerIndex].seatIndex;

    // Sort occupied players by seat index ascending
    var sorted = players.slice().sort(function (a, b) { return a.seatIndex - b.seatIndex; });

    // Find dealer position in sorted list
    var dealerPos = -1;
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i].seatIndex === dealerSeat) {
        dealerPos = i;
        break;
      }
    }

    // Walk forward from dealer+1 around the ring; dealer goes last.
    var order = [];
    for (var j = 1; j <= sorted.length; j++) {
      var idx = (dealerPos + j) % sorted.length;
      order.push(sorted[idx].id);
    }

    return order;
  }

  // ---- Deal Order ----
  function buildDealOrder() {
    var turnOrder = state.turnOrder;
    var dealOrder = [];
    for (var round = 0; round < 3; round++) {
      for (var i = 0; i < turnOrder.length; i++) {
        dealOrder.push(turnOrder[i]);
      }
    }
    return dealOrder;
  }

  // ---- New Round ----
  function newRound() {
    state.roundNumber++;

    // After round 1, rotate dealer clockwise
    if (state.roundNumber > 1) {
      state.dealerIndex = (state.dealerIndex + 1) % state.players.length;
    }
    // Update isDealer flags on all players
    for (var d = 0; d < state.players.length; d++) {
      state.players[d].isDealer = (d === state.dealerIndex);
    }

    state.deck = CardSystem.shuffle(CardSystem.createDeck());
    state.hands = {};
    state.turnOrder = buildTurnOrder();
    state.currentTurnIndex = -1;
    state.roundPhase = 'dealing';
    state.drawCounter = 0;

    for (var i = 0; i < state.players.length; i++) {
      state.hands[state.players[i].id] = {
        cards: [],
        stayed: false,
        busted: false,
        lastDrawOrder: -1
      };
    }

    return {
      dealOrder: buildDealOrder(),
      deck: state.deck,
      hands: state.hands
    };
  }

  // ---- Deal a single card to a player (called during deal animation) ----
  function dealCardTo(playerId) {
    if (state.deck.length === 0) return null;
    var card = state.deck.shift();
    state.hands[playerId].cards.push(card);
    return card;
  }

  // ---- Start Playing Phase ----
  function startPlaying() {
    state.roundPhase = 'playing';
    state.currentTurnIndex = 0;
    skipFinished();
    return getCurrentPlayer();
  }

  // ---- Get Current Player ----
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

  // ---- Player Actions ----
  function drawCard(playerId) {
    if (state.deck.length === 0) {
      // No cards left — force stay
      return { action: 'forced_stay', card: null, total: CardSystem.handTotal(state.hands[playerId].cards), busted: false };
    }
    var card = state.deck.shift();
    var hand = state.hands[playerId];
    hand.cards.push(card);

    // Track draw order for tiebreaker
    state.drawCounter++;
    hand.lastDrawOrder = state.drawCounter;

    var total = CardSystem.handTotal(hand.cards);
    var busted = total > 30;
    if (busted) {
      hand.busted = true;
    }
    return { action: 'draw', card: card, total: total, busted: busted };
  }

  /** Stay: lock in hand permanently */
  function stay(playerId) {
    var hand = state.hands[playerId];
    hand.stayed = true;
    return { action: 'stay', total: CardSystem.handTotal(hand.cards) };
  }

  // ---- AI Decision ----
  // Smart AI: considers bust probability from remaining deck, position relative
  // to opponents, threats still to act after us, and tiebreaker implications.
  function aiDecision(playerId) {
    var hand = state.hands[playerId];
    var total = CardSystem.handTotal(hand.cards);

    // Never stay into a guaranteed loss — forced draw
    if (stayWouldLose(playerId)) return 'draw';

    // Calculate bust probability from actual remaining deck cards
    var room = 30 - total; // max card value we can safely draw
    var bustCards = 0;
    for (var i = 0; i < state.deck.length; i++) {
      if (state.deck[i].value > room) bustCards++;
    }
    var bustProb = state.deck.length > 0 ? bustCards / state.deck.length : 1;

    // No bust possible (deck has no too-big cards left) — always draw
    if (bustCards === 0 && state.deck.length > 0 && total < 30) return 'draw';

    // Find best opponent score and evaluate threats
    var bestOpponentTotal = 0;
    var activeOpponents = 0;    // opponents who haven't stayed/busted yet
    var catchUpThreats = 0;     // weighted count of opponents who can plausibly catch up

    for (var j = 0; j < state.turnOrder.length; j++) {
      var jid = state.turnOrder[j];
      if (jid === playerId) continue;
      var jh = state.hands[jid];
      if (jh.busted) continue;
      var jt = CardSystem.handTotal(jh.cards);
      if (jt > bestOpponentTotal) bestOpponentTotal = jt;
      if (!jh.stayed) {
        activeOpponents++;
        // "Catch-up threat": can this opponent plausibly beat us?
        // gainNeeded = points they need to strictly beat our total
        var gainNeeded = total - jt + 1;
        var theirRoom = 30 - jt;
        if (gainNeeded <= 0) {
          // They already meet/beat us (stayWouldLose catches the loss case above)
          catchUpThreats += 1;
        } else if (gainNeeded <= theirRoom && gainNeeded <= 10) {
          // They can catch up in a single draw (card value 1-10) — serious threat
          catchUpThreats += 1;
        } else if (gainNeeded <= theirRoom) {
          // Needs multiple draws — weaker threat
          catchUpThreats += 0.5;
        }
      }
    }

    var lead = total - bestOpponentTotal;

    // Pick a bust-probability threshold based on lead and remaining threats.
    // More threats still to act → lower tolerance for staying on a thin lead.
    var threshold;
    if (lead >= 5) {
      // Huge lead — only draw if very safe
      threshold = 0.20;
    } else if (lead >= 3) {
      // Comfortable lead — mildly more willing if threats remain
      threshold = catchUpThreats >= 2 ? 0.35 : 0.25;
    } else if (lead >= 1) {
      // Thin lead — scale aggressiveness with number of realistic threats
      threshold = catchUpThreats >= 2 ? 0.50
                : catchUpThreats >= 1 ? 0.45
                : 0.30; // no threats left — lock it in
    } else {
      // Tied or behind — draw aggressively since staying likely loses
      threshold = 0.55;
    }

    return bustProb <= threshold ? 'draw' : 'stay';
  }

  // ---- Advance Turn ----
  function advanceTurn() {
    state.currentTurnIndex = (state.currentTurnIndex + 1) % state.turnOrder.length;

    // Check if all players are done
    if (allDone()) {
      state.roundPhase = 'finished';
      return null;
    }

    // Skip finished players (stayed or busted)
    skipFinished();

    if (allDone()) {
      state.roundPhase = 'finished';
      return null;
    }

    return getCurrentPlayer();
  }

  function skipFinished() {
    var count = 0;
    while (count < state.turnOrder.length) {
      var id = state.turnOrder[state.currentTurnIndex];
      var hand = state.hands[id];
      // Skip players who stayed or busted
      if (!hand.stayed && !hand.busted) break;
      state.currentTurnIndex = (state.currentTurnIndex + 1) % state.turnOrder.length;
      count++;
    }
  }

  function allDone() {
    for (var i = 0; i < state.turnOrder.length; i++) {
      var id = state.turnOrder[i];
      var hand = state.hands[id];
      // A player is "done" if they stayed or busted
      if (!hand.stayed && !hand.busted) return false;
    }
    return true;
  }

  // ---- Force Finish (for natural 30) ----
  function forceFinish() {
    for (var i = 0; i < state.turnOrder.length; i++) {
      var id = state.turnOrder[i];
      state.hands[id].stayed = true;
    }
    state.roundPhase = 'finished';
  }

  // ---- Check for Natural 30 ----
  function checkNatural30() {
    var found = false;
    for (var i = 0; i < state.turnOrder.length; i++) {
      var id = state.turnOrder[i];
      var total = CardSystem.handTotal(state.hands[id].cards);
      if (total === 30) {
        found = true;
        break;
      }
    }
    return found;
  }

  // ---- Determine Winner ----
  function determineWinner() {
    var eligible = [];
    for (var i = 0; i < state.turnOrder.length; i++) {
      var id = state.turnOrder[i];
      var hand = state.hands[id];
      var total = CardSystem.handTotal(hand.cards);
      if (!hand.busted && total <= 30) {
        eligible.push({
          playerId: id,
          total: total,
          cardCount: hand.cards.length,
          lastDrawOrder: hand.lastDrawOrder,
          position: i  // fallback position in turn order
        });
      }
    }

    if (eligible.length === 0) return null; // Everyone busted

    eligible.sort(function (a, b) {
      // Closest to 30 (higher is better)
      if (b.total !== a.total) return b.total - a.total;
      // More cards wins
      if (a.cardCount !== b.cardCount) return b.cardCount - a.cardCount;
      // Most recent draw wins (higher drawOrder = later = wins)
      var aOrder = a.lastDrawOrder >= 0 ? a.lastDrawOrder : -(999999 - a.position);
      var bOrder = b.lastDrawOrder >= 0 ? b.lastDrawOrder : -(999999 - b.position);
      return bOrder - aOrder;
    });

    var winner = eligible[0];

    // Determine tiebreaker explanation
    var tiebreaker = '';
    if (eligible.length > 1 && eligible[1].total === winner.total) {
      if (eligible[1].cardCount !== winner.cardCount) {
        tiebreaker = 'Won with more cards';
      } else {
        tiebreaker = 'Won by drawing most recently';
      }
    }

    // Update scores and last win round
    state.scores[winner.playerId] = (state.scores[winner.playerId] || 0) + 1;
    state.lastWinRound[winner.playerId] = state.roundNumber;

    return {
      winnerId: winner.playerId,
      total: winner.total,
      cardCount: winner.cardCount,
      tiebreaker: tiebreaker
    };
  }

  // ---- Get Results (sorted by ranking) ----
  function getResults() {
    var results = [];
    for (var i = 0; i < state.turnOrder.length; i++) {
      var id = state.turnOrder[i];
      var hand = state.hands[id];
      var player = getPlayerById(id);
      results.push({
        player: player,
        cards: hand.cards.slice(),
        total: CardSystem.handTotal(hand.cards),
        busted: hand.busted,
        stayed: hand.stayed,
        lastDrawOrder: hand.lastDrawOrder,
        position: i
      });
    }

    // Sort by ranking: non-busted first by total desc, then cardCount desc, then drawOrder desc
    results.sort(function (a, b) {
      // Busted always last
      if (a.busted !== b.busted) return a.busted ? 1 : -1;
      if (a.busted && b.busted) return b.total - a.total; // higher bust = less bad
      // Non-busted: closest to 30
      if (b.total !== a.total) return b.total - a.total;
      // More cards wins
      if (a.cards.length !== b.cards.length) return b.cards.length - a.cards.length;
      // Most recent draw wins
      var aOrder = a.lastDrawOrder >= 0 ? a.lastDrawOrder : -(999999 - a.position);
      var bOrder = b.lastDrawOrder >= 0 ? b.lastDrawOrder : -(999999 - b.position);
      return bOrder - aOrder;
    });

    return results;
  }

  // ---- Smart End Helpers ----

  /**
   * Would staying guarantee a loss for this player?
   * Checks against ALL non-busted opponents (stayed or still active),
   * since an active player can always choose to stay at their current total.
   * Uses full tiebreaker chain: total > card count > draw order.
   */
  function stayWouldLose(playerId) {
    var myHand = state.hands[playerId];
    var myTotal = CardSystem.handTotal(myHand.cards);
    var myCards = myHand.cards.length;
    var myPosition = state.turnOrder.indexOf(playerId);

    for (var i = 0; i < state.turnOrder.length; i++) {
      var id = state.turnOrder[i];
      if (id === playerId) continue;
      var hand = state.hands[id];
      if (hand.busted) continue;

      var total = CardSystem.handTotal(hand.cards);
      // Higher total beats us
      if (total > myTotal) return true;
      if (total < myTotal) continue;

      // Same total — more cards beats us
      if (hand.cards.length > myCards) return true;
      if (hand.cards.length < myCards) continue;

      // Same total, same card count — more recent draw beats us
      var theirDrawOrder = hand.lastDrawOrder >= 0 ? hand.lastDrawOrder : -(999999 - i);
      var myEffective = myHand.lastDrawOrder >= 0 ? myHand.lastDrawOrder : -(999999 - myPosition);
      if (theirDrawOrder > myEffective) return true;
    }
    return false;
  }

  /**
   * Should the round auto-end for this player?
   * True if they are the only active (non-stayed, non-busted) player
   * AND staying would win (not lose to any stayed player).
   */
  function shouldAutoEnd(playerId) {
    var activeCount = 0;
    for (var i = 0; i < state.turnOrder.length; i++) {
      var id = state.turnOrder[i];
      var hand = state.hands[id];
      if (!hand.stayed && !hand.busted) activeCount++;
    }
    if (activeCount !== 1) return false;

    // Only auto-end if staying would actually win
    return !stayWouldLose(playerId);
  }

  // ---- State Accessors ----
  function getState() { return state; }
  function getHand(playerId) { return state.hands[playerId]; }
  function getScores() { return state.scores; }
  function getLastWinRounds() { return state.lastWinRound; }
  function getDeckCount() { return state.deck.length; }
  function getRoundNumber() { return state.roundNumber; }
  function isRoundFinished() { return state.roundPhase === 'finished'; }

  // ---- Serialization (for save/load) ----
  function serialize() {
    return JSON.parse(JSON.stringify(state));
  }

  function deserialize(saved) {
    state.players = saved.players;
    state.dealerIndex = saved.dealerIndex;
    state.deck = saved.deck;
    state.hands = saved.hands;
    state.turnOrder = saved.turnOrder;
    state.currentTurnIndex = saved.currentTurnIndex;
    state.roundPhase = saved.roundPhase;
    state.scores = saved.scores;
    state.lastWinRound = saved.lastWinRound || {};
    state.roundNumber = saved.roundNumber;
    state.drawCounter = saved.drawCounter || 0;

    // Migrate old save formats
    for (var key in state.hands) {
      var h = state.hands[key];
      if (h.passed !== undefined && h.stayed === undefined) {
        h.stayed = h.passed;
        delete h.passed;
      }
      // Remove old passedLastTurn field if present
      delete h.passedLastTurn;
      if (h.lastDrawOrder === undefined) h.lastDrawOrder = -1;
    }
  }

  return {
    createPlayer: createPlayer,
    setupGame: setupGame,
    newRound: newRound,
    dealCardTo: dealCardTo,
    startPlaying: startPlaying,
    getCurrentPlayer: getCurrentPlayer,
    getPlayerById: getPlayerById,
    getPlayerIndex: getPlayerIndex,
    drawCard: drawCard,
    stay: stay,
    aiDecision: aiDecision,
    advanceTurn: advanceTurn,
    forceFinish: forceFinish,
    checkNatural30: checkNatural30,
    determineWinner: determineWinner,
    getResults: getResults,
    getState: getState,
    getHand: getHand,
    getScores: getScores,
    getLastWinRounds: getLastWinRounds,
    getDeckCount: getDeckCount,
    getRoundNumber: getRoundNumber,
    isRoundFinished: isRoundFinished,
    stayWouldLose: stayWouldLose,
    shouldAutoEnd: shouldAutoEnd,
    serialize: serialize,
    deserialize: deserialize
  };
})();

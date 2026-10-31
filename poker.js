// Core Texas Hold'em logic: deck, hand evaluation, equity estimate.
// Works in the browser (global `Poker`) and in Node (module.exports).
(function (root) {
  const RANK_CHARS = '23456789TJQKA';
  const SUIT_CHARS = ['♠', '♥', '♦', '♣'];
  const HAND_NAMES = [
    'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
    'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
  ];

  // A card is { r: 2..14, s: 0..3 }
  function newDeck() {
    const deck = [];
    for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) deck.push({ r, s });
    return deck;
  }

  function shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  function cardLabel(c) {
    return (c.r === 10 ? '10' : RANK_CHARS[c.r - 2]) + SUIT_CHARS[c.s];
  }

  // Score a 5-card hand. Returns an array: [category, tiebreakers...].
  // Larger arrays (compared lexicographically) are better hands.
  function evaluate5(cards) {
    const counts = {};
    for (const c of cards) counts[c.r] = (counts[c.r] || 0) + 1;
    // Groups sorted by count desc, then rank desc.
    const groups = Object.keys(counts)
      .map(r => ({ r: +r, n: counts[r] }))
      .sort((a, b) => b.n - a.n || b.r - a.r);
    const ranks = groups.map(g => g.r);

    const flush = cards.every(c => c.s === cards[0].s);
    let straightHigh = 0;
    if (groups.length === 5) {
      if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
      else if (ranks[0] === 14 && ranks[1] === 5) straightHigh = 5; // A-2-3-4-5
    }

    if (straightHigh && flush) return [8, straightHigh];
    if (groups[0].n === 4) return [7, ...ranks];
    if (groups[0].n === 3 && groups[1].n === 2) return [6, ...ranks];
    if (flush) return [5, ...ranks];
    if (straightHigh) return [4, straightHigh];
    if (groups[0].n === 3) return [3, ...ranks];
    if (groups[0].n === 2 && groups[1].n === 2) return [2, ...ranks];
    if (groups[0].n === 2) return [1, ...ranks];
    return [0, ...ranks];
  }

  function compareScores(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] || 0) - (b[i] || 0);
      if (d !== 0) return d;
    }
    return 0;
  }

  // Best 5-card score from any 5-7 cards (tries every 5-card combination).
  function bestHand(cards) {
    let best = null;
    const n = cards.length;
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++)
        for (let c = b + 1; c < n; c++)
          for (let d = c + 1; d < n; d++)
            for (let e = d + 1; e < n; e++) {
              const s = evaluate5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
              if (!best || compareScores(s, best) > 0) best = s;
            }
    return best;
  }

  function handName(score) {
    return HAND_NAMES[score[0]];
  }

  // Estimate the chance `hole` beats one random opponent hand,
  // given the known board. Ties count as half.
  // On the river the answer is exact: every possible opponent hand is checked.
  function estimateEquity(hole, board, iterations = 400) {
    const known = new Set([...hole, ...board].map(c => c.r * 4 + c.s));
    const rest = newDeck().filter(c => !known.has(c.r * 4 + c.s));
    let score = 0;
    if (board.length === 5) {
      const mine = bestHand(hole.concat(board));
      let n = 0;
      for (let a = 0; a < rest.length; a++)
        for (let b = a + 1; b < rest.length; b++, n++) {
          const cmp = compareScores(mine, bestHand([rest[a], rest[b]].concat(board)));
          score += cmp > 0 ? 1 : cmp === 0 ? 0.5 : 0;
        }
      return score / n;
    }
    for (let i = 0; i < iterations; i++) {
      // Partial shuffle: we only need 2 + (5 - board.length) cards.
      const need = 2 + (5 - board.length);
      for (let k = 0; k < need; k++) {
        const j = k + Math.floor(Math.random() * (rest.length - k));
        [rest[k], rest[j]] = [rest[j], rest[k]];
      }
      const opp = [rest[0], rest[1]];
      const fullBoard = board.concat(rest.slice(2, need));
      const cmp = compareScores(bestHand(hole.concat(fullBoard)), bestHand(opp.concat(fullBoard)));
      score += cmp > 0 ? 1 : cmp === 0 ? 0.5 : 0;
    }
    return score / iterations;
  }

  const api = { newDeck, shuffle, cardLabel, evaluate5, bestHand, compareScores, handName, estimateEquity };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Poker = api;
})(this);

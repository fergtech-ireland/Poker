// Heads-up Texas Hold'em: You vs Computer. No-limit betting.
(function () {
  const START_CHIPS = 1000;
  const SMALL_BLIND = 10;
  const BIG_BLIND = 20;
  const STREETS = ['Pre-flop', 'Flop', 'Turn', 'River'];
  const YOU = 0, CPU = 1;
  const NAMES = ['You', 'Computer'];
  const STATS_KEY = 'holdem-stats';

  const $ = id => document.getElementById(id);

  // ---------- Stats (saved in the browser) ----------
  let stats = loadStats();

  function loadStats() {
    try {
      const s = JSON.parse(localStorage.getItem(STATS_KEY));
      if (s && typeof s.wins === 'number') return s;
    } catch (e) { /* ignore */ }
    return { wins: 0, losses: 0, ties: 0 };
  }

  function saveStats() {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  }

  function renderStats() {
    const played = stats.wins + stats.losses + stats.ties;
    $('stat-played').textContent = played;
    $('stat-wins').textContent = stats.wins;
    $('stat-losses').textContent = stats.losses;
    $('stat-ties').textContent = stats.ties;
    $('stat-pct').textContent = played ? (stats.wins / played * 100).toFixed(1) + '%' : '0.0%';
  }

  // ---------- Game state ----------
  const g = {
    chips: [START_CHIPS, START_CHIPS],
    dealer: YOU,        // dealer posts the small blind
    deck: [],
    hole: [[], []],
    board: [],
    bets: [0, 0],       // chips put in on the current street
    contrib: [0, 0],    // chips put in this hand
    acted: [false, false],
    minRaise: 0,        // size of the last full bet/raise this round (the next raise must be at least this)
    street: 0,
    toAct: YOU,
    handOver: true,
    showCpu: false,
  };

  const other = p => 1 - p;
  const pot = () => g.contrib[0] + g.contrib[1];

  function log(msg) {
    const li = document.createElement('li');
    li.textContent = msg;
    $('log').prepend(li);
  }

  function commit(p, amount) {
    amount = Math.min(amount, g.chips[p]);
    g.chips[p] -= amount;
    g.bets[p] += amount;
    g.contrib[p] += amount;
    return amount;
  }

  function startHand() {
    if (g.chips[YOU] === 0 || g.chips[CPU] === 0) {
      log(`${g.chips[YOU] === 0 ? 'You are' : 'The computer is'} out of chips. Chip stacks reset.`);
      g.chips = [START_CHIPS, START_CHIPS];
    }
    g.deck = Poker.shuffle(Poker.newDeck());
    g.hole = [[g.deck.pop(), g.deck.pop()], [g.deck.pop(), g.deck.pop()]];
    g.board = [];
    g.bets = [0, 0];
    g.contrib = [0, 0];
    g.street = 0;
    g.handOver = false;
    g.showCpu = false;
    g.equity = []; // your win chance after each deal: [{ street, pct }]
    $('message').textContent = '';
    $('next-btn').hidden = true;
    $('log').innerHTML = '';

    const sb = g.dealer, bb = other(g.dealer);
    commit(sb, SMALL_BLIND);
    commit(bb, BIG_BLIND);
    log(`New hand. ${NAMES[sb]} post${sb === YOU ? '' : 's'} the small blind (${SMALL_BLIND}), ` +
        `${NAMES[bb]} post${bb === YOU ? '' : 's'} the big blind (${BIG_BLIND}).`);
    log(`Your cards: ${g.hole[YOU].map(Poker.cardLabel).join(' ')}. ${updateEquity()}`);
    g.acted = [false, false];
    g.minRaise = BIG_BLIND;
    g.toAct = sb; // heads-up: small blind acts first pre-flop
    proceed();
  }

  // What can player p do right now? Amounts are "bet/raise to" totals for this round.
  function options(p) {
    const o = other(p);
    const top = g.bets[o];
    const toCall = Math.max(0, top - g.bets[p]);
    const callAmt = Math.min(toCall, g.chips[p]);
    // Heads-up, betting more than the opponent can match is pointless, so the most is their stack.
    const max = Math.min(g.bets[p] + g.chips[p], g.bets[o] + g.chips[o]);
    const min = Math.min(max, top === 0 ? BIG_BLIND : top + g.minRaise);
    return {
      toCall, callAmt, top, min, max,
      canRaise: max > top && g.chips[o] > 0,
      allIn: max === g.bets[p] + g.chips[p],
      isBet: top === 0, pot: pot(), current: g.bets[p],
    };
  }

  // action: 'fold' | 'call' (check/call) | 'raise' (amount = bet/raise to) | 'allin'
  function act(p, action, amount) {
    if (g.handOver || g.toAct !== p) return;
    const o = other(p), opt = options(p);
    const who = NAMES[p];
    const s = p === YOU ? '' : 's';
    if (action === 'allin') { action = opt.canRaise ? 'raise' : 'call'; amount = opt.max; }
    if (action === 'raise' && !opt.canRaise) action = 'call';
    if (action === 'raise') {
      amount = amount == null ? opt.min : Math.floor(amount);
      if (!(amount <= opt.max && (amount >= opt.min || amount === opt.max))) return; // not a legal amount
    }

    if (action === 'fold') {
      log(`${who} fold${s}.`);
      return endHand(o, `${who === 'You' ? 'You' : 'The computer'} folded.`);
    }
    const allInNote = () => (g.chips[p] === 0 ? ' (all in)' : '');
    if (action === 'call') {
      if (opt.toCall === 0) log(`${who} check${s}.`);
      else { const c = commit(p, opt.callAmt); log(`${who} call${s} ${c}${allInNote()}.`); }
      g.acted[p] = true;
    } else if (action === 'raise') {
      if (amount - opt.top >= g.minRaise) g.minRaise = amount - opt.top; // a full raise sets the new minimum
      commit(p, amount - g.bets[p]);
      g.acted = [false, false];
      g.acted[p] = true;
      log(`${who} ${opt.isBet ? 'bet' : 'raise'}${s} ${opt.isBet ? '' : 'to '}${g.bets[p]}${allInNote()}.`);
    }

    if (roundComplete()) nextStreet();
    else { g.toAct = o; proceed(); }
  }

  function roundComplete() {
    const allIn = g.chips[0] === 0 || g.chips[1] === 0;
    const done = p => g.acted[p] || g.chips[p] === 0;
    return done(0) && done(1) && (g.bets[0] === g.bets[1] || allIn);
  }

  function dealStreet() {
    g.street++;
    const n = g.street === 1 ? 3 : 1;
    for (let i = 0; i < n; i++) g.board.push(g.deck.pop());
    log(`${STREETS[g.street]}: ${g.board.map(Poker.cardLabel).join(' ')}. ${updateEquity()}`);
  }

  // Your chance of winning from here against any hand the computer could hold
  // (its cards are hidden, so they're treated as unknown). Ties count as half.
  function updateEquity() {
    const pct = Math.round(Poker.estimateEquity(g.hole[YOU], g.board, 1500) * 100);
    g.equity.push({ street: STREETS[g.street], pct });
    return `Your win chance: ${pct}%`;
  }

  function nextStreet() {
    if (g.street === 3) return showdown();
    g.bets = [0, 0];
    g.acted = [false, false];
    g.minRaise = BIG_BLIND;
    dealStreet();
    if (g.chips[0] === 0 || g.chips[1] === 0) {
      // Someone is all-in: run out the board.
      while (g.street < 3) dealStreet();
      return showdown();
    }
    g.toAct = other(g.dealer); // big blind acts first after the flop
    proceed();
  }

  function showdown() {
    g.showCpu = true;
    const yours = Poker.bestHand(g.hole[YOU].concat(g.board));
    const theirs = Poker.bestHand(g.hole[CPU].concat(g.board));
    const cmp = Poker.compareScores(yours, theirs);
    const desc = `You: ${Poker.handName(yours)}. Computer: ${Poker.handName(theirs)}.`;
    if (cmp > 0) endHand(YOU, desc);
    else if (cmp < 0) endHand(CPU, desc);
    else endHand(null, desc);
  }

  // winner: YOU, CPU, or null for a split pot
  function endHand(winner, reason) {
    // Return any uncalled chips (e.g. a short-stacked blind).
    const diff = g.contrib[0] - g.contrib[1];
    const big = diff > 0 ? 0 : 1;
    g.chips[big] += Math.abs(diff);
    g.contrib[big] -= Math.abs(diff);

    const total = pot();
    let result;
    if (winner === null) {
      g.chips[0] += Math.floor(total / 2);
      g.chips[1] += total - Math.floor(total / 2);
      stats.ties++;
      result = `Split pot (${total}).`;
    } else {
      g.chips[winner] += total;
      if (winner === YOU) { stats.wins++; result = `You win ${total}!`; }
      else { stats.losses++; result = `Computer wins ${total}.`; }
    }
    g.bets = [0, 0]; // keep contrib so the final pot stays on screen
    g.handOver = true;
    g.dealer = other(g.dealer);
    saveStats();
    log(`${reason} ${result}`);
    $('message').textContent = `${reason} ${result}`;
    $('next-btn').hidden = false;
    render();
  }

  // ---------- Computer player ----------
  function cpuAct() {
    if (g.handOver || g.toAct !== CPU) return;
    const opt = options(CPU);
    const equity = Poker.estimateEquity(g.hole[CPU], g.board, 500);
    const potOdds = opt.toCall / (pot() + opt.toCall);
    const r = Math.random();
    // Bet sizes: a fraction of the pot (after calling), rounded to 5s, within the legal range.
    const size = f => Math.min(opt.max, Math.max(opt.min, Math.round((opt.top + (pot() + opt.toCall) * f) / 5) * 5));
    const shortStack = g.chips[CPU] <= BIG_BLIND * 10;

    if (opt.canRaise && (equity > 0.85 && (r < 0.35 || shortStack))) {
      act(CPU, 'allin');                                  // monster hand: shove
    } else if (opt.canRaise && (equity > 0.72 || (equity > 0.6 && r < 0.45))) {
      act(CPU, 'raise', size(equity > 0.72 ? 0.75 + r * 0.5 : 0.5));   // value bet
    } else if (opt.canRaise && r < 0.06) {
      act(CPU, 'raise', size(0.5));                       // the occasional bluff
    } else if (opt.toCall === 0) {
      act(CPU, 'call');                                   // check
    } else if (equity >= potOdds - 0.05 || (r < 0.08 && opt.toCall <= BIG_BLIND * 3)) {
      act(CPU, 'call');
    } else {
      act(CPU, 'fold');
    }
  }

  // ---------- Rendering ----------
  function cardHTML(c, hidden) {
    if (hidden) return '<div class="card back"></div>';
    const red = c.s === 1 || c.s === 2 ? ' red' : '';
    return `<div class="card${red}">${Poker.cardLabel(c)}</div>`;
  }

  function render() {
    $('your-cards').innerHTML = g.hole[YOU].map(c => cardHTML(c)).join('');
    $('cpu-cards').innerHTML = g.hole[CPU].map(c => cardHTML(c, !g.showCpu)).join('');
    let boardHTML = g.board.map(c => cardHTML(c)).join('');
    for (let i = g.board.length; i < 5; i++) boardHTML += '<div class="card empty"></div>';
    $('board').innerHTML = boardHTML;

    $('your-chips').textContent = g.chips[YOU];
    $('cpu-chips').textContent = g.chips[CPU];
    $('your-bet').textContent = g.bets[YOU] ? `Bet: ${g.bets[YOU]}` : '';
    $('cpu-bet').textContent = g.bets[CPU] ? `Bet: ${g.bets[CPU]}` : '';
    $('your-dealer').hidden = g.dealer !== YOU || g.handOver;
    $('cpu-dealer').hidden = g.dealer !== CPU || g.handOver;
    $('pot').textContent = pot();
    $('street').textContent = g.handOver ? '' : STREETS[g.street];
    $('equity').innerHTML = g.equity.map((e, i) =>
      `<span${i === g.equity.length - 1 ? ' class="now"' : ''}>${i ? '→ ' : ''}${e.street} <b>${e.pct}%</b></span>`
    ).join(' ');

    if (g.showCpu && g.board.length === 5) {
      $('your-hand-name').textContent = Poker.handName(Poker.bestHand(g.hole[YOU].concat(g.board)));
      $('cpu-hand-name').textContent = Poker.handName(Poker.bestHand(g.hole[CPU].concat(g.board)));
    } else {
      $('your-hand-name').textContent = g.hole[YOU].length && g.board.length
        ? Poker.handName(Poker.bestHand(g.hole[YOU].concat(g.board))) : '';
      $('cpu-hand-name').textContent = '';
    }

    const yourTurn = !g.handOver && g.toAct === YOU;
    const opt = options(YOU);
    for (const id of ['fold-btn', 'call-btn', 'raise-btn', 'bet-panel']) $(id).hidden = g.handOver;
    $('fold-btn').disabled = !yourTurn || opt.toCall === 0;
    $('call-btn').disabled = !yourTurn;
    $('call-btn').textContent = opt.toCall === 0 ? 'Check'
      : opt.callAmt === g.chips[YOU] ? `All in ${opt.callAmt}` : `Call ${opt.callAmt}`;
    betPanel.update(yourTurn && opt.canRaise ? { ...opt, bb: BIG_BLIND } : null);
    if (!yourTurn && !g.handOver) $('message').textContent = 'Computer is thinking...';
    else if (yourTurn) $('message').textContent = 'Your move.';
    renderStats();
  }

  function proceed() {
    render();
    if (!g.handOver && g.toAct === CPU) setTimeout(cpuAct, 700);
  }

  // ---------- Wire up buttons ----------
  $('fold-btn').onclick = () => act(YOU, 'fold');
  $('call-btn').onclick = () => act(YOU, 'call');
  // Chips and quick sizes above the action row; the Raise button makes the raise.
  const betPanel = BetPanel.create($('bet-panel'), $('raise-btn'), amount => act(YOU, 'raise', amount));
  $('next-btn').onclick = startHand;
  $('reset-btn').onclick = () => {
    if (!confirm('Reset your wins, losses and win percentage?')) return;
    stats = { wins: 0, losses: 0, ties: 0 };
    saveStats();
    renderStats();
  };

  startHand();
})();

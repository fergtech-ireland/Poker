// Heads-up Texas Hold'em: You vs Computer. Fixed-limit betting.
(function () {
  const START_CHIPS = 1000;
  const SMALL_BLIND = 10;
  const BIG_BLIND = 20;
  const MAX_RAISES = 4; // bet + 3 raises per street
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
    raises: 0,
    street: 0,
    toAct: YOU,
    handOver: true,
    showCpu: false,
  };

  const other = p => 1 - p;
  const pot = () => g.contrib[0] + g.contrib[1];
  const betSize = () => (g.street < 2 ? BIG_BLIND : BIG_BLIND * 2);

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
    g.raises = 1; // the big blind counts as the first bet
    g.toAct = sb; // heads-up: small blind acts first pre-flop
    proceed();
  }

  // What can player p do right now?
  function options(p) {
    const o = other(p);
    const toCall = Math.max(0, g.bets[o] - g.bets[p]);
    const callAmt = Math.min(toCall, g.chips[p]);
    // Never put in more than the opponent can match.
    const target = Math.min(
      g.bets[o] + betSize(),
      g.bets[p] + g.chips[p],
      g.bets[o] + g.chips[o]
    );
    const canRaise = g.raises < MAX_RAISES && target > g.bets[o];
    return { toCall, callAmt, canRaise, raiseTo: target };
  }

  function act(p, action) {
    if (g.handOver || g.toAct !== p) return;
    const o = other(p), opt = options(p);
    const who = NAMES[p];
    const s = p === YOU ? '' : 's';

    if (action === 'fold') {
      log(`${who} fold${s}.`);
      return endHand(o, `${who === 'You' ? 'You' : 'The computer'} folded.`);
    }
    if (action === 'call') {
      if (opt.toCall === 0) log(`${who} check${s}.`);
      else log(`${who} call${s} ${commit(p, opt.callAmt)}.`);
      g.acted[p] = true;
    } else if (action === 'raise' && opt.canRaise) {
      const wasBet = g.bets[o] === 0 && g.bets[p] === 0;
      commit(p, opt.raiseTo - g.bets[p]);
      g.raises++;
      g.acted = [false, false];
      g.acted[p] = true;
      log(`${who} ${wasBet ? 'bet' : 'raise'}${s} ${wasBet ? '' : 'to '}${g.bets[p]}.`);
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
    g.raises = 0;
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
    let action;

    if (opt.canRaise && (equity > 0.75 || (equity > 0.6 && r < 0.5) || r < 0.05)) {
      action = 'raise';             // strong hand, or the occasional bluff
    } else if (opt.toCall === 0) {
      action = 'call';              // check
    } else if (equity >= potOdds - 0.05 || r < 0.1) {
      action = 'call';
    } else {
      action = 'fold';
    }
    act(CPU, action);
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
    for (const id of ['fold-btn', 'call-btn', 'raise-btn']) $(id).hidden = g.handOver;
    $('fold-btn').disabled = !yourTurn || opt.toCall === 0;
    $('call-btn').disabled = !yourTurn;
    $('raise-btn').disabled = !yourTurn || !opt.canRaise;
    $('call-btn').textContent = opt.toCall === 0 ? 'Check' : `Call ${opt.callAmt}`;
    $('raise-btn').textContent =
      (g.bets[CPU] === 0 && g.bets[YOU] === 0 ? 'Bet ' : 'Raise to ') + opt.raiseTo;
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
  $('raise-btn').onclick = () => act(YOU, 'raise');
  $('next-btn').onclick = startHand;
  $('reset-btn').onclick = () => {
    if (!confirm('Reset your wins, losses and win percentage?')) return;
    stats = { wins: 0, losses: 0, ties: 0 };
    saveStats();
    renderStats();
  };

  startHand();
})();

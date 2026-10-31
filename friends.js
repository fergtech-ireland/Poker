// "With Friends" mode: talks to the poker server function and shows the shared table.
(function () {
  const CFG = window.POKER_CONFIG;
  const FN_URL = `${CFG.url}/functions/v1/poker`;
  const SESSION_KEY = 'holdem-friends-session';
  const NAME_KEY = 'holdem-name';
  const STATS_KEY = 'holdem-friends-stats';

  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Local storage ----------
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const store = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  let session = load(SESSION_KEY, null); // { code, token, playerId, counted: [handNo...] }
  let stats = load(STATS_KEY, { wins: 0, losses: 0, ties: 0 });

  function renderStats() {
    const played = stats.wins + stats.losses + stats.ties;
    $('stat-played').textContent = played;
    $('stat-wins').textContent = stats.wins;
    $('stat-losses').textContent = stats.losses;
    $('stat-ties').textContent = stats.ties;
    $('stat-pct').textContent = played ? (stats.wins / played * 100).toFixed(1) + '%' : '0.0%';
  }

  // ---------- Server calls ----------
  async function api(action, extra = {}) {
    const body = { action, ...extra };
    if (session && !body.code) body.code = session.code;
    if (session && !body.token && action !== 'create') body.token = session.token;
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CFG.key },
      body: JSON.stringify(body),
    });
    let data;
    try { data = await res.json(); } catch (e) { throw new Error('Could not reach the game server.'); }
    if (!res.ok || data.error) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  // ---------- State ----------
  let state = null;          // public table state
  let me = null;             // { id, hole, options }
  let clockOffset = 0;       // server time - local time
  let lastServerNow = 0;
  let equity = { key: '', list: [] };
  const serverNow = () => Date.now() + clockOffset;

  function apply(res) {
    if (!res || !res.state) return;
    if (res.state.serverNow < lastServerNow) return; // an older response arrived late
    lastServerNow = res.state.serverNow;
    clockOffset = res.state.serverNow - Date.now();
    state = res.state;
    me = res.me;
    if (!me) { // we're no longer at this table
      endSession('You are no longer at this table.');
      return;
    }
    countResult();
    render();
  }

  // Count each finished hand once in this device's lifetime stats.
  function countResult() {
    const r = state.lastResult;
    if (!r || !r.results || !r.results[me.id]) return;
    session.counted = session.counted || [];
    if (session.counted.includes(r.handNo)) return;
    session.counted.push(r.handNo);
    if (session.counted.length > 50) session.counted.shift();
    const result = r.results[me.id].result;
    if (result === 'won') stats.wins++;
    else if (result === 'tied') stats.ties++;
    else stats.losses++;
    store(STATS_KEY, stats);
    store(SESSION_KEY, session);
    renderStats();
  }

  let refreshing = false, refreshAgain = false;
  async function refresh() {
    if (!session) return;
    if (refreshing) { refreshAgain = true; return; }
    refreshing = true;
    try { apply(await api('state')); }
    catch (e) {
      if (/not found|not at this table/i.test(e.message)) endSession(e.message);
      else setMessage(e.message);
    } finally {
      refreshing = false;
      if (refreshAgain) { refreshAgain = false; refresh(); }
    }
  }

  async function send(action, extra) {
    try { apply(await api(action, extra)); }
    catch (e) { setMessage(e.message); refresh(); }
  }

  // ---------- Live updates ----------
  let channel = null, live = false, pollTimer = null;
  function connectLive() {
    disconnectLive();
    try {
      const client = window.supabase.createClient(CFG.url, CFG.key);
      channel = client.channel('room-' + session.code)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `code=eq.${session.code}` }, () => refresh())
        .subscribe(status => { live = status === 'SUBSCRIBED'; if (live) refresh(); });
      channel._client = client;
    } catch (e) { live = false; }
    // Polling as a safety net: often if live updates aren't working, rarely if they are.
    let last = 0;
    pollTimer = setInterval(() => {
      const every = live ? 15000 : 2500;
      if (Date.now() - last >= every) { last = Date.now(); refresh(); }
    }, 500);
  }
  function disconnectLive() {
    if (channel) { try { channel._client.removeChannel(channel); } catch (e) {} channel = null; }
    if (pollTimer) clearInterval(pollTimer);
    live = false;
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

  // ---------- Automatic next hand & turn timeouts ----------
  let askedNext = '', askedTimeout = '';
  setInterval(() => {
    if (!state || state.status !== 'playing') return renderTimer();
    const h = state.hand;
    const withChips = state.players.filter(p => p.chips > 0 && !p.leaving).length;
    if ((!h || h.over) && withChips >= 2) {
      const ended = state.lastResult ? state.lastResult.endedAt : 0;
      const key = `${h ? h.no : 0}:${Math.floor(serverNow() / 5000)}`;
      if (serverNow() - ended > state.config.NEXT_HAND_SECONDS * 1000 + 300 && askedNext !== key) {
        askedNext = key;
        send('next');
      }
    }
    if (h && !h.over) {
      const key = `${h.no}:${h.toAct}:${h.turnStart}`;
      if (serverNow() - h.turnStart > state.config.TURN_SECONDS * 1000 + 1000 && askedTimeout !== key) {
        askedTimeout = key;
        send('timeout');
      }
    }
    renderTimer();
  }, 1000);

  // ---------- Rendering ----------
  function cardHTML(c, hidden) {
    if (hidden) return '<div class="card back"></div>';
    const red = c.s === 1 || c.s === 2 ? ' red' : '';
    return `<div class="card${red}">${Poker.cardLabel(c)}</div>`;
  }

  function show(view) {
    for (const v of ['home-view', 'lobby-view', 'game-view']) $(v).hidden = v !== view;
    $('loading').hidden = true;
  }

  // Errors stay on screen for a few seconds before the normal status message returns.
  let errorUntil = 0;
  function setMessage(text) {
    errorUntil = Date.now() + 4000;
    if (!$('home-view').hidden) $('home-error').textContent = text;
    $('message').textContent = text;
    setTimeout(() => render(), 4100);
  }

  const playerById = id => state.players.find(p => p.id === id);
  const pct = s => (s.played ? Math.round(s.won / s.played * 100) + '%' : '-');

  function render() {
    if (!state) return;
    if (state.status === 'lobby') return renderLobby();
    show('game-view');
    $('game-code').textContent = state.code;
    const h = state.hand;
    const result = state.lastResult;
    const showdown = result && h && h.over && result.handNo === h.no ? result : null;

    // Other players
    $('seats').innerHTML = state.players.filter(p => p.id !== me.id).map(p => {
      const turn = h && !h.over && h.toAct === p.id;
      const tags = [h && h.dealerId === p.id ? 'D' : '', h && !h.over && h.sbId === p.id ? 'SB' : '', h && !h.over && h.bbId === p.id ? 'BB' : '']
        .filter(Boolean).map(t => `<span class="tag">${t}</span>`).join('');
      let cards = '', status = '';
      if (showdown && showdown.shown[p.id]) {
        cards = showdown.shown[p.id].cards.map(c => cardHTML(c)).join('');
        status = esc(showdown.shown[p.id].handName);
      } else if (p.inHand && !p.folded && h && !h.over) {
        cards = cardHTML(null, true) + cardHTML(null, true);
      }
      if (p.leaving) status = 'Left';
      else if (p.folded && h && !h.over) status = 'Folded';
      else if (!p.inHand && h && !h.over) status = p.chips > 0 ? 'Next hand' : 'Out of chips';
      else if (p.inHand && p.chips === 0 && h && !h.over && !p.folded) status = 'All in';
      else if (turn) status = '<span class="timer" data-timer></span>';
      if (showdown && showdown.results[p.id]) {
        const net = showdown.results[p.id].net;
        status += ` <span class="${net > 0 ? 'win' : 'loss'}">${net > 0 ? '+' : ''}${net}</span>`;
      }
      const out = p.leaving || (h && !h.over && (!p.inHand || p.folded));
      return `<div class="seat-box${turn ? ' turn' : ''}${out ? ' out' : ''}">
        <div class="name">${esc(p.name)}${tags}</div>
        <div>${p.chips} chips${p.bet ? ` <span class="bet">bet ${p.bet}</span>` : ''}</div>
        <div class="cards">${cards}</div>
        <div class="status">${status}</div>
      </div>`;
    }).join('') || '<p>Waiting for friends to join&hellip;</p>';

    // Board & pot
    const board = h ? h.board : [];
    let boardHTML = board.map(c => cardHTML(c)).join('');
    for (let i = board.length; i < 5; i++) boardHTML += '<div class="card empty"></div>';
    $('board').innerHTML = boardHTML;
    $('pot').textContent = h ? h.pot : 0;
    $('street').textContent = h && !h.over ? h.streetName : '';

    // Me
    const mine = playerById(me.id);
    const inHand = h && mine.inHand;
    $('your-cards').innerHTML = inHand && me.hole.length ? me.hole.map(c => cardHTML(c)).join('') : '';
    let info = `${esc(mine.name)} (you): <b>${mine.chips}</b> chips`;
    if (h && h.dealerId === me.id) info += '<span class="tag">D</span>';
    if (h && !h.over && h.sbId === me.id) info += '<span class="tag">SB</span>';
    if (h && !h.over && h.bbId === me.id) info += '<span class="tag">BB</span>';
    if (mine.bet) info += `<span class="bet">Bet: ${mine.bet}</span>`;
    if (inHand && me.hole.length && board.length) info += `<span class="hand-name">${Poker.handName(Poker.bestHand(me.hole.concat(board)))}</span>`;
    if (showdown && showdown.results[me.id]) {
      const net = showdown.results[me.id].net;
      info += ` <span class="${net > 0 ? 'win' : 'loss'}">${net > 0 ? '+' : ''}${net}</span>`;
    }
    $('me-info').innerHTML = info;
    updateEquity(inHand && !mine.folded);

    // Buttons
    const opt = acting ? null : me.options;
    $('fold-btn').disabled = !opt || opt.toCall === 0;
    $('call-btn').disabled = !opt;
    $('raise-btn').disabled = !opt || !opt.canRaise;
    $('call-btn').textContent = opt && opt.toCall > 0 ? `Call ${opt.callAmount}` : 'Check';
    $('raise-btn').textContent = opt ? `${opt.isBet ? 'Bet' : 'Raise to'} ${opt.raiseTo}` : 'Raise';
    const canRebuy = mine.chips === 0 && !(h && !h.over && mine.inHand && !mine.folded);
    $('rebuy-btn').hidden = !canRebuy;
    for (const id of ['fold-btn', 'call-btn', 'raise-btn']) $(id).hidden = canRebuy;

    // Message
    if (Date.now() >= errorUntil) {
      let msg = '';
      if (opt) msg = 'Your turn.';
      else if (h && !h.over) msg = `Waiting for ${(playerById(h.toAct) || {}).name || '...'}…`;
      else if (state.players.filter(p => p.chips > 0 && !p.leaving).length < 2) msg = canRebuy ? 'You are out of chips. Rebuy to keep playing.' : 'Waiting for more players with chips…';
      else if (h && h.over) msg = summary(showdown) + ' Next hand starting…';
      $('message').textContent = msg;
    }

    // Log
    $('log').innerHTML = state.log.slice().reverse().map(l => `<li>${esc(l)}</li>`).join('');

    // Scores
    $('score-body').innerHTML = state.players.slice()
      .sort((a, b) => (b.stats.won / (b.stats.played || 1)) - (a.stats.won / (a.stats.played || 1)) || b.chips - a.chips)
      .map(p => `<tr class="${p.id === me.id ? 'me' : ''}"><td>${esc(p.name)}</td><td>${p.chips}</td><td>${p.stats.played}</td><td>${p.stats.won}</td><td>${pct(p.stats)}</td></tr>`)
      .join('');
    renderTimer();
  }

  function summary(r) {
    if (!r) return '';
    const res = r.results[me.id];
    if (!res) return 'Hand over.';
    return res.result === 'won' ? `You won ${res.net > 0 ? res.net : 'the pot'}!` : res.result === 'tied' ? 'You split the pot.' : 'You lost this hand.';
  }

  function renderTimer() {
    const el = document.querySelector('[data-timer]');
    const h = state && state.hand;
    if (!h || h.over) return;
    const left = Math.max(0, Math.ceil((h.turnStart + state.config.TURN_SECONDS * 1000 - serverNow()) / 1000));
    const text = left <= 20 ? `Thinking… ${left}s` : 'Thinking…';
    if (el) el.textContent = text;
    if (me && me.options && left <= 15 && Date.now() >= errorUntil) $('message').textContent = `Your turn: ${left}s left`;
  }

  // Win chance after each deal, against the players still in the hand.
  function updateEquity(playing) {
    const h = state.hand;
    if (!playing || !me.hole.length) {
      if (!h || equity.hand !== h.no) { equity = { key: '', list: [], hand: h && h.no }; $('equity').innerHTML = ''; }
      return;
    }
    const key = `${h.no}:${h.board.length}`;
    if (equity.hand !== h.no) equity = { key: '', list: [], hand: h.no };
    if (equity.key !== key && !h.over) {
      equity.key = key;
      const opponents = Math.max(1, h.live - 1);
      const street = h.streetName;
      setTimeout(() => {
        const iters = opponents === 1 ? 1500 : 800;
        const p = Math.round(Poker.estimateEquity(me.hole, h.board, iters, opponents) * 100);
        if (equity.hand !== h.no) return;
        equity.list.push({ street, pct: p, opponents });
        drawEquity();
      }, 0);
    }
    drawEquity();
  }
  function drawEquity() {
    $('equity').innerHTML = equity.list.map((e, i) =>
      `<span${i === equity.list.length - 1 ? ' class="now"' : ''}>${i ? '→ ' : ''}${e.street} <b>${e.pct}%</b></span>`
    ).join(' ') + (equity.list.length ? ` <small>(vs ${equity.list[equity.list.length - 1].opponents})</small>` : '');
  }

  function renderLobby() {
    show('lobby-view');
    $('lobby-code').textContent = state.code;
    $('lobby-count').textContent = state.players.length;
    $('lobby-list').innerHTML = state.players.map(p =>
      `<li>${esc(p.name)}${p.id === state.hostId ? ' (host)' : ''}${p.id === me.id ? ' (you)' : ''}</li>`).join('');
    const host = state.hostId === me.id;
    $('start-btn').hidden = !host;
    $('start-btn').disabled = state.players.length < 2;
    $('lobby-wait').textContent = host
      ? (state.players.length < 2 ? 'Share the link. You can start once someone joins.' : 'Press Start when everyone is here.')
      : `Waiting for ${(playerById(state.hostId) || {}).name || 'the host'} to start the game…`;
  }

  // ---------- Joining & leaving ----------
  // Quietly leave a table we were sitting at before joining another one.
  function leaveOld() {
    if (!session) return;
    const old = session;
    session = null;
    localStorage.removeItem(SESSION_KEY);
    disconnectLive();
    api('leave', { code: old.code, token: old.token }).catch(() => {});
  }

  function startSession(res) {
    session = { code: res.code, token: res.token, playerId: res.playerId, counted: [] };
    store(SESSION_KEY, session);
    history.replaceState(null, '', `?room=${res.code}`);
    lastServerNow = 0;
    connectLive();
    apply(res);
  }

  function endSession(msg) {
    disconnectLive();
    session = null; state = null; me = null;
    localStorage.removeItem(SESSION_KEY);
    history.replaceState(null, '', location.pathname);
    show('home-view');
    $('home-error').textContent = msg || '';
  }

  function nameValue() {
    const name = $('name-input').value.trim();
    if (!name) { $('home-error').textContent = 'Please enter your name first.'; $('name-input').focus(); return null; }
    localStorage.setItem(NAME_KEY, name);
    return name;
  }

  async function busy(btn, fn) {
    btn.disabled = true;
    try { await fn(); } catch (e) { $('home-error').textContent = e.message; } finally { btn.disabled = false; }
  }

  $('create-btn').onclick = () => {
    const name = nameValue(); if (!name) return;
    leaveOld();
    busy($('create-btn'), async () => startSession(await api('create', { name })));
  };
  $('join-btn').onclick = () => {
    const name = nameValue(); if (!name) return;
    const code = $('code-input').value.trim().toUpperCase();
    if (code.length !== 4) { $('home-error').textContent = 'Room codes are 4 letters.'; return; }
    leaveOld();
    busy($('join-btn'), async () => startSession(await api('join', { code, name })));
  };
  $('code-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('join-btn').click(); });
  $('start-btn').onclick = () => send('start');
  // Lock the buttons as soon as a move is tapped, so a double-tap can't send it twice.
  let acting = false;
  async function move(m) {
    if (acting) return;
    acting = true;
    for (const id of ['fold-btn', 'call-btn', 'raise-btn']) $(id).disabled = true;
    try { await send('act', { move: m }); } finally { acting = false; render(); }
  }
  $('fold-btn').onclick = () => move('fold');
  $('call-btn').onclick = () => move('call');
  $('raise-btn').onclick = () => move('raise');
  $('rebuy-btn').onclick = () => send('rebuy');

  async function leave() {
    if (!confirm('Leave this table? Your chips at this table will be lost.')) return;
    try { await api('leave'); } catch (e) { /* leave anyway */ }
    endSession('');
  }
  $('leave-btn').onclick = leave;
  $('lobby-leave-btn').onclick = leave;

  async function share() {
    const link = `${location.origin}${location.pathname}?room=${session.code}`;
    const text = `Join my Texas Hold'em table! Room code ${session.code}`;
    try {
      if (navigator.share) { await navigator.share({ title: "Texas Hold'em", text, url: link }); return; }
      await navigator.clipboard.writeText(link);
      $('share-note').textContent = 'Link copied! Paste it to your friends.';
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      $('share-note').textContent = link;
    }
    if (!$('game-view').hidden) setMessage('Invite link copied.');
  }
  $('share-btn').onclick = share;
  $('game-share-btn').onclick = share;

  // ---------- Start up ----------
  renderStats();
  $('name-input').value = localStorage.getItem(NAME_KEY) || '';
  const roomParam = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z]/g, '');

  (async function init() {
    if (session && (!roomParam || roomParam === session.code)) {
      // Coming back to a table we're already at.
      try {
        const res = await api('state');
        history.replaceState(null, '', `?room=${session.code}`);
        connectLive();
        apply(res);
        return;
      } catch (e) {
        session = null;
        localStorage.removeItem(SESSION_KEY);
        if (!/not found|not at this table/i.test(e.message)) $('home-error').textContent = e.message;
      }
    }
    show('home-view');
    if (roomParam) {
      $('code-input').value = roomParam;
      $('home-error').textContent = `Enter your name and press Join to sit at table ${roomParam}.`;
      ($('name-input').value ? $('join-btn') : $('name-input')).focus();
    }
  })();
})();

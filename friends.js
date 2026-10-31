// "With Friends" mode: talks to the poker server function and shows the shared table.
(function () {
  const CFG = window.POKER_CONFIG;
  const FN_URL = `${CFG.url}/functions/v1/poker`;
  const SESSION_KEY = 'holdem-friends-session';
  const NAME_KEY = 'holdem-name';
  const STATS_KEY = 'holdem-friends-stats';
  const PROFILE_KEY = 'holdem-profile';
  const LEAGUES_KEY = 'holdem-leagues';

  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Local storage ----------
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const store = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  let session = load(SESSION_KEY, null); // { code, token, playerId, counted: [handNo...] }
  let stats = load(STATS_KEY, { wins: 0, losses: 0, ties: 0 });
  let myLeagues = load(LEAGUES_KEY, []); // [{ code, name }]

  // This device's player profile: lets league tables recognise you across games (no sign-up needed).
  function randomString(chars, length) {
    const a = new Uint32Array(length);
    crypto.getRandomValues(a);
    return Array.from(a, n => chars[n % chars.length]).join('');
  }
  let profile = load(PROFILE_KEY, null);
  if (!profile || !profile.id || !profile.secret) {
    profile = { id: randomString('abcdefghijklmnopqrstuvwxyz0123456789', 20), secret: randomString('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 40) };
    store(PROFILE_KEY, profile);
  }
  const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

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
    const leagueAction = action.startsWith('league_');
    if (session && !leagueAction && !body.code) body.code = session.code;
    if (session && !leagueAction && !body.token && action !== 'create') body.token = session.token;
    if (action === 'create' || action === 'join' || leagueAction || /^(profile_|friend_|invite)/.test(action)) body.profile = profile;
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CFG.key },
      body: JSON.stringify(body),
    });
    let data;
    try { data = await res.json(); } catch (e) { throw new Error('Could not reach the game server.'); }
    if (!res.ok || data.error) { const e = new Error(data.error || 'Something went wrong.'); e.code = data.code; throw e; }
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
    if (!res || !res.state || !session || res.state.code !== session.code) return; // left, or a reply for an old table
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
        .on('broadcast', { event: 'changed' }, () => refresh())
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
    for (const v of ['setup-view', 'profile-view', 'home-view', 'league-view', 'lobby-view', 'game-view']) $(v).hidden = v !== view;
    if (view === 'home-view') renderHome();
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
    $('game-info').textContent = modeText();
    const h = state.hand;
    const tourney = state.mode === 'tournament';
    const finished = state.status === 'finished';
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
      if (p.place) status = `Out: ${ordinal(p.place)}`;
      else if (p.watching) status = 'Watching';
      else if (p.leaving) status = 'Left';
      else if (p.folded && h && !h.over) status = 'Folded';
      else if (!p.inHand && h && !h.over) status = p.chips > 0 ? 'Next hand' : 'Out of chips';
      else if (p.inHand && p.chips === 0 && h && !h.over && !p.folded) status = 'All in';
      else if (turn) status = '<span class="timer" data-timer></span>';
      if (showdown && showdown.results[p.id]) {
        const net = showdown.results[p.id].net;
        status += ` <span class="${net > 0 ? 'win' : 'loss'}">${net > 0 ? '+' : ''}${net}</span>`;
      }
      const out = p.leaving || (p.place && p.place > 1) || p.watching || (h && !h.over && (!p.inHand || p.folded));
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
    const b = state.blinds;
    $('blinds-info').textContent = tourney && !finished
      ? `Blinds ${b.sb}/${b.bb} · level ${b.level}` + (b.handsLeft === null ? '' : b.handsLeft > 0 ? ` · up in ${b.handsLeft} hand${b.handsLeft === 1 ? '' : 's'}` : ' · going up next hand')
      : `Blinds ${b.sb}/${b.bb}`;

    // Me
    const mine = playerById(me.id);
    const inHand = h && mine.inHand;
    $('your-cards').innerHTML = inHand && me.hole.length ? me.hole.map(c => cardHTML(c)).join('') : '';
    let info = `${esc(mine.name)} (you): <b>${mine.chips}</b> chips`;
    if (mine.place && !finished) info += ` <span class="loss">Out: ${ordinal(mine.place)} place</span>`;
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
    const canRebuy = !tourney && mine.chips === 0 && !(h && !h.over && mine.inHand && !mine.folded);
    $('rebuy-btn').hidden = !canRebuy;
    for (const id of ['fold-btn', 'call-btn', 'raise-btn']) $(id).hidden = canRebuy;
    $('controls').hidden = finished || (tourney && (mine.place || mine.watching));
    renderFinal(finished);

    // Message
    if (Date.now() >= errorUntil) {
      let msg = '';
      if (finished) msg = '';
      else if (opt) msg = 'Your turn.';
      else if (tourney && mine.watching) msg = "You'll play in the next tournament. Enjoy the show!";
      else if (tourney && mine.place && (!h || h.over)) msg = `You finished ${ordinal(mine.place)}. Stay and watch, or leave the table.`;
      else if (h && !h.over) msg = `Waiting for ${(playerById(h.toAct) || {}).name || '...'}…`;
      else if (!tourney && state.players.filter(p => p.chips > 0 && !p.leaving).length < 2) msg = canRebuy ? 'You are out of chips. Rebuy to keep playing.' : 'Waiting for more players with chips…';
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

  function modeText() {
    if (!state) return '';
    const parts = [state.mode === 'tournament'
      ? `Tournament${state.tournament ? ' #' + state.tournament.no : ''} · blinds up every ${state.config.HANDS_PER_LEVEL[state.speed]} hands`
      : 'Cash game'];
    if (state.league) parts.push(`League: ${state.league.name}`);
    return parts.join(' · ');
  }

  // Final standings when a tournament ends.
  function renderFinal(finished) {
    $('final-panel').hidden = !finished;
    if (!finished) return;
    const t = state.tournament;
    const winner = t.standings[0];
    $('final-title').textContent = winner.id === me.id ? '🏆 You won the tournament!' : `🏆 ${winner.name} wins the tournament!`;
    $('final-points-head').hidden = !state.league;
    $('final-body').innerHTML = t.standings.map(s =>
      `<tr class="${s.id === me.id ? 'me' : ''}"><td>${ordinal(s.place)}</td><td>${esc(s.name)}</td>` +
      (state.league ? `<td>+${s.points}</td>` : '') + '</tr>').join('');
    const host = state.hostId === me.id;
    $('again-btn').hidden = !host;
    $('again-btn').disabled = state.players.filter(p => !p.leaving).length < 2;
    $('final-note').textContent = host
      ? (state.players.length < 2 ? 'Waiting for someone to play against…' : 'Start another tournament with everyone at the table.')
      : `Waiting for ${(playerById(state.hostId) || {}).name || 'the host'} to start another tournament…`;
    if (state.league) $('final-note').textContent += ` Points have been added to the ${state.league.name} league table.`;
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
      if (!h || equity.hand !== h.no) { equity = { key: '', list: [], hand: h && h.no }; $('equity').innerHTML = ''; $('equity-box').hidden = true; }
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
    $('equity-box').hidden = !equity.list.length;
  }

  function renderLobby() {
    show('lobby-view');
    $('lobby-code').textContent = state.code;
    $('lobby-mode').textContent = modeText();
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
    if (!myProfile) { show('setup-view'); return null; }
    return myProfile.name;
  }

  async function busy(btn, fn) {
    btn.disabled = true;
    try { await fn(); } catch (e) { $('home-error').textContent = e.message; } finally { btn.disabled = false; }
  }

  $('create-btn').onclick = () => {
    const name = nameValue(); if (!name) return;
    leaveOld();
    const mode = document.querySelector('input[name=mode]:checked').value;
    busy($('create-btn'), async () => startSession(await api('create', {
      name, mode, speed: $('speed-select').value, league: $('league-select').value || undefined,
    })));
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
  $('again-btn').onclick = () => send('start');
  for (const r of document.querySelectorAll('input[name=mode]')) r.onchange = () => {
    const t = document.querySelector('input[name=mode]:checked').value === 'tournament';
    $('speed-field').hidden = !t;
    $('mode-hint').textContent = t
      ? 'Everyone starts with 1000 chips, no rebuys, blinds keep rising. Last one standing wins.'
      : 'Play as long as you like. Out of chips? Rebuy.';
  };
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
    const playingTourney = state && state.mode === 'tournament' && state.status === 'playing' &&
      me && !(playerById(me.id) || {}).place && !(playerById(me.id) || {}).watching;
    if (!confirm(playingTourney ? 'Leave the tournament? You will be knocked out.' : 'Leave this table? Your chips at this table will be lost.')) return;
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

  // ---------- Profile, friends & invites ----------
  let myProfile = null; // { id, name, friendCode, friends, invites }

  async function loadMyProfile() {
    try { myProfile = (await api('profile_get')).profile; return true; }
    catch (e) { if (e.code === 'NO_PROFILE') { myProfile = null; return false; } throw e; }
  }

  function setProfile(p) {
    myProfile = p;
    localStorage.setItem(NAME_KEY, p.name);
    if (!$('home-view').hidden) renderHome();
  }

  $('setup-btn').onclick = () => {
    const name = $('name-input').value.trim();
    if (!name) { $('setup-error').textContent = 'Please enter a name.'; $('name-input').focus(); return; }
    busy($('setup-btn'), async () => {
      try { setProfile((await api('profile_save', { name })).profile); }
      catch (e) { $('setup-error').textContent = e.message; return; }
      await afterProfile();
    });
  };
  $('name-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('setup-btn').click(); });

  // Transfer codes carry the profile id and secret: HOLDEM-<base64>
  const encodeTransfer = p => 'HOLDEM-' + btoa(JSON.stringify({ i: p.id, s: p.secret })).replace(/=+$/, '');
  function decodeTransfer(code) {
    try {
      const raw = String(code).trim().replace(/^HOLDEM-/i, '');
      const o = JSON.parse(atob(raw + '='.repeat((4 - raw.length % 4) % 4)));
      if (typeof o.i === 'string' && typeof o.s === 'string') return { id: o.i, secret: o.s };
    } catch (e) { /* fall through */ }
    return null;
  }
  $('restore-btn').onclick = () => busy($('restore-btn'), async () => {
    const key = decodeTransfer($('restore-input').value);
    if (!key) { $('setup-error').textContent = "That transfer code isn't valid."; return; }
    const old = profile;
    profile = key;
    try {
      if (!(await loadMyProfile())) throw new Error('No profile found for that code.');
      store(PROFILE_KEY, profile);
      setProfile(myProfile);
      $('restore-input').value = '';
      await afterProfile();
    } catch (e) {
      profile = old;
      $('setup-error').textContent = e.message;
    }
  });

  $('profile-btn').onclick = () => {
    show('profile-view');
    $('rename-input').value = myProfile.name;
    $('profile-code').textContent = myProfile.friendCode;
    $('transfer-output').hidden = true;
    $('profile-error').textContent = '';
  };
  $('profile-back-btn').onclick = () => show('home-view');
  $('rename-btn').onclick = () => busy($('rename-btn'), async () => {
    try { setProfile((await api('profile_save', { name: $('rename-input').value })).profile); $('profile-error').textContent = 'Name saved.'; }
    catch (e) { $('profile-error').textContent = e.message; }
  });
  $('transfer-btn').onclick = () => {
    $('transfer-output').value = encodeTransfer(profile);
    $('transfer-output').hidden = false;
    $('transfer-output').select();
  };
  $('delete-btn').onclick = async () => {
    if (!confirm('Delete your profile? Your friends list goes, and your name is removed from league tables. This cannot be undone.')) return;
    $('delete-btn').disabled = true;
    try {
      if (session) { try { await api('leave'); } catch (e) { /* ignore */ } }
      await api('profile_delete');
    } catch (e) {
      $('profile-error').textContent = e.message;
      $('delete-btn').disabled = false;
      return;
    }
    disconnectLive();
    for (const k of [SESSION_KEY, NAME_KEY, STATS_KEY, PROFILE_KEY, LEAGUES_KEY]) localStorage.removeItem(k);
    location.replace(location.pathname + '?deleted=1');
  };

  $('friend-add-btn').onclick = () => busy($('friend-add-btn'), async () => {
    setProfile((await api('friend_add', { friendCode: $('friend-code-input').value })).profile);
    $('friend-code-input').value = '';
    $('home-error').textContent = '';
  });
  $('friend-code-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('friend-add-btn').click(); });
  $('friend-share-btn').onclick = async () => {
    const link = `${location.origin}${location.pathname}?friend=${myProfile.friendCode}`;
    try {
      if (navigator.share) { await navigator.share({ title: "Texas Hold'em", text: `Add me as a friend in Texas Hold'em! My friend code is ${myProfile.friendCode}`, url: link }); return; }
      await navigator.clipboard.writeText(link);
      $('friend-share-note').textContent = 'Link copied!';
    } catch (e) { if (!e || e.name !== 'AbortError') $('friend-share-note').textContent = link; }
  };

  // Buttons inside the friends and invites lists
  $('home-view').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.unfriend) {
      const f = myProfile.friends.find(x => x.id === b.dataset.unfriend);
      if (f && confirm(`Remove ${f.name} from your friends?`)) busy(b, async () => setProfile((await api('friend_remove', { friendId: f.id })).profile));
    } else if (b.dataset.dismiss) {
      busy(b, async () => setProfile((await api('invite_dismiss', { room: b.dataset.dismiss })).profile));
    } else if (b.dataset.join) {
      const code = b.dataset.join;
      leaveOld();
      busy(b, async () => {
        startSession(await api('join', { code, name: myProfile.name }));
        api('invite_dismiss', { room: code }).then(r => { myProfile = r.profile; }).catch(() => {});
      });
    }
  });

  // Invite friends to the table you're at
  function openInvites() {
    $('invite-list').innerHTML = myProfile && myProfile.friends.length
      ? myProfile.friends.map(f => `<li class="item"><span>${esc(f.name)}</span><button class="primary" data-invite="${f.id}">Invite</button></li>`).join('')
      : '<li>No friends yet. Add friends from the start screen, or share the table link.</li>';
    $('invite-overlay').hidden = false;
  }
  for (const b of document.querySelectorAll('.invite-friends-btn')) b.onclick = openInvites;
  $('invite-close-btn').onclick = () => { $('invite-overlay').hidden = true; };
  $('invite-list').addEventListener('click', e => {
    const b = e.target.closest('button[data-invite]');
    if (!b || !session) return;
    b.disabled = true;
    api('invite', { friendId: b.dataset.invite, room: session.code })
      .then(() => { b.textContent = 'Invited ✓'; })
      .catch(err => { b.textContent = 'Try again'; b.disabled = false; alert(err.message); });
  });

  // Check for new invites while on the start screen.
  setInterval(() => {
    if (myProfile && !$('home-view').hidden && !document.hidden) loadMyProfile().then(() => renderHome()).catch(() => {});
  }, 20000);

  // ---------- Leagues ----------
  let league = null; // league currently shown

  function rememberLeague(l) {
    myLeagues = myLeagues.filter(x => x.code !== l.code);
    myLeagues.unshift({ code: l.code, name: l.name });
    store(LEAGUES_KEY, myLeagues);
  }

  function renderHome() {
    if (myProfile) {
      $('me-name').textContent = myProfile.name;
      $('me-code').textContent = myProfile.friendCode;
      $('invites-panel').hidden = !myProfile.invites.length;
      $('invites-list').innerHTML = myProfile.invites.map(i =>
        `<li class="item"><span><b>${esc(i.fromName)}</b> invited you to a ${i.mode === 'tournament' ? 'tournament' : 'cash game'}</span>` +
        `<span><button class="primary" data-join="${i.room}">Join</button> <button class="secondary" data-dismiss="${i.room}">✕</button></span></li>`).join('');
      $('friends-list').innerHTML = myProfile.friends.length
        ? myProfile.friends.map(f => `<li class="item"><span>${esc(f.name)}</span><button class="secondary" data-unfriend="${f.id}" title="Remove friend">Remove</button></li>`).join('')
        : '<li>No friends yet. Share your friend link, or add a friend\'s code.</li>';
    }
    $('my-leagues').innerHTML = myLeagues.length
      ? myLeagues.map(l => `<li class="league-item" data-code="${l.code}"><span>${esc(l.name)}</span><a>View table ›</a></li>`).join('')
      : '<li>No leagues yet.</li>';
    for (const li of document.querySelectorAll('#my-leagues .league-item')) li.onclick = () => openLeague(li.dataset.code);
    const chosen = $('league-select').value;
    $('league-select').innerHTML = '<option value="">None</option>' +
      myLeagues.map(l => `<option value="${l.code}">${esc(l.name)}</option>`).join('');
    if (myLeagues.some(l => l.code === chosen)) $('league-select').value = chosen;
  }

  async function openLeague(code) {
    try {
      const res = await api('league_view', { code });
      showLeague(res.league);
    } catch (e) {
      show('home-view');
      $('home-error').textContent = e.message;
      if (/not found/.test(e.message)) { myLeagues = myLeagues.filter(l => l.code !== code); store(LEAGUES_KEY, myLeagues); renderHome(); }
    }
  }

  function showLeague(l) {
    league = l;
    if (l.isMember) rememberLeague(l);
    show('league-view');
    history.replaceState(null, '', `?league=${l.code}`);
    $('league-title').textContent = l.name;
    $('league-code').textContent = l.code;
    $('league-error').textContent = '';
    $('league-member-actions').hidden = !l.isMember;
    $('league-join-here-btn').hidden = l.isMember;
    $('league-body').innerHTML = l.members.length ? l.members.map((m, i) =>
      `<tr class="${m.you ? 'me' : ''}"><td>${i + 1}</td><td>${esc(m.name)}</td><td><b>${m.points}</b></td><td>${m.tournaments}</td>` +
      `<td>${m.wins}</td><td>${m.avgFinish === null ? '-' : m.avgFinish}</td>` +
      `<td>${m.hands ? `${m.handsWon}/${m.hands} (${Math.round(m.winPct)}%)` : '-'}</td></tr>`).join('')
      : '<tr><td colspan="7">No games yet.</td></tr>';
    $('league-recent').innerHTML = l.recent.length ? l.recent.map(t =>
      `<li>${new Date(t.date).toLocaleDateString()}: ${t.standings.slice(0, 3).map(s => `${ordinal(s.place)} ${esc(s.name)}`).join(', ')}` +
      `${t.players > 3 ? ` (+${t.players - 3} more)` : ''}</li>`).join('') : '<li>No tournaments yet.</li>';
  }

  async function leagueGame(mode) {
    const name = nameValue();
    if (!name) return;
    leaveOld();
    try { startSession(await api('create', { name, mode, speed: 'normal', league: league.code })); }
    catch (e) { $('league-error').textContent = e.message; }
  }
  $('league-tournament-btn').onclick = () => leagueGame('tournament');
  $('league-cash-btn').onclick = () => leagueGame('cash');
  $('league-back-btn').onclick = () => { history.replaceState(null, '', location.pathname); show('home-view'); };
  $('league-join-here-btn').onclick = async () => {
    if (!nameValue()) return;
    try { showLeague((await api('league_join', { code: league.code })).league); }
    catch (e) { $('league-error').textContent = e.message; }
  };
  $('league-create-btn').onclick = () => {
    const name = nameValue(); if (!name) return;
    const leagueName = $('league-name-input').value.trim();
    if (!leagueName) { $('home-error').textContent = 'Give your league a name.'; $('league-name-input').focus(); return; }
    busy($('league-create-btn'), async () => { showLeague((await api('league_create', { leagueName })).league); $('league-name-input').value = ''; });
  };
  $('league-join-btn').onclick = () => {
    const name = nameValue(); if (!name) return;
    const code = $('league-code-input').value.trim().toUpperCase();
    if (code.length !== 6) { $('home-error').textContent = 'League codes are 6 letters.'; return; }
    busy($('league-join-btn'), async () => { showLeague((await api('league_join', { code })).league); $('league-code-input').value = ''; });
  };
  $('league-share-btn').onclick = async () => {
    const link = `${location.origin}${location.pathname}?league=${league.code}`;
    try {
      if (navigator.share) { await navigator.share({ title: league.name, text: `Join our poker league "${league.name}"! Code ${league.code}`, url: link }); return; }
      await navigator.clipboard.writeText(link);
      $('league-share-note').textContent = 'Link copied!';
    } catch (e) {
      if (!e || e.name !== 'AbortError') $('league-share-note').textContent = link;
    }
  };

  // ---------- Start up ----------
  renderStats();
  const roomParam = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z]/g, '');
  const leagueParam = (new URLSearchParams(location.search).get('league') || '').toUpperCase().replace(/[^A-Z]/g, '');
  const friendParam = (new URLSearchParams(location.search).get('friend') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const deletedParam = new URLSearchParams(location.search).has('deleted');

  // After the profile exists (or was just created / restored), carry on to where the link pointed.
  async function afterProfile() {
    if (friendParam && myProfile && friendParam !== myProfile.friendCode && !myProfile.friends.some(f => f.friendCode === friendParam)) {
      show('home-view');
      $('friend-code-input').value = friendParam;
      $('home-error').textContent = 'Tap Add to add this friend.';
      history.replaceState(null, '', location.pathname);
      return;
    }
    return route();
  }

  (async function init() {
    try { await loadMyProfile(); }
    catch (e) { show('setup-view'); $('setup-error').textContent = e.message; return; }
    if (!myProfile) {
      show('setup-view');
      $('name-input').value = localStorage.getItem(NAME_KEY) || '';
      if (deletedParam) $('setup-error').textContent = 'Your profile has been deleted.';
      return;
    }
    localStorage.setItem(NAME_KEY, myProfile.name);
    return afterProfile();
  })();

  async function route() {
    if (session && !leagueParam && (!roomParam || roomParam === session.code)) {
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
    if (leagueParam) return openLeague(leagueParam);
    show('home-view');
    if (roomParam) {
      $('code-input').value = roomParam;
      $('home-error').textContent = `Press Join to sit at table ${roomParam}.`;
      $('join-btn').focus();
    }
  }
})();

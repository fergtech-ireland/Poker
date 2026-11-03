// Multiplayer no-limit Texas Hold'em rules (2-6 players), cash games and tournaments.
// Pure game logic: no networking or storage. The room object is plain JSON so it
// can be saved to the database as-is. Used by the Edge Function and by the tests.
import './poker.js';
const P = globalThis.Poker;

export const CONFIG = {
  START_CHIPS: 1000,
  SMALL_BLIND: 10,
  BIG_BLIND: 20,
  MAX_PLAYERS: 6,
  TURN_SECONDS: 45,       // after this anyone can ask the server to auto-check/fold
  NEXT_HAND_SECONDS: 4,   // pause after a hand before the next one can be dealt
  // Tournament blind levels [small, big]; the level goes up every N hands.
  BLIND_LEVELS: [[10, 20], [15, 30], [25, 50], [40, 80], [60, 120], [100, 200],
                 [150, 300], [250, 500], [400, 800], [600, 1200], [1000, 2000]],
  HANDS_PER_LEVEL: { normal: 8, fast: 4 },
};
const STREETS = ['Pre-flop', 'Flop', 'Turn', 'River'];

export class GameError extends Error {}
const fail = msg => { throw new GameError(msg); };

export const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

// ---------- Room & players ----------

// opts: { mode: 'cash' | 'tournament', speed: 'normal' | 'fast', league: { code, name } | null }
export function newRoom(code, now, opts = {}) {
  return {
    code,
    mode: opts.mode === 'tournament' ? 'tournament' : 'cash',
    speed: opts.speed === 'fast' ? 'fast' : 'normal',
    league: opts.league || null,
    status: 'lobby',          // lobby -> playing (-> finished, tournaments only)
    hostId: null, players: [], hand: null, handNo: 0,
    lastDealerId: null, lastDealerIdx: -1, log: [], createdAt: now,
    tournament: null,
    events: [],               // for the league table; taken out by the server before saving
  };
}

function addLog(room, msg) {
  room.log.push(msg);
  if (room.log.length > 40) room.log.splice(0, room.log.length - 40);
}

const player = (room, id) => room.players.find(p => p.id === id);
const nameOf = (room, id) => (player(room, id) || {}).name || '?';
const isTournament = room => room.mode === 'tournament';

export function cleanName(name, max = 16) {
  name = String(name || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  if (!name) fail('Please enter a name.');
  return name;
}

export function addPlayer(room, { id, name, tokenHash, profileId = null }) {
  const seated = room.players.filter(p => !p.leaving);
  if (seated.length >= CONFIG.MAX_PLAYERS) fail('This table is full (6 players).');
  name = cleanName(name);
  let unique = name, n = 2;
  while (room.players.some(p => p.name.toLowerCase() === unique.toLowerCase())) unique = `${name} ${n++}`;
  // Joining a tournament that's under way: watch now, play in the next one.
  const watching = isTournament(room) && room.status === 'playing';
  room.players.push({
    id, name: unique, tokenHash, profileId, chips: watching ? 0 : CONFIG.START_CHIPS,
    leaving: false, watching, stats: { played: 0, won: 0, tied: 0, lost: 0 },
  });
  if (!room.hostId) room.hostId = id;
  addLog(room, watching ? `${unique} joined and will play in the next tournament.` : `${unique} joined the table.`);
  return player(room, id);
}

// ---------- Blinds ----------

// Blinds for the next hand dealt.
function currentBlinds(room) {
  if (!isTournament(room) || !room.tournament) return { sb: CONFIG.SMALL_BLIND, bb: CONFIG.BIG_BLIND, level: 1 };
  const per = CONFIG.HANDS_PER_LEVEL[room.speed];
  const idx = Math.min(Math.floor(room.tournament.hands / per), CONFIG.BLIND_LEVELS.length - 1);
  const [sb, bb] = CONFIG.BLIND_LEVELS[idx];
  return { sb, bb, level: idx + 1 };
}

// What to show players: the blinds now (or for the next hand), and how many more hands
// will be dealt at this level before they go up (not counting a hand in progress).
function blindsInfo(room) {
  const h = room.hand;
  const t = room.tournament;
  const info = h && !h.over ? { sb: h.sb, bb: h.bb, level: t ? t.level : 1 } : currentBlinds(room);
  if (!isTournament(room) || !t || info.level >= CONFIG.BLIND_LEVELS.length) return { ...info, handsLeft: null };
  return { ...info, handsLeft: info.level * CONFIG.HANDS_PER_LEVEL[room.speed] - t.hands };
}

// ---------- Hand helpers ----------

const handActive = room => room.hand && !room.hand.over;
const maxBet = h => Math.max(0, ...h.ids.map(id => h.bets[id]));
const notFolded = h => h.ids.filter(id => !h.folded[id]);
const canAct = (room, h, id) => !h.folded[id] && player(room, id).chips > 0;

function commit(room, h, id, amount) {
  const p = player(room, id);
  amount = Math.min(amount, p.chips);
  p.chips -= amount;
  h.bets[id] += amount;
  h.contrib[id] += amount;
  return amount;
}

function needsToAct(room, h, id) {
  if (!canAct(room, h, id)) return false;
  const others = h.ids.filter(o => o !== id && canAct(room, h, o)).length;
  if (others === 0 && h.bets[id] >= maxBet(h)) return false; // nobody left to bet against
  return !h.acted[id] || h.bets[id] < maxBet(h);
}

// Next player (in seat order, after `fromId`) who still needs to act, or null.
function nextActor(room, h, fromId) {
  const start = h.ids.indexOf(fromId);
  for (let k = 1; k <= h.ids.length; k++) {
    const id = h.ids[(start + k) % h.ids.length];
    if (needsToAct(room, h, id)) return id;
  }
  return null;
}

// What the player to act may do. Bet/raise amounts are "to" totals for this round.
// No-limit: the smallest bet is the big blind; a raise must be at least as big as the last
// full bet or raise; anyone may go all in for whatever they have.
export function options(room, id) {
  const h = room.hand;
  if (!handActive(room) || h.toAct !== id) return null;
  const p = player(room, id);
  const top = maxBet(h);
  const toCall = Math.max(0, top - h.bets[id]);
  const bb = h.bb || CONFIG.BIG_BLIND; // tables saved by older versions have no h.bb
  const max = h.bets[id] + p.chips;    // all in
  const min = Math.min(max, top === 0 ? bb : top + (h.minRaise || bb));
  const othersCanAct = h.ids.some(o => o !== id && canAct(room, h, o));
  return {
    toCall,
    callAmount: Math.min(toCall, p.chips),
    canRaise: othersCanAct && max > top,
    min, max, top, allIn: true,
    raiseTo: min, // kept for older app versions
    isBet: top === 0,
    current: h.bets[id],
    pot: h.ids.reduce((s, o) => s + h.contrib[o], 0),
  };
}

// ---------- Dealing ----------

export function startHand(room, rand, now) {
  if (handActive(room)) fail('A hand is already in progress.');
  // Players who left during the last hand go now.
  room.players = room.players.filter(p => !p.leaving);
  if (!room.players.some(p => p.id === room.hostId)) room.hostId = room.players[0] ? room.players[0].id : null;

  const eligible = room.players.filter(p => p.chips > 0);
  if (eligible.length < 2) {
    room.hand = room.hand && room.hand.over ? room.hand : null;
    room.waiting = true;
    return false;
  }
  room.waiting = false;

  // Move the dealer button to the next player with chips.
  let idx = room.players.findIndex(p => p.id === room.lastDealerId);
  if (idx === -1) idx = Math.min(room.lastDealerIdx, room.players.length - 1);
  let dealerIdx = idx;
  for (let k = 1; k <= room.players.length; k++) {
    const j = (idx + k + room.players.length) % room.players.length;
    if (room.players[j].chips > 0) { dealerIdx = j; break; }
  }
  const dealerId = room.players[dealerIdx].id;
  room.lastDealerId = dealerId;
  room.lastDealerIdx = dealerIdx;

  const ids = eligible.map(p => p.id); // seat order
  const d = ids.indexOf(dealerId);
  const order = ids.map((_, k) => ids[(d + 1 + k) % ids.length]); // left of dealer ... dealer
  const headsUp = ids.length === 2;
  const sbId = headsUp ? dealerId : order[0];
  const bbId = headsUp ? order[0] : order[1];

  const blinds = currentBlinds(room);
  if (room.tournament) {
    const before = room.tournament.level || 1;
    room.tournament.hands++;
    room.tournament.level = blinds.level;
    if (blinds.level > before) addLog(room, `Blinds go up to ${blinds.sb}/${blinds.bb}.`);
  }

  room.handNo++;
  const h = room.hand = {
    no: room.handNo, ids, dealerId, sbId, bbId, sb: blinds.sb, bb: blinds.bb,
    deck: P.shuffle(P.newDeck(), rand), hole: {}, board: [],
    bets: {}, contrib: {}, folded: {}, acted: {}, startChips: {},
    minRaise: blinds.bb, street: 0, toAct: null, turnStart: now, over: false,
  };
  for (const id of ids) {
    h.bets[id] = 0; h.contrib[id] = 0; h.folded[id] = false; h.acted[id] = false; h.hole[id] = [];
    h.startChips[id] = player(room, id).chips;
  }
  for (let r = 0; r < 2; r++) for (const id of order) h.hole[id].push(h.deck.pop());
  room.lastResult = null;

  addLog(room, `Hand #${h.no}. ${nameOf(room, dealerId)} has the dealer button.`);
  const sb = commit(room, h, sbId, h.sb);
  const bb = commit(room, h, bbId, h.bb);
  addLog(room, `${nameOf(room, sbId)} posts small blind ${sb}, ${nameOf(room, bbId)} posts big blind ${bb}.`);

  const first = nextActor(room, h, bbId);
  if (first === null) endStreet(room, now);
  else { h.toAct = first; h.turnStart = now; }
  return true;
}

function dealStreet(room, h) {
  h.street++;
  const n = h.street === 1 ? 3 : 1;
  h.deck.pop(); // burn
  for (let i = 0; i < n; i++) h.board.push(h.deck.pop());
  addLog(room, `${STREETS[h.street]}: ${h.board.map(P.cardLabel).join(' ')}`);
}

function endStreet(room, now) {
  const h = room.hand;
  if (h.street === 3) return settle(room, now, false);
  for (const id of h.ids) { h.bets[id] = 0; h.acted[id] = false; }
  h.minRaise = h.bb;
  dealStreet(room, h);
  const actors = h.ids.filter(id => canAct(room, h, id)).length;
  if (actors <= 1) {
    while (h.street < 3) dealStreet(room, h);
    return settle(room, now, false);
  }
  const first = nextActor(room, h, h.dealerId);
  if (first === null) return endStreet(room, now);
  h.toAct = first;
  h.turnStart = now;
}

// ---------- Actions ----------

// move: 'fold' | 'call' (check or call) | 'raise' (amount = bet/raise to; default the minimum) | 'allin'
export function act(room, id, move, now, amount) {
  const h = room.hand;
  if (!handActive(room)) fail('No hand in progress.');
  if (h.toAct !== id) fail("It's not your turn.");
  const opt = options(room, id);
  const who = nameOf(room, id);

  if (move === 'allin') { move = opt.canRaise ? 'raise' : 'call'; amount = opt.max; }
  if (move === 'fold' && opt.toCall === 0) move = 'call'; // never fold when you can check
  if (move === 'raise' && !opt.canRaise) move = 'call';
  let to = opt.min;
  if (move === 'raise' && amount !== undefined && amount !== null) {
    to = Number(amount);
    if (!Number.isInteger(to)) fail('Please enter a whole number of chips.');
    if (to > opt.max) fail(`You only have ${opt.max - opt.current} chips; the most you can ${opt.isBet ? 'bet' : 'raise to'} is ${opt.max}.`);
    if (to < opt.min && to !== opt.max) fail(`The minimum ${opt.isBet ? 'bet' : 'raise'} is ${opt.isBet ? '' : 'to '}${opt.min}.`);
  }

  if (move === 'fold') {
    h.folded[id] = true;
    addLog(room, `${who} folds.`);
  } else if (move === 'call') {
    if (opt.toCall === 0) addLog(room, `${who} checks.`);
    else {
      const amt = commit(room, h, id, opt.callAmount);
      addLog(room, `${who} calls ${amt}${player(room, id).chips === 0 ? ' (all in)' : ''}.`);
    }
    h.acted[id] = true;
  } else if (move === 'raise') {
    if (to - opt.top >= (h.minRaise || h.bb || CONFIG.BIG_BLIND)) h.minRaise = to - opt.top; // a full raise sets the new minimum
    commit(room, h, id, to - h.bets[id]);
    for (const o of h.ids) h.acted[o] = false;
    h.acted[id] = true;
    addLog(room, `${who} ${opt.isBet ? 'bets' : 'raises to'} ${h.bets[id]}${player(room, id).chips === 0 ? ' (all in)' : ''}.`);
  } else {
    fail('Unknown move.');
  }
  afterAction(room, id, now);
}

function afterAction(room, id, now) {
  const h = room.hand;
  const live = notFolded(h);
  if (live.length === 1) return settle(room, now, true);
  const next = nextActor(room, h, id);
  if (next === null) endStreet(room, now);
  else { h.toAct = next; h.turnStart = now; }
}

// Anyone may call this; it only does something if the current player has run out of time.
export function timeout(room, now) {
  const h = room.hand;
  if (!handActive(room)) return false;
  if (now - h.turnStart < CONFIG.TURN_SECONDS * 1000) return false;
  const id = h.toAct;
  addLog(room, `${nameOf(room, id)} ran out of time.`);
  act(room, id, 'fold', now); // becomes a check when checking is possible
  return true;
}

export function nextHand(room, rand, now) {
  if (room.status !== 'playing') return false;
  if (handActive(room)) return false;
  const ended = room.lastResult ? room.lastResult.endedAt : 0;
  if (now - ended < CONFIG.NEXT_HAND_SECONDS * 1000) return false;
  const before = JSON.stringify(room);
  return startHand(room, rand, now) || JSON.stringify(room) !== before; // false = nothing changed
}

// Start the game (cash) or a tournament. For tournaments the host can also use this to play again.
export function startGame(room, id, rand, now) {
  if (room.hostId !== id) fail('Only the host can start the game.');
  if (room.status === 'playing') fail('The game has already started.');
  if (isTournament(room)) {
    room.players = room.players.filter(p => !p.leaving);
    if (room.players.length < 2) fail('You need at least 2 players to start.');
    const prevNo = room.tournament ? room.tournament.no : 0;
    room.tournament = {
      no: prevNo + 1, startedAt: now, hands: 0, level: 1, finishedAt: null,
      entrants: room.players.map(p => p.id), places: {}, standings: null,
      names: Object.fromEntries(room.players.map(p => [p.id, p.name])),
      profiles: Object.fromEntries(room.players.map(p => [p.id, p.profileId])),
    };
    for (const p of room.players) {
      p.chips = CONFIG.START_CHIPS;
      p.watching = false;
      p.stats = { played: 0, won: 0, tied: 0, lost: 0 };
    }
    room.hand = null;
    room.lastResult = null;
    addLog(room, `Tournament #${room.tournament.no} starts with ${room.players.length} players. ` +
      `Blinds go up every ${CONFIG.HANDS_PER_LEVEL[room.speed]} hands. Last one standing wins!`);
  } else if (room.players.filter(p => p.chips > 0).length < 2) {
    fail('You need at least 2 players to start.');
  }
  room.status = 'playing';
  startHand(room, rand, now);
}

export function rebuy(room, id) {
  const p = player(room, id);
  if (!p) fail('You are not at this table.');
  if (isTournament(room)) fail('There are no rebuys in a tournament.');
  if (p.chips > 0) fail('You can only rebuy when you are out of chips.');
  if (handActive(room) && room.hand.ids.includes(id) && !room.hand.folded[id]) fail('Wait until this hand is over.');
  p.chips = CONFIG.START_CHIPS;
  p.stats.rebuys = (p.stats.rebuys || 0) + 1;
  addLog(room, `${p.name} rebuys for ${CONFIG.START_CHIPS}.`);
}

export function leave(room, id, now) {
  const p = player(room, id);
  if (!p) return;
  addLog(room, `${p.name} left the table.`);
  const h = room.hand;
  if (handActive(room) && h.ids.includes(id) && !h.folded[id]) {
    p.leaving = true;
    h.folded[id] = true;
    if (h.toAct === id) afterAction(room, id, now);
    else if (notFolded(h).length === 1) settle(room, now, true);
    else if (nextActor(room, h, h.toAct) === null && !needsToAct(room, h, h.toAct)) endStreet(room, now);
  } else if (handActive(room) && h.ids.includes(id)) {
    p.leaving = true; // folded already; remove after the hand
    if (tournamentAlive(room, id)) { p.chips = 0; bust(room, [id]); finishIfDone(room, now); }
  } else {
    if (tournamentAlive(room, id)) { p.chips = 0; bust(room, [id]); }
    room.players = room.players.filter(x => x.id !== id);
    finishIfDone(room, now);
  }
  if (room.hostId === id) {
    const nextHost = room.players.find(x => !x.leaving);
    room.hostId = nextHost ? nextHost.id : null;
  }
}

// ---------- Tournaments ----------

const tournamentRunning = room => isTournament(room) && room.status === 'playing' && room.tournament;
const tournamentAlive = (room, id) =>
  tournamentRunning(room) && room.tournament.entrants.includes(id) && !room.tournament.places[id];

// Knock players out. Several out in the same hand: the one who started the hand with fewer chips finishes lower.
function bust(room, ids, startChips = {}) {
  const t = room.tournament;
  let alive = t.entrants.filter(id => !t.places[id]).length;
  const sorted = ids.slice().sort((a, b) => (startChips[a] || 0) - (startChips[b] || 0));
  for (const id of sorted) {
    t.places[id] = alive--;
    addLog(room, `${t.names[id]} is out in ${ordinal(t.places[id])} place.`);
  }
}

function finishIfDone(room, now) {
  if (!tournamentRunning(room)) return;
  const t = room.tournament;
  const remaining = t.entrants.filter(id => !t.places[id]);
  if (remaining.length > 1) return;
  if (remaining.length === 1) t.places[remaining[0]] = 1;
  const n = t.entrants.length;
  t.finishedAt = now;
  t.standings = t.entrants
    .map(id => ({ id, name: t.names[id], profileId: t.profiles[id], place: t.places[id], points: n - t.places[id] + 1 }))
    .sort((a, b) => a.place - b.place);
  room.status = 'finished';
  if (room.hand && !room.hand.over) { room.hand.over = true; room.hand.toAct = null; }
  const winner = t.standings[0];
  addLog(room, `🏆 ${winner.name} wins tournament #${t.no}!`);
  room.events.push({
    type: 'tournament',
    key: `${room.code}:${t.no}:${t.startedAt}`,
    date: now,
    players: n,
    standings: t.standings.map(({ name, profileId, place, points }) => ({ name, profileId, place, points })),
  });
}

// ---------- Showdown & payouts ----------

function settle(room, now, byFold) {
  const h = room.hand;
  const live = notFolded(h);
  const winnings = {};
  const wonPot = {};  // took a contested pot outright
  const splitPot = {}; // shared a contested pot
  for (const id of h.ids) winnings[id] = 0;
  const shown = {};

  if (byFold) {
    const w = live[0];
    const total = h.ids.reduce((s, id) => s + h.contrib[id], 0);
    winnings[w] = total;
    wonPot[w] = true;
    addLog(room, `${nameOf(room, w)} wins ${total}.`);
  } else {
    const scores = {};
    for (const id of live) {
      scores[id] = P.bestHand(h.hole[id].concat(h.board));
      shown[id] = { cards: h.hole[id], handName: P.handName(scores[id]) };
      addLog(room, `${nameOf(room, id)} shows ${h.hole[id].map(P.cardLabel).join(' ')} (${P.handName(scores[id])}).`);
    }
    // Build main pot + side pots from each player's total contribution.
    const levels = [...new Set(live.map(id => h.contrib[id]))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const L of levels) {
      let amount = 0;
      for (const id of h.ids) amount += Math.min(h.contrib[id], L) - Math.min(h.contrib[id], prev);
      if (amount > 0) pots.push({ amount, eligible: live.filter(id => h.contrib[id] >= L) });
      prev = L;
    }
    // Chips folded players put in above the highest live contribution (rare) go to the last pot.
    let extra = 0;
    for (const id of h.ids) extra += Math.max(0, h.contrib[id] - prev);
    if (extra && pots.length) pots[pots.length - 1].amount += extra;

    // Odd chips go to the first winner left of the dealer.
    const d = h.ids.indexOf(h.dealerId);
    const seatOrder = h.ids.map((_, k) => h.ids[(d + 1 + k) % h.ids.length]);
    pots.forEach((pot, i) => {
      let best = null, winners = [];
      for (const id of pot.eligible) {
        const c = best ? P.compareScores(scores[id], best) : 1;
        if (c > 0) { best = scores[id]; winners = [id]; } else if (c === 0) winners.push(id);
      }
      winners.sort((a, b) => seatOrder.indexOf(a) - seatOrder.indexOf(b));
      const share = Math.floor(pot.amount / winners.length);
      let rem = pot.amount - share * winners.length;
      for (const w of winners) { winnings[w] += share + (rem > 0 ? 1 : 0); if (rem > 0) rem--; }
      if (pot.eligible.length > 1) for (const w of winners) (winners.length === 1 ? wonPot : splitPot)[w] = true;
      const label = pots.length > 1 ? (i === 0 ? 'the main pot' : `side pot ${i}`) : 'the pot';
      const names = winners.map(w => nameOf(room, w)).join(' and ');
      addLog(room, winners.length > 1 && pot.eligible.length > 1
        ? `${names} split ${label} (${pot.amount}).`
        : pot.eligible.length === 1 ? `${names} gets back ${pot.amount} (uncalled).`
        : `${names} wins ${label} (${pot.amount}) with ${P.handName(best)}.`);
    });
  }

  const results = {};
  const leagueHand = [];
  for (const id of h.ids) {
    const p = player(room, id);
    p.chips += winnings[id];
    p.stats.played++;
    // A pot where you were the only eligible player is just your own chips coming back.
    const result = wonPot[id] ? 'won' : splitPot[id] ? 'tied' : 'lost';
    p.stats[result]++;
    results[id] = { result, net: winnings[id] - h.contrib[id] };
    if (p.profileId) leagueHand.push({ profileId: p.profileId, name: p.name, result });
  }
  h.over = true;
  h.toAct = null;
  room.lastResult = { handNo: h.no, byFold, shown, results, endedAt: now };
  if (leagueHand.length) room.events.push({ type: 'hand', players: leagueHand });

  if (tournamentRunning(room)) {
    // Out of chips, or left during the hand: knocked out.
    const out = h.ids.filter(id => tournamentAlive(room, id) && (player(room, id).chips === 0 || player(room, id).leaving));
    for (const id of out) player(room, id).chips = 0;
    if (out.length) bust(room, out, h.startChips);
    finishIfDone(room, now);
  }
}

// ---------- What each player is allowed to see ----------

export function publicView(room, now) {
  const h = room.hand;
  const t = room.tournament;
  return {
    code: room.code,
    mode: room.mode,
    speed: room.speed,
    league: room.league,
    status: room.status,
    hostId: room.hostId,
    waiting: !!room.waiting,
    config: CONFIG,
    serverNow: now,
    blinds: blindsInfo(room),
    tournament: t ? {
      no: t.no, entrants: t.entrants.length, places: t.places, standings: t.standings,
      finishedAt: t.finishedAt, handsPerLevel: CONFIG.HANDS_PER_LEVEL[room.speed],
    } : null,
    players: room.players.map(p => ({
      id: p.id, name: p.name, chips: p.chips, leaving: p.leaving, watching: !!p.watching, stats: p.stats,
      place: t && t.places[p.id] && room.status !== 'lobby' ? t.places[p.id] : null,
      inHand: !!(h && h.ids.includes(p.id)),
      folded: !!(h && h.folded[p.id]),
      bet: h && !h.over ? h.bets[p.id] || 0 : 0,
    })),
    hand: h ? {
      no: h.no, dealerId: h.dealerId, sbId: h.sbId, bbId: h.bbId, board: h.board,
      street: h.street, streetName: STREETS[h.street], toAct: h.toAct, turnStart: h.turnStart,
      over: h.over, pot: h.ids.reduce((s, id) => s + h.contrib[id], 0),
      live: notFolded(h).length,
    } : null,
    lastResult: room.lastResult || null,
    log: room.log.slice(-25),
  };
}

export function privateView(room, id) {
  const h = room.hand;
  return {
    id,
    hole: h && h.hole[id] ? h.hole[id] : [],
    options: options(room, id),
  };
}

// Turns a request ({ action, code, token, ... }) into a game change.
// Storage is passed in, so the same code runs in the Edge Function (Postgres)
// and in local tests (in memory).
//
// store.load(code)                                -> { version, room } | null
// store.save(code, expectedVersion, room, view)   -> true if saved, false if someone else saved first
// store.loadLeague(code)                          -> { version, league } | null
// store.saveLeague(code, expectedVersion, league) -> true / false
//   (expectedVersion 0 means "create")
// store.rateLimit(key, limit, windowSeconds)      -> true if allowed (optional)
// plus the profile methods listed in profiles.mjs
import * as E from './engine.mjs';
import { profileAction, verifiedProfile, noteLeague } from './profiles.mjs';

// Requests allowed per caller (by hashed IP address) per time window.
const LIMITS = {
  all: [600, 60],              // any request: 600 a minute
  room_create: [30, 3600],
  room_join: [120, 3600],
  league_create: [10, 3600],
  league_join: [60, 3600],
  profile_create: [10, 3600],
  friend_add: [60, 3600],
  invite: [120, 3600],
};

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, to avoid confusion with 1 and 0
const busyError = () => new E.GameError('The server is busy, please try again.');

export function secureRandom() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 4294967296;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function rateLimiter(store, ip) {
  let keyP = null;
  return async kind => {
    if (!store.rateLimit) return;
    keyP = keyP || sha256('holdem-rate:' + (ip || 'unknown')).then(h => h.slice(0, 24));
    const [limit, seconds] = LIMITS[kind];
    if (!(await store.rateLimit(`${kind}:${await keyP}`, limit, seconds))) {
      throw new E.GameError('Too many requests. Please wait a little and try again.');
    }
  };
}

function randomCode(length) {
  let code = '';
  for (let i = 0; i < length; i++) code += CODE_CHARS[Math.floor(secureRandom() * CODE_CHARS.length)];
  return code;
}

const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);
const cleanCode = (code, length) => {
  code = String(code || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== length) throw new E.GameError(length === 4 ? 'Room codes are 4 letters.' : 'League codes are 6 letters.');
  return code;
};

// A device's player profile: a random id plus a secret only that device knows.
// It lets the league table recognise you across tables, without accounts.
function cleanProfile(profile, required) {
  if (!profile) {
    if (required) throw new E.GameError('Missing player profile. Please reload the page.');
    return null;
  }
  const id = String(profile.id || ''), secret = String(profile.secret || '');
  if (!/^[a-z0-9]{12,40}$/.test(id) || secret.length < 16 || secret.length > 100) throw new E.GameError('Invalid player profile.');
  return { id, secret };
}

// ---------- Leagues ----------

function newLeague(code, name, now) {
  return { code, name, createdAt: now, members: {}, tournaments: [], processed: [] };
}

async function addMember(league, profile, name, now) {
  const hash = await sha256(profile.secret);
  const m = league.members[profile.id];
  if (m) {
    if (m.profileHash !== hash) throw new E.GameError('Could not verify your player profile for this league.');
    m.name = name;
    return;
  }
  league.members[profile.id] = {
    name, profileHash: hash, joinedAt: now,
    points: 0, tournaments: 0, wins: 0, podiums: 0, finishSum: 0, hands: 0, handsWon: 0, handsTied: 0,
  };
}

function applyEvents(league, events) {
  const member = (profileId, name) => league.members[profileId] || (league.members[profileId] = {
    name, profileHash: null, points: 0, tournaments: 0, wins: 0, podiums: 0, finishSum: 0, hands: 0, handsWon: 0, handsTied: 0,
  });
  for (const ev of events) {
    if (ev.type === 'hand') {
      for (const p of ev.players) {
        const m = member(p.profileId, p.name);
        m.hands++;
        if (p.result === 'won') m.handsWon++;
        if (p.result === 'tied') m.handsTied++;
      }
    } else if (ev.type === 'tournament') {
      if (league.processed.includes(ev.key)) continue; // never count a tournament twice
      league.processed.push(ev.key);
      if (league.processed.length > 200) league.processed.shift();
      for (const s of ev.standings) {
        if (!s.profileId) continue;
        const m = member(s.profileId, s.name);
        m.points += s.points;
        m.tournaments++;
        m.finishSum += s.place;
        if (s.place === 1) m.wins++;
        if (s.place <= 3) m.podiums++;
      }
      league.tournaments.unshift({ date: ev.date, players: ev.players, standings: ev.standings.map(({ name, profileId, place, points }) => ({ name, profileId, place, points })) });
      if (league.tournaments.length > 30) league.tournaments.length = 30;
    }
  }
}

export function leagueView(league, profileId) {
  const members = Object.entries(league.members).map(([pid, m]) => ({
    name: m.name, you: pid === profileId,
    points: m.points, tournaments: m.tournaments, wins: m.wins, podiums: m.podiums,
    avgFinish: m.tournaments ? Math.round(m.finishSum / m.tournaments * 10) / 10 : null,
    hands: m.hands, handsWon: m.handsWon,
    winPct: m.hands ? Math.round(m.handsWon / m.hands * 1000) / 10 : null,
  })).sort((a, b) => b.points - a.points || b.wins - a.wins || (b.winPct || 0) - (a.winPct || 0) || a.name.localeCompare(b.name));
  return {
    code: league.code, name: league.name, members,
    recent: league.tournaments.slice(0, 10).map(t => ({
      date: t.date, players: t.players, standings: t.standings.map(({ name, place, points }) => ({ name, place, points })),
    })),
    isMember: !!(profileId && league.members[profileId]),
  };
}

// Load, change and save a league, retrying if someone else saved it in between.
async function updateLeague(store, code, change) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const loaded = await store.loadLeague(code);
    if (!loaded) throw new E.GameError(`League ${code} not found.`);
    await change(loaded.league);
    if (await store.saveLeague(code, loaded.version, loaded.league)) return loaded.league;
  }
  throw busyError();
}

async function leagueAction(action, body, store, now, rateLimit) {
  if (action === 'league_create') {
    await rateLimit('league_create');
    const leagueName = E.cleanName(body.leagueName, 30);
    const profile = cleanProfile(body.profile, true);
    const { profile: me } = await verifiedProfile(store, profile);
    for (let attempt = 0; attempt < 6; attempt++) {
      const league = newLeague(randomCode(6), leagueName, now);
      await addMember(league, profile, me.name, now);
      if (await store.saveLeague(league.code, 0, league)) {
        await noteLeague(store, me.id, league.code);
        return { ok: true, league: leagueView(league, profile.id) };
      }
    }
    throw busyError();
  }
  const code = cleanCode(body.code, 6);
  const profile = cleanProfile(body.profile, action === 'league_join');
  if (action === 'league_join') {
    await rateLimit('league_join');
    const { profile: me } = await verifiedProfile(store, profile);
    const league = await updateLeague(store, code, l => addMember(l, profile, me.name, now));
    await noteLeague(store, me.id, code);
    return { ok: true, league: leagueView(league, profile.id) };
  }
  const loaded = await store.loadLeague(code);
  if (!loaded) throw new E.GameError(`League ${code} not found.`);
  return { ok: true, league: leagueView(loaded.league, profile && profile.id) };
}

// ---------- Rooms ----------

function views(room, playerId, now, extra = {}) {
  return {
    ok: true,
    state: E.publicView(room, now),
    me: playerId && room.players.some(p => p.id === playerId) ? E.privateView(room, playerId) : null,
    ...extra,
  };
}

// Save the room, then pass finished hands/tournaments on to its league.
async function saveRoom(store, code, version, room, now) {
  const events = room.events || [];
  room.events = [];
  if (!(await store.save(code, version, room, E.publicView(room, now)))) return false;
  if (room.league && events.length) {
    try { await updateLeague(store, room.league.code, l => applyEvents(l, events)); }
    catch (e) { console.error('League update failed', e); }
  }
  return true;
}

// ctx: { ip } from the server, for rate limits
export async function handle(body, store, now = Date.now(), ctx = {}) {
  const action = String(body.action || '');
  const rateLimit = rateLimiter(store, ctx.ip);
  await rateLimit('all');
  if (action.startsWith('league_')) return leagueAction(action, body, store, now, rateLimit);
  if (action.startsWith('profile_') || action.startsWith('friend_') || action.startsWith('invite')) {
    return profileAction(action, body, store, { now, rand: secureRandom, rateLimit, updateLeague });
  }

  if (action === 'create') {
    await rateLimit('room_create');
    let name = E.cleanName(body.name);
    const profile = cleanProfile(body.profile, false);
    // With a saved profile, the table uses the profile's name.
    if (profile && store.loadProfile && await store.loadProfile(profile.id)) name = (await verifiedProfile(store, profile)).profile.name;
    let league = null;
    if (body.league) {
      if (!profile) throw new E.GameError('Missing player profile. Please reload the page.');
      const l = await updateLeague(store, cleanCode(body.league, 6), l => addMember(l, profile, name, now));
      league = { code: l.code, name: l.name };
      await noteLeague(store, profile.id, l.code);
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = randomCode(4);
      const room = E.newRoom(code, now, { mode: body.mode, speed: body.speed, league });
      const token = crypto.randomUUID();
      const id = newId();
      E.addPlayer(room, { id, name, tokenHash: await sha256(token), profileId: profile && profile.id });
      if (await saveRoom(store, code, 0, room, now)) return views(room, id, now, { code, playerId: id, token });
    }
    throw new E.GameError('Could not create a room, please try again.');
  }

  const code = cleanCode(body.code, 4);
  const tokenHash = body.token ? await sha256(body.token) : null;
  const profile = cleanProfile(body.profile, false);
  let leagueChecked = false;

  // Retry if another player's move was saved between our load and save.
  for (let attempt = 0; attempt < 8; attempt++) {
    const loaded = await store.load(code);
    if (!loaded) throw new E.GameError(`Room ${code} not found.`);
    const { version, room } = loaded;
    room.events = [];
    const me = tokenHash ? room.players.find(p => p.tokenHash === tokenHash) : null;
    let extra = {};
    let changed = true;

    if (action === 'join') {
      if (me) return views(room, me.id, now, { code, playerId: me.id, token: body.token }); // rejoining
      if (!leagueChecked) await rateLimit('room_join');
      let name = E.cleanName(body.name);
      if (profile && store.loadProfile && await store.loadProfile(profile.id)) name = (await verifiedProfile(store, profile)).profile.name;
      // League tables: joining the table also joins its league.
      if (room.league && !leagueChecked) {
        if (!profile) throw new E.GameError('Missing player profile. Please reload the page.');
        await updateLeague(store, room.league.code, l => addMember(l, profile, name, now));
        await noteLeague(store, profile.id, room.league.code);
      }
      leagueChecked = true;
      const token = crypto.randomUUID();
      const id = newId();
      E.addPlayer(room, { id, name, tokenHash: await sha256(token), profileId: profile && profile.id });
      extra = { code, playerId: id, token };
    } else {
      if (!me) throw new E.GameError('You are not at this table.');
      switch (action) {
        case 'state': changed = false; break;
        case 'start': E.startGame(room, me.id, secureRandom, now); break;
        case 'act': E.act(room, me.id, String(body.move), now, body.amount); break;
        case 'next': changed = E.nextHand(room, secureRandom, now); break;
        case 'timeout': changed = E.timeout(room, now); break;
        case 'rebuy': E.rebuy(room, me.id); break;
        case 'leave': E.leave(room, me.id, now); break;
        default: throw new E.GameError('Unknown action.');
      }
    }

    if (!changed) return views(room, me.id, now);
    if (await saveRoom(store, code, version, room, now)) {
      return views(room, extra.playerId || me.id, now, extra);
    }
  }
  throw busyError();
}

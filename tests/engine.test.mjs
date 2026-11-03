// Run with: node tests/engine.test.mjs
import assert from 'node:assert/strict';
import * as E from '../supabase/functions/poker/engine.mjs';
import { handle } from '../supabase/functions/poker/api.mjs';

const P = globalThis.Poker;
const card = s => ({ r: '23456789TJQKA'.indexOf(s[0]) + 2, s: 'shdc'.indexOf(s[1]) });
const cards = s => s.split(' ').map(card);
let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('ok  ', name); }
  catch (e) { console.log('FAIL', name); console.log(e); process.exitCode = 1; }
};

// In-memory stand-in for the database (rooms + leagues), with version checks like the real one.
function makeStore() {
  const rooms = new Map(), leagues = new Map(), profiles = new Map();
  const table = (map, key) => ({
    async load(code) { const r = map.get(code); return r && { version: r.version, [key]: structuredClone(r.data) }; },
    async save(code, expected, data) {
      if (store.failNextSave) { store.failNextSave = false; const r = map.get(code); if (r) r.version++; return false; }
      const r = map.get(code);
      if (expected === 0) { if (r) return false; map.set(code, { version: 1, data: structuredClone(data) }); return true; }
      if (!r || r.version !== expected) return false;
      map.set(code, { version: expected + 1, data: structuredClone(data) });
      return true;
    },
  });
  const r = table(rooms, 'room'), l = table(leagues, 'league'), pr = table(profiles, 'profile');
  const store = {
    load: r.load, save: r.save, loadLeague: l.load, saveLeague: l.save, rooms, leagues, profiles, failNextSave: false,
    loadProfile: pr.load,
    async saveProfile(id, code, expected, profile) {
      if (expected === 0 && [...profiles.values()].some(x => x.data.friendCode === code)) return false;
      return pr.save(id, expected, profile);
    },
    async findProfileByFriendCode(code) { for (const [id, x] of profiles) if (x.data.friendCode === code) return id; return null; },
    async deleteProfile(id) { profiles.delete(id); },
    limits: new Map(), limitOverride: null,
    async rateLimit(key, limit) {
      const n = (store.limits.get(key) || 0) + 1;
      store.limits.set(key, n);
      return n <= (store.limitOverride ?? limit);
    },
  };
  return store;
}

function makeTournament(n, speed = 'fast') {
  const room = E.newRoom('TOUR', 0, { mode: 'tournament', speed });
  for (let i = 0; i < n; i++) E.addPlayer(room, { id: 'p' + i, name: 'P' + i, tokenHash: 'h' + i, profileId: 'profile' + i });
  return room;
}

function makeRoom(stacks) {
  const room = E.newRoom('TEST', 0);
  stacks.forEach((chips, i) => {
    E.addPlayer(room, { id: 'p' + i, name: 'P' + i, tokenHash: 'h' + i });
    room.players[i].chips = chips;
  });
  room.status = 'playing';
  return room;
}

// Replace the dealt cards with known ones. board = the 5 board cards in order.
function rig(room, holes, board) {
  const h = room.hand;
  h.ids.forEach((id, i) => { if (holes[i]) h.hole[id] = cards(holes[i]); });
  // dealStreet pops: burn, 3 flop, burn, turn, burn, river (pop takes from the end)
  const b = cards(board), filler = card('2c');
  h.deck = [b[4], filler, b[3], filler, b[2], b[1], b[0], filler].reverse();
}

const total = room => room.players.reduce((s, p) => s + p.chips, 0) +
  (room.hand && !room.hand.over ? room.hand.ids.reduce((s, id) => s + room.hand.contrib[id], 0) : 0);

function playOut(room, move = () => 'call', now = 1) {
  let guard = 0;
  while (room.hand && !room.hand.over && guard++ < 200) E.act(room, room.hand.toAct, move(room), now);
}

await test('hand evaluator still ranks hands', () => {
  assert.equal(P.handName(P.bestHand(cards('As Ks Qs Js Ts 2d 3c'))), 'Straight Flush');
  assert.equal(P.handName(P.bestHand(cards('Ah 2d 3c 4s 5h 9d Kc'))), 'Straight');
});

await test('multi-opponent win chance is sensible', () => {
  const aa1 = P.estimateEquity(cards('Ah Ad'), [], 3000, 1);
  const aa4 = P.estimateEquity(cards('Ah Ad'), [], 3000, 4);
  assert.ok(aa1 > 0.82 && aa1 < 0.89, aa1);
  assert.ok(aa4 > 0.50 && aa4 < 0.62, aa4); // AA vs 4 random hands ~56%
});

await test('heads-up: dealer posts small blind and acts first pre-flop', () => {
  const room = makeRoom([1000, 1000]);
  E.startHand(room, Math.random, 0);
  const h = room.hand;
  assert.equal(h.sbId, h.dealerId);
  assert.equal(h.toAct, h.dealerId);
  assert.equal(total(room), 2000);
});

await test('3 players: blinds left of dealer, first to act after big blind, button moves', () => {
  const room = makeRoom([1000, 1000, 1000]);
  E.startHand(room, Math.random, 0);
  const h = room.hand;
  assert.deepEqual([h.dealerId, h.sbId, h.bbId, h.toAct], ['p0', 'p1', 'p2', 'p0']);
  playOut(room);
  room.lastResult.endedAt = 0;
  E.nextHand(room, Math.random, 10000);
  assert.deepEqual([room.hand.dealerId, room.hand.sbId, room.hand.bbId], ['p1', 'p2', 'p0']);
});

await test('big blind gets the option to raise when everyone calls', () => {
  const room = makeRoom([1000, 1000, 1000]);
  E.startHand(room, Math.random, 0);
  E.act(room, 'p0', 'call', 1);
  E.act(room, 'p1', 'call', 1);
  assert.equal(room.hand.toAct, 'p2');
  assert.equal(room.hand.street, 0);
  E.act(room, 'p2', 'call', 1); // check
  assert.equal(room.hand.street, 1);
});

await test('everyone folds to one player: they win the blinds', () => {
  const room = makeRoom([1000, 1000, 1000]);
  E.startHand(room, Math.random, 0);
  E.act(room, 'p0', 'fold', 1);
  E.act(room, 'p1', 'fold', 1);
  assert.ok(room.hand.over);
  assert.equal(room.players[2].chips, 1010);
  assert.equal(room.players[2].stats.won, 1);
  assert.equal(room.players[0].stats.lost, 1);
  assert.equal(total(room), 3000);
});

await test('side pots: short all-in wins main pot, bigger stack wins side pot', () => {
  // p0 dealer (40 chips), p1 SB (100), p2 BB (1000)
  const room = makeRoom([40, 100, 1000]);
  E.startHand(room, Math.random, 0);
  rig(room, ['Ah As', 'Kh Ks', 'Qh Qs'], '2d 7c 9h Jd 3s'); // p0 best, p1 second
  const raiseAlways = r => (E.options(r, r.hand.toAct).canRaise ? 'raise' : 'call');
  playOut(room, raiseAlways);
  const [p0, p1, p2] = room.players;
  assert.equal(p0.chips, 120);           // main pot: 40 x 3
  assert.equal(p1.chips, 120);           // side pot: 60 x 2
  assert.equal(p2.chips, 900);           // lost 100
  assert.equal(p0.chips + p1.chips + p2.chips, 1140);
  assert.equal(p0.stats.won, 1);
  assert.equal(p1.stats.won, 1);
  assert.equal(p2.stats.lost, 1);
});

await test('split pots are shared between tied players', () => {
  const room = makeRoom([1000, 1000, 1000]);
  E.startHand(room, Math.random, 0);
  rig(room, ['2c 3d', 'Kh 4s', 'Kd 4c'], 'Ac Ad 9h 9s 7c'); // p1 & p2 tie (AA99K)
  E.act(room, 'p0', 'call', 1);   // 20
  E.act(room, 'p1', 'call', 1);   // 20
  E.act(room, 'p2', 'call', 1);   // check: pot 60
  E.act(room, 'p1', 'raise', 1);  // bets 20 on flop (pot 80)
  E.act(room, 'p2', 'call', 1);   // pot 100
  E.act(room, 'p0', 'fold', 1);
  // pot 100 split evenly
  playOut(room);
  assert.equal(room.players[1].chips, 1010);
  assert.equal(room.players[2].chips, 1010);
  assert.equal(room.players[1].stats.tied, 1);
  assert.equal(total(room), 3000);

  const r2 = makeRoom([1000, 1000, 1000]);
  E.startHand(r2, Math.random, 0);
  rig(r2, ['2c 3d', 'Kh 4s', 'Kd 4c'], 'Ac Ad 9h 9s 7c');
  E.act(r2, 'p0', 'fold', 1);     // pot 30 (10 + 20)
  E.act(r2, 'p1', 'call', 1);     // pot 40
  E.act(r2, 'p2', 'call', 1);
  playOut(r2);                     // 40 split 20/20
  assert.equal(r2.players[1].chips + r2.players[2].chips, 2000);
});

await test('no-limit: minimum bet and raise, custom amounts, bad amounts rejected', () => {
  const room = makeRoom([1000, 1000, 1000]);
  E.startHand(room, Math.random, 0);
  // p0 first to act pre-flop facing the big blind of 20: min raise is to 40, max is all in (1000)
  let o = E.options(room, 'p0');
  assert.deepEqual([o.toCall, o.min, o.max, o.isBet], [20, 40, 1000, false]);
  assert.throws(() => E.act(room, 'p0', 'raise', 1, 30), /minimum raise is to 40/);
  assert.throws(() => E.act(room, 'p0', 'raise', 1, 1001), /most you can/);
  assert.throws(() => E.act(room, 'p0', 'raise', 1, 55.5), /whole number/);
  E.act(room, 'p0', 'raise', 1, 100);         // raise of 80
  o = E.options(room, 'p1');
  assert.equal(o.min, 180);                   // next raise must be at least another 80
  E.act(room, 'p1', 'raise', 1, 250);         // raise of 150
  assert.equal(E.options(room, 'p2').min, 400);
  E.act(room, 'p2', 'fold', 1);
  E.act(room, 'p0', 'call', 1);               // p0 calls 150 more
  assert.equal(room.hand.street, 1);
  o = E.options(room, room.hand.toAct);
  assert.deepEqual([o.isBet, o.min, o.top], [true, 20, 0]); // post-flop the smallest bet is the big blind
  assert.equal(room.log.filter(l => /raises to 250/.test(l)).length, 1);
});

await test('no-limit: all in, and calling an all in for less', () => {
  const room = makeRoom([1000, 300]);
  E.startHand(room, Math.random, 0);          // p0 dealer/SB acts first heads-up
  E.act(room, 'p0', 'allin', 1);
  assert.equal(room.players[0].chips, 0);
  assert.ok(room.log.some(l => /raises to 1000 \(all in\)/.test(l)));
  const o = E.options(room, 'p1');
  assert.equal(o.callAmount, 280);            // p1 can only call with what they have
  assert.equal(o.canRaise, false);
  E.act(room, 'p1', 'call', 1);
  assert.ok(room.hand.over);                  // board runs out, showdown
  assert.equal(room.players[0].chips + room.players[1].chips, 1300);
  assert.ok(room.players.some(p => p.chips >= 700)); // p0 always gets back the 700 nobody could call
});

await test('no-limit: a short all-in raise does not lower the minimum raise', () => {
  const room = makeRoom([1000, 1000, 130]);
  E.startHand(room, Math.random, 0);
  E.act(room, 'p0', 'raise', 1, 100);         // raise of 80
  E.act(room, 'p1', 'call', 1);
  E.act(room, 'p2', 'allin', 1);              // BB all in to 130: only 30 more, not a full raise
  assert.equal(E.options(room, 'p0').min, 210); // still needs a full 80 raise over 130
});

await test('player leaving on their turn folds them and play continues', () => {
  const room = makeRoom([1000, 1000, 1000]);
  E.startHand(room, Math.random, 0);
  E.leave(room, 'p0', 1);
  assert.equal(room.hand.toAct, 'p1');
  E.act(room, 'p1', 'fold', 1);
  assert.ok(room.hand.over);
  room.lastResult.endedAt = 0;
  E.nextHand(room, Math.random, 10000);
  assert.equal(room.players.length, 2);
});

await test('timeout auto-checks or folds only after 45s', () => {
  const room = makeRoom([1000, 1000]);
  E.startHand(room, Math.random, 0);
  assert.equal(E.timeout(room, 10000), false);
  assert.equal(E.timeout(room, 46000), true);
  assert.ok(room.hand.over); // SB facing the big blind folds
});

await test('fuzz: thousands of random hands keep chips conserved and turns valid', () => {
  let hands = 0;
  for (let game = 0; game < 250; game++) {
    const n = 2 + (game % 5);
    const room = makeRoom(Array.from({ length: n }, () => 20 + Math.floor(Math.random() * 300)));
    let money = total(room);
    let now = 0;
    for (let k = 0; k < 20; k++) {
      now += 10000;
      if (room.lastResult) room.lastResult.endedAt = 0;
      if (!E.startHand(room, Math.random, now)) {
        const broke = room.players.find(p => p.chips === 0);
        if (!broke) break;
        E.rebuy(room, broke.id); money += 1000;
        continue;
      }
      hands++;
      let guard = 0;
      while (!room.hand.over) {
        assert.ok(guard++ < 100, 'hand never ended');
        const id = room.hand.toAct;
        const p = room.players.find(x => x.id === id);
        assert.ok(p && p.chips > 0 && !room.hand.folded[id], 'invalid player to act');
        assert.equal(total(room), money);
        const r = Math.random();
        if (r < 0.01) { E.leave(room, id, now); money -= 0; continue; }
        const opt = E.options(room, id);
        if (r < 0.12) E.act(room, id, 'fold', now);
        else if (r < 0.18) E.act(room, id, 'allin', now);
        else if (r < 0.5 && opt.canRaise) {
          // a random legal amount between the minimum and all in
          E.act(room, id, 'raise', now, opt.min + Math.floor(Math.random() * (opt.max - opt.min + 1)));
        } else E.act(room, id, 'call', now);
      }
      assert.equal(total(room), money, 'chips not conserved after hand');
      assert.ok(room.players.every(p => p.chips >= 0));
      // players who left take their chips with them
      for (const p of room.players.filter(p => p.leaving)) money -= p.chips;
    }
  }
  assert.ok(hands > 3000, `only ${hands} hands`);
  console.log(`      (${hands} hands played)`);
});

await test('api: create, join, start, play, and racing saves', async () => {
  const store = makeStore();
  const a = await handle({ action: 'create', name: 'Alice' }, store, 0);
  assert.match(a.code, /^[A-Z]{4}$/);
  const b = await handle({ action: 'join', code: a.code.toLowerCase(), name: 'alice' }, store, 0);
  assert.equal(b.state.players[1].name, 'alice 2'); // names are made unique
  await assert.rejects(handle({ action: 'start', code: a.code, token: b.token }, store, 0), /Only the host/);
  await assert.rejects(handle({ action: 'state', code: a.code, token: 'nope' }, store, 0), /not at this table/);
  let s = await handle({ action: 'start', code: a.code, token: a.token }, store, 0);
  assert.equal(s.me.hole.length, 2);
  // Nobody can see anyone else's cards in the public state.
  assert.ok(!JSON.stringify(s.state).includes('tokenHash'));
  assert.ok(!JSON.stringify(s.state).includes('"hole"'));
  assert.ok(!JSON.stringify(s.state).includes('deck'));
  const tokens = { [a.playerId]: a.token, [b.playerId]: b.token };
  store.failNextSave = true; // simulate another player's save sneaking in
  for (let i = 0; i < 40 && !s.state.hand.over; i++) {
    s = await handle({ action: 'act', code: a.code, token: tokens[s.state.hand.toAct], move: 'call' }, store, 1);
  }
  assert.ok(s.state.hand.over);
  assert.ok(s.state.lastResult.shown); // showdown reveals live hands
  const chips = s.state.players.reduce((t, p) => t + p.chips, 0);
  assert.equal(chips, 2000);
  const again = await handle({ action: 'join', code: a.code, token: a.token }, store, 2);
  assert.equal(again.playerId, a.playerId); // rejoin with saved token
});

await test('tournament: blinds go up every 4 hands on fast', () => {
  const room = makeTournament(3);
  E.startGame(room, 'p0', Math.random, 0);
  assert.equal(room.hand.bb, 20);
  let now = 0;
  for (let k = 0; k < 4; k++) {
    playOut(room, () => 'fold', now);
    now += 10000;
    E.nextHand(room, Math.random, now);
  }
  assert.equal(room.hand.bb, 30); // 5th hand: level 2
  assert.ok(room.log.some(l => l.includes('Blinds go up to 15/30')));
  assert.throws(() => E.rebuy(room, 'p0'), /no rebuys/);
});

await test('tournament: random tournaments always end with one winner and correct places', () => {
  let totalHands = 0;
  for (let game = 0; game < 120; game++) {
    const n = 2 + (game % 5);
    const room = makeTournament(n, game % 2 ? 'fast' : 'normal');
    E.startGame(room, 'p0', Math.random, 0);
    let now = 0, guard = 0;
    while (room.status === 'playing') {
      assert.ok(guard++ < 5000, 'tournament never ended');
      if (room.hand && !room.hand.over) {
        const r = Math.random();
        E.act(room, room.hand.toAct, r < 0.1 ? 'fold' : r < 0.6 ? 'raise' : 'call', now);
        if (room.status === 'playing') assert.equal(total(room), n * 1000, 'chips not conserved');
      } else {
        now += 10000;
        assert.ok(E.nextHand(room, Math.random, now), 'next hand did not start');
        totalHands++;
      }
    }
    const t = room.tournament;
    assert.equal(room.status, 'finished');
    assert.deepEqual(Object.values(t.places).sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i + 1));
    assert.equal(t.standings[0].place, 1);
    assert.equal(room.players.find(p => p.id === t.standings[0].id).chips, n * 1000); // winner has every chip
    assert.equal(t.standings.reduce((s, x) => s + x.points, 0), n * (n + 1) / 2);
    assert.equal(room.events.filter(e => e.type === 'tournament').length, 1);
    assert.equal(E.nextHand(room, Math.random, now + 99999), false); // no more hands
  }
  console.log(`      (120 tournaments, ${totalHands} hands)`);
});

await test('tournament: leaving knocks you out; late joiners watch until the next one; play again', () => {
  const room = makeTournament(4);
  E.startGame(room, 'p0', Math.random, 0);
  playOut(room, () => 'fold', 1);           // hand over
  E.leave(room, 'p3', 2);                   // leaves between hands
  assert.equal(room.tournament.places.p3, 4);
  E.addPlayer(room, { id: 'p9', name: 'Late', tokenHash: 'h9' });
  const late = room.players.find(p => p.id === 'p9');
  assert.ok(late.watching && late.chips === 0);
  E.nextHand(room, Math.random, 20000);
  assert.ok(!room.hand.ids.includes('p9'));
  E.leave(room, 'p1', 20001);               // leaves during a hand
  E.leave(room, 'p2', 20002);
  assert.equal(room.status, 'finished');
  assert.equal(room.tournament.standings[0].id, 'p0');
  assert.throws(() => E.startGame(room, 'p9', Math.random, 30000), /Only the host/);
  E.startGame(room, 'p0', Math.random, 30000); // play again
  assert.equal(room.tournament.no, 2);
  assert.equal(room.tournament.entrants.length, 2); // p0 and the late joiner
  assert.ok(room.hand.ids.includes('p9'));
});

await test('league: tournament results and hands go into the league table', async () => {
  const store = makeStore();
  const prof = i => ({ id: 'deviceprofile' + i, secret: 'secret-secret-secret-' + i });
  for (const [i, name] of [[1, 'Alice'], [2, 'Bob'], [3, 'Cara']]) await handle({ action: 'profile_save', profile: prof(i), name }, store, 0);
  const lg = await handle({ action: 'league_create', leagueName: 'Friday Night', name: 'Alice', profile: prof(1) }, store, 0);
  assert.match(lg.league.code, /^[A-Z]{6}$/);
  const code = lg.league.code;
  await assert.rejects(handle({ action: 'league_join', code, name: 'Imposter', profile: { id: prof(1).id, secret: 'wrong-wrong-wrong-wrong' } }, store, 0), /verify/);

  const a = await handle({ action: 'create', name: 'Alice', profile: prof(1), mode: 'tournament', speed: 'fast', league: code }, store, 0);
  assert.equal(a.state.league.name, 'Friday Night');
  const b = await handle({ action: 'join', code: a.code, name: 'Bob', profile: prof(2) }, store, 0);
  const c = await handle({ action: 'join', code: a.code, name: 'Cara', profile: prof(3) }, store, 0);
  let view = await handle({ action: 'league_view', code, profile: prof(2) }, store, 0);
  assert.equal(view.league.members.length, 3);   // joining the table joined the league
  assert.ok(view.league.isMember);

  const tokens = { [a.playerId]: a.token, [b.playerId]: b.token, [c.playerId]: c.token };
  let s = await handle({ action: 'start', code: a.code, token: a.token }, store, 0);
  let now = 0;
  for (let i = 0; i < 4000 && s.state.status === 'playing'; i++) {
    if (s.state.hand && !s.state.hand.over) {
      s = await handle({ action: 'act', code: a.code, token: tokens[s.state.hand.toAct], move: Math.random() < 0.6 ? 'raise' : 'call' }, store, now);
    } else {
      now += 10000;
      s = await handle({ action: 'next', code: a.code, token: a.token }, store, now);
    }
  }
  assert.equal(s.state.status, 'finished');
  const standings = s.state.tournament.standings;
  view = await handle({ action: 'league_view', code }, store, now);
  const top = view.league.members[0];
  assert.equal(top.name, standings[0].name);
  assert.equal(top.points, 3);
  assert.equal(top.wins, 1);
  assert.equal(view.league.members.reduce((t, m) => t + m.points, 0), 6);
  assert.equal(view.league.members.reduce((t, m) => t + m.tournaments, 0), 3);
  assert.ok(view.league.members.every(m => m.hands > 0));
  assert.equal(view.league.recent.length, 1);
  assert.ok(!JSON.stringify(view).includes('profileHash'));
  assert.ok(!JSON.stringify(view).includes('secret'));

  // Play again: a second tournament adds to the table
  s = await handle({ action: 'start', code: a.code, token: a.token }, store, now + 1);
  assert.equal(s.state.status, 'playing');
  assert.equal(s.state.tournament.no, 2);
});

await test('cash is the default mode, and rooms saved by the previous version still load', async () => {
  const store = makeStore();
  const a = await handle({ action: 'create', name: 'Alice' }, store, 0);
  assert.equal(a.state.mode, 'cash');
  const room = store.rooms.get(a.code).data;
  delete room.mode; delete room.events; delete room.tournament; // like a room saved by the old version
  await handle({ action: 'join', code: a.code, name: 'Bob' }, store, 0);
  const s = await handle({ action: 'start', code: a.code, token: a.token }, store, 0);
  assert.equal(s.state.hand.no, 1);
});

await test('profiles: create, rename, friends, invites, delete', async () => {
  const store = makeStore();
  const prof = i => ({ id: 'phoneprofile' + i, secret: 'a-long-secret-value-' + i });
  const a = await handle({ action: 'profile_save', profile: prof(1), name: 'Ann' }, store, 0);
  assert.match(a.profile.friendCode, /^[A-HJ-NP-Z2-9]{8}$/);
  const b = await handle({ action: 'profile_save', profile: prof(2), name: 'Ben<script>' }, store, 0);
  assert.equal(b.profile.name, 'Benscript');                      // no markup in names
  await assert.rejects(handle({ action: 'profile_get', profile: { id: prof(1).id, secret: 'wrong-secret-wrong-secret' } }, store, 0), /verify/);
  await assert.rejects(handle({ action: 'profile_get', profile: prof(9) }, store, 0), /Profile not found/);
  const renamed = await handle({ action: 'profile_save', profile: prof(1), name: 'Annie' }, store, 0);
  assert.equal(renamed.profile.name, 'Annie');
  assert.equal(renamed.profile.friendCode, a.profile.friendCode); // code doesn't change

  await assert.rejects(handle({ action: 'friend_add', profile: prof(1), friendCode: a.profile.friendCode }, store, 0), /your own/);
  await assert.rejects(handle({ action: 'friend_add', profile: prof(1), friendCode: 'ZZZZZZZZ' }, store, 0), /No player/);
  const af = await handle({ action: 'friend_add', profile: prof(1), friendCode: b.profile.friendCode.toLowerCase() }, store, 0);
  assert.deepEqual(af.profile.friends.map(f => f.name), ['Benscript']);
  const bf = await handle({ action: 'profile_get', profile: prof(2) }, store, 0);
  assert.deepEqual(bf.profile.friends.map(f => f.name), ['Annie']); // friendship works both ways

  // Invites need you to be at the table and the other person to be a friend.
  const t = await handle({ action: 'create', name: 'ignored', profile: prof(1) }, store, 0);
  assert.equal(t.state.players[0].name, 'Annie');                 // tables use the profile name
  await assert.rejects(handle({ action: 'invite', profile: prof(2), friendId: prof(1).id, room: t.code }, store, 0), /Join a table/);
  await handle({ action: 'invite', profile: prof(1), friendId: prof(2).id, room: t.code }, store, 0);
  let bv = await handle({ action: 'profile_get', profile: prof(2) }, store, 1000);
  assert.equal(bv.profile.invites.length, 1);
  assert.equal(bv.profile.invites[0].fromName, 'Annie');
  assert.equal(bv.profile.invites[0].room, t.code);
  bv = await handle({ action: 'profile_get', profile: prof(2) }, store, 4 * 3600 * 1000);
  assert.equal(bv.profile.invites.length, 0);                     // invites expire after 3 hours
  await handle({ action: 'invite', profile: prof(1), friendId: prof(2).id, room: t.code }, store, 5 * 3600 * 1000);
  bv = await handle({ action: 'invite_dismiss', profile: prof(2), room: t.code }, store, 5 * 3600 * 1000);
  assert.equal(bv.profile.invites.length, 0);

  // Delete: friends forget you, leagues keep results without your name.
  const lg = await handle({ action: 'league_create', leagueName: 'Club', profile: prof(1) }, store, 0);
  await handle({ action: 'league_join', code: lg.league.code, profile: prof(2) }, store, 0);
  const lgRoom = store.leagues.get(lg.league.code).data;
  lgRoom.tournaments.push({ date: 0, players: 2, standings: [{ name: 'Annie', profileId: prof(1).id, place: 1, points: 2 }] });
  await handle({ action: 'profile_delete', profile: prof(1) }, store, 0);
  assert.ok(!store.profiles.has(prof(1).id));
  bv = await handle({ action: 'profile_get', profile: prof(2) }, store, 0);
  assert.equal(bv.profile.friends.length, 0);
  const view = await handle({ action: 'league_view', code: lg.league.code }, store, 0);
  assert.ok(view.league.members.some(m => m.name === 'Deleted player'));
  assert.ok(!JSON.stringify(view).includes('Annie'));
  assert.ok(!JSON.stringify(store.leagues.get(lg.league.code).data).includes('Annie'));
  await assert.rejects(handle({ action: 'profile_get', profile: prof(1) }, store, 0), /Profile not found/);
});

await test('rate limits stop floods of new rooms', async () => {
  const store = makeStore();
  for (let i = 0; i < 30; i++) await handle({ action: 'create', name: 'Spam' }, store, 0, { ip: '1.2.3.4' });
  await assert.rejects(handle({ action: 'create', name: 'Spam' }, store, 0, { ip: '1.2.3.4' }), /Too many requests/);
  await handle({ action: 'create', name: 'Other' }, store, 0, { ip: '5.6.7.8' }); // other people unaffected
});

console.log(`\n${passed} tests passed${process.exitCode ? ', some FAILED' : ''}`);

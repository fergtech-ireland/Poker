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
        E.act(room, id, r < 0.15 ? 'fold' : r < 0.5 ? 'raise' : 'call', now);
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
  const db = new Map();
  let failNextSave = false;
  const store = {
    async load(code) { const r = db.get(code); return r && { version: r.version, room: structuredClone(r.room) }; },
    async save(code, expected, room) {
      if (failNextSave) { failNextSave = false; const r = db.get(code); r.version++; return false; }
      const r = db.get(code);
      if (expected === 0) { if (r) return false; db.set(code, { version: 1, room: structuredClone(room) }); return true; }
      if (!r || r.version !== expected) return false;
      db.set(code, { version: expected + 1, room: structuredClone(room) });
      return true;
    },
  };
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
  failNextSave = true; // simulate another player's save sneaking in
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

console.log(`\n${passed} tests passed${process.exitCode ? ', some FAILED' : ''}`);

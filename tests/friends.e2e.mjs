// End-to-end test of "With Friends" with three players in separate browsers.
// The server function is answered locally by the same api.mjs/engine.mjs code that is deployed,
// with an in-memory store. Needs Playwright:  NODE_PATH=$(npm root -g) node tests/friends.e2e.mjs
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handle } from '../supabase/functions/poker/api.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FN_URL = 'https://lcekdvxhuimoxpiadism.supabase.co/functions/v1/poker';

// ---- static file server ----
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(0);
const BASE = `http://localhost:${server.address().port}`;

// ---- in-memory "database" ----
const db = new Map();
const store = {
  async load(code) { const r = db.get(code); return r && { version: r.version, room: structuredClone(r.room) }; },
  async save(code, expected, room) {
    const r = db.get(code);
    if (expected === 0) { if (r) return false; db.set(code, { version: 1, room: structuredClone(room) }); return true; }
    if (!r || r.version !== expected) return false;
    db.set(code, { version: expected + 1, room: structuredClone(room) });
    return true;
  },
};
let calls = 0;

const browser = await chromium.launch();
const errors = [];
async function player(name, device) {
  const ctx = await browser.newContext(device ? { ...devices[device] } : { viewport: { width: 900, height: 900 } });
  await ctx.route('**/realtime/**', r => r.abort());
  await ctx.route(FN_URL, async route => {
    calls++;
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, body: 'ok' });
    try {
      const body = await handle(JSON.parse(req.postData()), store);
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    } catch (e) {
      route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: e.message }) });
    }
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.on('dialog', d => d.accept());
  page.playerName = name;
  return page;
}

const check = (cond, msg) => { if (!cond) throw new Error('Check failed: ' + msg); console.log('ok  ', msg); };
const totalChips = () => {
  const { room } = [...db.values()][0];
  const pot = room.hand && !room.hand.over ? room.hand.ids.reduce((s, id) => s + room.hand.contrib[id], 0) : 0;
  return room.players.reduce((s, p) => s + p.chips, 0) + pot;
};

try {
  const alice = await player('Alice', 'iPhone 13');
  const bob = await player('Bob');
  const cara = await player('Cara', 'Pixel 7');

  // Alice creates a room
  await alice.goto(`${BASE}/friends.html`);
  await alice.fill('#name-input', 'Alice');
  await alice.click('#create-btn');
  await alice.waitForSelector('#lobby-view:not([hidden])');
  const code = (await alice.textContent('#lobby-code')).trim();
  check(/^[A-Z]{4}$/.test(code), `room created with code ${code}`);
  check((await alice.isVisible('#start-btn')) && (await alice.isDisabled('#start-btn')), 'host sees Start, disabled until someone joins');

  // Bob joins from the invite link, Cara by typing the code
  await bob.goto(`${BASE}/friends.html?room=${code}`);
  check((await bob.inputValue('#code-input')) === code, 'invite link pre-fills the room code');
  await bob.fill('#name-input', 'Bob');
  await bob.click('#join-btn');
  await cara.goto(`${BASE}/friends.html`);
  await cara.fill('#name-input', 'Cara');
  await cara.fill('#code-input', code.toLowerCase());
  await cara.click('#join-btn');
  await cara.waitForSelector('#lobby-view:not([hidden])');
  check((await cara.textContent('#lobby-wait')).includes('Alice'), 'non-host waits for the host');
  await alice.waitForFunction(() => document.querySelectorAll('#lobby-list li').length === 3, null, { timeout: 8000 });
  check(true, 'host sees all 3 players in the lobby');

  // Start
  await alice.click('#start-btn');
  for (const p of [alice, bob, cara]) await p.waitForSelector('#game-view:not([hidden])', { timeout: 8000 });
  check(true, 'everyone is moved to the table when the host starts');
  for (const p of [alice, bob, cara]) {
    const own = await p.$$eval('#your-cards .card:not(.back)', els => els.length);
    const backs = await p.$$eval('.seat-box .card.back', els => els.length);
    check(own === 2 && backs === 4, `${p.playerName} sees own 2 cards and only card backs for the other 2 players`);
  }
  await alice.waitForFunction(() => document.querySelector('#equity').textContent.includes('%'), null, { timeout: 5000 });
  check((await alice.textContent('#equity')).includes('vs 2'), 'win chance shown against 2 opponents');

  // Play hands (realtime is blocked here, so pages see moves via 2.5s polling): whoever's turn it is picks a random move
  const pages = [alice, bob, cara];
  const handsPlayed = () => [...db.values()][0].room.handNo;
  let reloaded = false, shot = false;
  const started = Date.now();
  const deadline = Date.now() + 240000;
  while (handsPlayed() < 6 && Date.now() < deadline) {
    let acted = false;
    for (const p of pages) {
      if (await p.isVisible('#call-btn') && await p.isEnabled('#call-btn')) {
        const r = Math.random();
        const canRaise = await p.isEnabled('#raise-btn');
        const canFold = await p.isEnabled('#fold-btn');
        // The button can disable itself if the page updates between the check and the click.
        await p.click(canRaise && r < 0.3 ? '#raise-btn' : canFold && r > 0.85 ? '#fold-btn' : '#call-btn', { timeout: 1500 }).catch(() => {});
        acted = true;
        if (!shot && handsPlayed() >= 2) { await alice.screenshot({ path: '/tmp/friends-alice.png' }); shot = true; }
        break;
      }
      if (await p.isVisible('#rebuy-btn')) { await p.click('#rebuy-btn', { timeout: 1500 }).catch(() => {}); acted = true; }
    }
    if (!acted) await alice.waitForTimeout(300);
    const room = [...db.values()][0].room;
    const rebuys = room.players.reduce((s, p) => s + (p.stats.rebuys || 0), 0);
    if (totalChips() !== 3000 + rebuys * 1000) throw new Error(`chips not conserved: ${totalChips()}`);
    if (!reloaded && handsPlayed() >= 3) {
      await bob.reload();
      await bob.waitForSelector('#game-view:not([hidden])', { timeout: 8000 });
      reloaded = true;
      check(true, 'Bob reloads the page and is put straight back at the table');
    }
  }
  check(handsPlayed() >= 6, `${handsPlayed() - 1} hands played back to back in ${Math.round((Date.now() - started) / 1000)}s (polling only), chips always conserved`);

  // Stats: table scores and this-device stats
  await alice.waitForTimeout(3000);
  const rows = await alice.$$eval('#score-body tr', trs => trs.length);
  check(rows === 3, 'table scores list all 3 players');
  const room = [...db.values()][0].room;
  const aliceServer = room.players.find(p => p.name === 'Alice').stats;
  const aliceLocal = Number(await alice.textContent('#stat-played'));
  check(aliceLocal >= aliceServer.played - 1 && aliceLocal <= aliceServer.played, `Alice's device stats track her hands (${aliceLocal} vs server ${aliceServer.played})`);
  const pctText = await alice.textContent('#stat-pct');
  check(/%$/.test(pctText), `win % shown (${pctText})`);

  // Cara leaves; after the hand she's gone for the others
  await cara.click('#leave-btn');
  await cara.waitForSelector('#home-view:not([hidden])');
  check(true, 'Cara leaves and returns to the start screen');
  const leaveDeadline = Date.now() + 40000;
  while (Date.now() < leaveDeadline && [...db.values()][0].room.players.length > 2) {
    for (const p of [alice, bob]) if (await p.isVisible('#call-btn') && await p.isEnabled('#call-btn')) await p.click('#call-btn', { timeout: 1500 }).catch(() => {});
    await alice.waitForTimeout(300);
  }
  await alice.waitForFunction(() => document.querySelectorAll('#score-body tr').length === 2, null, { timeout: 8000 });
  check(true, 'Cara is removed from the table for everyone');

  // Not-your-turn and bad room code errors
  await cara.fill('#code-input', 'QQQQ');
  await cara.click('#join-btn');
  await cara.waitForFunction(() => /not found/.test(document.querySelector('#home-error').textContent));
  check(true, 'joining a room that does not exist shows an error');

  check(errors.length === 0, 'no JavaScript errors in any browser' + (errors.length ? ': ' + errors.join('; ') : ''));
  console.log(`\nAll checks passed (${calls} server calls).`);
} catch (e) {
  console.log('FAIL', e.message);
  if (errors.length) console.log(errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}

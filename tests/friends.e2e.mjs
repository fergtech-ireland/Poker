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

// ---- in-memory "database" (rooms + leagues) ----
const db = new Map(), leagueDb = new Map();
const table = (map, key) => ({
  async load(code) { const r = map.get(code); return r && { version: r.version, [key]: structuredClone(r.data) }; },
  async save(code, expected, data) {
    const r = map.get(code);
    if (expected === 0) { if (r) return false; map.set(code, { version: 1, data: structuredClone(data) }); return true; }
    if (!r || r.version !== expected) return false;
    map.set(code, { version: expected + 1, data: structuredClone(data) });
    return true;
  },
});
const profileDb = new Map();
const rooms = table(db, 'room'), leagues = table(leagueDb, 'league'), profiles = table(profileDb, 'profile');
const store = {
  load: rooms.load, save: rooms.save, loadLeague: leagues.load, saveLeague: leagues.save,
  loadProfile: profiles.load,
  async saveProfile(id, code, expected, p) {
    if (expected === 0 && [...profileDb.values()].some(x => x.data.friendCode === code)) return false;
    return profiles.save(id, expected, p);
  },
  async findProfileByFriendCode(code) { for (const [id, x] of profileDb) if (x.data.friendCode === code) return id; return null; },
  async deleteProfile(id) { profileDb.delete(id); },
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
      route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: e.message, code: e.code }) });
    }
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.on('console', m => { if (/Content Security Policy|Refused to/.test(m.text())) errors.push(`${name} CSP: ${m.text()}`); });
  page.on('dialog', d => (d.type() === 'prompt' ? d.accept(name) : d.accept()));
  page.playerName = name;
  return page;
}

// First visit: choose a player name to create the profile.
async function setup(page, name) {
  await page.waitForSelector('#setup-view:not([hidden])');
  await page.fill('#name-input', name);
  await page.click('#setup-btn');
  await page.waitForFunction(() => document.querySelector('#setup-view').hidden);
}
// Raise opens the chip panel: tap a few random chips (or sometimes All in) and confirm.
let betsPlaced = 0, allIns = 0;
async function raise(p, { noAllIn = false } = {}) {
  if (noAllIn && /^All in/.test(await p.textContent('#raise-btn'))) {
    await p.click('#call-btn', { timeout: 1500 }).catch(() => {});
    return;
  }
  // If the panel is still open from a missed confirm, use it rather than toggling it shut.
  if (!(await p.isVisible('#bet-panel'))) await p.click('#raise-btn', { timeout: 1500 }).catch(() => {});
  if (!(await p.isVisible('#bet-panel'))) return; // went straight all in
  if (!noAllIn && Math.random() < 0.08) { await p.click('#bet-panel .bet-allin').catch(() => {}); allIns++; }
  else {
    for (let k = Math.floor(Math.random() * 3); k > 0; k--) {
      const open = await p.$$('#bet-panel [data-chip]:not([disabled])');
      if (open.length) await open[Math.floor(Math.random() * Math.min(open.length, 3))].click().catch(() => {});
    }
  }
  await p.click('#bet-panel .bet-confirm', { timeout: 1500 }).then(() => betsPlaced++).catch(() => {});
}
const check = (cond, msg) => { if (!cond) throw new Error('Check failed: ' + msg); console.log('ok  ', msg); };
const totalChips = () => {
  const room = [...db.values()][0].data;
  const pot = room.hand && !room.hand.over ? room.hand.ids.reduce((s, id) => s + room.hand.contrib[id], 0) : 0;
  return room.players.reduce((s, p) => s + p.chips, 0) + pot;
};

try {
  const alice = await player('Alice', 'iPhone 13');
  const bob = await player('Bob');
  const cara = await player('Cara', 'Pixel 7');

  // Alice creates a room
  await alice.goto(`${BASE}/friends.html`);
  check(await alice.isVisible('#setup-view'), 'first visit asks for a player name');
  await setup(alice, 'Alice');
  check((await alice.textContent('#me-name')) === 'Alice' && /^[A-Z0-9]{8}$/.test(await alice.textContent('#me-code')), 'profile created with an 8-character friend code');
  await alice.click('#create-btn');
  await alice.waitForSelector('#lobby-view:not([hidden])');
  const code = (await alice.textContent('#lobby-code')).trim();
  check(/^[A-Z]{4}$/.test(code), `room created with code ${code}`);
  check((await alice.isVisible('#start-btn')) && (await alice.isDisabled('#start-btn')), 'host sees Start, disabled until someone joins');

  // Bob joins from the invite link, Cara by typing the code
  await bob.goto(`${BASE}/friends.html?room=${code}`);
  await setup(bob, 'Bob');
  await bob.waitForSelector('#home-view:not([hidden])');
  check((await bob.inputValue('#code-input')) === code, 'invite link pre-fills the room code after creating a profile');
  await bob.click('#join-btn');
  await cara.goto(`${BASE}/friends.html`);
  await setup(cara, 'Cara');
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

  // Bet panel: custom amount, validation, then the raise reaches everyone
  {
    let actor = null;
    for (let i = 0; i < 40 && !actor; i++) {
      for (const p of [alice, bob, cara]) if (await p.isEnabled('#raise-btn')) { actor = p; break; }
      if (!actor) await alice.waitForTimeout(300);
    }
    await actor.click('#raise-btn');
    check(await actor.isVisible('#bet-panel'), 'Raise opens the chip panel');
    const chipValues = await actor.$$eval('#bet-panel [data-chip]', bs => bs.map(b => b.dataset.chip));
    check(chipValues.join(',') === '5,25,100,500,1000', `chips: ${chipValues.join(', ')}`);
    await actor.fill('#bet-panel .bet-input', '25');
    check(await actor.isDisabled('#bet-panel .bet-confirm') && /minimum/.test(await actor.textContent('#bet-panel .bet-hint')), 'a raise below the minimum is refused with a hint');
    await actor.fill('#bet-panel .bet-input', '99999');
    check(await actor.isDisabled('#bet-panel .bet-confirm'), 'more than your chips is refused');
    await actor.click('#bet-panel .bet-reset');
    const minRaise = Number(await actor.inputValue('#bet-panel .bet-input'));
    const target = minRaise + 35;
    await actor.click('#bet-panel [data-chip="25"]');
    await actor.click('#bet-panel [data-chip="5"]');
    await actor.click('#bet-panel [data-chip="5"]');
    check(new RegExp(`^(Raise to|Bet) ${target}$`).test(await actor.textContent('#bet-panel .bet-confirm')), `minimum ${minRaise} + chips 25 + 5 + 5 = ${target}`);
    await actor.click('#bet-panel .bet-confirm');
    await actor.waitForFunction(() => document.querySelector('#bet-panel').hidden);
    await alice.waitForFunction(t => new RegExp(`(raises to|bets) ${t}`).test(document.querySelector('#log').textContent), target, { timeout: 8000 });
    check(true, `the chip raise to ${target} is made and shown to everyone`);
  }

  // Play hands (realtime is blocked here, so pages see moves via 2.5s polling): whoever's turn it is picks a random move
  const pages = [alice, bob, cara];
  const handsPlayed = () => [...db.values()][0].data.handNo;
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
        if (canRaise && r < 0.3) await raise(p);
        else await p.click(canFold && r > 0.85 ? '#fold-btn' : '#call-btn', { timeout: 1500 }).catch(() => {});
        acted = true;
        if (!shot && handsPlayed() >= 2) { await alice.screenshot({ path: '/tmp/friends-alice.png' }); shot = true; }
        break;
      }
      if (await p.isVisible('#rebuy-btn')) { await p.click('#rebuy-btn', { timeout: 1500 }).catch(() => {}); acted = true; }
    }
    if (!acted) await alice.waitForTimeout(300);
    const room = [...db.values()][0].data;
    const rebuys = room.players.reduce((s, p) => s + (p.stats.rebuys || 0), 0);
    if (totalChips() !== 3000 + rebuys * 1000) throw new Error(`chips not conserved: ${totalChips()}`);
    if (!reloaded && handsPlayed() >= 3) {
      await bob.reload();
      await bob.waitForSelector('#game-view:not([hidden])', { timeout: 8000 });
      reloaded = true;
      check(true, 'Bob reloads the page and is put straight back at the table');
    }
  }
  console.log(`      (${betsPlaced} bets/raises through the panel, ${allIns} all-ins)`);
  check(handsPlayed() >= 6, `${handsPlayed() - 1} hands played back to back in ${Math.round((Date.now() - started) / 1000)}s (polling only), chips always conserved`);

  // Stats: table scores and this-device stats
  await alice.waitForTimeout(3000);
  const rows = await alice.$$eval('#score-body tr', trs => trs.length);
  check(rows === 3, 'table scores list all 3 players');
  const room = [...db.values()][0].data;
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
  while (Date.now() < leaveDeadline && [...db.values()][0].data.players.length > 2) {
    for (const p of [alice, bob]) if (await p.isVisible('#call-btn') && await p.isEnabled('#call-btn')) await p.click('#call-btn', { timeout: 1500 }).catch(() => {});
    await alice.waitForTimeout(300);
  }
  await alice.waitForFunction(() => document.querySelectorAll('#score-body tr').length === 2, null, { timeout: 8000 });
  check(true, 'Cara is removed from the table for everyone');

  // ---- League + tournament ----
  const dave = await player('Dave', 'iPhone 13');
  await cara.fill('#league-name-input', 'Friday Night');
  await cara.click('#league-create-btn');
  await cara.waitForSelector('#league-view:not([hidden])');
  const leagueCode = (await cara.textContent('#league-code')).trim();
  check(/^[A-Z]{6}$/.test(leagueCode), `league created with code ${leagueCode}`);

  await dave.goto(`${BASE}/friends.html?league=${leagueCode}`);
  await setup(dave, 'Dave');
  await dave.waitForSelector('#league-view:not([hidden])');
  check(await dave.isVisible('#league-join-here-btn'), 'league link shows the table and a Join button to non-members');
  await dave.click('#league-join-here-btn');
  await dave.waitForFunction(() => document.querySelectorAll('#league-body tr').length === 2);
  check(true, 'Dave joins the league from the link');

  await cara.click('#league-back-btn');
  await cara.waitForSelector('#home-view:not([hidden])');
  check((await cara.textContent('#my-leagues')).includes('Friday Night'), 'home screen lists my leagues');
  await cara.check('input[name=mode][value=tournament]');
  check(await cara.isVisible('#speed-field'), 'choosing Tournament shows the blind speed option');
  await cara.screenshot({ path: '/tmp/shot-home.png', fullPage: true });
  await cara.selectOption('#speed-select', 'fast');
  await cara.selectOption('#league-select', leagueCode);
  await cara.click('#create-btn');
  await cara.waitForSelector('#lobby-view:not([hidden])');
  const tcode = (await cara.textContent('#lobby-code')).trim();
  const modeText = await cara.textContent('#lobby-mode');
  check(/Tournament/.test(modeText) && /every 4 hands/.test(modeText) && /Friday Night/.test(modeText), `lobby shows "${modeText}"`);

  await dave.goto(`${BASE}/friends.html?room=${tcode}`);
  await dave.click('#join-btn');
  await cara.waitForFunction(() => document.querySelectorAll('#lobby-list li').length === 2);
  await cara.click('#start-btn');
  await dave.waitForSelector('#game-view:not([hidden])');
  await cara.waitForFunction(() => /Blinds 10\/20 · level 1/.test(document.querySelector('#blinds-info').textContent));
  await dave.screenshot({ path: '/tmp/shot-tourney.png' });
  check(true, 'tournament table shows blind level and hands until it rises');
  check(!(await cara.isVisible('#rebuy-btn')), 'no rebuy button in a tournament');

  // Play a few hands, then Dave leaves: Cara wins.
  const tPages = [cara, dave];
  const tRoom = () => db.get(tcode).data;
  const tDeadline = Date.now() + 120000;
  while (tRoom().handNo < 3 && Date.now() < tDeadline) {
    let acted = false;
    for (const p of tPages) {
      if (await p.isVisible('#call-btn') && await p.isEnabled('#call-btn')) {
        // No all-ins here: under no-limit one all-in can end a heads-up tournament on the first hand,
        // and this part of the test needs a few hands before Dave leaves. All-ins are tested elsewhere.
        if (Math.random() < 0.25 && await p.isEnabled('#raise-btn')) await raise(p, { noAllIn: true });
        else await p.click('#call-btn', { timeout: 1500 }).catch(() => {});
        acted = true; break;
      }
    }
    if (!acted) await cara.waitForTimeout(300);
  }
  check(tRoom().handNo >= 3, `${tRoom().handNo} tournament hands played`);
  const tChips = tRoom().players.reduce((t, p) => t + p.chips, 0) +
    (tRoom().hand.over ? 0 : tRoom().hand.ids.reduce((t, id) => t + tRoom().hand.contrib[id], 0));
  check(tChips === 2000, `tournament chips conserved (${tChips})`);
  await dave.click('#leave-btn');
  await cara.waitForSelector('#final-panel:not([hidden])', { timeout: 10000 });
  const title = await cara.textContent('#final-title');
  check(/You won the tournament/.test(title), `Cara sees "${title.trim()}"`);
  await cara.screenshot({ path: '/tmp/shot-final.png' });
  check((await cara.textContent('#final-body')).includes('+2'), 'final standings show league points');
  check(await cara.isVisible('#again-btn') && await cara.isDisabled('#again-btn'), 'host sees Play again (disabled with nobody left)');

  // League table updated
  await dave.goto(`${BASE}/friends.html?league=${leagueCode}`);
  await dave.waitForSelector('#league-view:not([hidden])');
  const rowsText = await dave.$$eval('#league-body tr', trs => trs.map(t => t.textContent));
  check(rowsText[0].includes('Cara') && rowsText[0].includes('2') && rowsText[1].includes('Dave'), `league table: ${rowsText.map(r => r.replace(/\s+/g, ' ')).join(' | ')}`);
  check((await dave.textContent('#league-recent')).includes('1st Cara'), 'recent tournaments list the winner');
  await dave.screenshot({ path: '/tmp/shot-league.png', fullPage: true });

  // ---- Friends, invites, transfer code, delete ----
  await cara.click('#leave-btn');           // leave the finished tournament table
  await cara.waitForSelector('#home-view:not([hidden])');
  const caraCode = (await cara.textContent('#me-code')).trim();
  await dave.goto(`${BASE}/friends.html?friend=${caraCode}`);
  await dave.waitForSelector('#home-view:not([hidden])');
  check((await dave.inputValue('#friend-code-input')) === caraCode, 'friend link pre-fills the friend code');
  await dave.click('#friend-add-btn');
  await dave.waitForFunction(() => document.querySelector('#friends-list').textContent.includes('Cara'));
  await cara.reload();
  await cara.waitForFunction(() => document.querySelector('#friends-list').textContent.includes('Dave'));
  check(true, 'friends are added both ways');

  await cara.click('#create-btn');
  await cara.waitForSelector('#lobby-view:not([hidden])');
  const icode = (await cara.textContent('#lobby-code')).trim();
  await cara.click('#lobby-view .invite-friends-btn');
  await cara.click('#invite-list button[data-invite]');
  await cara.waitForFunction(() => /Invited/.test(document.querySelector('#invite-list').textContent));
  await cara.click('#invite-close-btn');
  await dave.reload();
  await dave.waitForSelector('#invites-panel:not([hidden])');
  check((await dave.textContent('#invites-list')).includes('Cara invited you'), 'Dave sees the invite on his start screen');
  await dave.click('#invites-list button[data-join]');
  await dave.waitForSelector('#lobby-view:not([hidden])');
  check((await dave.textContent('#lobby-code')).trim() === icode, 'tapping Join on the invite seats Dave at the table');
  await cara.waitForFunction(() => document.querySelectorAll('#lobby-list li').length === 2);

  // Transfer code: Cara moves her profile to a "new phone"
  await cara.click('#lobby-leave-btn');
  await cara.waitForSelector('#home-view:not([hidden])');
  await cara.click('#profile-btn');
  await cara.click('#transfer-btn');
  const transfer = await cara.inputValue('#transfer-output');
  const newPhone = await player('Cara2', 'Pixel 7');
  await newPhone.goto(`${BASE}/friends.html`);
  await newPhone.waitForSelector('#setup-view:not([hidden])');
  await newPhone.fill('#restore-input', transfer);
  await newPhone.click('#restore-btn');
  await newPhone.waitForSelector('#home-view:not([hidden])');
  check((await newPhone.textContent('#me-code')).trim() === caraCode && (await newPhone.textContent('#friends-list')).includes('Dave'),
    'transfer code brings the same profile and friends to a new phone');

  // Delete: Dave deletes his profile
  await dave.click('#lobby-leave-btn');
  await dave.waitForSelector('#home-view:not([hidden])');
  await dave.click('#profile-btn');
  await dave.click('#delete-btn');
  await dave.waitForSelector('#setup-view:not([hidden])');
  const delMsg = await dave.textContent('#setup-error');
  check(/deleted/.test(delMsg), `deleting the profile returns to the welcome screen ("${delMsg}" at ${dave.url()})`);
  check(![...profileDb.values()].some(x => x.data.name === 'Dave'), 'Dave\'s profile is gone from the server');
  check(!JSON.stringify(leagueDb.get(leagueCode).data).includes('"Dave"'), 'Dave\'s name is removed from the league');
  await newPhone.reload();
  await newPhone.waitForSelector('#home-view:not([hidden])');
  check(!(await newPhone.textContent('#friends-list')).includes('Dave'), 'Dave disappears from his friends\' lists');
  check(await dave.evaluate(() => !localStorage.getItem('holdem-leagues') && !localStorage.getItem('holdem-friends-stats')), 'app data on the phone is cleared');
  await setup(dave, 'Dave2');

  // Privacy pages
  await dave.goto(`${BASE}/privacy.html`);
  check((await dave.textContent('body')).includes('Deleting your data') && (await dave.textContent('[data-release]')).includes('FergTech'), 'privacy policy page loads with the footer');
  await dave.goto(`${BASE}/delete-data.html`);
  check((await dave.textContent('body')).includes('Delete my profile'), 'data deletion page loads');

  // Not-your-turn and bad room code errors
  await dave.goto(`${BASE}/friends.html`);
  await dave.fill('#code-input', 'QQQQ');
  await dave.click('#join-btn');
  await dave.waitForFunction(() => /not found/.test(document.querySelector('#home-error').textContent));
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

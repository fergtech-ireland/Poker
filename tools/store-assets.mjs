// Makes the Google Play / app store images: maskable icon, feature graphic and phone screenshots.
// Run with: NODE_PATH=$(npm root -g) node tools/store-assets.mjs   (needs Playwright)
// Screenshots use the real pages with the game server answered locally (same code as the live one).
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handle } from '../supabase/functions/poker/api.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'store');
const FN_URL = 'https://lcekdvxhuimoxpiadism.supabase.co/functions/v1/poker';
const svg = fs.readFileSync(path.join(ROOT, 'icons/icon.svg'), 'utf8');

// ---- local web server + in-memory game server ----
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
const maps = { room: new Map(), league: new Map(), profile: new Map() };
const tbl = kind => ({
  async load(k) { const r = maps[kind].get(k); return r && { version: r.v, [kind]: structuredClone(r.d) }; },
  async save(k, exp, d) {
    const r = maps[kind].get(k);
    if (exp === 0) { if (r) return false; maps[kind].set(k, { v: 1, d: structuredClone(d) }); return true; }
    if (!r || r.v !== exp) return false;
    maps[kind].set(k, { v: exp + 1, d: structuredClone(d) }); return true;
  },
});
const store = {
  load: tbl('room').load, save: tbl('room').save, loadLeague: tbl('league').load, saveLeague: tbl('league').save,
  loadProfile: tbl('profile').load,
  saveProfile: (id, code, exp, p) => tbl('profile').save(id, exp, p),
  async findProfileByFriendCode(c) { for (const [id, x] of maps.profile) if (x.d.friendCode === c) return id; return null; },
  async deleteProfile(id) { maps.profile.delete(id); },
};
const call = (body, now = Date.now()) => handle(body, store, now);

// ---- build some realistic games ----
const prof = n => ({ id: `storeprofile${n}aaaa`, secret: `store-secret-${n}-xxxxxxxxxx` });
const names = ['Aoife', 'Conor', 'Niamh', 'Darragh'];
for (let i = 0; i < 4; i++) await call({ action: 'profile_save', profile: prof(i), name: names[i] });
const lg = (await call({ action: 'league_create', leagueName: 'Friday Night', profile: prof(0) })).league;
for (let i = 1; i < 4; i++) await call({ action: 'league_join', code: lg.code, profile: prof(i) });

async function playTournament(seed) {
  const a = await call({ action: 'create', name: 'x', profile: prof(0), mode: 'tournament', speed: 'fast', league: lg.code });
  const tokens = { [a.playerId]: a.token };
  for (let i = 1; i < 4; i++) { const r = await call({ action: 'join', code: a.code, name: 'x', profile: prof(i) }); tokens[r.playerId] = r.token; }
  let s = await call({ action: 'start', code: a.code, token: a.token });
  let now = Date.now();
  for (let k = 0; k < 6000 && s.state.status === 'playing'; k++) {
    if (s.state.hand && !s.state.hand.over) {
      const r = Math.random();
      s = await call({ action: 'act', code: a.code, token: tokens[s.state.hand.toAct], move: r < 0.15 ? 'fold' : r < 0.55 ? 'raise' : 'call' }, now);
    } else { now += 10000; s = await call({ action: 'next', code: a.code, token: a.token }, now); }
  }
  return { code: a.code, playerId: a.playerId, token: a.token };
}
let finished;
for (let t = 0; t < 4; t++) finished = await playTournament(t);

// A cash table on the flop, Aoife to act
let cash;
for (let tries = 0; tries < 50; tries++) {
  const a = await call({ action: 'create', name: 'x', profile: prof(0), mode: 'cash', league: lg.code });
  const tokens = { [a.playerId]: a.token };
  for (let i = 1; i < 4; i++) { const r = await call({ action: 'join', code: a.code, name: 'x', profile: prof(i) }); tokens[r.playerId] = r.token; }
  let s = await call({ action: 'start', code: a.code, token: a.token });
  while (s.state.hand && !s.state.hand.over && (s.state.hand.street < 1 || s.state.hand.toAct !== a.playerId)) {
    s = await call({ action: 'act', code: a.code, token: tokens[s.state.hand.toAct], move: s.state.hand.street === 0 && Math.random() < 0.3 ? 'raise' : 'call' });
  }
  if (s.state.hand && !s.state.hand.over && s.state.hand.street === 1) { cash = { code: a.code, playerId: a.playerId, token: a.token }; break; }
}

// ---- render ----
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
async function renderHtml(html, w, h, file) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.setContent(html);
  await p.screenshot({ path: path.join(OUT, file) });
  await p.close();
}
const svgAt = size => svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
// The same cards without the green square behind them, for use on the green feature graphic.
const cardsAt = size => svgAt(size).replace(/<rect width="512" height="512"[^>]*\/>/, '');

// Maskable icon: artwork inside the central safe zone (Android crops to a circle or rounded square).
await renderHtml(`<body style="margin:0;background:#0b6623;display:flex;align-items:center;justify-content:center;width:512px;height:512px">${svgAt(360)}</body>`, 512, 512, 'icon-maskable-512.png');
fs.copyFileSync(path.join(OUT, 'icon-maskable-512.png'), path.join(ROOT, 'icons/icon-maskable-512.png'));
fs.copyFileSync(path.join(ROOT, 'icons/icon-512.png'), path.join(OUT, 'icon-512.png'));

// Feature graphic 1024 x 500
await renderHtml(`<body style="margin:0;width:1024px;height:500px;background:radial-gradient(circle at 30% 50%,#11843a,#0b6623 60%,#064a18);font-family:Arial,sans-serif;color:#fff;display:flex;align-items:center;overflow:hidden">
  <div style="width:420px;display:flex;justify-content:center">${cardsAt(380)}</div>
  <div>
    <div style="font-size:72px;font-weight:800;line-height:1">Texas<br>Hold'em</div>
    <div style="font-size:28px;margin-top:18px;color:#ffd700">Play friends · Tournaments · Leagues</div>
    <div style="font-size:20px;margin-top:10px;color:#cfe">No real money. Just poker.</div>
    <div style="margin-top:28px;font-weight:800;letter-spacing:.25em;font-size:16px">FERG<span style="color:#ffd700">TECH</span></div>
  </div></body>`, 1024, 500, 'feature-graphic-1024x500.png');

// Phone screenshots, 1080 x 1920
async function phone(name, url, session, prep) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await ctx.route('**/realtime/**', r => r.abort());
  await ctx.route(FN_URL, async route => {
    try { route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await call(JSON.parse(route.request().postData()))) }); }
    catch (e) { route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: e.message, code: e.code }) }); }
  });
  await ctx.addInitScript(([profile, session]) => {
    localStorage.setItem('holdem-profile', JSON.stringify(profile));
    localStorage.setItem('holdem-name', 'Aoife');
    localStorage.setItem('holdem-stats', JSON.stringify({ wins: 41, losses: 30, ties: 3 }));
    localStorage.setItem('holdem-friends-stats', JSON.stringify({ wins: 27, losses: 38, ties: 2 }));
    if (session) localStorage.setItem('holdem-friends-session', JSON.stringify(session));
  }, [prof(0), session]);
  const p = await ctx.newPage();
  await p.goto(url);
  await p.waitForTimeout(1500);
  if (prep) await prep(p);
  await p.screenshot({ path: path.join(OUT, name) });
  await ctx.close();
}
await phone('screenshot-1-friends-table.png', `${BASE}/friends.html`, { code: cash.code, token: cash.token, playerId: cash.playerId, counted: [] },
  p => p.evaluate(() => document.querySelector('.room-bar').scrollIntoView()));
await phone('screenshot-2-league.png', `${BASE}/friends.html?league=${lg.code}`, null,
  p => p.evaluate(() => document.querySelector('#league-body').closest('.panel').scrollIntoView()));
await phone('screenshot-3-tournament-win.png', `${BASE}/friends.html`, { code: finished.code, token: finished.token, playerId: finished.playerId, counted: [] },
  p => p.evaluate(() => document.querySelector('#final-panel').scrollIntoView()));
await phone('screenshot-4-vs-computer.png', `${BASE}/`, null, async p => {
  for (let i = 0; i < 6; i++) { if (await p.isEnabled('#call-btn')) await p.click('#call-btn'); await p.waitForTimeout(900); }
  await p.evaluate(() => document.querySelector('.stats').scrollIntoView());
});
await phone('screenshot-5-friends-home.png', `${BASE}/friends.html`, null, null);

await browser.close();
server.close();
console.log('Wrote', fs.readdirSync(OUT).join(', '));

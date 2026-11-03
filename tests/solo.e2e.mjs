// Browser test of the vs-Computer game with no-limit betting.
// Run with: NODE_PATH=$(npm root -g) node tests/solo.e2e.mjs   (needs Playwright)
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SHOT = process.env.SHOT_DIR ? path.join(process.env.SHOT_DIR, 'solo-bet-panel.png') : null;

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

const check = (cond, msg) => { if (!cond) throw new Error('Check failed: ' + msg); console.log('ok  ', msg); };
const browser = await chromium.launch();
const errors = [];
try {
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (/Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });
  p.on('dialog', d => d.accept());
  await p.goto(`http://localhost:${server.address().port}/`);
  // Between hands the last pot stays on screen after being paid out, so only the stacks count then.
  const total = () => p.evaluate(() => +document.querySelector('#your-chips').textContent + +document.querySelector('#cpu-chips').textContent);

  // First decision: open the panel and check it
  await p.waitForFunction(() => !document.querySelector('#raise-btn').disabled);
  check(/^Raise…$|^Bet…$/.test(await p.textContent('#raise-btn')), 'Raise button opens a chooser');
  await p.click('#raise-btn');
  check(await p.isVisible('#bet-panel'), 'bet panel opens');
  const chips = await p.$$eval('#bet-panel [data-chip]', bs => bs.map(b => +b.dataset.chip));
  check(chips.join(',') === '5,25,100,500,1000', `chips: ${chips.join(', ')}`);
  check((await p.textContent('#bet-panel .bet-confirm')) === 'Raise to 40', 'panel starts at the minimum raise (40)');
  await p.click('#bet-panel [data-chip="25"]');
  await p.click('#bet-panel [data-chip="25"]');
  await p.click('#bet-panel [data-chip="100"]');
  check((await p.textContent('#bet-panel .bet-confirm')) === 'Raise to 190', 'tapping 25 + 25 + 100 chips: Raise to 190');
  check((await p.$$('#bet-panel .bet-stack .mini')).length === 3, 'the three chips show under the amount');
  await p.click('#bet-panel .bet-undo');
  check((await p.textContent('#bet-panel .bet-confirm')) === 'Raise to 90', 'Undo takes the last chip off (90)');
  check(await p.isDisabled('#bet-panel [data-chip="1000"]'), 'a chip that would go past your stack is greyed out');
  if (SHOT) await p.screenshot({ path: SHOT });
  await p.fill('#bet-panel .bet-input', '5');
  check(await p.isDisabled('#bet-panel .bet-confirm'), 'a typed amount below the minimum is refused');
  await p.click('#bet-panel .bet-reset');
  await p.click('#bet-panel [data-chip="5"]');
  await p.click('#bet-panel [data-chip="25"]');
  check((await p.textContent('#bet-panel .bet-confirm')) === 'Raise to 70', 'Reset then 5 + 25: Raise to 70');
  await p.click('#bet-panel .bet-confirm');
  await p.waitForFunction(() => /raise to 70/.test(document.querySelector('#log').textContent));
  check(true, 'raise to 70 made');

  // Play many hands with random moves, including all-ins
  let hands = 0, allIns = 0, raises = 1;
  for (let step = 0; step < 4000 && hands < 40; step++) {
    if (await p.isVisible('#next-btn')) {
      const t = await total();
      if (t !== 2000) throw new Error(`chips not conserved: ${t}`);
      hands++;
      await p.click('#next-btn');
      continue;
    }
    if (!(await p.isEnabled('#call-btn'))) { await p.waitForTimeout(150); continue; }
    const r = Math.random();
    if (r < 0.35 && await p.isEnabled('#raise-btn')) {
      await p.click('#raise-btn');
      if (await p.isVisible('#bet-panel')) {
        if (r < 0.05) { await p.click('#bet-panel .bet-allin'); allIns++; }
        else {
          // tap up to three random chips that still fit
          for (let k = Math.floor(Math.random() * 4); k > 0; k--) {
            const open = await p.$$('#bet-panel [data-chip]:not([disabled])');
            if (open.length) await open[Math.floor(Math.random() * open.length)].click();
          }
        }
        await p.click('#bet-panel .bet-confirm');
        raises++;
      } else allIns++;
    } else if (r > 0.9 && await p.isEnabled('#fold-btn')) await p.click('#fold-btn');
    else await p.click('#call-btn');
  }
  check(hands >= 40, `${hands} hands played (${raises} raises, ${allIns} all-ins), chips always 2000`);
  const played = +(await p.textContent('#stat-played'));
  check(played === hands + (await p.isVisible('#next-btn') ? 1 : 0), `stats counted every hand (${played})`);
  check(errors.length === 0, 'no JavaScript or CSP errors' + (errors.length ? ': ' + errors.join('; ') : ''));
  console.log('\nAll checks passed.');
} catch (e) {
  console.log('FAIL', e.message);
  if (errors.length) console.log(errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}

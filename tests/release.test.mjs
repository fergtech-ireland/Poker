// Run with: node tests/release.test.mjs
// The release line must match the format used on other FergTech apps.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const R = require('../version.js');

assert.match(R.RELEASE.version, /^\d+\.\d+\.\d+$/);
assert.equal(R.releaseLine({ ...R.RELEASE, version: '0.5.0', buildDate: '2026-10-31' }),
  "Texas Hold'em v0.5.0 · © 2026 FergTech · Built by FergTech");
assert.match(R.releaseLine(), /^Texas Hold'em v\d+\.\d+\.\d+ · © \d{4} FergTech · Built by FergTech$/);
assert.equal(R.buildLabel({ ...R.RELEASE, buildSha: 'abc1234', buildDate: '2026-10-31' }), 'build abc1234, built 2026-10-31');
assert.equal(R.buildLabel({ ...R.RELEASE, buildSha: '', buildDate: '' }), '');
assert.equal(R.trademarkLine(), 'FergTech™ is a trademark of FergTech.');

// The changelog has an entry for the current version.
assert.ok(fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').includes(`## ${R.RELEASE.version} `), 'CHANGELOG.md has no entry for this version');

// The deploy workflow's stamping command works on version.js.
const tmp = '/tmp/version-stamp-test.js';
fs.copyFileSync(new URL('../version.js', import.meta.url), tmp);
execSync(`GITHUB_SHA=abcdef1234567890 bash -c 'sed -i "s/buildSha: \\x27\\x27/buildSha: \\x27\${GITHUB_SHA::7}\\x27/; s/buildDate: \\x27\\x27/buildDate: \\x27$(date -u +%F)\\x27/" ${tmp}'`);
delete require.cache[tmp];
const stamped = require(tmp);
assert.equal(stamped.RELEASE.buildSha, 'abcdef1');
assert.match(stamped.RELEASE.buildDate, /^\d{4}-\d{2}-\d{2}$/);
console.log('release line ok:', R.releaseLine(), '|', stamped.RELEASE.buildSha, stamped.RELEASE.buildDate);

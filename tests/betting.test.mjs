// Run with: node tests/betting.test.mjs
// Chip values must be real casino denominations, grow with the big blind, and stay in order.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chipValues } = require('../betting.js');

assert.deepEqual(chipValues(20), [5, 25, 100, 500, 1000]);        // cash games and the first tournament level
assert.deepEqual(chipValues(2000), [500, 2500, 10000, 50000, 100000]);
const levels = [20, 30, 50, 80, 120, 200, 300, 500, 800, 1200, 2000];
for (const bb of levels) {
  const v = chipValues(bb);
  assert.equal(v.length, 5);
  for (let i = 1; i < 5; i++) assert.ok(v[i] > v[i - 1], `chips in order at ${bb}`);
  assert.ok(v[0] <= bb && v[4] >= bb * 25, `chips span small to big at ${bb}: ${v}`);
}
console.log('chip values ok:', levels.map(bb => `${bb}: ${chipValues(bb).join('/')}`).join('  '));

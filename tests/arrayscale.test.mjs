// Unit tests: array fan scaling (wheel → end size, size interpolation, variable spacing) and
// slap-follows-size (same curve as duff). Run: node tests/arrayscale.test.mjs
import assert from 'node:assert/strict';
import { arrayPlan, arrayStep, arraySizeAt, wheelScaleFactor, clampStampSize, lerp, ARRAY_MAX } from '../shared/array.mjs';
import { duffScale, slapScale } from '../shared/synth.mjs';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

ok('lerp / arraySizeAt: first = size0, last = size1, middle halfway', () => {
  assert.equal(lerp(10, 20, 0.5), 15);
  assert.equal(arraySizeAt(0, 5, 0.3, 0.6), 0.3);
  assert.equal(arraySizeAt(4, 5, 0.3, 0.6), 0.6);
  assert.ok(near(arraySizeAt(2, 5, 0.3, 0.6), 0.45));
  assert.equal(arraySizeAt(0, 1, 0.3, 0.9), 0.3);
});

ok('wheelScaleFactor: scroll down shrinks, up grows; pixel and line deltas', () => {
  assert.ok(wheelScaleFactor(100, 0) < 1); // pixels down
  assert.ok(wheelScaleFactor(-100, 0) > 1);
  assert.ok(wheelScaleFactor(1, 1) < 1); // one mouse notch down
  assert.ok(wheelScaleFactor(-1, 1) > 1);
  assert.ok(near(wheelScaleFactor(0, 0), 1));
  // continuous: two notches ≈ factor²
  const f = wheelScaleFactor(1, 1);
  assert.ok(near(wheelScaleFactor(2, 1), f * f, 1e-9));
});

ok('clampStampSize respects min/max', () => {
  assert.equal(clampStampSize(0.05, 0.15, 1), 0.15);
  assert.equal(clampStampSize(3, 0.15, 1), 1);
  assert.equal(clampStampSize(0.4, 0.15, 1), 0.4);
});

const wall = { position: [0, 2, -5], quaternion: [0, 0, 0, 1], surface: 'vägg-norr' };

ok('uniform end size = old behaviour (horizontal step = width)', () => {
  const p = arrayPlan(wall, 0.2, 0.3, [1, 2, -5]);
  assert.ok(near(p.step, 0.2) && p.count === 6 && p.items.length === 6);
  assert.ok(p.items.every((x) => near(x.w, 0.2) && near(x.h, 0.3)));
});

ok('fan growing: last sticker larger, sizes rise, neighbours still touch (no overlap)', () => {
  const p = arrayPlan(wall, 0.2, 0.2, [2, 2, -5], { endW: 0.4, endH: 0.4 });
  assert.ok(p.count >= 3, String(p.count));
  const first = p.items[0], last = p.items[p.items.length - 1];
  assert.ok(near(first.w, 0.2) && near(first.h, 0.2));
  assert.ok(last.w > first.w && last.h > first.h);
  // each step ≈ the outgoing sticker's width (horizontal drag)
  for (let i = 1; i < p.items.length; i++) {
    const a = p.items[i - 1], b = p.items[i];
    const gap = b.position[0] - a.position[0];
    assert.ok(near(gap, a.w, 1e-5), `gap ${gap} vs ${a.w}`);
    assert.ok(b.w >= a.w - 1e-9);
  }
});

ok('fan shrinking: last sticker smaller, sizes fall', () => {
  const p = arrayPlan(wall, 0.4, 0.4, [2, 2, -5], { endW: 0.15, endH: 0.15 });
  assert.ok(p.count >= 3);
  const first = p.items[0], last = p.items[p.items.length - 1];
  assert.ok(near(first.w, 0.4));
  assert.ok(last.w < first.w);
  for (let i = 1; i < p.items.length; i++) assert.ok(p.items[i].w <= p.items[i - 1].w + 1e-9);
});

ok('slapScale mirrors duffScale: bigger = louder + lower', () => {
  const tiny = slapScale(0.1), mid = slapScale(0.3), big = slapScale(0.8);
  assert.deepEqual(mid, duffScale(0.09)); // 0.3² = 0.09 reference
  assert.ok(tiny.gain < mid.gain && mid.gain < big.gain);
  assert.ok(tiny.rate > mid.rate && mid.rate > big.rate);
  assert.deepEqual(slapScale(0.25, true), duffScale(0.25)); // asArea
});

console.log(`\narrayscale: ${n} passed`);

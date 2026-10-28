// Unit tests: the sticker wheel's maths (shared/wheel.mjs) – wrap-around, saturation, rotation, z-order.
import assert from 'node:assert/strict';
import { wrapDist, indexAt, targetFor, saturationAt, rotationAt, zAt, itemAt, reach, mod } from '../shared/wheel.mjs';

let passed = 0, failed = 0;
const ok = (name, fn) => { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '  — ' + e.message); } };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

console.log('Sticker wheel maths');
ok('mod is always 0 … n-1', () => { assert.equal(mod(-1, 5), 4); assert.equal(mod(5, 5), 0); assert.equal(mod(-6, 5), 4); });
ok('wrapDist: the short way round, in (-n/2, n/2]', () => {
  assert.equal(wrapDist(0, 0, 10), 0); assert.equal(wrapDist(1, 0, 10), 1); assert.equal(wrapDist(9, 0, 10), -1);
  assert.equal(wrapDist(0, 9, 10), 1, 'past the last comes the first (to the right)');
  assert.equal(wrapDist(9, 0, 10), -1, 'before the first is the last (to the left)');
  assert.equal(wrapDist(5, 0, 10), 5); assert.ok(near(wrapDist(3, 2.25, 10), 0.75));
  for (let n = 1; n < 12; n++) for (let i = 0; i < n; i++) for (const p of [-13.4, -1, 0, 0.5, 7.7, 30]) { const d = wrapDist(i, p, n); assert.ok(d > -n / 2 - 1e-9 && d <= n / 2 + 1e-9, `${i} ${p} ${n}`); assert.ok(near(mod(p + d - i, n), 0) || near(mod(p + d - i, n), n)); }
});
ok('endless both ways: indexAt wraps any position (186 stickers)', () => {
  assert.equal(indexAt(186, 186), 0); assert.equal(indexAt(-1, 186), 185); assert.equal(indexAt(372 + 5.4, 186), 5); assert.equal(indexAt(-0.6, 186), 185);
});
ok('targetFor: last → first is ONE step right, first → last one step left (no spin back)', () => {
  assert.equal(targetFor(0, 185, 186), 186); assert.equal(targetFor(185, 0, 186), -1); assert.equal(targetFor(3, 1, 186), 3);
  assert.equal(targetFor(0, 5, 6), 6); assert.equal(indexAt(targetFor(0, 5, 6), 6), 0);
});
ok('saturation: 100 % in the middle, 70 % / 40 % beside (−30 % / −60 %), nearly grey further out, 0 at the ends', () => {
  assert.equal(saturationAt(0), 1); assert.ok(near(saturationAt(1), 0.7)); assert.ok(near(saturationAt(-1), 0.7));
  assert.ok(near(saturationAt(2), 0.4)); assert.ok(near(saturationAt(-2), 0.4)); assert.ok(saturationAt(3) <= 0.1 + 1e-9);
  assert.equal(saturationAt(4), 0); assert.equal(saturationAt(-9), 0);
  assert.ok(saturationAt(0.5) < 1 && saturationAt(0.5) > 0.7, 'smooth while it turns');
});
ok('rotation: 0 in the middle, clockwise (+) to the right, counter-clockwise (−) to the left, growing outwards, capped', () => {
  assert.equal(rotationAt(0), 0); assert.ok(rotationAt(1) > 0 && rotationAt(-1) < 0); assert.equal(rotationAt(-2), -rotationAt(2));
  assert.ok(rotationAt(2) > rotationAt(1) && rotationAt(3) > rotationAt(2)); assert.ok(rotationAt(50) <= 40);
});
ok('z-order: the middle on top, each step out further behind (they tuck in behind each other)', () => {
  assert.ok(zAt(0) > zAt(1) && zAt(1) > zAt(2) && zAt(2) > zAt(3)); assert.equal(zAt(-2), zAt(2));
});
ok('itemAt: positions symmetric, overlapping (gap < item), fading only at the ends of the window', () => {
  const a = itemAt(2, { n: 20, first: 72, gap: 44, reachN: 4 }), b = itemAt(-2, { n: 20, first: 72, gap: 44, reachN: 4 });
  assert.equal(a.x, -b.x); assert.equal(a.x, 72 + 44); assert.equal(a.op, 1); assert.ok(a.y > 0);
  assert.equal(itemAt(5, { n: 20, reachN: 4 }).op, 0); assert.ok(near(itemAt(4.25, { n: 20, reachN: 4 }).op, 0.25));
  assert.equal(itemAt(0, { n: 1 }).op, 1, 'one sticker: just the one');
});
ok('reach: how many fit each side', () => { assert.equal(reach(300, 72, 44), 6); assert.equal(reach(50, 72, 44), 0); assert.equal(reach(0, 72, 44), 0); });

console.log(`\nSticker wheel unit tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

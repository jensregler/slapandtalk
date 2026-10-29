// The held sticker's timer on touch screens (shared/heldtimer.mjs): no Slap/Look switch on phones.
// Jens, 29 Oct 2026: 2 s untouched (was 10 s), then the 1 s fade. Any interaction while it is up
// (touch, aim, pinch, twist, size/rotation, the wheel) keeps it up: keepAlive restarts the 2 s.
// Run: node tests/heldtimer.test.mjs
import assert from 'node:assert/strict';
import { createHeldTimer, HELD_VISIBLE_MS as V, HELD_FADE_MS as F } from '../shared/heldtimer.mjs';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('✔ ' + name); };

test('the timings are named constants: 2 s visible (untouched), 1 s fade', () => {
  assert.equal(V, 2000); assert.equal(F, 1000);
});
test('start-up: nothing held, a tap only wakes it (never a slap)', () => {
  const h = createHeldTimer();
  assert.equal(h.state, 'idle'); assert.equal(h.opacity(0), 0); assert.equal(h.canSlap(0), false);
  assert.equal(h.tap(100), 'wake'); assert.equal(h.state, 'timed'); assert.equal(h.opacity(100), 1);
});
test('a chosen sticker is sharp in its holder indefinitely until the first placement', () => {
  const h = createHeldTimer(); h.choose(0);
  for (const t of [0, V + 500, 5 * V, 60000, 3600000]) { assert.equal(h.opacity(t), 1, `t=${t}`); assert.equal(h.canSlap(t), true); }
  assert.equal(h.tap(3600000), 'slap'); // the first placement is a slap
});
test('the first placement starts the clock: 2 s sharp, then a 1 s fade, then faded', () => {
  const h = createHeldTimer(); h.choose(0); h.placed(1000);
  assert.equal(h.state, 'timed');
  assert.equal(h.opacity(1000 + V - 1), 1); assert.equal(h.canSlap(1000 + V - 1), true);
  assert.equal(h.opacity(1000 + V), 1);
  assert.ok(Math.abs(h.opacity(1000 + V + F / 2) - 0.5) < 1e-9);
  assert.equal(h.canSlap(1000 + V + F / 2), false, 'fading: a tap does not slap');
  assert.equal(h.opacity(1000 + V + F), 0); assert.equal(h.faded(1000 + V + F), true);
  assert.equal(h.opacity(1000 + 99999), 0);
});
test('a tap while faded brings it back with a fresh 2 s – and that tap does not slap', () => {
  const h = createHeldTimer(); h.choose(0); h.placed(0);
  assert.equal(h.tap(20000), 'wake');
  assert.equal(h.opacity(20000), 1); assert.equal(h.canSlap(20000), true);
  assert.equal(h.opacity(20000 + V - 1), 1); assert.ok(h.opacity(20000 + V + F / 2) < 1); assert.equal(h.opacity(20000 + V + F), 0);
});
test('a tap while fading also only wakes it (fresh 2 s)', () => {
  const h = createHeldTimer(); h.placed(0);
  assert.equal(h.tap(V + 400), 'wake'); assert.equal(h.opacity(V + 400 + V - 100), 1);
});
test('each new stamp restarts the 2 s', () => {
  const h = createHeldTimer(); h.choose(0); h.placed(0);
  assert.equal(h.tap(1500), 'slap'); h.placed(1500);
  assert.equal(h.opacity(1500 + V - 100), 1, 'still sharp just under 2 s after the second stamp'); assert.equal(h.canSlap(1500 + V - 1), true);
  assert.ok(h.opacity(1500 + V + F / 2) < 1); assert.equal(h.opacity(1500 + V + F), 0);
});
test('any interaction while it is up restarts the 2 s (it fades only after 2 s untouched) – but does not revive a faded one', () => {
  const h = createHeldTimer(); h.placed(0);
  for (let t = 1500; t <= 15000; t += 1500) h.keepAlive(t); // touching/pinching every 1.5 s for 15 s
  assert.equal(h.opacity(15000 + V - 1), 1); assert.equal(h.canSlap(15000 + V - 1), true);
  assert.ok(h.opacity(15000 + V + F / 2) < 1); assert.equal(h.opacity(15000 + V + F), 0);
  h.keepAlive(30000); assert.equal(h.opacity(30000), 0, 'faded: an interaction is not a revive (a tap wakes it)');
});
test('choosing a new sticker while faded: sharp again until it is placed', () => {
  const h = createHeldTimer(); h.placed(0); assert.equal(h.opacity(20000), 0);
  h.choose(20000); assert.equal(h.opacity(90000), 1); assert.equal(h.tap(90000), 'slap');
});
console.log(`heldtimer: ${n} passed`);

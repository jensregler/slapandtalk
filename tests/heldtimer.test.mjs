// The held sticker's timer on touch screens (shared/heldtimer.mjs): no Slap/Look switch on phones.
// Run: node tests/heldtimer.test.mjs
import assert from 'node:assert/strict';
import { createHeldTimer, HELD_VISIBLE_MS, HELD_FADE_MS } from '../shared/heldtimer.mjs';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('✔ ' + name); };

test('the timings are named constants: 10 s visible, 1 s fade', () => {
  assert.equal(HELD_VISIBLE_MS, 10000); assert.equal(HELD_FADE_MS, 1000);
});
test('start-up: nothing held, a tap only wakes it (never a slap)', () => {
  const h = createHeldTimer();
  assert.equal(h.state, 'idle'); assert.equal(h.opacity(0), 0); assert.equal(h.canSlap(0), false);
  assert.equal(h.tap(100), 'wake'); assert.equal(h.state, 'timed'); assert.equal(h.opacity(100), 1);
});
test('a chosen sticker is sharp in its holder indefinitely until the first placement', () => {
  const h = createHeldTimer(); h.choose(0);
  for (const t of [0, 5000, 10500, 11000, 60000, 3600000]) { assert.equal(h.opacity(t), 1, `t=${t}`); assert.equal(h.canSlap(t), true); }
  assert.equal(h.tap(3600000), 'slap'); // the first placement is a slap
});
test('the first placement starts the clock: 10 s sharp, then a 1 s fade, then faded', () => {
  const h = createHeldTimer(); h.choose(0); h.placed(1000);
  assert.equal(h.state, 'timed');
  assert.equal(h.opacity(1000 + 9999), 1); assert.equal(h.canSlap(1000 + 9999), true);
  assert.equal(h.opacity(1000 + 10000), 1);
  assert.ok(Math.abs(h.opacity(1000 + 10500) - 0.5) < 1e-9);
  assert.equal(h.canSlap(1000 + 10500), false, 'fading: a tap does not slap');
  assert.equal(h.opacity(1000 + 11000), 0); assert.equal(h.faded(1000 + 11000), true);
  assert.equal(h.opacity(1000 + 99999), 0);
});
test('a tap while faded brings it back with a fresh 10 s – and that tap does not slap', () => {
  const h = createHeldTimer(); h.choose(0); h.placed(0);
  assert.equal(h.tap(20000), 'wake');
  assert.equal(h.opacity(20000), 1); assert.equal(h.canSlap(20000), true);
  assert.equal(h.opacity(29999), 1); assert.ok(h.opacity(30500) < 1); assert.equal(h.opacity(31000), 0);
});
test('a tap while fading also only wakes it (fresh 10 s)', () => {
  const h = createHeldTimer(); h.placed(0);
  assert.equal(h.tap(10400), 'wake'); assert.equal(h.opacity(10400 + 9000), 1);
});
test('each new stamp restarts the 10 s', () => {
  const h = createHeldTimer(); h.choose(0); h.placed(0);
  assert.equal(h.tap(6000), 'slap'); h.placed(6000);
  assert.equal(h.opacity(15000), 1, 'still sharp 9 s after the second stamp'); assert.equal(h.canSlap(15999), true);
  assert.ok(h.opacity(16500) < 1); assert.equal(h.opacity(17000), 0);
});
test('working the sliders keeps it up while it is up, but does not revive a faded one', () => {
  const h = createHeldTimer(); h.placed(0);
  h.keepAlive(8000); assert.equal(h.opacity(17000), 1);
  h.keepAlive(30000); assert.equal(h.opacity(30000), 0);
});
test('choosing a new sticker while faded: sharp again until it is placed', () => {
  const h = createHeldTimer(); h.placed(0); assert.equal(h.opacity(20000), 0);
  h.choose(20000); assert.equal(h.opacity(90000), 1); assert.equal(h.tap(90000), 'slap');
});
console.log(`heldtimer: ${n} passed`);

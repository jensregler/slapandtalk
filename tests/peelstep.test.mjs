// Footsteps on peels (shared/peelstep.mjs, Jens 29 Oct 2026): the normal footstep through a gentle
// low-pass and a little soft-clip distortion that grows with walking speed ("lite filter, lite
// distorsion"), and the cheap "is the foot on a peel?" test. Run: node tests/peelstep.test.mjs
import assert from 'node:assert/strict';
import { PEEL_STEP as S, peelStepParams, peelCurve, peelThd, onPeel } from '../shared/peelstep.mjs';
import { DEFAULT_PATCHES } from '../shared/synth.mjs';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('✔ ' + name); };

test('the numbers: slow 0.6 m/s … fast 4.7 m/s (Shift-run), low-pass 330 → 420 Hz, drive 0.04 → 0.28', () => {
  assert.deepEqual([S.vSlow, S.vFast, S.cutoffSlow, S.cutoffFast, S.driveSlow, S.driveFast, S.q, S.gain], [0.6, 4.7, 330, 420, 0.04, 0.28, 0.6, 0.9]);
});
test('the low-pass is below the normal step\'s own filter (muffled), every speed', () => {
  const own = Math.max(...DEFAULT_PATCHES.step.layers.filter((l) => l.kind === 'noise').map((l) => l.cutoff));
  for (const v of [0, 1, 2.6, 4.7, 9]) assert.ok(peelStepParams(v).cutoff < own, `${v} m/s`);
});
test('slow = the floor values, fast = the top values, clamped outside', () => {
  for (const v of [-1, 0, 0.6, NaN, undefined]) { const p = peelStepParams(v); assert.equal(p.t, 0); assert.equal(p.cutoff, 330); assert.equal(p.drive, 0.04); }
  for (const v of [4.7, 6, 100]) { const p = peelStepParams(v); assert.equal(p.t, 1); assert.equal(p.cutoff, 420); assert.equal(p.drive, 0.28); }
});
test('walking speed 2.6 m/s (the keys) sits in the middle: drive ≈ 0.16, cutoff ≈ 374 Hz', () => {
  const p = peelStepParams(2.6); assert.ok(Math.abs(p.drive - 0.157) < 0.002 && p.cutoff === 374, JSON.stringify(p));
});
test('faster = more distortion (and a hair brighter), strictly, across the range', () => {
  let last = null;
  for (let v = 0.6; v <= 4.7; v += 0.5) {
    const p = peelStepParams(v);
    if (last) { assert.ok(p.drive > last.drive, `drive at ${v}`); assert.ok(p.cutoff >= last.cutoff, `cutoff at ${v}`); }
    last = p;
  }
});
test('the curve: odd, monotonic, in [-1, 1], unity gain for small signals (no loudness jump)', () => {
  for (const d of [0, 0.04, 0.16, 0.28, 1]) {
    const { curve: c, post } = peelCurve(d), m = (c.length - 1) / 2;
    assert.ok(Math.abs(c[m]) < 1e-6 && Math.abs(c[0] + 1) < 1e-6 && Math.abs(c[c.length - 1] - 1) < 1e-6);
    for (let i = 1; i < c.length; i++) assert.ok(c[i] >= c[i - 1]);
    for (let i = 0; i < c.length; i++) assert.ok(Math.abs(c[i] + c[c.length - 1 - i]) < 1e-6);
    const slope = (c[m + 1] - c[m - 1]) / (2 * 2 / (c.length - 1));
    assert.ok(Math.abs(S.pre * slope * post - 1) < 0.01, `small-signal gain at drive ${d}`);
  }
});
test('distortion is subtle: < 4 % THD at a step\'s level when strolling, < 13 % at the peak when running, and grows with speed', () => {
  const slow = peelThd(peelStepParams(0.6).drive, 0.25), walk = peelThd(peelStepParams(2.6).drive, 0.25), fast = peelThd(peelStepParams(4.7).drive, 0.25);
  assert.ok(slow < 0.04 && fast < 0.13 && slow < walk && walk < fast, JSON.stringify({ slow, walk, fast }));
  assert.ok(peelThd(peelStepParams(4.7).drive, 0.1) < 0.03, 'quiet parts stay clean');
});
test('onPeel: inside, on the edge (+ foot radius) and outside; the peel\'s yaw counts', () => {
  const p = { x: 1, z: -2, w: 0.4, h: 0.2, yaw: 0 };
  assert.equal(onPeel(1, -2, [p]), true);
  assert.equal(onPeel(1.29, -2, [p]), true);   // 0.2 + 0.1 foot
  assert.equal(onPeel(1.31, -2, [p]), false);
  assert.equal(onPeel(1, -2.19, [p]), true); assert.equal(onPeel(1, -2.21, [p]), false);
  const r = { ...p, yaw: Math.PI / 2 }; // turned a quarter: long side along z
  assert.equal(onPeel(1, -2.29, [r]), true); assert.equal(onPeel(1.29, -2, [r]), false);
  assert.equal(onPeel(0, 0, []), false); assert.equal(onPeel(0, 0, null), false);
});
test('onPeel is cheap: 300 peels × 1000 checks well under 100 ms', () => {
  const peels = Array.from({ length: 300 }, (_, i) => ({ x: (i % 20) * 0.3 - 3, z: Math.floor(i / 20) * 0.3 - 3, w: 0.3, h: 0.2, yaw: i }));
  const t0 = performance.now(); let k = 0;
  for (let i = 0; i < 1000; i++) if (onPeel(Math.sin(i) * 4, Math.cos(i) * 4, peels)) k++;
  assert.ok(performance.now() - t0 < 100); void k;
});
console.log(`${n} passed`);

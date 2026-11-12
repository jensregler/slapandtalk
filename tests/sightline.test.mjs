// Sightline (Jens t866u): distance → 0…1 log value → the Steps osc pitch while sneaking; smoothing; the module
// is wired into sneak only and never writes the Steps patch.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as L from '../shared/sightline.mjs';
import { snapFreq } from '../shared/synth.mjs';
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

ok('range: 1 m … the city width (96 m), 10 raycasts a second', () => {
  assert.equal(L.SIGHTLINE.minM, 1); assert.equal(L.SIGHTLINE.maxM, 96); assert.equal(L.SIGHTLINE.intervalMs, 100);
});
ok('log value: 1 m → 0, 96 m → 1, √96 m ≈ 9.8 m → ½; closer than 1 m / further / no hit are clamped', () => {
  assert.equal(L.sightValue(1), 0); assert.equal(L.sightValue(96), 1);
  assert.ok(Math.abs(L.sightValue(Math.sqrt(96)) - 0.5) < 1e-9);
  assert.equal(L.sightValue(0.2), 0); assert.equal(L.sightValue(500), 1); assert.equal(L.sightValue(null), 1); assert.equal(L.sightValue(Infinity), 1);
  for (const d of [1, 2.5, 7, 30, 96]) assert.ok(Math.abs(L.sightMetres(L.sightValue(d)) - d) < 1e-9);
});
ok('pitch: near = high (1 m = 1760 Hz), far = low (96 m = 41.2 Hz), log – inside the step osc range, snapped to semitones', () => {
  assert.equal(L.sightFreq(0), 1760); assert.ok(Math.abs(L.sightFreq(1) - 41.2) < 1e-9);
  const [lo, hi] = [20, 8000]; assert.ok(L.SIGHTLINE.farHz >= lo && L.SIGHTLINE.nearHz <= hi);
  const a = L.sightFreq(0.25), b = L.sightFreq(0.5), c = L.sightFreq(0.75); assert.ok(Math.abs(a / b - b / c) < 1e-9); // equal steps = equal intervals
  assert.equal(snapFreq(1760), 1760); assert.equal(snapFreq(L.sightFreq(L.sightValue(10))), snapFreq(snapFreq(L.sightFreq(L.sightValue(10)))));
  let last = Infinity; for (let d = 1; d <= 96; d *= 1.3) { const f = L.sightFreq(L.sightValue(d)); assert.ok(f < last); last = f; }
});
ok('smoothing: exponential toward the target, no jump, first value taken as is', () => {
  assert.equal(L.sightSmooth(null, 0.4, 16), 0.4);
  const s1 = L.sightSmooth(0, 1, 16); assert.ok(s1 > 0 && s1 < 0.1);
  let v = 0; for (let t = 0; t < 1500; t += 16) v = L.sightSmooth(v, 1, 16); assert.ok(v > 0.99);
});
ok('wired into sneak only, the Steps patch is never written (only the played tune changes)', () => {
  const m = fs.readFileSync(new URL('../client/src/main.js', import.meta.url), 'utf8');
  assert.match(m, /const step = sightStep\(gaitStep\(myGait, liveRunMode\(\)\)\);/);
  assert.match(m, /if \(myGait !== 'crouch'\) \{ if \(sightOn\) \{ sightOn = false; sightHz = null; sightline\.reset\(\); \} return step; \}/);
  const fn = m.slice(m.indexOf('function sightStep('), m.indexOf('function walkSounds('));
  assert.doesNotMatch(fn, /\.freq\s*=|patches\.step\s*=|setPatch|save/);
  const c = fs.readFileSync(new URL('../client/src/sightline.js', import.meta.url), 'utf8');
  assert.match(c, /export class Sightline/); assert.match(c, /intervalMs/);
});
ok('Highline / Widthline on a wall facing me (+z): bottom-left = 0/0, top-right = 1/1, middle = ½', () => {
  const min = [-4, 0, -0.1], max = [4, 6, 0.1], n = [0, 0, 1], dir = [0, 0, -1];
  const at = (x, y) => L.surfaceLines([x, y, 0.1], n, min, max, dir);
  assert.deepEqual(at(-4, 0), { highline: 0, widthline: 0 }); assert.deepEqual(at(4, 6), { highline: 1, widthline: 1 });
  const m = at(0, 3); assert.ok(Math.abs(m.highline - 0.5) < 1e-9 && Math.abs(m.widthline - 0.5) < 1e-9);
  const q = at(2, 1.5); assert.ok(Math.abs(q.widthline - 0.75) < 1e-9 && Math.abs(q.highline - 0.25) < 1e-9);
});
ok('…a wall facing +x: "right" is −z as seen from there (left → right as I see it)', () => {
  const l = L.surfaceLines([0.1, 2, -3], [1, 0, 0], [-0.1, 0, -4], [0.1, 4, 4], [-1, 0, 0]);
  assert.ok(Math.abs(l.widthline - 0.875) < 1e-9 && Math.abs(l.highline - 0.5) < 1e-9, JSON.stringify(l));
});
ok('…the ground (normal up): Highline runs away from me (near 0 … far 1), Widthline left → right', () => {
  const min = [-10, -0.1, -10], max = [10, 0, 10];
  const l = L.surfaceLines([5, 0, -5], [0, 1, 0], min, max, [0, -0.7, -0.7]); // looking down toward −z
  assert.ok(Math.abs(l.highline - 0.75) < 1e-9 && Math.abs(l.widthline - 0.75) < 1e-9, JSON.stringify(l));
});
ok('…nothing hit → null; a zero-size axis → ½', () => {
  assert.deepEqual(L.surfaceLines(null, [0, 0, 1], null, null, null), { highline: null, widthline: null });
  assert.equal(L.surfaceLines([0, 1, 0], [0, 0, 1], [0, 0, 0], [0, 2, 0], [0, 0, -1]).widthline, 0.5);
});
ok('Highline / Widthline are measured, not wired to any sound', () => {
  const m = fs.readFileSync(new URL('../client/src/main.js', import.meta.url), 'utf8');
  const fn = m.slice(m.indexOf('function sightStep('), m.indexOf('function walkSounds('));
  assert.doesNotMatch(fn.slice(0, fn.indexOf('let sightHudEl')), /highline|widthline/);
});
console.log(`sightline: ${n} checks ok`);

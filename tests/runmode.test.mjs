// Run mode (shared/runmode.mjs + runEventsBetween in shared/groove.mjs; Jens t544u, 5 Nov 2026).
// Run: node tests/runmode.test.mjs (in npm test)
import assert from 'node:assert/strict';
import * as R from '../shared/runmode.mjs';
import * as G from '../shared/groove.mjs';

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const T0 = 1793031959884;

ok('tempo slider: −200…+200 in 12.5 % steps, mirrored so the rate never reaches zero', () => {
  assert.equal(R.cleanTempo(13), 12.5); assert.equal(R.cleanTempo(999), 200); assert.equal(R.cleanTempo(-999), -200); assert.equal(R.cleanTempo('x'), 100);
  const tbl = { 0: 1, 12.5: 1.125, 50: 1.5, 100: 2, 200: 3, '-50': 2 / 3, '-100': 0.5, '-200': 1 / 3 };
  for (const [p, r] of Object.entries(tbl)) assert.ok(near(R.tempoRate(Number(p)), r), `${p}% → ${r}`);
  for (let p = -200; p <= 200; p += 12.5) assert.ok(R.tempoRate(p) > 0);
  for (let p = -187.5; p <= 200; p += 12.5) assert.ok(R.tempoRate(p) > R.tempoRate(p - 12.5), 'monotonic');
});
ok('lock to clock: nearest clean ratio (log distance)', () => {
  const lk = (p) => { const r = R.runRate({ tempo: p, lock: true }); return `${r.num}:${r.den}`; };
  assert.equal(lk(0), '1:1'); assert.equal(lk(12.5), '1:1'); assert.equal(lk(25), '3:2'); assert.equal(lk(50), '3:2'); assert.equal(lk(75), '2:1');
  assert.equal(lk(100), '2:1'); assert.equal(lk(150), '3:1'); assert.equal(lk(200), '3:1');
  assert.equal(lk(-50), '2:3'); assert.equal(lk(-100), '1:2'); assert.equal(lk(-200), '1:3');
  const free = R.runRate({ tempo: 62.5, lock: false }); assert.ok(near(free.rate, 1.625) && free.num === null);
  assert.equal(R.cleanRun(null).lock, true);
});
ok('pitch: pentatonic steps, −5 … +8, octave down to octave + fifth up, default a fifth', () => {
  assert.equal(R.pitchMin, -5); assert.equal(R.pitchMax, 8);
  assert.deepEqual([-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8].map(R.pitchSemitones), [-12, -10, -8, -5, -3, 0, 2, 4, 7, 9, 12, 14, 16, 19]);
  assert.equal(R.pitchPercent(-5), -200); assert.equal(R.pitchPercent(8), 200); assert.equal(R.pitchPercent(3), 75); assert.equal(R.pitchPercent(-1), -40);
  assert.equal(R.pitchSemitones(R.RUN_DEFAULTS.pitch), 7);
  assert.ok(near(R.pitchRatio(-5), 0.5)); assert.ok(near(R.pitchRatio(4 + 1), 2));
  const PENT = new Set([0, 2, 4, 7, 9]);
  for (let i = R.pitchMin; i <= R.pitchMax; i++) assert.ok(PENT.has(((R.pitchSemitones(i) % 12) + 12) % 12), `step ${i} in the scale`);
  assert.equal(R.pitchLabel(3), '+75% · +7 st (fifth up)'); assert.equal(R.cleanPitch(99), 8);
});
ok('run grid: rate 1 = the walk grid; 2:1 puts a run step on every walk step and one between', () => {
  const g = { scale: 1, at: T0 - 5000, phase: 0.2 };
  for (let slot = 0; slot < 5; slot++) {
    const w = G.eventsBetween(g, slot, T0, T0 + 4000), r1 = G.runEventsBetween(g, slot, T0, T0 + 4000, 1);
    assert.equal(w.length, r1.length); w.forEach((e, i) => assert.ok(near(e.t, r1[i].t, 1e-6)));
    const r2 = G.runEventsBetween(g, slot, T0, T0 + 4000, 2);
    for (const e of w) assert.ok(r2.some((x) => near(x.t, e.t, 1e-6)), `slot ${slot}: walk step on the run grid`);
    assert.ok(Math.abs(r2.length - 2 * w.length) <= 1);
    // 3:2 – every 3 run steps meet one walk step every 2 (polyrhythm)
    const r32 = G.runEventsBetween(g, slot, T0, T0 + 8000, 1.5);
    const hits = r32.filter((x) => w.concat(G.eventsBetween(g, slot, T0 + 4000, T0 + 8000)).some((e) => near(e.t, x.t, 1e-6)));
    assert.ok(Math.abs(hits.length - r32.length / 3) <= 1, `slot ${slot}: 3:2 meets every third run step`);
  }
  assert.deepEqual(G.runEventsBetween(g, 0, T0, T0 + 1000, 0), G.runEventsBetween(g, 0, T0, T0 + 1000, 1), 'a bad rate = 1');
});
console.log(`runmode: ${n} checks ok`);

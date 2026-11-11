// Run mode (shared/runmode.mjs + runEventsBetween in shared/groove.mjs; Jens t544u, 5 Nov 2026).
// Run: node tests/runmode.test.mjs (in npm test)
import assert from 'node:assert/strict';
import * as R from '../shared/runmode.mjs';
import * as G from '../shared/groove.mjs';

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const T0 = 1793031959884;

ok('tempo slider: −400…+400 in 12.5 % steps, mirrored so the rate never reaches zero', () => {
  assert.equal(R.cleanTempo(13), 12.5); assert.equal(R.cleanTempo(999), 400); assert.equal(R.cleanTempo(-999), -400); assert.equal(R.cleanTempo('x'), 100);
  assert.equal(R.RUN.tempoMin, -400); assert.equal(R.RUN.tempoMax, 400);
  const tbl = { 0: 1, 12.5: 1.125, 50: 1.5, 100: 2, 200: 3, 300: 4, 400: 5, '-50': 2 / 3, '-100': 0.5, '-200': 1 / 3, '-400': 0.2 };
  for (const [p, r] of Object.entries(tbl)) assert.ok(near(R.tempoRate(Number(p)), r), `${p}% → ${r}`);
  for (let p = -400; p <= 400; p += 12.5) assert.ok(R.tempoRate(p) > 0);
  for (let p = -387.5; p <= 400; p += 12.5) assert.ok(R.tempoRate(p) > R.tempoRate(p - 12.5), 'monotonic');
});
ok('run tempo is adjustable: every 12.5 % notch is its own rate (the old lock snapped 5 notches to one 3:2)', () => {
  const rates = new Set(); for (let p = -400; p <= 400; p += 12.5) rates.add(R.runRate({ tempo: p }).rate.toFixed(9));
  assert.equal(rates.size, 65, '65 notches = 65 different run tempos');
  assert.equal(R.cleanRun(null).lock, false); assert.equal(R.cleanRun({ lock: true }).lock, false, 'an old saved lock is dropped');
  assert.ok(near(R.runRate({ tempo: 37.5, lock: true }).rate, 1.375), 'a saved lock no longer snaps');
  assert.equal(R.tempoLabel({ tempo: 37.5 }), '+37.5% · 11:8'); assert.equal(R.tempoLabel({ tempo: 50 }), '+50% · 3:2');
  assert.equal(R.tempoLabel({ tempo: 400 }), '+400% · 5:1'); assert.equal(R.tempoLabel({ tempo: -400 }), '-400% · 1:5'); assert.equal(R.tempoLabel({ tempo: -37.5 }), '-37.5% · 8:11');
  for (let p = -400; p <= 400; p += 12.5) { const { num, den } = R.tempoRatio(p); assert.ok(near(num / den, R.tempoRate(p)), `${p}%: exact ratio`); }
});
ok('lock to clock (dormant, only on request): nearest clean ratio (log distance)', () => {
  const lk = (p) => { const r = R.runRate({ tempo: p }, { lock: true }); return `${r.num}:${r.den}`; };
  assert.equal(lk(0), '1:1'); assert.equal(lk(12.5), '1:1'); assert.equal(lk(25), '3:2'); assert.equal(lk(50), '3:2'); assert.equal(lk(75), '2:1');
  assert.equal(lk(100), '2:1'); assert.equal(lk(150), '3:1'); assert.equal(lk(200), '3:1'); assert.equal(lk(400), '3:1');
  assert.equal(lk(-50), '2:3'); assert.equal(lk(-100), '1:2'); assert.equal(lk(-200), '1:3');
});
ok('crouch (sneak, Ctrl): own tempo −400…+400 % (default −50 % = 2:3) and pitch correction (default a fourth down)', () => {
  const d = R.cleanRun(null); assert.equal(d.crouchTempo, -50); assert.equal(d.crouchPitch, -2); assert.equal(R.pitchSemitones(d.crouchPitch), -5);
  assert.ok(near(R.crouchRate(d).rate, 2 / 3)); assert.equal(R.crouchTempoLabel(d), '-50% · 2:3');
  assert.equal(R.cleanRun({ crouchTempo: 999 }).crouchTempo, 400); assert.equal(R.cleanRun({ crouchTempo: -999 }).crouchTempo, -400); assert.equal(R.cleanRun({ crouchTempo: 'x' }).crouchTempo, -50);
  assert.equal(R.cleanRun({ crouchPitch: 99 }).crouchPitch, 8); assert.equal(R.cleanRun({ crouchPitch: 'x' }).crouchPitch, -2);
  assert.ok(near(R.crouchRate({ crouchTempo: 400 }).rate, 5)); assert.ok(near(R.crouchRate({ crouchTempo: -400 }).rate, 0.2));
  assert.ok(R.RUN.sneakSpeed > 0 && R.RUN.sneakSpeed < 1 && R.RUN.speed > 1);
  const r = { tempo: 25, pitch: 1, crouchTempo: -100, crouchPitch: -5 };
  assert.deepEqual(R.gaitStep('walk', r), null);
  const run = R.gaitStep('run', r); assert.ok(near(run.rate, 1.25) && near(run.tune, R.pitchRatio(1)));
  const cr = R.gaitStep('crouch', r); assert.ok(near(cr.rate, 0.5) && near(cr.tune, 0.5));
});
ok('gait: Shift = run, Ctrl = crouch (Ctrl wins), moving OR dancing; standing still = walk', () => {
  assert.equal(R.gaitOf({ moving: true }), 'walk');
  assert.equal(R.gaitOf({ moving: true, shift: true }), 'run');
  assert.equal(R.gaitOf({ moving: true, ctrl: true }), 'crouch');
  assert.equal(R.gaitOf({ moving: true, ctrl: true, shift: true }), 'crouch');
  assert.equal(R.gaitOf({ dancing: true, shift: true }), 'run', 'dance + Shift = run tempo');
  assert.equal(R.gaitOf({ dancing: true, ctrl: true }), 'crouch', 'dance + Ctrl = crouch tempo');
  assert.equal(R.gaitOf({ dancing: true }), 'walk');
  assert.equal(R.gaitOf({ shift: true, ctrl: true }), 'walk', 'standing still');
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

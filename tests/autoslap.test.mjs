// Auto-slap's maths (shared/autoslap.mjs): rate mapping, the step sequence (1–32 steps, a schema of
// per-step params), the beat lock on the Groove bar, the firing clock, settings persistence.
// Run: node tests/autoslap.test.mjs (in npm test)
import assert from 'node:assert/strict';
import * as A from '../shared/autoslap.mjs';
import * as G from '../shared/groove.mjs';

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const LENS = [1, 3, 5, 8, 16, 32];

ok('rate slider is log: 0 = 1 per 4 s, 1000 = 8/s, 2/s at 600; round trip; , and . a quarter octave', () => {
  assert.equal(A.sliderToRate(0), 0.25); assert.equal(A.sliderToRate(1000), 8); assert.equal(A.rateToSlider(2), 600);
  for (const r of [0.3, 0.5, 1, 3, 7]) assert.ok(Math.abs(A.sliderToRate(A.rateToSlider(r)) / r - 1) < 0.01, `round trip ${r}`);
  assert.ok(near(A.sliderToRate(300) / A.sliderToRate(200), A.sliderToRate(900) / A.sliderToRate(800), 1e-2), 'equal steps = equal ratios');
  assert.equal(A.stepRate(8, 1), 8); assert.equal(A.stepRate(0.25, -1), 0.25); assert.equal(A.stepRate(1, 1), 1.19);
  assert.equal(A.rateLabel(0.25), '1 per 4 s'); assert.equal(A.rateLabel(2), '2/s');
  assert.equal(1000 / A.AUTO.minGapMs, A.AUTO.maxRate, 'the gap guard = the max rate');
  assert.ok(A.AUTO.maxRate * 60 < A.AUTO.serverPerMinute, 'the client max fits inside the server budget');
});
ok('length: any integer 1…32, default 8; outside is clamped, junk = 8', () => {
  for (const l of LENS) assert.equal(A.clampLen(l), l);
  assert.equal(A.clampLen(0), 1); assert.equal(A.clampLen(-5), 1); assert.equal(A.clampLen(33), 32); assert.equal(A.clampLen(1000), 32);
  assert.equal(A.clampLen(4.6), 5); assert.equal(A.clampLen('16'), 16); assert.equal(A.clampLen(NaN), 8); assert.equal(A.clampLen(null), 8);
  assert.equal(A.cleanSeq(null).len, 8); assert.equal(A.cleanSeq({ len: 99 }).len, 32); assert.equal(A.cleanSeq({ len: 0 }).len, 1);
});
ok('steps are schema objects (STEP_PARAMS): defaults, cleaning, unknown keys dropped', () => {
  assert.deepEqual(A.defaultStep(), { on: true, vol: 100 });
  assert.deepEqual(A.cleanStep({ on: false, vol: 250, x: 1 }), { on: false, vol: 100 });
  assert.deepEqual(A.cleanStep({ on: 'yes', vol: -3 }), { on: true, vol: 0 }); assert.deepEqual(A.cleanStep({ vol: 33.6 }), { on: true, vol: 34 });
  // one entry added to the schema = it is everywhere (defaults, cleaning)
  A.STEP_PARAMS.x = { type: 'num', min: -1, max: 1, def: 0, label: 'X' };
  try { assert.deepEqual(A.defaultStep(), { on: true, vol: 100, x: 0 }); assert.equal(A.cleanStep({ x: 5 }).x, 1); assert.equal(A.cleanSeq({}).steps[31].x, 0); }
  finally { delete A.STEP_PARAMS.x; }
});
ok('growing appends defaults; shrinking hides steps but keeps them, growing again brings them back', () => {
  let q = A.cleanSeq({ len: 8 });
  q = A.setStep(q, 6, { on: false, vol: 40 }); q = A.setStep(q, 7, { vol: 10 });
  q = A.setLen(q, 5); assert.equal(A.visibleSteps(q).length, 5);
  q = A.cleanSeq(JSON.parse(JSON.stringify(q))); // through localStorage
  q = A.setLen(q, 12);
  assert.deepEqual(A.visibleSteps(q)[6], { on: false, vol: 40 }); assert.deepEqual(A.visibleSteps(q)[7], { on: true, vol: 10 });
  assert.deepEqual(A.visibleSteps(q)[11], A.defaultStep()); assert.equal(q.steps.length, 32);
  assert.equal(A.setStep(q, 40, { on: false }).steps.length, 32, 'an index past 32 changes nothing');
});
ok('persistence: settings survive JSON for every length; on/off is not kept; bad values fall back', () => {
  for (const len of LENS) {
    let s = A.cleanSettings({ mode: 'bar', bars: 2, rate: 3, seq: A.setStep(A.setLen(null, len), len - 1, { on: false, vol: 55 }) });
    s = A.cleanSettings(JSON.parse(JSON.stringify({ ...s, on: true })));
    assert.equal(s.seq.len, len); assert.deepEqual(s.seq.steps[len - 1], { on: false, vol: 55 }); assert.equal(s.bars, 2); assert.equal(s.rate, 3); assert.ok(!('on' in s));
  }
  assert.deepEqual(A.cleanSettings({ mode: 'x', bars: 3, rate: 99 }).mode, 'bar'); assert.equal(A.cleanSettings({ bars: 3 }).bars, 1); assert.equal(A.cleanSettings({ rate: 99 }).rate, 8); assert.equal(A.cleanSettings({ rate: 0.01 }).rate, 0.25);
});
ok('beat lock: N steps divide the Groove bar (× bars) – odd lengths are polyrhythms against the footsteps', () => {
  const bar = G.barMs(1);
  for (const len of LENS) {
    const s = A.cleanSettings({ mode: 'bar', seq: { len } });
    assert.ok(near(A.stepMs(s, bar), bar / len), `len ${len}`);
    // step boundaries line up with the bar: step 0 starts exactly on the downbeat
    const g = { scale: 1, at: 0, phase: 0 }, t = 1793031959884, b0 = Math.ceil(G.barsAt(g, t)), tb = g.at + (b0 - g.phase) * bar;
    assert.equal(A.stepAt(s, { t: tb + 0.01, bars: G.barsAt(g, tb + 0.01) }) % len, 0);
    assert.equal(((A.stepAt(s, { t: tb - 0.01, bars: G.barsAt(g, tb - 0.01) }) % len) + len) % len, len - 1);
  }
  assert.ok(near(A.stepMs({ mode: 'bar', bars: 2, seq: { len: 8 } }, bar), 375), '2 bars of 8 steps'); assert.ok(near(A.stepMs({ mode: 'bar', seq: { len: 5 } }, G.barMs(0.5)), 150), 'follows the Groove scale');
  // a 5-step loop against the 4-step walker: they coincide only on the downbeat (5 and 4 are coprime)
  const five = [0, 1, 2, 3, 4].map((i) => i / 5), four = [0, 1, 2, 3].map((i) => i / 4);
  assert.deepEqual(five.filter((x) => four.some((y) => near(x, y))), [0]);
});
ok('free rate: each step lasts 1/rate, the length only sets the loop', () => {
  for (const len of LENS) { const s = { mode: 'free', rate: 4, seq: { len } }; assert.equal(A.stepMs(s), 250); assert.equal(A.stepAt(s, { t: 1000 + 251 * 3, t0: 1000 }), 3); }
});
ok('the clock fires each new step once (on steps only), never a catch-up burst, never faster than 8/s', () => {
  for (const len of LENS) {
    const s = A.cleanSettings({ mode: 'free', rate: 4, seq: A.setStep(A.setLen(null, len), 0, { on: len === 1 }) });
    const c = A.createClock(); const fired = [];
    for (let t = 0; t <= 4000; t += 16) { const n0 = A.stepAt(s, { t, t0: 0 }); const f = c.tick(s, n0, t); if (f && !f.skipped) fired.push(f); }
    const want = len === 1 ? 16 : 16 - Math.ceil(16 / len); // every step but step 0 (off); the first boundary waits
    assert.ok(fired.every((f) => f.i !== 0 || len === 1), `len ${len}: step 0 off`);
    assert.ok(Math.abs(fired.length - want) <= 1, `len ${len}: ${fired.length} vs ~${want}`);
  }
  const c = A.createClock(), s = A.cleanSettings({ mode: 'bar', seq: { len: 32 } });
  assert.equal(c.tick(s, 10, 0), null, 'switching on waits for the next boundary');
  assert.ok(c.tick(s, 11, 47).step, 'next step fires'); assert.equal(c.tick(s, 11, 60), null, 'same step: once');
  assert.equal(c.tick(s, 12, 94).skipped, 'gap', '47 ms later: too soon (8/s cap)');
  assert.ok(c.tick(s, 15, 300).step && c.lastFire === 300, 'a slow frame jumps 3 steps: fires the newest once');
});
ok('effective rate: on the beat 32 steps of a 1.5 s bar = 21/s, capped to 8/s', () => {
  assert.equal(A.effectiveRate({ mode: 'bar', seq: { len: 32 } }, 1500), 8);
  assert.ok(near(A.effectiveRate({ mode: 'bar', seq: { len: 8 } }, 1500), 8 / 1.5 > 8 ? 8 : 8 / 1.5));
  assert.equal(A.effectiveRate({ mode: 'bar', seq: { len: 1 }, bars: 4 }, 1500), 1 / 6);
});
ok('stand-still guard: under max(3 cm, ¼ of the sticker) on the same surface = skip', () => {
  const p = { point: [0, 1, -5], surface: 'vägg-norr' };
  assert.ok(A.movedEnough(null, [0, 1, -5], 'vägg-norr', 0.15));
  assert.ok(!A.movedEnough(p, [0.02, 1, -5], 'vägg-norr', 0.1)); assert.ok(A.movedEnough(p, [0.04, 1, -5], 'vägg-norr', 0.1));
  assert.ok(!A.movedEnough(p, [0.2, 1, -5], 'vägg-norr', 1)); assert.ok(A.movedEnough(p, [0, 1, -5], 'golv', 1));
});
console.log(`autoslap: ${n} checks ok`);

// The footstep groove's grid math (shared/groove.mjs): one shared bar, interlocking polyrhythms per
// slot, a log-mapped scale that stretches the whole bar. Run: node tests/groove.test.mjs (in npm test)
import assert from 'node:assert/strict';
import * as G from '../shared/groove.mjs';

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const T0 = 1793031959884; // some wall-clock ms
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

ok('deterministic: two clients with the same clock and groove get the same events (also when they ask in different chunks)', () => {
  const g = { scale: 0.7, at: T0 - 12345, phase: 0.3 };
  for (let slot = 0; slot < 5; slot++) {
    const a = G.eventsBetween(g, slot, T0, T0 + 5000);
    const b = []; for (let t = T0; t < T0 + 5000; t += 16.7) b.push(...G.eventsBetween(g, slot, t, Math.min(t + 16.7, T0 + 5000)));
    assert.equal(a.length, b.length, `slot ${slot}`);
    a.forEach((e, i) => { assert.ok(near(e.t, b[i].t, 1e-3) && e.n === b[i].n && e.tick === b[i].tick, `slot ${slot} event ${i}`); });
    assert.deepEqual(G.eventsBetween(G.cleanGroove(JSON.parse(JSON.stringify(g))), slot, T0, T0 + 5000), a, 'the same after JSON (the network)');
  }
});
ok('each slot keeps its own polyrhythm: 4, 3, 5, 6, 7 pulses per bar, evenly spaced', () => {
  const g = G.DEFAULT_GROOVE, B = G.barMs(1);
  [4, 3, 5, 6, 7].forEach((p, slot) => {
    const ev = G.eventsBetween(g, slot, T0, T0 + B * 10);
    assert.ok(ev.length === p * 10 || ev.length === p * 10 + 1 || ev.length === p * 10 - 1, `slot ${slot}: ${ev.length} in 10 bars`);
    for (let i = 1; i < ev.length; i++) assert.ok(near(ev[i].t - ev[i - 1].t, B / p, 1e-3));
    assert.equal(new Set(ev.map((e) => e.tick)).size, p, 'the same ticks every bar');
  });
  assert.equal(G.patternOf(5), G.PATTERNS[0], 'slots wrap like the sound colours'); assert.equal(G.patternOf(-1), G.PATTERNS[4]);
});
ok('interlocking: the five slots never share a tick (smallest gap 5 of 420 ticks), at any scale', () => {
  const all = [0, 1, 2, 3, 4].flatMap(G.ticksOf).sort((a, b) => a - b);
  assert.equal(new Set(all).size, all.length, 'no collisions');
  assert.equal(all.length, 25);
  let gap = Infinity; for (let i = 0; i < all.length; i++) gap = Math.min(gap, (all[(i + 1) % all.length] - all[i] + G.GROOVE.ticks) % G.GROOVE.ticks);
  assert.equal(gap, 5);
  for (const scale of [G.GROOVE.min, 0.1, 1, 3, G.GROOVE.max]) {
    const g = { scale, at: T0, phase: 0.123 }, B = G.barMs(scale);
    const times = [0, 1, 2, 3, 4].flatMap((s) => G.eventsBetween(g, s, T0, T0 + B * 3)).map((e) => e.t).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= B * 5 / 420 - 1e-3, `scale ${scale}: gap ${times[i] - times[i - 1]}`);
  }
});
ok('scale stretches the whole bar: every interval scales by the same factor, ratios intact', () => {
  for (const s of [G.GROOVE.min, 0.25, 2, G.GROOVE.max]) {
    const a = { scale: 1, at: T0, phase: 0 }, b = { scale: s, at: T0, phase: 0 };
    const ea = [0, 1, 2, 3, 4].flatMap((k) => G.eventsBetween(a, k, T0, T0 + G.barMs(1))).sort((x, y) => x.t - y.t);
    const eb = [0, 1, 2, 3, 4].flatMap((k) => G.eventsBetween(b, k, T0, T0 + G.barMs(s))).sort((x, y) => x.t - y.t);
    assert.equal(ea.length, eb.length);
    ea.forEach((e, i) => { assert.equal(e.tick, eb[i].tick); assert.equal(e.slot, eb[i].slot); assert.ok(near((eb[i].t - T0), (e.t - T0) * G.cleanScale(s), 1e-3), `scale ${s}`); });
  }
});
ok('changing the scale keeps the phase (no jump), and the new tempo runs from there', () => {
  const g = { scale: 1, at: 0, phase: 0 };
  const now = T0 + 777, h = G.retime(g, 0.5, now);
  assert.ok(near(G.phaseAt(h, now), G.phaseAt(g, now), 1e-5), 'same phase at the change');
  assert.ok(near(G.phaseAt(h, now + G.barMs(0.5) / 4), (G.phaseAt(g, now) + 0.25) % 1, 1e-5), 'then twice as fast');
  assert.equal(h.scale, 0.5); assert.equal(h.at, now);
});
ok('clamp range 1/64 … 8, 4 significant digits; junk is rejected; the default is 1.0×', () => {
  assert.equal(G.cleanScale(100), 8); assert.equal(G.cleanScale(0.0001), G.cleanScale(1 / 64)); assert.ok(G.cleanScale(1 / 64) >= 1 / 64);
  assert.equal(G.cleanScale('2'), 2); assert.equal(G.cleanScale(1.234567), 1.235);
  for (const bad of [NaN, Infinity, -1, 0, null, undefined, 'x', {}, []]) assert.equal(G.cleanScale(bad), null, String(bad));
  assert.deepEqual(G.cleanGroove(null), { scale: 1, at: 0, phase: 0 }); assert.deepEqual(G.cleanGroove({ scale: 99, at: 'x', phase: 1.25 }), { scale: 8, at: 0, phase: 0.25 });
});
ok('extremes: at 1/64 a 4-pulse walker steps every ~6 ms (a buzz); at 8 a 3-pulse walker every 4 s', () => {
  assert.ok(G.pulseMs(G.GROOVE.min, 0) > 5 && G.pulseMs(G.GROOVE.min, 0) < 7 && G.buzzes(G.GROOVE.min, 0));
  assert.equal(G.pulseMs(G.GROOVE.max, 1), 4000); assert.ok(!G.buzzes(1, 4) && !G.buzzes(G.GROOVE.max, 4));
  assert.ok(G.buzzes(0.1, 4) && !G.buzzes(0.2, 0), 'buzz threshold 40 ms');
});
ok('slider is log: 0 = 1/64, 1000 = 8, 1.0× in between; round trip; keys a quarter octave (Shift a whole one)', () => {
  assert.equal(G.sliderToScale(0), G.cleanScale(1 / 64)); assert.equal(G.sliderToScale(1000), 8); assert.equal(G.scaleToSlider(1), 667);
  for (const s of [0.02, 0.1, 0.5, 1, 2.5, 7]) assert.ok(Math.abs(G.sliderToScale(G.scaleToSlider(s)) / s - 1) < 0.01, `round trip ${s}`);
  assert.ok(near(G.sliderToScale(500) / G.sliderToScale(400), G.sliderToScale(900) / G.sliderToScale(800), 1e-3), 'equal slider steps = equal ratios');
  assert.equal(G.stepScale(1, 1, true), 2); assert.equal(G.stepScale(1, -1, true), 0.5); assert.equal(G.stepScale(1, 1), 1.189);
  assert.equal(G.stepScale(8, 1), 8); assert.equal(G.stepScale(G.GROOVE.min, -1), G.cleanScale(G.GROOVE.min));
  assert.deepEqual(G.grooveLabel(1), { scale: '1.00×', bar: '1.5 s' }); assert.equal(G.grooveLabel(1 / 64).bar, '23 ms'); assert.equal(G.grooveLabel(8).bar, '12 s');
});
console.log(`groove: ${n} checks ok`);

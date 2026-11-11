// Walk-sound sequencer (shared/walkseq.mjs; Jens t783u, 10 Nov 2026): only while walking, pauses in
// place, run mode tempo + pitch. Run: node tests/walkseq.test.mjs (in npm test)
import assert from 'node:assert/strict';
import { planWalkSeq, newWalkSeq, walkGrid } from '../shared/walkseq.mjs';
import { loopSteps, barMsAt, MASTER, playerTempo } from '../shared/clock.mjs';
import { runRate, pitchRatio, RUN_DEFAULTS } from '../shared/runmode.mjs';

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const near = (a, b, e = 0.01) => Math.abs(a - b) <= e;
const tempo = { bpm: MASTER.bpm, phaseMs: 0 }, BAR = barMsAt(MASTER.bpm), T0 = 1793031959884;
const LOOP = { steps: 4, bars: 1, tempo };
// drive the planner like radio.tick does (a frame every 16 ms, 150 ms lookahead); walking(t) → bool
function drive(st, t0, t1, walking, run = () => null) {
  const out = [];
  for (let now = t0; now < t1; now += 16) {
    const w = walking(now); // the groove keeps "walking" 140 ms past the last movement
    out.push(...planWalkSeq(st, { now, ahead: now + 150, walk: { until: w ? now + 140 : 0, run: run(now) }, ...LOOP }));
  }
  return out;
}

ok('standing still: no steps at all, the clock does not roll', () => {
  const st = newWalkSeq();
  assert.deepEqual(drive(st, T0, T0 + 4 * BAR, () => false), []);
  assert.equal(st.count, 0);
});
ok('walking: the steps come on my tempo\'s grid (90 BPM default), in pattern order 0,1,2,3,0…', () => {
  const st = newWalkSeq(), evs = drive(st, T0, T0 + 2 * BAR, () => true);
  const grid = loopSteps(T0 - 20, T0 + 2 * BAR + 150, { steps: 4, bars: 1, tempo }).map((e) => e.t);
  assert.ok(evs.length >= 8);
  evs.forEach((e, k) => { assert.ok(grid.some((g) => near(g, e.t)), 'on the grid'); assert.equal(e.i, k % 4); assert.equal(e.tune, 1); });
  for (let k = 1; k < evs.length; k++) assert.ok(near(evs[k].t - evs[k - 1].t, BAR / 4), 'one step per quarter bar, no doubles');
});
ok('stop → silent; walk again → goes on from the NEXT step (pause, not reset to step 1)', () => {
  const st = newWalkSeq(), stopAt = T0 + BAR * 0.6, againAt = T0 + BAR * 3.1;
  const evs = drive(st, T0, T0 + BAR * 5, (t) => t < stopAt || t >= againAt);
  const before = evs.filter((e) => e.t < stopAt + 300), after = evs.filter((e) => e.t >= againAt - 20);
  assert.ok(before.length >= 2 && after.length >= 4);
  assert.ok(!evs.some((e) => e.t > stopAt + 300 && e.t < againAt - 20), 'nothing while standing');
  assert.equal(after[0].i, before.length % 4, 'continues where it paused');
  assert.ok(near(((after[0].t - tempo.phaseMs) / (BAR / 4)) % 1, 0, 1e-3) || near(((after[0].t - tempo.phaseMs) / (BAR / 4)) % 1, 1, 1e-3), 'still on the beat grid');
});
ok('nothing is scheduled past the moment I count as walking (no tail after I stop)', () => {
  const st = newWalkSeq(), now = T0 + 3;
  const evs = planWalkSeq(st, { now, ahead: now + 150, walk: { until: now + 10, run: null }, steps: 16, bars: 0.25, tempo });
  assert.ok(evs.every((e) => e.t < now + 10));
});
ok('run mode: run tempo (2:1 default) doubles the step rate on the same grid, run pitch on every step', () => {
  const rr = runRate(RUN_DEFAULTS), tune = pitchRatio(RUN_DEFAULTS.pitch);
  assert.equal(rr.rate, 2);
  const st = newWalkSeq(), evs = drive(st, T0, T0 + 2 * BAR, () => true, () => ({ rate: rr.rate, tune }));
  for (let k = 1; k < evs.length; k++) assert.ok(near(evs[k].t - evs[k - 1].t, BAR / 8));
  assert.ok(evs.every((e) => near(e.tune, tune) && tune > 1.49 && tune < 1.51), 'a fifth up');
  // every walk grid step is also a run step (polyrhythm against walkers)
  for (const g of walkGrid(T0 + 100, T0 + 2 * BAR - 200, LOOP)) assert.ok(evs.some((e) => near(e.t, g)));
});
ok('run mode slower (−100 % = 1:2) and unlocked rates follow the slider', () => {
  const half = runRate({ tempo: -100, pitch: 0, lock: true }).rate, free = runRate({ tempo: 62.5, pitch: 0, lock: false }).rate;
  for (const rate of [half, free]) {
    const st = newWalkSeq(), evs = drive(st, T0, T0 + 4 * BAR, () => true, () => ({ rate, tune: 1 }));
    for (let k = 1; k < evs.length; k++) assert.ok(near(evs[k].t - evs[k - 1].t, BAR / 4 / rate, 1e-3), `rate ${rate}`);
  }
});
ok('walk ↔ run switch mid-bar: the pattern position carries on, no doubled step where the grids meet', () => {
  const st = newWalkSeq(), sw = T0 + BAR * 1.3, back = T0 + BAR * 2.6;
  const evs = drive(st, T0, T0 + BAR * 4, () => true, (t) => (t >= sw && t < back ? { rate: 2, tune: 1.5 } : null));
  evs.forEach((e, k) => assert.equal(e.i, k % 4, 'no skipped / repeated pattern step'));
  for (let k = 1; k < evs.length; k++) assert.ok(evs[k].t - evs[k - 1].t > BAR / 8 * 0.44, 'no doubled step');
  assert.ok(evs.some((e) => e.tune === 1.5) && evs.filter((e) => e.t > back + 200).every((e) => e.tune === 1), 'run pitch only while running');
});
ok('walk tempo (my per-player walkBpm) scales the walk sequencer', () => {
  const fast = { bpm: 180, phaseMs: 0 }, st = newWalkSeq();
  const evs = []; for (let now = T0; now < T0 + 2000; now += 16) evs.push(...planWalkSeq(st, { now, ahead: now + 150, walk: { until: now + 140, run: null }, steps: 4, bars: 1, tempo: fast }));
  for (let k = 1; k < evs.length; k++) assert.ok(near(evs[k].t - evs[k - 1].t, barMsAt(180) / 4));
});
ok('Tempo changed mid-walk (t846u: the slider is live): the sequencer goes on in order on the new grid, no doubled step', () => {
  const st = newWalkSeq(), sw = T0 + 1500, evs = [];
  for (let now = T0; now < T0 + 4000; now += 16) {
    const tempo = playerTempo(now < sw ? 90 : 240);
    evs.push(...planWalkSeq(st, { now, ahead: now + 150, walk: { until: now + 140, run: null }, steps: 4, bars: 1, tempo }));
  }
  evs.forEach((e, k) => assert.equal(e.i, k % 4, 'pattern order kept across the change'));
  const after = evs.filter((e) => e.t > sw + 400);
  for (let k = 1; k < after.length; k++) assert.ok(near(after[k].t - after[k - 1].t, barMsAt(240) / 4), 'then at 240 BPM');
  for (let k = 1; k < evs.length; k++) assert.ok(evs[k].t - evs[k - 1].t > barMsAt(240) / 4 * 0.44, 'no doubled step at the switch');
});
ok('run / crouch stay a % of MY Tempo (also at a non-default Tempo)', () => {
  const st = newWalkSeq(), tempo = playerTempo(120), rr = runRate({ ...RUN_DEFAULTS, tempo: 50 }).rate; // +50 % = 3:2
  const evs = []; for (let now = T0; now < T0 + 3000; now += 16) evs.push(...planWalkSeq(st, { now, ahead: now + 150, walk: { until: now + 140, run: { rate: rr, tune: 1 } }, steps: 4, bars: 1, tempo }));
  for (let k = 1; k < evs.length; k++) assert.ok(near(evs[k].t - evs[k - 1].t, barMsAt(120) / 4 / 1.5), `${evs[k].t - evs[k - 1].t}`);
});
console.log(`walk sequencer: ${n} checks ok`);

// Walk-sound sequencer (Jens t783u, 10 Nov 2026): a sequencer layer on the Steps (walk) sound only
// runs while I walk – standing still = silence, no steps, no rolling. It pauses in place: when I
// walk again it goes on from the NEXT step of the pattern (not back to step 1), on the next beat of
// the master clock grid, so it still sits in time with the room (four voices, other sequencers).
// Run mode (shared/runmode.mjs, t544u) applies like it does to the footsteps: while running, the
// steps come at run.rate × the walk step rate (same grid, so 2:1 = a run step on every walk step
// and one between) and every step is pitched by run.tune (the pentatonic pitch correction).
// Pure maths (no audio): client/src/radio.js schedules what plan() returns; tests/walkseq.test.mjs.
import { barsAtTime, timeOfBar } from './clock.mjs';

export const WALKSEQ = Object.freeze({ lateMs: 20, max: 64, guard: 0.45 });

// The grid points of a loop of `steps` steps per `bars` bars at `rate` × its speed with from ≤ t < to.
export function walkGrid(from, to, { steps, bars = 1, tempo, rate = 1, max = WALKSEQ.max }) {
  const out = []; if (!(to > from) || !(steps > 0)) return out;
  if (!(rate > 0) || !Number.isFinite(rate)) rate = 1;
  const per = bars / (steps * rate); // bars per step
  for (let n = Math.ceil(barsAtTime(from, tempo) / per - 1e-9); out.length < max; n++) {
    const t = timeOfBar(n * per, tempo); if (t >= to) break; if (t < from) continue;
    out.push(t);
  }
  return out;
}

// One walk-sequencer loop's state: { next: wall ms planned up to, count: steps played so far
// (the pattern position = count % len), last: wall ms of the last step }.
export const newWalkSeq = () => ({ next: 0, count: 0, last: null });

// What to play between now and `ahead` (wall ms). walk = { until: I count as walking until this
// wall ms (0 = standing), run: { rate, tune } | null }. Returns [{ t, i (pattern step), tune }] and
// moves `state` on. Standing: nothing, and the position is kept (pause, not reset).
export function planWalkSeq(state, { now, ahead, walk, steps, bars = 1, tempo }) {
  const until = walk && walk.until > 0 ? walk.until : 0;
  const to = Math.min(ahead, until);
  if (!(to > now) || !(steps > 0)) return [];
  const run = walk.run && walk.run.rate > 0 ? walk.run : null;
  const rate = run ? run.rate : 1, tune = run && run.tune > 0 ? run.tune : 1;
  const from = Math.max(state.next || now, now - WALKSEQ.lateMs);
  const period = timeOfBar(bars / (steps * rate), { bpm: tempo.bpm, phaseMs: 0 }); // ms per step
  const out = [];
  for (const t of walkGrid(from, to, { steps, bars, tempo, rate })) {
    // walk ↔ run switch (a new grid): no doubled step right after the last one
    if (state.last != null && t > state.last - 0.5 && t - state.last < period * WALKSEQ.guard) continue;
    out.push({ t, i: state.count % steps, tune });
    state.count++; state.last = t;
  }
  state.next = Math.max(state.next || 0, to);
  return out;
}

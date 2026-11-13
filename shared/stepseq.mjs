// The Steps sequencer (Jens t889u, 13 Nov 2026): "walk mode, run mode och crouch mode är egentligen en sequenser
// som kör i olika tempo – en 4-stegs sequenser som triggar på 1, sen tre tomma platser, sen loop … sequensern
// hamnar på ett lager istället för på hela ljudet." So the Steps sound has ONE sequencer that plays the WHOLE
// sound (every layer), and it IS the footsteps:
//   - Its clock is the footstep grid (shared/groove.mjs): my Tempo × Groove × my slot's polyrhythm × the gait rate
//     (walk 1, run / crouch rate). A loop lasts `loop` footsteps and has `len` steps, so with the default
//     (4 steps, loop 1 footstep, step 1 on) every footstep is step 1 and steps 2–4 fall between footsteps – the
//     same one hit per footstep as before. Dance counts as walking, so the dance's steps run it too.
//   - Phase: the step index is the step's position on the shared grid (anchored at wall time 0), so it is the
//     same on every screen; the first step when I start (or change gait / tempo) is on the next beat and is
//     always step 1 (groove.js entry, shared/tempogrid.mjs entryMs).
//   - Parameter locks (Elektron-style): a step may carry locks { 'L0.cutoff': 800, 'G.gain': 0.6, … } – that step
//     plays with those values, every other step with the base sound. The walking randomness (the per-step pitch
//     wobble and left/right foot in client/src/sound.js / groove.js) still rides on top.
// Pure maths, no audio – client/src/groove.js schedules it, client/src/soundui.js edits it, tests/stepseq.test.mjs.
import { runEventsBetween } from './groove.mjs';
import { stepSeqOf, lockRange, clampTo, SYNTH, STEP_SEQ_DEFAULT } from './synth.mjs';

export { stepSeqOf };
// Faster than this per step: the sub-steps are not scheduled (only the footsteps, step 1's sound) – a flood guard.
export const STEP_SEQ = Object.freeze({ minStepMs: 12 });

const mod = (a, n) => ((a % n) + n) % n;
// Steps per footstep (may be fractional: 3 steps over 2 footsteps = 1.5).
export const stepsPerFoot = (seq) => { const q = seq && Array.isArray(seq.steps) && seq.steps.length ? seq : STEP_SEQ_DEFAULT; return q.len / q.loop; };

// The sequencer steps of one walker with from ≤ t < to (ms) on their footstep grid.
// g = their groove ({ scale, at, phase }), slot = their polyrhythm slot, rate = the gait rate (1 = walking),
// bpm = their Tempo, seq = the patch's seq (or null = the default).
// → [{ t, m (absolute grid step), i (pattern step 0…len-1), n (footstep number, for left/right), foot (true =
//     the step falls on a footstep), tick, slot }]
export function stepSeqBetween(g, slot, from, to, { rate = 1, bpm, seq = null, max = 512 } = {}) {
  const q = seq && Array.isArray(seq.steps) && seq.steps.length ? seq : STEP_SEQ_DEFAULT;
  const per = q.len / q.loop;
  return runEventsBetween(g, slot, from, to, rate * per, { max, bpm }).map((e) => {
    const f = e.n / per, n = Math.floor(f + 1e-9);
    return { t: e.t, m: e.n, i: mod(e.n, q.len), n, foot: Math.abs(f - Math.round(f)) < 1e-9, tick: e.tick, slot: e.slot };
  });
}

// The patch as step i plays it: its locks applied (G.gain → the patch gain, L<n>.<param> → that layer's param).
// Never mutates; no locks → the same object.
export function lockedPatch(patch, i) {
  const seq = patch && patch.seq; if (!seq || !Array.isArray(seq.steps)) return patch;
  const st = seq.steps[mod(Math.round(i) || 0, seq.steps.length)];
  const locks = st && st.locks; if (!locks) return patch;
  let gain = patch.gain; const layers = patch.layers.map((l) => l);
  for (const [k, v] of Object.entries(locks)) {
    const r = lockRange(k, patch.layers); if (!r || !Number.isFinite(v)) continue;
    const val = clampTo(v, r, r[0]);
    if (k === 'G.gain') { gain = val; continue; }
    const m = /^L(\d)\.([a-zA-Z]+)$/.exec(k); const li = +m[1];
    layers[li] = { ...layers[li], [m[2]]: val };
  }
  return { ...patch, gain, layers };
}

// ---------- Editing helpers (client/src/soundui.js; all mutate the seq in place) ----------
export const lockKey = (layer, param) => (layer == null ? 'G.gain' : `L${layer}.${param}`);
export function setLock(seq, i, key, v) {
  const st = seq && seq.steps && seq.steps[i]; if (!st) return false;
  if (!st.locks) st.locks = {};
  if (!(key in st.locks) && Object.keys(st.locks).length >= SYNTH.maxLocksPerStep) return false;
  st.locks[key] = v; return true;
}
export const getLock = (seq, i, key) => { const l = seq && seq.steps && seq.steps[i] && seq.steps[i].locks; return l && key in l ? l[key] : undefined; };
export function clearLock(seq, i, key) { const st = seq && seq.steps && seq.steps[i]; if (!st || !st.locks) return; delete st.locks[key]; if (!Object.keys(st.locks).length) delete st.locks; }
// i = a step index, or null = every step.
export function clearLocks(seq, i = null) { if (!seq || !seq.steps) return; seq.steps.forEach((st, j) => { if (i == null || j === i) delete st.locks; }); }
export const lockCount = (seq, i = null) => (seq && seq.steps ? seq.steps.reduce((n, st, j) => n + (i == null || j === i ? Object.keys(st.locks || {}).length : 0), 0) : 0);
// The steps (indices) that lock this key.
export const stepsLocking = (seq, key) => (seq && seq.steps ? seq.steps.flatMap((st, j) => (st.locks && key in st.locks ? [j] : [])) : []);
// A layer was removed: its locks go, the later layers' locks move down one.
export function removeLayerLocks(seq, idx) {
  if (!seq || !seq.steps) return;
  for (const st of seq.steps) {
    if (!st.locks) continue;
    const out = {};
    for (const [k, v] of Object.entries(st.locks)) {
      const m = /^L(\d)\.(.+)$/.exec(k);
      if (!m) { out[k] = v; continue; }
      const li = +m[1]; if (li === idx) continue;
      out[li > idx ? `L${li - 1}.${m[2]}` : k] = v;
    }
    if (Object.keys(out).length) st.locks = out; else delete st.locks;
  }
}
// Change the step count, keeping the steps (and their locks) that stay; new steps are off.
export function resizeSeq(seq, len) {
  const n = Math.min(SYNTH.seqMax, Math.max(1, Math.round(len)));
  seq.steps = Array.from({ length: n }, (_, j) => seq.steps[j] || { on: false, vol: 100 });
  seq.len = n; return seq;
}

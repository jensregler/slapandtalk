// The footstep groove: each player's footsteps on THEIR OWN bar (Jens, 11 Nov 2026 t846u: no shared
// clock, everyone has their own BPM). Shared by the web app (client/src/groove.js schedules the steps)
// and the tests. No network chatter per step: every client works a walker's bar out from the wall clock
// (corrected by the server's clock in the WebSocket welcome) and that walker's tempo (shared/playertempo.mjs,
// sent once per change), so a remote player's steps land at the same moment on every screen.
//
// The bar has GROOVE.ticks ticks. Each player slot (the same slot that gives their sound its
// colour, shared/synth.mjs SLOT_COLOURS) has its own polyrhythm on that bar: 4, 3, 5, 6 and 7
// pulses, each shifted by an offset so two slots at the SAME tempo never land on the same tick.
// A step only sounds while that avatar walks; the timing comes from the grid, not the stride.
//
// Bar length = GROOVE.beats (2) beats of the walker's own Tempo (shared/runmode.mjs walkBpm) × the
// walker's Groove scale. At 90 BPM and 1.0× that is 1333 ms (a 4-pulse walker: 3 steps/s), as before.
//   bar = 2 beats × 60000 / bpm × scale, scale from GROOVE.min (1/64) to GROOVE.max (8).
// Groove is a per-player setting (the ⚙ More → Sound slider, keys [ and ]): it is the bar length in
// beats of that player's tempo – not a clock of its own, never set by the room.
// A walker's state is { scale, at, phase }: at time `at` (ms) the bar was at `phase` (0…1). The web app
// anchors every walker at wall time 0 (at 0, phase 0), so a player's steps fall at the same moments on
// every screen from just their { bpm, scale, rate }; retime() (a phase-continuous change) stays for tests
// and the server's old room-groove endpoint, which nothing in the web app reads any more.
import { cleanWalkBpm } from './runmode.mjs';
import { TEMPO_CLASSES } from './tempogrid.mjs';

export const GROOVE = {
  ticks: 420,       // lcm(3, 4, 5, 6, 7)
  barMs: 4000 / 3,  // one bar at 1.0× and 90 BPM = 2 beats (was 1500 ms) – a 4-pulse walker: 3 steps/s
  beats: 2,         // a bar at 1.0× = 2 beats of the walker's own tempo
  bpm: 90,          // the tempo barMs refers to (the default Tempo, shared/runmode.mjs RUN.walkDef)
  min: 1 / 64, max: 8, def: 1,
  keyStep: Math.pow(2, 1 / 4), // [ and ]: a quarter octave; with Shift a whole octave
  sliderSteps: 1000,
  buzzMs: 40,       // a walker's pulses closer than this: one sustained "buzz" voice instead of events
  lookAheadMs: 120, // how far ahead the web app schedules on the AudioContext clock
};
// Slot → polyrhythm. offset in ticks (picked so all five interlock without collisions).
// t881u (12 Nov 2026, "vi måste få folks takter att matcha … polyrytm tänk"): every slot now starts ON the bar line
// (offset 0; it was 0 / 17 / 31 / 10 / 25 ticks so that slots never met). With everyone's Tempo on the 120-BPM grid
// (shared/tempogrid.mjs) and the grid anchored at server time 0, the 4 / 3 / 5 / 6 / 7 pulses are real polyrhythms
// over a shared downbeat: they meet on the bar line (and 4 / 6 also on the half bar).
export const PATTERNS = [
  { pulses: 4, offset: 0 },
  { pulses: 3, offset: 0 },
  { pulses: 5, offset: 0 },
  { pulses: 6, offset: 0 },
  { pulses: 7, offset: 0 },
];
export const DEFAULT_GROOVE = Object.freeze({ scale: GROOVE.def, at: 0, phase: 0 });

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const patternOf = (slot) => PATTERNS[((Number(slot) | 0) % PATTERNS.length + PATTERNS.length) % PATTERNS.length];

// The Groove scales (t881u): the same musical ratios as the tempo grid (shared/tempogrid.mjs TEMPO_CLASSES:
// 1, 6:5, 5:4, 4:3, 3:2, 8:5, 5:3, 7:4) × powers of two, 1/64 … 8 – so a bar of 2 × scale beats is an exact
// fraction of beats and still meets everybody's bar line. Exact doubles (4/3, not 1.333), the same on every client.
export const SCALE_GRID = Object.freeze((() => {
  const out = new Set();
  for (const [n, d] of TEMPO_CLASSES) for (let k = -7; k <= 3; k++) { const v = (n / d) * 2 ** k; if (v >= GROOVE.min - 1e-12 && v <= GROOVE.max + 1e-12) out.add(v); }
  return [...out].sort((a, b) => a - b);
})());
const SCALE_LOGS = SCALE_GRID.map(Math.log);
// A scale from anyone (slider, key, the network): clamped and snapped to the nearest SCALE_GRID value (log space;
// was 4 significant digits). null = not a number.
export function cleanScale(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!isNum(n) || n <= 0) return null;
  const l = Math.log(Math.min(GROOVE.max, Math.max(GROOVE.min, n)));
  let best = 0, bd = Infinity;
  for (let i = 0; i < SCALE_LOGS.length; i++) { const e = Math.abs(SCALE_LOGS[i] - l); if (e < bd - 1e-12) { bd = e; best = i; } }
  return SCALE_GRID[best];
}
export function cleanGroove(g) {
  if (!g || typeof g !== 'object') return { ...DEFAULT_GROOVE };
  const scale = cleanScale(g.scale) ?? GROOVE.def;
  const at = isNum(g.at) ? Math.round(g.at) : 0;
  const phase = isNum(g.phase) ? ((g.phase % 1) + 1) % 1 : 0;
  return { scale, at, phase: Number(phase.toFixed(6)) };
}
// Bar length (ms) at this scale and tempo (bpm = the walker's own Tempo; default 90).
const bpmOf = (bpm) => (isNum(bpm) && bpm > 0 ? cleanWalkBpm(bpm) : GROOVE.bpm);
export const barMs = (scale, bpm = GROOVE.bpm) => GROOVE.barMs * (cleanScale(scale) ?? GROOVE.def) * GROOVE.bpm / bpmOf(bpm);
// Where in the bar (in bars, not wrapped) the groove is at wall-clock time t (ms).
export function barsAt(g, t, bpm = GROOVE.bpm) { return g.phase + (t - g.at) / barMs(g.scale, bpm); }
// The phase (0…1) at time t.
export function phaseAt(g, t, bpm = GROOVE.bpm) { const b = barsAt(g, t, bpm); return ((b % 1) + 1) % 1; }
// The new state when the scale (and/or the tempo) changes at time now: same phase, new bar length.
// bpm = the tempo up to now (the phase is read on it); the new tempo needs no anchor of its own.
export function retime(g, scale, now, bpm = GROOVE.bpm) {
  const old = cleanGroove(g), s = cleanScale(scale) ?? old.scale;
  return { scale: s, at: Math.round(now), phase: Number(phaseAt(old, Math.round(now), bpm).toFixed(6)) };
}

// One slot's pulses with from ≤ t < to (ms). Each: { t (ms), n (pulse number, for left/right
// foot), tick (0…ticks-1 on the shared bar), slot }. Deterministic: the same on every client.
export function eventsBetween(g, slot, from, to, { max = 256, bpm = GROOVE.bpm } = {}) {
  const st = cleanGroove(g), pat = patternOf(slot), B = barMs(st.scale, bpm), off = pat.offset / GROOVE.ticks;
  const out = []; if (!(to > from)) return out;
  // pulse g sits at bar position x = off + n / pulses
  const first = Math.ceil((barsAt(st, from, bpm) - off) * pat.pulses - 1e-9);
  for (let n = first; out.length < max; n++) {
    const x = off + n / pat.pulses;
    const t = st.at + (x - st.phase) * B;
    if (t >= to) break;
    if (t < from) continue;
    const tick = ((Math.round(x * GROOVE.ticks) % GROOVE.ticks) + GROOVE.ticks) % GROOVE.ticks;
    out.push({ t, n, tick, slot: Number(slot) | 0 });
  }
  return out;
}
// Run mode (shared/runmode.mjs): the same slot's pulses at `rate` × the walk pulse rate, on the SAME
// grid: pulse m sits at bar position off + m / (pulses × rate). With a clean ratio num:den the run
// pulses meet a walk pulse every num run steps (= den walk steps), so runners and walkers form a
// polyrhythm; rate 1 = exactly eventsBetween. Each: { t, n, tick, slot } like eventsBetween.
export function runEventsBetween(g, slot, from, to, rate = 1, { max = 256, bpm = GROOVE.bpm } = {}) {
  if (!(rate > 0) || !Number.isFinite(rate)) rate = 1;
  const st = cleanGroove(g), pat = patternOf(slot), B = barMs(st.scale, bpm), off = pat.offset / GROOVE.ticks, per = pat.pulses * rate;
  const out = []; if (!(to > from)) return out;
  const first = Math.ceil((barsAt(st, from, bpm) - off) * per - 1e-9);
  for (let n = first; out.length < max; n++) {
    const x = off + n / per;
    const t = st.at + (x - st.phase) * B;
    if (t >= to) break;
    if (t < from) continue;
    const tick = ((Math.round(x * GROOVE.ticks) % GROOVE.ticks) + GROOVE.ticks) % GROOVE.ticks;
    out.push({ t, n, tick, slot: Number(slot) | 0 });
  }
  return out;
}
// The ticks a slot plays in one bar (for tests and the readout).
export const ticksOf = (slot) => { const p = patternOf(slot); return Array.from({ length: p.pulses }, (_, i) => (p.offset + i * GROOVE.ticks / p.pulses) % GROOVE.ticks); };
// ms between one slot's pulses at this scale.
export const pulseMs = (scale, slot, bpm = GROOVE.bpm) => barMs(scale, bpm) / patternOf(slot).pulses;
export const buzzes = (scale, slot, bpm = GROOVE.bpm) => pulseMs(scale, slot, bpm) < GROOVE.buzzMs;

// Slider 0…sliderSteps ↔ scale (log). 1.0× sits at 6/9 of the way (min 1/64 = 2^-6, max 8 = 2^3).
const LO = Math.log2(GROOVE.min), HI = Math.log2(GROOVE.max);
export function scaleToSlider(scale) { const s = cleanScale(scale) ?? GROOVE.def; return Math.round(GROOVE.sliderSteps * (Math.log2(s) - LO) / (HI - LO)); }
export function sliderToScale(x) { const k = Math.min(1, Math.max(0, Number(x) / GROOVE.sliderSteps || 0)); return cleanScale(Math.pow(2, LO + k * (HI - LO))); }
// [ / ]: dir −1 = tighter (faster), +1 = looser (slower). big (Shift): a whole octave.
// t881u: one notch of SCALE_GRID (was a quarter octave); Shift = a whole octave (still on the grid).
export function stepScale(scale, dir, big = false) {
  const s = cleanScale(scale) ?? GROOVE.def, d = Math.sign(dir);
  if (big) return cleanScale(s * Math.pow(2, d));
  const i = SCALE_GRID.indexOf(s); return SCALE_GRID[Math.min(SCALE_GRID.length - 1, Math.max(0, i + d))];
}
// "1.00×", "0.016×", "8.00×" and the bar length at my tempo ("1.5 s", "23 ms") + in beats ("2 beats").
export function grooveLabel(scale, bpm = GROOVE.bpm) {
  const s = cleanScale(scale) ?? GROOVE.def, b = barMs(s, bpm), beats = GROOVE.beats * s;
  const x = s >= 0.1 ? s.toFixed(2) : s.toPrecision(2);
  return { scale: `${x}×`, bar: b >= 1000 ? `${(b / 1000).toFixed(b >= 10000 ? 0 : 1)} s` : `${Math.round(b)} ms`, beats: `${Number(beats.toPrecision(3))} beat${beats === 1 ? '' : 's'}` };
}

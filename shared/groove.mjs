// The footstep groove: everyone's footsteps lock into ONE shared cycle (a "bar").
// Shared by the web app (client/src/groove.js schedules the steps) and the server (which keeps
// the room's scale and records it). No network chatter while people walk: every client works the
// bar out from the wall clock (corrected by the server's clock in the WebSocket welcome) and the
// room's groove state, so everyone hears the same groove (like the fabrics' animation).
//
// The bar has GROOVE.ticks ticks. Each player slot (the same slot that gives their sound its
// colour, shared/synth.mjs SLOT_COLOURS) has its own polyrhythm on that bar: 4, 3, 5, 6 and 7
// pulses, each shifted by an offset so no two slots ever land on the same tick (the smallest
// gap is 5 ticks = 18 ms at 1.0×). Several people walking fill each other's gaps: one groove.
// A step only sounds while that avatar walks; the timing comes from the grid, not the stride.
//
// The scale stretches or compresses the whole bar (all slots together, ratios intact):
//   bar = GROOVE.barMs × scale, scale from GROOVE.min (1/64: a 4-pulse step every ~6 ms, a buzz)
//   to GROOVE.max (8: a 3-pulse step every 4 s). Slider and keys move it on a log scale.
// The room's state is { scale, at, phase }: at time `at` (ms) the bar was at `phase` (0…1).
// Changing the scale keeps the phase continuous (like a transport changing tempo).

export const GROOVE = {
  ticks: 420,       // lcm(3, 4, 5, 6, 7)
  barMs: 1500,      // one bar at 1.0× (a 4-pulse walker: 2.7 steps/s)
  min: 1 / 64, max: 8, def: 1,
  keyStep: Math.pow(2, 1 / 4), // [ and ]: a quarter octave; with Shift a whole octave
  sliderSteps: 1000,
  buzzMs: 40,       // a walker's pulses closer than this: one sustained "buzz" voice instead of events
  lookAheadMs: 120, // how far ahead the web app schedules on the AudioContext clock
};
// Slot → polyrhythm. offset in ticks (picked so all five interlock without collisions).
export const PATTERNS = [
  { pulses: 4, offset: 0 },
  { pulses: 3, offset: 17 },
  { pulses: 5, offset: 31 },
  { pulses: 6, offset: 10 },
  { pulses: 7, offset: 25 },
];
export const DEFAULT_GROOVE = Object.freeze({ scale: GROOVE.def, at: 0, phase: 0 });

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const patternOf = (slot) => PATTERNS[((Number(slot) | 0) % PATTERNS.length + PATTERNS.length) % PATTERNS.length];

// A scale from anyone (slider, key, the network): clamped, 4 significant digits. null = not a number.
export function cleanScale(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!isNum(n) || n <= 0) return null;
  const c = Math.min(GROOVE.max, Math.max(GROOVE.min, n));
  return Math.min(GROOVE.max, Math.max(GROOVE.min, Number(c.toPrecision(4))));
}
export function cleanGroove(g) {
  if (!g || typeof g !== 'object') return { ...DEFAULT_GROOVE };
  const scale = cleanScale(g.scale) ?? GROOVE.def;
  const at = isNum(g.at) ? Math.round(g.at) : 0;
  const phase = isNum(g.phase) ? ((g.phase % 1) + 1) % 1 : 0;
  return { scale, at, phase: Number(phase.toFixed(6)) };
}
export const barMs = (scale) => GROOVE.barMs * (cleanScale(scale) ?? GROOVE.def);
// Where in the bar (in bars, not wrapped) the groove is at wall-clock time t (ms).
export function barsAt(g, t) { return g.phase + (t - g.at) / barMs(g.scale); }
// The phase (0…1) at time t.
export function phaseAt(g, t) { const b = barsAt(g, t); return ((b % 1) + 1) % 1; }
// The room's new state when the scale changes at time now: same phase, new tempo.
export function retime(g, scale, now) {
  const old = cleanGroove(g), s = cleanScale(scale) ?? old.scale;
  return { scale: s, at: Math.round(now), phase: Number(phaseAt(old, Math.round(now)).toFixed(6)) };
}

// One slot's pulses with from ≤ t < to (ms). Each: { t (ms), n (pulse number, for left/right
// foot), tick (0…ticks-1 on the shared bar), slot }. Deterministic: the same on every client.
export function eventsBetween(g, slot, from, to, { max = 256 } = {}) {
  const st = cleanGroove(g), pat = patternOf(slot), B = barMs(st.scale), off = pat.offset / GROOVE.ticks;
  const out = []; if (!(to > from)) return out;
  // pulse g sits at bar position x = off + n / pulses
  const first = Math.ceil((barsAt(st, from) - off) * pat.pulses - 1e-9);
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
// The ticks a slot plays in one bar (for tests and the readout).
export const ticksOf = (slot) => { const p = patternOf(slot); return Array.from({ length: p.pulses }, (_, i) => (p.offset + i * GROOVE.ticks / p.pulses) % GROOVE.ticks); };
// ms between one slot's pulses at this scale.
export const pulseMs = (scale, slot) => barMs(scale) / patternOf(slot).pulses;
export const buzzes = (scale, slot) => pulseMs(scale, slot) < GROOVE.buzzMs;

// Slider 0…sliderSteps ↔ scale (log). 1.0× sits at 6/9 of the way (min 1/64 = 2^-6, max 8 = 2^3).
const LO = Math.log2(GROOVE.min), HI = Math.log2(GROOVE.max);
export function scaleToSlider(scale) { const s = cleanScale(scale) ?? GROOVE.def; return Math.round(GROOVE.sliderSteps * (Math.log2(s) - LO) / (HI - LO)); }
export function sliderToScale(x) { const k = Math.min(1, Math.max(0, Number(x) / GROOVE.sliderSteps || 0)); return cleanScale(Math.pow(2, LO + k * (HI - LO))); }
// [ / ]: dir −1 = tighter (faster), +1 = looser (slower). big (Shift): a whole octave.
export function stepScale(scale, dir, big = false) { return cleanScale((cleanScale(scale) ?? GROOVE.def) * Math.pow(big ? 2 : GROOVE.keyStep, Math.sign(dir))); }
// "1.00×", "0.016×", "8.00×" and the bar length ("1.5 s", "23 ms").
export function grooveLabel(scale) {
  const s = cleanScale(scale) ?? GROOVE.def, b = barMs(s);
  const x = s >= 0.1 ? s.toFixed(2) : s.toPrecision(2);
  return { scale: `${x}×`, bar: b >= 1000 ? `${(b / 1000).toFixed(b >= 10000 ? 0 : 1)} s` : `${Math.round(b)} ms` };
}

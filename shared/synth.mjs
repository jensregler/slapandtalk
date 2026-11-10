import { cleanMods } from './lfo.mjs';
import { cleanSeq, visibleSteps } from './autoslap.mjs';
// Synth patches and effects as plain JSON – shared by the browser (client/src/synth.js plays
// them with Tone.js) and the server (which clamps whatever players send before others hear it).
//
// A PATCH is { v: 1, gain, layers: [LAYER, …] } (at most SYNTH.maxLayers layers).
// A LAYER is one oscillator or noise voice with its own envelope, filter and LFO:
//   kind 'osc' | 'noise'      wave sine|square|sawtooth|triangle   noise white|pink
//   freq (Hz, where the pitch ends up)  detune (cents)  unison 1–5 + spread (cents)  sub (level, −1 octave sine)
//   pitchAmt (semitones above/below freq at the start) + pitchTime (s): the pitch sweep/envelope
//   a, d, s, r (ADSR) + hold (s the gate is held before release)
//   filter lowpass|highpass|bandpass + cutoff, q, fEnv (octaves the cutoff sweeps) + fTime (s)
//   lfo none|pitch|cutoff|amp + lfoWave, lfoRate (Hz), lfoDepth (0–1)
//   level (mix), drive (0–1 waveshaper), delay (s after the trigger)
// FX is { reverb: {decay, preDelay, wet}, delay: {time, sync, feedback, wet, pingPong},
//         crush: {bits, wet}, dist: {amount, wet}, filter: {type, cutoff, q, wet} }.
// Everything is clamped to the ranges below; unknown keys are dropped.
//
// Layer type 'sampler' (Jens, 5 Nov 2026): plays a loaded audio file instead of an oscillator or
// noise. Extra keys ONLY on sampler layers (osc/noise layers look exactly as before):
//   sample (sha-256 hex of the stored WAV, '' = none yet)  name (file name, display)  len (s, the sample)
//   note + root (MIDI): played at 2^((note − root)/12) × freq/440 – root = the note the recording is in
//   (default C4 = 60), freq stays 440 unless the sound is retuned (duff, the per-play wobble)
//   whole (true = one-shot: the gate lasts the whole sample (start→end); false = gate: the envelope decides)
//   start, end (0–1 of the sample)  reverse  loop + loopStart, loopEnd (0–1) + xfade (s, crossfaded loop seam)
//   pan (−1…1)  poly (how many of this sample may ring at once; the oldest is cut)
// Decimation on ANY layer (sample-and-hold downsampler, client/src/decimator.js – an AudioWorklet):
//   decim (hold every input sample for N samples, 1 = off) + crush (bits, 0 = off). Like the sampler
//   keys these only appear when used, so an old patch's JSON is exactly what it was.
// Sequencer layer (any kind) – seq: { len 1–16, bars (loop length in master-clock bars), steps:
//   [{ on, vol 0–100 }] } (the step schema of the old auto-slap sequencer, shared/autoslap.mjs). A
//   layer with seq does not play on the one-shot trigger: it RUNS on the master clock (90 BPM,
//   shared/clock.mjs) while my radio is on – layers with different lengths make the polyrhythm.
// Pitch grid: the pitch controls (osc Pitch, sampler Note/Root) move in equal-tempered semitones
//   (A4 = 440 Hz); a morph lands on the grid too (snapFreq). LFOs and the per-play wobble still bend
//   between grid points (vibrato stays natural). Saved values are never moved by loading.
// The audio itself never goes in the patch: it is kept on this device (client/src/samples.js).
// A patch may also carry mods (shared/lfo.mjs: up to 16 nested LFOs) and morph (0–1, see morphPatch).

export const SOUNDS = ['slap', 'peel', 'step', 'duff']; // duff = peel landing thud (+ four voices Low)
export const SOUND_TABS = ['slap', 'peel', 'step', 'duff']; // sound-settings UI (Landing = duff = peel landing thud; Effects still city-driven, not a tab)
export const WAVES = ['sine', 'square', 'sawtooth', 'triangle'];
export const NOISES = ['white', 'pink'];
export const FILTERS = ['lowpass', 'highpass', 'bandpass'];
export const LFO_TARGETS = ['none', 'pitch', 'cutoff', 'amp'];
export const SYNCS = ['free', '1/4', '1/8', '1/8d', '1/16', '1/4t'];

export const SYNTH = {
  maxLayers: 4,
  maxPatchBytes: 6000,   // one patch as JSON (room for a sampler layer and 16 LFOs)
  maxSoundBytes: 40000,  // (was 20000 before sampler/LFO/follower layers) all of a player's patches + fx as JSON (kept on this device; others only get the seed)
  bpm: 90,               // tempo the delay "sync" values refer to (= the master clock, shared/clock.mjs)
  seqLens: [3, 4, 5, 6, 7, 8, 12, 16], seqMax: 16, seqBars: [0.25, 0.5, 1, 2, 4],
  // [min, max, step]
  layer: {
    freq: [20, 8000, 0.01], detune: [-1200, 1200, 1], unison: [1, 5, 1], spread: [0, 100, 1], sub: [0, 1, 0.01],
    pitchAmt: [-48, 48, 0.1], pitchTime: [0.001, 2, 0.001],
    a: [0.001, 2, 0.001], d: [0.001, 3, 0.001], s: [0, 1, 0.01], r: [0.001, 3, 0.001], hold: [0, 3, 0.001],
    cutoff: [20, 18000, 1], q: [0.1, 30, 0.1], fEnv: [-8, 8, 0.01], fTime: [0.001, 3, 0.001],
    lfoRate: [0.1, 80, 0.1], lfoDepth: [0, 1, 0.01],
    level: [0, 1, 0.01], drive: [0, 1, 0.01], delay: [0, 1, 0.001],
  },
  sampler: { note: [24, 108, 1], root: [24, 108, 1], len: [0, 10, 0.001], start: [0, 1, 0.001], end: [0, 1, 0.001],
    loopStart: [0, 1, 0.001], loopEnd: [0, 1, 0.001], xfade: [0, 0.5, 0.001], pan: [-1, 1, 0.01], poly: [1, 8, 1] },
  decim: [1, 64, 1],     // sample-and-hold: 1 = off, 8 = an eighth of the sample rate (≈ 6 kHz at 48 kHz)
  crush: [0, 16, 1],     // bit depth (0 = off)
  samplerRef: 440,       // a sampler layer's freq at "no retune"
  maxSampleSeconds: 10,  // longer files are cut to this when loaded
  morph: [0, 1, 0.01],
  enums: { kind: ['osc', 'noise', 'sampler', 'mic'], wave: WAVES, noise: NOISES, filter: FILTERS, lfo: LFO_TARGETS, lfoWave: WAVES },
  gain: [0, 1.5, 0.01],
  fx: {
    reverb: { decay: [0.1, 12, 0.1], preDelay: [0, 0.5, 0.001], wet: [0, 1, 0.01] },
    delay: { time: [0.01, 1.5, 0.001], feedback: [0, 0.95, 0.01], wet: [0, 1, 0.01] },
    crush: { bits: [1, 16, 1], wet: [0, 1, 0.01] },
    dist: { amount: [0, 1, 0.01], wet: [0, 1, 0.01] },
    filter: { cutoff: [20, 18000, 1], q: [0.1, 30, 0.1], wet: [0, 1, 0.01] },
  },
};

const LAYER_DEFAULTS = {
  kind: 'osc', wave: 'sine', noise: 'white', freq: 220, detune: 0, unison: 1, spread: 0, sub: 0,
  pitchAmt: 0, pitchTime: 0.05, a: 0.003, d: 0.1, s: 0, r: 0.05, hold: 0,
  filter: 'lowpass', cutoff: 18000, q: 0.7, fEnv: 0, fTime: 0.1,
  lfo: 'none', lfoWave: 'sine', lfoRate: 5, lfoDepth: 0, level: 0.5, drive: 0, delay: 0,
};
export const FX_DEFAULTS = {
  reverb: { decay: 1.5, preDelay: 0.01, wet: 0 },
  delay: { time: 0.25, sync: 'free', feedback: 0.3, wet: 0, pingPong: false },
  crush: { bits: 8, wet: 0 },
  dist: { amount: 0.3, wet: 0 },
  filter: { type: 'lowpass', cutoff: 18000, q: 0.7, wet: 0 },
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export function clampTo(v, [min, max, step], fallback) {
  if (!isNum(v)) return fallback;
  const c = Math.min(max, Math.max(min, v));
  const n = Math.round(c / step) * step;
  return Number(Math.min(max, Math.max(min, n)).toFixed(4));
}

export function cleanLayer(l) {
  if (!l || typeof l !== 'object' || Array.isArray(l)) return null;
  const out = {};
  for (const [k, list] of Object.entries(SYNTH.enums)) out[k] = list.includes(l[k]) ? l[k] : LAYER_DEFAULTS[k];
  for (const [k, range] of Object.entries(SYNTH.layer)) out[k] = clampTo(l[k], range, k === 'freq' && out.kind === 'sampler' ? SYNTH.samplerRef : LAYER_DEFAULTS[k]);
  if (out.kind === 'sampler') {
    out.note = clampTo(l.note, SYNTH.sampler.note, 60); out.root = clampTo(l.root, SYNTH.sampler.root, 60);
    out.len = clampTo(l.len, SYNTH.sampler.len, 0);
    out.sample = typeof l.sample === 'string' && /^[a-f0-9]{64}$/.test(l.sample) ? l.sample : '';
    out.name = typeof l.name === 'string' ? l.name.replace(/[\u0000-\u001f<>]/g, '').slice(0, 40) : '';
    out.whole = l.whole !== false;
    const S2 = SYNTH.sampler;
    out.start = clampTo(l.start, S2.start, 0); out.end = clampTo(l.end, S2.end, 1);
    if (out.end <= out.start) { out.start = 0; out.end = 1; }
    out.reverse = l.reverse === true; out.loop = l.loop === true;
    out.loopStart = clampTo(l.loopStart, S2.loopStart, out.start); out.loopEnd = clampTo(l.loopEnd, S2.loopEnd, out.end);
    if (out.loopEnd <= out.loopStart) { out.loopStart = out.start; out.loopEnd = out.end; }
    out.xfade = clampTo(l.xfade, S2.xfade, 0); out.pan = clampTo(l.pan, S2.pan, 0); out.poly = clampTo(l.poly, S2.poly, 4);
  }
  if (l.seq && typeof l.seq === 'object') out.seq = cleanLayerSeq(l.seq);
  const dc = clampTo(l.decim, SYNTH.decim, 1), cb = clampTo(l.crush, SYNTH.crush, 0);
  if (dc > 1) out.decim = dc;
  if (cb > 0) out.crush = cb;
  return out;
}
// A sequencer layer's steps: { len, bars, steps: [{ on, vol }] × len } (stored compact: only len steps).
export function cleanLayerSeq(q) {
  const len = Math.min(SYNTH.seqMax, Math.max(1, Math.round(isNum(q.len) ? q.len : 8)));
  const c = cleanSeq({ len, steps: Array.isArray(q.steps) ? q.steps : [] });
  return { len, bars: SYNTH.seqBars.includes(q.bars) ? q.bars : 1, steps: visibleSteps(c).slice(0, len) };
}
// The semitone grid (A4 = 440 Hz).
export const snapFreq = (hz) => (isNum(hz) && hz > 0 ? Number((440 * Math.pow(2, Math.round(12 * Math.log2(hz / 440)) / 12)).toFixed(2)) : hz);
// A sampler layer's playback rate (pitch ratio): note vs root, times any retune carried in freq.
export function samplerRate(l) {
  return Math.pow(2, ((l.note ?? 60) - (l.root ?? 60)) / 12) * ((l.freq || SYNTH.samplerRef) / SYNTH.samplerRef);
}
// How long a sampler layer's gate is held (s): the whole (pitched) sample, or the envelope as usual.
export function samplerGate(l) {
  if (!l.whole || l.loop) return null; // gate mode / looping: the envelope decides
  const part = Math.max(0, (l.end ?? 1) - (l.start ?? 0));
  return Math.min(SYNTH.maxSampleSeconds, ((l.len || 0) * part) / samplerRate(l));
}
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (m) => `${NOTE_NAMES[((Math.round(m) % 12) + 12) % 12]}${Math.floor(Math.round(m) / 12) - 1}`;
export function cleanPatch(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.layers)) return null;
  const layers = p.layers.slice(0, SYNTH.maxLayers).map(cleanLayer).filter(Boolean);
  if (!layers.length) return null;
  const out = { v: 1, gain: clampTo(p.gain, SYNTH.gain, 1), layers };
  if (p.fx) { const fx = cleanFx(p.fx); if (fx) out.fx = fx; } // this sound's own effects (else the player's)
  if (p.mods) { const mods = cleanMods(p.mods, layers); if (mods.length) out.mods = mods; } // LFOs (shared/lfo.mjs)
  return JSON.stringify(out).length <= SYNTH.maxPatchBytes ? out : null;
}
export function cleanFx(fx) {
  if (!fx || typeof fx !== 'object' || Array.isArray(fx)) return null;
  const out = {};
  for (const [unit, ranges] of Object.entries(SYNTH.fx)) {
    const src = fx[unit] && typeof fx[unit] === 'object' ? fx[unit] : {};
    const u = {};
    for (const [k, range] of Object.entries(ranges)) u[k] = clampTo(src[k], range, FX_DEFAULTS[unit][k]);
    if (unit === 'delay') { u.sync = SYNCS.includes(src.sync) ? src.sync : 'free'; u.pingPong = src.pingPong === true; }
    if (unit === 'filter') u.type = FILTERS.includes(src.type) ? src.type : 'lowpass';
    out[unit] = u;
  }
  return out;
}
// look.sound = { seed, patches?: { slap: PATCH, … }, fx?: FX }. seed is a short random id kept
// in the browser: it picks the player's own variation of the default sounds (no patches needed).
// patches/fx are only kept when `custom` is true (the player has the soundDesign entitlement).
export function cleanSound(s, { custom = false } = {}) {
  if (!s || typeof s !== 'object') return null;
  const out = {};
  if (typeof s.seed === 'string' && /^[A-Za-z0-9_-]{4,24}$/.test(s.seed)) out.seed = s.seed;
  if (custom) {
    const patches = {};
    if (s.patches && typeof s.patches === 'object') for (const k of SOUNDS) { const p = cleanPatch(s.patches[k]); if (p) patches[k] = p; }
    if (Object.keys(patches).length) out.patches = patches;
    const fx = cleanFx(s.fx); if (fx) out.fx = fx;
    if (JSON.stringify(out).length > SYNTH.maxSoundBytes) { delete out.patches; delete out.fx; }
  }
  return Object.keys(out).length ? out : null;
}
// Does the raw look carry custom sound data (that needs the entitlement)?
export const hasCustomSound = (s) => !!(s && typeof s === 'object' && (s.patches || s.fx));

// ---------- The default sounds (ports of the original hand-written Web Audio sounds) ----------
const L = (o) => cleanLayer({ ...LAYER_DEFAULTS, ...o });
const st = (from, to) => +(12 * Math.log2(from / to)).toFixed(1);
export const DEFAULT_PATCHES = {
  // thwack: bright band-passed noise + a low sine thump dropping 190→70 Hz + a sticky smack tail
  slap: { v: 1, gain: 0.9, layers: [ // (gain 0.9: a little headroom so no player's variation clips)
    L({ kind: 'noise', filter: 'bandpass', cutoff: 1800, q: 0.8, a: 0.003, d: 0.107, level: 0.75 }),
    L({ kind: 'osc', wave: 'sine', freq: 70, pitchAmt: st(190, 70), pitchTime: 0.08, a: 0.004, d: 0.096, level: 0.68 }),
    L({ kind: 'noise', filter: 'bandpass', cutoff: 4200, q: 2, a: 0.004, d: 0.044, level: 0.19, delay: 0.012 }),
  ] },
  // rrrip: noise through a band-pass sweeping 700→3200 Hz, chopped by a 38 Hz square (crackle)
  peel: { v: 1, gain: 1, layers: [
    L({ kind: 'noise', filter: 'bandpass', cutoff: 700, q: 3, fEnv: +Math.log2(3200 / 700).toFixed(2), fTime: 0.26,
      a: 0.03, d: 0.001, s: 1, hold: 0.18, r: 0.08, lfo: 'amp', lfoWave: 'square', lfoRate: 38, lfoDepth: 0.45, level: 0.45 }),
  ] },
  // footstep: a soft, low, short scuff (quiet)
  step: { v: 1, gain: 1, layers: [
    L({ kind: 'noise', noise: 'pink', filter: 'lowpass', cutoff: 520, q: 0.7, fEnv: -1, fTime: 0.05, a: 0.002, d: 0.055, level: 0.16 }),
    L({ kind: 'osc', wave: 'sine', freq: 85, pitchAmt: 7, pitchTime: 0.04, a: 0.002, d: 0.05, level: 0.12 }),
  ] },
  // duff: the backing paper landing flat – a soft papery thud (scaled by area, see duffScale)
  duff: { v: 1, gain: 1, layers: [
    L({ kind: 'noise', noise: 'pink', filter: 'lowpass', cutoff: 900, q: 0.8, fEnv: -1.5, fTime: 0.12, a: 0.004, d: 0.13, level: 0.32 }),
    L({ kind: 'osc', wave: 'sine', freq: 62, pitchAmt: 6, pitchTime: 0.06, a: 0.003, d: 0.11, level: 0.26 }),
  ] },
};

// ---------- Deterministic per-player variation ----------
export function hashSeed(str) { // FNV-1a → uint32
  let h = 2166136261 >>> 0; const s = String(str || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
export function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Tasteful bounds: pitch ±7 %, brightness ±15 %, length ±12 %, resonance ±15 %.
export const VARIATION = { pitch: 0.07, bright: 0.15, length: 0.12, q: 0.15 };
export function variant(patch, seed, sound = '') {
  const p = cleanPatch(patch); if (!p || !seed) return p;
  const r = rng(hashSeed(seed + ':' + sound));
  const k = (amt) => 1 + (r() * 2 - 1) * amt;
  const pitch = k(VARIATION.pitch), bright = k(VARIATION.bright), len = k(VARIATION.length), q = k(VARIATION.q);
  return cleanPatch({ ...p, layers: p.layers.map((l) => ({
    ...l, freq: l.freq * pitch, cutoff: l.cutoff * bright * pitch, q: l.q * q,
    d: l.d * len, r: l.r * len, hold: l.hold * len, lfoRate: l.lfoRate * pitch,
  })) });
}

// ---------- Slot colours: up to five people in a room sound distinct ----------
// Each player in a room has a slot (0, 1, 2 … from the server). The slot gives their footsteps,
// peels (the drag), slaps and duffs a colour: a pitch step and a filter tilt, far enough apart that
// five people are told apart by ear, small enough to stay calm. Slot 0 = the plain default.
//   pitch: ratio on every oscillator and filter · bright: extra ratio on the filters only
export const SLOT_COLOURS = [
  { name: 'plain', pitch: 1, bright: 1 },
  { name: 'warm', pitch: 0.84, bright: 0.78 },   // −3 semitones, darker
  { name: 'light', pitch: 1.19, bright: 1.28 },  // +3 semitones, brighter
  { name: 'deep', pitch: 0.75, bright: 0.66 },   // −5 semitones, darkest
  { name: 'airy', pitch: 1.33, bright: 1.5 },    // +5 semitones, brightest
];
export const COLOURED = ['slap', 'peel', 'step', 'duff'];
export const slotColour = (slot) => SLOT_COLOURS[((Number(slot) | 0) % SLOT_COLOURS.length + SLOT_COLOURS.length) % SLOT_COLOURS.length];
export function colourPatch(patch, slot, sound = '') {
  const c = slotColour(slot);
  if (!patch || (c.pitch === 1 && c.bright === 1) || (sound && !COLOURED.includes(sound))) return patch;
  return cleanPatch({ ...patch, layers: patch.layers.map((l) => ({ ...l, freq: l.freq * c.pitch, cutoff: l.cutoff * c.pitch * c.bright })) });
}

// ---------- Size → loudness / pitch (duff + slap + peel) ----------
// Pitch follows the sticker's size (longest side, m). The curve (Jens, 10 Nov 2026, t785u): the old
// 10 cm pitch (×1.485) down to the old 1.5 m pitch (×0.56), stretched log-linearly over 10 cm → 4 m:
// rate = hi · (lo / hi)^(ln(side / refM) / ln(maxM / refM)). Bigger = lower; smaller = higher.
// Jens, 10 Nov 2026 (t788u): "vi stannar ljudet vid 4m … pitch mellan 0,15 och 4 m" – the size fed in
// is clamped to 15 cm – 4 m (the graphic itself has no min or max since 11 Nov 2026): a sticker over 4 m
// still plays, at the 4 m pitch (×0.56); one under 15 cm plays at the 15 cm pitch (×1.334, the curve is
// not re-stretched) – never 0 Hz, never ∞.
// Used by the slap, the peel (pulling a sticker off) and the backing paper's landing (duff).
export const SIZE_PITCH = Object.freeze({ minM: 0.15, maxM: 4.0, refM: 0.10, hi: 1.485, lo: 0.56 });
export function sizeRate(side) {
  const { minM, maxM, refM, hi, lo } = SIZE_PITCH;
  const s = Math.max(minM, Math.min(maxM, isNum(side) && side > 0 ? side : 0.3));
  const t = Math.log(s / refM) / Math.log(maxM / refM);
  return +(hi * Math.pow(lo / hi, t)).toFixed(3);
}
// Loudness: area in m² (w × h of the peel / sticker). Reference: a 30 × 30 cm sticker (0.09 m²) → gain 1.
// Bigger = louder; smaller = quieter. Shared by the backing-paper landing (duff) and the slap itself
// (Jens, 6 Nov 2026), so a trapezoid array rises or falls across the row.
// side: the longest side (m) for the pitch; without it the square's side (√area).
export function duffScale(area, side = null) {
  const raw = isNum(area) && area > 0 ? area : 0.09;
  const a = Math.max(0.0004, Math.min(16, raw));
  const gain = Math.min(2, Math.max(0.15, Math.pow(a / 0.09, 0.35)));
  const rate = sizeRate(isNum(side) && side > 0 ? side : Math.sqrt(raw));
  return { gain: +gain.toFixed(3), rate };
}
// Slap: same curve. Pass the sticker's area (w × h), or its longest side in metres (treated as square).
export function slapScale(sizeOrArea, asArea = false) {
  if (asArea) return duffScale(sizeOrArea);
  const s = isNum(sizeOrArea) && sizeOrArea > 0 ? sizeOrArea : 0.3;
  return duffScale(s * s, s);
}
// Scale a patch's pitch (and filter) by rate – used for duff and the small per-play wobble.
export function retune(patch, rate) {
  if (!patch || rate === 1) return patch;
  return { ...patch, layers: patch.layers.map((l) => ({ ...l, freq: Math.min(8000, l.freq * rate), cutoff: Math.min(18000, l.cutoff * rate) })) };
}

// ---------- Free version: automatic room acoustics from the room's materials ----------
// Subtle on purpose: tile walls ring a little, a concrete floor very discreetly, the rest is dry.
export const ACOUSTICS = {
  wall: { kakel: 0.09, betong: 0.05, klinker: 0.04, puts: 0.02, tegel: 0.02, malat: 0.01 },
  floor: { betong: 0.035, klinker: 0.03, kakel: 0.03, linoleum: 0.01, asfalt: 0.01 },
  ceiling: { betong: 0.02 },
  maxWet: 0.12,
};
export function roomAcoustics(style) {
  const s = style || {};
  const wet = (ACOUSTICS.wall[s.wall] || 0) + (ACOUSTICS.floor[s.floor] || 0) + (ACOUSTICS.ceiling[s.ceiling] || 0);
  const w = Math.min(ACOUSTICS.maxWet, wet);
  // Hard tile rings a bit longer than plaster; still a small room.
  const decay = s.wall === 'kakel' ? 1.3 : s.floor === 'betong' || s.wall === 'betong' ? 1.0 : 0.7;
  return { reverb: { decay: w ? decay : 0.7, preDelay: 0.008, wet: +w.toFixed(3) } };
}

// ---------- Randomize (paid editor) ----------
const pickOf = (r, list) => list[Math.floor(r() * list.length)];
const between = (r, [min, max], curve = 1) => min + Math.pow(r(), curve) * (max - min);
export function randomPatch(seed, { wild = false } = {}) {
  const r = rng(hashSeed('patch:' + seed));
  const n = 1 + Math.floor(r() * (wild ? 4 : 2));
  const layers = [];
  for (let i = 0; i < n; i++) {
    const noise = r() < 0.45;
    layers.push(cleanLayer({
      kind: noise ? 'noise' : 'osc', wave: pickOf(r, WAVES), noise: pickOf(r, NOISES),
      freq: between(r, [40, wild ? 4000 : 1200], 2), detune: wild ? between(r, [-100, 100]) : 0,
      unison: wild ? 1 + Math.floor(r() * 4) : 1, spread: between(r, [0, 40]), sub: r() < 0.3 ? between(r, [0, 0.6]) : 0,
      pitchAmt: between(r, wild ? [-36, 36] : [-12, 18]), pitchTime: between(r, [0.01, wild ? 0.8 : 0.2], 2),
      a: between(r, [0.001, wild ? 0.2 : 0.02], 3), d: between(r, [0.03, wild ? 0.9 : 0.3], 2), s: wild && r() < 0.4 ? r() * 0.6 : 0,
      r: between(r, [0.02, 0.3]), hold: wild ? between(r, [0, 0.4], 2) : 0,
      filter: pickOf(r, FILTERS), cutoff: between(r, [300, 12000], 2), q: between(r, [0.5, wild ? 18 : 4]),
      fEnv: between(r, [-3, 3]), fTime: between(r, [0.02, 0.5]),
      lfo: wild || r() < 0.3 ? pickOf(r, LFO_TARGETS) : 'none', lfoWave: pickOf(r, WAVES), lfoRate: between(r, [0.5, wild ? 70 : 20], 2), lfoDepth: between(r, [0, wild ? 1 : 0.4]),
      level: between(r, [0.12, 0.4]), drive: wild ? between(r, [0, 1]) : 0, delay: i && r() < 0.4 ? between(r, [0, 0.15]) : 0,
    }));
  }
  return cleanPatch({ v: 1, gain: 1, layers });
}
export function randomFx(seed, { wild = false } = {}) {
  const r = rng(hashSeed('fx:' + seed));
  return cleanFx({
    reverb: { decay: between(r, [0.3, wild ? 10 : 3]), preDelay: between(r, [0, 0.08]), wet: between(r, [0, wild ? 0.8 : 0.3]) },
    delay: { time: between(r, [0.05, 0.7]), sync: pickOf(r, SYNCS), feedback: between(r, [0, wild ? 0.9 : 0.5]), wet: between(r, [0, wild ? 0.7 : 0.25]), pingPong: r() < 0.5 },
    crush: { bits: Math.round(between(r, [2, 12])), wet: wild ? between(r, [0, 1]) : 0 },
    dist: { amount: between(r, [0, 1]), wet: wild ? between(r, [0, 0.9]) : 0 },
    filter: { type: pickOf(r, FILTERS), cutoff: between(r, [200, 16000], 2), q: between(r, [0.5, wild ? 20 : 3]), wet: wild ? between(r, [0, 1]) : 0 },
  });
}
// Delay time in seconds from the sync choice.
export function delaySeconds(d, bpm = SYNTH.bpm) {
  const beat = 60 / bpm;
  switch (d.sync) {
    case '1/4': return beat; case '1/8': return beat / 2; case '1/8d': return beat * 0.75;
    case '1/16': return beat / 4; case '1/4t': return beat * 2 / 3; default: return d.time;
  }
}
// How long a patch rings (s), for voice bookkeeping and offline rendering.
export function patchLength(p) {
  return Math.max(0.05, ...p.layers.map((l) => { const g = l.kind === 'sampler' ? samplerGate(l) : null; return l.delay + l.a + (g != null ? g : Math.max(l.d, l.hold)) + l.r; }));
}

// ---------- Morph (Jens, 5 Nov 2026): original sound (t = 0) ↔ my settings (t = 1) ----------
// Numbers glide (log for frequencies and times, linear for the rest), choices (wave, layer type,
// filter type, on/off) flip at the middle, layers or LFOs that only one side has fade in/out.
// Layers pair up by position, LFOs by id. t = 0 gives a, t = 1 gives b exactly.
export const MORPH_LOG = new Set(['freq', 'cutoff', 'lfoRate', 'a', 'd', 'r', 'pitchTime', 'fTime', 'q', 'rate', 'decay', 'time']);
const lerp = (k, x, y, t) => {
  if (x === y) return x;
  if (MORPH_LOG.has(k) && x > 0 && y > 0) return x * Math.pow(y / x, t);
  return x + (y - x) * t;
};
function morphObj(a, b, t, skip = new Set()) {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (skip.has(k)) continue;
    const x = a[k], y = b[k];
    if (!(k in b)) { if (t < 0.5) out[k] = x; continue; }
    if (!(k in a)) { if (t >= 0.5) out[k] = y; continue; }
    if (typeof x === 'number' && typeof y === 'number') out[k] = lerp(k, x, y, t);
    else if (k === 'seq' || k === 'steps') out[k] = t < 0.5 ? x : y; // a step pattern flips at the middle
    else if (x && y && typeof x === 'object' && typeof y === 'object') out[k] = morphObj(x, y, t);
    else out[k] = t < 0.5 ? x : y;
  }
  return out;
}
// t in (1, 2] = SEEK beyond my preset (Jens, 5 Nov 2026: the radio knob twists ALL the variables on
// toward 'the next value'): every number that differs keeps going along the same line (log for
// frequencies/times), clamped to its legal range by cleanPatch; pitch snaps to the grid; choices
// and one-sided layers/LFOs stay as in my preset. Loudness is NOT extrapolated – patch gain and
// layer levels stay at the preset's (the volume is separate from the knob).
export const MORPH_MAX = 2;
export function morphPatch(a0, b0, t) {
  const a = cleanPatch(a0), b = cleanPatch(b0);
  if (!a || !b) return b || a;
  t = Math.min(MORPH_MAX, Math.max(0, isNum(t) ? t : 1));
  if (t === 1) return b;
  if (t <= 0) return a;
  const tl = Math.min(1, t); // levels/gain/depth of one-sided things: no further than the preset
  const n = Math.max(a.layers.length, b.layers.length), layers = [];
  for (let i = 0; i < n; i++) {
    const x = a.layers[i], y = b.layers[i];
    if (x && y) {
      const l = morphObj(x, y, t, new Set(['level']));
      l.level = x.level + (y.level - x.level) * tl;
      if (x.freq !== y.freq) l.freq = snapFreq(l.freq);                 // pitch lands on the grid
      if (l.note != null && x.note !== y.note) l.note = Math.round(l.note);
      // kind flips at the middle: keep the sampler keys of whichever side is playing
      const SK = ['note', 'root', 'len', 'sample', 'name', 'whole', 'start', 'end', 'reverse', 'loop', 'loopStart', 'loopEnd', 'xfade', 'pan', 'poly'];
      if (l.kind !== 'sampler') for (const k of SK) delete l[k];
      else if (x.kind !== y.kind) { const s = y.kind === 'sampler' ? y : x; for (const k of SK) l[k] = s[k]; }
      else if (x.sample !== y.sample) { const s = t < 0.5 ? x : y; for (const k of ['sample', 'name', 'len']) l[k] = s[k]; }
      // decimation: a side without it counts as off (decim 1, crush 0)
      if (x.decim || y.decim) l.decim = lerp('decim', x.decim || 1, y.decim || 1, t);
      if (x.crush || y.crush) l.crush = t < 0.5 ? (x.crush || 0) : (y.crush || 0);
      layers.push(l);
    } else if (x) { if (t < 1) layers.push({ ...x, level: x.level * (1 - t) }); }
    else layers.push({ ...y, level: y.level * tl });
  }
  const fxOf = (p) => p.fx || cleanFx(FX_DEFAULTS);
  const out = { v: 1, gain: a.gain + (b.gain - a.gain) * tl, layers };
  if (a.fx || b.fx) out.fx = morphObj(fxOf(a), fxOf(b), t);
  const am = a.mods || [], bm = b.mods || [];
  if (am.length || bm.length) {
    const mods = [];
    for (const id of new Set([...am.map((m) => m.id), ...bm.map((m) => m.id)])) {
      const x = am.find((m) => m.id === id), y = bm.find((m) => m.id === id);
      if (x && y && x.to === y.to) mods.push({ ...morphObj(x, y, t, new Set(['depth'])), depth: x.depth + (y.depth - x.depth) * t });
      else { if (x && t < 1) mods.push({ ...x, depth: x.depth * (1 - t) }); if (y) mods.push({ ...y, id: x && t < 1 ? nextFreeId(am, bm, mods) : y.id, depth: y.depth * tl }); }
    }
    out.mods = mods;
  }
  return cleanPatch(out) || b;
}
function nextFreeId(...lists) { const used = new Set(lists.flat().map((m) => m.id)); for (let i = 1; i < 100; i++) if (!used.has('m' + i)) return 'm' + i; return 'm99'; }
// Every setting that differs between two patches: ['gain', 'L0.cutoff', 'L1.kind', 'L2 (added)', 'fx.reverb.wet', 'm1.rate', …]
export function diffPatch(a0, b0) {
  const a = cleanPatch(a0), b = cleanPatch(b0); if (!a || !b) return [];
  const out = [];
  const walk = (x, y, pre) => {
    for (const k of new Set([...Object.keys(x || {}), ...Object.keys(y || {})])) {
      const u = x?.[k], v = y?.[k];
      if (u && v && typeof u === 'object') walk(u, v, `${pre}${k}.`);
      else if (u !== v) out.push(pre + k);
    }
  };
  if (a.gain !== b.gain) out.push('gain');
  for (let i = 0; i < Math.max(a.layers.length, b.layers.length); i++) {
    if (!a.layers[i]) out.push(`L${i} (added)`); else if (!b.layers[i]) out.push(`L${i} (removed)`); else walk(a.layers[i], b.layers[i], `L${i}.`);
  }
  if (a.fx || b.fx) walk(a.fx || cleanFx(FX_DEFAULTS), b.fx || cleanFx(FX_DEFAULTS), 'fx.');
  const am = a.mods || [], bm = b.mods || [];
  for (const m of bm) { const o = am.find((x) => x.id === m.id); if (!o) out.push(`${m.id} (added)`); else walk(o, m, `${m.id}.`); }
  for (const m of am) if (!bm.some((x) => x.id === m.id)) out.push(`${m.id} (removed)`);
  return out;
}

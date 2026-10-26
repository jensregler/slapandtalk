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

export const SOUNDS = ['slap', 'peel', 'nope', 'step', 'duff']; // (no chat-bubble pop exists, so none is added)
export const WAVES = ['sine', 'square', 'sawtooth', 'triangle'];
export const NOISES = ['white', 'pink'];
export const FILTERS = ['lowpass', 'highpass', 'bandpass'];
export const LFO_TARGETS = ['none', 'pitch', 'cutoff', 'amp'];
export const SYNCS = ['free', '1/4', '1/8', '1/8d', '1/16', '1/4t'];

export const SYNTH = {
  maxLayers: 4,
  maxPatchBytes: 4000,   // one patch as JSON
  maxSoundBytes: 10000,  // all of a player's patches + fx as JSON (look.sound; the WS message cap is 24 kB)
  bpm: 120,              // tempo the delay "sync" values refer to
  // [min, max, step]
  layer: {
    freq: [20, 8000, 1], detune: [-1200, 1200, 1], unison: [1, 5, 1], spread: [0, 100, 1], sub: [0, 1, 0.01],
    pitchAmt: [-48, 48, 0.1], pitchTime: [0.001, 2, 0.001],
    a: [0.001, 2, 0.001], d: [0.001, 3, 0.001], s: [0, 1, 0.01], r: [0.001, 3, 0.001], hold: [0, 3, 0.001],
    cutoff: [20, 18000, 1], q: [0.1, 30, 0.1], fEnv: [-8, 8, 0.01], fTime: [0.001, 3, 0.001],
    lfoRate: [0.1, 80, 0.1], lfoDepth: [0, 1, 0.01],
    level: [0, 1, 0.01], drive: [0, 1, 0.01], delay: [0, 1, 0.001],
  },
  enums: { kind: ['osc', 'noise'], wave: WAVES, noise: NOISES, filter: FILTERS, lfo: LFO_TARGETS, lfoWave: WAVES },
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
  for (const [k, range] of Object.entries(SYNTH.layer)) out[k] = clampTo(l[k], range, LAYER_DEFAULTS[k]);
  return out;
}
export function cleanPatch(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.layers)) return null;
  const layers = p.layers.slice(0, SYNTH.maxLayers).map(cleanLayer).filter(Boolean);
  if (!layers.length) return null;
  const out = { v: 1, gain: clampTo(p.gain, SYNTH.gain, 1), layers };
  if (p.fx) { const fx = cleanFx(p.fx); if (fx) out.fx = fx; } // this sound's own effects (else the player's)
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
  // uh-uh: two short descending square blips through a low-pass
  nope: { v: 1, gain: 1, layers: [
    L({ kind: 'osc', wave: 'square', freq: 290, pitchAmt: st(330, 290), pitchTime: 0.1, filter: 'lowpass', cutoff: 1400, a: 0.01, d: 0.1, level: 0.18 }),
    L({ kind: 'osc', wave: 'square', freq: 200, pitchAmt: st(260, 200), pitchTime: 0.1, filter: 'lowpass', cutoff: 1400, a: 0.01, d: 0.1, level: 0.18, delay: 0.13 }),
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

// ---------- Duff: bigger paper = louder and lower ----------
// area in m² (w × h of the peel). Reference: a 30 × 30 cm sticker (0.09 m²) → gain 1, rate 1.
export function duffScale(area) {
  const a = Math.max(0.0004, Math.min(4, isNum(area) ? area : 0.09));
  const gain = Math.min(2, Math.max(0.15, Math.pow(a / 0.09, 0.35)));
  const rate = Math.min(1.7, Math.max(0.55, Math.pow(0.09 / a, 0.18)));
  return { gain: +gain.toFixed(3), rate: +rate.toFixed(3) };
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
  return Math.max(0.05, ...p.layers.map((l) => l.delay + l.a + Math.max(l.d, l.hold) + l.r));
}

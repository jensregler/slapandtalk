// Noise room lights – the settings model (Jens t892u, 13 Nov 2026): the envelope follower that turns
// speaker A / B into light, and the four ceiling lamps one by one. Pure (no DOM, no THREE): the
// defaults, the ranges the panel shows, clean / JSON in and out, and the envelope maths.
// Used by noisespeakers.js (the lamps) and noiselightsui.js (Esc → LIGHTS). Kept per player in
// localStorage ('klibb.noiseLights'): only you see your own settings.
//
// The defaults are exactly the look before t892u (noisespeakers.js LAMP, t875u):
//   every 33 ms: RMS of the speaker's own signal (before the position gain, 512-sample window),
//   target = min(1, RMS ÷ 0.2), level moves 60 % of the way up / 12 % of the way down per tick
//   (= time constants ≈ 36 ms rise / ≈ 258 ms fall), intensity = normal × (0.35 + (1.5 − 0.35) × level),
//   NW + SW lamps ← A, NE + SE ← B, warm white #fff4e0, decay 1.6, out of the room = normal.

export const LIGHTS_KEY = 'klibb.noiseLights';
export const LIGHTS_VERSION = 1;
export const LAMP_IDS = Object.freeze(['NW', 'NE', 'SW', 'SE']); // ceilingLights() order: [−x −z], [+x −z], [−x +z], [+x +z]
export const LAMP_NAMES = Object.freeze({ NW: 'Back left (west)', NE: 'Back right (east)', SW: 'Front left (west)', SE: 'Front right (east)' });
export const SOURCES = Object.freeze(['A', 'B', 'mix', 'none']);
export const SOURCE_NAMES = Object.freeze({ A: 'Speaker A', B: 'Speaker B', mix: 'A + B (louder)', none: 'None (steady)' });
export const BANDS = Object.freeze(['full', 'low', 'mid', 'high']);
export const BAND_NAMES = Object.freeze({ full: 'Full sound', low: 'Bass (below Hz)', mid: 'Band (around Hz)', high: 'Treble (above Hz)' });
export const WINDOWS = Object.freeze([256, 512, 1024, 2048, 4096]);

// The envelope follower: one for each speaker (A, B), the same settings for both.
// num: [min, max, step, default, unit, label, help]
export const ENV_SPEC = Object.freeze({
  attackMs:  { min: 1, max: 2000, step: 1, def: 36, unit: 'ms', log: true, label: 'Attack (rise)', help: 'How fast the light goes up when the music gets louder.' },
  releaseMs: { min: 5, max: 5000, step: 1, def: 258, unit: 'ms', log: true, label: 'Release (fall)', help: 'How slowly the light fades when the music gets quieter.' },
  holdMs:    { min: 0, max: 2000, step: 5, def: 0, unit: 'ms', label: 'Hold', help: 'Keep the peak this long before the release starts.' },
  smoothMs:  { min: 0, max: 1000, step: 5, def: 0, unit: 'ms', label: 'Extra smoothing', help: 'A soft filter after attack / release. 0 = off.' },
  gainDb:    { min: -24, max: 24, step: 0.5, def: 0, unit: 'dB', label: 'Input gain', help: 'Turns the music up or down before it is measured.' },
  threshold: { min: 0, max: 0.5, step: 0.005, def: 0, unit: 'RMS', label: 'Threshold (floor)', help: 'Quieter than this = no light reaction.' },
  full:      { min: 0.01, max: 1, step: 0.005, def: 0.2, unit: 'RMS', log: true, label: 'Full at (ceiling)', help: 'This loud = brightest. Lower = reacts more.' },
  curve:     { min: 0.2, max: 5, step: 0.05, def: 1, unit: '×', log: true, label: 'Curve', help: '1 = straight. Above 1 = only peaks flash. Below 1 = more glow.' },
  updateMs:  { min: 8, max: 250, step: 1, def: 33, unit: 'ms', label: 'Update every', help: '33 ms ≈ 30 times a second.' },
  bandHz:    { min: 20, max: 16000, step: 1, def: 200, unit: 'Hz', log: true, label: 'Band frequency', help: 'Used when Listen to is not Full sound.' },
  master:    { min: 0, max: 4, step: 0.01, def: 1, unit: '×', label: 'Master brightness', help: 'All four lamps together.' },
  rest:      { min: 0, max: 4, step: 0.01, def: 1, unit: '×', label: 'Brightness outside the room', help: 'The lamps when nobody near hears the music (1 = normal).' },
});
export const ENV_CHOICE = Object.freeze({
  band:   { list: BANDS, def: 'full', label: 'Listen to', names: BAND_NAMES },
  window: { list: WINDOWS, def: 512, label: 'Measure window (samples)', names: null },
});

// One lamp.
export const LAMP_SPEC = Object.freeze({
  min:   { min: 0, max: 5, step: 0.01, def: 0.35, unit: '×', label: 'Min brightness (silence)', help: '× the lamp\'s normal light when the music is silent.' },
  max:   { min: 0, max: 10, step: 0.01, def: 1.5, unit: '×', label: 'Max brightness (loud)', help: '× the lamp\'s normal light at full level.' },
  reach: { min: 0.1, max: 4, step: 0.01, def: 1, unit: '×', label: 'Reach (distance)', help: 'How far the light reaches (1 = normal).' },
  decay: { min: 0, max: 4, step: 0.05, def: 1.6, unit: '', label: 'Fall-off (decay)', help: '0 = no fall-off, 2 = real-world.' },
  hue:   { min: -180, max: 180, step: 1, def: 0, unit: '°', label: 'Colour shift when loud', help: 'Turns the colour this many degrees at full level.' },
  dx:    { min: -4, max: 4, step: 0.05, def: 0, unit: 'm', label: 'Move east / west', help: '' },
  dy:    { min: -4, max: 0.25, step: 0.05, def: 0, unit: 'm', label: 'Move up / down', help: '' },
  dz:    { min: -4, max: 4, step: 0.05, def: 0, unit: 'm', label: 'Move north / south', help: '' },
});
export const DEFAULT_COLOR = '#fff4e0'; // CEILING_LIGHT_COLOR (room.js)
const DEFAULT_SOURCE = { NW: 'A', SW: 'A', NE: 'B', SE: 'B' };

const num = (v, s) => { const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? Math.min(s.max, Math.max(s.min, n)) : s.def; };
const hex = (v) => { if (typeof v !== 'string') return null; const m = v.trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i); if (!m) return null; let h = m[1].toLowerCase(); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return '#' + h; };

export function defaultLamp(id) {
  const o = { on: true, source: DEFAULT_SOURCE[id] || 'mix', color: DEFAULT_COLOR, invert: false };
  for (const [k, s] of Object.entries(LAMP_SPEC)) o[k] = s.def;
  return o;
}
export function defaultLights() {
  const env = {}; for (const [k, s] of Object.entries(ENV_SPEC)) env[k] = s.def;
  for (const [k, c] of Object.entries(ENV_CHOICE)) env[k] = c.def;
  const lamps = {}; for (const id of LAMP_IDS) lamps[id] = defaultLamp(id);
  return { v: LIGHTS_VERSION, env, lamps };
}
// Anything (old / partial / hand-edited JSON) → a complete, in-range settings object.
export function cleanLights(raw) {
  const d = defaultLights(); if (!raw || typeof raw !== 'object') return d;
  const e = raw.env && typeof raw.env === 'object' ? raw.env : {};
  for (const [k, s] of Object.entries(ENV_SPEC)) d.env[k] = num(e[k], s);
  if (BANDS.includes(e.band)) d.env.band = e.band;
  if (WINDOWS.includes(Number(e.window))) d.env.window = Number(e.window);
  const L = raw.lamps && typeof raw.lamps === 'object' ? raw.lamps : {};
  for (const id of LAMP_IDS) {
    const r = L[id]; if (!r || typeof r !== 'object') continue;
    const o = d.lamps[id];
    for (const [k, s] of Object.entries(LAMP_SPEC)) o[k] = num(r[k], s);
    if (typeof r.on === 'boolean') o.on = r.on;
    if (typeof r.invert === 'boolean') o.invert = r.invert;
    if (SOURCES.includes(r.source)) o.source = r.source;
    o.color = hex(r.color) || o.color;
  }
  return d;
}
export const isDefaultLights = (s) => JSON.stringify(cleanLights(s)) === JSON.stringify(defaultLights());
// Text to send Ulla (and back): pretty JSON with a tag, so a pasted chat message is recognised.
export const lightsToText = (s) => JSON.stringify({ noiseLights: cleanLights(s) }, null, 2);
export function lightsFromText(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Empty');
  const a = text.indexOf('{'), b = text.lastIndexOf('}'); // allow chat text around the JSON
  if (a < 0 || b <= a) throw new Error('No settings found in the text');
  const o = JSON.parse(text.slice(a, b + 1));
  const s = o && o.noiseLights ? o.noiseLights : o;
  if (!s || typeof s !== 'object' || (!s.env && !s.lamps)) throw new Error('No settings found in the text');
  return cleanLights(s);
}
export function loadLights(store = globalThis.localStorage) {
  try { const t = store && store.getItem(LIGHTS_KEY); return t ? cleanLights(JSON.parse(t)) : defaultLights(); } catch { return defaultLights(); }
}
export function saveLights(s, store = globalThis.localStorage) {
  try { if (!store) return; if (isDefaultLights(s)) store.removeItem(LIGHTS_KEY); else store.setItem(LIGHTS_KEY, JSON.stringify(cleanLights(s))); } catch { /* private / full */ }
}

// ---- the envelope maths ----
// RMS → target 0…1: × input gain, floor (threshold) … ceiling (full), then the curve.
export function envTarget(rms, env) {
  const r = rms * Math.pow(10, env.gainDb / 20), lo = env.threshold, hi = Math.max(lo + 1e-6, env.full);
  const t = Math.min(1, Math.max(0, (r - lo) / (hi - lo)));
  return env.curve === 1 ? t : Math.pow(t, env.curve);
}
// The share of the gap a one-pole filter with time constant tauMs closes in dtMs.
export const coef = (tauMs, dtMs) => (tauMs <= 0 ? 1 : 1 - Math.exp(-Math.max(0, dtMs) / tauMs));
// One step of a follower state { level, out, holdUntil } toward target; returns the shown level (0…1).
export function envStep(st, target, dtMs, nowMs, env) {
  if (target >= st.level) { st.level += (target - st.level) * coef(env.attackMs, dtMs); st.holdUntil = nowMs + env.holdMs; }
  else if (!(nowMs < st.holdUntil)) st.level += (target - st.level) * coef(env.releaseMs, dtMs);
  st.out = env.smoothMs > 0 ? (st.out ?? st.level) + (st.level - (st.out ?? st.level)) * coef(env.smoothMs, dtMs) : st.level;
  return st.out;
}
// A lamp's level from the two speakers' levels.
export function lampLevel(lamp, levels) {
  const l = lamp.source === 'A' ? levels.A : lamp.source === 'B' ? levels.B : lamp.source === 'mix' ? Math.max(levels.A, levels.B) : 0;
  return lamp.invert ? 1 - l : l;
}
// × the lamp's normal intensity (off = 0).
export const lampFactor = (lamp, level, env) => (lamp.on ? env.master * (lamp.min + (lamp.max - lamp.min) * level) : 0);
export const restFactor = (lamp, env) => (lamp.on ? env.master * env.rest : 0);
// BiquadFilter settings for the measuring tap (full = allpass: the same loudness, nothing cut).
export const bandFilter = (env) => ({ type: { full: 'allpass', low: 'lowpass', mid: 'bandpass', high: 'highpass' }[env.band] || 'allpass', frequency: env.band === 'full' ? 1000 : env.bandHz, Q: env.band === 'mid' ? 1 : 0.707 });

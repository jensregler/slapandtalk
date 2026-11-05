// Place effect in the city (Jens, 5 Nov 2026): everyone carries their OWN sound (radio, preset,
// morph) out into the city, but the GLOBAL effect – the master bus after all my sounds – depends
// on WHERE I stand. Per listener: each player hears the effect for their own position; nothing is
// sent to anyone.
//
// Data-driven: CITY_FX is a small table – a `base` (what the streets sound like) and `zones`
// applied in order on top of it. Each zone has a shape and a soft edge (`feather`, metres):
//   { id, name, shape: 'circle', x, z, r, feather, fx }          – round place (r = full strength)
//   { id, name, shape: 'rect', x, z, w, d, feather, fx }          – box (centre x/z, size w × d)
//   { id, name, shape: 'edge', inset, fx }                       – the last `inset` metres to the city's edge
// `fx` lists only what the zone changes (any of the PLACE keys). Strength w is 1 inside the shape
// and falls smoothly (smoothstep) to 0 at `feather` metres outside, so walking never jumps; the
// client also slews the audio params (~0.25 s time constant ≈ 0.75 s to settle).
// Inside houses / other rooms: PLACE_NEUTRAL (the room's own reverb does the rest).
// To change the zones: edit CITY_FX below (or pass a table to cityFxAt / klibb.setCityFx() in the
// browser to try one live; cleanCityFx() checks it). Coordinates are metres on the city map:
// the city is 96 × 96 m (x and z from −48 to 48), 3 × 3 plots of 32 m, the Town Hall in the middle
// (0, 0), its door facing south (+z), the spawn at (0, 17).
import { CITY } from './city.mjs';
import { MASTER } from './clock.mjs';

// Every place parameter: [min, max, log?]. Plain numbers – fed to existing audio params.
export const PLACE = Object.freeze({
  verbWet:   [0, 0.8],          // reverb send
  verbSize:  [0, 1],            // 0 = small room (0.9 s) … 1 = big hall (5.5 s): a blend of two reverbs
  delayTime: [0.02, 0.6, true], // s (slapback ≈ 0.06–0.12)
  delayFb:   [0, 0.7],
  delayWet:  [0, 0.8],
  delay2Time: [0.02, 1.2, true], // a second delay (the delay quarter: two taps blending)
  delay2Fb:  [0, 0.7],
  delay2Wet: [0, 0.8],
  modMix:    [0, 1],            // flanger / chorus (one modulated short delay in the worklet)
  modBase:   [0.5, 30, true],   // ms: ~1–3 = flanger, ~12–25 = chorus
  modDepth:  [0, 10],           // ms swing
  modRate:   [0.05, 5, true],   // Hz
  modFb:     [0, 0.9],          // flanger feedback (chorus ≈ 0)
  stutter:   [0, 1],            // chance per slice to repeat the last slice (beat repeat)
  stutterLen: [0.04, 0.7, true], // s, the slice (a 16th at 90 BPM = 0.167)
  chop:      [0, 1],            // cuts the 2nd half of a repeated slice
  cutoff:    [300, 20000, true], // master low-pass, Hz
  decim:     [1, 32, true],     // sample-and-hold factor (1 = off)
  bits:      [1, 16],           // bit depth (16 = clean)
  decimMix:  [0, 1],            // how much of the decimated signal (0 = none)
  bird:      [0, 2],            // × the radio's bird volume
  wind:      [0, 2],            // × the radio's wind volume
});
export const PLACE_NEUTRAL = Object.freeze({ verbWet: 0, verbSize: 0.3, delayTime: 0.1, delayFb: 0, delayWet: 0, delay2Time: 0.5, delay2Fb: 0, delay2Wet: 0,
  modMix: 0, modBase: 15, modDepth: 3, modRate: 0.5, modFb: 0, cutoff: 20000, decim: 1, bits: 16, decimMix: 0, stutter: 0, stutterLen: 1 / 6, chop: 0, bird: 1, wind: 1 });
// Tempo-synced times come from the master clock (shared/clock.mjs, 90 BPM): a beat = 0.667 s.
const BEAT = 60 / MASTER.bpm;
// Every value set back to clean (the dry quarter): all effects off, the radio's bird/wind as they are.
const CLEAN = Object.freeze({ ...PLACE_NEUTRAL });
export const PLACE_SLEW = 0.25; // s, the audio params' time constant (setTargetAtTime)
export const PLACE_EVERY_MS = 100; // how often the client recomputes from my position

// Layout (north = −z; the plots are 32 m, centres at −32 / 0 / 32; houses stand in the middle 16 × 16 m):
//      ┌──────────── north park (bird + wind) ────────────┐
//      │  1 DELAY      │  2 (streets)    │  3 REVERB       │
//      │  quarter      │                 │  quarter        │
//      ├───────────────┼─────────────────┼─────────────────┤
//      │  4 FLANGER    │   TOWN HALL     │  5 CHORUS       │
//      │  quarter      │  (streets)      │  quarter        │
//      ├───────────────┼──── square ─────┼─────────────────┤
//      │  6 GLITCH     │  7 (square:     │  8 CLEAN        │
//      │  crush+stutter│   big echo)     │  fully dry      │
//      └──────── edge: broken radio (last 7 m) ───────────┘
// Streets everywhere else: a short slapback. Quarters cover their plot (28 × 28 m) and fade over
// 8 m, so the street between two quarters is a blend of both. Later rows win where they overlap;
// CLEAN is last, so the clean quarter is truly clean (even at the city edge).
const quarter = (id, name, i, j, fx) => ({ id, name, shape: 'rect', x: i * 32, z: j * 32, w: 28, d: 28, feather: 8, fx });
export const CITY_FX = Object.freeze({
  base: { verbWet: 0.12, verbSize: 0.25, delayTime: 0.085, delayFb: 0.18, delayWet: 0.16, cutoff: 16000 }, // streets between houses: a short slapback
  zones: [
    { id: 'square', name: 'Town square', shape: 'circle', x: 0, z: 17, r: 9, feather: 9, // open square in front of the Town Hall: big echo
      fx: { verbWet: 0.45, verbSize: 0.95, delayWet: 0.12, delayTime: BEAT, delayFb: 0.25, cutoff: 18000 } },
    { id: 'park', name: 'North park', shape: 'rect', x: 0, z: -44, w: 96, d: 8, feather: 8, // behind the north row: nature
      fx: { bird: 2, wind: 1.7, verbWet: 0.22, verbSize: 0.55, delayWet: 0.03, cutoff: 12000 } },
    quarter('delay', 'Delay quarter', -1, -1, { delayTime: BEAT / 2, delayFb: 0.45, delayWet: 0.38, delay2Time: BEAT * 3 / 4, delay2Fb: 0.4, delay2Wet: 0.3, verbWet: 0.1 }), // ⅛ + dotted ⅛ at 90 BPM
    quarter('reverb', 'Reverb quarter', 1, -1, { verbWet: 0.7, verbSize: 1, delayWet: 0.02, cutoff: 14000 }),
    quarter('flanger', 'Flanger quarter', -1, 0, { modMix: 1, modBase: 1.6, modDepth: 1.4, modRate: 0.22, modFb: 0.72, delayWet: 0.06 }),
    quarter('chorus', 'Chorus quarter', 1, 0, { modMix: 0.85, modBase: 16, modDepth: 5, modRate: 0.9, modFb: 0, delayWet: 0.08, verbWet: 0.18 }),
    quarter('glitch', 'Glitch quarter', -1, 1, { decim: 10, bits: 5, decimMix: 0.8, stutter: 0.45, stutterLen: BEAT / 4, chop: 0.7, delayWet: 0.05 }),
    { id: 'edge', name: 'City edge', shape: 'edge', inset: 7, // the last 7 m: a broken radio
      fx: { decim: 14, bits: 6, decimMix: 0.75, cutoff: 4500, wind: 1.4 } },
    quarter('clean', 'Clean quarter', 1, 1, CLEAN),
  ],
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const KEYS = Object.keys(PLACE);

// Strength (0–1) of one zone at (x, z).
export function zoneWeight(zn, x, z, box = CITY) {
  const f = Math.max(0.01, zn.feather ?? 6);
  if (zn.shape === 'circle') return 1 - smooth((Math.hypot(x - zn.x, z - zn.z) - zn.r) / f);
  if (zn.shape === 'rect') {
    const dx = Math.max(0, Math.abs(x - zn.x) - zn.w / 2), dz = Math.max(0, Math.abs(z - zn.z) - zn.d / 2);
    return 1 - smooth(Math.hypot(dx, dz) / f);
  }
  if (zn.shape === 'edge') {
    const inset = Math.max(0.01, zn.inset ?? 6), b = Math.min(box.width / 2 - Math.abs(x), box.depth / 2 - Math.abs(z));
    return 1 - smooth(b / inset);
  }
  return 0;
}
const mix = (k, a, b, t) => (PLACE[k][2] ? Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * t) : a + (b - a) * t);

// The place effect at (x, z): { ...PLACE values, zones: { id: weight } }.
export function cityFxAt(x, z, cfg = CITY_FX) {
  const v = { ...PLACE_NEUTRAL, ...(cfg.base || {}) }, zones = {};
  if (!Number.isFinite(x) || !Number.isFinite(z)) return { ...PLACE_NEUTRAL, zones };
  for (const zn of cfg.zones || []) {
    const w = zoneWeight(zn, x, z); zones[zn.id] = +w.toFixed(3);
    if (w <= 0) continue;
    for (const [k, to] of Object.entries(zn.fx || {})) if (k in v) v[k] = mix(k, v[k], to, w);
  }
  for (const k of KEYS) v[k] = clamp(v[k], PLACE[k][0], PLACE[k][1]);
  return { ...v, zones };
}
export const placeNeutral = () => ({ ...PLACE_NEUTRAL, zones: {} });

// Check an edited table (later: the build city's editor). Unknown keys/shapes are dropped, values clamped.
export function cleanCityFx(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  const vals = (o) => { const out = {}; for (const k of KEYS) if (Number.isFinite(o?.[k])) out[k] = clamp(o[k], PLACE[k][0], PLACE[k][1]); return out; };
  const num = (n, lo, hi, d) => (Number.isFinite(n) ? clamp(n, lo, hi) : d);
  const zones = (Array.isArray(cfg.zones) ? cfg.zones : []).slice(0, 32).map((z, i) => {
    if (!z || !['circle', 'rect', 'edge'].includes(z.shape)) return null;
    const o = { id: String(z.id || `z${i}`).slice(0, 24), name: String(z.name || '').slice(0, 40), shape: z.shape, fx: vals(z.fx) };
    if (z.shape === 'edge') o.inset = num(z.inset, 0.5, 48, 6);
    else { o.x = num(z.x, -48, 48, 0); o.z = num(z.z, -48, 48, 0); o.feather = num(z.feather, 0.5, 48, 6); }
    if (z.shape === 'circle') o.r = num(z.r, 0, 96, 8);
    if (z.shape === 'rect') { o.w = num(z.w, 0, 96, 16); o.d = num(z.d, 0, 96, 16); }
    return o;
  }).filter(Boolean);
  return { base: vals(cfg.base), zones };
}

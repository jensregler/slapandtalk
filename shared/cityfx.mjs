// Place effect in the city (Jens, 5–6 Nov 2026): everyone carries their OWN sound (radio, preset,
// morph) out into the city, but the GLOBAL effect – the master bus after all my sounds – depends
// on WHERE I stand. Per listener: each player hears the effect for their own position; nothing is
// sent to anyone.
//
// v2 (sketch video + t579u): continuous GRADIENT FIELDS instead of flat 28 m quarters.
//   - Four CORNER houses (Delay NW, Reverb NE, Glitch SW, Freq shift SE): one slow shape,
//     rotated/mirrored – 100 % at the outer map corner, gentle falloff toward the centre.
//   - Two SIDE houses (Flanger W, Chorus E): half-disc radiating from the inner face toward
//     the alleys / centre.
//   - Alleys BLEND overlapping fields (multiple effects at once); deeper meetings = extremes.
//   - Around the Town Hall amounts ≈ 0 (quiet, effect-free).
//   - Four PEAKS at the inner intersections (±16, ±16): ~4× wider steep-but-smooth curves (not a
//     hard switch). Each peak stacks a UNIQUE combo of 3 different effects (“stacks of gradients
//     i korsningarna”) so no two intersections share the same set. Extreme at the centre; soft-capped.
//   - Parameters follow the gradients too (delay time short near the Delay house → tempo-synced
//     mid-alley; feedback, reverb size, mod depth/rate, glitch rate, freq-shift Hz likewise).
//   - Glitch SW also drives delay + flanger (on top of crush+stutter+chop): wet/fb/mod scale with
//     corner depth (0 at the field edge → max / 100 % feedback at the tip). Delay TIME additionally
//     slides with position along the outer walls. Glitch maxima are hotter than Delay NW / Flanger W.
// Inside houses / other rooms: PLACE_NEUTRAL (the room's own reverb does the rest).
// Coordinates: metres on the city map – 96 × 96 m (x, z −48…48), 3 × 3 plots of 32 m, Town Hall
// at (0, 0), door facing south (+z), spawn at (0, 17). North = −z.
import { CITY } from './city.mjs';
import { MASTER } from './clock.mjs';

// Every place parameter: [min, max, log?]. Plain numbers – fed to existing audio params.
export const PLACE = Object.freeze({
  verbWet:   [0, 0.8],
  verbSize:  [0, 1],
  delayTime: [0.02, 0.6, true],
  // delayFb max 1.0 so Glitch SW can hit 100 % feedback at the tip (other quarters stay ≤~0.55).
  delayFb:   [0, 1],
  delayWet:  [0, 1],
  delay2Time: [0.02, 1.2, true],
  delay2Fb:  [0, 1],
  delay2Wet: [0, 1],
  modMix:    [0, 1],
  modBase:   [0.5, 30, true],   // ms: ~1–3 = flanger, ~12–25 = chorus
  modDepth:  [0, 10],
  modRate:   [0.05, 5, true],
  modFb:     [0, 0.9],
  stutter:   [0, 1],
  stutterLen: [0.04, 0.7, true],
  chop:      [0, 1],
  cutoff:    [300, 20000, true],
  decim:     [1, 32, true],
  bits:      [1, 16],
  decimMix:  [0, 1],
  // Freq shift (ring-mod approximation of a frequency shifter; see decimator.js Place worklet).
  freqHz:    [-800, 800],       // carrier Hz; 0 = no shift
  freqMix:   [0, 1],            // dry/wet of the ring-mod branch
  // Intersection Distortion (Peaks that list 'dist') – place-bus WaveShaper, not listener FX.
  distWet:   [0, 0.85],
  distAmount:[0, 1],
  bird:      [0, 2],
  wind:      [0, 2],
});
export const PLACE_NEUTRAL = Object.freeze({
  verbWet: 0, verbSize: 0.3, delayTime: 0.1, delayFb: 0, delayWet: 0,
  delay2Time: 0.5, delay2Fb: 0, delay2Wet: 0,
  modMix: 0, modBase: 15, modDepth: 3, modRate: 0.5, modFb: 0,
  cutoff: 20000, decim: 1, bits: 16, decimMix: 0, stutter: 0, stutterLen: 1 / 6, chop: 0,
  freqHz: 0, freqMix: 0, distWet: 0, distAmount: 0.2, bird: 1, wind: 1,
});
const BEAT = 60 / MASTER.bpm; // ⅔ s at 90 BPM
export const PLACE_SLEW = 0.25;
export const PLACE_EVERY_MS = 100;

// ---------- Field geometry (metres) ----------
export const FIELD = Object.freeze({
  half: 48,                 // city half-extent
  plot: 32,
  houseHalf: 8,             // house is 16 × 16
  // Corner shape: 100 % within CORNER_FULL of the outer map corner, ~0 by CORNER_ZERO.
  cornerFull: 5,
  cornerZero: 72,           // past centre along the diagonal (√2·48 ≈ 67.9) → Town Hall ≈ 0, alleys still alive
  // Side half-disc: from the inner face of Flanger/Chorus toward the centre / alleys.
  sideFull: 3,
  sideZero: 28,           // house-centred; Town Hall at 32 m → ~0; alleys still filled
  // Peaks at the four inner intersections around the Town Hall (~4× prior radius, gentler).
  peakR: 12.8,              // metres to ~0 (was 3.2; delay/reverb/freqshift peak zones grow with this)
  peakKnee: 1.4,            // metres still ~100 % (was 0.35)
  peakPower: 3,             // >1 → steeper shoulders than plain smoothstep
});

// Named field ids (also used as place-chip labels via CITY_FX.zones).
export const FIELD_IDS = Object.freeze({
  delay: 'delay', reverb: 'reverb', flanger: 'flanger', chorus: 'chorus',
  glitch: 'glitch', freq: 'freq',
  peakA: 'peakA', peakB: 'peakB', peakC: 'peakC', peakD: 'peakD',
  park: 'park', edge: 'edge',
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const KEYS = Object.keys(PLACE);
const mixLin = (a, b, t) => a + (b - a) * t;
const mix = (k, a, b, t) => (PLACE[k][2] ? Math.exp(Math.log(Math.max(1e-12, a)) + (Math.log(Math.max(1e-12, b)) - Math.log(Math.max(1e-12, a))) * t) : mixLin(a, b, t));

// Smooth falloff 1→0 as d goes FULL→ZERO.
function radialFalloff(d, full, zero) {
  if (d <= full) return 1;
  if (d >= zero) return 0;
  return 1 - smooth((d - full) / (zero - full));
}

// ---------- ONE corner shape, rotated/mirrored via (sx, sz) ∈ {−1,+1}² ----------
// Outer map corner = (sx·48, sz·48). Amount = 1 there, slow falloff toward the centre.
export function cornerField(x, z, sx, sz, f = FIELD) {
  const ocx = sx * f.half, ocz = sz * f.half;
  return radialFalloff(Math.hypot(x - ocx, z - ocz), f.cornerFull, f.cornerZero);
}

// ---------- Side half-disc: Flanger (sx=−1) / Chorus (sx=+1) ----------
// Semi-circle centred on the house, radiating toward the city centre / alleys. The outer half
// (toward the city edge) keeps a soft shoulder through the house so there's no cliff at the wall,
// then falls off before the map edge.
export function sideField(x, z, sx, f = FIELD) {
  const hx = sx * f.plot;                    // house centre ±32
  const toward = sx * (hx - x);              // ≥0 on the centre-facing side of the house
  const r = Math.hypot(x - hx, z);
  const base = radialFalloff(r, f.sideFull, f.sideZero);
  if (toward >= -0.01) return base;          // centre-facing half (incl. the house midline)
  // Outer shoulder: through the house body, then down toward the city edge
  const outer = radialFalloff(-toward, 0, f.houseHalf + 8);
  return base * Math.max(0.15, outer);
}

// ---------- Peak: steep-but-continuous (NOT an instant switch) ----------
// 1 at the centre, drops fast to 0 just outside. Power>1 steepens the shoulders.
export function peakField(x, z, px, pz, f = FIELD) {
  const d = Math.hypot(x - px, z - pz);
  if (d <= f.peakKnee) return 1;
  if (d >= f.peakR) return 0;
  const s = smooth((d - f.peakKnee) / (f.peakR - f.peakKnee));
  return Math.pow(1 - s, f.peakPower);
}

// Peak centres: A NW, B NE, C SW, D SE – the four inner intersections around the Town Hall.
// Each peak: exactly 3 DIFFERENT effects; every peak's set is unique (Jens, Nov 2026 sketch).
export const PEAKS = Object.freeze([
  { id: 'peakA', name: 'Peak A', x: -16, z: -16, effects: ['dist', 'delay', 'freq'] },
  { id: 'peakB', name: 'Peak B', x:  16, z: -16, effects: ['bitcrush', 'reverb', 'chorus'] },
  { id: 'peakC', name: 'Peak C', x: -16, z:  16, effects: ['dist', 'flanger', 'stutter'] },
  { id: 'peakD', name: 'Peak D', x:  16, z:  16, effects: ['bitcrush', 'freq', 'reverb'] },
]);

/** Sum of peakField amounts for every peak that lists `effect` in its combo. */
export function peakEffectAmt(effect, peakAmts) {
  let s = 0;
  for (const p of PEAKS) if (p.effects.includes(effect)) s += peakAmts[p.id] || 0;
  return s;
}

// Soft overlays kept from v1 (nature + broken-radio edge). No loud Town-square echo – the hall
// area must stay quiet.
function parkWeight(x, z) {
  // Thin north strip at the very edge (z ≈ −48…−46.5), clear of the NW/NE house corners (−40).
  const dz = Math.max(0, Math.abs(z - (-47.25)) - 0.75);
  const dx = Math.max(0, Math.abs(x) - 48);
  return 1 - smooth(Math.hypot(dx, dz) / 4);
}
function edgeWeight(x, z, box = CITY) {
  const inset = 7;
  const b = Math.min(box.width / 2 - Math.abs(x), box.depth / 2 - Math.abs(z));
  return 1 - smooth(b / inset);
}

// Amounts for every named field at (x, z). Pure geometry – no audio params yet.
export function fieldAmounts(x, z, f = FIELD) {
  const delay = cornerField(x, z, -1, -1, f);
  const reverb = cornerField(x, z,  1, -1, f);
  const glitch = cornerField(x, z, -1,  1, f);
  const freq = cornerField(x, z,  1,  1, f);
  const flanger = sideField(x, z, -1, f);
  const chorus = sideField(x, z,  1, f);
  const peakA = peakField(x, z, -16, -16, f);
  const peakB = peakField(x, z,  16, -16, f);
  const peakC = peakField(x, z, -16,  16, f);
  const peakD = peakField(x, z,  16,  16, f);
  const park = parkWeight(x, z);
  const edge = edgeWeight(x, z);
  const peakAmts = { peakA, peakB, peakC, peakD };
  // Corner/side fields + unique 3-effect peak stacks (peakEffectAmt).
  return {
    delay, reverb, flanger, chorus, glitch, freq,
    peakA, peakB, peakC, peakD, park, edge,
    delayAmt: delay + peakEffectAmt('delay', peakAmts),
    reverbAmt: reverb + peakEffectAmt('reverb', peakAmts),
    flangerAmt: flanger + peakEffectAmt('flanger', peakAmts),
    chorusAmt: chorus + peakEffectAmt('chorus', peakAmts),
    glitchAmt: glitch, // SW corner: crush+stutter+chop + (via paramsFromFields) delay+flanger; peaks use bitcrush/stutter separately
    freqAmt: freq + peakEffectAmt('freq', peakAmts),
    distAmt: peakEffectAmt('dist', peakAmts),
    crushAmt: peakEffectAmt('bitcrush', peakAmts),
    stutterAmt: peakEffectAmt('stutter', peakAmts),
  };
}

// Delay time / feedback follow distance from the Delay outer corner (not just amount):
// short & snappy next to the house, tempo-synced (⅛) around mid-alley, longer further out.
export function delayParamsAt(x, z, f = FIELD) {
  const d = Math.hypot(x - (-f.half), z - (-f.half)); // dist from NW outer corner
  // 0 at corner → 1 around ~40 m (mid-alley / toward centre).
  const t = clamp((d - 8) / 34, 0, 1);
  const tSmooth = smooth(t);
  const delayTime = mixLin(0.055, BEAT / 2, tSmooth);       // 55 ms → ⅛ note (⅓ s)
  const delay2Time = mixLin(0.11, BEAT * 3 / 4, tSmooth);   // ~110 ms → dotted ⅛
  const delayFb = mixLin(0.55, 0.28, tSmooth);
  const delay2Fb = mixLin(0.48, 0.22, tSmooth);
  return { delayTime, delay2Time, delayFb, delay2Fb, t: tSmooth };
}

// Glitch-SW delay TIME along the outer walls (Jens, voice Nov 2026):
// L-distance from the SW tip (−half,+half) along either wall. 0 at the tip → grows as you slide
// west-wall north or south-wall east. Audible continuous change; independent of wet/fb depth.
export function glitchDelayParamsAt(x, z, f = FIELD) {
  const along = (x - (-f.half)) + (f.half - z);
  const t = clamp(along / 36, 0, 1);
  const tSmooth = smooth(t);
  // Wild range past the NW house's short slap: tip snaps short, wall stretch goes long.
  const delayTime = mixLin(0.04, 0.58, tSmooth);
  const delay2Time = mixLin(0.08, 1.05, tSmooth);
  return { delayTime, delay2Time, t: tSmooth, along };
}

// Map field amounts → PLACE params. Soft-cap so alley extremes stay musical.
function softCap(a, knee = 1) {
  // a≥0 → approaches knee*1.5 asymptotically; ≈a for a≪knee.
  return knee * 1.5 * (1 - Math.exp(-a / knee));
}

function paramsFromFields(A, x, z) {
  const v = { ...PLACE_NEUTRAL };
  const dA = softCap(A.delayAmt), rA = softCap(A.reverbAmt);
  const fA = softCap(A.flangerAmt), cA = softCap(A.chorusAmt);
  const gA = softCap(A.glitchAmt), qA = softCap(A.freqAmt);
  const park = A.park, edge = A.edge;

  // --- Delay (corner NW + peak D) ---
  // delayTime always blends street slapback → gradient so a silent→audible crossing never snaps.
  const dp = delayParamsAt(x, z);
  const dPres = clamp(dA / 0.35, 0, 1);
  v.delayWet = 0.55 * dA;
  v.delay2Wet = 0.42 * dA;
  v.delayTime = mixLin(0.085, dp.delayTime, dPres);
  v.delay2Time = mixLin(0.17, dp.delay2Time, dPres);
  v.delayFb = mixLin(0.15, dp.delayFb, dPres) * Math.max(dPres, clamp(dA, 0, 1));
  v.delay2Fb = mixLin(0.1, dp.delay2Fb, dPres) * Math.max(dPres, clamp(dA, 0, 1));

  // --- Reverb (corner NE + peak C) ---
  v.verbWet = 0.72 * rA;
  v.verbSize = mixLin(0.35, 1, clamp(rA, 0, 1));

  // --- Flanger (side W + peaks + Glitch SW) vs Chorus (side E + peaks) ---
  // Glitch corner adds EXTRA flanger energy (raw depth, soft-cap bypassed) so SW outruns Flanger W.
  const gRaw = clamp(A.glitchAmt, 0, 1); // 0 at glitch-field edge → 1 at innermost SW tip
  const fGlitch = gRaw * 1.35;           // hotter than a normal side-field peak
  const fTotal = fA + fGlitch;
  const modSum = fTotal + cA;
  v.modMix = clamp(0.99 * softCap(modSum, 1.15), 0, 1);
  // Soften bias when both fields are tiny so a 0↔ε crossing can't swing modBase across its whole range.
  const rawBias = modSum > 1e-9 ? cA / modSum : 0.5; // 0 = pure flanger, 1 = pure chorus
  const chorusBias = mixLin(0.5, rawBias, clamp(modSum / 0.1, 0, 1));
  v.modBase = mix('modBase', 1.5, 18, chorusBias);
  v.modDepth = mixLin(1.3, 5.5, chorusBias) * clamp(modSum, 0, 1.35);
  // Glitch tip pushes depth/feedback past the west-side peak.
  if (gRaw > 0) {
    v.modDepth = Math.max(v.modDepth, mixLin(2.5, 9.8, gRaw) * gRaw);
  }
  v.modRate = mix('modRate', 0.18, 1.1, chorusBias);
  v.modFb = mixLin(0.75, 0, chorusBias) * clamp(fTotal, 0, 1.2);
  if (gRaw > 0) v.modFb = Math.max(v.modFb, 0.9 * gRaw);

  // --- Glitch (SW corner: crush + stutter + chop bundle — kept) ---
  v.decimMix = 0.85 * gA;
  v.decim = mix('decim', 1, 12, clamp(gA, 0, 1));
  v.bits = mixLin(16, 4, clamp(gA, 0, 1));
  v.stutter = 0.55 * gA;
  // Near the house (high amount): dense 16ths; further out: longer slices.
  v.stutterLen = mix('stutterLen', BEAT / 4, BEAT / 2, 1 - clamp(gA, 0, 1));
  v.chop = 0.75 * gA;

  // --- Glitch SW EXTRA delay (Jens voice Nov 2026): wet + 100 % feedback at tip; TIME along wall ---
  // Soft-cap bypassed for wet/fb so SW is wildly hotter than Delay NW (~0.52 wet / ~0.55 fb).
  // Math.max so NW Delay / peaks keep their identity where they dominate.
  if (gRaw > 0) {
    const gp = glitchDelayParamsAt(x, z);
    v.delayWet = Math.max(v.delayWet, 0.98 * gRaw);
    v.delay2Wet = Math.max(v.delay2Wet, 0.88 * gRaw);
    v.delayFb = Math.max(v.delayFb, 1.0 * gRaw);     // → 100 % at innermost SW
    v.delay2Fb = Math.max(v.delay2Fb, 0.95 * gRaw);
    // Engage wall-time morph as soon as we're meaningfully in the glitch field.
    const gPres = clamp(gRaw / 0.2, 0, 1);
    v.delayTime = mixLin(v.delayTime, gp.delayTime, gPres);
    v.delay2Time = mixLin(v.delay2Time, gp.delay2Time, gPres);
  }

  // --- Freq shift (corner SE + peaks that list freq) ---
  // Hz grows with amount; sign follows a smooth N/S bias (no hard flip at z=0).
  const freqSign = clamp(z / 24, -1, 1); // ≈0 on the equator, ±1 deep south/north of SE
  v.freqMix = clamp(0.9 * qA, 0, 1);
  v.freqHz = freqSign * mixLin(0, 480, clamp(qA, 0, 1));

  // --- Intersection peak stacks: dist / bitcrush / stutter (extreme at centre; soft-capped, under master guard) ---
  const xDist = softCap(A.distAmt);
  const xCrush = softCap(A.crushAmt);
  const xStut = softCap(A.stutterAmt || 0);
  v.distWet = 0.82 * xDist;
  v.distAmount = mixLin(0.22, 0.92, clamp(xDist, 0, 1));
  if (xCrush > 0) {
    v.decimMix = Math.max(v.decimMix, 0.95 * xCrush);
    v.decim = Math.max(v.decim, mix('decim', 1, 30, clamp(xCrush, 0, 1)));
    v.bits = Math.min(v.bits, mixLin(16, 2.2, clamp(xCrush, 0, 1)));
  }
  if (xStut > 0) {
    v.stutter = Math.max(v.stutter, 0.9 * xStut);
    v.chop = Math.max(v.chop, 0.85 * xStut);
    v.stutterLen = mix('stutterLen', BEAT / 4, BEAT / 2, 1 - clamp(Math.max(gA, xStut), 0, 1));
  }

  // --- Park / edge overlays (additive, light) ---
  if (park > 0) {
    v.bird = mixLin(v.bird, 2, park);
    v.wind = mixLin(v.wind, 1.7, park);
    v.verbWet = mixLin(v.verbWet, Math.max(v.verbWet, 0.22), park * 0.5);
    v.verbSize = mixLin(v.verbSize, Math.max(v.verbSize, 0.55), park * 0.5);
  }
  if (edge > 0) {
    v.decimMix = mixLin(v.decimMix, Math.max(v.decimMix, 0.75), edge);
    v.decim = mix('decim', v.decim, Math.max(v.decim, 14), edge);
    v.bits = mixLin(v.bits, Math.min(v.bits, 6), edge);
    v.cutoff = mix('cutoff', v.cutoff, 4500, edge);
    v.wind = mixLin(v.wind, Math.max(v.wind, 1.4), edge);
  }

  // Streets base: a tiny slapback wet when nothing else is cooking (time already blended above).
  const activity = dA + rA + fA + cA + gA + qA + xDist + xCrush + xStut;
  if (activity < 0.15) {
    const street = 1 - activity / 0.15;
    v.delayWet = Math.max(v.delayWet, 0.12 * street);
    v.delayFb = Math.max(v.delayFb, 0.15 * street * (1 - dPres));
    v.verbWet = Math.max(v.verbWet, 0.08 * street);
    if (street > 0.5) v.cutoff = Math.min(v.cutoff, 16000);
  }

  for (const k of KEYS) v[k] = clamp(v[k], PLACE[k][0], PLACE[k][1]);
  return v;
}

// Zone table for the place-chip / debugger / cleanCityFx round-trip. Weights come from fields.
export const CITY_FX = Object.freeze({
  base: {}, // fields own the base; kept for cleanCityFx / setCityFx edits
  zones: Object.freeze([
    { id: 'delay', name: 'Delay quarter', shape: 'field', fx: {} },
    { id: 'reverb', name: 'Reverb quarter', shape: 'field', fx: {} },
    { id: 'flanger', name: 'Flanger quarter', shape: 'field', fx: {} },
    { id: 'chorus', name: 'Chorus quarter', shape: 'field', fx: {} },
    { id: 'glitch', name: 'Glitch quarter', shape: 'field', fx: {} },
    { id: 'freq', name: 'Freq shift quarter', shape: 'field', fx: {} },
    { id: 'peakA', name: 'Peak A (dist+delay+freq)', shape: 'field', fx: {} },
    { id: 'peakB', name: 'Peak B (bitcrush+reverb+chorus)', shape: 'field', fx: {} },
    { id: 'peakC', name: 'Peak C (dist+flanger+stutter)', shape: 'field', fx: {} },
    { id: 'peakD', name: 'Peak D (bitcrush+freq+reverb)', shape: 'field', fx: {} },
    { id: 'park', name: 'North park', shape: 'field', fx: {} },
    { id: 'edge', name: 'City edge', shape: 'field', fx: {} },
  ]),
});

// Legacy shape weights (custom overlays via setCityFx / cleanCityFx).
export function zoneWeight(zn, x, z, box = CITY) {
  if (zn.shape === 'field') return 0; // fields are computed in cityFxAt, not here
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

// The place effect at (x, z): { ...PLACE values, zones: { id: weight } }.
export function cityFxAt(x, z, cfg = CITY_FX) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return { ...PLACE_NEUTRAL, zones: {} };

  // Default path: continuous fields.
  const usingDefault = cfg === CITY_FX || (!cfg?.base && (cfg?.zones || []).every((zn) => zn.shape === 'field' || !zn.shape));
  if (usingDefault || (cfg?.zones || []).every((zn) => zn.shape === 'field')) {
    const A = fieldAmounts(x, z);
    const v = paramsFromFields(A, x, z);
    const zones = {
      delay: +A.delay.toFixed(3), reverb: +A.reverb.toFixed(3),
      flanger: +A.flanger.toFixed(3), chorus: +A.chorus.toFixed(3),
      glitch: +A.glitch.toFixed(3), freq: +A.freq.toFixed(3),
      peakA: +A.peakA.toFixed(3), peakB: +A.peakB.toFixed(3),
      peakC: +A.peakC.toFixed(3), peakD: +A.peakD.toFixed(3),
      park: +A.park.toFixed(3), edge: +A.edge.toFixed(3),
    };
    return { ...v, zones };
  }

  // Custom edited table (circle/rect/edge overlays): same blend as v1.
  const v = { ...PLACE_NEUTRAL, ...(cfg.base || {}) }, zones = {};
  for (const zn of cfg.zones || []) {
    const w = zoneWeight(zn, x, z); zones[zn.id] = +w.toFixed(3);
    if (w <= 0) continue;
    for (const [k, to] of Object.entries(zn.fx || {})) if (k in v) v[k] = mix(k, v[k], to, w);
  }
  for (const k of KEYS) v[k] = clamp(v[k], PLACE[k][0], PLACE[k][1]);
  return { ...v, zones };
}
export const placeNeutral = () => ({ ...PLACE_NEUTRAL, zones: {} });

// Check an edited table. Unknown keys/shapes dropped, values clamped. 'field' kept as a tag.
export function cleanCityFx(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  const vals = (o) => { const out = {}; for (const k of KEYS) if (Number.isFinite(o?.[k])) out[k] = clamp(o[k], PLACE[k][0], PLACE[k][1]); return out; };
  const num = (n, lo, hi, d) => (Number.isFinite(n) ? clamp(n, lo, hi) : d);
  const zones = (Array.isArray(cfg.zones) ? cfg.zones : []).slice(0, 32).map((z, i) => {
    if (!z || !['circle', 'rect', 'edge', 'field'].includes(z.shape)) return null;
    const o = { id: String(z.id || `z${i}`).slice(0, 24), name: String(z.name || '').slice(0, 40), shape: z.shape, fx: vals(z.fx) };
    if (z.shape === 'field') return o;
    if (z.shape === 'edge') o.inset = num(z.inset, 0.5, 48, 6);
    else { o.x = num(z.x, -48, 48, 0); o.z = num(z.z, -48, 48, 0); o.feather = num(z.feather, 0.5, 48, 6); }
    if (z.shape === 'circle') o.r = num(z.r, 0, 96, 8);
    if (z.shape === 'rect') { o.w = num(z.w, 0, 96, 16); o.d = num(z.d, 0, 96, 16); }
    return o;
  }).filter(Boolean);
  return { base: vals(cfg.base), zones };
}

export { BEAT, smooth, clamp };

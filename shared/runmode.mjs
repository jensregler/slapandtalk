// Run mode (Jens t544u, 5 Nov 2026): hold Shift while walking = running. Two personal settings on
// the Sound settings' Steps (walk sound) tab change how MY footsteps sound while I run:
//   tempo – step rate relative to walking, shown −400 % … +400 % in 12.5 % jumps (Jens, 11 Nov 2026;
//           was ±200 %). p ≥ 0: rate = 1 + p/100  (0 % = 1:1, +50 % = 3:2, +100 % = 2:1, +400 % = 5:1)
//           p < 0: rate = 1 / (1 + |p|/100)  (−50 % = 2:3, −100 % = 1:2, −400 % = 1:5)
//           a mirror image: never zero or negative, and the 50/100/200 marks are the clean ratios.
//   pitch – a step on a major-pentatonic ladder over the walk sound (C D E G A: no semitone
//           clashes, so running never sounds out of key against the walk / the four voices):
//           down 5 steps to an octave below (−40 % each), up 8 steps to an octave + a fifth above
//           (+25 % each). Default +75 % = +7 semitones (a fifth up).
//   lock  – "Lock to clock" (dormant, no UI): snapped the run tempo to the nearest of only 7 ratios
//           (1:3 … 3:1). It was on by default with no way to turn it off, so 4–5 slider notches in a row
//           gave the SAME tempo (+25 … +75 % all = 3:2) and the run tempo slider seemed not to work
//           (Jens, 11 Nov 2026). Now always off: every 12.5 % notch is its own tempo. Every notch is still
//           an exact ratio on the same grid ((8 + k):8 or 8:(8 + k)), so runners stay in time with walkers.
//   crouch / sneak (Jens, 11 Nov 2026): hold Ctrl = sneak – slower, and my steps use crouchTempo
//           (same −400 … +400 % maths as tempo, default −50 % = 2:3) and crouchPitch (same pentatonic
//           ladder, default −2 = −5 st, a fourth down).
//   gait  – while dancing, Shift = run tempo and Ctrl = crouch tempo for the dance's footsteps / walk
//           sequencer (gaitOf). Ctrl wins over Shift.
//   walkBpm – MY Tempo (Jens, 11 Nov 2026; t846u: the global clock is gone, everyone has their own
//           BPM): 30…2880 BPM, default 90, grid slider ("Tempo" on Steps). Per player (this field, in my
//           personal run-mode settings) – there is no room / city / global clock. EVERYTHING musical of
//           mine follows it: my footsteps (shared/groove.mjs), all my sequencer layers incl. the walk
//           sound's, the four voices, the synced delay, my voice echo and my dance. Others hear / see me
//           at it (shared/playertempo.mjs). Run / crouch tempo are % of it.
//           Since t881u it is one of the 120-BPM grid tempi (shared/tempogrid.mjs), 30 … 2880.
// Pure maths – shared by the web app (client/src/groove.js, soundui.js) and the unit tests.
import { TEMPOS, snapTempo, tempoIndex, tempoInfo, stepTempo, RATE_GRID } from './tempogrid.mjs';

export const RUN = Object.freeze({
  speed: 3.6,               // movement speed while Shift / Caps Lock run is on (controls.js): × walk speed – doubled from 1.8 (Jens t865u, 12 Nov 2026)
  sneakSpeed: 0.45,         // movement speed while Ctrl is held (sneak / crouch)
  tempoMin: -400, tempoMax: 400, tempoStep: 12.5, tempoDef: 100,
  crouchTempoDef: -50, crouchPitchDef: -2, // sneak: 2:3 of the walk step rate, a fourth down
  pitchDown: [-3, -5, -8, -10, -12],        // semitones, steps 1…5 below (pentatonic: A G E D C)
  pitchUp: [2, 4, 7, 9, 12, 14, 16, 19],    // semitones, steps 1…8 above (D E G A C D E G)
  pitchDef: 3,              // step index: +7 st (fifth)
  ratios: Object.freeze([[1, 3], [1, 2], [2, 3], [1, 1], [3, 2], [2, 1], [3, 1]]),
  lockDef: false,           // dormant: always off now (see the header)
  walkMin: 30, walkMax: 2880, walkDef: 90, // my Tempo, BPM (inclusive range = the 120-BPM grid's ends, t881u; was 3000)
  key: 'klibb.runMode',     // sessionStorage (personal sound setting, like the groove scale)
});
export const RUN_DEFAULTS = Object.freeze({ tempo: RUN.tempoDef, pitch: RUN.pitchDef, lock: RUN.lockDef, walkBpm: RUN.walkDef, crouchTempo: RUN.crouchTempoDef, crouchPitch: RUN.crouchPitchDef });
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Tempo (BPM): clamped to 30…2880 (the grid's ends), 0.1 BPM resolution – a general clamp; slider / saved values use snapWalkBpm.
export function cleanWalkBpm(b) {
  if (!isNum(b)) return RUN.walkDef;
  return Math.round(Math.min(RUN.walkMax, Math.max(RUN.walkMin, b)) * 10) / 10;
}
// My Tempo as set on the slider / saved (Jens t881u, 12 Nov 2026 – was 5 BPM steps, t868u): the nearest tempo of
// the 120-BPM grid (shared/tempogrid.mjs TEMPOS: 120 × small ratios – octaves, triplets, polyrhythms – 30 … 2880),
// so everybody's beats meet on the shared clock. Old saved values snap (475 → 480 · 4:1, 92 → 90 · 3:4).
// cleanWalkBpm above stays the general clamp for tempi that are not a slider value.
export function snapWalkBpm(b) { return snapTempo(cleanWalkBpm(b)); }
// The Tempo slider is one notch per grid tempo: knob 0 = 30 BPM, 1 = 2880 BPM (the list's ends), evenly spaced
// by index (the list itself is roughly logarithmic). WALK_KNOB_STEPS = the range input's max (last index).
export const WALK_KNOB_STEPS = TEMPOS.length - 1;
export const walkBpmToKnob = (b) => tempoIndex(snapWalkBpm(b)) / WALK_KNOB_STEPS;
export const knobToWalkBpm = (k) => TEMPOS[Math.round(Math.min(1, Math.max(0, isNum(k) ? k : 0)) * WALK_KNOB_STEPS)].bpm;
export const walkBpmLabel = (b) => { const t = tempoInfo(snapWalkBpm(b)); return `${t.bpm} BPM · ${t.ratio}`; }; // '180 BPM · 3:2' (ratio to 120)
// One notch up / down the grid (arrow keys; Page Up / Down = TEMPO_PAGE notches).
export const stepWalkBpm = (b, d) => stepTempo(snapWalkBpm(b), d);
export const TEMPO_PAGE = 8;

export function cleanTempo(p, def = RUN.tempoDef) {
  if (!isNum(p)) return def;
  const c = Math.min(RUN.tempoMax, Math.max(RUN.tempoMin, p));
  return Math.round(c / RUN.tempoStep) * RUN.tempoStep;
}
export const pitchMin = -RUN.pitchDown.length, pitchMax = RUN.pitchUp.length;
export function cleanPitch(i, def = RUN.pitchDef) { return isNum(i) ? Math.min(pitchMax, Math.max(pitchMin, Math.round(i))) : def; }
export const cleanCrouchTempo = (p) => cleanTempo(p, RUN.crouchTempoDef);
export const cleanCrouchPitch = (i) => cleanPitch(i, RUN.crouchPitchDef);
// lock is always false now (an old saved `lock: true` is dropped – it is what made the slider look dead).
export function cleanRun(r) {
  if (!r || typeof r !== 'object') return { ...RUN_DEFAULTS };
  return { tempo: cleanTempo(r.tempo), pitch: cleanPitch(r.pitch), lock: false, walkBpm: snapWalkBpm(r.walkBpm), crouchTempo: cleanCrouchTempo(r.crouchTempo), crouchPitch: cleanCrouchPitch(r.crouchPitch) };
}

// Every rate a run / crouch tempo notch can give, as an exact fraction: (8 + k):8 and 8:(8 + k), k = 0 … 32 (t881u).
// snapRate: the nearest of them (log space) – a peer's rate arrives rounded to 6 digits (8/11 → 0.727273); on a
// grid anchored at server time 0 (~1.8e12 ms) that rounding alone would put their steps off the beat, so it is
// snapped back to the exact ratio before it is used.
export { RATE_GRID };
export function snapRate(r) {
  if (!isNum(r) || r <= 0) return 1;
  const l = Math.log(r); let best = 1, bd = Infinity;
  for (const v of RATE_GRID) { const e = Math.abs(Math.log(v) - l); if (e < bd - 1e-12) { bd = e; best = v; } }
  return best;
}
// Tempo slider % → raw step-rate factor (before lock-to-clock).
export function tempoRate(p) { const c = cleanTempo(p); return c >= 0 ? 1 + c / 100 : 1 / (1 + -c / 100); }
// The exact ratio of a tempo % (every 12.5 % notch is (8 + k):8 or 8:(8 + k), reduced): +37.5 % = 11:8.
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
export function tempoRatio(p) {
  const c = cleanTempo(p), k = Math.round(Math.abs(c) / 12.5);
  let num = c >= 0 ? 8 + k : 8, den = c >= 0 ? 8 : 8 + k; const g = gcd(num, den); num /= g; den /= g;
  return { num, den };
}
// The nearest clean ratio (in log space, i.e. musically). Returns { num, den, rate }.
export function snapRatio(rate) {
  let best = RUN.ratios[3], bd = Infinity;
  for (const [n, d] of RUN.ratios) { const e = Math.abs(Math.log(rate) - Math.log(n / d)); if (e < bd - 1e-12) { bd = e; best = [n, d]; } }
  return { num: best[0], den: best[1], rate: best[0] / best[1] };
}
// What the step grid uses while running: rate (× the walk pulse rate) and the ratio label.
// (lock-to-clock is dormant: always the free rate, which is itself an exact ratio – see tempoRatio.)
// { lock: true } = the old snap to 7 ratios (kept for tests / a future explicit "Lock to clock" switch).
export function runRate(r, { lock = false } = {}) {
  const c = cleanRun(r), raw = tempoRate(c.tempo);
  return lock ? snapRatio(raw) : { rate: raw, ...tempoRatio(c.tempo) };
}
// Sneak (Ctrl): the same maths on crouchTempo.
export function crouchRate(r) {
  const c = cleanRun(r);
  return { rate: tempoRate(c.crouchTempo), ...tempoRatio(c.crouchTempo) };
}
// Which gait my steps use: 'crouch' (Ctrl), 'run' (Shift) or 'walk'. Moving OR dancing (Jens, 11 Nov
// 2026: dance + Shift = run tempo, dance + Ctrl = crouch tempo). Ctrl wins over Shift.
export function gaitOf({ moving = false, dancing = false, shift = false, ctrl = false } = {}) {
  if (!moving && !dancing) return 'walk';
  return ctrl ? 'crouch' : shift ? 'run' : 'walk';
}
// What groove.setRun / radio.setWalk get for a gait: { rate, tune } or null (walking).
export function gaitStep(gait, r) {
  const c = cleanRun(r);
  if (gait === 'run') return { rate: runRate(c).rate, tune: pitchRatio(c.pitch) };
  if (gait === 'crouch') return { rate: crouchRate(c).rate, tune: pitchRatio(c.crouchPitch) };
  return null;
}
// Pitch slider step → semitones and the shown %.
export function pitchSemitones(i) { const c = cleanPitch(i); return c === 0 ? 0 : c > 0 ? RUN.pitchUp[c - 1] : RUN.pitchDown[-c - 1]; }
export function pitchPercent(i) { const c = cleanPitch(i); return c >= 0 ? c * (200 / pitchMax) : c * (200 / -pitchMin); }
export const pitchRatio = (i) => Math.pow(2, pitchSemitones(i) / 12);
const INTERVALS = { 0: 'same', 2: 'tone', 4: 'third', 7: 'fifth', 9: 'sixth', 12: 'octave', 14: 'octave + tone', 16: 'octave + third', 19: 'octave + fifth', 3: 'minor third', 5: 'fourth', 8: 'minor sixth', 10: 'minor seventh' };
export function pitchLabel(i) {
  const st = pitchSemitones(i), pc = pitchPercent(i);
  const name = INTERVALS[Math.abs(st)] || '';
  return `${pc > 0 ? '+' : ''}${Math.round(pc)}% · ${st > 0 ? '+' : ''}${st} st${st ? ` (${name} ${st > 0 ? 'up' : 'down'})` : ''}`;
}
export function tempoPctLabel(p) {
  const c = cleanTempo(p), { num, den } = tempoRatio(c);
  return `${c > 0 ? '+' : ''}${c % 1 ? c.toFixed(1) : c}% · ${num}:${den}`;
}
export function tempoLabel(r) { return tempoPctLabel(cleanRun(r).tempo); }
export function crouchTempoLabel(r) { return tempoPctLabel(cleanRun(r).crouchTempo); }

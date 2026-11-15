// Sound themes (Jens, 15 Nov 2026 voice call: "Spara nuvarande ljudinställningar som Tema A … skapa en ny setup
// som heter Tema B … kontrollera ton och takt mycket hårdare"). A theme is a thin layer OVER the existing sound
// settings – it never rewrites a saved patch or the saved run mode, it only changes how they are played:
//   A – "Theme A": everything exactly as before (every hook below is the identity for A).
//   B – "Theme B": tight pitch and timing.
//       · Tempo: only 60 · 90 · 120 · 180 BPM (straight relations of 90 and 120: 2:3, 3:4, 1:2, 3:2, 2:1 – no
//         5:4 / 7:4 / 8:5 polyrhythm tempi). My Tempo snaps to the nearest of them, and so does my run / crouch
//         tempo (my Tempo × the run / crouch rate → the nearest allowed tempo, so Shift / Ctrl land on 60…180 too).
//       · Footstep polyrhythm: the slot patterns are only 4 or 3 pulses a bar (4/4 and 3/4; the 5 / 6 / 7 slots
//         play 4 / 3 / 4). Groove scale: octaves only (½×, 1×, 2× … – a straight double / half time).
//       · Pitch: one fixed frequency per step – no per-play wobble, no left/right-foot detune, no run / crouch pitch
//         correction, no Sightline sneak pitch, no pitch sweep / detune / LFOs / nested mods on the Steps sound; every
//         Steps layer's frequency is quantized to A minor pentatonic (A C D E G = the run-pitch ladder's C major
//         pentatonic – no semitone clashes).
//       · Off: NPC "Wild" presses (NPC_WILD), the Wild button in Sound settings, the dance lines (Highline → hold,
//         Widthline → drive).
// Pure maths – the web app (client/src/soundtheme.js keeps my choice) and the tests share it.
import { TEMPO_GRID } from './tempogrid.mjs';
import { snapWalkBpm } from './runmode.mjs';
import { cleanScale } from './groove.mjs';

export const THEME = Object.freeze({ key: 'klibb.soundTheme', def: 'A' });
const T = (o) => Object.freeze(o);
export const THEMES = T({
  A: T({ id: 'A', label: 'Theme A', blurb: 'The sound as it was: free tempo grid, polyrhythm, wobble and Wild.',
    tempi: null, gaitSnap: false, gaitTune: true, wobble: true, footTune: true, sightPitch: true, danceLines: true,
    npcWild: true, wildButton: true, slotPulses: null, octaveScale: false, stepPitch: null }),
  B: T({ id: 'B', label: 'Theme B', blurb: 'Tight: 60 · 90 · 120 · 180 BPM, 4/4 and 3/4, one fixed pitch per step (A minor pentatonic), no wobble.',
    tempi: T([60, 90, 120, 180]), gaitSnap: true, gaitTune: false, wobble: false, footTune: false, sightPitch: false, danceLines: false,
    npcWild: false, wildButton: false, slotPulses: T([4, 3]), octaveScale: true, stepPitch: 'pentatonic' }),
});
export const THEME_IDS = Object.freeze(Object.keys(THEMES));
export const cleanThemeId = (id) => (typeof id === 'string' && THEMES[id] ? id : THEME.def);
export const themeOf = (id) => (id && typeof id === 'object' && THEMES[id.id] === id ? id : THEMES[cleanThemeId(id)]);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const nearestLog = (v, list) => { let best = list[0], bd = Infinity; const l = Math.log(v); for (const x of list) { const e = Math.abs(Math.log(x) - l); if (e < bd - 1e-12) { bd = e; best = x; } } return best; };

// My Tempo as the theme plays it (A: the 120-BPM grid as before).
export function themeWalkBpm(bpm, theme) {
  const th = themeOf(theme), b = snapWalkBpm(bpm);
  return th.tempi ? nearestLog(b, th.tempi) : b;
}
// The run / crouch step ({ rate, tune } | null, shared/runmode.mjs gaitStep) as the theme plays it.
// B: rate → (the allowed tempo nearest walkBpm × rate) / walkBpm, tune → 1 (no pitch correction).
export function themeGaitStep(step, walkBpm, theme) {
  const th = themeOf(theme);
  if (!step || th.id === 'A') return step;
  let { rate, tune } = step;
  if (th.gaitSnap && th.tempi) { const w = themeWalkBpm(walkBpm, th), to = nearestLog(w * rate, th.tempi); rate = exactRatio(to, w); }
  if (!th.gaitTune) tune = 1;
  return { rate, tune };
}
// a / b as the exact double of the reduced fraction (120 / 90 → 4 / 3).
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
function exactRatio(a, b) { if (Number.isInteger(a) && Number.isInteger(b)) { const g = gcd(a, b); return (a / g) / (b / g); } return a / b; }
// The rates a theme's gait can produce (B: every ratio between two allowed tempi) – shared/runmode.mjs snapRate
// keeps them exact when they come back from the network (4:3 and 3:4 are not on the (8 + k):8 notch grid).
export const THEME_RATES = Object.freeze((() => {
  const out = new Set();
  for (const th of Object.values(THEMES)) if (th.tempi) for (const a of th.tempi) for (const b of th.tempi) out.add(exactRatio(a, b));
  return [...out].sort((x, y) => x - y);
})());

// The footstep polyrhythm: which slot pattern a walker plays (shared/groove.mjs PATTERNS: slot 0…4 = 4, 3, 5, 6, 7
// pulses). B: only 4 or 3 pulses – slot 2 (5) → 0 (4), 3 (6) → 1 (3), 4 (7) → 0 (4).
const SLOT_TO_43 = [0, 1, 0, 1, 0];
export function themeSlot(slot, theme) {
  const th = themeOf(theme), s = Number(slot) | 0;
  if (!th.slotPulses) return s;
  return SLOT_TO_43[((s % 5) + 5) % 5];
}
// Groove scale: B keeps it on octaves (½×, 1×, 2×, …).
export function themeScale(scale, theme) {
  const th = themeOf(theme), s = cleanScale(scale) ?? 1;
  if (!th.octaveScale) return s;
  return cleanScale(2 ** Math.round(Math.log2(s))) ?? 1;
}
// The per-play pitch wobble (client/src/sound.js) and the left/right-foot detune (groove.js): 1 when off.
export const themeWobble = (theme, w) => (themeOf(theme).wobble ? w : 1);
export const themeFootTune = (theme, t) => (themeOf(theme).footTune ? t : 1);

// ---------- Pitch: a shared scale ----------
// A minor pentatonic = C major pentatonic: pitch classes A C D E G (semitones above A: 0 3 5 7 10).
export const PENTATONIC = Object.freeze([0, 3, 5, 7, 10]);
// The nearest pentatonic note (A4 = 440 Hz), as Hz (2 decimals, like snapFreq).
export function quantizeHz(hz, scale = PENTATONIC) {
  if (!isNum(hz) || hz <= 0) return hz;
  const m = 12 * Math.log2(hz / 440), base = Math.floor(m / 12) * 12;
  let best = null, bd = Infinity;
  for (const o of [-12, 0, 12]) for (const pc of scale) { const n = base + o + pc, e = Math.abs(n - m); if (e < bd - 1e-9) { bd = e; best = n; } }
  return Number((440 * 2 ** (best / 12)).toFixed(2));
}
// The Steps patch as the theme plays it (after the step's locks and the gait / wobble retune). A: the same object.
// 'pentatonic': no pitch sweep, no detune, no layer LFO, no mods (free-running LFOs = a different pitch / colour
// each step), every layer's frequency on A minor pentatonic (≤ 8000 Hz, the osc's range).
export function themeStepPatch(patch, theme) {
  const th = themeOf(theme);
  if (!patch || !th.stepPitch) return patch;
  const layers = patch.layers.map((l) => ({ ...l, freq: Math.min(8000, quantizeHz(l.freq)), detune: 0, pitchAmt: 0, lfo: 'none', lfoDepth: 0 }));
  const out = { ...patch, layers };
  delete out.mods;
  return out;
}
// The tempo choices a theme offers on the Tempo slider (null = the whole grid, shared/tempogrid.mjs TEMPOS).
export const themeTempi = (theme) => themeOf(theme).tempi;
export const themeLabel = (theme) => themeOf(theme).label;
export { TEMPO_GRID };

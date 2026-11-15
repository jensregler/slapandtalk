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
//       · Others too (conformRemote): other players' and NPCs' tempi as I hear them go through the same rules
//         (tempo → 60…180, gait → an allowed tempo, no pitch correction, Groove on octaves), and every step I hear
//         gets the fixed pentatonic pitch.
//   C – "Theme C" (Jens, 15 Nov 2026: "staden utanför är totalt kaos – inga frekvenser lyssnar på varandra, allt är
//       snett, takterna har för mycket glapp … hacken gör det värre … håll tempot kring 120 och 90, använd bara de
//       tempo-variationer som redan finns och begränsa dem till 25 och 50 procent"): the whole city in one key and
//       on one clock – for EVERYTHING I hear, not just my own sound.
//       · Tempo: 90 or 120 BPM (mine; other players' and NPCs' as I hear them snap to the nearer one too).
//       · Run / crouch tempo: the existing −400 … +400 % tempo variation, limited to ±25 % and ±50 % (0 stays 0):
//         rates 2:3, 4:5, 1, 5:4, 3:2 – all exact notch ratios on the shared grid. Others' rates snap the same way.
//       · Footstep polyrhythm 4/4 and 3/4 only (as B), Groove on octaves (also for others as I hear them).
//       · Pitch: every frequency I hear (Steps, Slap, Peel, Landing, sequencer loops; mine, others', NPCs') is
//         quantized to A minor pentatonic; no detune, no pitch LFOs (vibrato) – pitch mods get depth 0. Pitch sweeps,
//         cutoff / volume LFOs and the run / crouch pitch correction (itself pentatonic) stay; they land in key.
//       · Off: the per-play wobble and the left/right-foot detune (the little "hack"), NPC Wild presses.
//         The Wild button and the dance lines stay (they are deliberate, and land in key / on the clock).
// The theme is the ROOM's (Jens, 15 Nov 2026: "alla har samma tema"): one per room / city, kept by the server
// (server/app.js PUT /api/rooms/:room/soundtheme, room.soundTheme), the same for everybody in it.
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
    npcWild: false, wildButton: false, slotPulses: T([4, 3]), octaveScale: true, stepPitch: 'pentatonic', conformRemote: true }),
  C: T({ id: 'C', label: 'Theme C', blurb: 'One key, one clock: 90 / 120 BPM, run / crouch ±25 / ±50 %, everything I hear on A minor pentatonic.',
    tempi: T([90, 120]), gaitSnap: false, gaitPct: T([-50, -25, 0, 25, 50]), gaitTune: true, wobble: false, footTune: false, sightPitch: true, danceLines: true,
    npcWild: false, wildButton: true, slotPulses: T([4, 3]), octaveScale: true, stepPitch: 'scale', allKinds: true, conformRemote: true }),
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
  if (th.gaitPct) rate = pctRate(nearestPct(rateToPct(rate), th.gaitPct));
  if (th.gaitSnap && th.tempi) { const w = themeWalkBpm(walkBpm, th), to = nearestLog(w * rate, th.tempi); rate = exactRatio(to, w); }
  if (!th.gaitTune) tune = 1;
  return { rate, tune };
}
// The run / crouch tempo % ↔ rate (shared/runmode.mjs tempoRate: p ≥ 0 → 1 + p/100, p < 0 → 1 / (1 + |p|/100)).
const rateToPct = (r) => (r >= 1 ? (r - 1) * 100 : -(1 / r - 1) * 100);
const pctRate = (p) => (p >= 0 ? (100 + p) / 100 : 100 / (100 - p)); // exact for ±25 / ±50: 5/4, 3/2, 4/5, 2/3
const nearestPct = (p, list) => { let best = list[0], bd = Infinity; for (const x of list) { const e = Math.abs(x - p); if (e < bd - 1e-9) { bd = e; best = x; } } return best; };
// The run / crouch tempo % as the theme plays it (C: the nearest of −50 −25 0 +25 +50; A / B: unchanged).
export function themeGaitPct(p, theme) { const th = themeOf(theme); return th.gaitPct && isNum(p) ? nearestPct(p, th.gaitPct) : p; }
// a / b as the exact double of the reduced fraction (120 / 90 → 4 / 3).
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
function exactRatio(a, b) { if (Number.isInteger(a) && Number.isInteger(b)) { const g = gcd(a, b); return (a / g) / (b / g); } return a / b; }
// The rates a theme's gait can produce (B: every ratio between two allowed tempi) – shared/runmode.mjs snapRate
// keeps them exact when they come back from the network (4:3 and 3:4 are not on the (8 + k):8 notch grid).
export const THEME_RATES = Object.freeze((() => {
  const out = new Set();
  for (const th of Object.values(THEMES)) {
    if (th.gaitSnap && th.tempi) for (const a of th.tempi) for (const b of th.tempi) out.add(exactRatio(a, b));
    if (th.gaitPct) for (const p of th.gaitPct) out.add(pctRate(p));
  }
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
  if (th.stepPitch === 'scale') return themeScalePatch(patch);
  const layers = patch.layers.map((l) => ({ ...l, freq: Math.min(8000, quantizeHz(l.freq)), detune: 0, pitchAmt: 0, lfo: 'none', lfoDepth: 0 }));
  const out = { ...patch, layers };
  delete out.mods;
  return out;
}
// Someone else's tempo ({ bpm, scale, rate, tune }, shared/playertempo.mjs) as I hear it (conformRemote themes):
// the same rules as my own – bpm on the theme's tempi, the gait rate onto an allowed tempo, no pitch correction where
// the theme has none, Groove on octaves. (With one theme per room their own client already sends it like this; this
// keeps NPCs – seeded on the server – and a stale client in line too.) A: the same object.
export function themeRemoteTempo(t, theme) {
  const th = themeOf(theme);
  if (!th.conformRemote || !t) return t;
  const bpm = th.tempi ? nearestLog(t.bpm, th.tempi) : t.bpm;
  let rate = t.rate;
  if (th.gaitPct) rate = pctRate(nearestPct(rateToPct(rate), th.gaitPct)); // (Theme C: ±25 / ±50 %)
  if (th.gaitSnap && th.tempi) rate = exactRatio(nearestLog(bpm * rate, th.tempi), bpm);
  return { ...t, bpm, rate, tune: th.gaitTune ? t.tune : 1, scale: th.octaveScale ? themeScale(t.scale, th) : t.scale };
}
// 'scale' (Theme C): in key, not frozen – every layer's frequency on A minor pentatonic, no detune, no pitch LFO
// (a pitch-targeted layer LFO becomes 'none'); mods on a pitch (L<i>.freq / .detune / .note) get depth 0 (the rest –
// cutoff, level, gain, nesting – keeps running). Pitch sweeps stay (they start and end in key).
const PITCH_MOD = /^L\d\.(freq|detune|note)$/;
export function themeScalePatch(patch) {
  if (!patch || !Array.isArray(patch.layers)) return patch;
  const layers = patch.layers.map((l) => ({ ...l, freq: Math.min(8000, quantizeHz(l.freq)), detune: 0, ...(l.lfo === 'pitch' ? { lfo: 'none', lfoDepth: 0 } : {}) }));
  const out = { ...patch, layers };
  if (Array.isArray(patch.mods)) out.mods = patch.mods.map((m) => (PITCH_MOD.test(m.to) ? { ...m, depth: 0 } : m));
  return out;
}
// Any sound as the theme plays it (Theme C: every kind is put in key; A / B: only Steps are touched – themeStepPatch).
export function themeAnyPatch(patch, kind, theme) {
  const th = themeOf(theme);
  if (kind === 'step') return themeStepPatch(patch, th);
  return th.allKinds ? themeScalePatch(patch) : patch;
}
// The tempo choices a theme offers on the Tempo slider (null = the whole grid, shared/tempogrid.mjs TEMPOS).
export const themeTempi = (theme) => themeOf(theme).tempi;
export const themeLabel = (theme) => themeOf(theme).label;
export { TEMPO_GRID };

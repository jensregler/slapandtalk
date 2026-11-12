// A player's tempo as the room hears and sees it (Jens, 11 Nov 2026 t846u: no global clock – everyone
// has their own BPM, and you hear / see the others at THEIR tempo, not yours).
// Sent by the player whenever it changes ('tempo' message, server/realtime.js keeps the latest per
// player and hands it to late joiners in welcome.players / join), never per step:
//   bpm   – their Tempo (shared/runmode.mjs walkBpm, 30…2880 BPM on the 120-BPM grid, default 90)
//   scale – their Groove (shared/groove.mjs scale, 1/64…8, default 1): footstep bar = 2 beats × scale
//   rate  – their step-rate factor right now: 1 walking, the run / crouch tempo while Shift / Ctrl
//           (shared/runmode.mjs gaitStep), 1/5…5
//   tune  – their run / crouch pitch correction right now (a frequency ratio, 1 = none)
// Pure maths; the server keeps its own copy of the limits (server/realtime.js cleanTempoMsg – the
// tests check they agree).
import { RUN, snapWalkBpm, snapRate } from './runmode.mjs';
import { GROOVE, cleanScale } from './groove.mjs';

export const PLAYER_TEMPO = Object.freeze({ minRate: 0.2, maxRate: 5, minTune: 0.25, maxTune: 4, sendMs: 120 });
export const PLAYER_TEMPO_DEFAULTS = Object.freeze({ bpm: RUN.walkDef, scale: GROOVE.def, rate: 1, tune: 1 });
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const sig = (v) => Number(v.toPrecision(6));
const range = (v, lo, hi, def) => (isNum(v) && v > 0 ? sig(Math.min(hi, Math.max(lo, v))) : def);

export function cleanPlayerTempo(t) {
  const d = PLAYER_TEMPO_DEFAULTS;
  if (!t || typeof t !== 'object') return { ...d };
  return {
    // t881u: bpm on the 120-BPM grid (shared/tempogrid.mjs), Groove on its scale grid, rate the exact run / crouch
    // ratio – so a peer's steps and dance land on the shared beat (no 6-digit rounding drift at ~1.8e12 ms).
    bpm: isNum(t.bpm) ? snapWalkBpm(t.bpm) : d.bpm,
    scale: cleanScale(t.scale) ?? d.scale,
    rate: isNum(t.rate) && t.rate > 0 ? snapRate(Math.min(PLAYER_TEMPO.maxRate, Math.max(PLAYER_TEMPO.minRate, t.rate))) : d.rate,
    tune: range(t.tune, PLAYER_TEMPO.minTune, PLAYER_TEMPO.maxTune, d.tune),
  };
}
export const sameTempo = (a, b) => { const x = cleanPlayerTempo(a), y = cleanPlayerTempo(b); return x.bpm === y.bpm && x.scale === y.scale && x.rate === y.rate && x.tune === y.tune; };
// The tempo a player's dance animation runs at: their Tempo × their step rate right now (run / crouch).
export const danceBpmOf = (t) => { const c = cleanPlayerTempo(t); return c.bpm * c.rate; }; // exact (t881u): grid tempo × exact rate
// My tempo message from my Tempo, Groove and gait step ({ rate, tune } | null while walking).
export const myPlayerTempo = (bpm, scale, step = null) => cleanPlayerTempo({ bpm, scale, rate: step && step.rate > 0 ? step.rate : 1, tune: step && step.tune > 0 ? step.tune : 1 });

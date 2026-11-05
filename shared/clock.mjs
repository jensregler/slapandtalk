// The master clock (Jens, 5 Nov 2026): ONE tempo everything musical locks to – 90 BPM, 4/4.
//   the four voices (shared/radio.mjs), sequencer layers (shared/synth.mjs seq), the delay's sync
//   values (SYNTH.bpm) and the footstep groove (its bar at 1.0× = 2 beats = 1333 ms, so the walkers'
//   3/4/5/6/7-pulse polyrhythm sits on the same grid) all count from it.
// Time = the server-corrected wall clock (ms, groove.now()) – the same in every browser – turned
// into AudioContext time by a lookahead scheduler (client/src/radio.js), never by setInterval.
//
// Rooms are slightly off (t531 "rooms 1 and 4 may differ only slightly"): every room code gets a
// small, deterministic tempo nudge (±0.3 BPM) and phase shift (0–12 ms) from its hash, so two rooms
// or houses heard together almost – but not quite – line up. 'stad' (the City) is exactly 90.
import { hashSeed } from './synth.mjs';

export const MASTER = Object.freeze({ bpm: 90, beatsPerBar: 4, maxNudgeBpm: 0.3, maxPhaseMs: 12 });
export const beatMs = (bpm = MASTER.bpm) => 60000 / bpm;
export const barMsAt = (bpm = MASTER.bpm) => beatMs(bpm) * MASTER.beatsPerBar;
export function roomTempo(room) {
  const id = String(room || 'stad');
  if (id === 'stad') return { bpm: MASTER.bpm, phaseMs: 0 };
  const h = hashSeed('tempo:' + id), h2 = hashSeed('phase:' + id);
  const nudge = ((h % 2001) / 1000 - 1) * MASTER.maxNudgeBpm;      // −0.3 … +0.3 BPM, 0.0003 steps
  const phaseMs = (h2 % 1201) / 100;                                // 0 … 12 ms
  return { bpm: +(MASTER.bpm + nudge).toFixed(4), phaseMs: +phaseMs.toFixed(2) };
}
// Where the clock is at wall time t (ms): in bars since the epoch (not wrapped).
export const barsAtTime = (t, tempo = { bpm: MASTER.bpm, phaseMs: 0 }) => (t - tempo.phaseMs) / barMsAt(tempo.bpm);
export const timeOfBar = (bars, tempo = { bpm: MASTER.bpm, phaseMs: 0 }) => bars * barMsAt(tempo.bpm) + tempo.phaseMs;
// Every step of a loop of `steps` steps per `bars` bars with from ≤ t < to: [{ t, n (absolute), i (0…steps-1) }].
export function loopSteps(from, to, { steps, bars = 1, tempo, max = 256 }) {
  const out = []; if (!(to > from) || !(steps > 0)) return out;
  const per = bars / steps; // bars per step
  for (let n = Math.ceil(barsAtTime(from, tempo) / per - 1e-9); out.length < max; n++) {
    const t = timeOfBar(n * per, tempo); if (t >= to) break; if (t < from) continue;
    out.push({ t, n, i: ((n % steps) + steps) % steps });
  }
  return out;
}

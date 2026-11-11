// Tempo maths (Jens, 11 Nov 2026 t846u: "ta bort den globala klockan helt och hållet. alla har sin egen bpm").
// There is NO room / master / global clock any more. Every player has their own tempo – the Tempo
// slider on Steps (shared/runmode.mjs walkBpm, 30–3000 BPM, default 90) – and everything musical of
// theirs counts from it: footsteps (shared/groove.mjs, bar = 2 beats × Groove), the walk-sound and other
// sequencer layers and the four voices (client/src/radio.js), the synced delay (shared/synth.mjs
// delaySeconds), the voice echo (client/src/voice.js) and the dance (shared/dance.mjs). Other players
// are heard / seen at THEIR tempo (sent as 'tempo' / 'dance' messages, server/realtime.js).
// Time = the server-corrected wall clock (ms, groove.now()) – only so a remote player's steps and dance
// land at the same moment on every screen; it is a time base, not a tempo. The grid of a tempo is
// anchored at wall time 0 (phaseMs 0) – no per-room nudge or phase shift any more (roomTempo is gone).
// MASTER is only the defaults (90 BPM, 4/4) used when a tempo is missing – it drives nothing by itself.
import { cleanWalkBpm } from './runmode.mjs';

export const MASTER = Object.freeze({ bpm: 90, beatsPerBar: 4 });
export const beatMs = (bpm = MASTER.bpm) => 60000 / bpm;
export const barMsAt = (bpm = MASTER.bpm) => beatMs(bpm) * MASTER.beatsPerBar;
// A player's tempo as the schedulers use it: { bpm (30…3000), phaseMs: 0 }.
export const playerTempo = (bpm) => ({ bpm: cleanWalkBpm(bpm), phaseMs: 0 });
// Where a tempo's grid is at wall time t (ms): in bars since the epoch (not wrapped).
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

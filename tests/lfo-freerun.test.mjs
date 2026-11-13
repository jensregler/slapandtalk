// Free-running Steps LFOs (Jens t899u): the LFO must not restart with the sequencer.
// Two consecutive triggers continue the same cycle; a rate change (p-lock) does not jump the phase.
import { wrapPhase, advanceLfoPhase, voiceLfoPhases, evalMods, waveAt } from '../shared/lfo.mjs';

const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

assert(wrapPhase(0) === 0 && wrapPhase(1) === 0 && wrapPhase(1.25) === 0.25 && wrapPhase(-0.25) === 0.75
  && wrapPhase(4.0) === 0, 'wrapPhase folds any real into [0, 1)');

// ---------- Two consecutive triggers: phase continues, it does not reset to 0 ----------
{
  const rate = 5; // Hz
  const t0 = 0.13, t1 = t0 + 0.2; // 0.2 s later = exactly one cycle
  const a = advanceLfoPhase(null, rate, t0);
  const b = advanceLfoPhase(a, rate, t1);
  assert(near(a.phase, 0.65) && a.phase !== 0, `first trigger starts mid-cycle, not at 0 (got ${a.phase})`);
  assert(near(b.phase, a.phase), `one exact cycle later the phase is the same point, not 0 (got ${b.phase})`);
  const t2 = t0 + 0.05; // +0.25 of a cycle
  const c = advanceLfoPhase(a, rate, t2);
  assert(near(c.phase, wrapPhase(a.phase + rate * (t2 - t0))) && c.phase !== 0, `a later trigger continues the cycle and is not retrig at 0 (got ${c.phase}, want ${wrapPhase(a.phase + 0.25)})`);
}

// ---------- Rate change (p-lock) does not jump the phase ----------
{
  const t0 = 0.13, r0 = 5, r1 = 10;
  const a = advanceLfoPhase(null, r0, t0);
  const sameTime = advanceLfoPhase(a, r1, t0); // new rate, same instant
  assert(near(sameTime.phase, a.phase) && sameTime.rate === r1, 'changing the rate at the same time does not jump the phase');
  const later = advanceLfoPhase(sameTime, r1, t0 + 0.1);
  assert(near(later.phase, wrapPhase(a.phase + r1 * 0.1)), `after a rate change, phase accumulates at the new rate (got ${later.phase})`);
  const naive = wrapPhase((t0 + 0.1) * r1);
  assert(!near(later.phase, naive), `phase accumulation is not a naive (t × newRate) jump (accum ${later.phase} vs naive ${naive})`);
}

// ---------- Per-walker accumulators, and the whole step-sound voice helper ----------
{
  const patch = {
    layers: [
      { lfo: 'amp', lfoWave: 'sine', lfoRate: 4, lfoDepth: 0.5 },
      { lfo: 'pitch', lfoWave: 'square', lfoRate: 2, lfoDepth: 0.3 },
    ],
    mods: [
      { id: 'm1', to: 'G.gain', wave: 'sine', rate: 3, depth: 0.4, phase: 0.25 },
      { id: 'gate', to: 'G.gain', wave: 'gate', rate: 8, depth: 1, phase: 0.1, pattern: [1, 0] },
      { id: 'm2', to: 'L0.cutoff', wave: 'follow', src: 'mic', attack: 0.01, release: 0.2, gain: 4, thr: 0, invert: false, depth: 0.6, rate: 1, phase: 0 },
    ],
  };
  const acc = new Map();
  const t0 = 0.4, t1 = 0.55;
  const a = voiceLfoPhases(patch, t0, acc, 'me');
  const b = voiceLfoPhases(patch, t1, acc, 'me');
  assert(near(a.layers[0], wrapPhase(t0 * 4)) && near(a.layers[1], wrapPhase(t0 * 2)),
    'first voice: each layer LFO starts at (time × rate) mod 1, not 0');
  assert(near(a.mods[0], wrapPhase(t0 * 3 + 0.25)), 'mod LFO keeps its own start offset on first use');
  assert(a.mods[1] == null && a.mods[2] == null, 'the radio gate and envelope followers keep their own phase (not free-run)');

  assert(near(b.layers[0], wrapPhase(a.layers[0] + 4 * (t1 - t0))), 'layer 0 LFO continues across two sequencer steps');
  assert(near(b.layers[1], wrapPhase(a.layers[1] + 2 * (t1 - t0))), 'layer 1 LFO continues across two sequencer steps');
  assert(near(b.mods[0], wrapPhase(a.mods[0] + 3 * (t1 - t0))), 'patch-mod LFO continues across two sequencer steps');
  assert(b.layers[0] !== 0 && b.mods[0] !== 0, 'second step is not retriggered at phase 0');
}

{
  const acc = new Map();
  voiceLfoPhases({ layers: [{ lfoRate: 4 }] }, 0.4, acc, 'me');
  voiceLfoPhases({ layers: [{ lfoRate: 10 }] }, 0.4, acc, 'me'); // p-lock rate change, no time passes
  const me2 = voiceLfoPhases({ layers: [{ lfoRate: 10 }] }, 0.55, acc, 'me');
  const npc = voiceLfoPhases({ layers: [{ lfoRate: 4 }] }, 0.55, acc, 'npc:ada');
  assert(near(me2.layers[0], wrapPhase(0.4 * 4 + 10 * 0.15)) && near(npc.layers[0], wrapPhase(0.55 * 4)) && !near(npc.layers[0], me2.layers[0]),
    'another walker (NPC / other player) has its own LFO clock and does not share mine');
}

// ---------- evalMods curves start at the free-run phase, and line up at the next trigger ----------
{
  const rate = 4, t0 = 0.2, t1 = 0.45, dt = t1 - t0, blockRate = 200;
  const acc = new Map();
  const patch = { layers: [], mods: [{ id: 'm1', to: 'G.gain', wave: 'sine', rate, depth: 1, phase: 0 }] };
  const a = voiceLfoPhases(patch, t0, acc, 'me');
  const b = voiceLfoPhases(patch, t1, acc, 'me');
  const { curves, blocks, dt: d } = evalMods([{ ...patch.mods[0], phase: a.mods[0] }], { seconds: dt, blockRate });
  const startVal = waveAt('sine', a.mods[0]);
  const first = curves['G.gain'][0];
  // tremolo: 1 - 0.5*d + 0.5*o, d=1, o=wave*d → 0.5 + 0.5*wave
  assert(near(first, 0.5 + 0.5 * startVal, 1e-9), `evalMods starts at the free-run phase (curve ${first}, wave ${startVal})`);
  const lastI = blocks - 1;
  const phaseAtEnd = wrapPhase(a.mods[0] + rate * lastI * d);
  const last = curves['G.gain'][lastI];
  assert(near(last, 0.5 + 0.5 * waveAt('sine', phaseAtEnd), 1e-6), 'the curve has run continuously by the next trigger');
  assert(near(phaseAtEnd, b.mods[0], rate * d + 1e-9), 'the next voice starts where the previous LFO curve left off (within one control block)');
}

console.log('Alla LFO free-run-tester gick igenom.');

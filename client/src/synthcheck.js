// Offline render check (tests and curious people): every patch is rendered with Tone.Offline and
// measured. A patch passes when it is audible (peak > 0.01) and doesn't clip (peak < 1).
import { loadTone, SynthEngine } from './synth.js';
import { peelStepParams } from '../../shared/peelstep.mjs';
import { DEFAULT_PATCHES, SOUNDS, patchLength, cleanPatch, cleanFx, retune, duffScale, roomAcoustics } from '../../shared/synth.mjs';

// patches: { name: patch | { patch, fx, gain, rate, room } } (default: the five default sounds).
export async function offlineCheck(patches = null) {
  const Tone = await loadTone();
  const list = patches || Object.fromEntries(SOUNDS.map((k) => [k, DEFAULT_PATCHES[k]]));
  const out = {};
  for (const [name, v] of Object.entries(list)) {
    const spec = v && v.layers ? { patch: v } : v;
    const p = cleanPatch(spec.patch); if (!p) { out[name] = { ok: false, error: 'invalid' }; continue; }
    const fx = spec.fx ? cleanFx(spec.fx) : null;
    const tail = fx || p.fx || spec.room ? 1.5 : 0.15;
    const len = patchLength(p) + tail;
    const buf = await Tone.Offline(async () => {
      const eng = new SynthEngine(Tone);
      if (spec.room) await eng.setRoom(roomAcoustics(spec.room));
      if (fx || p.fx) { const c = eng.chain(p.fx || fx); await Promise.all((eng.chains.get(JSON.stringify(cleanFx(p.fx || fx)))?.nodes || []).map((n) => n.ready).filter(Boolean)); void c; }
      eng.play(retune(p, spec.rate || 1), { gain: spec.gain ?? 1, fx, time: 0.01, keep: true });
    }, len, 1, 44100);
    const d = buf.getChannelData(0);
    let peak = 0, sum = 0;
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; sum += d[i] * d[i]; }
    const rms = Math.sqrt(sum / d.length);
    out[name] = { ok: peak > 0.01 && peak < 1, peak: +peak.toFixed(4), rms: +rms.toFixed(5), seconds: +len.toFixed(2) };
  }
  return out;
}
// Listening samples (Jens): a short walk of footsteps, normal or on a peel, at a walking speed.
// specs: [{ name, onPeel, speed, steps = 6 }] → { name: { rate, data: number[] (mono, 44.1 kHz), peak, rms, paper } }.
// The step interval follows the speed (a stride of ~0.75 m), left/right like the groove (1.02 / 0.97).
export async function renderSteps(specs) {
  const Tone = await loadTone(), out = {};
  for (const sp of specs) {
    const n = sp.steps || 6, gap = Math.max(0.16, 0.75 / Math.max(0.6, sp.speed || 1.3)), len = n * gap + 0.4;
    const paper = sp.onPeel ? peelStepParams(sp.speed) : null;
    const buf = await Tone.Offline(async () => {
      const eng = new SynthEngine(Tone);
      for (let i = 0; i < n; i++) eng.play(retune(cleanPatch(DEFAULT_PATCHES.step), i % 2 ? 0.97 : 1.02), { gain: paper ? paper.gain : 1, time: 0.05 + i * gap, keep: true, pool: 'step', paper });
    }, len, 1, 44100);
    const d = buf.getChannelData(0); let peak = 0, sum = 0;
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; sum += d[i] * d[i]; }
    out[sp.name] = { rate: 44100, data: Array.from(d, (x) => Math.round(x * 1e5) / 1e5), peak: +peak.toFixed(4), rms: +Math.sqrt(sum / d.length).toFixed(5), paper };
  }
  return out;
}
export { duffScale };

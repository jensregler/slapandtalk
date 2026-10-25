// Offline render check (tests and curious people): every patch is rendered with Tone.Offline and
// measured. A patch passes when it is audible (peak > 0.01) and doesn't clip (peak < 1).
import { loadTone, SynthEngine } from './synth.js';
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
export { duffScale };

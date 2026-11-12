// The synth's AudioWorklet module (Jens, 5 Nov 2026) – two tiny processors, added once per context:
//   'klibb-decimator' (below) and 'klibb-mods': ALL the LFOs of one voice evaluated per sample
//   (shared/lfo.mjs compileMods + modRunner, the same code the tests run), one output per modulated
//   AudioParam. It idles until startAt (context seconds) and lets go after endAt.
// Decimation (Jens, 5 Nov 2026): a sample-and-hold downsampler + optional bit reduction – the grainy
// "cheap sampler / broken radio" sound. One tiny AudioWorklet processor; a layer with decim > 1 or
// crush > 0 gets ONE of these nodes (shared/synth.mjs). Cost: a compare and a copy per sample.
//   factor (a-rate, 1…256): read the input every `factor` samples, hold it in between (fractional
//                           factors accumulate, so an LFO on it sweeps smoothly)
//   bits   (k-rate, 0…16):  0 = off, else quantise to 2^bits levels
// The module is added from a Blob URL (no extra file to serve), once per AudioContext; until it is
// ready (the first ~50 ms) a decimated layer plays clean.
import { modRunner } from '../../shared/lfo.mjs';
const MODS_SRC = `
const modRunner = (${modRunner.toString()});
class Mods extends AudioWorkletProcessor {
  constructor(o) { super(); const p = o.processorOptions || {}; this.prog = p.prog; this.r = modRunner(p.prog, sampleRate); this.startAt = p.startAt || 0; this.endAt = p.endAt || 1e9; this.no = p.prog.outs.length;
    this.ni = (p.prog.inputs || []).length; this.iv = new Float64Array(this.ni); this.fl = p.prog.list.map((m, j) => (m.wave === 5 ? [m.id, j] : null)).filter(Boolean); this.tick = 0; }
  process(inputs, outputs) {
    if (currentTime > this.endAt) return false;
    const n = outputs[0] ? outputs[0][0].length : 128, idle = currentTime + n / sampleRate < this.startAt, ni = this.ni, iv = this.iv;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < ni; k++) { const c = inputs[k] && inputs[k][0]; iv[k] = c ? c[i] : 0; }
      if (!idle) this.r.step(iv);
      for (let k = 0; k < this.no; k++) outputs[k][0][i] = idle ? 0 : this.r.out(k);
    }
    // the followers' envelopes for the editor's meter (~23 times a second)
    if (this.fl.length && !idle && ++this.tick % 16 === 0) { const e = {}; for (const [id, j] of this.fl) e[id] = this.r.env[j]; this.port.postMessage(e); }
    return true;
  }
}
registerProcessor('klibb-mods', Mods);
`;
export const DECIMATOR_SRC = MODS_SRC + `
class Decimator extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [
    { name: 'factor', defaultValue: 1, minValue: 1, maxValue: 256, automationRate: 'a-rate' },
    { name: 'bits', defaultValue: 0, minValue: 0, maxValue: 16, automationRate: 'k-rate' } ]; }
  constructor(o) { super(); this.held = [0, 0]; this.acc = [1e9, 1e9]; this.seen = false; this.born = currentTime; this.keep = !!o?.processorOptions?.keep; }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    // no input: wait (up to 3 s for a layer that starts later), and after the voice is gone let go
    if (!inp || !inp.length) { if (this.keep) { for (const y of out) y.fill(0); return true; } return !this.seen && currentTime - this.born < 3; } // keep: a long-lived node
    this.seen = true;
    const f = params.factor, bits = params.bits[0], q = bits > 0 ? Math.pow(2, Math.round(bits) - 1) : 0;
    for (let c = 0; c < out.length; c++) {
      const x = inp[c] || inp[0], y = out[c]; let h = this.held[c] || 0, a = this.acc[c] || 1e9;
      for (let i = 0; i < y.length; i++) {
        const n = f.length > 1 ? f[i] : f[0];
        if (++a >= n) { a -= n; if (a >= n) a = 0; h = q ? Math.round(x[i] * q) / q : x[i]; }
        y[i] = h;
      }
      this.held[c] = h; this.acc[c] = a;
    }
    return true;
  }
}
registerProcessor('klibb-decimator', Decimator);
`;
// tctx: a Tone context (its rawContext may be a standardized-audio-context wrapper, so the node is
// made through tctx.createAudioWorkletNode). The module goes straight to audioWorklet.addModule:
// Tone's own addAudioWorkletModule keeps only ONE module promise (its BitCrusher's).
const ready = new WeakMap(); // raw context → Promise<boolean>
export function ensureDecimator(tctx) {
  const raw = tctx?.rawContext; if (!raw) return Promise.resolve(false);
  if (ready.has(raw)) return ready.get(raw);
  let p;
  if (!raw.audioWorklet) p = Promise.resolve(false);
  else {
    const url = URL.createObjectURL(new Blob([DECIMATOR_SRC], { type: 'application/javascript' }));
    p = raw.audioWorklet.addModule(url).then(() => { raw.__decimator = true; return true; }, (e) => { console.warn('decimator', e); return false; });
  }
  ready.set(raw, p); return p;
}
export const decimatorReady = (tctx) => !!(tctx?.rawContext?.__decimator);
// One 'klibb-mods' node for a voice's compiled LFO program (null if the worklet isn't ready).
export function makeMods(tctx, prog, startAt, endAt) {
  if (!decimatorReady(tctx) || !prog.outs.length) return null;
  try {
    return tctx.createAudioWorkletNode('klibb-mods', { numberOfInputs: (prog.inputs || []).length, numberOfOutputs: prog.outs.length, outputChannelCount: prog.outs.map(() => 1), channelCount: 1, channelCountMode: 'explicit', processorOptions: { prog, startAt, endAt } });
  } catch (e) { console.warn('mods node', e); return null; }
}
export function makeDecimator(tctx, factor = 1, bits = 0, { keep = false, channels = 1 } = {}) {
  if (!decimatorReady(tctx)) return null;
  try {
    const n = tctx.createAudioWorkletNode('klibb-decimator', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [channels], parameterData: { factor, bits }, processorOptions: { keep } });
    return n;
  } catch (e) { console.warn('decimator node', e); return null; }
}
// The same maths in plain JS (tests, and to show what the worklet does).
export function decimate(x, factor, bits = 0) {
  const y = new Float32Array(x.length), q = bits > 0 ? Math.pow(2, Math.round(bits) - 1) : 0;
  let h = 0, a = 1e9;
  for (let i = 0; i < x.length; i++) { if (++a >= factor) { a -= factor; if (a >= factor) a = 0; h = q ? Math.round(x[i] * q) / q : x[i]; } y[i] = h; }
  return y;
}


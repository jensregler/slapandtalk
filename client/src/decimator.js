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
    if (!inp || !inp.length) { if (this.keep) { for (const y of out) y.fill(0); return true; } return !this.seen && currentTime - this.born < 3; } // keep: the city bus lives for good
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
// The city's place bus (shared/cityfx.mjs): ONE node for the whole master, stereo, per sample:
//   1. flanger/chorus – a short modulated delay (base + depth·LFO, feedback; the two channels a
//      quarter-cycle apart); flanger = 1–3 ms with feedback, chorus = 12–25 ms without
//   2. decimation (sample-and-hold) + bit reduction, mixed in by decimMix
//   3. stutter/chop – beat repeat: the sound is cut in slices (stutterLen, a 16th at 90 BPM); at
//      each slice a coin (stutter = chance) says "repeat the last slice"; chop gates its 2nd half
// All k-rate params (the client slews them), nothing allocates while running.
class Place extends AudioWorkletProcessor {
  static get parameterDescriptors() { const p = (name, d, lo, hi) => ({ name, defaultValue: d, minValue: lo, maxValue: hi, automationRate: 'k-rate' });
    return [p('modMix', 0, 0, 1), p('modBase', 2, 0.1, 40), p('modDepth', 1, 0, 20), p('modRate', 0.3, 0, 20), p('modFb', 0, -0.95, 0.95),
      p('decim', 1, 1, 64), p('bits', 16, 1, 16), p('decimMix', 0, 0, 1), p('stutter', 0, 0, 1), p('stutterLen', 1 / 6, 0.02, 1), p('chop', 0, 0, 1)]; }
  constructor() {
    super(); this.N = 4096; this.md = [new Float32Array(this.N), new Float32Array(this.N)]; this.mw = 0; this.ph = 0;
    this.R = Math.ceil(sampleRate * 2.1); this.ring = [new Float32Array(this.R), new Float32Array(this.R)]; this.rw = 0;
    this.held = [0, 0]; this.acc = 1e9; this.pos = 0; this.rep = false; this.from = 0; this.seed = 12345;
    this.stats = 0;
  }
  rnd() { this.seed = (this.seed * 1103515245 + 12345) >>> 0; return this.seed / 4294967296; }
  process(inputs, outputs, P) {
    const out = outputs[0], inp = inputs[0], n = out[0].length, C = out.length;
    const g = (k) => P[k][0];
    const mm = g('modMix'), base = g('modBase') * sampleRate / 1000, dep = g('modDepth') * sampleRate / 1000, fb = g('modFb'), dr = 2 * Math.PI * g('modRate') / sampleRate;
    const dec = g('decim'), dm = g('decimMix'), bits = g('bits'), q = bits < 15.5 ? Math.pow(2, Math.round(bits) - 1) : 0;
    const st = g('stutter'), L = Math.max(64, Math.round(g('stutterLen') * sampleRate)), chop = g('chop');
    const N = this.N, R = this.R;
    for (let i = 0; i < n; i++) {
      // slice clock (stutter)
      if (this.pos >= L) { this.pos = 0; this.rep = st > 0 && this.rnd() < st; this.from = (this.rw - L + R) % R; }
      const pos = this.pos++, edge = Math.min(1, pos / 96, (L - pos) / 96);
      let doS = ++this.acc >= dec; if (doS) { this.acc -= dec; if (this.acc >= dec) this.acc = 0; }
      this.ph += dr; if (this.ph > 6.283185307) this.ph -= 6.283185307;
      for (let c = 0; c < C; c++) {
        let x = inp && inp.length ? (inp[c] || inp[0])[i] : 0;
        if (!(x === x) || x > 8 || x < -8) x = 0; // NaN / runaway guard
        // 1. modulated delay
        if (mm > 0.0005) {
          const b = this.md[c], d = base + dep * (0.5 + 0.5 * Math.sin(this.ph + c * 1.5707963)), r = this.mw - d;
          const ri = Math.floor(r), fr = r - ri, i0 = ((ri % N) + N) % N, i1 = (i0 + 1) % N;
          const del = b[i0] + (b[i1] - b[i0]) * fr;
          let wv = x + fb * del; if (Math.abs(wv) < 1e-20) wv = 0; b[this.mw % N] = wv;
          x = x * (1 - 0.5 * mm) + del * 0.5 * mm;
        }
        // 2. decimate + bits
        if (dm > 0.0005) {
          if (doS) this.held[c] = q ? Math.round(x * q) / q : x;
          x = x + (this.held[c] - x) * dm;
        }
        // 3. stutter / chop
        const ring = this.ring[c]; ring[this.rw] = x;
        if (this.rep) {
          const y = ring[(this.from + pos) % R] * (pos > L / 2 ? 1 - chop : 1);
          x = x + (y - x) * edge;
        }
        out[c][i] = x;
      }
      this.mw = (this.mw + 1) % N; this.rw = (this.rw + 1) % R;
    }
    return true; // the bus lives as long as the page
  }
}
registerProcessor('klibb-place', Place);
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

// The city's place-bus node (stereo), or null (no worklet).
export function makePlace(tctx) {
  if (!decimatorReady(tctx)) return null;
  try { return tctx.createAudioWorkletNode('klibb-place', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] }); } catch (e) { console.warn('place node', e); return null; }
}

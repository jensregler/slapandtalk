// The synth engine: plays JSON patches (shared/synth.mjs) with Tone.js (MIT, lazy-loaded so
// the first paint stays light). Every sound in the room is one of these patches:
//   slap, peel, nope, step (footsteps), duff (backing paper landing).
// Signal path per voice:  layers → [player/patch FX chain] → [spatial panner] → room bus → out
//   room bus = automatic, subtle acoustics from the room's materials (free, no UI)
//   FX chain = filter → bitcrush → distortion → delay → reverb (paid "Sound settings")
// FX chains and the room reverb are cached and shared; voices are short-lived and disposed
// after they ring out, and at most MAX_VOICES play at once (phones stay fine).
import { cleanPatch, cleanFx, delaySeconds, patchLength, FX_DEFAULTS } from '../../shared/synth.mjs';

export const MAX_VOICES = 12;
let tonePromise = null;
export const loadTone = () => (tonePromise ||= import('tone'));

const fxActive = (fx) => fx && (fx.reverb.wet > 0 || fx.delay.wet > 0 || fx.crush.wet > 0 || fx.dist.wet > 0 || fx.filter.wet > 0);

export class SynthEngine {
  // Tone: the loaded module. ctx: a Tone context (Tone.getContext() or the one inside Tone.Offline).
  constructor(Tone, { output = null } = {}) {
    this.Tone = Tone;
    this.out = new Tone.Gain(1);
    this.out.connect(output || Tone.getDestination());
    this.roomIn = new Tone.Gain(1);
    this.roomDry = new Tone.Gain(1).connect(this.out);
    this.roomVerb = null; this.roomWet = 0; this.roomKey = '';
    this.roomIn.connect(this.roomDry);
    this.chains = new Map(); // JSON(fx) -> { input, nodes, used }
    this.voices = [];        // end times (context seconds)
  }
  get now() { return this.Tone.now(); }

  // Free acoustics: { reverb: { decay, preDelay, wet } } from roomAcoustics(style).
  async setRoom(ac) {
    const T = this.Tone, r = ac?.reverb || { wet: 0 };
    const key = JSON.stringify(r); if (key === this.roomKey) return; this.roomKey = key;
    if (this.roomVerb) { const old = this.roomVerb; this.roomVerb = null; setTimeout(() => old.dispose(), 3000); try { this.roomIn.disconnect(old); } catch { /* ok */ } }
    this.roomWet = r.wet || 0;
    if (!this.roomWet) return;
    const verb = new T.Reverb({ decay: r.decay, preDelay: r.preDelay, wet: 1 });
    const send = new T.Gain(this.roomWet);
    this.roomIn.connect(send); send.connect(verb); verb.connect(this.out);
    verb.send = send; const dispose = verb.dispose.bind(verb); verb.dispose = () => { send.dispose(); return dispose(); };
    this.roomVerb = verb;
    try { await verb.ready; } catch { /* old browsers */ }
  }

  // A cached FX chain for this fx JSON (null fx / all wet 0 = straight to the room bus).
  chain(fx) {
    const f = cleanFx(fx); if (!fxActive(f)) return this.roomIn;
    const key = JSON.stringify(f);
    const hit = this.chains.get(key); if (hit) { hit.used = Date.now(); return hit.input; }
    const T = this.Tone, nodes = [];
    const input = new T.Gain(1); nodes.push(input);
    let last = input;
    const add = (n) => { nodes.push(n); last.connect(n); last = n; return n; };
    if (f.filter.wet > 0) { // Tone.Filter has no wet control: dry/wet through a CrossFade
      const split = add(new T.Gain(1)), xf = new T.CrossFade(f.filter.wet), n = new T.Filter({ type: f.filter.type, frequency: f.filter.cutoff, Q: f.filter.q });
      split.connect(xf.a); split.connect(n); n.connect(xf.b); nodes.push(n, xf); last = xf;
    }
    if (f.crush.wet > 0) { const n = new T.BitCrusher(f.crush.bits); n.wet.value = f.crush.wet; add(n); }
    if (f.dist.wet > 0) { const n = new T.Distortion(f.dist.amount); n.wet.value = f.dist.wet; add(n); }
    if (f.delay.wet > 0) {
      const t = delaySeconds(f.delay);
      const n = f.delay.pingPong ? new T.PingPongDelay({ delayTime: t, feedback: f.delay.feedback, maxDelay: 1.6 }) : new T.FeedbackDelay({ delayTime: t, feedback: f.delay.feedback, maxDelay: 1.6 });
      n.wet.value = f.delay.wet; add(n);
    }
    if (f.reverb.wet > 0) { const n = new T.Reverb({ decay: f.reverb.decay, preDelay: f.reverb.preDelay }); n.wet.value = f.reverb.wet; add(n); }
    last.connect(this.roomIn);
    const entry = { input, nodes, used: Date.now() };
    this.chains.set(key, entry);
    if (this.chains.size > 8) { // drop the least recently used chain (after its tail)
      const [oldKey, old] = [...this.chains.entries()].sort((a, b) => a[1].used - b[1].used)[0];
      this.chains.delete(oldKey); setTimeout(() => old.nodes.forEach((n) => n.dispose()), 4000);
    }
    return input;
  }

  // Play a patch now (or at `time`). opts: { gain, rate, fx, pos: [x,y,z] (spatial) | null, keep: don't clean up (offline) }
  // Returns false when the polyphony cap skipped it.
  // Voices are plain Web Audio nodes made on Tone's context (see the note at the bottom);
  // they plug into the Tone FX chain / room bus and disconnect themselves when done.
  play(patch, { gain = 1, rate = 1, fx = null, pos = null, time = null, keep = false } = {}) {
    const p = cleanPatch(patch); if (!p) return false;
    const ctx = this.raw, t0 = (time ?? ctx.currentTime) + 0.005, len = patchLength(p);
    this.voices = this.voices.filter((end) => end > ctx.currentTime);
    if (this.voices.length >= MAX_VOICES) return false;
    this.voices.push(t0 + len);
    const nodes = [];
    const dest = this.chain(p.fx || fx);
    let out = dest.input || dest;
    if (pos) {
      const pan = ctx.createPanner();
      pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 1.6; pan.rolloffFactor = 1; pan.maxDistance = 30;
      if (pan.positionX) { pan.positionX.value = pos[0]; pan.positionY.value = pos[1]; pan.positionZ.value = pos[2]; } else pan.setPosition(...pos);
      pan.connect(out); out = pan; nodes.push(pan);
    }
    const vgain = ctx.createGain(); vgain.gain.value = p.gain * gain; vgain.connect(out); nodes.push(vgain);
    let last = null;
    for (const l of p.layers) { const r = this.layer(ctx, l, vgain, t0 + l.delay, rate); nodes.push(...r.nodes); if (!last || r.end > last.end) last = r; }
    if (!keep && last) last.src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch { /* ok */ } } };
    return true;
  }
  get raw() { return this.Tone.getContext().rawContext; }

  noiseBuffer(ctx, color) {
    this.noiseBufs ||= new Map();
    const key = color; const hit = this.noiseBufs.get(key); if (hit && hit.ctx === ctx) return hit.buf;
    const n = ctx.sampleRate, buf = ctx.createBuffer(1, n, n), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (color !== 'pink') { d[i] = w; continue; }
      // Paul Kellet's pink filter
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
    this.noiseBufs.set(key, { ctx, buf });
    return buf;
  }
  driveCurve(amount) {
    this.curves ||= new Map();
    const k = Math.round(amount * 20) / 20; if (this.curves.has(k)) return this.curves.get(k);
    const n = 1024, c = new Float32Array(n), a = 1 + k * 40;
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(a * x) / Math.tanh(a); }
    this.curves.set(k, c); return c;
  }

  // One layer = source(s) → [drive] → filter → amp envelope → [tremolo] → level → out.
  layer(ctx, l, out, t, rate) {
    const nodes = [], srcs = [];
    const freq = Math.min(8000, l.freq * rate), cutoff = Math.min(18000, l.cutoff * rate);
    const peakAt = t + l.a, decEnd = peakAt + l.d, gateEnd = decEnd + l.hold, end = gateEnd + l.r, stop = end + 0.02;
    const head = ctx.createGain(); nodes.push(head);
    if (l.kind === 'noise') {
      const n = ctx.createBufferSource(); n.buffer = this.noiseBuffer(ctx, l.noise); n.loop = true; n.playbackRate.value = rate;
      n.connect(head); srcs.push({ node: n, offset: Math.random() * 0.5 });
    } else {
      const start = Math.min(8000, freq * Math.pow(2, l.pitchAmt / 12));
      const voices = l.unison;
      for (let u = 0; u < voices; u++) {
        const o = ctx.createOscillator(); o.type = l.wave;
        const spread = voices > 1 ? (u / (voices - 1) - 0.5) * 2 * l.spread : 0;
        o.detune.value = l.detune + spread;
        o.frequency.setValueAtTime(start, t);
        if (l.pitchAmt) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq), t + l.pitchTime);
        const g = ctx.createGain(); g.gain.value = 1 / Math.sqrt(voices); o.connect(g); g.connect(head); nodes.push(g);
        srcs.push({ node: o });
      }
      if (l.sub > 0) {
        const s = ctx.createOscillator(); s.type = 'sine';
        s.frequency.setValueAtTime(start / 2, t); if (l.pitchAmt) s.frequency.exponentialRampToValueAtTime(Math.max(10, freq / 2), t + l.pitchTime);
        const g = ctx.createGain(); g.gain.value = l.sub; s.connect(g); g.connect(head); nodes.push(g); srcs.push({ node: s });
      }
    }
    let into = head;
    if (l.drive > 0) { const ws = ctx.createWaveShaper(); ws.curve = this.driveCurve(l.drive); head.connect(ws); into = ws; nodes.push(ws); }
    const filter = ctx.createBiquadFilter(); filter.type = l.filter; filter.Q.value = l.q;
    filter.frequency.setValueAtTime(cutoff, t);
    if (l.fEnv) filter.frequency.exponentialRampToValueAtTime(Math.min(18000, Math.max(20, cutoff * Math.pow(2, l.fEnv))), t + l.fTime);
    into.connect(filter); nodes.push(filter);
    // ADSR with exponential decay/release (like the original hand-made sounds)
    const env = ctx.createGain(), g = env.gain, sus = Math.max(0.0001, l.s);
    g.setValueAtTime(0.0001, t); g.linearRampToValueAtTime(1, peakAt);
    g.exponentialRampToValueAtTime(sus, decEnd);
    if (gateEnd > decEnd) g.setValueAtTime(sus, gateEnd);
    g.exponentialRampToValueAtTime(0.0001, end);
    g.setValueAtTime(0, end + 0.001);
    filter.connect(env); nodes.push(env);
    const level = ctx.createGain(); level.gain.value = l.level; nodes.push(level);
    if (l.lfo !== 'none' && l.lfoDepth > 0) {
      const lfo = ctx.createOscillator(); lfo.type = l.lfoWave; lfo.frequency.value = l.lfoRate * rate;
      const depth = ctx.createGain(); lfo.connect(depth); nodes.push(depth);
      if (l.lfo === 'amp') { // tremolo between 1 - depth and 1
        const trem = ctx.createGain(); trem.gain.value = 1 - l.lfoDepth / 2; depth.gain.value = l.lfoDepth / 2;
        depth.connect(trem.gain); env.connect(trem); trem.connect(level); nodes.push(trem);
      } else {
        env.connect(level);
        depth.gain.value = (l.lfo === 'pitch' ? 1200 : 3600) * l.lfoDepth; // cents
        if (l.lfo === 'cutoff') depth.connect(filter.detune);
        else for (const s of srcs) if (s.node.detune) depth.connect(s.node.detune);
      }
      srcs.push({ node: lfo });
    } else env.connect(level);
    level.connect(out);
    for (const s of srcs) { s.node.start(t, s.offset); s.node.stop(stop); nodes.push(s.node); }
    return { nodes, end: stop, src: srcs[0].node };
  }
}

// Why the voices are plain Web Audio and not Tone instruments: every Tone node wraps its params
// in Signal objects, so building one short one-shot voice cost 3–7 ms of main-thread time
// (measured in Chromium), too much for rapid slaps, several players' footsteps and phones.
// Native nodes are ~10× cheaper and need no dispose. Tone.js still does what it is good at:
// the context, the effects (Reverb with generated impulse responses, Feedback/PingPong delay,
// BitCrusher, Distortion, Filter + CrossFade), the room bus and Tone.Offline for the tests.
export { FX_DEFAULTS };

// The synth engine: plays JSON patches (shared/synth.mjs) with Tone.js (MIT, lazy-loaded so
// the first paint stays light). Every sound in the room is one of these patches:
//   slap, peel, step (footsteps), duff (peel landing thud; also four voices Low).
// Signal path per voice (t588u listener FX):
//   layers → [spatial panner] → room bus → [city place bus] → ears → [listener FX] → master → guard → speakers
//   room bus = automatic, subtle acoustics from the room's materials (free, no UI)
//   city place = position-based effects (shared/cityfx.mjs), already per-listener
//   listener FX = MY copy of the room/sound-settings effect chain (filter→crush→dist→delay→reverb).
//     Applied once, locally, to everything I hear (synths, samples, voice monitor, other voices).
//     No per-source FX, no extra network messages. Voices are short-lived; MAX_VOICES caps polyphony.
import { cleanPatch, cleanFx, delaySeconds, patchLength, samplerRate, FX_DEFAULTS, SYNTH } from '../../shared/synth.mjs';
import { evalMods, compileMods, MOD } from '../../shared/lfo.mjs';
import { ensureDecimator, makeDecimator, makeMods, makePlace } from './decimator.js';
import { DELAY_ROOM } from '../../shared/delayroom.mjs';
import { REVERB_ROOM } from '../../shared/reverbroom.mjs';
import { getMic, micStream } from './mic.js';
import { peelCurve } from '../../shared/peelstep.mjs';

export const MAX_VOICES = 12;
// Footsteps have their own, smaller budget (pool 'step'), so a fast groove never starves the slaps.
export const MAX_STEP_VOICES = 10;
// The radio's running loops (sequencer layers, four voices) have their own budget too (pool 'seq').
export const MAX_SEQ_VOICES = 16;
// Sampler layers (Jens, 5 Nov 2026): decoded audio by sha-256 (filled by client/src/samples.js).
// A sampler layer whose sample isn't here (yet) is silent; the rest of the patch still plays.
export const SAMPLE_BUFFERS = new Map();
let tonePromise = null;
export const loadTone = () => (tonePromise ||= import('tone'));

const fxActive = (fx) => fx && (fx.reverb.wet > 0 || fx.delay.wet > 0 || fx.crush.wet > 0 || fx.dist.wet > 0 || fx.filter.wet > 0);

export class SynthEngine {
  // Tone: the loaded module. ctx: a Tone context (Tone.getContext() or the one inside Tone.Offline).
  constructor(Tone, { output = null } = {}) {
    this.Tone = Tone;
    this.out = new Tone.Gain(1);       // room-bus output (pre place / ears)
    this.ears = new Tone.Gain(1);      // everything I hear lands here (post place)
    this.master = new Tone.Gain(1);    // post listener-FX, into the guard
    // ears + speakers guard (audio-rate LFOs, many voices): a fast limiter, then a gentle tanh soft clip
    const raw = Tone.getContext().rawContext;
    const lim = raw.createDynamicsCompressor(); lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.1;
    const clip = raw.createWaveShaper(); clip.curve = softClipCurve(); clip.oversample = '2x';
    // Default path (no city place yet): out → ears → master → lim → clip → speakers
    this.out.connect(this.ears); this.ears.connect(this.master);
    this.master.connect(lim); lim.connect(clip); Tone.connect(clip, output || Tone.getDestination());
    this.guard = { lim, clip };
    this.roomIn = new Tone.Gain(1);
    this.roomDry = new Tone.Gain(1).connect(this.out);
    this.roomVerb = null; this.roomWet = 0; this.roomKey = '';
    this.roomIn.connect(this.roomDry);
    this.chains = new Map(); // legacy per-source FX cache (kept for offline/tests; play() no longer routes through it)
    this.listenerFx = null;  // { key, nodes, input } – one chain on ears → master
    this.listenerFxKey = '';
    this.voices = [];        // end times (context seconds)
    this.stepVoices = [];    // the same for footsteps (pool 'step', MAX_STEP_VOICES)
    this.polys = new Map();  // sampler polyphony: sample hash → ringing voices [{ env, src, end }]
    this.ready = ensureDecimator(Tone.getContext()); // the decimation worklet (decimator.js)
    this.ready.then((ok) => { this.workletOk = !!ok; });
    this.place = null; // the city's place bus (setPlace), built on first use
  }

  // ---------- The live mic (mic layers, 'mic' followers) ----------
  // useMic() asks for the page's one mic (mic.js) – only when a mic layer is made / switched on.
  async useMic() { const s = await getMic('layers'); this.micNode = null; return !!(s && this.micSource()); }
  micSource() {
    const s = micStream(); if (!s) return null;
    if (!this.micNode || this.micNode.__stream !== s) { try { this.micNode = this.raw.createMediaStreamSource(s); this.micNode.__stream = s; } catch { this.micNode = null; } }
    return this.micNode;
  }

  // ---------- The place bus (city: shared/cityfx.mjs) ----------
  // Built ONCE (the first time a non-neutral place is set), between the room bus and my ears:
  //   out → low-pass → place worklet (flanger/chorus, decimate+bits, stutter/chop) → mix
  //   mix → ears (dry) · mix → delay A/B → ears · mix → small/big reverb → ears
  //   mix → distSend → WaveShaper (intersection Dist peaks) → soft level → ears
  //   mix (+ voices, voiceIn) → delay room 1/2/3 (send → delay ⟲ fb → ret) → ears (plot 5 only: shared/delayroom.mjs)
  //   mix (+ voices) → reverb room 1/2/3 (send → pre-delay → 2 all-passes → damp → fb ⟲ ; → diffuse tail → ret) → ears
  //   (fixed settings, plot 4 only) + three sines (20 … 2000 Hz from my look), volume LFO 0…100 % (2 … 1000 Hz = my distance to the
  //   point) → ears DRY only (shared/reverbroom.mjs)
  //   ears → [listener FX] → master → guard → speakers
  // After that only plain AudioParams move (setTargetAtTime, PLACE_SLEW): no graph rebuilds.
  // Place follows MY position (per listener); nothing is sent to anyone.
  placeBus() {
    if (this.place) return this.place;
    const T = this.Tone, ctx = this.raw, ears = this.ears;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5; lp.frequency.value = Math.min(20000, ctx.sampleRate / 2 - 100);
    const node = this.workletOk ? makePlace(T.getContext()) : null;
    const mix = ctx.createGain();
    // dryGain: City sound crossfade (Jens Nov 2026) – 1 = dry own sounds, 0 = wet-only through city FX
    const dryGain = ctx.createGain(); dryGain.gain.value = 1;
    const intoEars = (n) => { try { T.connect(n, ears); } catch { try { n.connect(ears.input || ears); } catch { /* ok */ } } };
    const tap = (max) => { const d = ctx.createDelay(max), fb = ctx.createGain(), send = ctx.createGain(); fb.gain.value = 0; send.gain.value = 0; mix.connect(send); send.connect(d); d.connect(fb); fb.connect(d); intoEars(d); return { d, fb, send }; };
    const verb = (decay, pre) => { const v = new T.Reverb({ decay, preDelay: pre, wet: 1 }), send = ctx.createGain(); send.gain.value = 0; mix.connect(send); T.connect(send, v); intoEars(v); return { v, send }; };
    // Intersection Distortion (Peaks A+C): soft fold WaveShaper on a wet send; level kept under the master guard.
    const dist = ctx.createWaveShaper(); dist.curve = placeDistCurve(0.2); dist.oversample = '2x';
    const distSend = ctx.createGain(); distSend.gain.value = 0;
    const distGain = ctx.createGain(); distGain.gain.value = 0.55; // makeup under soft-clip so peaks don't clip
    mix.connect(distSend); distSend.connect(dist); dist.connect(distGain); intoEars(distGain);
    // Noise room (plot 7, rebuild 10 Nov 2026): ONE looping pink-noise buffer drives a gain's AudioParam, so
    // mix × noise = my sound turned to hiss (silent when nothing plays); the same noise also feeds a quiet
    // steady hiss bed. Both sends start at 0 – only the noise room opens them.
    const nlen = Math.round(ctx.sampleRate * 2), nbuf = ctx.createBuffer(1, nlen, ctx.sampleRate), nd = nbuf.getChannelData(0);
    { let b0 = 0, b1 = 0, b2 = 0; for (let i = 0; i < nlen; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; nd[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; } }
    const nsrc = ctx.createBufferSource(); nsrc.buffer = nbuf; nsrc.loop = true;
    const nmod = ctx.createGain(); nmod.gain.value = 0; nsrc.connect(nmod.gain); mix.connect(nmod);
    const noiseSend = ctx.createGain(); noiseSend.gain.value = 0; nmod.connect(noiseSend); intoEars(noiseSend);
    const noiseBed = ctx.createGain(); noiseBed.gain.value = 0; nsrc.connect(noiseBed); intoEars(noiseBed);
    try { nsrc.start(); } catch { /* ok */ }
    // Delay room (plot 5, Jens's sketch t790u): THREE delay lines (left / centre / right on the back wall).
    // send (wet × City sound × the room gate) → delay ⟲ feedback → ret (the room gate) → ears. ret closes
    // outside the room, so echoes still ringing never follow me out (NO DELAY OUTSIDE THE ROOM).
    // voiceIn: voices (my monitor, the others' – plugEars) go through the same three delays.
    const voiceIn = ctx.createGain(); voiceIn.gain.value = 1;
    const roomTap = () => {
      const d = ctx.createDelay(DELAY_ROOM.maxTime + 0.2), fb = ctx.createGain(), send = ctx.createGain(), ret = ctx.createGain();
      fb.gain.value = 0; send.gain.value = 0; ret.gain.value = 0; d.delayTime.value = 0.5;
      mix.connect(send); voiceIn.connect(send); send.connect(d); d.connect(fb); fb.connect(d); d.connect(ret); intoEars(ret);
      return { d, fb, send, ret };
    };
    const room = [roomTap(), roomTap(), roomTap()];
    // Reverb room (plot 4, Jens 10 Nov 2026, corrected t808u–t812u – shared/reverbroom.mjs): a plain FIXED room
    // reverb for my sound and voices, built from three small diffuse cells:
    //   send → pre (fixed pre-delay) → AP1 → AP2 (Schroeder all-passes, |H| = 1) → damp (one-pole low-pass, |H| ≤ 1)
    //   → fb (fixed loopGain 0.5) ↻ back into pre; AP2 → tail (a ~1.6 s decaying-noise convolver) → ret → ears.
    // Nothing here follows my distance or my slaps; send / ret open only while I'm inside (rvWet).
    // Plus ONE pure sine per point (pitch from where I look, 20 … 2000 Hz – rvHz): osc → am (0.5 + 0.5·LFO = always
    // 0 … 100 % volume; the LFO frequency = my distance to the point, 2 … 1000 Hz – rvLfo) → lvl (tone level ×
    // presence × look-out × City sound) → ears, DRY. The sines are NOT fed into the loops (that howled).
    const sr = ctx.sampleRate;
    const allpass = (sec, g) => { // y = −g·v + v[n−D], v = x + g·v[n−D]
      const inp = ctx.createGain(), v = ctx.createGain(), d = ctx.createDelay(0.1), fbg = ctx.createGain(), neg = ctx.createGain(), out = ctx.createGain();
      d.delayTime.value = Math.max(sec, 256 / sr); fbg.gain.value = g; neg.gain.value = -g;
      inp.connect(v); v.connect(d); d.connect(fbg); fbg.connect(v); v.connect(neg); neg.connect(out); d.connect(out);
      return { inp, out };
    };
    const tailIR = (sec, seed) => {
      const n = Math.round(sr * sec), b = ctx.createBuffer(2, n, sr); let x = seed;
      for (let c = 0; c < 2; c++) { const ch = b.getChannelData(c); for (let i = 0; i < n; i++) { x = (x * 1664525 + 1013904223) >>> 0; ch[i] = ((x / 4294967296) * 2 - 1) * Math.exp(-6.9 * i / n) * Math.min(1, i / (sr * 0.004)); } }
      return b;
    };
    const AP = [[0.0047, 0.0113], [0.0053, 0.0127], [0.0061, 0.0139]];
    const verbPoint = (i) => {
      const send = ctx.createGain(), pre = ctx.createDelay(REVERB_ROOM.maxPre), fb = ctx.createGain(), ret = ctx.createGain();
      send.gain.value = 0; fb.gain.value = REVERB_ROOM.loopGain; ret.gain.value = 0; pre.delayTime.value = REVERB_ROOM.preTimes[i];
      const a1 = allpass(AP[i][0], 0.6), a2 = allpass(AP[i][1], 0.55);
      let damp; try { damp = ctx.createIIRFilter([0.45], [1, -0.55]); } catch { damp = ctx.createGain(); damp.gain.value = 0.9; }
      const tail = ctx.createConvolver(); tail.normalize = true; tail.buffer = tailIR(1.6, 0x9e3779b9 + i * 7919);
      mix.connect(send); voiceIn.connect(send); send.connect(pre); pre.connect(a1.inp); a1.out.connect(a2.inp); a2.out.connect(damp); damp.connect(fb); fb.connect(pre);
      a2.out.connect(tail); tail.connect(ret); intoEars(ret);
      // the point's sine: pitch from my look (rvHz, 20 … 2000 Hz; rest 200 / 2000 / 2000); its volume LFO's FREQUENCY = my distance (rvLfo)
      const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = REVERB_ROOM.restHz[i];
      const am = ctx.createGain(); am.gain.value = 0.5; // 0.5 + 0.5·sin = 0 … 1
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = REVERB_ROOM.lfoMin;
      const depth = ctx.createGain(); depth.gain.value = 0.5 * REVERB_ROOM.lfoDepth;
      const lvl = ctx.createGain(); lvl.gain.value = 0;
      lfo.connect(depth); depth.connect(am.gain); osc.connect(am); am.connect(lvl); intoEars(lvl); // dry only – not into pre
      try { osc.start(); lfo.start(); } catch { /* ok */ }
      return { send, pre, fb, ret, tail, osc, lfo, am, depth, lvl, toneInLoop: false };
    };
    const verbRoom = [verbPoint(0), verbPoint(1), verbPoint(2)];
    for (const n of this.plugged || []) { try { n.connect(voiceIn); } catch { /* ok */ } }
    try { this.out.disconnect(); } catch { /* ok */ } // was out → ears
    T.connect(this.out, lp);
    if (node) { lp.connect(node); node.connect(mix); } else lp.connect(mix);
    mix.connect(dryGain); intoEars(dryGain);
    this.place = { lp, node, mix, dryGain, city: 0, a: tap(1.5), b: tap(1.5), small: verb(0.9, 0.01), big: verb(5.5, 0.04), dist, distSend, distGain, distAmt: 0.2, noiseSend, noiseBed, voiceIn, room, verbRoom, last: null, sets: 0 };
    return this.place;
  }
  // v: the values from cityFxAt (or PLACE_NEUTRAL). Neutral before the bus exists = nothing to do.
  setPlace(v, { slew = 0.25, neutral = false, city = undefined } = {}) {
    if (!v) return false;
    if (!this.place && (neutral || this.workletOk === undefined)) return false; // neutral and no bus yet: stay untouched; worklet still loading: next tick
    const P = this.placeBus(), t = this.raw.currentTime, to = (param, x) => { if (Number.isFinite(x)) param.setTargetAtTime(x, t, slew); };
    // city 0..1: dry↔wet of reverb/delay (and other place sends). 0 = dry only, 1 = wet only.
    if (city !== undefined && Number.isFinite(city)) P.city = Math.min(1, Math.max(0, city));
    const c = P.city || 0;
    to(P.dryGain.gain, 1 - c);
    to(P.lp.frequency, Math.min(v.cutoff, this.raw.sampleRate / 2 - 100));
    to(P.a.d.delayTime, v.delayTime); to(P.a.fb.gain, v.delayFb); to(P.a.send.gain, (v.delayWet || 0) * c);
    to(P.b.d.delayTime, v.delay2Time); to(P.b.fb.gain, v.delay2Fb); to(P.b.send.gain, (v.delay2Wet || 0) * c);
    to(P.small.send.gain, (v.verbWet || 0) * (1 - v.verbSize) * c); to(P.big.send.gain, (v.verbWet || 0) * v.verbSize * c);
    // Distortion wet send (Peaks A+C). Curve rebuild only when amount steps enough (no audio glitch every tick).
    to(P.distSend.gain, (v.distWet || 0) * c);
    if (Number.isFinite(v.distAmount)) {
      const a = Math.round((v.distAmount || 0) * 50) / 50;
      if (a !== P.distAmt) { P.dist.curve = placeDistCurve(a); P.distAmt = a; }
    }
    if (P.node) for (const k of ['modMix', 'modBase', 'modDepth', 'modRate', 'modFb', 'decim', 'bits', 'decimMix', 'stutter', 'stutterLen', 'chop', 'freqHz', 'freqMix']) {
      const prm = P.node.parameters.get(k); if (!prm) continue;
      let x = v[k];
      // Mix-ish params also scale with city so 0 is truly dry
      if (k === 'modMix' || k === 'decimMix' || k === 'freqMix' || k === 'stutter' || k === 'chop') x = (x || 0) * c;
      to(prm, x);
    }
    // Noise room: hiss that follows my sound (×3: pink noise sits low) + a quiet bed (kept well under the guard).
    to(P.noiseSend.gain, (v.noiseWet || 0) * 3 * c); to(P.noiseBed.gain, (v.noiseBed || 0) * 0.08 * c);
    // Delay room: send = roomWet (0 outside the room) × City sound, ret = the room's presence (0 outside), feedback
    // 0…100 % → loop gain 0…loopMax, times (held by the client since my entry / last slap).
    const open = Math.min(1, Math.max(0, (v.roomWet || 0) / DELAY_ROOM.wet));
    P.room.forEach((r, i) => {
      to(r.send.gain, (v.roomWet || 0) * c); to(r.ret.gain, open);
      to(r.fb.gain, Math.min(1, Math.max(0, v['roomFb' + (i + 1)] || 0)) * DELAY_ROOM.loopMax);
      const tm = v['roomTime' + (i + 1)]; if (Number.isFinite(tm)) to(r.d.delayTime, Math.min(DELAY_ROOM.maxTime, Math.max(DELAY_ROOM.minTime, tm)));
    });
    // Reverb room: the fixed room reverb opens inside (send = rvWet × City sound, ret = presence); feedback and
    // pre-delays stay fixed (set at build). The sines: level = rvTone × City sound (0 outside / looking out),
    // pitch = rvHz (look), volume-LFO frequency = rvLfo (my distance, 2 … 1000 Hz); the LFO depth never changes.
    const vopen = Math.min(1, Math.max(0, (v.rvWet || 0) / REVERB_ROOM.wet));
    P.verbRoom.forEach((r, i) => {
      to(r.send.gain, (v.rvWet || 0) * c); to(r.ret.gain, vopen);
      to(r.lvl.gain, Math.min(1, Math.max(0, v.rvTone || 0)) * c);
      const f = v['rvHz' + (i + 1)]; if (Number.isFinite(f)) to(r.osc.frequency, Math.min(REVERB_ROOM.toneMaxHz, Math.max(REVERB_ROOM.toneMinHz, f)));
      const hz = v['rvLfo' + (i + 1)]; if (Number.isFinite(hz)) to(r.lfo.frequency, Math.min(REVERB_ROOM.lfoMax, Math.max(REVERB_ROOM.lfoMin, hz)));
    });
    P.last = v; P.sets++;
    return true;
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

  // ---------- Listener FX (t588u) ----------
  // One effect chain on ears → master. Room/sound-settings still decide the parameters (synced as
  // today via look.sound.fx / the room preset); each player applies THEIR copy locally to everything
  // reaching their ears. plugEars() is how voice monitor + other players' voices join the same path.
  setListenerFx(fx) {
    const T = this.Tone, f = cleanFx(fx), key = fxActive(f) ? JSON.stringify(f) : '';
    if (key === this.listenerFxKey) return this.listenerFx;
    this.listenerFxKey = key;
    try { this.ears.disconnect(); } catch { /* ok */ }
    if (this.listenerFx) {
      const old = this.listenerFx; this.listenerFx = null;
      setTimeout(() => old.nodes.forEach((n) => { try { n.dispose(); } catch { /* ok */ } }), 500);
    }
    if (!key) { this.ears.connect(this.master); return null; }
    const nodes = [];
    const input = new T.Gain(1); nodes.push(input);
    let last = input;
    const add = (n) => { nodes.push(n); last.connect(n); last = n; return n; };
    if (f.filter.wet > 0) {
      const split = add(new T.Gain(1)), xf = new T.CrossFade(f.filter.wet), n = new T.Filter({ type: f.filter.type, frequency: f.filter.cutoff, Q: f.filter.q });
      split.connect(xf.a); split.connect(n); n.connect(xf.b); nodes.push(n, xf); last = xf;
    }
    if (f.crush.wet > 0) { const n = new T.BitCrusher(f.crush.bits); n.wet.value = f.crush.wet; add(n); }
    if (f.dist.wet > 0) { const n = new T.Distortion(f.dist.amount); n.wet.value = f.dist.wet; add(n); }
    if (f.delay.wet > 0) {
      const sec = delaySeconds(f.delay);
      const n = f.delay.pingPong ? new T.PingPongDelay({ delayTime: sec, feedback: f.delay.feedback, maxDelay: 1.6 }) : new T.FeedbackDelay({ delayTime: sec, feedback: f.delay.feedback, maxDelay: 1.6 });
      n.wet.value = f.delay.wet; add(n);
    }
    if (f.reverb.wet > 0) { const n = new T.Reverb({ decay: f.reverb.decay, preDelay: f.reverb.preDelay }); n.wet.value = f.reverb.wet; add(n); }
    this.ears.connect(input); last.connect(this.master);
    this.listenerFx = { key, input, nodes };
    return this.listenerFx;
  }
  // Connect a raw Web Audio node (voice monitor, remote peer) into my ears so it gets listener FX + place.
  // Voices also feed the delay room's three delays and the reverb room's three points (place.voiceIn; silent outside).
  plugEars(node) {
    if (!node) return;
    try { this.Tone.connect(node, this.ears); } catch {
      try { node.connect(this.ears.input || this.ears); } catch { /* ok */ }
    }
    (this.plugged ||= new Set()).add(node);
    if (this.place?.voiceIn) { try { node.connect(this.place.voiceIn); } catch { /* ok */ } }
  }
  unplugEars(node) {
    if (!node) return;
    this.plugged?.delete(node);
    if (this.place?.voiceIn) { try { node.disconnect(this.place.voiceIn); } catch { /* ok */ } }
    try { this.Tone.disconnect(node, this.ears); } catch {
      try { node.disconnect(this.ears.input || this.ears); } catch { /* ok */ }
    }
  }

  // A cached FX chain for this fx JSON. Kept for offline rendering / tests; live play() routes
  // through the listener FX instead (t588u), so per-source FX is no longer heard by others.
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

  // Play a patch now (or at `time`). opts: { gain, rate, fx, pos: [x,y,z] (spatial) | null, keep: don't clean up (offline),
  //   paper: { cutoff, q, drive, pre } – the footstep-on-a-peel insert (shared/peelstep.mjs): low-pass → soft clip }
  // Returns false when the polyphony cap skipped it.
  // Voices are plain Web Audio nodes made on Tone's context (see the note at the bottom);
  // they plug into the Tone FX chain / room bus and disconnect themselves when done.
  // gate: { pattern: [0…1 per step], rate (loops/s), phase, decay } – the fast sequencer (radio.js): an
  //   internal per-sample gate on the patch volume, so steps faster than the scheduler become a tone.
  play(patch, { gain = 1, rate = 1, fx = null, pos = null, time = null, keep = false, pool = 'main', paper = null, gate = null, length = null, layer = null } = {}) {
    const p = cleanPatch(patch); if (!p) return false;
    const ctx = this.raw, t0 = Math.max(time ?? 0, ctx.currentTime) + 0.005, len = length ?? patchLength(p);
    if (gate) p.mods = [...(p.mods || []), { id: 'gate', to: 'G.gain', wave: 'gate', rate: gate.rate, depth: 1, phase: gate.phase || 0, pattern: gate.pattern, decay: gate.decay || 0 }];
    const step = pool === 'step', key = step ? 'stepVoices' : pool === 'seq' ? 'seqVoices' : 'voices';
    this[key] = (this[key] || []).filter((end) => end > ctx.currentTime);
    // (scheduled-ahead voices count from when they are scheduled: a cap on what is queued, too)
    if (this[key].length >= (step ? MAX_STEP_VOICES : pool === 'seq' ? MAX_SEQ_VOICES : MAX_VOICES)) return false;
    this[key].push(t0 + len);
    const nodes = [];
    // t588u: no per-source FX – everything shares the listener chain on ears → master.
    const dest = this.roomIn;
    let out = dest.input || dest;
    if (pos) {
      const pan = ctx.createPanner();
      pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 1.6; pan.rolloffFactor = 1; pan.maxDistance = 30;
      if (pan.positionX) { pan.positionX.value = pos[0]; pan.positionY.value = pos[1]; pan.positionZ.value = pos[2]; } else pan.setPosition(...pos);
      pan.connect(out); out = pan; nodes.push(pan);
    }
    if (paper) out = this.paper(ctx, paper, out, nodes);
    const vgain = ctx.createGain(); vgain.gain.value = p.gain * gain; vgain.connect(out); nodes.push(vgain);
    let last = null; const made = [];
    this.modTargets = new Set((p.mods || []).map((m) => m.to)); // (a layer whose decim/pan an LFO drives needs its node)
    // sequencer layers (l.seq) run on the master clock (radio.js plays them one by one with `layer`), not on the trigger
    for (const [i, l] of p.layers.entries()) { if (layer == null ? !!l.seq : i !== layer) { made.push(null); continue; } const r = this.layer(ctx, l, vgain, t0 + l.delay, rate, i); made.push(r); if (!r) continue; nodes.push(...r.nodes); if (!last || r.end > last.end) last = r; }
    if (p.mods && p.mods.length) { const mn = this.modulate(ctx, p, made, vgain, p.gain * gain, t0, len); if (mn) nodes.push(mn); }
    if (!last) { for (const n of nodes) { try { n.disconnect(); } catch { /* ok */ } } return true; } // (only an empty sampler)
    if (!keep) last.src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch { /* ok */ } } };
    return true;
  }
  // The patch's LFOs (shared/lfo.mjs): all of them evaluated once per control block (128 samples)
  // in dependency order, then ONE setValueCurveAtTime per modulated parameter – no LFO nodes.
  modulate(ctx, p, made, vgain, gain0, t0, len) {
    const t = performance.now();
    // 1) the worklet: every LFO per sample (audio rate OK), one output per parameter
    const bases = { 'G.gain': gain0 };
    made.forEach((r, i) => { if (r) Object.assign(bases, { [`L${i}.q`]: r.q, [`L${i}.level`]: r.levelBase, [`L${i}.decim`]: r.decimBase }); });
    const prog = compileMods(p.mods, p.layers, { bases });
    const node = makeMods(this.Tone.getContext(), prog, t0, t0 + len + 0.1);
    if (node) {
      let params = 0;
      prog.outs.forEach((o, k) => {
        const m = /^L(\d)\.(\w+)$/.exec(o.to), r = m ? made[Number(m[1])] : null;
        const targets = o.to === 'G.gain' ? [vgain.gain] : !r ? [] : m[2] === 'pitch' ? r.pitch.map((x) => x.param) : m[2] === 'cutoff' ? [r.filter.detune]
          : m[2] === 'q' ? [r.filter.Q] : m[2] === 'level' ? [r.level.gain] : m[2] === 'decim' && r.decim ? [r.decim.parameters.get('factor')] : m[2] === 'pan' && r.panner ? [r.panner.pan] : [];
        for (const prm of targets) { try { node.connect(prm, k); params++; } catch (e) { this.modErrors = (this.modErrors || 0) + 1; } }
      });
      // envelope followers: their source signals into the node's inputs (shared/lfo.mjs)
      const ins = prog.inputs || [], wired = [];
      ins.forEach((src, k) => {
        let from = null;
        if (/^L\d$/.test(src)) from = made[Number(src[1])]?.level || null;
        else if (src === 'mic') from = this.micSource();
        else if (src === 'bus') from = this.place ? this.place.mix : this.out;
        else if (src === 'master') from = this.out;
        if (!from) return;
        try { this.Tone.connect(from, node, 0, k); wired.push(from); } catch (e) { this.modErrors = (this.modErrors || 0) + 1; }
      });
      if (wired.length) {
        node.port.onmessage = (e) => { this.follow = { ...(this.follow || {}), ...e.data }; this.followAt = performance.now(); };
        setTimeout(() => { for (const f of wired) { try { this.Tone.disconnect(f, node); } catch { /* gone */ } } }, (t0 - ctx.currentTime + len + 0.4) * 1000);
      }
      this.followInputs = ins;
      this.modStats = { lfos: p.mods.length, worklet: true, outputs: prog.outs.length, params, ms: +(performance.now() - t).toFixed(3) };
      return node;
    }
    // 2) fallback while the worklet loads: control-rate curves
    const { curves, blocks, dt } = evalMods(p.mods, { seconds: len, blockRate: ctx.sampleRate / MOD.block });
    if (!blocks) return;
    const dur = (blocks - 1) * dt;
    const write = (param, f) => { try { param.cancelScheduledValues(t0); param.setValueCurveAtTime(f, t0, dur); } catch (e) { this.modErrors = (this.modErrors || 0) + 1; } };
    const scaled = (a, base) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = base * a[i]; return o; };
    const cents = (a, base) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = base + 1200 * Math.log2(a[i]); return o; };
    let params = 0;
    if (curves['G.gain']) { write(vgain.gain, scaled(curves['G.gain'], gain0)); params++; }
    made.forEach((r, i) => {
      if (!r) return;
      const pitch = ['freq', 'note', 'detune'].map((k) => curves[`L${i}.${k}`]).filter(Boolean);
      if (pitch.length) {
        const f = new Float32Array(blocks).fill(1); for (const c of pitch) for (let j = 0; j < blocks; j++) f[j] *= c[j];
        for (const { param, base } of r.pitch) { write(param, cents(f, base)); params++; }
      }
      if (curves[`L${i}.cutoff`]) { write(r.filter.detune, cents(curves[`L${i}.cutoff`], 0)); params++; }
      if (curves[`L${i}.q`]) { write(r.filter.Q, scaled(curves[`L${i}.q`], r.q)); params++; }
      if (curves[`L${i}.level`]) { write(r.level.gain, scaled(curves[`L${i}.level`], r.levelBase)); params++; }
      if (curves[`L${i}.decim`] && r.decim) { write(r.decim.parameters.get('factor'), scaled(curves[`L${i}.decim`], r.decimBase)); params++; }
      if (curves[`L${i}.pan`] && r.panner) { const c = curves[`L${i}.pan`], o = new Float32Array(c.length); for (let j = 0; j < c.length; j++) o[j] = Math.max(-1, Math.min(1, r.panBase + c[j] - 1)); write(r.panner.pan, o); params++; }
    });
    this.modStats = { lfos: p.mods.length, worklet: false, blocks, params, ms: +(performance.now() - t).toFixed(3) };
    return null;
  }
  get raw() { return this.Tone.getContext().rawContext; }
  // The peel-step insert: → low-pass (muffled) → pre gain → tanh soft clip → post gain → out.
  // Returns the insert's input. Curves are cached per drive (0.01 steps).
  paper(ctx, { cutoff = 360, q = 0.6, drive = 0.1, pre = 2.2 } = {}, out, nodes) {
    this.paperCurves ||= new Map();
    const k = Math.round(drive * 100) / 100;
    if (!this.paperCurves.has(k)) this.paperCurves.set(k, peelCurve(k));
    const { curve, post } = this.paperCurves.get(k);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = q;
    const g1 = ctx.createGain(); g1.gain.value = pre;
    const ws = ctx.createWaveShaper(); ws.curve = curve; ws.oversample = '2x';
    const g2 = ctx.createGain(); g2.gain.value = post;
    lp.connect(g1); g1.connect(ws); ws.connect(g2); g2.connect(out);
    nodes.push(lp, g1, ws, g2);
    return lp;
  }

  // A sustained, looping voice (the footstep "buzz" when the groove is so fast that the steps
  // merge into a tone, see client/src/groove.js): buffer loops from `time`, fades in/out.
  // Returns { stop(), setPos([x,y,z]), setGain(g) } or null.
  loop(buffer, { gain = 1, fx = null, pos = null, time = null, fade = 0.03 } = {}) {
    if (!buffer) return null;
    const ctx = this.raw, t0 = Math.max(time ?? 0, ctx.currentTime);
    const dest = this.chain(fx); let out = dest.input || dest;
    const nodes = []; let pan = null;
    if (pos) {
      pan = ctx.createPanner(); pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 1.6; pan.rolloffFactor = 1; pan.maxDistance = 30;
      if (pan.positionX) { pan.positionX.value = pos[0]; pan.positionY.value = pos[1]; pan.positionZ.value = pos[2]; } else pan.setPosition(...pos);
      pan.connect(out); out = pan; nodes.push(pan);
    }
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + fade); g.connect(out); nodes.push(g);
    const src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true; src.connect(g); src.start(t0); nodes.push(src);
    let stopped = false;
    return {
      stop: (at = null) => {
        if (stopped) return; stopped = true;
        const t = Math.max(at ?? 0, ctx.currentTime);
        try { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + fade); src.stop(t + fade + 0.01); } catch { /* ok */ }
        src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch { /* ok */ } } };
      },
      setPos: (p) => { if (!pan || !p) return; if (pan.positionX) { pan.positionX.value = p[0]; pan.positionY.value = p[1]; pan.positionZ.value = p[2]; } else pan.setPosition(...p); },
      get stopped() { return stopped; },
    };
  }

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
  layer(ctx, l, out, t, rate, idx = -1) {
    const modOn = (k) => !!this.modTargets?.has(`L${idx}.${k}`);
    const nodes = [], srcs = [];
    const freq = Math.min(8000, l.freq * rate), cutoff = Math.min(18000, l.cutoff * rate);
    let end2 = 0;
    let peakAt = t + l.a, decEnd = peakAt + l.d, gateEnd = decEnd + l.hold, end = gateEnd + l.r, stop = end + 0.02;
    let sus = Math.max(0.0001, l.s);
    const pitch = []; // the detune params the pitch LFOs drive: { param, base (cents) }
    let samplerSrc = null;
    let poly = null;
    if (l.kind === 'sampler') {
      const raw0 = l.sample && SAMPLE_BUFFERS.get(l.sample); if (!raw0) return null;
      const { buf, start, end: endPt, loopStart, loopEnd } = this.samplerBuffer(ctx, raw0, l);
      const ratio = samplerRate(l) * rate, dur = buf.duration;
      const gate = l.whole && !l.loop ? Math.min(SYNTH.maxSampleSeconds, ((endPt - start) * dur) / ratio) : null;
      if (gate != null) { // one-shot: attack → full level → released so it ends exactly at the end point
        decEnd = peakAt; sus = 1; end2 = t + gate; gateEnd = Math.max(peakAt, end2 - l.r); end = Math.max(gateEnd + 0.002, end2); stop = end + 0.02;
      }
      samplerSrc = ctx.createBufferSource(); samplerSrc.buffer = buf;
      if (l.loop) { samplerSrc.loop = true; samplerSrc.loopStart = loopStart * dur; samplerSrc.loopEnd = loopEnd * dur; }
      if (l.pitchAmt) { samplerSrc.playbackRate.setValueAtTime(ratio * Math.pow(2, l.pitchAmt / 12), t); samplerSrc.playbackRate.exponentialRampToValueAtTime(ratio, t + l.pitchTime); }
      else samplerSrc.playbackRate.value = ratio;
      samplerSrc.detune.value = l.detune; pitch.push({ param: samplerSrc.detune, base: l.detune });
      samplerSrc.__offset = start * dur;
      poly = { key: l.sample, max: l.poly || 4 };
    }
    const head = ctx.createGain(); nodes.push(head);
    if (samplerSrc) { samplerSrc.connect(head); srcs.push({ node: samplerSrc, offset: samplerSrc.__offset }); }
    else if (l.kind === 'mic') { // live mic (mic.js): this voice's envelope/filter/… open a gate on it
      const mic = this.micSource(); if (!mic) return null; // no permission yet: silent (never asks here)
      const tap = ctx.createGain(); mic.connect(tap); tap.connect(head); nodes.push(tap);
      const clock = ctx.createConstantSource(); clock.offset.value = 0; clock.connect(head); srcs.push({ node: clock }); // silent: gives the voice its start/stop/onended
      setTimeout(() => { try { mic.disconnect(tap); } catch { /* gone */ } }, Math.max(0, stop - ctx.currentTime) * 1000 + 200);
    } else if (l.kind === 'noise') {
      const n = ctx.createBufferSource(); n.buffer = this.noiseBuffer(ctx, l.noise); n.loop = true; n.playbackRate.value = rate;
      n.connect(head); srcs.push({ node: n, offset: Math.random() * 0.5 });
    } else {
      const start = Math.min(8000, freq * Math.pow(2, l.pitchAmt / 12));
      const voices = l.unison;
      for (let u = 0; u < voices; u++) {
        const o = ctx.createOscillator(); o.type = l.wave;
        const spread = voices > 1 ? (u / (voices - 1) - 0.5) * 2 * l.spread : 0;
        o.detune.value = l.detune + spread; pitch.push({ param: o.detune, base: l.detune + spread });
        o.frequency.setValueAtTime(start, t);
        if (l.pitchAmt) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq), t + l.pitchTime);
        const g = ctx.createGain(); g.gain.value = 1 / Math.sqrt(voices); o.connect(g); g.connect(head); nodes.push(g);
        srcs.push({ node: o });
      }
      if (l.sub > 0) {
        const s = ctx.createOscillator(); s.type = 'sine'; pitch.push({ param: s.detune, base: 0 });
        s.frequency.setValueAtTime(start / 2, t); if (l.pitchAmt) s.frequency.exponentialRampToValueAtTime(Math.max(10, freq / 2), t + l.pitchTime);
        const g = ctx.createGain(); g.gain.value = l.sub; s.connect(g); g.connect(head); nodes.push(g); srcs.push({ node: s });
      }
    }
    let into = head;
    if (l.drive > 0) { const ws = ctx.createWaveShaper(); ws.curve = this.driveCurve(l.drive); head.connect(ws); into = ws; nodes.push(ws); }
    // decimation (sample-and-hold + bits, decimator.js): one worklet node, only when the layer uses it
    let decim = null;
    if (l.decim > 1 || l.crush > 0 || modOn('decim')) {
      decim = makeDecimator(this.Tone.getContext(), l.decim || 1, l.crush || 0);
      if (decim) { into.connect(decim); into = decim; nodes.push(decim); }
    }
    const filter = ctx.createBiquadFilter(); filter.type = l.filter; filter.Q.value = l.q;
    filter.frequency.setValueAtTime(cutoff, t);
    if (l.fEnv) filter.frequency.exponentialRampToValueAtTime(Math.min(18000, Math.max(20, cutoff * Math.pow(2, l.fEnv))), t + l.fTime);
    into.connect(filter); nodes.push(filter);
    // ADSR with exponential decay/release (like the original hand-made sounds)
    const env = ctx.createGain(), g = env.gain;
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
    let panner = null;
    if (l.kind === 'sampler' && (l.pan || modOn('pan')) && ctx.createStereoPanner) { panner = ctx.createStereoPanner(); panner.pan.value = l.pan; level.connect(panner); panner.connect(out); nodes.push(panner); }
    else level.connect(out);
    for (const s of srcs) { s.node.start(t, s.offset); s.node.stop(stop); nodes.push(s.node); }
    if (poly) this.voiceLimit(ctx, poly, env, srcs[0].node, t, stop);
    return { nodes, end: stop, src: srcs[0].node, pitch, filter, q: l.q, level, levelBase: l.level, decim, decimBase: l.decim || 1, panner, panBase: l.pan || 0 };
  }
  // Sampler polyphony: at most `max` voices of one sample ring at once; the oldest is faded out (8 ms).
  voiceLimit(ctx, { key, max }, env, src, t, stop) {
    const now = ctx.currentTime;
    const list = (this.polys.get(key) || []).filter((v) => v.end > now);
    while (list.length >= max) {
      const v = list.shift();
      try { v.env.gain.cancelScheduledValues(t); v.env.gain.setTargetAtTime(0, t, 0.008); v.src.stop(t + 0.05); } catch { /* ended */ }
      this.stolen = (this.stolen || 0) + 1;
    }
    list.push({ env, src, end: stop }); this.polys.set(key, list);
  }
  // The buffer a sampler layer plays: reversed and/or with a crossfaded loop seam when asked (cached).
  // Returns { buf, start, end, loopStart, loopEnd } with positions (0–1) in that buffer.
  samplerBuffer(ctx, raw, l) {
    let start = l.start ?? 0, end = l.end ?? 1, ls = l.loopStart ?? start, le = l.loopEnd ?? end;
    if (l.reverse) { [start, end, ls, le] = [1 - end, 1 - start, 1 - le, 1 - ls]; }
    const xf = l.loop ? l.xfade || 0 : 0;
    if (!l.reverse && !xf) return { buf: raw, start, end, loopStart: ls, loopEnd: le };
    this.sbufs ||= new Map();
    const key = `${l.sample}|${l.reverse ? 1 : 0}|${xf ? `${ls}:${le}:${xf}` : ''}|${raw.length}`;
    let buf = this.sbufs.get(key);
    if (!buf) {
      const n = raw.length; buf = ctx.createBuffer(raw.numberOfChannels, n, raw.sampleRate);
      for (let c = 0; c < raw.numberOfChannels; c++) {
        const src = raw.getChannelData(c), d = buf.getChannelData(c);
        if (l.reverse) for (let i = 0; i < n; i++) d[i] = src[n - 1 - i]; else d.set(src);
        if (xf) { // the last X samples before loopEnd fade into the X samples before loopStart → no click at the seam
          const a = Math.round(ls * n), b = Math.round(le * n), X = Math.min(Math.round(xf * raw.sampleRate), a, b - a);
          const copy = d.slice(a - X, a);
          for (let i = 0; i < X; i++) { const w = i / X; d[b - X + i] = d[b - X + i] * (1 - w) + copy[i] * w; }
        }
      }
      if (this.sbufs.size > 24) this.sbufs.clear();
      this.sbufs.set(key, buf);
    }
    return { buf, start, end, loopStart: ls, loopEnd: le };
  }
}

// tanh soft clip: unity for small signals, never above ±1.
function softClipCurve() {
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.abs(x) < 0.5 ? x : Math.sign(x) * (0.5 + 0.5 * Math.tanh((Math.abs(x) - 0.5) / 0.5)); }
  return c;
}
// Soft fold for city intersection Distortion peaks (amount 0..1). Output stays in ±1 so the master guard does not engage hard.
function placeDistCurve(amount = 0.2) {
  const k = Math.max(0.01, Math.min(1, amount) * 28);
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return c;
}
// Why the voices are plain Web Audio and not Tone instruments: every Tone node wraps its params
// in Signal objects, so building one short one-shot voice cost 3–7 ms of main-thread time
// (measured in Chromium), too much for rapid slaps, several players' footsteps and phones.
// Native nodes are ~10× cheaper and need no dispose. Tone.js still does what it is good at:
// the context, the effects (Reverb with generated impulse responses, Feedback/PingPong delay,
// BitCrusher, Distortion, Filter + CrossFade), the room bus and Tone.Offline for the tests.
export { FX_DEFAULTS };

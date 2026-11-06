// Voice chat: the sound goes straight between the browsers (WebRTC). The server only passes the
// "signal" messages (offer / answer / ICE candidates) to another player in the same room
// (server/realtime.js). A room has at most 5 players in the demo (10 otherwise), so every browser
// simply connects to every other one (a mesh): no media server.
//
//   - The microphone is OFF until you press 🎙 (or B). The first press asks for permission.
//     After that 🎙 mutes and unmutes (the connection stays, nothing is sent while muted).
//   - You hear the others even with your own mic off.
//   - Voices fade a little with distance (optional, ⚙ More → Sound), never below 30 %.
//   - A small mark shows above whoever is talking (and ·)) in People here).
//   - Public STUN only (stun.l.google.com). Without a TURN server some networks (strict company
//     or carrier NATs) cannot connect: then voice silently does not work for that pair.
// Perfect negotiation (https://w3c.github.io/webrtc-pc/#perfect-negotiation-example): either side
// may (re)offer at any time; on a clash the "polite" side (the larger id) gives way.
import { quantLevel } from '../../shared/director.mjs';
import { MASTER } from '../../shared/clock.mjs';
import { RUN } from '../../shared/runmode.mjs';
import { getMic, releaseMic, onMicStream, setMicRaw, micRaw } from './mic.js';
import { makeDecimator } from './decimator.js';

// ---------- Voice effect (Jens, 5 Nov 2026; Hear myself + instrument FX 6 Nov 2026) ----------
// Optional, per player, OFF by default (= the dry voice, exactly as before). Applied on the
// SENDER: my mic → Web Audio effect → a MediaStreamDestination track, which replaces the track my
// peers get (RTCRtpSender.replaceTrack – no renegotiation). Why the sender: it is MY voice, like my
// sound (and everyone hears the same thing), it costs one chain per player instead of one per pair,
// and nobody needs to know about effects to hear it. Echo cancellation still works: it runs at
// capture, before the effect (unless "Raw mic" is on for instrument use). Off = replaceTrack back
// to the original mic track and the chain is torn down.
// Kinds: radio, echo (tempo-synced delay), hall, robot, chorus, pitch (pentatonic), harmony
// (fifth / octave). amount 0–1: wet / intensity.
// "Hear myself" (monitor): the SAME processed signal taps into my headphones so I can play the
// voice as an instrument alone. Never goes back into the mic when headphones are used.
export const VOICE_FX = {
  kinds: ['dry', 'radio', 'echo', 'hall', 'robot', 'chorus', 'pitch', 'harmony'],
  names: {
    dry: 'Dry', radio: '📻 Radio', echo: '🔁 Echo (tempo)', hall: '⛪ Hall', robot: '🤖 Robot / crush',
    chorus: '🌊 Chorus', pitch: '🎹 Pitch', harmony: '🎼 Harmony',
  },
  // delay subdivisions in beats of the master clock (shared/clock.mjs, 90 BPM by default)
  divs: ['1/4', '1/8', '1/8.'],
  divBeats: { '1/4': 1, '1/8': 0.5, '1/8.': 0.75 },
  divNames: { '1/4': '1/4 note', '1/8': '1/8 note', '1/8.': 'dotted 1/8' },
  harm: ['fifth', 'octave', 'fifthOct'],
  harmNames: { fifth: '+ fifth', octave: '+ octave', fifthOct: '+ fifth & octave' },
  harmSt: { fifth: [7], octave: [12], fifthOct: [7, 12] },
  beat: 60 / MASTER.bpm,
  // major-pentatonic ladder (same steps as run mode): snap pitch to these semitones
  pentatonic: Object.freeze([...RUN.pitchDown].reverse().concat([0], [...RUN.pitchUp])),
  pitchMin: -12, pitchMax: 19, pitchDef: 7,
  monKey: 'klibb.voiceMon',
  monVolDef: 0.7,
};
export function delaySec(div = '1/8', bpm = MASTER.bpm) {
  const beats = VOICE_FX.divBeats[VOICE_FX.divs.includes(div) ? div : '1/8'] ?? 0.5;
  const b = Number(bpm); const rate = Number.isFinite(b) && b > 0 ? b : MASTER.bpm;
  return (60 / rate) * beats;
}
export function snapVoicePitch(st) {
  const n = Number(st);
  if (!Number.isFinite(n)) return VOICE_FX.pitchDef;
  const c = Math.min(VOICE_FX.pitchMax, Math.max(VOICE_FX.pitchMin, n));
  let best = VOICE_FX.pentatonic[0], bd = Infinity;
  for (const p of VOICE_FX.pentatonic) { const e = Math.abs(p - c); if (e < bd - 1e-9) { bd = e; best = p; } }
  return best;
}
export function pitchLabel(st) {
  const s = snapVoicePitch(st);
  const name = ({ 0: 'unison', 2: 'tone', 4: 'third', 7: 'fifth', 9: 'sixth', 12: 'octave',
    14: 'octave + tone', 16: 'octave + third', 19: 'octave + fifth', 3: 'min 3rd', 5: 'fourth',
    8: 'min 6th', 10: 'min 7th' })[Math.abs(s)] || '';
  return `${s > 0 ? '+' : ''}${s} st${s && name ? ` (${name})` : ''}`;
}
export function cleanVoiceFx(f) {
  const o = f && typeof f === 'object' ? f : {};
  const a = Number(o.amount);
  const pitch = snapVoicePitch(o.pitch);
  return {
    on: o.on === true,
    kind: VOICE_FX.kinds.includes(o.kind) ? o.kind : 'radio',
    amount: Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 0.6,
    div: VOICE_FX.divs.includes(o.div) ? o.div : '1/8',
    pitch,
    harm: VOICE_FX.harm.includes(o.harm) ? o.harm : 'fifth',
  };
}
export function cleanMonitor(m) {
  const o = m && typeof m === 'object' ? m : {};
  const v = Number(o.vol);
  return {
    on: o.on === true,
    vol: Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : VOICE_FX.monVolDef,
    raw: o.raw === true,
  };
}

function hallIR(ctx, sec = 2.4) {
  const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3); }
  return b;
}

// Pure Web Audio dual-delay pitch shifter (same idea as Tone.PitchShift: two windowed delays whose
// delayTime ramps with opposite-phase saw LFOs). Works without Tone being ready.
function makePitchShift(ctx, semitones, windowSize = 0.08) {
  const input = ctx.createGain(), output = ctx.createGain();
  const delayA = ctx.createDelay(1), delayB = ctx.createDelay(1);
  const mixA = ctx.createGain(), mixB = ctx.createGain();
  mixA.gain.value = 0.5; mixB.gain.value = 0.5;
  input.connect(delayA); input.connect(delayB);
  delayA.connect(mixA); delayB.connect(mixB);
  mixA.connect(output); mixB.connect(output);
  const lfoA = ctx.createOscillator(), lfoB = ctx.createOscillator();
  lfoA.type = 'sawtooth'; lfoB.type = 'sawtooth';
  // phase offset ≈ 180° via a wave-shaping delay on B's control signal
  const freq = 1 / Math.max(0.02, windowSize);
  lfoA.frequency.value = freq; lfoB.frequency.value = freq;
  const scaleA = ctx.createGain(), scaleB = ctx.createGain();
  const depth = windowSize;
  // pitch up → delay decreases over the window (negative ramp depth); pitch down → positive
  const st = Number(semitones) || 0;
  const ratio = Math.pow(2, st / 12);
  // Classic mapping: depth of delay modulation sets the shift amount
  const delayDepth = Math.min(0.25, Math.abs(1 - ratio) * windowSize * 2 + 0.001);
  scaleA.gain.value = st >= 0 ? -delayDepth / 2 : delayDepth / 2;
  scaleB.gain.value = st >= 0 ? -delayDepth / 2 : delayDepth / 2;
  const biasA = ctx.createConstantSource(), biasB = ctx.createConstantSource();
  biasA.offset.value = depth / 2; biasB.offset.value = depth / 2;
  lfoA.connect(scaleA); scaleA.connect(delayA.delayTime); biasA.connect(delayA.delayTime);
  // invert B by routing through a Gain(-1) so the windows alternate
  const inv = ctx.createGain(); inv.gain.value = -1;
  lfoB.connect(inv); inv.connect(scaleB); scaleB.connect(delayB.delayTime); biasB.connect(delayB.delayTime);
  lfoA.start(); lfoB.start(); biasA.start(); biasB.start();
  const stop = () => {
    for (const n of [lfoA, lfoB, biasA, biasB]) try { n.stop(); } catch { /* ok */ }
    for (const n of [input, output, delayA, delayB, mixA, mixB, scaleA, scaleB, inv, lfoA, lfoB, biasA, biasB]) {
      try { n.disconnect(); } catch { /* ok */ }
    }
  };
  return { input, output, stop };
}

// Build the chain: src (MediaStreamSource) → … → tap (Gain) → dest. Returns { nodes, tap, stop() }.
// Monitor connects to `tap` (before MediaStreamDestination) for lower latency into headphones.
export function buildVoiceFx(ctx, src, dest, fx, tctx = null, bpm = MASTER.bpm) {
  const f = cleanVoiceFx(fx);
  const kind = f.kind, a = f.amount;
  const nodes = [], mk = (n) => { nodes.push(n); return n; }, gain = (v) => { const g = mk(ctx.createGain()); g.gain.value = v; return g; };
  const tap = mk(ctx.createGain()); tap.gain.value = 1;
  tap.connect(dest);
  const extra = [];
  const pitchTo = (semitones, wet) => {
    const ps = makePitchShift(ctx, semitones);
    extra.push(ps.stop);
    const w = gain(wet), d = gain(Math.max(0, 1 - wet * 0.85));
    src.connect(ps.input); ps.output.connect(w); w.connect(tap);
    src.connect(d); d.connect(tap);
  };

  if (kind === 'radio' || kind === 'robot') {
    let x = src;
    if (kind === 'radio') {
      const hp = mk(ctx.createBiquadFilter()); hp.type = 'highpass'; hp.frequency.value = 300; hp.Q.value = 0.7;
      const lp = mk(ctx.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 3000; lp.Q.value = 0.7;
      const sh = mk(ctx.createWaveShaper()); const k = 1 + 8 * a, c = new Float32Array(1024); for (let i = 0; i < c.length; i++) { const v = (i / 511.5) - 1; c[i] = Math.tanh(k * v) / Math.tanh(k); } sh.curve = c;
      x.connect(hp); hp.connect(lp); lp.connect(sh); x = sh;
      const hiss = mk(ctx.createBufferSource()); const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      hiss.buffer = nb; hiss.loop = true; const hg = gain(0.004 + 0.012 * a); const hbp = mk(ctx.createBiquadFilter()); hbp.type = 'bandpass'; hbp.frequency.value = 2000;
      hiss.connect(hbp); hbp.connect(hg); hg.connect(tap); hiss.start(); extra.push(() => { try { hiss.stop(); } catch { /* ok */ } });
    }
    const dec = tctx ? makeDecimator(tctx, kind === 'robot' ? 3 + 14 * a : 1 + 2 * a, kind === 'robot' ? 10 - 6 * a : 0) : null;
    if (dec) { nodes.push(dec); x.connect(dec); x = dec; }
    if (kind === 'robot') {
      const dl = mk(ctx.createDelay(0.05)); dl.delayTime.value = 0.009; const fb = gain(0.35 + 0.4 * a), cw = gain(0.6);
      x.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(cw); cw.connect(tap);
    }
    const out = gain(kind === 'radio' ? 0.9 : 0.8); x.connect(out); out.connect(tap);
  } else if (kind === 'echo') {
    const dry = gain(1); src.connect(dry); dry.connect(tap);
    const dl = mk(ctx.createDelay(2)); dl.delayTime.value = delaySec(f.div, bpm);
    const fb = gain(0.2 + 0.35 * a), wet = gain(0.65 * a);
    src.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(tap);
  } else if (kind === 'hall') {
    const dry = gain(1); src.connect(dry); dry.connect(tap);
    const cv = mk(ctx.createConvolver()); cv.buffer = hallIR(ctx); const wet = gain(0.8 * a);
    src.connect(cv); cv.connect(wet); wet.connect(tap);
  } else if (kind === 'chorus') {
    const dry = gain(1 - 0.45 * a); src.connect(dry); dry.connect(tap);
    const dl = mk(ctx.createDelay(0.05)); dl.delayTime.value = 0.012;
    const lfo = mk(ctx.createOscillator()); lfo.type = 'sine'; lfo.frequency.value = 0.6 + 1.4 * a;
    const depth = gain(0.003 + 0.006 * a); lfo.connect(depth); depth.connect(dl.delayTime);
    const base = ctx.createConstantSource(); base.offset.value = 0.012; nodes.push(base); base.connect(dl.delayTime); base.start();
    lfo.start(); extra.push(() => { try { lfo.stop(); base.stop(); } catch { /* ok */ } });
    const wet = gain(0.55 * a); src.connect(dl); dl.connect(wet); wet.connect(tap);
  } else if (kind === 'pitch') {
    pitchTo(f.pitch, 0.35 + 0.65 * a);
  } else if (kind === 'harmony') {
    const dry = gain(1); src.connect(dry); dry.connect(tap);
    const sts = VOICE_FX.harmSt[f.harm] || VOICE_FX.harmSt.fifth;
    const wetEach = (0.35 + 0.45 * a) / sts.length;
    for (const st of sts) {
      const ps = makePitchShift(ctx, st);
      extra.push(ps.stop);
      const w = gain(wetEach); src.connect(ps.input); ps.output.connect(w); w.connect(tap);
    }
  } else { src.connect(tap); }

  return {
    nodes, tap,
    stop() {
      for (const fn of extra) fn();
      for (const n of nodes) { try { n.disconnect(); } catch { /* ok */ } }
      try { src.disconnect(); } catch { /* ok */ }
    },
  };
}

export const VOICE = { ice: [{ urls: 'stun:stun.l.google.com:19302' }], near: 1.8, floor: 0.3, talkOn: 0.012, talkOff: 0.006, holdMs: 350, statsMs: 200, sendMs: 80 };
// My own loudness while I talk goes to the server ~12 times a second as a number 0…15 (never
// audio), and only while the room is being recorded (● REC shows): it ends up in the session
// recording, for the mouth and the auto-director in the replay (shared/director.mjs).
// Mic off or muted = nothing is sent.

function rms(analyser, buf) { analyser.getFloatTimeDomainData(buf); let s = 0; for (const x of buf) s += x * x; return Math.sqrt(s / buf.length); }

export class Voice {
  // net: { id, sendSignal(to, data) } · sound: Sounds (for the AudioContext) · positionOf(id) → {x, z} | null
  // listener() → {x, z} · onSpeaking(id, on, level) (id 'me' = me) · onState(state) · toast(msg)
  // tempo() → bpm of the room's master clock (for tempo-synced echo)
  constructor({ net, sound = null, positionOf = () => null, listener = () => null, onSpeaking = () => {}, onState = () => {}, toast = () => {}, ice = VOICE.ice, tempo = () => MASTER.bpm }) {
    Object.assign(this, { net, sound, positionOf, listener, onSpeaking, onState, toast, ice, tempo });
    this.peers = new Map(); // id -> peer
    this.state = 'off';     // 'off' | 'on' | 'muted'
    this.stream = null; this.track = null; this.near = true;
    this.me = { talking: false, quietAt: 0, level: 0, analyser: null, buf: null };
    this.lastStats = 0; this.log = []; this.people = [];
    this.fx = cleanVoiceFx(null);
    this.monitor = cleanMonitor(null);
    this._unsubMic = onMicStream((s) => { if (this.state !== 'off') this.remic(s); });
  }
  get supported() { return !!(typeof RTCPeerConnection === 'function' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
  // 🎙: off → on (asks for the microphone the first time) → muted → on …
  async toggle() {
    if (this.state === 'off') return this.start();
    this.setMuted(this.state === 'on');
    return this.state;
  }
  async start() {
    if (!this.supported) { this.toast('unsupported'); return this.state; }
    if (this.starting) return this.starting;
    this.starting = (async () => {
      // the page's ONE mic (mic.js, shared with mic layers); voice chat sends a CLONE of its track,
      // so muting voice chat doesn't silence a mic layer (and the other way round)
      const shared = await getMic('voice');
      if (!shared) { releaseMic('voice'); this.toast('denied'); return this.state; }
      this.track = shared.getAudioTracks()[0].clone();
      this.stream = new MediaStream([this.track]);
      this.applyFx();
      this.applyMonitor();
      this.state = 'on'; this.onState(this.state); this.toast('on');
      for (const p of this.peers.values()) this.addTrack(p);
      for (const id of this.people) this.peer(id); // everyone already here: I call them
      this.watchMe();
      return this.state;
    })().finally(() => { this.starting = null; });
    return this.starting;
  }
  // Shared mic was re-opened (raw ↔ chat): swap my clone and rebuild the chain.
  remic(shared) {
    if (!shared || this.state === 'off') return;
    try { if (this.track) this.track.stop(); } catch { /* ok */ }
    this.track = shared.getAudioTracks()[0].clone();
    this.track.enabled = this.state !== 'muted';
    this.stream = new MediaStream([this.track]);
    this.applyFx();
    this.applyMonitor();
    this.watchMe();
  }
  // ~12 Hz while I talk, and one 0 when I stop (or mute, or turn the mic off).
  sendLevel(q, now) {
    if (q === 0 && !this.me.sentQ) return;
    if (q > 0 && !(this.recording && this.recording())) return; // only into a running recording
    if (q > 0 && now - (this.me.sentAt || 0) < VOICE.sendMs) return;
    this.me.sentQ = q; this.me.sentAt = now;
    if (this.net.sendTalk) this.net.sendTalk(q);
  }
  setMuted(m) {
    if (!this.track) return;
    if (m) this.sendLevel(0, performance.now());
    this.track.enabled = !m; this.state = m ? 'muted' : 'on';
    if (m && this.me.talking) { this.me.talking = false; this.onSpeaking('me', false, 0); }
    // muted = silence into the monitor too (track.enabled does it; also duck the gain for safety)
    if (this.monGain) this.monGain.gain.value = m ? 0 : this.monitor.vol;
    this.onState(this.state); this.toast(m ? 'muted' : 'on');
  }
  // The players in the room now (ids, without me). New ones get a connection if I am sending;
  // otherwise they connect to me when THEY start talking. Gone ones are closed.
  setPeople(ids) {
    this.people = [...ids];
    const want = new Set(ids);
    for (const id of [...this.peers.keys()]) if (!want.has(id)) this.drop(id);
    if (this.track) for (const id of ids) this.peer(id);
  }
  peer(id) {
    let p = this.peers.get(id);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    p = { id, pc, polite: String(this.net.id || '') > String(id), makingOffer: false, ignoreOffer: false, sender: null, audio: null, gain: null, src: null, level: 0, talking: false, quietAt: 0, stream: null };
    this.peers.set(id, p);
    pc.onicecandidate = (e) => { if (e.candidate) this.send(id, { c: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
    pc.onnegotiationneeded = async () => {
      try {
        p.makingOffer = true;
        await pc.setLocalDescription();
        this.send(id, { d: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      } catch (e) { this.log.push(`offer ${id}: ${e.message}`); } finally { p.makingOffer = false; }
    };
    pc.ontrack = (e) => this.hear(p, e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]));
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' && pc.restartIce) pc.restartIce(); };
    if (this.track) this.addTrack(p);
    return p;
  }
  addTrack(p) { if (!p.sender && this.track) p.sender = p.pc.addTrack(this.sendTrack(), this.stream); }
  sendTrack() { return (this.fxChain && this.fxChain.track) || this.track; }
  // The voice effect (VOICE_FX above): (re)build or remove the chain, then swap the sent track.
  setFx(f) { this.fx = cleanVoiceFx({ ...(this.fx || {}), ...f }); this.applyFx(); this.applyMonitor(); return this.fx; }
  applyFx() {
    const f = this.fx || cleanVoiceFx(null);
    if (this.fxChain) { this.fxChain.stop(); this.fxChain = null; }
    const ctx = this.track && f.on && f.kind !== 'dry' && this.sound && this.sound.ensure ? this.sound.ensure() : null;
    if (ctx && ctx.createMediaStreamDestination) {
      try {
        const src = ctx.createMediaStreamSource(new MediaStream([this.track])), dest = ctx.createMediaStreamDestination();
        const bpm = typeof this.tempo === 'function' ? this.tempo() : MASTER.bpm;
        const chain = buildVoiceFx(ctx, src, dest, f, this.sound.Tone ? this.sound.Tone.getContext() : null, bpm);
        this.fxChain = { ...chain, track: dest.stream.getAudioTracks()[0], kind: f.kind };
      } catch (e) { this.log.push('voice fx: ' + e.message); this.fxChain = null; }
    }
    const t = this.sendTrack();
    for (const p of this.peers.values()) if (p.sender && p.sender.track !== t) p.sender.replaceTrack(t).catch((e) => this.log.push('replaceTrack: ' + e.message));
  }
  // Hear myself: tap the processed (or dry) voice into my output. Headphones recommended.
  setMonitor(m) {
    this.monitor = cleanMonitor({ ...(this.monitor || {}), ...m });
    this.applyMonitor();
    return this.monitor;
  }
  applyMonitor() {
    this.stopMonitor();
    const mon = this.monitor || cleanMonitor(null);
    if (!mon.on || !this.track || this.state === 'off') return;
    const ctx = this.sound && this.sound.ensure ? this.sound.ensure() : null;
    if (!ctx || !ctx.destination) return;
    try {
      const g = ctx.createGain();
      g.gain.value = this.state === 'muted' ? 0 : mon.vol;
      if (this.fxChain && this.fxChain.tap) {
        this.fxChain.tap.connect(g);
      } else {
        const src = ctx.createMediaStreamSource(new MediaStream([this.track]));
        src.connect(g);
        this.monSrc = src;
      }
      g.connect(ctx.destination);
      this.monGain = g;
    } catch (e) { this.log.push('monitor: ' + e.message); this.stopMonitor(); }
  }
  stopMonitor() {
    try { this.monSrc && this.monSrc.disconnect(); } catch { /* ok */ }
    try { this.monGain && this.monGain.disconnect(); } catch { /* ok */ }
    if (this.fxChain && this.fxChain.tap && this.monGain) {
      try { this.fxChain.tap.disconnect(this.monGain); } catch { /* ok */ }
    }
    this.monSrc = null; this.monGain = null;
  }
  // Flip raw mic (instrument) ↔ chat processing. Re-opens getUserMedia; remic() rebuilds the chain.
  async setRaw(want) {
    this.monitor = cleanMonitor({ ...(this.monitor || {}), raw: !!want });
    await setMicRaw(!!want);
    return micRaw();
  }
  send(to, data) { this.net.sendSignal(to, data); }
  async onSignal(from, data) {
    if (!data || typeof data !== 'object' || typeof from !== 'string') return;
    const p = this.peer(from), pc = p.pc;
    try {
      if (data.d && typeof data.d.type === 'string') {
        const offer = data.d.type === 'offer';
        const clash = offer && (p.makingOffer || pc.signalingState !== 'stable');
        p.ignoreOffer = !p.polite && clash;
        if (p.ignoreOffer) return;
        await pc.setRemoteDescription(data.d);
        if (offer) { await pc.setLocalDescription(); this.send(from, { d: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }); }
      } else if (data.c) {
        try { await pc.addIceCandidate(data.c); } catch (e) { if (!p.ignoreOffer) throw e; }
      }
    } catch (e) { this.log.push(`signal ${from}: ${e.message}`); }
  }
  // Their voice: through Web Audio (a gain for the distance) when the audio is running, else the
  // <audio> element's own volume. Chrome only lets a WebRTC stream into Web Audio while it is also
  // attached to a media element, so the element is always there (muted when Web Audio plays it).
  hear(p, stream) {
    if (p.stream === stream) return;
    p.stream = stream;
    if (!p.audio) { p.audio = document.createElement('audio'); p.audio.autoplay = true; p.audio.playsInline = true; p.audio.dataset.voice = p.id; p.audio.style.display = 'none'; document.body.appendChild(p.audio); }
    p.audio.srcObject = stream;
    const ctx = this.sound && this.sound.ensure ? this.sound.ensure() : null;
    if (ctx && ctx.state === 'running' && ctx.createMediaStreamSource) {
      try {
        p.src = ctx.createMediaStreamSource(stream); p.gain = ctx.createGain();
        p.src.connect(p.gain).connect(ctx.destination);
        p.analyser = ctx.createAnalyser(); p.analyser.fftSize = 512; p.buf = new Float32Array(p.analyser.fftSize); p.src.connect(p.analyser);
        p.audio.muted = true;
      } catch { p.gain = null; p.audio.muted = false; }
    } else p.audio.muted = false;
    const pl = p.audio.play && p.audio.play(); if (pl && pl.catch) pl.catch(() => {});
  }
  drop(id) {
    const p = this.peers.get(id); if (!p) return;
    try { p.pc.close(); } catch { /* */ }
    try { p.src && p.src.disconnect(); p.gain && p.gain.disconnect(); p.analyser && p.analyser.disconnect(); } catch { /* */ }
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    if (p.talking) this.onSpeaking(id, false, 0);
    this.peers.delete(id);
  }
  closeAll() {
    this.sendLevel(0, performance.now());
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.stopMonitor();
    if (this.fxChain) { this.fxChain.stop(); this.fxChain = null; }
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    if (this.track) releaseMic('voice');
    this.stream = null; this.track = null; this.state = 'off'; this.onState(this.state);
  }
  // My own level (for the 🎙 glow), from an analyser on my microphone.
  watchMe() {
    const ctx = this.sound && this.sound.ensure ? this.sound.ensure() : null;
    if (!ctx || !ctx.createMediaStreamSource || !this.stream) return;
    try { const a = ctx.createAnalyser(); a.fftSize = 512; ctx.createMediaStreamSource(this.stream).connect(a); this.me.analyser = a; this.me.buf = new Float32Array(a.fftSize); } catch { /* no glow */ }
  }
  talk(who, id, level, now) {
    who.level = level;
    if (level > VOICE.talkOn) { who.quietAt = now + VOICE.holdMs; if (!who.talking) { who.talking = true; this.onSpeaking(id, true, level); } else this.onSpeaking(id, true, level); }
    else if (who.talking && level < VOICE.talkOff && now > who.quietAt) { who.talking = false; this.onSpeaking(id, false, 0); }
  }
  // Every frame: distance → volume; a few times a second: who is talking (inbound audioLevel).
  update(now = performance.now()) {
    const L = this.listener();
    for (const p of this.peers.values()) {
      if (!p.stream) continue;
      let v = 1;
      const at = this.near && L ? this.positionOf(p.id) : null;
      if (at) { const d = Math.hypot(at.x - L.x, at.z - L.z); v = Math.max(VOICE.floor, Math.min(1, VOICE.near / (VOICE.near + Math.max(0, d - VOICE.near)))); }
      p.volume = v;
      if (p.gain) p.gain.gain.value = v; else if (p.audio && Math.abs(p.audio.volume - v) > 0.01) p.audio.volume = v;
    }
    if (this.me.analyser && this.state === 'on') {
      const lvl = rms(this.me.analyser, this.me.buf);
      this.talk(this.me, 'me', lvl, now);
      this.sendLevel(this.me.talking ? Math.max(1, quantLevel(lvl)) : 0, now);
    }
    for (const p of this.peers.values()) if (p.analyser) this.talk(p, p.id, rms(p.analyser, p.buf), now);
    if (now - this.lastStats < VOICE.statsMs) return;
    this.lastStats = now;
    for (const p of this.peers.values()) {
      if (p.analyser) continue;
      if (!p.stream || p.statsBusy) continue;
      p.statsBusy = true;
      p.pc.getStats().then((st) => {
        let lvl = 0;
        st.forEach((r) => { if (r.type === 'inbound-rtp' && (r.kind === 'audio' || r.mediaType === 'audio') && typeof r.audioLevel === 'number') lvl = Math.max(lvl, r.audioLevel); });
        this.talk(p, p.id, lvl, performance.now());
      }).catch(() => {}).finally(() => { p.statsBusy = false; });
    }
  }
  info() {
    return {
      state: this.state,
      peers: [...this.peers.values()].map((p) => ({ id: p.id, conn: p.pc.connectionState, ice: p.pc.iceConnectionState, sending: !!p.sender, hearing: !!p.stream,
        webAudio: !!p.gain, volume: p.volume ?? null, level: +(+p.level || 0).toFixed(4), talking: p.talking })),
      me: { talking: this.me.talking, level: +(+this.me.level || 0).toFixed(4) },
      fx: this.fx || cleanVoiceFx(null),
      fxChain: this.fxChain ? this.fxChain.kind : null,
      monitor: this.monitor || cleanMonitor(null),
      monitoring: !!this.monGain,
      raw: micRaw(),
      sentTracks: [...this.peers.values()].map((p) => (p.sender && p.sender.track ? (p.sender.track === this.track ? 'mic' : this.fxChain && p.sender.track === this.fxChain.track ? 'fx' : 'other') : null)),
      log: this.log.slice(-10),
    };
  }
}

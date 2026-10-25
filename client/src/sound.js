// Sounds, made on the fly with Web Audio (no sound files to download, nothing to license).
//   slap  – a short, punchy "thwack": a burst of filtered noise (the sticker hitting the wall)
//           on top of a quick low thump (the hand).
//   peel  – a softer "rrrip": noise through a sweeping band-pass filter with a crackle.
// Other people's slaps and peels are spatial: they come from where the sticker is, and get
// quieter with distance (PannerNode, HRTF). Each sound gets a small random pitch variation.
// Mute is remembered in localStorage ('klibb.muted').
const MUTE_KEY = 'klibb.muted';

export class Sounds {
  constructor() {
    this.ctx = null; this.master = null; this.noise = null;
    this.muted = localStorage.getItem(MUTE_KEY) === '1';
    this.log = []; // the last sounds (for tests and curious people): { kind, remote, distance, gain, rate }
    this.listener = { p: [0, 1.6, 0], f: [0, 0, -1] };
    // Browsers only allow audio after the user has clicked/tapped/typed: start then.
    const unlock = () => { this.ensure(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); };
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, unlock, { capture: true, passive: true });
  }
  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    try { this.ctx = new AC(); } catch { return null; }
    this.master = this.ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(this.ctx.destination);
    // One second of white noise, reused by every sound.
    const n = this.ctx.sampleRate, buf = this.ctx.createBuffer(1, n, n), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return this.ctx;
  }
  setMuted(m) { this.muted = !!m; localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0'); }
  // Where am I and which way am I looking (call every frame with the camera).
  setListener(pos, forward) {
    this.listener = { p: [pos.x, pos.y, pos.z], f: [forward.x, forward.y, forward.z] };
    const ctx = this.ctx; if (!ctx) return;
    // Bara när något ändrats, och med .value (inte setValueAtTime): en automationshändelse per
    // bildruta och parameter gör att ljudtrådens tidslinjer växer hela tiden.
    const L = ctx.listener;
    const key = this.listener.p.concat(this.listener.f).map((n) => n.toFixed(2)).join();
    if (key === this.listenerKey) return;
    this.listenerKey = key;
    if (L.positionX) {
      L.positionX.value = pos.x; L.positionY.value = pos.y; L.positionZ.value = pos.z;
      L.forwardX.value = forward.x; L.forwardY.value = forward.y; L.forwardZ.value = forward.z;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else if (L.setPosition) { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0); }
  }
  // kind: 'slap' | 'peel'. at = [x, y, z] for someone else's sound (spatial), or null for my own.
  play(kind, at = null) {
    const rate = 0.9 + Math.random() * 0.22; // small random pitch variation
    const remote = !!at;
    const distance = remote ? Math.hypot(at[0] - this.listener.p[0], at[1] - this.listener.p[1], at[2] - this.listener.p[2]) : 0;
    // Same curve as the PannerNode below (inverse distance), so the log shows what you hear.
    const gain = remote ? 1.6 / (1.6 + Math.max(0, distance - 1.6)) : 1;
    const entry = { kind, remote, distance: +distance.toFixed(2), gain: +gain.toFixed(3), rate: +rate.toFixed(3), muted: this.muted, time: Date.now() };
    this.log.push(entry); if (this.log.length > 50) this.log.shift();
    if (this.muted) return entry;
    const ctx = this.ensure(); if (!ctx) return entry;
    // Högst 12 ljud samtidigt: trycker någon Z väldigt fort hoppas resten över i stället för att
    // ljudtråden fylls med noder.
    const now = ctx.currentTime;
    this.voices = (this.voices || []).filter((end) => end > now);
    if (this.voices.length >= 12) { entry.skipped = true; return entry; }
    this.voices.push(now + 0.4);
    let out = this.master;
    if (remote) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 1.6; p.rolloffFactor = 1; p.maxDistance = 30;
      if (p.positionX) { p.positionX.value = at[0]; p.positionY.value = at[1]; p.positionZ.value = at[2]; } else p.setPosition(...at);
      p.connect(this.master); out = p;
      setTimeout(() => p.disconnect(), 800); // när ljudet är slut
    }
    const t = ctx.currentTime + 0.005;
    if (kind === 'slap') this.slap(ctx, out, t, rate, remote ? 0.9 : 0.75);
    else this.peel(ctx, out, t, rate, remote ? 0.6 : 0.45);
    return entry;
  }
  noiseSource(ctx, rate) { const s = ctx.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = rate; s.loop = true; return s; }
  slap(ctx, out, t, rate, vol) {
    // The "thwack": bright noise, very fast attack, ~90 ms decay.
    const n = this.noiseSource(ctx, rate);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800 * rate; bp.Q.value = 0.8;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 350;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    n.connect(bp).connect(hp).connect(g).connect(out); n.start(t, Math.random() * 0.5); n.stop(t + 0.13);
    // The "thump": a low sine that drops in pitch.
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(190 * rate, t); o.frequency.exponentialRampToValueAtTime(70 * rate, t + 0.08);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(vol * 0.9, t + 0.004); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g2).connect(out); o.start(t); o.stop(t + 0.12);
    // A tiny sticky "smack" tail.
    const n2 = this.noiseSource(ctx, rate * 1.3);
    const bp2 = ctx.createBiquadFilter(); bp2.type = 'bandpass'; bp2.frequency.value = 4200 * rate; bp2.Q.value = 2;
    const g3 = ctx.createGain();
    g3.gain.setValueAtTime(0.0001, t + 0.012); g3.gain.exponentialRampToValueAtTime(vol * 0.25, t + 0.016); g3.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    n2.connect(bp2).connect(g3).connect(out); n2.start(t, Math.random() * 0.5); n2.stop(t + 0.08);
  }
  peel(ctx, out, t, rate, vol) {
    const dur = 0.26 / rate;
    const n = this.noiseSource(ctx, rate);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(700 * rate, t); bp.frequency.exponentialRampToValueAtTime(3200 * rate, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.03); g.gain.setValueAtTime(vol, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // Crackle: the adhesive letting go in little jerks.
    const am = ctx.createGain(); am.gain.value = 0.55;
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 38 * rate;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.45;
    lfo.connect(lfoGain).connect(am.gain);
    n.connect(bp).connect(am).connect(g).connect(out);
    n.start(t, Math.random() * 0.5); n.stop(t + dur + 0.02); lfo.start(t); lfo.stop(t + dur + 0.02);
  }
}

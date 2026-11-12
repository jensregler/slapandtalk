// Background bird + wind (Jens, 5 Nov 2026), synthesized – no samples, cheap:
//   bird: a phrase (shared/radio.mjs birdPhrase: willow warbler / redwing / golden plover, always
//         falling) every 5–17 s; each note = one sine oscillator + one gain envelope, through a
//         shared low-pass + long reverb (far away, across the bog), quiet.
//   wind: ONE looping pink-noise buffer → band-pass → gain; a timer (every ~0.8 s) nudges the
//         cutoff and the level toward a new random gust target with setTargetAtTime.
// Both go to the engine's output (Music vol applies) and are mine only (the radio, shared/radio.mjs).
import { birdPhrase } from '../../shared/radio.mjs';

export class Ambient {
  constructor(engine) {
    this.engine = engine; this.Tone = engine.Tone; this.ctx = engine.raw;
    this.bird = { on: false, vol: 0.35, timer: null, bus: null, phrases: 0 };
    this.wind = { on: false, vol: 0.25, timer: null, nodes: null };
    // bird/wind buses into the engine's output (unity; the city's per-zone mix is gone, t857u)
    const out = engine.out.input || engine.out;
    this.mix = { bird: this.ctx.createGain(), wind: this.ctx.createGain(), v: { bird: 1, wind: 1 } };
    this.mix.bird.connect(out); this.mix.wind.connect(out);
  }
  birdBus() {
    if (this.bird.bus) return this.bird.bus;
    const T = this.Tone, ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = this.bird.vol * 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500;
    const verb = new T.Reverb({ decay: 4.5, preDelay: 0.06, wet: 0.6 });
    g.connect(lp); T.connect(lp, verb); verb.connect(this.mix.bird);
    this.bird.bus = { g, lp, verb }; return this.bird.bus;
  }
  setBird({ on, vol }) {
    const b = this.bird; b.vol = vol ?? b.vol;
    if (b.bus) b.bus.g.gain.setTargetAtTime(b.vol * 0.5, this.ctx.currentTime, 0.2);
    if (on === b.on) return; b.on = !!on;
    clearTimeout(b.timer);
    if (b.on) { this.birdBus(); b.timer = setTimeout(() => this.phrase(), 1500 + Math.random() * 3000); }
  }
  phrase(seed = `${Date.now()}:${Math.random()}`) {
    const b = this.bird; if (!b.on) return null;
    const { g } = this.birdBus(), ctx = this.ctx, t0 = ctx.currentTime + 0.05;
    const ph = birdPhrase(seed);
    for (const n of ph.notes) {
      const o = ctx.createOscillator(), e = ctx.createGain(), t = t0 + n.t;
      o.type = 'sine'; o.frequency.setValueAtTime(n.f0, t); o.frequency.exponentialRampToValueAtTime(n.f1, t + n.dur);
      e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(0.25 * n.amp, t + Math.min(0.03, n.dur / 3));
      e.gain.exponentialRampToValueAtTime(0.0001, t + n.dur);
      o.connect(e); e.connect(g); o.start(t); o.stop(t + n.dur + 0.02);
      o.onended = () => { o.disconnect(); e.disconnect(); };
    }
    b.phrases++; b.last = ph.kind;
    const len = ph.notes.length ? ph.notes[ph.notes.length - 1].t + 1 : 1;
    b.timer = setTimeout(() => this.phrase(), (len + ph.gap) * 1000);
    return ph;
  }
  setWind({ on, vol }) {
    const w = this.wind, ctx = this.ctx; w.vol = vol ?? w.vol;
    if (on === w.on) { if (w.nodes) w.nodes.g.gain.setTargetAtTime(w.vol * 0.3, ctx.currentTime, 0.5); return; }
    w.on = !!on; clearTimeout(w.timer);
    if (!w.on) { if (w.nodes) { const n = w.nodes; w.nodes = null; n.g.gain.setTargetAtTime(0, ctx.currentTime, 0.4); setTimeout(() => { try { n.src.stop(); } catch { /* ok */ } n.src.disconnect(); n.bp.disconnect(); n.g.disconnect(); }, 2500); } return; }
    const src = ctx.createBufferSource(); src.buffer = this.engine.noiseBuffer(ctx, 'pink'); src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 400; bp.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(bp); bp.connect(g); g.connect(this.mix.wind); src.start();
    w.nodes = { src, bp, g }; w.gusts = 0;
    const gust = () => {
      if (!w.nodes) return;
      const t = ctx.currentTime, k = Math.random();
      w.nodes.bp.frequency.setTargetAtTime(250 + k * k * 900, t, 0.9);         // brighter in a gust
      w.nodes.g.gain.setTargetAtTime(w.vol * 0.3 * (0.35 + 0.65 * k), t, 1.1); // and louder
      w.gusts++; w.timer = setTimeout(gust, 600 + Math.random() * 900);
    };
    gust();
  }
  stop() { this.setBird({ on: false }); this.setWind({ on: false }); }
}

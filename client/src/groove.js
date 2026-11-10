// Footstep groove (shared/groove.mjs): everyone's footsteps lock into one shared bar.
// Each frame main.js tells us who is where; whoever is walking gets their slot's pulses on the
// shared grid, scheduled a little ahead on the AudioContext clock (no setTimeout jitter).
// The wall clock is corrected by the server's clock (welcome.now), so all clients agree.
// When a walker's pulses come closer than GROOVE.buzzMs, the steps become one looping "buzz"
// voice (one grain of their step sound per pulse) instead of a flood of one-shot voices.
import { GROOVE, DEFAULT_GROOVE, cleanGroove, eventsBetween, runEventsBetween, pulseMs, barMs } from '../../shared/groove.mjs';
import { patchLength, retune } from '../../shared/synth.mjs';

const WALK = { speed: 0.35, holdMs: 140, jump: 0.8, jumpSpeed: 9, maxPerFrame: 48, buzzGain: 0.45, maxAheadMs: 400 };

export class GrooveSteps {
  constructor(sound, { now = () => Date.now() } = {}) {
    this.sound = sound; this.wall = now; this.offset = 0;
    this.groove = { ...DEFAULT_GROOVE };
    this.track = new Map();   // id -> { x, z, t, v, walkUntil, moveUntil, until, buzz, buzzKey } (moveUntil: really moving; walkUntil: + dancing, Jens t814u)
    this.anchor = null;       // { wall, audio }: wall-clock ms ↔ AudioContext seconds
    this.log = [];            // the last step events (tests, curious people): { id, slot, t, tick, n, scale }
    this.events = 0; this.buzzing = 0;
    // Run mode (shared/runmode.mjs, Jens t544u): while I hold Shift and move, MY steps use
    // { rate (× the walk pulse rate, on the same grid), tune (pitch ratio) }; null = walking.
    this.run = null;
    // Watchdog: no frames (a hidden tab, a stall) = nobody is walking as far as we know: the buzz
    // must not loop on by itself.
    this.watch = setInterval(() => { if (this.lastFrame && this.now() - this.lastFrame > WALK.maxAheadMs) { this.stopAll(); for (const t of this.track.values()) { t.walkUntil = 0; t.moveUntil = 0; } this.buzzing = 0; } }, 250);
  }
  now() { return this.wall() + this.offset; }
  // serverNow (ms) from the WebSocket welcome: the shared clock.
  setServerClock(serverMs) { if (Number.isFinite(serverMs)) this.offset = serverMs - this.wall(); }
  setGroove(g) {
    const n = cleanGroove(g || DEFAULT_GROOVE);
    if (n.scale === this.groove.scale && n.at === this.groove.at && n.phase === this.groove.phase) return false;
    this.groove = n;
    for (const t of this.track.values()) { t.until = Math.min(t.until, this.now()); this.stopBuzz(t); } // re-plan from now
    return true;
  }
  get scale() { return this.groove.scale; }
  // run = { rate, tune } or null. A change re-plans my steps from now (the gap guard below stops a
  // doubled step where the walk grid and the run grid meet), so Shift up/down is heard at once.
  setRun(run) {
    const n = run && run.rate > 0 ? { rate: +run.rate, tune: run.tune > 0 ? +run.tune : 1 } : null;
    const same = (!n && !this.run) || (n && this.run && n.rate === this.run.rate && n.tune === this.run.tune);
    if (same) return false;
    this.run = n;
    const me = this.track.get('me'); if (me) { me.until = Math.min(me.until, this.now()); this.stopBuzz(me); }
    return true;
  }

  // Wall-clock ms → AudioContext seconds (null: no audio yet).
  audioTime(ms) {
    const ctx = this.sound.ctx; if (!ctx || ctx.state !== 'running') return null;
    const w = this.now(), a = ctx.currentTime;
    if (!this.anchor || Math.abs(this.anchor.audio + (w - this.anchor.wall) / 1000 - a) > 0.03) this.anchor = { wall: w, audio: a };
    return this.anchor.audio + (ms - this.anchor.wall) / 1000;
  }

  // walkers: [{ id, x, z, at: [x,y,z] | null (me), voice: look.sound | undefined (me), onPeel: feet on backing paper,
  //            dancing: the dance is on – counts as walking (Jens t814u) for as long as it is }]
  update(walkers, nowMs = this.now()) {
    const seen = new Set(); let budget = WALK.maxPerFrame;
    // look ahead at least 1.5 frames (slow machines), at most WALK.maxAheadMs
    const frame = this.lastFrame ? nowMs - this.lastFrame : 16; this.lastFrame = nowMs;
    const horizon = nowMs + Math.min(WALK.maxAheadMs, Math.max(GROOVE.lookAheadMs, frame * 1.5));
    for (const w of walkers) {
      seen.add(w.id);
      let t = this.track.get(w.id);
      if (!t) { this.track.set(w.id, { x: w.x, z: w.z, t: nowMs, v: 0, walkUntil: 0, moveUntil: 0, until: nowMs, buzz: null }); continue; }
      const dt = Math.max(1, nowMs - t.t), d = Math.hypot(w.x - t.x, w.z - t.z);
      t.x = w.x; t.z = w.z; t.t = nowMs;
      if (d > WALK.jump && d / (dt / 1000) > WALK.jumpSpeed) { t.v = 0; t.walkUntil = 0; t.moveUntil = 0; } // a teleport, not a walk
      else { const v = d / (dt / 1000), k = Math.min(1, dt / 120); t.v += (v - t.v) * k; }
      const hold = nowMs + Math.min(WALK.maxAheadMs, Math.max(WALK.holdMs, frame * 1.5));
      if (t.v > WALK.speed) { t.walkUntil = hold; t.moveUntil = hold; }
      // dancing = walking (Jens t814u): kept up every frame while the dance is on; when it stops, the
      // same hold as a real stop (≤ WALK.holdMs) and then quiet. moveUntil stays on real movement only.
      if (w.dancing) t.walkUntil = Math.max(t.walkUntil, hold);
      const walking = nowMs < t.walkUntil;
      const voice = w.voice === undefined ? this.sound.mine : w.voice;
      const slot = voice && Number.isInteger(voice.colour) ? voice.colour : 0;
      if (!walking) { t.until = nowMs; this.stopBuzz(t); continue; }
      const run = w.id === 'me' && this.run ? this.run : null; // run mode: my own steps only
      const rate = run ? run.rate : 1, period = pulseMs(this.groove.scale, slot) / rate;
      if (period < GROOVE.buzzMs) { this.buzz(t, w, voice, slot, nowMs, run); t.until = horizon; continue; }
      this.stopBuzz(t);
      const from = Math.max(t.until, nowMs);
      if (horizon <= from) continue;
      const evs = run ? runEventsBetween(this.groove, slot, from, horizon, rate, { max: budget }) : eventsBetween(this.groove, slot, from, horizon, { max: budget });
      t.until = evs.length >= budget && evs.length ? evs[evs.length - 1].t + 0.001 : horizon;
      for (const e of evs) {
        if (t.last != null && e.t > t.last - 0.5 && e.t - t.last < period * 0.45) continue; // walk ↔ run switch: no doubled step
        t.last = e.t;
        budget--;
        this.events++;
        this.log.push({ id: w.id, slot, t: Math.round(e.t * 10) / 10, tick: e.tick, n: e.n, scale: this.groove.scale, ...(run ? { run: +rate.toFixed(4), tune: +run.tune.toFixed(4) } : {}) });
        if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
        const time = this.audioTime(e.t);
        if (time !== null && time < (this.sound.ctx.currentTime - 0.03)) continue; // too late (a hiccup): skip, don't pile up
        // left/right foot: a hair lower on every other pulse
        this.sound.play('step', w.at || null, { ...(w.voice === undefined ? {} : { sound: w.voice }), time, tune: (e.n % 2 ? 0.97 : 1.02) * (run ? run.tune : 1), onPeel: !!w.onPeel, speed: t.v });
      }
      if (budget <= 0) break;
    }
    for (const [id, t] of this.track) if (!seen.has(id)) { this.stopBuzz(t); this.track.delete(id); }
    this.buzzing = [...this.track.values()].filter((t) => t.buzz).length;
  }

  // ---------- The buzz: a looping grain at the pulse rate ----------
  buzz(t, w, voice, slot, nowMs, run = null) {
    const eng = this.sound.engine;
    if (!eng || this.sound.muted) { this.stopBuzz(t); return; }
    const key = `${this.groove.scale}:${this.groove.at}:${slot}:${voice?.seed || ''}:${voice?.patches?.step ? 'c' : ''}:${run ? run.rate + '/' + run.tune : ''}`;
    if (t.buzz && t.buzzKey === key) { if (w.at) t.buzz.setPos(w.at); return; }
    this.stopBuzz(t);
    const period = pulseMs(this.groove.scale, slot) / (run ? run.rate : 1) / 1000;
    let { patch } = this.sound.patchFor('step', voice);
    if (run && run.tune !== 1) patch = retune(patch, run.tune);
    const buf = grainBuffer(this.sound.ctx, patch, period);
    // start on a pulse of the shared grid, so the buzz has the groove's phase
    const next = (run ? runEventsBetween(this.groove, slot, nowMs + 20, nowMs + 20 + barMs(this.groove.scale) + 1, run.rate, { max: 2 }) : eventsBetween(this.groove, slot, nowMs + 20, nowMs + 20 + barMs(this.groove.scale) + 1, { max: 2 })).find((e) => e.n % 2 === 0); // (the buffer starts with the left foot)
    const time = next ? this.audioTime(next.t) : null;
    t.buzz = eng.loop(buf, { gain: WALK.buzzGain * (w.at ? 0.9 : 1), pos: w.at || null, fx: voice?.fx || null, time });
    t.buzzKey = key;
    this.log.push({ id: w.id, slot, t: next ? next.t : nowMs, tick: next ? next.tick : -1, n: -1, scale: this.groove.scale, buzz: true });
  }
  stopBuzz(t) { if (t.buzz) { t.buzz.stop(); t.buzz = null; t.buzzKey = ''; } }
  stopAll() { for (const t of this.track.values()) this.stopBuzz(t); }
}

// Two pulses (left foot, right foot a hair lower) of a step patch, rendered by hand into a
// looping buffer: noise and oscillator layers with their decay, pitch sweep and a one-pole
// filter. Cheap (a few hundred samples), not a perfect copy of the Web Audio voice; at this
// speed you hear the timbre of the buzz, not single steps.
export function grainBuffer(ctx, patch, period) {
  const sr = ctx.sampleRate, n = Math.max(16, Math.round(period * sr));
  const buf = ctx.createBuffer(1, n * 2, sr), d = buf.getChannelData(0);
  const len = Math.min(period, patchLength(patch));
  for (let foot = 0; foot < 2; foot++) {
    const tune = foot ? 0.97 : 1.02, base = foot * n;
    for (const l of patch.layers) {
      const tau = Math.max(0.002, l.d / 9.2), a = Math.max(0.0005, l.a);
      const cutoff = Math.min(18000, l.cutoff * tune), rc = 1 - Math.exp(-2 * Math.PI * cutoff / sr);
      let phase = 0, lp = 0, lp2 = 0;
      const amp = l.level * patch.gain;
      for (let i = 0; i < n; i++) {
        const t = i / sr; if (t > len + 0.001) break;
        const env = (t < a ? t / a : Math.exp(-(t - a) / tau)) * (i > n - 24 ? (n - i) / 24 : 1);
        let x;
        if (l.kind === 'noise') x = Math.random() * 2 - 1;
        else {
          const f0 = l.freq * tune, f = l.pitchAmt ? f0 * Math.pow(2, (l.pitchAmt / 12) * Math.max(0, 1 - t / l.pitchTime)) : f0;
          phase += 2 * Math.PI * Math.min(8000, f) / sr;
          x = l.wave === 'square' ? Math.sign(Math.sin(phase)) : l.wave === 'sawtooth' ? ((phase / Math.PI) % 2) - 1 : l.wave === 'triangle' ? Math.asin(Math.sin(phase)) * 2 / Math.PI : Math.sin(phase);
        }
        lp += (x - lp) * rc; lp2 += (lp - lp2) * rc;
        const y = l.filter === 'highpass' ? x - lp : l.filter === 'bandpass' ? lp - lp2 : lp;
        d[base + i] += y * env * amp * (l.kind === 'noise' ? 1.6 : 1);
      }
    }
  }
  return buf;
}

// Footstep groove (shared/groove.mjs): every walker's footsteps on THEIR OWN bar (Jens, 11 Nov 2026
// t846u: no shared clock). Mine: my Tempo (setBpm, from shared/runmode.mjs walkBpm) × my Groove scale
// (setGroove) × my run / crouch rate (setRun). Someone else's: their tempo as they sent it
// (shared/playertempo.mjs: bpm, scale, rate, tune – walkers[].tempo), so I hear them at THEIR BPM.
// Each frame main.js tells us who is where; whoever is walking gets their slot's pulses on their grid,
// scheduled a little ahead on the AudioContext clock (no setTimeout jitter).
// The wall clock is corrected by the server's clock (welcome.now), so all clients agree on when.
// When a walker's pulses come closer than GROOVE.buzzMs, the steps become one looping "buzz"
// voice (one grain of their step sound per pulse) instead of a flood of one-shot voices.
import { GROOVE, DEFAULT_GROOVE, cleanGroove, eventsBetween, runEventsBetween, pulseMs, barMs } from '../../shared/groove.mjs';
import { cleanPlayerTempo } from '../../shared/playertempo.mjs';
import { snapWalkBpm } from '../../shared/runmode.mjs';
import { entryMs } from '../../shared/tempogrid.mjs';
import { patchLength, retune } from '../../shared/synth.mjs';
import { stepSeqBetween, stepSeqOf, STEP_SEQ } from '../../shared/stepseq.mjs';

const WALK = { speed: 0.35, holdMs: 140, jump: 0.8, jumpSpeed: 9, maxPerFrame: 48, buzzGain: 0.45, maxAheadMs: 400 };

export class GrooveSteps {
  constructor(sound, { now = () => Date.now() } = {}) {
    this.sound = sound; this.wall = now; this.offset = 0;
    this.groove = { ...DEFAULT_GROOVE }; // MY groove: { scale (= my Groove), at: 0, phase: 0 }
    this.bpm = GROOVE.bpm;               // MY Tempo (shared/runmode.mjs walkBpm)
    this.track = new Map();   // id -> { x, z, t, v, walkUntil, moveUntil, until, buzz, buzzKey } (moveUntil: really moving; walkUntil: + dancing, Jens t814u)
    this.anchor = null;       // { wall, audio }: wall-clock ms ↔ AudioContext seconds
    this.log = [];            // the last step events (tests, curious people): { id, slot, t, tick, n, scale }
    this.events = 0; this.buzzing = 0;
    this.seqCache = new WeakMap(); this.nullVoice = {}; // look.sound → its Steps sequencer (seqOf)
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
  // My Groove (scale). Every walker's grid is anchored at wall time 0 (at 0, phase 0) – mine too – so a
  // player's steps fall at the same moments on every screen from just { bpm, scale, rate } (no per-step
  // messages, no shared clock). A change jumps to the new grid (the gap guard below stops a doubled step).
  setGroove(g) {
    const n = cleanGroove(g || DEFAULT_GROOVE);
    if (n.scale === this.groove.scale) return false;
    this.groove = { scale: n.scale, at: 0, phase: 0 };
    const me = this.track.get('me'); if (me) { me.until = Math.min(me.until, this.now()); me.reenter = true; this.stopBuzz(me); } // re-plan mine from now, entering on the beat (t883u)
    return true;
  }
  get scale() { return this.groove.scale; }
  // My Tempo changed (the Tempo slider; t846u): my bar gets the new length from now.
  setBpm(bpm) {
    const b = snapWalkBpm(bpm); if (b === this.bpm) return false;
    this.bpm = b;
    const me = this.track.get('me'); if (me) { me.until = Math.min(me.until, this.now()); me.reenter = true; this.stopBuzz(me); }
    return true;
  }
  // A walker's grid: mine, or theirs from the tempo they sent (bpm, Groove scale, run / crouch rate + pitch).
  gridOf(w) {
    if (w.id === 'me') return { groove: this.groove, bpm: this.bpm, run: this.run };
    const t = cleanPlayerTempo(w.tempo);
    const run = t.rate !== 1 || t.tune !== 1 ? { rate: t.rate, tune: t.tune } : null;
    return { groove: { scale: t.scale, at: 0, phase: 0 }, bpm: t.bpm, run };
  }
  // run = { rate, tune } or null. A change re-plans my steps from now (the gap guard below stops a
  // doubled step where the walk grid and the run grid meet), so Shift up/down is heard at once.
  setRun(run) {
    const n = run && run.rate > 0 ? { rate: +run.rate, tune: run.tune > 0 ? +run.tune : 1 } : null;
    const same = (!n && !this.run) || (n && this.run && n.rate === this.run.rate && n.tune === this.run.tune);
    if (same) return false;
    this.run = n;
    const me = this.track.get('me'); if (me) { me.until = Math.min(me.until, this.now()); me.reenter = true; this.stopBuzz(me); }
    return true;
  }

  // The Steps sequencer a walker's sound plays (t889u): from their Steps patch (mine: my custom / live one; theirs:
  // their default variation – the default sequencer). Cached per look.sound object (a new object on every change).
  seqOf(voice) {
    const knob = this.sound.radio ? this.sound.radio.knob : null;
    const key = voice && typeof voice === 'object' ? voice : this.nullVoice;
    const hit = this.seqCache.get(key); if (hit && hit.knob === knob) return hit.seq;
    const seq = stepSeqOf(this.sound.patchFor('step', voice).patch);
    this.seqCache.set(key, { knob, seq }); return seq;
  }
  // Wall-clock ms → AudioContext seconds (null: no audio yet).
  audioTime(ms) {
    const ctx = this.sound.ctx; if (!ctx || ctx.state !== 'running') return null;
    const w = this.now(), a = ctx.currentTime;
    if (!this.anchor || Math.abs(this.anchor.audio + (w - this.anchor.wall) / 1000 - a) > 0.03) this.anchor = { wall: w, audio: a };
    return this.anchor.audio + (ms - this.anchor.wall) / 1000;
  }

  // walkers: [{ id, x, z, at: [x,y,z] | null (me), voice: look.sound | undefined (me), onPeel: feet on backing paper,
  //            dancing: the dance is on – counts as walking (Jens t814u) for as long as it is,
  //            tempo: their shared/playertempo.mjs tempo (others only; mine is setBpm / setGroove / setRun),
  //            npc: a dancing NPC (client/src/npcs.js – its steps use the 'npc' voice pool) }]
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
      if (!walking) { t.until = nowMs; t.walking = false; t.enterAt = null; this.stopBuzz(t); continue; }
      const G = this.gridOf(w), run = G.run; // mine: my run / crouch; theirs: as they sent it
      // their tempo changed: re-plan them from now (mine re-plans in setBpm / setGroove / setRun)
      const gk = `${G.bpm}:${G.groove.scale}:${run ? run.rate + '/' + run.tune : ''}`;
      if (w.id !== 'me' && t.gk !== undefined && t.gk !== gk) { t.until = Math.min(t.until, nowMs); t.reenter = true; this.stopBuzz(t); }
      t.gk = gk;
      const rate = run ? run.rate : 1, period = pulseMs(G.groove.scale, slot, G.bpm) / rate;
      // The Steps sequencer (Jens t889u, shared/stepseq.mjs): ONE sequencer plays the whole Steps sound on this
      // footstep grid – len steps per `loop` footsteps (default 4 steps a footstep, step 1 on = one hit per footstep,
      // as before). Each step may carry parameter locks. Too fast to schedule step by step → footsteps only.
      const seq = this.seqOf(voice), per = seq.len / seq.loop, seqPeriod = period / per;
      const useSeq = seqPeriod >= STEP_SEQ.minStepMs;
      // Entering in time (Jens t883u): starting to walk / dance, or a new gait / tempo, does not start the steps at the
      // key press: the first step waits for the next beat of my tempo × gait rate on the shared clock (shared/tempogrid.mjs
      // entryMs: ≤ 0.5 s, a beat that went by ≤ 20 ms ago is taken at once). The avatar moves at once – only the sound
      // is quantized. That first step sounds ON the beat even when my slot's polyrhythm has no pulse there; the
      // pattern carries on from it (the gap guard below drops a pattern pulse that would come too soon after it).
      // With the Steps sequencer the entry step is always step 1 (t889u: "triggar på 1").
      const fresh = !t.walking;
      if (fresh || t.reenter) { t.enterAt = entryMs(nowMs, G.bpm, rate); t.enterFrom = nowMs; t.fresh = fresh; t.walking = true; t.reenter = false; t.until = Math.max(t.until, nowMs); }
      if (period < GROOVE.buzzMs) { t.enterAt = null; this.buzz(t, w, voice, slot, nowMs, run, G); t.until = horizon; continue; }
      this.stopBuzz(t);
      const enter = t.enterAt != null ? t.enterAt : null;
      const from = Math.max(t.until, nowMs, enter != null ? enter : -Infinity);
      if (horizon <= from) continue;
      const MAXEV = 512;
      const evs = useSeq ? stepSeqBetween(G.groove, slot, from, horizon, { rate, bpm: G.bpm, seq, max: MAXEV })
        : (run ? runEventsBetween(G.groove, slot, from, horizon, rate, { max: MAXEV, bpm: G.bpm }) : eventsBetween(G.groove, slot, from, horizon, { max: MAXEV, bpm: G.bpm })).map((e) => ({ ...e, m: e.n, i: 0, foot: true }));
      if (enter != null) { // the entry step itself, on the beat – step 1 of the sequencer
        t.enterAt = null;
        if (!(evs.length && Math.abs(evs[0].t - enter) < 1)) evs.unshift({ t: enter, n: 0, m: 0, i: 0, foot: true, tick: -1, slot, entry: true });
        else { const e0 = evs[0]; e0.entry = true; if (!e0.foot) e0.tick = -1; e0.i = 0; e0.foot = true; } // on a sub-step: off the footstep pattern (tick −1), as before
        if (t.fresh) t.last = null; // a fresh start: nothing to guard against (a gait / tempo switch keeps the guard)
      }
      t.until = evs.length >= MAXEV && evs.length ? evs[evs.length - 1].t + 0.001 : horizon;
      for (const e of evs) {
        const st = seq.steps[e.i] || seq.steps[0];
        if (useSeq && !(st && st.on && st.vol > 0)) continue; // an empty step
        // walk ↔ run switch: no doubled step (footsteps: within 0.45 of a footstep; sub-steps: of a sequencer step)
        if (t.last != null && e.t > t.last - 0.5 && e.t - t.last < (e.foot ? period : seqPeriod) * 0.45) continue;
        if (budget <= 0) { t.until = Math.min(t.until, e.t - 0.001); break; }
        t.last = e.t;
        budget--;
        this.events++;
        this.log.push({ id: w.id, slot, t: Math.round(e.t * 10) / 10, tick: e.tick, n: e.n, i: e.i, scale: G.groove.scale, bpm: G.bpm, ...(seq.len !== 4 || seq.loop !== 1 ? { m: e.m, foot: e.foot } : {}), ...(e.entry ? { entry: true, from: Math.round(t.enterFrom * 10) / 10 } : {}), ...(run ? { run: +rate.toFixed(4), tune: +run.tune.toFixed(4) } : {}) });
        if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
        const time = this.audioTime(e.t);
        if (time !== null && time < (this.sound.ctx.currentTime - 0.03)) continue; // too late (a hiccup): skip, don't pile up
        // left/right foot: a hair lower on every other footstep (the walking randomness stays – sound.js adds the wobble)
        this.sound.play('step', w.at || null, { ...(w.voice === undefined ? {} : { sound: w.voice }), ...(w.npc ? { pool: 'npc', npc: w.id } : {}), time, tune: (e.n % 2 ? 0.97 : 1.02) * (run ? run.tune : 1), onPeel: !!w.onPeel, speed: t.v, seqStep: useSeq ? e.i : 0, volume: useSeq && st ? st.vol / 100 : 1 });
      }
      if (budget <= 0) break;
    }
    for (const [id, t] of this.track) if (!seen.has(id)) { this.stopBuzz(t); this.track.delete(id); }
    this.buzzing = [...this.track.values()].filter((t) => t.buzz).length;
  }

  // ---------- The buzz: a looping grain at the pulse rate ----------
  buzz(t, w, voice, slot, nowMs, run = null, G = { groove: this.groove, bpm: this.bpm }) {
    const eng = this.sound.engine;
    if (!eng || this.sound.muted) { this.stopBuzz(t); return; }
    const g = G.groove, bpm = G.bpm;
    // mineV (t869u): my Sound settings changed (live while editing, or saved) – everyone's steps use my patches
    const key = `${g.scale}:${g.at}:${bpm}:${slot}:${voice?.seed || ''}:${voice?.patches?.step ? 'c' : ''}:${run ? run.rate + '/' + run.tune : ''}:${this.sound.mineV || 0}`;
    if (t.buzz && t.buzzKey === key) { if (w.at) t.buzz.setPos(w.at); return; }
    this.stopBuzz(t);
    const period = pulseMs(g.scale, slot, bpm) / (run ? run.rate : 1) / 1000;
    let { patch } = this.sound.patchFor('step', voice);
    if (run && run.tune !== 1) patch = retune(patch, run.tune);
    const buf = grainBuffer(this.sound.ctx, patch, period);
    // start on a pulse of the shared grid, so the buzz has the groove's phase
    const bar = barMs(g.scale, bpm) + 1;
    const next = (run ? runEventsBetween(g, slot, nowMs + 20, nowMs + 20 + bar, run.rate, { max: 2, bpm }) : eventsBetween(g, slot, nowMs + 20, nowMs + 20 + bar, { max: 2, bpm })).find((e) => e.n % 2 === 0); // (the buffer starts with the left foot)
    const time = next ? this.audioTime(next.t) : null;
    t.buzz = eng.loop(buf, { gain: WALK.buzzGain * (w.at ? 0.9 : 1), pos: w.at || null, fx: voice?.fx || null, time });
    t.buzzKey = key;
    this.log.push({ id: w.id, slot, t: next ? next.t : nowMs, tick: next ? next.tick : -1, n: -1, scale: g.scale, bpm, buzz: true });
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

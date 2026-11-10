// Sounds: every sound in the room is a synth patch (shared/synth.mjs) played by the Tone.js
// engine in synth.js – no sound files to download, nothing to license.
//   slap  – a short, punchy "thwack"        peel – a softer "rrrip" with crackle
//   step  – quiet footsteps while moving    duff – backing-paper landing thud (also four voices Low)
// Each player has their own variation of the defaults, picked deterministically from a seed in
// their look (look.sound.seed), so everyone hears YOUR slap the same way with no extra traffic.
// Paid "Sound settings" can replace a patch and set an FX chain (look.sound.patches / .fx).
// FX follows the LISTENER (t588u): my local copy of the chain colours everything I hear
// (my sounds, others' sounds, voice monitor, remote voices) – not per-source, not sent as audio.
// Other people's sounds are spatial (HRTF panner, quieter with distance). The room's materials
// add a subtle, automatic reverb (roomAcoustics). Mute is remembered ('klibb.muted').
import { withHold } from '../../shared/dancehold.mjs';
import { DEFAULT_PATCHES, variant, morphPatch, cleanPatch, cleanFx, duffScale, slapScale, sizeRate, retune, roomAcoustics, colourPatch } from '../../shared/synth.mjs';
import { loadTone, SynthEngine, MAX_VOICES } from './synth.js';
import { peelStepParams } from '../../shared/peelstep.mjs';
import { ensureSamples } from './samples.js';
import { knobToMorph } from '../../shared/radio.mjs';

const MUTE_KEY = 'klibb.muted';
const VOL_KEY = 'klibb.musicVol';
const VOLUME = { slap: [0.75 / 0.75, 0.9 / 0.75], peel: [1, 0.6 / 0.45], step: [1, 1], duff: [1, 1] }; // [mine, remote]

// Call synchronously inside a user gesture (Enter / tap on the landing) so WebAudio is allowed
// before main.js constructs Sounds. The primed context is reused by Sounds.ensure().
export function primeAudioFromGesture() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    let ctx = window.__klibbAudioCtx;
    if (!ctx || ctx.state === 'closed') {
      try { ctx = new AC({ latencyHint: 'interactive' }); } catch { try { ctx = new AC(); } catch { return null; } }
      window.__klibbAudioCtx = ctx;
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch { return null; }
}

export class Sounds {
  constructor() {
    this.ctx = null; this.engine = null; this.Tone = null;
    this.muted = localStorage.getItem(MUTE_KEY) === '1';
    this.log = [];     // the last sounds (for tests and curious people): { kind, remote, distance, gain, rate, seed, custom }
    this.steps = 0;    // footsteps played (not in the log: they would drown it)
    this.peelSteps = 0; // …of them on a peel (the muffled paper variant, shared/peelstep.mjs)
    this.stepLog = []; // the last 40 footsteps (tests): { onPeel, speed, cutoff, drive, remote }
    this.mine = null;  // my look.sound ({ seed, patches?, fx? })
    this.room = roomAcoustics(null);
    this.listener = { p: [0, 1.6, 0], f: [0, 0, -1] };
    this.cache = new Map(); // seed+kind -> varied patch
    // Browsers only allow audio after the user has clicked/tapped/typed: start then.
    // Music vol (Jens, 31 Oct 2026; Sound settings): how loud everything the room plays is for me, 0…1 (this device).
    // Personal, this visit only (sessionStorage; reset on Exit-to-menu or a new room – soundui.js).
    const sv = (() => { try { return sessionStorage.getItem(VOL_KEY); } catch { return null; } })();
    const v = Number(sv); this.volume = sv != null && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
    const unlock = () => { this.ensure(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); };
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, unlock, { capture: true, passive: true });
  }
  // The AudioContext is made right away (inside the click); Tone.js loads in the background.
  ensure() {
    if (this.ctx) return this.ctx;
    // Landing Enter/tap may have primed a context under the user gesture (startcard.js).
    if (typeof window !== 'undefined' && window.__klibbAudioCtx) {
      this.ctx = window.__klibbAudioCtx;
    } else {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch { try { this.ctx = new AC(); } catch { return null; } }
    }
    this.ready = loadTone().then((Tone) => {
      Tone.setContext(new Tone.Context(this.ctx));
      this.Tone = Tone;
      this.engine = new SynthEngine(Tone);
      this.engine.out.gain.value = 0.9 * this.volume;
      this.engine.setRoom(this.room);
      this.engine.setListenerFx(this.mine && this.mine.fx ? cleanFx(this.mine.fx) : null);
      return this.engine;
    }).catch((e) => { console.warn('synth', e); return null; });
    return this.ctx;
  }
  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, Number(v) || 0)); try { sessionStorage.setItem(VOL_KEY, String(this.volume)); } catch { /* private */ }
    if (this.engine) this.engine.out.gain.value = 0.9 * this.volume;
  }
  setRadio(r) { this.radio = r ? { on: r.on !== false, knob: Number.isFinite(r.knob) ? r.knob : 0.5 } : null; this.morphCache = null; }
  setMuted(m) { this.muted = !!m; localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0'); }
  // a mic layer was made / switched on: ask for the mic (mic.js). → true when it is on
  async useMic() { this.ensure(); await this.ready; return this.engine ? this.engine.useMic() : false; }
  setMine(sound) {
    this.mine = sound || null;
    if (sound?.patches && this.ensure()) ensureSamples(sound.patches, this.ctx); // (sampler layers' audio from this device)
    // Listener FX: apply MY fx locally to everything reaching my ears (t588u).
    const apply = (eng) => { if (eng) eng.setListenerFx(sound && sound.fx ? cleanFx(sound.fx) : null); };
    if (this.engine) apply(this.engine); else if (this.ready) this.ready.then(apply);
  }
  // Room style ({ floor, wall, ceiling }) → automatic acoustics.
  setRoom(style) { this.room = roomAcoustics(style); if (this.engine) this.engine.setRoom(this.room); }
  // Where am I and which way am I looking (call every frame with the camera).
  setListener(pos, forward) {
    this.listener = { p: [pos.x, pos.y, pos.z], f: [forward.x, forward.y, forward.z] };
    const ctx = this.ctx; if (!ctx) return;
    // Only when something changed, and with .value (not setValueAtTime): one automation event
    // per frame and parameter makes the audio thread's timelines grow forever.
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
  // The patch a player's sound uses: their custom one, else their variation of the default.
  patchFor(kind, sound) {
    const custom = sound && sound.patches && cleanPatch(sound.patches[kind]);
    // The radio (shared/radio.mjs, mine only): off = the original sounds; the knob morphs from the
    // original (that player's default variation, knob 0) to the custom patch (knob ½) and on past it
    // (knob 1 = the difference twice over: seek, morphPatch t = 2). Not a volume.
    const radio = this.radio || { on: true, knob: 0.5 };
    const t = knobToMorph(radio.knob);
    if (custom && radio.on) {
      if (t !== 1 && DEFAULT_PATCHES[kind]) {
        const base = sound.seed ? variant(DEFAULT_PATCHES[kind], sound.seed, kind) : cleanPatch(DEFAULT_PATCHES[kind]);
        const key = `${kind}:${sound.seed}:${radio.knob}`;
        this.morphCache ||= new Map();
        let hit = this.morphCache.get(key);
        if (!hit || hit.src !== JSON.stringify(custom)) { if (this.morphCache.size > 60) this.morphCache.clear(); hit = { src: JSON.stringify(custom), patch: morphPatch(base, custom, t) }; this.morphCache.set(key, hit); }
        return { patch: hit.patch, custom: true, morph: t };
      }
      return { patch: custom, custom: true };
    }
    const seed = sound && sound.seed || '';
    const colour = sound && Number.isInteger(sound.colour) ? sound.colour : 0; // the player's slot colour (shared/synth.mjs)
    const key = seed + ':' + colour + ':' + kind;
    if (!this.cache.has(key)) { if (this.cache.size > 200) this.cache.clear(); this.cache.set(key, colourPatch(seed ? variant(DEFAULT_PATCHES[kind], seed, kind) : cleanPatch(DEFAULT_PATCHES[kind]), colour, kind)); }
    return { patch: this.cache.get(key), custom: false };
  }
  // kind: 'slap' | 'peel' | 'step' | 'duff'. at = [x, y, z] for a sound out in the
  // room (spatial), or null for my own. opts: { sound: that player's look.sound (default: mine),
  // area: m² (duff + slap: loudness), size: m longest side (slap, peel, duff: pitch over 15 cm – 4 m (clamped),
  // shared/synth.mjs sizeRate; slap without area → treated as square), volume }.
  // time: when (AudioContext seconds, the footstep groove schedules ahead); tune: extra pitch ratio.
  // onPeel + speed (m/s, footsteps only): the step lands on backing paper – the paper variant.
  // hold (s, slap): every layer's envelope hold for this one play (the dance-mode vector, shared/dancehold.mjs);
  // null/absent = the patch's own hold.
  play(kind, at = null, { sound, area, size, volume = 1, time = null, tune = 1, onPeel = false, speed = 0, exact = false, hold = null } = {}) {
    const remote = !!at;
    const who = sound === undefined ? this.mine : sound;
    const wobble = exact ? 1 : kind === 'step' ? 0.94 + Math.random() * 0.12 : 0.97 + Math.random() * 0.06; // tiny per-play life
    let rate = wobble * tune, gain = volume * (VOLUME[kind] || [1, 1])[remote ? 1 : 0];
    if (kind === 'duff') { const s = duffScale(area, size); gain *= s.gain; rate *= s.rate; }
    if (kind === 'slap' && (area != null || size != null)) {
      const s = area != null ? duffScale(area, size) : slapScale(size);
      gain *= s.gain; rate *= s.rate;
    }
    // Peel (pulling a sticker off): the same size → pitch as the slap (Jens, 10 Nov 2026); loudness as before.
    if (kind === 'peel' && size != null) rate *= sizeRate(size);
    const distance = remote ? Math.hypot(at[0] - this.listener.p[0], at[1] - this.listener.p[1], at[2] - this.listener.p[2]) : 0;
    // Same curve as the panner (inverse distance), so the log shows what you hear.
    const heard = remote ? 1.6 / (1.6 + Math.max(0, distance - 1.6)) : 1;
    const { patch: base, custom } = this.patchFor(kind, who);
    const patch = hold != null ? withHold(base, hold) : base;
    const entry = { kind, remote, distance: +distance.toFixed(2), gain: +heard.toFixed(3), level: +gain.toFixed(3), rate: +rate.toFixed(3),
      seed: who?.seed || null, colour: who && Number.isInteger(who.colour) ? who.colour : 0, custom, muted: this.muted, time: Date.now(), ...(hold != null ? { hold: +(+hold).toFixed(3) } : {}),
      ...((kind === 'duff' || kind === 'slap') && area != null ? { area: +(+area || 0).toFixed(4) } : {}),
      ...((kind === 'slap' || kind === 'peel' || kind === 'duff') && size != null ? { size: +(+size || 0).toFixed(4) } : {}) };
    const paper = kind === 'step' && onPeel ? peelStepParams(speed) : null;
    if (paper) { gain *= paper.gain; entry.paper = paper; }
    if (kind === 'step') {
      this.steps++; if (paper) this.peelSteps++;
      this.stepLog.push({ onPeel: !!paper, speed: +(+speed || 0).toFixed(2), cutoff: paper?.cutoff ?? null, drive: paper?.drive ?? null, remote, muted: this.muted });
      if (this.stepLog.length > 40) this.stepLog.shift();
    } else { this.log.push(entry); if (this.log.length > 50) this.log.shift(); }
    if (this.muted) return entry;
    if (!this.ensure()) return entry;
    // FX is on the listener chain (setMine → setListenerFx), not per voice.
    const go = (eng) => { if (!eng || this.muted) return; if (!eng.play(retune(patch, rate), { gain, pos: remote ? at : null, time, pool: kind === 'step' ? 'step' : 'main', paper })) entry.skipped = true; };
    if (this.engine) go(this.engine);
    else if (time == null) { const t = Date.now(); this.ready.then((eng) => { if (Date.now() - t < 400) go(eng); }); } // the very first sound waits for Tone.js
    return entry;
  }
  // The radio's loops (radio.js): a patch (or one layer of it) at an AudioContext time, with my effects.
  playPatch(patch, { time = null, layer = null, gain = 1, gate = null, length = null } = {}) {
    if (this.muted || !this.engine || !patch) return false;
    return this.engine.play(patch, { gain: gain * this.volumeOf(), time, layer, gate, length, pool: 'seq' });
  }
  volumeOf() { return 1; }
  // Preview a patch (the Sound settings editor), dry, at my position.
  preview(patch, fx = null) {
    if (!this.ensure()) return Promise.resolve(false);
    return this.ready.then(async (eng) => {
      if (!eng) return false;
      await ensureSamples({ p: patch }, this.ctx);
      // Preview uses the listener chain; if the editor passes a draft fx, apply it for the preview.
      if (fx) eng.setListenerFx(fx);
      else eng.setListenerFx(this.mine && this.mine.fx ? cleanFx(this.mine.fx) : null);
      return eng.play(patch, {});
    });
  }
  get maxVoices() { return MAX_VOICES; }
}

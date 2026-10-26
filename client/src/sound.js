// Sounds: every sound in the room is a synth patch (shared/synth.mjs) played by the Tone.js
// engine in synth.js – no sound files to download, nothing to license.
//   slap  – a short, punchy "thwack"        peel – a softer "rrrip" with crackle
//   nope  – "uh-uh" (a refused slap)        step – quiet footsteps while moving
//   duff  – the backing paper landing; bigger paper = louder and lower
// Each player has their own variation of the defaults, picked deterministically from a seed in
// their look (look.sound.seed), so everyone hears YOUR slap the same way with no extra traffic.
// Paid "Sound settings" can replace a patch and add an FX chain (look.sound.patches / .fx).
// Other people's sounds are spatial (HRTF panner, quieter with distance). The room's materials
// add a subtle, automatic reverb (roomAcoustics). Mute is remembered ('klibb.muted').
import { DEFAULT_PATCHES, variant, cleanPatch, cleanFx, duffScale, retune, roomAcoustics, colourPatch } from '../../shared/synth.mjs';
import { loadTone, SynthEngine, MAX_VOICES } from './synth.js';

const MUTE_KEY = 'klibb.muted';
const VOLUME = { slap: [0.75 / 0.75, 0.9 / 0.75], peel: [1, 0.6 / 0.45], nope: [1, 1], step: [1, 1], duff: [1, 1] }; // [mine, remote]

export class Sounds {
  constructor() {
    this.ctx = null; this.engine = null; this.Tone = null;
    this.muted = localStorage.getItem(MUTE_KEY) === '1';
    this.log = [];     // the last sounds (for tests and curious people): { kind, remote, distance, gain, rate, seed, custom }
    this.steps = 0;    // footsteps played (not in the log: they would drown it)
    this.mine = null;  // my look.sound ({ seed, patches?, fx? })
    this.room = roomAcoustics(null);
    this.listener = { p: [0, 1.6, 0], f: [0, 0, -1] };
    this.cache = new Map(); // seed+kind -> varied patch
    // Browsers only allow audio after the user has clicked/tapped/typed: start then.
    const unlock = () => { this.ensure(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); };
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, unlock, { capture: true, passive: true });
  }
  // The AudioContext is made right away (inside the click); Tone.js loads in the background.
  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    try { this.ctx = new AC(); } catch { return null; }
    this.ready = loadTone().then((Tone) => {
      Tone.setContext(new Tone.Context(this.ctx));
      this.Tone = Tone;
      this.engine = new SynthEngine(Tone);
      this.engine.out.gain.value = 0.9;
      this.engine.setRoom(this.room);
      return this.engine;
    }).catch((e) => { console.warn('synth', e); return null; });
    return this.ctx;
  }
  setMuted(m) { this.muted = !!m; localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0'); }
  setMine(sound) { this.mine = sound || null; }
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
    if (custom) return { patch: custom, custom: true };
    const seed = sound && sound.seed || '';
    const colour = sound && Number.isInteger(sound.colour) ? sound.colour : 0; // the player's slot colour (shared/synth.mjs)
    const key = seed + ':' + colour + ':' + kind;
    if (!this.cache.has(key)) { if (this.cache.size > 200) this.cache.clear(); this.cache.set(key, colourPatch(seed ? variant(DEFAULT_PATCHES[kind], seed, kind) : cleanPatch(DEFAULT_PATCHES[kind]), colour, kind)); }
    return { patch: this.cache.get(key), custom: false };
  }
  // kind: 'slap' | 'peel' | 'nope' | 'step' | 'duff'. at = [x, y, z] for a sound out in the
  // room (spatial), or null for my own. opts: { sound: that player's look.sound (default: mine),
  // area: m² (duff), volume }.
  // time: when (AudioContext seconds, the footstep groove schedules ahead); tune: extra pitch ratio.
  play(kind, at = null, { sound, area, volume = 1, time = null, tune = 1 } = {}) {
    const remote = !!at;
    const who = sound === undefined ? this.mine : sound;
    const wobble = kind === 'step' ? 0.94 + Math.random() * 0.12 : 0.97 + Math.random() * 0.06; // tiny per-play life
    let rate = wobble * tune, gain = volume * (VOLUME[kind] || [1, 1])[remote ? 1 : 0];
    if (kind === 'duff') { const s = duffScale(area); gain *= s.gain; rate *= s.rate; }
    const distance = remote ? Math.hypot(at[0] - this.listener.p[0], at[1] - this.listener.p[1], at[2] - this.listener.p[2]) : 0;
    // Same curve as the panner (inverse distance), so the log shows what you hear.
    const heard = remote ? 1.6 / (1.6 + Math.max(0, distance - 1.6)) : 1;
    const { patch, custom } = this.patchFor(kind, who);
    const entry = { kind, remote, distance: +distance.toFixed(2), gain: +heard.toFixed(3), level: +gain.toFixed(3), rate: +rate.toFixed(3),
      seed: who?.seed || null, colour: who && Number.isInteger(who.colour) ? who.colour : 0, custom, muted: this.muted, time: Date.now(), ...(kind === 'duff' ? { area: +(+area || 0).toFixed(4) } : {}) };
    if (kind === 'step') this.steps++; else { this.log.push(entry); if (this.log.length > 50) this.log.shift(); }
    if (this.muted) return entry;
    if (!this.ensure()) return entry;
    const fx = who && who.fx ? cleanFx(who.fx) : null;
    const go = (eng) => { if (!eng || this.muted) return; if (!eng.play(retune(patch, rate), { gain, fx, pos: remote ? at : null, time, pool: kind === 'step' ? 'step' : 'main' })) entry.skipped = true; };
    if (this.engine) go(this.engine);
    else if (time == null) { const t = Date.now(); this.ready.then((eng) => { if (Date.now() - t < 400) go(eng); }); } // the very first sound waits for Tone.js
    return entry;
  }
  // Preview a patch (the Sound settings editor), dry, at my position.
  preview(patch, fx = null) { if (!this.ensure()) return Promise.resolve(false); return this.ready.then((eng) => eng ? eng.play(patch, { fx }) : false); }
  get maxVoices() { return MAX_VOICES; }
}

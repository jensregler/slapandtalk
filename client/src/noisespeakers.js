// The noise room's two speakers (Jens t872u; zones + schedule in shared/noisespeakers.mjs).
// Cheap on purpose:
//   - each speaker is ONE <audio> element streamed by the browser (MediaElementSource → GainNode), never a
//     decoded buffer; nothing is fetched until you walk into the room, and both players pause (and stop
//     downloading) when you walk out.
//   - per frame: two numbers (the zone gains) and a gain change only when they moved.
// Everyone in the room hears the same track at the same spot: the schedule comes from the server-corrected
// clock (groove.now()) and the manifest (public/noise-speakers/manifest.json, written by
// scripts/noise-speakers.mjs).
import { SPEAKERS, NOISE_SPEAKERS, speakerGain, speakerTrackAt, inNoiseRoom, noiseActive, doorDistance } from '../../shared/noisespeakers.mjs';
import { LAMP_IDS, loadLights, cleanLights, envTarget, envStep, lampLevel, lampFactor, restFactor, bandFilter } from './noiselights.js';

const BASE = '/noise-speakers/';
// the lamps (t875u): ~30 updates a second; RMS ≥ full = brightest; min = the glow in silence (× the lamp's normal intensity)
// (t892u: these are now the defaults of the player's own settings – noiselights.js, Esc → LIGHTS)
export const LAMP = Object.freeze({ everyMs: 33, full: 0.2, min: 0.35, max: 1.5, attack: 0.6, release: 0.12 });
// ?noiseplaylist=test → the short test tones in /noise-speakers/test/ (tests: a track ends within seconds)
const playlistBase = () => { try { return new URLSearchParams(location.search).get('noiseplaylist') === 'test' ? BASE + 'test/' : BASE; } catch { return BASE; } };

export class NoiseSpeakers {
  // sound: the Sounds object (its AudioContext, mute and volume); now: () => server-corrected ms
  constructor({ sound, now = () => Date.now(), base = playlistBase(), lamps = null, lights = null } = {}) {
    this.sound = sound; this.now = now; this.lamps = lamps; this.lampAt = 0; this.lampsLit = false; this.base = base; this.manifestUrl = base + 'manifest.json';
    // the four lamps by name (NW NE SW SE, from where they hang) + my light settings (Jens t892u)
    this.lampById = {}; this.lights = cleanLights(lights || loadLights());
    if (lamps) {
      const all = [...(lamps.A || []), ...(lamps.B || [])], cx = all.reduce((s, l) => s + l.position.x, 0) / (all.length || 1), cz = all.reduce((s, l) => s + l.position.z, 0) / (all.length || 1);
      for (const l of all) {
        const id = l.userData.lampId || (l.position.z < cz ? 'N' : 'S') + (l.position.x < cx ? 'W' : 'E');
        l.userData.lampId = id; l.userData.home = l.userData.home || l.position.clone(); l.userData.distance0 = l.userData.distance0 ?? l.distance;
        l.userData.color0 = l.userData.color0 || '#' + l.color.getHexString(); if (!this.lampById[id]) this.lampById[id] = l;
      }
      this.applyLights();
    }
    this.tracks = null; this.loading = null; this.inside = false;
    this.players = SPEAKERS.map((s) => ({ ...s, el: null, node: null, gain: null, tap: null, buf: null, level: 0, rms: 0, g: 0, want: null, file: null, plays: 0, started: [], blocked: false }));
    this.log = []; // tests: { speaker, file, at }
    this.lastSync = 0;
    // A play() refused for lack of a user gesture (iOS) is tried again on the next tap / key.
    const retry = () => { for (const p of this.players) if (p.blocked && this.inside) this.play(p); };
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, retry, { capture: true, passive: true });
  }
  load() {
    if (!this.loading) this.loading = fetch(this.manifestUrl, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : { tracks: [] }))
      .then((m) => { this.tracks = Array.isArray(m.tracks) ? m.tracks.filter((t) => t && typeof t.file === 'string' && t.duration > 0) : []; })
      .catch(() => { this.tracks = []; this.loading = null; });
    return this.loading;
  }
  // Build a speaker's <audio> + gain the first time it is needed (needs the AudioContext).
  wire(p) {
    if (p.el) return true;
    const ctx = this.sound && this.sound.ensure && this.sound.ensure(); if (!ctx) return false;
    const el = new Audio(); el.preload = 'auto'; el.crossOrigin = 'anonymous'; el.loop = false;
    // a track ended: the next one when the shared schedule says (now, or in a moment if the file was a hair short)
    el.addEventListener('ended', () => { const w = p.want; const wait = w ? Math.max(0, w.endMs - this.now()) : 0; setTimeout(() => this.sync(), Math.min(wait + 20, 3000)); });
    const node = ctx.createMediaElementSource(el), gain = ctx.createGain(); gain.gain.value = 0;
    node.connect(gain); gain.connect(ctx.destination);
    // the lamps' tap (Jens t875u): the speaker's own signal, BEFORE the position gain – a small analyser, read ~30×/s
    // (t892u) through a filter, so the lamps can listen to the bass / a band / the treble only (allpass = all of it)
    const tap = ctx.createAnalyser(); tap.fftSize = this.lights.env.window; tap.smoothingTimeConstant = 0;
    const band = ctx.createBiquadFilter(); node.connect(band); band.connect(tap);
    Object.assign(p, { el, node, gain, tap, band, buf: new Float32Array(tap.fftSize) });
    this.applyTap(p);
    return true;
  }
  applyTap(p) {
    if (!p.tap) return;
    const env = this.lights.env, f = bandFilter(env);
    if (p.band) { p.band.type = f.type; p.band.frequency.value = f.frequency; p.band.Q.value = f.Q; }
    if (p.tap.fftSize !== env.window) { p.tap.fftSize = env.window; p.buf = new Float32Array(env.window); }
  }
  // My light settings (Esc → LIGHTS): the lamps' colour / reach / fall-off / place now, the rest on the next tick.
  setLights(s) {
    this.lights = cleanLights(s);
    for (const p of this.players) this.applyTap(p);
    this.applyLights();
  }
  applyLights() {
    const L = this.lights;
    for (const id of LAMP_IDS) {
      const l = this.lampById[id], c = L.lamps[id]; if (!l) continue;
      l.color.set(c.color); l.userData.colorNow = c.color;
      l.distance = l.userData.distance0 * c.reach; l.decay = c.decay;
      l.position.set(l.userData.home.x + c.dx, l.userData.home.y + c.dy, l.userData.home.z + c.dz);
      if (!this.lampsLit) l.intensity = l.userData.base * restFactor(c, L.env);
    }
  }
  play(p) {
    const pr = p.el.play();
    if (pr && pr.catch) pr.then(() => { p.blocked = false; }).catch((e) => { if (e && e.name === 'NotAllowedError') p.blocked = true; });
  }
  // Put each speaker on the track the shared schedule says, at the right second.
  sync(force = false) {
    if (!this.tracks || !this.tracks.length || !this.inside) return;
    const t = this.now();
    for (const p of this.players) {
      if (!this.wire(p)) return;
      const s = speakerTrackAt(this.tracks, p.id, t); if (!s) continue;
      p.want = s;
      const url = this.base + s.track.file;
      if (p.file !== url + '@' + s.startMs) {
        p.file = url + '@' + s.startMs; p.plays++; p.started.push(s.track.file); if (p.started.length > 20) p.started.shift();
        this.log.push({ speaker: p.id, file: s.track.file, at: t }); if (this.log.length > 40) this.log.shift();
        if (!p.el.src.endsWith(url)) p.el.src = url;
        // joining mid-track: start where the others are; a track change (offset ≈ 0): from the top, so the song's
        // first second isn't cut while it loads (the drift check below catches up if it falls > resyncSec behind)
        const join = s.offsetSec > NOISE_SPEAKERS.resyncSec;
        try { p.el.currentTime = join ? s.offsetSec : 0; } catch { /* not seekable yet: loadedmetadata below */ }
        if (join) p.el.addEventListener('loadedmetadata', () => { const w = p.want; if (w && w.track === s.track) try { p.el.currentTime = (this.now() - w.startMs) / 1000; } catch { /* */ } }, { once: true });
        this.play(p);
      } else if (p.el.ended) continue; // waiting for the schedule's next track
      else if (force || (p.el.paused && !p.blocked)) this.play(p);
      else if (!p.el.seeking && p.el.readyState >= 2 && Math.abs(p.el.currentTime - s.offsetSec) > NOISE_SPEAKERS.resyncSec) p.el.currentTime = s.offsetSec;
    }
  }
  // The ceiling lamps follow the music (Jens t875u): west lamps ← A, east lamps ← B. Only the existing lights'
  // intensity changes (no new lights). level = RMS ÷ LAMP.full, fast up / slow down; intensity = base × (min … max).
  // t892u: every number is the player's own setting (noiselights.js; defaults = the t875u look), each lamp
  // picks its source (A, B, the louder of both, none) and can change colour with the level.
  lampsTick(now) {
    const L = this.lamps, S = this.lights, env = S.env; if (!L || now - this.lampAt < env.updateMs) return;
    const dt = this.lampAt ? Math.min(250, now - this.lampAt) : env.updateMs; this.lampAt = now;
    const levels = {};
    for (const p of this.players) {
      let rms = 0;
      if (p.tap && p.el && !p.el.paused) { p.tap.getFloatTimeDomainData(p.buf); let s = 0; for (let i = 0; i < p.buf.length; i++) s += p.buf[i] * p.buf[i]; rms = Math.sqrt(s / p.buf.length); }
      p.rms = rms;
      p.env = p.env || { level: 0, out: 0, holdUntil: 0 };
      p.env.level = p.level; levels[p.id] = p.shown = envStep(p.env, envTarget(rms, env), dt, now, env); p.level = p.env.level;
    }
    for (const id of LAMP_IDS) {
      const l = this.lampById[id], c = S.lamps[id]; if (!l) continue;
      const lv = lampLevel(c, levels); l.userData.level = lv;
      l.intensity = l.userData.base * lampFactor(c, lv, env);
      if (c.hue) { l.color.set(c.color).offsetHSL(c.hue / 360 * lv, 0, 0); l.userData.colorNow = '#' + l.color.getHexString(); }
    }
    this.lampsLit = true;
  }
  lampsRest() { // out of the room: the lamps back to their normal light (× my "outside the room" brightness)
    if (!this.lamps || !this.lampsLit) return; this.lampsLit = false; this.lampAt = 0;
    for (const p of this.players) { p.level = 0; p.rms = 0; p.shown = 0; p.env = null; }
    for (const id of LAMP_IDS) { const l = this.lampById[id], c = this.lights.lamps[id]; if (!l) continue; l.intensity = l.userData.base * restFactor(c, this.lights.env); l.color.set(c.color); l.userData.colorNow = c.color; l.userData.level = 0; }
  }
  stop() {
    this.lampsRest();
    for (const p of this.players) if (p.el) { p.el.pause(); p.el.removeAttribute('src'); p.el.load(); p.file = null; p.g = 0; if (p.gain) p.gain.gain.value = 0; }
  }
  // Every frame with the listener's position.
  update(pos) {
    // "inside" = the players run: in the room, or out in front of the door within reach (t880u); else paused, no downloads
    const inside = noiseActive(pos.x, pos.z); this.inRoom = inNoiseRoom(pos.x, pos.z); this.doorD = doorDistance(pos.x, pos.z);
    if (inside !== this.inside) {
      this.inside = inside;
      if (inside) { if (this.tracks) this.sync(true); else this.load().then(() => this.sync(true)); }
      else this.stop(); // outside: silent, and nothing more is downloaded
    }
    if (!inside) return;
    const now = performance.now();
    if (now - this.lastSync > 1000) { this.lastSync = now; this.sync(); }
    this.lampsTick(now);
    const s = this.sound, vol = s ? (s.muted ? 0 : (Number.isFinite(s.volume) ? s.volume : 1)) : 1;
    for (const p of this.players) {
      if (!p.gain) continue;
      const g = speakerGain(p.id, pos.x, pos.z) * NOISE_SPEAKERS.master * vol;
      if (Math.abs(g - p.g) > 0.002) { p.g = g; p.gain.gain.setTargetAtTime(g, p.gain.context.currentTime, 0.04); }
    }
  }
  info() {
    return { inside: this.inside, inRoom: !!this.inRoom, door: Number.isFinite(this.doorD) ? +this.doorD.toFixed(2) : null, lamps: this.lamps ? Object.fromEntries(Object.entries(this.lamps).map(([k, v]) => [k, v.map((l) => ({ id: l.userData.lampId, x: +l.position.x.toFixed(2), intensity: +l.intensity.toFixed(3), base: l.userData.base }))])) : null,
      lights: this.lampById ? Object.fromEntries(Object.entries(this.lampById).map(([id, l]) => [id, { intensity: +l.intensity.toFixed(3), base: l.userData.base, color: '#' + l.color.getHexString(), distance: +l.distance.toFixed(2), decay: l.decay, level: +(l.userData.level || 0).toFixed(3), pos: [+l.position.x.toFixed(2), +l.position.y.toFixed(2), +l.position.z.toFixed(2)] }])) : null, tracks: this.tracks ? this.tracks.length : null, log: this.log.slice(),
      players: this.players.map((p) => ({ id: p.id, rms: +p.rms.toFixed(4), level: +p.level.toFixed(3), shown: +(p.shown ?? p.level).toFixed(3), gain: +p.g.toFixed(4), zone: +(p.g / NOISE_SPEAKERS.master).toFixed(4), file: p.want ? p.want.track.file : null, plays: p.plays,
        paused: p.el ? p.el.paused : true, time: p.el ? +p.el.currentTime.toFixed(2) : 0, ready: p.el ? p.el.readyState : 0, src: p.el ? p.el.getAttribute('src') : null, blocked: p.blocked })) };
  }
}

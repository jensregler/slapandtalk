// The noise room's two speakers (Jens t872u; zones + schedule in shared/noisespeakers.mjs).
// Cheap on purpose:
//   - each speaker is ONE <audio> element streamed by the browser (MediaElementSource → GainNode), never a
//     decoded buffer; nothing is fetched until you walk into the room, and both players pause (and stop
//     downloading) when you walk out.
//   - per frame: two numbers (the zone gains) and a gain change only when they moved.
// Everyone in the room hears the same track at the same spot: the schedule comes from the server-corrected
// clock (groove.now()) and the manifest (public/noise-speakers/manifest.json, written by
// scripts/noise-speakers.mjs).
import { SPEAKERS, NOISE_SPEAKERS, speakerGain, speakerTrackAt, inNoiseRoom } from '../../shared/noisespeakers.mjs';

const BASE = '/noise-speakers/';

export class NoiseSpeakers {
  // sound: the Sounds object (its AudioContext, mute and volume); now: () => server-corrected ms
  constructor({ sound, now = () => Date.now(), manifestUrl = BASE + 'manifest.json' } = {}) {
    this.sound = sound; this.now = now; this.manifestUrl = manifestUrl;
    this.tracks = null; this.loading = null; this.inside = false;
    this.players = SPEAKERS.map((s) => ({ ...s, el: null, node: null, gain: null, g: 0, want: null, file: null, plays: 0, started: [], blocked: false }));
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
    Object.assign(p, { el, node, gain });
    return true;
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
      const url = BASE + s.track.file;
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
  stop() {
    for (const p of this.players) if (p.el) { p.el.pause(); p.el.removeAttribute('src'); p.el.load(); p.file = null; p.g = 0; if (p.gain) p.gain.gain.value = 0; }
  }
  // Every frame with the listener's position.
  update(pos) {
    const inside = inNoiseRoom(pos.x, pos.z);
    if (inside !== this.inside) {
      this.inside = inside;
      if (inside) { if (this.tracks) this.sync(true); else this.load().then(() => this.sync(true)); }
      else this.stop(); // outside: silent, and nothing more is downloaded
    }
    if (!inside) return;
    const now = performance.now();
    if (now - this.lastSync > 1000) { this.lastSync = now; this.sync(); }
    const s = this.sound, vol = s ? (s.muted ? 0 : (Number.isFinite(s.volume) ? s.volume : 1)) : 1;
    for (const p of this.players) {
      if (!p.gain) continue;
      const g = speakerGain(p.id, pos.x, pos.z) * NOISE_SPEAKERS.master * vol;
      if (Math.abs(g - p.g) > 0.002) { p.g = g; p.gain.gain.setTargetAtTime(g, p.gain.context.currentTime, 0.04); }
    }
  }
  info() {
    return { inside: this.inside, tracks: this.tracks ? this.tracks.length : null, log: this.log.slice(),
      players: this.players.map((p) => ({ id: p.id, gain: +p.g.toFixed(4), zone: +(p.g / NOISE_SPEAKERS.master).toFixed(4), file: p.want ? p.want.track.file : null, plays: p.plays,
        paused: p.el ? p.el.paused : true, time: p.el ? +p.el.currentTime.toFixed(2) : 0, ready: p.el ? p.el.readyState : 0, src: p.el ? p.el.getAttribute('src') : null, blocked: p.blocked })) };
  }
}

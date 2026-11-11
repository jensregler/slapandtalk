// Master block (was "the radio"; Jens Nov 2026 rebuild).
// Sound settings Master shows only: master volume (ears) + City sound (0–100 dry↔wet of city FX).
// Older controls (on/off, Blend, Tempo, Bird/Wind/Four voices) stay in cleanRadio / Radio engine
// paths but have no UI; on+knob are forced to "my sound" by cleanRadio. Walk tempo lives on Steps:
// per player (shared/runmode.mjs walkBpm, 30–3000 BPM), only for my walk-sound sequencer – the room
// clock (tempo(): sequencers, four voices, dance, voice FX) no longer follows it (Jens, 11 Nov 2026).
import { cleanRadio, cleanPreset, FOUR_VOICES, RADIO, bpmToKnob, knobToBpm } from '../../shared/radio.mjs';
import { roomTempo, loopSteps, barMsAt, barsAtTime } from '../../shared/clock.mjs';
import { SOUNDS, retune } from '../../shared/synth.mjs';
import { planWalkSeq, newWalkSeq } from '../../shared/walkseq.mjs';
import { RUN, cleanWalkBpm } from '../../shared/runmode.mjs';
import { Ambient } from './ambient.js';

const OWNER_KEY = 'klibb.soundOwner';
export function soundOwner() {
  let k = null; try { k = localStorage.getItem(OWNER_KEY); } catch { /* private */ }
  if (!k || !/^[A-Za-z0-9_-]{16,64}$/.test(k)) {
    const abc = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    k = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => abc[b % abc.length]).join('');
    try { localStorage.setItem(OWNER_KEY, k); } catch { /* private: a new key per visit */ }
  }
  return k;
}
const hdr = () => ({ 'Content-Type': 'application/json', 'X-Sound-Owner': soundOwner() });
export async function fetchRoomPreset(room) {
  try { const r = await fetch(`/api/rooms/${encodeURIComponent(room)}/sound`, { headers: hdr() }); if (!r.ok) return undefined; return (await r.json()).preset || null; } catch { return undefined; }
}
export async function putRoomPreset(room, preset) {
  try { const r = await fetch(`/api/rooms/${encodeURIComponent(room)}/sound`, { method: 'PUT', headers: hdr(), body: JSON.stringify(preset || {}) }); return r.ok; } catch { return false; }
}

// The radio's state + what it drives: sound (Sounds: the knob/on → patchFor), the ambient bird/wind
// and the four-voice scheduler. clock() = the shared, server-corrected wall clock (groove.now()).
export class Radio {
  constructor({ sound, clock = () => Date.now(), onChange = () => {}, room = 'stad' }) {
    this.sound = sound; this.clock = clock; this.onChange = onChange; this.room = room; this.roomTempo = roomTempo(room);
    this.state = cleanRadio(null); this.amb = null; this.next = 0; this.voiceLog = [];
    sound.setRadio(this.state);
    // Walk-sound sequencer (shared/walkseq.mjs, Jens t783u): only while I walk, run mode applies.
    this.walk = { until: 0, run: null }; this.walkSeq = new Map(); // key -> newWalkSeq()
    this.walkBpm = RUN.walkDef; // MY walk tempo (per player; main.js / soundui.js set it from my run mode)
  }
  // My walk tempo, 30…3000 BPM (shared/runmode.mjs cleanWalkBpm). Only the walk sequencer reads it.
  setWalkBpm(bpm) { this.walkBpm = cleanWalkBpm(bpm); return this.walkBpm; }
  walkTempo() { return { bpm: this.walkBpm, phaseMs: 0 }; }
  // main.js walkSounds, every frame: until = wall ms I count as walking until (the footstep groove's
  // own walk detection, 0 = standing); run = { rate, tune } while Shift-running (groove.run) or null.
  setWalk({ until = 0, run = null } = {}) {
    this.walk = { until: Number.isFinite(until) && until > 0 ? until : 0, run: run && run.rate > 0 ? { rate: +run.rate, tune: run.tune > 0 ? +run.tune : 1 } : null };
  }
  set(patch, { save = true } = {}) {
    const s = this.state;
    this.state = cleanRadio({ ...s, ...patch, bird: { ...s.bird, ...(patch.bird || {}) }, wind: { ...s.wind, ...(patch.wind || {}) }, voices: { ...s.voices, ...(patch.voices || {}) } });
    this.sound.setRadio(this.state); this.apply();
    // City sound amount is read by placeTick (outdoors only). Stash for the next tick.
    if (patch && 'city' in patch && this.sound.engine?.place) this.sound.engine.place.city = this.state.city;
    if (save) this.onChange(this.state);
    return this.state;
  }
  // bird + wind follow the state (once the engine is up)
  apply() {
    const eng = this.sound.engine; if (!eng) { this.sound.ready?.then(() => this.apply()); return; }
    this.amb ||= new Ambient(eng);
    const off = !this.state.on || this.sound.muted;
    this.amb.setBird({ on: !off && this.state.bird.on, vol: this.state.bird.vol });
    this.amb.setWind({ on: !off && this.state.wind.on, vol: this.state.wind.vol });
  }
  // The master clock in this room: 90 BPM × this room's small nudge, + its phase shift. Not my walk tempo
  // (state.bpm is a dormant preset field; walk tempo = walkTempo(), per player).
  tempo() { return { bpm: this.roomTempo.bpm, phaseMs: this.roomTempo.phaseMs }; }
  // Lookahead scheduler (call every frame): what falls in the next 150 ms is put on the AudioContext
  // clock. Loops faster than RADIO.fastSteps steps/s switch to "tone mode": one sustained voice per
  // second with a per-sample step gate in the worklet (synth.js play({ gate })), so they become a tone.
  tick() {
    const on = this.state.on && !this.sound.muted && this.sound.engine;
    if (!on) { this.next = 0; this.toneUntil = new Map(); for (const w of this.walkSeq.values()) w.next = 0; return; }
    const ctx = this.sound.ctx, now = this.clock(), ahead = now + 150, from = Math.max(this.next || now, now - 20);
    const tempo = this.tempo(), barS = barMsAt(tempo.bpm) / 1000;
    const at = (t) => ctx.currentTime + Math.max(0, (t - now) / 1000);
    this.toneUntil ||= new Map();
    const loops = []; // { key, steps, bars, play(t, i, vol), tone(t, len, gate) }
    if (this.state.voices.on) FOUR_VOICES.forEach((v, vi) => loops.push({ key: 'v' + vi, steps: v.steps, bars: 1, pattern: [1],
      play: (time) => this.sound.play(v.sound, null, { volume: this.state.voices.vol * v.gain, tune: v.ratio, time, exact: true }),
      tone: (time, len, gate) => { const pf = this.sound.patchFor(v.sound, this.sound.mine).patch; this.sound.playPatch(sustain(retune(pf, v.ratio), len), { time, gate, length: len, gain: this.state.voices.vol * v.gain * 0.5 }); } }));
    for (const kind of SOUNDS) { // sequencer layers of my sounds
      const pf = this.sound.patchFor(kind, this.sound.mine).patch;
      (pf?.layers || []).forEach((l, i) => { if (!l.seq) return; loops.push({ walk: kind === 'step', pf, layer: i, key: `${kind}${i}`, steps: l.seq.len, bars: l.seq.bars, pattern: l.seq.steps.map((x) => (x.on ? x.vol / 100 : 0)),
        seq: l.seq, play: (time, n) => { const st = l.seq.steps[n]; if (st?.on) this.sound.playPatch(pf, { time, layer: i, gain: st.vol / 100 }); },
        tone: (time, len, gate) => this.sound.playPatch(sustain(pf, len), { time, layer: i, gate, length: len }) }); });
    }
    let fired = 0;
    const walk = this.walk, seen = new Set();
    const wTempo = this.walkTempo(), wBarS = barMsAt(wTempo.bpm) / 1000; // the walk sequencer: MY walk tempo
    for (const lp of loops) {
      if (lp.walk) { fired += this.walkLoop(lp, { now, ahead, tempo: wTempo, barS: wBarS, at, walk }); seen.add(lp.key); continue; }
      const rate = lp.steps / (lp.bars * barS); // steps per second
      if (rate <= RADIO.fastSteps) {
        for (const e of loopSteps(from, ahead, { steps: lp.steps, bars: lp.bars, tempo, max: 64 })) { lp.play(at(e.t), e.i); fired++; this.voiceLog.push({ t: Math.round(e.t), key: lp.key, i: e.i }); }
      } else if ((this.toneUntil.get(lp.key) || 0) < ahead) { // tone mode: the next second, gated per sample
        const t = Math.max(this.toneUntil.get(lp.key) || now, now), len = 1;
        const loopsAt = barsAtTime(t, tempo) / lp.bars; // where in the loop (loops since the epoch)
        lp.tone(at(t), len, { pattern: lp.pattern, rate: 1 / (lp.bars * barS), phase: loopsAt - Math.floor(loopsAt), decay: 4 });
        this.toneUntil.set(lp.key, t + len * 1000); this.voiceLog.push({ t: Math.round(t), key: lp.key, tone: true });
      }
    }
    for (const k of this.walkSeq.keys()) if (!seen.has(k)) this.walkSeq.delete(k); // the layer is gone
    if (this.voiceLog.length > 64) this.voiceLog.splice(0, this.voiceLog.length - 64);
    this.next = ahead;
    return fired;
  }
  // A sequencer layer on the walk (Steps) sound: only while I walk (pause in place when I stop,
  // go on from the next step when I walk again), at run.rate × and run.tune while running.
  walkLoop(lp, { now, ahead, tempo, barS, at, walk }) {
    let st = this.walkSeq.get(lp.key); if (!st) { st = newWalkSeq(); this.walkSeq.set(lp.key, st); }
    const run = walk.run, rate = run ? run.rate : 1, tune = run ? run.tune : 1;
    const pf = tune !== 1 ? retune(lp.pf, tune) : lp.pf;
    if (!(Math.min(ahead, walk.until) > now)) { this.toneUntil.delete(lp.key); return 0; } // standing: silent, position kept
    if (lp.steps * rate / (lp.bars * barS) <= RADIO.fastSteps) {
      this.toneUntil.delete(lp.key);
      const evs = planWalkSeq(st, { now, ahead, walk, steps: lp.steps, bars: lp.bars, tempo });
      for (const e of evs) {
        const s = lp.seq.steps[e.i]; if (s?.on) this.sound.playPatch(pf, { time: at(e.t), layer: lp.layer, gain: s.vol / 100 });
        this.voiceLog.push({ t: Math.round(e.t), key: lp.key, i: e.i, walk: true, ...(run ? { run: +rate.toFixed(4), tune: +tune.toFixed(4) } : {}) });
      }
      return evs.length;
    }
    // tone mode (faster than RADIO.fastSteps): short gated chunks while I walk, so it stops soon after I do
    const end = Math.min(ahead, walk.until), last = this.toneUntil.get(lp.key) || 0;
    if (last >= end) return 0;
    const t = Math.max(last, now), len = 0.25;
    const loopsAt = barsAtTime(t, tempo) * rate / lp.bars;
    this.sound.playPatch(sustain(pf, len), { time: at(t), layer: lp.layer, gate: { pattern: lp.pattern, rate: rate / (lp.bars * barS), phase: loopsAt - Math.floor(loopsAt), decay: 4 }, length: len });
    this.toneUntil.set(lp.key, t + len * 1000); st.next = t + len * 1000;
    this.voiceLog.push({ t: Math.round(t), key: lp.key, tone: true, walk: true, ...(run ? { run: +rate.toFixed(4), tune: +tune.toFixed(4) } : {}) });
    return 0;
  }
}
// A copy of a patch that holds for `len` s (tone mode): short attack, full sustain, quick release.
function sustain(p, len) {
  if (!p) return p;
  return { ...p, layers: p.layers.map((l) => ({ ...l, a: Math.min(l.a, 0.005), d: 0.01, s: 1, hold: Math.min(3, len), r: 0.03, delay: 0, ...(l.kind === 'sampler' ? { whole: false, loop: true } : {}) })) };
}

// ---------- Master block (top of Sound settings) ----------
// Volume = Music vol (final output gain). City sound = dry/wet of the city place bus
// (reverb + delay sends; 0 = dry own sounds, 100 = wet only). Dormant fields stay in radio.state.
export const detent = (k) => { k = Math.min(1, Math.max(0, k)); return Math.abs(k - 0.5) < 0.03 ? 0.5 : k; };
export function knobText(st) {
  // Kept for tests / old callers; Blend UI is gone.
  const k = st.knob;
  if (!st.on) return 'Master off – original sound only';
  if (k <= 0) return 'Original sound';
  if (Math.abs(k - 0.5) < 1e-6) return 'My sound (this room)';
  if (k < 0.5) return `${Math.round(k * 200)} % toward my sound`;
  return `${Math.round((k - 0.5) * 200)} % past my sound (stronger)`;
}
export function citySoundText(city) {
  const p = Math.round(Math.min(1, Math.max(0, Number(city) || 0)) * 100);
  if (p <= 0) return '0 % – dry (own sounds, no city FX)';
  if (p >= 100) return '100 % – city FX only (wet)';
  return `${p} % city FX`;
}
// musicVol: { get, set, def } – same object main.js uses for Music vol (merged into Master).
export function radioBlock({ radio, imgUrl, el, musicVol = null }) {
  void imgUrl;
  const st = radio.state;
  const box = el('fieldset', 'snd-layer radio-box'); box.id = 'radio-box';
  box.appendChild(el('legend', null, 'Master'));
  box.appendChild(el('p', 'hint', 'Volume in your ears, and how much of the city effects you hear.'));

  // ----- Volume: the ONLY volume control (Jens, 11 Nov 2026: the header "Music vol" duplicate is gone) -----
  const volRow = el('div', 'snd-sl'); volRow.dataset.param = 'master-vol';
  volRow.appendChild(el('span', null, 'Volume'));
  const vol = el('input'); vol.type = 'range'; vol.min = 0; vol.max = 100; vol.step = 1; vol.id = 'master-vol';
  vol.setAttribute('aria-label', 'Volume');
  const vol0 = musicVol ? musicVol.get() : 1;
  vol.value = String(Math.round(vol0 * 100));
  const volOut = el('output', null, `${Math.round(vol0 * 100)} %`); volOut.id = 'master-vol-val';
  const syncVol = (v) => {
    const x = Math.min(1, Math.max(0, v));
    vol.value = String(Math.round(x * 100));
    volOut.textContent = `${Math.round(x * 100)} %`;
    if (musicVol) musicVol.set(x);
  };
  vol.oninput = () => syncVol(Number(vol.value) / 100);
  volRow.append(vol, volOut); box.appendChild(volRow);

  // ----- City sound (dry ↔ wet of city place FX) -----
  const cityWrap = el('div', 'snd-group');
  cityWrap.appendChild(el('small', null, 'City sound'));
  const cityRow = el('div', 'snd-sl'); cityRow.dataset.param = 'city-sound';
  cityRow.appendChild(el('span', null, 'City sound'));
  const city = el('input'); city.type = 'range'; city.min = 0; city.max = 100; city.step = 1; city.id = 'city-sound';
  city.setAttribute('aria-label', 'City sound: dry to wet city effects');
  city.value = String(Math.round((st.city || 0) * 100));
  const cityOut = el('output'); cityOut.id = 'city-sound-val';
  const showCity = () => { cityOut.textContent = citySoundText(radio.state.city); city.value = String(Math.round((radio.state.city || 0) * 100)); };
  city.oninput = () => { radio.set({ city: Number(city.value) / 100 }, { save: false }); showCity(); };
  city.onchange = () => radio.set({});
  cityRow.append(city, cityOut); cityWrap.appendChild(cityRow);
  cityWrap.appendChild(el('p', 'hint', '0 = your sounds dry. 100 = only through the city reverb and delay.'));
  box.appendChild(cityWrap);

  showCity();
  return box;
}
export { cleanPreset };

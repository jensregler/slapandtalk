// The radio (Jens, 5 Nov 2026; shared/radio.mjs): the redio sticker opens Sound settings, and at the
// top of it sits the radio itself – the picture, with its big knob as MORPH + SEEK – not a volume (left = Ulla's
// original sound, middle = my preset for this room, right = on past it), a power button, and the background bird, wind
// and the four voices. Everything here is mine only: saved per room + per player on the server
// (a private random key in this browser), never broadcast.
import { cleanRadio, cleanPreset, FOUR_VOICES, RADIO, bpmToKnob, knobToBpm } from '../../shared/radio.mjs';
import { roomTempo, loopSteps, barMsAt, barsAtTime, MASTER } from '../../shared/clock.mjs';
import { SOUNDS, retune } from '../../shared/synth.mjs';
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
  }
  set(patch, { save = true } = {}) {
    const s = this.state;
    this.state = cleanRadio({ ...s, ...patch, bird: { ...s.bird, ...(patch.bird || {}) }, wind: { ...s.wind, ...(patch.wind || {}) }, voices: { ...s.voices, ...(patch.voices || {}) } });
    this.sound.setRadio(this.state); this.apply();
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
  // The master clock for me in this room: my bpm × this room's small nudge, + its phase shift.
  tempo() { return { bpm: this.state.bpm * (this.roomTempo.bpm / MASTER.bpm), phaseMs: this.roomTempo.phaseMs }; }
  // Lookahead scheduler (call every frame): what falls in the next 150 ms is put on the AudioContext
  // clock. Loops faster than RADIO.fastSteps steps/s switch to "tone mode": one sustained voice per
  // second with a per-sample step gate in the worklet (synth.js play({ gate })), so they become a tone.
  tick() {
    const on = this.state.on && !this.sound.muted && this.sound.engine;
    if (!on) { this.next = 0; this.toneUntil = new Map(); return; }
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
      (pf?.layers || []).forEach((l, i) => { if (!l.seq) return; loops.push({ key: `${kind}${i}`, steps: l.seq.len, bars: l.seq.bars, pattern: l.seq.steps.map((x) => (x.on ? x.vol / 100 : 0)),
        play: (time, n) => { const st = l.seq.steps[n]; if (st?.on) this.sound.playPatch(pf, { time, layer: i, gain: st.vol / 100 }); },
        tone: (time, len, gate) => this.sound.playPatch(sustain(pf, len), { time, layer: i, gate, length: len }) }); });
    }
    let fired = 0;
    for (const lp of loops) {
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
    if (this.voiceLog.length > 64) this.voiceLog.splice(0, this.voiceLog.length - 64);
    this.next = ahead;
    return fired;
  }
}
// A copy of a patch that holds for `len` s (tone mode): short attack, full sustain, quick release.
function sustain(p, len) {
  if (!p) return p;
  return { ...p, layers: p.layers.map((l) => ({ ...l, a: Math.min(l.a, 0.005), d: 0.01, s: 1, hold: Math.min(3, len), r: 0.03, delay: 0, ...(l.kind === 'sampler' ? { whole: false, loop: true } : {}) })) };
}

// ---------- The radio block (top of Sound settings) ----------
// imgUrl: the redio sticker's picture. The knob sits where the picture's volume knob is.
// Knob: 0 = original, ½ = my sound (a click-stop), 1 = seek on past my sound (knobToMorph).
export const detent = (k) => { k = Math.min(1, Math.max(0, k)); return Math.abs(k - 0.5) < 0.03 ? 0.5 : k; };
export function knobText(st) {
  const k = st.knob;
  if (!st.on) return 'Radio off – the original sound';
  if (k <= 0) return 'Original sound';
  if (Math.abs(k - 0.5) < 1e-6) return 'My sound (this room)';
  if (k < 0.5) return `${Math.round(k * 200)} % toward my sound`;
  return `Seek: ${Math.round((k - 0.5) * 200)} % past my sound`;
}
const KNOB_AT = { x: 0.352, y: 0.738, size: 0.095 }; // (fractions of the picture: the lower-left knob)
export function radioBlock({ radio, imgUrl, el }) {
  const st = radio.state;
  const box = el('section', 'radio-box'); box.id = 'radio-box';
  const pic = el('div', 'radio-pic'); pic.style.backgroundImage = imgUrl ? `url("${imgUrl}")` : '';
  if (!st.on) pic.classList.add('off');
  const knob = el('div', 'radio-knob'); knob.id = 'radio-knob'; knob.tabIndex = 0; knob.setAttribute('role', 'slider');
  knob.setAttribute('aria-label', 'Morph and seek: original, my sound, then further'); knob.setAttribute('aria-valuemin', '0'); knob.setAttribute('aria-valuemax', '100');
  Object.assign(knob.style, { left: `${KNOB_AT.x * 100}%`, top: `${KNOB_AT.y * 100}%`, width: `${KNOB_AT.size * 100}%` });
  const face = el('div', 'radio-knob-face'); face.appendChild(el('div', 'radio-knob-mark')); knob.appendChild(face);
  const read = el('div', 'radio-read'); read.id = 'radio-read';
  const show = () => {
    const k = radio.state.knob, deg = -135 + 270 * k;
    face.style.transform = `rotate(${deg}deg)`; knob.setAttribute('aria-valuenow', String(Math.round(k * 100)));
    read.textContent = knobText(radio.state);
  };
  let drag = null;
  knob.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); knob.setPointerCapture(e.pointerId); drag = { y: e.clientY, x: e.clientX, k: radio.state.knob }; });
  knob.addEventListener('pointermove', (e) => { if (!drag) return; const d = (e.clientX - drag.x - (e.clientY - drag.y)) / 220; radio.set({ knob: detent(drag.k + d) }, { save: false }); show(); });
  const end = () => { if (drag) { drag = null; radio.set({}, { save: true }); } };
  knob.addEventListener('pointerup', end); knob.addEventListener('pointercancel', end);
  knob.addEventListener('keydown', (e) => { const d = { ArrowRight: 0.05, ArrowUp: 0.05, ArrowLeft: -0.05, ArrowDown: -0.05 }[e.key]; if (d == null) return; e.preventDefault(); e.stopPropagation(); radio.set({ knob: Math.min(1, Math.max(0, radio.state.knob + d)) }); show(); });
  knob.addEventListener('wheel', (e) => { e.preventDefault(); radio.set({ knob: Math.min(1, Math.max(0, radio.state.knob - Math.sign(e.deltaY) * 0.05)) }); show(); }, { passive: false });
  pic.appendChild(knob);
  const ends = el('div', 'radio-ends'); ends.append(el('span', null, '◀ Original'), el('span', null, 'Mine'), el('span', null, 'Next ▶'));
  const power = el('button', 'radio-power', st.on ? '⏻ Radio ON' : '⏻ Radio OFF'); power.type = 'button'; power.id = 'radio-power';
  power.setAttribute('aria-pressed', String(st.on));
  power.onclick = () => { radio.set({ on: !radio.state.on }); power.textContent = radio.state.on ? '⏻ Radio ON' : '⏻ Radio OFF'; power.setAttribute('aria-pressed', String(radio.state.on)); pic.classList.toggle('off', !radio.state.on); show(); };
  box.append(pic, ends, read, power);
  // the master tempo: 90 BPM default, log taper up to audio rate – "11" at the top
  const tp = el('div', 'radio-tempo'); tp.id = 'radio-tempo';
  const tl = el('span', null, 'Tempo'); const tr = el('input'); tr.type = 'range'; tr.min = 0; tr.max = 1000; tr.step = 1; tr.id = 'radio-bpm';
  tr.value = Math.round(bpmToKnob(st.bpm) * 1000); tr.setAttribute('aria-label', 'Tempo');
  const to = el('output'); const eleven = el('span', 'radio-eleven', '11');
  const tshow = () => { const b = radio.state.bpm, hz = b / 60; to.textContent = hz >= RADIO.gridFromHz ? `${Math.round(b).toLocaleString('en')} BPM · ${hz.toFixed(hz < 100 ? 1 : 0)} Hz tone` : `${b.toFixed(b < 200 ? 1 : 0)} BPM`; };
  tr.oninput = () => { radio.set({ bpm: knobToBpm(Number(tr.value) / 1000) }, { save: false }); tshow(); };
  tr.onchange = () => radio.set({});
  const t90 = el('button', 'radio-90', '90'); t90.type = 'button'; t90.title = 'Back to 90 BPM'; t90.onclick = () => { radio.set({ bpm: 90 }); tr.value = Math.round(bpmToKnob(90) * 1000); tshow(); };
  tp.append(tl, tr, eleven, to, t90); tshow(); box.appendChild(tp);
  for (const [key, label] of [['bird', '🐦 Bird'], ['wind', '🌬 Wind'], ['voices', '🎶 Four voices']]) {
    const row = el('div', 'radio-amb'); row.dataset.amb = key;
    const b = el('button', 'radio-toggle', `${label}: ${st[key].on ? 'on' : 'off'}`); b.type = 'button'; b.setAttribute('aria-pressed', String(st[key].on));
    b.onclick = () => { const on = !radio.state[key].on; radio.set({ [key]: { on } }); b.textContent = `${label}: ${on ? 'on' : 'off'}`; b.setAttribute('aria-pressed', String(on)); };
    const r = el('input'); r.type = 'range'; r.min = 0; r.max = 100; r.value = Math.round(st[key].vol * 100); r.setAttribute('aria-label', `${label} volume`);
    r.oninput = () => radio.set({ [key]: { vol: Number(r.value) / 100 } }, { save: false });
    r.onchange = () => radio.set({});
    row.append(b, r); box.appendChild(row);
  }
  show();
  return box;
}
export { cleanPreset };

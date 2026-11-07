// Master / blend block (was "the radio"; Jens, 5 Nov 2026 + Nov 2026: no radio metaphor).
// Sound settings opens with a plain Master section: on/off, Blend (original → mine → further),
// Tempo, Bird / Wind / Four voices. Same saved shape (shared/radio.mjs cleanRadio). Mine only:
// per room + per player on the server (private key in this browser), never broadcast.
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

// ---------- Master / blend block (top of Sound settings) ----------
// Used to be a radio picture with a SEEK knob. Jens (Nov 2026): treat it as a normal synth row –
// plain sliders, every control visible, no hidden metaphor. Saved shape is still { on, knob, bpm,
// bird, wind, voices } (cleanRadio) so old presets load unchanged.
export const detent = (k) => { k = Math.min(1, Math.max(0, k)); return Math.abs(k - 0.5) < 0.03 ? 0.5 : k; };
export function knobText(st) {
  const k = st.knob;
  if (!st.on) return 'Master off – original sound only';
  if (k <= 0) return 'Original sound';
  if (Math.abs(k - 0.5) < 1e-6) return 'My sound (this room)';
  if (k < 0.5) return `${Math.round(k * 200)} % toward my sound`;
  return `${Math.round((k - 0.5) * 200)} % past my sound (stronger)`;
}
export function radioBlock({ radio, imgUrl, el }) {
  void imgUrl; // kept in the signature for callers; the picture is gone
  const st = radio.state;
  const box = el('fieldset', 'snd-layer radio-box'); box.id = 'radio-box';
  const leg = el('legend', null, 'Master'); box.appendChild(leg);
  box.appendChild(el('p', 'hint', 'Blend, tempo and background for this room. Same settings as before – just laid out like the rest of the synth.'));

  // ----- On / off -----
  const powerRow = el('div', 'snd-sel');
  const power = el('button', 'radio-power', st.on ? '⏻ Master ON' : '⏻ Master OFF');
  power.type = 'button'; power.id = 'radio-power'; power.setAttribute('aria-pressed', String(st.on));
  power.onclick = () => {
    radio.set({ on: !radio.state.on });
    power.textContent = radio.state.on ? '⏻ Master ON' : '⏻ Master OFF';
    power.setAttribute('aria-pressed', String(radio.state.on));
    show();
  };
  powerRow.appendChild(power); box.appendChild(powerRow);

  // ----- Blend (was the radio knob / SEEK) -----
  const blendWrap = el('div', 'snd-group');
  blendWrap.appendChild(el('small', null, 'Blend'));
  const ends = el('div', 'radio-ends');
  ends.append(el('span', null, 'Original'), el('span', null, 'Mine'), el('span', null, 'Further'));
  blendWrap.appendChild(ends);
  const blendRow = el('div', 'snd-sl'); blendRow.dataset.param = 'blend';
  blendRow.appendChild(el('span', null, 'Blend'));
  const knob = el('input'); knob.type = 'range'; knob.min = 0; knob.max = 100; knob.step = 1;
  knob.id = 'radio-knob'; knob.setAttribute('role', 'slider');
  knob.setAttribute('aria-label', 'Blend: original, my sound, then further');
  knob.setAttribute('aria-valuemin', '0'); knob.setAttribute('aria-valuemax', '100');
  knob.value = String(Math.round(st.knob * 100));
  const read = el('output'); read.id = 'radio-read';
  const show = () => {
    const k = radio.state.knob;
    knob.value = String(Math.round(k * 100));
    knob.setAttribute('aria-valuenow', String(Math.round(k * 100)));
    read.textContent = knobText(radio.state);
  };
  knob.oninput = () => { radio.set({ knob: detent(Number(knob.value) / 100) }, { save: false }); show(); };
  knob.onchange = () => radio.set({});
  // Keep keyboard nudging (tests + accessibility)
  knob.addEventListener('keydown', (e) => {
    const d = { ArrowRight: 0.05, ArrowUp: 0.05, ArrowLeft: -0.05, ArrowDown: -0.05 }[e.key];
    if (d == null) return;
    e.preventDefault(); e.stopPropagation();
    radio.set({ knob: Math.min(1, Math.max(0, radio.state.knob + d)) }); show();
  });
  blendRow.append(knob, read); blendWrap.appendChild(blendRow); box.appendChild(blendWrap);

  // ----- Tempo -----
  const tp = el('div', 'snd-group'); tp.id = 'radio-tempo';
  tp.appendChild(el('small', null, 'Tempo'));
  const trow = el('div', 'snd-sl');
  trow.appendChild(el('span', null, 'Tempo'));
  const tr = el('input'); tr.type = 'range'; tr.min = 0; tr.max = 1000; tr.step = 1; tr.id = 'radio-bpm';
  tr.value = Math.round(bpmToKnob(st.bpm) * 1000); tr.setAttribute('aria-label', 'Tempo');
  const to = el('output');
  const tshow = () => {
    const b = radio.state.bpm, hz = b / 60;
    to.textContent = hz >= RADIO.gridFromHz
      ? `${Math.round(b).toLocaleString('en')} BPM · ${hz.toFixed(hz < 100 ? 1 : 0)} Hz tone`
      : `${b.toFixed(b < 200 ? 1 : 0)} BPM`;
  };
  tr.oninput = () => { radio.set({ bpm: knobToBpm(Number(tr.value) / 1000) }, { save: false }); tshow(); };
  tr.onchange = () => radio.set({});
  trow.append(tr, to); tp.appendChild(trow);
  const tbtns = el('div', 'snd-sel');
  const t90 = el('button', 'radio-90', '90 BPM'); t90.type = 'button'; t90.title = 'Back to 90 BPM';
  t90.onclick = () => { radio.set({ bpm: 90 }); tr.value = Math.round(bpmToKnob(90) * 1000); tshow(); };
  const eleven = el('span', 'radio-eleven', '↑ 11'); eleven.title = 'Top of the tempo range';
  tbtns.append(t90, eleven); tp.appendChild(tbtns); tshow(); box.appendChild(tp);

  // ----- Background / voices (every control visible) -----
  const ambWrap = el('div', 'snd-group');
  ambWrap.appendChild(el('small', null, 'Background'));
  for (const [key, label] of [['bird', '🐦 Bird'], ['wind', '🌬 Wind'], ['voices', '🎶 Four voices']]) {
    const row = el('div', 'radio-amb snd-sl'); row.dataset.amb = key;
    const b = el('button', 'radio-toggle', `${label}: ${st[key].on ? 'on' : 'off'}`);
    b.type = 'button'; b.setAttribute('aria-pressed', String(st[key].on));
    b.onclick = () => {
      const on = !radio.state[key].on;
      radio.set({ [key]: { on } });
      b.textContent = `${label}: ${on ? 'on' : 'off'}`;
      b.setAttribute('aria-pressed', String(on));
    };
    const r = el('input'); r.type = 'range'; r.min = 0; r.max = 100; r.value = Math.round(st[key].vol * 100);
    r.setAttribute('aria-label', `${label} amount`);
    r.oninput = () => radio.set({ [key]: { vol: Number(r.value) / 100 } }, { save: false });
    r.onchange = () => radio.set({});
    const out = el('output', null, `${Math.round(st[key].vol * 100)} %`);
    r.addEventListener('input', () => { out.textContent = `${r.value} %`; });
    row.append(b, r, out); ambWrap.appendChild(row);
  }
  // List the four voices so they are not hidden behind a single toggle.
  const vList = el('p', 'hint radio-voices-list');
  vList.textContent = 'Four voices: ' + FOUR_VOICES.map((v) => `${v.name} (${v.steps} steps)`).join(' · ');
  ambWrap.appendChild(vList);
  box.appendChild(ambWrap);

  show();
  return box;
}
export { cleanPreset };

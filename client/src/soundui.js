// Sound settings (full version, entitlements.full.soundDesign): synth panels for slap, peel,
// steps and Landing/duff (SOUND_TABS). Effects data (st.fx) stays (the listener FX) – the Effects tab
// is kept in code but not shown.
// Personal (Jens, 2 Nov 2026 / session model 6 Nov 2026): my sound settings are mine only –
// sessionStorage 'klibb.sound' (and voice FX / Hear myself / Music vol / groove / run / mic). They
// come along from a room out into the City (and around inside the city), never sent to anyone.
// Entering a NEW room (or a fresh page load into a room) puts every one of them back to default
// and clears sampler recordings (prepareSoundForPlace → resetPersonalSound). "Exit to menu" does
// the same. Free players never see the panel; they get their own variation of the defaults from
// 'klibb.soundSeed'.
import { SOUNDS, SOUND_TABS, SYNTH, WAVES, NOISES, FILTERS, LFO_TARGETS, SYNCS, DEFAULT_PATCHES, FX_DEFAULTS,
  cleanPatch, cleanFx, cleanSound, variant, randomPatch, randomFx, noteName, diffPatch, snapFreq, retune as retuneP, defaultStepSeq } from '../../shared/synth.mjs';
import { lockedPatch, setLock, getLock, clearLock, clearLocks, lockCount, stepsLocking, removeLayerLocks, resizeSeq, lockKey } from '../../shared/stepseq.mjs';
import { MOD, canAddMod, newMod, newFollower, removeMod, removeLayerMods, parseTarget, modOrder, snapRate, selfLoop, targetSpec, LAYER_TARGETS, PATCH_TARGETS, MOD_TARGETS } from '../../shared/lfo.mjs';
import { loadSampleFile, clearSamples, pruneSamples, ensureSamples } from './samples.js';
import { SAMPLE_BUFFERS } from './synth.js';
import { S } from './strings.js';
import { RUN, RUN_DEFAULTS, cleanRun, cleanTempo, cleanPitch, cleanCrouchTempo, cleanCrouchPitch, pitchMin, pitchMax, runRate, crouchRate, pitchRatio, pitchLabel, tempoLabel, crouchTempoLabel, cleanWalkBpm, snapWalkBpm, stepWalkBpm, TEMPO_PAGE, WALK_KNOB_STEPS, walkBpmToKnob, knobToWalkBpm, walkBpmLabel } from '../../shared/runmode.mjs';
import { TEMPO_BPMS, meetBars } from '../../shared/tempogrid.mjs';

// Visit-scoped (Jens, 6 Nov 2026): patches / FX / Music vol / groove / run / voice FX / Hear myself
// follow you from a room out into the City. Entering a different room (or a fresh load into a room)
// resets them (prepareSoundForPlace). A room's server preset (radio.js) only seeds when personal
// sound is empty after that reset. Older 'klibb.sound@<room>' keys are migrated once onto 'klibb.sound'.
const SEED_KEY = 'klibb.soundSeed';
const SOUND_KEY = 'klibb.sound';
export const SOUND_SCOPE_KEY = 'klibb.soundScope'; // 'room:<id>' | 'city:<id>' – where this visit's sound last lived
export const VOICE_FX_KEY = 'klibb.voiceFx';
export const VOICE_MON_KEY = 'klibb.voiceMon';
export const VOICE_MIC_KEY = 'klibb.voiceMic'; // 'on' | 'muted' | absent(=off)
export function setSoundRoom(_room) { /* no-op: sound is visit-scoped (API kept for callers) */ }
export const soundKey = () => SOUND_KEY;
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* full/private */ } };
// the personal sound settings: this visit (tab) only
const sread = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const swrite = (k, v) => { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* private */ } };
// Every personal sound setting that Exit-to-menu / a new room puts back to default.
export const PERSONAL_SOUND_KEYS = [SOUND_KEY, 'klibb.musicVol', 'klibb.grooveScale', RUN.key, VOICE_FX_KEY, VOICE_MON_KEY, VOICE_MIC_KEY];
// (before 2 Nov 2026 they lived in localStorage for good: gone, so nobody starts with old ones)
try { for (const k of PERSONAL_SOUND_KEYS) localStorage.removeItem(k); } catch { /* private */ }
// Migrate a leftover per-room sound key onto the visit key (once).
try {
  if (!sessionStorage.getItem(SOUND_KEY)) {
    for (const k of Object.keys(sessionStorage)) {
      if (/^klibb\.sound@/.test(k) && sessionStorage.getItem(k)) { sessionStorage.setItem(SOUND_KEY, sessionStorage.getItem(k)); break; }
    }
  }
} catch { /* private */ }
// Wipe personal sound + sampler recordings (IndexedDB) + per-room radio copies + the visit scope.
export function resetPersonalSound() {
  for (const k of PERSONAL_SOUND_KEYS) swrite(k, null);
  swrite(SOUND_SCOPE_KEY, null);
  try {
    const keys = [];
    for (let i = 0; i < sessionStorage.length; i++) keys.push(sessionStorage.key(i));
    for (const k of keys) if (k && /^klibb\.(sound|radio)@/.test(k)) sessionStorage.removeItem(k);
  } catch { /* private */ }
  try { localStorage.removeItem(VOICE_FX_KEY); } catch { /* private */ }
  clearSamples().catch(() => {});
  runCache = null;
}
// Call once at boot (main.js), before Sounds / voice read session keys.
// place = { kind: 'city', id } → KEEP settings (room→city and within the city).
// place = { kind: 'room', id } → KEEP only on reload of the SAME room; otherwise RESET
// (fresh load, other room, or leaving the city into a room).
export function prepareSoundForPlace(place) {
  const prev = sread(SOUND_SCOPE_KEY);
  if (!place || !place.kind || !place.id) {
    resetPersonalSound();
    return { reset: true, prev, scope: null };
  }
  if (place.kind === 'city') {
    const scope = `city:${place.id}`;
    swrite(SOUND_SCOPE_KEY, scope);
    return { reset: false, prev, scope };
  }
  const scope = `room:${place.id}`;
  if (prev === scope) return { reset: false, prev, scope };
  resetPersonalSound();
  swrite(SOUND_SCOPE_KEY, scope);
  return { reset: true, prev, scope };
}
export const personalGet = sread, personalSet = swrite;
// Run mode (shared/runmode.mjs, Jens t544u): { tempo %, pitch step, walkBpm, crouchTempo %, crouchPitch step } – personal, this visit.
let runCache = null;
export function loadRunMode() {
  if (!runCache) { try { runCache = cleanRun(JSON.parse(sread(RUN.key) || 'null')); } catch { runCache = cleanRun(null); } }
  return runCache;
}
export function saveRunMode(r) {
  const c = cleanRun(r); runCache = c;
  swrite(RUN.key, JSON.stringify(c) === JSON.stringify(cleanRun(RUN_DEFAULTS)) ? null : JSON.stringify(c));
  return c;
}

export function mySeed() {
  let s = read(SEED_KEY);
  if (!s || !/^[A-Za-z0-9_-]{4,24}$/.test(s)) {
    const abc = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    s = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => abc[b % abc.length]).join('');
    write(SEED_KEY, s);
  }
  return s;
}
// My look.sound: { seed, patches?, fx? } (cleaned like the server does).
export function loadSoundLook() {
  let saved = {}; try { saved = JSON.parse(sread(SOUND_KEY) || '{}') || {}; } catch { saved = {}; }
  return cleanSound({ seed: mySeed(), patches: saved.patches, fx: saved.fx }, { custom: true }) || { seed: mySeed() };
}
export function saveSoundLook({ patches, fx }) {
  const clean = cleanSound({ seed: mySeed(), patches, fx }, { custom: true }) || {};
  if (!clean.patches && !clean.fx) swrite(SOUND_KEY, null);
  else swrite(SOUND_KEY, JSON.stringify({ patches: clean.patches, fx: clean.fx }));
  pruneSamples(clean.patches).catch(() => {});
  return clean;
}

// ---------- Slider mapping (log for frequencies and times) ----------
const LOG = new Set(['freq', 'cutoff', 'lfoRate', 'a', 'd', 'r', 'hold', 'pitchTime', 'fTime', 'time', 'decay', 'preDelay', 'delay', 'rate', 'decim', 'attack', 'release', 'gain']);
const STEPS = 1000;
function toSlider(k, [min, max], v) {
  if (LOG.has(k)) { const lo = Math.max(min, 0.0005); return Math.round(STEPS * Math.log(Math.max(lo, v) / lo) / Math.log(max / lo)); }
  return Math.round(STEPS * (v - min) / (max - min));
}
function fromSlider(k, [min, max, step], x) {
  let v;
  if (LOG.has(k)) { const lo = Math.max(min, 0.0005); v = lo * Math.pow(max / lo, x / STEPS); if (x === 0) v = min; } else v = min + (max - min) * x / STEPS;
  return Math.min(max, Math.max(min, Math.round(v / step) * step));
}
const fmt = (k, v) => {
  if (k === 'freq') { const m = 69 + 12 * Math.log2(v / 440), on = Math.abs(m - Math.round(m)) < 0.02; return `${on ? noteName(m) + ' ' : ''}${v >= 1000 ? (v / 1000).toFixed(2) + ' kHz' : v.toFixed(v < 100 ? 1 : 0) + ' Hz'}`; }
  if (k === 'cutoff') return v >= 1000 ? `${(v / 1000).toFixed(2)} kHz` : `${Math.round(v)} Hz`;
  if (k === 'lfoRate') return `${v.toFixed(1)} Hz`;
  if (['a', 'd', 'r', 'hold', 'pitchTime', 'fTime', 'time', 'preDelay', 'delay'].includes(k)) return v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`;
  if (k === 'decay') return `${v.toFixed(1)} s`;
  if (k === 'attack' || k === 'release') return v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`;
  if (k === 'gain') return `×${v.toFixed(1)}`;
  if (k === 'detune' || k === 'spread') return `${Math.round(v)} ct`;
  if (k === 'pitchAmt') return `${v > 0 ? '+' : ''}${v.toFixed(1)} st`;
  if (k === 'fEnv') return `${v > 0 ? '+' : ''}${v.toFixed(2)} oct`;
  if (k === 'unison' || k === 'bits') return String(Math.round(v));
  if (k === 'q') return v.toFixed(1);
  if (k === 'note' || k === 'root') return `${noteName(v)} (${Math.round(v)})`;
  if (k === 'xfade') return `${Math.round(v * 1000)} ms`;
  if (k === 'pan') return Math.abs(v) < 0.005 ? 'C' : v < 0 ? `L ${Math.round(-v * 100)}` : `R ${Math.round(v * 100)}`;
  if (k === 'poly') return `${Math.round(v)} voices`;
  if (k === 'decim') return v <= 1 ? 'off' : `÷${Math.round(v)}`;
  if (k === 'crush') return v <= 0 ? 'off' : `${Math.round(v)} bit`;
  if (k === 'rate') return v < 1 ? `${v.toFixed(2)} Hz` : v < 20 ? `${v.toFixed(1)} Hz` : `${Math.round(v)} Hz · ${noteName(69 + 12 * Math.log2(v / 440))} tone`;
  return `${Math.round(v * 100)}%`;
};
// a new mic layer: a short gate (each note opens it), modest level, a gentle low-pass
const MIC_LAYER = Object.freeze({ a: 0.005, d: 0.2, s: 1, hold: 0.12, r: 0.06, level: 0.35, filter: 'lowpass', cutoff: 7000, q: 0.7 });
const LABELS = {
  freq: 'Pitch', detune: 'Detune', unison: 'Unison', spread: 'Spread', sub: 'Sub', pitchAmt: 'Sweep', pitchTime: 'Sweep time',
  a: 'Attack', d: 'Decay', s: 'Sustain', r: 'Release', hold: 'Hold', level: 'Level', drive: 'Drive', delay: 'Start',
  cutoff: 'Cutoff', q: 'Resonance', fEnv: 'Filter env', fTime: 'Env time', lfoRate: 'LFO rate', lfoDepth: 'LFO depth',
  decay: 'Decay', preDelay: 'Pre-delay', wet: 'Wet', time: 'Time', feedback: 'Feedback', bits: 'Bits', amount: 'Amount',
  note: 'Note', root: 'Root note', start: 'Start', end: 'End', loopStart: 'Loop start', loopEnd: 'Loop end', xfade: 'Crossfade',
  pan: 'Pan', poly: 'Polyphony', decim: 'Decimate', crush: 'Bit crush', rate: 'Rate', depth: 'Depth', phase: 'Phase',
  attack: 'Attack', release: 'Release', gain: 'Sensitivity', thr: 'Threshold',
};
// Sampler layer (Jens, 5 Nov 2026): its own groups. One-shot hides decay/sustain/hold (the sample decides).
const SAMPLER_GROUPS = [
  ['Pitch', ['note', 'root', 'detune', 'pitchAmt', 'pitchTime']],
  ['Sample', ['start', 'end', 'loopStart', 'loopEnd', 'xfade', 'level', 'pan', 'poly']],
  ['Amp', ['a', 'd', 's', 'r', 'hold', 'drive', 'delay']],
  ['Filter', ['cutoff', 'q', 'fEnv', 'fTime']],
  ['Decimate', ['decim', 'crush']],
  ['LFO', ['lfoRate', 'lfoDepth']],
];
const rangeOf = (k) => SYNTH.layer[k] || SYNTH.sampler[k] || (k === 'decim' ? SYNTH.decim : k === 'crush' ? SYNTH.crush : null);
const LAYER_DEF = { decim: 1, crush: 0 };
const GROUPS = [
  ['Oscillator', ['freq', 'detune', 'unison', 'spread', 'sub', 'pitchAmt', 'pitchTime']],
  ['Amp', ['a', 'd', 's', 'r', 'hold', 'level', 'drive', 'delay']],
  ['Filter', ['cutoff', 'q', 'fEnv', 'fTime']],
  ['Decimate', ['decim', 'crush']],
  ['LFO', ['lfoRate', 'lfoDepth']],
];
// Layer LFO ask-button UX (Jens t600u): after moving a targetable slider, a floating "LFO?" appears
// beside the table (no layout shift). Accept → assign l.lfo + put Rate/Depth under that slider.
// Simple layer LFO targets only pitch/cutoff/amp (one per layer). Nesting LFO→LFO is the advanced
// mods system (shared/lfo.mjs), not this per-layer oscillator.
export const SLIDER_TO_LFO = { freq: 'pitch', note: 'pitch', cutoff: 'cutoff', level: 'amp' };
export function lfoSliderFor(l, target) {
  if (target === 'pitch') return l.kind === 'sampler' ? 'note' : 'freq';
  if (target === 'cutoff') return 'cutoff';
  if (target === 'amp') return 'level';
  return null;
}
const FX_UNITS = [['reverb', 'Reverb'], ['delay', 'Delay'], ['filter', 'Filter'], ['crush', 'Bitcrush'], ['dist', 'Distortion']];
const TAB_NAMES = { slap: 'Slap', peel: 'Peel', step: 'Steps', duff: 'Landing', fx: 'Effects' }; // Landing = peel landing thud (duff); fx kept for city code paths, not listed in SOUND_TABS

// musicVol: { get, set, def } – master volume (was Music vol header; now in Master section).
// radioBlock: () => Master section (the one Volume). radio: Radio instance (my Tempo on Steps).
export function initSoundUI({ $, sound, toast, onSave, onOpenChange = () => {}, onLive = () => {}, musicVol = null, radioBlock = null, radio = null }) {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const st = { open: false, tab: 'slap', patches: {}, fx: null, rolls: 0, sel: null }; // sel: the Steps-sequencer step being locked (t889u), null = editing the base sound
  const base = (k) => variant(DEFAULT_PATCHES[k], mySeed(), k); // my default (what free me sounds like)

  function open() {
    const cur = loadSoundLook();
    st.patches = {}; for (const k of SOUNDS) st.patches[k] = cleanPatch(cur.patches?.[k]) || base(k);
    if (!st.patches.step.seq) st.patches.step.seq = defaultStepSeq(); // one sequencer for the whole Steps sound (t889u)
    st.sel = null;
    st.custom = new Set(Object.keys(cur.patches || {}));
    st.fx = cleanFx(cur.fx) || cleanFx(FX_DEFAULTS);
    st.vol0 = musicVol ? musicVol.get() : null; st.volReset = false;
    st.run = { ...loadRunMode() };
    st.open = true; $('sound-panel').hidden = false; render(); onOpenChange(true);
  }
  // Closed without saving (✕ / Cancel): a Volume that only Reset changed goes back too, and so does
  // a Tempo that was only tried out (the saved one from my run mode).
  function close(saved = false) {
    if (!saved && st.volReset && musicVol && st.vol0 != null) { musicVol.set(st.vol0); st.volReset = false; }
    if (!saved && radio) radio.setWalkBpm(loadRunMode().walkBpm);
    if (st.liveT) { clearTimeout(st.liveT); st.liveT = 0; }
    if (!saved) onLive(null); // Cancel / ✕: back to my saved sound
    closeAsk(); closePop(); st.sel = null;
    st.open = false; $('sound-panel').hidden = true; onOpenChange(false);
  }

  // lfo: { patch, to, sound } – when the control is released after a change, offer advanced "Add LFO?" (lfoPop)
  // layerAsk: { patch, layer, sound, param } – also offer the simple layer "LFO?" ask-button (t600u)
  function slider(k, range, value, onInput, lfo = null, layerAsk = null) {
    const row = el('div', 'snd-sl'); row.dataset.param = k;
    const lab = el('span', null, LABELS[k] || k);
    const r = el('input'); r.type = 'range'; r.min = 0; r.max = STEPS; r.step = 1; r.value = toSlider(k, range, value);
    r.setAttribute('aria-label', LABELS[k] || k);
    const out = el('output', null, fmt(k, value));
    // pitch grid: the osc Pitch moves in semitones (shared/synth.mjs snapFreq); LFO rates ≥ 20 Hz too
    const snap = k === 'freq' ? snapFreq : k === 'rate' ? snapRate : (v) => v;
    r.oninput = () => {
      let v = snap(fromSlider(k, range, Number(r.value)));
      // Pitch (and audio-rate LFO rate): snap the thumb too, so a click always lands on a note and
      // tiny drags that stay inside one semitone don't look dead (Jens t587u: "pitch does nothing").
      if (k === 'freq' || k === 'rate') {
        const snapped = toSlider(k, range, v);
        if (Number(r.value) !== snapped) r.value = snapped;
      }
      out.textContent = fmt(k, v); onInput(v);
    };
    if (lfo || layerAsk) {
      if (lfo) {
        row.dataset.mod = lfo.to;
        if ((lfo.patch.mods || []).some((m) => m.to === lfo.to)) row.classList.add('has-lfo');
      }
      let before = r.value;
      const grab = () => { before = r.value; };
      r.addEventListener('pointerdown', grab); r.addEventListener('touchstart', grab, { passive: true }); r.addEventListener('focus', grab);
      // 'change' fires on release (mouse up, touch end on iPhone, keys)
      r.addEventListener('change', () => {
        if (r.value === before) return;
        before = r.value;
        // Layer "LFO?" covers pitch/cutoff/amp without reflowing the table. Skip the advanced
        // insert-pop on the same gesture (that one still appears for q/detune/decim/… and nesting).
        if (layerAsk) { layerLfoAsk(row, layerAsk); return; }
        if (lfo) lfoPop(row, lfo);
      });
    }
    row.append(lab, r, out); return row;
  }
  // ---------- Layer "LFO?" ask (Jens t600u) – floating beside the table, no layout shift ----------
  let ask = null, askOutside = null;
  function closeAsk() {
    if (askOutside) { document.removeEventListener('pointerdown', askOutside, true); askOutside = null; }
    if (ask) { ask.remove(); ask = null; }
  }
  function layerLfoAsk(row, { patch, layer: li, sound: k, param }) {
    const target = SLIDER_TO_LFO[param];
    if (!target || !LFO_TARGETS.includes(target)) return;
    const l = patch.layers[li]; if (!l) return;
    // Already on this target: nothing to ask (Rate/Depth already sit under the slider).
    if (l.lfo === target) return;
    closeAsk(); closePop();
    const panel = $('sound-panel'); if (!panel) return;
    ask = el('button', 'lfo-ask', 'LFO?'); ask.type = 'button'; ask.id = 'lfo-ask';
    ask.setAttribute('aria-label', `Add LFO to ${LABELS[param] || param}`);
    ask.dataset.target = target; ask.dataset.layer = String(li); ask.dataset.param = param;
    // Pin beside the sound table (panel), vertically near the slider (clamped to the visible panel).
    const pr = panel.getBoundingClientRect(), rr = row.getBoundingClientRect();
    const mid = rr.top + rr.height / 2 - 28;
    const top = Math.max(Math.max(8, pr.top), Math.min(Math.min(window.innerHeight, pr.bottom) - 64, mid));
    ask.style.position = 'fixed';
    ask.style.left = `${Math.min(window.innerWidth - 120, Math.max(8, pr.right + 8))}px`;
    ask.style.top = `${top}px`;
    ask.style.zIndex = '20';
    ask.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      l.lfo = target;
      if (!(l.lfoDepth > 0)) l.lfoDepth = 0.35;
      closeAsk();
      edited(k, true);
      toast(`LFO → ${target}`, 1400);
    };
    // Anything else (tap/click outside the button) = no.
    askOutside = (e) => { if (ask && !ask.contains(e.target)) closeAsk(); };
    // Defer so the releasing pointer that opened the ask does not instantly dismiss it.
    setTimeout(() => { if (askOutside) document.addEventListener('pointerdown', askOutside, true); }, 0);
    document.body.appendChild(ask);
  }
  // ---------- Advanced "Add LFO?" / follower (Jens, 5 Nov 2026) – separate nested-mods system ----------
  let pop = null, popTimer = null;
  function closePop() { clearTimeout(popTimer); if (pop) { pop.remove(); pop = null; } }
  function lfoPop(row, { patch, to, sound: k }) {
    closePop();
    if (!canAddMod(cleanPatch(patch) || patch, to)) return;
    const t = parseTarget(to);
    const what = t.type === 'mod' ? `LFO ${t.id.slice(1)} ${LABELS[t.param]}` : t.type === 'patch' ? 'Volume' : LABELS[t.param] || t.param;
    pop = el('div', 'lfo-pop'); pop.id = 'lfo-pop'; pop.setAttribute('role', 'dialog'); pop.dataset.to = to;
    const q = el('span', null, `Add LFO to ${what}?`);
    const yes = el('button', 'primary', '〰 Add LFO'); yes.type = 'button'; yes.id = 'lfo-pop-yes';
    const no = el('button', null, 'No'); no.type = 'button';
    const fol = el('button', null, '📈 Follower'); fol.type = 'button'; fol.id = 'lfo-pop-follow'; fol.title = 'Add an envelope follower (it follows how loud a sound is)';
    yes.onclick = () => { const m = newMod(cleanPatch(patch) || patch, to); if (m) { (patch.mods ||= []).push(m); edited(k, true); toast(`LFO added to ${what}`, 1600); } closePop(); };
    fol.onclick = () => { const m = newFollower(cleanPatch(patch) || patch, to, 'master'); if (m) { (patch.mods ||= []).push(m); edited(k, true); toast(`Follower added to ${what}`, 1600); } closePop(); };
    no.onclick = closePop;
    q.textContent = `Add LFO or follower to ${what}?`;
    pop.append(q, yes, fol, no);
    row.after(pop);
    popTimer = setTimeout(closePop, 5000); // non-intrusive: gone after 5 s
  }
  function select(name, list, value, onChange, labels = {}) {
    const s = el('select'); s.setAttribute('aria-label', name); s.dataset.name = name;
    for (const v of list) { const o = el('option', null, labels[v] || v); o.value = v; if (v === value) o.selected = true; s.appendChild(o); }
    s.onchange = () => onChange(s.value); return s;
  }
  function fxBlock(fx, onChange) {
    const box = el('div', 'snd-fx');
    for (const [unit, title] of FX_UNITS) {
      const sec = el('fieldset', 'snd-unit'); sec.dataset.unit = unit; sec.appendChild(el('legend', null, title));
      if (unit === 'delay') {
        const row = el('div', 'snd-sel');
        row.append(select('Sync', SYNCS, fx.delay.sync, (v) => { fx.delay.sync = v; onChange(); }, { free: 'Free' }));
        const pp = el('label', 'check'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = fx.delay.pingPong; cb.onchange = () => { fx.delay.pingPong = cb.checked; onChange(); };
        pp.append(cb, document.createTextNode(' Ping-pong')); row.appendChild(pp); sec.appendChild(row);
      }
      if (unit === 'filter') { const row = el('div', 'snd-sel'); row.append(select('Type', FILTERS, fx.filter.type, (v) => { fx.filter.type = v; onChange(); })); sec.appendChild(row); }
      for (const [k, range] of Object.entries(SYNTH.fx[unit])) sec.appendChild(slider(k, range, fx[unit][k], (v) => { fx[unit][k] = v; onChange(); }));
      box.appendChild(sec);
    }
    return box;
  }
  function layerBlock(p, i, k) {
    const l = p.layers[i];
    if (l.kind === 'sampler') return samplerBlock(p, i, k);
    const box = el('fieldset', 'snd-layer'); box.dataset.layer = i;
    const head = el('legend', null, `Layer ${i + 1}`); box.appendChild(head);
    const sel = el('div', 'snd-sel');
    sel.append(select('Source', ['osc', 'noise', 'mic'], l.kind, (v) => { l.kind = v; if (v === 'mic') { Object.assign(l, MIC_LAYER, { level: Math.min(l.level, MIC_LAYER.level) }); micOn(); } edited(k, true); }, { osc: 'Oscillator', noise: 'Noise', mic: '🎙 Live mic' }));
    if (l.kind === 'mic') { /* no wave/noise colour */ } else if (l.kind === 'osc') sel.append(select('Wave', WAVES, l.wave, (v) => { l.wave = v; edited(k); }, { sawtooth: 'saw' }));
    else sel.append(select('Noise', NOISES, l.noise, (v) => { l.noise = v; edited(k); }));
    sel.append(select('Filter', FILTERS, l.filter, (v) => { l.filter = v; edited(k); }));
    if (p.layers.length > 1) sel.appendChild(removeLayerBtn(p, i, k));
    box.appendChild(sel);
    if (l.kind === 'mic') box.appendChild(micBlock());
    box.appendChild(seqBlock(p, i, k));
    const under = lfoSliderFor(l, l.lfo); // which slider gets Rate/Depth under it (t600u)
    let lfoPlaced = false;
    for (const [title, keys] of GROUPS) {
      if (title === 'LFO') continue; // Rate/Depth sit under the target slider, not in their own group
      const g = el('div', 'snd-group'); g.appendChild(el('small', null, title));
      for (const key of keys) {
        if ((l.kind === 'noise' || l.kind === 'mic') && ['freq', 'detune', 'unison', 'spread', 'sub', 'pitchAmt', 'pitchTime'].includes(key)) continue;
        const row = layerSlider(p, i, k, key);
        if (under && key === under) row.classList.add('has-lfo');
        g.appendChild(row);
        if (under && key === under) { appendLayerLfoRows(g, p, i, k); lfoPlaced = true; }
      }
      if (g.childElementCount > 1) box.appendChild(g);
    }
    // Fallback when the target slider is hidden on this kind (e.g. pitch LFO on a noise layer).
    if (l.lfo !== 'none' && !lfoPlaced) {
      const g = el('div', 'snd-group'); g.appendChild(el('small', null, 'LFO'));
      appendLayerLfoRows(g, p, i, k); box.appendChild(g);
    }
    return box;
  }
  // Rate + Depth + wave + off, inserted directly under the slider the layer LFO is assigned to.
  function appendLayerLfoRows(g, p, i, k) {
    const l = p.layers[i];
    const wrap = el('div', 'snd-lfo-under'); wrap.dataset.lfoUnder = l.lfo;
    const head = el('div', 'snd-lfo-under-head');
    head.appendChild(el('small', null, `〰 LFO → ${l.lfo}`));
    head.appendChild(select('LFO wave', WAVES, l.lfoWave, (v) => { l.lfoWave = v; edited(k); }, { sawtooth: 'saw' }));
    const off = el('button', 'snd-lfo-off', '✕'); off.type = 'button'; off.id = `lfo-off-${i}`;
    off.title = 'Turn LFO off'; off.setAttribute('aria-label', 'Turn LFO off');
    off.onclick = () => { l.lfo = 'none'; edited(k, true); };
    head.appendChild(off);
    wrap.appendChild(head);
    for (const key of ['lfoRate', 'lfoDepth']) wrap.appendChild(layerSlider(p, i, k, key));
    g.appendChild(wrap);
  }
  // ---------- The mic layer (Jens, 5 Nov 2026) ----------
  // The page's one mic (mic.js). It is asked for only here: when a mic layer is made or switched on.
  async function micOn() {
    const ok = await sound.useMic();
    if (!ok) toast('No microphone – permission denied or no mic. The mic layer stays silent.', 3500);
    render(); return ok;
  }
  function micBlock() {
    const b = el('div', 'mic-box');
    const live = !!(sound.engine && sound.engine.micSource && sound.engine.micSource());
    b.appendChild(el('p', 'mic-state', live ? '🎙 Mic is on – each note (or sequencer step) opens the gate on your live voice.' : '🎙 Mic is off'));
    if (!live) { const on = el('button', 'primary mic-on', '🎙 Turn the mic on'); on.type = 'button'; on.id = 'mic-on'; on.onclick = () => micOn(); b.appendChild(on); }
    b.appendChild(el('p', 'mic-warn', '🎧 Use headphones! The mic layer plays your voice through your speakers – without headphones it can howl (feedback).'));
    b.appendChild(el('p', 'hint', 'Only you hear your mic layer (your sound settings are yours). Others hear your voice through voice chat 🎙.'));
    return b;
  }
  function removeLayerBtn(p, i, k) {
    const rm = el('button', 'snd-rm', '✕'); rm.type = 'button'; rm.title = 'Remove layer';
    rm.onclick = () => { p.layers.splice(i, 1); if (p.mods) { p.mods = removeLayerMods(p.mods, i); if (!p.mods.length) delete p.mods; } if (p.seq) removeLayerLocks(p.seq, i); edited(k, true); };
    return rm;
  }
  function layerSlider(p, i, k, key, after = null) {
    const l = p.layers[i];
    if (k === 'step' && p.seq) return lockSlider(p, k, key, rangeOf(key), lockKey(i, key), () => l[key] ?? LAYER_DEF[key], (v) => { l[key] = v; if (after) after(v); });
    const ask = SLIDER_TO_LFO[key] ? { patch: p, layer: i, sound: k, param: key } : null;
    // lfoRate/lfoDepth: no simple ask (one layer LFO cannot modulate itself). Advanced mods still
    // offer nesting when those rows appear in the mods block (rate/depth there use mod targets).
    return slider(key, rangeOf(key), l[key] ?? LAYER_DEF[key], (v) => { l[key] = v; edited(k); if (after) after(v); },
      { patch: p, to: `L${i}.${key}`, sound: k }, ask);
  }
  // ---------- Sequencer (any layer; the old auto-slap's step sequencer, shared/autoslap.mjs schema) ----------
  // The layer then RUNS on my own Tempo while the radio is on (radio.js), instead of on the trigger.
  function seqBlock(p, i, k) {
    const l = p.layers[i];
    if (k === 'step') return el('span', 'snd-seq-none'); // Steps: one sequencer for the whole sound (stepSeqBlock, t889u)
    const box = el('div', 'snd-seq'); box.dataset.seq = l.seq ? 'on' : 'off';
    const tog = el('button', 'snd-seq-tog', l.seq ? '▦ Sequencer: on' : '▦ Run as sequencer'); tog.type = 'button'; tog.setAttribute('aria-pressed', String(!!l.seq));
    tog.onclick = () => { if (l.seq) delete l.seq; else l.seq = { len: 4, bars: 1, steps: Array.from({ length: 4 }, () => ({ on: true, vol: 100 })) }; edited(k, true); };
    box.appendChild(tog);
    if (!l.seq) return box;
    const row = el('div', 'snd-sel');
    const lens = Array.from({ length: SYNTH.seqMax }, (_, n) => String(n + 1));
    row.append(el('span', 'snd-seq-lab', 'Steps'), select('Steps', lens, String(l.seq.len), (v) => { const n = Number(v); const old = l.seq.steps; l.seq.len = n; l.seq.steps = Array.from({ length: n }, (_, j) => old[j] || { on: false, vol: 100 }); edited(k, true); }));
    const quick = el('span', 'snd-seq-quick');
    for (const n of SYNTH.seqLens) { const b = el('button', n === l.seq.len ? 'sel' : null, String(n)); b.type = 'button'; b.onclick = () => { const old = l.seq.steps; l.seq.len = n; l.seq.steps = Array.from({ length: n }, (_, j) => old[j] || { on: true, vol: 100 }); edited(k, true); }; quick.appendChild(b); }
    row.append(quick);
    row.append(el('span', 'snd-seq-lab', 'Loop'), select('Bars', SYNTH.seqBars.map(String), String(l.seq.bars), (v) => { l.seq.bars = Number(v); edited(k); }, Object.fromEntries(SYNTH.seqBars.map((b) => [String(b), `${b} bar${b === 1 ? '' : 's'}`]))));
    box.appendChild(row);
    const grid = el('div', 'snd-seq-grid'); grid.style.gridTemplateColumns = `repeat(${Math.min(8, l.seq.len)}, 1fr)`;
    l.seq.steps.forEach((stp, j) => {
      const c = el('button', 'snd-step' + (stp.on ? ' on' : ''), String(j + 1)); c.type = 'button'; c.setAttribute('aria-pressed', String(stp.on)); c.dataset.step = j;
      c.onclick = () => { stp.on = !stp.on; edited(k, true); };
      grid.appendChild(c);
    });
    box.appendChild(grid);
    box.appendChild(el('p', 'hint', 'Runs on your Tempo (Steps) while Master is on. Give layers different step counts (3, 4, 5, 7 …) for a polyrhythm.'));
    return box;
  }
  // ---------- The Steps sequencer (Jens t889u): ONE sequencer for the whole Steps sound + parameter locks ----------
  // A slider on the Steps tab: editing the base sound, or – while a step is selected (st.sel) – that step's lock.
  // Locked sliders are marked (orange, 🔒 step N); with no step selected a slider that some steps lock shows them.
  function lockSlider(p, k, key, range, lk, getBase, setBase) {
    const sel = st.sel != null && p.seq.steps[st.sel] ? st.sel : null;
    const locked = sel != null ? getLock(p.seq, sel, lk) : undefined;
    const ask = sel == null && SLIDER_TO_LFO[key] && lk !== 'G.gain' ? { patch: p, layer: +lk.slice(1, lk.indexOf('.')), sound: k, param: key } : null;
    const row = slider(key, range, locked !== undefined ? locked : getBase(), (v) => {
      if (sel != null) { if (setLock(p.seq, sel, lk, v)) markLock(row, p, lk); else toast(`At most ${SYNTH.maxLocksPerStep} locks on one step`, 1800); }
      else setBase(v);
      edited(k);
    }, sel == null ? { patch: p, to: lk, sound: k } : null, ask);
    row.dataset.lock = lk;
    markLock(row, p, lk);
    return row;
  }
  function markLock(row, p, lk) {
    const steps = stepsLocking(p.seq, lk), sel = st.sel;
    const here = sel != null && steps.includes(sel);
    row.classList.toggle('locked', here);
    row.classList.toggle('has-locks', !here && steps.length > 0);
    row.dataset.lockSteps = steps.map((j) => j + 1).join(',');
    let b = row.querySelector('.lock-badge');
    if (!steps.length && !here) { if (b) b.remove(); return; }
    if (!b) {
      b = el('button', 'lock-badge'); b.type = 'button';
      b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); if (st.sel == null || !stepsLocking(p.seq, lk).includes(st.sel)) return; clearLock(p.seq, st.sel, lk); edited('step', true); };
      row.appendChild(b);
    }
    b.textContent = here ? `🔒 step ${sel + 1} ✕` : `🔒 ${steps.map((j) => j + 1).join(', ')}`;
    b.title = here ? `Locked on step ${sel + 1} – click to clear this lock` : `Locked on step${steps.length > 1 ? 's' : ''} ${steps.map((j) => j + 1).join(', ')}`;
    b.disabled = !here;
  }
  const loopLabel = (v) => `${v === 0.25 ? '¼' : v === 0.5 ? '½' : v} footstep${v === 1 || v < 1 ? '' : 's'}`;
  function selectStep(j) { st.sel = st.sel === j ? null : j; render(); }
  function stepSeqBlock(p, k) {
    const q = p.seq;
    const box = el('fieldset', 'snd-stepseq'); box.id = 'snd-stepseq';
    box.dataset.sel = st.sel == null ? '' : String(st.sel);
    box.appendChild(el('legend', null, '▦ Sequencer – the whole Steps sound'));
    box.appendChild(el('p', 'hint', 'One sequencer plays every layer. Walk, run, sneak and dance run it at their own tempo; step 1 is the footstep. Click a number to turn a step on or off. Press ✎ (or hold the number) to pick a step – then every slider you move is locked to that step only.'));
    const row = el('div', 'snd-sel');
    const lens = Array.from({ length: SYNTH.seqMax }, (_, n) => String(n + 1));
    row.append(el('span', 'snd-seq-lab', 'Steps'), select('Steps', lens, String(q.len), (v) => { resizeSeq(q, Number(v)); if (st.sel != null && st.sel >= q.len) st.sel = null; edited(k, true); }));
    const quick = el('span', 'snd-seq-quick');
    for (const n of SYNTH.seqLens) { const b = el('button', n === q.len ? 'sel' : null, String(n)); b.type = 'button'; b.onclick = () => { resizeSeq(q, n); if (st.sel != null && st.sel >= q.len) st.sel = null; edited(k, true); }; quick.appendChild(b); }
    row.append(quick);
    row.append(el('span', 'snd-seq-lab', 'Loop'), select('Loop', SYNTH.stepLoops.map(String), String(q.loop), (v) => { q.loop = Number(v); edited(k, true); }, Object.fromEntries(SYNTH.stepLoops.map((b) => [String(b), loopLabel(b)]))));
    box.appendChild(row);
    const grid = el('div', 'ss-grid'); grid.style.gridTemplateColumns = `repeat(${Math.min(8, q.len)}, 1fr)`;
    q.steps.forEach((stp, j) => {
      const cell = el('div', 'ss-cell' + (stp.on ? ' on' : '') + (st.sel === j ? ' sel' : '') + (stp.locks ? ' has-locks' : '')); cell.dataset.step = j;
      const pad = el('button', 'ss-pad', String(j + 1)); pad.type = 'button'; pad.dataset.step = j; pad.setAttribute('aria-pressed', String(stp.on));
      pad.setAttribute('aria-label', `Step ${j + 1} ${stp.on ? 'on' : 'off'}`);
      let lp = 0, long = false;
      pad.addEventListener('pointerdown', () => { long = false; clearTimeout(lp); lp = setTimeout(() => { long = true; selectStep(j); }, 450); });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) pad.addEventListener(ev, () => clearTimeout(lp));
      pad.addEventListener('contextmenu', (e) => e.preventDefault());
      pad.onclick = () => { if (long) { long = false; return; } stp.on = !stp.on; edited(k, true); };
      const pick = el('button', 'ss-pick', st.sel === j ? '✓ editing' : '✎ lock'); pick.type = 'button'; pick.dataset.step = j;
      pick.setAttribute('aria-pressed', String(st.sel === j)); pick.setAttribute('aria-label', st.sel === j ? `Stop editing step ${j + 1}` : `Edit locks of step ${j + 1}`);
      pick.onclick = () => selectStep(j);
      cell.append(pad, pick);
      const n = lockCount(q, j);
      if (n) { const lb = el('span', 'ss-locks', `🔒 ${n}`); lb.title = `${n} lock${n === 1 ? '' : 's'} on step ${j + 1}`; cell.appendChild(lb); }
      grid.appendChild(cell);
    });
    box.appendChild(grid);
    const bar = el('div', 'ss-bar');
    if (st.sel != null) {
      const ed = el('div', 'ss-editing'); ed.id = 'ss-editing';
      ed.textContent = `✎ Editing step ${st.sel + 1}${q.steps[st.sel].on ? '' : ' (off – turn it on to hear it)'} – the sliders below now lock to this step`;
      bar.appendChild(ed);
      const pv = el('button', 'snd-add', `▶ Hear step ${st.sel + 1}`); pv.type = 'button'; pv.id = 'ss-hear'; pv.onclick = () => sound.preview(cleanPatch(lockedPatch(cleanPatch(p) || p, st.sel)) || p, p.fx ? null : st.fx);
      const cl = el('button', 'snd-add ss-clear', `✕ Clear step ${st.sel + 1} locks`); cl.type = 'button'; cl.id = 'ss-clear-step'; cl.disabled = !lockCount(q, st.sel);
      cl.onclick = () => { clearLocks(q, st.sel); edited(k, true); };
      const done = el('button', 'primary ss-done', '✓ Done – edit the base sound'); done.type = 'button'; done.id = 'ss-done'; done.onclick = () => { st.sel = null; render(); };
      bar.append(pv, cl, done);
    }
    const all = el('button', 'snd-add ss-clear', '✕ Clear all locks'); all.type = 'button'; all.id = 'ss-clear-all'; all.disabled = !lockCount(q);
    all.onclick = () => { clearLocks(q, null); edited(k, true); };
    bar.appendChild(all);
    box.appendChild(bar);
    return box;
  }
  // ---------- The sampler layer ----------
  function samplerBlock(p, i, k) {
    const l = p.layers[i];
    const box = el('fieldset', 'snd-layer snd-sampler'); box.dataset.layer = i; box.dataset.kind = 'sampler';
    box.appendChild(el('legend', null, `Layer ${i + 1} · 🎵 Sampler`));
    const sel = el('div', 'snd-sel');
    sel.append(select('Filter', FILTERS, l.filter, (v) => { l.filter = v; edited(k); }));
    if (p.layers.length > 1) sel.appendChild(removeLayerBtn(p, i, k));
    box.appendChild(sel);
    box.appendChild(seqBlock(p, i, k));
    // file: drag-and-drop (desktop) or the picker (iPhone: Files, Voice Memos via Files, iCloud …)
    const drop = el('div', 'smp-drop'); drop.dataset.drop = 'sampler';
    const file = el('input'); file.type = 'file'; file.accept = 'audio/*,.wav,.mp3,.m4a,.aac,.ogg,.oga,.opus,.flac,.aif,.aiff,.caf'; file.hidden = true; file.className = 'smp-file';
    const pick = el('button', 'smp-pick', '📂 Choose audio file'); pick.type = 'button'; pick.onclick = () => file.click();
    const info = el('div', 'smp-info', l.sample ? `${l.name || 'sample'} · ${l.len.toFixed(2)} s` : 'No sample yet – drop an audio file here, or choose one');
    if (l.sample && !SAMPLE_BUFFERS.has(l.sample)) info.textContent += ' (not on this device)';
    const load = async (f) => {
      if (!f) return;
      info.textContent = 'Loading …';
      try {
        const ctx = sound.ensure();
        const r = await loadSampleFile(f, ctx);
        Object.assign(l, { sample: r.hash, name: r.name, len: r.len, start: 0, end: 1, loopStart: 0, loopEnd: 1 });
        edited(k, true);
        toast(r.truncated ? `Loaded – cut to the first ${SYNTH.maxSampleSeconds} s` : `Loaded ${r.name}`, 2200);
        preview();
      } catch (e) { info.textContent = e.message || 'Could not load that file'; toast(e.message || 'Could not load that file', 2600); }
    };
    file.onchange = () => { load(file.files && file.files[0]); file.value = ''; };
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    drop.addEventListener('dragenter', (e) => { stop(e); drop.classList.add('over'); });
    drop.addEventListener('dragover', (e) => { stop(e); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; drop.classList.add('over'); });
    drop.addEventListener('dragleave', (e) => { stop(e); drop.classList.remove('over'); });
    drop.addEventListener('drop', (e) => { stop(e); drop.classList.remove('over'); load(e.dataTransfer?.files?.[0]); });
    drop.append(el('div', 'smp-drop-text', '⬇ Drop an audio file here'), pick, file, info);
    box.appendChild(drop);
    // waveform with the start/end (green/red) and loop (yellow) points
    const cv = el('canvas', 'smp-wave'); cv.width = 960; cv.height = 200;
    const draw = () => drawWave(cv, l);
    box.appendChild(cv); draw();
    if (l.sample && !SAMPLE_BUFFERS.has(l.sample)) ensureSamples({ p }, sound.ensure()).then(() => { draw(); if (SAMPLE_BUFFERS.has(l.sample)) info.textContent = `${l.name || 'sample'} · ${l.len.toFixed(2)} s`; });
    // switches
    const sw = el('div', 'smp-switches');
    for (const [key, label] of [['whole', 'One-shot (whole sample)'], ['loop', 'Loop'], ['reverse', 'Reverse']]) {
      const lab = el('label', 'check smp-check'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!l[key]; cb.dataset.key = key;
      cb.onchange = () => { l[key] = cb.checked; edited(k, true); };
      lab.append(cb, document.createTextNode(' ' + label)); sw.appendChild(lab);
    }
    box.appendChild(sw);
    if (l.loop && l.whole) box.appendChild(el('p', 'hint', 'Looping: the envelope (Hold + Release) decides how long it plays.'));
    const under = lfoSliderFor(l, l.lfo);
    let lfoPlaced = false;
    for (const [title, keys] of SAMPLER_GROUPS) {
      if (title === 'LFO') continue; // Rate/Depth sit under the target slider
      const g = el('div', 'snd-group'); g.appendChild(el('small', null, title));
      for (const key of keys) {
        if (!l.loop && ['loopStart', 'loopEnd', 'xfade'].includes(key)) continue;
        if (l.whole && !l.loop && ['d', 's', 'hold'].includes(key)) continue;
        const row = layerSlider(p, i, k, key, ['start', 'end', 'loopStart', 'loopEnd'].includes(key) ? draw : null);
        if (under && key === under) row.classList.add('has-lfo');
        g.appendChild(row);
        if (under && key === under) { appendLayerLfoRows(g, p, i, k); lfoPlaced = true; }
      }
      if (g.childElementCount > 1) box.appendChild(g);
    }
    if (l.lfo !== 'none' && !lfoPlaced) {
      const g = el('div', 'snd-group'); g.appendChild(el('small', null, 'LFO'));
      appendLayerLfoRows(g, p, i, k); box.appendChild(g);
    }
    return box;
  }
  // ---------- LFOs (shared/lfo.mjs) ----------
  function modsBlock(p, k) {
    const mods = p.mods || [];
    const box = el('section', 'snd-mods'); box.id = 'snd-mods';
    box.appendChild(el('h3', null, `〰 LFOs + 📈 followers (${mods.length}/${MOD.max})`));
    const addF = el('button', 'snd-add snd-add-follow', '+ Follower'); addF.type = 'button'; addF.id = 'snd-add-follow';
    addF.onclick = () => { const c = cleanPatch(p) || p; const to = allTargets(c).find((t) => canAddMod(c, t)); const m = to && newFollower(c, to, 'master'); if (m) { (p.mods ||= []).push(m); edited(k, true); } else toast('No free control for a follower', 1600); };
    if (!mods.length) { box.appendChild(el('p', 'hint', 'Change a control and let go: it offers “Add LFO?” (or a follower). An LFO can also move another LFO’s rate or depth. A follower moves a control with how LOUD something is (the mic, a layer, all my sound, the city bus).')); box.appendChild(addF); return box; }
    const { depth } = modOrder(mods);
    const name = (to) => { const t = parseTarget(to); if (!t) return to; const mm = t.type === 'mod' && mods.find((x) => x.id === t.id); return t.type === 'mod' ? `${mm && mm.wave === 'follow' ? 'Follower' : 'LFO'} ${t.id.slice(1)} · ${LABELS[t.param]}` : t.type === 'patch' ? 'Volume' : `Layer ${t.layer + 1} · ${LABELS[t.param] || t.param}`; };
    for (const m of mods) {
      const fw = m.wave === 'follow';
      const f = el('fieldset', 'snd-mod' + (fw ? ' snd-follow' : '')); f.dataset.mod = m.id; f.style.marginLeft = `${(depth[m.id] - 1) * 14}px`;
      f.appendChild(el('legend', null, `${depth[m.id] > 1 ? '↳ ' : ''}${fw ? '📈 Follower' : 'LFO'} ${m.id.slice(1)} → ${name(m.to)}`));
      const row = el('div', 'snd-sel');
      if (fw) {
        const srcs = ['master', 'bus', 'mic', ...p.layers.map((_, i) => 'L' + i)];
        row.append(select('Follows', srcs, m.src, async (v) => { m.src = v; if (v === 'mic') { const ok = await sound.useMic(); if (!ok) toast('No microphone (permission denied?) – the follower stays still', 3000); } edited(k, true); },
          { master: 'Follows: all my sound', bus: 'Follows: city bus', mic: 'Follows: 🎙 mic', ...Object.fromEntries(p.layers.map((_, i) => ['L' + i, `Follows: layer ${i + 1}`])) }));
        const c = cleanPatch(p) || p, tg = allTargets(c).filter((t) => t === m.to || (!mods.some((x) => x.to === t) && !(parseTarget(t).type === 'mod' && parseTarget(t).id === m.id)));
        row.append(select('Target', tg, m.to, (v) => { const old = m.to; m.to = v; const cl = cleanPatch(p); if (!cl || !(cl.mods || []).some((x) => x.id === m.id)) { m.to = old; toast('That would loop or nest too deep', 2200); } edited(k, true); }, Object.fromEntries(tg.map((t) => [t, '→ ' + name(t)]))));
        const inv = el('label', 'check'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!m.invert; cb.onchange = () => { m.invert = cb.checked; edited(k); }; inv.append(cb, document.createTextNode(' Invert')); row.append(inv);
      } else row.append(select('Shape', WAVES, m.wave, (v) => { m.wave = v; edited(k); }, { sawtooth: 'saw' }));
      const rm = el('button', 'snd-rm', '✕'); rm.type = 'button'; rm.title = fw ? 'Remove follower' : 'Remove LFO';
      rm.onclick = () => { p.mods = removeMod(p.mods, m.id); if (!p.mods.length) delete p.mods; edited(k, true); };
      row.appendChild(rm); f.appendChild(row);
      if (fw) {
        const meter = el('div', 'flw-meter'); meter.dataset.mod = m.id; meter.appendChild(el('div', 'flw-bar')); meter.setAttribute('role', 'meter'); meter.setAttribute('aria-label', 'Envelope');
        f.appendChild(meter);
        if (selfLoop(m)) f.appendChild(el('p', 'hint', '↻ It follows what it moves – allowed, smoothed (release at least 50 ms).'));
        f.appendChild(slider('attack', MOD.attack, m.attack, (v) => { m.attack = v; edited(k); }));
        f.appendChild(slider('release', MOD.release, m.release, (v) => { m.release = v; edited(k); }));
        f.appendChild(slider('gain', MOD.gain, m.gain, (v) => { m.gain = v; edited(k); }));
        f.appendChild(slider('thr', MOD.thr, m.thr, (v) => { m.thr = v; edited(k); }));
        f.appendChild(slider('depth', MOD.depth, m.depth, (v) => { m.depth = v; edited(k); }, { patch: p, to: `${m.id}.depth`, sound: k }));
      } else {
        f.appendChild(slider('rate', MOD.rate, m.rate, (v) => { m.rate = v; edited(k); }, { patch: p, to: `${m.id}.rate`, sound: k }));
        f.appendChild(slider('depth', MOD.depth, m.depth, (v) => { m.depth = v; edited(k); }, { patch: p, to: `${m.id}.depth`, sound: k }));
        f.appendChild(slider('phase', MOD.phase, m.phase, (v) => { m.phase = v; edited(k); }));
      }
      box.appendChild(f);
    }
    box.appendChild(addF);
    meterLoop();
    return box;
  }
  // every target a mod can drive in this patch
  function allTargets(c) {
    const out = [];
    c.layers.forEach((l, i) => { for (const prm of Object.keys(LAYER_TARGETS[l.kind] || {})) out.push(`L${i}.${prm}`); });
    for (const prm of Object.keys(PATCH_TARGETS)) out.push(`G.${prm}`);
    for (const m of c.mods || []) for (const prm of Object.keys(MOD_TARGETS)) if (m.wave !== 'follow' || prm === 'depth') out.push(`${m.id}.${prm}`);
    return out.filter((t) => targetSpec(t, c.layers));
  }
  // the followers' meters: the envelope the worklet reports (synth.js engine.follow), falling back to 0
  let meterRaf = 0;
  function meterLoop() {
    if (meterRaf) return;
    const tick = () => {
      const ms = document.querySelectorAll('.flw-meter'); if (!ms.length) { meterRaf = 0; return; }
      const e = sound.engine, fresh = e && e.followAt && performance.now() - e.followAt < 300;
      for (const mt of ms) { const v = fresh ? Math.min(1, e.follow[mt.dataset.mod] || 0) : 0; mt.firstChild.style.width = `${Math.round(v * 100)}%`; mt.dataset.v = v.toFixed(3); }
      meterRaf = requestAnimationFrame(tick);
    };
    meterRaf = requestAnimationFrame(tick);
  }
  function edited(k, rerender = false) { if (k !== 'fx') st.custom.add(k); if (rerender) render(); }

  function render() {
    closeAsk(); closePop();
    const body = $('snd-body'); body.innerHTML = '';
    const rb = $('snd-radio'); if (rb) { rb.innerHTML = ''; if (radioBlock) rb.appendChild(radioBlock()); }
    const tabs = $('snd-tabs'); tabs.innerHTML = '';
    // Slap / Peel / Steps / Landing (duff). Effects stay in state (city drives fx); tab button not shown.
    // Effects render branch below stays for programmatic/city use.
    if (st.tab !== 'fx' && !SOUND_TABS.includes(st.tab)) st.tab = 'slap';
    for (const t of SOUND_TABS) {
      const b = el('button', null, TAB_NAMES[t]); b.type = 'button'; b.dataset.tab = t; b.setAttribute('aria-pressed', String(st.tab === t));
      if (st.tab === t) b.classList.add('sel'); b.onclick = () => { st.tab = t; render(); }; tabs.appendChild(b);
    }
    if (st.tab === 'fx') {
      body.appendChild(el('p', 'hint', 'Effects on all your sounds (everyone hears them).'));
      body.appendChild(fxBlock(st.fx, () => {}));
      return;
    }
    const k = st.tab, p = st.patches[k];
    const changed = diffPatch(base(k), p).length;
    body.appendChild(el('p', 'snd-diff', changed ? `${changed} setting${changed === 1 ? '' : 's'} changed from the original – the Blend slider morphs between them (and past them: Further)` : 'The original sound (nothing changed yet)'));
    if (k === 'step' && p.seq) body.appendChild(lockSlider(p, k, 'level', SYNTH.gain, 'G.gain', () => p.gain, (v) => { p.gain = v; }));
    else body.appendChild(slider('level', SYNTH.gain, p.gain, (v) => { p.gain = v; edited(k); }, { patch: p, to: 'G.gain', sound: k }));
    body.lastChild.querySelector('span').textContent = 'Volume';
    if (k === 'step') body.appendChild(runBlock());
    if (k === 'step') { if (!p.seq) p.seq = defaultStepSeq(); body.appendChild(stepSeqBlock(p, k)); }
    if (k !== 'step' && st.sel != null) st.sel = null;
    $('sound-panel').toggleAttribute('data-stepsel', k === 'step' && st.sel != null);
    p.layers.forEach((_, i) => body.appendChild(layerBlock(p, i, k)));
    if (p.layers.length < SYNTH.maxLayers) {
      const adds = el('div', 'snd-adds');
      const add = el('button', 'snd-add', '+ Layer'); add.type = 'button';
      add.onclick = () => { p.layers.push(cleanPatch({ layers: [{ kind: 'osc', wave: 'sine', freq: 220, d: 0.12, level: 0.2 }] }).layers[0]); edited(k, true); };
      // a new layer TYPE (not a source inside a layer): plays a loaded audio file
      const addS = el('button', 'snd-add snd-add-sampler', '+ Sampler layer'); addS.type = 'button'; addS.id = 'snd-add-sampler';
      addS.onclick = () => { p.layers.push(cleanPatch({ layers: [{ kind: 'sampler', a: 0.003, d: 0.2, s: 1, r: 0.08, level: 0.7 }] }).layers[0]); edited(k, true); };
      // start a layer as a sequencer: a running, continuous sound on my own Tempo
      const addQ = el('button', 'snd-add snd-add-seq', '+ Sequencer layer'); addQ.type = 'button'; addQ.id = 'snd-add-seq';
      addQ.onclick = () => { p.layers.push(cleanPatch({ layers: [{ kind: 'osc', wave: 'triangle', freq: 220, d: 0.15, level: 0.25, seq: { len: 5, bars: 1, steps: Array.from({ length: 5 }, () => ({ on: true, vol: 100 })) } }] }).layers[0]); edited(k, true); };
      const addM = el('button', 'snd-add snd-add-mic', '+ Mic layer'); addM.type = 'button'; addM.id = 'snd-add-mic';
      addM.onclick = () => { p.layers.push(cleanPatch({ layers: [{ kind: 'mic', ...MIC_LAYER }] }).layers[0]); edited(k, true); micOn(); };
      adds.append(add, addS, ...(k === 'step' ? [] : [addQ]), addM); body.appendChild(adds); // Steps: the whole sound is sequenced (t889u)
    }
    body.appendChild(modsBlock(p, k));
    const own = el('label', 'check snd-own'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!p.fx;
    cb.onchange = () => { if (cb.checked) p.fx = cleanFx(st.fx); else delete p.fx; edited(k, true); };
    own.append(cb, document.createTextNode(' Own effects for this sound')); body.appendChild(own);
    if (p.fx) body.appendChild(fxBlock(p.fx, () => edited(k)));
  }

  // ---------- Tempo + Run (Steps tab; Tempo was Master tempo, then Walk tempo; run = shared/runmode.mjs) ----------
  function runBlock() {
    const r = st.run;
    const box = el('fieldset', 'snd-run'); box.id = 'snd-run';
    box.appendChild(el('legend', null, S.stepsModeTitle || 'Walk & run'));
    box.appendChild(el('p', 'hint', S.stepsModeHint || 'Tempo is yours (30–2880 BPM, on the 120 BPM grid): everything musical of yours follows it. Hold Shift to run – then run tempo and pitch apply.'));
    const row = (id, label, title, min, max, step, value, show, onInput) => {
      const d = el('div', 'snd-sl'); d.dataset.param = id; d.title = title;
      const inp = el('input'); inp.type = 'range'; inp.id = id; inp.min = min; inp.max = max; inp.step = step; inp.value = value; inp.setAttribute('aria-label', label);
      const out = el('output', null, show()); out.id = id + '-val';
      inp.oninput = () => { onInput(Number(inp.value)); out.textContent = show(); };
      d.append(el('span', null, label), inp, out); return d;
    };
    // Tempo (Jens, 11 Nov 2026; t846u: the global clock is gone): MY tempo, per player (st.run.walkBpm →
    // shared/runmode.mjs), log slider 30…3000 BPM, default 90. Heard live while dragging (radio.setWalkBpm);
    // Save keeps it, Cancel undoes it. EVERYTHING musical of mine follows it – footsteps, all sequencers,
    // four voices, synced delay, voice echo, dance – and the others hear / see me at it. (Was "Walk tempo",
    // when only the walk-sound sequencer followed it.) The id stays 'walk-tempo'.
    // t881u (12 Nov 2026): the 120-BPM grid instead of 5 BPM steps – one notch per grid tempo (shared/tempogrid.mjs
    // TEMPOS: 120 × octaves, triplets and polyrhythm ratios, 30 … 2880), labelled "180 BPM · 3:2" (the ratio to 120)
    // plus where it meets 120 on the shared clock. Arrow keys = one notch, Page Up/Down = TEMPO_PAGE notches,
    // Home/End = the ends. Big and clear (Jens): its own row class 'tempo-grid'.
    r.walkBpm = snapWalkBpm(r.walkBpm);
    const knobOf = (b) => String(Math.round(walkBpmToKnob(b) * WALK_KNOB_STEPS));
    const meetText = (b) => { const m = meetBars(b); return snapWalkBpm(b) === 120 ? (S.tempoMeetSame || 'The base tempo: everyone else lines up with you') : S.tempoMeet ? S.tempoMeet(m) : `Meets 120 BPM on the bar line every ${m === 1 ? 'bar' : m + ' bars'}`; };
    const walkRow = row('walk-tempo', S.walkTempo || 'Tempo', S.walkTempoTitle || 'Your own tempo on the 120 BPM grid (default 90 · 3:4)',
      0, WALK_KNOB_STEPS, 1, knobOf(r.walkBpm),
      () => walkBpmLabel(r.walkBpm),
      (v) => { r.walkBpm = knobToWalkBpm(v / WALK_KNOB_STEPS); if (radio) radio.setWalkBpm(r.walkBpm); if (wIn) wIn.value = knobOf(r.walkBpm); if (meet) meet.textContent = meetText(r.walkBpm); });
    walkRow.classList.add('tempo-grid');
    const wIn = walkRow.querySelector('input');
    wIn.dataset.min = String(TEMPO_BPMS[0]); wIn.dataset.max = String(TEMPO_BPMS[TEMPO_BPMS.length - 1]); wIn.dataset.grid = String(TEMPO_BPMS.length);
    wIn.setAttribute('aria-valuetext', walkBpmLabel(r.walkBpm));
    wIn.addEventListener('input', () => wIn.setAttribute('aria-valuetext', walkBpmLabel(r.walkBpm)));
    wIn.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: TEMPO_PAGE, PageDown: -TEMPO_PAGE }[e.key];
      const to = e.key === 'Home' ? TEMPO_BPMS[0] : e.key === 'End' ? TEMPO_BPMS[TEMPO_BPMS.length - 1] : d ? stepWalkBpm(r.walkBpm, d) : null;
      if (to == null) return;
      e.preventDefault(); e.stopPropagation();
      wIn.value = knobOf(to); wIn.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const meet = el('div', 'tempo-meet', meetText(r.walkBpm)); meet.id = 'walk-tempo-meet';
    walkRow.appendChild(meet);
    box.appendChild(walkRow);
    box.appendChild(row('run-tempo', S.runTempo, S.runTempoTitle, RUN.tempoMin, RUN.tempoMax, RUN.tempoStep, r.tempo, () => tempoLabel(r), (v) => { r.tempo = cleanTempo(v); }));
    box.appendChild(row('run-pitch', S.runPitch || 'Pitch correction', S.runPitchTitle, pitchMin, pitchMax, 1, r.pitch, () => pitchLabel(r.pitch), (v) => { r.pitch = cleanPitch(v); }));
    // Sneak (Jens, 11 Nov 2026): hold Ctrl = crouch – its own tempo (−400 … +400 %) and pitch correction.
    box.appendChild(row('crouch-tempo', S.crouchTempo || 'Crouch tempo', S.crouchTempoTitle, RUN.tempoMin, RUN.tempoMax, RUN.tempoStep, cleanCrouchTempo(r.crouchTempo), () => crouchTempoLabel(r), (v) => { r.crouchTempo = cleanCrouchTempo(v); }));
    box.appendChild(row('crouch-pitch', S.crouchPitch || 'Crouch pitch correction', S.crouchPitchTitle, pitchMin, pitchMax, 1, cleanCrouchPitch(r.crouchPitch), () => pitchLabel(cleanCrouchPitch(r.crouchPitch)), (v) => { r.crouchPitch = cleanCrouchPitch(v); }));
    // Lock-to-clock stays dormant (always off); Preview kept as a non-slider helper.
    const pv = el('button', 'snd-add', S.runPreview); pv.type = 'button'; pv.id = 'run-preview'; pv.title = S.runPreviewTitle; pv.onclick = () => previewRun();
    const pc = el('button', 'snd-add', S.crouchPreview || '▶ Walk → crouch'); pc.type = 'button'; pc.id = 'crouch-preview'; pc.title = S.crouchPreviewTitle || 'Hear one bar of walking, then one bar of sneaking (Ctrl)'; pc.onclick = () => previewRun('crouch');
    const sel = el('div', 'snd-sel'); sel.append(pv, pc); box.appendChild(sel);
    return box;
  }
  // One bar of walking (4 steps), then one bar of running (or sneaking), with the step patch being edited –
  // at the Tempo being edited (bar = 2 beats of it, like the footsteps at Groove 1×).
  function previewRun(gait = 'run') {
    const ctx = sound.ensure(); const eng = sound.engine; if (!ctx || !eng) { sound.ready?.then(() => previewRun(gait)); return; }
    const p = cleanPatch(st.patches.step); if (!p) return;
    const fx = p.fx ? cleanFx(p.fx) : cleanFx(st.fx);
    const bar = 120 / cleanWalkBpm(st.run.walkBpm), walkPulse = bar / 4, crouch = gait === 'crouch', rr = crouch ? crouchRate(st.run) : runRate(st.run), tune = pitchRatio(crouch ? cleanCrouchPitch(st.run.crouchPitch) : st.run.pitch);
    const t0 = ctx.currentTime + 0.08;
    // the Steps sequencer (t889u): len steps per `loop` footsteps, each step with its locks
    const q = p.seq || defaultStepSeq(), per = q.len / q.loop;
    const run = (start, pulse, tn) => {
      const sp = pulse / per;
      for (let m = 0, played = 0; m * sp < bar - 1e-6 && played < 48; m++) {
        const i = m % q.len, stp = q.steps[i]; if (!stp || !stp.on || !(stp.vol > 0)) continue;
        played++; const foot = Math.floor(m / per + 1e-9);
        eng.play(retuneP(lockedPatch(p, i), (foot % 2 ? 0.97 : 1.02) * tn), { gain: stp.vol / 100, fx, time: start + m * sp, pool: 'step', lfoId: 'me' });
      }
    };
    run(t0, walkPulse, 1);
    run(t0 + bar, walkPulse / rr.rate, tune);
  }
  function preview() {
    const k = st.tab === 'fx' ? 'slap' : st.tab;
    let p = cleanPatch(st.patches[k]);
    if (k === 'step' && st.sel != null && p) p = cleanPatch(lockedPatch(p, st.sel)) || p; // the selected step, with its locks (t889u)
    return sound.preview(p, p.fx ? null : st.fx);
  }
  function randomize(wild) {
    st.rolls++; st.sel = null;
    const seed = `${mySeed()}:${Date.now()}:${st.rolls}`;
    if (st.tab === 'fx') st.fx = randomFx(seed, { wild });
    else { st.patches[st.tab] = randomPatch(seed + st.tab, { wild }); st.custom.add(st.tab); }
    render(); preview();
  }
  // Reset = everything back to the defaults (Jens, 2 Nov 2026): every SOUNDS patch, Effects data,
  // Volume, and run mode incl. my Tempo (90).
  function reset() {
    st.sel = null;
    for (const k of SOUNDS) st.patches[k] = base(k);
    st.custom = new Set();
    st.fx = cleanFx(FX_DEFAULTS);
    if (musicVol) { musicVol.set(musicVol.def); st.volReset = true; }
    st.run = { ...RUN_DEFAULTS };
    if (radio) radio.setWalkBpm(st.run.walkBpm);
    render(); preview();
    toast(S.soundReset || 'All sounds, effects and Volume back to default – Save to keep it', 2600);
  }
  function save() {
    const patches = {}; for (const k of st.custom) patches[k] = st.patches[k];
    const fx = JSON.stringify(cleanFx(st.fx)) === JSON.stringify(cleanFx(FX_DEFAULTS)) ? undefined : st.fx;
    const clean = saveSoundLook({ patches, fx });
    if (Object.keys(patches).length && !clean.patches) { toast(S.soundTooBig || 'Too much sound data – remove a layer or two.', 3000); return; }
    const run = saveRunMode(st.run); if (radio) radio.setWalkBpm(run.walkBpm);
    onLive(null); onSave(clean); st.volReset = false; close(true); toast(S.soundSaved || 'Sound settings saved', 1800);
  }

  // Live (Jens t869u, 12 Nov 2026): every change in the panel – osc pitch, waveform, envelope, filter, layers,
  // sequencer, effects, Random / Reset – is heard at once on what is already playing (my footsteps, the walk
  // sequencer, the dance's step loop), without Save and without restarting the dance. main.js puts the draft in
  // as my sound for now (together.setLiveSound); Save keeps it, Cancel / ✕ goes back. Coalesced: one update per
  // burst of input events (a slider drag = ~1 per frame).
  function liveDraft() {
    const patches = {}; for (const k of st.custom) patches[k] = st.patches[k];
    return { patches, fx: st.fx };
  }
  function liveSoon() {
    if (!st.open || st.liveT) return;
    st.liveT = setTimeout(() => { st.liveT = 0; if (st.open) { st.liveN = (st.liveN || 0) + 1; onLive(liveDraft()); } }, 0);
  }
  for (const ev of ['input', 'change', 'click']) $('sound-panel').addEventListener(ev, liveSoon, true);
  $('snd-close').onclick = () => close(); $('snd-cancel').onclick = () => close();
  $('snd-preview').onclick = preview; $('snd-random').onclick = () => randomize(false); $('snd-wild').onclick = () => randomize(true);
  $('snd-reset').onclick = reset; $('snd-save').onclick = save;
  // runDraft: the run/walk/crouch settings being edited while the panel is open (main.js hears them live).
  return { open, close, isOpen: () => st.open, state: () => st, runDraft: () => (st.open && st.run ? st.run : null), liveCount: () => st.liveN || 0, preview, render };
}

// The sample's waveform (min/max per pixel column) with start/end and loop markers.
function drawWave(cv, l) {
  const g = cv.getContext('2d'); if (!g) return;
  const W = cv.width, H = cv.height; g.fillStyle = '#101010'; g.fillRect(0, 0, W, H);
  const buf = l.sample && SAMPLE_BUFFERS.get(l.sample);
  if (!buf) { g.fillStyle = '#777'; g.font = '28px system-ui'; g.textAlign = 'center'; g.fillText('No sample', W / 2, H / 2 + 10); return; }
  const d = buf.getChannelData(0), per = Math.max(1, Math.floor(d.length / W));
  g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(l.start * W, 0, (l.end - l.start) * W, H);
  g.strokeStyle = '#7fd1ff'; g.lineWidth = 2; g.beginPath();
  for (let x = 0; x < W; x++) {
    const i0 = l.reverse ? d.length - (x + 1) * per : x * per; let lo = 1, hi = -1;
    for (let i = Math.max(0, i0); i < Math.min(d.length, i0 + per); i++) { const v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    g.moveTo(x + 0.5, H / 2 - hi * H * 0.46); g.lineTo(x + 0.5, H / 2 - lo * H * 0.46);
  }
  g.stroke();
  const mark = (p, c, w = 5) => { g.fillStyle = c; g.fillRect(Math.round(p * W) - w / 2, 0, w, H); };
  mark(l.start, '#3ddc84'); mark(l.end, '#ff5a5a');
  if (l.loop) { mark(l.loopStart, '#ffd23f', 4); mark(l.loopEnd, '#ffd23f', 4); }
}

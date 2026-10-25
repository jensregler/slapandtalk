// Sound settings (full version, entitlements.full.soundDesign): one synth panel per sound
// (slap, peel, nope, steps, duff) and an effects panel, with preview, reset and randomize.
// Saved in this browser (localStorage 'klibb.sound') and sent with my look, so everyone in
// the room plays my sounds the same way. Free players never see this; they get their own
// variation of the default sounds from 'klibb.soundSeed'.
import { SOUNDS, SYNTH, WAVES, NOISES, FILTERS, LFO_TARGETS, SYNCS, DEFAULT_PATCHES, FX_DEFAULTS,
  cleanPatch, cleanFx, cleanSound, variant, randomPatch, randomFx } from '../../shared/synth.mjs';
import { S } from './strings.js';

const SEED_KEY = 'klibb.soundSeed', SOUND_KEY = 'klibb.sound';
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* full/private */ } };

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
  let saved = {}; try { saved = JSON.parse(read(SOUND_KEY) || '{}') || {}; } catch { saved = {}; }
  return cleanSound({ seed: mySeed(), patches: saved.patches, fx: saved.fx }, { custom: true }) || { seed: mySeed() };
}
export function saveSoundLook({ patches, fx }) {
  const clean = cleanSound({ seed: mySeed(), patches, fx }, { custom: true }) || {};
  if (!clean.patches && !clean.fx) write(SOUND_KEY, null);
  else write(SOUND_KEY, JSON.stringify({ patches: clean.patches, fx: clean.fx }));
  return clean;
}

// ---------- Slider mapping (log for frequencies and times) ----------
const LOG = new Set(['freq', 'cutoff', 'lfoRate', 'a', 'd', 'r', 'hold', 'pitchTime', 'fTime', 'time', 'decay', 'preDelay', 'delay']);
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
  if (['freq', 'cutoff'].includes(k)) return v >= 1000 ? `${(v / 1000).toFixed(2)} kHz` : `${Math.round(v)} Hz`;
  if (k === 'lfoRate') return `${v.toFixed(1)} Hz`;
  if (['a', 'd', 'r', 'hold', 'pitchTime', 'fTime', 'time', 'preDelay', 'delay'].includes(k)) return v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`;
  if (k === 'decay') return `${v.toFixed(1)} s`;
  if (k === 'detune' || k === 'spread') return `${Math.round(v)} ct`;
  if (k === 'pitchAmt') return `${v > 0 ? '+' : ''}${v.toFixed(1)} st`;
  if (k === 'fEnv') return `${v > 0 ? '+' : ''}${v.toFixed(2)} oct`;
  if (k === 'unison' || k === 'bits') return String(Math.round(v));
  if (k === 'q') return v.toFixed(1);
  return `${Math.round(v * 100)}%`;
};
const LABELS = {
  freq: 'Pitch', detune: 'Detune', unison: 'Unison', spread: 'Spread', sub: 'Sub', pitchAmt: 'Sweep', pitchTime: 'Sweep time',
  a: 'Attack', d: 'Decay', s: 'Sustain', r: 'Release', hold: 'Hold', level: 'Level', drive: 'Drive', delay: 'Start',
  cutoff: 'Cutoff', q: 'Resonance', fEnv: 'Filter env', fTime: 'Env time', lfoRate: 'LFO rate', lfoDepth: 'LFO depth',
  decay: 'Decay', preDelay: 'Pre-delay', wet: 'Wet', time: 'Time', feedback: 'Feedback', bits: 'Bits', amount: 'Amount',
};
const GROUPS = [
  ['Oscillator', ['freq', 'detune', 'unison', 'spread', 'sub', 'pitchAmt', 'pitchTime']],
  ['Amp', ['a', 'd', 's', 'r', 'hold', 'level', 'drive', 'delay']],
  ['Filter', ['cutoff', 'q', 'fEnv', 'fTime']],
  ['LFO', ['lfoRate', 'lfoDepth']],
];
const FX_UNITS = [['reverb', 'Reverb'], ['delay', 'Delay'], ['filter', 'Filter'], ['crush', 'Bitcrush'], ['dist', 'Distortion']];
const TAB_NAMES = { slap: 'Slap', peel: 'Peel', nope: 'Nope', step: 'Steps', duff: 'Duff', fx: 'Effects' };

export function initSoundUI({ $, sound, toast, onSave, onOpenChange = () => {} }) {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const st = { open: false, tab: 'slap', patches: {}, fx: null, rolls: 0 };
  const base = (k) => variant(DEFAULT_PATCHES[k], mySeed(), k); // my default (what free me sounds like)

  function open() {
    const cur = loadSoundLook();
    st.patches = {}; for (const k of SOUNDS) st.patches[k] = cleanPatch(cur.patches?.[k]) || base(k);
    st.custom = new Set(Object.keys(cur.patches || {}));
    st.fx = cleanFx(cur.fx) || cleanFx(FX_DEFAULTS);
    st.open = true; $('sound-panel').hidden = false; render(); onOpenChange(true);
  }
  function close() { st.open = false; $('sound-panel').hidden = true; onOpenChange(false); }

  function slider(k, range, value, onInput) {
    const row = el('div', 'snd-sl'); row.dataset.param = k;
    const lab = el('span', null, LABELS[k] || k);
    const r = el('input'); r.type = 'range'; r.min = 0; r.max = STEPS; r.step = 1; r.value = toSlider(k, range, value);
    r.setAttribute('aria-label', LABELS[k] || k);
    const out = el('output', null, fmt(k, value));
    r.oninput = () => { const v = fromSlider(k, range, Number(r.value)); out.textContent = fmt(k, v); onInput(v); };
    row.append(lab, r, out); return row;
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
    const box = el('fieldset', 'snd-layer'); box.dataset.layer = i;
    const head = el('legend', null, `Layer ${i + 1}`); box.appendChild(head);
    const sel = el('div', 'snd-sel');
    sel.append(select('Source', ['osc', 'noise'], l.kind, (v) => { l.kind = v; edited(k, true); }, { osc: 'Oscillator', noise: 'Noise' }));
    if (l.kind === 'osc') sel.append(select('Wave', WAVES, l.wave, (v) => { l.wave = v; edited(k); }, { sawtooth: 'saw' }));
    else sel.append(select('Noise', NOISES, l.noise, (v) => { l.noise = v; edited(k); }));
    sel.append(select('Filter', FILTERS, l.filter, (v) => { l.filter = v; edited(k); }));
    sel.append(select('LFO', LFO_TARGETS, l.lfo, (v) => { l.lfo = v; edited(k, true); }, { none: 'LFO off', pitch: 'LFO → pitch', cutoff: 'LFO → cutoff', amp: 'LFO → amp' }));
    if (l.lfo !== 'none') sel.append(select('LFO wave', WAVES, l.lfoWave, (v) => { l.lfoWave = v; edited(k); }, { sawtooth: 'saw' }));
    if (p.layers.length > 1) { const rm = el('button', 'snd-rm', '✕'); rm.type = 'button'; rm.title = 'Remove layer'; rm.onclick = () => { p.layers.splice(i, 1); edited(k, true); }; sel.appendChild(rm); }
    box.appendChild(sel);
    for (const [title, keys] of GROUPS) {
      if (title === 'LFO' && l.lfo === 'none') continue;
      const g = el('div', 'snd-group'); g.appendChild(el('small', null, title));
      for (const key of keys) {
        if (l.kind === 'noise' && ['freq', 'detune', 'unison', 'spread', 'sub', 'pitchAmt', 'pitchTime'].includes(key)) continue;
        g.appendChild(slider(key, SYNTH.layer[key], l[key], (v) => { l[key] = v; edited(k); }));
      }
      if (g.childElementCount > 1) box.appendChild(g);
    }
    return box;
  }
  function edited(k, rerender = false) { if (k !== 'fx') st.custom.add(k); if (rerender) render(); }

  function render() {
    const body = $('snd-body'); body.innerHTML = '';
    const tabs = $('snd-tabs'); tabs.innerHTML = '';
    for (const t of [...SOUNDS, 'fx']) {
      const b = el('button', null, TAB_NAMES[t]); b.type = 'button'; b.dataset.tab = t; b.setAttribute('aria-pressed', String(st.tab === t));
      if (st.tab === t) b.classList.add('sel'); b.onclick = () => { st.tab = t; render(); }; tabs.appendChild(b);
    }
    if (st.tab === 'fx') {
      body.appendChild(el('p', 'hint', 'Effects on all your sounds (everyone hears them).'));
      body.appendChild(fxBlock(st.fx, () => {}));
      return;
    }
    const k = st.tab, p = st.patches[k];
    body.appendChild(slider('level', SYNTH.gain, p.gain, (v) => { p.gain = v; edited(k); }));
    body.lastChild.querySelector('span').textContent = 'Volume';
    p.layers.forEach((_, i) => body.appendChild(layerBlock(p, i, k)));
    if (p.layers.length < SYNTH.maxLayers) {
      const add = el('button', 'snd-add', '+ Layer'); add.type = 'button';
      add.onclick = () => { p.layers.push(cleanPatch({ layers: [{ kind: 'osc', wave: 'sine', freq: 220, d: 0.12, level: 0.2 }] }).layers[0]); edited(k, true); };
      body.appendChild(add);
    }
    const own = el('label', 'check snd-own'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!p.fx;
    cb.onchange = () => { if (cb.checked) p.fx = cleanFx(st.fx); else delete p.fx; edited(k, true); };
    own.append(cb, document.createTextNode(' Own effects for this sound')); body.appendChild(own);
    if (p.fx) body.appendChild(fxBlock(p.fx, () => edited(k)));
  }

  function preview() {
    const k = st.tab === 'fx' ? 'slap' : st.tab;
    const p = cleanPatch(st.patches[k]);
    return sound.preview(p, p.fx ? null : st.fx);
  }
  function randomize(wild) {
    st.rolls++;
    const seed = `${mySeed()}:${Date.now()}:${st.rolls}`;
    if (st.tab === 'fx') st.fx = randomFx(seed, { wild });
    else { st.patches[st.tab] = randomPatch(seed + st.tab, { wild }); st.custom.add(st.tab); }
    render(); preview();
  }
  function reset() {
    if (st.tab === 'fx') st.fx = cleanFx(FX_DEFAULTS);
    else { st.patches[st.tab] = base(st.tab); st.custom.delete(st.tab); }
    render();
  }
  function save() {
    const patches = {}; for (const k of st.custom) patches[k] = st.patches[k];
    const fx = JSON.stringify(cleanFx(st.fx)) === JSON.stringify(cleanFx(FX_DEFAULTS)) ? undefined : st.fx;
    const clean = saveSoundLook({ patches, fx });
    if (Object.keys(patches).length && !clean.patches) { toast(S.soundTooBig || 'Too much sound data – remove a layer or two.', 3000); return; }
    onSave(clean); close(); toast(S.soundSaved || 'Sound settings saved', 1800);
  }

  $('snd-close').onclick = close; $('snd-cancel').onclick = close;
  $('snd-preview').onclick = preview; $('snd-random').onclick = () => randomize(false); $('snd-wild').onclick = () => randomize(true);
  $('snd-reset').onclick = reset; $('snd-save').onclick = save;
  return { open, close, isOpen: () => st.open, state: () => st, preview };
}

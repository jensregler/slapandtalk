// "Färg" in the room look panel (Jens, 29 Oct 2026, point 11): the user's own image as the room's
// surface – floor, walls AND ceiling – with the avatar fabric's fun controls: scale, rotation, hue,
// cycle hue, spin, scroll, the colour under transparent parts, and 🌀 Randomize. It is stored in the
// room look (style.fabric, roomstyle.js cleanRoomFabric), so everyone in the room, recordings and
// presets made from the room see it. Images go through POST /api/fabrics (the avatar fabrics' path:
// resized in the browser, content-hash id). Full version (entitlements.full.fabrics; open while
// OPEN_ACCESS is on): the free version doesn't get the row at all (calm, no upsell), like the
// avatar's Colour | Fabric switch.
import { S } from './strings.js';
import { FABRIC, cleanFabric, fabricPhase, fabricUrl, PRESETS, presetCanvas } from './fabrics.js';
import { randomFabricParams } from '../../shared/fabric.mjs';
import { readMine } from './designs.js';
import { has } from './entitlements.js';
import { idForPreset, idForSticker, idForFile, readRecent, addRecent } from './fabricui.js';
import { cleanRoomFabric } from './roomstyle.js';

const SLIDERS = [['scale', () => S.fabScale, null], ['rot', () => S.fabRotation, null], ['hue', () => S.fabHue, null],
  ['hueHz', () => S.fabCycleHue, 'cycleHue'], ['spinHz', () => S.fabSpin, 'spin'], ['scroll', () => S.fabScroll, null]];
const fmt = (k, v) => { const p = FABRIC.params[k]; return p.unit === '×' ? `${v.toFixed(2)}×` : p.unit === '°' ? `${Math.round(v)}°` : p.unit === 'Hz' ? `${v.toFixed(2)} Hz` : `${v.toFixed(2)}/s`; };
export const FARG_BASES = ['#ffffff', '#f1eee7', '#e8dcc2', '#9ba1a6', '#4b78b3', '#5e8d69', '#e6a3b4', '#b4413a', '#ffd400', '#2a2a2c'];

export function initFargUI({ $, getStyle, setFabric, toast }) {
  let last = null, busy = 0; // last = the most recent Färg (so None → back keeps its values)
  const box = $('farg-box'), row = $('sp-farg-row'), file = $('farg-file');
  const cur = () => getStyle()?.fabric || null;
  async function use(getId) {
    busy++; toast(S.fabUploading, 1200);
    try {
      const id = await getId();
      addRecent([id]);
      const keep = cur() || last || {};
      setFabric(cleanRoomFabric({ base: '#ffffff', ...keep, id }), true);
    } catch (e) { toast(S.fabFailed(e.message || 'error'), 3500); }
    finally { busy--; }
  }
  file.onchange = () => { const f = file.files && file.files[0]; file.value = ''; if (f) use(() => idForFile(f)); };
  const btn = (cls, text, title, onClick) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; if (text) b.textContent = text; if (title) { b.title = title; b.setAttribute('aria-label', title); } b.onclick = onClick; return b; };
  const pick = (title, bg, sel, onClick) => { const b = btn('farg-pick' + (sel ? ' sel' : ''), '', title, onClick); b.style.backgroundImage = `url("${bg}")`; return b; };
  const thumbs = {};

  function render() {
    const full = has('fabrics');
    row.hidden = !full;
    box.innerHTML = '';
    if (!full) return;
    const f = cur();
    if (f) last = f;
    const src = document.createElement('div'); src.className = 'farg-src';
    const none = btn('farg-none' + (f ? '' : ' sel'), S.fargNone, S.fargNoneTitle, () => { if (cur()) { last = cur(); setFabric(null, true); } });
    const up = btn('fab-up farg-up', S.fabUpload, S.fargUploadTitle, () => file.click());
    src.append(none, up);
    const picks = document.createElement('div'); picks.className = 'fab-picks farg-picks';
    for (const st of readMine().slice().reverse().slice(0, 8)) picks.appendChild(pick(S.fabMine, st.url, false, () => use(() => idForSticker(st))));
    for (const id of readRecent().slice(0, 8)) picks.appendChild(pick(S.fabRecent, fabricUrl(id), f && f.id === id, () => use(async () => id)));
    for (const [k, p] of Object.entries(PRESETS)) picks.appendChild(pick(S.fabPreset(p.name), (thumbs[k] ||= presetCanvas(k, 64).toDataURL()), false, () => use(() => idForPreset(k))));
    const hint = document.createElement('small'); hint.className = 'farg-hint'; hint.textContent = f ? S.fargOnHint : S.fargHint;
    box.append(hint, src, picks);
    if (!f) return;
    const ctl = document.createElement('div'); ctl.className = 'fab-ctl farg-ctl';
    const pv = document.createElement('div'); pv.className = 'fab-preview farg-preview'; pv.setAttribute('role', 'img'); pv.setAttribute('aria-label', S.fabPreview);
    const tile = document.createElement('div'); tile.className = 'fab-tile'; pv.appendChild(tile); ctl.appendChild(pv);
    for (const [k, label, flag] of SLIDERS) {
      const p = FABRIC.params[k], r0 = document.createElement('div'); r0.className = 'fab-sl'; r0.dataset.param = k;
      let lab;
      if (flag) {
        lab = document.createElement('label'); lab.className = 'check';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.dataset.flag = flag; cb.checked = !!f[flag];
        cb.onchange = () => { edit({ [flag]: cb.checked }); r0.classList.toggle('off', !cb.checked); };
        lab.append(cb, document.createTextNode(' ' + label()));
        if (!f[flag]) r0.classList.add('off');
      } else { lab = document.createElement('span'); lab.textContent = label(); }
      const r = document.createElement('input'); r.type = 'range'; r.min = p.min; r.max = p.max; r.step = p.step; r.value = f[k];
      r.setAttribute('aria-label', flag ? `${label()} ${S.fabSpeed}` : label());
      const out = document.createElement('output'); out.textContent = fmt(k, f[k]);
      r.oninput = () => { const v = Number(r.value); out.textContent = fmt(k, v); edit({ [k]: v }); };
      r0.append(lab, r, out); ctl.appendChild(r0);
    }
    const base = document.createElement('div'); base.className = 'farg-base';
    const bl = document.createElement('small'); bl.textContent = S.fabBaseHint; base.appendChild(bl);
    const sw = document.createElement('div'); sw.className = 'swatches colors';
    for (const hex of FARG_BASES) { const b = btn(hex === f.base ? 'sel' : '', '', hex, () => setFabric({ ...cur(), base: hex }, true)); b.style.background = hex; b.dataset.id = hex; sw.appendChild(b); }
    const any = document.createElement('input'); any.type = 'color'; any.id = 'farg-base-any'; any.value = f.base; any.title = S.faceCustom;
    any.oninput = () => setFabric({ ...cur(), base: any.value }, false);
    any.onchange = () => setFabric({ ...cur(), base: any.value }, true);
    sw.appendChild(any); base.appendChild(sw); ctl.appendChild(base);
    const wild = btn('farg-wild', S.fargRandomize, S.fargRandomizeTitle, () => {
      const c = cur(); if (!c) return;
      setFabric({ ...randomFabricParams(c.id), base: Math.random() < 0.5 ? c.base : FARG_BASES[Math.floor(Math.random() * FARG_BASES.length)] }, true);
    });
    ctl.appendChild(wild);
    box.appendChild(ctl);
    tick();
  }
  function edit(patch) { const c = cur(); if (!c) return; setFabric(cleanRoomFabric({ ...c, ...patch }), false); }
  function tick(now = Date.now()) {
    const f = cur(), pv = box.querySelector('.farg-preview'); if (!f || !pv) return;
    const tile = pv.firstChild, ph = fabricPhase(f, now), px = 30 * f.scale;
    pv.style.backgroundColor = f.base;
    const url = `url("${fabricUrl(f.id)}")`; if (tile.dataset.url !== url) { tile.style.backgroundImage = url; tile.dataset.url = url; }
    tile.style.backgroundSize = `${px}px ${px}px`; tile.style.backgroundPosition = `center ${ph.offset * px}px`;
    tile.style.transform = `rotate(${-ph.rot}deg)`; tile.style.filter = ph.hue ? `hue-rotate(${ph.hue}deg)` : '';
  }
  return { render, tick, busy: () => busy > 0 };
}
export { cleanFabric };

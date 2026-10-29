// "Min gubbe": the Colour | Fabric switch on every colour slot, the fabric picker and sliders,
// and 🌀 Randomize. together.js owns the draft look; this file only edits draft.fabric.
import { S } from './strings.js';
import { FABRIC, cleanFabric, fabricPhase, fabricUrl, prepareFabricImage, prepareFacePhoto, uploadFabric, PRESETS, presetCanvas, presetBlob } from './fabrics.js';
import { randomFabricParams } from '../../shared/fabric.mjs';
import { readMine, getBlob } from './designs.js';
import { has } from './entitlements.js';

export const SLOTS = { shirt: 'shirt', pants: 'pants', hair: 'hairColor', skin: 'skin', hat: 'hatColor', face: 'face' }; // plats -> färgfältet i looken
const SLOT_LABEL = { shirt: () => S.shirt, pants: () => S.pants, hair: () => S.hairColor, skin: () => S.skin, hat: () => S.capColour, face: () => S.face };
const RECENT_KEY = 'klibb.fabrics', PRESET_KEY = 'klibb.fabricPresets', FROM_STICKER_KEY = 'klibb.fabricFromSticker';
const ID_RE = /^[a-f0-9]{16}$/;
const readJson = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v && typeof v === 'object' ? v : def; } catch { return def; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* fullt/privat läge */ } };
export const readRecent = () => { const v = readJson(RECENT_KEY, []); return Array.isArray(v) ? v.filter((id) => ID_RE.test(id)) : []; };
export function addRecent(ids) { const list = [...ids.filter((id) => ID_RE.test(id)), ...readRecent()]; writeJson(RECENT_KEY, [...new Set(list)].slice(0, 12)); }

// Slider rows: [param, label, flag (toggle) or null]
const SLIDERS = [['scale', () => S.fabScale, null], ['rot', () => S.fabRotation, null], ['hue', () => S.fabHue, null],
  ['hueHz', () => S.fabCycleHue, 'cycleHue'], ['spinHz', () => S.fabSpin, 'spin'], ['scroll', () => S.fabScroll, null]];
const fmt = (k, v) => { const p = FABRIC.params[k]; return p.unit === '×' ? `${v.toFixed(2)}×` : p.unit === '°' ? `${Math.round(v)}°` : p.unit === 'Hz' ? `${v.toFixed(2)} Hz` : `${v.toFixed(2)}/s`; };

// (also used by the room's Färg, fargui.js)
// Hämta (eller ladda upp) ett tyg-id för en källa: förinställt mönster, egen klibba eller fil.
export async function idForPreset(key) {
  const map = readJson(PRESET_KEY, {});
  if (ID_RE.test(map[key] || '')) return map[key];
  const img = await uploadFabric(await presetBlob(key));
  writeJson(PRESET_KEY, { ...readJson(PRESET_KEY, {}), [key]: img.id }); return img.id;
}
export async function idForSticker(st) {
  const map = readJson(FROM_STICKER_KEY, {});
  if (ID_RE.test(map[st.id] || '')) return map[st.id];
  const blob = (await getBlob(st)) || (await fetch(st.url).then((r) => (r.ok ? r.blob() : null)));
  if (!blob) throw new Error('image not found');
  const img = await uploadFabric(await prepareFabricImage(blob));
  writeJson(FROM_STICKER_KEY, { ...readJson(FROM_STICKER_KEY, {}), [st.id]: img.id }); return img.id;
}
export async function idForFile(file) { return (await uploadFabric(await prepareFabricImage(file))).id; }

export function initFabricUI({ $, getDraft, setDraft, preview, toast }) {
  const modes = {};   // plats -> 'color' | 'fabric' (fabric utan bild än = väntar på val)
  const params = {};  // plats -> senaste värdena, så de finns kvar om man byter bild
  let busy = 0;


  function setSlot(slot, f) {
    const d = getDraft(), fabric = { ...(d.fabric || {}) };
    if (f) fabric[slot] = f; else delete fabric[slot];
    setDraft({ fabric }, { rerender: true });
  }
  // photo: the face slot's face photo (drawn once on the front of the head) instead of a tiled fabric.
  async function useSource(slot, getId, { photo = false } = {}) {
    busy++; toast(photo ? S.facePhotoMaking : S.fabUploading, 1200);
    try {
      const id = await getId();
      modes[slot] = 'fabric';
      const was = params[slot] || {};
      // switching between a photo and a pattern starts from neutral zoom/rotation (they mean different things)
      const keep = !!was.photo === photo ? was : {};
      setSlot(slot, cleanFabric({ ...keep, id, photo: slot === 'face' && photo }));
    } catch (e) { toast(S.fabFailed(e.message || 'error'), 3500); }
    finally { busy--; }
  }

  const file = $('fab-file'); let fileSlot = null, filePhoto = false;
  file.onchange = () => {
    const f = file.files && file.files[0]; file.value = ''; if (!f || !fileSlot) return;
    if (filePhoto) useSource(fileSlot, async () => (await uploadFabric(await prepareFacePhoto(f))).id, { photo: true });
    else useSource(fileSlot, () => idForFile(f));
  };

  // The Fabric button's icon: a tiny swatch of plain, off-white cotton weave (drawn once).
  // Deliberately unremarkable – the wild stuff is only found once the panel is open.
  function seg(slot, mode) {
    const box = document.createElement('div'); box.className = 'fab-seg'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', S.fabModeAria(SLOT_LABEL[slot]()));
    for (const [m, label] of [['color', S.fabColour], ['fabric', S.fabFabric]]) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.mode = m; b.textContent = label;
      if (m === 'fabric') { const ico = document.createElement('span'); ico.className = 'fab-ico'; ico.setAttribute('aria-hidden', 'true'); ico.style.backgroundImage = `url("${weaveIcon()}")`; b.prepend(ico); }
      b.setAttribute('aria-pressed', String(mode === m)); if (mode === m) b.classList.add('sel');
      b.onclick = () => {
        if (modes[slot] === m) return;
        modes[slot] = m;
        const cur = getDraft().fabric?.[slot];
        if (m === 'color') { if (cur) params[slot] = cur; setSlot(slot, null); }
        else if (params[slot]?.id) setSlot(slot, cleanFabric(params[slot])); // samma tyg som sist
        else setDraft({}, { rerender: true });
      };
      box.appendChild(b);
    }
    return box;
  }
  function pickButton(title, bg, sel, cls, onPick) {
    const b = document.createElement('button'); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
    b.style.backgroundImage = `url("${bg}")`; if (sel) b.classList.add('sel'); if (cls) b.classList.add(cls);
    b.onclick = onPick; return b;
  }
  const presetThumbs = {};
  const presetThumb = (k) => (presetThumbs[k] ||= presetCanvas(k, 64).toDataURL());

  function controls(slot, f) {
    const ctl = document.createElement('div'); ctl.className = 'fab-ctl';
    const top = document.createElement('div'); top.className = 'fab-top';
    const pv = document.createElement('div'); pv.className = 'fab-preview'; pv.setAttribute('role', 'img'); pv.setAttribute('aria-label', S.fabPreview);
    const tile = document.createElement('div'); tile.className = 'fab-tile'; pv.appendChild(tile);
    const src = document.createElement('div'); src.className = 'fab-src';
    const up = document.createElement('button'); up.type = 'button'; up.className = 'fab-up'; up.textContent = S.fabUpload; up.title = S.fabUploadTitle;
    up.onclick = () => { fileSlot = slot; filePhoto = false; file.click(); };
    const hint = document.createElement('small'); hint.textContent = f?.photo ? `${S.facePhotoOn} ${S.fabPickHint}` : f ? S.fabPickHint : `${S.fabNone} ${S.fabPickHint}`;
    const srcBtns = [up];
    if (slot === 'face') { // the face: a photo of a face, mapped once onto the front of the head
      const ph = document.createElement('button'); ph.type = 'button'; ph.className = 'fab-up fab-photo'; ph.textContent = S.facePhoto; ph.title = S.facePhotoTitle;
      if (f?.photo) ph.classList.add('sel');
      ph.onclick = () => { fileSlot = slot; filePhoto = true; file.click(); };
      srcBtns.push(ph);
    }
    const picks = document.createElement('div'); picks.className = 'fab-picks';
    const curId = f?.id;
    const fromSticker = readJson(FROM_STICKER_KEY, {}), presetIds = readJson(PRESET_KEY, {});
    for (const st of readMine().slice().reverse().slice(0, 12)) {
      picks.appendChild(pickButton(S.fabMine, st.url, fromSticker[st.id] && fromSticker[st.id] === curId, 'mine', () => useSource(slot, () => idForSticker(st))));
    }
    const shown = new Set([...Object.values(fromSticker), ...Object.values(presetIds)]);
    for (const id of readRecent()) if (!shown.has(id)) picks.appendChild(pickButton(S.fabRecent, fabricUrl(id), id === curId, null, () => useSource(slot, async () => id)));
    for (const [k, p] of Object.entries(PRESETS)) picks.appendChild(pickButton(S.fabPreset(p.name), presetThumb(k), presetIds[k] && presetIds[k] === curId, null, () => useSource(slot, () => idForPreset(k))));
    src.append(...srcBtns, hint, picks);
    top.append(pv, src); ctl.appendChild(top);
    const vals = f || cleanFabric({ ...(params[slot] || {}), id: '0000000000000000' });
    for (const [k, label, flag] of SLIDERS) {
      const p = FABRIC.params[k], row = document.createElement('div'); row.className = 'fab-sl'; row.dataset.param = k;
      let lab;
      if (flag) {
        lab = document.createElement('label'); lab.className = 'check';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.dataset.flag = flag; cb.checked = !!vals[flag]; cb.disabled = !f;
        cb.onchange = () => { edit(slot, { [flag]: cb.checked }); row.classList.toggle('off', !cb.checked); };
        lab.append(cb, document.createTextNode(' ' + label()));
        if (!vals[flag]) row.classList.add('off');
      } else { lab = document.createElement('span'); lab.textContent = label(); }
      const r = document.createElement('input'); r.type = 'range'; r.min = p.min; r.max = p.max; r.step = p.step; r.value = vals[k]; r.disabled = !f;
      r.setAttribute('aria-label', flag ? `${label()} ${S.fabSpeed}` : label());
      const out = document.createElement('output'); out.textContent = fmt(k, vals[k]);
      r.oninput = () => { const v = Number(r.value); out.textContent = fmt(k, v); edit(slot, { [k]: v }); };
      row.append(lab, r, out); ctl.appendChild(row);
    }
    return ctl;
  }
  // Slider/kryssruta: bara ny looken till förhandsvisningen, ingen ny panel (så dragningen inte avbryts).
  function edit(slot, patch) {
    const cur = getDraft().fabric?.[slot]; if (!cur) return;
    const f = cleanFabric({ ...cur, ...patch }); params[slot] = f;
    setDraft({ fabric: { ...getDraft().fabric, [slot]: f } }, { rerender: false });
  }

  // Free version: plain colours only – no Colour | Fabric switch, no fabric panel at all.
  // Full version (entitlements.full.fabrics): the switch, and inside an opened fabric panel
  // the 🌀 Randomize button (never on the closed/default view).
  function render() {
    const d = getDraft(), full = has('fabrics');
    const wild = $('av-wild'), home = $('av-wild-home');
    if (wild && home && wild.parentElement !== home) home.appendChild(wild);
    let wildPlaced = false;
    for (const row of document.querySelectorAll('#avatar-panel .fab-slot')) {
      const slot = row.dataset.slot, f = full ? d.fabric?.[slot] || null : null;
      if (f) { modes[slot] = 'fabric'; params[slot] = f; }
      if (!full) modes[slot] = 'color';
      const mode = modes[slot] === 'fabric' ? 'fabric' : 'color';
      const head = row.querySelector('.fab-head');
      head.querySelector('.fab-seg')?.remove(); if (full) head.appendChild(seg(slot, mode));
      row.querySelector('.fab-ctl')?.remove(); row.querySelector('.fab-base')?.remove();
      const sw = row.querySelector('.swatches');
      if (mode === 'fabric') {
        const ctl = controls(slot, f);
        if (wild && !wildPlaced) { const w = document.createElement('div'); w.className = 'fab-wild'; w.appendChild(wild); ctl.appendChild(w); wildPlaced = true; }
        row.insertBefore(ctl, sw);
        const base = document.createElement('div'); base.className = 'fab-base';
        const s = document.createElement('small'); s.textContent = S.fabBaseHint; base.appendChild(s);
        row.insertBefore(base, sw);
      }
    }
    tick();
  }
  // Varje bildruta medan panelen är öppen: de små förhandsvisningarna snurrar/byter färg som gubben.
  function tick(now = Date.now()) {
    const d = getDraft();
    for (const row of document.querySelectorAll('#avatar-panel .fab-slot')) {
      const slot = row.dataset.slot, f = d.fabric?.[slot], pv = row.querySelector('.fab-preview'); if (!pv) continue;
      const tile = pv.firstChild;
      pv.style.backgroundColor = d[SLOTS[slot]] || (slot === 'face' ? d.skin : '') || '#333';
      if (!f) { tile.style.backgroundImage = 'none'; continue; }
      if (f.photo) { const url = `url("${fabricUrl(f.id)}")`; if (tile.dataset.url !== url) { tile.style.backgroundImage = url; tile.dataset.url = url; } tile.style.backgroundSize = 'cover'; tile.style.backgroundPosition = 'center'; tile.style.transform = `rotate(${-f.rot}deg) scale(${1 / f.scale})`; tile.style.filter = f.hue ? `hue-rotate(${f.hue}deg)` : ''; continue; }
      const ph = fabricPhase(f, now), px = 33 * f.scale;
      const url = `url("${fabricUrl(f.id)}")`; if (tile.dataset.url !== url) { tile.style.backgroundImage = url; tile.dataset.url = url; }
      tile.style.backgroundSize = `${px}px ${px}px`;
      tile.style.backgroundPosition = `center ${ph.offset * px}px`;
      tile.style.transform = `rotate(${-ph.rot}deg)`;
      tile.style.filter = ph.hue ? `hue-rotate(${ph.hue}deg)` : '';
    }
  }
  function reset(look) { for (const s of Object.keys(SLOTS)) { modes[s] = look.fabric?.[s] ? 'fabric' : 'color'; if (look.fabric?.[s]) params[s] = look.fabric[s]; } }

  // 🌀 Randomize: färger, kläder och tyger på det mesta, med galna värden.
  async function wild(baseLook) {
    const sources = [...Object.keys(PRESETS).map((k) => () => idForPreset(k)), ...readMine().slice(-10).map((st) => () => idForSticker(st)), ...readRecent().map((id) => async () => id)];
    const slots = Object.keys(SLOTS).filter((s) => (s === 'skin' || s === 'face' ? Math.random() < 0.35 : Math.random() < 0.8));
    busy++; toast(S.randomizing, 1500);
    try {
      const ids = await Promise.all(slots.map(() => sources[Math.floor(Math.random() * sources.length)]().catch(() => null)));
      const fabric = {};
      slots.forEach((s, i) => { if (ids[i]) fabric[s] = randomFabricParams(ids[i]); });
      const look = { ...baseLook, hat: baseLook.hat || !!fabric.hat, fabric };
      reset(look);
      return look;
    } finally { busy--; }
  }
  return { render, tick, reset, wild, busy: () => busy > 0, modes };
}

let weaveUrl = null;
export function weaveIcon() {
  if (weaveUrl) return weaveUrl;
  const n = 16, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d');
  g.fillStyle = '#e9e4d8'; g.fillRect(0, 0, n, n); // unbleached cotton
  // Plain weave: alternating over/under threads, a touch of slub.
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const over = (x + y) % 2 === 0, slub = ((x * 7 + y * 13) % 11) / 110;
    g.fillStyle = over ? `rgba(255,255,250,${0.35 + slub})` : `rgba(120,110,95,${0.18 + slub})`;
    g.fillRect(x, y, 1, 1);
  }
  g.strokeStyle = 'rgba(90,85,75,.35)'; g.strokeRect(0.5, 0.5, n - 1, n - 1);
  weaveUrl = c.toDataURL();
  return weaveUrl;
}

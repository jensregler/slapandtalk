// Packs the player carries (up to PACKS_MAX = 3). Each pack has 3 stickers.
// Finishing the pac makeover (door.js) calls addPack(); a 4th pack asks which to replace
// (lift + "Replace this?" yes/no – same idea as the sticker editor).
import { S } from './strings.js';

export const PACKS_KEY = 'klibb.packs';
export const PACKS_MAX = 3;

const read = () => {
  try {
    const v = JSON.parse(localStorage.getItem(PACKS_KEY) || '[]');
    return Array.isArray(v) ? v.filter((p) => p && typeof p.id === 'string' && Array.isArray(p.stickers)).slice(0, PACKS_MAX) : [];
  } catch { return []; }
};
const write = (list) => { try { localStorage.setItem(PACKS_KEY, JSON.stringify(list.slice(0, PACKS_MAX))); } catch { /* full */ } };

export const readPacks = () => read();
export const packsCount = () => read().length;

/** Normalize a finished door pac into a packs-wheel entry. */
export function packFromPac(pac) {
  if (!pac || !Array.isArray(pac.stickers) || pac.stickers.length !== 3) return null;
  const id = pac.id || `pack-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    name: String(pac.name || '').slice(0, 30),
    stickers: pac.stickers.slice(0, 3),
    urls: Array.isArray(pac.urls) ? pac.urls.slice(0, 3) : [],
    designs: Array.isArray(pac.designs) ? pac.designs.slice(0, 3) : [],
    bag: pac.bag || 1,
    img: pac.img || '',
    at: pac.at || new Date().toISOString(),
  };
}

/**
 * Add a finished pack. If under the limit, saves immediately and returns { ok: true, packs }.
 * If full, returns { ok: false, needsReplace: true, packs, pending } – caller should open
 * openPackReplace(pending, onDone).
 */
export function addPack(pac) {
  const entry = packFromPac(pac);
  if (!entry) return { ok: false, error: 'bad-pack' };
  const list = read();
  // Same three stickers already carried: refresh that slot instead of duplicating.
  const same = list.findIndex((p) => p.stickers.join() === entry.stickers.join() && p.bag === entry.bag);
  if (same >= 0) {
    list[same] = { ...list[same], ...entry, id: list[same].id };
    write(list);
    return { ok: true, packs: list, replaced: list[same].id };
  }
  if (list.length < PACKS_MAX) {
    list.push(entry);
    write(list);
    return { ok: true, packs: list, added: entry.id };
  }
  return { ok: false, needsReplace: true, packs: list, pending: entry };
}

export function replacePack(oldId, pending) {
  const entry = packFromPac(pending) || pending;
  if (!entry) return read();
  const list = read();
  const i = list.findIndex((p) => p.id === oldId);
  if (i < 0) return list;
  list[i] = { ...entry, id: entry.id || oldId };
  write(list);
  return list;
}

export function removePack(id) {
  write(read().filter((p) => p.id !== id));
  return read();
}

/** Lift + "Replace this?" yes/no over the packs you already carry. */
export function openPackReplace(pending, { onDone, toast } = {}) {
  const list = read();
  const box = document.createElement('div');
  box.id = 'packs-replace';
  box.innerHTML = `
    <div class="pk-panel">
      <div class="pk-title"></div>
      <div class="pk-grid"></div>
      <div class="pk-confirm" hidden>
        <div class="pk-ask"></div>
        <div class="pk-btns">
          <button type="button" class="pk-no"></button>
          <button type="button" class="pk-yes"></button>
        </div>
      </div>
      <button type="button" class="pk-back"></button>
    </div>`;
  document.body.appendChild(box);
  const $ = (sel) => box.querySelector(sel);
  $('.pk-title').textContent = S.packsFullAsk || 'You can only carry 3 packs. Choose one to replace.';
  $('.pk-ask').textContent = S.packsReplaceAsk || 'Replace this?';
  $('.pk-yes').textContent = S.packsReplaceYes || 'yes';
  $('.pk-no').textContent = S.packsReplaceNo || 'no';
  $('.pk-back').textContent = S.choiceBack || '↩ Back';
  let pickId = null;
  const grid = $('.pk-grid');
  for (const p of list) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pk-pick'; b.dataset.id = p.id;
    b.innerHTML = `<img src="${p.img || '/start/pac.webp'}" alt=""><span>${p.name || S.cityMyPack || 'pack'}</span>`;
    b.onclick = () => {
      grid.querySelectorAll('.pk-pick').forEach((x) => x.classList.remove('picked'));
      b.classList.add('picked');
      pickId = p.id;
      $('.pk-confirm').hidden = false;
    };
    grid.appendChild(b);
  }
  const close = (result) => { box.remove(); onDone?.(result); };
  $('.pk-back').onclick = () => close({ cancelled: true });
  $('.pk-no').onclick = () => {
    pickId = null;
    $('.pk-confirm').hidden = true;
    grid.querySelectorAll('.pk-pick').forEach((x) => x.classList.remove('picked'));
  };
  $('.pk-yes').onclick = () => {
    if (!pickId) return;
    const packs = replacePack(pickId, pending);
    toast?.(S.packsAdded || 'Pack saved on your PACKS wheel.');
    close({ ok: true, packs, replaced: pickId });
  };
  return { close: () => close({ cancelled: true }) };
}

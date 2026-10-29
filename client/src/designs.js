// Mina designs (uppladdade klibbor) på den här enheten.
//
// Listan sparas i localStorage ("klibb.mine") och själva bilderna i IndexedDB. Om servern
// tappar en bild (Renders gratisnivå raderar disken vid omstart eller uppdatering) laddar
// appen upp den igen från telefonen/datorn, så designen inte försvinner för dig.
//
// Varje ändring läser först om listan från localStorage, så två flikar (eller appen på
// hemskärmen + webbläsaren) inte skriver över varandras designs.
const KEY = 'klibb.mine';
const MAX = 30;

export function readMine() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter((m) => m && m.id && m.url) : []; } catch { return []; }
}
// Over MAX: the oldest non-favourites go first (favourites, "staples", stay).
function writeMine(list) {
  list = list.slice();
  const favs = readFavs();
  while (list.length > MAX) { const i = list.findIndex((m) => !favs.has(m.id)); list.splice(i < 0 ? 0 : i, 1); }
  localStorage.setItem(KEY, JSON.stringify(list)); return list;
}

// Lägg till (eller flytta sist = nyast). replaceId: byt ut en gammal post på samma plats.
export function addMine(img, replaceId = null) {
  const list = readMine();
  const at = replaceId ? list.findIndex((m) => m.id === replaceId) : -1;
  const rest = list.filter((m) => m.id !== img.id && m.id !== replaceId);
  if (at >= 0) rest.splice(Math.min(at, rest.length), 0, img); else rest.push(img);
  return writeMine(rest);
}
// Put a design back at its old place (undo after removing it from the palette).
export function insertMine(img, index) {
  const rest = readMine().filter((m) => m.id !== img.id);
  rest.splice(Math.max(0, Math.min(index, rest.length)), 0, img);
  return writeMine(rest);
}
// A new quick room (Jens, 29 Oct 2026): my test uploads should not linger on the sticker wheel. Every
// upload goes, except the ones I starred (favourites = "staples": the only stickers that can be starred,
// and the way to keep one). Returns the ids that went (their local image copies go too).
export function clearMineForNewRoom() {
  const favs = readFavs(), list = readMine(), gone = list.filter((m) => !favs.has(m.id)).map((m) => m.id);
  writeMine(list.filter((m) => favs.has(m.id)));
  writeFavs(new Set([...favs].filter((id) => list.some((m) => m.id === id)))); // a star only on an upload I have
  return { gone, done: Promise.all(gone.map((id) => deleteBlob(id))) };
}
export function removeMine(ids) { return writeMine(readMine().filter((m) => !ids.includes(m.id))); }
export function updateMine(images) { return writeMine(readMine().map((m) => images[m.id] || m)); }

// ---------- Favourites ("staples"): a list of design ids in localStorage ("klibb.favs") ----------
export const FAV_KEY = 'klibb.favs';
export function readFavs() {
  try { const v = JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []); } catch { return new Set(); }
}
function writeFavs(set) { localStorage.setItem(FAV_KEY, JSON.stringify([...set])); return set; }
export function setFav(id, on) { const s = readFavs(); if (on) s.add(id); else s.delete(id); return writeFavs(s); }
// A design got a new id (uploaded again after the server lost it): it stays a favourite.
export function moveFav(from, to) { const s = readFavs(); if (!s.delete(from)) return s; s.add(to); return writeFavs(s); }

// ---------- Bilderna i IndexedDB ----------
let dbp;
function db() {
  if (!('indexedDB' in self)) return Promise.reject(new Error('ingen IndexedDB'));
  dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open('klibb', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('blobs');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('blobs', mode);
    const req = fn(t.objectStore('blobs'));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}
export const saveBlob = (id, blob) => tx('readwrite', (s) => s.put(blob, id)).catch(() => {});
export const deleteBlob = (id) => tx('readwrite', (s) => s.delete(id)).catch(() => {});
export async function getBlob(img) {
  const b = await tx('readonly', (s) => s.get(img.id)).catch(() => null);
  if (b) return b;
  // Äldre designs (från innan bilderna sparades lokalt): kanske finns den kvar i webbläsarens cache.
  try {
    const r = await fetch(img.url, { cache: 'only-if-cached', mode: 'same-origin' });
    if (r.ok) return await r.blob();
  } catch { /* inte i cachen */ }
  return null;
}

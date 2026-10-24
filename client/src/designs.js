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
function writeMine(list) { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); return list.slice(-MAX); }

// Lägg till (eller flytta sist = nyast). replaceId: byt ut en gammal post på samma plats.
export function addMine(img, replaceId = null) {
  const list = readMine();
  const at = replaceId ? list.findIndex((m) => m.id === replaceId) : -1;
  const rest = list.filter((m) => m.id !== img.id && m.id !== replaceId);
  if (at >= 0) rest.splice(Math.min(at, rest.length), 0, img); else rest.push(img);
  return writeMine(rest);
}
export function removeMine(ids) { return writeMine(readMine().filter((m) => !ids.includes(m.id))); }
export function updateMine(images) { return writeMine(readMine().map((m) => images[m.id] || m)); }

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

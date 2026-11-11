// Mina stämplar (historiken) på den här enheten, så jag kan peela (ta bort) dem igen.
// Sparas i localStorage ("klibb.history"): { room, stampId, token, designId, url, time }.
// token = den hemliga peel-nyckeln från servern. Bara den som har nyckeln kan peela stämpeln.
// Precis som designs läses listan om före varje ändring, så två flikar inte skriver över varandra.
const KEY = 'klibb.history';
const MAX = 1000;
// Bara de senaste 100 i varje rum går att peela (pilhistoriken / undo stack; servern sparar inte nycklar till fler).
// Jens, 11 Nov 2026: 100 (was 10) – "det är roligt att kunna ta bort dem". Same number as server/store.js PEEL_KEEP.
export const PER_ROOM = 100;

export function readHistory() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter((h) => h && h.room && h.stampId && h.token) : []; } catch { return []; }
}
function write(list) {
  // Nyaste först per rum: behåll högst PER_ROOM i varje rum, och högst MAX totalt.
  const perRoom = new Map();
  const keep = new Set(list.slice().sort((a, b) => b.time.localeCompare(a.time))
    .filter((h) => { const n = perRoom.get(h.room) || 0; perRoom.set(h.room, n + 1); return n < PER_ROOM; }));
  const l = list.filter((h) => keep.has(h)).slice(-MAX);
  localStorage.setItem(KEY, JSON.stringify(l)); return l;
}
export function addHistory(entry) { return write([...readHistory().filter((h) => h.stampId !== entry.stampId), entry]); }
export function removeHistory(stampIds) { const s = new Set(stampIds); return write(readHistory().filter((h) => !s.has(h.stampId))); }
// Nyaste först, bara det här rummet.
export function roomHistory(room) { return readHistory().filter((h) => h.room === room).sort((a, b) => b.time.localeCompare(a.time)).slice(0, PER_ROOM); }
// Rensa gamla listor (från innan gränsen fanns) ner till PER_ROOM per rum.
export function trimHistory() { const l = readHistory(); if (write(l).length !== l.length) return true; return false; }
// En slumpad id för den här enheten (servern räknar "de senaste PER_ROOM per person" med den).
export function deviceId() {
  let id = localStorage.getItem('klibb.device');
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) { id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem('klibb.device', id); }
  return id;
}
export const HISTORY_KEY = KEY;

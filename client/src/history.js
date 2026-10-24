// Mina stämplar (historiken) på den här enheten, så jag kan peela (ta bort) dem igen.
// Sparas i localStorage ("klibb.history"): { room, stampId, token, designId, url, time }.
// token = den hemliga peel-nyckeln från servern. Bara den som har nyckeln kan peela stämpeln.
// Precis som designs läses listan om före varje ändring, så två flikar inte skriver över varandra.
const KEY = 'klibb.history';
const MAX = 1000;

export function readHistory() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter((h) => h && h.room && h.stampId && h.token) : []; } catch { return []; }
}
function write(list) { const l = list.slice(-MAX); localStorage.setItem(KEY, JSON.stringify(l)); return l; }
export function addHistory(entry) { return write([...readHistory().filter((h) => h.stampId !== entry.stampId), entry]); }
export function removeHistory(stampIds) { const s = new Set(stampIds); return write(readHistory().filter((h) => !s.has(h.stampId))); }
// Nyaste först, bara det här rummet.
export function roomHistory(room) { return readHistory().filter((h) => h.room === room).sort((a, b) => b.time.localeCompare(a.time)); }
export const HISTORY_KEY = KEY;

// Leaving the city (Jens, t479u, 2 Nov 2026): a free player carries the packs they took only while
// they are in the city – leaving it (going to a room, Exit to menu, a new tab, another city) drops
// them; their own pack stays in the Town Hall's shop for its week. A paying player keeps them (the
// server decides: POST /api/city/packs/drop answers what I still carry).
// Small on purpose: the start card (startcard.js) uses it too.
import { unlockHeaders } from './entitlements.js';

const FLAG = 'klibb.inCity'; // this tab is in that city now (sessionStorage)
const TAKEN_KEY = 'klibb.cityTaken', TOKEN_KEY = 'klibb.packToken';
const sget = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const sset = (k, v) => { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* private */ } };
const lread = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const lwrite = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* full */ } };

// → what I still carry (pack ids), after the server dropped the rest.
async function drop() {
  const token = lread(TOKEN_KEY), t = lread(TAKEN_KEY);
  if (!t || !Array.isArray(t.packs) || !t.packs.length) return [];
  let keep = [];
  if (token) {
    try {
      const r = await fetch('/api/city/packs/drop', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'x-pack-token': token, ...unlockHeaders() }, body: '{}' });
      const d = await r.json(); keep = Array.isArray(d.takes) ? d.takes : [];
    } catch { keep = []; } // offline: drop them here too (the server drops them the next time)
  }
  lwrite(TAKEN_KEY, { ...t, packs: t.packs.filter((p) => keep.includes(p.id)) });
  return keep;
}
// A city page: if this tab was not in THIS city already, it is a new visit (start with only my pack).
export function enterCity(city) {
  const was = sget(FLAG);
  sset(FLAG, city);
  return was === city ? Promise.resolve(null) : drop();
}
// Anywhere else (a room, the start card): if this tab was in a city, I left it.
export function leaveCity() {
  if (!sget(FLAG)) return Promise.resolve(null);
  sset(FLAG, null);
  return drop();
}
export const cityOfThisTab = () => sget(FLAG);

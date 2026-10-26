// Where the plain address (slapandtalk.com/, no ?room=) takes you: your most recently used room.
// "Your rooms" = the ones this browser has a key for (klibb.roomKeys: you made it; klibb.memberKeys:
// an invite let you in) or has opened (klibb.rooms: { id: lastVisitMs }, kept by main.js).
// The server says which still exist and when something last happened there
// (GET /api/rooms/recent?ids=…); unreachable → the local last-visit time decides. Rooms the
// server says are gone (cleaned up, an expired demo room) are forgotten here. No rooms → a new
// quick room, as "＋ New quick room" makes. The address becomes /?room=<id> with
// history.replaceState (no reload, so no loop); main.js then opens that room.
// Not used: ?room= given (also ?room=stad = the City), ?replay=, ?admin= (admin opens the City
// as before), the demo (demo.js has its own "your room" rule).
const VISITS = 'klibb.rooms', ROOM_KEYS = 'klibb.roomKeys', MEMBERS = 'klibb.memberKeys';
const MAX_VISITS = 100;
const ROOM_RE = /^[a-z0-9-]{1,40}$/;
const read = (k) => { try { const v = JSON.parse(localStorage.getItem(k) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: fine */ } };

// main.js: "I am in this room now" (the City is not one of your rooms).
export function noteVisit(id, now = Date.now()) {
  if (!ROOM_RE.test(id) || id === 'stad') return;
  const v = read(VISITS); v[id] = now;
  const keep = Object.entries(v).sort((a, b) => b[1] - a[1]).slice(0, MAX_VISITS);
  write(VISITS, Object.fromEntries(keep));
}
export function forget(ids) {
  for (const k of [VISITS, ROOM_KEYS, MEMBERS]) { const m = read(k); let ch = false; for (const id of ids) if (id in m) { delete m[id]; ch = true; } if (ch) write(k, m); }
}
// My rooms, most recently visited first (rooms with a key but never noted come last).
export function myRooms() {
  const v = read(VISITS), ids = new Set([...Object.keys(v), ...Object.keys(read(ROOM_KEYS)), ...Object.keys(read(MEMBERS))]);
  return [...ids].filter((id) => ROOM_RE.test(id) && id !== 'stad').sort((a, b) => (v[b] || 0) - (v[a] || 0) || a.localeCompare(b)).slice(0, 50);
}
// The choice itself (pure, for tests): server answer { rooms: [{ id, updatedAt }], missing } or
// null (unreachable) → { id, forget: [...] } or { id: null }.
export function pickRoom(mine, answer, visits = {}) {
  if (!mine.length) return { id: null, forget: [] };
  if (!answer) return { id: mine[0], forget: [], offline: true };
  const missing = new Set(answer.missing || []);
  const best = (answer.rooms || []).filter((r) => mine.includes(r.id) && !missing.has(r.id))
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) || (visits[b.id] || 0) - (visits[a.id] || 0))[0];
  return { id: best ? best.id : null, forget: [...missing] };
}
const timed = (url, opts = {}, ms = 3500) => {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = setTimeout(() => ctl && ctl.abort(), ms);
  return fetch(url, { ...opts, ...(ctl ? { signal: ctl.signal } : {}) }).finally(() => clearTimeout(t));
};
// boot.js, before main.js. Returns the room id it chose (or null = the City, as before).
export async function land() {
  const params = new URLSearchParams(location.search);
  if (params.has('room') || params.has('replay') || params.has('admin')) return null;
  const mine = myRooms();
  let answer = null;
  if (mine.length) {
    try { const r = await timed(`/api/rooms/recent?ids=${mine.join(',')}`, { cache: 'no-store' }); if (r.ok) answer = await r.json(); } catch { /* offline: local times */ }
  }
  const pick = pickRoom(mine, answer, read(VISITS));
  if (pick.forget.length) forget(pick.forget);
  let id = pick.id;
  if (!id) {
    // No rooms (or all gone): a new quick room, the same as "＋ New quick room" with the default look.
    try {
      const r = await timed('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.room && data.roomKey) { const k = read(ROOM_KEYS); k[data.room.id] = data.roomKey; write(ROOM_KEYS, k); id = data.room.id; }
    } catch { /* offline: the City, as before */ }
  }
  if (!id) return null;
  params.set('room', id);
  history.replaceState(history.state, '', `${location.pathname}?${params}${location.hash}`);
  return id;
}

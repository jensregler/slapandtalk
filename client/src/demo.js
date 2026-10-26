// The demo profile in the browser (config.demo, see server/demo.js for the rules).
//   - Before anything else: "What's your name?" (once per device; the name shows above your character).
//   - Everyone has their own room: the plain address (or the City) takes you to yours, or makes a
//     new one (the empty preset). Nobody sees a list of rooms.
//   - Getting in: the creator's room key, a member key (saved the first time an invite let you
//     in), or the single-use invite link (?invite=…) – sent with the WebSocket hello as `pass`.
//   - The hour: a quiet timer, a calm note at 5 minutes, and a closing card at the end.
import { config } from './config.js';
import { S } from './strings.js';
import { loadMyAvatar, saveMyAvatar, cleanName } from './avatars.js';

const OWN = 'klibb.demoRoom';       // { id, expiresAt } – my own room on this device
const MEMBERS = 'klibb.memberKeys'; // { room: memberKey }
const ROOM_KEYS = 'klibb.roomKeys'; // { room: roomKey } (shared with main.js)
const INVITES = 'klibb.myInvites';  // { room: token } – my own invite link per room
const readMap = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch { return {}; } };
const writeMap = (k, id, v) => { const m = readMap(k); if (v === null) delete m[id]; else m[id] = v; localStorage.setItem(k, JSON.stringify(m)); };
const $ = (id) => document.getElementById(id);

export const isDemo = () => !!config.demo;
export const roomUrl = (id) => `${location.origin}/?room=${id}`;
export const inviteUrl = (id, token) => `${location.origin}/?room=${id}&invite=${encodeURIComponent(token)}`;

// ---------- Name ----------
export function askName() {
  const me = loadMyAvatar();
  if (me.name) return Promise.resolve(me.name);
  const dlg = $('name-dialog'), input = $('name-input'), ok = $('name-ok');
  return new Promise((resolve) => {
    const sync = () => { ok.disabled = !cleanName(input.value); };
    input.oninput = sync; sync();
    const done = (e) => {
      if (e) e.preventDefault();
      const name = cleanName(input.value); if (!name) { input.focus(); return; }
      saveMyAvatar(name, me.look); // keeps the randomly made character
      dlg.close(); resolve(name);
    };
    $('name-form').onsubmit = done;
    dlg.addEventListener('cancel', (e) => e.preventDefault()); // Esc does not skip it
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    setTimeout(() => input.focus(), 30);
  });
}

// ---------- My own room ----------
export function ownRoom() {
  try { const r = JSON.parse(localStorage.getItem(OWN) || 'null'); if (r && r.id && Date.parse(r.expiresAt) > Date.now()) return r; } catch { /* */ }
  return null;
}
export async function createOwnRoom() {
  const r = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.room) throw new Error(data.error || 'Could not make a room.');
  if (data.roomKey) writeMap(ROOM_KEYS, data.room.id, data.roomKey);
  localStorage.setItem(OWN, JSON.stringify({ id: data.room.id, expiresAt: data.room.expiresAt }));
  return data.room.id;
}
export async function goToNewRoom() { const id = await createOwnRoom(); location.href = roomUrl(id); }

// Runs before main.js. false = we are moving to another address (do not start the room).
export async function demoGate() {
  document.body.classList.add('demo');
  await askName();
  const params = new URLSearchParams(location.search);
  const room = (params.get('room') || '').toLowerCase();
  if (room && room !== 'stad') return true;
  const own = ownRoom();
  try { location.replace(roomUrl(own ? own.id : await createOwnRoom())); } catch (e) { showClosed(e.message, { title: S.deniedGone }); return false; }
  return false;
}

// ---------- Getting in ----------
export function passFor(room) {
  const invite = new URLSearchParams(location.search).get('invite') || '';
  const pass = {};
  const rk = readMap(ROOM_KEYS)[room]; if (rk) pass.roomKey = rk;
  const mk = readMap(MEMBERS)[room]; if (mk) pass.member = mk;
  if (invite) pass.invite = invite;
  return pass;
}
// The welcome: keep a new member key, drop the used invite from the address bar.
export function onWelcome(room, m) {
  if (m.pass) writeMap(MEMBERS, room, m.pass);
  const p = new URLSearchParams(location.search);
  if (p.has('invite')) { p.delete('invite'); history.replaceState(null, '', location.pathname + '?' + p.toString()); }
}
export const myInvite = (room) => readMap(INVITES)[room] || '';
export const saveInvite = (room, token) => writeMap(INVITES, room, token);
// The room is gone: forget everything about it on this device.
export function forgetRoom(room) {
  for (const k of [MEMBERS, INVITES]) writeMap(k, room, null);
  const own = (() => { try { return JSON.parse(localStorage.getItem(OWN) || 'null'); } catch { return null; } })();
  if (own && own.id === room) localStorage.removeItem(OWN);
}

// ---------- The closing card (also: refused at the door) ----------
export function showClosed(text, { title = S.closedTitle } = {}) {
  const el = $('demo-closed');
  $('demo-closed-title').textContent = title;
  $('demo-closed-text').textContent = text || S.closedText;
  el.hidden = false;
  const t = document.getElementById('demo-timer'); if (t) t.hidden = true; // nothing left to count
  document.body.classList.add('demo-closed');
  $('demo-closed-new').onclick = async (e) => { e.target.disabled = true; try { await goToNewRoom(); } catch { e.target.disabled = false; } };
}
export const deniedText = (code) => ({ invite: S.deniedInvite, used: S.deniedUsed, full: S.deniedFull, gone: S.deniedGone }[code] || S.deniedInvite);

// ---------- The hour ----------
// expiresAt from the welcome; skew = server time − my time (so a wrong clock on the phone is fine).
export function startTimer({ expiresAt, serverNow, onWarn, onEnd, warnMs = (config.warnMinutes || 5) * 60_000 }) {
  const end = Date.parse(expiresAt); if (!end) return () => {};
  const skew = serverNow ? Date.parse(serverNow) - Date.now() : 0;
  const el = $('demo-timer'); el.hidden = false; el.title = S.demoTimerTitle;
  let warned = false, ended = false;
  const left = () => end - (Date.now() + skew);
  const tick = () => {
    const ms = left();
    el.textContent = S.demoTimer(ms);
    el.classList.toggle('soon', ms < warnMs);
    if (!warned && ms <= warnMs && ms > 0) { warned = true; onWarn && onWarn(Math.max(1, Math.round(ms / 60_000))); }
    if (!ended && ms <= 0) { ended = true; onEnd && onEnd(); }
  };
  tick();
  const t = setInterval(tick, 1000);
  return Object.assign(() => clearInterval(t), { left });
}

// The Thursday demo of the FREE version: one switch, DEMO_PROFILE=1 (see README "Demo profile").
// Nothing is deleted from the app: with the flag off, every feature is back.
//
// What the flag does on the server
//   - entitlements: everyone is "free" (no fabrics, Sound settings or big stickers, even with a key)
//   - no uploads (POST /api/stickers → 403); stickers come from the curated library (server/library.js)
//   - no room editing: look, peels, recording, cameras → 403 (admin still can)
//   - MAX 5 players per room, invite-only rooms, and every room closes after one hour
//
// Rooms and invites (all stored in the room's own JSON, so it goes away with the room)
//   room.demo = { expiresAt, members: [{ id, hash, name, invitedBy, joinedAt }], invites: [{ hash, by, createdAt, usedBy?, usedAt? }] }
//   - The creator gets the secret roomKey (as before) and is member "owner".
//   - Every member (the creator too) can invite ONE friend: a single-use link /?room=<id>&invite=<token>.
//   - Using the link makes you a member: the server hands back a private member key that this
//     browser keeps (localStorage), so a reload or a reconnect lets you straight back in.
//   - A used link is dead. No link, no key: no entry (not even as a watcher).
//   - At most maxMembers (5) people: the creator plus 4. Unused invites count, so the chain
//     creator → A → B → C → D can never grow past 5.
//   - Only hashes of keys and invite tokens are stored.
// The hour
//   room.demo.expiresAt = createdAt + DEMO_ROOM_MINUTES (default 60). At that moment everyone in
//   the room gets { type: 'room:closed' }, their connections close (code 4010), and the room's
//   JSON (stickers, peels, members, invites) and its recordings/<room>/ logs are deleted from
//   storage (R2). Library images and anything under videos/ stay (videos have their own retention).
//   A sweep at start-up and every few minutes catches rooms that expired while the server slept.
const crypto = require('crypto');
const DEMO = require('../shared/demo.json');

const isOn = (v) => v === '1' || String(v).toLowerCase() === 'true';
function demoSettings(env = process.env) {
  if (!isOn(env.DEMO_PROFILE)) return null;
  const minutes = Number(env.DEMO_ROOM_MINUTES) > 0 ? Number(env.DEMO_ROOM_MINUTES) : DEMO.roomMinutes;
  return { on: true, roomMs: Math.round(minutes * 60_000), warnMs: DEMO.warnMinutes * 60_000, maxPlayers: DEMO.maxPlayers, maxMembers: DEMO.maxMembers, style: { ...DEMO.style } };
}

const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
function same(token, h) {
  if (!token || typeof token !== 'string' || typeof h !== 'string' || h.length !== 64) return false;
  const a = Buffer.from(hash(token), 'hex'), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const tok = (v) => (typeof v === 'string' && TOKEN_RE.test(v) ? v : '');

function createDemo({ store, settings, clock = () => Date.now(), onExpire = () => {}, log = console, sweepMs = 5 * 60_000, tickMs = 2000 }) {
  const S = settings;
  const known = new Map(); // roomId -> expiresAt (rooms this server has seen), for the fast tick
  const note = (id, d) => { if (d && d.expiresAt) known.set(id, Date.parse(d.expiresAt)); };
  const isDemoRoom = (r) => !!(r && r.type === 'quick' && r.demo && r.demo.expiresAt);
  const expired = (r) => isDemoRoom(r) && clock() >= Date.parse(r.demo.expiresAt);

  // Fields for a brand-new demo room (POST /api/rooms).
  function newRoomFields() {
    return { demo: { expiresAt: new Date(clock() + S.roomMs).toISOString(), members: [], invites: [] } };
  }
  function created(room) { note(room.id, room.demo); }

  // May this hello enter? pass = { roomKey, member, invite }. Answer:
  //   { ok: true, memberId, memberKey? (new member: keep it), expiresAt }  or  { ok: false, code, error }
  //   code: 'gone' (no such room / closed), 'used' (invite already used), 'full', 'invite' (no pass)
  async function admit(roomId, pass = {}, name = '') {
    const roomKey = tok(pass.roomKey), member = tok(pass.member), invite = tok(pass.invite);
    const res = await store.editRoom(roomId, (room) => {
      if (!isDemoRoom(room)) return { ok: false, code: 'gone', save: false };
      if (expired(room)) return { ok: false, code: 'gone', save: false };
      const d = room.demo; d.members = d.members || []; d.invites = d.invites || [];
      note(roomId, d);
      const base = { expiresAt: d.expiresAt };
      if (roomKey && same(roomKey, room.keyHash)) {
        let m = d.members.find((x) => x.id === 'owner');
        if (!m) { m = { id: 'owner', name: String(name || '').slice(0, 24), invitedBy: null, joinedAt: new Date(clock()).toISOString() }; d.members.unshift(m); return { ok: true, memberId: 'owner', ...base }; }
        return { ok: true, memberId: 'owner', ...base, save: false };
      }
      if (member) { const m = d.members.find((x) => x.hash && same(member, x.hash)); if (m) return { ok: true, memberId: m.id, ...base, save: false }; }
      if (invite) {
        const inv = d.invites.find((x) => same(invite, x.hash));
        if (!inv) return { ok: false, code: 'invite', save: false };
        if (inv.usedBy) return { ok: false, code: 'used', save: false };
        if (d.members.length >= S.maxMembers) return { ok: false, code: 'full', save: false };
        const key = crypto.randomBytes(24).toString('base64url');
        const id = crypto.randomBytes(5).toString('hex');
        d.members.push({ id, hash: hash(key), name: String(name || '').slice(0, 24), invitedBy: inv.by, joinedAt: new Date(clock()).toISOString() });
        inv.usedBy = id; inv.usedAt = new Date(clock()).toISOString();
        return { ok: true, memberId: id, memberKey: key, ...base };
      }
      return { ok: false, code: 'invite', save: false };
    });
    if (res === 'notfound') return { ok: false, code: 'gone' };
    const { save, ...out } = res; // eslint-disable-line no-unused-vars
    return out;
  }

  // My invite: { state: 'none' | 'open' | 'used', name? (who used it), left (free places) }
  function statusOf(d, memberId) {
    const mine = (d.invites || []).filter((x) => x.by === memberId);
    const used = mine.find((x) => x.usedBy);
    const left = Math.max(0, S.maxMembers - (d.members || []).length - (d.invites || []).filter((x) => !x.usedBy).length);
    if (used) { const who = (d.members || []).find((m) => m.id === used.usedBy); return { state: 'used', name: who ? who.name : '', left }; }
    return { state: mine.length ? 'open' : 'none', left };
  }
  async function inviteStatus(roomId, memberId) {
    const r = await store.peek(roomId);
    if (!isDemoRoom(r)) return null;
    return statusOf(r.demo, memberId);
  }
  // A new single-use invite link for this member (replaces their unused one). { token } or { error, code }
  async function createInvite(roomId, memberId) {
    const res = await store.editRoom(roomId, (room) => {
      if (!isDemoRoom(room) || expired(room)) return { code: 'gone', error: 'This room has closed.', save: false };
      const d = room.demo; d.invites = d.invites || [];
      if (!(d.members || []).some((m) => m.id === memberId)) return { code: 'nomember', error: 'Only people in the room can invite.', save: false };
      const st = statusOf(d, memberId);
      if (st.state === 'used') return { code: 'used', error: 'You have already invited someone.', name: st.name, save: false };
      const others = d.invites.filter((x) => !x.usedBy && x.by !== memberId).length;
      if ((d.members || []).length + others >= S.maxMembers) return { code: 'full', error: 'The room is full.', save: false };
      d.invites = d.invites.filter((x) => !(x.by === memberId && !x.usedBy)); // the old unused link stops working
      const token = crypto.randomBytes(18).toString('base64url');
      d.invites.push({ hash: hash(token), by: memberId, createdAt: new Date(clock()).toISOString() });
      return { token, status: statusOf(d, memberId) };
    });
    if (res === 'notfound') return { code: 'gone', error: 'This room has closed.' };
    const { save, ...out } = res; // eslint-disable-line no-unused-vars
    return out;
  }
  // Is the room still open? (POST stamps)  'ok' | 'gone'
  async function roomOpen(roomId) {
    const r = await store.peek(roomId);
    return isDemoRoom(r) && !expired(r) ? 'ok' : 'gone';
  }

  const closing = new Set();
  async function expire(id) {
    if (closing.has(id)) return false;
    closing.add(id);
    try {
      try { onExpire(id); } catch (e) { log.error('[demo] onExpire', e && e.message); }
      await store.deleteRoom(id);
      // Session-recording logs of this room too (recordings/<room>/…). NEVER videos/: the finished
      // videos have their own retention (video pipeline).
      for (const k of await store.adapter.list(`recordings/${id}/`).catch(() => [])) {
        if (k.startsWith(`recordings/${id}/`)) await store.adapter.delete(k).catch(() => {});
      }
      known.delete(id);
      log.log(`[demo] room ${id} closed after its hour and was deleted`);
      return true;
    } finally { closing.delete(id); }
  }
  // Fast tick: the rooms this server knows about. Slow sweep: everything in storage.
  async function tick() {
    const now = clock(), due = [...known].filter(([, t]) => now >= t).map(([id]) => id);
    for (const id of due) await expire(id).catch((e) => log.error('[demo] expire', id, e && e.message));
    return due;
  }
  async function sweep() {
    const out = [];
    for (const id of await store.listRooms()) {
      const r = await store.peek(id).catch(() => null);
      if (!isDemoRoom(r)) continue;
      note(id, r.demo);
      if (expired(r)) { await expire(id); out.push(id); }
    }
    return out;
  }
  let t1 = null, t2 = null;
  function start() {
    sweep().catch((e) => log.error('[demo] sweep', e && e.message));
    t1 = setInterval(() => tick().catch(() => {}), tickMs); t1.unref?.();
    t2 = setInterval(() => sweep().catch(() => {}), sweepMs); t2.unref?.();
  }
  function stop() { clearInterval(t1); clearInterval(t2); }

  // What the web app needs to know (GET /api/config).
  const publicConfig = () => ({ demo: true, maxPlayers: S.maxPlayers, maxMembers: S.maxMembers, roomMinutes: S.roomMs / 60_000, warnMinutes: S.warnMs / 60_000, style: S.style });

  return { settings: S, newRoomFields, created, admit, createInvite, inviteStatus, roomOpen, expire, tick, sweep, start, stop, publicConfig, isDemoRoom, expired };
}

module.exports = { demoSettings, createDemo, DEMO };

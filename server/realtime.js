// Flerspelarläge: WebSocket på samma server som webbappen (adressen /ws?room=<rum>).
//
// Vem gör vad?
//   - HTTP-API:t (app.js) är fortfarande "sanningen" för stämplar och rummets utseende.
//     När något ändras där anropar app.js broadcast(rum, händelse), och här skickas
//     händelsen vidare direkt till alla som är i rummet (så klibbor syns för andra direkt).
//   - Här finns bara sådant som inte behöver sparas: vem som är i rummet, var de står,
//     hur deras gubbe ser ut och chatten (de senaste 50 meddelandena, bara i minnet).
//
// Meddelanden är JSON med fältet t (typ):
//   klient → server: hello {name, look, p, y, pi, unlock?: {key, dev}} · move {p, y, pi} · look {name, look} · chat {text}
//                    unlock {unlock: {key, dev}}  (new full-version key in an open tab)
//                    ping · signal {to, data}  (signal = för röstchatt via WebRTC, se nedan)
//                    talk {l} · held {h}  (recording only: my voice level / the sticker I aim with, never relayed)
//                    dance {at?, bpm?, phaseMs?, loop?, stop?}  (runway dance, shared/dance.mjs: I start the dance (loop = until I stop it); others see it.
//                    stop: true = I stopped it early – only relayed while my dance is on, so it needs no limiter of its own)
//                    sit {chair: prop id | null, draw}  (3D props, shared/props.mjs: I sit down on a chair – drawing –
//                    or stand up; one person per chair, the server keeps who sits where)
//   server → klient: welcome {id, you, players, chat, max, full, rec, now (server ms: the shared clock for the footstep groove)} · join {player} · leave {id}
//                    move {id, p, y, pi} · look {id, name, look} · you {id, name} · chat {msg}
//                    event {e} · signal {from, data} · pong · error {error}
//                    dance {id, at?, bpm?, phaseMs?, loop?, stop?}  (someone started the runway dance – at = server ms of the press, on that
//                    clock – or stopped it early)
//                    sit {id, chair, draw}  (someone sat down / stood up; to the sender with taken: id when that chair was taken)
//   a player (welcome.players, join) carries sit: { chair, draw } while seated.
//   p = ögats position [x, y, z], y = vridning (yaw), pi = blicken upp/ner (pitch), i radianer.
//   rec = pågående inspelning { recId, startedAt } eller null (event rec:start / rec:stop när det ändras).
//
// Inspelning (recorder.js): när en inspelning pågår i rummet skickas join/leave/look/move/chat
// även till inspelningen. Signal-meddelanden (röst) spelas aldrig in.
//
// Röstchatt (nästa steg): ljudet går direkt mellan webbläsarna (WebRTC). Servern skickar
// bara vidare "signal"-meddelanden (offer/answer/ice) till en annan spelare i samma rum.
// Det finns redan här, så klienten kan byggas utan att servern behöver ändras.
// Slot: every player gets the lowest free number in the room (0, 1, 2 …), kept while they stay.
// The web app colours that player's sounds by it (shared/synth.mjs SLOT_COLOURS), so up to five
// people in a demo room all sound a little different.
//
// Demo profile (server/demo.js): gate.admit(room, pass, name) decides if a hello may enter (invite
// link, member key or room key). Refused: { t: 'denied', code, error } and the socket closes with
// 4003 (the browser does not retry). gate.onMessage handles 'invite' messages. closeRoom(id) closes
// everyone in a room (code 4010) when its hour is up.
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const AV = require('../shared/avatar.json');

const DENIED = {
  invite: 'This room is invite-only. Ask someone inside for an invite link.',
  used: 'This invite link has already been used.',
  full: 'This room is full.',
  gone: 'This room has closed.',
  'house-full': 'This house is full – try another room.',
};
const listeners = new Set();
// Anropas av app.js. roomId '*' = alla rum (t.ex. när admin tar bort en bild helt).
function broadcast(roomId, event) { for (const fn of listeners) fn(roomId, event); }
function onBroadcast(fn) { listeners.add(fn); return () => listeners.delete(fn); }
// Var står spelaren (WebSocket-id) i rummet just nu, enligt det senaste den skickade?
// { p: [x, y, z] (ögonen), y: yaw, moves: hur många move som kommit } eller null.
// app.js använder det för räckvidden när rummet har peels på (går inte att fuska med från klienten).
const finders = new Set();
function playerPosition(roomId, id) {
  if (typeof id !== 'string') return null;
  for (const f of finders) { const p = f(roomId, id); if (p) return p; }
  return null;
}
// Is the room full, and is this WebSocket id one of its players (not a watcher)? null = nobody is
// connected to the room on this server. app.js refuses slaps from non-players while a room is full.
const seaters = new Set();
function roomSeat(roomId, id) {
  for (const f of seaters) { const s = f(roomId, typeof id === 'string' ? id : null); if (s) return s; }
  return null;
}
// Which rooms have people in them right now (the start card's "…or Join" list, app.js)?
// [{ id, count, max }] for every room on this server with at least one player.
const listers = new Set();
function activeRooms() { const out = []; for (const f of listers) out.push(...f()); return out; }
const fullText = (max) => `This room is full (${max} people max – one wall each). You can watch and read the chat; you get in automatically when someone leaves.`;

const ROOM_RE = /^[a-z0-9-]{1,40}$/;
const CHAT_KEEP = 50;
const CHAT_MAX = 300;
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const clampN = (n, a, b) => Math.min(b, Math.max(a, n));
const round = (n) => Math.round(n * 1000) / 1000;
const DANCE_MS = 19500; // the runway dance's longest length (shared/dance.mjs DANCE.maxMs) + a little slack

// Namn: inga kontroll- eller osynliga tecken (t.ex. tecken som vänder textriktningen), inga
// dubbla mellanslag, högst 24 tecken (räknat i tecken, så en emoji inte klipps itu).
function cleanName(s) {
  const t = String(s ?? '').normalize('NFC').replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '').replace(/\s+/g, ' ').trim();
  return Array.from(t).slice(0, AV.maxName).join('').trim();
}
// "Guest 3" (och "Gäst 3") är reserverat för gäster utan namn, så ingen kan låtsas vara en annan gäst.
const GUEST_RE = /^(guest|g[äa]st)\s*\d*$/i;
// Gubbens utseende kontrolleras mot samma katalog som webbappen använder (shared/avatar.json).
// ent = the sender's full-version flags (server/entitlements.js): fabric (and custom sound)
// data from a free player is dropped, so nobody can push it past the UI.
const ALL = { fabrics: true, soundDesign: true }; // cleanLook(l) without flags: trust (recordings, tests)
// Same rule as shared/insta.mjs (ESM; tests/stickermenu.test.mjs checks they agree).
const cleanInsta = (v) => String(v ?? '').trim().replace(/^@+/, '').replace(/[^A-Za-z0-9._]/g, '').slice(0, 30).toLowerCase();
const LOCKED_FACE_INSTA = 'jensreglermanniska';
const LOCKED_FACE = Object.freeze({ id: '70cf6e844298da52', scale: 1.15, rot: 0, hue: 0, hueHz: 0.25, spinHz: 0.1, scroll: 0, cycleHue: false, spin: false, photo: true });

const PATCH_ID_RE = /^[a-f0-9]{16}$/;
const PATCHES_MAX = 24;
const PATCH_SLOTS = ['shirt', 'pants', 'shoes', 'hair', 'skin', 'face', 'hat'];
function patchSlotFromP(p) {
  const y = p[1];
  if (y >= 1.45) return 'hair';
  if (y >= 0.85) return 'shirt';
  if (y >= 0.35) return 'pants';
  return 'shoes';
}
function cleanPatchParam(name, v) {
  const p = FAB.params[name];
  let n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return p.def;
  n = p.wrap ? ((n % 360) + 360) % 360 : Math.min(p.max, Math.max(p.min, n));
  return round(n);
}
// Kept in sync with shared/patches.mjs (atlas stamps; legacy {q,size} accepted).
function cleanPatches(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !PATCH_ID_RE.test(raw.id)) continue;
    if (!Array.isArray(raw.p) || raw.p.length !== 3 || !raw.p.every(isNum)) continue;
    const p = raw.p.map((x) => round(x));
    const slot = (typeof raw.slot === 'string' && PATCH_SLOTS.includes(raw.slot)) ? raw.slot : patchSlotFromP(p);
    let scale = raw.scale;
    if (scale == null && isNum(raw.size)) scale = raw.size / 0.14;
    const o = { id: raw.id, slot, p };
    for (const k of Object.keys(FAB.params)) o[k] = cleanPatchParam(k, raw[k] != null ? raw[k] : (k === 'scale' ? scale : undefined));
    for (const k of FAB.flags) if (k !== 'photo') o[k] = raw[k] === true;
    out.push(o);
    if (out.length >= PATCHES_MAX) break;
  }
  return out.length ? out : null;
}

function cleanLook(l, ent = ALL) {
  const d = AV.default; l = l && typeof l === 'object' ? l : {};
  const pick = (v, list, def) => (typeof v === 'string' && list.includes(v.toLowerCase()) ? v.toLowerCase() : def);
  const out = {
    outfit: AV.outfits[l.outfit] ? l.outfit : d.outfit,
    hair: AV.hair[l.hair] ? l.hair : d.hair,
    shirt: pick(l.shirt, AV.colors.shirt, d.shirt),
    pants: pick(l.pants, AV.colors.pants, d.pants),
    hairColor: pick(l.hairColor, AV.colors.hair, d.hairColor),
    skin: pick(l.skin, AV.colors.skin, d.skin),
    shoes: pick(l.shoes, AV.colors.shoes || [], d.shoes || '#222222'),
    hat: l.hat === true,
    hatColor: pick(l.hatColor, AV.colors.hat, d.hatColor),
    // The face's own colour (any #rrggbb); absent = the same as the skin. Locked owners drop it.
    ...(typeof l.face === 'string' && /^#[0-9a-f]{6}$/i.test(l.face) ? { face: l.face.toLowerCase() } : {}),
    ...(ent.fabrics ? fabricField(l.fabric) : {}),
    ...(ent.fabrics ? (() => { const p = cleanPatches(l.patches); return p ? { patches: p } : {}; })() : {}),
    ...soundField(l.sound, ent),
    ...(cleanInsta(l.insta) ? { insta: cleanInsta(l.insta) } : {}), // the Instagram name (shared/insta.mjs: same rule)
  };
  // Face lock retired (Jens, 9 Nov 2026): players (incl. @jensreglermanniska) may change face.
  return out;
}
// look.sound (shared/synth.mjs): the seed for the player's own variation of the default sounds,
// plus custom patches/FX for soundDesign players – clamped to the same ranges as the editor.
// The shared module is ESM: loaded once at startup (until then only the seed is kept).
let SYN = null;
const synthReady = import('../shared/synth.mjs').then((m) => { SYN = m; return m; });
function soundField(s, ent) {
  if (!s || typeof s !== 'object') return {};
  if (!SYN) return typeof s.seed === 'string' && /^[A-Za-z0-9_-]{4,24}$/.test(s.seed) ? { sound: { seed: s.seed } } : {};
  const out = SYN.cleanSound(s, { custom: !!ent.soundDesign });
  return out ? { sound: out } : {};
}
// Tyger (fabrics): en uppladdad bild som upprepas över en kroppsdel i stället för färgen.
// Samma regler som shared/fabric.mjs (webbläsaren); tests/fabric.test.mjs kollar att de är lika.
// Äldre klienter känner inte till fältet och visar bara färgen.
const FAB = require('../shared/fabric.json');
// patches.mjs is ESM – inline cleaner (kept in sync with shared/patches.mjs; tests/patches.test.mjs).
const { makeEntitlements, fromHello, FREE_MAX_PLAYERS } = require('./entitlements');
const FAB_ID_RE = /^[a-f0-9]{16}$/;
function cleanFabricParam(name, v) {
  const p = FAB.params[name];
  let n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return p.def;
  n = p.wrap ? ((n % 360) + 360) % 360 : Math.min(p.max, Math.max(p.min, n));
  return round(n);
}
function cleanFabrics(fs) {
  if (!fs || typeof fs !== 'object' || Array.isArray(fs)) return null;
  const out = {};
  for (const s of FAB.slots) {
    const f = fs[s];
    if (!f || typeof f !== 'object' || Array.isArray(f) || typeof f.id !== 'string' || !FAB_ID_RE.test(f.id)) continue;
    const o = { id: f.id };
    for (const k of Object.keys(FAB.params)) o[k] = cleanFabricParam(k, f[k]);
    for (const k of FAB.flags) o[k] = f[k] === true;
    out[s] = o;
  }
  return Object.keys(out).length ? out : null;
}
function fabricField(fs) { const f = cleanFabrics(fs); return f ? { fabric: f } : {}; }
const cleanPitch = (n) => (isNum(n) ? round(clampN(n, -1.57, 1.57)) : 0);
function cleanPos(p, bounds) {
  if (!Array.isArray(p) || p.length !== 3 || !p.every(isNum)) return null;
  return [round(clampN(p[0], -bounds.x, bounds.x)), round(clampN(p[1], 0, bounds.y)), round(clampN(p[2], -bounds.z, bounds.z))];
}
// The sticker I am holding and aiming with (the see-through preview on the wall), for a running
// session recording only: { img, p, n, q, w, h, s, a? } or null (nothing held / not aiming at a wall).
// Returns undefined for anything malformed (dropped). Never passed on to the others live.
const r4 = (n) => Math.round(n * 1e4) / 1e4;
function unitVec(v, len) {
  if (!Array.isArray(v) || v.length !== len || !v.every(isNum)) return null;
  const m = Math.hypot(...v); if (!(m > 1e-6)) return null;
  return v.map((x) => r4(x / m));
}
function cleanHeld(h, bounds) {
  if (h === null) return null;
  if (!h || typeof h !== 'object' || typeof h.img !== 'string' || !/^[a-f0-9]{16}$/.test(h.img)) return undefined;
  const p = cleanPos(h.p, bounds), n = unitVec(h.n, 3), q = unitVec(h.q, 4);
  if (!p || !n || !q || !isNum(h.w) || !isNum(h.h)) return undefined;
  const s = typeof h.s === 'string' ? h.s.replace(/[\p{Cc}\p{Cf}]/gu, '').slice(0, 40) : '';
  // Pulling out a sticker row (arrays): a = { to } = the drag target B (it may lie past a wall's end:
  // the ray meets the anchor's plane out there, so only kept within ±50 m, not clamped to the room). p/n/q/s are
  // then the row's anchor and w × h one copy; the replay recomputes the row (shared/array.mjs).
  let a = null;
  if (h.a !== undefined && h.a !== null) {
    const v = h.a && typeof h.a === 'object' ? h.a.to : null;
    const to = Array.isArray(v) && v.length === 3 && v.every(isNum) ? v.map((x) => round(clampN(x, -50, 50))) : null;
    if (!to) return undefined;
    a = { to };
  }
  return { img: h.img, p, n, q, w: r4(clampN(h.w, 0.01, 4)), h: r4(clampN(h.h, 0.01, 4)), s, ...(a ? { a } : {}) };
}

// Enkel "hink" per anslutning: högst `rate` meddelanden per sekund i snitt, `burst` på en gång.
function bucket(rate, burst) {
  let tokens = burst, last = Date.now();
  return () => {
    const now = Date.now(); tokens = Math.min(burst, tokens + ((now - last) / 1000) * rate); last = now;
    if (tokens < 1) return false;
    tokens -= 1; return true;
  };
}

const CITY = require('../shared/city.mjs');

function attachRealtime(server, {
  maxPlayers = FREE_MAX_PLAYERS, path = '/ws', heartbeatMs = 15_000, maxPerIp = 30, clock = () => Date.now(),
  roomSize = require('../shared/room.json'), recorder = null, entitle = makeEntitlements(process.env), gate = null, onEmpty = null, onJoin = null,
} = {}) {
  const boxBounds = (b) => ({ x: b.width / 2, y: b.height, z: b.depth / 2 });
  // Where people may stand: the room box, but the City is its own 96 × 24 × 96 space (shared/city.mjs).
  const roomBounds = boxBounds(roomSize), cityBounds = boxBounds(CITY.CITY);
  const boundsOf = (c) => (c && CITY.isCityOutside(c.room) ? cityBounds : roomBounds); // every city's outside (t479u)
  const wss = new WebSocketServer({ noServer: true, maxPayload: 24 * 1024 }); // a look with custom sound patches can be ~10 kB
  const rooms = new Map(); // id -> { players: Map<id, client>, watchers: Set<client>, chat: [] }
  const perIp = new Map();

  const room = (id) => {
    if (!rooms.has(id)) rooms.set(id, { id, players: new Map(), watchers: [], chat: [], seats: new Map() }); // seats: chair prop id -> client id
    return rooms.get(id);
  };
  // Flags from a paid key arrive asynchronously (server/licenses.js); only ever replaces c.ent.
  const upgradeEnt = (c, creds, replace = false) => {
    const now = entitle(creds || {}); // already known (e.g. /api/unlock just checked it): right away
    if (replace || Object.values(now).some(Boolean)) c.ent = now;
    if (!entitle.check || !creds || typeof creds.key !== 'string') return;
    entitle.check(creds).then((ent) => { if (replace || Object.values(ent).some(Boolean)) c.ent = ent; }).catch(() => {});
  };
  const pub = (c) => ({ id: c.id, name: c.name, look: c.look, p: c.p, y: c.y, pi: c.pi || 0, slot: c.slot ?? 0, ...(c.sit ? { sit: { ...c.sit } } : {}) });
  // The lowest slot no other player in the room has.
  function takeSlot(c, r) {
    const used = new Set([...r.players.values()].filter((o) => o !== c).map((o) => o.slot));
    let n = 0; while (used.has(n)) n++;
    c.slot = n;
  }
  const rec = (roomId, e, data) => { if (recorder) recorder.log(roomId, e, data); };
  // Inspelningen frågar vilka som är i rummet när den startar (och om rummet står tomt).
  if (recorder) recorder.setPresence((id) => { const r = rooms.get(id); return r ? [...r.players.values()].map(pub) : []; });
  // Den som inte valt något namn heter "Guest N", med det lägsta lediga N i rummet.
  // Två i samma rum får därför aldrig samma gästnamn.
  function setName(c, r, wanted) {
    const chosen = cleanName(wanted);
    if (chosen && !GUEST_RE.test(chosen)) { c.guestNo = null; c.name = chosen; return; }
    if (!c.guestNo) {
      const used = new Set(everyone(r).filter((o) => o !== c && o.guestNo).map((o) => o.guestNo));
      let n = 1; while (used.has(n)) n++;
      c.guestNo = n;
    }
    c.name = `Guest ${c.guestNo}`;
  }
  const send = (c, msg) => { if (c.ws.readyState === 1) c.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); };
  const everyone = (r) => [...r.players.values(), ...r.watchers];
  const toRoom = (r, msg, except) => { const s = JSON.stringify(msg); for (const c of everyone(r)) if (c !== except) send(c, s); };

  const finder = (roomId, id) => {
    const r = rooms.get(roomId); if (!r) return null;
    const c = r.players.get(id) || r.watchers.find((w) => w.id === id);
    return c && c.p && c.ws.readyState === 1 ? { p: c.p.slice(), y: c.y, moves: c.moves || 0 } : null;
  };
  finders.add(finder);
  const seater = (roomId, id) => {
    const r = rooms.get(roomId); if (!r) return null;
    return { full: r.players.size >= maxPlayers, player: !!id && r.players.has(id), max: maxPlayers, count: r.players.size };
  };
  seaters.add(seater);
  listers.add(() => [...rooms.values()].filter((r) => r.players.size > 0).map((r) => ({ id: r.id, count: r.players.size, max: maxPlayers })));
  const off = onBroadcast((roomId, e) => {
    const list = roomId === '*' ? [...rooms.values()] : rooms.has(roomId) ? [rooms.get(roomId)] : [];
    for (const r of list) toRoom(r, { t: 'event', e });
  });

  function welcome(c, r) {
    send(c, { t: 'welcome', now: clock(), id: c.id, you: { id: c.id, name: c.name, slot: c.slot ?? 0 }, full: !c.player, ...(c.player ? {} : { fullText: fullText(maxPlayers) }), ...(c.extra || {}), max: maxPlayers, count: r.players.size,
      players: [...r.players.values()].filter((p) => p !== c).map(pub), chat: r.chat, rec: recorder ? recorder.status(r.id) : null });
  }
  // Någon gick: släpp in den som väntat längst (om rummet var fullt).
  function promote(r) {
    while (r.players.size < maxPlayers && r.watchers.length) {
      const c = r.watchers.shift();
      if (c.ws.readyState !== 1) continue;
      takeSlot(c, r); c.player = true; r.players.set(c.id, c);
      welcome(c, r);
      toRoom(r, { t: 'join', player: pub(c) }, c);
      rec(r.id, 'join', pub(c));
    }
  }
  function leave(c) {
    const r = rooms.get(c.room); if (!r) return;
    if (c.sit && r.seats.get(c.sit.chair) === c.id) r.seats.delete(c.sit.chair);
    c.sit = null;
    if (r.players.get(c.id) === c) { r.players.delete(c.id); rec(r.id, 'leave', { id: c.id }); toRoom(r, { t: 'leave', id: c.id, ...(c.replaced ? { rejoin: true } : {}) }); if (!c.replaced) promote(r); }
    r.watchers = r.watchers.filter((w) => w !== c);
    if (!r.players.size && !r.watchers.length) { rooms.delete(c.room); if (onEmpty) onEmpty(c.room); } // chatten glöms när rummet är tomt; tomma rum tas bort (server/emptyrooms.js)
  }

  function onMessage(c, raw) {
    if (!c.limit()) { if (++c.strikes > 200) c.ws.close(4008, 'Too many messages'); return; }
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    let r = room(c.room);
    if (m.t === 'ping') return send(c, { t: 'pong' });
    if (m.t === 'hello') {
      if (c.joined || c.admitting) return;
      if (gate) {
        c.admitting = true;
        Promise.resolve(gate.admit(c.room, m.pass && typeof m.pass === 'object' ? m.pass : {}, cleanName(m.name))).then((res) => {
          c.admitting = false;
          if (c.ws.readyState !== 1) return;
          if (!res || !res.ok) {
            send(c, { t: 'denied', code: (res && res.code) || 'invite', error: (res && res.error) || DENIED[(res && res.code) || 'invite'] || DENIED.invite });
            return c.ws.close(4003, 'Not admitted');
          }
          c.member = res.memberId;
          c.extra = { expiresAt: res.expiresAt, serverNow: new Date(clock()).toISOString(), member: res.memberId, ...(res.memberKey ? { pass: res.memberKey } : {}), ...(res.extra || {}) };
          hello(c, m);
        }).catch((e) => { c.admitting = false; console.error('[realtime] admit', e); try { c.ws.close(1011, 'Server error'); } catch { /* */ } });
        return;
      }
      return hello(c, m);
    }
    if (!c.joined) return;
    if (m.t === 'invite' && gate && gate.onMessage) {
      if (!c.inviteLimit()) return send(c, { t: 'error', error: 'Easy now – wait a bit.' });
      return gate.onMessage(c, m, { send: (msg) => send(c, msg) });
    }
    return onJoined(c, m, r);
  }
  function hello(c, m) {
    let r = room(c.room);
    {
      c.joined = true;
      // Samma flik som kopplar upp sig igen (sid = slumpat per sidladdning): den gamla, döda
      // anslutningen tas bort direkt, så ingen syns två gånger. Gästnumret behålls.
      c.sid = typeof m.sid === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(m.sid) ? m.sid : null;
      // The page this tab left a moment ago (prev = its sid; a door into a house, back out, a reload):
      // if its connection is still here – in ANY room – it goes now, so nobody sees a ghost of me (t481u).
      const prevSid = typeof m.prev === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(m.prev) && m.prev !== c.sid ? m.prev : null;
      if (prevSid) for (const rr of [...rooms.values()]) for (const o of everyone(rr)) if (o !== c && o.sid === prevSid) { leave(o); try { o.ws.close(4000, 'Replaced by a new connection'); } catch { /* */ } }
      r = room(c.room);
      const old = c.sid && everyone(r).find((o) => o !== c && o.sid === c.sid);
      if (old) {
        c.guestNo = old.guestNo; old.replaced = true;
        leave(old); try { old.ws.close(4000, 'Replaced by a new connection'); } catch { /* redan stängd */ }
        r = room(c.room);
      }
      // A kept city house (rebuild, Jens 10 Nov 2026, pt781u): at most HOUSE_MAX people – number five is
      // turned away (no watching), and the page sends them back out to pick another room.
      const houseMax = CITY.isPlotRoom(c.room) ? Math.min(CITY.HOUSE_MAX, maxPlayers) : 0;
      if (houseMax && r.players.size >= houseMax) {
        c.joined = false;
        send(c, { t: 'denied', code: 'house-full', house: CITY.houseNumber(c.room), max: houseMax, error: DENIED['house-full'] });
        if (!r.players.size && !r.watchers.length) rooms.delete(c.room);
        return c.ws.close(4003, 'House full');
      }
      setName(c, r, m.name);
      c.ent = entitle(fromHello(m));
      upgradeEnt(c, fromHello(m)); // a paid key we haven't seen yet: ask Lemon Squeezy, then upgrade
      c.look = cleanLook(m.look, c.ent);
      c.p = cleanPos(m.p, boundsOf(c)) || [0, 1.6, 3.5]; c.y = isNum(m.y) ? round(m.y) : 0; c.pi = cleanPitch(m.pi);
      if (r.players.size < maxPlayers) { takeSlot(c, r); c.player = true; r.players.set(c.id, c); } else r.watchers.push(c);
      if (onJoin) onJoin(c.room);
      welcome(c, r);
      if (c.player) { toRoom(r, { t: 'join', player: pub(c), ...(old ? { rejoin: true } : {}) }, c); rec(r.id, 'join', pub(c)); }
    }
  }
  function onJoined(c, m, r) {
    // "I have a key" in an open tab: new full-version flags without reconnecting.
    if (m.t === 'unlock') { if (c.lookLimit()) upgradeEnt(c, fromHello(m), true); return; }
    if (m.t === 'move') {
      if (!c.moveLimit()) return;
      const p = cleanPos(m.p, boundsOf(c)); if (!p) return;
      c.p = p; c.y = isNum(m.y) ? round(m.y) : c.y; c.pi = m.pi === undefined ? c.pi : cleanPitch(m.pi); c.moves = (c.moves || 0) + 1;
      if (!c.player) return; // den som väntar syns inte, men servern vet var den står (räckvidden med peels)
      rec(r.id, 'move', { id: c.id, p: c.p, y: c.y, pi: c.pi });
      return toRoom(r, { t: 'move', id: c.id, p: c.p, y: c.y, pi: c.pi }, c);
    }
    if (m.t === 'look') {
      if (!c.lookLimit()) return send(c, { t: 'error', error: 'Easy now – wait a bit before changing again.' });
      c.look = cleanLook(m.look, c.ent || {}); setName(c, r, m.name);
      send(c, { t: 'you', id: c.id, name: c.name }); // så jag vet vad de andra ser
      if (c.player) { toRoom(r, { t: 'look', id: c.id, name: c.name, look: c.look }, c); rec(r.id, 'look', { id: c.id, name: c.name, look: c.look }); }
      return;
    }
    if (m.t === 'chat') {
      if (!c.player) return send(c, { t: 'error', error: 'The room is full – you can read the chat but not write yet.' });
      const text = String(m.text || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, CHAT_MAX);
      if (!text) return;
      if (!c.chatLimit()) return send(c, { t: 'error', error: 'You are typing too fast – wait a few seconds.' });
      const msg = { id: crypto.randomBytes(6).toString('hex'), from: c.id, name: c.name, text, time: new Date(clock()).toISOString() };
      r.chat.push(msg); if (r.chat.length > CHAT_KEEP) r.chat.splice(0, r.chat.length - CHAT_KEEP);
      rec(r.id, 'chat', { id: c.id, name: c.name, text, mid: msg.id });
      return toRoom(r, { t: 'chat', msg });
    }
    if (m.t === 'talk') {
      // Voice loudness of MY OWN microphone (0…15), only while I talk (client/src/voice.js). Not
      // audio and not passed on to anyone: it only goes into a running session recording, where
      // it drives the mouth and the auto-director in the replay (shared/director.mjs).
      if (!c.player || !c.talkLimit()) return;
      const l = Math.round(Number(m.l));
      if (!Number.isFinite(l) || l < 0 || l > 15) return;
      return rec(r.id, 'talk', { id: c.id, l });
    }
    if (m.t === 'held') {
      // The sticker I hold and aim with (client/src/main.js sends it only while the room is being
      // recorded, ~8 a second while it moves, null when I stop holding/aiming). Like 'talk': only
      // into the recording (shared/replay.mjs heldAt), so replays and videos show it on the wall.
      if (!c.player || (m.h !== null && !c.heldLimit())) return; // a null (let go) always gets through
      const h = cleanHeld(m.h, boundsOf(c)); if (h === undefined) return;
      return rec(r.id, 'held', { id: c.id, h });
    }
    if (m.t === 'dance') {
      // Runway dance (shared/dance.mjs): one-shot; broadcast so others play it on this player's avatar.
      if (!c.player) return;
      if (m.stop === true) { // stopped early: only while a dance of theirs is on (bounded by the start limiter)
        if (!(c.danceUntil > Date.now())) return;
        c.danceUntil = 0;
        return toRoom(r, { t: 'dance', id: c.id, stop: true }, c);
      }
      if (!c.danceLimit()) return;
      // loop: true (Jens t814u) = it repeats every 4 bars until they stop it (X again, W/A/S/D) –
      // the stop stays relayable for as long as it is on.
      const loop = m.loop === true;
      c.danceUntil = loop ? Infinity : Date.now() + DANCE_MS;
      // Standing up if they were seated – the dance needs the floor.
      if (c.sit) {
        if (r.seats.get(c.sit.chair) === c.id) r.seats.delete(c.sit.chair);
        c.sit = null;
        toRoom(r, { t: 'sit', id: c.id, chair: null, draw: false });
      }
      // when (server-clock ms) + the clock it runs on, so every screen plays the same beats (shared/dance.mjs)
      const now = Date.now(), at = isNum(m.at) && Math.abs(m.at - now) < 5000 ? Math.round(m.at) : null;
      const sync = at !== null && isNum(m.bpm) && m.bpm >= 1 && m.bpm <= 120000 ? { at, bpm: round(m.bpm), phaseMs: isNum(m.phaseMs) ? round(clampN(m.phaseMs, -60000, 60000)) : 0 } : {};
      return toRoom(r, { t: 'dance', id: c.id, ...sync, ...(loop ? { loop: true } : {}) }, c);
    }
    if (m.t === 'sit') {
      // Sitting down on a chair (3D props): the chair is a prop id; one person per chair. null = stand up.
      if (!c.player || !c.sitLimit()) return;
      const chair = m.chair === null || m.chair === undefined ? null : (typeof m.chair === 'string' && /^[a-f0-9]{10}$/.test(m.chair) ? m.chair : undefined);
      if (chair === undefined) return;
      const draw = m.draw === true;
      if (chair && r.seats.has(chair) && r.seats.get(chair) !== c.id) return send(c, { t: 'sit', id: c.id, chair: null, draw: false, taken: chair });
      if (c.sit && c.sit.chair !== chair && r.seats.get(c.sit.chair) === c.id) r.seats.delete(c.sit.chair);
      c.sit = chair ? { chair, draw } : null;
      if (chair) r.seats.set(chair, c.id);
      return toRoom(r, { t: 'sit', id: c.id, chair, draw: chair ? draw : false });
    }
    if (m.t === 'signal') {
      // För röstchatt (WebRTC): skickas bara vidare till en spelare i samma rum.
      if (!c.player || !c.signalLimit() || typeof m.to !== 'string') return;
      const to = r.players.get(m.to); if (!to || to === c) return;
      const data = m.data; if (JSON.stringify(data ?? null).length > 12 * 1024) return;
      return send(to, { t: 'signal', from: c.id, data });
    }
  }

  wss.on('connection', (ws, req, roomId, ip) => {
    const c = {
      id: crypto.randomBytes(5).toString('hex'), ws, room: roomId, ip, joined: false, player: false, strikes: 0,
      limit: bucket(40, 80), moveLimit: bucket(20, 30), lookLimit: bucket(0.5, 5), chatLimit: bucket(0.5, 5), signalLimit: bucket(30, 60), inviteLimit: bucket(0.5, 10), talkLimit: bucket(15, 20), heldLimit: bucket(12, 20), sitLimit: bucket(2, 8), danceLimit: bucket(0.15, 2),
    };
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    ws.on('pong', () => { ws.klibbDead = false; });
    ws.on('message', (data, isBinary) => { ws.klibbDead = false; if (!isBinary) onMessage(c, data.toString()); });
    ws.on('close', () => { leave(c); const n = (perIp.get(ip) || 1) - 1; if (n) perIp.set(ip, n); else perIp.delete(ip); });
    ws.on('error', () => {});
  });

  function onUpgrade(req, socket, head) {
    let url; try { url = new URL(req.url, 'http://x'); } catch { return socket.destroy(); }
    if (url.pathname !== path) return; // någon annan får ta hand om den
    const roomId = String(url.searchParams.get('room') || '').toLowerCase();
    const ip = req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
    if (!ROOM_RE.test(roomId) || (perIp.get(ip) || 0) >= maxPerIp) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n'); return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, roomId, ip));
  }
  server.on('upgrade', onUpgrade);

  // Hjärtslag: servern pingar alla; den som inte svarat sedan förra pingen kopplas bort
  // (t.ex. en mobil som tappade nätet utan att säga hej då).
  const hb = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.klibbDead) { ws.terminate(); continue; }
      ws.klibbDead = true; ws.ping();
    }
  }, heartbeatMs);
  hb.unref();

  // City-bus TEST bots: synthetic players (no WebSocket). They show in welcome/join/move/leave
  // and count toward presence / "here right now". ws is always closed so send() is a no-op.
  function botClient({ id, roomId, name, look, p, y, slot }) {
    return {
      id, room: roomId, name: cleanName(name) || 'Bot', look: cleanLook(look || {}),
      p: Array.isArray(p) ? p.map(Number) : [0, 1.6, 12], y: Number(y) || 0, pi: 0,
      slot: Number.isInteger(slot) ? slot : 0, player: true, joined: true, bot: true,
      sit: null, guestNo: null, strikes: 0, moves: 0, ent: {},
      ws: { readyState: 3 }, // WebSocket.CLOSED
      limit: () => true, lookLimit: () => true, chatLimit: () => true,
      talkLimit: () => true, heldLimit: () => true, danceLimit: () => true,
    };
  }
  function injectBot(roomId, { id, name, look, p, y, slot } = {}) {
    if (!id || typeof id !== 'string') return null;
    const r = room(roomId);
    let c = r.players.get(id);
    if (c && c.bot) {
      if (name) setName(c, r, name);
      if (look) c.look = cleanLook(look);
      if (Array.isArray(p)) c.p = p.map(Number);
      if (y != null) c.y = Number(y) || 0;
      toRoom(r, { t: 'look', id: c.id, name: c.name, look: c.look });
      toRoom(r, { t: 'move', id: c.id, p: c.p, y: c.y, pi: 0 });
      return pub(c);
    }
    if (c) return null; // real player owns that id
    c = botClient({ id, roomId, name, look, p, y, slot });
    if (!Number.isInteger(slot)) takeSlot(c, r);
    r.players.set(c.id, c);
    toRoom(r, { t: 'join', player: pub(c) });
    rec(r.id, 'join', pub(c));
    return pub(c);
  }
  function moveBot(roomId, id, p, y) {
    const r = rooms.get(roomId); if (!r) return false;
    const c = r.players.get(id); if (!c || !c.bot || !Array.isArray(p)) return false;
    c.p = p.map(Number); c.y = Number(y) || 0; c.moves = (c.moves || 0) + 1;
    toRoom(r, { t: 'move', id: c.id, p: c.p, y: c.y, pi: 0 });
    return true;
  }
  function removeBot(roomId, id) {
    const r = rooms.get(roomId); if (!r) return false;
    const c = r.players.get(id); if (!c || !c.bot) return false;
    r.players.delete(id);
    toRoom(r, { t: 'leave', id });
    rec(r.id, 'leave', { id });
    if (!r.players.size && !r.watchers.length) { rooms.delete(roomId); if (onEmpty) onEmpty(roomId); }
    return true;
  }
  function listBots(roomId) {
    const r = rooms.get(roomId); if (!r) return [];
    return [...r.players.values()].filter((c) => c.bot).map(pub);
  }

  return {
    wss,
    injectBot, moveBot, removeBot, listBots,
    // Close a room for everyone (the demo's hour is up): they get the event first, then code 4010.
    closeRoom(roomId, event = { type: 'room:closed' }) {
      const r = rooms.get(roomId); if (!r) return 0;
      const all = everyone(r);
      toRoom(r, { t: 'event', e: event });
      for (const c of all) { try { c.ws.close(4010, 'Room closed'); } catch { /* */ } }
      return all.length;
    },
    occupied: (id) => { const r = rooms.get(id); return !!r && (r.players.size > 0 || r.watchers.length > 0); },
    stats: () => Object.fromEntries([...rooms.values()].map((r) => [r.id, { players: r.players.size, watchers: r.watchers.length, chat: r.chat.length }])),
    // Vid omstart: säg till alla att servern startar om (kod 1012), så de kopplar upp sig igen.
    close(code = 1012, reason = 'Servern startar om') {
      clearInterval(hb); off(); finders.delete(finder); seaters.delete(seater); server.off('upgrade', onUpgrade);
      for (const ws of wss.clients) ws.close(code, reason);
      wss.close();
    },
  };
}

module.exports = { cleanHeld, broadcast, onBroadcast, playerPosition, roomSeat, activeRooms, attachRealtime, cleanLook, cleanName, cleanFabrics, synthReady };

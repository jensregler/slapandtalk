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
//   server → klient: welcome {id, you, players, chat, max, full, rec} · join {player} · leave {id}
//                    move {id, p, y, pi} · look {id, name, look} · you {id, name} · chat {msg}
//                    event {e} · signal {from, data} · pong · error {error}
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

const ROOM_RE = /^[a-z0-9-]{1,40}$/;
const CHAT_KEEP = 50;
const CHAT_MAX = 300;
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const clampN = (n, a, b) => Math.min(b, Math.max(a, n));
const round = (n) => Math.round(n * 1000) / 1000;

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
function cleanLook(l, ent = ALL) {
  const d = AV.default; l = l && typeof l === 'object' ? l : {};
  const pick = (v, list, def) => (typeof v === 'string' && list.includes(v.toLowerCase()) ? v.toLowerCase() : def);
  return {
    outfit: AV.outfits[l.outfit] ? l.outfit : d.outfit,
    hair: AV.hair[l.hair] ? l.hair : d.hair,
    shirt: pick(l.shirt, AV.colors.shirt, d.shirt),
    pants: pick(l.pants, AV.colors.pants, d.pants),
    hairColor: pick(l.hairColor, AV.colors.hair, d.hairColor),
    skin: pick(l.skin, AV.colors.skin, d.skin),
    hat: l.hat === true,
    hatColor: pick(l.hatColor, AV.colors.hat, d.hatColor),
    ...(ent.fabrics ? fabricField(l.fabric) : {}),
    ...soundField(l.sound, ent),
  };
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
const { makeEntitlements, fromHello } = require('./entitlements');
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

// Enkel "hink" per anslutning: högst `rate` meddelanden per sekund i snitt, `burst` på en gång.
function bucket(rate, burst) {
  let tokens = burst, last = Date.now();
  return () => {
    const now = Date.now(); tokens = Math.min(burst, tokens + ((now - last) / 1000) * rate); last = now;
    if (tokens < 1) return false;
    tokens -= 1; return true;
  };
}

function attachRealtime(server, {
  maxPlayers = 10, path = '/ws', heartbeatMs = 15_000, maxPerIp = 30, clock = () => Date.now(),
  roomSize = require('../shared/room.json'), recorder = null, entitle = makeEntitlements(process.env), gate = null,
} = {}) {
  const bounds = { x: roomSize.width / 2, y: roomSize.height, z: roomSize.depth / 2 };
  const wss = new WebSocketServer({ noServer: true, maxPayload: 24 * 1024 }); // a look with custom sound patches can be ~10 kB
  const rooms = new Map(); // id -> { players: Map<id, client>, watchers: Set<client>, chat: [] }
  const perIp = new Map();

  const room = (id) => {
    if (!rooms.has(id)) rooms.set(id, { id, players: new Map(), watchers: [], chat: [] });
    return rooms.get(id);
  };
  // Flags from a paid key arrive asynchronously (server/licenses.js); only ever replaces c.ent.
  const upgradeEnt = (c, creds, replace = false) => {
    const now = entitle(creds || {}); // already known (e.g. /api/unlock just checked it): right away
    if (replace || Object.values(now).some(Boolean)) c.ent = now;
    if (!entitle.check || !creds || typeof creds.key !== 'string') return;
    entitle.check(creds).then((ent) => { if (replace || Object.values(ent).some(Boolean)) c.ent = ent; }).catch(() => {});
  };
  const pub = (c) => ({ id: c.id, name: c.name, look: c.look, p: c.p, y: c.y, pi: c.pi || 0, slot: c.slot ?? 0 });
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
  const off = onBroadcast((roomId, e) => {
    const list = roomId === '*' ? [...rooms.values()] : rooms.has(roomId) ? [rooms.get(roomId)] : [];
    for (const r of list) toRoom(r, { t: 'event', e });
  });

  function welcome(c, r) {
    send(c, { t: 'welcome', id: c.id, you: { id: c.id, name: c.name, slot: c.slot ?? 0 }, full: !c.player, ...(c.extra || {}), max: maxPlayers, count: r.players.size,
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
    if (r.players.get(c.id) === c) { r.players.delete(c.id); rec(r.id, 'leave', { id: c.id }); toRoom(r, { t: 'leave', id: c.id, ...(c.replaced ? { rejoin: true } : {}) }); if (!c.replaced) promote(r); }
    r.watchers = r.watchers.filter((w) => w !== c);
    if (!r.players.size && !r.watchers.length) rooms.delete(c.room); // chatten glöms när rummet är tomt
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
      const old = c.sid && everyone(r).find((o) => o !== c && o.sid === c.sid);
      if (old) {
        c.guestNo = old.guestNo; old.replaced = true;
        leave(old); try { old.ws.close(4000, 'Replaced by a new connection'); } catch { /* redan stängd */ }
        r = room(c.room);
      }
      setName(c, r, m.name);
      c.ent = entitle(fromHello(m));
      upgradeEnt(c, fromHello(m)); // a paid key we haven't seen yet: ask Lemon Squeezy, then upgrade
      c.look = cleanLook(m.look, c.ent);
      c.p = cleanPos(m.p, bounds) || [0, 1.6, 3.5]; c.y = isNum(m.y) ? round(m.y) : 0; c.pi = cleanPitch(m.pi);
      if (r.players.size < maxPlayers) { takeSlot(c, r); c.player = true; r.players.set(c.id, c); } else r.watchers.push(c);
      welcome(c, r);
      if (c.player) { toRoom(r, { t: 'join', player: pub(c), ...(old ? { rejoin: true } : {}) }, c); rec(r.id, 'join', pub(c)); }
    }
  }
  function onJoined(c, m, r) {
    // "I have a key" in an open tab: new full-version flags without reconnecting.
    if (m.t === 'unlock') { if (c.lookLimit()) upgradeEnt(c, fromHello(m), true); return; }
    if (m.t === 'move') {
      if (!c.moveLimit()) return;
      const p = cleanPos(m.p, bounds); if (!p) return;
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
      limit: bucket(40, 80), moveLimit: bucket(20, 30), lookLimit: bucket(0.5, 5), chatLimit: bucket(0.5, 5), signalLimit: bucket(30, 60), inviteLimit: bucket(0.5, 10), talkLimit: bucket(15, 20),
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

  return {
    wss,
    // Close a room for everyone (the demo's hour is up): they get the event first, then code 4010.
    closeRoom(roomId, event = { type: 'room:closed' }) {
      const r = rooms.get(roomId); if (!r) return 0;
      const all = everyone(r);
      toRoom(r, { t: 'event', e: event });
      for (const c of all) { try { c.ws.close(4010, 'Room closed'); } catch { /* */ } }
      return all.length;
    },
    stats: () => Object.fromEntries([...rooms.values()].map((r) => [r.id, { players: r.players.size, watchers: r.watchers.length, chat: r.chat.length }])),
    // Vid omstart: säg till alla att servern startar om (kod 1012), så de kopplar upp sig igen.
    close(code = 1012, reason = 'Servern startar om') {
      clearInterval(hb); off(); finders.delete(finder); server.off('upgrade', onUpgrade);
      for (const ws of wss.clients) ws.close(code, reason);
      wss.close();
    },
  };
}

module.exports = { broadcast, onBroadcast, playerPosition, attachRealtime, cleanLook, cleanName, cleanFabrics, synthReady };

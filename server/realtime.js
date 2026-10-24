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
//   klient → server: hello {name, look, p, y} · move {p, y} · look {name, look} · chat {text}
//                    ping · signal {to, data}  (signal = för röstchatt via WebRTC, se nedan)
//   server → klient: welcome {id, players, chat, max, full} · join {player} · leave {id}
//                    move {id, p, y} · look {id, name, look} · chat {msg} · event {e} · signal {from, data}
//                    pong · error {error}
//
// Röstchatt (nästa steg): ljudet går direkt mellan webbläsarna (WebRTC). Servern skickar
// bara vidare "signal"-meddelanden (offer/answer/ice) till en annan spelare i samma rum.
// Det finns redan här, så klienten kan byggas utan att servern behöver ändras.
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const AV = require('../shared/avatar.json');

const listeners = new Set();
// Anropas av app.js. roomId '*' = alla rum (t.ex. när admin tar bort en bild helt).
function broadcast(roomId, event) { for (const fn of listeners) fn(roomId, event); }
function onBroadcast(fn) { listeners.add(fn); return () => listeners.delete(fn); }

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
// "Gäst 3" är reserverat för gäster utan namn, så ingen kan låtsas vara en annan gäst.
const GUEST_RE = /^g[äa]st\s*\d*$/i;
// Gubbens utseende kontrolleras mot samma katalog som webbappen använder (shared/avatar.json).
function cleanLook(l) {
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
  };
}
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
  roomSize = require('../shared/room.json'),
} = {}) {
  const bounds = { x: roomSize.width / 2, y: roomSize.height, z: roomSize.depth / 2 };
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const rooms = new Map(); // id -> { players: Map<id, client>, watchers: Set<client>, chat: [] }
  const perIp = new Map();

  const room = (id) => {
    if (!rooms.has(id)) rooms.set(id, { id, players: new Map(), watchers: [], chat: [] });
    return rooms.get(id);
  };
  const pub = (c) => ({ id: c.id, name: c.name, look: c.look, p: c.p, y: c.y });
  // Den som inte valt något namn heter "Gäst N", med det lägsta lediga N i rummet.
  // Två i samma rum får därför aldrig samma gästnamn.
  function setName(c, r, wanted) {
    const chosen = cleanName(wanted);
    if (chosen && !GUEST_RE.test(chosen)) { c.guestNo = null; c.name = chosen; return; }
    if (!c.guestNo) {
      const used = new Set(everyone(r).filter((o) => o !== c && o.guestNo).map((o) => o.guestNo));
      let n = 1; while (used.has(n)) n++;
      c.guestNo = n;
    }
    c.name = `Gäst ${c.guestNo}`;
  }
  const send = (c, msg) => { if (c.ws.readyState === 1) c.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); };
  const everyone = (r) => [...r.players.values(), ...r.watchers];
  const toRoom = (r, msg, except) => { const s = JSON.stringify(msg); for (const c of everyone(r)) if (c !== except) send(c, s); };

  const off = onBroadcast((roomId, e) => {
    const list = roomId === '*' ? [...rooms.values()] : rooms.has(roomId) ? [rooms.get(roomId)] : [];
    for (const r of list) toRoom(r, { t: 'event', e });
  });

  function welcome(c, r) {
    send(c, { t: 'welcome', id: c.id, you: { id: c.id, name: c.name }, full: !c.player, max: maxPlayers, count: r.players.size,
      players: [...r.players.values()].filter((p) => p !== c).map(pub), chat: r.chat });
  }
  // Någon gick: släpp in den som väntat längst (om rummet var fullt).
  function promote(r) {
    while (r.players.size < maxPlayers && r.watchers.length) {
      const c = r.watchers.shift();
      if (c.ws.readyState !== 1) continue;
      c.player = true; r.players.set(c.id, c);
      welcome(c, r);
      toRoom(r, { t: 'join', player: pub(c) }, c);
    }
  }
  function leave(c) {
    const r = rooms.get(c.room); if (!r) return;
    if (r.players.get(c.id) === c) { r.players.delete(c.id); toRoom(r, { t: 'leave', id: c.id, ...(c.replaced ? { rejoin: true } : {}) }); if (!c.replaced) promote(r); }
    r.watchers = r.watchers.filter((w) => w !== c);
    if (!r.players.size && !r.watchers.length) rooms.delete(c.room); // chatten glöms när rummet är tomt
  }

  function onMessage(c, raw) {
    if (!c.limit()) { if (++c.strikes > 200) c.ws.close(4008, 'För många meddelanden'); return; }
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    let r = room(c.room);
    if (m.t === 'ping') return send(c, { t: 'pong' });
    if (m.t === 'hello') {
      if (c.joined) return;
      c.joined = true;
      // Samma flik som kopplar upp sig igen (sid = slumpat per sidladdning): den gamla, döda
      // anslutningen tas bort direkt, så ingen syns två gånger. Gästnumret behålls.
      c.sid = typeof m.sid === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(m.sid) ? m.sid : null;
      const old = c.sid && everyone(r).find((o) => o !== c && o.sid === c.sid);
      if (old) {
        c.guestNo = old.guestNo; old.replaced = true;
        leave(old); try { old.ws.close(4000, 'Ersatt av en ny anslutning'); } catch { /* redan stängd */ }
        r = room(c.room);
      }
      setName(c, r, m.name);
      c.look = cleanLook(m.look);
      c.p = cleanPos(m.p, bounds) || [0, 1.6, 3.5]; c.y = isNum(m.y) ? round(m.y) : 0;
      if (r.players.size < maxPlayers) { c.player = true; r.players.set(c.id, c); } else r.watchers.push(c);
      welcome(c, r);
      if (c.player) toRoom(r, { t: 'join', player: pub(c), ...(old ? { rejoin: true } : {}) }, c);
      return;
    }
    if (!c.joined) return;
    if (m.t === 'move') {
      if (!c.player || !c.moveLimit()) return;
      const p = cleanPos(m.p, bounds); if (!p) return;
      c.p = p; c.y = isNum(m.y) ? round(m.y) : c.y;
      return toRoom(r, { t: 'move', id: c.id, p: c.p, y: c.y }, c);
    }
    if (m.t === 'look') {
      if (!c.lookLimit()) return send(c, { t: 'error', error: 'Lugn i stormen – vänta lite innan du byter igen.' });
      c.look = cleanLook(m.look); setName(c, r, m.name);
      send(c, { t: 'you', id: c.id, name: c.name }); // så jag vet vad de andra ser
      if (c.player) toRoom(r, { t: 'look', id: c.id, name: c.name, look: c.look }, c);
      return;
    }
    if (m.t === 'chat') {
      if (!c.player) return send(c, { t: 'error', error: 'Rummet är fullt – du kan läsa chatten men inte skriva än.' });
      const text = String(m.text || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, CHAT_MAX);
      if (!text) return;
      if (!c.chatLimit()) return send(c, { t: 'error', error: 'Du skriver för snabbt – vänta några sekunder.' });
      const msg = { id: crypto.randomBytes(6).toString('hex'), from: c.id, name: c.name, text, time: new Date(clock()).toISOString() };
      r.chat.push(msg); if (r.chat.length > CHAT_KEEP) r.chat.splice(0, r.chat.length - CHAT_KEEP);
      return toRoom(r, { t: 'chat', msg });
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
      limit: bucket(40, 80), moveLimit: bucket(20, 30), lookLimit: bucket(0.5, 5), chatLimit: bucket(0.5, 5), signalLimit: bucket(30, 60),
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
    stats: () => Object.fromEntries([...rooms.values()].map((r) => [r.id, { players: r.players.size, watchers: r.watchers.length, chat: r.chat.length }])),
    // Vid omstart: säg till alla att servern startar om (kod 1012), så de kopplar upp sig igen.
    close(code = 1012, reason = 'Servern startar om') {
      clearInterval(hb); off(); server.off('upgrade', onUpgrade);
      for (const ws of wss.clients) ws.close(code, reason);
      wss.close();
    },
  };
}

module.exports = { broadcast, onBroadcast, attachRealtime, cleanLook, cleanName };

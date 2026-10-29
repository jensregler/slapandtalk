// Flerspelarläget i webbläsaren: en WebSocket till servern (/ws?room=<rum>, se server/realtime.js).
// Den kopplar upp sig igen av sig själv om anslutningen bryts (t.ex. när servern på Render
// vaknar eller startar om): först efter en halv sekund, sedan längre och längre (max 10 s).
//
// handlers: {
//   hello()            → { name, look, p, y, pi }   (pi = blicken upp/ner)   (skickas varje gång vi ansluter)
//   onWelcome(m)       → vi är inne (m.full = rummet var fullt, vi tittar bara på)
//   onJoin(player), onLeave(id), onMove(id, p, y), onLook(id, name, look)
//   onChat(msg), onEvent(e)  (stamp:add, stamp:remove, image:remove, room:style)
//   onSignal(from, data)     (för röstchatt, nästa steg)
//   onStatus(status)   → 'connecting' | 'online' | 'full' | 'offline'
//   onReconnect()      → anslutningen kom tillbaka efter ett avbrott (hämta det vi missat)
//   onError(text)
// }
export function connect(roomId, handlers) {
  const h = { hello: () => ({}), ...handlers };
  const noop = () => {};
  for (const k of ['onDenied', 'onInvite', 'onYou', 'onWelcome', 'onJoin', 'onLeave', 'onMove', 'onLook', 'onChat', 'onEvent', 'onSignal', 'onStatus', 'onReconnect', 'onError']) h[k] = h[k] || noop;
  // Slumpas per sidladdning: kopplar samma flik upp sig igen vet servern att den gamla
  // anslutningen är död och tar bort den direkt (annars kunde man synas två gånger en stund).
  const sid = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  let deniedCode = null, ws = null, closed = false, attempt = 0, timer = null, lastMsg = 0, everOnline = false, status = 'offline', myId = null;
  const setStatus = (s) => { if (s !== status) { status = s; h.onStatus(s); } };
  const url = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?room=${encodeURIComponent(roomId)}`;
  const send = (m) => { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; } return false; };

  // h.ready (optional): () => a promise to wait for before the very first connect (main.js: the room info +
  // entitlements, so my first hello already carries the look I have in this room – the preset-room character).
  let gated = typeof h.ready === 'function';
  function open() {
    clearTimeout(timer); timer = null;
    if (gated || closed || (ws && ws.readyState <= 1)) return;
    setStatus('connecting');
    let sock;
    try { sock = new WebSocket(url()); } catch { schedule(); return; }
    ws = sock;
    sock.onopen = () => { lastMsg = Date.now(); send({ t: 'hello', ...h.hello(), sid }); };
    sock.onmessage = (ev) => {
      lastMsg = Date.now();
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      switch (m.t) {
        case 'welcome': {
          attempt = 0; myId = m.id;
          const again = everOnline; everOnline = true;
          setStatus(m.full ? 'full' : 'online');
          h.onWelcome(m);
          if (again) h.onReconnect();
          break;
        }
        case 'you': h.onYou(m.name); break;
        case 'join': h.onJoin(m.player, !!m.rejoin); break;
        case 'leave': h.onLeave(m.id, !!m.rejoin); break;
        case 'move': h.onMove(m.id, m.p, m.y); break;
        case 'look': h.onLook(m.id, m.name, m.look); break;
        case 'chat': h.onChat(m.msg); break;
        case 'event': h.onEvent(m.e); break;
        case 'signal': h.onSignal(m.from, m.data); break;
        case 'error': h.onError(m.error); break;
        case 'denied': deniedCode = m.code || 'invite'; h.onDenied(m); break; // demo: not let in (no retry)
        case 'invite': h.onInvite(m); break;
        default: break; // pong m.m.
      }
    };
    sock.onclose = (ev) => {
      if (ws !== sock) return;
      ws = null; myId = null;
      if (closed) return;
      // 4003 = not let in (demo invite rules), 4010 = the room has closed: trying again won't help.
      if (ev && (ev.code === 4003 || ev.code === 4010)) { closed = true; setStatus(ev.code === 4010 ? 'closed' : 'denied'); h.onLeave('*'); return; }
      setStatus('offline'); h.onLeave('*'); // alla andra försvinner tills vi är tillbaka
      schedule();
    };
    sock.onerror = () => {};
  }
  function schedule() {
    if (closed || timer) return;
    const d = Math.min(10_000, 500 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
    attempt = Math.min(attempt + 1, 6);
    timer = setTimeout(open, d);
  }
  // Hjärtslag: vi pingar var 15:e sekund. Har vi inte hört något på 40 s är anslutningen
  // död (fast webbläsaren inte märkt det), så vi stänger och kopplar upp oss igen.
  const hb = setInterval(() => {
    if (!ws || ws.readyState !== 1) return;
    send({ t: 'ping' });
    if (Date.now() - lastMsg > 40_000) ws.close();
  }, 15_000);
  // Kommer nätet tillbaka, eller blir fliken synlig igen: försök direkt.
  const now = () => { if (!closed && (!ws || ws.readyState > 1)) { attempt = 0; open(); } };
  addEventListener('online', now);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') now(); });
  setTimeout(() => { // först när den som anropade är klar med sin egen start
    if (!gated) { open(); return; }
    Promise.resolve().then(h.ready).catch(() => {}).finally(() => { gated = false; open(); });
  }, 0);

  return {
    get id() { return myId; },
    get status() { return status; },
    sendMove: (p, y, pi = 0) => send({ t: 'move', p, y, pi }),
    sendLook: (name, look) => send({ t: 'look', name, look }),
    sendChat: (text) => send({ t: 'chat', text }),
    sendUnlock: (unlock) => send({ t: 'unlock', unlock }), // new full-version key in this tab
    sendSignal: (to, data) => send({ t: 'signal', to, data }), // voice chat (voice.js)
    sendTalk: (l) => send({ t: 'talk', l }), // my own voice level 0…15 while I talk (recordings only)
    sendHeld: (h) => send({ t: 'held', h }), // the sticker I hold and aim with, or null (recordings only)
    sendInvite: (action = 'create') => send({ t: 'invite', action }), // demo: my single-use invite link
    get denied() { return deniedCode; },
    reconnectNow: now,
    close() { closed = true; clearInterval(hb); clearTimeout(timer); if (ws) ws.close(); },
  };
}

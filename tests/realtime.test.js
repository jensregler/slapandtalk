// Tester av flerspelarläget på servern (WebSocket), utan webbläsare.
// Körs med: node tests/realtime.test.js (ingår i npm test)
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const WebSocket = require('ws');
const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { attachRealtime } = require('../server/realtime');

const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// En testklient: samlar alla meddelanden och kan vänta på ett visst.
function client(base, room, hello = {}) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?room=${room}`);
  const c = { ws, msgs: [], closed: null };
  ws.on('message', (d) => c.msgs.push(JSON.parse(d.toString())));
  ws.on('close', (code) => { c.closed = code; });
  c.send = (m) => ws.send(JSON.stringify(m));
  c.wait = async (pred, ms = 2000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const m = c.msgs.find(pred); if (m) return m; await sleep(10); }
    return null;
  };
  c.ready = new Promise((r) => ws.on('open', r)).then(() => { if (hello) c.send({ t: 'hello', ...hello }); });
  return c;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-rt-'));
  const store = createStore(new LocalAdapter(dir));
  const app = createApp(store, { adminToken: 'hemligt-test' });
  const server = app.listen(0);
  const rt = attachRealtime(server, { maxPlayers: 3, heartbeatMs: 200 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const all = [];
  const join = (room, hello) => { const c = client(base, room, hello); all.push(c); return c; };
  try {
    // ---------- Gå in, se varandra, röra sig, gå ----------
    const a = join('rum1', { name: 'Anna', look: { outfit: 'kostym', shirt: '#e63946', hair: 'tupp' }, p: [1, 1.6, 2], y: 0.5 });
    await a.ready;
    const wa = await a.wait((m) => m.t === 'welcome');
    assert(wa && !wa.full && wa.players.length === 0 && wa.max === 3, 'första spelaren kommer in i ett tomt rum');
    const b = join('rum1', { name: '<b>Bosse</b>\u0007', look: { outfit: 'finns-inte', shirt: 'red', hat: 'ja' } });
    await b.ready;
    const wb = await b.wait((m) => m.t === 'welcome');
    const ja = await a.wait((m) => m.t === 'join');
    assert(wb.players.length === 1 && wb.players[0].name === 'Anna' && wb.players[0].look.outfit === 'kostym' && wb.players[0].look.shirt === '#e63946'
      && JSON.stringify(wb.players[0].p) === '[1,1.6,2]', 'den som kommer in ser vem som redan är där, med gubbe och position');
    assert(ja && ja.player.name === '<b>Bosse</b>' && ja.player.look.outfit === 'tshirt' && ja.player.look.shirt === '#3a86ff' && ja.player.look.hat === false,
      'namn rensas från kontrolltecken (HTML escapas i webbläsaren), okänt utseende blir standard');
    b.send({ t: 'move', p: [2, 1.6, -3], y: 1.25 });
    b.send({ t: 'move', p: [999, -5, 'x'], y: 1 });
    b.send({ t: 'move', p: [99, 1.6, -99], y: 1 });
    const mv = await a.wait((m) => m.t === 'move' && m.p[0] === 2);
    const clamped = await a.wait((m) => m.t === 'move' && m.p[0] === 5);
    assert(mv && mv.id === wb.id && mv.y === 1.25 && clamped && clamped.p[2] === -5 && !a.msgs.some((m) => m.t === 'move' && m.p.includes(999)),
      'positioner skickas vidare; felaktiga ignoreras och utanför rummet hålls inne i rummet');
    assert(!b.msgs.some((m) => m.t === 'move'), 'man får inte tillbaka sina egna positioner');
    // ---------- Gubbe byts ----------
    a.send({ t: 'look', name: 'Anna B', look: { outfit: 'punk', hair: 'lang', shirt: '#ffd400', hat: true, hatColor: '#222222' } });
    const lk = await b.wait((m) => m.t === 'look');
    assert(lk && lk.name === 'Anna B' && lk.look.outfit === 'punk' && lk.look.hat === true && lk.look.hatColor === '#222222', 'ny gubbe syns för de andra direkt');

    // ---------- Stämplar och peel via HTTP syns direkt via WebSocket ----------
    const png = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#ff00ff' } }).png().toBuffer();
    const fd = new FormData(); fd.append('file', new Blob([png], { type: 'image/png' }), 'k.png');
    const img = await (await fetch(`${base}/api/stickers`, { method: 'POST', body: fd })).json();
    const other = join('rum2', { name: 'Annan' }); await other.ready; await other.wait((m) => m.t === 'welcome');
    const st = await (await fetch(`${base}/api/rooms/rum1/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId: img.id, position: [0, 1, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.3, surface: 'vägg-norr' }) })).json();
    const ev = await b.wait((m) => m.t === 'event' && m.e.type === 'stamp:add');
    const raw = JSON.stringify(b.msgs);
    assert(ev && ev.e.stamp.id === st.stamp.id && ev.e.image.id === img.id && !raw.includes(st.peelToken) && !raw.includes('peelHash'),
      'ny stämpel skickas till alla i rummet direkt (med bilden, aldrig peel-nyckeln)');
    await sleep(100);
    assert(!other.msgs.some((m) => m.t === 'event'), 'andra rum får inga händelser från det här rummet');
    await fetch(`${base}/api/rooms/rum1/stamps/${st.stamp.id}/peel`, { method: 'DELETE', headers: { 'x-peel-token': st.peelToken } });
    const rm = await a.wait((m) => m.t === 'event' && m.e.type === 'stamp:remove');
    assert(rm && rm.e.id === st.stamp.id && !JSON.stringify(a.msgs).includes(st.peelToken), 'peel syns för alla direkt');
    const created = await (await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ style: { floor: 'betong', wall: 'tegel', ceiling: 'vit' } }) })).json();
    const sc = join(created.room.id, { name: 'Skaparen' }); await sc.ready; await sc.wait((m) => m.t === 'welcome');
    await fetch(`${base}/api/rooms/${created.room.id}/style`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-room-key': created.roomKey }, body: JSON.stringify({ style: { floor: 'parkett', wall: 'puts', ceiling: 'vit' } }) });
    const se = await sc.wait((m) => m.t === 'event' && m.e.type === 'room:style');
    assert(se && se.e.style.floor === 'parkett' && !JSON.stringify(sc.msgs).includes(created.roomKey), 'nytt utseende på rummet syns direkt (rumsnyckeln skickas aldrig)');
    await fetch(`${base}/api/stickers/${img.id}`, { method: 'DELETE', headers: { 'x-admin-token': 'hemligt-test' } });
    const ir = await other.wait((m) => m.t === 'event' && m.e.type === 'image:remove');
    assert(ir && ir.e.id === img.id && (await a.wait((m) => m.t === 'event' && m.e.type === 'image:remove')), 'admin tar bort en bild: alla rum får veta det direkt');

    // ---------- Chatt ----------
    a.send({ t: 'chat', text: '  <img src=x onerror=alert(1)> hej  ' });
    const ch = await b.wait((m) => m.t === 'chat');
    assert(ch && ch.msg.text === '<img src=x onerror=alert(1)> hej' && ch.msg.name === 'Anna B' && ch.msg.from === wa.id && /T/.test(ch.msg.time),
      'chattmeddelande når alla med namn och tid (texten skickas som den är, webbläsaren visar den som text)');
    a.send({ t: 'chat', text: 'x'.repeat(1000) });
    const long = await b.wait((m) => m.t === 'chat' && m.msg.text.startsWith('xxx'));
    assert(long && long.msg.text.length === 300, 'för långa meddelanden kortas till 300 tecken');
    for (let i = 0; i < 8; i++) a.send({ t: 'chat', text: `spam ${i}` });
    await sleep(300);
    const spam = b.msgs.filter((m) => m.t === 'chat' && m.msg.text.startsWith('spam')).length;
    assert(spam >= 2 && spam < 8 && a.msgs.some((m) => m.t === 'error' && /för snabbt/.test(m.error)), `chatten har en spärr mot spam (${spam} av 8 kom fram)`);
    // ---------- Fullt rum ----------
    const c3 = join('rum1', { name: 'Tredje' }); await c3.ready;
    const w3 = await c3.wait((m) => m.t === 'welcome');
    assert(w3 && !w3.full && w3.chat.length >= 3 && w3.chat.length <= 50, 'den som kommer in senare får de senaste chattmeddelandena');
    const c4 = join('rum1', { name: 'Fjärde' }); await c4.ready;
    const w4 = await c4.wait((m) => m.t === 'welcome');
    await sleep(100);
    assert(w4 && w4.full && w4.players.length === 3 && !a.msgs.some((m) => m.t === 'join' && m.player.name === 'Fjärde'), 'rummet är fullt (max 3 här): den fjärde får titta men syns inte');
    c4.send({ t: 'chat', text: 'får jag skriva?' }); c4.send({ t: 'move', p: [0, 1.6, 0], y: 0 });
    await sleep(150);
    assert(!a.msgs.some((m) => m.t === 'chat' && m.msg.text === 'får jag skriva?') && c4.msgs.some((m) => m.t === 'error' && /fullt/.test(m.error)), 'den som tittar kan inte chatta eller synas');
    c3.ws.close();
    const promoted = await c4.wait((m) => m.t === 'welcome' && !m.full);
    const pj = await a.wait((m) => m.t === 'join' && m.player.name === 'Fjärde');
    assert(promoted && pj && (await a.wait((m) => m.t === 'leave' && m.id === w3.id)), 'när någon går kommer den som väntade in automatiskt');
    // ---------- Röstchatt-signaler (för nästa steg) ----------
    a.send({ t: 'signal', to: wb.id, data: { kind: 'offer', sdp: 'v=0' } });
    const sig = await b.wait((m) => m.t === 'signal');
    await sleep(100);
    assert(sig && sig.from === wa.id && sig.data.kind === 'offer' && !c4.msgs.some((m) => m.t === 'signal'), 'signaler (för röstchatt) går bara till den de är till');
    // ---------- Skräp och för många meddelanden ----------
    b.ws.send('inte json'); b.send({ t: 'okänd' }); b.send({ t: 'hello', name: 'igen' });
    await sleep(100);
    assert(b.ws.readyState === 1, 'skräpmeddelanden ignoreras utan att anslutningen bryts');
    const flood = join('rum3', { name: 'Flood' }); await flood.ready; await flood.wait((m) => m.t === 'welcome');
    for (let i = 0; i < 400; i++) flood.send({ t: 'ping' });
    await sleep(300);
    assert(flood.closed === 4008, 'den som skickar hundratals meddelanden i sekunden kopplas bort');
    const big = join('rum3', { name: 'Stor' }); await big.ready; await big.wait((m) => m.t === 'welcome');
    big.ws.send(JSON.stringify({ t: 'chat', text: 'x'.repeat(20000) }));
    await sleep(200);
    assert(big.closed === 1009, 'för stora meddelanden (över 16 kB) stänger anslutningen');
    const bad = new WebSocket(`${base.replace('http', 'ws')}/ws?room=OGILTIGT/../x`);
    const badRes = await new Promise((r) => { bad.on('error', () => r('nekad')); bad.on('open', () => r('öppen')); });
    assert(badRes === 'nekad', 'ogiltigt rum nekas');
    // ---------- Hjärtslag: en klient som inte svarar kopplas bort ----------
    const dead = join('rum3', { name: 'Död' }); await dead.ready; await dead.wait((m) => m.t === 'welcome');
    dead.ws.pong = () => {}; dead.ws._receiver.removeAllListeners('ping'); dead.ws._receiver.on('ping', () => {});
    await sleep(700);
    assert(dead.closed !== null, 'en anslutning som slutat svara (hjärtslag) städas bort');
    // ---------- Namn: gästnamn är unika, valda namn syns direkt, städas ----------
    const g1 = join('namn', { name: '' }); await g1.ready; const wg1 = await g1.wait((m) => m.t === 'welcome');
    const g2 = join('namn', { name: '   ' }); await g2.ready; const wg2 = await g2.wait((m) => m.t === 'welcome');
    const g3 = join('namn', { name: 'gäst 1' }); await g3.ready; const wg3 = await g3.wait((m) => m.t === 'welcome');
    assert(wg1.you.name === 'Gäst 1' && wg2.you.name === 'Gäst 2' && wg3.you.name === 'Gäst 3' && wg3.players.map((p) => p.name).join() === 'Gäst 1,Gäst 2',
      'gäster utan namn får olika namn (Gäst 1, 2, 3), och ingen kan välja namnet "Gäst 1"');
    g2.send({ t: 'look', name: '  Ulla \u202e\u200b  ', look: {} });
    const ul = await g1.wait((m) => m.t === 'look' && m.id === wg2.id);
    const you = await g2.wait((m) => m.t === 'you');
    assert(ul && ul.name === 'Ulla' && you.name === 'Ulla', 'valt namn ("Ulla") syns för de andra direkt när man sparar, städat från mellanslag och osynliga tecken');
    const g4 = join('namn', { name: '' }); await g4.ready; const wg4 = await g4.wait((m) => m.t === 'welcome');
    assert(wg4.you.name === 'Gäst 2' && wg4.players.some((p) => p.name === 'Ulla'), 'den som kommer in senare ser "Ulla", och det lediga gästnumret används igen');
    g2.send({ t: 'look', name: '', look: {} });
    const back = await g1.wait((m) => m.t === 'look' && m.id === wg2.id && m.name !== 'Ulla');
    assert(back && /^Gäst \d+$/.test(back.name) && back.name !== 'Gäst 2' && back.name !== 'Gäst 1' && back.name !== 'Gäst 3', `tar man bort sitt namn blir man en gäst med ett eget nummer (${back && back.name})`);
    g3.send({ t: 'look', name: 'A'.repeat(23) + '😀😀', look: {} });
    const em = await g1.wait((m) => m.t === 'look' && m.id === wg3.id);
    assert(em && Array.from(em.name).length === 24 && em.name.endsWith('😀') && !/[\uD800-\uDBFF]$/.test(em.name), 'namn kortas till 24 tecken utan att en emoji klipps itu');
    // Samma flik kopplar upp sig igen (samma sid): den gamla anslutningen ersätts, ingen syns två gånger
    const s1 = join('namn2', { name: 'Kalle', sid: 'flik-abcdef123' }); await s1.ready; const ws1 = await s1.wait((m) => m.t === 'welcome');
    const watcher = join('namn2', { name: 'Tittare' }); await watcher.ready; await watcher.wait((m) => m.t === 'welcome');
    const s2 = join('namn2', { name: 'Kalle', sid: 'flik-abcdef123' }); await s2.ready; const ws2 = await s2.wait((m) => m.t === 'welcome');
    const gone = await watcher.wait((m) => m.t === 'leave' && m.id === ws1.id);
    await sleep(150);
    assert(gone && gone.rejoin && s1.closed === 4000 && ws2.players.length === 1 && watcher.msgs.filter((m) => m.t === 'join' && m.player.name === 'Kalle').length === 1,
      'samma flik som kopplar upp sig igen ersätter sin gamla anslutning (ingen dubbelgångare, inga "gick/kom in"-rader)');


    rt.close();
    await sleep(150);
    assert(a.closed === 1012 && b.closed === 1012, 'vid omstart får alla koden 1012 (startar om), så de kopplar upp sig igen');
  } finally {
    for (const c of all) try { c.ws.terminate(); } catch { /* redan stängd */ }
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('Alla flerspelartester gick igenom.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

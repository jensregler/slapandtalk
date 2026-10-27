// The free version's room limit (FREE_MAX_PLAYERS = 4: four walls, one each), without a browser:
// four get in, the fifth only watches (no avatar, no chat, no slapping – the server refuses its
// stamps with 409 full) and gets in by itself when someone leaves. Also: the demo uses the same
// number, and MAX_PLAYERS_PER_ROOM can only lower it. Run with: node tests/roomlimit.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const WebSocket = require('ws');
const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { attachRealtime } = require('../server/realtime');
const { FREE_MAX_PLAYERS, maxPlayersFor } = require('../server/entitlements');
const { demoSettings } = require('../server/demo');

const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client(base, room, hello = {}) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?room=${room}`);
  const c = { ws, msgs: [], closed: null };
  ws.on('message', (d) => c.msgs.push(JSON.parse(d.toString())));
  ws.on('close', (code) => { c.closed = code; });
  c.send = (m) => ws.send(JSON.stringify(m));
  c.wait = async (pred, ms = 2000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = c.msgs.find(pred); if (m) return m; await sleep(10); } return null; };
  c.ready = new Promise((r) => ws.on('open', r)).then(() => { if (hello) c.send({ t: 'hello', ...hello }); });
  return c;
}

(async () => {
  // ---------- The number ----------
  assert(FREE_MAX_PLAYERS === 4, 'the free version: 4 per room (one wall each)');
  assert(maxPlayersFor({}) === 4 && maxPlayersFor({ MAX_PLAYERS_PER_ROOM: '10' }) === 4 && maxPlayersFor({ MAX_PLAYERS_PER_ROOM: '2' }) === 2 && maxPlayersFor({ MAX_PLAYERS_PER_ROOM: 'x' }) === 4,
    'MAX_PLAYERS_PER_ROOM can only lower it (Render\'s old "10" no longer raises it)');
  const demo = demoSettings({ DEMO_PROFILE: '1' });
  assert(demo.maxPlayers === FREE_MAX_PLAYERS && demo.maxMembers === FREE_MAX_PLAYERS, 'the demo (DEMO_PROFILE=1): 4 per room and 4 members (creator + 3 invites), same constant');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-limit-'));
  const store = createStore(new LocalAdapter(dir));
  const app = createApp(store, { adminToken: 'hemligt-test' });
  const server = app.listen(0);
  const rt = attachRealtime(server, { heartbeatMs: 300 }); // no maxPlayers: the default is the free limit
  const base = `http://127.0.0.1:${server.address().port}`;
  const all = [];
  const join = (room, name) => { const c = client(base, room, { name }); all.push(c); return c; };
  try {
    const png = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#00ff88' } }).png().toBuffer();
    const fd = new FormData(); fd.append('file', new Blob([png], { type: 'image/png' }), 'k.png');
    const img = await (await fetch(`${base}/api/stickers`, { method: 'POST', body: fd })).json();
    const slap = (by, headers = {}) => fetch(`${base}/api/rooms/rum4/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ imageId: img.id, position: [0, 1, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.3, surface: 'vägg-norr', ...(by ? { by } : {}) }) });

    // ---------- Four get in ----------
    const four = [];
    for (const n of ['Anna', 'Bosse', 'Cilla', 'Dante']) { const c = join('rum4', n); await c.ready; const w = await c.wait((m) => m.t === 'welcome'); four.push({ c, w }); }
    assert(four.every(({ w }) => w && !w.full && w.max === 4) && new Set(four.map(({ w }) => w.you.slot)).size === 4, 'four people get in as players, each with their own slot (0–3), max 4');

    // ---------- The fifth only watches ----------
    const e = join('rum4', 'Edvin'); await e.ready;
    const we = await e.wait((m) => m.t === 'welcome');
    assert(we && we.full === true && we.max === 4 && we.count === 4 && /full \(4 people max/.test(we.fullText || ''), `the fifth is not let in as a participant: welcome full, with a clear message ("${we && we.fullText}")`);
    await sleep(100);
    assert(!four[0].c.msgs.some((m) => m.t === 'join' && m.player.name === 'Edvin'), 'nobody sees a fifth avatar join');
    e.send({ t: 'chat', text: 'hej' });
    const err = await e.wait((m) => m.t === 'error');
    assert(err && /full/.test(err.error) && !four[0].c.msgs.some((m) => m.t === 'chat'), 'the fifth cannot chat');
    const r5 = await slap(we.id);
    const j5 = await r5.json();
    assert(r5.status === 409 && j5.full === true && /full \(4 people max/.test(j5.error), `the fifth cannot slap: 409 full ("${j5.error}")`);
    const rAnon = await slap(null);
    assert(rAnon.status === 409, 'a slap with no player id while the room is full is refused too (can\'t get around it)');
    const rIn = await slap(four[1].w.id);
    assert(rIn.status === 200, 'the four inside slap as usual');
    // Sticker arrays (POST …/stamps/array) follow the same full-room rule.
    const anc = await rIn.json();
    const row = (by) => fetch(`${base}/api/rooms/rum4/stamps/array`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anchor: { id: anc.stamp.id, token: anc.peelToken }, to: [1.2, 1, -5], ...(by ? { by } : {}) }) });
    const rRow5 = await row(we.id), jRow5 = await rRow5.json();
    assert(rRow5.status === 409 && jRow5.full === true, 'the fifth cannot drag out a sticker array either: …/stamps/array answers 409 full');
    assert((await row(null)).status === 409, '…nor without a player id');
    const rRowIn = await row(four[1].w.id), jRowIn = await rRowIn.json();
    assert(rRowIn.status === 200 && jRowIn.stamps && jRowIn.stamps.length > 0, `the four inside drag out arrays as usual (${jRowIn.stamps && jRowIn.stamps.length} copies)`);
    const rAdmin = await slap(null, { 'x-admin-token': 'hemligt-test' });
    assert(rAdmin.status === 200, 'admin is not limited');
    const other = await fetch(`${base}/api/rooms/annat-rum/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId: img.id, position: [0, 1, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.3, surface: 'vägg-norr' }) });
    assert(other.status === 200, 'a room that is not full (nobody connected) works like before');

    // ---------- Someone leaves: the slot frees up ----------
    four[2].c.ws.close();
    const promoted = await e.wait((m) => m.t === 'welcome' && m.full === false, 3000);
    const seen = await four[0].c.wait((m) => m.t === 'join' && m.player.name === 'Edvin', 3000);
    assert(promoted && promoted.you.slot === four[2].w.you.slot && seen, `Cilla leaves: Edvin gets in by himself, in her slot (${promoted && promoted.you.slot}), and the others see him join`);
    const rNow = await slap(we.id);
    assert(rNow.status === 200, 'now Edvin can slap');
    const f = join('rum4', 'Frida'); await f.ready;
    const wf = await f.wait((m) => m.t === 'welcome');
    assert(wf && wf.full === true, 'full again at four: the next one watches');
    const rF = await slap(wf.id);
    assert(rF.status === 409, '…and cannot slap');
    console.log('\nAlla rumsgräns-tester gick igenom.');
  } catch (err) {
    console.error(err); process.exitCode = 1;
  } finally {
    for (const c of all) try { c.ws.close(); } catch { /* */ }
    rt.close?.(); server.close(); setTimeout(() => process.exit(process.exitCode || 0), 100);
  }
})();

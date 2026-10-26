// Tyger (fabrics) på gubbarna, utan webbläsare: värdena (klämning, skräp), att servern och
// webbläsaren har samma regler, uppladdningen (typ, storlek, hash) och att tygerna skickas
// till de andra i rummet. Körs med: node tests/fabric.test.mjs (ingår i npm test)
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { FABRIC, cleanFabric, cleanFabrics, cleanParam, fabricPhase, fabricSize, randomFabricParams, defaultFabric } from '../shared/fabric.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const WebSocket = require('ws');
const { LocalAdapter } = require('../server/storage/local');
const { createStore, contentId } = require('../server/store');
const { createApp } = require('../server/app');
const { attachRealtime, cleanLook, cleanFabrics: serverClean } = require('../server/realtime');
const { makeEntitlements } = require('../server/entitlements');

const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ID = '0123456789abcdef', ID2 = 'fedcba9876543210';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const seeded = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// ---------- Värdena ----------
{
  const f = cleanFabric({ id: ID });
  assert(same(Object.keys(f).sort(), ['cycleHue', 'hue', 'hueHz', 'id', 'rot', 'scale', 'scroll', 'spin', 'spinHz'])
    && f.scale === 1 && f.rot === 0 && f.hue === 0 && f.cycleHue === false && f.spin === false && f.scroll === 0, 'ett tyg med bara id får standardvärden');
  const c = cleanFabric({ id: ID, scale: 99, rot: -30, hue: 725, hueHz: 50, spinHz: -4, scroll: 1e9, cycleHue: 'true', spin: 1 });
  assert(c.scale === FABRIC.params.scale.max && c.rot === 330 && c.hue === 5 && c.hueHz === 2 && c.spinHz === FABRIC.params.spinHz.min && c.scroll === 2,
    'för stora/små värden kläms in (scale 0.1–4, Hz-gränser), vinklar går runt (−30° = 330°, 725° = 5°)');
  assert(c.cycleHue === false && c.spin === false, 'av/på måste vara true på riktigt ("true" eller 1 räknas inte)');
  const j = cleanFabric({ id: ID, scale: 'NaN', rot: Infinity, hue: {}, hueHz: [], spinHz: null, scroll: '0.5' });
  assert(j.scale === 1 && j.rot === 0 && j.hue === 0 && j.hueHz === FABRIC.params.hueHz.def && j.spinHz === FABRIC.params.spinHz.def && j.scroll === 0.5,
    'skräp (NaN, Infinity, objekt, listor, null) blir standardvärdet, siffror som text godtas');
  assert(cleanParam('scale', 0.123456) === 0.123, 'värden avrundas (3 decimaler) så looken blir liten');
  for (const bad of [null, 'x', 42, [], { id: 'ABCDEF0123456789' }, { id: '0123' }, { id: ID + '0' }, { id: '../../etc/passwd' }, { id: 7 }]) {
    assert(cleanFabric(bad) === null, `ogiltigt tyg nekas: ${JSON.stringify(bad)}`);
  }
  const fs1 = cleanFabrics({ shirt: { id: ID }, shoes: { id: ID }, __proto__: { id: ID }, pants: { id: 'nope' }, hat: { id: ID2, scale: 3 } });
  assert(same(Object.keys(fs1), ['shirt', 'hat']) && fs1.hat.scale === 3, 'bara kända platser (shirt, pants, hair, skin, hat) och giltiga id:n behålls');
  assert(cleanFabrics({}) === null && cleanFabrics(null) === null && cleanFabrics([]) === null && cleanFabrics('x') === null && cleanFabrics({ shirt: { id: 'x' } }) === null,
    'inga giltiga tyger = null (looken ser ut precis som förut)');
  const p = fabricPhase(cleanFabric({ id: ID, rot: 10, hue: 20, spin: true, spinHz: 0.5, cycleHue: true, hueHz: 0.25, scroll: 1 }), 1_000_000_001_000);
  const q = fabricPhase(cleanFabric({ id: ID, rot: 10, hue: 20 }), 123456789);
  assert(Math.abs(p.rot - (10 + 180) % 360) < 1e-6 && Math.abs(p.hue - (20 + 90)) < 1e-6 && p.offset === 0 && q.rot === 10 && q.hue === 20 && q.offset === 0,
    'animationen räknas från klockan (samma tid = samma läge för alla), av = stilla');
  const big = fabricPhase(cleanFabric({ id: ID, spin: true, spinHz: 0.37 }), 1.9e12);
  assert(big.rot >= 0 && big.rot < 360 && Number.isFinite(big.rot), 'stora klockvärden ger fortfarande en vinkel 0–360');
  assert(fabricSize(1000, 300) === 512 && fabricSize(200, 100) === 256 && fabricSize(3, 3) === 32 && fabricSize(129, 1) === 256 && fabricSize(0, 0) === 32,
    'bildstorleken blir en tvåpotens 32–512 px');
  const rand = seeded(123);
  const rs = [...Array(200)].map(() => randomFabricParams(ID, rand));
  assert(rs.every((r) => same(cleanFabric(r), r)) && new Set(rs.map((r) => r.scale)).size > 50, '🌀 Randomize ger alltid giltiga (och olika) värden');
  assert(same(defaultFabric(ID), cleanFabric({ id: ID })), 'defaultFabric = standardvärden');
}

// ---------- Servern har samma regler som webbläsaren ----------
{
  const junk = [undefined, null, 1, 'x', [], {}, { shirt: null }, { shirt: { id: ID } }, { shirt: { id: ID, scale: -1, rot: 400, hue: -1, cycleHue: true, hueHz: 0 } },
    { hair: { id: ID2, spin: true, spinHz: 99, scroll: -3 }, skin: { id: ID, scale: '2' }, pants: { id: ID.toUpperCase() } },
    { hat: { id: ID, scale: 1e-9, rot: 'abc' }, shirt: [] }];
  const rand = seeded(77);
  for (let i = 0; i < 200; i++) {
    const vals = [rand() * 1000 - 500, 'x', null, true, rand(), -rand() * 10, String(rand() * 5)];
    const any = () => vals[Math.floor(rand() * vals.length)];
    junk.push({ [FABRIC.slots[i % 5]]: { id: rand() < 0.8 ? ID : 'bad', scale: any(), rot: any(), hue: any(), hueHz: any(), spinHz: any(), scroll: any(), cycleHue: rand() < 0.5 ? true : 'yes', spin: any() } });
  }
  assert(junk.every((j) => same(serverClean(j), cleanFabrics(j))), `servern och webbläsaren rensar tyger likadant (${junk.length} fall, mest skräp)`);
  const old = cleanLook({ outfit: 'punk', shirt: '#e63946' });
  assert(!('fabric' in old), 'en look utan tyger ser ut precis som förut (inget fabric-fält), så äldre klienter inte märker något');
  const withF = cleanLook({ outfit: 'punk', fabric: { shirt: { id: ID, scale: 2 } } });
  assert(withF.fabric.shirt.scale === 2 && withF.outfit === 'punk', 'servern behåller tyger i looken');
}

// ---------- Uppladdningen och realtid ----------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-fab-'));
const store = createStore(new LocalAdapter(dir));
// Fabrics are part of the full version: this key unlocks them (FULL_ACCESS_KEYS on the server).
const FULL_KEY = 'test-full-key-123';
const entitle = makeEntitlements({ FULL_ACCESS_KEYS: `${FULL_KEY}, only-sound-key-1:soundDesign` });
const app = createApp(store, { adminToken: 'hemligt-test', entitle });
const server = app.listen(0);
const rt = attachRealtime(server, { maxPlayers: 5, heartbeatMs: 500, entitle });
const base = `http://127.0.0.1:${server.address().port}`;
const clients = [];
try {
  const png = (w, h, opts = {}) => sharp({ create: { width: w, height: h, channels: 4, background: opts.bg || { r: 255, g: 0, b: 80, alpha: 1 } } }).png().toBuffer();
  const post = (buf, type = 'image/png', name = 'tyg.png', ip = '10.0.0.1', key = FULL_KEY) => {
    const fd = new FormData(); fd.append('file', new Blob([buf], { type }), name);
    return fetch(`${base}/api/fabrics`, { method: 'POST', body: fd, headers: { 'x-forwarded-for': ip, ...(key ? { 'x-unlock': key } : {}) } });
  };
  // Gating: free players (no key, a wrong key, a sound-only key) can't upload fabrics
  const freeUp = [await post(await png(16, 16), 'image/png', 'f.png', '10.0.1.1', null), await post(await png(16, 16), 'image/png', 'f.png', '10.0.1.1', 'wrong-key-123456'), await post(await png(16, 16), 'image/png', 'f.png', '10.0.1.1', 'only-sound-key-1')];
  const ents = await Promise.all([{}, { 'x-unlock': FULL_KEY }, { 'x-unlock': 'only-sound-key-1' }, { 'x-dev-unlock': '1' }].map((h) => fetch(`${base}/api/entitlements`, { headers: h }).then((r) => r.json())));
  assert(freeUp.every((r) => r.status === 403) && same(ents[0].full, { fabrics: false, soundDesign: false, bigStickers: false, cleanVideo: false, multiCam: false }) && same(ents[1].full, { fabrics: true, soundDesign: true, bigStickers: true, cleanVideo: true, multiCam: true })
    && same(ents[2].full, { fabrics: false, soundDesign: true, bigStickers: false, cleanVideo: false, multiCam: false }) && same(ents[3].full, { fabrics: false, soundDesign: false, bigStickers: false, cleanVideo: false, multiCam: false }) && ents[0].devAllowed === false,
    'full version: free by default; only a key from FULL_ACCESS_KEYS unlocks fabrics (403 otherwise); per-feature keys; dev unlock ignored unless DEV_UNLOCK=1');
  const devEnt = makeEntitlements({ DEV_UNLOCK: '1' });
  assert(devEnt({ dev: true }).fabrics && devEnt({ dev: true }).soundDesign && !devEnt({}).fabrics && devEnt.devAllowed && !makeEntitlements({ FULL_ACCESS_KEYS: 'short' })({ key: 'short' }).fabrics,
    'DEV_UNLOCK=1 (test servers): the browser flag klibb.devUnlock unlocks everything; keys shorter than 12 chars are ignored');
  const r1 = await post(await png(1000, 400));
  const m1 = await r1.json();
  const file = await fetch(`${base}${m1.url}`);
  const stored = Buffer.from(await file.arrayBuffer());
  const meta = await sharp(stored).metadata();
  assert(r1.status === 200 && /^[a-f0-9]{16}$/.test(m1.id) && m1.url === `/uploads/${m1.id}.webp` && m1.kind === 'fabric' && m1.width === 512 && m1.height === 512,
    'uppladdning: 1000×400 PNG blir ett kvadratiskt 512 px tyg med hash-id');
  assert(file.status === 200 && meta.format === 'webp' && meta.width === 512 && meta.hasAlpha && contentId(stored) === m1.id && stored.length <= FABRIC.maxBytes,
    'tyget sparas som WebP (med genomskinlighet runt bilden), id = hash av innehållet, under 300 kB, och kan hämtas av alla');
  const corner = await sharp(stored).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
  assert(corner[3] === 0, 'det som inte täcks av bilden blir genomskinligt (där syns färgen igenom)');
  const again = await (await post(await png(1000, 400))).json();
  assert(again.id === m1.id, 'samma bild igen = samma id (sparas bara en gång)');
  const small = await (await post(await png(20, 10), 'image/png', 'a.png', '10.0.0.2')).json();
  const jpg = await post(await sharp({ create: { width: 300, height: 300, channels: 3, background: '#00d1ff' } }).jpeg().toBuffer(), 'image/jpeg', 'a.jpg', '10.0.0.2');
  assert(small.width === 32 && jpg.status === 200 && (await jpg.json()).width === 512, 'små bilder blir 32 px, JPG godtas (300 px → 512)');
  const text = await post(Buffer.from('hej hej'), 'text/plain', 'a.txt', '10.0.0.3');
  const gif = await post(Buffer.from('GIF89a'), 'image/gif', 'a.gif', '10.0.0.3');
  const fake = await post(Buffer.from('det här är ingen bild'), 'image/png', 'a.png', '10.0.0.3');
  const none = await fetch(`${base}/api/fabrics`, { method: 'POST', headers: { 'x-forwarded-for': '10.0.0.3', 'x-unlock': FULL_KEY } });
  assert(text.status === 400 && gif.status === 400 && fake.status === 400 && none.status === 400, 'fel filtyp, GIF, trasig "bild" och ingen fil alls nekas (400)');
  const noise = await sharp(Buffer.from([...Array(700 * 700 * 3)].map(() => Math.floor(Math.random() * 256))), { raw: { width: 700, height: 700, channels: 3 } }).png().toBuffer();
  const tooBig = await post(noise, 'image/png', 'brus.png', '10.0.0.4');
  assert(noise.length > FABRIC.maxBytes && tooBig.status === 400 && /larger than 300 kB/.test((await tooBig.json()).error), `för stor fil (${Math.round(noise.length / 1024)} kB) nekas med ett tydligt fel`);
  const statuses = [];
  for (let i = 0; i < 22; i++) statuses.push((await post(await png(8, 8, { bg: { r: i, g: 1, b: 2, alpha: 1 } }), 'image/png', 'x.png', '10.0.0.9')).status);
  assert(statuses.slice(0, 20).every((s) => s === 200) && statuses[20] === 429, 'samma spärr som klistermärken: högst 20 uppladdningar per minut och IP');

  // Realtid: tygerna skickas till de andra (rensade)
  const client = (room, hello) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?room=${room}`);
    const c = { ws, msgs: [] }; clients.push(c);
    ws.on('message', (d) => c.msgs.push(JSON.parse(d.toString())));
    c.send = (m) => ws.send(JSON.stringify(m));
    c.wait = async (pred, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = c.msgs.find(pred); if (m) return m; await sleep(10); } return null; };
    c.ready = new Promise((r) => ws.on('open', r)).then(() => c.send({ t: 'hello', ...hello }));
    return c;
  };
  const fab = { shirt: { id: m1.id, scale: 2.5, rot: 45, hue: 200, cycleHue: true, hueHz: 0.5, spin: true, spinHz: 0.2, scroll: 0.3 }, hat: { id: 'trasigt' }, shoes: { id: m1.id } };
  const a = client('fab-rt', { name: 'Anna', look: { outfit: 'punk', hat: true, fabric: fab }, unlock: { key: FULL_KEY } });
  await a.ready; await a.wait((m) => m.t === 'welcome');
  const b = client('fab-rt', { name: 'Bosse', look: { outfit: 'tshirt' } });
  await b.ready;
  const wb = await b.wait((m) => m.t === 'welcome');
  const seen = wb.players[0].look;
  assert(same(seen.fabric, { shirt: cleanFabric(fab.shirt) }) && seen.hat === true, 'den som kommer in ser andras tyger med samma värden (trasiga och okända platser borta)');
  const jb = await a.wait((m) => m.t === 'join');
  assert(jb && !('fabric' in jb.player.look), 'den utan tyger skickas som förut (inget fabric-fält)');
  a.send({ t: 'look', name: 'Anna', look: { outfit: 'punk', fabric: { pants: { id: m1.id, scale: 0.01, rot: -90, hue: 'x' }, skin: { id: m1.id } } } });
  const lk = await b.wait((m) => m.t === 'look');
  assert(lk && same(Object.keys(lk.look.fabric), ['pants', 'skin']) && lk.look.fabric.pants.scale === 0.1 && lk.look.fabric.pants.rot === 270 && lk.look.fabric.pants.hue === 0,
    'ändrade tyger skickas till de andra direkt, rensade (scale kläms, vinkel går runt, skräp = standard)');
  a.send({ t: 'look', name: 'Anna', look: { outfit: 'punk', fabric: { shirt: { id: 'x'.repeat(5000) } } } });
  const lk2 = await b.wait((m) => m.t === 'look' && m !== lk);
  assert(lk2 && !('fabric' in lk2.look), 'tar man bort tygerna (eller skickar skräp) går gubben tillbaka till bara färger');
  a.send({ t: 'look', name: 'Anna', look: { outfit: 'punk', fabric: { shirt: { id: m1.id } } } });
  await b.wait((m) => m.t === 'look' && m.look.fabric && m.look.fabric.shirt && !m.look.fabric.pants);
  // A free player who sends fabric anyway (hello and look): the server drops it for everyone.
  const f = client('fab-rt', { name: 'Fri', look: { outfit: 'punk', fabric: { shirt: { id: m1.id } } }, unlock: { key: 'wrong-key-123456', dev: true } });
  await f.ready; await f.wait((m) => m.t === 'welcome');
  const jf = await b.wait((m) => m.t === 'join' && m.player.name === 'Fri');
  f.send({ t: 'look', name: 'Fri', look: { outfit: 'punk', fabric: { pants: { id: m1.id } } } });
  const lf = await b.wait((m) => m.t === 'look' && m.name === 'Fri');
  assert(jf && !('fabric' in jf.player.look) && lf && !('fabric' in lf.look), 'free player: fabric data in hello/look is rejected by the server (others never get it)');
  const wf = f.msgs.find((m) => m.t === 'welcome');
  assert(wf.players.some((p) => p.name === 'Anna' && p.look.fabric), "free players still SEE other players' fabrics");
} finally {
  for (const c of clients) try { c.ws.close(); } catch { /* */ }
  rt.close?.(); server.close(); fs.rmSync(dir, { recursive: true, force: true });
}
console.log('Alla tyg-tester gick igenom.');
process.exit(0);

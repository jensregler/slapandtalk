// Slap and Talk – servern.
// Den gör tre saker: 1) tar emot och sparar uppladdade klistermärken,
// 2) sparar och lämnar ut stämplar per rum, 3) serverar själva webbappen.
// Själva appen byggs i createApp(store, inställningar), så testerna kan starta en egen
// server med tillfällig lagring och en låtsasklocka. index.js startar den på riktigt.
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { contentId } = require('./store');
const { broadcast, cleanName } = require('./realtime');

// Konstnärens namn och länk (samma regler som i webbläsaren). ESM-modul, så den laddas med import().
const artistLinkMod = import('../shared/artistlink.mjs');

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_PX = 1024;
// Största klibban (längsta sidan) = väggens höjd, samma mått som rummet i webbappen.
const MAX_STAMP_SIZE = require('../shared/room.json').height;
// Större stämplar krymps (i stället för att nekas), så äldre appar inte får fel.
const clampSize = (s) => Math.min(s, MAX_STAMP_SIZE);

function createApp(store, { adminToken = '', quickTtlHours = 24, recorder = null } = {}) {
const ADMIN_TOKEN = adminToken;
const app = express();
app.set('trust proxy', true); // vi ligger bakom Cloudflare-tunneln
app.use(express.json({ limit: '50kb' }));

// Rum-id: små bokstäver, siffror och bindestreck. "stad" är den publika staden.
const ROOM_RE = /^[a-z0-9-]{1,40}$/;
function roomParam(req, res) {
  const id = String(req.params.room || '').toLowerCase();
  if (!ROOM_RE.test(id)) { res.status(400).json({ error: 'Invalid room' }); return null; }
  return id;
}

// Enkel spärr mot spam: max N förfrågningar per IP och minut.
function rateLimit(max) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const list = (hits.get(key) || []).filter((t) => now - t < 60_000);
    if (list.length >= max) return res.status(429).json({ error: 'Easy now – wait a minute.' });
    list.push(now); hits.set(key, list); next();
  };
}

function isAdmin(req) {
  const t = req.get('x-admin-token') || '';
  return ADMIN_TOKEN.length > 0 && t.length === ADMIN_TOKEN.length &&
    crypto.timingSafeEqual(Buffer.from(t), Buffer.from(ADMIN_TOKEN));
}

// ---------- Klistermärken (bilder) ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => cb(null, ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)),
});

app.post('/api/stickers', rateLimit(20), (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The file is larger than 5 MB.' : 'The upload failed.' });
    if (!req.file) return res.status(400).json({ error: 'Pick a PNG, JPG or WebP image.' });
    try {
      // Vi gör om bilden till WebP (behåller genomskinlighet), max 1024 px,
      // och tar bort metadata som GPS-position från mobilkameran.
      const img = sharp(req.file.buffer, { limitInputPixels: 60e6 }).rotate();
      const out = await img.resize(MAX_PX, MAX_PX, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 90, alphaQuality: 100 }).toBuffer({ resolveWithObject: true });
      // Samma bild två gånger blir samma design (id = innehållets hash).
      const id = contentId(out.data);
      const existing = await store.getImage(id);
      if (existing && await store.hasImageFile(id)) return res.json(existing);
      await store.putImageFile(id, out.data);
      const meta = await store.addImage({
        id, url: `/uploads/${id}.webp`, width: out.info.width, height: out.info.height,
        artist: String(req.body?.artist || '').slice(0, 60), createdAt: new Date().toISOString(),
      });
      res.json(meta);
    } catch (e) {
      res.status(400).json({ error: 'Could not read the image.' });
    }
  });
});

// Finns bilden på riktigt? På Renders gratisnivå är disken tillfällig: efter en omstart
// kan både bildfilen och listan över bilder vara borta, medan webbläsaren fortfarande
// minns designen (och visar en gammal kopia ur sin cache).
async function imageAvailable(id) {
  id = String(id || '');
  if (!/^[a-f0-9]{16}$/.test(id)) return null;
  const meta = await store.getImage(id);
  if (!meta || !(await store.hasImageFile(id))) return null;
  return meta;
}
// Peel-nycklar: sparas bara som SHA-256, jämförs i konstant tid.
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
function tokenMatches(token, hash) {
  if (!token || typeof hash !== 'string' || hash.length !== 64) return false;
  const a = Buffer.from(hashToken(token), 'hex'), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// Det som visas för alla: aldrig peel-hashen.
const publicStamp = ({ peelHash, peelOwner, ...s }) => s; // peel-nyckel och ägare visas aldrig
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Vilka av de här bilderna finns kvar? ?ids=a,b,c  ->  { images: { a: {...}, c: {...} } }
app.get('/api/stickers', wrap(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter((id) => /^[a-f0-9]{16}$/.test(id)).slice(0, 100);
  const images = {}, missing = [];
  await Promise.all(ids.map(async (id) => { const m = await imageAvailable(id); if (m) images[id] = m; else missing.push(id); }));
  res.json({ images, missing });
}));

// ---------- Rum ----------
// Rummets utseende kontrolleras mot samma katalog som webbappen använder.
const STYLES = require('../shared/styles.json');
function cleanStyle(s) {
  if (!s || typeof s !== 'object') return null;
  if (!STYLES.floors[s.floor] || !STYLES.walls[s.wall] || !STYLES.ceilings[s.ceiling || STYLES.default.ceiling]) return null;
  const out = { floor: s.floor, wall: s.wall, ceiling: STYLES.ceilings[s.ceiling] ? s.ceiling : STYLES.default.ceiling };
  if (STYLES.walls[s.wall].colored) { if (!STYLES.wallColors[s.wallColor]) return null; out.wallColor = s.wallColor; }
  if (s.seed !== undefined && s.seed !== null && s.seed !== '') { if (typeof s.seed !== 'string' || !/^[a-z0-9]{1,12}$/.test(s.seed)) return null; out.seed = s.seed; }
  return out;
}
const styleOf = (r) => r.style || { ...STYLES.default }; // äldre rum: dagens utseende
const roomPublic = (r) => ({ id: r.id, type: r.type, owner: r.owner || null, createdAt: r.createdAt, lastVisitAt: r.lastVisitAt, style: styleOf(r),
  quickTtlHours: r.type === 'quick' ? quickTtlHours : null });

// Skapa ett nytt snabbrum (inget konto behövs). Svarar med en kort kod, t.ex. "k7m2qx".
// Body (valfritt): { style: { floor, wall, wallColor?, ceiling?, seed? } }
// Svaret innehåller roomKey: en hemlig nyckel som bara skaparen får. Med den kan
// rummets utseende ändras senare. Servern sparar bara en hash av nyckeln.
app.post('/api/rooms', rateLimit(10), wrap(async (req, res) => {
  let style = null;
  if (req.body && req.body.style !== undefined) { style = cleanStyle(req.body.style); if (!style) return res.status(400).json({ error: 'Unknown room look' }); }
  const roomKey = crypto.randomBytes(24).toString('base64url');
  const room = await store.createRoom({ type: 'quick', style, keyHash: hashToken(roomKey) });
  res.json({ room: roomPublic(room), roomKey });
}));

// Byt utseende: rummets skapare (nyckeln i x-room-key) eller admin. Staden: bara admin.
app.put('/api/rooms/:room/style', rateLimit(30), wrap(async (req, res) => {
  const id = roomParam(req, res); if (!id) return;
  const style = cleanStyle(req.body && req.body.style);
  if (!style) return res.status(400).json({ error: 'Unknown room look' });
  const admin = isAdmin(req), key = String(req.get('x-room-key') || '');
  const r = await store.setRoomStyle(id, style, (room) => admin || (room.type !== 'stad' && tokenMatches(key, room.keyHash)));
  if (r === 'notfound') return res.status(404).json({ error: 'That room does not exist' });
  if (r === 'forbidden') return res.status(403).json({ error: 'Only the room’s creator can change its look' });
  broadcast(id, { type: 'room:style', style });
  res.json({ ok: true, style });
}));

// Profilrum: förberett för konton. Tills inloggning finns kan bara admin skapa dem.
app.post('/api/admin/rooms', express.json(), wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Not allowed' });
  const b = req.body || {};
  const id = String(b.id || '').toLowerCase();
  if (!ROOM_RE.test(id) || id === 'stad') return res.status(400).json({ error: 'Invalid room' });
  const owner = b.owner && typeof b.owner === 'object' ? { id: String(b.owner.id || '').slice(0, 60), name: String(b.owner.name || '').slice(0, 60) } : null;
  try {
    res.json({ room: roomPublic(await store.createRoom({ id, type: 'profile', owner })) });
  } catch (e) { res.status(e.code === 'EXISTS' ? 409 : 400).json({ error: e.message }); }
}));

// Om lagringen inte svarar (t.ex. R2 nere) visas rummet tomt i stället för ett serverfel.
// Inget skrivs: nästa klibba går genom vanliga vägen och får ett fel tills lagringen är tillbaka,
// så befintliga klibbor aldrig skrivs över av ett tomt rum.
function emptyRoomOnStorageError(id, e) {
  console.error(`[lagring] Kunde inte läsa rum ${id}, visar det tomt: ${e && (e.name || '')} ${e && e.message}`);
  return { ...store.emptyRoom(id), exists: false, storageUnavailable: true };
}

app.get('/api/rooms/:room', wrap(async (req, res) => {
  const id = roomParam(req, res); if (!id) return;
  let room;
  try { room = await store.roomOrEmpty(id); } catch (e) { room = emptyRoomOnStorageError(id, e); }
  res.json({ room: roomPublic(room), ...(room.storageUnavailable ? { storageUnavailable: true } : {}) });
}));

// Klienten säger till med jämna mellanrum att någon är i rummet, så det inte städas bort.
app.post('/api/rooms/:room/visit', rateLimit(60), wrap(async (req, res) => {
  const id = roomParam(req, res); if (!id) return;
  const room = await store.touchRoom(id);
  res.json({ ok: !!room });
}));

// ---------- Stämplar ----------
app.get('/api/rooms/:room/stamps', wrap(async (req, res) => {
  const id = roomParam(req, res); if (!id) return;
  let room;
  try { room = (await store.touchRoom(id)) || (await store.roomOrEmpty(id)); } // att ladda rummet räknas som ett besök
  catch (e) { room = emptyRoomOnStorageError(id, e); }
  // Stämplar vars bild saknas hoppas över, så de inte blir trasiga/osynliga i rummet.
  const images = {};
  const ok = new Map();
  for (const s of room.stamps) if (!ok.has(s.imageId)) ok.set(s.imageId, await imageAvailable(s.imageId));
  const stamps = room.stamps.filter((s) => {
    const m = ok.get(s.imageId);
    if (m) images[s.imageId] = m;
    return !!m;
  }).map((s) => publicStamp(isNum(s.size) && s.size > MAX_STAMP_SIZE ? { ...s, size: MAX_STAMP_SIZE } : s)); // gamla för stora stämplar
  res.json({ room: id, info: roomPublic(room), stamps, images, cameras: room.cameras || [], ...(room.storageUnavailable ? { storageUnavailable: true } : {}) });
}));

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isVec = (v, len) => Array.isArray(v) && v.length === len && v.every(isNum);

// Namn och länk till den som gjorde klibban. Ogiltig länk (javascript:, data:, inloggning i
// länken, för lång …) sparas inte alls, och en tom länk sparas inte heller.
async function artistFields(b) {
  const { cleanArtistName, cleanArtistLink } = await artistLinkMod;
  const link = cleanArtistLink(b.artistLink);
  return { artist: cleanArtistName(b.artist), ...(link ? { artistLink: link } : {}) };
}

app.post('/api/rooms/:room/stamps', rateLimit(120), wrap(async (req, res) => {
  const room = roomParam(req, res); if (!room) return;
  const b = req.body || {};
  const image = await imageAvailable(b.imageId);
  if (!image) return res.status(410).json({ error: 'That design is no longer on the server. Please upload it again.', gone: true });
  if (!isVec(b.position, 3) || !isVec(b.normal, 3) || !isVec(b.quaternion, 4)) return res.status(400).json({ error: 'Invalid position' });
  if (!isNum(b.size) || b.size < 0.02) return res.status(400).json({ error: 'Invalid size' });
  // Peel-nyckel: bara den som stämplade får den. Servern sparar bara en hash av den.
  const peelToken = crypto.randomBytes(24).toString('base64url');
  // Vem stämplade (för gränsen på 20 peel-bara per person och rum): en slumpad enhets-id från
  // webbläsaren, annars IP-adressen. Bara en hash sparas.
  const owner = typeof b.owner === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(b.owner) ? 'd:' + b.owner : 'ip:' + req.ip;
  const saved = await store.addStamp(room, {
    peelHash: hashToken(peelToken), peelOwner: hashToken(owner).slice(0, 24),
    imageId: image.id,
    position: b.position, normal: b.normal, quaternion: b.quaternion,
    size: clampSize(b.size), rotation: isNum(b.rotation) ? b.rotation : 0,
    surface: String(b.surface || '').slice(0, 40),
    ...(await artistFields(b)),
  });
  const stamp = publicStamp(saved);
  // nonce: en slumpad lapp från klienten, så den som stämplade känner igen sin egen stämpel
  // (och inte spelar upp ljudet två gånger). Aldrig peel-nyckeln.
  const nonce = typeof b.nonce === 'string' ? b.nonce.slice(0, 40) : undefined;
  broadcast(room, { type: 'stamp:add', stamp, image, ...(nonce ? { nonce } : {}) });
  res.json({ stamp, image, peelToken });
}));

// Peela egna stämplar: { items: [{ id, token }, ...] } (högst 200 åt gången, t.ex. "Peela alla").
// Svar: { results: { <id>: 'ok' | 'notfound' | 'forbidden' } }
app.post('/api/rooms/:room/peel', rateLimit(60), wrap(async (req, res) => {
  const room = roomParam(req, res); if (!room) return;
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 200)
    .filter((x) => x && typeof x.id === 'string' && /^[a-f0-9]{16}$/.test(x.id)).map((x) => ({ id: x.id, token: String(x.token || '') })) : [];
  if (!items.length) return res.status(400).json({ error: 'No stickers to peel' });
  const results = await store.peelStamps(room, items, (s, token) => tokenMatches(token, s.peelHash));
  for (const [id, r] of Object.entries(results)) if (r === 'ok') broadcast(room, { type: 'stamp:remove', id });
  res.json({ results });
}));
// En enda stämpel: 200 om den peelades, 404 om den inte finns, 403 om nyckeln är fel.
app.delete('/api/rooms/:room/stamps/:id/peel', rateLimit(60), wrap(async (req, res) => {
  const room = roomParam(req, res); if (!room) return;
  const id = String(req.params.id);
  const token = String(req.get('x-peel-token') || '');
  const r = (await store.peelStamps(room, [{ id, token }], (s, t) => tokenMatches(t, s.peelHash)))[id];
  if (r === 'ok') { broadcast(room, { type: 'stamp:remove', id }); return res.json({ ok: true }); }
  if (r === 'notfound') return res.status(404).json({ error: 'That sticker is gone', gone: true });
  res.status(403).json({ error: 'You can only peel your own stickers' });
}));

// ---------- Rättigheter för inspelning och kameror ----------
// Samma regel som för rummets utseende: den som skapade rummet (rumsnyckeln i x-room-key)
// eller admin. Staden: bara admin.
const canEditRoom = (req) => { const admin = isAdmin(req), key = String(req.get('x-room-key') || ''); return (room) => admin || (room.type !== 'stad' && tokenMatches(key, room.keyHash)); };
async function rightsTo(req, res, id, what = 'record and place cameras') {
  let room = await store.getRoom(id);
  if (!room && id === 'stad') room = { id, type: 'stad' };
  if (!room) { res.status(404).json({ error: 'That room does not exist' }); return null; }
  if (!canEditRoom(req)(room)) { res.status(403).json({ error: id === 'stad' ? `Only admin can ${what} in the City` : `Only the room’s creator can ${what}` }); return null; }
  return room;
}

// ---------- Nollställ rummet: ALLA klibbor bort, för alla ----------
// Bara den som skapade rummet (rumsnyckeln) eller admin. Staden: bara admin.
// { by: namnet som visas i chatten ("Ulla reset the room") }. Spelas in om rummet spelas in.
const cleanBy = (v) => String(v || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
app.post('/api/rooms/:room/reset', rateLimit(20), wrap(async (req, res) => {
  const id = roomParam(req, res); if (!id) return;
  if (!(await rightsTo(req, res, id, 'reset the room'))) return;
  const removed = await store.resetStamps(id);
  const by = cleanBy(req.body?.by) || (isAdmin(req) ? 'Admin' : 'The room’s creator');
  broadcast(id, { type: 'room:reset', by, removed });
  res.json({ ok: true, removed });
}));

// ---------- Virtuella kameror ----------
// { name, p: [x,y,z] (kamerans position), yaw, pitch (radianer), fov (lodrät bildvinkel, grader), aspect: '' | '16:9' | '9:16' }
const ROOM_SIZE = require('../shared/room.json');
const MAX_CAMERAS = 12;
const CAM_ID_RE = /^[a-f0-9]{10}$/;
const ASPECTS = ['', '16:9', '9:16'];
const wrapAngle = (a) => Math.round(Math.atan2(Math.sin(a), Math.cos(a)) * 1e4) / 1e4;
function cleanCamera(b, old = null) {
  b = b && typeof b === 'object' ? b : {};
  const c = old ? { ...old } : { fov: 60, aspect: '', yaw: 0, pitch: 0 };
  if (b.p !== undefined || !old) {
    if (!isVec(b.p, 3)) return null;
    const hw = ROOM_SIZE.width / 2 - 0.05, hd = ROOM_SIZE.depth / 2 - 0.05;
    const r = (n) => Math.round(n * 1000) / 1000;
    c.p = [r(Math.min(hw, Math.max(-hw, b.p[0]))), r(Math.min(ROOM_SIZE.height - 0.05, Math.max(0.05, b.p[1]))), r(Math.min(hd, Math.max(-hd, b.p[2])))];
  }
  if (b.yaw !== undefined) { if (!isNum(b.yaw)) return null; c.yaw = wrapAngle(b.yaw); }
  if (b.pitch !== undefined) { if (!isNum(b.pitch)) return null; c.pitch = Math.round(Math.min(1.55, Math.max(-1.55, b.pitch)) * 1e4) / 1e4; }
  if (b.fov !== undefined) { if (!isNum(b.fov)) return null; c.fov = Math.round(Math.min(120, Math.max(15, b.fov))); }
  if (b.aspect !== undefined) { const a = b.aspect === null ? '' : String(b.aspect); if (!ASPECTS.includes(a)) return null; c.aspect = a; }
  if (b.name !== undefined) { const n = cleanName(b.name); if (n) c.name = n; }
  return c;
}
app.post('/api/rooms/:room/cameras', rateLimit(60), wrap(async (req, res) => {
  const id = roomParam(req, res); if (!id) return;
  const cam = cleanCamera(req.body); if (!cam) return res.status(400).json({ error: 'Invalid camera' });
  const r = await store.editCameras(id, canEditRoom(req), (list) => {
    if (list.length >= MAX_CAMERAS) return { error: `At most ${MAX_CAMERAS} cameras per room`, save: false };
    // Camera 1, 2, 3 … (det lägsta lediga numret)
    const used = new Set(list.map((c) => /^Camera (\d+)$/.exec(c.name)?.[1]).filter(Boolean).map(Number));
    let n = 1; while (used.has(n)) n++;
    const c = { id: crypto.randomBytes(5).toString('hex'), name: cam.name || `Camera ${n}`, p: cam.p, yaw: cam.yaw, pitch: cam.pitch, fov: cam.fov, aspect: cam.aspect, createdAt: new Date().toISOString() };
    list.push(c);
    return { camera: c };
  });
  if (r === 'notfound') return res.status(404).json({ error: 'That room does not exist' });
  if (r === 'forbidden') return res.status(403).json({ error: 'Only the room’s creator can place cameras' });
  if (r.error) return res.status(400).json({ error: r.error });
  broadcast(id, { type: 'camera:add', camera: r.camera });
  res.json(r);
}));
app.put('/api/rooms/:room/cameras/:id', rateLimit(120), wrap(async (req, res) => {
  const id = roomParam(req, res); if (!id) return;
  const camId = String(req.params.id); if (!CAM_ID_RE.test(camId)) return res.status(400).json({ error: 'Invalid camera' });
  const r = await store.editCameras(id, canEditRoom(req), (list) => {
    const i = list.findIndex((c) => c.id === camId); if (i < 0) return { missing: true, save: false };
    const c = cleanCamera(req.body, list[i]); if (!c) return { bad: true, save: false };
    list[i] = c; return { camera: c };
  });
  if (r === 'notfound' || r.missing) return res.status(404).json({ error: 'That camera does not exist' });
  if (r === 'forbidden') return res.status(403).json({ error: 'Only the room’s creator can change the cameras' });
  if (r.bad) return res.status(400).json({ error: 'Invalid camera' });
  broadcast(id, { type: 'camera:update', camera: r.camera });
  res.json(r);
}));
app.delete('/api/rooms/:room/cameras/:id', rateLimit(60), wrap(async (req, res) => {
  const id = roomParam(req, res); if (!id) return;
  const camId = String(req.params.id);
  const r = await store.editCameras(id, canEditRoom(req), (list) => {
    const i = list.findIndex((c) => c.id === camId); if (i < 0) return { missing: true, save: false };
    list.splice(i, 1); return { ok: true };
  });
  if (r === 'notfound' || r.missing) return res.status(404).json({ error: 'That camera does not exist' });
  if (r === 'forbidden') return res.status(403).json({ error: 'Only the room’s creator can remove cameras' });
  broadcast(id, { type: 'camera:remove', id: camId });
  res.json({ ok: true });
}));

// ---------- Sessionsinspelning (se recorder.js och docs/recording-format.md) ----------
const needRecorder = (res) => { if (!recorder) { res.status(503).json({ error: 'Recording is not enabled on this server' }); return false; } return true; };
// Pågår en inspelning? (alla får fråga: alla i rummet ser ju ● REC)
app.get('/api/rooms/:room/recording', wrap(async (req, res) => {
  const id = roomParam(req, res); if (!id) return;
  res.json({ recording: recorder ? recorder.status(id) : null });
}));
app.post('/api/rooms/:room/recording/start', rateLimit(20), wrap(async (req, res) => {
  const id = roomParam(req, res); if (!id || !needRecorder(res)) return;
  if (!(await rightsTo(req, res, id))) return;
  try {
    const r = await recorder.start(id, {
      by: isAdmin(req) ? 'admin' : 'rummets skapare',
      // Startläget: rummets utseende, klibbor (med bilder) och kameror just nu.
      snapshot: async () => {
        const room = await store.roomOrEmpty(id);
        const images = {}, stamps = [];
        for (const s of room.stamps) {
          if (!(s.imageId in images)) images[s.imageId] = await imageAvailable(s.imageId);
          if (images[s.imageId]) stamps.push(publicStamp(isNum(s.size) && s.size > MAX_STAMP_SIZE ? { ...s, size: MAX_STAMP_SIZE } : s));
        }
        for (const k of Object.keys(images)) if (!images[k]) delete images[k];
        return { style: styleOf(room), stamps, images, cameras: room.cameras || [] };
      },
    });
    res.json({ ok: true, already: r.already, recording: recorder.status(id) });
  } catch (e) {
    if (e.code === 'BUSY') return res.status(429).json({ error: e.message });
    throw e;
  }
}));
app.post('/api/rooms/:room/recording/stop', rateLimit(20), wrap(async (req, res) => {
  const id = roomParam(req, res); if (!id || !needRecorder(res)) return;
  if (!(await rightsTo(req, res, id))) return;
  const meta = await recorder.stop(id, 'stop');
  if (!meta) return res.status(409).json({ error: 'Nothing is being recorded' });
  res.json({ ok: true, recording: meta });
}));
// Lista: bara den som får spela in. En enskild inspelning kan alla med länken spela upp
// (inspelnings-id:t är slumpat och går inte att gissa). Riktiga behörigheter kommer med konton.
app.get('/api/rooms/:room/recordings', wrap(async (req, res) => {
  const id = roomParam(req, res); if (!id || !needRecorder(res)) return;
  if (!(await rightsTo(req, res, id))) return;
  res.json({ recordings: await recorder.list(id) });
}));
app.get('/api/rooms/:room/recordings/:rec', wrap(async (req, res) => {
  const id = roomParam(req, res); if (!id || !needRecorder(res)) return;
  const m = await recorder.meta(id, String(req.params.rec));
  if (!m) return res.status(404).json({ error: 'That recording does not exist' });
  res.json(m);
}));
app.get('/api/rooms/:room/recordings/:rec/log', wrap(async (req, res) => {
  const id = roomParam(req, res); if (!id || !needRecorder(res)) return;
  const buf = await recorder.read(id, String(req.params.rec));
  if (!buf) return res.status(404).json({ error: 'That recording does not exist' });
  res.set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' }).send(buf);
}));
app.delete('/api/rooms/:room/recordings/:rec', wrap(async (req, res) => {
  const id = roomParam(req, res); if (!id || !needRecorder(res)) return;
  if (!(await rightsTo(req, res, id))) return;
  res.json({ ok: await recorder.remove(id, String(req.params.rec)) });
}));

// ---------- Admin (dold) ----------
app.get('/api/admin/check', (req, res) => res.json({ ok: isAdmin(req) }));

app.delete('/api/rooms/:room/stamps/:id', wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Not allowed' });
  const room = roomParam(req, res); if (!room) return;
  const ok = await store.deleteStamp(room, req.params.id);
  if (ok) broadcast(room, { type: 'stamp:remove', id: req.params.id });
  res.json({ ok });
}));

// Tar bort en bild helt, och alla stämplar av den i alla rum.
app.delete('/api/stickers/:id', wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Not allowed' });
  const id = String(req.params.id);
  if (!/^[a-f0-9]{16}$/.test(id)) return res.status(400).json({ error: 'Invalid id' });
  const removed = await store.deleteStampsWithImage(id);
  await store.deleteImage(id);
  await store.deleteImageFile(id);
  broadcast('*', { type: 'image:remove', id });
  res.json({ ok: true, removedStamps: removed });
}));

// ---------- Filer ----------
// Bilderna hämtas via lagringslagret (disk eller S3/R2). Id:t är innehållets hash,
// så en bild ändras aldrig och får cachas länge.
app.get('/uploads/:file', wrap(async (req, res) => {
  const m = /^([a-f0-9]{16})\.webp$/.exec(req.params.file);
  const buf = m && await store.getImageFile(m[1]);
  if (!buf) return res.status(404).end();
  res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=2592000, immutable' }).send(buf);
}));
const DIST = path.join(__dirname, '..', 'dist');
// index.html, sw.js och manifestet får aldrig cachas, så en ny version syns direkt efter
// en uppdatering. Filerna i assets/ har ett unikt namn per version och får cachas länge.
const noCache = (res) => res.setHeader('Cache-Control', 'no-cache');
app.use(express.static(DIST, {
  setHeaders: (res, file) => {
    if (/[\\/]assets[\\/]/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    else noCache(res);
  },
}));
app.get(/^\/(?!api|uploads).*/, (req, res) => { noCache(res); res.sendFile(path.join(DIST, 'index.html')); });

app.use('/api', (err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Something went wrong on the server.' }); });
return app;
}

module.exports = { createApp };

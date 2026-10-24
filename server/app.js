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
const { broadcast } = require('./realtime');

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_PX = 1024;

function createApp(store, { adminToken = '', quickTtlHours = 24 } = {}) {
const ADMIN_TOKEN = adminToken;
const app = express();
app.set('trust proxy', true); // vi ligger bakom Cloudflare-tunneln
app.use(express.json({ limit: '50kb' }));

// Rum-id: små bokstäver, siffror och bindestreck. "stad" är den publika staden.
const ROOM_RE = /^[a-z0-9-]{1,40}$/;
function roomParam(req, res) {
  const id = String(req.params.room || '').toLowerCase();
  if (!ROOM_RE.test(id)) { res.status(400).json({ error: 'Ogiltigt rum' }); return null; }
  return id;
}

// Enkel spärr mot spam: max N förfrågningar per IP och minut.
function rateLimit(max) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const list = (hits.get(key) || []).filter((t) => now - t < 60_000);
    if (list.length >= max) return res.status(429).json({ error: 'Lugn i stormen – vänta en minut.' });
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
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Filen är större än 5 MB.' : 'Uppladdningen misslyckades.' });
    if (!req.file) return res.status(400).json({ error: 'Välj en PNG-, JPG- eller WebP-bild.' });
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
      res.status(400).json({ error: 'Bilden gick inte att läsa.' });
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
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Vilka av de här bilderna finns kvar? ?ids=a,b,c  ->  { images: { a: {...}, c: {...} } }
app.get('/api/stickers', wrap(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter((id) => /^[a-f0-9]{16}$/.test(id)).slice(0, 100);
  const images = {}, missing = [];
  await Promise.all(ids.map(async (id) => { const m = await imageAvailable(id); if (m) images[id] = m; else missing.push(id); }));
  res.json({ images, missing });
}));

// ---------- Rum ----------
const roomPublic = (r) => ({ id: r.id, type: r.type, owner: r.owner || null, createdAt: r.createdAt, lastVisitAt: r.lastVisitAt,
  quickTtlHours: r.type === 'quick' ? quickTtlHours : null });

// Skapa ett nytt snabbrum (inget konto behövs). Svarar med en kort kod, t.ex. "k7m2qx".
app.post('/api/rooms', rateLimit(10), wrap(async (req, res) => {
  const room = await store.createRoom({ type: 'quick' });
  res.json({ room: roomPublic(room) });
}));

// Profilrum: förberett för konton. Tills inloggning finns kan bara admin skapa dem.
app.post('/api/admin/rooms', express.json(), wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Ej behörig' });
  const b = req.body || {};
  const id = String(b.id || '').toLowerCase();
  if (!ROOM_RE.test(id) || id === 'stad') return res.status(400).json({ error: 'Ogiltigt rum' });
  const owner = b.owner && typeof b.owner === 'object' ? { id: String(b.owner.id || '').slice(0, 60), name: String(b.owner.name || '').slice(0, 60) } : null;
  try {
    res.json({ room: roomPublic(await store.createRoom({ id, type: 'profile', owner })) });
  } catch (e) { res.status(e.code === 'EXISTS' ? 409 : 400).json({ error: e.message }); }
}));

app.get('/api/rooms/:room', wrap(async (req, res) => {
  const id = roomParam(req, res); if (!id) return;
  res.json({ room: roomPublic(await store.roomOrEmpty(id)) });
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
  const room = (await store.touchRoom(id)) || (await store.roomOrEmpty(id)); // att ladda rummet räknas som ett besök
  // Stämplar vars bild saknas hoppas över, så de inte blir trasiga/osynliga i rummet.
  const images = {};
  const ok = new Map();
  for (const s of room.stamps) if (!ok.has(s.imageId)) ok.set(s.imageId, await imageAvailable(s.imageId));
  const stamps = room.stamps.filter((s) => {
    const m = ok.get(s.imageId);
    if (m) images[s.imageId] = m;
    return !!m;
  });
  res.json({ room: id, info: roomPublic(room), stamps, images });
}));

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isVec = (v, len) => Array.isArray(v) && v.length === len && v.every(isNum);

app.post('/api/rooms/:room/stamps', rateLimit(120), wrap(async (req, res) => {
  const room = roomParam(req, res); if (!room) return;
  const b = req.body || {};
  const image = await imageAvailable(b.imageId);
  if (!image) return res.status(410).json({ error: 'Designen finns inte längre på servern. Ladda upp den igen.', gone: true });
  if (!isVec(b.position, 3) || !isVec(b.normal, 3) || !isVec(b.quaternion, 4)) return res.status(400).json({ error: 'Felaktig placering' });
  if (!isNum(b.size) || b.size < 0.02 || b.size > 5) return res.status(400).json({ error: 'Felaktig storlek' });
  const stamp = await store.addStamp(room, {
    imageId: image.id,
    position: b.position, normal: b.normal, quaternion: b.quaternion,
    size: b.size, rotation: isNum(b.rotation) ? b.rotation : 0,
    surface: String(b.surface || '').slice(0, 40),
    artist: String(b.artist || '').slice(0, 60),
  });
  broadcast(room, { type: 'stamp:add', stamp });
  res.json({ stamp, image });
}));

// ---------- Admin (dold) ----------
app.get('/api/admin/check', (req, res) => res.json({ ok: isAdmin(req) }));

app.delete('/api/rooms/:room/stamps/:id', wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Ej behörig' });
  const room = roomParam(req, res); if (!room) return;
  const ok = await store.deleteStamp(room, req.params.id);
  if (ok) broadcast(room, { type: 'stamp:remove', id: req.params.id });
  res.json({ ok });
}));

// Tar bort en bild helt, och alla stämplar av den i alla rum.
app.delete('/api/stickers/:id', wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Ej behörig' });
  const id = String(req.params.id);
  if (!/^[a-f0-9]{16}$/.test(id)) return res.status(400).json({ error: 'Ogiltigt id' });
  const removed = await store.deleteStampsWithImage(id);
  await store.deleteImage(id);
  await store.deleteImageFile(id);
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

app.use('/api', (err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Något gick fel på servern.' }); });
return app;
}

module.exports = { createApp };

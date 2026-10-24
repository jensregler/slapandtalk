// Slap and Talk – servern.
// Den gör tre saker: 1) tar emot och sparar uppladdade klistermärken,
// 2) sparar och lämnar ut stämplar per rum, 3) serverar själva webbappen.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const store = require('./store');
const { broadcast } = require('./realtime');

const PORT = Number(process.env.PORT || 8787);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_PX = 1024;
const UPLOAD_DIR = path.join(store.DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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
    require('crypto').timingSafeEqual(Buffer.from(t), Buffer.from(ADMIN_TOKEN));
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
      const id = store.newId();
      fs.writeFileSync(path.join(UPLOAD_DIR, id + '.webp'), out.data);
      const meta = store.addImage({
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
function imageAvailable(id) {
  const meta = store.getImage(String(id || ''));
  if (!meta || !fs.existsSync(path.join(UPLOAD_DIR, meta.id + '.webp'))) return null;
  return meta;
}

// Vilka av de här bilderna finns kvar? ?ids=a,b,c  ->  { images: { a: {...}, c: {...} } }
app.get('/api/stickers', (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter((id) => /^[a-f0-9]{16}$/.test(id)).slice(0, 100);
  const images = {};
  for (const id of ids) { const m = imageAvailable(id); if (m) images[id] = m; }
  res.json({ images });
});

// ---------- Stämplar ----------
app.get('/api/rooms/:room/stamps', (req, res) => {
  const room = roomParam(req, res); if (!room) return;
  // Stämplar vars bild saknas hoppas över, så de inte blir trasiga/osynliga i rummet.
  const images = {};
  const ok = new Map();
  const stamps = store.listStamps(room).filter((s) => {
    if (!ok.has(s.imageId)) ok.set(s.imageId, imageAvailable(s.imageId));
    const m = ok.get(s.imageId);
    if (m) images[s.imageId] = m;
    return !!m;
  });
  res.json({ room, stamps, images });
});

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isVec = (v, len) => Array.isArray(v) && v.length === len && v.every(isNum);

app.post('/api/rooms/:room/stamps', rateLimit(120), (req, res) => {
  const room = roomParam(req, res); if (!room) return;
  const b = req.body || {};
  const image = imageAvailable(b.imageId);
  if (!image) return res.status(410).json({ error: 'Designen finns inte längre på servern. Ladda upp den igen.', gone: true });
  if (!isVec(b.position, 3) || !isVec(b.normal, 3) || !isVec(b.quaternion, 4)) return res.status(400).json({ error: 'Felaktig placering' });
  if (!isNum(b.size) || b.size < 0.02 || b.size > 5) return res.status(400).json({ error: 'Felaktig storlek' });
  const stamp = store.addStamp(room, {
    imageId: image.id,
    position: b.position, normal: b.normal, quaternion: b.quaternion,
    size: b.size, rotation: isNum(b.rotation) ? b.rotation : 0,
    surface: String(b.surface || '').slice(0, 40),
    artist: String(b.artist || '').slice(0, 60),
  });
  broadcast(room, { type: 'stamp:add', stamp });
  res.json({ stamp, image });
});

// ---------- Admin (dold) ----------
app.get('/api/admin/check', (req, res) => res.json({ ok: isAdmin(req) }));

app.delete('/api/rooms/:room/stamps/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Ej behörig' });
  const room = roomParam(req, res); if (!room) return;
  const ok = store.deleteStamp(room, req.params.id);
  if (ok) broadcast(room, { type: 'stamp:remove', id: req.params.id });
  res.json({ ok });
});

// Tar bort en bild helt, och alla stämplar av den i alla rum.
app.delete('/api/stickers/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Ej behörig' });
  const id = String(req.params.id);
  if (!/^[a-f0-9]{16}$/.test(id)) return res.status(400).json({ error: 'Ogiltigt id' });
  const removed = store.deleteStampsWithImage(id);
  store.deleteImage(id);
  fs.rmSync(path.join(UPLOAD_DIR, id + '.webp'), { force: true });
  res.json({ ok: true, removedStamps: removed });
});

// ---------- Filer ----------
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));
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

app.listen(PORT, () => console.log(`Slap and Talk kör på http://localhost:${PORT}`));

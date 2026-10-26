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
const { broadcast, cleanName, playerPosition } = require('./realtime');
const { createHidden, autoPruneOn } = require('./hidden');
const { publicSticker } = require('./library');

// Konstnärens namn och länk (samma regler som i webbläsaren). ESM-modul, så den laddas med import().
const artistLinkMod = import('../shared/artistlink.mjs');
// Peels (baksidespapper): samma beräkningar som i webbläsaren (fallbana, landning, överlapp).
const peelsMod = import('../shared/peels.mjs');

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_PX = 1024;
// Sticker size: no upper limit in the full version (bigStickers), even beyond the room (Jens,
// 26 Oct 2026; a limit may come back). Free: at most FREE_MAX_STICKER_M (below). Only a technical
// guard: the size must be a finite number ≥ 2 cm (checked on slap).
// The starting size from a file-name letter prefix ("B_cat.png" = 17.5 cm): shared/sizeprefix.mjs.
const sizeMod = import('../shared/sizeprefix.mjs');
const { makeEntitlements, fromReq, FREE_MAX_STICKER_M, FREE_MIN_STICKER_M, KEY_RE } = require('./entitlements');
const { verifySignature } = require('./licenses');
// Paid full version (Lemon Squeezy, see server/licenses.js and README "Full version: Lemon Squeezy").
//   checkoutUrl  LS_CHECKOUT_URL (https only), tagged with checkout[custom][src]=app
//   show         the quiet "Full version" entry in ⚙ More: only with a checkout URL, and in the
//                demo profile (DEMO_PROFILE=1) only when SHOW_BUY=1.
function payConfig(env = process.env) {
  let checkoutUrl = '';
  try {
    const u = new URL(String(env.LS_CHECKOUT_URL || ''));
    if (u.protocol === 'https:') { u.searchParams.set('checkout[custom][src]', 'app'); checkoutUrl = u.toString(); }
  } catch { /* not set */ }
  const demo = env.DEMO_PROFILE === '1';
  return { checkoutUrl, show: !!checkoutUrl && (!demo || env.SHOW_BUY === '1'), webhookSecret: String(env.LS_WEBHOOK_SECRET || '') };
}
// Free version: new stickers are at most 1 m (+ a little rounding slack, then clamped to 1 m).
// Bigger, up to the wall height, needs the full version (bigStickers). Old stickers stay as they are.
const FREE_SIZE_SLACK = 0.01;

const { mountVideos, videoSettings } = require('./videos');
const { createMailer } = require('./mail');

// demo: the demo profile (server/demo.js createDemo) or null. library: loadLibrary() list.
function createApp(store, { adminToken = '', quickTtlHours = 24, recorder = null, entitle = makeEntitlements(process.env), mailer = createMailer(process.env), videos = videoSettings(process.env), clock = () => Date.now(), pay = payConfig(process.env), log = console, demo = null, library = [], autoPrune = autoPruneOn(process.env), pruneDelayMs = 1500 } = {}) {
const ADMIN_TOKEN = adminToken;
const app = express();
app.set('trust proxy', true); // vi ligger bakom Cloudflare-tunneln
// Full-version flags for a request; asks Lemon Squeezy first when the key is a paid key we haven't seen.
const entOf = (req) => (entitle.check ? entitle.check(fromReq(req)) : Promise.resolve(entitle(fromReq(req))));
const licenses = entitle.licenses || null;
const wrapEarly = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Lemon Squeezy webhook ----------
// Before express.json: the signature (X-Signature = HMAC-SHA256 hex of the RAW body, LS_WEBHOOK_SECRET)
// must be checked on the exact bytes. Events: order_created, order_refunded, license_key_created,
// license_key_updated (others are answered 200 and ignored, so LS doesn't retry them).
app.post('/api/ls/webhook', express.raw({ type: () => true, limit: '512kb' }), async (req, res) => {
  if (!pay.webhookSecret || !licenses) return res.status(503).json({ error: 'Payments are not configured.' });
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!verifySignature(pay.webhookSecret, raw, req.get('x-signature') || '')) return res.status(401).json({ error: 'Bad signature' });
  let payload; try { payload = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'Bad JSON' }); }
  const event = String(req.get('x-event-name') || payload?.meta?.event_name || '');
  try {
    const r = await licenses.handleWebhook(event, payload);
    res.json({ ok: true, ...(r && r.ignored ? { ignored: true } : {}) });
  } catch (e) { log.error(`[ls] webhook ${event} failed: ${e.message}`); res.status(500).json({ error: 'Could not handle the event' }); }
});

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

// What the web app should be (the demo profile or the normal app). Never cached.
app.get('/api/config', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(demo ? demo.publicConfig() : { demo: false });
});
// The curated sticker library (server/library.js).
// startCm: the design's starting height (cm) from its original file name's letter prefix.
app.get('/api/library', (req, res, next) => sizeMod.then((Z) => {
  res.set('Cache-Control', 'no-cache');
  res.json({ stickers: library.map((s) => ({ ...publicSticker(s), startCm: Z.designStartCm(s) })) });
}).catch(next));
// The demo: no uploads, no room editing (admin still can). Same 403 shape everywhere.
const demoBlocks = (req, res) => {
  if (!demo || isAdmin(req)) return false;
  res.status(403).json({ error: 'Not in this version.', demo: true }); return true;
};

app.post('/api/stickers', rateLimit(20), (req, res) => {
  if (demo) return res.status(403).json({ error: 'Uploads are not part of this version.', demo: true });
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
      // Starting size from the original file name ("B_cat.png" = 17.5 cm, no prefix = 15 cm). The
      // web app sends the name in `name` (its shrunk copy is always called klibba.png); a re-upload
      // of a lost design sends the startCm it already had.
      const Z = await sizeMod;
      const name = typeof req.body?.name === 'string' ? req.body.name.slice(0, 200) : String(req.file.originalname || '');
      const prefix = Z.parsePrefix(name);
      const sent = Number(req.body?.startCm);
      const startCm = prefix ? prefix.cm : Z.isStartCm(sent) ? sent : null;
      await store.clearRemoved(id); // a deliberate new upload brings an admin-removed design back
      const existing = await store.getImage(id);
      if (existing && await store.hasImageFile(id)) {
        // Same picture, renamed with a (different) prefix: the new prefix wins. No prefix: keep what it had.
        if (startCm !== null && existing.startCm !== startCm) return res.json(await store.addImage({ ...existing, startCm }));
        return res.json(existing.startCm === undefined ? { ...existing, startCm: Z.DEFAULT_START_CM } : existing);
      }
      await store.putImageFile(id, out.data);
      const meta = await store.addImage({
        id, url: `/uploads/${id}.webp`, width: out.info.width, height: out.info.height,
        artist: String(req.body?.artist || '').slice(0, 60), createdAt: new Date().toISOString(),
        startCm: startCm ?? Z.DEFAULT_START_CM,
      });
      res.json(meta);
    } catch (e) {
      res.status(400).json({ error: 'Could not read the image.' });
    }
  });
});

// ---------- Tyger (fabrics): en bild som upprepas över en del av gubben ----------
// Samma lagring som klibborna (id = innehållets hash, /uploads/<id>.webp), så alla i rummet kan
// hämta den med id:t. Bilden blir alltid kvadratisk med sidan en tvåpotens (32–512 px): den
// passas in och resten blir genomskinligt (där syns delens färg igenom). Webbläsaren krymper den
// redan innan, så den ska vara liten (högst ~300 kB in och ut).
const FAB = require('../shared/fabric.json');
const fabricUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: FAB.maxBytes, files: 1 },
  fileFilter: (req, file, cb) => cb(null, ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)),
});
const fabricSize = (w, h) => Math.min(FAB.maxPx, Math.max(FAB.minPx, 2 ** Math.ceil(Math.log2(Math.max(1, w | 0, h | 0)))));
// Full version flags for this browser (see server/entitlements.js). Free = all false.
// buy: only when the quiet "Full version" entry should exist (payConfig), never a nag.
app.get('/api/entitlements', wrapEarly(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const full = await entOf(req);
  res.json({ full, devAllowed: !!entitle.devAllowed, ...(pay.show ? { buy: { url: pay.checkoutUrl } } : {}), paid: !!licenses });
}));
// "I have a key": check a pasted key (manual FULL_ACCESS_KEYS or a Lemon Squeezy license key).
// The browser stores it only when ok. Never logged. 10 tries per IP and minute.
app.post('/api/unlock', rateLimit(10), wrapEarly(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
  if (!KEY_RE.test(key)) return res.status(400).json({ ok: false, error: 'That does not look like a key.' });
  const full = await entOf({ get: (h) => (h === 'x-unlock' ? key : undefined) });
  const ok = Object.values(full).some(Boolean);
  res.status(ok ? 200 : 403).json(ok ? { ok, full } : { ok, full, error: 'That key does not unlock the full version.' });
}));

app.post('/api/fabrics', rateLimit(20), (req, res) => {
  // Fabrics are part of the full version: free players can't make new ones (they still see others').
  entOf(req).then((ent) => {
  if (!ent.fabrics) return res.status(403).json({ error: 'Fabrics are part of the full version.' });
  fabricUpload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `The fabric image is larger than ${Math.round(FAB.maxBytes / 1024)} kB.` : 'The upload failed.' });
    if (!req.file) return res.status(400).json({ error: 'Pick a PNG, JPG or WebP image.' });
    try {
      const base = sharp(req.file.buffer, { limitInputPixels: 30e6 }).rotate();
      const meta = await base.metadata();
      const swap = (meta.orientation || 1) >= 5;
      const size = fabricSize(swap ? meta.height : meta.width, swap ? meta.width : meta.height);
      let out = null;
      for (const quality of [88, 75, 60]) {
        out = await base.clone().resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .webp({ quality, alphaQuality: 90 }).toBuffer({ resolveWithObject: true });
        if (out.data.length <= FAB.maxBytes) break;
      }
      if (out.data.length > FAB.maxBytes) return res.status(400).json({ error: 'That image is too detailed for a fabric.' });
      const id = contentId(out.data);
      const existing = await store.getImage(id);
      if (existing && await store.hasImageFile(id)) return res.json(existing);
      await store.putImageFile(id, out.data);
      res.json(await store.addImage({ id, url: `/uploads/${id}.webp`, width: out.info.width, height: out.info.height, kind: 'fabric', createdAt: new Date().toISOString() }));
    } catch (e) {
      res.status(400).json({ error: 'Could not read the image.' });
    }
  });
  }).catch(() => res.status(500).json({ error: 'Something went wrong on the server.' }));
});

// Finns bilden på riktigt? På Renders gratisnivå är disken tillfällig: efter en omstart
// kan både bildfilen och listan över bilder vara borta, medan webbläsaren fortfarande
// minns designen (och visar en gammal kopia ur sin cache).
// fresh: kontrollera bildfilen i lagringen även om vi redan vet att den fanns (när rummet laddas).
// En klibba (POST) litar på det servern redan vet, så den slipper vänta på lagringen.
async function imageAvailable(id, { fresh = false } = {}) {
  id = String(id || '');
  if (!/^[a-f0-9]{16}$/.test(id)) return null;
  const meta = await store.getImage(id);
  if (!meta || !(await store.hasImageFile(id, { fresh }))) return null;
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
  const images = {}, missing = [], removed = [];
  await Promise.all(ids.map(async (id) => {
    const m = await imageAvailable(id); if (m) { images[id] = m; return; }
    missing.push(id);
    if (await store.isRemoved(id)) removed.push(id); // removed on purpose: don't upload it again
  }));
  res.json({ images, missing, removed });
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
const roomPublic = (r) => ({ id: r.id, type: r.type, owner: r.owner || null, createdAt: r.createdAt, lastVisitAt: r.lastVisitAt, style: styleOf(r), peels: !!r.peelsOn,
  quickTtlHours: r.type === 'quick' ? quickTtlHours : null, ...(r.demo && r.demo.expiresAt ? { expiresAt: r.demo.expiresAt } : {}) });

// Skapa ett nytt snabbrum (inget konto behövs). Svarar med en kort kod, t.ex. "k7m2qx".
// Body (valfritt): { style: { floor, wall, wallColor?, ceiling?, seed? } }
// Svaret innehåller roomKey: en hemlig nyckel som bara skaparen får. Med den kan
// rummets utseende ändras senare. Servern sparar bara en hash av nyckeln.
app.post('/api/rooms', rateLimit(10), wrap(async (req, res) => {
  let style = null;
  if (req.body && req.body.style !== undefined) { style = cleanStyle(req.body.style); if (!style) return res.status(400).json({ error: 'Unknown room look' }); }
  if (demo) style = cleanStyle(demo.settings.style); // the demo: always the empty preset room (tiles, concrete, plain ceiling)
  const roomKey = crypto.randomBytes(24).toString('base64url');
  const room = await store.createRoom({ type: 'quick', style, keyHash: hashToken(roomKey), extra: demo ? demo.newRoomFields() : null });
  if (demo) demo.created(room);
  res.json({ room: roomPublic(room), roomKey });
}));

// Byt utseende: rummets skapare (nyckeln i x-room-key) eller admin. Staden: bara admin.
app.put('/api/rooms/:room/style', rateLimit(30), wrap(async (req, res) => {
  if (demoBlocks(req, res)) return;
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
  // Alla bilder kontrolleras samtidigt (mot R2 tar varje fråga en stund).
  const ids = [...new Set(room.stamps.map((s) => s.imageId))];
  const metas = await Promise.all(ids.map((i) => imageAvailable(i, { fresh: true })));
  ids.forEach((i, n) => ok.set(i, metas[n]));
  const stamps = room.stamps.filter((s) => {
    const m = ok.get(s.imageId);
    if (m) images[s.imageId] = m;
    return !!m;
  }).map(publicStamp);
  // Baksidespapper på golvet (bara när rummet har peels på). Bilden behövs för formen.
  let peels = [];
  if (room.peelsOn && Array.isArray(room.peels) && room.peels.length) {
    const pIds = [...new Set(room.peels.map((p) => p.imageId))].filter((i) => !ok.has(i));
    const pMetas = await Promise.all(pIds.map((i) => imageAvailable(i)));
    pIds.forEach((i, n) => ok.set(i, pMetas[n]));
    peels = room.peels.filter((p) => { const m = ok.get(p.imageId); if (m) images[p.imageId] = m; return !!m; });
  }
  res.json({ room: id, info: roomPublic(room), stamps, peels, images, cameras: room.cameras || [], ...(room.storageUnavailable ? { storageUnavailable: true } : {}) });
}));

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isVec = (v, len) => Array.isArray(v) && v.length === len && v.every(isNum);

// Namn och länk till den som gjorde klibban. Ogiltig länk (javascript:, data:, inloggning i
// länken, för lång …) sparas inte alls, och en tom länk sparas inte heller.
// Ett spelar-id från realtime.js (10 hex-tecken), annars ingenting.
const playerId = (v) => (typeof v === 'string' && /^[a-f0-9]{10}$/.test(v) ? v : undefined);

async function artistFields(b) {
  const { cleanArtistName, cleanArtistLink } = await artistLinkMod;
  const link = cleanArtistLink(b.artistLink);
  return { artist: cleanArtistName(b.artist), ...(link ? { artistLink: link } : {}) };
}

app.post('/api/rooms/:room/stamps', rateLimit(120), wrap(async (req, res) => {
  const room = roomParam(req, res); if (!room) return;
  const b = { ...(req.body || {}) };
  // The demo: only people actually in the room (connected over WebSocket, admitted with an
  // invite or the room key) can slap, and only while the room's hour lasts.
  if (demo && !isAdmin(req)) {
    if ((await demo.roomOpen(room)) !== 'ok') return res.status(410).json({ error: 'This room has closed.', closed: true });
    if (!playerPosition(room, playerId(b.by))) return res.status(403).json({ error: 'Join the room first.', demo: true });
  }
  const image = await imageAvailable(b.imageId);
  if (!image) {
    if (await store.isRemoved(String(b.imageId || ''))) return res.status(410).json({ error: 'That design was removed.', gone: true, removed: true });
    return res.status(410).json({ error: 'That design is no longer on the server. Please upload it again.', gone: true });
  }
  if (!isVec(b.position, 3) || !isVec(b.normal, 3) || !isVec(b.quaternion, 4)) return res.status(400).json({ error: 'Invalid position' });
  if (!isNum(b.size) || b.size < 0.02) return res.status(400).json({ error: 'Invalid size' });
  // Same gate as fabrics: only the full version (bigStickers) may slap stickers bigger than 1 m or
  // smaller than 15 cm. Free sizes outside 15 cm – 1 m are clamped (not refused), like before.
  if ((b.size > FREE_MAX_STICKER_M + FREE_SIZE_SLACK || b.size < FREE_MIN_STICKER_M - FREE_SIZE_SLACK) && !(await entOf(req)).bigStickers) {
    b.size = Math.min(FREE_MAX_STICKER_M, Math.max(FREE_MIN_STICKER_M, b.size));
  }
  // Peels: på golvet fastnar klibbor inte på baksidespapper (mer än PEEL.refuseOverlap = nej).
  const P = await peelsMod;
  let peelSt = await store.peelState(room);
  // Peels på: man når bara så långt armen räcker (P.SLAP_REACH), mätt från där servern senast
  // hörde att spelaren stod. Peels av: ingen gräns alls.
  let reachFrom = null;
  if (peelSt.on) {
    const reach = await checkReach(P, room, b);
    if (!reach.ok) return res.status(409).json({ error: 'Out of reach.', tooFar: true, ...(reach.distance ? { distance: reach.distance } : {}) });
    reachFrom = reach.from;
  }
  if (peelSt.on && peelSt.peels.length && P.onFloor(String(b.surface || ''), b.normal)) {
    const frac = await floorOverlap(P, image, b, peelSt.peels);
    if (frac > P.PEEL.refuseOverlap) return res.status(409).json({ error: 'Nope.', nope: true, overlap: Math.round(frac * 1000) / 1000 });
  }
  // Peel-nyckel: bara den som stämplade får den. Servern sparar bara en hash av den.
  const peelToken = crypto.randomBytes(24).toString('base64url');
  // Vem stämplade (för gränsen på 20 peel-bara per person och rum): en slumpad enhets-id från
  // webbläsaren, annars IP-adressen. Bara en hash sparas.
  const owner = typeof b.owner === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(b.owner) ? 'd:' + b.owner : 'ip:' + req.ip;
  const evicted = []; // the room is full (MAX_STAMPS_PER_ROOM): the oldest stickers quietly go
  const saved = await store.addStamp(room, {
    peelHash: hashToken(peelToken), peelOwner: hashToken(owner).slice(0, 24),
    imageId: image.id,
    position: b.position, normal: b.normal, quaternion: b.quaternion,
    size: b.size, rotation: isNum(b.rotation) ? b.rotation : 0,
    surface: String(b.surface || '').slice(0, 40),
    // A library sticker always carries its own artist (whoever slaps it), so the credit is right.
    ...(await artistFields(image.library ? { artist: image.artist, artistLink: image.artistLink } : b)),
  }, { onEvict: (ids) => evicted.push(...ids), onLeave: (ids) => hidden.left(room, ids) });
  for (const id of evicted) broadcast(room, { type: 'stamp:remove', id });
  const stamp = publicStamp(saved);
  // nonce: en slumpad lapp från klienten, så den som stämplade känner igen sin egen stämpel
  // (och inte spelar upp ljudet två gånger). Aldrig peel-nyckeln.
  const nonce = typeof b.nonce === 'string' ? b.nonce.slice(0, 40) : undefined;
  // by: vem i rummet (WebSocket-id) som slappade, så de andras webbläsare kan visa gubbens slap.
  // Sparas inte med klibban. Äldre klienter skickar inget och bryr sig inte om fältet.
  const by = playerId(b.by);
  // Peels på: baksidespappret faller från den som slappade (fallet räknas ut av klienterna från seed).
  let peel = null;
  if (peelSt.on || (await store.peelState(room)).on) {
    const from = reachFrom || cleanFrom(b.peelFrom) || fallbackFrom(b.position, b.normal);
    const seed = nonce && /^[A-Za-z0-9_-]{1,40}$/.test(nonce) ? nonce : saved.id;
    const { side, ...plan } = P.peelPlan(seed, from, b.position);
    const [w, h] = P.stampDims(image, stamp.size);
    peel = await store.addPeel(room, { id: saved.id, imageId: image.id, w: Math.round(w * 1e4) / 1e4, h: Math.round(h * 1e4) / 1e4, seed, ...plan }, P.PEEL.maxPerRoom);
  }
  broadcast(room, { type: 'stamp:add', stamp, image, ...(nonce ? { nonce } : {}), ...(by ? { by } : {}), ...(peel ? { peel } : {}) });
  res.json({ stamp, image, peelToken, ...(peel ? { peel } : {}) });
}));

// Räckvidden med peels på. Spelaren måste vara ansluten till rummet (WebSocket, b.by) så servern
// vet var den står. Positionen kan ligga ett steg efter (move går över WebSocket, slappen över
// HTTP): säger klienten att den står inom räckhåll väntar vi högst REACH_WAIT_MS på nästa move.
// Svar: { ok, from } där from = var pappret föds från (klientens egen position om den stämmer med
// serverns, så pappret landar på samma ställe för alla, annars serverns), eller { ok: false, distance }.
const REACH_WAIT_MS = 400;
async function checkReach(P, room, b) {
  const by = playerId(b.by);
  let pos = playerPosition(room, by);
  if (!pos) return { ok: false };
  const limit = P.SLAP_REACH + P.REACH_TOLERANCE;
  const dist = (q) => P.reachDistance(q.p, b.position);
  const claimed = cleanFrom(b.peelFrom);
  if (dist(pos) > limit) {
    const claimOk = claimed && P.reachDistance([claimed.x, pos.p[1], claimed.z], b.position) <= P.SLAP_REACH + 0.05;
    const t0 = Date.now();
    while (claimOk && Date.now() - t0 < REACH_WAIT_MS) {
      await new Promise((r) => setTimeout(r, 20));
      const q = playerPosition(room, by); if (!q) break;
      if (q.moves !== pos.moves) { pos = q; if (dist(pos) <= limit) break; }
    }
    if (dist(pos) > limit) return { ok: false, distance: Math.round(dist(pos) * 100) / 100 };
  }
  const ours = { x: pos.p[0], z: pos.p[2], yaw: isNum(pos.y) ? pos.y : 0 };
  const from = claimed && Math.hypot(claimed.x - ours.x, claimed.z - ours.z) <= P.REACH_TOLERANCE ? claimed : ours;
  return { ok: true, from };
}

// Var stod den som slappade? { p: [x, z], yaw } från klienten, inom rummet. Annars gissar vi:
// en bit framför klibban (längs normalen), vänd mot den.
function cleanFrom(f) {
  if (!f || typeof f !== 'object' || !isVec(f.p, 2) || !isNum(f.yaw)) return null;
  const hx = ROOM_SIZE.width / 2, hz = ROOM_SIZE.depth / 2;
  return { x: Math.min(hx, Math.max(-hx, f.p[0])), z: Math.min(hz, Math.max(-hz, f.p[1])), yaw: f.yaw };
}
function fallbackFrom(pos, n) {
  const horiz = Math.hypot(n[0], n[2]);
  const nx = horiz > 0.3 ? n[0] / horiz : 0, nz = horiz > 0.3 ? n[2] / horiz : 1;
  const x = pos[0] + nx * 0.8, z = pos[2] + nz * 0.8;
  return cleanFrom({ p: [x, z], yaw: Math.atan2(nx, nz) });
}
// Formen (alfamask) per design, för överlappet på golvet. Cachas (en design ändras aldrig).
const maskCache = new Map();
async function imageMask(P, id) {
  if (maskCache.has(id)) return maskCache.get(id);
  const buf = await store.getImageFile(id);
  let mask = null;
  if (buf) {
    const n = P.PEEL.maskSize;
    const raw = await sharp(buf).ensureAlpha().resize(n, n, { fit: 'fill' }).extractChannel(3).raw().toBuffer();
    mask = P.maskFromAlpha(raw, n);
  }
  if (maskCache.size > 2000) maskCache.delete(maskCache.keys().next().value);
  maskCache.set(id, mask);
  return mask;
}
async function floorOverlap(P, image, b, peels) {
  const [w, h] = P.stampDims(image, b.size);
  const { u, v } = P.stampFrame(b.quaternion);
  const sticker = { x: b.position[0], z: b.position[2], w, h, u, v };
  const R = Math.hypot(w, h) / 2;
  const near = peels.filter((p) => Math.hypot(p.x - sticker.x, p.z - sticker.z) < R + Math.hypot(p.w, p.h) / 2);
  if (!near.length) return 0;
  sticker.mask = await imageMask(P, image.id);
  const withMasks = await Promise.all(near.map(async (p) => ({ ...p, mask: await imageMask(P, p.imageId) })));
  return P.overlapFraction(sticker, withMasks);
}

// Peels på/av (rummets skapare med rumsnyckeln, eller admin; Staden bara admin). { on: true|false }
app.put('/api/rooms/:room/peels', rateLimit(30), wrap(async (req, res) => {
  if (demoBlocks(req, res)) return;
  const id = roomParam(req, res); if (!id) return;
  if (typeof req.body?.on !== 'boolean') return res.status(400).json({ error: 'on must be true or false' });
  const r = await store.setPeelsOn(id, req.body.on, canEditRoom(req));
  if (r === 'notfound') return res.status(404).json({ error: 'That room does not exist' });
  if (r === 'forbidden') return res.status(403).json({ error: 'Only the room’s creator can change this' });
  broadcast(id, { type: 'room:peels', on: req.body.on });
  res.json({ ok: true, on: req.body.on });
}));
// Sopa golvet: allt baksidespapper bort. Samma rättighet.
app.post('/api/rooms/:room/peels/clear', rateLimit(20), wrap(async (req, res) => {
  if (demoBlocks(req, res)) return;
  const id = roomParam(req, res); if (!id) return;
  const r = await store.clearPeels(id, canEditRoom(req));
  if (r === 'notfound') return res.status(404).json({ error: 'That room does not exist' });
  if (r === 'forbidden') return res.status(403).json({ error: 'Only the room’s creator can change this' });
  broadcast(id, { type: 'peels:clear' });
  res.json({ ok: true, removed: r });
}));

// Peela egna stämplar: { items: [{ id, token }, ...] } (högst 200 åt gången, t.ex. "Peela alla").
// Svar: { results: { <id>: 'ok' | 'notfound' | 'forbidden' } }
app.post('/api/rooms/:room/peel', rateLimit(60), wrap(async (req, res) => {
  const room = roomParam(req, res); if (!room) return;
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 200)
    .filter((x) => x && typeof x.id === 'string' && /^[a-f0-9]{16}$/.test(x.id)).map((x) => ({ id: x.id, token: String(x.token || '') })) : [];
  if (!items.length) return res.status(400).json({ error: 'No stickers to peel' });
  const results = await store.peelStamps(room, items, (s, token) => tokenMatches(token, s.peelHash));
  const by = playerId(req.body?.by);
  for (const [id, r] of Object.entries(results)) if (r === 'ok') broadcast(room, { type: 'stamp:remove', id, ...(by ? { by } : {}) });
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

// ---------- Clear hidden stickers ("Clear history") ----------
// Same rights as resetting the room (the creator with the room key, or admin; the City: admin only;
// the demo: the creator). Removes every sticker that is (almost) fully covered by newer ones
// (shared/coverage.mjs: ≥ 98 % of its opaque area), keeps the rest in order, and drops all peel keys,
// so what you see becomes the room's new base layer. One locked step; everyone gets room:clear-hidden.
const hidden = createHidden({
  store, broadcast, log, auto: autoPrune, delayMs: pruneDelayMs,
  imageMeta: (id) => imageAvailable(id),
  imageMask: async (id) => imageMask(await peelsMod, id),
});
app.get('/api/rooms/:room/hidden', rateLimit(30), wrap(async (req, res) => {
  const id = roomParam(req, res); if (!id) return;
  if (!(await rightsTo(req, res, id, 'clear hidden stickers'))) return;
  res.json(await hidden.count(id) || { hidden: 0, total: 0 });
}));
app.post('/api/rooms/:room/clear-hidden', rateLimit(10), wrap(async (req, res) => {
  const id = roomParam(req, res); if (!id) return;
  if (!(await rightsTo(req, res, id, 'clear hidden stickers'))) return;
  const r = await hidden.clear(id);
  if (!r) return res.status(404).json({ error: 'That room does not exist' });
  const by = cleanBy(req.body?.by) || (isAdmin(req) ? 'Admin' : 'The room’s creator');
  broadcast(id, { type: 'room:clear-hidden', ids: r.removed, by, kept: r.kept });
  res.json({ ok: true, removed: r.removed.length, kept: r.kept, historyCleared: r.historyCleared });
}));

// ---------- Virtuella kameror ----------
// { name, p: [x,y,z] (kamerans position), yaw, pitch (radianer), fov (lodrät bildvinkel, grader), aspect: '' | '16:9' | '9:16' }
const ROOM_SIZE = require('../shared/room.json');
const MAX_CAMERAS = 12;
const CAM_ID_RE = /^[a-f0-9]{10}$/;
const ASPECTS = ['', '16:9', '9:16'];
// The auto cameraman (shared/autocam.mjs AUTO_CHOICES): a camera entry { auto: path } that nobody
// places; the web app and the replay move it along the path. At most one per room.
const AUTO_CHOICES = ['perimeter', 'diagonal', 'pushin', 'seeded'];
const wrapAngle = (a) => Math.round(Math.atan2(Math.sin(a), Math.cos(a)) * 1e4) / 1e4;
function cleanCamera(b, old = null) {
  b = b && typeof b === 'object' ? b : {};
  const c = old ? { ...old } : { fov: 60, aspect: '', yaw: 0, pitch: 0, p: [0, 1.6, 0] };
  if (b.p !== undefined || (!old && b.auto === undefined)) {
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
  if (b.auto !== undefined || (old && old.auto)) {
    const a = b.auto === undefined ? old.auto : String(b.auto);
    if (!AUTO_CHOICES.includes(a) || (old && !old.auto)) return null; // a placed camera can't become an auto one (or back)
    c.auto = a; c.p = [0, 1.6, 0]; c.yaw = 0; c.pitch = 0; c.fov = 50; c.aspect = '';
  }
  return c;
}
app.post('/api/rooms/:room/cameras', rateLimit(60), wrap(async (req, res) => {
  if (demoBlocks(req, res)) return;
  const id = roomParam(req, res); if (!id) return;
  const cam = cleanCamera(req.body); if (!cam) return res.status(400).json({ error: 'Invalid camera' });
  const r = await store.editCameras(id, canEditRoom(req), (list) => {
    if (list.length >= MAX_CAMERAS) return { error: `At most ${MAX_CAMERAS} cameras per room`, save: false };
    if (cam.auto && list.some((c) => c.auto)) return { error: 'The room already has an auto cameraman', save: false };
    // Camera 1, 2, 3 … (det lägsta lediga numret)
    const used = new Set(list.map((c) => /^Camera (\d+)$/.exec(c.name)?.[1]).filter(Boolean).map(Number));
    let n = 1; while (used.has(n)) n++;
    const c = { id: crypto.randomBytes(5).toString('hex'), name: cam.name || (cam.auto ? 'Auto cameraman' : `Camera ${n}`), p: cam.p, yaw: cam.yaw, pitch: cam.pitch, fov: cam.fov, aspect: cam.aspect, ...(cam.auto ? { auto: cam.auto } : {}), createdAt: new Date().toISOString() };
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
  if (demoBlocks(req, res)) return;
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
// The demo records too (finished videos with the auto-director); placing cameras stays off there.
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
          if (images[s.imageId]) stamps.push(publicStamp(s));
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
// The auto-director's shot list (shared/director.mjs): who talks when and which angle, for editing.
// Like the log: anyone with the (unguessable) recording id.
app.get('/api/rooms/:room/recordings/:rec/shots', wrap(async (req, res) => {
  const id = roomParam(req, res); if (!id || !needRecorder(res)) return;
  const list = await recorder.shots(id, String(req.params.rec));
  if (!list) return res.status(404).json({ error: 'That recording does not exist' });
  res.set('Cache-Control', 'no-cache').json(list);
}));
app.delete('/api/rooms/:room/recordings/:rec', wrap(async (req, res) => {
  const id = roomParam(req, res); if (!id || !needRecorder(res)) return;
  if (!(await rightsTo(req, res, id))) return;
  res.json({ ok: await recorder.remove(id, String(req.params.rec)) });
}));

// ---------- Finished videos (see videos.js): upload, list, watch page, email the link ----------
app.locals.hidden = hidden;
app.locals.videos = mountVideos(app, { store, recorder, entitle, fromReq, mailer, rightsTo, roomParam, wrap, isAdmin, settings: videos, clock });

// ---------- Admin (dold) ----------
app.get('/api/admin/check', (req, res) => res.json({ ok: isAdmin(req) }));
// Paid full versions (Lemon Squeezy): only counts, never keys. x-admin-token: ADMIN_TOKEN.
app.get('/api/admin/entitlements', wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Not allowed' });
  res.set('Cache-Control', 'no-store');
  const paid = licenses ? await licenses.counts() : { active: 0, locked: 0 };
  res.json({ paidActive: paid.active, paidLocked: paid.locked, manualKeys: entitle.manualCount || 0, lemonSqueezy: !!(licenses && licenses.enabled), checkout: !!pay.checkoutUrl });
}));

app.delete('/api/rooms/:room/stamps/:id', wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Not allowed' });
  const room = roomParam(req, res); if (!room) return;
  const ok = await store.deleteStamp(room, req.params.id);
  if (ok) broadcast(room, { type: 'stamp:remove', id: req.params.id });
  res.json({ ok });
}));

// Tar bort en bild helt, och alla stämplar av den i alla rum.
// The design is remembered as removed (tombstone), so its uploader's browser drops it from the
// palette instead of uploading it again. ?simulateLoss=1 (tests): forget it WITHOUT a tombstone,
// like Render losing the file, so the browser restores it from its local copy.
app.delete('/api/stickers/:id', wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Not allowed' });
  const id = String(req.params.id);
  if (!/^[a-f0-9]{16}$/.test(id)) return res.status(400).json({ error: 'Invalid id' });
  const lost = req.query.simulateLoss === '1';
  const removed = await store.deleteStampsWithImage(id);
  await store.deleteImage(id);
  await store.deleteImageFile(id);
  if (!lost) await store.markRemoved(id);
  broadcast('*', { type: 'image:remove', id, removed: !lost });
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

module.exports = { createApp, payConfig };

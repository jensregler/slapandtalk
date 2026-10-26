// Photos (📷 Photo / the P key, live in the room or from any replay view): a still of what you
// see, so people keep memories of rooms that go away (demo rooms close after an hour). The
// browser downloads it straight away and uploads a JPEG here; the server re-encodes it (sharp:
// no metadata, at most 4096 px) and keeps it like the finished videos:
//   photos/<room>/<photoId>.jpg    the file
//   photos/<room>/<photoId>.json   its meta (for the room's Recordings list)
//   photos/_index/<photoId>.json   the same meta, found by id alone (/p/<id>, cleanup)
// NEVER under rooms/ or recordings/, so a demo room's expiry (server/demo.js) leaves them alone.
// Each photo lives PHOTO_RETENTION_DAYS (default: VIDEO_RETENTION_DAYS, else 30) after it was
// taken, counted at read time; cleanup() deletes the rest. Ids are random (16 hex = 64 bits),
// so a photo is exactly as private as a video: whoever has the link.
//
// Routes:
//   POST /api/rooms/:room/photos?source=live|replay&rec=<recId>&view=<view>   raw image/jpeg or image/png
//   GET  /api/rooms/:room/photos       list (the room's creator / admin, like recordings and videos)
//   GET  /api/photos/:id               public meta
//   DELETE /api/photos/:id             admin only
//   GET  /p/:id                        a simple page;  GET /p/:id/file  the JPEG (?download=1)
// Anyone in a room may take photos (it is not a room setting, also in the demo); uploads are rate
// limited per IP and capped at PHOTO_MAX_MB.
const crypto = require('crypto');
const sharp = require('sharp');
const { windowLimit } = require('./videos');

const PHOTO_ID_RE = /^[a-f0-9]{16}$/;
const INDEX = 'photos/_index/';
const VIEW_RE = /^[a-z]+(:[A-Za-z0-9_-]{1,40})?$/;

function photoSettings(env = process.env) {
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
  return {
    retentionDays: num(env.PHOTO_RETENTION_DAYS, num(env.VIDEO_RETENTION_DAYS, 30)),
    maxMB: num(env.PHOTO_MAX_MB, 8),
    perMinute: num(env.PHOTO_UPLOADS_PER_MINUTE, 6), // per IP
    perHour: num(env.PHOTO_UPLOADS_PER_HOUR, 60), // per IP
    maxConcurrent: 3,
    publicUrl: String(env.PUBLIC_URL || '').replace(/\/+$/, ''),
  };
}

function createPhotoStore(adapter, { clock = () => Date.now(), retentionDays = 30 } = {}) {
  const retentionMs = retentionDays * 86400_000;
  const k = { file: (m) => `photos/${m.room}/${m.id}.jpg`, meta: (room, id) => `photos/${room}/${id}.json`, index: (id) => `${INDEX}${id}.json` };
  const withExpiry = (m) => ({ ...m, expiresAt: new Date(Date.parse(m.createdAt) + retentionMs).toISOString() });
  const expired = (m) => clock() >= Date.parse(m.createdAt) + retentionMs;
  const parse = (b) => { if (!b) return null; try { return JSON.parse(b.toString('utf8')); } catch { return null; } };
  async function save({ room, jpeg, width, height, source, recId, view, free }) {
    const m = { v: 1, id: crypto.randomBytes(8).toString('hex'), room, source, recId: recId || null, view: view || null, width, height, bytes: jpeg.length, free: !!free, createdAt: new Date(clock()).toISOString() };
    await adapter.put(k.file(m), jpeg, 'image/jpeg');
    const body = Buffer.from(JSON.stringify(m));
    await adapter.put(k.meta(room, m.id), body, 'application/json');
    await adapter.put(k.index(m.id), body, 'application/json');
    return withExpiry(m);
  }
  async function get(id) {
    if (!PHOTO_ID_RE.test(String(id))) return null;
    const m = parse(await adapter.get(k.index(id)));
    return m && !expired(m) ? withExpiry(m) : null;
  }
  async function listRoom(room) {
    const out = [];
    for (const key of await adapter.list(`photos/${room}/`)) {
      if (!key.endsWith('.json')) continue;
      const m = parse(await adapter.get(key));
      if (m && m.id && !expired(m)) out.push(withExpiry(m));
    }
    return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  async function remove(m) { await adapter.delete(k.file(m)); await adapter.delete(k.meta(m.room, m.id)); await adapter.delete(k.index(m.id)); }
  async function cleanup() {
    const gone = [];
    for (const key of await adapter.list(INDEX)) {
      if (!key.endsWith('.json')) continue;
      const m = parse(await adapter.get(key));
      if (m && m.createdAt && m.room && expired(m)) { await remove(m); gone.push(m.id); }
    }
    return gone;
  }
  return { save, get, listRoom, remove, cleanup, file: (m) => adapter.get(k.file(m)), keys: k, retentionMs };
}

// The body, at most maxBytes (413 beyond).
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const parts = []; let n = 0, done = false;
    req.on('data', (c) => { if (done) return; n += c.length; if (n > maxBytes) { done = true; reject(Object.assign(new Error('too big'), { status: 413 })); return; } parts.push(c); });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(parts)); } });
    req.on('aborted', () => { if (!done) { done = true; reject(Object.assign(new Error('aborted'), { status: 400 })); } });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}
const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPng = (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
function photoPage(m, base) {
  const url = `${base}/p/${m.id}`, file = `${base}/p/${m.id}/file`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Slap and Talk – photo</title>
<meta name="robots" content="noindex">
<meta property="og:title" content="A Slap and Talk photo">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(file)}">
<link rel="icon" href="/icons/icon-192.png">
<style>
  html, body { margin: 0; background: #121212; color: #e8e8e8; font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 1400px; margin: 0 auto; padding: 20px 16px 40px; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 14px; letter-spacing: .02em; }
  img { display: block; width: 100%; height: auto; max-height: 80vh; object-fit: contain; background: #000; border-radius: 10px; }
  .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 14px; }
  a.btn, button { font: inherit; color: #e8e8e8; background: #242424; border: 1px solid #3a3a3a; border-radius: 8px; padding: 7px 14px; text-decoration: none; cursor: pointer; }
  .muted { color: #9a9a9a; font-size: 13px; }
  footer { margin-top: 28px; } footer a { color: #e8c25a; text-decoration: none; }
</style></head>
<body><main>
  <h1>Slap and Talk</h1>
  <img src="/p/${esc(m.id)}/file" alt="A photo from a Slap and Talk room" width="${m.width}" height="${m.height}">
  <div class="row">
    <a class="btn" href="/p/${esc(m.id)}/file?download=1" download>Download</a>
    <button type="button" id="copy">Copy link</button>
    <span class="muted">${m.width}×${m.height} · kept until ${esc(fmtDate(m.expiresAt))}</span>
  </div>
  <footer class="muted">Taken in <a href="/">Slap and Talk</a> · make your own room.</footer>
</main>
<script>
  document.getElementById('copy').onclick = async function () {
    try { await navigator.clipboard.writeText(${JSON.stringify(url).replace(/</g, '\\u003c')}); this.textContent = 'Copied'; } catch (e) { this.textContent = 'Copy failed'; }
  };
</script>
</body></html>`;
}

function mountPhotos(app, { store, entitle, fromReq, rightsTo, roomParam, wrap, isAdmin, settings = photoSettings(), clock = () => Date.now() }) {
  const photos = createPhotoStore(store.adapter, { clock, retentionDays: settings.retentionDays });
  const maxBytes = Math.round(settings.maxMB * 1024 * 1024);
  let inFlight = 0;
  const baseOf = (req) => settings.publicUrl || `${req.protocol}://${req.get('host')}`;
  const pub = ({ room, ...m }) => ({ ...m, url: `/p/${m.id}`, fileUrl: `/p/${m.id}/file` });

  app.post('/api/rooms/:room/photos', windowLimit(settings.perMinute, 60_000, 'Easy now – one photo at a time.'), windowLimit(settings.perHour, 3600_000), wrap(async (req, res) => {
    const room = roomParam(req, res); if (!room) return;
    const declared = Number(req.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) return res.status(413).set('Connection', 'close').json({ error: `The photo is larger than ${settings.maxMB} MB.` });
    if (room !== 'stad' && !(await store.getRoom(room))) return res.status(404).json({ error: 'That room does not exist' });
    if (inFlight >= settings.maxConcurrent) return res.status(503).set('Retry-After', '5').json({ error: 'Busy – try again in a moment.' });
    inFlight++;
    try {
      let buf;
      try { buf = await readBody(req, maxBytes); } catch (e) {
        if (e.status === 413) { res.status(413).set('Connection', 'close').json({ error: `The photo is larger than ${settings.maxMB} MB.` }); res.on('finish', () => req.destroy()); return; }
        return res.status(400).json({ error: 'The upload was interrupted.' });
      }
      if (!(isJpeg(buf) || isPng(buf))) return res.status(415).json({ error: 'That is not a JPEG or PNG photo.' });
      let out;
      try {
        out = await sharp(buf, { limitInputPixels: 8192 * 8192 }).rotate().resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true });
      } catch { return res.status(415).json({ error: 'That photo could not be read.' }); }
      if (out.info.width < 64 || out.info.height < 64) return res.status(400).json({ error: 'The photo is too small.' });
      const q = req.query || {};
      const source = q.source === 'replay' ? 'replay' : 'live';
      const recId = /^[a-f0-9]{16}$/.test(String(q.rec || '')) ? String(q.rec) : null;
      const view = VIEW_RE.test(String(q.view || '')) ? String(q.view) : null;
      const free = !(entitle.check ? await entitle.check(fromReq(req)) : entitle(fromReq(req))).cleanVideo;
      const m = await photos.save({ room, jpeg: out.data, width: out.info.width, height: out.info.height, source, recId, view, free });
      res.json({ photo: pub(m), shareUrl: `${baseOf(req)}/p/${m.id}` });
    } finally { inFlight--; }
  }));
  app.get('/api/rooms/:room/photos', wrap(async (req, res) => {
    const id = roomParam(req, res); if (!id) return;
    if (!(await rightsTo(req, res, id, 'see the photos'))) return;
    res.json({ photos: (await photos.listRoom(id)).map(pub) });
  }));
  app.get('/api/photos/:id', wrap(async (req, res) => {
    const m = await photos.get(req.params.id);
    if (!m) return res.status(404).json({ error: 'That photo does not exist (or is too old).' });
    res.json(pub(m));
  }));
  app.delete('/api/photos/:id', wrap(async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Not allowed' });
    const m = await photos.get(req.params.id);
    if (!m) return res.status(404).json({ error: 'That photo does not exist' });
    await photos.remove(m); res.json({ ok: true });
  }));
  app.get('/p/:id', wrap(async (req, res) => {
    const m = await photos.get(req.params.id);
    res.set('Cache-Control', 'no-cache');
    if (!m) return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Slap and Talk</title><body style="background:#121212;color:#ddd;font:16px system-ui;padding:40px;text-align:center"><p>This photo does not exist any more.</p><p><a style="color:#e8c25a" href="/">Slap and Talk</a></p>');
    res.type('html').send(photoPage(m, baseOf(req)));
  }));
  app.get('/p/:id/file', wrap(async (req, res) => {
    const m = await photos.get(req.params.id); if (!m) return res.status(404).end();
    const b = await photos.file(m); if (!b) return res.status(404).end();
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400', 'Content-Disposition': `${req.query.download ? 'attachment' : 'inline'}; filename="slapandtalk-${m.room}-${m.createdAt.replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')}.jpg"` });
    res.send(b);
  }));
  return photos;
}

module.exports = { mountPhotos, createPhotoStore, photoSettings, photoPage, PHOTO_ID_RE };

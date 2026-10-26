// Finished videos (made on the replay page: logo intro + the replay, free videos with the
// channel bug and the ticker). The browser records the .webm/.mp4 and uploads it here.
//
// Stored via the storage layer (disk or R2), NEVER under rooms/ or recordings/, so a video
// outlives its room (demo rooms are deleted after an hour):
//   videos/<room>/<videoId>.webm|.mp4   the file
//   videos/<room>/<videoId>.json        its meta (for the room's Recordings list)
//   videos/_index/<videoId>.json        the same meta, found by id alone (watch page, cleanup)
// Each video lives VIDEO_RETENTION_DAYS (default 30) after it was made, counted from createdAt
// at read time, so changing the env var applies to old videos too. cleanup() deletes the rest.
//
// Routes:
//   GET  /api/videos/config                          { email, retentionDays, maxMB }
//   POST /api/rooms/:room/recordings/:rec/videos     raw body (video/webm or video/mp4), streamed to a temp file
//   GET  /api/rooms/:room/videos                     list (same rights as the room's recordings)
//   GET  /api/videos/:id                             public meta
//   POST /api/videos/:id/email   { email }           mails the link once; the address is never stored
//   DELETE /api/videos/:id                           admin only
//   GET  /v/:id                                      a simple watch page
//   GET  /v/:id/file                                 the file, with HTTP range requests (seeking)
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { cleanEmail } = require('./mail');

const VIDEO_ID_RE = /^[a-f0-9]{16}$/;
const REC_ID_RE = /^[a-f0-9]{16}$/;
const INDEX = 'videos/_index/'; // "_" is never a room id, so this can't collide with a room
const ASPECTS = ['16:9', '9:16', '1:1'];

function videoSettings(env = process.env) {
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
  return {
    retentionDays: num(env.VIDEO_RETENTION_DAYS, 30),
    maxMB: num(env.VIDEO_MAX_MB, 80),
    maxConcurrent: num(env.VIDEO_MAX_UPLOADS, 2), // uploads at the same time (memory/disk on Render free)
    uploadsPerMinute: num(env.VIDEO_UPLOADS_PER_MINUTE, 4), // per IP
    uploadsPerHour: num(env.VIDEO_UPLOADS_PER_HOUR, 20), // per IP
    emailsPerMinute: 3, // per IP
    emailsPerHour: num(env.VIDEO_EMAILS_PER_HOUR, 10), // per IP
    emailsPerVideo: 5,
    publicUrl: String(env.PUBLIC_URL || '').replace(/\/+$/, ''),
    tmpDir: env.VIDEO_TMP_DIR || os.tmpdir(),
  };
}

function createVideoStore(adapter, { clock = () => Date.now(), retentionDays = 30 } = {}) {
  const retentionMs = retentionDays * 86400_000;
  const k = {
    file: (m) => `videos/${m.room}/${m.id}.${m.ext}`,
    meta: (room, id) => `videos/${room}/${id}.json`,
    index: (id) => `${INDEX}${id}.json`,
  };
  const withExpiry = (m) => ({ ...m, expiresAt: new Date(Date.parse(m.createdAt) + retentionMs).toISOString() });
  const expired = (m) => clock() >= Date.parse(m.createdAt) + retentionMs;
  const parse = (b) => { if (!b) return null; try { return JSON.parse(b.toString('utf8')); } catch { return null; } };

  async function save({ room, recId, file, type, ext, bytes, durationMs, aspect, free }) {
    const m = {
      v: 1, id: crypto.randomBytes(8).toString('hex'), room, recId, type, ext, bytes,
      durationMs: Math.max(0, Math.min(6 * 3600_000, Math.round(Number(durationMs) || 0))),
      aspect: ASPECTS.includes(aspect) ? aspect : null, free: !!free, intro: true, createdAt: new Date(clock()).toISOString(),
    };
    await adapter.putFile(k.file(m), file, type);
    const body = Buffer.from(JSON.stringify(m));
    await adapter.put(k.meta(room, m.id), body, 'application/json');
    await adapter.put(k.index(m.id), body, 'application/json');
    return withExpiry(m);
  }
  async function get(id) {
    if (!VIDEO_ID_RE.test(String(id))) return null;
    const m = parse(await adapter.get(k.index(id)));
    if (!m || expired(m)) return null;
    return withExpiry(m);
  }
  async function listRoom(room) {
    const out = [];
    for (const key of await adapter.list(`videos/${room}/`)) {
      if (!key.endsWith('.json')) continue;
      const m = parse(await adapter.get(key));
      if (m && m.id && !expired(m)) out.push(withExpiry(m));
    }
    return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  async function remove(m) {
    await adapter.delete(k.file(m)); await adapter.delete(k.meta(m.room, m.id)); await adapter.delete(k.index(m.id));
  }
  // The retention job: deletes every video older than retentionDays. Returns the deleted ids.
  async function cleanup() {
    const gone = [];
    for (const key of await adapter.list(INDEX)) {
      if (!key.endsWith('.json')) continue;
      const m = parse(await adapter.get(key));
      if (!m || !m.createdAt || !m.room || !m.ext) continue;
      if (expired(m)) { await remove(m); gone.push(m.id); }
    }
    return gone;
  }
  const stat = (m) => adapter.stat(k.file(m));
  const stream = (m, range) => adapter.getStream(k.file(m), range);
  return { save, get, listRoom, remove, cleanup, stat, stream, keys: k, retentionMs };
}

// Per-IP limit over a time window (the app's rateLimit() is per minute only).
function windowLimit(max, ms, message = 'Easy now – try again a bit later.') {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    if (hits.size > 5000) for (const [key, l] of hits) if (!l.some((t) => now - t < ms)) hits.delete(key);
    const list = (hits.get(req.ip) || []).filter((t) => now - t < ms);
    if (list.length >= max) return res.status(429).json({ error: message });
    list.push(now); hits.set(req.ip, list); next();
  };
}

// Stream the request body to a file, at most maxBytes. Resolves the byte count.
function receiveTo(req, file, maxBytes) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    let n = 0, done = false;
    const fail = (e) => { if (done) return; done = true; out.destroy(); reject(e); };
    req.on('data', (c) => {
      if (done) return;
      n += c.length;
      if (n > maxBytes) return fail(Object.assign(new Error('too big'), { status: 413 }));
      if (!out.write(c)) { req.pause(); out.once('drain', () => req.resume()); }
    });
    req.on('end', () => { if (done) return; done = true; out.end(() => resolve(n)); });
    req.on('aborted', () => fail(Object.assign(new Error('aborted'), { status: 400 })));
    req.on('error', fail); out.on('error', fail);
  });
}
// What is it really? WebM/Matroska starts with the EBML magic, MP4 has "ftyp" at byte 4.
async function sniff(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const b = Buffer.alloc(12); await fh.read(b, 0, 12, 0);
    if (b.readUInt32BE(0) === 0x1a45dfa3) return { type: 'video/webm', ext: 'webm' };
    if (b.toString('latin1', 4, 8) === 'ftyp') return { type: 'video/mp4', ext: 'mp4' };
    return null;
  } finally { await fh.close(); }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtLen = (ms) => { const s = Math.round((ms || 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

function watchPage(m, base) {
  const url = `${base}/v/${m.id}`, file = `${base}/v/${m.id}/file`;
  const portrait = m.aspect === '9:16';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Slap and Talk – video</title>
<meta name="robots" content="noindex">
<meta property="og:title" content="A Slap and Talk video">
<meta property="og:type" content="video.other">
<meta property="og:url" content="${esc(url)}">
<meta property="og:video" content="${esc(file)}">
<meta property="og:video:type" content="${esc(m.type)}">
<link rel="icon" href="/icons/icon-192.png">
<style>
  html, body { margin: 0; background: #121212; color: #e8e8e8; font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: ${portrait ? '480px' : '1100px'}; margin: 0 auto; padding: 20px 16px 40px; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 14px; letter-spacing: .02em; }
  video { display: block; width: 100%; max-height: 78vh; background: #000; border-radius: 10px; }
  .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 14px; }
  a.btn, button { font: inherit; color: #e8e8e8; background: #242424; border: 1px solid #3a3a3a; border-radius: 8px; padding: 7px 14px; text-decoration: none; cursor: pointer; }
  a.btn:hover, button:hover { background: #2e2e2e; }
  .muted { color: #9a9a9a; font-size: 13px; }
  footer { margin-top: 28px; }
  footer a { color: #e8c25a; text-decoration: none; }
</style></head>
<body><main>
  <h1>Slap and Talk</h1>
  <video id="v" controls playsinline preload="metadata" src="/v/${esc(m.id)}/file"></video>
  <div class="row">
    <a class="btn" href="/v/${esc(m.id)}/file?download=1" download>Download</a>
    <button type="button" id="copy">Copy link</button>
    <span class="muted">${esc(fmtLen(m.durationMs))} · kept until ${esc(fmtDate(m.expiresAt))}</span>
  </div>
  <footer class="muted">Made in <a href="/">Slap and Talk</a> · make your own room.</footer>
</main>
<script>
  document.getElementById('copy').onclick = async function () {
    try { await navigator.clipboard.writeText(${JSON.stringify(url).replace(/</g, '\\u003c')}); this.textContent = 'Copied'; } catch (e) { this.textContent = 'Copy failed'; }
  };
</script>
</body></html>`;
}

function mountVideos(app, { store, recorder, entitle, fromReq, mailer, rightsTo, roomParam, wrap, isAdmin, settings = videoSettings(), clock = () => Date.now() }) {
  const videos = createVideoStore(store.adapter, { clock, retentionDays: settings.retentionDays });
  const maxBytes = Math.round(settings.maxMB * 1024 * 1024);
  let inFlight = 0;
  const sentPerVideo = new Map(); // id -> count (in memory; the address itself is never kept)
  const baseOf = (req) => settings.publicUrl || `${req.protocol}://${req.get('host')}`;
  const pub = ({ room, recId, ...m }) => ({ ...m, url: `/v/${m.id}`, fileUrl: `/v/${m.id}/file` });

  app.get('/api/videos/config', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ email: !!mailer.enabled, retentionDays: settings.retentionDays, maxMB: settings.maxMB });
  });

  app.post('/api/rooms/:room/recordings/:rec/videos', windowLimit(settings.uploadsPerMinute, 60_000), windowLimit(settings.uploadsPerHour, 3600_000), wrap(async (req, res) => {
    const room = roomParam(req, res); if (!room) return;
    const recId = String(req.params.rec);
    const declared = Number(req.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) return res.status(413).set('Connection', 'close').json({ error: `The video is larger than ${settings.maxMB} MB.` });
    if (!recorder || !REC_ID_RE.test(recId) || !(await recorder.meta(room, recId))) return res.status(404).json({ error: 'That recording does not exist' });
    if (inFlight >= settings.maxConcurrent) return res.status(503).set('Retry-After', '20').json({ error: 'The server is busy saving other videos. Try again in a moment.' });
    inFlight++;
    const tmp = path.join(settings.tmpDir, `sat-video-${crypto.randomBytes(6).toString('hex')}.part`);
    try {
      let bytes;
      try { bytes = await receiveTo(req, tmp, maxBytes); } catch (e) {
        if (e.status === 413) {
          res.status(413).set('Connection', 'close').json({ error: `The video is larger than ${settings.maxMB} MB.` });
          res.on('finish', () => req.destroy());
          return;
        }
        if (!res.headersSent) res.status(400).json({ error: 'The upload was interrupted.' });
        return;
      }
      if (bytes < 1024) return res.status(400).json({ error: 'The video is empty.' });
      const kind = await sniff(tmp);
      if (!kind) return res.status(415).json({ error: 'That is not a WebM or MP4 video.' });
      const q = req.query || {};
      const free = !entitle(fromReq(req)).cleanVideo;
      const m = await videos.save({ room, recId, file: tmp, ...kind, bytes, durationMs: q.durationMs, aspect: String(q.aspect || ''), free });
      res.json({ video: pub(m), watchUrl: `${baseOf(req)}/v/${m.id}`, email: !!mailer.enabled });
    } finally {
      inFlight--;
      fsp.rm(tmp, { force: true }).catch(() => {});
    }
  }));

  app.get('/api/rooms/:room/videos', wrap(async (req, res) => {
    const id = roomParam(req, res); if (!id) return;
    if (!(await rightsTo(req, res, id))) return;
    res.json({ videos: (await videos.listRoom(id)).map((m) => ({ ...pub(m), recId: m.recId })) });
  }));

  app.get('/api/videos/:id', wrap(async (req, res) => {
    const m = await videos.get(req.params.id);
    if (!m) return res.status(404).json({ error: 'That video does not exist (or is too old).' });
    res.json(pub(m));
  }));

  app.delete('/api/videos/:id', wrap(async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Not allowed' });
    const m = await videos.get(req.params.id);
    if (!m) return res.status(404).json({ error: 'That video does not exist' });
    await videos.remove(m); res.json({ ok: true });
  }));

  app.post('/api/videos/:id/email', windowLimit(settings.emailsPerMinute, 60_000), windowLimit(settings.emailsPerHour, 3600_000), wrap(async (req, res) => {
    if (!mailer.enabled) return res.status(503).json({ error: 'Email is not available. Copy the link instead.' });
    const to = cleanEmail(req.body && req.body.email);
    if (!to) return res.status(400).json({ error: 'That does not look like an email address.' });
    const m = await videos.get(req.params.id);
    if (!m) return res.status(404).json({ error: 'That video does not exist (or is too old).' });
    const n = sentPerVideo.get(m.id) || 0;
    if (n >= settings.emailsPerVideo) return res.status(429).json({ error: 'This link has already been emailed a few times.' });
    sentPerVideo.set(m.id, n + 1);
    if (sentPerVideo.size > 10000) sentPerVideo.delete(sentPerVideo.keys().next().value);
    const base = baseOf(req), url = `${base}/v/${m.id}`;
    try {
      await mailer.send({
        to,
        subject: 'Your Slap and Talk video',
        text: `Here is the link to your Slap and Talk video:\n\n${url}\n\nIt is kept until ${fmtDate(m.expiresAt)}. Download it from that page if you want to keep it longer.\n\nSlap and Talk\n${base}\n`,
      });
    } catch (e) {
      sentPerVideo.set(m.id, n);
      return res.status(502).json({ error: 'The email could not be sent. Copy the link instead.' });
    }
    res.json({ ok: true });
  }));

  // The watch page and the raw file. Registered before the app's catch-all index.html route.
  app.get('/v/:id', wrap(async (req, res) => {
    const m = await videos.get(req.params.id);
    res.set('Cache-Control', 'no-cache');
    if (!m) return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Slap and Talk</title><body style="background:#121212;color:#ddd;font:16px system-ui;padding:40px;text-align:center"><p>This video does not exist any more.</p><p><a style="color:#e8c25a" href="/">Slap and Talk</a></p>');
    res.type('html').send(watchPage(m, baseOf(req)));
  }));
  const serveFile = wrap(async (req, res) => {
    const m = await videos.get(req.params.id);
    if (!m) return res.status(404).end();
    const st = await videos.stat(m);
    if (!st) return res.status(404).end();
    const size = st.size;
    const headers = {
      'Content-Type': m.type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400',
      'Content-Disposition': `${req.query.download ? 'attachment' : 'inline'}; filename="slapandtalk-${m.id}.${m.ext}"`,
    };
    let start = 0, end = size - 1, status = 200;
    const range = req.get('range');
    if (range) {
      const r = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!r || (r[1] === '' && r[2] === '')) return res.status(416).set({ 'Content-Range': `bytes */${size}` }).end();
      if (r[1] === '') { start = Math.max(0, size - Number(r[2])); } else { start = Number(r[1]); if (r[2] !== '') end = Math.min(size - 1, Number(r[2])); }
      if (start >= size || start > end) return res.status(416).set({ 'Content-Range': `bytes */${size}` }).end();
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
    headers['Content-Length'] = String(end - start + 1);
    res.status(status).set(headers);
    if (req.method === 'HEAD') return res.end();
    const body = await videos.stream(m, { start, end });
    if (!body) return res.status(404).end();
    body.on('error', () => res.destroy());
    res.on('close', () => { if (body.destroy) body.destroy(); });
    body.pipe(res);
  });
  app.get('/v/:id/file', serveFile);

  return videos;
}

module.exports = { mountVideos, createVideoStore, videoSettings, watchPage, windowLimit, sniff, VIDEO_ID_RE };

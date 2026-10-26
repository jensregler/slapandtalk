// Finished videos: upload (streamed, size cap, sniffing), storage under videos/ (outlives the
// room), retention + cleanup, range requests, watch page, the Recordings list, email-the-link
// (mock provider), the S3 streaming bits, and the pure layout/ticker maths.
// Runs without a browser: node tests/video.test.js (part of npm test).
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { Readable } = require('stream');
const { pathToFileURL } = require('url');
const { LocalAdapter } = require('../server/storage/local');
const { S3Adapter } = require('../server/storage/s3');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { createRecorder } = require('../server/recorder');
const { makeEntitlements } = require('../server/entitlements');
const { videoSettings } = require('../server/videos');
const { createMailer, cleanEmail } = require('../server/mail');

const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };
const DAY = 86400_000;
const webm = (n) => { const b = Buffer.alloc(n, 7); b.writeUInt32BE(0x1a45dfa3, 0); return b; };
const mp4 = (n) => { const b = Buffer.alloc(n, 3); b.write('ftypisom', 4, 'latin1'); return b; };

async function pure() {
  const V = await import(pathToFileURL(path.join(__dirname, '..', 'shared', 'videoframe.mjs')).href);
  const CFG = require('../shared/video.json');
  assert(V.pickIntro(1280, 720) === '16x9' && V.pickIntro(1024, 640) === '16x9' && V.pickIntro(720, 1280) === '9x16' && V.pickIntro(800, 800) === '1x1' && V.pickIntro(1000, 900) === '1x1',
    'intro: the frame shape picks 16:9, 9:16 or 1:1');
  const o = V.outputSize(2560, 1600, 1280), p = V.outputSize(1080, 1920, 1280), s = V.outputSize(641, 401, 1280);
  assert(o.w === 1280 && o.h === 800 && p.w === 720 && p.h === 1280 && s.w % 2 === 0 && s.h % 2 === 0, 'output size: longest side ≤ 1280, even numbers');
  const b = V.bugRect(1280, 720, 320 / 225, CFG.bug);
  assert(b.x + b.w < 1280 && b.x > 1280 * 0.75 && b.y < 720 * 0.08 && b.w > 100 && b.w < 200, `bug: small, in the top-right corner (${JSON.stringify(b)})`);
  const sch = V.tickerSchedule(CFG.ticker, 120_000, 42);
  const gaps = sch.slice(1).map((x, i) => x.at - sch[i].until);
  assert(sch.length >= 3 && sch[0].at === CFG.ticker.firstAfterSeconds * 1000 && sch.every((x) => x.until - x.at === CFG.ticker.showSeconds * 1000) && gaps.every((g) => g >= 20_000 && g <= 30_000),
    `ticker: about ${CFG.ticker.showSeconds} s at a time, 20–30 s apart (${sch.length} times in 2 min)`);
  assert(sch[0].text === CFG.ticker.lines[0] && sch[1].text === CFG.ticker.lines[1 % CFG.ticker.lines.length], 'ticker: the texts come from the one config list (shared/video.json), in turn');
  assert(V.tickerSchedule(CFG.ticker, 5_000).length === 0 && V.tickerSchedule({ ...CFG.ticker, lines: [] }, 120_000).length === 0, 'ticker: none in very short clips or with an empty list');
  const t0 = sch[0].at;
  assert(V.tickerAt(sch, t0 - 1) === null && V.tickerAt(sch, t0 + 100).k < 0.5 && V.tickerAt(sch, t0 + 2000).k === 1 && V.tickerAt(sch, sch[0].until - 50).k < 0.2 && V.tickerAt(sch, sch[0].until) === null,
    'ticker: slides in calmly, holds, slides out');
}

async function mail() {
  assert(!createMailer({}).enabled && !createMailer({ RESEND_API_KEY: 'x' }).enabled && !createMailer({ MAIL_FROM: 'a@b.se' }).enabled, 'mail: off unless both RESEND_API_KEY and MAIL_FROM are set');
  assert(cleanEmail(' ann@example.com ') === 'ann@example.com' && cleanEmail('a.b+c@sub.example.se') && !cleanEmail('nope') && !cleanEmail('a@b') && !cleanEmail('a b@c.se') && !cleanEmail('a@c..se')
    && !cleanEmail('x'.repeat(250) + '@a.se') && !cleanEmail({}) && !cleanEmail('a@b.c\nBcc: x@y.se'), 'mail: addresses are validated');
  const calls = [];
  const fetchImpl = async (url, opt) => { calls.push({ url, opt }); return { ok: true, json: async () => ({ id: 'em_1' }) }; };
  const m = createMailer({ RESEND_API_KEY: 're_test', MAIL_FROM: 'Slap and Talk <video@slapandtalk.com>' }, { fetchImpl });
  const r = await m.send({ to: 'ann@example.com', subject: 'S', text: 'T' });
  const body = JSON.parse(calls[0].opt.body);
  assert(m.enabled && r.id === 'em_1' && calls[0].url === 'https://api.resend.com/emails' && calls[0].opt.headers.Authorization === 'Bearer re_test'
    && body.from.includes('video@slapandtalk.com') && body.to[0] === 'ann@example.com' && body.text === 'T' && !('html' in body), 'mail: Resend HTTP API, plain text only (no HTML = no tracking)');
  const bad = createMailer({ RESEND_API_KEY: 're_test', MAIL_FROM: 'a@b.se' }, { fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ message: 'domain not verified' }) }), log: { error() {} } });
  let err = null; try { await bad.send({ to: 'a@b.se', subject: 's', text: 't' }); } catch (e) { err = e; }
  assert(err && err.code === 'SEND' && err.status === 403, 'mail: a provider error becomes a clear error');
}

function fakeS3() {
  const objects = new Map();
  const nf = () => Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
  return {
    objects,
    async send(cmd) {
      const { Key, Body, Range, ContentLength } = cmd.input;
      switch (cmd.constructor.name) {
        case 'PutObjectCommand': {
          let buf;
          if (Body && typeof Body.pipe === 'function') { const parts = []; for await (const c of Body) parts.push(c); buf = Buffer.concat(parts); this.streamed = (this.streamed || 0) + 1; if (ContentLength !== buf.length) throw new Error('ContentLength mismatch'); } else buf = Buffer.from(Body);
          objects.set(Key, buf); return {};
        }
        case 'HeadObjectCommand': if (!objects.has(Key)) throw Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } }); return { ContentLength: objects.get(Key).length };
        case 'GetObjectCommand': {
          if (!objects.has(Key)) throw nf();
          let b = objects.get(Key);
          if (Range) { const [, a, z] = /bytes=(\d+)-(\d*)/.exec(Range); b = b.subarray(Number(a), z === '' ? b.length : Number(z) + 1); }
          const body = Readable.from([b]); body.transformToByteArray = async () => new Uint8Array(b); return { Body: body };
        }
        case 'DeleteObjectCommand': objects.delete(Key); return {};
        case 'ListObjectsV2Command': return { Contents: [...objects.keys()].filter((k) => k.startsWith(cmd.input.Prefix)).map((k) => ({ Key: k })) };
        default: throw new Error('unknown ' + cmd.constructor.name);
      }
    },
  };
}

async function s3() {
  const client = fakeS3();
  const a = new S3Adapter({ bucket: 'b', client, prefix: 'p/' });
  const tmp = path.join(os.tmpdir(), `vt-${process.pid}.bin`);
  fs.writeFileSync(tmp, Buffer.from('0123456789abcdef'));
  await a.putFile('videos/r/x.webm', tmp, 'video/webm');
  const st = await a.stat('videos/r/x.webm');
  const read = async (s) => { const parts = []; for await (const c of s) parts.push(c); return Buffer.concat(parts).toString(); };
  assert(client.streamed === 1 && st.size === 16 && (await read(await a.getStream('videos/r/x.webm', { start: 2, end: 5 }))) === '2345' && (await a.stat('nope')) === null && (await a.getStream('nope', { start: 0 })) === null,
    'R2/S3: videos are uploaded as a stream from the temp file (not held in memory), read back by byte range');
  fs.rmSync(tmp);
}

async function server() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-test-'));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-tmp-'));
  let now = Date.parse('2026-10-29T12:00:00Z');
  const clock = () => now;
  const adapter = new LocalAdapter(dir);
  const store = createStore(adapter);
  const recorder = createRecorder(store);
  const sent = [];
  let mailFail = false;
  const mailer = { enabled: true, provider: 'mock', async send(m) { if (mailFail) throw new Error('x'); sent.push(m); return { id: 'm' }; } };
  const settings = { ...videoSettings({}), maxMB: 0.05, uploadsPerMinute: 100, uploadsPerHour: 1000, tmpDir, publicUrl: 'https://slapandtalk.com' };
  const app = createApp(store, { adminToken: 'admin-token-xyz', recorder, entitle: makeEntitlements({ DEV_UNLOCK: '1' }), mailer, videos: settings, clock });
  const srv = app.listen(0);
  const plain = createApp(store, { recorder, entitle: makeEntitlements({}), mailer: createMailer({}), videos: { ...settings }, clock }).listen(0);
  const B = `http://localhost:${srv.address().port}`, P = `http://localhost:${plain.address().port}`;
  try {
    const { room: { id: R }, roomKey: KEY } = await (await fetch(`${B}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const REC = 'aaaabbbbccccdddd';
    await adapter.put(`recordings/${R}/${REC}.meta.json`, Buffer.from(JSON.stringify({ v: 1, recId: REC, room: R, status: 'done', startedAt: new Date(now).toISOString(), durationMs: 5000, participants: [] })));
    await adapter.put(`recordings/${R}/${REC}.jsonl`, Buffer.from('{}\n'));
    const up = (body, { rec = REC, type = 'video/webm', headers = {}, base = B, q = '?aspect=16:9&durationMs=7800' } = {}) => fetch(`${base}/api/rooms/${R}/recordings/${rec}/videos${q}`, { method: 'POST', headers: { 'Content-Type': type, ...headers }, body, duplex: 'half' });

    assert((await (await fetch(`${B}/api/videos/config`)).json()).email === true && (await (await fetch(`${P}/api/videos/config`)).json()).email === false, 'config: tells the browser whether email exists (no key = no email field)');
    assert((await up(webm(4096), { rec: '0000000000000000' })).status === 404 && (await up(webm(4096), { rec: 'xyz' })).status === 404, 'upload: only for a recording that exists');
    assert((await up(Buffer.alloc(4096, 1))).status === 415 && (await up(webm(100))).status === 400, 'upload: not a WebM/MP4 (sniffed, not trusted from Content-Type) = 415, empty = 400');
    const big = await up(webm(60 * 1024));
    // Without Content-Length (streamed in chunks): stopped while receiving.
    const chunked = await new Promise((resolve) => {
      const u = new URL(`${B}/api/rooms/${R}/recordings/${REC}/videos`);
      const rq = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'video/webm', 'Transfer-Encoding': 'chunked' } }, (res) => { res.resume(); resolve(res.statusCode); });
      rq.on('error', () => resolve('closed'));
      rq.write(webm(16 * 1024)); let n = 0; const iv = setInterval(() => { if (n++ > 6 || rq.destroyed) { clearInterval(iv); rq.end(); return; } rq.write(Buffer.alloc(16 * 1024, 1)); }, 10);
    });
    assert(big.status === 413 && (chunked === 413 || chunked === 'closed'), `upload: size cap (VIDEO_MAX_MB) both by Content-Length and while streaming (${big.status}, ${chunked})`);
    await new Promise((r) => setTimeout(r, 300));
    assert(fs.readdirSync(tmpDir).length === 0, 'upload: temp files are always removed');

    const ok = await up(webm(20 * 1024));
    const j = await ok.json();
    const id = j.video && j.video.id;
    assert(ok.status === 200 && /^[a-f0-9]{16}$/.test(id) && j.watchUrl === `https://slapandtalk.com/v/${id}` && j.video.type === 'video/webm' && j.video.free === true && j.video.aspect === '16:9' && j.video.durationMs === 7800 && j.email === true,
      'upload: saved, with a stable watch link /v/<id> (PUBLIC_URL)');
    assert(!('room' in j.video) && !('recId' in j.video), 'public video info never shows the room code');
    assert(fs.existsSync(path.join(dir, 'videos', R, `${id}.webm`)) && fs.existsSync(path.join(dir, 'videos', R, `${id}.json`)) && fs.existsSync(path.join(dir, 'videos', '_index', `${id}.json`)),
      'stored as videos/<room>/<id>.webm + .json (+ videos/_index/<id>.json), never under rooms/ or recordings/');
    const full = await (await up(mp4(8 * 1024), { type: 'video/mp4', headers: { 'x-dev-unlock': '1' }, q: '?aspect=9:16' })).json();
    assert(full.video.free === false && full.video.type === 'video/mp4' && full.video.aspect === '9:16', 'full version (cleanVideo) is marked as without bug; Safari MP4 is accepted');

    // Range requests
    const r0 = await fetch(`${B}/v/${id}/file`);
    const all = Buffer.from(await r0.arrayBuffer());
    const r1 = await fetch(`${B}/v/${id}/file`, { headers: { Range: 'bytes=0-99' } });
    const r2 = await fetch(`${B}/v/${id}/file`, { headers: { Range: 'bytes=-10' } });
    const r3 = await fetch(`${B}/v/${id}/file`, { headers: { Range: 'bytes=999999-' } });
    const head = await fetch(`${B}/v/${id}/file`, { method: 'HEAD' });
    const b1 = Buffer.from(await r1.arrayBuffer()), b2 = Buffer.from(await r2.arrayBuffer());
    assert(r0.status === 200 && all.length === 20 * 1024 && r0.headers.get('accept-ranges') === 'bytes' && r0.headers.get('content-type') === 'video/webm'
      && r1.status === 206 && b1.length === 100 && r1.headers.get('content-range') === `bytes 0-99/${20 * 1024}` && b1.equals(all.subarray(0, 100))
      && r2.status === 206 && b2.equals(all.subarray(-10)) && r3.status === 416 && head.status === 200 && head.headers.get('content-length') === String(20 * 1024),
    'raw file /v/<id>/file: range requests (206, suffix, 416) and HEAD, so players can seek');
    assert((await fetch(`${B}/v/${id}/file?download=1`)).headers.get('content-disposition').startsWith('attachment'), 'raw file: ?download=1 downloads it');
    const page = await (await fetch(`${B}/v/${id}`)).text();
    assert(page.includes(`<video`) && page.includes(`/v/${id}/file`) && page.includes('lang="en"') && page.includes('Copy link') && !/<script[^>]+src=/.test(page), 'watch page /v/<id>: a simple English page with the video, no third-party scripts');
    assert((await fetch(`${B}/v/0123456789abcdef`)).status === 404 && (await fetch(`${B}/v/nope`)).status === 404, 'watch page: unknown video = 404');
    const pub = await (await fetch(`${B}/api/videos/${id}`)).json();
    assert(pub.id === id && pub.url === `/v/${id}` && Date.parse(pub.expiresAt) - Date.parse(pub.createdAt) === 30 * DAY, 'video info: expires 30 days after it was made (VIDEO_RETENTION_DAYS)');

    // Recordings list
    const noRights = await fetch(`${B}/api/rooms/${R}/videos`);
    const list = await (await fetch(`${B}/api/rooms/${R}/videos`, { headers: { 'x-room-key': KEY } })).json();
    assert(noRights.status === 403 && list.videos.length === 2 && list.videos.every((v) => v.recId === REC && v.url.startsWith('/v/')), 'the Recordings list gets the room’s videos (same rights as the recordings)');

    // Email the link
    const em = (body, base = B) => fetch(`${base}/api/videos/${id}/email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert((await em({ email: 'ann@example.com' }, P)).status === 503, 'email: no provider configured = 503 (the client shows Copy link instead)');
    assert((await em({ email: 'not-an-email' })).status === 400, 'email: invalid address = 400');
    const e1 = await em({ email: 'ann@example.com' });
    const m = sent[0];
    assert(e1.status === 200 && sent.length === 1 && m.to === 'ann@example.com' && m.subject === 'Your Slap and Talk video' && m.text.includes(`https://slapandtalk.com/v/${id}`) && !/[åäö]/i.test(m.text) && m.text.length < 400,
      'email: one short English mail with the watch link via the provider');
    const grep = (d) => fs.readdirSync(d, { withFileTypes: true }).some((f) => f.isDirectory() ? grep(path.join(d, f.name)) : fs.readFileSync(path.join(d, f.name)).includes('ann@example.com'));
    assert(!grep(dir), 'email: the address is not stored anywhere');
    mailFail = true;
    const e2 = await em({ email: 'bo@example.com' });
    mailFail = false;
    const e3 = await em({ email: 'cy@example.com' });
    assert(e2.status === 502 && e3.status === 429, 'email: a provider failure = 502; and it is rate-limited per IP');

    // The room disappears (demo rooms after an hour): rooms/ + recordings/ go, the video stays.
    // Uses the demo profile's own expiry (server/demo.js) when it exists, so its room deletion is
    // what's checked; otherwise the same steps by hand.
    let viaDemo = false;
    if (fs.existsSync(path.join(__dirname, '..', 'server', 'demo.js'))) {
      const { createDemo } = require('../server/demo');
      const demo = createDemo({ store, settings: { roomMs: 3600_000, warnMs: 0, maxPlayers: 5, maxMembers: 5, style: {} }, clock, log: { log() {}, error() {} } });
      viaDemo = await demo.expire(R);
    }
    if (!viaDemo) { await store.deleteRoom(R); for (const k of await adapter.list(`recordings/${R}/`)) await adapter.delete(k); }
    assert(!(await store.getRoom(R)) &&(await fetch(`${B}/v/${id}`)).status === 200 && (await fetch(`${B}/v/${id}/file`)).status === 200 && (await adapter.list(`recordings/${R}/`)).length === 0, `the room and its recordings are deleted${viaDemo ? ' (demo expiry, server/demo.js)' : ''}, the video still plays`);

    // Retention: after 30 days the video is gone and cleanup deletes the files.
    now += 29 * DAY;
    assert((await fetch(`${B}/v/${id}`)).status === 200 && (await app.locals.videos.cleanup()).length === 0, 'retention: still there after 29 days');
    now += 2 * DAY;
    assert((await fetch(`${B}/v/${id}`)).status === 404 && (await fetch(`${B}/api/videos/${id}`)).status === 404, 'retention: after 30 days the link answers 404');
    const gone = await app.locals.videos.cleanup();
    assert(gone.length === 2 && !fs.existsSync(path.join(dir, 'videos', R, `${id}.webm`)) && (await adapter.list('videos/_index/')).length === 0, 'cleanup job: deletes old videos’ files and meta');

    // Admin delete
    await adapter.put(`recordings/${R}/${REC}.meta.json`, Buffer.from(JSON.stringify({ v: 1, recId: REC, room: R, status: 'done', startedAt: new Date(now).toISOString() })));
    const v3 = (await (await up(webm(4096))).json()).video;
    assert((await fetch(`${B}/api/videos/${v3.id}`, { method: 'DELETE' })).status === 403 && (await fetch(`${B}/api/videos/${v3.id}`, { method: 'DELETE', headers: { 'x-admin-token': 'admin-token-xyz' } })).status === 200 && (await fetch(`${B}/v/${v3.id}`)).status === 404,
      'admin can delete a video');

    // Upload rate limit (per IP and minute)
    const limited = createApp(store, { recorder, mailer, videos: { ...settings, uploadsPerMinute: 2 }, clock }).listen(0);
    const L = `http://localhost:${limited.address().port}`;
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await up(webm(2048), { base: L })).status);
    limited.close();
    assert(codes[0] === 200 && codes[1] === 200 && codes[2] === 429, `upload: rate-limited per IP (${codes})`);
  } finally {
    srv.close(); plain.close(); await recorder.close();
    fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

(async () => {
  await pure();
  await mail();
  await s3();
  await server();
  console.log('Alla videotester gick igenom.');
})().catch((e) => { console.error(e); process.exit(1); });

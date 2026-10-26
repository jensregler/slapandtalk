// E2E: finished videos from the replay page, in headless Chromium, against its OWN server
// (temp storage, DEV_UNLOCK=1, a mock Resend). Checks, by decoding the uploaded files with ffmpeg:
//   - the first frames are the logo intro (and the intro sound is in the file),
//   - free: the 'slap and talk' bug sits in the top-right corner and the ticker slides in at the
//     bottom; full version (cleanVideo): neither,
//   - upload -> Recordings list -> watch page round trip, Copy link, and 'Email me the link'.
// Run: node tests/e2e-video.js (part of npm test; starts and stops its own server, needs ffmpeg).
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 160; // frames are compared at this width

// Decode a video to small RGB frames at `fps`. -> { w, h, frames: [Buffer] }
function frames(file, fps, w = W) {
  const out = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `fps=${fps},scale=${w}:-2`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 512 * 1024 * 1024 });
  const info = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim().split(',').map(Number);
  const h = Math.round((info[1] * w) / info[0] / 2) * 2;
  const size = w * h * 3, list = [];
  for (let i = 0; i + size <= out.length; i += size) list.push(out.subarray(i, i + size));
  return { w, h, frames: list };
}
// Mean absolute difference (0–255) between two frames, optionally inside a rect (fractions of the frame).
function diff(a, b, w, h, rect = { x: 0, y: 0, w: 1, h: 1 }) {
  const x0 = Math.floor(rect.x * w), y0 = Math.floor(rect.y * h), x1 = Math.ceil((rect.x + rect.w) * w), y1 = Math.ceil((rect.y + rect.h) * h);
  let s = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 3; s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); n += 3; }
  return s / n;
}
const freePort = () => new Promise((res) => { const s = http.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

async function videoE2E() {
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) execFileSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit' });
  fs.mkdirSync(SHOTS, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-video-data-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-video-'));
  // Mock Resend: records what would have been sent.
  const mails = [];
  const mock = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { mails.push({ auth: req.headers.authorization, body: JSON.parse(b) }); res.setHeader('Content-Type', 'application/json'); res.end('{"id":"mock_1"}'); }); }).listen(0);
  const PORT = await freePort();
  const BASE = `http://localhost:${PORT}`;
  const env = {
    ...process.env, PORT: String(PORT), STORAGE: 'local', DATA_DIR: dataDir, DEV_UNLOCK: '1', ADMIN_TOKEN: 'e2e-video-admin',
    RESEND_API_KEY: 're_e2e', MAIL_FROM: 'Slap and Talk <video@example.com>', RESEND_API_URL: `http://localhost:${mock.address().port}/emails`, PUBLIC_URL: '',
    DEMO_PROFILE: '', FULL_ACCESS_KEYS: '',
  };
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  try {
    for (let i = 0; i < 100 && !(await fetch(`${BASE}/api/videos/config`).then((r) => r.ok).catch(() => false)); i++) await sleep(100);
    // A room with a ~14 s recording (long enough for the ticker, which first shows 8 s in).
    const { room: { id: R }, roomKey: KEY } = await (await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const rec = (what) => fetch(`${BASE}/api/rooms/${R}/recording/${what}`, { method: 'POST', headers: { 'x-room-key': KEY } }).then((r) => r.json());
    const { recording: { recId: REC } } = await rec('start');
    await sleep(14000);
    await rec('stop');

    async function make(kind) {
      const ctx = await browser.newContext({ viewport: { width: 1024, height: 640 } });
      if (kind === 'full') await ctx.addInitScript(() => localStorage.setItem('klibb.devUnlock', '1'));
      const P = await ctx.newPage();
      P.on('pageerror', (e) => console.log(`sidfel (${kind}):`, e.message));
      await P.goto(`${BASE}/?room=${R}&replay=${REC}`);
      await P.waitForFunction(() => window.replay && window.replay.ready, null, { timeout: 30000 });
      const started = await P.evaluate(() => window.replay.startVideo());
      const intro = await P.evaluate(() => { const c = window.replay.composer(); return c ? { phase: c.state.phase, intro: c.state.intro, key: c.state.introKey, w: c.state.w, h: c.state.h, bug: c.state.bug, audio: c.state.audio, free: c.state.free } : null; });
      await P.waitForFunction(() => window.replay.lastVideo(), null, { timeout: 90000 });
      const up = await P.evaluate(async () => { const j = await window.replay.upload(); return j; });
      await P.waitForSelector('#rp-share-link-row', { state: 'visible', timeout: 10000 });
      const ui = await P.evaluate(() => ({ link: document.getElementById('rp-share-link').value, email: !document.getElementById('rp-email-form').hidden, note: document.getElementById('rp-share-note').textContent, ticker: window.replay.lastVideo().probe.tickerShown, frames: window.replay.lastVideo().probe.introFrames }));
      await P.screenshot({ path: path.join(SHOTS, `60-video-share-${kind}.png`) });
      return { ctx, P, started, intro, up, ui };
    }

    const free = await make('free');
    assert(free.started === true && free.intro && free.intro.phase === 'intro' && free.intro.intro === true && free.intro.key === '16x9' && free.intro.free === true && free.intro.audio === true,
      `⏺ Record video starts with the logo intro (16:9 for a ${free.intro && free.intro.w}×${free.intro && free.intro.h} frame), intro sound mixed in`);
    assert(free.up && free.up.video && free.up.video.free === true && free.ui.link === free.up.watchUrl && free.ui.link.endsWith(`/v/${free.up.video.id}`), 'after recording the video is uploaded and its link is shown');
    assert(free.ui.email && /days/.test(free.ui.note) && free.ui.ticker > 0, 'free: Email me the link is offered (a provider is configured); the ticker was drawn');
    const full = await make('full');
    assert(full.intro.free === false && full.up.video.free === false && full.ui.ticker === 0, 'full version (cleanVideo): no bug, no ticker');

    // ---- Decode the uploaded files ----
    const save = async (id, name) => { const f = path.join(work, name); fs.writeFileSync(f, Buffer.from(await (await fetch(`${BASE}/v/${id}/file`)).arrayBuffer())); return f; };
    const fFree = await save(free.up.video.id, 'free.webm'), fFull = await save(full.up.video.id, 'full.webm');
    const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'csv=p=0', fFree]).toString();
    assert(/video/.test(streams) && /audio/.test(streams), `the file has a video and an audio track (${streams.trim().replace(/\n/g, ' + ')})`);
    const introRef = frames(path.join(ROOT, 'client', 'public', 'intro', 'sat-intro-16x9.webm'), 10);
    const vf = frames(fFree, 4), vF = frames(fFull, 4);
    const { w, h } = vf;
    // Our frames are 1024x640 (16:10): the 16:9 intro is letterboxed. Compare inside the intro's area.
    const ih = (1024 / (16 / 9)) / 640, area = { x: 0, y: (1 - ih) / 2, w: 1, h: ih };
    // Reference: the intro scaled to the same letterboxed frame.
    const refLetterbox = frames(path.join(ROOT, 'client', 'public', 'intro', 'sat-intro-16x9.webm'), 10, W);
    const toBox = (f) => { const out = Buffer.alloc(w * h * 3); const y0 = Math.round(((1 - ih) / 2) * h); f.copy(out, y0 * w * 3, 0, Math.min(f.length, (h - y0) * w * 3)); return out; };
    const refs = refLetterbox.frames.map(toBox);
    const best = (f) => Math.min(...refs.map((r) => diff(f, r, w, h, area)));
    const head = [0, 1, 2, 4, 6].map((i) => best(vf.frames[i]));
    const tail = best(vf.frames[vf.frames.length - 2]);
    assert(head.every((d) => d < 14) && tail > 2 * Math.max(...head), `the first frames (0–1.5 s) are the logo intro (diff to intro ${head.map((d) => d.toFixed(1)).join(', ')}; at the end ${tail.toFixed(1)})`);
    const headFull = [0, 2, 4].map((i) => best(vF.frames[i]));
    assert(headFull.every((d) => d < 14), 'the full version opens with the intro too');
    assert(introRef.frames.length >= 25, 'intro reference decoded');

    // Bug: compare free vs full near the end (same replay time, same camera).
    const fi = vf.frames.length - 3, Fi = vF.frames.length - 3;
    const bug = free.intro.bug, bugArea = { x: bug.x / free.intro.w, y: bug.y / free.intro.h, w: bug.w / free.intro.w, h: bug.h / free.intro.h };
    const topLeft = { x: 0.03, y: 0.03, w: bugArea.w, h: bugArea.h };
    const dBug = diff(vf.frames[fi], vF.frames[Fi], w, h, bugArea), dElse = diff(vf.frames[fi], vF.frames[Fi], w, h, topLeft);
    assert(bugArea.x > 0.75 && bugArea.y < 0.08 && dBug > 12 && dElse < 4, `free: the bug is in the top-right corner (free vs full there: ${dBug.toFixed(1)}; top-left: ${dElse.toFixed(1)}); full: no bug`);
    // Ticker: 8–12 s into the replay part = about 10.8–14.8 s into the video. Bottom-left strip.
    const tAt = Math.round((2.8 + 10) * 4);
    const strip = { x: 0.02, y: 0.86, w: 0.45, h: 0.11 };
    const dTick = diff(vf.frames[tAt], vF.frames[tAt], w, h, strip), dNoTick = diff(vf.frames[Math.round((2.8 + 4) * 4)], vF.frames[Math.round((2.8 + 4) * 4)], w, h, strip);
    assert(dTick > 6 && dNoTick < 3, `free: the link ticker shows at the bottom now and then (strip diff ${dTick.toFixed(1)} while shown, ${dNoTick.toFixed(1)} otherwise)`);
    const big = frames(fFree, 4, 640);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${big.w}x${big.h}`, '-i', '-', path.join(SHOTS, '61-video-intro.png')], { input: big.frames[2] });
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${big.w}x${big.h}`, '-i', '-', path.join(SHOTS, '62-video-free-bug-ticker.png')], { input: big.frames[tAt] });

    // ---- Round trip: Recordings list, watch page, copy, email ----
    const list = await (await fetch(`${BASE}/api/rooms/${R}/videos`, { headers: { 'x-room-key': KEY } })).json();
    assert(list.videos.length === 2 && list.videos.every((v) => v.recId === REC), 'both videos are in the room’s video list');
    const rctx = await browser.newContext({ viewport: { width: 1024, height: 640 } });
    await rctx.addInitScript(([r, k]) => localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })), [R, KEY]);
    const A = await rctx.newPage();
    await A.goto(`${BASE}/?room=${R}`);
    await A.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    await A.evaluate(() => window.klibb.openMore());
    await A.waitForFunction(() => document.querySelectorAll('#rec-list .rec-video').length === 2, null, { timeout: 10000 });
    const href = await A.evaluate(() => document.querySelector('#rec-list .rec-video').getAttribute('href'));
    assert(/^\/v\/[a-f0-9]{16}$/.test(href), 'Recordings list (⚙ More → 🎬 Recording): the videos show under their recording, linking to /v/<id>');
    await rctx.close();
    const V = await (await browser.newContext({ viewport: { width: 1024, height: 700 } })).newPage();
    await V.goto(`${BASE}/v/${free.up.video.id}`);
    await V.waitForFunction(() => { const v = document.querySelector('video'); return v && v.readyState >= 1 && v.videoWidth > 0; }, null, { timeout: 15000 });
    const vinfo = await V.evaluate(() => { const v = document.querySelector('video'); return { w: v.videoWidth, h: v.videoHeight, lang: document.documentElement.lang }; });
    await V.evaluate(() => { const v = document.querySelector('video'); v.currentTime = 6; });
    await V.waitForFunction(() => { const v = document.querySelector('video'); return !v.seeking && v.currentTime > 5; }, null, { timeout: 15000 });
    await V.screenshot({ path: path.join(SHOTS, '63-video-watch-page.png') });
    assert(vinfo.w === 1024 && vinfo.h === 640 && vinfo.lang === 'en', `watch page /v/<id> plays the video (${vinfo.w}×${vinfo.h}) and can seek (range requests)`);

    const P = free.P;
    await P.fill('#rp-email', 'not an email');
    const invalid = await P.evaluate(() => document.getElementById('rp-email').checkValidity());
    await P.fill('#rp-email', 'visitor@example.com');
    await P.click('#rp-email-send');
    await P.waitForFunction(() => /Sent/.test(document.getElementById('rp-email-status').textContent), null, { timeout: 10000 });
    const m = mails[0];
    assert(!invalid && mails.length === 1 && m.auth === 'Bearer re_e2e' && m.body.to[0] === 'visitor@example.com' && m.body.text.includes(`/v/${free.up.video.id}`) && !m.body.html && (await P.inputValue('#rp-email')) === '',
      'Email me the link: the mock provider gets one plain-text mail with the watch link; the field is cleared');
    const grep = (d) => fs.readdirSync(d, { withFileTypes: true }).some((f) => (f.isDirectory() ? grep(path.join(d, f.name)) : fs.readFileSync(path.join(d, f.name)).includes('visitor@example.com')));
    assert(!grep(dataDir), 'the email address is not stored on the server');
    await free.ctx.close(); await full.ctx.close();
  } catch (e) {
    console.log(log.split('\n').slice(-30).join('\n'));
    throw e;
  } finally {
    await browser.close(); srv.kill('SIGTERM'); mock.close();
    fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { videoE2E };
if (require.main === module) videoE2E().then(() => console.log('Video-E2E klart.')).catch((e) => { console.error(e); process.exit(1); });

// Headless screenshots: asset ghost in front of a surface-texture patch (and the old bug).
// Writes /workspace/ghost-fix/*.png. Run: node tools/ghost-front-shot.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.GHOST_FIX_SHOTS || '/workspace/ghost-fix';
const PORT = Number(process.env.GHOST_FIX_PORT || 8997);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let p = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found ' + url.pathname); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
});

const listen = () => new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const pixel = (buf, x, y, w) => {
  const i = (y * w + x) * 4;
  return { r: buf[i], g: buf[i + 1], b: buf[i + 2] };
};
// After: the ghost is blended over dark brick, so the pixel is olive, not a pure green.
const isGreenOverBrick = (c) => c.g >= c.r && c.g > c.b && c.g > 40;
const isBrick = (c) => c.r > c.g + 10 && c.r > c.b && c.r > 50 && c.g < 120;

fs.mkdirSync(OUT, { recursive: true });
await listen();
const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
let failed = 0;
const check = (name, ok, extra) => {
  if (ok) console.log('  ✓ ' + name);
  else { failed++; console.log('  ✗ ' + name + (extra ? ' — ' + JSON.stringify(extra) : '')); }
};

const shot = async (query, file) => {
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/tools/ghost-front-shot.html${query}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__shot && window.__shot.ready, null, { timeout: 20000 });
  const dest = path.join(OUT, file);
  await page.screenshot({ path: dest, type: 'png' });
  const sample = await page.evaluate(async () => {
    const c = document.querySelector('#c');
    const { x, y } = window.__shot.sample;
    const ctx = c.getContext('webgl2') || c.getContext('webgl');
    const pix = new Uint8Array(4);
    // WebGL origin is bottom-left.
    ctx.readPixels(x, c.height - 1 - y, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, pix);
    return { x, y, r: pix[0], g: pix[1], b: pix[2], a: pix[3] };
  });
  await page.close();
  return { dest, sample };
};

try {
  const before = await shot('?bug=1', 'ghost-behind-texture-before.png');
  const after = await shot('', 'ghost-in-front-after.png');
  console.log('wrote', before.dest);
  console.log('wrote', after.dest);
  console.log('sample before', before.sample);
  console.log('sample after', after.sample);
  check('before the fix the brick sheet paints over the ghost', isBrick(before.sample) && !isGreenOverBrick(before.sample), before.sample);
  check('after the fix the green ghost is visible over the brick sheet', isGreenOverBrick(after.sample) && after.sample.g > before.sample.g && after.sample.r < before.sample.r, after.sample);
  check('no page errors', errors.length === 0, errors);
} catch (e) {
  failed++;
  console.log('  ✗ crashed: ' + (e && e.stack));
}
await browser.close();
server.close();
if (failed) process.exit(1);
console.log('\nghost-front-shot: ok');

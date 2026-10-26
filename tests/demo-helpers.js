// Shared by tests/e2e-demo.js and tests/e2e-director.js: a speech-like fake microphone, a demo
// server of our own (own port, own temp data dir), and entering through the name dialog.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toneWav(seconds = 6, rate = 48000) {
  // Speech-like, so the browser's noise suppression keeps it: a gliding voice (110–220 Hz with
  // harmonics) in "syllables" of ~0.2 s, phrases with pauses. A steady tone gets suppressed as noise.
  const n = seconds * rate, data = Buffer.alloc(n * 2);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate, f0 = 150 + 50 * Math.sin(2 * Math.PI * 0.7 * t) + 20 * Math.sin(2 * Math.PI * 5.3 * t);
    ph += 2 * Math.PI * f0 / rate;
    const syl = Math.max(0, Math.sin(2 * Math.PI * 4.2 * t)) ** 0.7, phrase = (t % 2) < 1.5 ? 1 : 0;
    let v = 0; for (let k = 1; k <= 8; k++) v += Math.sin(k * ph) / k * (k === 3 || k === 4 ? 1.6 : 1);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, 0.22 * v * syl * phrase)) * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

async function startServer(port, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-demo-e2e-'));
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), DATA_DIR: dir, STORAGE: 'local', ADMIN_TOKEN: 'demo-e2e-admin',
    DEMO_PROFILE: '1', DEV_UNLOCK: '1', FULL_ACCESS_KEYS: 'demo-e2e-key', ...extra };
  const child = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(base + '/api/config'); if (r.ok) return { base, dir, child, log: () => out }; } catch { /* starting */ }
    await sleep(150);
  }
  child.kill(); throw new Error('demo server did not start:\n' + out);
}

// A page that has answered the name dialog (or will: name = what to type).
async function enter(ctx, url, name) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('    [pageerror]', e.message));
  await page.goto(url);
  await page.waitForSelector('#name-dialog[open]', { timeout: 20000 });
  await page.fill('#name-input', name);
  await page.press('#name-input', 'Enter');
  return page;
}


module.exports = { toneWav, startServer, enter, sleep };

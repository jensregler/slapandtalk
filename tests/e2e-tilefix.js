// E2E: fabric images tile seamlessly both ways at any aspect ratio (Jens, 30 Oct 2026: "När man använder
// egen bild på tak vägg samt golv vill den bara repetera i höjdled inte i sidoled. Där läggs det till
// mellanrum"). A fabric image is stored as a square with the picture fitted inside (transparent bars
// beside a portrait, above/below a landscape); those bars used to show as wide gaps in the colour under
// the fabric. Here: a portrait (300×700) on the floor, a landscape (700×260) on the walls and a portrait
// as Färg (the ceiling), all non-power-of-two, opaque orange with a dark grid, white under them – and the
// screen must show no white between the tiles, in either direction. Also the avatar shirt fabric.
// Own server (TILEFIX_E2E_PORT, default 8930). Screenshots → TILEFIX_SHOTS (/workspace/tilefix-shots), prefix TILEFIX_TAG.
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.TILEFIX_E2E_PORT || 8930);
const SHOTS = process.env.TILEFIX_SHOTS || '/workspace/tilefix-shots';
const TAG = process.env.TILEFIX_TAG || 'after';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 900) : '')); } };
const pic = (w, h, fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${fill}"/>
  ${[...Array(12)].map((_, i) => `<path d="M${(i * w) / 6} 0V${h}M0 ${(i * h) / 6}H${w}" stroke="#3a1400" stroke-width="6"/>`).join('')}
  <circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 4}" fill="#1b4fd6"/></svg>`;
// the white under the fabric, lit (greyish-white): bright and unsaturated – the test images are all saturated or dark
const white = (r, g, b) => Math.min(r, g, b) > 120 && Math.max(r, g, b) - Math.min(r, g, b) < 40;
async function share(file, pred) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  let hit = 0; const n = info.width * info.height;
  for (let i = 0; i < n; i++) { const o = i * info.channels; if (pred(data[o], data[o + 1], data[o + 2])) hit++; }
  return hit / n;
}
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const portrait = path.join(os.tmpdir(), 'e2e-tile-portrait.png'), landscape = path.join(os.tmpdir(), 'e2e-tile-landscape.png'), port2 = path.join(os.tmpdir(), 'e2e-tile-portrait2.png');
  await sharp(Buffer.from(pic(300, 700, '#e8661a'))).png().toFile(portrait);
  await sharp(Buffer.from(pic(700, 260, '#d23c3c'))).png().toFile(landscape);
  await sharp(Buffer.from(pic(330, 610, '#2fae4a'))).png().toFile(port2);
  const browser = await chromium.launch({ args: GL });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const errors = [];
  try {
    const start = await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: false }) }).then((r) => r.json());
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 });
    await ctx.addInitScript(() => {
      if (sessionStorage.getItem('init')) return; sessionStorage.setItem('init', '1');
      localStorage.setItem('klibb.avatar', JSON.stringify({ name: 'Tiles', look: { outfit: 'tshirt', hair: 'kort', shirt: '#3a86ff', pants: '#2b4c7e', hairColor: '#4a2c17', skin: '#e0ac69', hat: false, hatColor: '#e63946' } }));
      localStorage.setItem('klibb.devUnlock', '1');
    });
    const A = await ctx.newPage(); A.setDefaultTimeout(90000); A.on('pageerror', (e) => errors.push(e.message));
    await A.goto(`${S.base}/?room=${start.room.id}`);
    await A.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 90000 }); await A.evaluate(() => window.klibb.entitlementsReady());
    await A.evaluate(() => window.klibb.openStylePanel('create')); await A.waitForSelector('#style-panel:not([hidden])');
    const own = async (kind, file) => {
      await A.click(`#own-${kind} .farg-open`); await A.setInputFiles(`#own-${kind}-file`, file);
      await A.waitForFunction((k) => window.klibb.styleDraft()?.surfFabric?.[k]?.id && window.klibb.roomFabric().loaded, kind, { timeout: 60000 });
    };
    await own('floor', portrait); await own('wall', landscape);
    await A.setInputFiles('#farg-file', port2);
    await A.waitForFunction(() => window.klibb.styleDraft()?.fabric?.id && window.klibb.roomFabric().loaded, null, { timeout: 60000 });
    await Promise.all([A.waitForNavigation({ timeout: 60000 }), A.click('#style-ok')]);
    await A.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.roomFabric().loaded && window.klibb.roomFabric().on.length === 6, null, { timeout: 90000 });
    const look = async (name, x, z, yaw, pitch) => {
      await A.evaluate(([x, z, yaw, pitch]) => { const k = window.klibb; k.moveTo(x, z); k.look(yaw, pitch); }, [x, z, yaw, pitch]); await sleep(1200);
      const full = path.join(SHOTS, `${TAG}-${name}.png`); await A.screenshot({ path: full });
      const clip = path.join(os.tmpdir(), `tile-${TAG}-${name}-clip.png`);
      await A.screenshot({ path: clip, clip: { x: 380, y: 230, width: 520, height: 300 } }); // (the middle of the view, no panels)
      return share(clip, white);
    };
    const floor = await look('floor', 0, 1, 0, -1.2);
    check('floor (portrait 300×700 image): tiles side by side and up/down with no white gaps', floor < 0.01, { white: floor });
    const wall = await look('wall', 0, 2, 0, 0.0);
    check('walls (landscape 700×260 image): no white gaps between the tiles', wall < 0.01, { white: wall });
    const ceil = await look('ceiling-farg', 0, 1, 0, 1.2);
    check('ceiling via Färg (portrait 330×610 image): no white gaps', ceil < 0.01, { white: ceil });
    const asp = await A.evaluate(() => window.klibb.surfaces.map((m) => [m.name, m.material.userData.fab?.asp?.value]));
    const a = Object.fromEntries(asp);
    check('…and each tile keeps the picture\'s shape (aspect ≈ 300/700, 700/260, 330/610)', Math.abs(a.golv - 300 / 700) < 0.03 && Math.abs(a['vägg-norr'] - 700 / 260) < 0.1 && Math.abs(a.tak - 330 / 610) < 0.03, a);
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  finally { await browser.close(); S.child.kill(); }
  console.log(`\nTile e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

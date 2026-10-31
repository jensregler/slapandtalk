// E2E: no body fabric through a face photo (Jens, 31 Oct 2026). With a loud skin fabric (magenta/lime
// stripes) and a face photo, the face – nose ridge, nose sides, cheeks by the ears – must show the photo
// (or the plain face colour at its very edge), never the skin fabric. Checked as another player sees it,
// front and 3/4, for every head (hair style). Before the fix the nose sides and the sides of the face
// were skin triangles (their normals point sideways), so the skin fabric showed through there.
// Own server (FACEBLEED_E2E_PORT, default 8898). Screenshots: FACEBLEED_SHOTS (default /workspace/facefix-shots).
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.FACEBLEED_E2E_PORT || 8898);
const SHOTS = process.env.FACEBLEED_SHOTS || '/workspace/facefix-shots';
const TAG = process.env.FACEBLEED_TAG || 'after';
const HAIRS = (process.env.FACEBLEED_HAIRS || 'kort,lugg,lang,kammad,tupp').split(',');
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };
// The loud skin fabric: magenta and lime stripes.
const FAB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#ff00ff"/>
  <rect x="0" width="64" height="256" fill="#00ff00"/><rect x="128" width="64" height="256" fill="#00ff00"/></svg>`;
// The face photo: a warm skin-coloured face with dark eyes, brows, beard – no magenta or lime anywhere.
const FACE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" fill="#c98a62"/>
  <rect y="0" width="640" height="120" fill="#5a3418"/>
  <ellipse cx="235" cy="300" rx="50" ry="26" fill="#fff"/><ellipse cx="405" cy="300" rx="50" ry="26" fill="#fff"/>
  <circle cx="235" cy="302" r="18" fill="#3a2410"/><circle cx="405" cy="302" r="18" fill="#3a2410"/>
  <rect x="180" y="245" width="110" height="18" rx="8" fill="#2b1a0c"/><rect x="350" y="245" width="110" height="18" rx="8" fill="#2b1a0c"/>
  <path d="M150 430 Q320 640 490 430 L490 640 L150 640 Z" fill="#3b2a1e"/></svg>`;
// magenta or lime, lit or in shade (the photo, the hair and the hoodie have neither)
const fabricPx = (r, g, b) => (r > 90 && b > 90 && g < 0.55 * Math.min(r, b)) || (g > 90 && r < 0.6 * g && b < 0.6 * g);

// The face of a player's avatar on screen: the screen box around the front of the head (avatars.js
// FACE: hairline to chin, in front of the ears), from the avatar's own transform (the avatar = 0.9 × the model).
async function faceBox(p, which = 'eyes') {
  return p.evaluate((which) => {
    const k = window.klibb, cam = which === 'show' ? k.showCam : k.camera;
    const scene = k.scene;
    const roots = []; scene.traverse((o) => { if (o.name === (which === 'show' ? 'min-gubbe' : 'gubbe') && o.visible) roots.push(o); });
    const at = which === 'show' ? k.avatarView().pos : k.players()[0].pos;
    const root = roots.sort((a, b) => a.position.distanceTo(new a.position.constructor(...at)) - b.position.distanceTo(new a.position.constructor(...at)))[0];
    root.updateMatrixWorld(true);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const x of [-0.1, 0.11]) for (const y of [1.5, 1.74]) for (const z of [0.12, 0.23]) {
      const v = root.localToWorld(new root.position.constructor(x * 0.9, y * 0.9, z * 0.9)).project(cam);
      const sx = (v.x + 1) / 2 * innerWidth, sy = (1 - v.y) / 2 * innerHeight;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }, which);
}
async function shot(p, file, box) {
  const pad = Math.max(box.width, box.height) * 0.5;
  const clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 };
  const png = await p.screenshot({ clip });
  await sharp(png).resize({ width: 1000, kernel: 'nearest' }).png().toFile(file); // big, for poor eyes
}
async function fabricShare(p, box) {
  const png = await p.screenshot({ clip: box });
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let hit = 0; const n = info.width * info.height;
  for (let i = 0; i < n; i++) { const o = i * info.channels; if (fabricPx(data[o], data[o + 1], data[o + 2])) hit++; }
  return { share: hit / n, hit, n };
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const fabPng = path.join(os.tmpdir(), 'e2e-facebleed-fabric.png'), facePng = path.join(os.tmpdir(), 'e2e-facebleed-face.png');
  await sharp(Buffer.from(FAB_SVG)).png().toFile(fabPng); await sharp(Buffer.from(FACE_SVG)).png().toFile(facePng);
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  try {
    const up = async (file) => { const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(file)], { type: 'image/png' }), 'x.png');
      const r = await fetch(`${S.base}/api/fabrics`, { method: 'POST', body: fd, headers: { 'x-unlock': 'demo-e2e-key' } }); return r.json(); };
    const fab = await up(fabPng), face = await up(facePng);
    check('the skin fabric and the face photo are uploaded', /^[a-f0-9]{16}$/.test(fab.id || '') && /^[a-f0-9]{16}$/.test(face.id || ''), { fab, face });
    for (const hair of HAIRS) {
      const { room: { id: R }, roomKey: KEY } = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
      const look = { outfit: 'huvtroja', hair, shirt: '#3a86ff', pants: '#2b4c7e', hairColor: '#4a2c17', skin: '#e0ac69', hat: false, hatColor: '#e63946',
        fabric: { skin: { id: fab.id, scale: 0.5 }, face: { id: face.id, photo: true } } };
      const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await ctxA.addInitScript(([r, k, l]) => { localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })); localStorage.setItem('klibb.avatar', JSON.stringify({ name: 'Ansikte', look: l })); localStorage.setItem('klibb.unlock', 'demo-e2e-key'); }, [R, KEY, look]);
      const A = await ctxA.newPage(); A.on('pageerror', (e) => errors.push('A: ' + e.message));
      const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const B = await ctxB.newPage(); B.on('pageerror', (e) => errors.push('B: ' + e.message));
      for (const P of [A, B]) {
        await P.goto(`${S.base}/?room=${R}`);
        await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.net.status === 'online' && window.klibb.net.id, null, { timeout: 30000 });
      }
      await A.evaluate(() => { const k = window.klibb; k.moveTo(0, 0.5); k.look(0, 0); });
      await sleep(2500); // let the toasts fade
      await B.waitForFunction(() => { const p = window.klibb.players()[0]; return p && p.face && p.face.photo && p.face.fabric?.loaded && p.fabrics?.skin?.loaded !== false; }, null, { timeout: 20000 });
      for (const [view, deg] of [['front', 0], ['three-quarter', 40], ['side', 70]]) {
        const th = deg * Math.PI / 180, d = 0.75;
        await B.evaluate(([th, d]) => { const k = window.klibb; k.moveTo(Math.sin(th) * d, 0.5 - Math.cos(th) * d); k.look(Math.PI - th, -0.12); }, [th, d]);
        await sleep(1200);
        const box = await faceBox(B, 'eyes');
        await shot(B, path.join(SHOTS, `${TAG}-${hair}-${view}.png`), box);
        const s = await fabricShare(B, box);
        check(`${hair}, ${view}: no skin fabric on the face (seen by the other player)`, s.share < 0.0005, s);
        console.log('      fabric share', s.share.toFixed(5));
      }
      // My own avatar in My avatar (the zoomed showcase view) – B leaves first, so it can't stand in the way.
      await ctxB.close();
      await A.evaluate(() => window.klibb.openAvatarPanel());
      await A.waitForFunction(() => { const v = window.klibb.avatarView(); const f = window.klibb.selfAvatar().face; return v && v.visible && f && f.photo; }, null, { timeout: 20000 });
      await A.waitForFunction(() => Math.abs(Math.sin(window.klibb.avatarView().phase)) < 0.15, null, { timeout: 15000, polling: 50 });
      const sbox = await faceBox(A, 'show');
      await shot(A, path.join(SHOTS, `${TAG}-${hair}-my-avatar.png`), sbox);
      const s = await fabricShare(A, sbox);
      check(`${hair}, My avatar: no skin fabric on the face`, s.share < 0.0015, s);
      await ctxA.close();
    }
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await browser.close(); S.child.kill();
  console.log(`\nFace-bleed e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

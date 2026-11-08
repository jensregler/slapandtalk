// E2E: 🎲 Random / 🌀 Randomize in My avatar never take the face away (Jens, 8 Nov 2026).
// Seed the locked face photo (insta @jensreglermanniska), press Random N times and Randomize once: the face photo stays on the head.
// Own server (RANDOMFACE_E2E_PORT, default 8898). Screenshot: RANDOMFACE_SHOT.
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.RANDOMFACE_E2E_PORT || 8898);
const SHOT = process.env.RANDOMFACE_SHOT || '/workspace/randomface/after-random.png';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };
const FACE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800"><rect width="640" height="800" fill="#8a8f99"/>
  <ellipse cx="320" cy="400" rx="230" ry="300" fill="#ff8800"/>
  <ellipse cx="235" cy="350" rx="55" ry="40" fill="#fff"/><ellipse cx="405" cy="350" rx="55" ry="40" fill="#fff"/>
  <circle cx="235" cy="350" r="22" fill="#1d4ed8"/><circle cx="405" cy="350" r="22" fill="#1d4ed8"/>
  <path d="M200 520 Q320 640 440 520" stroke="#c00" stroke-width="28" fill="none" stroke-linecap="round"/></svg>`;

(async () => {
  fs.mkdirSync(path.dirname(SHOT), { recursive: true });
  const facePng = path.join(os.tmpdir(), 'e2e-randomface-photo.png');
  await sharp(Buffer.from(FACE_SVG)).png().toFile(facePng);
  const S = await startServer(PORT, { DEMO_PROFILE: '0' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  try {
    const { room: { id: R }, roomKey: KEY } = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(([r, k]) => localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })), [R, KEY]);
    await ctx.addInitScript(() => localStorage.setItem('klibb.avatar', JSON.stringify({ name: 'Ansikte', look: { outfit: 'tshirt', hair: 'kort', shirt: '#3a86ff', pants: '#2b4c7e', hairColor: '#4a2c17', skin: '#e0ac69', hat: false, hatColor: '#e63946', insta: 'jensreglermanniska' } }))); // owns the locked face photo (t587u)
    const A = await ctx.newPage(); A.on('pageerror', (e) => errors.push(e.message));
    await A.goto(`${S.base}/?room=${R}`);
    await A.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.net.status === 'online', null, { timeout: 30000 });
    await A.evaluate(async () => { await window.klibb.entitlementsReady?.(); const k = window.klibb; k.moveTo(0, 0.5); k.look(0, 0); k.openAvatarPanel(); });
    await A.waitForFunction(() => { const v = window.klibb.avatarView(); return v && v.visible && window.klibb.selfAvatar().face; }, null, { timeout: 15000 });
    await A.waitForFunction(() => { const f = window.klibb.selfAvatar().face; return f.photo && f.fabric?.loaded; }, null, { timeout: 20000 });
    const before = await A.evaluate(() => ({ face: window.klibb.selfAvatar().face, draft: window.klibb.avatarView().draft }));
    check('face photo on before Random', before.face.photo && before.draft.fabric?.face?.photo, before);
    const faceId = before.draft.fabric.face.id;
    const N = 8, outfits = new Set();
    for (let i = 0; i < N; i++) {
      await A.evaluate(() => document.getElementById('av-random').click()); await sleep(300);
      const s = await A.evaluate(() => ({ face: window.klibb.selfAvatar().face, draft: window.klibb.avatarView().draft }));
      outfits.add(s.draft.outfit + s.draft.shirt + s.draft.hair);
      if (!(s.draft.fabric?.face?.id === faceId && s.face.photo)) { check(`face kept after Random #${i + 1}`, false, s); break; }
    }
    check(`face photo still on after ${N} × 🎲 Random`, await A.evaluate((id) => { const d = window.klibb.avatarView().draft; return d.fabric?.face?.id === id && window.klibb.selfAvatar().face.photo; }, faceId));
    check('…and Random did change the clothes', outfits.size > 1, [...outfits]);
    if (await A.evaluate(() => !!document.getElementById('av-wild'))) {
      await A.evaluate(() => document.getElementById('av-wild').click());
      await A.waitForFunction(() => !document.querySelector('#av-wild')?.disabled, null, { timeout: 15000 }); await sleep(2500);
      const w = await A.evaluate(() => window.klibb.avatarView().draft.fabric?.face?.id);
      check('face photo still on after 🌀 Randomize', w === faceId, w);
    }
    await A.waitForFunction(() => window.klibb.selfAvatar().face.fabric?.loaded, null, { timeout: 15000 });
    await A.waitForFunction(() => Math.abs(Math.sin(window.klibb.avatarView().phase)) < 0.2, null, { timeout: 15000, polling: 50 });
    await A.screenshot({ path: SHOT });
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + e.stack); }
  finally { await browser.close(); S.child.kill(); }
  console.log(`randomface: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

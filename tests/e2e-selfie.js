// E2E: selfie mode = no slap mode (Jens, 2 Nov 2026: in the front view the sticker preview and the aim
// ring were still there behind my avatar, and "Slap mode · V" still showed). In view 'front': no aim
// ring, no "Slap mode · V", no held sticker preview (desktop) / holder (phone), the mode button greyed;
// a click / stampAt places nothing, V does not switch modes. Back in 1st / 3rd person: all of it is back.
// Own server (SELFIE_E2E_PORT, default 8907). Screenshots: SELFIE_SHOTS (default /workspace/presetpicker-shots).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.SELFIE_E2E_PORT || 8907);
const SHOTS = process.env.SELFIE_SHOTS || '/workspace/presetpicker-shots';
const TAG = process.env.SELFIE_TAG || 'after';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errs = [];
  try {
    const mk = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ style: { floor: 'betong', wall: 'tegel' }, preset: false }) })).json();
    const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${S.base}/?room=${mk.room.id}`);
    await p.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected && window.klibb.net.status === "online", null, { timeout: 30000 });
    // as when the pointer is locked (playing): the aim ring shows; aim the preview at the north wall
    const ui = () => p.evaluate(() => {
      const vis = (id) => { const e = document.getElementById(id); if (!e) return null; const cs = getComputedStyle(e); return !e.hidden && cs.display !== 'none' && cs.visibility !== 'hidden'; };
      const k = window.klibb;
      return { view: k.view(), ring: vis('crosshair'), hint: vis('mode-hud'), hintText: document.getElementById('mode-hud').textContent, preview: !!k.preview.mesh.visible, modeBtn: getComputedStyle(document.getElementById('mode-btn')).pointerEvents, mode: k.state.mode, nature: document.body.classList.contains('nature-mode') };
    });
    await p.evaluate(() => { const k = window.klibb; document.getElementById('crosshair').hidden = false; k.setMode('slap', { quiet: true }); k.setView('third', { quiet: true }); /* a room starts in View mode: as after a click on a wall */ k.moveTo(0, 2); k.look(0, 0.15); k.aimAt?.(0, 0); });
    await p.mouse.move(640, 400); await sleep(1500);
    const third = await ui();
    check('3rd person (behind): slap mode as always – aim ring, "Slap mode · V", the sticker preview', third.ring && third.hint && /Slap mode/.test(third.hintText), third);
    await p.screenshot({ path: path.join(SHOTS, `20-selfie-${TAG}-third-person.png`) });
    await p.evaluate(() => window.klibb.setView('front', { quiet: true })); await p.mouse.move(650, 410); await sleep(1500);
    const front = await ui();
    await p.screenshot({ path: path.join(SHOTS, `21-selfie-${TAG}-front.png`) });
    check('selfie mode (front view): no aim ring, no "Slap mode · V", no sticker preview, the mode button greyed', front.view === 'front' && !front.ring && !front.hint && !front.preview && front.modeBtn === 'none', front);
    const n0 = await p.evaluate(() => window.klibb.stamps.meshes.size);
    const slapped = await p.evaluate(async () => !!(await window.klibb.stampAt(0, 0)));
    await p.mouse.click(640, 400); await sleep(800);
    check('…a slap (stampAt / a click) places nothing', !slapped && (await p.evaluate(() => window.klibb.stamps.meshes.size)) === n0);
    await p.keyboard.press('v'); await sleep(400);
    const afterV = await ui();
    check('…V does not switch to Nature mode', !afterV.nature && afterV.mode === front.mode, afterV);
    await p.evaluate(() => window.klibb.setView('first', { quiet: true })); await p.mouse.move(640, 400); await sleep(1200);
    const first = await ui();
    check('back to 1st person: aim ring, hint and preview are back', first.ring && first.hint && first.preview && first.modeBtn !== 'none', first);
    const ok = await p.evaluate(async () => { const k = window.klibb; k.look(0, 0.1); await new Promise((r) => setTimeout(r, 100)); return !!(await k.stampAt(0, 0)); });
    check('…and slapping works again', ok);
    await p.keyboard.press('v'); await sleep(500);
    check('…and V switches modes again', (await ui()).nature);
    // phone: the held sticker in its holder goes away in selfie mode
    const m = await (await b.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage(); m.on('pageerror', (e) => errs.push('m: ' + e.message));
    await m.goto(`${S.base}/?room=${mk.room.id}`); await m.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected, null, { timeout: 30000 }); await sleep(1000);
    const held = () => m.evaluate(() => getComputedStyle(document.getElementById('held')).display);
    const h1 = await held();
    await m.evaluate(() => window.klibb.setView('front', { quiet: true })); await sleep(1200);
    const h2 = await held();
    await m.screenshot({ path: path.join(SHOTS, `22-selfie-${TAG}-phone-front.png`) });
    await m.evaluate(() => window.klibb.setView('first', { quiet: true })); await sleep(400);
    check('phone: the held sticker shows in 1st person, is gone in selfie mode, back after', h1 !== 'none' && h2 === 'none' && (await held()) !== 'none', { h1, h2 });
    check('no page errors', errs.length === 0, errs);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await b.close(); S.child.kill();
  console.log(`\nSelfie e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

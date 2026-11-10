// E2E (short): no sticker wheel any more (Jens t793u, 10 Nov 2026) – the small design HUD bottom
// centre (main.js renderStrip) shows the held sticker + n/N; R/F step it; a pick from the panel list
// holds it without slapping; the demo's library goes round. Own servers (port 8887 normal app, 8889
// demo; STRIP_E2E_PORT; never 8787). Phones: the sticker stack, no HUD. Screenshot: STRIP_SHOT (default /workspace/mobile-ui-shots/desktop-strip.png).
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { chromium, devices } = require('playwright');
const { startServer, enter } = require('./demo-helpers');

const PORT = Number(process.env.STRIP_E2E_PORT || 8887);
const SHOT = process.env.STRIP_SHOT || '/workspace/mobile-ui-shots/desktop-strip.png';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra) : '')); } };

(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '0', ADMIN_TOKEN: 'strip-e2e-admin' });
  const D = await startServer(PORT + 2, { DEMO_PROFILE: '1', ADMIN_TOKEN: 'strip-e2e-admin' });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-strip-e2e-'));
  const errors = [];
  console.log(`Design HUD, no wheel (${S.base}, demo ${D.base})`);
  try {
    const colors = ['#e0352b', '#2b6be0', '#2be06b', '#e0d02b', '#b02be0'];
    const files = [];
    for (const [i, c] of colors.entries()) { const f = path.join(tmp, `s${i}.png`); await sharp({ create: { width: 120, height: 120, channels: 4, background: c } }).png().toFile(f); files.push(f); }
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route('**/api/library', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"stickers":[]}' })); // my own uploads only here (the library on the wheel for everyone: e2e-wheel)
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${made.room.id}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    check('no stickers yet: no design HUD', !(await P.evaluate(() => window.klibb.designHud().shown)));
    for (const [i, f] of files.entries()) { await P.setInputFiles('#file', f); await P.waitForFunction((n) => window.klibb.designs().length === n, i + 1, { timeout: 20000 }); }
    await P.waitForTimeout(300);
    const st = () => P.evaluate(() => ({ ...window.klibb.designHud(), wheels: window.klibb.wheelsShown(), selected: window.klibb.state.selected.id, url: window.klibb.state.selected.url, ids: window.klibb.designs().map((d) => d.id), count: window.klibb.stamps.count, locked: window.klibb.controls.locked, rect: document.getElementById('design-hud').getBoundingClientRect().toJSON() }));
    const s0 = await st();
    // The wheels are gone (Jens t793u, 10 Nov 2026): the small design HUD bottom centre shows the held one + n/N.
    check(`no sticker wheel; the design HUD shows the held sticker (${s0.num})`, s0.shown && s0.wheels.length === 0 && s0.img === s0.url && /^\d+\/5$/.test(s0.num), s0);
    check('the HUD stays clear of the crosshair (bottom of the screen)', s0.rect.top > 800 / 2 + 150, s0.rect);
    const target = s0.ids[2];
    await P.click(`#tray [data-id="${target}"] .pick, #tray .thumb[data-id="${target}"]`).catch(() => P.evaluate((id) => window.klibb.selectDesign(window.klibb.designs().find((d) => d.id === id)), target));
    await P.waitForTimeout(500);
    const s1 = await st();
    check('picking from the panel list holds that sticker (HUD follows) – no slap', s1.selected === target && s1.img === s1.url && s1.count === s0.count, s1);
    await P.mouse.move(640, 300); await P.keyboard.press('r'); await P.waitForTimeout(200);
    const s2 = await st();
    await P.keyboard.press('f'); await P.keyboard.press('f'); await P.waitForTimeout(200);
    const s3 = await st();
    const i1 = s1.ids.indexOf(target);
    check('R / F step the held sticker; the HUD follows', s2.selected === s1.ids[(i1 + 1) % 5] && s2.img === s2.url && s3.selected === s1.ids[(i1 + 4) % 5] && s3.img === s3.url, { s2: s2.num, s3: s3.num });
    await ctx.close();

    // the demo: the library, R/F go round it
    const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const M = await enter(dctx, D.base + '/', 'Jens'); M.on('pageerror', (e) => errors.push(e.message));
    await M.waitForURL(/\?room=/, { timeout: 20000 }); await M.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    await M.waitForFunction(() => window.klibb.designs().length > 20 && window.klibb.state.selected, null, { timeout: 20000 });
    await M.evaluate(() => document.activeElement && document.activeElement.blur());
    const first = await M.evaluate(() => ({ sel: window.klibb.state.selected.id, ids: window.klibb.designs().map((d) => d.id) }));
    await M.keyboard.press('f'); await M.waitForTimeout(250);
    const fin = await M.evaluate(() => ({ sel: window.klibb.state.selected.id, hud: window.klibb.designHud(), wheels: window.klibb.wheelsShown() }));
    const fi = first.ids.indexOf(first.sel);
    check(`demo: F goes round the library (${first.ids.length}); HUD shows it, no wheel`, fin.sel === first.ids[(fi - 1 + first.ids.length) % first.ids.length] && fin.hud.shown && fin.wheels.length === 0, { fin, fi });
    await M.mouse.move(640, 300); await M.waitForTimeout(300); await M.screenshot({ path: SHOT });
    await dctx.close();

    // phones: no strip
    const pctx = await browser.newContext({ ...devices['iPhone 13'] });
    const T = await pctx.newPage(); T.on('pageerror', (e) => errors.push(e.message));
    await T.goto(`${S.base}/?room=${made.room.id}`); await T.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    await T.setInputFiles('#file', files[0]); await T.waitForFunction(() => window.klibb.designs().length === 1, null, { timeout: 20000 });
    check('phone: no strip, no design HUD (the sticker stack instead)', (await T.evaluate(() => window.klibb.wheelsShown().length)) === 0 && await T.isHidden('#design-hud') && await T.isVisible('#design-btn'));
    await pctx.close();
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  finally {
    await browser.close(); S.child.kill(); D.child.kill();
    for (const d of [S.dir, D.dir, tmp]) fs.rmSync(d, { recursive: true, force: true });
    console.log(`\nSticker strip e2e: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();

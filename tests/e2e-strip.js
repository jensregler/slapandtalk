// E2E (short): the desktop sticker strip along the bottom edge (main.js renderStrip). Own servers
// (port 8887 normal app, 8889 demo; STRIP_E2E_PORT; never 8787). The strip holds the stickers R/F
// cycle through, the current one highlighted; a click picks one and never slaps or locks the pointer;
// R/F move the highlight and keep it in view (the demo's 130-sticker library scrolls); it stays clear
// of the crosshair; phones do not have it. Screenshot: STRIP_SHOT (default /workspace/mobile-ui-shots/desktop-strip.png).
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
  console.log(`Desktop sticker strip (${S.base}, demo ${D.base})`);
  try {
    const colors = ['#e0352b', '#2b6be0', '#2be06b', '#e0d02b', '#b02be0'];
    const files = [];
    for (const [i, c] of colors.entries()) { const f = path.join(tmp, `s${i}.png`); await sharp({ create: { width: 120, height: 120, channels: 4, background: c } }).png().toFile(f); files.push(f); }
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${made.room.id}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    check('no stickers yet: no strip', !(await P.evaluate(() => window.klibb.strip().shown)));
    for (const [i, f] of files.entries()) { await P.setInputFiles('#file', f); await P.waitForFunction((n) => window.klibb.designs().length === n, i + 1, { timeout: 20000 }); }
    await P.waitForTimeout(300);
    const st = () => P.evaluate(() => ({ ...window.klibb.strip(), selected: window.klibb.state.selected.id, ids: window.klibb.designs().map((d) => d.id), count: window.klibb.stamps.count, locked: window.klibb.controls.locked }));
    const s0 = await st();
    check(`the strip runs along the bottom with all ${s0.ids.length} stickers, the current one highlighted (${s0.num})`,
      s0.shown && s0.n === 5 && s0.sel === s0.selected && s0.rect.bottom >= 799 && s0.rect.height <= 50, s0);
    check('it stays clear of the crosshair (lower part of the screen) and the old design box is gone', s0.rect.top > 800 / 2 + 100 && await P.isHidden('#design-hud'), s0.rect);
    const target = s0.ids[2];
    await P.click(`#strip-row .strip-th[data-id="${target}"]`); await P.waitForTimeout(400);
    const s1 = await st();
    check('clicking a thumbnail picks that sticker (highlight follows, 3/5) – no slap, no pointer lock', s1.selected === target && s1.sel === target && s1.num === '3/5' && s1.count === s0.count && !s1.locked, s1);
    await P.keyboard.press('r'); await P.waitForTimeout(200);
    const s2 = await st();
    await P.keyboard.press('f'); await P.keyboard.press('f'); await P.waitForTimeout(200);
    const s3 = await st();
    check('R / F move the highlight with the selection', s2.selected === s0.ids[3] && s2.sel === s2.selected && s3.selected === s0.ids[1] && s3.sel === s3.selected, { s2: s2.sel, s3: s3.sel });
    await ctx.close();

    // the demo: the library (130), scrolling and auto-scroll
    const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const M = await enter(dctx, D.base + '/', 'Jens'); M.on('pageerror', (e) => errors.push(e.message));
    await M.waitForURL(/\?room=/, { timeout: 20000 }); await M.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    await M.waitForFunction(() => window.klibb.strip().n > 20, null, { timeout: 20000 });
    await M.evaluate(() => document.activeElement && document.activeElement.blur());
    const lib = await M.evaluate(() => ({ ...window.klibb.strip(), n2: window.klibb.designs().length }));
    await M.keyboard.press('f'); await M.waitForTimeout(250); // from the first, F goes round to the last
    const fin = await M.evaluate(() => { const s = window.klibb.strip(), row = document.getElementById('strip-row'), cur = row.querySelector('.sel');
      return { ...s, inView: cur.offsetLeft >= row.scrollLeft && cur.offsetLeft + cur.offsetWidth <= row.scrollLeft + row.clientWidth, sel2: window.klibb.state.selected.id }; });
    check(`demo: the strip is the library (${lib.n} = R/F's ${lib.n2}); F to the last one scrolls the strip to keep it in view`, lib.n === lib.n2 && fin.scroll > 0 && fin.inView && fin.sel === fin.sel2, { lib: lib.n, fin });
    await M.keyboard.press('f'); await M.keyboard.press('f'); await M.waitForTimeout(250);
    await M.mouse.move(640, 300); await M.waitForTimeout(300); await M.screenshot({ path: SHOT });
    const fin2 = await M.evaluate(() => window.klibb.strip().scroll);
    await M.hover('#strip-row'); await M.mouse.wheel(0, -600); await M.waitForTimeout(250);
    const wheel = await M.evaluate(() => window.klibb.strip().scroll);
    check('the mouse wheel over the strip scrolls it', wheel < fin2, { before: fin2, after: wheel });
    await dctx.close();

    // phones: no strip
    const pctx = await browser.newContext({ ...devices['iPhone 13'] });
    const T = await pctx.newPage(); T.on('pageerror', (e) => errors.push(e.message));
    await T.goto(`${S.base}/?room=${made.room.id}`); await T.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    await T.setInputFiles('#file', files[0]); await T.waitForFunction(() => window.klibb.designs().length === 1, null, { timeout: 20000 });
    check('phone: no strip (the sticker stack instead)', await T.isHidden('#design-strip') && await T.isVisible('#design-btn'));
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

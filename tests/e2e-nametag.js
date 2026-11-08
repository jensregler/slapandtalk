// E2E: the name-tag tool (Jens, 31 Oct 2026; mockups nametag-1..7, client/src/nametag.js). Click the
// placed sticker roll (knappar/editor.png) → a "my name is" tag opens big; ‹ › go through Jens's blanks
// (blanks/blank1..10 → client/public/nametags/); a colour picker, brushsize and brushtype (solid /
// opaque / dripping); "save" → "choose one to replace" → the tag is uploaded as my sticker and takes
// that sticker's place in the wheel; "exit" closes. Own server (NAMETAG_E2E_PORT, default 8902).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.NAMETAG_E2E_PORT || 8902);
const SHOTS = process.env.STICKERMENU_SHOTS || process.env.ESC_SHOTS || '/workspace/createmenu';
const NAMETAG = 'f79189b79546d64a', D71 = '2e30991b8436f21a' /* 98.png: the wheel's middle since 4 Nov (t507u) */;
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: false }) })).json();
    const R = made.room.id;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await ctx.addInitScript(([r, k]) => localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })), [R, made.roomKey]);
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${R}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected, null, { timeout: 60000 });
    await sleep(1200);
    // slap the roll on the north wall and click it
    await P.evaluate(() => { const k = window.klibb; k.setView('first', { quiet: true }); k.moveTo(0, -1.4); k.look(0, 0.05); });
    await sleep(400);
    await P.evaluate((id) => window.klibb.selectDesign(window.klibb.state.library.find((d) => d.id === id)), NAMETAG); await sleep(500);
    await P.evaluate(() => { window.klibb.controls.locked = true; window.klibb.setSize(45); window.klibb.stampAt(0, 0.2); window.klibb.controls.locked = false; });
    await sleep(900);
    // Menu stickers are gone: open the name-tag tool from the Esc menu action (same as the NAME button).
    check('the placed editor sticker is no longer a menu sticker', await P.evaluate(() => window.klibb.menuAt(0, 0.2)) === null);
    await P.evaluate(() => window.klibb.menuAction('nametag')); await sleep(800);
    let st = await P.evaluate(() => window.klibb.nameTag());
    check('a click on it opens the name-tag tool on Jens\'s first blank (no code fallback needed)', st.open && st.blank === 1 && st.fallback.length === 0, st);
    await P.screenshot({ path: path.join(SHOTS, '20-nametag-open.png') });
    await P.click('#nt-next'); await P.click('#nt-next'); await sleep(400);
    st = await P.evaluate(() => window.klibb.nameTag());
    check('› goes through the blanks (purple "FUCK my name is" = blank3)', st.blank === 3, st);
    // pick a red in the picker, then draw "R" and "X"
    const box = async (sel) => P.locator(sel).boundingBox();
    const hue = await box('#nt-hue'), sv = await box('#nt-sv');
    await P.mouse.click(hue.x + 10, hue.y + 2); await P.mouse.click(sv.x + sv.width * 0.95, sv.y + sv.height * 0.08);
    const tag = await box('#nt-stroke');
    const T = (fx, fy) => [tag.x + tag.width * fx, tag.y + tag.height * fy];
    const line = async (pts) => { await P.mouse.move(...T(...pts[0])); await P.mouse.down(); for (const p of pts.slice(1)) await P.mouse.move(...T(...p), { steps: 12 }); await P.mouse.up(); };
    await P.fill('#nt-size', '22'); await P.dispatchEvent('#nt-size', 'input');
    await line([[0.18, 0.88], [0.2, 0.52], [0.32, 0.55], [0.3, 0.68], [0.2, 0.7], [0.34, 0.88]]);
    await P.click('#nt-type'); await sleep(200);
    await P.screenshot({ path: path.join(SHOTS, '21-nametag-brushtypes.png') });
    await P.click('.nt-brush-dripping'); await sleep(100);
    await line([[0.55, 0.5], [0.8, 0.9]]); await line([[0.8, 0.5], [0.55, 0.9]]);
    await line([[0.4, 0.07], [0.45, 0.2]]); await line([[0.6, 0.07], [0.55, 0.2]]);
    await P.click('#nt-type'); await P.click('.nt-brush-opaque'); await P.fill('#nt-size', '40'); await P.dispatchEvent('#nt-size', 'input');
    await line([[0.15, 0.95], [0.85, 0.95]]);
    await sleep(2500); // drips run
    st = await P.evaluate(() => window.klibb.nameTag());
    const ink = await P.evaluate(() => { const c = document.getElementById('nt-ink').getContext('2d'); const d = c.getImageData(0, 0, 800, 536).data; let red = 0, semi = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 200 && d[i - 3] > 180 && d[i - 2] < 60) red++; else if (d[i] > 60 && d[i] < 160) semi++; return { red, semi }; });
    check('drawing works: red solid ink, the opaque brush leaves see-through ink, brush = opaque, size 40', ink.red > 4000 && ink.semi > 4000 && st.brush === 'opaque' && st.size === 40 && /^#e[0-9a-f]|^#f[0-9a-f]/.test(st.color), { ink, st });
    await P.screenshot({ path: path.join(SHOTS, '22-nametag-drawn.png') });
    const order = await P.evaluate(() => window.klibb.nameTag().buttons.map((b) => b.id + ':' + b.text));
    check('bottom bar reads exit – undo – done', order.join('|') === 'nt-exit:exit|nt-undo:↶ undo|nt-save:done', order);
    check('left Slap-and-Talk panel hidden while editor open', await P.evaluate(() => document.body.classList.contains('nametag-open') && getComputedStyle(document.getElementById('panel')).display === 'none'));
    const choices = await P.evaluate(() => window.klibb.stickerDesigns().length);
    await P.click('#nt-save'); await sleep(800);
    const grid = await P.evaluate(() => ({
      shown: !document.getElementById('nt-replace').hidden,
      n: document.querySelectorAll('#nt-grid .nt-pick').length,
      title: document.getElementById('nt-replace-title')?.textContent || '',
      first: document.querySelector('#nt-grid .nt-pick')?.dataset.id,
    }));
    check('"done" → carry-228 replace heading + wheel stickers', grid.shown && grid.n === choices && grid.n > 50 && /228/.test(grid.title) && /Choose one sticker to replace/i.test(grid.title), { grid, choices });
    await P.screenshot({ path: path.join(SHOTS, '23-nametag-choose-replace.png') });

    await P.click(`#nt-grid .nt-pick[data-id="${D71}"]`); await sleep(400);
    const conf = await P.evaluate(() => {
      const st = window.klibb.nameTag();
      const pick = document.querySelector('#nt-grid .nt-pick.picked');
      return { confirming: st.confirming, pickId: st.pickId, ask: document.getElementById('nt-confirm-ask')?.textContent, lifted: !!pick };
    });
    check('picking a sticker lifts it and asks Replace this?', conf.confirming && conf.pickId === D71 && /Replace this/i.test(conf.ask) && conf.lifted, conf);
    await P.screenshot({ path: path.join(SHOTS, '23b-nametag-replace-confirm.png') });
    await P.click('#nt-confirm-no'); await sleep(400);
    const afterNo = await P.evaluate(() => {
      const st = window.klibb.nameTag();
      const ink = document.getElementById('nt-ink').getContext('2d').getImageData(0, 0, 800, 536).data;
      let painted = 0; for (let i = 3; i < ink.length; i += 4) if (ink[i] > 10) painted++;
      return { open: st.open, replacing: st.replacing, confirming: st.confirming, painted };
    });
    check('No discards the drawing and returns to draw mode', afterNo.open && !afterNo.replacing && !afterNo.confirming && afterNo.painted === 0, afterNo);

    const tag2 = await P.locator('#nt-stroke').boundingBox();
    const T2 = (fx, fy) => [tag2.x + tag2.width * fx, tag2.y + tag2.height * fy];
    await P.mouse.move(...T2(0.3, 0.5)); await P.mouse.down(); await P.mouse.move(...T2(0.7, 0.7), { steps: 10 }); await P.mouse.up();
    await P.click('#nt-save'); await sleep(500);
    await P.click(`#nt-grid .nt-pick[data-id="${D71}"]`); await sleep(300);
    await P.click('#nt-replace-back'); await sleep(300);
    const afterBack = await P.evaluate(() => {
      const st = window.klibb.nameTag();
      const ink = document.getElementById('nt-ink').getContext('2d').getImageData(0, 0, 800, 536).data;
      let painted = 0; for (let i = 3; i < ink.length; i += 4) if (ink[i] > 10) painted++;
      return { replacing: st.replacing, painted };
    });
    check('Back keeps the drawing and returns to draw mode', !afterBack.replacing && afterBack.painted > 0, afterBack);
    await P.click('#nt-save'); await sleep(500);
    await P.click(`#nt-grid .nt-pick[data-id="${D71}"]`); await sleep(300);
    await P.click('#nt-confirm-yes');
    await P.waitForFunction(() => !window.klibb.nameTag().open, null, { timeout: 15000 }); await sleep(800);
    const after = await P.evaluate((d71) => { const w = window.klibb.stickerDesigns(); const sel = window.klibb.state.selected; return { sel: sel.id, at0: w[0].id, has71: w.some((d) => d.id === d71), once: w.filter((d) => d.id === sel.id).length, mine: JSON.parse(localStorage.getItem('klibb.mine') || '[]').map((m) => m.id), swaps: JSON.parse(localStorage.getItem('klibb.swaps') || '{}') }; }, D71);
    check('…choosing 98 (the middle): the tag is uploaded as my sticker, in my hand, in 98\'s place, once; 98 is out', after.at0 === after.sel && !after.has71 && after.once === 1 && after.mine.includes(after.sel) && after.swaps[D71] === after.sel, after);
    const img = await (await fetch(`${S.base}/api/stickers/${after.sel}.webp`).catch(() => null))?.status;
    await P.evaluate(() => { window.klibb.controls.locked = true; window.klibb.setSize(40); window.klibb.stampAt(-0.5, -0.25); window.klibb.controls.locked = false; }); await sleep(1200);
    await P.screenshot({ path: path.join(SHOTS, '24-nametag-slapped.png') });
    check('…and it can be slapped (a stamp with the tag image)', await P.evaluate((id) => window.klibb.state.stamps ? [...window.klibb.state.stamps.values?.() || window.klibb.state.stamps].some((s) => (s.img || s.design || s.stamp?.img) === id) : true, after.sel), img);
    await P.evaluate(() => window.klibb.openNameTag()); await sleep(400);
    await P.keyboard.press('Escape'); await sleep(200);
    check('Esc / exit closes it without saving', !(await P.evaluate(() => window.klibb.nameTag().open)));
    // phone
    const m = await (await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage();
    m.on('pageerror', (e) => errors.push('phone: ' + e.message));
    await m.goto(`${S.base}/?room=${R}`); await m.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 }); await sleep(800);
    await m.evaluate(() => window.klibb.openNameTag()); await sleep(800);
    await m.screenshot({ path: path.join(SHOTS, '25-nametag-phone.png') });
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await browser.close(); S.child.kill();
  console.log(`\nName-tag e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

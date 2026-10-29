// E2E (short): the size prefix in the web app. Own server (port 8840, normal app, DEV_UNLOCK).
// Since 28 Oct 2026 (Jens): the size prefix no longer sets the size. The first sticker of a session
// spawns 30 cm HIGH ("B_cat.png", square: 30 cm), later uploads and R/F keep the size you have, the
// wheel scales freely and R/F keep that scaled size; the free version never goes below 15 cm; the
// server still stores startCm (unused by the app). More: e2e-wheel (wide/tall spawns, wheel switching).
const sharp = require('sharp');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, openAccess } = require('./demo-helpers');

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };

(async () => {
  const S = await startServer(8840, { DEMO_PROFILE: '0', ADMIN_TOKEN: 'size-e2e-admin' });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-size-e2e-'));
  console.log(`Size prefix (${S.base})`);
  const OPEN = await openAccess(S.base); // OPEN ACCESS: the 'free' browser has the full version (5 cm – no max, nature allowed)
  if (OPEN) console.log('  – OPEN ACCESS is on: free-version checks expect the full limits (run with OPEN_ACCESS=0 for the free ones)');
  try {
    const files = { b: path.join(tmp, 'B_cat.png'), plain: path.join(tmp, 'b-Apple.png'), wide: path.join(tmp, 'D_wide.png') };
    await sharp({ create: { width: 64, height: 64, channels: 4, background: '#ff0000' } }).png().toFile(files.b);
    await sharp({ create: { width: 64, height: 64, channels: 4, background: '#00ff00' } }).png().toFile(files.plain);
    await sharp({ create: { width: 128, height: 64, channels: 4, background: '#0000ff' } }).png().toFile(files.wide);
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 650 } });
    const p = await ctx.newPage(); const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${S.base}/?room=${made.room.id}`);
    await p.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    const size = () => p.evaluate(() => ({ size: Math.round(window.klibb.state.size * 1000) / 10, label: document.getElementById('size-val').textContent, sel: window.klibb.state.selected && window.klibb.state.selected.id }));
    const upload = async (file) => {
      const before = await p.evaluate(() => window.klibb.designs().length);
      await p.setInputFiles('#file', file);
      await p.waitForFunction((n) => window.klibb.designs().length === n + 1, before, { timeout: 20000 });
      await p.waitForTimeout(200);
      return size();
    };
    const b = await upload(files.b);
    check('the first upload (B_cat.png, square) spawns 30 cm high – the B_ prefix no longer sets it', b.size === 30 && b.label === '30 cm', b);
    const plain = await upload(files.plain);
    check('the next upload keeps the size (30 cm)', plain.size === 30, plain);
    const wide = await upload(files.wide);
    check('a 2:1 design named D_… keeps the size too (not 22.5 cm from its prefix)', wide.size === 30 && wide.label === '30 cm', wide);
    await p.evaluate(() => { const k = window.klibb; k.moveTo(0, 0); k.look(0, 0); });
    await p.mouse.click(700, 330); await p.waitForFunction(() => window.klibb.controls.locked, null, { timeout: 5000 });
    for (let i = 0; i < 5; i++) await p.mouse.wheel(0, -200);
    await p.waitForTimeout(200);
    const scaled = await size();
    check('the wheel still scales freely after the start size', scaled.size > 30, scaled);
    const stamp = await p.evaluate(() => window.klibb.stampAt(0, 0).then((s) => s && Math.round(s.size * 1000) / 10));
    check('the slap uses the held (scaled) size', stamp === scaled.size, { stamp, scaled });
    await p.keyboard.press('KeyF'); await p.waitForTimeout(150); const f1 = await size();
    await p.keyboard.press('KeyF'); await p.waitForTimeout(150); const f2 = await size();
    await p.keyboard.press('KeyR'); await p.waitForTimeout(150); const r1 = await size();
    check('R/F: switching keeps the scaled size (no per-design reset)', [f1, f2, r1].every((x) => x.size === scaled.size) && new Set([f1.sel, f2.sel]).size === 2, { f1, f2, r1, scaled });
    let back = r1; for (let i = 0; i < 3 && back.sel !== wide.sel; i++) { await p.keyboard.press('KeyR'); await p.waitForTimeout(150); back = await size(); }
    check('…and back on the one that was scaled it is still the scaled size', back.sel === wide.sel && back.size === scaled.size, back);
    const low = await p.evaluate(() => { const k = window.klibb; k.setSize(5); return { size: Math.round(k.state.size * 1000) / 10, min: document.getElementById('size').min, minCm: k.minSizeCm }; });
    if (OPEN) check('open access: the size goes down to 5 cm (setSize, slider min)', low.size === 5 && low.min === '5' && low.minCm === 5, low);
    else check('free version: the size never goes below 15 cm (setSize, slider min)', low.size === 15 && low.min === '15' && low.minCm === 15, low);
    // Nature stickers (curated library, name starts with "nature"; shared/nature.mjs): 5 cm – 4 m high, no paper.
    // Since 28 Oct 2026 they are the full version (Nature wheel): the free version cannot hold one (checked
    // here), the 5 cm – 4 m limits are checked in the full version below.
    const natFree = await p.evaluate(async () => {
      const k = window.klibb, lib = k.library().find((d) => !d.nature), prev = k.state.selected;
      await k.selectDesign({ ...lib, id: 'feedfacecafe0001', nature: true, library: true, width: 100, height: 100 });
      const out = { sel: k.state.selected && k.state.selected.id, prev: prev && prev.id, paywall: k.fullUi().isOpen(), natLim: k.limitsFor({ ...lib, nature: true, library: true }) };
      k.fullUi().close();
      out.upload = k.limitsFor({ ...prev, library: false, nature: true, name: 'nature-x.png' }); // an upload is never nature
      out.peel = [k.dropsPeel({ ...lib, nature: true, library: true }), k.dropsPeel(lib), k.dropsPeel({ ...prev, library: false, nature: true, name: 'nature-x.png' })];
      return out;
    });
    if (OPEN) {
      check('open access: a nature sticker is held (no full version panel)', natFree.sel === 'feedfacecafe0001' && !natFree.paywall, natFree);
      check('…its rule is still 5 cm – 400 cm; an upload named nature… gets the normal (full) limits (5 cm – no max)', natFree.natLim.minCm === 5 && natFree.natLim.maxCm === 400 && natFree.upload.maxCm === Infinity && natFree.upload.minCm === 5, natFree);
      await p.evaluate((id) => window.klibb.selectDesign(window.klibb.designs().find((d) => d.id === id)), natFree.prev); // back to the upload
    } else {
    check('free version: a nature sticker cannot be held (the full version panel opens instead)', natFree.sel === natFree.prev && natFree.paywall, natFree);
    check('…its rule is still 5 cm – 400 cm; an upload named nature… keeps the normal free limits (15–100 cm)', natFree.natLim.minCm === 5 && natFree.natLim.maxCm === 400 && natFree.upload.maxCm === 100 && natFree.upload.minCm === 15, natFree);
    }
    check('nature stickers drop no backing paper (client: no peel animation); others and uploads do', JSON.stringify(natFree.peel) === '[false,true,true]', natFree.peel);
    await p.mouse.click(700, 330); await p.waitForFunction(() => window.klibb.controls.locked, null, { timeout: 5000 });
    for (let i = 0; i < 20; i++) await p.mouse.wheel(0, 200);
    await p.waitForTimeout(200);
    const wheelLow = await size();
    check(OPEN ? 'open access: the wheel goes down to 5 cm' : 'free version: the wheel stops at 15 cm', wheelLow.size === (OPEN ? 5 : 15), wheelLow);
    const server = await (await fetch(`${S.base}/api/stickers?ids=${b.sel}`)).json();
    check('the server still stores startCm 17.5 on the B_ image (kept, unused by the app)', server.images[b.sel] && server.images[b.sel].startCm === 17.5, server.images[b.sel]);
    await ctx.close();
    // Full version: the nature sticker's own limits, 5 cm – 4 m high (no 15 cm floor, no free 100 cm cap)
    const fctx = await browser.newContext({ viewport: { width: 1000, height: 650 } });
    await fctx.addInitScript(() => localStorage.setItem('klibb.devUnlock', '1'));
    const fp = await fctx.newPage(); fp.on('pageerror', (e) => errors.push(e.message));
    await fp.goto(`${S.base}/?room=${made.room.id}`);
    await fp.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.natureOpen(), null, { timeout: 30000 });
    const nat = await fp.evaluate(async () => {
      const k = window.klibb, lib = k.library().find((d) => !d.nature), r = (x) => Math.round(x * 1000) / 10;
      const realNat = k.natureDesigns()[0];
      await k.selectDesign({ ...lib, id: 'feedfacecafe0001', nature: true, library: true, width: 100, height: 100 });
      const out = { lim: k.limitsFor(), sliderMax: document.getElementById('size').max, sliderMin: document.getElementById('size').min, act: k.activeWheel() };
      k.setSize(350); out.s350 = r(k.state.size); k.setSize(900); out.s900 = r(k.state.size); k.setSize(3); out.s3 = r(k.state.size);
      k.setSize(380); await k.selectDesign(lib); out.back = r(k.state.size); out.backLim = k.limitsFor();
      out.real = realNat && k.limitsFor(realNat);
      return out;
    });
    check('nature sticker (full version): 5 cm – 400 cm, slider 5–400; 900 → 400, 3 → 5 (also a real imported one)', nat.lim.minCm === 5 && nat.lim.maxCm === 400 && nat.sliderMax === '400' && nat.sliderMin === '5' && nat.s350 === 350 && nat.s900 === 400 && nat.s3 === 5 && nat.real && nat.real.maxCm === 400 && nat.real.minCm === 5, nat);
    check('…back on a normal sticker the normal full limits again (380 cm kept, no 400 cm nature cap)', nat.back === 380 && nat.backLim.maxCm > 400, nat);
    await fctx.close();
    check('no page errors', !errors.length, errors);
  } catch (e) { fail++; console.log('  ✗ crashed: ' + (e && e.stack || e)); }
  finally { await browser.close(); S.child.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(`\nSize e2e: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

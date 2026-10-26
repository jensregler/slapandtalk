// E2E (short): the size prefix in the web app. Own server (port 8840, normal app, DEV_UNLOCK).
// An upload named "B_…" starts at 17.5 cm, one without a prefix (or with a dash) at 15 cm; a wide "D_…"
// at 22.5 cm (the letter value is the slider's size, the longest side); R/F sets each design's own start
// size; the wheel still scales freely afterwards; the free version never goes below 15 cm.
const sharp = require('sharp');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startServer } = require('./demo-helpers');

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };

(async () => {
  const S = await startServer(8840, { DEMO_PROFILE: '0', ADMIN_TOKEN: 'size-e2e-admin' });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-size-e2e-'));
  console.log(`Size prefix (${S.base})`);
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
    check('an upload named B_cat.png starts at 17.5 cm', b.size === 17.5 && b.label === '17.5 cm', b);
    const plain = await upload(files.plain);
    check('one without a prefix ("b-Apple.png": a dash is not a prefix) starts at 15 cm', plain.size === 15, plain);
    const wide = await upload(files.wide);
    check('a 2:1 design named D_… starts at 22.5 cm held size (the longest side, as the slider shows)', wide.size === 22.5 && wide.label === '22.5 cm', wide);
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
    const want = { [b.sel]: 17.5, [plain.sel]: 15, [wide.sel]: 22.5 };
    check('R/F: each design starts at its own size whenever it is picked', [f1, f2, r1].every((x) => want[x.sel] === x.size) && new Set([f1.sel, f2.sel]).size === 2, { f1, f2, r1 });
    let back = r1; for (let i = 0; i < 3 && back.sel !== wide.sel; i++) { await p.keyboard.press('KeyR'); await p.waitForTimeout(150); back = await size(); }
    check('…and back on the scaled one it is its start size again, not the scaled size', back.sel === wide.sel && back.size === 22.5, back);
    const low = await p.evaluate(() => { const k = window.klibb; k.setSize(5); return { size: Math.round(k.state.size * 1000) / 10, min: document.getElementById('size').min, minCm: k.minSizeCm }; });
    check('free version: the size never goes below 15 cm (setSize, slider min)', low.size === 15 && low.min === '15' && low.minCm === 15, low);
    for (let i = 0; i < 20; i++) await p.mouse.wheel(0, 200);
    await p.waitForTimeout(200);
    const wheelLow = await size();
    check('free version: the wheel stops at 15 cm', wheelLow.size === 15, wheelLow);
    const server = await (await fetch(`${S.base}/api/stickers?ids=${b.sel}`)).json();
    check('the server stored startCm 17.5 on the B_ image', server.images[b.sel] && server.images[b.sel].startCm === 17.5, server.images[b.sel]);
    check('no page errors', !errors.length, errors);
    await ctx.close();
  } catch (e) { fail++; console.log('  ✗ crashed: ' + (e && e.stack || e)); }
  finally { await browser.close(); S.child.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(`\nSize e2e: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

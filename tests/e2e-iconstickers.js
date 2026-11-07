// Former icon / menu stickers: still in the library as ordinary images, but OFF the sticker wheel
// (Esc menu replaces them). Own server.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.ICONS_E2E_PORT || 8895);
const ICONS = ['editor.png', 'character.png', 'city.png', 'exit.png', 'redio.png', 'room.png'];
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 400) : '')); } };
(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '0', ADMIN_TOKEN: 'icons-e2e-admin' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const lib = (await (await fetch(`${S.base}/api/library`)).json()).stickers;
    const man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'library', 'manifest.json'), 'utf8')).stickers;
    const icons = ICONS.map((n) => { const m = man.find((s) => s.source === n); return m && lib.find((d) => d.id === m.id); });
    check('/api/library still has the six icon images', icons.every(Boolean), ICONS.filter((n, i) => !icons[i]));
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const P = await ctx.newPage();
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: false }) })).json();
    await P.goto(`${S.base}/?room=${made.room.id}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected, null, { timeout: 60000 });
    const ids = icons.map((d) => d.id);
    const onWheel = await P.evaluate((ids) => ids.filter((id) => window.klibb.stickerDesigns().some((d) => d.id === id)), ids);
    check('…but they are excluded from the sticker wheel (Esc menu replaces them)', onWheel.length === 0, onWheel);
    const excl = await P.evaluate(() => window.klibb.wheelExclude());
    check('…and listed in wheelExclude', ids.every((id) => excl.includes(id)), { excl: excl.length });
    await ctx.close();
  } finally { await browser.close(); await S.close(); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

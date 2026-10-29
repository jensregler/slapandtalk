// E2E: own uploads per version (Jens, 29 Oct 2026, point 9). Free (OPEN_ACCESS off): ONE own
// uploaded sticker next to the free library deck; a second upload replaces the first with a short
// toast; older stored uploads stay on the device but only the newest is on the wheel. Full version
// (dev unlock) and OPEN_ACCESS on: every upload is kept, as before.
// Own servers (FREEUPLOAD_E2E_PORT, default 8896, and +1).
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.FREEUPLOAD_E2E_PORT || 8896);
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 600) : '')); } };

async function png(name, colour) { const f = path.join(os.tmpdir(), `e2e-freeup-${name}.png`); await sharp({ create: { width: 240, height: 240, channels: 4, background: colour } }).png().toFile(f); return f; }
async function open(browser, S, { dev = false, preload = null } = {}) {
  const { room: { id: R } } = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }, body: '{}' })).json();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(([dev, preload]) => {
    if (sessionStorage.getItem('init')) return; sessionStorage.setItem('init', '1');
    if (dev) localStorage.setItem('klibb.devUnlock', '1');
    if (preload) localStorage.setItem('klibb.mine', JSON.stringify(preload));
  }, [dev, preload]);
  const P = await ctx.newPage();
  await P.goto(`${S.base}/?room=${R}`);
  await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
  await P.evaluate(() => window.klibb.entitlementsReady());
  return P;
}
const upload = async (P, file) => {
  const before = await P.evaluate(() => window.klibb.state.selected?.id || null);
  await P.setInputFiles('#file', file);
  await P.waitForFunction((b) => { const s = window.klibb.state.selected; return s && !s.library && s.id !== b; }, before, { timeout: 15000 });
  await sleep(150);
  return P.evaluate(() => ({ sel: window.klibb.state.selected.id, mine: window.klibb.state.mine.map((m) => m.id), stored: JSON.parse(localStorage.getItem('klibb.mine') || '[]').map((m) => m.id),
    designs: window.klibb.designs().map((d) => d.id), wheel: window.klibb.stickerDesigns().filter((d) => !d.library).map((d) => d.id),
    lib: window.klibb.stickerDesigns().filter((d) => d.library).length, toast: document.getElementById('toast').textContent, full: window.klibb.entitlements().full.uploads, open: window.klibb.entitlements().open }));
};

(async () => {
  const red = await png('red', '#ff2040'), blue = await png('blue', '#2060ff'), green = await png('green', '#20c040');
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const FREE = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '0' });
  const OPEN = await startServer(PORT + 1, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  try {
    // Free
    const F = await open(browser, FREE);
    const f1 = await upload(F, red);
    check('free: the first upload works – my one own sticker, in hand, on the wheel next to the free library deck', !f1.full && !f1.open && f1.mine.length === 1 && f1.wheel.join() === f1.sel && f1.lib > 50 && !/replaced/.test(f1.toast), f1);
    const f2 = await upload(F, blue);
    check('free: a second upload REPLACES the first (one own sticker, stored and on the wheel)', f2.mine.join() === f2.sel && f2.stored.join() === f2.sel && f2.wheel.join() === f2.sel && f2.sel !== f1.sel, f2);
    check('…with a short toast that the full version keeps them all', /replaced the old one/.test(f2.toast) && /full version keeps them all/.test(f2.toast), f2.toast);
    check('…and the old one is gone from the palette and its local copy', !f2.designs.includes(f1.sel));
    // Full version (dev unlock on the free server)
    const U = await open(browser, FREE, { dev: true });
    const u1 = await upload(U, red), u2 = await upload(U, green);
    check('full version: every upload is kept (two own stickers), no replace toast', u2.full && u2.mine.length === 2 && u2.wheel.length === 2 && !/replaced/.test(u2.toast) && u1.mine.length === 1, u2);
    // Free, with uploads from before (e.g. made while OPEN_ACCESS was on): kept on the device, only the newest shown
    const old = await U.evaluate(() => JSON.parse(localStorage.getItem('klibb.mine'))); // two real uploads from the full browser
    const newest = old[old.length - 1].id;
    const G = await open(browser, FREE, { preload: old });
    const g = await G.evaluate(() => ({ designs: window.klibb.designs().map((d) => d.id), wheel: window.klibb.stickerDesigns().filter((d) => !d.library).map((d) => d.id), stored: JSON.parse(localStorage.getItem('klibb.mine') || '[]').map((m) => m.id) }));
    check('free with older uploads on the device: only the newest is on the palette/wheel, the rest stays stored (back with the full version)', g.designs.join() === newest && g.wheel.join() === newest && g.stored.length === 2, g);
    // OPEN_ACCESS on: unchanged (everyone keeps all)
    const O = await open(browser, OPEN);
    await upload(O, red); const o2 = await upload(O, blue);
    check('OPEN_ACCESS on: unchanged – both uploads kept, no toast about the full version', o2.open && o2.full && o2.mine.length === 2 && !/replaced/.test(o2.toast), o2);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await browser.close(); FREE.child.kill(); OPEN.child.kill();
  console.log(`\nFree upload e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

// E2E (lean): the free version's room limit (FREE_MAX_PLAYERS = 4) in the web app. Own server
// (port 8881, normal app; never 8787). Four people are in (plain WebSocket clients); the browser is
// the fifth: the banner says the room is full (4 max), slapping is refused with a toast and nothing
// is added; one of the four leaves → the browser gets in by itself, the banner goes and it can slap.
// Run: node tests/e2e-roomfull.js   (needs a built client: npx vite build)
const sharp = require('sharp');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
const PORT = Number(process.env.ROOMFULL_E2E_PORT || 8881);

(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '0', ADMIN_TOKEN: 'roomfull-e2e-admin', MAX_PLAYERS_PER_ROOM: '10' }); // Render's old 10 must not raise it
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-roomfull-e2e-'));
  const socks = [];
  console.log(`Room limit (${S.base})`);
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const R = made.room.id;
    for (const name of ['Anna', 'Bosse', 'Cilla', 'Dante']) {
      const ws = new WebSocket(`${S.base.replace('http', 'ws')}/ws?room=${R}`);
      await new Promise((r) => ws.on('open', r)); ws.send(JSON.stringify({ t: 'hello', name }));
      await new Promise((r) => ws.on('message', function f(d) { if (JSON.parse(d).t === 'welcome') { ws.off('message', f); r(); } }));
      socks.push(ws);
    }
    const file = path.join(tmp, 'dot.png');
    await sharp({ create: { width: 64, height: 64, channels: 4, background: '#ff3300' } }).png().toFile(file);
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 650 } });
    const p = await ctx.newPage(); const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${S.base}/?room=${R}`);
    await p.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    await p.setInputFiles('#file', file);
    await p.waitForFunction(() => window.klibb.designs().length === 1 && window.klibb.state.selected, null, { timeout: 20000 });
    await p.waitForFunction(() => !document.getElementById('full-banner').hidden, null, { timeout: 10000 }).catch(() => {});
    const banner = await p.evaluate(() => ({ hidden: document.getElementById('full-banner').hidden, text: document.getElementById('full-banner').textContent, presence: document.getElementById('presence-text').textContent }));
    check('the fifth: a clear banner says the room is full, 4 people max, and that you get in when someone leaves', !banner.hidden && /4 people max/.test(banner.text) && /when someone leaves/.test(banner.text) && /full \(4 of 4\)/.test(banner.presence), banner);
    const before = await p.evaluate(() => window.klibb.stamps.count);
    const res = await p.evaluate(() => window.klibb.stampAt(0, 0));
    await sleep(300);
    const after = await p.evaluate(() => ({ n: window.klibb.stamps.count, toast: document.getElementById('toast').textContent }));
    const srv = await (await fetch(`${S.base}/api/rooms/${R}/stamps`)).json();
    check('…cannot slap: nothing is added (here or on the server), with a toast', res === null && after.n === before && srv.stamps.length === 0 && /room is full/i.test(after.toast), { res, after, server: srv.stamps.length });
    socks[1].close();
    await p.waitForFunction(() => document.getElementById('full-banner').hidden, null, { timeout: 10000 }).catch(() => {});
    const inNow = await p.evaluate(() => ({ hidden: document.getElementById('full-banner').hidden, presence: document.getElementById('presence-text').textContent }));
    check('one of the four leaves: the browser gets in by itself (banner gone, 4 here)', inNow.hidden && /4 here/.test(inNow.presence), inNow);
    const st = await p.evaluate(() => window.klibb.stampAt(0, 0));
    await sleep(500);
    const srv2 = await (await fetch(`${S.base}/api/rooms/${R}/stamps`)).json();
    check('…and now it can slap', !!st && srv2.stamps.length === 1, { st: !!st, server: srv2.stamps.length });
    check('no page errors', errors.length === 0, errors);
  } catch (e) { fail++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  finally {
    for (const ws of socks) try { ws.close(); } catch { /* */ }
    await browser.close(); S.child.kill();
    console.log(`\nRoom limit e2e: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();

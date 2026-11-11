// E2E: the undo / peel history holds 100 (Jens, 11 Nov 2026: "expand history to 100 – it's fun to be able
// to remove them"; was 10). 14 slaps (more than the old 10) are ALL in the history and on the More panel's
// "My slaps in this room" list, the copy says 100, and Z peels them all, one by one, live and on the server.
// Own server (HISTORY100_E2E_PORT, default 8968).
const sharp = require('sharp');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startServer } = require('./demo-helpers');
const PORT = Number(process.env.HISTORY100_E2E_PORT || 8968);
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };

(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '0', ADMIN_TOKEN: 'hist-e2e-admin' });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-hist-e2e-'));
  console.log(`History 100 (${S.base})`);
  try {
    const file = path.join(tmp, 'A_dot.png');
    await sharp({ create: { width: 64, height: 64, channels: 4, background: '#33aa00' } }).png().toFile(file);
    const R = (await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()).room.id;
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 650 } });
    const p = await ctx.newPage(); const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${S.base}/?room=${R}`);
    await p.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    await p.setInputFiles('#file', file);
    await p.waitForFunction(() => window.klibb.state.selected && !window.klibb.state.selected.library, null, { timeout: 20000 });
    const onServer = async () => (await (await fetch(`${S.base}/api/rooms/${R}/stamps`)).json()).stamps.length;
    const N = 14;
    await p.evaluate(async (N) => { const k = window.klibb; k.moveTo(0, 0); k.setSize(20);
      for (let i = 0; i < N; i++) { k.look(-0.6 + (i % 7) * 0.18, -0.2 + Math.floor(i / 7) * 0.2); await k.stampAt(0, 0); } }, N);
    await p.waitForFunction(() => window.klibb.pendingSlaps() === 0, null, { timeout: 20000 }).catch(() => {});
    const st = await p.evaluate(() => ({ limit: window.klibb.peelLimit, hist: window.klibb.roomHistory().length, stored: JSON.parse(localStorage.getItem('klibb.history')).filter((h) => h.room === window.klibb.room).length,
      text: document.getElementById('history-limit').textContent, items: document.querySelectorAll('#history-list li').length }));
    check(`the history cap is 100 and the copy says so ("${st.text}")`, st.limit === 100 && /last 100 slaps/.test(st.text), st);
    check(`all ${N} slaps (more than the old 10) are in the history and on the list`, st.hist === N && st.stored === N && st.items === N && (await onServer()) === N, st);
    await p.mouse.click(500, 325); await p.waitForFunction(() => window.klibb.controls.locked, null, { timeout: 5000 }).catch(() => {});
    for (let i = 0; i < N; i++) { await p.keyboard.press('KeyZ'); await p.waitForTimeout(60); }
    await p.evaluate(() => window.klibb.peelSettled());
    const after = await p.evaluate(() => ({ hist: window.klibb.roomHistory().length, count: window.klibb.stamps.count }));
    const srv = await onServer();
    check(`Z ×${N}: every one of them peels off (removed live and on the server)`, after.hist === 0 && after.count === 0 && srv === 0, { after, srv });
    check('no page errors', !errors.length, errors);
    await ctx.close();
  } catch (e) { fail++; console.log('  ✗ crashed: ' + (e && e.stack || e)); }
  finally { await browser.close(); S.child.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(`\nHistory 100 e2e: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

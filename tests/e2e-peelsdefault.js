// E2E (short): 🧻 Peels is always ON when the page loads (Jens, 28 Oct 2026), even if it was switched
// off before (the setting lives on the server: room.peelsOn). Own server (PEELSDEFAULT_E2E_PORT, 8857).
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.PEELSDEFAULT_E2E_PORT || 8857);
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra) : '')); } };

(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '0', ADMIN_TOKEN: 'peelsdefault-admin' });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  console.log(`Peels on by default (${S.base})`);
  try {
    const { room: { id: R }, roomKey: KEY } = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const srv = async () => (await (await fetch(`${S.base}/api/rooms/${R}/stamps`)).json()).info?.peels;
    // switched off before (e.g. an earlier visit)
    await fetch(`${S.base}/api/rooms/${R}/peels`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-room-key': KEY }, body: JSON.stringify({ on: false }) });
    check('before: the room has peels off on the server', (await srv()) === false, await srv());
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
    await ctx.addInitScript(([r, k]) => localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })), [R, KEY]);
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    const load = async () => { await P.goto(`${S.base}/?room=${R}`); await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 }); await sleep(300);
      return P.evaluate(() => ({ checked: document.getElementById('peels-on').checked, on: window.klibb.peels().on })); };
    const a = await load();
    check('page load: the 🧻 Peels box is checked and peels are on (also on the server)', a.checked && a.on && (await srv()) === true, { a, srv: await srv() });
    // switch it off during the visit
    await P.evaluate(() => { const c = document.getElementById('peels-on'); c.checked = false; c.dispatchEvent(new Event('change')); });
    await sleep(800);
    const b = await P.evaluate(() => ({ checked: document.getElementById('peels-on').checked, on: window.klibb.peels().on }));
    check('it can still be switched off during the visit', !b.checked && !b.on && (await srv()) === false, { b, srv: await srv() });
    const c = await load();
    check('after a reload it is on again (checked), even though it was switched off', c.checked && c.on && (await srv()) === true, { c, srv: await srv() });
    check('no page errors', errors.length === 0, errors);
    await ctx.close();
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  finally {
    await browser.close(); S.child.kill();
    console.log(`\nPeels default e2e: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();

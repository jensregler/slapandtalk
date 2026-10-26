// E2E (short): "✨ Clear hidden stickers" in the Room ▾ menu. Own server (port 8839, normal app).
// The creator sees the button, gets a calm confirm with the count, and the hidden sticker goes for
// everyone while the visible ones (and the picture) stay. A visitor without the room key never sees it.
const sharp = require('sharp');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };

(async () => {
  const S = await startServer(8839, { DEMO_PROFILE: '0', ADMIN_TOKEN: 'clear-e2e-admin' });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  console.log(`Clear hidden stickers (${S.base})`);
  try {
    const solid = async (hex) => sharp({ create: { width: 64, height: 64, channels: 4, background: hex } }).png().toBuffer();
    const upload = async (buf) => { const fd = new FormData(); fd.append('file', new Blob([buf], { type: 'image/png' }), 'k.png'); return (await fetch(`${S.base}/api/stickers`, { method: 'POST', body: fd })).json(); };
    const red = await upload(await solid('#ff0000')), blue = await upload(await solid('#0000ff'));
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const R = made.room.id;
    const post = (img, x, y, size) => fetch(`${S.base}/api/rooms/${R}/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId: img.id, position: [x, y, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size, rotation: 0, surface: 'vägg-norr', owner: 'e2eOwnerAAAA' }) }).then((r) => r.json());
    const ready = (p) => p.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    const open = async (key) => {
      const ctx = await browser.newContext({ viewport: { width: 800, height: 500 } });
      if (key) await ctx.addInitScript(([room, k]) => localStorage.setItem('klibb.roomKeys', JSON.stringify({ [room]: k })), [R, key]);
      const p = await ctx.newPage(); const errors = []; p.on('pageerror', (e) => errors.push(e.message));
      await p.goto(`${S.base}/?room=${R}`); await ready(p);
      return { ctx, p, errors };
    };
    const A = await open(made.roomKey), B = await open(null);
    const y = await A.p.evaluate(() => { const k = window.klibb; k.moveTo(0, 0); k.look(0, 0); return k.camera.position.y; });
    const under = await post(red, 0, y, 0.3), cover = await post(blue, 0, y, 0.9), side = await post(red, 1.2, y, 0.4);
    for (const P of [A.p, B.p]) await P.waitForFunction(() => window.klibb.stamps.count === 3, null, { timeout: 30000 });
    const centre = async () => { const b = await A.p.screenshot({ clip: { x: 398, y: 248, width: 4, height: 4 } }); const s = await sharp(b).stats(); return s.channels.slice(0, 3).map((c) => Math.round(c.mean)); };
    const before = await centre();
    const vis = await Promise.all([A.p, B.p].map((P) => P.evaluate(() => !document.getElementById('clear-hidden').hidden)));
    check('the button is there for the creator, not for a visitor', vis[0] === true && vis[1] === false, vis);
    await A.p.click('#room-menu-btn'); await A.p.click('#clear-hidden'); // Room ▾ → ✨ Clear hidden stickers
    await A.p.waitForFunction(() => /Remove 1 hidden sticker\?/.test(document.getElementById('clear-q').textContent), null, { timeout: 15000 });
    const dlg = await A.p.evaluate(() => ({ open: document.getElementById('clear-dialog').open, q: document.getElementById('clear-q').textContent, text: document.getElementById('clear-text').textContent }));
    check('a calm confirm with the count', dlg.open && dlg.q === 'Remove 1 hidden sticker? Visible ones stay.' && /new base layer/.test(dlg.text), dlg);
    await A.p.screenshot({ path: 'screenshots/80-clear-hidden-confirm.png' });
    await A.p.click('#clear-go');
    for (const P of [A.p, B.p]) await P.waitForFunction(() => window.klibb.stamps.count === 2, null, { timeout: 15000 });
    const ids = await B.p.evaluate(() => [...window.klibb.stamps.meshes.keys()]);
    check('the hidden one is gone for everyone; the visible ones stay', !ids.includes(under.stamp.id) && ids.includes(cover.stamp.id) && ids.includes(side.stamp.id), ids);
    check('the dialog closed', !(await A.p.evaluate(() => document.getElementById('clear-dialog').open)));
    await sleep(400);
    const after = await centre();
    check('the picture is the same (blue on top before and after)', before[2] > 120 && after[2] > 120 && before[0] < 90 && after[0] < 90, { before, after });
    const left = (await (await fetch(`${S.base}/api/rooms/${R}/stamps`)).json()).stamps.map((s) => s.id);
    check('the server keeps the two visible ones', left.length === 2 && left[0] === cover.stamp.id && left[1] === side.stamp.id, left);
    check('no page errors', !A.errors.length && !B.errors.length, [...A.errors, ...B.errors]);
    await A.ctx.close(); await B.ctx.close();
  } catch (e) { fail++; console.log('  ✗ crashed: ' + (e && e.stack || e)); }
  finally { await browser.close(); S.child.kill(); }
  console.log(`\nClear e2e: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

// E2E: peels in the city's outside (Jens, Nov 2026). Always on; slap a building wall → paper
// flies out along the normal, lives ~6 s, then fades. Own server (CITYPEELS_E2E_PORT, 8996).
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.CITYPEELS_E2E_PORT || 8996);
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 500) : '')); } };
const ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const browser = await chromium.launch({ args: ARGS });
  const errors = [];
  console.log(`City peels e2e (${S.base})`);
  try {
    const lib = (await (await fetch(`${S.base}/api/library`)).json()).stickers.filter((d) => !d.nature);
    const plain = lib.slice(0, 3);
    const pac = { name: 'Peel pack', stickers: plain.map((d) => d.id), urls: plain.map((d) => d.url), designs: plain.map((d) => ({ id: d.id, url: d.url, width: d.width, height: d.height })), at: new Date().toISOString() };
    const look = JSON.stringify({ name: 'Jens', look: { outfit: 'casual', hair: 'short', shirt: '#3a7bd5', pants: '#333333', hairColor: '#3b2a1a', skin: '#e0b48c', hat: false, hatColor: '#d33', insta: '' } });
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    await ctx.addInitScript(([p, l]) => { localStorage.setItem('klibb.pac', p); localStorage.setItem('klibb.avatar', l); localStorage.setItem('klibb.devUnlock', '1'); }, [JSON.stringify(pac), look]);
    const P = await ctx.newPage();
    P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=stad-byggen`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected, null, { timeout: 60000 });
    await sleep(800);
    const info = await P.evaluate(() => ({ peelsOn: window.klibb.peels().on, city: window.klibb.city() }));
    check('city outside: peels are on at load (no admin toggle)', info.peelsOn === true && info.city.outside === true, info);

    // Face the Town Hall's south wall (same pose as e2e-citynature: z=20, pitch up).
    await P.evaluate((id) => {
      const k = window.klibb;
      const d = (k.state.library || []).find((x) => x.id === id);
      if (d && !d.nature) k.selectDesign(d);
      k.setView('first', { quiet: true });
      k.controls.ground = null; k.controls.collide = null;
      k.camera.position.set(0, 1.6, 20);
      k.controls.yaw = 0; k.controls.pitch = 0.66; k.controls.apply();
      k.setMode?.('slap'); k.controls.locked = true; k.setSize(40);
    }, plain[0].id);
    await sleep(500);
    const before = await P.evaluate(() => window.klibb.peels().count);
    const slap = await P.evaluate(() => window.klibb.stampAt(0, 0).then((s) => s && { id: s.id, surface: s.surface, p: s.position }));
    await P.evaluate(() => { window.klibb.controls.locked = false; });
    await P.waitForFunction((n) => window.klibb.peels().count > n, before, { timeout: 8000 });
    const mid = await P.evaluate(() => {
      const info = window.klibb.peels();
      const id = info.peels[info.peels.length - 1]?.id;
      const pose = id ? window.klibb.peelPose(id) : null;
      return { count: info.count, on: info.on, peel: info.peels.at(-1), pose, slapAt: null };
    });
    check('slap in the city: a peel appears', mid.count > before && mid.on, { before, mid, slap });
    check('peel lands out in front of the wall (z > slap z, not inside the hall)',
      mid.peel && slap && mid.peel.z > slap.p[2] + 0.3, { peel: mid.peel, slap });

    // Lifetime ~6 s: wait for client expiry (lifeMs + a little).
    await P.waitForFunction(() => window.klibb.peels().count === 0, null, { timeout: 12000 });
    const after = await P.evaluate(() => window.klibb.peels());
    check('after ~6 s the peel is gone (client lifeMs)', after.count === 0, after);

    const srv = await (await fetch(`${S.base}/api/rooms/stad-byggen/stamps`)).json();
    check('server: peels flag is on; expired peels not in snapshot', srv.info?.peels === true && !(srv.peels || []).some((p) => p.id === slap?.id), { peels: srv.info?.peels, n: (srv.peels || []).length });
    check('no page errors', errors.length === 0, errors);
    await ctx.close();
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  finally {
    await browser.close(); S.child.kill();
    console.log(`\nCity peels e2e: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();

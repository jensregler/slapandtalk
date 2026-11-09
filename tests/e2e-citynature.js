// The build phase in the city (Jens, t492u + t493u, 3 Nov 2026): screenshots to CITYNATURE_SHOTS
// (/workspace/citynature-shots) + checks. The Nature wheel in the build city's outside and in a house
// (V = Nature mode), a 20 m nature sticker outside (24 m allowed there), 6 m in a house; the build city
// saves itself into the default city preset; a new city starts with that preset; the city is emptied
// (deleted) and started again → the tree is there again. Own server (CITYNATURE_E2E_PORT, 8994).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.CITYNATURE_E2E_PORT || 8994);
const SHOTS = process.env.CITYNATURE_SHOTS || '/workspace/citynature-shots';
const ADM = 'demo-e2e-admin';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 900) : '')); } };
const ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1', EMPTY_CITY_GRACE_SECONDS: '2', EMPTY_ROOM_GRACE_SECONDS: '1' });
  const browser = await chromium.launch({ args: ARGS });
  const errors = [];
  const shot = (P, name) => P.screenshot({ path: path.join(SHOTS, name) });
  const api = async (m, u, b, adm) => { const r = await fetch(S.base + u, { method: m, headers: { 'Content-Type': 'application/json', ...(adm ? { 'x-admin-token': ADM } : {}) }, ...(b ? { body: JSON.stringify(b) } : {}) }); return r.json().catch(() => ({})); };
  try {
    const lib = (await api('GET', '/api/library')).stickers;
    const plain = lib.filter((d) => !d.nature).slice(10, 13);
    const pac = { name: 'Jens pack', stickers: plain.map((d) => d.id), urls: plain.map((d) => d.url), designs: plain.map((d) => ({ id: d.id, url: d.url, width: d.width, height: d.height })), at: new Date().toISOString() };
    const look = JSON.stringify({ name: 'Jens', look: { outfit: 'casual', hair: 'short', shirt: '#3a7bd5', pants: '#333333', hairColor: '#3b2a1a', skin: '#e0b48c', hat: false, hatColor: '#d33', insta: 'jensregler' } });
    const newCtx = async () => { const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }); await ctx.addInitScript(([p, l]) => { localStorage.setItem('klibb.pac', p); localStorage.setItem('klibb.avatar', l); localStorage.setItem('klibb.devUnlock', '1'); }, [JSON.stringify(pac), look]); return ctx; };
    const open = async (ctx, room) => { const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(room + ': ' + e.message)); await P.goto(`${S.base}/?room=${room}`); await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected, null, { timeout: 60000 }); await sleep(1500); return P; };
    const pose = (Q, x, y, z, yaw, pitch) => Q.evaluate(([x, y, z, yaw, pitch]) => { const k = window.klibb; k.controls.ground = null; k.controls.collide = null; k.camera.position.set(x, y, z); k.controls.yaw = yaw; k.controls.pitch = pitch; k.controls.apply(); }, [x, y, z, yaw, pitch]);
    const natState = (P) => P.evaluate(() => ({ open: window.klibb.natureOpen(), strip: window.klibb.natureStrip(), two: document.body.classList.contains('two-wheels'), build: document.body.classList.contains('city-build'), city: window.klibb.city().wheel, act: window.klibb.activeWheel() }));

    // ---- the build city's outside
    const ctx = await newCtx();
    let P = await open(ctx, 'stad-byggen');
    let n = await natState(P);
    check('build city outside: the Nature wheel is shown and open (two wheels), sticker wheel is the full deck', n.open && n.strip.shown && !n.strip.locked && n.strip.n > 0 && n.two && n.build && n.city.length > 20, n);
    await P.evaluate(() => window.klibb.setView('first', { quiet: true }));
    // the desktop starts in Look mode: V = back to Slap mode, V again = Nature mode
    for (let i = 0; i < 2 && (await P.evaluate(() => window.klibb.activeWheel())) !== 'nature'; i++) { await P.keyboard.press('v'); await sleep(500); }
    n = await natState(P);
    check('V: Nature mode – a nature sticker in hand', n.act === 'nature' && await P.evaluate(() => !!window.klibb.state.selected.nature), n);
    await shot(P, '01-build-city-outside-nature-wheel.png');
    // a 20 m nature sticker on the Town Hall's south wall (24 m high), aimed 11 m up
    await pose(P, 0, 1.6, 20, 0, 0.66); await sleep(300);
    await P.evaluate(() => { const k = window.klibb; k.setMode?.('slap'); k.controls.locked = true; k.setSize(2000); });
    const st = await P.evaluate(() => window.klibb.stampAt(0, 0).then((s) => s && { size: s.size, imageId: s.imageId, id: s.id }));
    await P.evaluate(() => { window.klibb.controls.locked = false; }); await sleep(800);
    const sel = await P.evaluate(() => window.klibb.state.selected);
    const want = Math.min(20, 24 * Math.max(1, sel.width / sel.height));
    check(`a 20 m nature sticker outside (asked 20 m → ${st && st.size} m)`, st && st.imageId === sel.id && Math.abs(st.size - want) < 0.02, { st, want });
    await pose(P, 17, 6, 30, 0.62, 0.12); await sleep(1200);
    await shot(P, '02-build-city-20m-nature-sticker.png');

    // ---- a house in the build city
    const h = await api('POST', '/api/cities/stad-byggen/houses');
    const H = await open(ctx, h.id);
    n = await natState(H);
    check(`build city house ${h.n}: the Nature wheel is there too`, h.id === 'stad-byggen-1' && n.open && n.strip.shown && n.two, n);
    await H.evaluate(() => window.klibb.setView('first', { quiet: true }));
    for (let i = 0; i < 2 && (await H.evaluate(() => window.klibb.activeWheel())) !== 'nature'; i++) { await H.keyboard.press('v'); await sleep(400); }
    await H.evaluate(() => { const k = window.klibb; k.moveTo(0, 6); k.look(0, 0.1); k.setMode?.('slap'); k.controls.locked = true; k.setSize(600); });
    const hs = await H.evaluate(() => window.klibb.stampAt(0, 0).then((s) => s && { size: s.size }));
    await H.evaluate(() => { window.klibb.controls.locked = false; }); await sleep(900);
    check(`…a 6 m nature sticker on the house's wall (${hs && hs.size} m)`, hs && hs.size > 4, hs);
    await shot(H, '03-build-city-house-nature.png');
    await H.close(); await P.close();

    // ---- the default city preset saves itself
    await sleep(3500);
    let pre = await api('GET', '/api/admin/citypresets', null, true);
    const d = pre.presets && pre.presets.find((p) => p.default);
    check('the build city was saved into the default city preset by itself', d && d.stickers.outside === 1 && d.stickers['1'] === 1, pre);

    // ---- a new city: the tree is there; empty it (deleted) and start one again
    const c1 = (await api('POST', '/api/cities', { name: 'Slapville' })).city.id;
    const ctx2 = await newCtx();
    let Q = await open(ctx2, c1);
    const st1 = (await api('GET', `/api/rooms/${c1}/stamps`)).stamps;
    n = await natState(Q);
    check('a new city starts with the preset: the 20 m tree, and the Nature wheel there too (build phase)', st1.length === 1 && Math.abs(st1[0].size - want) < 0.02 && n.strip.shown, { st1, n });
    await pose(Q, 17, 6, 30, 0.62, 0.12); await sleep(1200);
    await shot(Q, '04-new-city-has-the-tree.png');
    await Q.close(); await ctx2.close();
    let gone = false;
    for (let i = 0; i < 30 && !gone; i++) { await sleep(500); gone = !(await api('GET', '/api/cities')).cities.some((c) => c.id === c1); }
    check('everyone left: the city is deleted', gone);
    const c2 = (await api('POST', '/api/cities', { name: 'Slapville again' })).city.id;
    const ctx3 = await newCtx();
    Q = await open(ctx3, c2);
    const st2 = (await api('GET', `/api/rooms/${c2}/stamps`)).stamps;
    check('a city started again: the tree is still there (the preset survived the city)', c2 !== c1 && st2.length === 1 && st2[0].imageId === st.imageId, st2);
    await pose(Q, 17, 6, 30, 0.62, 0.12); await sleep(1200);
    await shot(Q, '05-city-recreated-tree-still-there.png');
    const hh = await api('POST', `/api/cities/${c2}/houses`);
    const Q2 = await open(ctx3, hh.id);
    check('…its house 1 gets the preset\'s house 1 (the 6 m nature sticker)', (await api('GET', `/api/rooms/${hh.id}/stamps`)).stamps.length === 1);
    await Q2.evaluate(() => { window.klibb.setView('first', { quiet: true }); window.klibb.moveTo(0, 6); window.klibb.look(0, 0.1); }); await sleep(900);
    await shot(Q2, '06-recreated-city-house-1.png');
    await ctx3.close(); await ctx.close();
    check('no page errors', !errors.length, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e && e.stack)); }
  await browser.close(); S.child.kill();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

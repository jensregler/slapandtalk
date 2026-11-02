// The City (t476u, 2 Nov 2026): screenshots to CITY_SHOTS (/workspace/city-shots) + checks.
// A room → the door → 3 slaps in a pack → "to city"; two other people's packs in the Town Hall;
// overview, a plot, the Town Hall outside, the hand-in / swap counter, the reduced wheel, a house
// inside, and the phone. Own server (CITY_E2E_PORT, 8992).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.CITY_E2E_PORT || 8992);
const SHOTS = process.env.CITY_SHOTS || '/workspace/city-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };
const ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1', ...(process.env.CITY_DATA_DIR ? { DATA_DIR: process.env.CITY_DATA_DIR } : {}) });
  const browser = await chromium.launch({ args: ARGS });
  const errors = [];
  const shot = (P, name) => P.screenshot({ path: path.join(SHOTS, name) });
  try {
    // two other people hand in packs (straight to the API; a picture made from the bag)
    const lib = (await (await fetch(`${S.base}/api/library`)).json()).stickers.filter((d) => !d.nature);
    const bag = fs.readFileSync(path.join(__dirname, '../client/public/start/pac.webp'));
    const sharp = require('sharp');
    // a pack picture like the door makes: the 3 stickers in the pouch, the bag over them
    async function packPicture(stk) {
      const spots = [[60, 300], [270, 320], [150, 520]], layers = [];
      for (let k = 0; k < 3; k++) {
        const buf = Buffer.from(await (await fetch(S.base + stk[k].url)).arrayBuffer());
        layers.push({ input: await sharp(buf).resize(210, 210, { fit: 'inside' }).png().toBuffer(), left: spots[k][0], top: spots[k][1] });
      }
      return sharp({ create: { width: 563, height: 802, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([...layers, { input: bag, left: 0, top: 0 }]).webp().toBuffer();
    }
    const others = [];
    for (const [name, k] of [['Malmö crew', 20], ['Göteborg 🌊', 40]]) {
      const fd = new FormData(); fd.append('name', name); fd.append('stickers', JSON.stringify(lib.slice(k, k + 3).map((d) => d.id))); fd.append('img', new Blob([await packPicture(lib.slice(k, k + 3))], { type: 'image/webp' }), 'p.webp');
      const r = await (await fetch(`${S.base}/api/city/packs`, { method: 'POST', body: fd })).json(); others.push(r);
    }
    check('two packs handed in by others (token, a week)', others.every((o) => o.token && o.pack && Date.parse(o.pack.expiresAt) - Date.parse(o.pack.createdAt) === 7 * 864e5), others.map((o) => o.error || o.pack.id));
    const listAnon = await (await fetch(`${S.base}/api/city/packs`)).json();
    check('…GET lists them, no "mine" without a token', listAnon.packs.length === 2 && listAnon.mine === null);
    const t0 = await fetch(`${S.base}/api/city/packs/${others[0].pack.id}/take`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    check('…taking a pack without handing one in: 403', t0.status === 403);

    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: false }) })).json();
    const R = made.room.id;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await ctx.addInitScript(([r, k]) => localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })), [R, made.roomKey]);
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${R}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected, null, { timeout: 60000 });
    await sleep(800);
    await P.evaluate(() => window.klibb.menuAction('door')); await sleep(300);
    await P.click('#menu-choice-list [data-id="enter-city"]'); await sleep(600);
    const ids = await P.evaluate(() => [...document.querySelectorAll('#df-grid .df-g')].slice(4, 7).map((b) => b.dataset.id));
    for (const id of ids) await P.click(`#df-grid .df-g[data-id="${id}"]`);
    await P.click('#df-next'); await sleep(900);
    await P.fill('#df-name', 'Jens pack');
    await Promise.all([P.waitForURL(/room=stad/, { timeout: 20000 }), P.click('#df-city')]);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
    await sleep(2500);
    let c = await P.evaluate(() => window.klibb.city());
    check('"to city" → the City (outside, 9 doors)', c.outside && c.inCity && c.doors === 9, c);
    check('the reduced wheel: my 3 stickers + exit + my pack, nothing else', c.wheel.length === 5 && ids.every((id) => c.wheel.includes(id)) && c.wheel.includes('a03b0ba5768979e6') && c.wheel.includes('city-pack'), c.wheel);
    check('…holding my first sticker', await P.evaluate((id) => window.klibb.state.selected?.id === id, ids[0]));
    // 1. overview from high up in the south-west corner
    const pose = (x, y, z, yaw, pitch) => P.evaluate(([x, y, z, yaw, pitch]) => { const k = window.klibb; k.controls.ground = null; k.controls.collide = null; k.camera.position.set(x, y, z); k.controls.yaw = yaw; k.controls.pitch = pitch; k.controls.apply(); }, [x, y, z, yaw, pitch]);
    await P.evaluate(() => window.klibb.setView('first', { quiet: true }));
    await pose(-46, 22.5, 46, -Math.PI / 4, -0.42); await sleep(900);
    await shot(P, '01-city-overview.png');
    await pose(46, 22.5, -46, (3 * Math.PI) / 4, -0.42); await sleep(700);
    await shot(P, '01b-city-overview-from-north-east.png');
    // 2. a plot: house 6 (south-west) from its corner
    await pose(-17.5, 6, 47, -0.55, -0.22); await sleep(700);
    await shot(P, '02-plot-house-6.png');
    // 3. the Town Hall from the square in front of it
    await pose(16, 2.1, 46, 0.35, 0.22); await sleep(700);
    await shot(P, '03-town-hall-exterior.png');
    // walk-up: standing at the Town Hall door opens it
    await P.evaluate(() => { const k = window.klibb; k.controls.ground = (x, z) => (Math.abs(x) <= 15.6 && Math.abs(z) <= 15.6 ? 0.5 : 0); k.camera.position.set(0, 2.1, 12); k.controls.yaw = 0; k.controls.pitch = 0; k.controls.apply(); });
    await sleep(300);
    await P.evaluate(() => { window.klibb.camera.position.set(0, 2.1, 8.9); }); await sleep(900);
    c = await P.evaluate(() => window.klibb.city());
    check('walking up to the Town Hall door opens the Town Hall', c.hall.open && c.atDoor === 'hall', c);
    await P.waitForFunction(() => window.klibb.city().hall.packs !== null, null, { timeout: 10000 }); await sleep(800);
    await shot(P, '04a-town-hall-inside-before-hand-in.png');
    await P.click('#th-handin'); await P.waitForFunction(() => window.klibb.city().hall.mine, null, { timeout: 15000 }); await sleep(900);
    c = await P.evaluate(() => window.klibb.city());
    check('hand in my pack → in the Town Hall for a week', c.hall.mine && c.hall.mine.left === 2 && Math.abs(Date.parse(c.hall.mine.expiresAt) - Date.now() - 7 * 864e5) < 120000, c.hall);
    await P.click(`.th-pack[data-id="${others[0].pack.id}"] .th-take`); await P.waitForFunction(() => window.klibb.city().taken.length === 1, null, { timeout: 10000 }); await sleep(900);
    await shot(P, '04-town-hall-hand-in-and-swap.png');
    await P.click(`.th-pack[data-id="${others[1].pack.id}"] .th-take`); await P.waitForFunction(() => window.klibb.city().taken.length === 2, null, { timeout: 10000 }); await sleep(900);
    c = await P.evaluate(() => window.klibb.city());
    check('take 2 packs from others → 3 packs, 9 stickers (+ exit + pack) on the wheel', c.taken.length === 2 && c.wheel.length === 11, c);
    const tok = await P.evaluate(() => JSON.parse(localStorage.getItem('klibb.packToken')));
    const own = await P.evaluate(() => window.klibb.city().hall.mine.id);
    const third = await fetch(`${S.base}/api/city/packs/${others[0].pack.id}/take`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-pack-token': tok }, body: '{}' });
    const fd = new FormData(); fd.append('name', 'x'); fd.append('stickers', JSON.stringify(lib.slice(60, 63).map((d) => d.id))); fd.append('img', new Blob([bag], { type: 'image/webp' }), 'p.webp');
    const more = await (await fetch(`${S.base}/api/city/packs`, { method: 'POST', body: fd })).json();
    const over = await fetch(`${S.base}/api/city/packs/${more.pack.id}/take`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-pack-token': tok }, body: '{}' });
    const again = await fetch(`${S.base}/api/city/packs`, { method: 'POST', headers: { 'x-pack-token': tok }, body: fd });
    const ownTake = await fetch(`${S.base}/api/city/packs/${own}/take`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-pack-token': others[0].token }, body: '{}' });
    check('server: a third take is refused (409), a second hand-in in the same week too (409); taking twice the same is a no-op', over.status === 409 && again.status === 409 && third.status === 200, [over.status, again.status, third.status]);
    check('…someone else may take MY pack (it stays in the hall)', ownTake.status === 200);
    await P.click('#th-back'); await sleep(500);
    // 5. the reduced wheel (desktop strip), standing on the square
    await P.evaluate(() => { const k = window.klibb; k.camera.position.set(-6, 2.1, 18); k.controls.yaw = -0.35; k.controls.pitch = 0.12; k.controls.apply(); }); await sleep(900);
    await shot(P, '05-reduced-wheel.png');
    await P.locator('#design-strip').screenshot({ path: path.join(SHOTS, '05b-reduced-wheel-strip.png') }).catch(() => {});
    // a slap in the city lands (on the Town Hall's wall)
    const before = await P.evaluate(() => window.klibb.state.stamps?.length ?? null);
    await P.evaluate(async () => { const k = window.klibb; k.camera.position.set(0, 2.1, 12); k.controls.yaw = 0; k.controls.pitch = 0.15; k.controls.apply(); k.controls.locked = true; await k.stampAt(0.3, 0.2); k.controls.locked = false; });
    await sleep(1500);
    const cityRoom = await (await fetch(`${S.base}/api/rooms/stad/stamps`)).json();
    const st = (cityRoom.stamps || [])[0];
    check('a slap in the city sticks to a city surface (the Town Hall\'s south wall)', st && st.surface === 'hall-s', st && st.surface);
    await shot(P, '06-slapped-on-town-hall.png');
    // the exit button in the city: Back to my room / Exit to menu
    await P.evaluate(() => window.klibb.selectDesign(window.klibb.stickerDesigns().find((d) => d.id === 'a03b0ba5768979e6'))); await sleep(300);
    await P.evaluate(async () => { const k = window.klibb; k.controls.locked = true; await k.stampAt(0, 0); k.controls.locked = false; }); await sleep(400);
    const ex = await P.evaluate(() => [...document.querySelectorAll('#menu-choice-list button')].map((b) => b.dataset.id));
    check('the exit button opens the exit menu (Back to my room, Exit to menu)', JSON.stringify(ex) === JSON.stringify(['to-room', 'exit-menu', 'back']), ex);
    await shot(P, '07-city-exit-menu.png');
    await P.click('#menu-choice-list [data-id="back"]');
    // 8. into a house (house 2: north-middle) and inside it
    await Promise.all([P.waitForURL(/room=stad-2/, { timeout: 20000 }), P.evaluate(() => { window.klibb.cityDoor('stad-2'); document.querySelector('#menu-choice-list [data-id="enter-house"]').click(); })]);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 }); await sleep(2500);
    c = await P.evaluate(() => window.klibb.city());
    const plot = await (await fetch(`${S.base}/api/rooms/stad-2`)).json();
    check('house 2 is a real room (type stad, never swept), same reduced wheel', plot.room && plot.room.type === 'stad' && c.inCity && !c.outside && c.wheel.length === 11, { type: plot.room && plot.room.type, c });
    await shot(P, '08-inside-house-2.png');
    await P.evaluate(() => window.klibb.menuAction('exit')); await sleep(300);
    const ex2 = await P.evaluate(() => [...document.querySelectorAll('#menu-choice-list button')].map((b) => b.dataset.id));
    check('…its exit menu: Back to the City first', ex2[0] === 'to-city', ex2);
    await Promise.all([P.waitForURL(/room=stad&at=stad-2/, { timeout: 20000 }), P.click('#menu-choice-list [data-id="to-city"]')]);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 }); await sleep(1500);
    const pos = await P.evaluate(() => window.klibb.camera.position.toArray());
    check('…back outside, in front of house 2\'s door', Math.abs(pos[2] - (-32 + 8 + 2.4)) < 0.6 && Math.abs(pos[0]) < 1.2, pos);
    // walls: you can't walk into a house
    await P.evaluate(() => { const k = window.klibb; k.camera.position.set(0, 2.1, -20); k.controls.yaw = 0; k.controls.apply(); k.controls.keys.add('KeyW'); });
    await sleep(2500); await P.evaluate(() => window.klibb.controls.keys.delete('KeyW'));
    const z = await P.evaluate(() => window.klibb.camera.position.z);
    check('walking north into house 2 stops at its wall', z > -24 + 0.3 - 0.01 && z < -23, z);
    const pac = await P.evaluate(() => localStorage.getItem('klibb.pac')).catch(() => null);
    await ctx.close();

    // 9. the phone
    const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const Q = await ph.newPage(); Q.on('pageerror', (e) => errors.push(e.message));
    await Q.goto(`${S.base}/?room=stad`);
    await Q.evaluate((p) => { if (p) localStorage.setItem('klibb.pac', p); }, pac);
    await Q.reload(); await Q.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 }); await sleep(2500);
    await Q.evaluate(() => { const k = window.klibb; k.camera.position.set(16, 2.1, 46); k.controls.yaw = 0.35; k.controls.pitch = 0.2; k.controls.apply(); }); await sleep(900);
    await Q.screenshot({ path: path.join(SHOTS, '09-phone-city.png') });
    const qc = await Q.evaluate(() => window.klibb.city());
    check('phone: the city with the reduced stack (my 3 + exit + pack)', qc.outside && qc.wheel.length === 5, qc);
    await Q.evaluate(() => window.klibb.openHall()); await Q.waitForFunction(() => window.klibb.city().hall.packs !== null, null, { timeout: 10000 }); await sleep(900);
    await Q.screenshot({ path: path.join(SHOTS, '10-phone-town-hall.png') });
    const fit = await Q.evaluate(() => { const r = document.querySelector('#townhall .th-panel').getBoundingClientRect(); const b = document.querySelector('#th-handin').getBoundingClientRect(); return { w: r.width, bh: b.height }; });
    check('phone: the Town Hall fills the screen, buttons ≥ 44 px high', fit.w <= 390 && fit.bh >= 44, fit);
    await ph.close();
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await browser.close(); S.child.kill();
  console.log(`\nCity e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

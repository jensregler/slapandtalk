// E2E: own image per surface (Jens, 30 Oct 2026): in the room look panel ('＋ New quick room' → Create
// room, and 🎨 Change look) the floor, the walls and the ceiling each have their own "🖼 Own image…"
// option: upload a picture (the Färg / avatar-fabric upload) and it becomes that surface, with every
// fabric control (scale, rotation, hue, cycle hue, spin, scroll, colour under transparent parts,
// 🌀 Randomize). Stored in the room look (style.surfFabric): the others (live), the recording, a
// preset made from the room see it. A surface's own image wins over Färg; Färg covers the others.
// Picking a catalogue material for a surface takes its own image away. Full version (fabrics) like
// Färg; the server drops it for the free version. Own servers (SURF_E2E_PORT, default 8906, and +1).
// Screenshots → SURF_SHOTS (default /workspace/surf-shots).
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.SURF_E2E_PORT || 8906);
const SHOTS = process.env.SURF_SHOTS || '/workspace/surf-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 900) : '')); } };
const WALLS = ['vägg-norr', 'vägg-söder', 'vägg-väster', 'vägg-öster'];
let ipN = 0;
const post = (S, p, body, headers = {}) => fetch(`${S.base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.9.${++ipN}.3`, ...headers }, body: JSON.stringify(body) }).then((r) => r.json());
const stripes = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#ffffff"/><g fill="${fill}">
  <polygon points="0,0 64,0 256,192 256,256 192,256 0,64"/><polygon points="160,0 256,0 256,96"/><polygon points="0,160 0,256 96,256"/></g></svg>`;
const IS = {
  red: (r, g, b) => r > 170 && g < 90 && b < 90,
  green: (r, g, b) => g > 140 && r < 100 && b < 100,
  blue: (r, g, b) => b > 160 && r < 90 && g < 120,
  magenta: (r, g, b) => r > 150 && b > 150 && g < 110 && Math.abs(r - b) < 90,
};
async function share(file, pred) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  let hit = 0; const n = info.width * info.height;
  for (let i = 0; i < n; i++) { const o = i * info.channels; if (pred(data[o], data[o + 1], data[o + 2])) hit++; }
  return hit / n;
}
async function page(browser, S, url, { dev = false, admin = null, scale = 1 } = {}, errors = []) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: scale });
  await ctx.addInitScript(([dev, admin]) => {
    if (admin) sessionStorage.setItem('klibb.admin', admin);
    if (sessionStorage.getItem('init')) return; sessionStorage.setItem('init', '1');
    localStorage.setItem('klibb.avatar', JSON.stringify({ name: dev ? 'Full' : 'Fri', look: { outfit: 'tshirt', hair: 'kort', shirt: '#3a86ff', pants: '#2b4c7e', hairColor: '#4a2c17', skin: '#e0ac69', hat: false, hatColor: '#e63946' } }));
    if (dev) localStorage.setItem('klibb.devUnlock', '1');
  }, [dev, admin]);
  const P = await ctx.newPage(); P.setDefaultTimeout(90000); P.on('pageerror', (e) => errors.push(e.message));
  await P.goto(url);
  return P;
}
const ready = (P) => P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 90000 }).then(() => P.evaluate(() => window.klibb.entitlementsReady()));
const info = (P) => P.evaluate(() => ({ draft: window.klibb.styleDraft(), cur: window.klibb.currentStyle(), fab: window.klibb.roomFabric(),
  boxes: ['floor', 'wall', 'ceiling'].map((k) => { const b = document.getElementById('own-' + k); return { k, shown: !b.hidden, open: !!b.querySelector('.farg-open'), sliders: [...b.querySelectorAll('.fab-sl')].map((r) => r.dataset.param), wild: !!b.querySelector('.farg-wild'), base: b.querySelectorAll('.farg-base button').length }; }),
  sel: { floor: !!document.querySelector('#sw-floor button.sel'), wall: !!document.querySelector('#sw-wall button.sel'), ceiling: !!document.querySelector('#sw-ceiling button.sel') } }));
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const setRange = (P, kind, param, v) => P.evaluate(([k, p, v]) => { const r = document.querySelector(`#own-${k} .fab-sl[data-param="${p}"] input[type=range]`); r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); }, [kind, param, v]);
const setFlag = (P, kind, flag, on = true) => P.evaluate(([k, f, on]) => { const c = document.querySelector(`#own-${k} input[data-flag="${f}"]`); c.checked = on; c.dispatchEvent(new Event('change', { bubbles: true })); }, [kind, flag, on]);
async function upload(P, kind, file) {
  await P.click(`#own-${kind} .farg-open`);
  await P.setInputFiles(`#own-${kind}-file`, file);
  await P.waitForFunction((k) => window.klibb.styleDraft()?.surfFabric?.[k]?.id && window.klibb.roomFabric().loaded, kind, { timeout: 45000 });
}
const view = (P, x = 0, z = 2.5, yaw = 0, pitch = 0.05) => P.evaluate(([x, z, yaw, pitch]) => { const k = window.klibb; k.moveTo(x, z); k.look(yaw, pitch); }, [x, z, yaw, pitch]);

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const img = {};
  for (const [c, fill] of [['red', '#ff1a1a'], ['green', '#18c818'], ['blue', '#1a3cff'], ['magenta', '#ff00ff']]) {
    img[c] = path.join(os.tmpdir(), `e2e-surf-${c}.png`); await sharp(Buffer.from(stripes(fill))).png().toFile(img[c]);
  }
  const browser = await chromium.launch({ args: GL });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '0' });
  const O = await startServer(PORT + 1, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const errors = [];
  try {
    const start = await post(S, '/api/rooms', { preset: false });
    const A = await page(browser, S, `${S.base}/?room=${start.room.id}`, { dev: true, scale: 2 }, errors); // (sharp, big screenshots for Jens)
    await ready(A);
    await view(A);
    await A.evaluate(() => window.klibb.openStylePanel('create'));
    await A.waitForSelector('#style-panel:not([hidden])'); await sleep(700);
    const i0 = await info(A);
    check('Create room panel: floor, walls and ceiling each have a big "🖼 Own image…" button (full version)', i0.boxes.every((b) => b.shown && b.open) && !i0.draft.surfFabric, i0.boxes);
    await A.screenshot({ path: path.join(SHOTS, '1-panel-own-image-buttons.png') });
    await A.locator('#style-panel').screenshot({ path: path.join(SHOTS, '1b-panel-closeup.png') });
    // ---- floor: red, rotation 30, scale 2
    await upload(A, 'floor', img.red); await sleep(400);
    const i1 = await info(A);
    check('floor: upload → the floor (only) gets the image, live', i1.fab.own.golv === i1.draft.surfFabric.floor.id && i1.fab.on.join() === 'golv', i1.fab);
    check('…with every fabric control: scale, rotation, hue, cycle hue, spin, scroll, colour under transparent parts, Randomize', i1.boxes[0].sliders.join() === 'scale,rot,hue,hueHz,spinHz,scroll' && i1.boxes[0].wild && i1.boxes[0].base >= 8, i1.boxes[0]);
    check('…and the floor\'s catalogue swatch is no longer marked', !i1.sel.floor && i1.sel.wall && i1.sel.ceiling, i1.sel);
    await setRange(A, 'floor', 'rot', 30); await setRange(A, 'floor', 'scale', 2);
    // ---- walls: green, rotation 60;  ceiling: blue, rotation 90 + spin
    await upload(A, 'wall', img.green); await setRange(A, 'wall', 'rot', 60);
    await upload(A, 'ceiling', img.blue); await setRange(A, 'ceiling', 'rot', 90); await setFlag(A, 'ceiling', 'spin'); await setRange(A, 'ceiling', 'scale', 1.5);
    await A.click('#own-wall .farg-base button[data-id="#f1eee7"]');
    await sleep(600);
    const i2 = await info(A);
    const sf = i2.draft.surfFabric;
    check('three different images: floor, all four walls, ceiling (each its own)', sf.floor.id !== sf.wall.id && sf.wall.id !== sf.ceiling.id && i2.fab.own.golv === sf.floor.id && i2.fab.own.tak === sf.ceiling.id && WALLS.every((w) => i2.fab.own[w] === sf.wall.id), i2.fab.own);
    check('rotation and scale per surface (floor 30° 2×, walls 60°, ceiling 90° 1.5× spinning) – on the surfaces too', sf.floor.rot === 30 && sf.floor.scale === 2 && sf.wall.rot === 60 && sf.ceiling.rot === 90 && sf.ceiling.spin === true && sf.ceiling.scale === 1.5
      && i2.fab.params.golv.rot === 30 && i2.fab.params['vägg-norr'].rot === 60 && i2.fab.params.tak.spin === true, { sf, p: i2.fab.params });
    check('…colour under transparent parts per surface (walls #f1eee7)', sf.wall.base === '#f1eee7' && sf.floor.base === '#ffffff', sf);
    await A.evaluate(() => { document.getElementById('style-panel').scrollTop = 0; });
    await A.screenshot({ path: path.join(SHOTS, '2-panel-floor-walls-ceiling-own-images.png') });
    await A.locator('#own-floor').screenshot({ path: path.join(SHOTS, '2b-floor-own-image-controls-closeup.png') });
    const idW = sf.wall.id;
    await A.click('#own-wall .farg-wild'); await sleep(300);
    const i3 = await info(A);
    check('🌀 Randomize on the walls: wild values, same image, the floor and ceiling untouched', i3.draft.surfFabric.wall.id === idW && JSON.stringify(i3.draft.surfFabric.wall) !== JSON.stringify(sf.wall) && JSON.stringify(i3.draft.surfFabric.floor) === JSON.stringify(sf.floor), i3.draft.surfFabric.wall);
    await setRange(A, 'wall', 'rot', 60); await setRange(A, 'wall', 'hue', 0); await setRange(A, 'wall', 'scale', 1); await setFlag(A, 'wall', 'cycleHue', false); await setFlag(A, 'wall', 'spin', false); await setRange(A, 'wall', 'scroll', 0);
    await A.click('#own-wall .farg-base button[data-id="#f1eee7"]'); await sleep(200);
    await A.click('#style-random'); await sleep(400);
    check('🎲 Random keeps the surfaces\' own images', JSON.stringify((await info(A)).draft.surfFabric.floor) === JSON.stringify(sf.floor));
    const want = (await info(A)).draft.surfFabric;
    await Promise.all([A.waitForNavigation({ timeout: 45000 }), A.click('#style-ok')]);
    await ready(A);
    await A.waitForFunction(() => window.klibb.roomFabric().loaded && Object.keys(window.klibb.roomFabric().own).length === 6, null, { timeout: 45000 });
    const R = await A.evaluate(() => new URLSearchParams(location.search).get('room'));
    const same = (x, y) => !!x && !!y && x.id === y.id && x.rot === y.rot && x.scale === y.scale && x.spin === y.spin && x.base === y.base;
    const a1 = await info(A);
    check('Create room → the new room has all three (room look + surfaces)', same(a1.cur.surfFabric.floor, want.floor) && same(a1.cur.surfFabric.wall, want.wall) && same(a1.cur.surfFabric.ceiling, want.ceiling) && a1.fab.own.golv === want.floor.id, a1.cur);
    const srv = await (await fetch(`${S.base}/api/rooms/${R}`)).json();
    check('…stored on the server with the room look', same(srv.room.style.surfFabric?.floor, want.floor) && same(srv.room.style.surfFabric?.wall, want.wall) && same(srv.room.style.surfFabric?.ceiling, want.ceiling), srv.room.style);
    await A.evaluate(() => document.getElementById('rec-toggle').click());
    await A.waitForFunction(() => !!window.klibb.rec(), null, { timeout: 8000 });
    const recId = await A.evaluate(() => window.klibb.rec().recId);
    // ---- another player (free version)
    const B = await page(browser, S, `${S.base}/?room=${R}`, {}, errors);
    await ready(B);
    await B.waitForFunction(() => window.klibb.roomFabric().loaded && Object.keys(window.klibb.roomFabric().own).length === 6, null, { timeout: 45000 });
    const b1 = await info(B);
    check('another player (free version) sees each surface\'s own image with its rotation', b1.fab.own.golv === want.floor.id && b1.fab.own.tak === want.ceiling.id && b1.fab.params.golv.rot === 30 && b1.fab.params['vägg-väster'].rot === 60 && b1.fab.params.tak.rot === 90, b1.fab);
    await B.evaluate(() => document.getElementById('rec-notice-ok')?.click());
    await view(B, 0, 3.2, 0, 0.18); await sleep(1000);
    const shotB = path.join(SHOTS, '3-room-red-floor-green-walls-blue-ceiling.png'); await B.screenshot({ path: shotB });
    const sh = { red: await share(shotB, IS.red), green: await share(shotB, IS.green), blue: await share(shotB, IS.blue) };
    check('…on screen: red (floor), green (walls) and blue (ceiling) stripes', sh.red > 0.01 && sh.green > 0.03 && sh.blue > 0.005, sh);
    await view(B, 0, 3.2, 0, -0.45); await sleep(700); await B.screenshot({ path: path.join(SHOTS, '4-room-looking-down-floor.png') });
    await view(B, 0, 3.2, 0, 0.7); await sleep(700); await B.screenshot({ path: path.join(SHOTS, '5-room-looking-up-ceiling.png') });
    // ---- Change look: Färg on top, the ceiling's own image off → the ceiling shows Färg; walls rotated
    await A.evaluate(() => window.klibb.openStylePanel('edit'));
    await A.waitForSelector('#style-panel:not([hidden])'); await sleep(500);
    const e0 = await info(A);
    check('🎨 Change look: the three own images are open in their rows', e0.boxes.every((b) => b.shown && !b.open && b.sliders.length === 6), e0.boxes);
    await A.setInputFiles('#farg-file', img.magenta);
    await A.waitForFunction(() => window.klibb.styleDraft()?.fabric?.id && window.klibb.roomFabric().loaded, null, { timeout: 45000 }); await sleep(300);
    const e1 = await info(A);
    check('Färg added: the own images stay on floor/walls/ceiling (own wins over Färg)', e1.fab.own.golv === want.floor.id && e1.fab.params.golv.id === want.floor.id && e1.fab.params.tak.id === want.ceiling.id, e1.fab.params);
    await A.click('#own-ceiling .farg-none'); await setRange(A, 'wall', 'rot', 120); await sleep(500);
    const e2 = await info(A);
    check('ceiling\'s own image → None: the ceiling now shows Färg; walls rotate to 120°', !e2.draft.surfFabric.ceiling && e2.fab.params.tak.id === e2.draft.fabric.id && e2.fab.params['vägg-norr'].rot === 120, e2.fab.params);
    await A.screenshot({ path: path.join(SHOTS, '6-change-look-with-farg.png') });
    await A.click('#style-ok'); await sleep(300);
    await B.waitForFunction((fid) => { const p = window.klibb.roomFabric().params; return p.tak?.id === fid && p['vägg-norr']?.rot === 120; }, e2.draft.fabric.id, { timeout: 15000 }).catch(() => {});
    const b2 = await info(B);
    check('…Save: the other player sees it live (ceiling = Färg, walls 120°, floor still its own image)', b2.fab.params.tak?.id === e2.draft.fabric.id && b2.fab.params['vägg-norr']?.rot === 120 && b2.fab.params.golv?.id === want.floor.id, b2.fab.params);
    await view(B, 0, 3.2, 0, 0.18); await sleep(800);
    const shotB2 = path.join(SHOTS, '7-after-change-ceiling-farg.png'); await B.screenshot({ path: shotB2 });
    check('…on screen: magenta ceiling now', (await share(shotB2, IS.magenta)) > 0.005);
    // catalogue swatch takes the own image away (then cancel)
    await A.evaluate(() => window.klibb.openStylePanel('edit')); await A.waitForSelector('#style-panel:not([hidden])');
    await A.click('#sw-floor button[data-id="parkett"]').catch(async () => { await A.click('#sw-floor button'); }); await sleep(400);
    const e3 = await info(A);
    check('picking a catalogue floor takes the floor\'s own image away (walls keep theirs)', !e3.draft.surfFabric?.floor && !!e3.draft.surfFabric?.wall && e3.sel.floor, e3.draft);
    await A.click('#style-cancel'); await sleep(400);
    check('…Cancel: back as it was', (await info(A)).fab.own.golv === want.floor.id);
    // ---- the recording
    await A.evaluate(() => document.getElementById('rec-toggle').click());
    await A.waitForFunction(() => !window.klibb.rec(), null, { timeout: 8000 }); await sleep(800);
    const lines = (await (await fetch(`${S.base}/api/rooms/${R}/recordings/${recId}/log`)).text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const head = lines.find((l) => l.style);
    check('the recording carries the per-surface images (header room look)', head && same(head.style.surfFabric?.floor, want.floor) && same(head.style.surfFabric?.ceiling, want.ceiling), head && head.style);
    const RP = await page(browser, S, `${S.base}/?room=${R}&replay=${recId}`, {}, errors);
    await sleep(6500);
    const shotR = path.join(SHOTS, '8-replay.png'); await RP.screenshot({ path: shotR });
    const rs = { red: await share(shotR, IS.red), green: await share(shotR, IS.green), blue: await share(shotR, IS.blue) };
    check('…and the replay draws them', rs.green > 0.02 && (rs.red > 0.003 || rs.blue > 0.003), rs);
    // ---- a preset made from the room keeps them
    const AD = await page(browser, S, `${S.base}/?room=${R}`, { admin: 'demo-e2e-admin' }, errors);
    await AD.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.adminToken, null, { timeout: 90000 });
    await sleep(2500);
    const preset = await AD.evaluate(() => window.klibb.savePreset({ name: 'E2E own images' }));
    check('preset from the room: its look keeps the per-surface images', preset && preset.style && preset.style.surfFabric?.floor?.id === want.floor.id && preset.style.surfFabric?.wall?.rot === 120, preset && preset.style);
    const nu = await post(S, '/api/rooms', {});
    check('…a new user\'s room from the preset gets them (free version too)', nu.room?.preset?.id === preset.id && nu.room.style.surfFabric?.floor?.id === want.floor.id && nu.room.style.surfFabric?.wall?.id === want.wall.id, nu.room && nu.room.style);
    await fetch(`${S.base}/api/admin/presets/${preset.id}`, { method: 'DELETE', headers: { 'x-admin-token': 'demo-e2e-admin' } });
    // ---- free version / server
    await B.evaluate(() => window.klibb.openStylePanel('create')); await B.waitForSelector('#style-panel:not([hidden])');
    const bf = await info(B);
    check('free version: no own-image option in the rows (no upsell)', bf.boxes.every((b) => !b.shown), bf.boxes);
    await B.evaluate(() => document.getElementById('style-cancel').click());
    const style = { floor: 'parkett', wall: 'tegel', ceiling: 'vit', surfFabric: want };
    const freeRoom = await post(S, '/api/rooms', { style }), fullRoom = await post(S, '/api/rooms', { style }, { 'x-dev-unlock': '1' });
    check('server: the free version\'s own images are dropped (rest kept), the full version\'s kept', freeRoom.room && !freeRoom.room.style.surfFabric && freeRoom.room.style.floor === 'parkett' && same(fullRoom.room?.style.surfFabric?.wall, want.wall), { free: freeRoom.room?.style, full: fullRoom.room?.style });
    const bad = await post(S, '/api/rooms', { style: { ...style, surfFabric: { floor: { id: '../etc' }, roof: want.floor, wall: want.wall } } }, { 'x-dev-unlock': '1' });
    check('…bad ids / unknown surfaces dropped, the rest stays', bad.room && !bad.room.style.surfFabric.floor && !bad.room.style.surfFabric.roof && same(bad.room.style.surfFabric.wall, want.wall), bad.room && bad.room.style);
    for (const X of [A, B, RP, AD]) await X.context().close(); // (fewer WebGL pages for the last one)
    const oRoom = await post(O, '/api/rooms', { preset: false });
    const C = await page(browser, O, `${O.base}/?room=${oRoom.room.id}`, {}, errors);
    await ready(C); await C.evaluate(() => window.klibb.openStylePanel('create')); await C.waitForSelector('#style-panel:not([hidden])');
    check('OPEN_ACCESS on: the own-image option is there for everyone', (await info(C)).boxes.every((b) => b.shown));
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  finally { await browser.close(); S.child.kill(); O.child.kill(); }
  console.log(`\nSurface own-image e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

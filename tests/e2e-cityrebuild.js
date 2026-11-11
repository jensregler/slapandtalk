// The city rebuild (Jens, 10 Nov 2026, pt781u + his annotated top-down sketch): screenshots to
// CITY_REBUILD_SHOTS (default /workspace/city-rebuild-shots) + checks, own server (CITY_REBUILD_PORT, 8994).
//   - the layout from above and from the street: kept houses 1/3/6/8, the subway station on plot 2, the
//     plaza between it and the Town Hall, open FX rooms (walls + roof) on 4/5/7
//   - the kept houses' room presets (seeded from PRESET_FACES_DIR = <dir>/<presetId>/<face>.webp when given,
//     else plain coloured faces) – 1 village in forrest, 3 Reglersro, 6 modern office, 8 Cozy Village
//   - max 4 per house: the door turns number five away (other houses offered); the server denies a fifth
//     socket and the page lands back outside with the same choice
//   - the subway door lists the living cities that have room (not mine, not full ones) and rides there
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const sharp = require('sharp');
const WebSocket = require('ws');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.CITY_REBUILD_PORT || 8994);
const SHOTS = process.env.CITY_REBUILD_SHOTS || '/workspace/city-rebuild-shots';
const FACES_DIR = process.env.PRESET_FACES_DIR || '';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 900) : '')); } };
const ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const FACES = ['floor', 'ceiling', 'north', 'south', 'west', 'east'];
const PRESETS = [['50288ba516', 'small village in forrest', '#5d8a4a'], ['ef54aa361a', 'Reglersro', '#8a6a4a'], ['62bda393d3', 'modern office', '#6a7a8a'], ['af39b8617f', 'Cozy Village', '#a0704a'], ['ba96fb9dc1', 'start', '#999999']];

async function seedPresets(dir) {
  fs.mkdirSync(path.join(dir, 'presets'), { recursive: true });
  for (const [id, title, col] of PRESETS) {
    fs.mkdirSync(path.join(dir, 'presets', id), { recursive: true });
    for (const f of FACES) {
      const real = FACES_DIR && path.join(FACES_DIR, id, `${f}.webp`);
      const buf = real && fs.existsSync(real) ? fs.readFileSync(real)
        : await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="128"><rect width="256" height="128" fill="${col}" fill-opacity=".55"/><text x="128" y="74" font-family="Arial" font-size="22" text-anchor="middle" fill="#111">${title}</text></svg>`)).webp().toBuffer();
      fs.writeFileSync(path.join(dir, 'presets', id, `${f}.webp`), buf);
    }
    fs.writeFileSync(path.join(dir, 'presets', `${id}.json`), JSON.stringify({ id, title, name: '', sourceRoom: null, style: null, px: 256, geo: '16x8x16', createdAt: '2026-11-01T00:00:00Z',
      faces: Object.fromEntries(FACES.map((f) => [f, `/api/presets/${id}/${f}.webp?v=1`])) }));
  }
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-rebuild-'));
  await seedPresets(dataDir);
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1', DATA_DIR: dataDir });
  const browser = await chromium.launch({ args: ARGS });
  const errors = [], sockets = [];
  const shot = (P, name) => P.screenshot({ path: path.join(SHOTS, name) });
  const ready = (P) => P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
  const ids = (P, sel) => P.evaluate((s) => [...document.querySelectorAll(s)].map((b) => b.dataset.id), sel);
  const post = (url, body = {}) => fetch(S.base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const join = async (room, name) => { const ws = new WebSocket(`${S.base.replace('http', 'ws')}/ws?room=${room}`); sockets.push(ws); await new Promise((r) => ws.on('open', r)); ws.send(JSON.stringify({ t: 'hello', name })); await sleep(120); return ws; };
  const pose = (Q, x, y, z, yaw, pitch) => Q.evaluate(([x, y, z, yaw, pitch]) => { const k = window.klibb; k.controls.ground = null; k.controls.collide = null; k.camera.position.set(x, y, z); k.controls.yaw = yaw; k.controls.pitch = pitch; k.controls.apply(); }, [x, y, z, yaw, pitch]);
  const look = JSON.stringify({ name: 'Jens', look: { outfit: 'casual', hair: 'short', shirt: '#3a7bd5', pants: '#333333', hairColor: '#3b2a1a', skin: '#e0b48c', hat: false, hatColor: '#d33' } });
  try {
    const CID = (await post('/api/cities', { name: 'Slapville', by: 'Jens' })).city.id;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await ctx.addInitScript((l) => { if (!localStorage.getItem('klibb.avatar')) localStorage.setItem('klibb.avatar', l); localStorage.setItem('klibb.pac', JSON.stringify({ name: 'Jens pack', stickers: [], at: 1 })); }, look);
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${CID}`); await ready(P); await sleep(2500);
    await P.evaluate(() => window.klibb.setView('first', { quiet: true }));
    let c = await P.evaluate(() => window.klibb.city());
    check('the rebuilt city: black doors on houses 1/3/6/8, the subway door, the Town Hall – none on 4/5/7', JSON.stringify(c.doorStates.map((d) => d[0])) === JSON.stringify([1, 'subway', 3, 'hall', 6, 8]) && [1, 3, 6, 8].every((n) => c.doorStates.find((d) => d[0] === n)[1] === 'open'), c.doorStates);
    const names = await P.evaluate(() => { const g = window.klibb.scene.getObjectByName('city'); const n = []; g.traverse((o) => { if (o.name) n.push(o.name); }); return n; });
    check('scene: subway station + T sign, FX walls and roofs on 4/5/7 with their signs, plaza benches; no house walls on plots 2/4/5/7',
      ['subway-s', 'subway-t', 'subway-sign', 'fx4-roof', 'fx4-ceiling', 'fx5-roof', 'fx7-roof', 'fx-sign-4', 'fx-sign-5', 'fx-sign-7', 'plaza-bench', 'h0-s', 'h2-s', 'h6-s', 'h8-s'].every((x) => names.includes(x))
      && !['h1-s', 'h3-s', 'h5-s', 'h7-s', 'door-4', 'door-5', 'door-7', 'door-2'].some((x) => names.includes(x)), names.filter((x) => /^(h\d|fx|subway|door)/.test(x)));

    // The FX rooms' ceiling light (Jens, 11 Nov 2026, voice): each open room 4/5/7 has the same four ceiling
    // lamps as a house's ceiling (compared with house 1's lamps below: colour, intensity, reach, decay, layout).
    const lampsOf = (Q, root) => Q.evaluate((root) => { const k = window.klibb, out = []; (root ? k.scene.getObjectByName(root) : k.scene).traverse((o) => { if (o.isPointLight) { const p = o.getWorldPosition(o.position.clone()); out.push({ name: o.name, fx: o.userData.fxCeiling || 0, color: o.color.getHex(), intensity: o.intensity, distance: o.distance, decay: o.decay, x: p.x, y: p.y, z: p.z }); } }); return out; }, root);
    const fxLamps = await lampsOf(P, 'city');
    const FXC = { 4: [-32, 0], 5: [32, 0], 7: [0, 32] };
    check('FX rooms 4/5/7: four ceiling lamps each, inside the walls, just under the ceiling (8 m); no other point lights in the city',
      fxLamps.length === 12 && [4, 5, 7].every((n) => { const l = fxLamps.filter((o) => o.fx === n && o.name === `fx${n}-ceiling-light`); return l.length === 4 && l.every((o) => Math.abs(o.x - FXC[n][0]) < 7.6 && Math.abs(o.z - FXC[n][1]) < 7.6 && o.y > 7 && o.y < 8); }), fxLamps);

    // ---- from above (the sketch's view): sky ceiling hidden, camera high over the middle, looking straight down
    await P.evaluate(() => { const k = window.klibb; const g = k.scene.getObjectByName('city'); g.traverse((o) => { if (o.name === 'tak' || /^vägg-/.test(o.name)) o.visible = false; }); k.camera.far = 400; k.camera.updateProjectionMatrix(); });
    await pose(P, 0, 125, 0.01, 0, -Math.PI / 2 + 0.0001); await sleep(1500);
    await shot(P, '01-top-down-like-the-sketch.png');
    // the same with the open rooms' roofs lifted off: their walls (the sketch's orange lines) – 4 open west, 5 open east, 7 a doorway south
    await P.evaluate(() => { const g = window.klibb.scene.getObjectByName('city'); g.traverse((o) => { if (/^fx\d-(roof|ceiling)$/.test(o.name) || (o.isMesh && o.geometry?.type === 'BoxGeometry' && o.position.y > 7.9 && o.position.y < 8.4)) o.visible = false; }); });
    await sleep(800); await shot(P, '01b-top-down-open-room-walls-roofs-off.png');
    await P.evaluate(() => { const g = window.klibb.scene.getObjectByName('city'); g.traverse((o) => { o.visible = true; }); });
    await pose(P, 0, 60, 92, 0, -0.62); await sleep(1200);
    await shot(P, '02-aerial-from-the-south.png');
    await P.evaluate(() => { const g = window.klibb.scene.getObjectByName('city'); g.traverse((o) => { if (o.name === 'tak' || /^vägg-/.test(o.name)) o.visible = true; }); });
    const fov = (f) => P.evaluate((f) => { const k = window.klibb; k.camera.fov = f; k.camera.updateProjectionMatrix(); }, f);
    // ---- street level: the plaza and the subway station (from the Town Hall's north side, looking north)
    await pose(P, -3, 2.1, -9.5, 0.08, 0.02); await sleep(1200);
    await shot(P, '03-plaza-and-subway-station.png');
    await pose(P, 9, 1.7, -30, 0.9, 0.06); await sleep(900);
    await shot(P, '04-subway-door-and-T-sign.png');
    // ---- the open FX rooms
    await fov(95);
    await pose(P, -47.4, 3.2, 6, -1.75, -0.05); await sleep(1100);
    await shot(P, '05-room4-reverb-open-west.png');
    await pose(P, -38, 1.7, 0, -1.57, 0.12); await sleep(900);
    await shot(P, '06-room4-reverb-inside.png');
    await pose(P, 47.4, 3.2, -6, 1.75, -0.05); await sleep(1000);
    await shot(P, '07-room5-delay-open-east.png');
    await pose(P, 6, 3.2, 47.4, 0.2, -0.05); await sleep(1000);
    await shot(P, '08-room7-noise-doorway.png');
    await pose(P, 0, 1.7, 38, 0, 0.05); await sleep(900);
    await shot(P, '08b-room7-noise-inside.png');
    await fov(70);

    // ---- the subway: living cities with room (not mine, not full)
    const malmo = (await post('/api/cities', { name: 'Malmö', by: 'Ulla' })).city.id;
    const full = (await post('/api/cities', { name: 'Full town', by: 'Kim' })).city.id;
    await join(malmo, 'Ulla'); for (let k = 0; k < 4; k++) await join(full, 'K' + k);
    await pose(P, 0, 2.2, -27, 0, 0.02); await sleep(300);
    await P.evaluate(() => window.klibb.cityDoor('subway')); await P.waitForFunction(() => window.klibb.city().pick.cities !== null, null, { timeout: 10000 }); await sleep(700);
    c = await P.evaluate(() => window.klibb.city());
    check('subway door → "living cities with room": Malmö (room for 3), not Full town (4 of 4), not Slapville itself; no "start a city" button',
      c.pick.open && c.pick.subway && c.pick.cities.length === 1 && c.pick.cities[0].id === malmo && c.pick.cities[0].space === 3 && !(await P.isVisible('#cp-new')), c.pick);
    await shot(P, '09-subway-list-living-cities-with-room.png');
    await Promise.all([P.waitForURL(new RegExp(`room=${malmo}&at=subway`), { timeout: 20000 }), P.click(`.cp-city[data-id="${malmo}"]`)]);
    await ready(P); await sleep(2000);
    const arr = await P.evaluate(() => window.klibb.camera.position.toArray());
    check('…riding there: in Malmö, up on the plaza in front of its station', Math.abs(arr[0]) < 1 && Math.abs(arr[2] - (-38.5 + 2.25 + 2.6)) < 0.6, arr);
    await shot(P, '10-arrived-by-subway-on-the-plaza.png');
    await P.goto(`${S.base}/?room=${CID}`); await ready(P); await sleep(2000);

    // ---- kept houses with their presets
    const titles = {};
    for (const n of [1, 3, 6, 8]) {
      await post(`/api/cities/${CID}/houses`, { n, by: 'Jens' });
      const r = (await (await fetch(`${S.base}/api/rooms/${CID}-${n}`)).json()).room;
      titles[n] = r.preset && r.preset.id;
    }
    check('houses 1/3/6/8 carry their room presets (village in forrest, Reglersro, modern office, Cozy Village)', JSON.stringify(titles) === JSON.stringify({ 1: '50288ba516', 3: 'ef54aa361a', 6: '62bda393d3', 8: 'af39b8617f' }), titles);
    await P.evaluate(() => window.klibb.cityDoor(1)); await sleep(700);
    const d1 = await ids(P, '#menu-choice-list > *');
    check('house 1\'s door: go in (0 of 4 inside · a quiet room)', d1[0] === 'enter-house' && /0 of 4/.test(await P.textContent('#menu-choice-list')), d1);
    await pose(P, -29, 2.0, -12, 0.25, 0.06); await sleep(500);
    await shot(P, '11-house1-black-door-go-in.png');
    await Promise.all([P.waitForURL(new RegExp(`room=${CID}-1$`), { timeout: 20000 }), P.click('#menu-choice-list [data-id="enter-house"]')]);
    await ready(P); await sleep(3500);
    let pr = await P.evaluate(() => window.klibb.preset());
    check('inside house 1: the preset room is on (baked walls)', pr.room === true, pr);
    const houseLamps = await lampsOf(P, null);
    const key = (o, cx = 0, cz = 0) => [o.color, +o.intensity.toFixed(4), +o.distance.toFixed(4), o.decay, +(o.x - cx).toFixed(3), +o.y.toFixed(3), +(o.z - cz).toFixed(3)].join(',');
    const houseSet = houseLamps.map((o) => key(o)).sort().join(' | ');
    check('…the FX rooms\' ceiling lamps are house 1\'s ceiling lamps (same warm colour, intensity, reach, decay, same spots under the ceiling)',
      houseLamps.length === 4 && [4, 5, 7].every((n) => fxLamps.filter((o) => o.fx === n).map((o) => key(o, FXC[n][0], FXC[n][1])).sort().join(' | ') === houseSet), { houseSet, fx: fxLamps.map((o) => key(o, FXC[o.fx][0], FXC[o.fx][1])) });
    await shot(P, '12-house1-inside-village-in-forrest.png');
    for (const [n, name] of [[3, '13-house3-inside-reglersro.png'], [6, '14-house6-inside-modern-office.png'], [8, '15-house8-inside-cozy-village.png']]) {
      await P.goto(`${S.base}/?room=${CID}-${n}`); await ready(P); await sleep(3500);
      pr = await P.evaluate(() => window.klibb.preset());
      check(`inside house ${n}: its preset room is on`, pr.room === true, pr);
      await shot(P, name);
    }

    // ---- max 4: the door turns number five away; the server denies a fifth socket
    await P.goto(`${S.base}/?room=${CID}`); await ready(P); await sleep(2000);
    const inside = []; for (let k = 0; k < 4; k++) inside.push(await join(`${CID}-8`, 'P' + k));
    await P.evaluate(() => window.klibb.cityDoor(8)); await sleep(900);
    const d8 = await ids(P, '#menu-choice-list > *');
    const d8text = await P.textContent('#menu-choice-list');
    check('house 8 with 4 inside: "House 8 is full – 4 people max. Try another room:" + houses 1, 3, 6', JSON.stringify(d8) === JSON.stringify(['house-full', 'try-1', 'try-3', 'try-6', 'back']) && /House 8 is full/.test(d8text), { d8, d8text });
    await pose(P, 35, 2.0, 47.4, 0.2, 0.06); await sleep(400);
    await shot(P, '16-house8-full-try-another-room.png');
    await P.click('#menu-choice-list [data-id="back"]');
    await P.goto(`${S.base}/?room=${CID}-8`);
    await P.waitForURL(new RegExp(`room=${CID}&at=${CID}-8&full=8`), { timeout: 30000 }); await ready(P); await sleep(1800);
    const back = await ids(P, '#menu-choice-list > *');
    check('a fifth straight into house 8 (a link): the server says no → back outside in front of its door, with the other houses', back[0] === 'house-full' && back.includes('try-1'), back);
    await shot(P, '17-fifth-denied-back-outside.png');
    for (const w of inside) w.close();
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e && e.stack || e)); }
  for (const w of sockets) { try { w.close(); } catch { /* */ } }
  await browser.close(); S.child.kill();
  console.log(`\nCity rebuild e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

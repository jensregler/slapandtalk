// 3D props (Jens, t491u + t509u, 4 Nov 2026): screenshots to PROPS_SHOTS (/workspace/props-v1-shots) + checks.
//   - a room has the table set by default; one person uses the drawing tool → sits at the table and draws,
//     the other sees it (chair taken; the cap stays on the head); getting up frees the chair
//   - the Props wheel (build phase, full version / own room): place a cuboid, size W/H/D, colour, saved
//   - the build city's street with lights, benches, signs … (PUT /api/rooms/stad-byggen/props/:id),
//     copied into the default city preset; not allowed in another city's outside
//   - a phone view (390 × 844)
// Own server (PROPS_E2E_PORT, 8993), OPEN_ACCESS=1 (= the full version).
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.PROPS_E2E_PORT || 8993);
const SHOTS = process.env.PROPS_SHOTS || '/workspace/props-v1-shots';
const ADM = 'demo-e2e-admin';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 900) : '')); } };
const ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1', EMPTY_CITY_GRACE_SECONDS: '2', EMPTY_ROOM_GRACE_SECONDS: '2' });
  const browser = await chromium.launch({ args: ARGS });
  const errors = [];
  const shot = (P, name) => P.screenshot({ path: path.join(SHOTS, name) });
  const api = async (m, u, b, h = {}) => { const r = await fetch(S.base + u, { method: m, headers: { 'Content-Type': 'application/json', ...h }, ...(b ? { body: JSON.stringify(b) } : {}) }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
  const LIB = { pac: null };
  const look = (name, shirt, hat) => JSON.stringify({ name, look: { outfit: 'casual', hair: 'short', shirt, pants: '#333333', hairColor: '#3b2a1a', skin: '#e0b48c', hat, hatColor: '#d33' } });
  const newCtx = async (name, shirt, hat, opt = { viewport: { width: 1600, height: 1000 } }, keys = {}) => {
    const ctx = await browser.newContext(opt);
    await ctx.addInitScript(([l, k, p]) => { localStorage.setItem('klibb.avatar', l); localStorage.setItem('klibb.devUnlock', '1'); localStorage.setItem('klibb.roomKeys', k); if (p) localStorage.setItem('klibb.pac', p); }, [look(name, shirt, hat), JSON.stringify(keys), LIB.pac]);
    return ctx;
  };
  const open = async (ctx, room) => {
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(room + ': ' + e.message)); P.on('console', (m) => { if (m.type() === 'warning' && /\[props\]/.test(m.text())) errors.push(room + ': ' + m.text().slice(0, 200)); });
    await P.goto(`${S.base}/?room=${room}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.propsReady, null, { timeout: 60000 }); await sleep(1200); return P;
  };
  const pose = (Q, x, y, z, yaw, pitch) => Q.evaluate(([x, y, z, yaw, pitch]) => { const k = window.klibb; k.controls.ground = null; k.controls.collide = null; k.camera.position.set(x, y, z); k.controls.yaw = yaw; k.controls.pitch = pitch; k.controls.apply(); }, [x, y, z, yaw, pitch]);
  try {
    const lib = (await api('GET', '/api/library')).stickers, plain = lib.filter((d) => !d.nature).slice(10, 13);
    LIB.pac = JSON.stringify({ name: 'Jens pack', stickers: plain.map((d) => d.id), urls: plain.map((d) => d.url), designs: plain.map((d) => ({ id: d.id, url: d.url, width: d.width, height: d.height })), at: new Date().toISOString() });
    // ---------- a room: the table set, sit and draw
    const mk = await api('POST', '/api/rooms', { style: { floor: 'betong', wall: 'tegel' } });
    const R = mk.room.id;
    const st = await api('GET', `/api/rooms/${R}/stamps`);
    check('a new room has the table with 4 chairs by default', st.props && st.props.length === 5 && st.props.filter((p) => p.kind === 'chair').length === 4, st.props);
    const A = await open(await newCtx('Jens', '#3a7bd5', false, undefined, { [R]: mk.roomKey }), R);
    const B = await open(await newCtx('Ada', '#d64b3a', true), R);
    check('the props are built in the room (5)', (await A.evaluate(() => window.klibb.props.info().n)) === 5);
    await B.evaluate(() => { window.klibb.setView('first', { quiet: true }); window.klibb.moveTo(-0.6, 0.2); });
    await sleep(400);
    await B.evaluate(() => window.klibb.openNameTag()); await sleep(1500);
    const bs = await B.evaluate(() => window.klibb.props.seated());
    check('the drawing tool near a chair: I sit at the table', bs && /^d0000000a[1-4]$/.test(bs.id), bs);
    let seen = null;
    for (let i = 0; i < 20 && !(seen && seen.seated); i++) { await sleep(300); seen = await A.evaluate(() => window.klibb.players().find((p) => p.name === 'Ada')); }
    check('…and the others see me sitting and drawing', seen && seen.seated && seen.sit && seen.sit.draw && seen.sit.chair === bs.id, seen);
    const chairP = (await A.evaluate(() => window.klibb.props.list())).find((p) => p.id === bs.id);
    check('…on that chair (the avatar is at the chair)', seen && chairP && Math.hypot(seen.pos[0] - chairP.x, seen.pos[2] - chairP.z) < 0.35, { seen, chairP });
    check('…the cap stays off (kepsen never shown, even when seated)', seen && seen.capWorld == null, seen && { capWorld: seen.capWorld, pos: seen.pos });
    await A.evaluate(() => window.klibb.setView('first', { quiet: true }));
    await pose(A, 1.5, 1.6, 3.1, 0.62, -0.38); await sleep(2200);
    await shot(A, '01-room-table-someone-sitting-drawing.png');
    // A takes the drawing tool too: gets another chair (B's is taken)
    await A.evaluate(() => { window.klibb.moveTo(-0.6, 0.2); }); await sleep(300);
    await A.evaluate(() => window.klibb.props.sitToDraw()); await sleep(800);
    const as = await A.evaluate(() => window.klibb.props.seated());
    check('a second drawer gets another chair (the first one is taken)', as && as.id !== bs.id, { as, bs });
    await A.evaluate(() => window.klibb.props.standUp());
    await B.keyboard.press('Escape'); await sleep(1200);
    const bs2 = await B.evaluate(() => window.klibb.props.seated());
    let seen2 = null; for (let i = 0; i < 10; i++) { await sleep(300); seen2 = await A.evaluate(() => window.klibb.players().find((p) => p.name === 'Ada')); if (!seen2.seated) break; }
    check('closing the drawing tool: I stand up, the chair is free', !bs2 && seen2 && !seen2.seated, { bs2, seen2 });
    await B.close();

    // ---------- collision (Jens t521u): walking into the table set stops at a chair; the drawing tool still sits me down
    await A.evaluate(() => window.klibb.setView('first', { quiet: true }));
    const walk = (Q, x, z, yaw, ms) => Q.evaluate(async ([x, z, yaw, ms]) => {
      const k = window.klibb; k.camera.position.set(x, 1.6, z); k.controls.yaw = yaw; k.controls.pitch = 0; k.controls.apply();
      k.controls.keys.add('KeyW'); await new Promise((r) => setTimeout(r, ms)); k.controls.keys.delete('KeyW');
      return [k.camera.position.x, k.camera.position.z];
    }, [x, z, yaw, ms]);
    const w1 = await walk(A, -0.45, -1.2, Math.PI, 1600); // south (+z) straight at chair a1 (z 0.78)
    check('collision: walking at the table set, I stop at the chair (not through it)', w1[1] > -0.6 && w1[1] < 0.78 - 0.15 && Math.abs(w1[0] + 0.45) < 0.4, w1);
    check('…the chair\'s box is there (prop colliders)', /^d0000000a[0-4]$/.test(await A.evaluate(() => window.klibb.props.collider.blocked(-0.45, 0.78)) || ''));
    const w2 = await walk(A, 3, -1.2, Math.PI, 1600); // the same walk beside it: free
    check('…beside the table nothing stops me', w2[1] > 2, w2);
    await A.evaluate(() => { const k = window.klibb; k.camera.position.set(-0.45, 1.6, 0.78); }); // spawned inside a chair
    const w3 = await walk(A, -0.45, 0.78, 0, 900); // walk out north
    check('…standing inside a prop (placed on me / spawned in it): I can walk out, not stuck', w3[1] < 0.3, w3);
    await A.evaluate(() => { window.klibb.camera.position.set(-1.3, 1.6, 0.2); window.klibb.controls.yaw = 0; }); await sleep(200);
    await A.evaluate(() => window.klibb.props.sitToDraw()); await sleep(600);
    const sat = await A.evaluate(() => ({ s: window.klibb.props.seated(), p: window.klibb.camera.position.toArray() }));
    check('…sitting via the drawing tool still puts me in the chair', sat.s && /^d0000000a/.test(sat.s.id) && Math.hypot(sat.p[0] - sat.s.x, sat.p[2] - sat.s.z) < 0.3, sat);
    await A.evaluate(() => window.klibb.props.standUp()); await sleep(300);
    await A.evaluate(() => { const k = window.klibb; k.camera.position.set(-0.45, 1.6, -0.1); k.controls.yaw = Math.PI; k.controls.pitch = 0; k.controls.apply(); });
    await walk(A, -0.45, -1.2, Math.PI, 1600);
    await A.evaluate(() => window.klibb.setView('third', { quiet: true })); await sleep(1200);
    await shot(A, '20-room-player-stopped-at-chair-3rd.png');
    await A.evaluate(() => window.klibb.setView('first', { quiet: true }));

    // ---------- the Props wheel in my own room: a cuboid
    await A.evaluate(() => window.klibb.setProps(true)); await sleep(1200);
    const inf = await A.evaluate(() => window.klibb.props.info());
    check('the Props wheel opens (own room, build phase, full version)', inf.active && inf.strip, inf);
    await A.evaluate(() => window.klibb.props.pickKind('box'));
    await pose(A, 3.5, 1.7, 5.5, 0, -0.5); await sleep(700);
    await A.evaluate(() => window.klibb.props.click()); await sleep(900);
    let box = (await A.evaluate(() => window.klibb.props.list())).find((p) => p.kind === 'box');
    check('a cuboid is placed where I aim', !!box && Math.abs(box.x - 3.5) < 1 && box.z < 5.5, box);
    await A.evaluate((id) => { const u = window.klibb.props; u.select(id); u.change((p) => ({ ...p, sx: 2.4, sy: 1.2, sz: 0.6, color: '#d8452f', yaw: 0.4 })); }, box.id);
    await sleep(1500);
    const saved = (await api('GET', `/api/rooms/${R}/stamps`)).props;
    const sb = saved.find((p) => p.id === box.id);
    check('…its size W/H/D, colour and turn are saved (and the default table set with it)', sb && sb.sx === 2.4 && sb.sy === 1.2 && sb.sz === 0.6 && sb.color === '#d8452f' && saved.length === 6, { box, saved: saved.filter((p) => p.kind === 'box'), n: saved.length });
    check('…the panel is open', await A.evaluate(() => window.klibb.props.info().panel));
    await A.evaluate(() => window.klibb.props.pickKind('plant')); await A.evaluate(() => window.klibb.props.select(window.klibb.props.list().find((p) => p.kind === 'box').id));
    await pose(A, 1.2, 2.4, 7.4, -0.12, -0.32); await sleep(1500);
    await shot(A, '02-props-wheel-cuboid-panel.png');
    // a sticker on the cuboid's face (faces are sticker surfaces)
    const faces = await A.evaluate(() => window.klibb.props.info().faces);
    check('the cuboid\'s six faces are sticker surfaces', faces >= 12, faces);
    const r2 = await api('PUT', `/api/rooms/${R}/props/abcdef0123`, { prop: { kind: 'bench', x: 1, z: 1 } });
    check('someone else (no room key) may not place props in my room', r2.status === 403, r2);
    await A.close();

    // ---------- the build city's street
    const CITY = 'stad-byggen';
    const street = [];
    let n = 0; const id = () => (0xa000000000 + (n++)).toString(16);
    for (let z = -6; z <= 40; z += 9) street.push({ kind: 'lamp', x: 18.2, z, yaw: -Math.PI / 2 }, { kind: 'lamp2', x: 13.8, z: z + 4.5, yaw: Math.PI / 2 });
    street.push(
      { kind: 'sign-stop', x: 14, z: 30, yaw: 0 }, { kind: 'sign-yield', x: 18, z: 26, yaw: 0 }, { kind: 'sign-30', x: 13.9, z: 22, yaw: 0 },
      { kind: 'sign-crossing', x: 18.1, z: 18, yaw: 0 }, { kind: 'sign-parking', x: 13.9, z: 14, yaw: 0 }, { kind: 'sign-oneway', x: 18.1, z: 10, yaw: 0 }, { kind: 'sign-noentry', x: 13.9, z: 6, yaw: 0 },
      { kind: 'bench', x: 19.5, z: 33, yaw: -Math.PI / 2 }, { kind: 'bin', x: 19.5, z: 31.5 }, { kind: 'busstop', x: 20, z: 24, yaw: -Math.PI / 2 },
      { kind: 'elskap', x: 12.5, z: 26, yaw: Math.PI / 2 }, { kind: 'postlada', x: 12.6, z: 31, yaw: Math.PI / 2 }, { kind: 'pillar', x: 12, z: 18 },
      { kind: 'planter', x: 19.6, z: 15 }, { kind: 'tree', x: 21, z: 8 }, { kind: 'treeL', x: 11, z: 10 }, { kind: 'bikerack', x: 19.7, z: 20, yaw: -Math.PI / 2 },
      { kind: 'car', x: 16.8, z: 12, yaw: 0 }, { kind: 'cone', x: 15.5, z: 35 }, { kind: 'cone', x: 15.9, z: 35.6 }, { kind: 'kiosk', x: 22, z: 30, yaw: -Math.PI / 2 },
      { kind: 'phonebooth', x: 11.5, z: 35, yaw: Math.PI / 2 }, { kind: 'market', x: 22.5, z: 37, yaw: -Math.PI / 2 }, { kind: 'fountain', x: 16, z: 0 }, { kind: 'trafficlight', x: 18.2, z: 3, yaw: -Math.PI / 2 },
      { kind: 'box', x: 25, z: 20, yaw: 0, sx: 1.5, sy: 3, sz: 10, color: '#4f8fd6' },
    );
    let okAll = true;
    for (const p of street) { const r = await api('PUT', `/api/rooms/${CITY}/props/${id()}`, { prop: p }); if (r.status !== 200) { okAll = false; console.log('    put', p.kind, r.status, r.error); } }
    check(`the build city: ${street.length} props placed along a street (lights, signs, bench, bus stop, elskåp, PostNord, car …)`, okAll);
    const other = (await api('POST', '/api/cities', { name: 'Elsewhere' })).city.id;
    const ro = await api('PUT', `/api/rooms/${other}/props/abcdefabcd`, { prop: { kind: 'bench', x: 16, z: 20 } });
    check('…but not in another city\'s outside (only the build city)', ro.status === 403, ro);
    const roa = await api('PUT', `/api/rooms/${other}/props/abcdefabcd`, { prop: { kind: 'bench', x: 16, z: 20 } }, { 'x-admin-token': ADM });
    check('…unless admin', roa.status === 200, roa);
    const C = await open(await newCtx('Jens', '#3a7bd5', false), CITY);
    check('the props are built in the city', (await C.evaluate(() => window.klibb.props.info().n)) === street.length, await C.evaluate(() => window.klibb.props.info()));
    await C.evaluate(() => window.klibb.setView('first', { quiet: true }));
    await pose(C, 16, 1.75, 41, 0, -0.04); await sleep(2500);
    await shot(C, '03-city-street-signs-props.png');
    await pose(C, 16.6, 1.6, 34.5, 0.42, -0.02); await sleep(1500);
    await shot(C, '03b-city-swedish-road-signs-close.png');
    await pose(C, 23, 6, 44, 0.32, -0.2); await sleep(1500);
    await shot(C, '04-city-street-from-above.png');
    await C.evaluate(() => window.klibb.setProps(true)); await sleep(1500);
    await pose(C, 16, 1.75, 41, 0, -0.1); await sleep(1000);
    await shot(C, '05-city-props-wheel.png');
    await C.evaluate(() => window.klibb.setProps(false)); await sleep(500);

    // ---------- collision in the city: walking at the kiosk stops at its counter
    const kiosk = (await C.evaluate(() => window.klibb.props.list())).find((p) => p.kind === 'kiosk');
    await C.evaluate(() => { const k = window.klibb; k.controls.ground = null; k.controls.collide = null; });
    const wk = await walk(C, 19.2, 30, -Math.PI / 2, 2200); // east (+x) at the kiosk's front (x 21, its counter 20.6; past the street light at x 18.2)
    check('the city: walking at the kiosk, I stop in front of it', wk[0] > 19.5 && wk[0] < 20.75 && Math.abs(wk[1] - 30) < 0.3, { wk, lamp: await C.evaluate(() => { const l = window.klibb.props.list().find((p) => p.kind === 'lamp' && p.z === 30); return l && window.klibb.props.collider.boxes(l.id).map((b) => [b.cx, b.cz, b.hx, b.hz]); }) });
    const lampP = (await C.evaluate(() => window.klibb.props.list())).find((p) => p.kind === 'lamp');
    const lampBoxes = await C.evaluate((id) => window.klibb.props.collider.boxes(id).map((b) => [b.hx, b.hz]), lampP.id);
    check('…a street light blocks only at its pole (not its arm)', lampBoxes.length >= 1 && lampBoxes.every(([a, b]) => a < 0.4 && b < 0.4), { lampBoxes });
    await C.evaluate(() => { const k = window.klibb; k.controls.yaw = -Math.PI / 2 + 0.5; k.controls.pitch = -0.1; k.controls.apply(); k.setView('third', { quiet: true }); }); await sleep(1500);
    await shot(C, '21-city-player-stopped-at-kiosk-3rd.png');
    await C.evaluate(() => window.klibb.setView('first', { quiet: true }));

    // ---------- stickers on any prop (Jens t521u): on the kiosk (not a cuboid), saved, there after a reload
    const design = plain[0].id;
    await C.evaluate((id) => window.klibb.selectDesign(window.klibb.stickerDesigns().find((d) => d.id === id) || window.klibb.stickerDesigns()[0]), design); await sleep(500);
    await C.evaluate(() => window.klibb.setSize(90)); // big: it wraps over the kiosk's counter
    await pose(C, 18.2, 1.6, 30.2, -Math.PI / 2, -0.08); await sleep(800);
    const ks = await C.evaluate(() => window.klibb.stampAt(0, 0).then((s) => s && { id: s.id, surface: s.surface, position: s.position }));
    check('a sticker slapped on the kiosk sticks to the kiosk\'s mesh (prop-<id>-m<k>)', ks && new RegExp(`^prop-${kiosk.id}-m\\d+$`).test(ks.surface), ks);
    await sleep(1200);
    const drawn = (Q, id) => Q.evaluate((id) => { const m = window.klibb.stamps.meshes.get(id); return !!m && (m.baked || (m.geometry && m.geometry.attributes.position.count > 0)); }, id);
    check('…and is drawn on it', ks && await drawn(C, ks.id));
    const saved2 = (await api('GET', `/api/rooms/${CITY}/stamps`)).stamps.find((x) => ks && x.id === ks.id);
    check('…saved by the server like any sticker (world-space, its surface)', !!saved2 && saved2.surface === ks.surface, saved2);
    await C.reload(); await C.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.propsReady, null, { timeout: 60000 }); await sleep(2500);
    check('…still there after a reload', ks && await drawn(C, ks.id));
    await C.evaluate(() => window.klibb.setView('first', { quiet: true }));
    await pose(C, 17.6, 1.9, 31.4, -Math.PI / 2 + 0.35, -0.12); await sleep(1500);
    await shot(C, '22-city-sticker-on-kiosk-before-move.png');
    // moving the kiosk: the sticker stays where it was slapped (Jens: build first, texture afterwards)
    const mv = await api('PUT', `/api/rooms/${CITY}/props/${kiosk.id}`, { prop: { ...kiosk, z: 33.5 } }, { 'x-admin-token': ADM });
    check('moving the kiosk is saved', mv.status === 200, mv);
    await sleep(1500);
    await shot(C, '23-city-sticker-on-kiosk-after-move.png');
    check('…the sticker stays (world-space): not lost', ks && (await C.evaluate((id) => window.klibb.stamps.meshes.has(id), ks.id)));
    await api('PUT', `/api/rooms/${CITY}/props/${kiosk.id}`, { prop: kiosk }, { 'x-admin-token': ADM });
    await C.close();
    await sleep(3500);
    const pre = await api('GET', '/api/admin/citypresets', null, { 'x-admin-token': ADM });
    const dp = pre.presets && pre.presets.find((p) => p.default);
    check('the build city\'s props go into the default city preset', !!dp && dp.props && dp.props.outside === street.length, dp);
    check('…and the sticker on the kiosk with them (same prop ids: a new city gets both)', !!dp && dp.stickers && dp.stickers.outside >= 1, dp && dp.stickers);

    // ---------- phone
    const ph = await newCtx('Ada', '#d64b3a', true, { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } });
    const M = await open(ph, CITY);
    await M.evaluate(() => window.klibb.setView('first', { quiet: true }));
    await pose(M, 16, 1.7, 40, 0, -0.05); await sleep(1800);
    await shot(M, '06-phone-city-street.png');
    await M.evaluate(() => window.klibb.setProps(true)); await sleep(1500);
    await shot(M, '07-phone-props-wheel.png');
    const R2 = await open(ph, R);
    await R2.evaluate(() => { window.klibb.setView('third', { quiet: true }); window.klibb.moveTo(-0.6, 0.2); }); await sleep(500);
    await R2.evaluate(() => window.klibb.openNameTag()); await sleep(1800);
    await shot(R2, '08-phone-room-sitting-drawing.png');
    await ph.close();
    check('no page errors', !errors.length, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e && e.stack)); }
  await browser.close(); S.child.kill();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

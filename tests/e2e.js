// Automatiskt test från början till slut (körs med: npm test).
// Öppnar appen i en osynlig webbläsare, laddar upp klibbor, stämplar på vägg,
// golv och tak, laddar om sidan och kollar att allt finns kvar. Tar skärmdumpar.
// Kör mot rummet "e2e-test" och städar bort allt efteråt.
require('dotenv').config({ path: __dirname + '/../.env', quiet: true });
const { chromium, devices } = require('playwright');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8787';
const ROOM = 'e2e-test';
const SHOTS = path.join(__dirname, '..', 'screenshots');
const TOKEN = process.env.ADMIN_TOKEN;
fs.mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };

async function makeTestSticker() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
    <circle cx="200" cy="200" r="180" fill="#e0245e" stroke="#fff" stroke-width="16"/>
    <text x="200" y="230" font-family="DejaVu Sans" font-weight="900" font-size="90" text-anchor="middle" fill="#fff">TEST</text></svg>`;
  const file = path.join(__dirname, 'test-klibba.png');
  await sharp(Buffer.from(svg)).png().toFile(file);
  return file;
}

const count = (page) => page.evaluate(() => window.klibb.stamps.count);
const waitReady = (page) => page.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 20000 });

(async () => {
  const testPng = await makeTestSticker();
  const demoPng = path.join(__dirname, 'demo-klibba.png');
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const created = new Set();
  try {
    // ---------- Dator ----------
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('sidfel:', e.message));
    await page.goto(`${BASE}/?room=${ROOM}`);
    await waitReady(page);
    assert(await page.evaluate(() => !!document.querySelector('canvas').getContext), 'sidan laddades');
    await page.fill('#artist', 'Testaren');

    await page.setInputFiles('#file', demoPng);
    await page.waitForFunction(() => window.klibb.state.selected);
    const demoId = await page.evaluate(() => window.klibb.state.selected.id);
    await page.setInputFiles('#file', testPng);
    await page.waitForFunction((id) => window.klibb.state.selected && window.klibb.state.selected.id !== id, demoId);
    const testId = await page.evaluate(() => window.klibb.state.selected.id);
    created.add(demoId); created.add(testId);
    assert(testId && demoId, 'två klibbor uppladdade');

    const stamp = (x, y) => page.evaluate(([x, y]) => window.klibb.stampAt(x, y).then((s) => s && s.surface), [x, y]);
    const pick = (id) => page.evaluate((id) => { const k = window.klibb; k.state.selected = k.state.mine.find((m) => m.id === id); }, id);

    // Vägg: titta rakt fram mot norra väggen
    await page.evaluate(() => { window.klibb.moveTo(0, 1); window.klibb.look(0, 0); });
    await pick(demoId);
    await page.evaluate(() => { window.klibb.state.size = 1.0; });
    assert((await stamp(0, 0)) === 'vägg-norr', 'stämpel på vägg');
    // Överlapp: testklibban delvis ovanpå
    await pick(testId);
    await page.evaluate(() => { window.klibb.state.size = 0.6; window.klibb.state.rotation = 20; });
    assert((await stamp(0.035, 0.03)) === 'vägg-norr', 'överlappande stämpel på vägg');
    // Golv
    await page.evaluate(() => { window.klibb.look(0, -1.1); window.klibb.state.rotation = 0; });
    assert((await stamp(0, 0)) === 'golv', 'stämpel på golv');
    // Tak
    await page.evaluate(() => window.klibb.look(0, 1.1));
    const t = await stamp(0, 0);
    assert(t === 'tak', 'stämpel i tak');
    assert((await count(page)) === 4, '4 stämplar i rummet');

    await page.evaluate(() => { window.klibb.moveTo(0.6, -2.6); window.klibb.look(0, -0.05); });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SHOTS, '01-dator-vagg-overlapp.png') });
    await page.evaluate(() => { window.klibb.moveTo(0, 3.5); window.klibb.look(0.35, -0.35); });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, '02-dator-oversikt.png') });

    // Ladda om och kontrollera att allt finns kvar
    await page.reload(); await waitReady(page);
    await page.waitForTimeout(500);
    assert((await count(page)) === 4, 'efter omladdning finns alla 4 kvar');
    const pairs = await page.evaluate(() => [...window.klibb.stamps.meshes.values()]
      .map((m) => [m.userData.stamp.createdAt, m.renderOrder]).sort((a, b) => a[0].localeCompare(b[0])));
    assert(pairs.every((p, i) => i === 0 || p[1] > pairs[i - 1][1]), 'nyare stämplar ritas ovanpå äldre (renderOrder)');
    await page.evaluate(() => { window.klibb.moveTo(0, 0); window.klibb.look(0, -1.2); });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, '03-dator-golv.png') });
    await page.evaluate(() => window.klibb.look(0, 1.2));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, '04-dator-tak.png') });

    // ---------- Vikning över kanter och hörn ----------
    // Ren geometri först: summan av bitarnas yta i bildkoordinater ska vara exakt 1
    // (hela klibban syns, inget dubbelt, inget saknas), och varje bit ska ligga på sin yta.
    const foldCheck = (pos, normal, dir, rot, size, surface) => page.evaluate(([pos, normal, dir, rot, size, surface]) => {
      const k = window.klibb;
      const q = k.orientation(normal, dir, rot);
      const pieces = k.fold(pos, q, size, size, surface);
      const area = (pts) => pts.reduce((s, p, i) => { const r = pts[(i + 1) % pts.length]; return s + p[0] * r[1] - r[0] * p[1]; }, 0) / 2;
      const B = { x: 5, y: [0, 4], z: 5 };
      const onFace = pieces.every((pc) => pc.points.every(([x, y, z]) => {
        const e = 1e-4;
        const inside = x >= -B.x - e && x <= B.x + e && y >= B.y[0] - e && y <= B.y[1] + e && z >= -B.z - e && z <= B.z + e;
        const onPlane = { golv: Math.abs(y), tak: Math.abs(y - 4), 'vägg-norr': Math.abs(z + 5), 'vägg-söder': Math.abs(z - 5), 'vägg-väster': Math.abs(x + 5), 'vägg-öster': Math.abs(x - 5) }[pc.face] < e;
        return inside && onPlane;
      }));
      // Inga sträckningar: avståndet mellan hörn i 3D = avståndet i bilden (gånger storleken).
      const rigid = pieces.every((pc) => pc.points.every((p, i) => {
        const j = (i + 1) % pc.points.length, r = pc.points[j];
        const d3 = Math.hypot(p[0] - r[0], p[1] - r[1], p[2] - r[2]);
        const d2 = Math.hypot(pc.uv[i][0] - pc.uv[j][0], pc.uv[i][1] - pc.uv[j][1]) * size;
        return Math.abs(d3 - d2) < 1e-4;
      }));
      return { faces: [...new Set(pieces.map((p) => p.face))].sort(), uvArea: pieces.reduce((s, p) => s + Math.abs(area(p.uv)), 0), onFace, rigid };
    }, [pos, normal, dir, rot, size, surface]);
    const edge = await foldCheck([0, 0, -4.75], [0, 1, 0], [0, -0.5, -1], 25, 1.0, 'golv');
    assert(edge.faces.join() === 'golv,vägg-norr' && Math.abs(edge.uvArea - 1) < 1e-6 && edge.onFace && edge.rigid,
      `vikning över kant: golv + vägg, hela klibban kvar (${edge.faces.join(' + ')}, yta ${edge.uvArea.toFixed(4)})`);
    const corner = await foldCheck([-4.75, 3.72, -5], [0, 0, 1], [0, 0, -1], 15, 1.0, 'vägg-norr');
    assert(corner.faces.join() === 'tak,vägg-norr,vägg-väster' && Math.abs(corner.uvArea - 1) < 1e-6 && corner.onFace && corner.rigid,
      `vikning i hörn: vägg + vägg + tak (${corner.faces.join(' + ')}, yta ${corner.uvArea.toFixed(4)})`);
    const floorCorner = await foldCheck([4.8, 0, 4.85], [0, 1, 0], [1, -0.5, 1], -30, 0.9, 'golv');
    assert(floorCorner.faces.join() === 'golv,vägg-söder,vägg-öster' && Math.abs(floorCorner.uvArea - 1) < 1e-6 && floorCorner.onFace && floorCorner.rigid,
      `vikning i hörn: golv + vägg + vägg (${floorCorner.faces.join(' + ')})`);
    const middle = await foldCheck([1, 1.5, -5], [0, 0, 1], [0, 0, -1], 0, 0.5, 'vägg-norr');
    assert(middle.faces.join() === 'vägg-norr' && Math.abs(middle.uvArea - 1) < 1e-6, 'klibba mitt på väggen viks inte');

    // Riktiga stämplar vid kant och i hörn, med en rutig klibba så man ser att inget sträcks.
    const gridSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
      <rect width="400" height="400" fill="#ffd400"/>
      ${[...Array(9)].map((_, i) => `<path d="M${i * 50} 0V400M0 ${i * 50}H400" stroke="#222" stroke-width="5"/>`).join('')}
      <rect x="8" y="8" width="384" height="384" fill="none" stroke="#e0245e" stroke-width="16"/>
      <text x="200" y="235" font-family="DejaVu Sans" font-weight="900" font-size="110" text-anchor="middle" fill="#e0245e" stroke="#fff" stroke-width="6" paint-order="stroke">VIK</text></svg>`;
    const gridPng = path.join(__dirname, 'vik-klibba.png');
    await sharp(Buffer.from(gridSvg)).png().toFile(gridPng);
    await page.setInputFiles('#file', gridPng);
    await page.waitForFunction((id) => window.klibb.state.selected && window.klibb.state.selected.id !== id, testId);
    const gridId = await page.evaluate(() => window.klibb.state.selected.id);
    created.add(gridId);
    const stampDirect = (pos, normal, dir, rot, size, surface) => page.evaluate(async ([pos, normal, dir, rot, size, surface]) => {
      const k = window.klibb;
      const r = await fetch(`/api/rooms/e2e-test/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: k.state.selected.id, position: pos, normal, quaternion: k.orientation(normal, dir, rot), size, rotation: rot, surface, artist: 'Testaren' }) }).then((r) => r.json());
      await k.stamps.add(r.stamp, r.image);
      return k.stamps.meshes.get(r.stamp.id).geometry.index.count / 3;
    }, [pos, normal, dir, rot, size, surface]);
    const tris1 = await stampDirect([0, 0, -4.75], [0, 1, 0], [0, -0.5, -1], 25, 1.0, 'golv');
    const tris2 = await stampDirect([-4.75, 3.72, -5], [0, 0, 1], [0, 0, -1], 15, 1.0, 'vägg-norr');
    assert(tris1 > 2 && tris2 > 4 && tris2 < 60, `vikta stämplar har få trianglar (${tris1} och ${tris2}), bra för mobilen`);
    // Överlapp i hörnet: en till ovanpå
    await pick(testId);
    await stampDirect([-4.9, 3.5, -4.6], [1, 0, 0], [-1, 0, 0], -10, 0.6, 'vägg-väster');
    await page.evaluate(() => { document.getElementById('panel').style.visibility = 'hidden'; window.klibb.moveTo(0.4, -2.2); window.klibb.look(0, -0.75); });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, '07-vikt-kant.png') });
    await page.evaluate(() => { window.klibb.moveTo(-3.7, -3.7); window.klibb.look(Math.PI / 4, 0.75); });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, '08-vikt-horn.png') });
    await page.evaluate(() => { document.getElementById('panel').style.visibility = ''; });
    // Förhandsvisningen viks likadant
    const prevTris = await page.evaluate(() => {
      const k = window.klibb; const q = k.orientation([0, 0, 1], [0, 0, -1], 0);
      const THREEq = k.camera.quaternion.constructor, V = k.camera.position.constructor;
      k.preview.show(new V(-4.8, 3.8, -5), new V(0, 0, 1), new THREEq(...q), 0.8, 0.8, 'vägg-norr');
      return k.preview.mesh.geometry.index.count / 3;
    });
    assert(prevTris >= 3 * 2, `förhandsvisningen viks också i hörnet (${prevTris} trianglar)`);
    await page.evaluate(() => window.klibb.preview.hide());
    const stampsNow = await count(page);
    await page.reload(); await waitReady(page); await page.waitForTimeout(300);
    assert((await count(page)) === stampsNow, `vikta stämplar finns kvar efter omladdning (${stampsNow})`);

    // Admin-läget: rätt nyckel visar bannern, fel nyckel gör det inte
    await page.goto(`${BASE}/?room=${ROOM}&admin=fel`); await waitReady(page);
    assert(await page.isHidden('#admin-banner'), 'fel admin-nyckel avvisas');
    await page.goto(`${BASE}/?room=${ROOM}&admin=${TOKEN}`); await waitReady(page);
    await page.waitForSelector('#admin-banner', { state: 'visible' });
    assert(!page.url().includes(TOKEN), 'admin-nyckeln tas bort ur adressfältet');
    await ctx.close();

    // ---------- Mobil ----------
    const mctx = await browser.newContext({ ...devices['Pixel 7'] });
    const m = await mctx.newPage();
    m.on('pageerror', (e) => console.log('sidfel (mobil):', e.message));
    await m.goto(`${BASE}/?room=${ROOM}`); await waitReady(m);
    assert(await m.isVisible('#joystick'), 'mobil: styrspak syns');
    await m.setInputFiles('#file', testPng);
    await m.waitForFunction(() => window.klibb.state.selected);
    created.add(await m.evaluate(() => window.klibb.state.selected.id));
    await m.screenshot({ path: path.join(SHOTS, '05-mobil-meny.png') });
    await m.tap('#panel-toggle');
    await m.evaluate(() => { window.klibb.moveTo(0, 1.5); window.klibb.look(0, 0); });
    const vp = m.viewportSize();
    const mBefore = await m.evaluate(() => window.klibb.stamps.count);
    await m.touchscreen.tap(vp.width * 0.7, vp.height * 0.35);
    await m.waitForFunction((n) => window.klibb.stamps.count === n + 1, mBefore, { timeout: 5000 });
    assert(true, 'mobil: tryck på skärmen stämplar');
    // Styrspaken flyttar kameran
    const before = await m.evaluate(() => window.klibb.camera.position.z);
    const jb = await m.locator('#joystick').boundingBox();
    const cdp = await mctx.newCDPSession(m);
    const cx = jb.x + jb.width / 2, cy = jb.y + jb.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - 45 }] });
    await m.waitForTimeout(600);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const after = await m.evaluate(() => window.klibb.camera.position.z);
    assert(after < before - 0.3, `mobil: styrspaken går framåt (${before.toFixed(2)} → ${after.toFixed(2)})`);
    await m.waitForTimeout(300);
    await m.screenshot({ path: path.join(SHOTS, '06-mobil-rum.png') });
    await mctx.close();
  } finally {
    // Städa: ta bort testbilderna (och därmed alla teststämplar) via admin-API:t
    for (const id of created) {
      await fetch(`${BASE}/api/stickers/${id}`, { method: 'DELETE', headers: { 'x-admin-token': TOKEN } });
    }
    const left = await (await fetch(`${BASE}/api/rooms/${ROOM}/stamps`)).json();
    console.log(left.stamps.length === 0 ? '✔ teststämplar borttagna' : 'FEL: stämplar kvar');
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });

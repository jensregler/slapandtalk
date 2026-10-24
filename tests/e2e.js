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

    // ---------- R växlar mellan mina designs ----------
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    const designState = () => page.evaluate(() => ({ sel: window.klibb.state.selected && window.klibb.state.selected.id,
      hud: document.getElementById('design-hud-img').getAttribute('src'), num: document.getElementById('design-hud-num').textContent,
      hudVisible: !document.getElementById('design-hud').hidden, n: window.klibb.designs().length }));
    const d0 = await designState();
    assert(d0.n === 3 && d0.hudVisible, `designrutan syns (${d0.num})`);
    const seen = [d0.sel];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('r');
      await page.waitForTimeout(150);
      const d = await designState();
      seen.push(d.sel);
      const idx = await page.evaluate((id) => window.klibb.designs().findIndex((x) => x.id === id), d.sel);
      assert(d.sel !== seen[seen.length - 2] && d.hud.includes(d.sel) && d.num === `${idx + 1}/3`, `R nr ${i + 1}: byter design och rutan visar den (${d.num})`);
    }
    assert(new Set(seen.slice(0, 3)).size === 3 && seen[3] === seen[0], 'R går igenom alla 3 designs och börjar om');
    const previewOk = await page.evaluate(() => {
      const map = window.klibb.preview.mat.map; return !!map && map.image.src.includes(window.klibb.state.selected.id);
    });
    assert(previewOk, 'förhandsvisningen byter bild direkt');
    await page.keyboard.press('r'); await page.waitForTimeout(200);
    await page.evaluate(() => { const k = window.klibb; k.moveTo(-1, -2.5); k.look(0.3, 0.1);
      k.preview.show(new k.camera.position.constructor(-1.4, 1.9, -5), new k.camera.position.constructor(0, 0, 1),
        new k.camera.quaternion.constructor(...k.orientation([0, 0, 1], [0, 0, -1], 0)), 0.6, 0.6, 'vägg-norr'); });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, '09-design-dator.png') });
    await page.evaluate(() => window.klibb.preview.hide());

    // ---------- Designs som inte finns kvar på servern ----------
    await page.evaluate(() => {
      const mine = JSON.parse(localStorage.getItem('klibb.mine'));
      mine.push({ id: 'deadbeefdeadbeef', url: '/uploads/deadbeefdeadbeef.webp', width: 100, height: 100 });
      localStorage.setItem('klibb.mine', JSON.stringify(mine));
    });
    await page.reload(); await waitReady(page);
    const afterDead = await page.evaluate(() => ({ ids: window.klibb.state.mine.map((m) => m.id), sel: window.klibb.state.selected && window.klibb.state.selected.id }));
    assert(!afterDead.ids.includes('deadbeefdeadbeef') && afterDead.ids.length === 3 && afterDead.sel && afterDead.sel !== 'deadbeefdeadbeef',
      'en sparad design som är borta från servern tas bort ur listan');
    const okAdd = await page.evaluate(async () => {
      const k = window.klibb, n = k.stamps.count;
      await k.stamps.add({ id: 'trasig', order: 999, position: [0, 1, -5], quaternion: [0, 0, 0, 1], size: 0.5, surface: 'vägg-norr' },
        { id: 'deadbeefdeadbeef', url: '/uploads/deadbeefdeadbeef.webp', width: 1, height: 1 });
      return k.stamps.count === n;
    });
    assert(okAdd, 'en stämpel med saknad bild hoppas över utan fel');
    const dead = await fetch(`${BASE}/api/rooms/${ROOM}/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId: 'deadbeefdeadbeef', position: [0, 1, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.5 }) });
    assert(dead.status === 410, 'servern vägrar stämpla en design som är borta (410)');
    // Bildfilen försvinner men stämpeln ligger kvar (som efter en omstart på Render). Bara lokalt.
    const UPLOADS = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'uploads');
    if (/localhost|127\.0\.0\.1/.test(BASE) && fs.existsSync(UPLOADS)) {
      // en egen bild (unik färg), eftersom samma bild annars blir samma design som de andra testbilderna
      const uniq = await sharp({ create: { width: 64, height: 64, channels: 4, background: `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}` } }).png().toBuffer();
      const fd = new FormData();
      fd.append('file', new Blob([uniq], { type: 'image/png' }), 'x.png');
      const img = await (await fetch(`${BASE}/api/stickers`, { method: 'POST', body: fd })).json();
      created.add(img.id);
      await fetch(`${BASE}/api/rooms/${ROOM}/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: img.id, position: [2, 1, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.5, surface: 'vägg-norr' }) });
      const withIt = (await (await fetch(`${BASE}/api/rooms/${ROOM}/stamps`)).json()).stamps.length;
      fs.rmSync(path.join(UPLOADS, img.id + '.webp'));
      const without = (await (await fetch(`${BASE}/api/rooms/${ROOM}/stamps`)).json()).stamps.length;
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.reload(); await waitReady(page);
      assert(without === withIt - 1 && (await count(page)) === without && !errors.length,
        `stämplar vars bildfil saknas hoppas över och rummet laddas ändå (${withIt} → ${without})`);
    }

    // ---------- Ett nytt rum är helt tomt ----------
    const fresh = 'nytt-' + Date.now().toString(36);
    const freshApi = await (await fetch(`${BASE}/api/rooms/${fresh}/stamps`)).json();
    await page.goto(`${BASE}/?room=${fresh}`); await waitReady(page);
    assert(freshApi.stamps.length === 0 && (await count(page)) === 0, `ett nytt rum (${fresh}) är helt tomt`);

    // ---------- Rumsmenyn: nytt snabbrum, dela länk, till Staden ----------
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    const roomUi = () => page.evaluate(() => ({ room: window.klibb.room, badge: document.getElementById('room-type').textContent,
      hud: document.getElementById('room-hud').textContent, note: document.getElementById('room-note').textContent,
      toStad: !document.getElementById('to-stad').hidden }));
    await page.click('#new-room');
    await page.waitForURL(/\?room=[a-z2-9]{6}$/); await waitReady(page);
    const q = await roomUi();
    assert(q.badge === 'Snabbrum' && q.hud === `Snabbrum · ${q.room}` && q.toStad && /24 timmar/.test(q.note) && (await count(page)) === 0,
      `knappen Nytt snabbrum skapar ett tomt rum (${q.room}) och visar typen`);
    const qInfo = await (await fetch(`${BASE}/api/rooms/${q.room}`)).json();
    assert(qInfo.room.type === 'quick' && qInfo.room.createdAt, 'snabbrummet är sparat på servern som typ quick');
    await page.click('#share-room');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert(clip === `${new URL(BASE).origin}/?room=${q.room}`, `Dela länk kopierar länken (${clip})`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, '11-rum-meny.png') });
    await page.click('#to-stad');
    await page.waitForURL((u) => !u.search.includes('room=')); await waitReady(page);
    const st = await roomUi();
    assert(st.room === 'stad' && st.badge === 'Staden' && st.hud === 'Staden' && !st.toStad, 'Till Staden tar en tillbaka till Staden');

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
    assert((await m.textContent('#room-hud')) === 'Snabbrum · e2e-test' && await m.isVisible('#new-room'), 'mobil: rumsmenyn och rumsetiketten syns');
    await m.waitForFunction(() => !document.getElementById('toast').classList.contains('show'), null, { timeout: 5000 });
    await m.waitForTimeout(300);
    await m.screenshot({ path: path.join(SHOTS, '12-rum-meny-mobil.png') });
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
    // Mobil: den runda knappen byter design
    await m.setInputFiles('#file', gridPng);
    await m.waitForFunction(() => window.klibb.state.mine.length === 2);
    created.add(await m.evaluate(() => window.klibb.state.selected.id));
    const sel = () => m.evaluate(() => [window.klibb.state.selected.id, document.getElementById('design-btn-num').textContent]);
    const s0 = await sel();
    assert(await m.isVisible('#design-btn'), `mobil: designknappen syns (${s0[1]})`);
    await m.tap('#design-btn'); await m.waitForTimeout(150);
    const s1 = await sel();
    await m.tap('#design-btn'); await m.waitForTimeout(150);
    const s2 = await sel();
    assert(s1[0] !== s0[0] && s2[0] === s0[0] && s1[1] === '2/2', 'mobil: tryck på designknappen byter design och börjar om');
    assert((await m.evaluate(() => window.klibb.stamps.count)) === mBefore + 1, 'mobil: knappen stämplar inte av misstag');
    // Mobil: ögat växlar Tittläge, tryck stämplar inte då
    assert(await m.isVisible('#mode-btn'), 'mobil: ögonknappen syns');
    await m.tap('#mode-btn'); await m.waitForTimeout(200);
    const mv = await m.evaluate(() => [window.klibb.state.mode, getComputedStyle(document.getElementById('design-btn')).opacity, window.klibb.stamps.count]);
    await m.touchscreen.tap(vp.width * 0.4, vp.height * 0.3); await m.waitForTimeout(700);
    const mvc = await m.evaluate(() => window.klibb.stamps.count);
    assert(mv[0] === 'view' && Number(mv[1]) < 0.6 && mvc === mv[2], 'mobil: 👁 ger Tittläge, designknappen dämpas och tryck stämplar inte');
    await m.waitForFunction(() => !document.getElementById('toast').classList.contains('show'), null, { timeout: 5000 });
    await m.screenshot({ path: path.join(SHOTS, '14-tittlage-mobil.png') });
    await m.tap('#mode-btn'); await m.waitForTimeout(200);
    await m.touchscreen.tap(vp.width * 0.4, vp.height * 0.3);
    await m.waitForFunction((n) => window.klibb.stamps.count === n + 1, mvc, { timeout: 5000 });
    assert((await m.evaluate(() => window.klibb.state.mode)) === 'slap', 'mobil: 👁 igen ger Klibbläge och tryck stämplar');
    // Mobil: ↩ peelar min senaste
    const pc = await m.evaluate(() => [window.klibb.stamps.count, window.klibb.roomHistory().length]);
    await m.screenshot({ path: path.join(SHOTS, '16-peel-mobil.png') });
    await m.tap('#peel-btn'); await m.waitForTimeout(500);
    const pc2 = await m.evaluate(() => [window.klibb.stamps.count, window.klibb.roomHistory().length]);
    assert(await m.isVisible('#peel-btn') && pc[1] >= 1 && pc2[0] === pc[0] - 1 && pc2[1] === pc[1] - 1, 'mobil: ↩ peelar min senaste klibba');
    await m.waitForTimeout(300);
    await m.screenshot({ path: path.join(SHOTS, '06-mobil-rum.png') });
    await m.tap('#design-btn'); await m.waitForTimeout(300);
    await m.screenshot({ path: path.join(SHOTS, '10-design-mobil.png') });
    await mctx.close();

    // ---------- Designs ska inte försvinna (Jens: "laddade upp 4 men 2 försvann") ----------
    const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const d = await dctx.newPage();
    d.on('pageerror', (e) => console.log('sidfel (designs):', e.message));
    await d.goto(`${BASE}/?room=${ROOM}`); await waitReady(d);
    const colors = ['#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00897b'];
    const pngs = [];
    for (const [i, c] of colors.entries()) {
      const f = path.join(require('os').tmpdir(), `klibb-design-${i}.png`);
      await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" rx="40" fill="${c}"/>
        <text x="150" y="190" font-family="DejaVu Sans" font-weight="900" font-size="150" text-anchor="middle" fill="#fff">${i + 1}</text></svg>`)).png().toFile(f);
      pngs.push(f);
    }
    const mineIds = () => d.evaluate(() => window.klibb.state.mine.map((m) => m.id).sort());
    for (const f of pngs.slice(0, 4)) {
      const n = (await mineIds()).length;
      await d.setInputFiles('#file', f);
      await d.waitForFunction((n) => window.klibb.state.mine.length === n + 1, n);
    }
    const four = await mineIds();
    four.forEach((id) => created.add(id));
    assert(four.length === 4, '4 olika designs uppladdade');
    // Stämpla om och om igen och tryck R mitt i (även innan servern hunnit svara).
    await d.evaluate(async () => {
      const k = window.klibb, jobs = [];
      for (let i = 0; i < 12; i++) {
        k.look(-0.6 + i * 0.1, -0.1 + (i % 3) * 0.1);
        jobs.push(k.stampAt(0, 0));
        k.nextDesign();
        await new Promise((r) => setTimeout(r, 40));
      }
      await Promise.all(jobs);
    });
    await d.reload(); await waitReady(d);
    assert((await mineIds()).join() === four.join(), 'efter 12 stämplar med R och omladdning finns alla 4 kvar');

    // Kontrollen mot servern går fel på olika sätt: ingen design får försvinna.
    const failures = [
      ['serverfel 500', (r) => r.fulfill({ status: 500, body: '{"error":"x"}', contentType: 'application/json' })],
      ['för många förfrågningar 429', (r) => r.fulfill({ status: 429, body: '{"error":"Lugn i stormen"}', contentType: 'application/json' })],
      ['nätverksfel', (r) => r.abort('failed')],
      ['svar utan "missing" (gammal server)', (r) => r.fulfill({ status: 200, body: '{"images":{}}', contentType: 'application/json' })],
      ['trasigt svar (kallstart)', (r) => r.fulfill({ status: 200, body: '<html>Service waking up</html>', contentType: 'text/html' })],
    ];
    for (const [name, handler] of failures) {
      await d.route('**/api/stickers?ids=*', handler);
      await d.reload(); await waitReady(d);
      await d.unroute('**/api/stickers?ids=*');
      assert((await mineIds()).join() === four.join(), `kontrollen misslyckas (${name}): alla 4 finns kvar`);
    }
    // Långsam kontroll medan man laddar upp en femte design.
    await d.route('**/api/stickers?ids=*', async (r) => { await new Promise((ok) => setTimeout(ok, 2500)); await r.continue(); });
    await d.reload();
    await d.waitForFunction(() => window.klibb && window.klibb.state);
    await d.setInputFiles('#file', pngs[4]);
    await d.waitForFunction(() => window.klibb.state.mine.length === 5);
    await waitReady(d);
    await d.unroute('**/api/stickers?ids=*');
    const five = await mineIds();
    five.forEach((id) => created.add(id));
    assert(five.length === 5 && four.every((id) => five.includes(id)), 'en uppladdning under en långsam kontroll tas inte bort (5 kvar)');

    // Servern tappar 2 designs (som efter en omstart på Render): de laddas upp igen från enheten.
    const del = (id) => fetch(`${BASE}/api/stickers/${id}`, { method: 'DELETE', headers: { 'x-admin-token': TOKEN } });
    await del(five[0]); await del(five[1]);
    await d.reload(); await waitReady(d);
    await d.waitForFunction(() => /laddades upp igen/.test(document.getElementById('toast').textContent), null, { timeout: 8000 });
    const onServer = await (await fetch(`${BASE}/api/stickers?ids=${five.join(',')}`)).json();
    assert((await mineIds()).join() === five.join() && Object.keys(onServer.images).length === 5,
      'designs som servern tappat laddas upp igen automatiskt, alla 5 kvar med samma id');
    // Servern tappar designen mitt under stämplingen (svar 410): den återställs och stämpeln sätts ändå.
    const selId = await d.evaluate(() => window.klibb.state.selected.id);
    await del(selId);
    const stamped = await d.evaluate(() => { window.klibb.look(0.2, 0); return window.klibb.stampAt(0, 0).then((s) => s && s.imageId); });
    assert(stamped === selId && (await mineIds()).join() === five.join(), 'stämpling när servern tappat designen: återställs och stämplas, inget försvinner');
    // En 410 för en design rör inte de andra, även om man hunnit trycka R.
    const two = await d.evaluate(() => window.klibb.designs().slice(0, 2).map((x) => x.id));
    await d.route('**/api/rooms/*/stamps', (r) => (r.request().method() === 'POST' && JSON.parse(r.request().postData()).imageId === two[0]
      ? r.fulfill({ status: 410, body: '{"error":"borta","gone":true}', contentType: 'application/json' }) : r.continue()), { times: 1 });
    await d.evaluate((id) => { const k = window.klibb; k.state.selected = k.state.mine.find((m) => m.id === id); const p = k.stampAt(0, 0); k.nextDesign(); return p; }, two[0]);
    await d.waitForTimeout(500);
    assert((await mineIds()).join() === five.join(), 'ett 410-svar för en design tar inte bort någon annan design');

    // ---------- Största storlek = väggens höjd ----------
    const cap = await d.evaluate(() => {
      const k = window.klibb;
      const r = { max: k.maxSizeCm, sliderMax: document.getElementById('size').max };
      k.setSize(1000); r.after = k.state.size; r.slider = document.getElementById('size').value;
      r.toast = document.getElementById('toast').textContent;
      return r;
    });
    assert(cap.max === 400 && cap.sliderMax === '400' && cap.after === 4 && cap.slider === '400' && /Max storlek/.test(cap.toast),
      `storleken stannar vid väggens höjd, räknad ur rummet (${cap.max} cm), med meddelande`);
    // Scrollhjulet: låst mus, scrolla uppåt många gånger
    await d.evaluate(() => { window.klibb.setSize(300); window.klibb.moveTo(0, 0); window.klibb.look(0, 0); });
    await d.mouse.click(900, 400); await d.waitForTimeout(200);
    for (let i = 0; i < 15; i++) await d.mouse.wheel(0, -200);
    await d.waitForTimeout(200);
    const wheelSize = await d.evaluate(() => window.klibb.state.size);
    // En mycket bred design: längsta sidan (bredden) får inte bli längre än väggens höjd
    await d.evaluate(() => { const k = window.klibb; k.state.size = 9; k.state.rotation = 0; });
    const wideStamp = await d.evaluate(() => window.klibb.stampAt(0, 0).then((s) => s && { id: s.id, size: s.size }));
    const wide = wideStamp && wideStamp.size;
    // Klibbans längsta sida räknas i dess eget plan (bildkoordinater × mått), oberoende av hur den är vriden i rummet.
    const dimsOk = await d.evaluate((id) => { const k = window.klibb, m = k.stamps.meshes.get(id);
      return Math.max(...k.stamps.constructor.dims(m.userData.image, m.userData.stamp.size)); }, wideStamp.id);
    // En mycket bred design (10:1): längsta sidan, bredden, blir också högst väggens höjd.
    const wideDims = await d.evaluate(() => { const k = window.klibb; return k.stamps.constructor.dims({ width: 1000, height: 100 }, Math.min(9, k.maxSizeCm / 100)); });
    await d.evaluate(() => { const k = window.klibb; k.setSize(30); k.controls.unlock(); });
    assert(wheelSize === 4 && wide === 4 && dimsOk <= 4 + 1e-3 && wideDims[0] === 4 && Math.abs(wideDims[1] - 0.4) < 1e-9,
      `scroll stannar vid 4 m, en stämpel blir högst 4 m (${dimsOk.toFixed(2)} m) och en bred design högst 4 m bred`);

    // ---------- Peel (ångra) och historik ----------
    const hist = () => d.evaluate(() => ({ n: window.klibb.roomHistory().length, count: window.klibb.stamps.count,
      items: document.querySelectorAll('#history-list li').length, toast: document.getElementById('toast').textContent }));
    const stampN = (n) => d.evaluate(async (n) => { const k = window.klibb; const out = [];
      for (let i = 0; i < n; i++) { k.look(-0.4 + i * 0.2, 0.15); out.push((await k.stampAt(0, 0)).id); k.nextDesign(); } return out; }, n);
    await d.evaluate(() => { const k = window.klibb; k.moveTo(0, -1); k.setSize(40); k.state.rotation = 0; localStorage.removeItem('klibb.history'); });
    await d.reload(); await waitReady(d);
    await d.evaluate(() => { const k = window.klibb; k.moveTo(0, -1); k.setSize(40); });
    const h0 = await hist();
    await stampN(3);
    const h1 = await hist();
    assert(h1.n === 3 && h1.items === 3 && h1.count === h0.count + 3, 'tre egna klibbor syns i historiken');
    await d.evaluate(() => document.activeElement && document.activeElement.blur());
    await d.keyboard.press('z'); await d.waitForTimeout(400);
    const h2 = await hist();
    await d.evaluate(() => window.klibb.setMode('view', { quiet: true }));
    await d.keyboard.press('Control+z'); await d.waitForTimeout(400);
    const h3 = await hist();
    // Cmd+Z (Mac): Linux-webbläsaren i testet skickar inte Cmd-kombinationer, så händelsen skickas direkt.
    await d.evaluate(() => dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, bubbles: true })));
    await d.waitForTimeout(400);
    const h4 = await hist();
    await d.keyboard.press('z'); await d.waitForTimeout(400);
    const h5 = await hist();
    await d.evaluate(() => window.klibb.setMode('slap', { quiet: true }));
    assert(h2.count === h1.count - 1 && /Peelad/.test(h2.toast) && h3.count === h1.count - 2 && h4.count === h1.count - 3 && h4.n === 0,
      'Z, Ctrl+Z och Cmd+Z peelar senaste klibban en i taget (även i Tittläge)');
    assert(h5.count === h4.count && /Inga fler egna klibbor här/.test(h5.toast), 'när inga egna finns kvar: "Inga fler egna klibbor här"');
    // Z medan man skriver: ingen peel
    await stampN(1);
    await d.fill('#artist', ''); await d.type('#artist', 'Zorro');
    const hz = await hist();
    assert(hz.n === 1 && hz.count === h5.count + 1, 'Z gör ingenting medan man skriver');
    await d.fill('#artist', 'Testaren'); await d.evaluate(() => document.activeElement.blur());
    // Någon annans stämpel: finns inte i min historik, och fel nyckel nekas
    const otherStamp = await (await fetch(`${BASE}/api/rooms/${ROOM}/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId: four[0], position: [3, 1, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.5, surface: 'vägg-norr' }) })).json();
    const steal = await d.evaluate((id) => fetch(`/api/rooms/e2e-test/peel`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ id, token: 'gissning' }] }) }).then((r) => r.json()), otherStamp.stamp.id);
    const listing = await (await fetch(`${BASE}/api/rooms/${ROOM}/stamps`)).text();
    assert(steal.results[otherStamp.stamp.id] === 'forbidden' && !listing.includes(otherStamp.peelToken) && !listing.includes('peelHash'),
      'man kan inte peela någon annans klibba, och nycklarna syns inte i rummets data');
    // Historiklistan: ✕ på en post, sedan "Peela alla" med bekräftelse
    await stampN(3);
    const hBefore = await hist();
    const secondId = await d.evaluate(() => document.querySelectorAll('#history-list li')[1].dataset.id);
    await d.click('#history-list li:nth-child(2) button'); await d.waitForTimeout(500);
    const afterX = await d.evaluate((id) => ({ gone: !window.klibb.stamps.meshes.has(id), n: window.klibb.roomHistory().length }), secondId);
    assert(afterX.gone && afterX.n === hBefore.n - 1, '✕ i historiken peelar just den klibban');
    await stampN(2);
    await d.evaluate(() => { const k = window.klibb; k.moveTo(0, 2.5); k.look(0, 0.12); });
    await d.hover('#history-list li:nth-child(2)'); await d.waitForTimeout(300);
    await d.screenshot({ path: path.join(SHOTS, '15-historik-dator.png') });
    const pre = await hist();
    await d.click('#peel-all'); await d.waitForTimeout(300);
    const ask = await d.evaluate(() => [document.getElementById('peel-all').textContent, window.klibb.stamps.count]);
    assert(/Säker/.test(ask[0]) && ask[1] === pre.count, '"Peela alla" frågar först och tar inte bort något');
    await d.click('#peel-all'); await d.waitForTimeout(800);
    const allGone = await hist();
    assert(allGone.n === 0 && allGone.items === 0 && allGone.count === pre.count - pre.n && /Peelade/.test(allGone.toast),
      `"Peela alla" (andra trycket) tar bort alla mina ${pre.n} men inga andras`);
    // Historik för stämplar som inte finns längre rensas tyst bort
    await d.evaluate(() => { const h = JSON.parse(localStorage.getItem('klibb.history') || '[]');
      h.push({ room: 'e2e-test', stampId: 'aaaaaaaaaaaaaaaa', token: 'x', designId: 'x', url: '', time: new Date().toISOString() });
      localStorage.setItem('klibb.history', JSON.stringify(h)); });
    await d.reload(); await waitReady(d);
    assert((await hist()).n === 0, 'historik för stämplar som inte finns längre rensas bort');

    // ---------- Klibbläge / Tittläge (V) ----------
    const modeInfo = () => d.evaluate(() => ({ mode: window.klibb.state.mode, hud: document.getElementById('mode-hud').textContent,
      preview: window.klibb.preview.mesh.visible, count: window.klibb.stamps.count, size: window.klibb.state.size,
      rot: window.klibb.state.rotation, sel: window.klibb.state.selected && window.klibb.state.selected.id, locked: window.klibb.controls.locked }));
    await d.evaluate(() => { window.klibb.moveTo(1, 0); window.klibb.look(0, 0.05); });
    await d.mouse.click(900, 400); // första klicket låser musen (stämplar inte)
    await d.waitForTimeout(300);
    const m0 = await modeInfo();
    assert(m0.locked && m0.mode === 'slap' && m0.hud === 'Klibbläge · V' && m0.preview, 'Klibbläge från början: pekaren syns');
    await d.keyboard.press('v'); await d.waitForTimeout(200);
    const m1 = await modeInfo();
    assert(m1.mode === 'view' && m1.hud === 'Tittläge · V' && !m1.preview, 'V slår på Tittläge och döljer pekaren');
    await d.mouse.click(900, 400); await d.waitForTimeout(400);
    await d.mouse.wheel(0, 300); await d.keyboard.press('q'); await d.keyboard.press('e'); await d.keyboard.press('q');
    await d.waitForTimeout(200);
    const m2 = await modeInfo();
    assert(m2.count === m1.count && m2.size === m1.size && m2.rot === m1.rot && !m2.preview, 'Tittläge: klick stämplar inte, scroll och Q/E ändrar inget');
    await d.keyboard.press('r'); await d.waitForTimeout(200);
    const m3 = await modeInfo();
    assert(m3.sel !== m2.sel && m3.mode === 'view' && !m3.preview, 'R byter design men man stannar i Tittläge');
    await d.evaluate(() => { window.klibb.moveTo(0, 2.5); window.klibb.look(0.15, 0.05); });
    await d.waitForFunction(() => !document.getElementById('toast').classList.contains('show'), null, { timeout: 5000 });
    await d.waitForTimeout(300);
    await d.screenshot({ path: path.join(SHOTS, '13-tittlage-dator.png') });
    await d.keyboard.press('v'); await d.waitForTimeout(200);
    await d.mouse.click(900, 400);
    await d.waitForFunction((n) => window.klibb.stamps.count === n + 1, m3.count, { timeout: 5000 });
    const m4 = await modeInfo();
    assert(m4.mode === 'slap' && m4.preview && m4.count === m3.count + 1, 'V igen: Klibbläge, pekaren syns och klick stämplar igen');
    await d.evaluate(() => window.klibb.controls.unlock()); // som Esc
    await d.waitForFunction(() => !window.klibb.controls.locked);
    await d.fill('#artist', ''); await d.type('#artist', 'Viva');
    const typed = await d.evaluate(() => [window.klibb.state.mode, document.getElementById('artist').value]);
    assert(typed[0] === 'slap' && typed[1] === 'Viva', 'V gör ingenting medan man skriver i ett textfält');
    await d.keyboard.press('Control+v'); // klistra in: ska inte heller växla
    assert((await d.evaluate(() => window.klibb.state.mode)) === 'slap', 'Ctrl+V växlar inte läge');
    await d.fill('#artist', 'Testaren');
    await dctx.close();
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

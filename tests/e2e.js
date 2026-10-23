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
    await m.touchscreen.tap(vp.width * 0.7, vp.height * 0.35);
    await m.waitForFunction(() => window.klibb.stamps.count === 5, null, { timeout: 5000 });
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

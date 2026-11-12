// E2E (Jens t864u, 12 Nov 2026): day again + a DAY / NIGHT button, the front page goes straight into a new city
// with a fictional name, the Town Hall's one rename, and Export city → Import city into a FRESH local server
// (both servers in LOCAL_MODE: the local admin key is used by itself). Big screenshots to DAYTOWNHALL_SHOTS.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT_A = Number(process.env.DAYTOWNHALL_E2E_PORT || 8961), PORT_B = PORT_A + 1;
const SHOTS = process.env.DAYTOWNHALL_SHOTS || '/workspace/day-townhall/shots';
const ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const BUILD = 'stad-byggen';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 900) : '')); } };

async function seed(dir, n = 60) {
  const svg = (col) => `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><circle cx="128" cy="128" r="110" fill="${col}" stroke="#111" stroke-width="14"/></svg>`;
  const designs = [];
  fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true }); fs.mkdirSync(path.join(dir, 'images'), { recursive: true }); fs.mkdirSync(path.join(dir, 'rooms'), { recursive: true });
  for (const col of ['#e8312f', '#2f6fe8', '#f2c12e']) {
    const webp = await sharp(Buffer.from(svg(col))).webp({ quality: 92 }).toBuffer();
    const id = crypto.createHash('sha256').update(webp).digest('hex').slice(0, 16);
    fs.writeFileSync(path.join(dir, 'uploads', `${id}.webp`), webp);
    const meta = { id, url: `/uploads/${id}.webp`, width: 256, height: 256, artist: 'E2E', createdAt: new Date().toISOString() };
    fs.writeFileSync(path.join(dir, 'images', `${id}.json`), JSON.stringify(meta)); designs.push(meta);
  }
  const q = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]; // flat on the ground
  const stamps = Array.from({ length: n }, (_, k) => ({ id: crypto.randomBytes(8).toString('hex'), order: k + 1, createdAt: new Date().toISOString(), imageId: designs[k % 3].id,
    position: [-3 + (k % 10) * 0.6, 0, 12.6 + Math.floor(k / 10) * 0.6], normal: [0, 1, 0], quaternion: q, size: 0.55, rotation: 0, surface: 'golv', artist: 'E2E' }));
  fs.writeFileSync(path.join(dir, 'rooms', `${BUILD}.json`), JSON.stringify({ id: BUILD, type: 'stad', name: 'Build city', geo: 'city-2', createdAt: new Date().toISOString(), lastVisitAt: new Date().toISOString(), stamps }));
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-dth-a-')), dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-dth-b-'));
  await seed(dirA);
  const env = { DEMO_PROFILE: '0', OPEN_ACCESS: '1', LOCAL_MODE: '1', ADMIN_TOKEN: '', SURFACE_TEX_IDLE_MS: '1500' };
  const A = await startServer(PORT_A, { ...env, DATA_DIR: dirA });
  const B = await startServer(PORT_B, { ...env, DATA_DIR: dirB });
  const browser = await chromium.launch({ args: ARGS });
  const errors = [];
  const ready = (P) => P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 90000 });
  const page = async (base, w = 1600, h = 1000) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, acceptDownloads: true });
    await ctx.addInitScript(() => { localStorage.setItem('klibb.avatar', JSON.stringify({ name: 'Jens', look: { outfit: 'casual', hair: 'short', shirt: '#3a7bd5', pants: '#333333', hairColor: '#3b2a1a', skin: '#e0b48c', hat: false, hatColor: '#d33' } })); });
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    return { ctx, P };
  };
  const shot = (P, f) => P.screenshot({ path: path.join(SHOTS, f) });
  const escOpen = (P) => P.evaluate(() => { const k = window.klibb; if (k.escGate) k.escGate.unlockedAt = -1e9; k.escMenu().open(); });
  try {
    // ---- 1. the front page: straight into a new city, no name asked ----
    const { P } = await page(A.base);
    let sawName = false;
    await P.goto(`${A.base}/?start=1`);
    await P.waitForSelector('#sc-splash', { timeout: 20000 }); await sleep(400);
    await shot(P, '1-front-page.png');
    P.on('framenavigated', () => {});
    const watch = setInterval(() => { P.evaluate(() => !!document.getElementById('sc-cityname')).then((v) => { if (v) sawName = true; }).catch(() => {}); }, 60);
    await P.keyboard.press('Enter');
    await P.waitForFunction(() => window.klibb && window.klibb.ready && /room=stad-/.test(location.search), null, { timeout: 90000 });
    clearInterval(watch);
    const city = await P.evaluate(() => new URLSearchParams(location.search).get('room'));
    const info = await (await fetch(`${A.base}/api/cities/${city}`)).json();
    check('front page: Enter goes straight into a new city – no "name the city" step', !sawName && /^stad-[a-z0-9]{6}$/.test(city), { sawName, city });
    check(`the new city got a fictional name ("${info.city.name}") and can be renamed once`, !!info.city.name && info.city.name !== 'A city' && info.city.canRename === true, info.city);

    // ---- 2. day by default; DAY / NIGHT in the Esc menu ----
    await P.evaluate(() => { const k = window.klibb; k.moveTo(0, 30); k.camera.position.y = 1.6; k.look(Math.PI, 0.15); }); await sleep(2500);
    let look = await P.evaluate(() => window.klibb.cityLook());
    check('the city is DAY by default (light-blue sky)', look.time === 'day' && look.sky === 'bfe2f6' && look.stored === 'day', look);
    await shot(P, '2-city-day.png');
    await escOpen(P); await sleep(700);
    let esc = await P.evaluate(() => window.klibb.escMenu().info());
    check('Esc menu has a DAY / NIGHT button (shows DAY now)', esc.buttons.includes('daynight') && /DAY/.test(esc.dayNightLabel), esc);
    await shot(P, '3-esc-menu-day.png');
    await P.click('[data-esc="daynight"]'); await sleep(600);
    look = await P.evaluate(() => window.klibb.cityLook()); esc = await P.evaluate(() => window.klibb.escMenu().info());
    check('click → NIGHT: black sky, the button says NIGHT, the menu stays open, remembered', look.time === 'night' && look.sky === '000000' && look.stored === 'night' && esc.open && /NIGHT/.test(esc.dayNightLabel), { look, esc: esc.dayNightLabel });
    await shot(P, '4-esc-menu-night.png');
    await P.evaluate(() => window.klibb.escMenu().close()); await sleep(800);
    await shot(P, '5-city-night.png');
    await P.reload(); await ready(P); await sleep(1000);
    look = await P.evaluate(() => window.klibb.cityLook());
    check('after a reload it is still night (localStorage, per player)', look.time === 'night' && look.sky === '000000', look);
    await escOpen(P); await sleep(500); await P.click('[data-esc="daynight"]'); await sleep(300);
    look = await P.evaluate(() => window.klibb.cityLook());
    check('click again → back to day', look.time === 'day' && look.sky === 'bfe2f6', look);
    await P.evaluate(() => window.klibb.escMenu().close());
    // in a house (not the outside) the button is not offered
    // ---- 3. the Town Hall: rename once ----
    await P.evaluate(() => window.klibb.openHall()); await P.waitForSelector('#th-city-input', { timeout: 15000 }); await sleep(600);
    await shot(P, '6-townhall-before.png');
    await P.fill('#th-city-input', 'Jensköping'); await P.click('#th-city-go'); await P.waitForSelector('#th-city-yes'); await sleep(300);
    await shot(P, '7-townhall-confirm.png');
    await P.click('#th-city-yes');
    await P.waitForSelector('#th-city-locked', { timeout: 15000 }).catch(async () => { console.log('    [debug]', await P.evaluate(() => document.getElementById('th-city').innerText + ' | ' + JSON.stringify(window.klibb.city().hall.city))); });
    await sleep(600);
    const hall = await P.evaluate(() => window.klibb.city().hall.city);
    check('Town Hall: renamed to Jensköping, the rename field is gone', hall && hall.name === 'Jensköping' && !hall.canRename && !hall.form, hall);
    await shot(P, '8-townhall-after.png');
    const again = await fetch(`${A.base}/api/cities/${city}/name`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Someone Else' }) });
    check('a second rename (another player) is refused – 409', again.status === 409, again.status);
    await P.evaluate(() => document.getElementById('th-x').click());
    await P.reload(); await ready(P); await sleep(500);
    await P.evaluate(() => window.klibb.openHall()); await P.waitForSelector('#th-city-locked', { timeout: 15000 });
    const hall2 = await P.evaluate(() => window.klibb.city().hall.city);
    check('after a reload the Town Hall still shows Jensköping and no rename', hall2.name === 'Jensköping' && !hall2.form, hall2);
    const hud = await P.evaluate(() => document.getElementById('room-hud').textContent);
    check('the city name in the HUD is the new one', /Jensköping/.test(hud), hud);
    await P.evaluate(() => document.getElementById('th-x').click());

    // ---- 4. the build city: bake, export (local key by itself) ----
    await P.goto(`${A.base}/?room=${BUILD}`); await ready(P);
    await P.waitForFunction(() => window.klibb.surfTex().info().count >= 40, null, { timeout: 120000 }).catch(() => {});
    const baked = await P.evaluate(() => window.klibb.surfTex().info());
    check('build city: the browser baked the old stickers into tiles (60 → ≥40 painted, newest 20 live)', baked.count >= 40 && baked.tiles >= 1, baked);
    await fetch(`${A.base}/api/cities/${BUILD}/name`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Byggstaden' }) });
    await escOpen(P); await sleep(400); await P.click('[data-esc="city"]'); await sleep(500);
    esc = await P.evaluate(() => window.klibb.escMenu().info());
    check('CITY submenu: Create new city, Join existing, Export city, Import city', ['createcity', 'joincity', 'exportcity', 'importcity'].every((k) => esc.buttons.includes(k)), esc.buttons);
    await shot(P, '9-esc-city-export-import.png');
    const [dl] = await Promise.all([P.waitForEvent('download', { timeout: 60000 }), P.click('[data-esc="exportcity"]')]);
    const file = path.join(SHOTS, '..', 'export-test.satcity'); await dl.saveAs(file);
    const size = fs.statSync(file).size;
    check(`Export city downloads ${dl.suggestedFilename()} (${(size / 1024).toFixed(0)} KB)`, /^Byggstaden-.*\.satcity$/.test(dl.suggestedFilename()) && size > 2000, dl.suggestedFilename());

    // ---- 5. import it into a FRESH local server ----
    const { P: Q } = await page(B.base);
    await Q.goto(`${B.base}/?room=${BUILD}`); await ready(Q); await sleep(800);
    const before = await Q.evaluate(() => ({ live: window.klibb.stamps.meshes.size, tex: window.klibb.surfTex().info() }));
    check('the fresh server: an empty build city', before.live === 0 && before.tex.count === 0, before);
    await escOpen(Q); await sleep(400); await Q.click('[data-esc="city"]'); await sleep(400);
    const [chooser] = await Promise.all([Q.waitForEvent('filechooser'), Q.click('[data-esc="importcity"]')]);
    await chooser.setFiles(file);
    await Q.waitForSelector('#cf-import-yes', { timeout: 10000 }); await sleep(300);
    await shot(Q, '10-import-confirm.png');
    await Promise.all([Q.waitForNavigation({ timeout: 90000 }).catch(() => null), Q.click('#cf-import-yes')]);
    await ready(Q); await Q.waitForFunction(() => window.klibb.surfTex().info().tiles >= 1, null, { timeout: 60000 }).catch(() => {});
    await sleep(1500);
    const after = await Q.evaluate(() => ({ live: window.klibb.stamps.meshes.size, tex: window.klibb.surfTex().info(), name: window.klibb.cityInfo()?.name, hud: document.getElementById('room-hud').textContent }));
    check('after Import city: the same live stickers, painted count and tiles, and the name', after.live === 60 - baked.count && after.tex.count === baked.count && after.tex.tiles === baked.tiles && after.tex.shown === baked.tiles && /Byggstaden/.test(after.hud), { after, baked });
    await Q.evaluate(() => { const k = window.klibb; k.moveTo(0, 17); k.camera.position.y = 1.6; k.look(0, -1.25); }); await sleep(1200);
    await shot(Q, '11-imported-build-city.png');
    await P.evaluate(() => { const k = window.klibb; k.moveTo(0, 17); k.camera.position.y = 1.6; k.look(0, -1.25); }); await sleep(1200);
    await shot(P, '11b-source-build-city.png');
    const nolocal = await fetch(`${B.base}/api/admin/cities/import`, { method: 'POST', headers: { 'Content-Type': 'application/gzip' }, body: fs.readFileSync(file) });
    check('without a key the import is refused (403) even on the local server', nolocal.status === 403, nolocal.status);
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e && e.stack)); }
  finally { await browser.close(); A.child.kill(); B.child.kill(); }
  console.log(`e2e-daytownhall: ${passed} ok, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

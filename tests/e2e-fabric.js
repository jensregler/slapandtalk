// E2E: tyger (fabrics) på gubbarna (körs från e2e.js, eller själv: node tests/e2e-fabric.js).
// A sätter tyger på tröja, byxor, hår och keps i Min gubbe (egen bild, egen klibba, mönster),
// drar i reglagen och sparar. B ser samma tyger med samma värden. Mobil: panelen går att använda.
// Skärmdumpar hamnar i FABRIC_SHOTS (standard: en tillfällig mapp), de checkas inte in.
const path = require('path');
const fs = require('fs');
const os = require('os');
const sharp = require('sharp');

async function fabricE2E({ browser, BASE, assert, waitReady, devices, TOKEN }) {
  const OUT = process.env.FABRIC_SHOTS || path.join(os.tmpdir(), 'klibbrum-shots');
  fs.mkdirSync(OUT, { recursive: true });
  const made = new Set();
  // En egen "tag" att ha som tyg, och en klibba att bära
  const tagSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" rx="40" fill="#111"/>
    <text x="300" y="200" font-family="DejaVu Sans" font-weight="900" font-size="150" text-anchor="middle" fill="#ffd400">ULLA</text></svg>`;
  const tagPng = path.join(os.tmpdir(), 'e2e-tyg-ulla.png');
  await sharp(Buffer.from(tagSvg)).png().toFile(tagPng);
  const stickerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><circle cx="200" cy="200" r="180" fill="#00d1ff" stroke="#fff" stroke-width="20"/>
    <text x="200" y="240" font-family="DejaVu Sans" font-weight="900" font-size="120" text-anchor="middle" fill="#ff2e63">S.A.T</text></svg>`;
  const stickerPng = path.join(os.tmpdir(), 'e2e-tyg-klibba.png');
  await sharp(Buffer.from(stickerSvg)).png().toFile(stickerPng);

  const R = (await (await fetch(`${BASE}/api/rooms`, { method: 'POST' })).json()).room.id;
  const actx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const bctx = await browser.newContext({ viewport: { width: 1024, height: 640 } });
  const A = await actx.newPage(), B = await bctx.newPage();
  for (const [n, pg] of [['A', A], ['B', B]]) pg.on('pageerror', (e) => console.log(`sidfel (tyg ${n}):`, e.message));
  try {
    await A.goto(`${BASE}/?room=${R}`); await waitReady(A);
    await B.goto(`${BASE}/?room=${R}`); await waitReady(B);
    await A.waitForFunction(() => window.klibb.players().length === 1 && window.klibb.players()[0].built, null, { timeout: 15000 });
    await B.waitForFunction(() => window.klibb.players().length === 1 && window.klibb.players()[0].built, null, { timeout: 15000 });
    // A laddar upp en klibba (så den finns bland "dina klibbor" i tygväljaren)
    await A.setInputFiles('#file', stickerPng);
    await A.waitForFunction(() => window.klibb.state.selected);
    made.add(await A.evaluate(() => window.klibb.state.selected.id));

    await A.evaluate(() => window.klibb.openAvatarPanel());
    await A.waitForSelector('#avatar-panel', { state: 'visible' });
    const slot = (s) => `#avatar-panel .fab-slot[data-slot="${s}"]`;
    const segs = await A.$$eval('#avatar-panel .fab-slot', (rows) => rows.map((r) => [r.dataset.slot, [...r.querySelectorAll('.fab-seg button')].map((b) => b.textContent).join('|')]));
    assert(segs.length === 5 && segs.every(([, t]) => t === 'Colour|Fabric') && segs.map(([s]) => s).join() === 'shirt,pants,hair,skin,hat',
      'Min gubbe: varje färgplats (tröja, byxor, hårfärg, hud, keps) har en Colour | Fabric-knapp');
    await A.click('#av-outfit button[data-id="huvtroja"]'); await A.click('#av-hair button[data-id="tupp"]');
    // Tröja: egen bild från enheten (filväljaren)
    await A.click(`${slot('shirt')} .fab-seg button[data-mode="fabric"]`);
    const sliders = await A.$$eval(`${slot('shirt')} .fab-sl input[type=range]`, (rs) => rs.map((r) => [r.closest('.fab-sl').dataset.param, r.min, r.max, r.disabled]));
    assert(sliders.length === 6 && sliders.every((s) => s[3]), 'Fabric utan bild: reglagen syns men är avstängda tills man valt en bild');
    const [chooser] = await Promise.all([A.waitForEvent('filechooser'), A.click(`${slot('shirt')} .fab-up`)]);
    await chooser.setFiles(tagPng);
    await A.waitForFunction(() => window.klibb.previewFabrics().shirt?.loaded, null, { timeout: 10000 });
    const shirtId = await A.evaluate(() => window.klibb.previewFabrics().shirt.id);
    made.add(shirtId);
    const up = await (await fetch(`${BASE}/api/stickers?ids=${shirtId}`)).json();
    assert(up.images[shirtId] && up.images[shirtId].kind === 'fabric' && up.images[shirtId].width === 512 && up.images[shirtId].height === 512,
      '📷 Upload image: bilden krymps i webbläsaren, laddas upp som tyg (512 px, hash-id) och syns direkt på gubben i förhandsvisningen');
    const setRange = (sel, v) => A.$eval(sel, (r, v) => { r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true })); }, v);
    await setRange(`${slot('shirt')} .fab-sl[data-param="scale"] input[type=range]`, 0.55);
    await setRange(`${slot('shirt')} .fab-sl[data-param="rot"] input[type=range]`, 30);
    await setRange(`${slot('shirt')} .fab-sl[data-param="hue"] input[type=range]`, 90);
    await A.check(`${slot('shirt')} input[data-flag="cycleHue"]`);
    await setRange(`${slot('shirt')} .fab-sl[data-param="hueHz"] input[type=range]`, 0.3);
    await A.check(`${slot('shirt')} input[data-flag="spin"]`);
    // Byxor: ett inbyggt mönster. Hår: min egen klibba. Keps: stjärnor. Hud: färg som förut.
    await A.click(`${slot('pants')} .fab-seg button[data-mode="fabric"]`);
    await A.click(`${slot('pants')} .fab-picks button[title="Pattern: Checks"]`);
    await A.waitForFunction(() => window.klibb.previewFabrics().pants?.loaded, null, { timeout: 10000 });
    await setRange(`${slot('pants')} .fab-sl[data-param="scale"] input[type=range]`, 0.35);
    await setRange(`${slot('pants')} .fab-sl[data-param="rot"] input[type=range]`, 45);
    await setRange(`${slot('pants')} .fab-sl[data-param="scroll"] input[type=range]`, 0.5);
    await A.click(`${slot('hair')} .fab-seg button[data-mode="fabric"]`);
    await A.click(`${slot('hair')} .fab-picks button.mine`);
    await A.waitForFunction(() => window.klibb.previewFabrics().hair?.loaded, null, { timeout: 10000 });
    await setRange(`${slot('hair')} .fab-sl[data-param="scale"] input[type=range]`, 0.4);
    await A.check('#av-hat');
    await A.click(`${slot('hat')} .fab-seg button[data-mode="fabric"]`);
    await A.click(`${slot('hat')} .fab-picks button[title="Pattern: Stars"]`);
    await A.waitForFunction(() => window.klibb.previewFabrics().hat?.loaded, null, { timeout: 10000 });
    await A.click(`${slot('hat')} .swatches button[data-id="#e63946"]`);
    const draft = await A.evaluate(() => window.klibb.previewFabrics());
    for (const f of Object.values(draft)) made.add(f.id);
    assert(draft.shirt.f.scale === 0.55 && draft.shirt.f.rot === 30 && draft.shirt.f.hue === 90 && draft.shirt.f.cycleHue && draft.shirt.f.hueHz === 0.3 && draft.shirt.f.spin
      && draft.pants.f.scroll === 0.5 && draft.hair.id !== draft.shirt.id && Object.keys(draft).sort().join() === 'hair,hat,pants,shirt',
      'reglagen (Scale, Rotation, Hue, Cycle hue + Speed, Spin + Speed, Scroll) ändrar tyget direkt i förhandsvisningen');
    // Skärmdump på panelen med tygreglagen
    await A.$eval(slot('shirt'), (el) => el.scrollIntoView({ block: 'start' }));
    await A.evaluate(() => { const p = document.getElementById('avatar-panel'); p.scrollTop = Math.max(0, p.scrollTop - 250); });
    await A.waitForTimeout(800);
    await A.screenshot({ path: path.join(OUT, 'fabric-menu-desktop.png') });
    // Byt fram och tillbaka: Colour tar bort tyget, Fabric igen ger samma tyg och värden tillbaka
    await A.click(`${slot('shirt')} .fab-seg button[data-mode="color"]`);
    const off = await A.evaluate(() => window.klibb.previewFabrics().shirt);
    await A.click(`${slot('shirt')} .fab-seg button[data-mode="fabric"]`);
    await A.waitForFunction(() => window.klibb.previewFabrics().shirt?.loaded, null, { timeout: 10000 });
    const back = await A.evaluate(() => window.klibb.previewFabrics().shirt.f);
    assert(!off && back.scale === 0.55 && back.spin, 'Colour ↔ Fabric: tillbaka till färg, och Fabric igen ger samma tyg med samma värden');
    await A.click('#av-ok');

    // B ser A:s tyger
    await B.waitForFunction(() => { const f = window.klibb.players()[0].fabrics; return ['shirt', 'pants', 'hair', 'hat'].every((s) => f[s] && f[s].loaded); }, null, { timeout: 15000 });
    const seen = await B.evaluate(() => window.klibb.players()[0]);
    const mine = await A.evaluate(() => JSON.parse(localStorage.getItem('klibb.avatar')).look);
    const sameF = ['shirt', 'pants', 'hair', 'hat'].every((s) => JSON.stringify(seen.fabrics[s].f) === JSON.stringify(mine.fabric[s]) && JSON.stringify(seen.look.fabric[s]) === JSON.stringify(mine.fabric[s]));
    assert(sameF && !seen.fabrics.skin && mine.fabric.shirt.scale === 0.55, 'B ser A:s tyger (samma bild, samma värden och animationer), och A:s look med tyger sparas på enheten');
    // A i tredje person: ser sin egen galna utstyrsel bakifrån
    await A.evaluate(() => { const k = window.klibb; k.moveTo(1.2, 2.2); k.look(Math.PI * 0.12, -0.05); k.setView('third'); });
    await A.waitForFunction(() => { const s = window.klibb.selfAvatar(); return s.visible && s.fabrics.shirt?.loaded && s.fabrics.hat?.loaded; }, null, { timeout: 15000 });
    await B.evaluate(() => { const k = window.klibb; k.moveTo(1.2, -0.6); k.look(Math.PI, -0.12); });
    await A.waitForTimeout(1500);
    await A.screenshot({ path: path.join(OUT, 'fabric-3rd-person-outfit.png') });
    await B.waitForTimeout(500);
    await B.screenshot({ path: path.join(OUT, 'fabric-seen-by-other-player.png') });
    const stats = await B.evaluate(() => window.klibb.fabricStats());
    assert(stats.inUse === 4 && stats.denied === 0, `texturerna cachas per tyg (B har ${stats.inUse} tygtexturer för fyra platser)`);
    // A tar av sig tygerna: B ser färgerna igen och texturerna släpps
    await A.evaluate(() => window.klibb.openAvatarPanel());
    for (const s of ['shirt', 'pants', 'hair', 'hat']) await A.click(`${slot(s)} .fab-seg button[data-mode="color"]`);
    await A.click('#av-ok');
    await B.waitForFunction(() => Object.keys(window.klibb.players()[0].fabrics).length === 0 && !window.klibb.players()[0].look.fabric, null, { timeout: 8000 });
    const freed = await B.evaluate(() => window.klibb.fabricStats().inUse);
    assert(freed === 0, 'tar A av tygerna ser B färgerna igen, och texturerna som ingen använder släpps');
    // 🌀 Randomize
    await A.evaluate(() => window.klibb.openAvatarPanel());
    await A.click('#av-wild');
    await A.waitForFunction(() => Object.values(window.klibb.previewFabrics()).some((f) => f.loaded), null, { timeout: 15000 });
    const wild = await A.evaluate(() => window.klibb.previewFabrics());
    for (const f of Object.values(wild)) made.add(f.id);
    assert(Object.keys(wild).length >= 1, `🌀 Randomize: en galen utstyrsel med tyger på ${Object.keys(wild).join(', ')}`);
    await A.click('#av-cancel');

    // Mobil: panelen med tygreglagen går att använda med touch
    const mctx = await browser.newContext({ ...devices['iPhone 13'] });
    const M = await mctx.newPage();
    M.on('pageerror', (e) => console.log('sidfel (tyg mobil):', e.message));
    await M.goto(`${BASE}/?room=${R}`); await waitReady(M);
    await M.evaluate(() => window.klibb.openAvatarPanel());
    await M.waitForSelector('#avatar-panel', { state: 'visible' });
    await M.tap(`${slot('shirt')} .fab-seg button[data-mode="fabric"]`);
    await M.tap(`${slot('shirt')} .fab-picks button[title="Pattern: Zigzag"]`);
    await M.waitForFunction(() => window.klibb.previewFabrics().shirt?.loaded, null, { timeout: 10000 });
    await M.$eval(`${slot('shirt')} .fab-sl[data-param="scale"] input[type=range]`, (el) => el.scrollIntoView({ block: 'center' }));
    const box = await M.locator(`${slot('shirt')} .fab-sl[data-param="scale"] input[type=range]`).boundingBox();
    await M.touchscreen.tap(box.x + box.width * 0.9, box.y + box.height / 2);
    await M.waitForTimeout(300);
    const mScale = await M.evaluate(() => window.klibb.previewFabrics().shirt.f.scale);
    const vw = M.viewportSize().width;
    const fits = await M.$eval('#avatar-panel', (p, vw) => p.getBoundingClientRect().right <= vw + 1 && p.scrollWidth <= p.clientWidth + 1, vw);
    await M.$eval(slot('shirt'), (el) => el.scrollIntoView({ block: 'start' }));
    await M.waitForTimeout(600);
    await M.screenshot({ path: path.join(OUT, 'fabric-menu-mobile.png') });
    assert(mScale > 3 && fits, `mobil: Fabric och reglagen fungerar med touch (scale ${mScale}) och panelen får plats i bredd`);
    await mctx.close();
    console.log(`  (tyg-skärmdumpar i ${OUT})`);
  } finally {
    await actx.close(); await bctx.close();
    for (const id of made) if (id) await fetch(`${BASE}/api/stickers/${id}`, { method: 'DELETE', headers: { 'x-admin-token': TOKEN } }).catch(() => {});
  }
}

module.exports = { fabricE2E };

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  const { chromium, devices } = require('playwright');
  const BASE = process.env.BASE_URL || 'http://localhost:8787';
  const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };
  const waitReady = (page) => page.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 20000 });
  (async () => {
    const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    try { await fabricE2E({ browser, BASE, assert, waitReady, devices, TOKEN: process.env.ADMIN_TOKEN }); } finally { await browser.close(); }
  })().catch((e) => { console.error(e); process.exit(1); });
}

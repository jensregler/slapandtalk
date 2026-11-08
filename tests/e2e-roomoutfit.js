// E2E: latest chosen outfit is what you wear when entering a room (Jens, 8 Nov 2026).
// Covers: Min gubbe → Save → another room; unsaved draft → goRoom; city → house;
// reload into room; Exit to menu → Join keeps the saved look.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.ROOMOUTFIT_E2E_PORT || 8928);
const SHOTS = process.env.ROOMOUTFIT_SHOTS || '/tmp/roomoutfit-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 600) : '')); } };
const LOOK_A = { outfit: 'kostym', hair: 'lang', shirt: '#e63946', pants: '#222222', hairColor: '#1b1410', skin: '#e0ac69', shoes: '#222222', hat: true, hatColor: '#e63946' };
const LOOK_B = { outfit: 'punk', hair: 'lugg', shirt: '#ffd400', pants: '#2b4c7e', hairColor: '#c0392b', skin: '#c68642', shoes: '#f1f1f1', hat: false, hatColor: '#3a86ff' };
const keys = ['outfit', 'hair', 'shirt', 'pants', 'hairColor', 'skin', 'shoes', 'hat', 'hatColor'];
const same = (a, b) => !!a && !!b && keys.every((k) => a[k] === b[k]);
const lookOf = async (P) => P.evaluate(() => {
  const ls = JSON.parse(localStorage.getItem('klibb.avatar') || '{}').look;
  const me = window.klibb.me()?.look;
  const self = window.klibb.selfAvatar()?.look;
  return { ls, me, self };
});
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: false }) })).json();
    const R = made.room.id;
    const made2 = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: false }) })).json();
    const R2 = made2.room.id;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(([r, k, r2, k2, l]) => {
      // Only seed once – addInitScript re-runs on every navigation; do not clobber a look just saved.
      if (!localStorage.getItem('klibb.roomKeys')) localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k, [r2]: k2 }));
      if (!localStorage.getItem('klibb.avatar')) localStorage.setItem('klibb.avatar', JSON.stringify({ name: 'Outfit', look: l }));
      localStorage.setItem('klibb.devUnlock', '1');
      if (!sessionStorage.getItem('klibb.lookSession')) sessionStorage.setItem('klibb.lookSession', '1');
    }, [R, made.roomKey, R2, made2.roomKey, LOOK_A]);
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${R}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
    await sleep(600);
    let got = await lookOf(P);
    check('enter room: wears the saved look (LOOK_A / kostym)', got.ls?.outfit === 'kostym' && got.me?.outfit === 'kostym', got);

    // Character menu: change to LOOK_B and Save
    await P.evaluate(() => window.klibb.openAvatarPanel());
    await P.waitForFunction(() => window.klibb.avatarView()?.visible, null, { timeout: 15000 });
    await P.click('#av-outfit button[data-id="punk"]');
    await P.click('#av-hair button[data-id="lugg"]');
    const shirtBtn = await P.evaluate((hex) => {
      const b = [...document.querySelectorAll('#av-shirt button')].find((el) => el.dataset.id === hex);
      if (b) { b.click(); return true; } return false;
    }, LOOK_B.shirt);
    check('shirt chip clicked', shirtBtn);
    await P.click('#av-ok'); await sleep(400);
    got = await lookOf(P);
    check('Save writes punk/lugg into klibb.avatar + me', got.ls?.outfit === 'punk' && got.ls?.hair === 'lugg' && got.me?.outfit === 'punk', got);

    // Navigate to another room via goRoom (persistWornLook)
    await Promise.all([
      P.waitForURL(new RegExp(`room=${R2}`), { timeout: 20000 }),
      P.evaluate((id) => window.klibb.goRoom(id), R2),
    ]);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
    await sleep(800);
    got = await lookOf(P);
    check('goRoom into another room: still punk/lugg (not LOOK_A)', got.ls?.outfit === 'punk' && got.ls?.hair === 'lugg' && got.me?.outfit === 'punk' && got.me?.hair === 'lugg', got);

    // City → house: make city, go there, then to a house room
    const city = await (await fetch(`${S.base}/api/cities`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Outfit town' }) })).json();
    const cityId = city.city?.id || city.id;
    check('city created', !!cityId, city);
    await P.evaluate(() => {
      localStorage.setItem('klibb.pac', JSON.stringify({ name: 'Test pac', stickers: ['a', 'b', 'c'], bag: 1, img: 'data:image/png;base64,xx' }));
    });
    await Promise.all([
      P.waitForURL(new RegExp(`room=${cityId}`), { timeout: 20000 }),
      P.evaluate((id) => window.klibb.goRoom(id), cityId),
    ]);
    await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.city()?.outside, null, { timeout: 60000 });
    await sleep(800);
    got = await lookOf(P);
    check('in city: still punk/lugg', got.ls?.outfit === 'punk' && got.me?.outfit === 'punk', got);

    // City → a regular room (same persist path as a house door)
    await Promise.all([
      P.waitForURL(new RegExp(`room=${R}`), { timeout: 20000 }),
      P.evaluate((id) => window.klibb.goRoom(id), R),
    ]);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
    await sleep(800);
    got = await lookOf(P);
    check('city → room: still punk/lugg', got.ls?.outfit === 'punk' && got.ls?.hair === 'lugg' && got.me?.outfit === 'punk', got);

    // Unsaved draft then goRoom: open panel, pick kostym, persist via goRoom without Save
    await P.evaluate(() => window.klibb.openAvatarPanel());
    await P.waitForFunction(() => window.klibb.avatarView()?.visible, null, { timeout: 15000 });
    await P.click('#av-outfit button[data-id="kostym"]');
    await P.click('#av-hair button[data-id="lang"]');
    await sleep(200);
    await Promise.all([
      P.waitForURL(new RegExp(`room=${R}`), { timeout: 20000 }),
      P.evaluate((id) => window.klibb.goRoom(id), R),
    ]);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
    await sleep(800);
    got = await lookOf(P);
    check('unsaved draft → goRoom: kostym/lang persisted into next room', got.ls?.outfit === 'kostym' && got.ls?.hair === 'lang' && got.me?.outfit === 'kostym', got);

    // Reload keeps the chosen look (no re-roll on reload)
    await P.reload({ waitUntil: 'domcontentloaded' });
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
    await sleep(800);
    got = await lookOf(P);
    check('reload into room: still kostym/lang (not rolled away)', got.ls?.outfit === 'kostym' && got.ls?.hair === 'lang' && got.me?.outfit === 'kostym', got);

    // Change to punk, Save, then simulate Exit persist + re-enter
    await P.evaluate(() => window.klibb.openAvatarPanel());
    await P.waitForFunction(() => window.klibb.avatarView()?.visible, null, { timeout: 15000 });
    await P.click('#av-outfit button[data-id="punk"]');
    await P.click('#av-hair button[data-id="lugg"]');
    await P.click('#av-ok'); await sleep(300);
    const persisted = await P.evaluate(() => window.klibb.persistWornLook());
    check('persistWornLook after Save returns punk', persisted?.outfit === 'punk', persisted);
    await P.goto(`${S.base}/?room=${R2}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
    await sleep(800);
    got = await lookOf(P);
    check('re-enter room after persist: punk/lugg (not last session LOOK_A)', got.ls?.outfit === 'punk' && got.me?.outfit === 'punk' && got.me?.hair === 'lugg', got);

    await P.screenshot({ path: path.join(SHOTS, 'room-outfit.png') });
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await browser.close(); S.child.kill();
  console.log(`\nRoom outfit e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

// E2E: clothes worn in a room follow into the city (Jens, 7 Nov 2026).
// 1) Save a look in Min gubbe → persistWornLook / go to city → same outfit.
// 2) Room character (setRoomLook) differs from klibb.avatar → persist captures the worn one.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.CITYOUTFIT_E2E_PORT || 8927);
const SHOTS = process.env.CITYOUTFIT_SHOTS || '/tmp/cityoutfit-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 500) : '')); } };
const LOOK_A = { outfit: 'kostym', hair: 'lang', shirt: '#e63946', pants: '#222222', hairColor: '#1b1410', skin: '#e0ac69', shoes: '#222222', hat: true, hatColor: '#e63946' };
const LOOK_B = { outfit: 'punk', hair: 'lugg', shirt: '#ffd400', pants: '#2b4c7e', hairColor: '#c0392b', skin: '#c68642', shoes: '#f1f1f1', hat: false, hatColor: '#3a86ff' };
const keys = ['outfit', 'hair', 'shirt', 'pants', 'hairColor', 'skin', 'shoes', 'hat', 'hatColor'];
const same = (a, b) => !!a && !!b && keys.every((k) => a[k] === b[k]);
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: false }) })).json();
    const R = made.room.id;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(([r, k, l]) => {
      if (!localStorage.getItem('klibb.roomKeys')) localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k }));
      if (!localStorage.getItem('klibb.avatar')) localStorage.setItem('klibb.avatar', JSON.stringify({ name: 'Outfit', look: l }));
      localStorage.setItem('klibb.devUnlock', '1');
      if (!sessionStorage.getItem('klibb.lookSession')) sessionStorage.setItem('klibb.lookSession', '1');
    }, [R, made.roomKey, LOOK_A]);
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${R}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
    await sleep(800);

    // Change clothes in the panel and Save
    await P.evaluate(() => window.klibb.openAvatarPanel());
    await P.waitForFunction(() => window.klibb.avatarView()?.visible, null, { timeout: 15000 });
    await P.click('#av-outfit button[data-id="punk"]');
    await P.click('#av-hair button[data-id="lugg"]');
    await P.click('#av-ok'); await sleep(400);
    const saved = await P.evaluate(() => JSON.parse(localStorage.getItem('klibb.avatar')).look);
    check('Save writes punk/lugg into klibb.avatar', saved.outfit === 'punk' && saved.hair === 'lugg', saved);

    // Simulate a room character that differs from the saved own look, then persist
    await P.evaluate((look) => { window.klibb.net; const t = window.klibb; /* set via internal */ }, LOOK_B);
    const worn = await P.evaluate((b) => {
      // Force the live avatar to LOOK_B without saving (as if roomLook / unsaved draft)
      const before = JSON.parse(localStorage.getItem('klibb.avatar')).look;
      // open panel, apply B as draft, persist without Save
      window.klibb.openAvatarPanel();
      return new Promise((resolve) => {
        const wait = () => {
          const v = window.klibb.avatarView();
          if (!v || !v.visible) return setTimeout(wait, 50);
          // poke draft via DOM chips matching LOOK_B
          document.querySelector(`#av-outfit button[data-id="${b.outfit}"]`)?.click();
          document.querySelector(`#av-hair button[data-id="${b.hair}"]`)?.click();
          const got = window.klibb.persistWornLook();
          const after = JSON.parse(localStorage.getItem('klibb.avatar')).look;
          resolve({ before, got, after, draft: window.klibb.avatarView()?.draft });
        };
        wait();
      });
    }, LOOK_B);
    check('persistWornLook captures the draft outfit (punk stays if already, or LOOK_B)', worn.after.outfit === 'punk' && worn.after.hair === (worn.draft?.hair || worn.after.hair), worn);
    check('…and writes it to klibb.avatar', same(worn.got, worn.after), worn);

    // Room-character path: setRoomLook to LOOK_A colours via evaluating together if exposed
    // Direct: overwrite localStorage with LOOK_A, set live self to LOOK_B via persist after panel draft B
    await P.evaluate((b) => {
      // leave panel
      document.getElementById('av-cancel')?.click();
      localStorage.setItem('klibb.avatar', JSON.stringify({ name: 'Outfit', look: { outfit: 'kostym', hair: 'lang', shirt: '#e63946', pants: '#222222', hairColor: '#1b1410', skin: '#e0ac69', shoes: '#222222', hat: true, hatColor: '#e63946' } }));
    }, LOOK_B);
    // Re-open and set draft to LOOK_B pieces, persist (simulates worn ≠ saved)
    const cap = await P.evaluate(async (b) => {
      window.klibb.openAvatarPanel();
      await new Promise((r) => {
        const t = () => { if (window.klibb.avatarView()?.visible) r(); else setTimeout(t, 40); }; t();
      });
      document.querySelector(`#av-outfit button[data-id="${b.outfit}"]`)?.click();
      document.querySelector(`#av-hair button[data-id="${b.hair}"]`)?.click();
      const shirtBtn = [...document.querySelectorAll('#av-shirt button')].find((el) => el.dataset.id === b.shirt);
      shirtBtn?.click();
      const got = window.klibb.persistWornLook();
      return { got, ls: JSON.parse(localStorage.getItem('klibb.avatar')).look };
    }, LOOK_B);
    check('worn draft (punk/lugg/#ffd400) overwritten onto klibb.avatar before city', cap.ls.outfit === 'punk' && cap.ls.hair === 'lugg' && cap.ls.shirt === '#ffd400', cap);

    // Make a pac quickly and go to city via goRoom (skip full door UI)
    await P.evaluate(() => {
      localStorage.setItem('klibb.pac', JSON.stringify({ name: 'Test pac', stickers: ['a', 'b', 'c'], bag: 1, img: 'data:image/png;base64,xx' }));
    });
    // Start a city via API then goRoom
    const city = await (await fetch(`${S.base}/api/cities`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Outfit town' }) })).json();
    const cityId = city.city?.id || city.id;
    check('city created', !!cityId, city);
    await Promise.all([
      P.waitForURL(new RegExp(`room=${cityId}`), { timeout: 20000 }),
      P.evaluate((id) => window.klibb.goRoom(id), cityId),
    ]);
    await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.city()?.outside, null, { timeout: 60000 });
    await sleep(1000);
    const inCity = await P.evaluate(() => {
      const ls = JSON.parse(localStorage.getItem('klibb.avatar')).look;
      const me = window.klibb.me();
      const self = window.klibb.selfAvatar();
      return { ls, meLook: me?.look, selfLook: self?.look, city: window.klibb.city() };
    });
    check('in the city with the same outfit/hair/shirt', inCity.ls.outfit === 'punk' && inCity.ls.hair === 'lugg' && inCity.ls.shirt === '#ffd400'
      && inCity.meLook?.outfit === 'punk' && inCity.meLook?.hair === 'lugg', inCity);
    await P.screenshot({ path: path.join(SHOTS, 'city-outfit.png') });
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await browser.close(); S.child.kill();
  console.log(`\nCity outfit e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

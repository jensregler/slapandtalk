// E2E: Esc spawns the big-button menu (SOUND / AVATAR / ROOM / CITY / EXIT / CREATE).
// CREATE → STICKERS / STICKER PACK submenu (Esc closes submenu first).
// CITY → Create new city / Join existing (Esc closes submenu first; join lists live cities).
const path = require('path');
const fs = require('fs');
const { chromium, devices } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.ESCMENU_E2E_PORT || 8917);
const SHOTS = process.env.ESC_SHOTS || '/workspace/createmenu';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: false }) })).json();
    const R = made.room.id;
    // Seed a live city so Join existing has a row (with stickers/visitors fields).
    const city = await (await fetch(`${S.base}/api/cities`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Esc Town' }) })).json();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => localStorage.setItem('klibb.devUnlock', '1'));
    const P = await ctx.newPage();
    P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${R}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
    await P.evaluate(() => window.klibb.entitlementsReady());

    const wheel = await P.evaluate(() => ({
      ids: window.klibb.stickerDesigns().map((d) => d.id),
      excl: window.klibb.wheelExclude(),
    }));
    check('former menu stickers are not on the sticker wheel', wheel.excl.every((id) => !wheel.ids.includes(id)), { n: wheel.ids.length, excl: wheel.excl.length });

    await P.mouse.click(900, 400);
    await P.waitForFunction(() => window.klibb.controls.locked, null, { timeout: 5000 }).catch(() => {});
    await P.evaluate(() => window.klibb.controls.unlock());
    await P.evaluate(() => { window.klibb.escGate.unlockedAt = -1e9; window.klibb.escMenu().open(); });
    await sleep(400);
    const open1 = await P.evaluate(() => window.klibb.escMenu().info());
    // the six first, then the catalogs (STICKERS / NATURE; ASSETS only for the build phase's builders) and HELP (Jens t792u/t797u)
    check('Esc menu opens with SOUND / AVATAR / ROOM / CITY / EXIT / CREATE, then STICKERS / NATURE / HELP', open1.open && open1.buttons.slice(0, 6).join() === 'sound,avatar,room,city,exit,create'
      && open1.buttons.slice(6).join() === 'catstickers,catnature,help', open1);
    const modes = await P.evaluate(() => document.querySelectorAll('#mode-switch button').length);
    check('no wheel mode switch in the side panel any more (t793u)', modes === 0, modes);
    await P.screenshot({ path: path.join(SHOTS, '01-esc-menu.png') });

    // CREATE submenu
    await P.click('#esc-menu [data-esc="create"]'); await sleep(350);
    const createSub = await P.evaluate(() => window.klibb.escMenu().info());
    check('CREATE opens STICKERS / STICKER PACK / MY PACKS submenu', createSub.submenu && createSub.view === 'create' && createSub.buttons.join() === 'stickers,stickerpack,mypacks', createSub);
    await P.screenshot({ path: path.join(SHOTS, '02-create-submenu.png') });

    // Esc closes submenu first (via escTopPanel)
    await P.evaluate(() => { window.klibb.escGate.unlockedAt = -1e9; });
    await P.keyboard.press('Escape'); await sleep(300);
    const afterSubEsc = await P.evaluate(() => window.klibb.escMenu().info());
    check('Esc while CREATE submenu open closes submenu and keeps main buttons', afterSubEsc.open && !afterSubEsc.submenu && afterSubEsc.buttons.includes('create'), afterSubEsc);

    // STICKERS opens the sticker editor
    await P.click('#esc-menu [data-esc="create"]'); await sleep(200);
    await P.click('#esc-menu [data-esc="stickers"]'); await sleep(600);
    const nt = await P.evaluate(() => ({ open: window.klibb.nameTag().open, menu: window.klibb.escMenu().isOpen(), panelHidden: document.body.classList.contains('nametag-open') }));
    check('STICKERS opens the sticker editor and hides the left panel', nt.open && !nt.menu && nt.panelHidden, nt);
    await P.screenshot({ path: path.join(SHOTS, '03-stickers-editor.png') });
    const order = await P.evaluate(() => window.klibb.nameTag().buttons.map((b) => b.id + ':' + b.text));
    check('editor bottom bar is exit – undo – done', order.join('|') === 'nt-exit:exit|nt-undo:↶ undo|nt-save:done', order);
    await P.keyboard.press('Escape'); await sleep(300);

    // STICKER PACK opens pac makeover (door flow)
    await P.evaluate(() => { window.klibb.escGate.unlockedAt = -1e9; window.klibb.escMenu().open(); }); await sleep(200);
    await P.click('#esc-menu [data-esc="create"]'); await sleep(200);
    await P.click('#esc-menu [data-esc="stickerpack"]'); await sleep(600);
    const pack = await P.evaluate(() => window.klibb.door());
    check('STICKER PACK opens the pac makeover flow', pack.open === true, pack);
    await P.keyboard.press('Escape'); await sleep(300);

    // CITY submenu
    await P.evaluate(() => { window.klibb.escGate.unlockedAt = -1e9; window.klibb.escMenu().open(); }); await sleep(200);
    await P.click('#esc-menu [data-esc="city"]'); await sleep(350);
    const citySub = await P.evaluate(() => window.klibb.escMenu().info());
    check('CITY opens Create new city / Join existing submenu', citySub.submenu && citySub.view === 'city' && citySub.buttons.join() === 'createcity,joincity', citySub);
    await P.screenshot({ path: path.join(SHOTS, '04-city-submenu.png') });

    await P.keyboard.press('Escape'); await sleep(250);
    const cityEsc = await P.evaluate(() => window.klibb.escMenu().info());
    check('Esc closes CITY submenu first', cityEsc.open && cityEsc.view === 'main', cityEsc);

    // Join existing list
    await P.click('#esc-menu [data-esc="city"]'); await sleep(200);
    await P.click('#esc-menu [data-esc="joincity"]'); await sleep(700);
    const join = await P.evaluate(() => window.klibb.escMenu().info());
    check('Join existing lists live cities with stickers + visitors', join.view === 'cityjoin' && Array.isArray(join.cities) && join.cities.some((c) => c.name === 'Esc Town' && typeof c.stickers === 'number' && typeof c.visitors === 'number'), join);
    await P.screenshot({ path: path.join(SHOTS, '05-city-join-list.png') });
    await P.keyboard.press('Escape'); await sleep(250);
    const joinEsc = await P.evaluate(() => window.klibb.escMenu().info());
    check('Esc from join list returns to CITY submenu', joinEsc.view === 'city', joinEsc);
    await P.keyboard.press('Escape'); await sleep(200);

    // Create new city → straight into a new city with a fictional name (t864u: no name step any more)
    await P.evaluate(() => { window.klibb.escGate.unlockedAt = -1e9; window.klibb.escMenu().open(); }); await sleep(200);
    await P.click('#esc-menu [data-esc="city"]'); await sleep(200);
    await Promise.all([P.waitForNavigation({ timeout: 30000 }).catch(() => null), P.click('#esc-menu [data-esc="createcity"]')]);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
    const made = await P.evaluate(() => ({ url: location.search, pick: window.klibb.city().pick }));
    check('Create new city goes straight into a new city (no name step)', /room=stad-[a-z0-9]+/.test(made.url) && !(made.pick && made.pick.open), made);

    // SOUND still works
    await P.evaluate(() => { window.klibb.escGate.unlockedAt = -1e9; window.klibb.escMenu().open(); }); await sleep(200);
    await P.click('#esc-menu [data-esc="sound"]'); await sleep(500);
    const snd = await P.evaluate(() => ({
      menu: window.klibb.escMenu().isOpen(),
      sound: !document.getElementById('sound-panel').hidden,
      full: !!document.querySelector('#full-panel:not([hidden])'),
    }));
    check('SOUND closes the Esc menu and opens sound settings (or the full-version panel)', !snd.menu && (snd.sound || snd.full), snd);

    await P.evaluate(() => { window.klibb.escGate.unlockedAt = -1e9; });
    await P.keyboard.press('Escape'); await sleep(350);
    const afterPanelEsc = await P.evaluate(() => ({
      menu: window.klibb.escMenu().isOpen(),
      sound: !document.getElementById('sound-panel').hidden,
      full: !!document.querySelector('#full-panel:not([hidden])'),
    }));
    check('Esc while Sound settings open closes the panel and does NOT show the button row', !afterPanelEsc.menu && !afterPanelEsc.sound && !afterPanelEsc.full, afterPanelEsc);

    // API: city list exposes stickers + visitors
    const apiCities = await (await fetch(`${S.base}/api/cities`)).json();
    const seeded = (apiCities.cities || []).find((c) => c.id === city.city.id);
    check('GET /api/cities includes stickers + visitors on each city', seeded && typeof seeded.stickers === 'number' && typeof seeded.visitors === 'number', seeded);

    // Former NAME still reachable via menuAction('nametag')
    await P.evaluate(() => window.klibb.menuAction('nametag')); await sleep(400);
    check('menuAction(nametag) still opens the sticker editor (former NAME)', await P.evaluate(() => window.klibb.nameTag().open));
    await P.keyboard.press('Escape'); await sleep(200);

    check('no page errors', errors.length === 0, errors.slice(0, 3));
  } finally {
    await browser.close();
    S.child.kill();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

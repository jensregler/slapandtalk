// E2E: Esc spawns the big-button menu (SOUND / AVATAR / ROOM / CITY / EXIT / NAME). Esc again or a
// click on the scrim closes it and returns to the game. Touch reaches the same overlay via the
// stack's Menu button. Menu stickers are gone from the wheel.
const path = require('path');
const fs = require('fs');
const { chromium, devices } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.ESCMENU_E2E_PORT || 8917);
const SHOTS = process.env.ESC_SHOTS || '/workspace';
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
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => localStorage.setItem('klibb.devUnlock', '1'));
    const P = await ctx.newPage();
    P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${R}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
    await P.evaluate(() => window.klibb.entitlementsReady());

    // Former menu stickers are off the wheel
    const wheel = await P.evaluate(() => ({
      ids: window.klibb.stickerDesigns().map((d) => d.id),
      excl: window.klibb.wheelExclude(),
    }));
    check('former menu stickers are not on the sticker wheel', wheel.excl.every((id) => !wheel.ids.includes(id)), { n: wheel.ids.length, excl: wheel.excl.length });

    // Enter the game, then Esc → big menu
    await P.mouse.click(900, 400);
    await P.waitForFunction(() => window.klibb.controls.locked, null, { timeout: 5000 }).catch(() => {});
    await P.evaluate(() => window.klibb.controls.unlock());
    // Simulate a real Esc (softUnlockAt is recent from unlock() – force a real-Esc open)
    await P.evaluate(() => { window.klibb.escGate.unlockedAt = -1e9; window.klibb.escMenu().open(); });
    await sleep(400);
    const open1 = await P.evaluate(() => window.klibb.escMenu().info());
    check('Esc menu opens with SOUND / AVATAR / ROOM / CITY / EXIT / NAME', open1.open && open1.buttons.join() === 'sound,avatar,room,city,exit,name', open1);
    await P.screenshot({ path: path.join(SHOTS, 'esc-menu.png') });

    // SOUND opens sound settings (or full-version gate)
    await P.click('#esc-menu [data-esc="sound"]');
    await sleep(500);
    const snd = await P.evaluate(() => ({
      menu: window.klibb.escMenu().isOpen(),
      sound: !document.getElementById('sound-panel').hidden,
      full: !!document.querySelector('#full-panel:not([hidden])'),
    }));
    check('SOUND closes the Esc menu and opens sound settings (or the full-version panel)', !snd.menu && (snd.sound || snd.full), snd);

    // Esc priority: panel open → Esc closes panel, buttons stay hidden; Esc again → buttons.
    await P.evaluate(() => { window.klibb.escGate.unlockedAt = -1e9; });
    await P.keyboard.press('Escape'); await sleep(350);
    const afterPanelEsc = await P.evaluate(() => ({
      menu: window.klibb.escMenu().isOpen(),
      sound: !document.getElementById('sound-panel').hidden,
      full: !!document.querySelector('#full-panel:not([hidden])'),
    }));
    check('Esc while Sound settings open closes the panel and does NOT show the button row', !afterPanelEsc.menu && !afterPanelEsc.sound && !afterPanelEsc.full, afterPanelEsc);
    await P.keyboard.press('Escape'); await sleep(350);
    const afterSecondEsc = await P.evaluate(() => window.klibb.escMenu().info());
    check('Esc again (nothing open) shows the Esc button row', afterSecondEsc.open === true, afterSecondEsc);

    // Re-open and try AVATAR
    await P.evaluate(() => window.klibb.escMenu().open()); await sleep(200);
    await P.click('#esc-menu [data-esc="avatar"]'); await sleep(500);
    const av = await P.evaluate(() => ({ menu: window.klibb.escMenu().isOpen(), av: !document.getElementById('avatar-panel').hidden }));
    check('AVATAR opens My avatar', !av.menu && av.av, av);
    await P.keyboard.press('Escape'); await sleep(300);

    // ROOM
    await P.evaluate(() => window.klibb.escMenu().open()); await sleep(200);
    await P.click('#esc-menu [data-esc="room"]'); await sleep(600);
    const rm = await P.evaluate(() => ({ menu: window.klibb.escMenu().isOpen(), room: window.klibb.roomPanel().open }));
    check('ROOM opens the room info panel', !rm.menu && rm.room, rm);
    await P.keyboard.press('Escape'); await sleep(300);

    // NAME
    await P.evaluate(() => window.klibb.menuAction('nametag')); await sleep(600);
    check('NAME / menuAction(nametag) opens the name-tag tool', await P.evaluate(() => window.klibb.nameTag().open));
    await P.keyboard.press('Escape'); await sleep(300);

    // CITY
    await P.evaluate(() => window.klibb.menuAction('door')); await sleep(400);
    const city = await P.evaluate(() => window.klibb.choice());
    check('CITY opens the enter-city choice', city.open && city.what === 'door', city);
    await P.keyboard.press('Escape'); await sleep(200);
    await P.evaluate(() => { const b = document.querySelector('#menu-choice-list [data-id="back"]'); if (b) b.click(); });
    await sleep(200);

    // Scrim closes + resumes (pointerdown on the dimmed backdrop)
    await P.evaluate(() => {
      window.klibb.controls.unlock?.();
      window.klibb.escMenu().open();
    });
    await sleep(200);
    await P.evaluate(() => {
      document.getElementById('esc-scrim').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    });
    await sleep(400);
    const after = await P.evaluate(() => ({ menu: window.klibb.escMenu().isOpen(), resuming: window.klibb.resuming(), locked: window.klibb.controls.locked }));
    check('clicking the scrim closes the Esc menu (and tries to re-enter)', !after.menu && (after.resuming || after.locked), after);

    // Slap hit FX screenshot (drive the FX layer directly – no stamp needed)
    const fxN = await P.evaluate(() => {
      const fx = window.klibb.slapFx();
      fx.clear();
      fx.burst([0, 1.5, -7.5], [0, 0, 1], [0, 1.6, -2]);
      return fx.count;
    });
    await sleep(60);
    await P.screenshot({ path: path.join(SHOTS, 'slap-fx.png') });
    check('slap FX spawned at least one overlay', fxN > 0, { fxN });

    check('no page errors', errors.length === 0, errors.slice(0, 3));
  } finally {
    await browser.close();
    S.child.kill();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

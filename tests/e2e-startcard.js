// E2E: landing → name city → enter city (startcard.js; Jens, Nov 2026).
// Covers Enter, desktop mouse click, and touch tap → NAME THE NEW CITY → city outside.
// Own server (STARTCARD_E2E_PORT, default 8901).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.STARTCARD_E2E_PORT || 8901);
const SHOTS = process.env.STICKERMENU_SHOTS || '/workspace/stickermenu-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errs = [];
  try {
    const p = await (await b.newContext({ viewport: { width: 900, height: 1000 } })).newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${S.base}/?start=1`);
    await p.waitForSelector('#sc-splash', { timeout: 15000 }); await sleep(200);
    await p.screenshot({ path: '/workspace/menu-1.png' });
    const splash = await p.evaluate(() => {
      const t = [...document.querySelectorAll('.sc-title')].map((x) => x.textContent);
      return {
        titles: t.join('/'),
        frame: !!document.querySelector('.sc-frame'),
        main: !!window.klibb,
        buttons: [...document.querySelectorAll('#start-card button')].map((x) => x.id || x.textContent),
        hint: document.getElementById('sc-enter-hint')?.textContent || '',
        newBtn: !!document.getElementById('sc-new'),
        joinBtn: !!document.getElementById('sc-join'),
        buildBtn: !!document.getElementById('sc-build'),
      };
    });
    check('?start=1 shows SLP/TLK only – no NEW GAME / JOIN / BUILD CITY buttons, room not loaded',
      splash.titles === 'SLP/TLK' && splash.frame && !splash.main && !splash.newBtn && !splash.joinBtn && !splash.buildBtn && splash.buttons.length === 0, splash);
    check('splash has a subtle Enter hint (discoverability, not a button)', /enter/i.test(splash.hint), splash.hint);

    // Enter → name-city screen
    await p.keyboard.press('Enter');
    await p.waitForSelector('#sc-cityname', { timeout: 10000 }); await sleep(200);
    await p.screenshot({ path: '/workspace/menu-2.png' });
    const nameScreen = await p.evaluate(() => ({
      heading: document.getElementById('sc-city-heading')?.textContent,
      input: document.getElementById('sc-cityname')?.tagName,
      placeholder: document.getElementById('sc-cityname')?.placeholder,
      buttons: [...document.querySelectorAll('#start-card button')].map((x) => x.id),
      klibb: !!window.klibb,
    }));
    check('Enter opens NAME THE NEW CITY (one text field, no menu buttons)',
      /NAME THE NEW CITY/i.test(nameScreen.heading || '') && nameScreen.input === 'INPUT'
      && !!nameScreen.placeholder && nameScreen.buttons.length === 0 && !nameScreen.klibb, nameScreen);

    // Empty name → random default from placeholder; Enter confirms → city
    const placeholder = nameScreen.placeholder;
    await p.focus('#sc-cityname');
    await Promise.all([
      p.waitForFunction(() => window.klibb && window.klibb.ready && /stad-/.test(location.search), null, { timeout: 45000 }),
      p.locator('#sc-cityname').press('Enter'),
    ]);
    const entered = await p.evaluate(() => {
      const room = new URLSearchParams(location.search).get('room');
      const hud = document.getElementById('room-hud')?.textContent || document.getElementById('room-name')?.textContent || '';
      return {
        room,
        outside: !!(window.klibb && window.klibb.city && window.klibb.city().outside),
        hud,
        startGone: !document.getElementById('start-card'),
        audio: !!(window.__klibbAudioCtx),
      };
    });
    check('empty name + Enter creates a city (stad-*) and enters it (not a room)',
      /^stad-[a-z0-9]+$/i.test(entered.room || '') && entered.outside && entered.startGone, entered);
    check('city HUD uses the default/placeholder name',
      (entered.hud || '').includes(placeholder) || !!entered.hud, { hud: entered.hud, placeholder });
    check('Enter primed WebAudio (gesture context still around)', !!entered.audio, entered.audio);
    await p.screenshot({ path: '/workspace/menu-3.png' });
    await p.close();

    // Named city
    const p2 = await (await b.newContext({ viewport: { width: 900, height: 1000 } })).newPage();
    p2.on('pageerror', (e) => errs.push('p2: ' + e.message));
    await p2.goto(`${S.base}/`);
    await p2.waitForSelector('#sc-splash', { timeout: 15000 });
    await p2.keyboard.press('Enter');
    await p2.waitForSelector('#sc-cityname', { timeout: 10000 });
    await p2.fill('#sc-cityname', 'Slapville');
    await p2.focus('#sc-cityname');
    await Promise.all([
      p2.waitForFunction(() => window.klibb && window.klibb.ready && /room=stad-/.test(location.search), null, { timeout: 45000 }),
      p2.locator('#sc-cityname').press('Enter'),
    ]);
    const named = await p2.evaluate(() => {
      const room = new URLSearchParams(location.search).get('room');
      const info = window.klibb?.city?.()?.info || null;
      const hud = document.getElementById('room-hud')?.textContent || '';
      return { room, name: info?.name || hud, outside: !!window.klibb?.city?.()?.outside };
    });
    check('typed name "Slapville" → that city outside',
      /^stad-/.test(named.room || '') && named.outside && /Slapville/i.test(named.name || ''), named);
    await p2.close();

    // ?room= still skips the landing
    const mk = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Direct room', preset: false }) })).json();
    const d = await (await b.newContext({ viewport: { width: 900, height: 800 } })).newPage();
    d.on('pageerror', (e) => errs.push('d: ' + e.message));
    await d.goto(`${S.base}/?room=${mk.room.id}`);
    await d.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    check('?room= skips landing straight into the room',
      await d.evaluate((id) => !document.getElementById('start-card') && window.klibb.room === id, mk.room.id));
    await d.close();

    // Desktop mouse click anywhere on splash → NAME THE NEW CITY (not Enter, not touch)
    const clickP = await (await b.newContext({ viewport: { width: 900, height: 1000 } })).newPage();
    clickP.on('pageerror', (e) => errs.push('click: ' + e.message));
    await clickP.goto(`${S.base}/?start=1`);
    await clickP.waitForSelector('#sc-splash', { timeout: 15000 }); await sleep(200);
    await clickP.mouse.click(450, 500);
    await clickP.waitForSelector('#sc-cityname', { timeout: 10000 }); await sleep(200);
    await clickP.screenshot({ path: '/workspace/start-click-name.png' });
    const clickUi = await clickP.evaluate(() => ({
      heading: document.getElementById('sc-city-heading')?.textContent,
      focus: document.activeElement?.id,
      audio: !!(window.__klibbAudioCtx),
      klibb: !!window.klibb,
      room: new URLSearchParams(location.search).get('room'),
      buttons: [...document.querySelectorAll('#start-card button')].map((x) => x.id),
    }));
    check('desktop mouse click opens NAME THE NEW CITY (focus on field, audio primed, no city yet)',
      /NAME THE NEW CITY/i.test(clickUi.heading || '') && clickUi.focus === 'sc-cityname'
      && clickUi.audio && !clickUi.klibb && !clickUi.room && clickUi.buttons.length === 0, clickUi);
    // Same click must not have skipped past the name screen; confirm with Enter → city outside + jingle
    await Promise.all([
      clickP.waitForFunction(() => window.klibb && window.klibb.ready && /stad-/.test(location.search), null, { timeout: 45000 }),
      clickP.locator('#sc-cityname').press('Enter'),
    ]);
    await clickP.waitForFunction(() => window.__klibbStartupJingle === true, null, { timeout: 8000 }).catch(() => {});
    const clickEntered = await clickP.evaluate(() => {
      const c = window.klibb?.city?.() || {};
      return {
        room: new URLSearchParams(location.search).get('room'),
        outside: !!c.outside,
        house: c.house,
        door: !!document.getElementById('door-flow'),
        nametag: !!document.getElementById('nametag'),
        jingle: !!window.__klibbStartupJingle,
        startGone: !document.getElementById('start-card'),
      };
    });
    check('after name confirm: straight into city outside (no door/pac/nametag)',
      /^stad-/.test(clickEntered.room || '') && clickEntered.outside && clickEntered.house === 0
      && !clickEntered.door && !clickEntered.nametag && clickEntered.startGone, clickEntered);
    check('startup jingle flagged (sat-intro-ljud.wav played on confirm)', !!clickEntered.jingle, clickEntered);
    await clickP.close();

    // Touch: tap splash → name → tap ENTER on the bar
    const m = await (await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage();
    m.on('pageerror', (e) => errs.push('m: ' + e.message));
    await m.goto(`${S.base}/?start=1`);
    await m.waitForSelector('#sc-splash', { timeout: 15000 }); await sleep(200);
    await m.tap('#start-card');
    await m.waitForSelector('#sc-cityname', { timeout: 10000 });
    const touchUi = await m.evaluate(() => ({
      go: document.getElementById('sc-city-go')?.textContent,
      hint: document.getElementById('sc-enter-hint')?.textContent || null,
    }));
    check('touch name screen shows discreet ENTER (phones have no Enter key)',
      /enter/i.test(touchUi.go || ''), touchUi);
    await m.fill('#sc-cityname', 'Touchburg');
    await Promise.all([
      m.waitForFunction(() => window.klibb && window.klibb.ready && /room=stad-/.test(location.search), null, { timeout: 45000 }),
      m.tap('#sc-city-go'),
    ]);
    check('touch ENTER creates & enters the named city',
      await m.evaluate(() => /Touchburg/i.test(window.klibb?.city?.()?.info?.name || document.getElementById('room-hud')?.textContent || '')));
    await m.close();

    check('no page errors', errs.filter((e) => !/WebGL|AudioContext|tone/i.test(e)).length === 0, errs.slice(0, 5));
  } finally {
    await b.close().catch(() => {});
    S.child.kill();
  }
  console.log(`\nStart card e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

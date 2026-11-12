// E2E: landing → straight into a new city (startcard.js; Jens, Nov 2026; t864u: no naming step – a fictional name).
// Covers Enter, desktop mouse click, and touch tap → city outside.
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

    // Enter → straight into a NEW city with a fictional name (Jens t864u: no "name the city" step any more)
    await Promise.all([
      p.waitForFunction(() => window.klibb && window.klibb.ready && /stad-/.test(location.search), null, { timeout: 45000 }),
      p.keyboard.press('Enter'),
    ]);
    const entered = await p.evaluate(() => {
      const room = new URLSearchParams(location.search).get('room');
      const hud = document.getElementById('room-hud')?.textContent || '';
      return { room, outside: !!(window.klibb && window.klibb.city && window.klibb.city().outside), hud, name: window.klibb.cityInfo?.()?.name || '',
        startGone: !document.getElementById('start-card'), audio: !!(window.__klibbAudioCtx), nameField: !!document.getElementById('sc-cityname') };
    });
    check('Enter creates a city (stad-*) and enters it at once – no name step', /^stad-[a-z0-9]+$/i.test(entered.room || '') && entered.outside && entered.startGone && !entered.nameField, entered);
    check(`the new city has a fictional name ("${entered.name}") shown in the HUD`, !!entered.name && entered.hud.includes(entered.name), entered);
    check('Enter primed WebAudio (gesture context still around)', !!entered.audio, entered.audio);
    await p.close();

    // ?room= still skips the landing
    const mk = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Direct room', preset: false }) })).json();
    const d = await (await b.newContext({ viewport: { width: 900, height: 800 } })).newPage();
    d.on('pageerror', (e) => errs.push('d: ' + e.message));
    await d.goto(`${S.base}/?room=${mk.room.id}`);
    await d.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    check('?room= skips landing straight into the room',
      await d.evaluate((id) => !document.getElementById('start-card') && window.klibb.room === id, mk.room.id));
    await d.close();

    // Desktop mouse click anywhere on splash → straight into a new city (+ the jingle)
    const clickP = await (await b.newContext({ viewport: { width: 900, height: 1000 } })).newPage();
    clickP.on('pageerror', (e) => errs.push('click: ' + e.message));
    await clickP.goto(`${S.base}/?start=1`);
    await clickP.waitForSelector('#sc-splash', { timeout: 15000 }); await sleep(200);
    await Promise.all([
      clickP.waitForFunction(() => window.klibb && window.klibb.ready && /stad-/.test(location.search), null, { timeout: 45000 }),
      clickP.mouse.click(450, 500),
    ]);
    await clickP.waitForFunction(() => window.__klibbStartupJingle === true, null, { timeout: 8000 }).catch(() => {});
    const clickEntered = await clickP.evaluate(() => {
      const c = window.klibb?.city?.() || {};
      return { room: new URLSearchParams(location.search).get('room'), outside: !!c.outside, house: c.house, door: !!document.getElementById('door-flow'),
        nametag: !!document.getElementById('nametag'), jingle: !!window.__klibbStartupJingle, startGone: !document.getElementById('start-card') };
    });
    check('desktop click: straight into a new city outside (no name step, door, pac or nametag)',
      /^stad-/.test(clickEntered.room || '') && clickEntered.outside && clickEntered.house === 0 && !clickEntered.door && !clickEntered.nametag && clickEntered.startGone, clickEntered);
    check('startup jingle flagged (sat-intro-ljud.wav played)', !!clickEntered.jingle, clickEntered);
    await clickP.close();

    // Touch: tap the splash → straight in
    const m = await (await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage();
    m.on('pageerror', (e) => errs.push('m: ' + e.message));
    await m.goto(`${S.base}/?start=1`);
    await m.waitForSelector('#sc-splash', { timeout: 15000 }); await sleep(200);
    await Promise.all([
      m.waitForFunction(() => window.klibb && window.klibb.ready && /room=stad-/.test(location.search), null, { timeout: 45000 }),
      m.tap('#start-card'),
    ]);
    check('touch tap: straight into a new city', await m.evaluate(() => !!window.klibb.city().outside && !document.getElementById('start-card')));
    await m.close();

    check('no page errors', errs.filter((e) => !/WebGL|AudioContext|tone/i.test(e)).length === 0, errs.slice(0, 5));
  } finally {
    await b.close().catch(() => {});
    S.child.kill();
  }
  console.log(`\nStart card e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

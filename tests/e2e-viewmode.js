// E2E (Jens, 2 Nov 2026, t470u):
//  1) a room starts in View mode, and View mode lets you look around (desktop: drag with the mouse, no lock needed);
//  2) the held sticker fades out completely → View mode; a click on a free surface (no sticker, no button)
//     → Slap mode (that click places nothing); in View mode a click on a sticker = a big "Made by" popup
//     with the creator and the Instagram link (a library sticker's credit is looked up too);
//  4) sound settings are personal: kept for this visit (room → the City), never sent to others, others'
//     sounds play with mine; the room's groove does not change mine; "Exit to menu" = all back to default.
// (3, the file-name credit rule, is in tests/sizeprefix.test.mjs + tests/stickercredit.test.mjs.)
// Own server (VIEWMODE_E2E_PORT, default 8911). Screenshots: PRESETPICKER_SHOTS (/workspace/presetpicker-shots).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.VIEWMODE_E2E_PORT || 8911);
const SHOTS = process.env.PRESETPICKER_SHOTS || '/workspace/presetpicker-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };
const CUSTOM = { patches: { slap: { gain: 0.3, layers: [{ kind: 'osc', wave: 'square', freq: 300, d: 0.5, level: 0.9 }] } }, fx: { crush: { bits: 3, wet: 0.5 } } };
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errs = [];
  try {
    const mk = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ style: { floor: 'betong', wall: 'tegel' }, preset: false }) })).json();
    const ready = (p) => p.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected && window.klibb.state.library.length > 0 && window.klibb.net.status === 'online', null, { timeout: 30000 });
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${S.base}/?room=${mk.room.id}`); await ready(p);
    const st = () => p.evaluate(() => { const k = window.klibb; return { mode: k.state.mode, hud: document.getElementById('mode-hud').textContent, yaw: +k.controls.yaw.toFixed(3), pitch: +k.controls.pitch.toFixed(3), locked: k.controls.locked, preview: k.preview.mesh.visible, held: k.deskHeld() }; });
    const s0 = await st();
    check('1) the room starts in View mode ("Look mode" hint, no held sticker on the wall)', s0.mode === 'view' && /Look mode/.test(s0.hud) && !s0.preview, s0);
    await p.evaluate(() => { const k = window.klibb; k.setView('first', { quiet: true }); k.moveTo(0, 2); k.look(0, 0.05); }); await sleep(300);
    const a = await st();
    await p.mouse.move(640, 400); await p.mouse.down(); for (let i = 1; i <= 10; i++) { await p.mouse.move(640 + i * 20, 400 + i * 6); await sleep(16); } await p.mouse.up(); await sleep(300);
    const d = await st();
    check('…View mode: dragging with the mouse looks around (no lock needed), still View mode', Math.abs(d.yaw - a.yaw) > 0.3 && Math.abs(d.pitch - a.pitch) > 0.05 && d.mode === 'view', { a, d });
    await p.screenshot({ path: path.join(SHOTS, '30-viewmode-start.png') });
    // a library sticker with a credit (as the import gives it): Jens Tjerngren @jensregler
    const credited = await p.evaluate(() => { const k = window.klibb, d = k.state.library.find((x) => x.library && !x.nature && !x.artist && !x.artistLink); d.artist = 'Jens Tjerngren'; d.artistLink = 'https://www.instagram.com/jensregler'; return d.id; });
    await p.evaluate(async (id) => { const k = window.klibb; await k.selectDesign(k.state.library.find((x) => x.id === id)); k.setSize(120); k.moveTo(0, 2); k.look(0, 0.05); await new Promise((r) => setTimeout(r, 150)); return k.stampAt(0, 0); }, credited);
    await p.waitForFunction(() => window.klibb.pendingSlaps() === 0, null, { timeout: 15000 });
    await p.evaluate(() => { const k = window.klibb; k.setMode('view', { quiet: true }); k.look(0, 0.05); }); await sleep(300);
    const m1 = await st();
    // click the sticker (middle of the screen) with the mouse free
    await p.mouse.click(640, 400); await sleep(500);
    const cr = await p.evaluate(() => { const e = document.getElementById('credit'); const r = e.getBoundingClientRect(); return { shown: !e.hidden, name: document.getElementById('credit-name').textContent, link: document.getElementById('credit-link').getAttribute('href'), label: document.getElementById('credit-link').textContent, nameSize: parseFloat(getComputedStyle(document.getElementById('credit-name')).fontSize), w: r.width, mode: window.klibb.state.mode }; });
    check('2) View mode: clicking a sticker shows a big "Made by" popup – Jens Tjerngren + the Instagram link (looked up from the library)', cr.shown && cr.name === 'Jens Tjerngren' && /instagram\.com\/jensregler/.test(cr.link) && cr.nameSize >= 30 && cr.mode === 'view', { cr, m1 });
    await p.screenshot({ path: path.join(SHOTS, '31-viewmode-credit-popup.png') });
    // a free surface: Slap mode (that click places nothing)
    const n0 = await p.evaluate(() => window.klibb.stamps.meshes.size);
    await p.evaluate(() => { const k = window.klibb; k.look(0.6, 0.1); }); await sleep(300);
    await p.mouse.click(640, 400); await sleep(500);
    const s2 = await st();
    check('…a click on a free surface (floor, no sticker, no button) → Slap mode; that click placed nothing', s2.mode === 'slap' && (await p.evaluate(() => window.klibb.stamps.meshes.size)) === n0 && s2.held && s2.held.canSlap && s2.held.opacity === 1, s2);
    await p.screenshot({ path: path.join(SHOTS, '32-slapmode-after-click.png') });
    // slap once (a sticker not placed yet stays held until placed), then fade → View mode
    await p.mouse.click(640, 400); await sleep(400);
    check('…the next click slaps', (await p.evaluate(() => window.klibb.stamps.meshes.size)) === n0 + 1);
    await p.waitForFunction(() => window.klibb.state.mode === 'view', null, { timeout: 9000 }).catch(() => {});
    const s3 = await st();
    check('…untouched, the held sticker fades out completely (2 s + 1 s) and it is View mode again', s3.mode === 'view' && s3.held.opacity === 0 && /Look mode/.test(s3.hud), s3);
    // 4) personal sound
    await p.evaluate((c) => { sessionStorage.setItem('klibb.sound', JSON.stringify(c)); sessionStorage.setItem('klibb.musicVol', '0.4'); sessionStorage.setItem('klibb.grooveScale', '2'); }, CUSTOM);
    await p.reload(); await ready(p); await sleep(800);
    const o = await (await b.newContext({ viewport: { width: 800, height: 600 } })).newPage(); o.on('pageerror', (e) => errs.push('o: ' + e.message));
    await o.goto(`${S.base}/?room=${mk.room.id}`); await ready(o); await sleep(1500);
    const pid = await p.evaluate(() => window.klibb.net.id), oid = await o.evaluate(() => window.klibb.net.id);
    const mine = await p.evaluate((oid) => ({ me: window.klibb.voiceOf(null), them: window.klibb.voiceOf(oid), vol: window.klibb.sound.volume, groove: window.klibb.groove().scale }), oid);
    const theirs = await o.evaluate((pid) => ({ heardP: window.klibb.voiceOf(pid), groove: window.klibb.groove().scale }), pid);
    check('4) my sound settings are mine: kept this visit (patches, effects, Music vol 0.4, groove 2×)', !!mine.me.patches && !!mine.me.fx && mine.vol === 0.4 && mine.groove === 2, mine);
    check('…never sent: the other person hears me with THEIR (default) sound, their groove untouched', theirs.heardP && !theirs.heardP.patches && !theirs.heardP.fx && theirs.groove === 1, theirs);
    check('…others\' slaps play for me with MY settings (their seed and colour)', !!mine.them && !!mine.them.patches && !!mine.them.fx, mine.them);
    // the room's groove changed by someone (the old room setting): mine stays
    await o.evaluate(async (room) => { await fetch(`/api/rooms/${room}/groove`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-admin-token': 'demo-e2e-admin' }, body: JSON.stringify({ scale: 0.5 }) }).catch(() => null); }, mk.room.id); await sleep(800);
    check('…a room groove change (old room setting) does not touch mine', (await p.evaluate(() => window.klibb.groove().scale)) === 2);
    check('…nothing about sound in localStorage (old keys gone)', await p.evaluate(() => ['klibb.sound', 'klibb.musicVol', 'klibb.grooveScale'].every((k) => localStorage.getItem(k) === null)));
    // out into the City: they come along
    await p.goto(`${S.base}/?room=stad`); await p.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 }); await sleep(500);
    const city = await p.evaluate(() => ({ me: window.klibb.voiceOf(null), vol: window.klibb.sound.volume, groove: window.klibb.groove().scale }));
    check('…into the City: my sound settings come along', !!city.me.patches && city.vol === 0.4 && city.groove === 2, city);
    // Exit to menu: all back to default
    await p.goto(`${S.base}/?start=1`);
    await p.waitForSelector('#sc-splash, #sc-new', { timeout: 15000 });
    if (!(await p.$('#sc-new'))) { await p.click('#start-card'); await p.waitForSelector('#sc-new', { timeout: 10000 }); }
    const menu = await p.evaluate(() => ['klibb.sound', 'klibb.musicVol', 'klibb.grooveScale'].map((k) => sessionStorage.getItem(k)));
    check('"Exit to menu": every sound setting back to default', menu.every((x) => x === null), menu);
    await p.click('#sc-new'); await p.click('#sc-empty');
    await p.waitForSelector('#sc-details', { timeout: 10000 }); await p.fill('#sc-name', 'Jens'); await p.click('#sc-enter');
    await p.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 }); await sleep(500);
    const fresh = await p.evaluate(() => ({ me: window.klibb.voiceOf(null), vol: window.klibb.sound.volume, groove: window.klibb.groove().scale, mode: window.klibb.state.mode }));
    check('…a new room starts with the default sound (and in View mode)', !fresh.me.patches && !fresh.me.fx && fresh.vol === 1 && fresh.groove === 1 && fresh.mode === 'view', fresh);
    // phone: starts with nothing in hand (= view), a tap on a sticker = the popup
    const m = await (await b.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage(); m.on('pageerror', (e) => errs.push('m: ' + e.message));
    await m.goto(`${S.base}/?room=${mk.room.id}`); await m.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.library.length > 0, null, { timeout: 30000 }); await sleep(800);
    const hm = await m.evaluate(() => window.klibb.held());
    check('phone: a room starts with nothing in hand (View: a tap wakes it, never slaps)', hm && (hm.state === 'idle' || hm.opacity === 0), hm);
    await m.evaluate((id) => { const k = window.klibb; k.state.library.find((x) => x.id === id).artist = 'Jens Tjerngren'; k.state.library.find((x) => x.id === id).artistLink = 'https://www.instagram.com/jensregler'; k.setView('first', { quiet: true }); k.moveTo(0, 2); k.look(0, 0.05); }, credited); await sleep(600);
    await m.tap('#scene', { position: { x: 215, y: 466 } }); await sleep(600);
    const mc = await m.evaluate(() => ({ shown: !document.getElementById('credit').hidden, name: document.getElementById('credit-name').textContent }));
    check('phone: a tap on the sticker shows the big popup', mc.shown && mc.name === 'Jens Tjerngren', mc);
    await m.screenshot({ path: path.join(SHOTS, '33-phone-credit-popup.png') });
    check('no page errors', errs.length === 0, errs);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await b.close(); S.child.kill();
  console.log(`\nView mode + personal sound e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

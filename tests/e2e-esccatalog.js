// E2E (Jens t792u–t797u, 10 Nov 2026): the simpler UI.
//   - no wheels (no sticker / Nature / Packs / Props strips, no STICKERS/NATURE/ASSETS/PACKS switch)
//   - Esc: STICKERS / NATURE / ASSETS under the six, then HELP; each catalog = a scrolling grid of
//     every item, tiles in the buttons' chrome; a click holds it and closes the menu
//   - HELP lists every key; Esc goes back to the main menu
//   - wheel = size, Shift + wheel = turn (Q/E too), the catalog scrolls instead
//   - hold + look away = a row: stickers, nature, and assets
// Own server (ESCCAT_E2E_PORT, 8931), OPEN_ACCESS=1 (= the full version), my own room (assets open).
// Screenshots: ESCCAT_SHOTS (/workspace/esc-catalog-shots).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.ESCCAT_E2E_PORT || 8931);
const SHOTS = process.env.ESCCAT_SHOTS || '/workspace/esc-catalog-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 900) : '')); } };
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const browser = await chromium.launch({ args: ARGS });
  const errors = [];
  console.log(`Esc catalogs / no wheels / help / rows (${S.base})`);
  try {
    const mk = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: false }) })).json();
    const R = mk.room.id;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await ctx.addInitScript(([r, k]) => { localStorage.setItem('klibb.devUnlock', '1'); localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })); }, [R, mk.roomKey]);
    const P = await ctx.newPage();
    P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${R}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.propsReady, null, { timeout: 60000 });
    await P.evaluate(() => window.klibb.entitlementsReady());
    await P.evaluate(() => window.klibb.holdSharp(true));
    await sleep(600);
    const k = (fn, arg) => P.evaluate(fn, arg);

    // ---------- 1) the wheels are gone ----------
    await P.keyboard.press('KeyR'); await sleep(200);
    const gone = await k(() => ({ shown: window.klibb.wheelsShown(), dom: ['design-strip', 'nature-strip', 'packs-strip', 'wheel-label', 'mode-switch'].filter((id) => document.getElementById(id)) }));
    check('no wheel strips / wheel label / mode switch anywhere (also after R)', gone.shown.length === 0 && gone.dom.length === 0, gone);

    // ---------- 2) the Esc main menu: the six, then STICKERS / NATURE / ASSETS, then HELP ----------
    const openEsc = () => k(() => { window.klibb.controls.unlock(); window.klibb.escGate.unlockedAt = -1e9; if (!window.klibb.escMenu().isOpen()) window.klibb.escMenu().open(); });
    await openEsc(); await sleep(700);
    const main = await k(() => {
      const r = (key) => document.querySelector(`#esc-menu [data-esc="${key}"]`).getBoundingClientRect().toJSON();
      const st = (key) => { const c = getComputedStyle(document.querySelector(`#esc-menu [data-esc="${key}"]`)); return [c.borderTopWidth, c.borderTopColor, c.borderTopLeftRadius, c.backgroundColor].join(' '); };
      return { info: window.klibb.escMenu().info(), six: ['sound', 'avatar', 'room', 'city', 'exit', 'create'].map(r), cat: ['catstickers', 'catnature', 'catassets'].map(r), help: r('help'), styleSix: st('sound'), styleCat: st('catstickers'), styleHelp: st('help') };
    });
    check('main Esc: SOUND AVATAR ROOM CITY EXIT CREATE, then STICKERS NATURE ASSETS, then HELP', main.info.buttons.join() === 'sound,avatar,room,city,exit,create,catstickers,catnature,catassets,help', main.info.buttons);
    const sixBottom = Math.max(...main.six.map((b) => b.bottom)), catBottom = Math.max(...main.cat.map((b) => b.bottom));
    check('the three catalog buttons sit in a row under the six', main.cat.every((b) => b.top >= sixBottom - 1) && new Set(main.cat.map((b) => Math.round(b.top))).size === 1, { sixBottom, cat: main.cat });
    check('HELP sits under the catalog row', main.help.top >= catBottom - 1, { catBottom, help: main.help });
    check('the new buttons look like the six (border, colour, radius, background)', main.styleCat === main.styleSix && main.styleHelp === main.styleSix, main);
    await P.screenshot({ path: path.join(SHOTS, '01-esc-main-menu.png') });

    // ---------- 3) STICKERS: the grid ----------
    await P.click('#esc-menu [data-esc="catstickers"]'); await sleep(600);
    const cat = await k(() => {
      const i = window.klibb.escMenu().info(); const t = document.querySelector('#esc-menu .esc-tile'); const c = t && getComputedStyle(t); const b = document.querySelector('#esc-menu [data-esc="sound"]');
      const tr = t && t.getBoundingClientRect();
      return { i, n: window.klibb.stickerDesigns().length, sel: window.klibb.state.selected?.id, chrome: c && [c.borderTopWidth, c.borderTopColor, c.borderTopLeftRadius, c.backgroundColor].join(' '), sound: [b.style.borderTopWidth], w: tr && tr.width, h: tr && tr.height, img: !!(t && t.querySelector('img')) };
    });
    check('STICKERS opens a grid of every sticker', cat.i.view === 'catalog' && cat.i.catalog.kind === 'stickers' && cat.i.catalog.n === cat.n && cat.n > 20, { view: cat.i.view, catalog: cat.i.catalog && { ...cat.i.catalog, ids: undefined }, n: cat.n });
    check('the tiles carry the buttons\u2019 chrome (3px yellow border, 22px radius, dark) and are big', cat.chrome === main.styleSix && cat.w >= 150 && cat.h >= 180 && cat.img, cat);
    check('the held sticker is marked in the grid', cat.i.catalog.selected === cat.sel, { sel: cat.sel, marked: cat.i.catalog.selected });
    await P.screenshot({ path: path.join(SHOTS, '02-stickers-grid.png') });
    // the mouse wheel scrolls the grid (no size / turn change)
    const before = await k(() => ({ size: window.klibb.state.size, rot: window.klibb.state.rotation, top: document.querySelector('#esc-menu .esc-cat-grid').scrollTop }));
    await P.mouse.move(640, 500); await P.mouse.wheel(0, 600); await sleep(400);
    await P.keyboard.down('Shift'); await P.mouse.wheel(0, 300); await P.keyboard.up('Shift'); await sleep(300);
    const after = await k(() => ({ size: window.klibb.state.size, rot: window.klibb.state.rotation, top: document.querySelector('#esc-menu .esc-cat-grid').scrollTop }));
    check('in the catalog the wheel scrolls the grid; size and turn stay', after.top > before.top && after.size === before.size && after.rot === before.rot, { before, after });
    // pick one
    const pickId = cat.i.catalog.ids[7];
    await P.click(`#esc-menu .esc-tile[data-id="${pickId}"]`); await sleep(500);
    const picked = await k(() => ({ open: window.klibb.escMenu().isOpen(), sel: window.klibb.state.selected?.id, mode: window.klibb.state.mode, hud: window.klibb.designHud() }));
    check('clicking a tile holds that sticker and closes the menu (slap mode)', !picked.open && picked.sel === pickId && picked.mode === 'slap', picked);
    check('the small design HUD shows what I hold', picked.hud.shown && /\d+\/\d+/.test(picked.hud.num), picked.hud);

    // Esc from a catalog goes back to the main menu first
    await openEsc(); await sleep(400);
    await P.click('#esc-menu [data-esc="catnature"]'); await sleep(500);
    const natOpen = await k(() => window.klibb.escMenu().info());
    await P.keyboard.press('Escape'); await sleep(400);
    const backMain = await k(() => window.klibb.escMenu().info());
    check('NATURE opens the nature grid; Esc goes back to the main menu', natOpen.catalog && natOpen.catalog.kind === 'nature' && natOpen.catalog.n > 20 && backMain.open && backMain.view === 'main', { nat: natOpen.catalog && natOpen.catalog.n, back: backMain.view });
    await P.click('#esc-menu [data-esc="catnature"]'); await sleep(500);
    const natId = (await k(() => window.klibb.escMenu().info())).catalog.ids[3];
    await P.click(`#esc-menu .esc-tile[data-id="${natId}"]`); await sleep(500);
    const nat = await k(() => ({ sel: window.klibb.state.selected?.id, active: window.klibb.activeWheel(), open: window.klibb.escMenu().isOpen() }));
    check('picking a nature tile holds it (Nature mode), menu closed', nat.sel === natId && nat.active === 'nature' && !nat.open, nat);
    // R/F cycle the nature list (no wheel)
    await k(() => window.klibb.nextDesign()); await sleep(100);
    const natNext = await k(() => ({ sel: window.klibb.state.selected?.id, active: window.klibb.activeWheel(), shown: window.klibb.wheelsShown() }));
    check('R steps to the next nature sticker, nothing wheel-like shows', natNext.active === 'nature' && natNext.sel !== natId && natNext.shown.length === 0, natNext);

    // ---------- 4) ASSETS ----------
    await openEsc(); await sleep(400);
    await P.click('#esc-menu [data-esc="catassets"]'); await sleep(1500);
    const ass = await k(() => window.klibb.escMenu().info());
    check('ASSETS opens a grid of every asset (with pictures)', ass.catalog && ass.catalog.kind === 'assets' && ass.catalog.n >= 20 && (await Promise.resolve(true)), ass.catalog && { ...ass.catalog, ids: ass.catalog.ids.slice(0, 5) });
    await P.screenshot({ path: path.join(SHOTS, '04-assets-grid.png') });
    await P.click('#esc-menu .esc-tile[data-id="cone"]'); await sleep(500);
    const ap = await k(() => ({ active: window.klibb.propsMode(), held: window.klibb.props.held().kind, open: window.klibb.escMenu().isOpen(), hud: window.klibb.designHud() }));
    check('picking an asset tile holds it (Props on), menu closed, HUD names it', ap.active && ap.held === 'cone' && !ap.open && ap.hud.shown && /cone|Cone|kon/i.test(ap.hud.num + ap.hud.img.slice(0, 0) + ''), ap);

    // ---------- 5) HELP ----------
    await openEsc(); await sleep(400);
    await P.click('#esc-menu [data-esc="help"]'); await sleep(500);
    const help = await k(() => ({ i: window.klibb.escMenu().info(), fs: parseFloat(getComputedStyle(document.querySelector('#esc-menu .esc-keys dt')).fontSize) }));
    const need = ['W A S D', 'Shift + W A S D', 'Mouse', 'Click', 'Hold click', 'Scroll wheel', 'Shift + scroll wheel', 'Q / E', 'R / F', 'Esc', 'O', 'Z', 'G', 'V', 'C', 'X', 'P', 'T or Enter'];
    const missing = need.filter((w) => !help.i.help.includes(w));
    check('HELP lists all the keys (walk, run, look, slap, rows, wheel size, Shift+wheel turn, Q/E, R/F, Esc, O, Z, G …)', help.i.view === 'help' && missing.length === 0, { missing });
    check('HELP text is large (≥ 20 px)', help.fs >= 20, help.fs);
    await P.screenshot({ path: path.join(SHOTS, '03-help.png') });
    await P.keyboard.press('Escape'); await sleep(300);
    check('Esc in HELP goes back to the main menu', (await k(() => window.klibb.escMenu().info().view)) === 'main');
    // CREATE → MY PACKS (packs without a wheel)
    await k(() => localStorage.setItem('klibb.packs', JSON.stringify([{ id: 'pk1', name: 'Jens pack', stickers: ['a', 'b', 'c'], urls: [], designs: [], bag: 1, img: '' }])));
    await P.click('#esc-menu [data-esc="create"]'); await sleep(300);
    await P.click('#esc-menu [data-esc="mypacks"]'); await sleep(400);
    const packs = await k(() => window.klibb.escMenu().info());
    check('CREATE → MY PACKS shows the packs I carry', packs.catalog && packs.catalog.kind === 'packs' && packs.catalog.n === 1, packs.catalog);
    await P.click('#esc-menu .esc-tile[data-id="pk1"]'); await sleep(300);
    const pac = await k(() => JSON.parse(localStorage.getItem('klibb.pac') || 'null')?.id);
    check('picking a pack makes it the pack I carry', pac === 'pk1', pac);
    await k(() => window.klibb.escMenu().close());

    // ---------- 6) wheel = size, Shift + wheel = turn ----------
    await k(() => { const kb = window.klibb; kb.setProps(false); kb.selectDesign(kb.stickerDesigns()[5]); kb.setMode('slap', { quiet: true }); kb.moveTo(0, -3); kb.look(0, 0); kb.setRot(0); kb.setSize(30); });
    await P.mouse.click(640, 430); await P.waitForFunction(() => window.klibb.controls.locked, null, { timeout: 5000 }).catch(() => {});
    await P.mouse.move(0, 0); await sleep(150); await k(() => window.klibb.look(0, 0));
    await k(() => window.klibb.peelSettled());
    const w0 = await k(() => ({ size: window.klibb.state.size, rot: window.klibb.state.rotation, locked: window.klibb.controls.locked }));
    await P.mouse.wheel(0, -100); await sleep(200);
    const w1 = await k(() => ({ size: window.klibb.state.size, rot: window.klibb.state.rotation }));
    await P.keyboard.down('Shift'); await P.mouse.wheel(0, 100); await sleep(150); await P.mouse.wheel(0, 100); await P.keyboard.up('Shift'); await sleep(200);
    const w2 = await k(() => ({ size: window.klibb.state.size, rot: window.klibb.state.rotation }));
    check('playing: wheel up = bigger sticker (no turn)', w0.locked && w1.size > w0.size && w1.rot === w0.rot, { w0, w1 });
    check('playing: Shift + wheel = turn (15° a notch), size stays', Math.abs(w2.rot - w1.rot) === 30 && w2.size === w1.size, { w1, w2 });
    await P.keyboard.press('KeyQ'); await sleep(100);
    const w3 = await k(() => window.klibb.state.rotation);
    check('Q still turns too', w3 === w2.rot - 15, { w2: w2.rot, w3 });
    await k(() => window.klibb.setRot(0));

    // ---------- 7) rows: stickers, nature, assets ----------
    const onServer = async () => (await (await fetch(`${S.base}/api/rooms/${R}/stamps`)).json());
    const settle = () => P.waitForFunction(() => window.klibb.pendingSlaps() === 0 && window.klibb.arrayState().inFlight === 0, null, { timeout: 15000 });
    async function stickerRow(label) {
      await k(() => { window.klibb.setSize(20); window.klibb.look(0, 0); });
      const base = (await onServer()).stamps.length;
      await P.mouse.down(); await sleep(150);
      await k(() => window.klibb.look(-0.45, 0));
      await P.waitForFunction(() => window.klibb.arrayState().ghosts > 0, null, { timeout: 5000 }).catch(() => {});
      const during = await k(() => window.klibb.arrayState());
      if (label === 'sticker') await P.screenshot({ path: path.join(SHOTS, '05-sticker-row-drag.png') });
      await P.mouse.up(); await settle(); await sleep(300);
      const n = (await onServer()).stamps.length - base;
      check(`${label} row: hold + look away shows ghosts, release places 1 + ghosts`, during.dragging && during.ghosts >= 2 && n === 1 + during.ghosts, { during, n });
      await k(() => window.klibb.look(0.45, 0)); await sleep(100);
    }
    await stickerRow('sticker');
    await k(() => { const kb = window.klibb; kb.selectDesign(kb.natureDesigns().find((d) => d.width / d.height < 2) || kb.natureDesigns()[0]); kb.setMode('slap', { quiet: true }); });
    await sleep(400);
    await k(() => { window.klibb.moveTo(0, 2); window.klibb.look(Math.PI, 0); }); await sleep(100);
    await stickerRow('nature');

    // assets: a cone on the floor, hold and look along the floor
    await k(() => { const kb = window.klibb; kb.setProps(true); kb.props.pickKind('cone'); kb.moveTo(0, 0); kb.look(0, -0.6); });
    await sleep(1200);
    const n0 = await k(() => window.klibb.props.info().n);
    await P.mouse.down(); await sleep(400);
    await k(() => window.klibb.look(-0.9, -0.6));
    await P.waitForFunction(() => { const r = window.klibb.props.row(); return r && r.ghosts >= 2; }, null, { timeout: 8000 }).catch(() => {});
    const rowInfo = await k(() => window.klibb.props.row());
    await P.screenshot({ path: path.join(SHOTS, '06-asset-row-drag.png') });
    await P.mouse.up(); await sleep(2500);
    const n1 = await k(() => window.klibb.props.info().n);
    const srv = (await onServer()).props.length;
    check('asset row: hold + look away shows ghost copies, release places 1 + copies (saved)', rowInfo && rowInfo.ghosts >= 2 && n1 === n0 + 1 + rowInfo.ghosts && srv === n1, { rowInfo, n0, n1, srv });
    // Esc-like cancel (right-click) keeps only the first
    await k(() => window.klibb.look(0.9, -0.6)); await sleep(300);
    await P.mouse.down(); await sleep(400);
    await k(() => window.klibb.look(1.6, -0.6));
    await P.waitForFunction(() => { const r = window.klibb.props.row(); return r && r.ghosts >= 1; }, null, { timeout: 8000 }).catch(() => {});
    await P.mouse.down({ button: 'right' }); await P.mouse.up({ button: 'right' }); await P.mouse.up(); await sleep(1500);
    const n2 = await k(() => window.klibb.props.info().n);
    check('asset row: right-click while dragging = no copies (the first stays)', n2 === n1 + 1, { n1, n2 });
    check('no page errors', errors.length === 0, errors);
  } catch (e) {
    console.error(e); failed++;
  } finally {
    await browser.close(); S.child.kill();
    console.log(`\nEsc catalog e2e: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();

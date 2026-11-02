// E2E: the menu stickers (Jens, 31 Oct + 2 Nov 2026). The sticker wheel starts on d71 (d72-d74 to
// its left, the menu stickers to its right, then the list from the back); a click on a placed menu
// sticker opens its menu: character → My avatar (+ Instagram name, seen by the others), redio →
// Sound settings (+ Music vol), room → the room info panel (clear your stickers), exit → Exit to
// menu / Back, door → Enter the city / Back. Own server (STICKERMENU_E2E_PORT, default 8899).
// Screenshots: STICKERMENU_SHOTS (default /workspace/stickermenu-shots).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.STICKERMENU_E2E_PORT || 8899);
const SHOTS = process.env.STICKERMENU_SHOTS || '/workspace/stickermenu-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };
const ID = { d71: '6705c0bb226e755f', d72: '637af7039ccbc251', d73: '63101930ca537cf2', d74: 'cdc47e9da5787154',
  character: '697fceb275175f0c', radio: '14ea2304625a5827', room: 'e8a93272e6311b69', door: 'fe62d4b007728d63', exit: 'a03b0ba5768979e6', camera: '910d8ca0408dcec8', nametag: 'f79189b79546d64a' };

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: false }) })).json();
    const R = made.room.id;
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx.addInitScript(([r, k]) => localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })), [R, made.roomKey]);
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${R}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected, null, { timeout: 60000 });
    await sleep(1200);

    // ---- 9) the wheel at start ----
    const w = await P.evaluate(() => {
      const list = window.klibb.stickerDesigns().map((d) => d.id), n = list.length, at = (k) => list[((k % n) + n) % n];
      const btn = (id) => { const b = document.querySelector(`#strip-row .strip-th[data-id="${id}"]`); if (!b || b.style.display === 'none') return null; const r = b.getBoundingClientRect(); return r.x + r.width / 2; };
      return { sel: window.klibb.state.selected.id, strip: window.klibb.strip().sel, left: [-1, -2, -3].map(at), right: [1, 2, 3, 4, 5, 6, 7].map(at),
        x: Object.fromEntries(['d71', 'd72', 'd73', 'd74'].map((k) => [k, null])), ids: list.slice(0, 3), btnX: (id) => 0, n };
    });
    check('the wheel starts on d71 (held, in the middle)', w.sel === ID.d71 && w.strip === ID.d71, { sel: w.sel, strip: w.strip });
    check('…d72, d73, d74 to its left', JSON.stringify(w.left) === JSON.stringify([ID.d72, ID.d73, ID.d74]), w.left);
    check('…the menu stickers to its right: character, redio, room, door, exit, camera, name-tag roll', JSON.stringify(w.right) === JSON.stringify([ID.character, ID.radio, ID.room, ID.door, ID.exit, ID.camera, ID.nametag]), w.right);
    const xs = await P.evaluate((ids) => Object.fromEntries(Object.entries(ids).map(([k, id]) => { const b = document.querySelector(`#strip-row .strip-th[data-id="${id}"]`); const r = b && b.style.display !== 'none' ? b.getBoundingClientRect() : null; return [k, r && r.width ? Math.round(r.x + r.width / 2) : null]; })), ID);
    check('…on screen too: d72 left of d71, character right of it', xs.d71 && xs.d72 && xs.character && xs.d72 < xs.d71 && xs.character > xs.d71, xs);
    await P.screenshot({ path: path.join(SHOTS, '1-wheel-at-start.png'), clip: { x: 0, y: 1000 - 300, width: 1600, height: 300 } });
    await P.screenshot({ path: path.join(SHOTS, '1-wheel-at-start-full.png') });

    // ---- slap the menu stickers onto the north wall ----
    await P.evaluate(() => { const k = window.klibb; k.setView('first', { quiet: true }); k.moveTo(0, -1.4); k.look(0, 0.05); });
    await sleep(500);
    const spots = { character: [-0.55, 0.35], radio: [0, 0.35], room: [0.55, 0.35], exit: [-0.55, -0.3], door: [0, -0.3] };
    const lib = await P.evaluate(() => window.klibb.stickerDesigns());
    for (const [k, [x, y]] of Object.entries(spots)) {
      await P.evaluate((d) => window.klibb.selectDesign(d), lib.find((d) => d.id === ID[k])); await sleep(500);
      await P.evaluate(() => { window.klibb.controls.locked = true; window.klibb.setSize(45); });
      await P.evaluate(([x, y]) => window.klibb.stampAt(x, y), [x, y]);
      await P.evaluate(() => { window.klibb.controls.locked = false; }); await sleep(300);
    }
    await sleep(800);
    const srv = (await (await fetch(`${S.base}/api/rooms/${R}/stamps`)).json()).stamps;
    check('five menu stickers slapped (like any sticker)', srv.length === 5, srv.map((s) => s.imageId));
    const menus = await P.evaluate((spots) => Object.fromEntries(Object.entries(spots).map(([k, [x, y]]) => [k, window.klibb.menuAt(x, y)])), spots);
    check('each one is recognised as its menu sticker where it hangs', menus.character === 'character' && menus.radio === 'radio' && menus.room === 'room' && menus.exit === 'exit' && menus.door === 'door', menus);
    await P.screenshot({ path: path.join(SHOTS, '2-menu-stickers-on-the-wall.png') });
    const notMenu = await P.evaluate(() => window.klibb.menuClick(0.95, 0.9));
    check('a click elsewhere is not a menu', notMenu === false);

    // ---- 1) character → My avatar + Instagram name ----
    await P.evaluate(([x, y]) => window.klibb.menuClick(x, y), spots.character);
    await P.waitForFunction(() => { const v = window.klibb.avatarView(); return v && v.visible; }, null, { timeout: 15000 });
    const av = await P.evaluate(() => ({ open: !document.getElementById('avatar-panel').hidden, name: !!document.getElementById('av-name'), insta: !!document.getElementById('av-insta'), label: document.querySelector('.av-insta span')?.textContent }));
    check('character sticker → My avatar opens (zoomed avatar), with Name and Instagram name fields', av.open && av.name && av.insta, av);
    await P.fill('#av-name', 'Jens'); await P.fill('#av-insta', '@Slap.And_Talk!');
    const typed = await P.inputValue('#av-insta');
    check('…the Instagram field keeps only what Instagram allows (no @, no !)', typed === 'slap.and_talk', typed);
    await sleep(600);
    await P.screenshot({ path: path.join(SHOTS, '3-character-my-avatar-instagram.png') });
    await P.click('#av-ok'); await sleep(500);
    const saved = await P.evaluate(() => JSON.parse(localStorage.getItem('klibb.avatar')));
    check('…saved with the avatar (look.insta)', saved.name === 'Jens' && saved.look.insta === 'slap.and_talk', saved);
    const B = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); B.on('pageerror', (e) => errors.push('B: ' + e.message));
    await B.goto(`${S.base}/?room=${R}`);
    await B.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.players().length === 1 && window.klibb.players()[0].look.insta, null, { timeout: 30000 });
    const seen = await B.evaluate(() => window.klibb.players()[0]);
    check('the other player gets the Instagram name in my look', seen.look.insta === 'slap.and_talk', seen.look);
    await P.evaluate(() => { const k = window.klibb; k.moveTo(0, -1.4); k.look(0, 0.05); });
    await B.evaluate(() => { const k = window.klibb; k.moveTo(0, -0.4); k.look(0, 0); });
    await sleep(1500);
    await B.screenshot({ path: path.join(SHOTS, '4-name-and-instagram-above-head.png') });

    // ---- 2) redio → Sound settings + Music vol ----
    await P.evaluate(([x, y]) => window.klibb.menuClick(x, y), spots.radio); await sleep(600);
    const snd = await P.evaluate(() => ({ open: !document.getElementById('sound-panel').hidden, vol: document.getElementById('music-vol')?.value, label: document.querySelector('#music-vol-row span')?.textContent }));
    check('redio sticker → Sound settings opens, with a Music vol slider', snd.open && snd.vol === '100' && snd.label === 'Music vol', snd);
    await P.evaluate(() => { const r = document.getElementById('music-vol'); r.value = '35'; r.dispatchEvent(new Event('input', { bubbles: true })); });
    check('…Music vol sets how loud the room is for me (kept on this device)', await P.evaluate(() => localStorage.getItem('klibb.musicVol') === '0.35'));
    await P.screenshot({ path: path.join(SHOTS, '5-redio-sound-settings-music-vol.png') });
    await P.evaluate(() => document.getElementById('snd-close').click()); await sleep(300);

    // ---- 3) room → the room info panel ----
    await P.evaluate(([x, y]) => window.klibb.menuClick(x, y), spots.room); await sleep(1200);
    const rp = await P.evaluate(() => ({ open: window.klibb.roomPanel().open, name: document.getElementById('rpi-name').textContent, life: document.getElementById('rpi-life').textContent,
      visitors: document.getElementById('rpi-visitors').textContent, here: document.getElementById('rpi-here').textContent, stickers: document.getElementById('rpi-stickers').textContent }));
    check('room sticker → the room panel: name, lifetime, people visited, here now, sticker count', rp.open && rp.name === R && rp.life && rp.visitors === '2' && rp.stickers === '5' && /^2/.test(rp.here), rp);
    await P.screenshot({ path: path.join(SHOTS, '6-room-info-panel.png') });

    // ---- 8) exit → Exit to menu / Back; door → Enter the city / Back ----
    await P.evaluate(() => document.getElementById('rp-close').click());
    await P.evaluate(([x, y]) => window.klibb.menuClick(x, y), spots.exit); await sleep(300);
    const ex = await P.evaluate(() => ({ c: window.klibb.choice(), b: [...document.querySelectorAll('#menu-choice-list button')].map((b) => b.textContent) }));
    check('exit sticker → two big choices: Exit to menu / Back', ex.c.open && ex.c.what === 'exit' && ex.b.length === 2 && /Exit to menu/.test(ex.b[0]) && /Back/.test(ex.b[1]), ex);
    await P.screenshot({ path: path.join(SHOTS, '7-exit-choice.png') });
    await P.evaluate(() => document.querySelector('#menu-choice-list button[data-id="back"]').click()); await sleep(200);
    check('…Back closes it and I stay in the room', await P.evaluate((r) => !window.klibb.choice().open && new URLSearchParams(location.search).get('room') === r, R));
    await P.evaluate(([x, y]) => window.klibb.menuClick(x, y), spots.door); await sleep(300);
    const dr = await P.evaluate(() => ({ c: window.klibb.choice(), b: [...document.querySelectorAll('#menu-choice-list button')].map((b) => b.textContent) }));
    check('door sticker → Enter the city / Back to the room', dr.c.open && dr.c.what === 'door' && /city/i.test(dr.b[0]) && /Back/.test(dr.b[1]), dr);
    await P.screenshot({ path: path.join(SHOTS, '8-door-choice.png') });
    await P.evaluate(() => document.querySelector('#menu-choice-list button[data-id="back"]').click());

    // ---- 3b) clear your stickers (only mine) ----
    await P.evaluate(() => window.klibb.openRoomPanel()); await sleep(500);
    await P.evaluate(() => document.getElementById('rpi-clear').click()); await sleep(200);
    await P.screenshot({ path: path.join(SHOTS, '9-room-clear-confirm.png') });
    await P.evaluate(() => document.getElementById('rpi-clear-yes').click()); await sleep(1500);
    const after = (await (await fetch(`${S.base}/api/rooms/${R}/stamps`)).json()).stamps.length;
    const bSees = await B.evaluate(() => window.klibb.stamps.meshes.size);
    check('Clear your stickers (after a yes): my five are gone, for the other player too', after === 0 && bSees === 0, { after, bSees });
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await browser.close(); S.child.kill();
  console.log(`\nSticker menus e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

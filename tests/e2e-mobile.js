// E2E: the touch (phone) layout – iPhone-sized viewport (390×844, touch). Own servers (port 8877
// normal app, 8879 demo; MOBILE_E2E_PORT). First load = only the joystick and the sticker stack; the
// stack's menu and every option in it; the sticker book; the editing sliders (rotation left, size
// right); the held sticker's timer (sharp until the first stamp, then 2 s untouched, 1 s fade, a tap brings it back
// and never slaps, each stamp restarts it); slapping = tap a wall; the demo still works; desktop
// unchanged. Screenshots: MOBILE_SHOTS (default /workspace/mobile-ui-shots).
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { chromium, devices } = require('playwright');
const { startServer, enter } = require('./demo-helpers');

const PORT = Number(process.env.MOBILE_E2E_PORT || 8877);
const SHOTS = process.env.MOBILE_SHOTS || '/workspace/mobile-ui-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra) : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PHONE = { ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, permissions: ['microphone'] };
// what is on the screen (fixed UI), apart from toasts
const ON_SCREEN = ['joystick', 'design-btn', 'panel', 'panel-toggle', 'peel-btn', 'view-btn', 'mode-btn', 'mode-hud', 'room-hud', 'chat-btn', 'mic-touch',
  'held', 'stack-menu', 'sm-book', 'sm-avatar', 'sm-room', 'sm-talk', 'sticker-book', 'more-panel', 'design-hud', 'design-strip'];

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', ADMIN_TOKEN: 'mobile-e2e-admin' });
  const D = await startServer(PORT + 2, { DEMO_PROFILE: '1', ADMIN_TOKEN: 'mobile-e2e-admin' });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-mobile-e2e-'));
  const errors = [];
  console.log(`Mobile layout (${S.base}, demo ${D.base})`);
  try {
    const red = path.join(tmp, 'red.png'), blue = path.join(tmp, 'blue.png');
    await sharp({ create: { width: 200, height: 200, channels: 4, background: '#e0352b' } }).png().toFile(red);
    await sharp({ create: { width: 200, height: 140, channels: 4, background: '#2b6be0' } }).png().toFile(blue);
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const R = made.room.id;
    const ctx = await browser.newContext(PHONE);
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    const ready = () => P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    const shown = (page = P) => page.evaluate((ids) => ids.filter((id) => { const el = document.getElementById(id); if (!el || !el.getClientRects().length) return false;
      const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && Number(cs.opacity) > 0.01; }), ON_SCREEN);
    const held = (page = P) => page.evaluate(() => window.klibb.held());
    const count = (page = P) => page.evaluate(() => window.klibb.stamps.count);
    const vp = PHONE.viewport, wall = [vp.width * 0.5, vp.height * 0.33];
    const face = (page = P) => page.evaluate(() => { window.klibb.moveTo(0, 1.5); window.klibb.look(0, 0); });
    const quiet = (page = P) => page.waitForFunction(() => !document.getElementById('toast').classList.contains('show'), null, { timeout: 6000 }).catch(() => {});

    // ---------- First load ----------
    await P.goto(`${S.base}/?room=${R}`); await ready(); await P.waitForTimeout(600);
    const s0 = await shown();
    check('first load (no stickers yet): only the joystick and the (empty) sticker stack', s0.join() === 'joystick,design-btn', s0);
    await P.setInputFiles('#file', red); await P.waitForFunction(() => window.klibb.designs().length === 1, null, { timeout: 20000 });
    await P.setInputFiles('#file', blue); await P.waitForFunction(() => window.klibb.designs().length === 2, null, { timeout: 20000 });
    await P.evaluate(([id, key]) => localStorage.setItem('klibb.roomKeys', JSON.stringify({ [id]: key })), [R, made.roomKey]); // I made this room
    await P.reload(); await ready(); await face(); await P.waitForTimeout(900);
    const s1 = await shown(), h1 = await held();
    check('first load (with stickers): only the joystick and the sticker stack (no panel, no ☰ Stickers, no 👤 ↩ 👁, no 💬/🎙 bubbles, no held sticker yet)',
      s1.join() === 'joystick,design-btn' && h1.state === 'idle', { s1, h1 });
    const stackImgs = await P.evaluate(() => ['design-btn-img', 'design-btn-b1'].map((id) => !!document.getElementById(id).getAttribute('src') && !document.getElementById(id).hidden));
    check('the stack shows the sticker on top and one more under it', stackImgs.every(Boolean), stackImgs);
    await P.screenshot({ path: path.join(SHOTS, '01-first-load.png') });

    // ---------- The menu ----------
    await P.tap('#design-btn'); await P.waitForTimeout(350);
    const items = ['sm-book', 'sm-avatar', 'sm-room', 'sm-undo', 'sm-view', 'sm-photo', 'sm-chat', 'sm-mic'];
    const boxes = await P.evaluate((ids) => ids.map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return [id, r.left, r.top, r.right, r.bottom]; }), items);
    const inside = boxes.every(([, l, t, r, b]) => l >= 0 && t >= 0 && r <= vp.width && b <= vp.height && r - l > 40);
    const overlap = boxes.some((a, i) => boxes.some((b, j) => j > i && a[1] < b[3] && b[1] < a[3] && a[2] < b[4] && b[2] < a[4]));
    check('tapping the stack fans out the menu: 📒 Stickers, 🧍 Character, 🏠 Room, ↩ Undo, 👤 3rd person, 📷 Photo + Talk card (💬, 🎙) – all on screen, none overlapping',
      (await held()).menuOpen && inside && !overlap, boxes);
    await P.screenshot({ path: path.join(SHOTS, '02-menu-open.png') });
    const c0 = await count();
    await P.touchscreen.tap(vp.width * 0.3, vp.height * 0.25); await P.waitForTimeout(600);
    check('a tap outside closes the menu (and does not slap)', !(await held()).menuOpen && (await count()) === c0);

    // 📒 Stickers: the book, pick one → held, sharp, the editing sliders
    await P.tap('#design-btn'); await P.waitForTimeout(250); await P.tap('#sm-book'); await P.waitForTimeout(300);
    const book = await P.evaluate(() => ({ open: !document.getElementById('sticker-book').hidden, thumbs: document.querySelectorAll('#sticker-book #tray .pick').length,
      upload: !!document.querySelector('#sticker-book label.upload') && document.querySelector('#sticker-book label.upload').getClientRects().length > 0 }));
    check('📒 Stickers opens the sticker book (my stickers + ⬆ Upload)', book.open && book.thumbs === 2 && book.upload, book);
    await P.screenshot({ path: path.join(SHOTS, '03-sticker-book.png') });
    const other = await P.evaluate(() => { const id = window.klibb.state.selected.id; return [...document.querySelectorAll('#tray .thumb')].map((t) => t.dataset.id).find((x) => x !== id); });
    await P.tap(`#tray .thumb[data-id="${other}"] .pick`); await P.waitForTimeout(500);
    const h2 = await held(), s2 = await shown(), hasEdges = await P.evaluate(() => document.querySelectorAll('.edge, #edge-rot, #edge-size').length > 0);
    check('picking a sticker closes the book and puts it in my hand: sharp (two fingers pinch/twist it: e2e-pinch.js; no edge sliders)',
      (await P.evaluate(() => window.klibb.state.selected.id)) === other && !h2.bookOpen && h2.state === 'holding' && h2.heldOpacity === 1 && !hasEdges, { h2, s2 });
    // picture 4: the editing view – holder in the middle, the sliders, the three menu buttons lit, nothing else
    const mid = h2.heldRect ? [h2.heldRect.x + h2.heldRect.width / 2, h2.heldRect.y + h2.heldRect.height / 2] : [0, 0];
    const lit = await P.evaluate(() => ['sm-book', 'sm-avatar', 'sm-room'].map((id) => getComputedStyle(document.getElementById(id)).borderTopColor));
    check('editing view: the sticker sits in its holder in the middle of the screen, sharp; 📒 🧍 🏠 lit at the bottom; no sliders, no 💬/🎙 (they are on the Talk card)',
      h2.editing && Math.abs(mid[0] - vp.width / 2) < 3 && Math.abs(mid[1] - vp.height / 2) < 3 &&
      s2.join() === 'joystick,design-btn,held,stack-menu,sm-book,sm-avatar,sm-room' && lit.every((c) => c === 'rgb(255, 212, 0)'), { mid, s2, lit });
    await quiet(); await P.screenshot({ path: path.join(SHOTS, '04-editing-view.png') });
    // the three buttons work from the editing view
    await P.tap('#sm-book'); await P.waitForTimeout(250);
    const fromEdit = await held(); await P.tap('#book-close'); await P.waitForTimeout(250);
    check('editing view: 📒 opens the sticker book directly (no menu needed)', fromEdit.bookOpen && !fromEdit.menuOpen, fromEdit);
    await P.evaluate(() => { window.klibb.setSize(30); document.getElementById('rot').value = 0; document.getElementById('rot').oninput({ target: document.getElementById('rot') }); });

    // ---------- The timer: sharp until the first stamp ----------
    await P.waitForTimeout(11500);
    const h3 = await held();
    check('held: still sharp 12 s after choosing (indefinitely until the first placement)', h3.state === 'holding' && h3.heldOpacity === 1, h3);
    const c1 = await count();
    await P.touchscreen.tap(...wall);
    await P.waitForFunction((n) => window.klibb.stamps.count === n + 1, c1, { timeout: 6000 }).catch(() => {});
    const h4 = await held();
    check('slapping on touch = tap a wall with the sticker in hand; the first stamp starts the 2 s timer', (await count()) === c1 + 1 && h4.state === 'timed' && h4.age < 1500, h4);
    // Timing sampled in the page (robust under load): an interaction (size control) restarts the 2 s, then hands off.
    const tl = await P.evaluate(() => new Promise((res) => {
      window.klibb.setSize(30);
      const out = []; const t0 = performance.now();
      const tick = () => { const h = window.klibb.held(); out.push([h.age, h.heldOpacity, h.canSlap]);
        if (h.age >= 3250 || performance.now() - t0 > 8000) res(out); else setTimeout(tick, 40); };
      tick();
    }));
    const early = tl.filter(([a]) => a < 1900), midS = tl.filter(([a]) => a > 2150 && a < 2850);
    const h5 = { heldOpacity: early.length && early.every(([, o]) => o === 1) ? 1 : 0, n: early.length };
    const h6 = midS.find(([, o]) => o > 0.05 && o < 0.95) || midS[0] || [0, 0, true];
    await P.waitForFunction(() => window.klibb.pendingSlaps() === 0, null, { timeout: 6000 });
    await P.waitForTimeout(100);
    const h7 = await held(), s7 = await shown();
    check('after the stamp: sharp for 2 s (untouched), then fades over 1 s, then gone (no held sticker)',
      h5.heldOpacity === 1 && h6[1] > 0.05 && h6[1] < 0.95 && !h6[2] && h7.heldOpacity === 0 && !h7.heldShown && s7.join() === 'joystick,design-btn',
      { h5, h6, h7, s7 });
    await P.screenshot({ path: path.join(SHOTS, '06-held-faded.png') });
    // faded = look mode: a tap only wakes it
    const c2 = await count();
    await P.touchscreen.tap(...wall); await P.waitForTimeout(900);
    const h8 = await held();
    check('faded: a tap on the wall does NOT slap, it brings the held sticker back with a fresh 2 s', (await count()) === c2 && h8.heldOpacity === 1 && h8.canSlap && h8.age < 1500, { c2, h8 });
    await quiet(); await P.screenshot({ path: path.join(SHOTS, '05-held-visible.png') }); // woken again: sharp
    await P.evaluate(() => window.klibb.stackMenu().chosen()); await P.waitForTimeout(200); // (2 s may have run out during the screenshot: back in hand)
    await P.touchscreen.tap(wall[0] - 60, wall[1] + 40);
    await P.waitForFunction((n) => window.klibb.stamps.count === n + 1, c2, { timeout: 6000 }).catch(() => {});
    check('…and the next tap slaps again', (await count()) === c2 + 1);
    await P.waitForFunction(() => window.klibb.pendingSlaps() === 0, null, { timeout: 6000 });
    await P.evaluate(() => window.klibb.stackMenu().chosen()); await P.waitForTimeout(100);
    await P.touchscreen.tap(wall[0] - 30, wall[1] - 30); // first stamp after choosing starts the 2 s
    await P.waitForFunction((n) => window.klibb.stamps.count === n + 2, c2, { timeout: 6000 }).catch(() => {});
    await P.waitForFunction(() => window.klibb.held().age >= 900, null, { timeout: 5000 });
    const before = await held();
    await P.touchscreen.tap(wall[0] + 60, wall[1] + 20);
    await P.waitForFunction((n) => window.klibb.stamps.count === n + 3, c2, { timeout: 6000 }).catch(() => {});
    const h9 = await held();
    check(`each new stamp restarts the 2 s (age ${before.age} → ${h9.age} ms)`, (await count()) === c2 + 3 && before.age > 800 && before.canSlap && h9.age < 1000, { before, h9 });
    await P.waitForFunction(() => window.klibb.pendingSlaps() === 0, null, { timeout: 6000 });
    // release from the holder: a tap on it slaps where it is (the middle); drag it out = slaps where you let go
    await P.evaluate(() => window.klibb.stackMenu().chosen()); await P.waitForTimeout(200); // (2 s: back in hand for this part)
    const c4 = await count();
    await P.touchscreen.tap(vp.width / 2, vp.height / 2);
    await P.waitForFunction((n) => window.klibb.stamps.count === n + 1, c4, { timeout: 6000 }).catch(() => {});
    const relTap = await count();
    const cdpR = await ctx.newCDPSession(P);
    await cdpR.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: vp.width / 2, y: vp.height / 2 }] });
    for (let k = 1; k <= 8; k++) await cdpR.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: vp.width / 2 - k * 12, y: vp.height / 2 - k * 25 }] });
    await P.waitForTimeout(100); await P.screenshot({ path: path.join(SHOTS, '05b-release-drag.png') });
    await cdpR.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await P.waitForFunction((n) => window.klibb.stamps.count === n + 1, relTap, { timeout: 6000 }).catch(() => {});
    check('release: tapping the sticker in its holder slaps it (middle of the screen); dragging it out and letting go slaps it there', relTap === c4 + 1 && (await count()) === c4 + 2, { c4, relTap, now: await count() });
    await P.waitForFunction(() => window.klibb.pendingSlaps() === 0, null, { timeout: 6000 });

    // ---------- The other options ----------
    // ↩ Undo (stays open for another undo)
    const c3 = await count();
    await P.tap('#design-btn'); await P.waitForTimeout(250); await P.tap('#sm-undo');
    await P.waitForFunction((n) => window.klibb.stamps.count === n - 1, c3, { timeout: 6000 }).catch(() => {});
    check('↩ Undo peels my last sticker (the menu stays open for another undo)', (await count()) === c3 - 1 && (await held()).menuOpen);
    // 👤 3rd person
    await P.tap('#sm-view'); await P.waitForTimeout(300);
    const v1 = await P.evaluate(() => [window.klibb.view(), document.getElementById('sm-view').getAttribute('aria-pressed')].join());
    await P.tap('#design-btn'); await P.waitForTimeout(250);
    const lab = await P.textContent('#sm-view .sm-lab');
    await P.tap('#sm-view'); await P.waitForTimeout(300);
    check('👤 switches to 3rd person and back (label: 1st person while in 3rd)', v1 === 'third,true' && lab === '1st person' && (await P.evaluate(() => window.klibb.view())) === 'first', { v1, lab });
    // 📷 Photo
    const ph0 = await P.evaluate(() => window.klibb.lastPhoto());
    await P.tap('#design-btn'); await P.waitForTimeout(250); await P.tap('#sm-photo');
    await P.waitForFunction((a) => { const p = window.klibb.lastPhoto(); return p && JSON.stringify(p) !== a; }, JSON.stringify(ph0), { timeout: 15000 }).catch(() => {});
    check('📷 Photo takes a photo', !!(await P.evaluate(() => window.klibb.lastPhoto())));
    // 🏠 Room: the room's info, Room ▾ (new quick room, share …), recording – on top of ⚙ More
    await quiet();
    await P.tap('#design-btn'); await P.waitForTimeout(250); await P.tap('#sm-room'); await P.waitForTimeout(300);
    const room = await P.evaluate(() => ({ more: !document.getElementById('more-panel').hidden, roomBox: !!document.querySelector('#more-panel #room-box'),
      name: document.getElementById('room-name').textContent, rec: !document.getElementById('rec-box').hidden }));
    await P.tap('#room-menu-btn'); await P.waitForTimeout(200);
    const rm = await P.isVisible('#new-room') && await P.isVisible('#share-room');
    check('🏠 Room opens the room sheet: name, Room ▾ (new quick room, share link …), and the rest of ⚙ More (recording for the creator)', room.more && room.roomBox && room.name === R && rm && room.rec, { room, rm });
    await P.screenshot({ path: path.join(SHOTS, '07-room-sheet.png') });
    await P.tap('#more-close'); await P.waitForTimeout(200);
    // 🧍 Character
    await P.tap('#design-btn'); await P.waitForTimeout(250); await P.tap('#sm-avatar');
    await P.waitForSelector('#avatar-panel', { state: 'visible', timeout: 8000 }).catch(() => {});
    check('🧍 Character opens My avatar', await P.isVisible('#avatar-panel'));
    await P.tap('#av-cancel'); await P.waitForTimeout(300);
    // 💬 Talk
    await P.tap('#design-btn'); await P.waitForTimeout(250); await P.tap('#sm-chat'); await P.waitForTimeout(300);
    const chat = await P.evaluate(() => document.getElementById('chat').classList.contains('open') && !document.getElementById('chat-form').hidden);
    await P.fill('#chat-input', 'hej från mobilen'); await P.press('#chat-input', 'Enter'); await P.waitForTimeout(500);
    const said = await P.evaluate(() => [...document.querySelectorAll('#chat-log li')].some((l) => l.textContent.includes('hej från mobilen')));
    check('💬 Talk opens the chat and a message goes out', chat && said, { chat, said });
    await P.tap('#chat-close').catch(() => {}); await P.waitForTimeout(300);
    // 🎙 Mic
    await P.tap('#design-btn'); await P.waitForTimeout(250); await P.tap('#sm-mic');
    await P.waitForFunction(() => document.getElementById('sm-mic').dataset.state !== 'off', null, { timeout: 8000 }).catch(() => {});
    const mic = await P.evaluate(() => ({ sm: document.getElementById('sm-mic').dataset.state, bubble: getComputedStyle(document.getElementById('mic-touch')).display }));
    check('🎙 Mic turns the microphone on; while it is live the 🎙 bubble shows top right (one tap to mute)', mic.sm === 'on' && mic.bubble !== 'none', mic);
    await P.evaluate(() => window.klibb.toggleMic()); await P.waitForTimeout(300);
    // swipe on the stack = next/previous sticker
    await P.evaluate(() => window.klibb.stackMenu().close());
    const sel0 = await P.evaluate(() => window.klibb.state.selected.id), sb = await P.locator('#design-btn').boundingBox();
    const cdp = await ctx.newCDPSession(P), cx = sb.x + sb.width / 2, cy = sb.y + sb.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
    for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - i * 12 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await P.waitForTimeout(400);
    const sw = await P.evaluate(() => ({ sel: window.klibb.state.selected.id, held: window.klibb.held() }));
    check('swiping up on the stack takes the next sticker into my hand (sharp again until placed), no menu', sw.sel !== sel0 && sw.held.state === 'holding' && !sw.held.menuOpen, sw);
    // the joystick still walks
    await face();
    const z0 = await P.evaluate(() => window.klibb.camera.position.z), jb = await P.locator('#joystick').boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: jb.x + jb.width / 2, y: jb.y + jb.height / 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: jb.x + jb.width / 2, y: jb.y + jb.height / 2 - 45 }] });
    await P.waitForTimeout(600); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    check('the joystick walks', (await P.evaluate(() => window.klibb.camera.position.z)) < z0 - 0.3);
    await ctx.close();

    // ---------- Desktop is unchanged ----------
    const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const DP = await dctx.newPage(); DP.on('pageerror', (e) => errors.push(e.message));
    await DP.goto(`${S.base}/?room=${R}`); await DP.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    const dk = await shown(DP), dm = await DP.evaluate(() => ({ mode: window.klibb.state.mode, held: window.klibb.held(), roomBoxInPanel: !!document.querySelector('#panel #room-box'), tray: !!document.querySelector('#panel #tray') }));
    check('desktop: the panel is there as before (room box, tray), no stack menu / held timer / edge sliders', dk.includes('panel') && !dk.some((x) => ['stack-menu', 'held', 'edge-rot', 'edge-size', 'joystick'].includes(x)) && dm.held === null && dm.roomBoxInPanel && dm.tray, { dk, dm });
    await dctx.close();

    // ---------- Demo ----------
    const mctx = await browser.newContext(PHONE);
    const M = await enter(mctx, D.base + '/', 'Phone'); M.on('pageerror', (e) => errors.push(e.message));
    await M.waitForURL(/\?room=/, { timeout: 20000 }); await M.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 }); await M.waitForTimeout(800);
    const ds = await shown(M);
    check('demo, phone: first load shows only the joystick and the sticker stack (the library on top)', ds.join() === 'joystick,design-btn' && !!(await M.evaluate(() => window.klibb.state.selected)), ds);
    await M.tap('#design-btn'); await M.waitForTimeout(300);
    const dmn = await M.evaluate(() => Object.fromEntries(['sm-book', 'sm-avatar', 'sm-room', 'sm-undo', 'sm-view', 'sm-photo', 'sm-chat', 'sm-mic'].map((id) => [id, document.getElementById(id).getClientRects().length > 0])));
    check('demo: the menu has everything but 🧍 Character (as before: no avatar editing in the demo)', !dmn['sm-avatar'] && Object.entries(dmn).every(([k, v]) => k === 'sm-avatar' || v), dmn);
    await M.screenshot({ path: path.join(SHOTS, '08-demo-menu.png') });
    await M.tap('#sm-book'); await M.waitForTimeout(300);
    const db = await M.evaluate(() => ({ thumbs: document.querySelectorAll('#sticker-book #tray .pick').length, upload: document.querySelector('#sticker-book label.upload').getClientRects().length > 0 }));
    check('demo: the sticker book is the library, no ⬆ Upload', db.thumbs > 0 && !db.upload, db);
    await M.tap('#sticker-book #tray .thumb:nth-child(2) .pick'); await M.waitForTimeout(400);
    await face(M);
    const dc = await count(M);
    await M.touchscreen.tap(...wall);
    await M.waitForFunction((n) => window.klibb.stamps.count === n + 1, dc, { timeout: 6000 }).catch(() => {});
    check('demo: tap a wall slaps the library sticker', (await count(M)) === dc + 1);
    await mctx.close();
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  finally {
    await browser.close(); S.child.kill(); D.child.kill();
    for (const d of [S.dir, D.dir, tmp]) fs.rmSync(d, { recursive: true, force: true });
    console.log(`\nMobile layout e2e: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();

// E2E: a new quick room clears my uploads off the sticker wheel; only uploads can be starred
// (Jens, 29 Oct 2026: "När man startar ett nytt quick room ska uppladdade klistermärken rensas – de som
// man tryckt på upload under testning ligger kvar i klibbhjulet och ska tas bort. Bara de uppladdade
// kan favoriseras (kryssas), inte alla stickers."). Starred uploads (favourites) are kept – that is
// what a star is for. Both ways a new quick room starts: "＋ New quick room" → Create room, and the
// plain address with no rooms yet (landing.js). Own server (NEWROOM_E2E_PORT, default 8895).
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.NEWROOM_E2E_PORT || 8895);
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };
const PNGS = [path.join(__dirname, 'test-klibba.png'), path.join(__dirname, 'vik-klibba.png'), path.join(__dirname, 'demo-klibba.png')];

(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '0', ADMIN_TOKEN: 'newroom-e2e-admin' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  const ready = (p) => p.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.library.length > 0, null, { timeout: 30000 });
  const info = (p) => p.evaluate(() => { const k = window.klibb; return { room: new URLSearchParams(location.search).get('room'), mine: k.state.mine.map((m) => m.id), favs: [...k.state.favs],
    wheel: k.wheelDesigns().map((d) => d.id), tray: [...document.querySelectorAll('#tray .thumb')].map((t) => t.dataset.id), libFavBtns: document.querySelectorAll('#libtray .fav-btn, #naturetray .fav-btn').length,
    stored: JSON.parse(localStorage.getItem('klibb.mine') || '[]').map((m) => m.id) }; });
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 } });
    await ctx.addInitScript(([r, k]) => localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })), [made.room.id, made.roomKey]);
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${made.room.id}`); await ready(P);
    for (const f of PNGS) {
      const n = (await info(P)).mine.length;
      await P.setInputFiles('#file', f);
      await P.waitForFunction((n) => window.klibb.state.mine.length > n, n, { timeout: 15000 });
    }
    const a = await info(P);
    check('three test uploads: in my palette and first on the sticker wheel', a.mine.length === 3 && a.mine.every((id) => a.wheel.slice(0, 3).includes(id)), a);
    // only uploads can be starred
    const starred = await P.evaluate((id) => window.klibb.toggleFav(id), a.mine[0]);
    const libId = await P.evaluate(() => window.klibb.state.library.find((d) => !d.nature)?.id);
    const natId = await P.evaluate(() => window.klibb.state.library.find((d) => d.nature)?.id);
    const libStar = await P.evaluate((id) => window.klibb.toggleFav(id), libId);
    const natStar = await P.evaluate((id) => window.klibb.toggleFav(id), natId);
    const b = await info(P);
    check('an upload can be starred', starred === true && b.favs.includes(a.mine[0]), b.favs);
    check('a library sticker and a nature sticker cannot (toggleFav refuses, no star stored)', libStar === false && natStar === false && !b.favs.includes(libId) && !b.favs.includes(natId), { libStar, natStar, favs: b.favs });
    check('…and the library/nature lists have no star buttons', b.libFavBtns === 0, b.libFavBtns);
    // ＋ New quick room → Create room
    await P.evaluate(() => document.getElementById('new-room').click()); await sleep(500);
    await Promise.all([P.waitForNavigation({ timeout: 20000 }), P.evaluate(() => document.getElementById('style-ok').click())]);
    await ready(P); await sleep(500);
    const c = await info(P);
    check('＋ New quick room: a new room', c.room && c.room !== made.room.id, c.room);
    check('…my unstarred test uploads are gone (palette, sticker wheel, localStorage)', !c.mine.includes(a.mine[1]) && !c.mine.includes(a.mine[2]) && !c.wheel.includes(a.mine[1]) && !c.wheel.includes(a.mine[2]) && !c.stored.includes(a.mine[1]), c);
    check('…the starred upload stays (a star = keep it), still starred', c.mine.length === 1 && c.mine[0] === a.mine[0] && c.favs.includes(a.mine[0]) && c.wheel[0] === a.mine[0], c);
    check('…the library is all still on the wheel', c.wheel.includes(libId), c.wheel.length);
    const blobs = await P.evaluate((ids) => new Promise((ok) => { const r = indexedDB.open('klibb', 1); r.onsuccess = () => { const t = r.result.transaction('blobs', 'readonly'), s = t.objectStore('blobs'); const out = {}; ids.forEach((id) => { const q = s.get(id); q.onsuccess = () => { out[id] = !!q.result; }; }); t.oncomplete = () => ok(out); }; r.onerror = () => ok(null); }), a.mine);
    check('…their local image copies are deleted too (the starred one kept)', blobs && blobs[a.mine[0]] && !blobs[a.mine[1]] && !blobs[a.mine[2]], blobs);
    // reloading the SAME room does not clear anything
    await P.setInputFiles('#file', PNGS[1]); await P.waitForFunction(() => window.klibb.state.mine.length === 2, null, { timeout: 15000 });
    await P.reload(); await ready(P);
    check('reopening a room (not a new one) keeps my uploads', (await info(P)).mine.length === 2);
    await ctx.close();

    // the plain address, no rooms yet → landing.js makes a quick room: old uploads go there too
    const ctx2 = await browser.newContext({ viewport: { width: 1300, height: 850 } });
    const P2 = await ctx2.newPage(); P2.on('pageerror', (e) => errors.push(e.message));
    await P2.goto(`${S.base}/?room=stad`); await ready(P2);
    await P2.setInputFiles('#file', PNGS[0]); await P2.waitForFunction(() => window.klibb.state.mine.length === 1, null, { timeout: 15000 });
    await P2.evaluate(() => { localStorage.removeItem('klibb.rooms'); localStorage.removeItem('klibb.roomKeys'); });
    await P2.goto(`${S.base}/`); await ready(P2); await sleep(400);
    const d = await info(P2);
    check('plain address, no rooms → a new quick room, and the test upload is off the wheel', d.room && d.room !== 'stad' && d.mine.length === 0 && d.stored.length === 0, d);
    await ctx2.close();
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await browser.close(); S.child.kill();
  console.log(`\nNew quick room e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

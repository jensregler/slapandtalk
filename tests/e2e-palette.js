// E2E: the sticker palette (menu thumbnails).
//  - desktop: hovering a thumbnail shows a star (favourite) top-left and a small round red × top-right
//  - × removes ONLY that design from my own list; 'Removed · Undo' for ~5 s puts it back in place
//  - stickers already on the walls (and the image on the server) stay
//  - favourites persist over a reload and survive remove + undo
//  - touch (no hover): the selected thumbnail shows its controls, a long-press shows them on any other
//  - designs an admin removed (DELETE /api/stickers/:id) drop out of the palette, live and on load,
//    and are not uploaded again from the local copy; a deliberate new upload brings one back
const sharp = require('sharp');
const path = require('path');
const os = require('os');

async function makePngs(tag, n) {
  const colors = ['#2a9d8f', '#e9c46a', '#f4a261', '#264653', '#8ab17d'];
  const out = [];
  for (let i = 0; i < n; i++) {
    const f = path.join(os.tmpdir(), `klibb-palette-${tag}-${i}.png`);
    await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><circle cx="120" cy="120" r="110" fill="${colors[i % colors.length]}"/>
      <text x="120" y="150" font-family="DejaVu Sans" font-weight="900" font-size="80" text-anchor="middle" fill="#fff">${tag}${i}</text></svg>`)).png().toFile(f);
    out.push(f);
  }
  return out;
}

async function paletteE2E({ browser, BASE, assert, waitReady, devices, TOKEN }) {
  const made = new Set();
  const ROOM = 'e2e-palette';
  const pngs = await makePngs('P', 7);
  try {
    // ---------- Desktop ----------
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const d = await ctx.newPage();
    const errors = []; d.on('pageerror', (e) => errors.push(e.message));
    await d.goto(`${BASE}/?room=${ROOM}`); await waitReady(d);
    for (const f of pngs.slice(0, 4)) {
      const n = await d.evaluate(() => window.klibb.state.mine.length);
      await d.setInputFiles('#file', f);
      await d.waitForFunction((n) => window.klibb.state.mine.length === n + 1, n);
    }
    const order = () => d.evaluate(() => window.klibb.designs().map((x) => x.id)); // as shown, newest first
    const ids = await order(); ids.forEach((id) => made.add(id));
    assert(ids.length === 4, 'palette: 4 designs uploaded');
    const [A, B, C, D] = ids; // A newest (selected)
    const thumb = (id) => `#tray .thumb[data-id="${id}"]`;
    // Wait for the fade-in (slow under load) instead of a fixed pause.
    const shown = (pg, id) => pg.waitForFunction((id) => { const x = document.querySelector(`#tray .thumb[data-id="${id}"] .del-btn`); return x && +getComputedStyle(x).opacity > 0.95; }, id, { timeout: 8000 });
    const ctl = (id) => d.evaluate((id) => {
      const t = document.querySelector(`#tray .thumb[data-id="${id}"]`); if (!t) return null;
      const r = t.querySelector('.pick').getBoundingClientRect();
      const f = t.querySelector('.fav-btn'), x = t.querySelector('.del-btn');
      const fr = f.getBoundingClientRect(), xr = x.getBoundingClientRect(), fs = getComputedStyle(f), xs = getComputedStyle(x);
      return { fav: +fs.opacity, del: +xs.opacity, favPe: fs.pointerEvents, delPe: xs.pointerEvents, favText: f.textContent, pressed: f.getAttribute('aria-pressed'),
        delBg: xs.backgroundColor, delColor: xs.color, delText: x.textContent, delRadius: xs.borderRadius, delW: xr.width,
        delTopRight: Math.abs(xr.right - r.right) < 12 && Math.abs(xr.top - r.top) < 12, favTopLeft: Math.abs(fr.left - r.left) < 12 && Math.abs(fr.top - r.top) < 12 };
    }, id);

    // Park the mouse away from the tray: controls hidden.
    await d.mouse.move(900, 600); await d.waitForTimeout(450);
    const before = await ctl(B);
    assert(before.fav < 0.05 && before.del < 0.05 && before.delPe === 'none',
      'palette (desktop): no star or × on a thumbnail until you hover it');
    await d.hover(`${thumb(B)} .pick`); await shown(d, B);
    const hov = await ctl(B);
    assert(hov.fav > 0.9 && hov.del > 0.9 && hov.delPe === 'auto' && hov.delTopRight && hov.favTopLeft,
      'palette (desktop): hover shows the star top-left and the × top-right');
    assert(hov.delText === '×' && hov.delBg === 'rgb(224, 53, 43)' && hov.delColor === 'rgb(255, 255, 255)' && hov.delRadius === '50%' && hov.delW <= 24,
      `palette: the remove control is a small round red badge with a white × (${hov.delBg}, ${hov.delW}px)`);
    await d.screenshot({ path: path.join(__dirname, '..', 'screenshots', '47-palett-hover-dator.png'), clip: { x: 0, y: 0, width: 340, height: 520 } });

    // ---------- Favourite: click the star, survives a reload ----------
    await d.click(`${thumb(B)} .fav-btn`);
    const favNow = await d.evaluate((id) => ({ ls: JSON.parse(localStorage.getItem('klibb.favs') || '[]'), sel: window.klibb.state.selected.id }), B);
    assert(favNow.ls.includes(B) && favNow.sel === A, 'favourite: clicking the star marks it (saved) and does not pick the design');
    await d.reload(); await waitReady(d);
    await d.mouse.move(900, 600); await d.waitForTimeout(450);
    const favAfter = await ctl(B), notFav = await ctl(C);
    assert(favAfter.pressed === 'true' && favAfter.favText === '★' && favAfter.fav > 0.9 && favAfter.del < 0.05 && notFav.fav < 0.05,
      'favourite: after a reload the yellow star still shows (without hover), the × only on hover');

    // A sticker of C on the wall: it must stay when C leaves my palette.
    const stampC = await d.evaluate(async (id) => {
      const k = window.klibb; k.skipReachCheck = true; k.state.selected = k.state.mine.find((m) => m.id === id);
      k.moveTo(0, 1); k.look(0, 0); const s = await k.stampAt(0, 0); return s && s.id;
    }, C);
    assert(!!stampC, 'a sticker of design C is on the wall');
    await d.evaluate((id) => { const k = window.klibb; k.state.selected = k.state.mine.find((m) => m.id === id); }, A);

    // ---------- Remove with undo ----------
    await d.hover(`${thumb(C)} .pick`); await shown(d, C);
    await d.click(`${thumb(C)} .del-btn`);
    const gone = await d.evaluate(() => ({ ids: window.klibb.designs().map((x) => x.id), ls: JSON.parse(localStorage.getItem('klibb.mine')).map((m) => m.id),
      toast: document.getElementById('undo-toast').hidden ? '' : document.getElementById('undo-toast').textContent.replace(/\s+/g, ' ').trim(), sel: window.klibb.state.selected.id }));
    assert(gone.ids.join() === [A, B, D].join() && !gone.ls.includes(C) && gone.sel === A,
      'remove: × takes out only that design (the others stay in order, the selection stays)');
    assert(gone.toast === 'Removed · Undo', `remove: a calm toast "${gone.toast}" instead of a confirm dialog`);
    await d.click('#undo-btn');
    const back = await d.evaluate(() => ({ ids: window.klibb.designs().map((x) => x.id), hidden: document.getElementById('undo-toast').hidden }));
    assert(back.ids.join() === [A, B, C, D].join() && back.hidden, 'undo: the design is back in the same place');

    // Removing a favourite and undoing keeps it a favourite.
    await d.hover(`${thumb(B)} .pick`); await shown(d, B);
    await d.click(`${thumb(B)} .del-btn`);
    const favGone = await d.evaluate((id) => JSON.parse(localStorage.getItem('klibb.favs') || '[]').includes(id), B);
    await d.click('#undo-btn');
    const favBack = await d.evaluate((id) => ({ fav: JSON.parse(localStorage.getItem('klibb.favs') || '[]').includes(id), ids: window.klibb.designs().map((x) => x.id) }), B);
    assert(!favGone && favBack.fav && favBack.ids.join() === [A, B, C, D].join(), 'undo: a removed favourite comes back as a favourite');

    // Remove the selected one: the next design gets selected.
    await d.hover(`${thumb(A)} .pick`); await shown(d, A);
    await d.click(`${thumb(A)} .del-btn`);
    const selNext = await d.evaluate(() => window.klibb.state.selected && window.klibb.state.selected.id);
    await d.click('#undo-btn');
    const selBack = await d.evaluate(() => window.klibb.state.selected && window.klibb.state.selected.id);
    assert(selNext === B && selBack === A, 'remove the selected design: the next one is picked; undo picks it again');

    // Remove C for real (let the undo time run out).
    const undoMs = await d.evaluate(() => window.klibb.undoMs);
    await d.hover(`${thumb(C)} .pick`); await shown(d, C);
    await d.click(`${thumb(C)} .del-btn`);
    await d.waitForTimeout(undoMs + 400);
    const after = await d.evaluate(async (id) => {
      const blob = await new Promise((ok) => { const r = indexedDB.open('klibb', 1); r.onsuccess = () => { const g = r.result.transaction('blobs').objectStore('blobs').get(id); g.onsuccess = () => ok(!!g.result); g.onerror = () => ok(null); }; r.onerror = () => ok(null); });
      return { hidden: document.getElementById('undo-toast').hidden, blob };
    }, C);
    await d.reload(); await waitReady(d);
    const afterReload = await d.evaluate(() => window.klibb.designs().map((x) => x.id));
    const roomStamps = (await (await fetch(`${BASE}/api/rooms/${ROOM}/stamps`)).json()).stamps.map((s) => s.id);
    const onServer = await (await fetch(`${BASE}/api/stickers?ids=${C}`)).json();
    assert(after.hidden && after.blob === false && afterReload.join() === [A, B, D].join(),
      'remove: after ~5 s the toast is gone, so is the local copy, and the design stays out of the palette after a reload');
    assert(roomStamps.includes(stampC) && !!onServer.images[C], 'remove: the sticker already on the wall stays, and the image stays on the server');

    // ---------- Designs an admin removed ----------
    // Live: D is deleted by an admin while the page is open: it leaves the palette (no restore toast).
    await d.evaluate(() => { document.getElementById('toast').textContent = ''; });
    await fetch(`${BASE}/api/stickers/${D}`, { method: 'DELETE', headers: { 'x-admin-token': TOKEN } });
    await d.waitForFunction((id) => !window.klibb.state.mine.some((m) => m.id === id), D, { timeout: 5000 });
    // On load: a second browser has B (a favourite) and A in its list; the admin deletes B while it is closed.
    const mineLs = await d.evaluate(() => localStorage.getItem('klibb.mine'));
    const favLs = await d.evaluate(() => localStorage.getItem('klibb.favs'));
    await ctx.close();
    await fetch(`${BASE}/api/stickers/${B}`, { method: 'DELETE', headers: { 'x-admin-token': TOKEN } });
    const chk = await (await fetch(`${BASE}/api/stickers?ids=${[A, B, D].join(',')}`)).json();
    assert(chk.removed.includes(B) && chk.removed.includes(D) && !chk.removed.includes(A) && chk.missing.includes(B),
      'server: /api/stickers?ids= reports admin-removed designs as "removed" (not just missing)');
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx2.addInitScript(([m, f]) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('klibb.mine', m); if (f) localStorage.setItem('klibb.favs', f); } }, [mineLs, favLs]);
    const e = await ctx2.newPage(); e.on('pageerror', (x) => errors.push(x.message));
    const reuploads = []; e.on('request', (r) => { if (r.method() === 'POST' && /\/api\/stickers$/.test(new URL(r.url()).pathname)) reuploads.push(r.url()); });
    await e.goto(`${BASE}/?room=${ROOM}`); await waitReady(e);
    const loaded = await e.evaluate(() => ({ ids: window.klibb.designs().map((x) => x.id), favs: JSON.parse(localStorage.getItem('klibb.favs') || '[]'), toast: document.getElementById('toast').textContent }));
    const stillGone = await (await fetch(`${BASE}/api/stickers?ids=${B}`)).json();
    assert(loaded.ids.join() === A && !loaded.favs.includes(B) && reuploads.length === 0 && !stillGone.images[B] && !/uploaded again/.test(loaded.toast),
      'on load: an admin-removed design (even a favourite) drops out of the palette and is NOT uploaded again from the local copy');
    // A deliberate new upload of the same picture brings it back.
    await e.setInputFiles('#file', pngs[2]); // B was the 3rd upload
    await e.waitForFunction((id) => window.klibb.state.mine.some((m) => m.id === id), B, { timeout: 10000 });
    const reup = await (await fetch(`${BASE}/api/stickers?ids=${B}`)).json();
    assert(!!reup.images[B] && !reup.removed.includes(B), 'uploading a removed picture again on purpose works (same id, back on the server)');
    await ctx2.close();

    // ---------- Touch: no hover ----------
    const mctx = await browser.newContext({ ...devices['Pixel 7'] });
    const m = await mctx.newPage(); m.on('pageerror', (x) => errors.push(x.message));
    await m.goto(`${BASE}/?room=${ROOM}`); await waitReady(m);
    for (const f of pngs.slice(4, 7)) {
      const n = await m.evaluate(() => window.klibb.state.mine.length);
      await m.setInputFiles('#file', f);
      await m.waitForFunction((n) => window.klibb.state.mine.length === n + 1, n);
    }
    const tids = await m.evaluate(() => window.klibb.designs().map((x) => x.id)); tids.forEach((id) => made.add(id));
    const [T1, T2, T3] = tids; // T1 selected
    const mctl = (id) => m.evaluate((id) => { const t = document.querySelector(`#tray .thumb[data-id="${id}"]`); const x = t.querySelector('.del-btn'), f = t.querySelector('.fav-btn');
      const r = x.getBoundingClientRect(); return { del: +getComputedStyle(x).opacity, fav: +getComputedStyle(f).opacity, w: r.width, x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, id);
    const noHover = await m.evaluate(() => matchMedia('(hover: none)').matches);
    await m.waitForTimeout(450);
    const selC = await mctl(T1), other = await mctl(T2);
    assert(noHover && selC.del > 0.9 && selC.fav > 0.9 && other.del < 0.05 && selC.w >= 22,
      'palette (touch): the selected thumbnail shows its star and × (bigger targets), the others do not');
    // Long-press another thumbnail: its controls show, the selection does not change.
    const box = await m.locator(`#tray .thumb[data-id="${T3}"] .pick`).boundingBox();
    const cdp = await mctx.newCDPSession(m);
    const pt = [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
    await m.waitForTimeout(650);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await m.waitForTimeout(300);
    const lp = await mctl(T3);
    const selAfterLp = await m.evaluate(() => window.klibb.state.selected.id);
    assert(lp.del > 0.9 && lp.fav > 0.9 && selAfterLp === T1, 'palette (touch): a long-press shows the star and × on that thumbnail without picking it');
    await m.screenshot({ path: path.join(__dirname, '..', 'screenshots', '48-palett-mobil.png') });
    await m.tap(`#tray .thumb[data-id="${T3}"] .fav-btn`);
    await m.waitForTimeout(150);
    const tFav = await m.evaluate((id) => JSON.parse(localStorage.getItem('klibb.favs') || '[]').includes(id), T3);
    await m.tap(`#tray .thumb[data-id="${T2}"] .pick`); // select T2: its controls show
    await m.waitForTimeout(450);
    const t2 = await mctl(T2);
    await m.tap(`#tray .thumb[data-id="${T2}"] .del-btn`);
    const tGone = await m.evaluate(() => window.klibb.designs().map((x) => x.id));
    await m.tap('#undo-btn');
    const tBack = await m.evaluate(() => window.klibb.designs().map((x) => x.id));
    assert(tFav && t2.del > 0.9 && tGone.join() === [T1, T3].join() && tBack.join() === tids.join(),
      'palette (touch): tap the star to favourite, tap a thumbnail then its × to remove, Undo puts it back');
    await mctx.close();
    assert(errors.length === 0, `palette: no page errors (${errors.join(' | ')})`);
  } finally {
    if (TOKEN) for (const id of made) await fetch(`${BASE}/api/stickers/${id}`, { method: 'DELETE', headers: { 'x-admin-token': TOKEN } }).catch(() => {});
  }
}

module.exports = { paletteE2E };

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  const { chromium, devices } = require('playwright');
  const BASE = process.env.BASE_URL || 'http://localhost:8787';
  const assert = (c, msg) => { if (!c) throw new Error('FEL: ' + msg); console.log('✔ ' + msg); };
  const waitReady = (page) => page.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 20000 });
  (async () => {
    const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    try { await paletteE2E({ browser, BASE, assert, waitReady, devices, TOKEN: process.env.ADMIN_TOKEN }); } finally { await browser.close(); }
  })().catch((e) => { console.error(e); process.exit(1); });
}

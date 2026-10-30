// E2E: the two wheels (Jens, 28 Oct 2026). The Nature wheel (left) = the library's nature stickers
// (shared/nature.mjs), the sticker wheel (right) = everything else (no nature stickers). Free version:
// the Nature wheel is greyed + locked, a click opens the full version panel, nothing gets held, and
// the server refuses nature stamps (403). Full version (natureStickers): clicking a nature sticker makes
// the Nature wheel active (R/F and the stack follow it), its slap is 5 cm – 4 m high and drops no
// paper; clicking the sticker wheel goes back. Phone: the two bands side by side, the left one Nature.
// Own server (NATUREWHEEL_E2E_PORT, default 8865). Screenshots: NATURE_SHOTS (default /workspace/nature-shots).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep, openAccess, SKIP_FREE } = require('./demo-helpers');

const PORT = Number(process.env.NATUREWHEEL_E2E_PORT || 8865);
const SHOTS = process.env.NATURE_SHOTS || '/workspace/nature-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 600) : '')); } };

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', ADMIN_TOKEN: 'nature-e2e-admin' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  try {
    const lib = (await (await fetch(`${S.base}/api/library`)).json()).stickers;
    const nat = lib.filter((d) => d.nature), rest = lib.filter((d) => !d.nature);
    check(`/api/library: ${lib.length} stickers, ${nat.length} nature (≥ 98) + ${rest.length} others (≥ 230)`, nat.length >= 98 && rest.length >= 230, { n: lib.length, nat: nat.length });
    const ready = (p, full) => p.waitForFunction((f) => window.klibb && window.klibb.ready && window.klibb.state.selected && window.klibb.natureOpen() === f, full, { timeout: 30000 });
    const settle = (p, w) => p.waitForFunction((w) => { const x = window.klibb[w](); return Math.abs(x.pos - x.target) < 0.002; }, w, { timeout: 8000 }).catch(() => {});

    const OPEN = await openAccess(S.base);
    if (OPEN) console.log(SKIP_FREE); else {
      // ---- free version, desktop ----
      const fctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      const F = await fctx.newPage(); F.on('pageerror', (e) => errors.push(e.message));
      await F.goto(S.base + '/'); await ready(F, false);
      const f0 = await F.evaluate(() => ({ ns: window.klibb.natureStrip(), ss: window.klibb.strip(), sticker: window.klibb.stickerDesigns().map((d) => d.id), natural: window.klibb.natureDesigns().map((d) => d.id), act: window.klibb.activeWheel(), sel: window.klibb.state.selected,
        tray: [...document.querySelectorAll('#libtray .thumb')].map((t) => t.dataset.id), ntray: [...document.querySelectorAll('#naturetray .thumb')].length, nbox: document.getElementById('nature-box').className }));
      check('two wheels: Nature on the LEFT of the sticker wheel, both shown', f0.ns.shown && f0.ss.shown && f0.ns.rect.right <= f0.ss.rect.left + 1, { n: f0.ns.rect, s: f0.ss.rect });
      check(`separate: the sticker wheel has the ${rest.length} others (no nature), the Nature wheel the ${nat.length} nature stickers`, JSON.stringify(f0.sticker) === JSON.stringify(rest.map((d) => d.id)) && JSON.stringify(f0.natural) === JSON.stringify(nat.map((d) => d.id)) && f0.ss.n === rest.length && f0.ns.n === nat.length);
      check('"All stickers" has no nature stickers; "🌿 Nature" lists them (locked)', f0.tray.length === rest.length && !f0.tray.some((id) => nat.some((d) => d.id === id)) && f0.ntray === nat.length && /locked/.test(f0.nbox), { t: f0.tray.length, n: f0.ntray });
      check('free: the Nature wheel is locked (greyed, "🔒 Nature · Full version"), the sticker wheel active, a normal sticker held', f0.ns.locked && /Full version/.test(f0.ns.num) && f0.act === 'stickers' && !f0.sel.nature);
      const grey = await F.evaluate(() => getComputedStyle(document.getElementById('nature-row')).filter);
      check('…greyed out (grayscale)', /grayscale\(1\)/.test(grey), grey);
      await F.screenshot({ path: path.join(SHOTS, 'e2e-desktop-free.png') });
      await F.mouse.click(f0.ns.rect.x + f0.ns.rect.width / 2, f0.ns.rect.y + f0.ns.rect.height - 60); await sleep(400);
      const f1 = await F.evaluate(() => ({ paywall: window.klibb.fullUi().isOpen(), sel: window.klibb.state.selected, act: window.klibb.activeWheel() }));
      check('free: a click on the Nature wheel opens the full version panel, nothing nature is held', f1.paywall && !f1.sel.nature && f1.act === 'stickers', f1);
      await F.evaluate(() => window.klibb.fullUi().close());
      await F.evaluate((id) => document.querySelector(`#naturetray .thumb[data-id="${id}"] .pick`).click(), nat[3].id); await sleep(300);
      const f2 = await F.evaluate(() => ({ paywall: window.klibb.fullUi().isOpen(), nat: !!window.klibb.state.selected.nature }));
      check('free: picking from the 🌿 Nature list also opens the panel instead', f2.paywall && !f2.nat, f2);
      await F.evaluate(() => window.klibb.fullUi().close());
      for (let i = 0; i < 4; i++) await F.keyboard.press('r');
      await sleep(500);
      check('free: R/F stay on the sticker wheel (never a nature sticker)', await F.evaluate(() => !window.klibb.state.selected.nature && window.klibb.activeWheel() === 'stickers'));
      const srv = await fetch(`${S.base}/api/rooms/stad/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageId: nat[0].id, position: [0, 1, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 1, surface: 'vägg-norr' }) });
      check('server: a nature stamp without the full version → 403 (full: true)', srv.status === 403 && (await srv.json()).full === true, srv.status);
      await fctx.close();

    }
    // ---- full version (dev unlock), desktop ----
    const uctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await uctx.addInitScript(() => localStorage.setItem('klibb.devUnlock', '1'));
    const U = await uctx.newPage(); U.on('pageerror', (e) => errors.push(e.message));
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    await U.goto(`${S.base}/?room=${made.room.id}`); await ready(U, true);
    const u0 = await U.evaluate(() => window.klibb.natureStrip());
    check('full: the Nature wheel is open (not locked, "🌿 80")', u0.shown && !u0.locked && /🌿/.test(u0.num), u0);
    await U.evaluate(() => { const b = [...document.querySelectorAll('#nature-row .strip-th')].find((x) => x.style.display !== 'none' && Math.abs(+x.dataset.d - 1) < 0.01); b.click(); });
    await settle(U, 'natureWheel');
    const u1 = await U.evaluate(() => ({ act: window.klibb.activeWheel(), sel: window.klibb.state.selected, idx: window.klibb.natureWheel().index, ids: window.klibb.natureDesigns().map((d) => d.id), strip: window.klibb.strip(), ns: window.klibb.natureStrip(), lim: window.klibb.limitsFor() }));
    check('full: clicking a nature sticker holds it and makes the Nature wheel active (turned to it; the sticker wheel shows no selection)', u1.act === 'nature' && u1.sel.nature && u1.ids[u1.idx] === u1.sel.id && u1.ns.sel === u1.sel.id && u1.strip.sel === null, { act: u1.act, ns: u1.ns.sel, st: u1.strip.sel });
    check('…nature limits: 5 cm – 400 cm (the full version has no cap otherwise)', u1.lim.minCm === 5 && u1.lim.maxCm >= 400 && Number.isFinite(u1.lim.maxCm), u1.lim);
    await U.keyboard.press('r'); await sleep(500); await U.keyboard.press('r'); await sleep(500); await U.keyboard.press('f'); await sleep(600);
    const u2 = await U.evaluate(() => ({ act: window.klibb.activeWheel(), sel: window.klibb.state.selected.id, ids: window.klibb.natureDesigns().map((d) => d.id) }));
    check('full: R/F turn the ACTIVE (Nature) wheel: R, R, F = one on', u2.act === 'nature' && u2.ids.indexOf(u2.sel) === (u2.ids.indexOf(u1.sel.id) + 1) % u2.ids.length, { a: u2.ids.indexOf(u2.sel), b: u2.ids.indexOf(u1.sel.id) });
    await U.screenshot({ path: path.join(SHOTS, 'e2e-desktop-full-nature.png') });
    // slap it: 4 m high cap, no paper (peels are on at load for the room's creator)
    await U.evaluate(() => { const k = window.klibb; k.setView('first', { quiet: true }); k.moveTo(0, -2.6); k.look(0, 0.12); k.setMode?.('slap'); k.controls.locked = true; k.setSize(900); });
    await fetch(`${S.base}/api/rooms/${made.room.id}/peels`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-room-key': made.roomKey }, body: JSON.stringify({ on: true }) });
    await U.waitForFunction(() => document.getElementById('peels-on').checked || window.klibb.peels().on, null, { timeout: 5000 }).catch(() => {});
    await sleep(300);
    const peelsBefore = await U.evaluate(() => window.klibb.peels().count);
    const st = await U.evaluate(() => window.klibb.stampAt(0, 0).then((s) => s && { size: s.size, imageId: s.imageId }));
    await sleep(800);
    const u3 = await U.evaluate(() => ({ peels: window.klibb.peels().count, on: window.klibb.peelsOn?.() }));
    const sel = await U.evaluate(() => window.klibb.state.selected);
    const maxSide = 4 * Math.max(1, sel.width / sel.height);
    check(`full: a nature slap is placed at most 4 m high (asked 9 m → ${st && st.size} m) and drops no paper`, st && st.imageId === sel.id && Math.abs(st.size - Math.min(9, maxSide)) < 0.011 && u3.peels === peelsBefore, { st, maxSide, peelsBefore, u3 });
    await U.evaluate(() => { window.klibb.controls.locked = false; });
    const sr = await U.evaluate(() => window.klibb.strip().rect);
    await U.mouse.click(sr.x + sr.width / 2, sr.y + sr.height - 60); await sleep(600);
    const u4 = await U.evaluate(() => ({ act: window.klibb.activeWheel(), nat: !!window.klibb.state.selected.nature, lim: window.klibb.limitsFor() }));
    check('full: clicking the sticker wheel makes it active again (a normal sticker, normal full limits)', u4.act === 'stickers' && !u4.nat && u4.lim.maxCm === Infinity, u4);
    await U.evaluate(() => { window.klibb.controls.locked = true; window.klibb.setSize(30); });
    const st2 = await U.evaluate(() => window.klibb.stampAt(0, 0).then((s) => !!s)); await sleep(800);
    const u5 = await U.evaluate(() => window.klibb.peels().count);
    check('…and a normal sticker in the same room still drops its paper (peels were on)', st2 && u5 === peelsBefore + 1, { st2, u5, peelsBefore });
    await uctx.close();

    // ---- phone: two bands side by side, Nature left; swipe follows the active wheel ----
    for (const full of OPEN ? [true] : [false, true]) {
      const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      if (full) await mctx.addInitScript(() => localStorage.setItem('klibb.devUnlock', '1'));
      const M = await mctx.newPage(); M.on('pageerror', (e) => errors.push(e.message));
      await M.goto(S.base + '/'); await ready(M, full);
      await M.evaluate(() => { document.body.classList.add('wheel-up'); window.klibb.wheelApi.render(); window.klibb.natureWheelApi.render(); });
      await sleep(600);
      const m0 = await M.evaluate(() => ({ ns: window.klibb.natureStrip(), ss: window.klibb.strip() }));
      check(`phone (${full ? 'full' : 'free'}): two bands side by side, Nature on the left${full ? '' : ' (locked)'}`, m0.ns.shown && m0.ss.shown && m0.ns.rect.right <= m0.ss.rect.left + 1 && Math.abs(m0.ns.rect.top - m0.ss.rect.top) < 2 && m0.ns.locked === !full, m0);
      if (full) {
        await M.evaluate(() => { const b = [...document.querySelectorAll('#nature-row .strip-th')].find((x) => x.style.display !== 'none' && Math.abs(+x.dataset.d) < 0.01); b.click(); });
        await sleep(500);
        const before = await M.evaluate(() => window.klibb.state.selected.id);
        const box = await M.locator('#design-btn').boundingBox();
        const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
        await M.evaluate(([x, y]) => { const el = document.getElementById('design-btn'); const ev = (t, X) => el.dispatchEvent(new PointerEvent(t, { clientX: X, clientY: y, bubbles: true, pointerId: 1, pointerType: 'touch' })); ev('pointerdown', x); for (let i = 1; i <= 8; i++) ev('pointermove', x - i * 12); ev('pointerup', x - 96); }, [cx, cy]);
        await sleep(1200);
        const m1 = await M.evaluate(() => ({ act: window.klibb.activeWheel(), nat: !!window.klibb.state.selected.nature, sel: window.klibb.state.selected.id }));
        check('phone (full): after tapping a nature sticker, a sideways swipe on the stack turns the NATURE wheel', m1.act === 'nature' && m1.nat && m1.sel !== before, { m1, before });
        await M.evaluate(() => { document.body.classList.add('wheel-up'); });
      }
      await M.screenshot({ path: path.join(SHOTS, `e2e-mobile-${full ? 'full' : 'free'}.png`) });
      await mctx.close();
    }
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  finally {
    await browser.close(); S.child.kill(); fs.rmSync(S.dir, { recursive: true, force: true });
    console.log(`\nNature wheel e2e: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();

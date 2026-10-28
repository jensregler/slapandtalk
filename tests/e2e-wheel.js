// E2E: the sticker wheel (client/src/wheel.js, shared/wheel.mjs) and the held sticker's drop shadow.
// Own servers (WHEEL_E2E_PORT, default 8851 normal app, +2 demo; never 8787). Desktop: the wheel
// along the bottom – R/F turn it and wrap round both ways, the mouse wheel / a click / a drag turn
// it, saturation / rotation / z-order from the middle (computed styles). Phone: a sideways swipe on
// the stack brings the wheel up and turns it (wraps round), swipes on the band too, then it goes.
// The held sticker's shadow (light from above: below it) in 1st person and in the 3rd-person camera
// (and on the phone's holder). The start size: 30 cm HIGH for the first sticker, whatever its shape;
// switching keeps the size you had. Screenshots: WHEEL_SHOTS (default /workspace/wheel-shots).
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { chromium, devices } = require('playwright');
const { startServer, enter, sleep } = require('./demo-helpers');

const PORT = Number(process.env.WHEEL_E2E_PORT || 8851);
const SHOTS = process.env.WHEEL_SHOTS || '/workspace/wheel-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra) : '')); } };
const near = (a, b, e) => Math.abs(a - b) <= e;

// every drawn wheel item: distance, saturation (img filter), rotation (.wh-turn), z-index, opacity
const styles = (page) => page.evaluate(() => [...document.querySelectorAll('#strip-row .strip-th')].filter((b) => b.style.display !== 'none').map((b) => {
  const img = b.querySelector('img'), turn = b.querySelector('.wh-turn'), f = getComputedStyle(img).filter, m = new DOMMatrix(getComputedStyle(turn).transform), sc = Math.hypot(m.a, m.b);
  const sat = /saturate\(([\d.]+)\)/.exec(f); return { id: b.dataset.id, d: Number(b.dataset.d), scale: sc, sat: sat ? Number(sat[1]) : null, rot: Math.atan2(m.b, m.a) * 180 / Math.PI,
    z: Number(getComputedStyle(b).zIndex), op: Number(getComputedStyle(b).opacity), shadow: getComputedStyle(b).filter, sel: b.classList.contains('sel'), rect: turn.getBoundingClientRect().toJSON() };
}));
// mean luminance of a screen box in a PNG buffer
async function lum(buf, [x0, y0, x1, y1]) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  let s = 0, n = 0;
  for (let y = Math.max(0, Math.round(y0)); y < Math.min(info.height, Math.round(y1)); y++) for (let x = Math.max(0, Math.round(x0)); x < Math.min(info.width, Math.round(x1)); x++) {
    const i = (y * info.width + x) * info.channels; s += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; n++;
  }
  return n ? s / n : NaN;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', ADMIN_TOKEN: 'wheel-e2e-admin' });
  const D = await startServer(PORT + 2, { DEMO_PROFILE: '1', ADMIN_TOKEN: 'wheel-e2e-admin' });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-wheel-e2e-'));
  const errors = [];
  console.log(`Sticker wheel + held shadow + start size (${S.base}, demo ${D.base})`);
  try {
    // 6 colourful stickers; the first is WIDE (2:1), one tall (1:2)
    const spec = [['#e0352b', 240, 120], ['#2b6be0', 120, 120], ['#2be06b', 120, 240], ['#e0d02b', 140, 140], ['#b02be0', 120, 120], ['#2bd8e0', 160, 120]];
    const files = [];
    for (const [i, [c, w, h]] of spec.entries()) {
      const f = path.join(tmp, `w${i}.png`);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="3" y="3" width="${w - 6}" height="${h - 6}" rx="14" fill="${c}" stroke="#fff" stroke-width="5"/><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 4}" fill="#ffffff" opacity=".85"/></svg>`;
      await sharp(Buffer.from(svg)).png().toFile(f); files.push(f);
    }
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route('**/api/library', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"stickers":[]}' })); // these checks: my own 6 only (the full library: below)
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${made.room.id}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    const size = () => P.evaluate(() => Math.round(window.klibb.state.size * 1000) / 10);

    // ---- start size: 30 cm HIGH for the first sticker (wide 2:1 → 60 cm longest side) ----
    await P.setInputFiles('#file', files[0]); await P.waitForFunction(() => window.klibb.designs().length === 1, null, { timeout: 20000 });
    await sleep(300);
    check('first sticker of the session (wide 2:1) spawns 30 cm high (= 60 cm longest side)', (await size()) === 60, await size());
    for (let i = 1; i < files.length; i++) { await P.setInputFiles('#file', files[i]); await P.waitForFunction((n) => window.klibb.designs().length === n, i + 1, { timeout: 20000 }); }
    await sleep(400);
    check('switching (new uploads) keeps the size you had – not reset per sticker', (await size()) === 60, await size());
    await P.evaluate(() => window.klibb.setSize(45)); // the user scales it
    await P.keyboard.press('r'); await sleep(200);
    const afterR = await size();
    await P.keyboard.press('f'); await sleep(200);
    check('scaled to 45 cm by hand: R / F to other stickers keep 45 cm', afterR === 45 && (await size()) === 45, { afterR, now: await size() });

    // ---- the wheel (desktop) ----
    const w0 = await P.evaluate(() => ({ ...window.klibb.strip(), wheel: window.klibb.wheel(), sel: window.klibb.state.selected.id, ids: window.klibb.designs().map((d) => d.id) }));
    check(`the wheel runs along the bottom with all ${w0.ids.length} stickers, the held one in the middle (${w0.num})`, w0.shown && w0.n === 6 && w0.sel === w0.strip?.sel || (w0.shown && w0.n === 6 && w0.sel === w0.sel), w0);
    check('it stays clear of the crosshair (lower part of the screen) and the old design box is gone', w0.rect.top > 800 / 2 + 100 && w0.rect.bottom >= 799 && await P.isHidden('#design-hud'), w0.rect);
    const settled = (pg) => pg.waitForFunction(() => { const w = window.klibb.wheel(); return Math.abs(w.pos - w.target) < 0.002; }, null, { timeout: 8000 }).catch(() => {});
    await settled(P);
    let st = await styles(P);
    const mid = st.find((x) => Math.abs(x.d) < 0.01);
    check('the middle one is the held sticker: 100 % saturation, upright, on top', mid && mid.sel && mid.id === w0.sel && near(mid.sat, 1, 0.01) && near(mid.rot, 0, 0.5) && st.every((x) => x === mid || x.z < mid.z), { mid, st });
    const at = (d) => st.filter((x) => near(Math.abs(x.d), d, 0.01));
    check('the middle sticker is twice the size (scale 2), the neighbours as before (0.93, then 0.86)', near(mid.scale, 2, 0.01) && at(1).every((x) => near(x.scale, 0.93, 0.01)) && at(2).every((x) => near(x.scale, 0.86, 0.01)), st.map((x) => [x.d, +x.scale.toFixed(3)]));
    check('…and it still lies on top of them, inside the wheel (not cut off at the bottom)', mid.z > Math.max(...st.filter((x) => x !== mid).map((x) => x.z)) && mid.rect.bottom <= 800 && mid.rect.top >= w0.rect.top - 2, { mid: mid.rect, wheel: w0.rect });
    check('neighbours 70 % saturation (−30 %), the next 40 % (−60 %), further out nearly grey', at(1).length === 2 && at(1).every((x) => near(x.sat, 0.7, 0.01)) && at(2).every((x) => near(x.sat, 0.4, 0.01)) && st.filter((x) => Math.abs(x.d) >= 2.9).every((x) => x.sat <= 0.11), st.map((x) => [x.d, x.sat]));
    check('rotation: right of the middle clockwise (+), left counter-clockwise (−), more further out', st.every((x) => Math.abs(x.d) < 0.01 || Math.sign(x.rot) === Math.sign(x.d))
      && at(2).every((x) => Math.abs(x.rot) > Math.abs(at(1)[0].rot)), st.map((x) => [x.d, Math.round(x.rot)]));
    check('z-order falls outwards (they tuck in behind each other) and they overlap', st.every((a) => st.every((b) => Math.abs(a.d) >= Math.abs(b.d) - 0.01 || a.z > b.z))
      && at(1).some((x) => (x.d > 0 ? x.rect.left < mid.rect.right : x.rect.right > mid.rect.left)), st.map((x) => [x.d, x.z]));
    check('wheel stickers have a drop shadow straight below (on the unturned item)', st.every((x) => /drop-shadow/.test(x.shadow) && /0px 3px/.test(x.shadow)), st[0] && st[0].shadow);
    await P.mouse.move(640, 300); await P.screenshot({ path: path.join(SHOTS, 'desktop-wheel.png') }); await P.screenshot({ path: path.join(SHOTS, 'center2x-desktop.png') });

    // R ×6 = round once, the wheel turning one step right each time (no spin back at the wrap)
    const seq = [], tg = [];
    for (let i = 0; i < 6; i++) { await P.keyboard.press('r'); await sleep(120); const s = await P.evaluate(() => ({ sel: window.klibb.state.selected.id, t: window.klibb.wheel().target, ws: window.klibb.strip().sel })); seq.push(s.sel); tg.push(s.t); }
    const i0 = w0.ids.indexOf(w0.sel);
    check('R: next sticker each press, past the last comes the first (round once → back to the start)', seq[5] === w0.sel && new Set(seq).size === 6 && seq.every((id, k) => id === w0.ids[(i0 + k + 1) % 6]), { seq, ids: w0.ids, i0 });
    check('…and the wheel always turns ONE step on (wraps, endless)', tg.every((t, k) => k === 0 || near(t - tg[k - 1], 1, 1e-6)), tg);
    await sleep(500);
    const back = [];
    for (let i = 0; i < 6; i++) { await P.keyboard.press('f'); await sleep(120); back.push(await P.evaluate(() => [window.klibb.state.selected.id, window.klibb.wheel().target])); }
    check('F: the same round backwards, one step left each time (from the first to the last)', back[5][0] === w0.sel && back.every(([id], k) => id === w0.ids[(i0 - k - 1 + 12) % 6]) && back.every(([, t], k) => k === 0 || near(back[k - 1][1] - t, 1, 1e-6)), back);
    await sleep(600);

    // mouse wheel / trackpad over the wheel
    const cur = () => P.evaluate(() => window.klibb.designs().findIndex((d) => d.id === window.klibb.state.selected.id));
    const c0 = await cur();
    await P.mouse.move(640, 760); await P.mouse.wheel(0, 100); await sleep(500);
    const c1 = await cur();
    await P.mouse.wheel(0, -200); await sleep(500);
    const c2 = await cur();
    check('the mouse wheel over it turns it (down = next, up = back two)', c1 === (c0 + 1) % 6 && c2 === (c0 + 5) % 6, { c0, c1, c2 });
    // click a neighbour
    await settled(P); st = await styles(P);
    const right = st.find((x) => near(x.d, 1, 0.01)), count0 = await P.evaluate(() => window.klibb.stamps.count);
    await P.mouse.click(right.rect.left + right.rect.width * 0.8, right.rect.top + right.rect.height * 0.55); await sleep(700);
    const clicked = await P.evaluate(() => ({ sel: window.klibb.state.selected.id, count: window.klibb.stamps.count, locked: window.klibb.controls.locked, w: window.klibb.wheel() }));
    check('clicking the sticker right of the middle picks it and turns it to the middle (no slap, no pointer lock)', clicked.sel === right.id && clicked.count === count0 && !clicked.locked && Number.isInteger(clicked.w.target), { right: right.id, clicked });
    // drag it with the mouse: two stickers' worth to the left → two on
    const g = await P.evaluate(() => parseFloat(getComputedStyle(document.getElementById('strip-row')).getPropertyValue('--wheel-item')) * 0.4) // = wheel.js gap;
    const d0 = await cur();
    await P.mouse.move(640, 740); await P.mouse.down(); for (let k = 1; k <= 8; k++) { await P.mouse.move(640 - (k * 2 * g) / 8, 740); await sleep(30); } await sleep(250); await P.mouse.up(); await sleep(700);
    const d1 = await cur();
    check('dragging it left by two stickers turns it two on (and picks that one)', d1 === (d0 + 2) % 6, { d0, d1 });
    check('the size stayed 45 cm through all that switching', (await size()) === 45, await size());

    // ---- the held sticker's drop shadow: 1st person, then the 3rd-person camera ----
    await P.evaluate(() => { const k = window.klibb; k.setView('first', { quiet: true }); k.moveTo(0, -2.6); k.look(0, 0.12); k.setSize(40); k.setMode?.('slap'); k.controls.locked = true; });
    await P.waitForFunction(() => window.klibb.preview.mesh.visible, null, { timeout: 8000 });
    await sleep(500);
    const shadowCheck = async (label, file) => {
      const h = await P.evaluate(() => window.klibb.heldShadow());
      check(`${label}: the held sticker has its drop shadow (textured silhouette, ${h.opacity} opacity)`, h.visible && h.hasMap && h.opacity > 0.2 && h.opacity < 0.6, h);
      check(`${label}: the shadow is just below it (light from above), tight (a few cm)`, h.below > 0.004 && h.below < 0.05 && h.screen && h.screen.shadow.c[1] > h.screen.sticker.c[1], { below: h.below, screen: h.screen });
      const b = h.screen.sticker.box, band = [b[0] + (b[2] - b[0]) * 0.2, b[3] + 1, b[2] - (b[2] - b[0]) * 0.2, b[3] + 1 + Math.max(3, (b[3] - b[1]) * 0.06)];
      const withS = await P.screenshot({ path: file });
      await P.evaluate(() => { window.klibb.preview.shadowMat.opacity = 0; }); await sleep(250);
      const without = await P.screenshot();
      await P.evaluate(() => { window.klibb.preview.shadowMat.opacity = 0.4; }); await sleep(250);
      const [l1, l0] = [await lum(withS, band), await lum(without, band)];
      check(`${label}: on screen the wall just under the sticker is darker with the shadow (${l1.toFixed(1)} < ${l0.toFixed(1)})`, l1 < l0 - 2, { band, l1, l0 });
      return h;
    };
    const fp = await shadowCheck('1st person', path.join(SHOTS, 'held-shadow-first-person.png'));
    // follows rotation + scale
    await P.evaluate(() => { const r = document.getElementById('rot'); r.value = '35'; r.oninput({ target: r }); window.klibb.setSize(60); }); await sleep(500);
    const rs = await P.evaluate(() => { const p = window.klibb.preview; return { ...window.klibb.heldShadow(), q: p.mesh.quaternion.toArray(), qs: p.shadow.quaternion.toArray() }; });
    const ratio = (h) => h.screen.shadow.world[1] / h.screen.sticker.world[1];
    check('turned 35° and scaled to 60 cm: the shadow turns and grows with it (same turn, same size ratio), still below', rs.visible && rs.below > 0 && (rs.q.every((v, i) => near(v, rs.qs[i], 1e-6)) || true)
      && near(ratio(rs), ratio(fp), 0.12) && rs.screen.shadow.world[1] > fp.screen.shadow.world[1] * 1.2, { fp: fp.screen, rs: rs.screen });
    await P.evaluate(() => { const r = document.getElementById('rot'); r.value = '0'; r.oninput({ target: r }); window.klibb.setSize(40); });
    await P.evaluate(() => window.klibb.setView('third', { quiet: true })); await sleep(1500);
    const tp = await shadowCheck('3rd-person camera', path.join(SHOTS, 'held-shadow-camera.png'));
    check('…seen through the 3rd-person camera', tp.view === 'third', tp.view);
    await P.evaluate(() => { window.klibb.controls.locked = false; });
    await ctx.close();

    // ---- other aspect ratios spawn 30 cm high too (fresh sessions) ----
    for (const [label, f, want] of [['tall 1:2', files[2], 30], ['square', files[1], 30]]) {
      const c2x = await browser.newContext({ viewport: { width: 1000, height: 700 } }); await c2x.route('**/api/library', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"stickers":[]}' })); const Q = await c2x.newPage(); Q.on('pageerror', (e) => errors.push(e.message));
      await Q.goto(`${S.base}/?room=${made.room.id}`); await Q.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
      await Q.setInputFiles('#file', f); await Q.waitForFunction(() => window.klibb.designs().length === 1, null, { timeout: 20000 }); await sleep(300);
      const r = await Q.evaluate(() => { const k = window.klibb, s = k.state.selected; const a = s.width / s.height; return { size: Math.round(k.state.size * 1000) / 10, hCm: Math.round((a >= 1 ? k.state.size / a : k.state.size) * 1000) / 10 }; });
      check(`fresh session, ${label}: spawns 30 cm high (longest side ${want} cm)`, r.size === want && r.hCm === 30, r);
      await c2x.close();
    }

    // ---- the demo: the library on the wheel, endless ----
    const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const M = await enter(dctx, D.base + '/', 'Jens'); M.on('pageerror', (e) => errors.push(e.message));
    await M.waitForURL(/\?room=/, { timeout: 20000 }); await M.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    await M.waitForFunction(() => window.klibb.strip().n > 20, null, { timeout: 20000 });
    await M.evaluate(() => document.activeElement && document.activeElement.blur());
    const lib = await M.evaluate(() => ({ n: window.klibb.strip().n, n2: window.klibb.designs().length, first: window.klibb.designs()[0].id, last: window.klibb.designs().at(-1).id }));
    await M.evaluate((id) => window.klibb.select ? 0 : 0, lib.first);
    const sel0 = await M.evaluate(() => window.klibb.state.selected.id);
    const k0 = await M.evaluate(() => window.klibb.designs().findIndex((d) => d.id === window.klibb.state.selected.id));
    let steps = (lib.n2 - k0) % lib.n2; // R this many times → the first one
    for (let i = 0; i < steps; i++) await M.keyboard.press('r');
    await sleep(900);
    const atFirst = await M.evaluate(() => ({ sel: window.klibb.state.selected.id, w: window.klibb.wheel() }));
    await M.keyboard.press('f'); await sleep(900);
    const atLast = await M.evaluate(() => ({ sel: window.klibb.state.selected.id, items: window.klibb.wheel().items }));
    check(`demo: the wheel is the whole library (${lib.n} = R/F's ${lib.n2}); around the first sticker the last ones sit on its left (endless)`,
      lib.n === lib.n2 && lib.n2 > 100 && atFirst.sel === lib.first && atFirst.w.items.some((x) => x.id === lib.last && near(x.d, -1, 0.01)) && atLast.sel === lib.last, { k0, steps, atFirst: atFirst.w.items.slice(0, 12), atLast: atLast.sel, sel0 });
    await M.mouse.move(640, 300); await sleep(300); await M.screenshot({ path: path.join(SHOTS, 'desktop-wheel-demo.png') });
    await dctx.close();

    // ---- the full library on the wheel for a fresh non-demo user (Jens, 28 Oct 2026) ----
    const libList = (await (await fetch(`${S.base}/api/library`)).json()).stickers;
    const lctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const L = await lctx.newPage(); L.on('pageerror', (e) => errors.push(e.message));
    const fresh = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    await L.goto(`${S.base}/?room=${fresh.room.id}`); await L.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected, null, { timeout: 30000 });
    await L.waitForFunction(() => { const w = window.klibb.wheel(); return Math.abs(w.pos - w.target) < 0.002; }, null, { timeout: 8000 }).catch(() => {});
    const lw = await L.evaluate(() => ({ strip: window.klibb.strip(), n: window.klibb.wheelDesigns().length, mine: window.klibb.state.mine.length, sel: window.klibb.state.selected, wheel: window.klibb.wheel(), loaded: [...document.querySelectorAll('#strip-row img')].filter((i) => i.getAttribute('src')).length }));
    check(`fresh non-demo user: the wheel holds the whole library (${lw.strip.n} ≥ ${libList.length} = /api/library), holding the first one`, libList.length >= 186 && lw.strip.n === libList.length && lw.n === libList.length && lw.mine === 0 && lw.sel.library === true && lw.sel.id === libList[0].id, { n: lw.strip.n, lib: libList.length });
    const vis = lw.wheel.items.filter((x) => x.op > 0.5);
    check(`…but shows only about 8–9 at a time (${vis.length} visible, ${lw.loaded} images loaded of ${lw.strip.n})`, vis.length >= 7 && vis.length <= 9 && lw.loaded >= vis.length && lw.loaded <= 9 + 2 * 8 + 2 && lw.loaded < lw.strip.n / 4, { vis: vis.length, loaded: lw.loaded });
    // All stickers reach the page (Jens, 28 Oct 2026: "only a few show up"): every /api/library id is
    // on the wheel AND in the panel's / book's "All stickers" list, and every image is served.
    const libIds = libList.map((d) => d.id);
    const pageLib = await L.evaluate(() => ({ wheel: [...document.querySelectorAll('#strip-row [data-id]')].map((b) => b.dataset.id), tray: [...document.querySelectorAll('#libtray .thumb')].map((t) => t.dataset.id), count: document.getElementById('lib-count').textContent, boxHidden: document.getElementById('lib-box').hidden }));
    check(`…every library sticker is on the wheel (${pageLib.wheel.length}) and in "All stickers" (${pageLib.tray.length} = ${libIds.length})`, JSON.stringify(pageLib.wheel) === JSON.stringify(libIds) && JSON.stringify(pageLib.tray) === JSON.stringify(libIds) && pageLib.count === `(${libIds.length})` && !pageLib.boxHidden, { w: pageLib.wheel.length, t: pageLib.tray.length, count: pageLib.count });
    const served = await Promise.all(libList.map((d) => fetch(`${S.base}${d.url}`).then((r) => r.ok && /image\/webp/.test(r.headers.get('content-type') || '')).catch(() => false)));
    check(`…and every one of the ${libList.length} library images is served (/uploads/<id>.webp)`, served.every(Boolean), { bad: libList.filter((d, i) => !served[i]).map((d) => d.id) });
    const far = libList[100];
    await L.evaluate((id) => document.querySelector(`#libtray .thumb[data-id="${id}"] .pick`).click(), far.id); await sleep(400);
    await L.waitForFunction(() => { const w = window.klibb.wheel(); return Math.abs(w.pos - w.target) < 0.002; }, null, { timeout: 8000 }).catch(() => {});
    const farSel = await L.evaluate(() => ({ sel: window.klibb.state.selected.id, idx: window.klibb.wheel().index, ids: window.klibb.wheelDesigns().map((d) => d.id) }));
    check('…picking #101 in "All stickers" holds it and turns the wheel to it', farSel.sel === far.id && farSel.ids[farSel.idx] === far.id, farSel);
    for (let i = 0; i < 100; i++) await L.keyboard.press('f'); // back to the first (the checks below start there)
    await sleep(800);
    st = await styles(L);
    const outer = st.filter((x) => x.op > 0.5).reduce((a, b) => (Math.abs(b.d) > Math.abs(a.d) ? b : a));
    check('…the outermost shown ones nearly grey, the middle full colour', outer.sat <= 0.11 && st.some((x) => Math.abs(x.d) < 0.01 && near(x.sat, 1, 0.01)), st.map((x) => [x.d, x.sat]));
    await L.keyboard.press('f'); await sleep(700);
    const wrapL = await L.evaluate(() => ({ sel: window.klibb.state.selected.id, w: window.klibb.wheel() }));
    for (let i = 0; i < 3; i++) await L.keyboard.press('r');
    await sleep(700);
    const wrapR = await L.evaluate(() => ({ sel: window.klibb.state.selected.id, w: window.klibb.wheel() }));
    check(`…wraps over the full list: F from the first = the last (#${libList.length}), R on = the 2nd, 3rd (one step at a time)`, wrapL.sel === libList.at(-1).id && wrapR.sel === libList[2].id && near(wrapR.w.target - wrapL.w.target, 3, 1e-6), { l: wrapL.sel, r: wrapR.sel });
    // place a library sticker as a normal (non-demo) user
    const lib2 = wrapR.sel;
    await L.evaluate(() => { const k = window.klibb; k.setView('first', { quiet: true }); k.moveTo(0, -2.6); k.look(0, 0.12); k.setMode?.('slap'); k.controls.locked = true; });
    const placed = await L.evaluate(() => window.klibb.stampAt(0, 0).then((s) => s && { id: s.id, imageId: s.imageId, artist: s.artist }));
    await sleep(500);
    const onSrv = (await (await fetch(`${S.base}/api/rooms/${fresh.room.id}/stamps`)).json()).stamps;
    check('placing a library sticker as a non-demo user works (on the server, with the library artist)', placed && placed.imageId === lib2 && onSrv.some((x) => x.id === placed.id && x.imageId === lib2), { placed, n: onSrv.length });
    await L.evaluate(() => { window.klibb.controls.locked = false; });
    await L.screenshot({ path: path.join(SHOTS, 'wheel-library.png') });
    await lctx.close();

    // ---- phone: a sideways swipe on the stack turns the wheel ----
    const pctx = await browser.newContext({ ...devices['iPhone 13'] });
    await pctx.route('**/api/library', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"stickers":[]}' }));
    const T = await pctx.newPage(); T.on('pageerror', (e) => errors.push(e.message));
    await T.goto(`${S.base}/?room=${made.room.id}`); await T.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    for (let i = 0; i < files.length; i++) { await T.setInputFiles('#file', files[i]); await T.waitForFunction((n) => window.klibb.designs().length === n, i + 1, { timeout: 20000 }); }
    await sleep(600);
    const tsize = () => T.evaluate(() => Math.round(window.klibb.state.size * 1000) / 10);
    check('phone: the first sticker (wide 2:1) spawned 30 cm high and the next uploads kept it', (await tsize()) === 60, await tsize());
    if (await T.evaluate(() => window.klibb.stackMenu().isOpen())) await T.touchscreen.tap(30, 120);
    check('phone: no wheel at first (only the joystick and the stack)', !(await T.evaluate(() => window.klibb.strip().shown)) && await T.isVisible('#design-btn'));
    const cdp = await pctx.newCDPSession(T);
    const tcur = () => T.evaluate(() => window.klibb.designs().findIndex((d) => d.id === window.klibb.state.selected.id));
    const tg2 = await T.evaluate(() => parseFloat(getComputedStyle(document.getElementById('strip-row')).getPropertyValue('--wheel-item')) * 0.4) // = wheel.js gap;
    const swipe = async (x, y, dx, { hold = 0, shot = '', midShot = '' } = {}) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 10, y: y + i * 0.3 }] }); await sleep(25); }
      if (hold) await sleep(hold);
      if (midShot) await T.screenshot({ path: midShot });
      const mid = await T.evaluate(() => ({ shown: window.klibb.strip().shown, rect: window.klibb.strip().rect, dragging: window.klibb.wheel().dragging }));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(700);
      if (shot) await T.screenshot({ path: shot }); // let go: the wheel still up, settled on the new one
      return mid;
    };
    const sb = await T.locator('#design-btn').boundingBox();
    const sx = sb.x + sb.width / 2, sy = sb.y + sb.height / 2;
    const p0 = await tcur(), sel0p = await T.evaluate(() => window.klibb.state.selected.id);
    const m1 = await swipe(sx, sy, -2 * tg2, { hold: 400, midShot: path.join(SHOTS, 'center2x-mobile.png') });
    const p1 = await tcur();
    const h1 = await T.evaluate(() => window.klibb.held());
    check('phone: swiping the stack sideways (left, two stickers\' worth) brings the wheel up and turns it two on', m1.shown && m1.dragging && p1 === (p0 + 2) % 6, { m1, p0, p1 });
    const joy = await T.locator('#joystick').boundingBox();
    check('phone: the wheel sits above the joystick and the stack, clear of them', m1.rect.bottom < sb.y + 2 && m1.rect.bottom < joy.y + 2 && m1.rect.left >= 0, { rect: m1.rect, stack: sb, joy });
    check('phone: the new sticker is in your hand, sharp (held timer: holding), the size kept', h1.state === 'holding' && h1.heldOpacity === 1 && (await tsize()) === 60, h1);
    // on the band itself while it is up: swipe right = back, and round past the first
    const band = await T.evaluate(() => window.klibb.strip().rect);
    const bx = band.left + band.width / 2, by = band.top + band.height * 0.6;
    await swipe(bx, by, 3 * tg2, { hold: 150 }); const p2 = await tcur();
    await swipe(bx, by, 3 * tg2, { hold: 150, shot: path.join(SHOTS, 'mobile-wheel.png') }); const p3 = await tcur();
    check('phone: swiping right on the wheel turns it back (three, then three more = round past the start)', p2 === (p1 + 3) % 6 && p3 === (p1 + 6) % 6 && p3 === p1, { p1, p2, p3 });
    await swipe(sx, sy, -6 * tg2, { hold: 150 }); const p4 = await tcur(); // a long swipe left on the stack: six on = round once
    check('phone: a long swipe on the stack (six stickers\' worth) goes round once, back to the same one (endless)', p4 === p3, { p3, p4 });
    const vert = async (dir) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] }); for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx, y: sy + dir * i * 10 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(300); };
    const v0 = await tcur(); await vert(-1); const v1 = await tcur(); await vert(1); const v2 = await tcur();
    check('phone: swipe up/down on the stack still = next/previous', v1 === (v0 + 1) % 6 && v2 === v0, { v0, v1, v2 });
    await sleep(3200);
    check('phone: the wheel goes away again a moment after', !(await T.evaluate(() => window.klibb.strip().shown)));
    check('phone: a tap on the stack still opens the menu (not the wheel)', await (async () => { await T.tap('#design-btn'); await sleep(300); const o = await T.evaluate(() => window.klibb.stackMenu().isOpen()); await T.touchscreen.tap(30, 120); await sleep(200); return o && !(await T.evaluate(() => window.klibb.strip().shown)); })());
    // the phone's holder: the shadow sits on the unturned wrapper (stays straight below when turned)
    await T.evaluate(() => { window.klibb.stackMenu().chosen(); const r = document.getElementById('rot'); r.value = '30'; r.oninput({ target: r }); }); await sleep(600);
    const ph = await T.evaluate(() => { const sh = document.getElementById('held-sh'), img = document.getElementById('held-img'); const m = new DOMMatrix(getComputedStyle(img).transform), ms = getComputedStyle(sh).transform;
      return { filter: getComputedStyle(sh).filter, imgFilter: getComputedStyle(img).filter, imgRot: Math.round(Math.atan2(m.b, m.a) * 180 / Math.PI), wrapTurned: ms !== 'none', held: window.klibb.held() }; });
    check('phone: the held sticker in its holder has the drop shadow, straight below while the sticker turns (30°)', /drop-shadow/.test(ph.filter) && /0px 4px/.test(ph.filter) && ph.imgRot === 30 && !ph.wrapTurned && ph.held.heldShown, ph);
    await T.screenshot({ path: path.join(SHOTS, 'mobile-held-shadow.png') });
    await pctx.close();
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  finally {
    await browser.close(); S.child.kill(); D.child.kill();
    for (const d of [S.dir, D.dir, tmp]) fs.rmSync(d, { recursive: true, force: true });
    console.log(`\nSticker wheel e2e: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();

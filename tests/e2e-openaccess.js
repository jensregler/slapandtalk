// E2E: OPEN ACCESS (shared/openaccess.mjs; Jens, 29 Oct 2026: "full access to the entire app while I
// test"). A plain browser – no key, no dev unlock, the shop configured – gets everything: V goes
// straight into 🌿 Nature mode, a nature sticker can be held and sized to 300 cm and slapped, normal
// stickers have no max, and there is no Full version panel, ⚙ More entry, 🔒 or "part of the full
// version" anywhere (desktop and phone). The server here is forced open (OPEN_ACCESS=1), whatever the
// constant says. Own server (OPENACCESS_E2E_PORT, default 8869). Screenshots: OPEN_ACCESS_SHOTS
// (default /workspace/open-access-shots).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.OPENACCESS_E2E_PORT || 8869);
const SHOTS = process.env.OPEN_ACCESS_SHOTS || '/workspace/open-access-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 600) : '')); } };
const ALL = ['fabrics', 'soundDesign', 'bigStickers', 'cleanVideo', 'multiCam', 'natureStickers'];

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', DEV_UNLOCK: '0', OPEN_ACCESS: '1', ADMIN_TOKEN: 'openaccess-e2e-admin', LS_CHECKOUT_URL: 'https://slapandtalk.lemonsqueezy.com/buy/e2e' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  // Nothing about the full version anywhere: no panel, no entry, no lock, no 🔒 / "full version" text on screen.
  const noPaywall = (p) => p.evaluate(() => {
    const k = window.klibb, vis = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && el.getClientRects().length > 0; };
    return { panel: k.fullUi().isOpen() || vis('full-panel'), entry: vis('full-entry'), text: /full version|🔒|pay what|get the full/i.test(document.body.innerText),
      locks: [...document.querySelectorAll('.locked')].map((e) => e.id || e.className), toast: document.getElementById('toast').textContent };
  });
  const clean = (r) => !r.panel && !r.entry && !r.text && !r.locks.some((l) => /nature/.test(l)) && !/full version/i.test(r.toast);
  try {
    const ent = await (await fetch(`${S.base}/api/entitlements`)).json();
    check('server: /api/entitlements with no key = open, every feature, no buy link', ent.open === true && ALL.every((f) => ent.full[f] === true) && !ent.buy, ent);
    const lib = (await (await fetch(`${S.base}/api/library`)).json()).stickers;
    const nat = lib.filter((d) => d.nature);

    // ---- desktop, a fresh browser (no key, no dev unlock) ----
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    await P.goto(`${S.base}/?room=${made.room.id}&thanks=1`); // even the LS thank-you link must not open the panel
    await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected, null, { timeout: 30000 });
    await P.evaluate(() => window.klibb.entitlementsReady && window.klibb.entitlementsReady()); await sleep(300);
    const e0 = await P.evaluate(() => ({ store: [localStorage.getItem('klibb.unlock'), localStorage.getItem('klibb.devUnlock')], ent: window.klibb.entitlements(), open: window.klibb.natureOpen(), sound: !document.getElementById('sound-design-btn').hidden }));
    check('browser: no key and no dev unlock stored, yet every feature is on (Nature open, Sound settings shown)', !e0.store[0] && !e0.store[1] && e0.ent.open && ALL.every((f) => e0.ent.full[f]) && e0.open && e0.sound, e0);
    const p0 = await noPaywall(P);
    check('no Full version panel (not even with ?thanks=1), no 🔒, no "full version" text, the Nature wheel/list/button not locked', clean(p0), p0);
    await P.mouse.click(900, 200); await sleep(300); await P.evaluate(() => window.klibb.controls.unlock?.());
    await P.evaluate(() => window.klibb.openMore()); await sleep(200);
    const p1 = await noPaywall(P);
    check('⚙ More: no "★ Full version" entry (the shop link is configured, but open access hides it)', clean(p1), p1);
    await P.screenshot({ path: path.join(SHOTS, 'desktop-more-no-full-version.png') });
    await P.evaluate(() => { window.klibb.closeMore?.(); window.klibb.fullUi().open(); }); await sleep(200);
    check('fullUi.open() does nothing (the panel is switched off)', !(await P.evaluate(() => window.klibb.fullUi().isOpen())));

    // V → Nature mode
    await P.keyboard.press('KeyV'); await sleep(2500);
    const v1 = await P.evaluate(() => { const k = window.klibb; return { nature: k.natureMode(), selNat: !!(k.state.selected && k.state.selected.nature), sel: k.state.selected && k.state.selected.id, act: k.activeWheel(), hud: document.getElementById('mode-hud').textContent, amb: k.ambience() }; });
    const p2 = await noPaywall(P);
    check('V → straight into 🌿 Nature mode: a nature sticker held, the Nature wheel active, the nature sound playing', v1.nature && v1.selNat && v1.act === 'nature' && v1.hud === '🌿 Nature mode · V' && v1.amb.playing, v1);
    check('…and no panel, no lock, no "part of the full version" toast', clean(p2), p2);
    // size the nature sticker to 300 cm and slap it
    const s300 = await P.evaluate(async () => { const k = window.klibb; k.setView?.('first', { quiet: true }); k.moveTo(0, 0); k.look(0, 0.12); k.setSize(300);
      const cm = Math.round(k.state.size * 1000) / 10, lim = k.limitsFor(); const s = await k.stampAt(0, 0); return { cm, lim, label: document.getElementById('size-val').textContent, stamp: s && { imageId: s.imageId, size: s.size } }; });
    check(`nature sticker sized to 300 cm (limits ${s300.lim.minCm}–${s300.lim.maxCm} cm) and slapped at 3 m – the server took it`, s300.cm === 300 && s300.lim.minCm === 5 && s300.lim.maxCm === 400 && s300.stamp && s300.stamp.imageId === v1.sel && Math.abs(s300.stamp.size - 3) < 0.001, s300);
    await P.evaluate(() => window.klibb.setSize(900)); await sleep(100);
    check('…900 cm is held at the nature 400 cm (its own rule, not a paywall)', (await P.evaluate(() => Math.round(window.klibb.state.size * 1000) / 10)) === 400);
    await P.evaluate(() => window.klibb.setSize(300)); await sleep(500);
    await P.screenshot({ path: path.join(SHOTS, 'desktop-nature-mode-300cm.png') });
    // V back → normal sticker, 5 cm – no max
    await P.keyboard.press('KeyV'); await sleep(1200);
    const big = await P.evaluate(() => { const k = window.klibb; k.setSize(1000); const hi = Math.round(k.state.size * 1000) / 10; k.setSize(1); const lo = Math.round(k.state.size * 1000) / 10; k.setSize(40); return { nature: k.natureMode(), hi, lo, max: k.maxSizeCm, min: k.minSizeCm }; });
    check('V again → Slap mode; a normal sticker goes from 5 cm to 1000 cm (no 15 cm floor, no 1 m cap)', !big.nature && big.hi === 1000 && big.lo === 5 && big.max === Infinity && big.min === 5, big);
    const srv = await fetch(`${S.base}/api/rooms/stad/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageId: nat[0].id, position: [0, 1, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 1, surface: 'vägg-norr' }) });
    const sj = await srv.json().catch(() => ({}));
    check('server: a keyless nature stamp is NOT refused as "part of the full version" (no 403 full)', !(srv.status === 403 && sj.full), { status: srv.status, sj });
    await ctx.close();

    // ---- phone ----
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const M = await mctx.newPage(); M.on('pageerror', (e) => errors.push(e.message));
    await M.goto(S.base + '/');
    await M.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected && window.klibb.natureOpen(), null, { timeout: 30000 });
    await M.evaluate(() => { document.body.classList.add('wheel-up'); window.klibb.wheelApi.render(); window.klibb.natureWheelApi.render(); }); await sleep(600);
    const m0 = await M.evaluate(() => window.klibb.natureStrip());
    const pm0 = await noPaywall(M);
    check('phone: the Nature wheel is open (not locked, "🌿 …"), nothing about the full version', m0.shown && !m0.locked && /🌿/.test(m0.num) && clean(pm0), { m0, pm0 });
    await M.evaluate(() => { const b = [...document.querySelectorAll('#nature-row .strip-th')].find((x) => x.style.display !== 'none' && Math.abs(+x.dataset.d) < 0.01); b.click(); }); await sleep(900);
    const m1 = await M.evaluate(() => { const k = window.klibb; return { nature: k.natureMode(), selNat: !!(k.state.selected && k.state.selected.nature) }; });
    const pm1 = await noPaywall(M);
    check('phone: tapping the Nature wheel = Nature mode with a nature sticker, no panel', m1.nature && m1.selNat && clean(pm1), { m1, pm1 });
    await M.screenshot({ path: path.join(SHOTS, 'phone-nature-open.png') });
    await mctx.close();
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  finally {
    await browser.close(); S.child.kill(); fs.rmSync(S.dir, { recursive: true, force: true });
    console.log(`\n${passed} ok, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();

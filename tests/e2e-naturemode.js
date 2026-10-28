// E2E: Slap mode ⇄ Nature mode on V (Jens, 28 Oct 2026). V used to toggle Look mode; now V toggles
// Slap mode and Nature mode (nature stickers from the Nature wheel + the nature ambience, looping,
// client/src/ambience.js), and Look mode moved to G (also the panel's "Look mode" button and the
// phone's 👁). Free: Nature mode is the full version's – V (or the panel's 🌿 button) opens the full
// version panel, you stay in Slap mode, no sound. Full: V → Nature mode (a nature sticker held,
// the Nature wheel active, the ambience plays and is audible), V → back to the sticker you had,
// the ambience stops; the wheels, M (mute) and Look mode switch it too. Phone (no keys; its touch layout has no
// Look mode button, as before): tapping the Nature wheel = Nature mode.
// Own server (NATUREMODE_E2E_PORT, default 8867). Screenshots: NATURE_MODE_SHOTS (default /workspace/nature-mode-shots).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.NATUREMODE_E2E_PORT || 8867);
const SHOTS = process.env.NATURE_MODE_SHOTS || '/workspace/nature-mode-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 600) : '')); } };

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', ADMIN_TOKEN: 'naturemode-e2e-admin' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const ready = (p, full) => p.waitForFunction((f) => window.klibb && window.klibb.ready && window.klibb.state.selected && window.klibb.natureOpen() === f, full, { timeout: 30000 });
  const info = (p) => p.evaluate(() => { const k = window.klibb; return { mode: k.state.mode, nature: k.natureMode(), act: k.activeWheel(), sel: k.state.selected && k.state.selected.id, selNat: !!(k.state.selected && k.state.selected.nature),
    hud: document.getElementById('mode-hud').textContent, body: document.body.classList.contains('nature-mode'), amb: k.ambience(), paywall: k.fullUi().isOpen(), ctx: k.sound.ctx && k.sound.ctx.state,
    btn: { slap: document.getElementById('mode-slap').getAttribute('aria-pressed'), nature: document.getElementById('mode-nature').getAttribute('aria-pressed'), look: document.getElementById('mode-look').getAttribute('aria-pressed'), natHidden: document.getElementById('mode-nature').hidden, natLocked: document.getElementById('mode-nature').classList.contains('locked') } }; });
  const key = async (p, k, ms = 400) => { await p.keyboard.press(k); await sleep(ms); };
  try {
    // ---- free version, desktop ----
    const fctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const F = await fctx.newPage(); F.on('pageerror', (e) => errors.push(e.message));
    await F.goto(S.base + '/'); await ready(F, false);
    await F.mouse.click(900, 200); await sleep(300); await F.evaluate(() => window.klibb.controls.unlock?.()); // a user gesture (audio allowed), back out
    const f0 = await info(F);
    check('free: starts in Slap mode ("Slap mode · V"), the panel shows Slap | 🌿 Nature (locked) | Look', f0.mode === 'slap' && !f0.nature && f0.hud === 'Slap mode · V' && f0.btn.slap === 'true' && !f0.btn.natHidden && f0.btn.natLocked && f0.btn.look === 'false', f0);
    await F.screenshot({ path: path.join(SHOTS, 'desktop-free-slap.png') });
    await key(F, 'KeyV');
    const f1 = await info(F);
    check('free: V opens the full version panel instead; still Slap mode, no nature sticker, no nature sound', f1.paywall && f1.mode === 'slap' && !f1.nature && !f1.selNat && !f1.amb.playing && f1.hud === 'Slap mode · V', f1);
    await F.screenshot({ path: path.join(SHOTS, 'desktop-free-v-paywall.png') });
    await F.evaluate(() => window.klibb.fullUi().close());
    await F.click('#mode-nature'); await sleep(300);
    const f2 = await info(F);
    check('free: the panel\'s 🌿 Nature mode button also opens the panel', f2.paywall && !f2.nature && !f2.amb.playing, f2);
    await F.evaluate(() => window.klibb.fullUi().close());
    await key(F, 'KeyG');
    const f3 = await info(F);
    check('free: G = Look mode ("Look mode · G"; Look mode used to be V)', f3.mode === 'view' && f3.hud === 'Look mode · G' && f3.btn.look === 'true', f3);
    await key(F, 'KeyG');
    check('free: G again = Slap mode', (await info(F)).mode === 'slap');
    await fctx.close();

    // ---- full version (dev unlock), desktop ----
    const uctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await uctx.addInitScript(() => localStorage.setItem('klibb.devUnlock', '1'));
    const U = await uctx.newPage(); U.on('pageerror', (e) => errors.push(e.message));
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    await U.goto(`${S.base}/?room=${made.room.id}`); await ready(U, true);
    await U.mouse.click(900, 200); await sleep(300); await U.evaluate(() => window.klibb.controls.unlock?.());
    const u0 = await info(U);
    check('full: starts in Slap mode, a normal sticker, no nature sound; 🌿 button not locked', u0.mode === 'slap' && !u0.nature && !u0.selNat && !u0.amb.playing && !u0.btn.natLocked, u0);
    await key(U, 'KeyV', 2500);
    const u1 = await info(U);
    check('full: V → 🌿 Nature mode ("🌿 Nature mode · V"): a nature sticker held, the Nature wheel active', u1.mode === 'slap' && u1.nature && u1.selNat && u1.act === 'nature' && u1.hud === '🌿 Nature mode · V' && u1.body && u1.btn.nature === 'true' && u1.btn.slap === 'false', u1);
    check('…the nature ambience plays (procedural, audible: rms > 0, the audio context running)', u1.amb.playing && u1.amb.source === 'procedural' && u1.amb.rms > 0.001 && u1.ctx === 'running', { amb: u1.amb, ctx: u1.ctx });
    await sleep(6000);
    const u1b = await info(U);
    check('…and keeps playing (looping: birds now and then, still audible after 8 s)', u1b.nature && u1b.amb.playing && u1b.amb.birds >= 1 && u1b.amb.rms > 0.001, u1b.amb);
    await U.screenshot({ path: path.join(SHOTS, 'desktop-full-nature-mode.png') });
    // slap in Nature mode: a nature sticker, 4 m cap still
    const st = await U.evaluate(async () => { const k = window.klibb; k.moveTo(0, 0); k.look(0, 0.12); k.setSize(900); const s = await k.stampAt(0, 0); return s && { imageId: s.imageId, size: s.size }; });
    check('full: a slap in Nature mode is the nature sticker (nature rules: ≤ 4 m)', st && st.imageId === u1.sel && st.size <= 4.0001, st);
    await key(U, 'KeyV', 1200);
    const u2 = await info(U);
    check('full: V again → Slap mode, back on the sticker I had (not a nature one), the ambience stops', u2.mode === 'slap' && !u2.nature && u2.sel === u0.sel && !u2.selNat && !u2.amb.playing && u2.hud === 'Slap mode · V' && !u2.body, u2);
    await key(U, 'KeyV', 800);
    const u3 = await info(U);
    check('full: V → Nature mode again, the same nature sticker as before, sound back on', u3.nature && u3.sel === u1.sel && u3.amb.playing, u3);
    await key(U, 'KeyG', 600);
    const u4 = await info(U);
    check('full: G (Look mode) from Nature mode: just looking, the ambience stops', u4.mode === 'view' && !u4.nature && !u4.amb.playing && u4.hud === 'Look mode · G', u4);
    await key(U, 'KeyV', 600);
    const u5 = await info(U);
    check('full: V from Look mode = back to slapping, on the wheel I was on (Nature, sound on)', u5.mode === 'slap' && u5.nature && u5.amb.playing, u5);
    await key(U, 'KeyM', 600);
    const u6 = await info(U);
    await key(U, 'KeyM', 600);
    const u7 = await info(U);
    check('full: M (sounds off) silences the nature ambience, M again brings it back (still Nature mode)', u6.nature && !u6.amb.playing && u7.nature && u7.amb.playing, { u6: u6.amb, u7: u7.amb });
    // the wheels switch the mode too
    await U.evaluate(() => { const b = [...document.querySelectorAll('#strip-row .strip-th')].find((x) => x.style.display !== 'none' && Math.abs(+x.dataset.d) < 0.01); b.click(); }); await sleep(800);
    const u8 = await info(U);
    check('full: picking from the sticker wheel = Slap mode (ambience off)', !u8.nature && !u8.selNat && !u8.amb.playing && u8.hud === 'Slap mode · V', u8);
    await U.evaluate(() => { const b = [...document.querySelectorAll('#nature-row .strip-th')].find((x) => x.style.display !== 'none' && Math.abs(+x.dataset.d - 1) < 0.01); b.click(); }); await sleep(800);
    const u9 = await info(U);
    check('full: picking from the Nature wheel = Nature mode (ambience on)', u9.nature && u9.selNat && u9.amb.playing, u9);
    await U.click('#mode-slap'); await sleep(500);
    const u10 = await info(U);
    await U.click('#mode-nature'); await sleep(500);
    const u11 = await info(U);
    check('full: the panel buttons Slap mode / 🌿 Nature mode switch too', !u10.nature && !u10.amb.playing && u10.btn.slap === 'true' && u11.nature && u11.amb.playing && u11.btn.nature === 'true', { u10: u10.btn, u11: u11.btn });
    await U.screenshot({ path: path.join(SHOTS, 'desktop-full-panel-nature.png') });
    await U.click('#mode-look'); await sleep(500);
    const u12 = await info(U);
    check('full: the panel\'s Look mode button still works (Look mode, ambience off)', u12.mode === 'view' && !u12.amb.playing && u12.btn.look === 'true', u12);
    await U.click('#mode-slap'); await sleep(400);
    await U.screenshot({ path: path.join(SHOTS, 'desktop-full-slap-mode.png') });
    await uctx.close();

    // ---- phone ----
    for (const full of [false, true]) {
      const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      if (full) await mctx.addInitScript(() => localStorage.setItem('klibb.devUnlock', '1'));
      const M = await mctx.newPage(); M.on('pageerror', (e) => errors.push(e.message));
      await M.goto(S.base + '/'); await ready(M, full);
      const m1 = await info(M);
      check(`phone (${full ? 'full' : 'free'}): starts in Slap mode, no nature sound`, m1.mode === 'slap' && !m1.nature && !m1.amb.playing, m1);
      await M.evaluate(() => { document.body.classList.add('wheel-up'); window.klibb.wheelApi.render(); window.klibb.natureWheelApi.render(); });
      await sleep(500);
      if (full) {
        await M.evaluate(() => { const b = [...document.querySelectorAll('#nature-row .strip-th')].find((x) => x.style.display !== 'none' && Math.abs(+x.dataset.d) < 0.01); b.click(); });
        await sleep(900);
        const m2 = await info(M);
        check('phone (full): tapping the Nature wheel = Nature mode with the nature sound', m2.nature && m2.selNat && m2.amb.playing && m2.amb.rms > 0.001, m2);
        await M.evaluate(() => document.body.classList.add('wheel-up'));
      } else {
        const m2 = await info(M);
        check('phone (free): no Nature mode, no nature sound', !m2.nature && !m2.amb.playing, m2);
      }
      await M.screenshot({ path: path.join(SHOTS, `mobile-${full ? 'full-nature-mode' : 'free'}.png`) });
      await mctx.close();
    }
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  finally {
    await browser.close(); S.child.kill(); fs.rmSync(S.dir, { recursive: true, force: true });
    console.log(`\nNature mode e2e: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();

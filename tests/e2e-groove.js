// E2E (short): the footstep groove. Own server (port 8846, normal app). A = the room's creator with
// the full version, B = a free visitor. The slider and [ / ] change the scale for A, it syncs to B,
// B cannot change it (no UI, keys do nothing), and the footsteps of a walking avatar land on the
// shared grid (shared/groove.mjs) – the same ticks and times in A's and B's browser. At the fast end
// the steps become one buzz voice.
const { chromium } = require('playwright');
const { startServer } = require('./demo-helpers');

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 600) : '')); } };
const KEY = 'groove-e2e-full-key';

(async () => {
  const G = await import('../shared/groove.mjs');
  const S = await startServer(8846, { DEMO_PROFILE: '0', DEV_UNLOCK: '0', ADMIN_TOKEN: 'groove-e2e-admin', FULL_ACCESS_KEYS: KEY });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  console.log(`Groove (${S.base})`);
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const R = made.room.id;
    const open = async (init) => {
      const ctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
      if (init) await ctx.addInitScript(init, { R, roomKey: made.roomKey, key: KEY });
      const p = await ctx.newPage(); p.errors = []; p.on('pageerror', (e) => p.errors.push(e.message));
      await p.goto(`${S.base}/?room=${R}`);
      await p.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.net.id, null, { timeout: 30000 });
      return p;
    };
    const A = await open(({ R, roomKey, key }) => { localStorage.setItem('klibb.roomKeys', JSON.stringify({ [R]: roomKey })); localStorage.setItem('klibb.unlock', key); localStorage.setItem('klibb.artist', 'A'); });
    const B = await open(() => { localStorage.setItem('klibb.artist', 'B'); });
    await A.evaluate(() => window.klibb.entitlementsReady());
    await A.waitForFunction(() => window.klibb.groove().canChange, null, { timeout: 10000 }).catch(() => {});
    const gA = () => A.evaluate(() => window.klibb.groove()), gB = () => B.evaluate(() => window.klibb.groove());
    let a = await gA(), b = await gB();
    check('A (creator + full version) may change it, the Groove row is shown; B (free) sees none of it', a.canChange && !a.ui.hidden && !b.canChange && b.ui.hidden, { a: a.ui, b: b.ui });
    check('both start at the default 1.0× with no readout chip', a.scale === 1 && b.scale === 1 && b.ui.chip === '' && a.ui.value.startsWith('1.00×'), { a: a.ui, b: b.ui });

    // ---------- Slider ----------
    await A.evaluate(() => { const s = document.getElementById('groove-scale'); s.value = '600'; s.dispatchEvent(new Event('input', { bubbles: true })); });
    const want = G.sliderToScale(600);
    a = await gA();
    check(`the slider changes A's scale right away (600 → ${want}×)`, a.scale === want, a.scale);
    await B.waitForFunction((w) => window.klibb.groove().scale === w, want, { timeout: 5000 }).catch(() => {});
    b = await gB();
    check('…and it syncs to B (same scale, same phase anchor as the server)', b.scale === want && b.at > 0, { b: b.scale, at: b.at });
    check('B gets the tiny calm readout chip', b.ui.chip === `Groove ${G.grooveLabel(want).scale}`, b.ui.chip);

    // ---------- Keys ----------
    await A.keyboard.press('BracketRight');
    const k1 = G.stepScale(want, 1);
    await A.keyboard.down('Shift'); await A.keyboard.press('BracketLeft'); await A.keyboard.up('Shift');
    const k2 = G.stepScale(k1, -1, true);
    a = await gA();
    check(`] = a quarter octave looser, Shift+[ = an octave tighter (${want} → ${k1} → ${k2})`, a.scale === k2, a.scale);
    await B.waitForFunction((w) => window.klibb.groove().scale === w, k2, { timeout: 5000 }).catch(() => {});
    b = await gB();
    check('the keys sync to B too', b.scale === k2, b.scale);
    await B.keyboard.press('BracketRight'); await B.waitForTimeout(400);
    check('B pressing ] changes nothing (not theirs to change, no nagging)', (await gB()).scale === k2 && (await gA()).scale === k2);
    const srv = await (await fetch(`${S.base}/api/rooms/${R}/stamps`)).json();
    check('saved with the room', srv.info.groove && srv.info.groove.scale === k2, srv.info.groove);
    // settle A and B on the server's state
    await A.waitForFunction((w) => window.klibb.groove().scale === w, k2, { timeout: 3000 }).catch(() => {});
    await B.waitForTimeout(300);

    // ---------- Footsteps land on the grid ----------
    const walk = (p, ms, x0, z0) => p.evaluate(({ ms, x0, z0 }) => new Promise((done) => {
      const k = window.klibb; k.moveTo(x0, z0); const t0 = performance.now(); let last = t0;
      const step = (now) => { const dt = (now - last) / 1000; last = now; const c = k.camera.position; c.x += 2.2 * dt * (Math.floor((now - t0) / 1200) % 2 ? -1 : 1); if (now - t0 < ms) requestAnimationFrame(step); else done(); };
      requestAnimationFrame(step);
    }), { ms, x0, z0 });
    const t0 = Date.now();
    await Promise.all([walk(A, 2600, -1.5, 1), walk(B, 2600, -1.5, -1)]);
    await A.waitForTimeout(400);
    a = await gA(); b = await gB();
    const aId = await A.evaluate(() => window.klibb.net.id), bId = await B.evaluate(() => window.klibb.net.id);
    const slotA = await A.evaluate(() => window.klibb.mySlot()), slotB = await B.evaluate(() => window.klibb.mySlot());
    const onGrid = (e, g) => G.eventsBetween(g, e.slot, e.t - 0.5, e.t + 0.5).some((x) => x.tick === e.tick && Math.abs(x.t - e.t) < 0.2);
    const mineA = a.log.filter((e) => e.id === 'me' && e.t >= t0 - 200), mineB = b.log.filter((e) => e.id === 'me' && e.t >= t0 - 200);
    const aFromB = b.log.filter((e) => e.id === aId && e.t >= t0 - 200), bFromA = a.log.filter((e) => e.id === bId && e.t >= t0 - 200);
    const st = { scale: a.scale, at: a.at, phase: a.phase };
    check(`A's own steps while walking land on the shared grid (${mineA.length} steps, slot ${slotA})`, mineA.length >= 3 && mineA.every((e) => onGrid(e, st) && e.slot === slotA), mineA.slice(0, 4));
    check(`B's own steps too, in its own slot (${mineB.length} steps, slot ${slotB})`, mineB.length >= 3 && slotA !== slotB && mineB.every((e) => onGrid(e, st) && e.slot === slotB), mineB.slice(0, 4));
    const ticksA = new Set(mineA.map((e) => e.tick)), ticksB = new Set(mineB.map((e) => e.tick));
    check('they interlock: A and B never share a tick', [...ticksA].every((t) => !ticksB.has(t)), { A: [...ticksA], B: [...ticksB] });
    const shared = aFromB.filter((e) => mineA.some((m) => m.n === e.n && m.tick === e.tick && Math.abs(m.t - e.t) < 0.5));
    check(`B hears A's steps on the same pulses at the same times (${shared.length} of ${aFromB.length} match A's own)`, aFromB.length >= 2 && shared.length >= Math.ceil(aFromB.length * 0.7) && aFromB.every((e) => onGrid(e, st)), { aFromB: aFromB.slice(0, 3), mineA: mineA.slice(0, 3) });
    check('and A hears B on the grid', bFromA.length >= 2 && bFromA.every((e) => onGrid(e, st) && e.slot === slotB), bFromA.length);
    const mineNow = (g) => g.log.filter((e) => e.id === 'me').length;
    const still = mineNow(await gA()); await A.waitForTimeout(500);
    const after = await gA();
    check('standing still: no steps', mineNow(after) === still, after.tracks);

    // ---------- The fast end: a buzz ----------
    await A.evaluate(() => window.klibb.setGrooveScale(1 / 64));
    const audio = await A.evaluate(() => window.klibb.sound.ctx ? window.klibb.sound.ctx.state : 'none');
    const buzz = A.evaluate(() => new Promise((done) => {
      const k = window.klibb; let max = 0; k.moveTo(-1.5, 1); const t0 = performance.now(); let last = t0;
      const step = (now) => { const dt = (now - last) / 1000; last = now; k.camera.position.x += 2.2 * dt; max = Math.max(max, k.groove().buzzing); if (now - t0 < 1200) requestAnimationFrame(step); else done(max); };
      requestAnimationFrame(step);
    }));
    const maxBuzz = await buzz;
    if (audio === 'running') check('at 1/64× the walking steps become one sustained buzz voice (no flood of one-shot voices)', maxBuzz === 1, { maxBuzz, audio });
    else console.log(`  · (buzz check skipped: AudioContext ${audio})`);
    await A.waitForTimeout(800);
    const ended = await gA();
    check('stopping ends the buzz', ended.buzzing === 0, ended.tracks);
    check('no page errors', !A.errors.length && !B.errors.length, [...A.errors, ...B.errors]);
  } catch (e) { fail++; console.log('  ✗ crashed: ' + (e && e.stack || e)); }
  finally { await browser.close(); S.child.kill(); }
  console.log(`\nGroove e2e: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

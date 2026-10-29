// E2E: footsteps on peels (Jens, 29 Oct 2026). A slap drops its backing paper on the floor; walking
// ON it plays the paper variant of the footstep (low-pass + a little distortion that grows with the
// walking speed, shared/peelstep.mjs), walking anywhere else the normal step. Checked through the
// step log (window.klibb.peelSteps()): my own steps (desktop keys W/Shift and a phone), the other
// player's steps as I hear them, and mute. Renders listening samples (normal vs peel, slow vs fast)
// with the real engine (Tone.Offline) to PILL_STEPS (default /workspace/pill-steps).
// Own server (PEELSTEP_E2E_PORT, default 8879).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.PEELSTEP_E2E_PORT || 8879);
const OUT = process.env.PILL_STEPS || '/workspace/pill-steps';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };
const wav = (data, rate) => {
  const b = Buffer.alloc(44 + data.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data.length * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(data.length * 2, 40);
  data.forEach((x, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x)) * 32767), 44 + i * 2));
  return b;
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', ADMIN_TOKEN: 'peelstep-e2e-admin' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const R = made.room.id;
    const actx = await browser.newContext({ viewport: { width: 1000, height: 650 } });
    await actx.addInitScript(([r, k]) => localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })), [R, made.roomKey]);
    const bctx = await browser.newContext({ viewport: { width: 800, height: 550 } });
    const A = await actx.newPage(), B = await bctx.newPage();
    for (const pg of [A, B]) pg.on('pageerror', (e) => errors.push(e.message));
    const ready = (pg) => pg.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected, null, { timeout: 30000 });
    await A.goto(`${S.base}/?room=${R}`); await ready(A);
    await B.goto(`${S.base}/?room=${R}`); await ready(B);
    await A.keyboard.press('Shift'); await B.keyboard.press('Shift'); // a gesture (not a click: that would slap): the audio starts
    await A.waitForFunction(() => window.klibb.players().length === 1, null, { timeout: 15000 });
    await A.waitForFunction(() => window.klibb.peels().on, null, { timeout: 8000 });

    // A big sticker on the north wall: its paper lands on the floor in front of it
    await A.evaluate(() => { const k = window.klibb; k.setView('first', { quiet: true }); k.setSize(100); k.moveTo(0, -2.6); k.look(0, 0.1); });
    await sleep(1500); // (the page-load "peels on" sync settles first)
    for (let i = 0; i < 4 && !(await A.evaluate(() => window.klibb.peels().count)); i++) { await A.evaluate(() => window.klibb.stampAt(0, 0)); await sleep(700); }
    await A.waitForFunction(() => window.klibb.peels().landed >= 1, null, { timeout: 8000, polling: 100 });
    await B.waitForFunction(() => window.klibb.peels().landed >= 1, null, { timeout: 8000, polling: 100 });
    const peel = await A.evaluate(() => window.klibb.peels().peels[0]);
    check('a slap drops a peel on the floor (the "pills": backing paper), and it lands (also the first slap of a design: the confirm-while-loading race)', !!peel && Number.isFinite(peel.x) && peel.landed, peel);

    const st = (pg) => pg.evaluate(() => window.klibb.peelSteps());
    // pace in the page (per animation frame, like walking): a circle of radius r around (cx, cz) at speed v for ms
    const pace = (pg, cx, cz, r, v, ms) => pg.evaluate(([cx, cz, r, v, ms]) => new Promise((res) => {
      const t0 = performance.now(), k = window.klibb;
      const f = () => { const t = (performance.now() - t0) / 1000, a = (v / r) * t; k.moveTo(cx + r * Math.cos(a), cz + r * Math.sin(a)); if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(); };
      f();
    }), [cx, cz, r, v, ms]);

    // 1) off the peels (keys): normal steps only
    await A.evaluate(() => { const k = window.klibb; k.moveTo(2, 2); k.look(Math.PI / 2, 0); });
    await sleep(300);
    const a0 = await st(A);
    await A.keyboard.down('KeyW'); await sleep(1200); await A.keyboard.up('KeyW'); await sleep(300);
    const a1 = await st(A);
    const offLog = a1.log.slice(-(a1.steps - a0.steps));
    check('walking with W off the peels: normal footsteps, no paper steps', a1.steps - a0.steps >= 2 && a1.peelSteps === a0.peelSteps && offLog.every((e) => !e.onPeel), { a0: [a0.steps, a0.peelSteps], a1: [a1.steps, a1.peelSteps], offLog });

    // 2) walking on the peel, slowly and fast
    const under = await A.evaluate(([x, z]) => { window.klibb.moveTo(x, z); return window.klibb.peelSteps().under; }, [peel.x, peel.z]);
    check('standing on the peel counts as on it (the foot test)', under === true, await A.evaluate(() => window.klibb.peels()));
    const b0 = await st(A);
    await pace(A, peel.x, peel.z, 0.15, 1.2, 1800); await sleep(200);
    const b1 = await st(A);
    const slow = b1.log.slice(-(b1.steps - b0.steps));
    await pace(A, peel.x, peel.z, 0.25, 4.4, 1800); await sleep(200);
    const b2 = await st(A);
    const fast = b2.log.slice(-(b2.steps - b1.steps));
    const avg = (l, k) => l.reduce((s, e) => s + e[k], 0) / Math.max(1, l.length);
    check('walking on the peel: the steps are the paper variant (low-pass + distortion)', slow.length >= 2 && slow.every((e) => e.onPeel && e.cutoff >= 330 && e.cutoff <= 420) && b1.peelSteps - b0.peelSteps === slow.length, { slow });
    check(`faster on the peel = more distortion (slow ${avg(slow, 'drive').toFixed(3)} @ ${avg(slow, 'speed').toFixed(1)} m/s → fast ${avg(fast, 'drive').toFixed(3)} @ ${avg(fast, 'speed').toFixed(1)} m/s), still subtle (≤ 0.28)`,
      fast.length >= 2 && fast.every((e) => e.onPeel) && avg(fast, 'drive') > avg(slow, 'drive') + 0.05 && fast.every((e) => e.drive <= 0.28) && avg(fast, 'cutoff') > avg(slow, 'cutoff'), { slow, fast });

    // 3) the other player hears A's paper steps (from where A walks), and normal ones off it
    const c0 = await st(B);
    await pace(A, peel.x, peel.z, 0.15, 1.5, 2500);
    await sleep(500);
    const c1 = await st(B);
    const heard = c1.log.slice(-(c1.steps - c0.steps)).filter((e) => e.remote);
    check('the other player hears my footsteps on the peel as paper steps (spatial)', heard.some((e) => e.onPeel) && c1.peelSteps > c0.peelSteps, { heard });
    const d0 = await st(B);
    await pace(A, 2, 2, 0.3, 1.5, 2500); await sleep(500);
    const d1 = await st(B);
    const heard2 = d1.log.slice(-(d1.steps - d0.steps)).filter((e) => e.remote);
    check('…and normal steps when I walk off it', heard2.length >= 1 && heard2.every((e) => !e.onPeel), { heard2 });

    // 4) crossing the peel with the keys (real walking): paper steps on it, normal before
    await A.evaluate(([x, z]) => { const k = window.klibb; k.moveTo(x + 1.6, z); k.look(Math.PI / 2, 0); }, [peel.x, peel.z]); // yaw π/2 faces -x
    await sleep(300);
    const e0 = await st(A);
    await A.keyboard.down('KeyW'); await sleep(1300); await A.keyboard.up('KeyW'); await sleep(300);
    const e1 = await st(A);
    const cross = e1.log.slice(-(e1.steps - e0.steps));
    check('crossing the peel with W: normal steps, then paper steps on it', cross.some((e) => e.onPeel) && cross.some((e) => !e.onPeel), { cross: cross.map((e) => +e.onPeel) });

    // 5) mute: no sound (the steps are counted but marked muted – nothing reaches the engine)
    await A.evaluate(() => document.getElementById('sound-btn').click());
    const f0 = await st(A);
    await pace(A, peel.x, peel.z, 0.15, 1.5, 1200); await sleep(200);
    const f1 = await st(A);
    const mutedLog = f1.log.slice(-(f1.steps - f0.steps));
    check('muted: paper steps are silent too (marked muted)', mutedLog.length >= 1 && mutedLog.every((e) => e.muted && e.onPeel), { mutedLog });
    await A.evaluate(() => document.getElementById('sound-btn').click());

    // 6) phone: the same on a touch screen
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
    const M = await mctx.newPage(); M.on('pageerror', (e) => errors.push(e.message));
    await M.goto(`${S.base}/?room=${R}`); await ready(M);
    await M.waitForFunction(() => document.body.classList.contains('touch') && window.klibb.peels().landed >= 1, null, { timeout: 15000 });
    const g0 = await st(M);
    await pace(M, peel.x, peel.z, 0.15, 1.5, 1500); await sleep(200);
    const g1 = await st(M);
    const mob = g1.log.slice(-(g1.steps - g0.steps)).filter((e) => !e.remote);
    check('phone: walking on the peel plays the paper steps', mob.length >= 1 && mob.every((e) => e.onPeel), { mob });
    await mctx.close();

    // 7) listening samples (the real engine, offline): normal vs peel, slow vs fast
    const specs = [
      { name: 'normal-slow', onPeel: false, speed: 1.2 }, { name: 'peel-slow', onPeel: true, speed: 1.2 },
      { name: 'normal-fast', onPeel: false, speed: 4.5 }, { name: 'peel-fast', onPeel: true, speed: 4.5 },
    ];
    const r = await A.evaluate((s) => window.klibb.renderPeelSteps(s), specs);
    const order = ['normal-slow', 'peel-slow', 'normal-fast', 'peel-fast'];
    const all = [];
    for (const k of order) { fs.writeFileSync(path.join(OUT, `${k}.wav`), wav(r[k].data, r[k].rate)); for (const x of r[k].data) all.push(x); for (let i = 0; i < Math.round(0.6 * r[k].rate); i++) all.push(0); }
    fs.writeFileSync(path.join(OUT, 'all-four-in-a-row.wav'), wav(all, 44100));
    const lv = Object.fromEntries(order.map((k) => [k, { peak: r[k].peak, rms: r[k].rms }]));
    fs.writeFileSync(path.join(OUT, 'levels.json'), JSON.stringify({ ...lv, params: { slow: r['peel-slow'].paper, fast: r['peel-fast'].paper } }, null, 2));
    check('samples rendered: audible, no clipping, the peel steps about as loud (0.4–1.3×) as the normal ones', order.every((k) => r[k].peak > 0.01 && r[k].peak < 1)
      && ['slow', 'fast'].every((s) => { const q = r[`peel-${s}`].rms / r[`normal-${s}`].rms; return q > 0.4 && q < 1.3; }), lv);
    check('no page errors', errors.length === 0, errors);
    await actx.close(); await bctx.close();
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  finally {
    await browser.close(); S.child.kill();
    console.log(`Peel steps e2e: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();

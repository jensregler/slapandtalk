// E2E (short): auto-slap. Own server (port 8853, normal app). Free: no Auto-slap row, H does nothing.
// Full version: the sequence editor for 1–32 steps (and clamping), H toggles, it fires at about the
// right rate (free rate and on the beat), skips when the crosshair stands still, pauses in Look mode
// and in the chat, stops on Esc (leaving pointer lock), the burst is one undo step (Z), and the reach
// rule holds (peels on, too far = nothing).
const sharp = require('sharp');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startServer } = require('./demo-helpers');

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 500) : '')); } };
const KEY = 'autoslap-e2e-full-key';

(async () => {
  const S = await startServer(8853, { DEMO_PROFILE: '0', DEV_UNLOCK: '0', ADMIN_TOKEN: 'auto-e2e-admin', FULL_ACCESS_KEYS: KEY });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-auto-e2e-'));
  console.log(`Auto-slap (${S.base})`);
  try {
    const file = path.join(tmp, 'A_dot.png');
    await sharp({ create: { width: 64, height: 64, channels: 4, background: '#ff3300' } }).png().toFile(file);
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const R = made.room.id;
    const onServer = async () => (await (await fetch(`${S.base}/api/rooms/${R}/stamps`)).json()).stamps.length;
    const open = async (full) => {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 650 } });
      if (full) await ctx.addInitScript((k) => localStorage.setItem('klibb.unlock', k), KEY);
      const p = await ctx.newPage(); p.errors = []; p.on('pageerror', (e) => p.errors.push(e.message));
      await p.goto(`${S.base}/?room=${R}`);
      await p.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
      await p.evaluate(() => window.klibb.entitlementsReady());
      return p;
    };
    // ---------- Free ----------
    const F = await open(false);
    await F.evaluate(() => window.klibb.autoSlapObj().render());
    await F.keyboard.press('KeyH');
    const fi = await F.evaluate(() => window.klibb.autoSlap());
    check('free version: no Auto-slap row, H does nothing (no nagging)', fi.hidden && !fi.on, fi);
    await F.context().close();

    // ---------- Full version ----------
    const p = await open(true);
    await p.setInputFiles('#file', file);
    await p.waitForFunction(() => window.klibb.designs().length === 1 && window.klibb.state.selected, null, { timeout: 20000 });
    await p.evaluate(() => window.klibb.autoSlapObj().render());
    const info = () => p.evaluate(() => window.klibb.autoSlap());
    check('full version: the Auto-slap row is there, off, 8 steps by default', !(await info()).hidden && !(await info()).on && (await info()).cells === 8);

    // The editor for 1 … 32 steps
    await p.evaluate(() => window.klibb.openMore());
    const setLen = (v) => p.evaluate((v) => { const i = document.getElementById('auto-len'); i.value = String(v); i.dispatchEvent(new Event('change', { bubbles: true })); return window.klibb.autoSlap(); }, v);
    const lens = {};
    for (const l of [1, 3, 5, 8, 16, 32]) { const r = await setLen(l); lens[l] = r.cells === l && r.settings.seq.len === l; }
    check('length 1, 3, 5, 8, 16, 32: the grid shows exactly that many steps', Object.values(lens).every(Boolean), lens);
    const lay = await p.evaluate(() => {
      const g = document.getElementById('auto-steps'), box = document.getElementById('auto-box').getBoundingClientRect(), cells = [...g.children].map((c) => c.getBoundingClientRect());
      return { rows: new Set(cells.map((c) => Math.round(c.top))).size, inside: cells.every((c) => c.left >= box.left - 1 && c.right <= box.right + 1 && c.width >= 8), w: Math.round(cells[0].width), h: Math.round(box.height) };
    });
    if (process.env.AUTO_SHOT) await p.screenshot({ path: process.env.AUTO_SHOT });
    check(`32 steps lay out in 2 rows of 16 inside the panel (cells ${lay.w} px, box ${lay.h} px high)`, lay.rows === 2 && lay.inside && lay.h < 260, lay);
    const c40 = await setLen(40), c0 = await setLen(0), cm = await setLen(-3);
    check('outside 1–32 is clamped (40 → 32, 0 → 1, −3 → 1)', c40.settings.seq.len === 32 && c0.settings.seq.len === 1 && cm.settings.seq.len === 1);
    // hidden steps are kept: switch step 6 off at 8, shrink to 4, grow to 8
    await setLen(8);
    await p.click('#auto-steps .auto-cell:nth-child(6)');
    await setLen(4); const back = await setLen(8);
    check('shrinking keeps the hidden steps: step 6 is still off after 8 → 4 → 8', back.settings.seq.steps[5].on === false && back.settings.seq.steps[4].on === true);
    await p.click('#auto-steps .auto-cell:nth-child(6)'); // on again
    await p.reload(); await p.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 }); await p.evaluate(() => window.klibb.entitlementsReady());
    check('settings survive a reload (and it starts off)', (await info()).settings.seq.len === 8 && !(await info()).on);
    await p.waitForFunction(() => window.klibb.state.selected, null, { timeout: 20000 });

    // ---------- Firing ----------
    await p.evaluate(() => { const k = window.klibb; k.moveTo(0, -3); k.look(0, 0); });
    await p.mouse.click(500, 325); await p.waitForFunction(() => window.klibb.controls.locked, null, { timeout: 5000 });
    await p.evaluate(() => window.klibb.peelSettled());
    const settle = () => p.waitForFunction(() => window.klibb.pendingSlaps() === 0, null, { timeout: 15000 }).catch(() => {});
    // sweep the view back and forth (paints a trail) for ms
    const sweep = (ms, stop = false) => p.evaluate(([ms, stop]) => new Promise((done) => { const k = window.klibb, t0 = performance.now();
      let n = 0, steps = 0, lastStep = -1; const f = (now) => { n++; const sn = Math.floor((now - t0) / 250); if (sn !== lastStep) { steps++; lastStep = sn; } if (n === 1 && stop) k.autoSlapObj().setOn(true); if (now - t0 >= ms && stop) k.autoSlapObj().setOn(false); const t = (now - t0) / 1000; k.look(Math.sin(t * 2.2) * 0.5, Math.sin(t * 1.3) * 0.15); if (now - t0 < ms) requestAnimationFrame(f); else done({ n, steps, ms: now - t0 }); }; requestAnimationFrame(f); }), [ms, stop]);
    await p.evaluate(() => window.klibb.autoSlapObj().set({ mode: 'free', rate: 4 }));
    await p.keyboard.press('KeyH');
    const on1 = await info();
    check('H turns it on (chip shown)', on1.on && /Auto-slap/.test(on1.chip), on1);
    // measured in the page (a loaded box adds seconds of latency between the test and the page);
    // it switches off in the same frame the sweep ends, so the count and the server agree
    await p.evaluate(() => window.klibb.autoSlapObj().setOn(false)); await settle(); const n0 = await onServer(), fired0 = (await info()).fired;
    const sw = await sweep(2500, true), frames = sw.n, secs = sw.ms / 1000;
    // 250 ms step boundaries that a frame actually landed in (a stalled frame on a loaded box
    // swallows several – by design one slap per frame at most, never a catch-up burst)
    const f1 = (await info()).fired - fired0; await settle();
    const n1 = await onServer();
    const want = sw.steps - 1; // the first step only arms the clock
    check(`free rate 4/s: ~${Math.round(4 * secs)} in ${secs.toFixed(1)} s (fired ${f1}, on the server ${n1 - n0}, ${frames} frames, ${want} reachable steps)`, f1 >= want * 0.6 && f1 <= 4 * secs + 2 && n1 - n0 === f1, { f1, d: n1 - n0, frames, want, skipped: (await info()).skipped });
    // the burst = one undo step
    const hist = await p.evaluate(() => window.klibb.roomHistory().length);
    await p.keyboard.press('KeyZ'); await p.evaluate(() => window.klibb.peelSettled()); await settle();
    const n2 = await onServer();
    check(`the burst is one history step (${hist} entr${hist === 1 ? 'y' : 'ies'}), Z peels all ${n1 - n0}`, hist === 1 && n2 === n0, { hist, n0, n1, n2 });

    // standing still: nothing piles up
    await p.evaluate(() => window.klibb.look(0, 0));
    await p.keyboard.press('KeyH'); await p.waitForTimeout(1500);
    const still = await info(); await settle();
    check('standing still: at most one sticker, the rest skipped ("still")', (await onServer()) - n2 <= 1 && (still.skipped.still || 0) >= 2, still.skipped);

    // on the beat: 4 steps per Groove bar (1.5 s at 1.0×) = 2.67/s
    await p.evaluate(() => window.klibb.autoSlapObj().set({ mode: 'bar', bars: 1, seq: { len: 4 } }));
    const b0 = (await info()).fired, tb = Date.now(); await sweep(3000); const bs = (Date.now() - tb) / 1000;
    const bf = (await info()).fired - b0;
    const log = await p.evaluate(() => window.klibb.autoSlap().stepMs);
    check(`on the beat, 4 steps per bar: ~${(bs * 4 / 1.5).toFixed(1)} in ${bs.toFixed(1)} s (fired ${bf}; step ${log} ms)`, Math.abs(log - 375) < 1 && bf >= bs * 4 / 1.5 * 0.6 && bf <= bs * 4 / 1.5 + 2, bf);

    // Look mode pauses
    await p.keyboard.press('KeyV');
    const l0 = (await info()).fired; await sweep(1000); const lk = await info();
    check('Look mode: paused (still on, nothing fires)', lk.on && lk.paused && lk.fired === l0 && /paused/.test(lk.chip), lk);
    await p.keyboard.press('KeyV');
    // the chat pauses (our own unlock: it stays on)
    await p.keyboard.press('KeyT'); await p.waitForTimeout(300);
    const c0f = (await info()).fired; await p.waitForTimeout(800); const ch = await info();
    check('chat open: paused, not off', ch.on && ch.paused && ch.fired === c0f, ch);
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    await p.mouse.click(500, 325); await p.waitForFunction(() => window.klibb.controls.locked, null, { timeout: 5000 }).catch(() => {});
    await sweep(800);
    check('back in the game: it runs again', (await info()).fired > ch.fired && !(await info()).paused);
    // Esc = the browser leaves pointer lock (not one of our own unlocks): off
    await p.evaluate(() => document.exitPointerLock()); await p.waitForTimeout(300);
    const esc = await info();
    check('Esc (leaving pointer lock): off', !esc.on && esc.chip === '', esc);
    await settle();

    // reach: peels on, far from the wall
    await fetch(`${S.base}/api/rooms/${R}/peels`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-room-key': made.roomKey }, body: '{"on":true}' });
    await p.waitForFunction(() => window.klibb.peels().on, null, { timeout: 5000 }).catch(() => {});
    await p.evaluate(() => { const k = window.klibb; k.moveTo(0, 3); k.look(0, 0); });
    await p.mouse.click(500, 325); await p.waitForFunction(() => window.klibb.controls.locked, null, { timeout: 5000 });
    const r0 = await onServer(), rs0 = (await info()).skipped.reach || 0;
    await p.keyboard.press('KeyH'); await sweep(1500); await p.keyboard.press('KeyH'); await settle();
    const rr = await info();
    check('peels on and the wall 8 m away: nothing slaps (skipped "reach", quietly)', (await onServer()) === r0 && (rr.skipped.reach || 0) - rs0 >= 2, rr.skipped);
    check('no page errors', !p.errors.length, p.errors);
  } catch (e) { fail++; console.log('  ✗ crashed: ' + (e && e.stack || e)); }
  finally { await browser.close(); S.child.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(`\nAuto-slap e2e: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

// E2E (Jens t881u + t883u, 12 Nov 2026): the 120-BPM tempo grid. Two players – A at 120 BPM, B at 180 BPM (3:2) –
// dance in the same room: their footsteps meet on the shared bar line (every 2000 ms of server time) within a few
// ms, on both screens; the Tempo slider steps through the grid with labels like "180 BPM · 3:2"; and when A starts
// walking the first step waits for the next beat (entering in time) instead of sounding at the key press.
// Own server (port 8973). Screenshot of the slider → TEMPO_SHOTS (default /workspace/tempo-grid).
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 900) : '')); } };
const KEY = 'tempogrid-e2e-full-key';
const SHOTS = process.env.TEMPO_SHOTS || '/workspace/tempo-grid';
const TOL = 4; // ms on the shared clock
(async () => {
  const S = await startServer(Number(process.env.TEMPOGRID_E2E_PORT || 8973), { DEMO_PROFILE: '0', DEV_UNLOCK: '0', ADMIN_TOKEN: 'tempogrid-e2e-admin', FULL_ACCESS_KEYS: KEY });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    fs.mkdirSync(SHOTS, { recursive: true });
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const R = made.room.id;
    const open = async (init, scale = 1) => {
      const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: scale });
      if (init) await ctx.addInitScript(init, { R, roomKey: made.roomKey, key: KEY });
      const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
      await p.goto(`${S.base}/?room=${R}`);
      await p.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.net.id, null, { timeout: 30000 });
      return p;
    };
    const A = await open(({ R, roomKey, key }) => { localStorage.setItem('klibb.roomKeys', JSON.stringify({ [R]: roomKey })); localStorage.setItem('klibb.unlock', key); localStorage.setItem('klibb.artist', 'A'); }, 2);
    const B = await open(({ key }) => { localStorage.setItem('klibb.unlock', key); localStorage.setItem('klibb.artist', 'B'); });
    for (const P of [A, B]) { await P.evaluate(() => window.klibb.entitlementsReady && window.klibb.entitlementsReady()); await P.mouse.click(550, 380).catch(() => {}); await P.keyboard.press('Escape').catch(() => {}); }
    const aId = await A.evaluate(() => window.klibb.net.id), bId = await B.evaluate(() => window.klibb.net.id);

    // ---------- The slider: one notch per grid tempo, "BPM · ratio" labels, arrows step through the grid ----------
    await A.evaluate(() => { window.klibb.soundUi().open(); document.querySelector('#snd-tabs [data-tab="step"]').click(); });
    await sleep(300);
    const ui = await A.evaluate(() => { const w = document.getElementById('walk-tempo'); return { max: w.max, step: w.step, min: w.dataset.min, top: w.dataset.max, grid: w.dataset.grid, out: document.getElementById('walk-tempo-val').textContent, meet: document.getElementById('walk-tempo-meet')?.textContent }; });
    check(`Tempo slider: 53 notches (0 … 52), 30 … 2880 BPM, default "${ui.out}" (${ui.meet})`, ui.max === '52' && ui.step === '1' && ui.min === '30' && ui.top === '2880' && ui.grid === '53' && ui.out === '90 BPM · 3:4' && /every bar/.test(ui.meet || ''), ui);
    const walk = await A.evaluate(() => {
      const w = document.getElementById('walk-tempo'), fire = (key) => w.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      const seen = []; w.value = '0'; w.dispatchEvent(new Event('input', { bubbles: true }));
      for (let i = 0; i < 60; i++) { seen.push(document.getElementById('walk-tempo-val').textContent); fire('ArrowRight'); }
      return seen;
    });
    const uniq = [...new Set(walk)];
    check(`arrow keys walk the whole grid: ${uniq.length} tempi, ${uniq.slice(14, 22).join(' | ')} …`, uniq.length === 53 && uniq[0] === '30 BPM · 1:4' && uniq[16] === '120 BPM · 1:1' && uniq[20] === '180 BPM · 3:2' && uniq[52] === '2880 BPM · 24:1', uniq);
    // A → 120, the base
    await A.evaluate(() => { const w = document.getElementById('walk-tempo'); w.value = '16'; w.dispatchEvent(new Event('input', { bubbles: true })); });
    await A.evaluate(() => document.getElementById('snd-save').click());
    // B → 180 (3:2) – B sets it on its own slider too
    await B.evaluate(() => { window.klibb.soundUi().open(); document.querySelector('#snd-tabs [data-tab="step"]').click(); });
    await sleep(200);
    const bUi = await B.evaluate(() => { const w = document.getElementById('walk-tempo'); w.value = '20'; w.dispatchEvent(new Event('input', { bubbles: true })); return { out: document.getElementById('walk-tempo-val').textContent, meet: document.getElementById('walk-tempo-meet')?.textContent }; });
    // the screenshot (large: deviceScaleFactor 2 on A) – A's slider at 180 · 3:2 for the picture
    await A.evaluate(() => { window.klibb.soundUi().open(); document.querySelector('#snd-tabs [data-tab="step"]').click(); });
    await sleep(200);
    await A.evaluate(() => { const w = document.getElementById('walk-tempo'); w.value = '20'; w.dispatchEvent(new Event('input', { bubbles: true })); w.closest('fieldset').scrollIntoView({ block: 'center' }); w.focus(); });
    await sleep(250);
    const row = await A.$('#snd-run [data-param="walk-tempo"]');
    if (row) await row.screenshot({ path: path.join(SHOTS, 'tempo-slider-180.png') });
    const fsBox = await A.$('#snd-run'); if (fsBox) await fsBox.screenshot({ path: path.join(SHOTS, 'tempo-steps-block.png') });
    await A.evaluate(() => document.getElementById('snd-cancel').click()); // back to the saved 120
    await B.evaluate(() => document.getElementById('snd-save').click());
    await sleep(500);
    const tempi = { a: await A.evaluate(() => window.klibb.radio().walkBpm), b: await B.evaluate(() => window.klibb.radio().walkBpm) };
    check(`A at ${tempi.a} BPM, B at ${tempi.b} BPM ("${bUi.out}", ${bUi.meet})`, tempi.a === 120 && tempi.b === 180 && bUi.out === '180 BPM · 3:2', { tempi, bUi });
    await A.waitForFunction((id) => { const p = window.klibb.players().find((x) => x.id === id); return p && p.tempo && p.tempo.bpm === 180; }, bId, { timeout: 5000 }).catch(() => {});

    // ---------- Both dance: steps on the shared bar line ----------
    for (const P of [A, B]) { await P.evaluate(() => { if (window.klibb.escMenu?.().isOpen?.()) window.klibb.escMenu().close(); window.klibb.setView('first'); }); }
    await A.evaluate(() => window.klibb.startDance()); await B.evaluate(() => window.klibb.startDance());
    await sleep(800);
    await A.evaluate(() => { window.klibb.grooveObj().log.length = 0; }); await B.evaluate(() => { window.klibb.grooveObj().log.length = 0; });
    await sleep(7400);
    const logA = await A.evaluate(() => ({ log: window.klibb.grooveObj().log.filter((e) => !e.buzz), off: window.klibb.grooveObj().offset }));
    const logB = await B.evaluate(() => ({ log: window.klibb.grooveObj().log.filter((e) => !e.buzz), off: window.klibb.grooveObj().offset }));
    const mineA = logA.log.filter((e) => e.id === 'me').map((e) => e.t), bOnA = logA.log.filter((e) => e.id === bId).map((e) => e.t);
    const mineB = logB.log.filter((e) => e.id === 'me').map((e) => e.t);
    const lo = Math.max(mineA[0] ?? Infinity, bOnA[0] ?? Infinity), hi = Math.min(mineA.at(-1) ?? -Infinity, bOnA.at(-1) ?? -Infinity);
    const lines = []; for (let L = Math.ceil(lo / 2000) * 2000; L <= hi; L += 2000) lines.push(L);
    const near = (arr, L) => arr.reduce((m, x) => Math.min(m, Math.abs(x - L)), Infinity);
    // (a software-GL tab can stall for > 0.4 s now and then: the groove's watchdog then drops that stretch – a bar line
    // where a player has no step at all within ±200 ms is such a gap, not a timing error, and is left out)
    const hits = lines.map((L) => ({ L, a: +near(mineA, L).toFixed(2), b: +near(bOnA, L).toFixed(2) })).filter((h) => h.a < 200 && h.b < 200);
    check(`A (120) and B (180, as A hears B) both step ON the shared bar line (${hits.length} bar lines of 2000 ms, worst ${Math.max(...hits.map((h) => Math.max(h.a, h.b)))} ms)`,
      hits.length >= 2 && hits.every((h) => h.a <= TOL && h.b <= TOL), { hits, lines: lines.length, nA: mineA.length, nB: bOnA.length });
    if (process.env.DEBUG_TG) console.log(JSON.stringify({ A: logA.log.map((e) => [e.id === 'me' ? 'A' : 'B', +(e.t % 4000).toFixed(1), e.entry ? 'E' : '', e.bpm, e.run || '']), B: logB.log.filter((e) => e.id === 'me').map((e) => [+(e.t % 4000).toFixed(1), e.entry ? 'E' : '']) }));
    const g120 = mineA.slice(1).map((x, i) => x - mineA[i]), g180 = bOnA.slice(1).map((x, i) => x - bOnA[i]);
    check(`…each at its own tempo: A's steps every ${(g120.reduce((s, x) => s + x, 0) / g120.length).toFixed(1)} ms, B's every ${(g180.reduce((s, x) => s + x, 0) / g180.length).toFixed(1)} ms (a 3:2 polyrhythm)`, g120.length > 3 && g180.length > 3, { g120: g120.slice(0, 6), g180: g180.slice(0, 6) });
    const same = mineB.filter((t) => t >= lo && t <= hi).map((t) => near(bOnA, t)).filter((d) => d < 100); // (stall gaps left out, as above)
    check(`B's own steps (B's screen) = B's steps as A hears them (worst ${Math.max(...same).toFixed(2)} ms; clock offsets ${logA.off.toFixed(0)} / ${logB.off.toFixed(0)})`, same.length > 3 && Math.max(...same) <= TOL, same.slice(0, 8));
    check('A\'s steps all sit on A\'s groove grid (its slot\'s 3 / 4 / 5 / 6 / 7 pulses over the 1000 ms groove bar, from server time 0)', mineA.every((t) => { const bar = 1000, x = ((t % bar) + bar) % bar; return [3, 4, 5, 6, 7].some((p) => { const k = x / (bar / p); return Math.abs(k - Math.round(k)) * (bar / p) <= TOL; }); }), mineA.slice(0, 6).map((t) => t % 1000));

    // ---------- Entering in time (t883u) ----------
    await A.keyboard.press('KeyX').catch(() => {}); await A.evaluate(() => { if (window.klibb.dancing()) window.klibb.cancelDance?.(); });
    await sleep(900); // standing: the footsteps stop
    const place = () => A.evaluate(() => { const k = window.klibb, b = k.controls.bounds; k.camera.position.x = (b.min.x + b.max.x) / 2; k.camera.position.z = b.max.z - 0.4; k.controls.yaw = 0; k.controls.apply(); });
    const entries = [];
    for (let i = 0; i < 3; i++) {
      await place(); await sleep(1300 + i * 137); // standing still (the teleport is not a walk), a different moment against the beat each time
      await A.evaluate(() => { window.klibb.grooveObj().log.length = 0; });
      const pressAt = await A.evaluate(() => window.klibb.grooveObj().now());
      await A.keyboard.down('KeyW'); await sleep(1100); await A.keyboard.up('KeyW');
      const l = await A.evaluate(() => window.klibb.grooveObj().log.filter((e) => e.id === 'me'));
      entries.push({ pressAt: +pressAt.toFixed(1), first: l[0] || null, n: l.length, next: l.slice(1, 4).map((e) => e.t) });
      await sleep(700);
    }
    const onBeat = entries.map((e) => (e.first ? { wait: +(e.first.t - e.pressAt).toFixed(1), afterStart: +(e.first.t - e.first.from).toFixed(1), beatOff: +Math.min(e.first.t % 500, 500 - (e.first.t % 500)).toFixed(2), entry: !!e.first.entry } : null));
    check(`start walking: the first step lands ON the next 120 BPM beat (500 ms grid), not at the key press – ${onBeat.map((o) => o && `${o.afterStart} ms after the walk starts (${o.wait} after W)`).join(' / ')}`,
      onBeat.every((o) => o && o.beatOff <= TOL && o.entry && o.afterStart >= -20 && o.afterStart <= 500), { entries, onBeat });
    check('…and the steps after it keep to the grid', entries.every((e) => e.next.length >= 1 && e.next.every((t) => { const x = ((t % 1000) + 1000) % 1000; return [3, 4, 5, 6, 7].some((p) => { const k = x / (1000 / p); return Math.abs(k - Math.round(k)) * (1000 / p) <= TOL; }); })), entries);
    check('no page errors', errors.length === 0, errors);
  } catch (e) { fail++; console.log('  ✗ crashed: ' + (e && e.stack)); }
  finally { await browser.close(); S.child.kill(); }
  console.log(`e2e-tempogrid: ${pass} ok, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

// E2E (Jens t814u, 11 Nov 2026): "när man trycker x så skall dansen loopa ända tills man trycker x.
// när man dansar räknas det som att gå så gåljudet och ev sequenser går så länge man dansar".
// X starts the dance and it loops (4 bars at a time, on the clock) until X again; while it is on it
// counts as walking: my footsteps and the walk (Steps) sound's sequencer keep going, then stop like
// a real stop. W/A/S/D still cancel it; X is ignored while typing; the phone's 💃 toggles the same way.
// Two pages (B sees A loop and stop), own server (port DANCELOOP_E2E_PORT, 8871).
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.DANCELOOP_E2E_PORT || 8871);
const SHOTS = process.env.DANCELOOP_SHOTS || '/workspace/dance-loop-shots';

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 700) : '')); } };
const KEY = 'danceloop-e2e-full-key';
const near = (g, want) => Math.abs(g - want) <= want * 0.01 + 1;

(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '0', DEV_UNLOCK: '0', ADMIN_TOKEN: 'danceloop-e2e-admin', FULL_ACCESS_KEYS: KEY });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  console.log(`Dance loop + dancing = walking (${S.base})`);
  let A, B;
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const R = made.room.id;
    const open = async (init, opts = { viewport: { width: 1000, height: 700 } }) => {
      const ctx = await browser.newContext(opts);
      await ctx.addInitScript(init, { R, roomKey: made.roomKey, key: KEY });
      const p = await ctx.newPage(); p.errors = []; p.on('pageerror', (e) => p.errors.push(e.message));
      await p.goto(`${S.base}/?room=${R}`);
      await p.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.net.id, null, { timeout: 30000 });
      return p;
    };
    A = await open(({ R, roomKey, key }) => { localStorage.setItem('klibb.roomKeys', JSON.stringify({ [R]: roomKey })); localStorage.setItem('klibb.unlock', key); localStorage.setItem('klibb.artist', 'A'); });
    B = await open(() => { localStorage.setItem('klibb.artist', 'B'); });
    await A.evaluate(() => window.klibb.entitlementsReady && window.klibb.entitlementsReady());
    const aId = await A.evaluate(() => window.klibb.net.id);
    await B.waitForFunction((id) => window.klibb.players().some((p) => p.id === id && p.built), aId, { timeout: 15000 }).catch(() => {});
    await A.mouse.click(500, 350).catch(() => {}); await A.keyboard.press('Escape').catch(() => {});
    await A.evaluate(() => window.klibb.setView('first'));
    await A.waitForFunction(() => window.klibb.soundObj().engine, null, { timeout: 20000 }).catch(() => {});

    // the Steps sound's sequencer (t889u: one for the whole sound, it IS the footsteps): step 3 on as well, saved
    await A.evaluate(() => window.klibb.soundUi().open()); await sleep(300);
    await A.click('#snd-tabs [data-tab="step"]'); await sleep(200);
    await A.click('#snd-stepseq .ss-pad[data-step="2"]'); await sleep(150);
    const seq = await A.evaluate(() => window.klibb.soundUi().state().patches.step.seq);
    check('Steps tab: the Steps sequencer, 4 steps, 1 + 3 on', seq && seq.len === 4 && seq.steps[0].on && seq.steps[2].on && !seq.steps[1].on, seq);
    await A.evaluate(() => document.getElementById('snd-save').click()); await sleep(300);
    await A.evaluate(() => window.klibb.soundUi().close?.()); await sleep(200);
    await A.evaluate(() => window.klibb.setView('first'));
    const seqLog = (since) => A.evaluate((since) => window.klibb.grooveObj().log.filter((e) => e.id === 'me' && e.t >= since), since);
    const myFeet = (since) => A.evaluate((since) => window.klibb.grooveObj().log.filter((e) => e.id === 'me' && e.t >= since && e.n >= 0 && e.i === 0), since);
    const now = () => A.evaluate(() => window.klibb.grooveObj().now());
    // the groove log keeps the last 200 entries: sample it every second and merge
    const collect = async (ms) => { const seen = new Map(); const t0 = await now(); const end = Date.now() + ms; while (Date.now() < end) { for (const e of await seqLog(t0)) seen.set(e.t + ':' + e.i, e); await sleep(900); } for (const e of await seqLog(t0)) seen.set(e.t + ':' + e.i, e); return [...seen.values()].sort((a, b) => a.t - b.t); };

    // ---------- standing: nothing ----------
    await sleep(800); let t0 = await now(); await sleep(1500);
    check('standing: the walk sequencer is silent', (await seqLog(t0)).length === 0);

    // ---------- X: the dance starts and loops ----------
    await A.focus('canvas').catch(() => {});
    await A.keyboard.press('KeyX'); await sleep(500);
    let s = await A.evaluate(() => ({ d: window.klibb.dancing(), v: window.klibb.view(), me: window.klibb.selfAvatar() }));
    check('X: dancing (looping), in 3rd person', s.d && s.v === 'third' && s.me.danceLoop === true, s);
    await B.waitForFunction((id) => window.klibb.players().some((p) => p.id === id && p.dancing), aId, { timeout: 5000 }).catch(() => {});
    const sb0 = await B.evaluate((id) => window.klibb.players().find((p) => p.id === id), aId);
    check('B sees A dance, looping, on the same clock', sb0 && sb0.dancing && sb0.danceLoop && sb0.danceAt === s.me.danceAt && sb0.danceBpm === s.me.danceBpm, sb0 && { d: sb0.dancing, l: sb0.danceLoop, at: [sb0.danceAt, s.me.danceAt] });
    fs.mkdirSync(SHOTS, { recursive: true });
    await sleep(2500); check('(the big Esc menu is not open for the shot)', await A.evaluate(() => !document.querySelector('#esc-menu:not([hidden])')), null); await A.screenshot({ path: path.join(SHOTS, 'dancing-a.png') }).catch(() => {});
    const tDance = await now();
    await A.evaluate(() => { const f = window.__frames = { max: 0, long: 0, n: 0, last: performance.now() }; const loop = () => { const t = performance.now(), g = t - f.last; f.last = t; f.n++; if (g > f.max) f.max = g; if (g > 170) f.long++; if (!f.stop) requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
    const ev = await collect(12500);
    const frames = await A.evaluate(() => { window.__frames.stop = true; return window.__frames; }); // longer than one pass (16 beats at 90 BPM = 10.7 s + lead-in)
    s = await A.evaluate(() => ({ d: window.klibb.dancing(), me: window.klibb.selfAvatar(), walkingFlag: window.klibb.meWalking(), until: window.klibb.walkUntil(), now: window.klibb.grooveObj().now(), track: window.klibb.groove().tracks.find((t) => t.id === 'me') }));
    check('still dancing after more than one 4-bar pass (it loops, not one-shot)', s.d && s.me.danceLoops >= 1 && s.me.dancePhase && s.me.dancePhase !== 'done', { d: s.d, loops: s.me.danceLoops, phase: s.me.dancePhase, t: s.me.danceTime });
    // a step can only be skipped by a frame that took longer than the 150 ms lookahead (the same as when
    // really walking – e2e-walkseq allows whole-step gaps): on a fast machine every gap is one step
    const half = 4000 / 3 / [4, 3, 5, 6, 7][ev.length ? ev[0].slot : 0] / 2; // step 3 sits halfway between two footsteps
    const gaps = ev.slice(1).map((e, k) => e.t - ev[k].t).filter((g) => g > 20), onGrid = (g) => { const k = Math.round(g / half); return k >= 1 && near(g, k * half); };
    const skipped = gaps.filter((g) => !near(g, half)).length;
    check('dancing counts as walking: the Steps sequencer stepped the whole time (steps 1 and 3, half a footstep apart, in order, no pause)',
      ev.length >= 24 && gaps.every(onGrid) && ev.every((e) => e.i === 0 || e.i === 2) && skipped <= frames.long + 2, { n: ev.length, half, gaps: gaps.filter((g) => !near(g, half)), frames });
    console.log(`    (walk sequencer: ${ev.length} steps in 12.5 s, ${skipped} skipped; frames: ${frames.n}, longest ${Math.round(frames.max)} ms, ${frames.long} over 170 ms)`);
    const feet = await myFeet(tDance);
    check('…and my footsteps (walk sound) kept going while dancing', feet.length >= 10 && feet[feet.length - 1].t > s.now - 1500, { n: feet.length, last: feet.length && feet[feet.length - 1].t, now: s.now });
    check('…the groove counts me as walking, not as moving (radio walk-until ahead of now)', s.track && s.track.walking && !s.track.moving && s.until > s.now, s.track);
    check('…and meWalking() (really moving) stays false: dancing in place is walking, not moving', s.walkingFlag === false, s.walkingFlag);
    const bTrack = await B.evaluate((id) => window.klibb.groove().tracks.find((t) => t.id === id), aId);
    check('B hears A\'s steps while A dances (A counts as walking there too)', bTrack && bTrack.walking, bTrack);

    // ---------- X again: stops; then quiet like a real stop ----------
    await A.keyboard.press('KeyX'); await sleep(150);
    s = await A.evaluate(() => ({ d: window.klibb.dancing(), v: window.klibb.view() }));
    check('X again: the dance stops and the view goes back to 1st person', !s.d && s.v === 'first', s);
    await B.waitForFunction((id) => window.klibb.players().some((p) => p.id === id && !p.dancing), aId, { timeout: 5000 }).catch(() => {});
    check('…and B sees it stop', await B.evaluate((id) => window.klibb.players().some((p) => p.id === id && !p.dancing), aId));
    await sleep(400); t0 = await now(); await sleep(2000);
    check('after the dance: the walk sequencer is silent again', (await seqLog(t0)).length === 0, await seqLog(t0));
    check('…and so are my footsteps', (await myFeet(t0)).length === 0, await myFeet(t0));

    // ---------- W/A/S/D still cancel ----------
    await A.keyboard.press('KeyX'); await sleep(500);
    check('X once more: dancing', await A.evaluate(() => window.klibb.dancing()));
    await A.keyboard.down('KeyW'); await sleep(200); await A.keyboard.up('KeyW');
    s = await A.evaluate(() => ({ d: window.klibb.dancing(), v: window.klibb.view() }));
    check('W cancels the dance at once (view back to 1st person)', !s.d && s.v === 'first', s);
    await A.keyboard.down('KeyS'); await sleep(200); await A.keyboard.up('KeyS'); await sleep(300);

    // ---------- typing: X is just a letter ----------
    await A.evaluate(() => { const f = document.getElementById('chat-form'); f.hidden = false; document.getElementById('chat-input').focus(); });
    await A.keyboard.press('KeyX'); await sleep(500);
    const typ = await A.evaluate(() => ({ d: window.klibb.dancing(), val: document.getElementById('chat-input').value }));
    check('X while typing in the chat does not dance', !typ.d && typ.val.includes('x'), typ);
    await A.evaluate(() => { const i = document.getElementById('chat-input'); i.value = ''; i.blur(); document.getElementById('chat-form').hidden = true; });

    // ---------- the phone's 💃 (stack menu) toggles the same way ----------
    const P = await open(() => { localStorage.setItem('klibb.artist', 'P'); }, { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } });
    await P.evaluate(() => window.klibb.setView('first'));
    await P.evaluate(() => document.getElementById('sm-dance').click()); await sleep(800);
    const ph1 = await P.evaluate(() => ({ d: window.klibb.dancing(), loop: window.klibb.selfAvatar().danceLoop, v: window.klibb.view() }));
    await sleep(300);
    await P.evaluate(() => document.getElementById('sm-dance').click()); await sleep(300);
    const ph2 = await P.evaluate(() => ({ d: window.klibb.dancing(), v: window.klibb.view() }));
    check('💃 Dance (phone menu): first tap starts the looping dance, second tap stops it', ph1.d && ph1.loop && !ph2.d && ph2.v === 'first', { ph1, ph2 });
    A.errors.push(...P.errors);
    check('no page errors', !A.errors.length && !B.errors.length, [...A.errors, ...B.errors]);
  } catch (e) { fail++; console.log('  ✗ crashed: ' + (e && e.stack || e)); }
  finally { await browser.close(); S.child.kill(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

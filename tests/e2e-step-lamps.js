// E2E (Jens t956u): a lamp above every sequencer step, flashing when the step actually
// triggers. Screenshot of one lamp lit → /workspace/step-lamps.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.STEPLAMP_E2E_PORT || 8881);
const SHOTS = process.env.STEPLAMP_SHOTS || '/workspace/step-lamps';

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 900) : '')); } };
const KEY = 'steplamp-e2e-full-key';

(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '0', DEV_UNLOCK: '0', ADMIN_TOKEN: 'steplamp-e2e-admin', FULL_ACCESS_KEYS: KEY });
  const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
  let browser;
  try { browser = await chromium.launch({ args }); }
  catch { browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args }); }
  console.log(`Step lamps (${S.base})`);
  fs.mkdirSync(SHOTS, { recursive: true });
  let A;
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const R = made.room.id;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(({ R, roomKey, key }) => { localStorage.setItem('klibb.roomKeys', JSON.stringify({ [R]: roomKey })); localStorage.setItem('klibb.unlock', key); localStorage.setItem('klibb.artist', 'L'); }, { R, roomKey: made.roomKey, key: KEY });
    A = await ctx.newPage(); A.errors = []; A.on('pageerror', (e) => A.errors.push(e.message));
    const boot = async () => {
      await A.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.net.id, null, { timeout: 30000 });
      await A.evaluate(() => window.klibb.entitlementsReady && window.klibb.entitlementsReady());
      await A.mouse.click(640, 450).catch(() => {}); await A.keyboard.press('Escape').catch(() => {});
      await A.evaluate(() => window.klibb.setView('first'));
      await A.waitForFunction(() => window.klibb.soundObj().engine, null, { timeout: 20000 }).catch(() => {});
    };
    await A.goto(`${S.base}/?room=${R}`); await boot();

    const bigShot = async (name, sel = '#snd-stepseq') => {
      await A.evaluate(() => { const p = document.getElementById('sound-panel'); p.style.maxHeight = 'none'; p.style.position = 'absolute'; p.style.zoom = '2'; p.style.top = '0'; p.style.right = '0';
        for (const e of document.querySelectorAll('#snd-body > .snd-layer:not([data-layer="0"]), #snd-body > .snd-adds, #snd-body > #snd-mods, #snd-body > .snd-own, #snd-body > .snd-fx')) { e.dataset.shotHide2 = '1'; e.style.display = 'none'; }
      });
      const h = await A.evaluate(() => Math.ceil(document.getElementById('sound-panel').getBoundingClientRect().height * 2 + 40));
      await A.setViewportSize({ width: 1280, height: Math.min(16000, Math.max(900, h)) }); await sleep(300);
      await (await A.$(sel)).screenshot({ path: path.join(SHOTS, name), timeout: 60000 }).catch((e) => console.log('   (shot failed: ' + e.message + ')'));
      await A.evaluate(() => { const p = document.getElementById('sound-panel'); for (const k of ['maxHeight', 'position', 'zoom', 'top', 'right']) p.style[k] = '';
        for (const e of document.querySelectorAll('[data-shot-hide2]')) { e.style.display = ''; delete e.dataset.shotHide2; }
      });
      await A.setViewportSize({ width: 1280, height: 900 }); await sleep(200);
    };

    await A.evaluate(() => window.klibb.soundUi().open()); await sleep(300);
    await A.click('#snd-tabs [data-tab="step"]'); await sleep(200);

    const ui = await A.evaluate(() => {
      const cells = [...document.querySelectorAll('#snd-stepseq .ss-cell')];
      return cells.map((c) => {
        const lamp = c.querySelector('.ss-lamp');
        const pad = c.querySelector('.ss-pad');
        const first = c.firstElementChild;
        return {
          step: c.dataset.step,
          hasLamp: !!lamp,
          lampOn: lamp ? lamp.classList.contains('on') : false,
          lampFirst: first === lamp,
          lampBeforePad: lamp && pad && lamp.compareDocumentPosition(pad) & Node.DOCUMENT_POSITION_FOLLOWING,
          round: lamp ? getComputedStyle(lamp).borderRadius : null,
          size: lamp ? { w: lamp.getBoundingClientRect().width, h: lamp.getBoundingClientRect().height } : null,
        };
      });
    });
    check('one lamp above each of the 4 default step pads', ui.length === 4 && ui.every((x) => x.hasLamp && x.lampFirst && x.lampBeforePad), ui);
    check('lamps start dim (none lit)', ui.every((x) => x.lampOn === false), ui);
    check('lamps are round and at least 24 px across (readable)', ui.every((x) => x.round && (x.round === '50%' || parseFloat(x.round) >= 12) && x.size.w >= 24 && x.size.h >= 24), ui);

    const lit = await A.evaluate(() => {
      const ctx = window.klibb.soundObj().ctx;
      const now = ctx && Number.isFinite(ctx.currentTime) ? ctx.currentTime : 0;
      const ui = window.klibb.soundUi();
      ui.reportStepLamp(0, now);
      const on = [...ui.tickStepLamps(now)];
      const lamps = [...document.querySelectorAll('#snd-stepseq .ss-lamp')].map((l) => ({ i: l.dataset.step, on: l.classList.contains('on') }));
      return { now, on, lamps };
    });
    check('reporting a hit on step 1 lights only that lamp', lit.on.join() === '0' && lit.lamps[0].on === true && lit.lamps.slice(1).every((l) => l.on === false), lit);

    const off = await A.evaluate(() => {
      const ui = window.klibb.soundUi();
      const on = [...ui.tickStepLamps(1e9)];
      const lamps = [...document.querySelectorAll('#snd-stepseq .ss-lamp')].map((l) => l.classList.contains('on'));
      return { on, lamps };
    });
    check('after the flash window, every lamp is dim again', off.on.length === 0 && off.lamps.every((x) => x === false), off);

    // Hold the lit style for the screenshot: the real flash is only 120 ms and would go dark
    // during the zoom/sleep. The check above already proved the AudioContext-timed path.
    // resetStepLamps cancels the rAF loop so it cannot clear the class mid-shot.
    await A.evaluate(() => {
      window.klibb.soundUi().resetStepLamps();
      document.querySelector('#snd-stepseq .ss-lamp[data-step="0"]').classList.add('on');
    });
    await bigShot('01-step-1-lamp-lit.png', '#snd-stepseq');
    check('screenshot written', fs.existsSync(path.join(SHOTS, '01-step-1-lamp-lit.png')));

    check('no page errors', A.errors.length === 0, A.errors);
  } finally {
    try { if (A) await A.context().close(); } catch {}
    try { await browser.close(); } catch {}
    try { S.child.kill(); } catch {}
  }
  console.log(fail ? `FAILED ${fail}, passed ${pass}` : `All ${pass} checks passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

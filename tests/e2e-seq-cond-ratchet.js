// E2E (Jens t952u + t953u + t954u): Sampler in the layer Source list, condition + ratchet under the
// lock buttons, the redundant Steps dropdown gone, Effects tab back. Screenshots → /workspace/seq-cond-ratchet.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.SEQCR_E2E_PORT || 8878);
const SHOTS = process.env.SEQCR_SHOTS || '/workspace/seq-cond-ratchet';

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 900) : '')); } };
const KEY = 'seqcr-e2e-full-key';

(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '0', DEV_UNLOCK: '0', ADMIN_TOKEN: 'seqcr-e2e-admin', FULL_ACCESS_KEYS: KEY });
  const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
  let browser;
  try { browser = await chromium.launch({ args }); }
  catch { browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args }); }
  console.log(`Sequencer condition / ratchet / sampler / Effects (${S.base})`);
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

    const bigShot = async (name, sel = '#sound-panel') => {
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

    const tabs = await A.$$eval('#snd-tabs button', (b) => b.map((x) => ({ tab: x.dataset.tab, label: x.textContent })));
    check('tabs include Effects after Landing', tabs.map((x) => x.tab).join() === 'step,slap,peel,duff,fx' && tabs[4].label === 'Effects', tabs);

    const seqUi = await A.evaluate(() => {
      const box = document.getElementById('snd-stepseq');
      const stepsSelect = box.querySelector('select[data-name="Steps"]');
      const lens = [...box.querySelectorAll('.snd-seq-quick button')].map((b) => b.textContent);
      const cond = [...box.querySelectorAll('.ss-cond')].map((b) => b.textContent);
      const rat = [...box.querySelectorAll('.ss-ratchet')].map((b) => b.textContent);
      const locks = [...box.querySelectorAll('.ss-pick')].length;
      return { stepsSelect: !!stepsSelect, lens, cond, rat, locks, n: box.querySelectorAll('.ss-cell').length };
    });
    check('the redundant Steps dropdown is gone; the 3/4/5/6/7/8/12/16 buttons remain', !seqUi.stepsSelect && seqUi.lens.join() === '3,4,5,6,7,8,12,16', seqUi);
    check('each of the 4 default steps has a lock, a 1:1 condition and a 1× ratchet button', seqUi.n === 4 && seqUi.locks === 4 && seqUi.cond.join() === '1:1,1:1,1:1,1:1' && seqUi.rat.join() === '1×,1×,1×,1×', seqUi);

    await A.click('#snd-stepseq .ss-cond[data-step="0"]'); await sleep(80);
    await A.click('#snd-stepseq .ss-cond[data-step="0"]'); await sleep(80); // 1:1 → 1:2 → 1:3
    await A.click('#snd-stepseq .ss-ratchet[data-step="0"]'); await sleep(80);
    await A.click('#snd-stepseq .ss-ratchet[data-step="0"]'); await sleep(80);
    await A.click('#snd-stepseq .ss-ratchet[data-step="0"]'); await sleep(80); // 1 → 2 → 3 → 4
    const after = await A.evaluate(() => {
      const st = window.klibb.soundUi().state().patches.step.seq.steps[0];
      return { cond: st.cond, ratchet: st.ratchet, condBtn: document.querySelector('#snd-stepseq .ss-cond[data-step="0"]').textContent, ratBtn: document.querySelector('#snd-stepseq .ss-ratchet[data-step="0"]').textContent };
    });
    check('clicking condition cycles to 1:3 and ratchet to 4×, stored on the step', after.cond === 3 && after.ratchet === 4 && after.condBtn === '1:3' && after.ratBtn === '4×', after);

    await bigShot('01-steps-condition-ratchet.png', '#snd-stepseq');
    await bigShot('02-steps-panel-condition-ratchet.png');

    const src0 = await A.evaluate(() => [...document.querySelector('#snd-body .snd-layer[data-layer="0"] select[data-name="Source"]').options].map((o) => ({ v: o.value, t: o.textContent })));
    check('Layer 1 Source lists Oscillator, Noise, Sampler, Live mic', src0.map((o) => o.v).join() === 'osc,noise,sampler,mic' && src0.some((o) => /Sampler/.test(o.t)), src0);

    await A.selectOption('#snd-body .snd-layer[data-layer="0"] select[data-name="Source"]', 'sampler'); await sleep(400);
    const smp = await A.evaluate(() => {
      const box = document.querySelector('#snd-body .snd-sampler');
      const builtins = [...(box?.querySelectorAll('.smp-builtin') || [])].map((b) => b.textContent);
      const file = !!box?.querySelector('.smp-file');
      const kind = window.klibb.soundUi().state().patches.step.layers[0].kind;
      const src = [...(box?.querySelector('select[data-name="Source"]')?.options || [])].map((o) => o.value);
      return { kind, builtins, file, src, hasDrop: !!box?.querySelector('.smp-drop') };
    });
    check('switching Source to Sampler shows the sampler layer, file picker and Kick/Hat/Click/Blip', smp.kind === 'sampler' && smp.file && smp.hasDrop && smp.builtins.join() === 'Kick,Hat,Click,Blip' && smp.src.join() === 'osc,noise,sampler,mic', smp);

    await A.evaluate(() => document.querySelector('#snd-body .snd-sampler')?.scrollIntoView()); await sleep(200);
    // unhide layer 1 for the sampler shot
    await A.evaluate(() => { const p = document.getElementById('sound-panel'); p.style.maxHeight = 'none'; p.style.position = 'absolute'; p.style.zoom = '1.6'; p.style.top = '0'; p.style.right = '0';
      for (const e of document.querySelectorAll('#snd-body > .snd-adds, #snd-body > #snd-mods, #snd-body > .snd-own')) { e.dataset.shotHide2 = '1'; e.style.display = 'none'; }
    });
    const h = await A.evaluate(() => Math.ceil(document.getElementById('sound-panel').getBoundingClientRect().height * 1.6 + 40));
    await A.setViewportSize({ width: 1280, height: Math.min(16000, Math.max(900, h)) }); await sleep(300);
    await (await A.$('#sound-panel')).screenshot({ path: path.join(SHOTS, '03-sampler-source.png'), timeout: 60000 }).catch((e) => console.log('   (shot failed: ' + e.message + ')'));
    await A.evaluate(() => { const p = document.getElementById('sound-panel'); for (const k of ['maxHeight', 'position', 'zoom', 'top', 'right']) p.style[k] = '';
      for (const e of document.querySelectorAll('[data-shot-hide2]')) { e.style.display = ''; delete e.dataset.shotHide2; }
    });
    await A.setViewportSize({ width: 1280, height: 900 }); await sleep(200);

    const kick = await A.evaluate(async () => {
      const btn = document.querySelector('.smp-builtin[data-builtin="kick"]');
      btn.click();
      await new Promise((r) => setTimeout(r, 400));
      const l = window.klibb.soundUi().state().patches.step.layers[0];
      return { name: l.name, has: !!l.sample, len: l.len, sel: document.querySelector('.smp-builtin[data-builtin="kick"]')?.classList.contains('sel') };
    });
    check('Kick built-in loads a sample onto the layer', kick.name === 'Kick' && kick.has && kick.len > 0, kick);

    await A.click('#snd-tabs [data-tab="fx"]'); await sleep(300);
    const fx = await A.evaluate(() => {
      const units = [...document.querySelectorAll('#snd-body .snd-unit')].map((u) => u.dataset.unit);
      const wets = [...document.querySelectorAll('#snd-body .snd-sl')].filter((r) => /wet/i.test(r.querySelector('span')?.textContent || '')).length;
      const hint = document.querySelector('#snd-body .hint')?.textContent || '';
      return { units, wets, hint, tab: window.klibb.soundUi().state().tab };
    });
    check('Effects tab shows reverb, delay, crush, dist and filter, with Wet sliders to switch them on', fx.tab === 'fx' && [...fx.units].sort().join() === 'crush,delay,dist,filter,reverb' && fx.wets >= 5, fx);

    // turn reverb on and confirm it is in the live draft
    await A.evaluate(() => {
      const row = [...document.querySelectorAll('#snd-body .snd-unit[data-unit="reverb"] .snd-sl')].find((r) => /wet/i.test(r.querySelector('span')?.textContent || ''));
      const inp = row.querySelector('input'); inp.value = String(inp.max * 0.4); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(200);
    const wet = await A.evaluate(() => window.klibb.soundUi().state().fx.reverb.wet);
    check('raising Reverb Wet above 0 stores the effect in sound settings', wet > 0.2, wet);

    await A.evaluate(() => { const p = document.getElementById('sound-panel'); p.style.maxHeight = 'none'; p.style.position = 'absolute'; p.style.zoom = '1.6'; p.style.top = '0'; p.style.right = '0'; });
    const hf = await A.evaluate(() => Math.ceil(document.getElementById('sound-panel').getBoundingClientRect().height * 1.6 + 40));
    await A.setViewportSize({ width: 1280, height: Math.min(16000, Math.max(900, hf)) }); await sleep(300);
    await (await A.$('#sound-panel')).screenshot({ path: path.join(SHOTS, '04-effects-tab.png'), timeout: 60000 }).catch((e) => console.log('   (shot failed: ' + e.message + ')'));
    await A.evaluate(() => { const p = document.getElementById('sound-panel'); for (const k of ['maxHeight', 'position', 'zoom', 'top', 'right']) p.style[k] = ''; });

    check('no page errors', A.errors.length === 0, A.errors);
  } catch (e) {
    fail++; console.log('  ✗ crashed — ' + (e && e.stack || e));
    if (A) await A.screenshot({ path: path.join(SHOTS, 'crash.png') }).catch(() => {});
  } finally {
    await browser.close(); if (S && S.child) S.child.kill();
  }
  console.log(`\nseq-cond-ratchet e2e: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

// E2E (Jens t869u, 12 Nov 2026): while I dance (X), every change in Sound settings → Steps is heard at once on
// the running dance step loop – no Save, no restarting the dance: osc pitch, waveform (the patch my steps play),
// Tempo (the step grid + the dance, and the other player hears / sees my new tempo). Cancel = back to my saved
// sound. Own server (port 8965).
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 900) : '')); } };
const KEY = 'dancelive-e2e-full-key';
(async () => {
  const S = await startServer(Number(process.env.DANCELIVE_E2E_PORT || 8965), { DEMO_PROFILE: '0', DEV_UNLOCK: '0', ADMIN_TOKEN: 'dancelive-e2e-admin', FULL_ACCESS_KEYS: KEY });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const R = made.room.id;
    const open = async (init) => {
      const ctx = await browser.newContext({ viewport: { width: 1100, height: 750 } });
      if (init) await ctx.addInitScript(init, { R, roomKey: made.roomKey, key: KEY });
      const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
      await p.goto(`${S.base}/?room=${R}`);
      await p.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.net.id, null, { timeout: 30000 });
      return p;
    };
    const A = await open(({ R, roomKey, key }) => { localStorage.setItem('klibb.roomKeys', JSON.stringify({ [R]: roomKey })); localStorage.setItem('klibb.unlock', key); localStorage.setItem('klibb.artist', 'A'); });
    const B = await open(() => { localStorage.setItem('klibb.artist', 'B'); });
    await A.evaluate(() => window.klibb.entitlementsReady && window.klibb.entitlementsReady());
    const aId = await A.evaluate(() => window.klibb.net.id);
    await A.mouse.click(550, 375).catch(() => {}); await A.keyboard.press('Escape').catch(() => {});
    await A.evaluate(() => { if (window.klibb.escMenu?.().isOpen?.()) window.klibb.escMenu().close(); window.klibb.setView('first'); });
    const started = await A.evaluate(() => window.klibb.startDance());
    await sleep(1500);
    const lastOsc = () => A.evaluate(() => { const l = window.klibb.soundObj().stepLog.filter((e) => !e.remote); return l.length ? { fq: l[l.length - 1].fq, waves: l[l.length - 1].waves, n: window.klibb.soundObj().steps } : null; });
    const s0 = await lastOsc();
    if (!s0) console.log('    [debug]', JSON.stringify(await A.evaluate(() => ({ d: window.klibb.dancing(), steps: window.klibb.soundObj().steps, ctx: window.klibb.soundObj().ctx?.state, muted: window.klibb.soundObj().muted, glog: window.klibb.grooveObj().log.slice(-3), tr: window.klibb.groove().tracks, view: window.klibb.view() }))));
    check('dancing: my dance step loop plays', started && (await A.evaluate(() => window.klibb.dancing())) && s0 && s0.fq.length > 0, s0);
    // open Sound settings → Steps, move the first layer's Pitch
    await A.evaluate(() => { window.klibb.soundUi().open(); document.querySelector('#snd-tabs [data-tab="step"]').click(); });
    await sleep(300);
    const before = await A.evaluate(() => JSON.stringify(window.klibb.soundMine()?.patches?.step ?? null));
    const layers0 = await A.evaluate(() => window.klibb.soundUi().state().patches.step.layers.map((l) => l.freq));
    const set = await A.evaluate(() => {
      const r = document.querySelector('#snd-body [data-param="freq"] input'); if (!r) return null;
      r.value = String(Math.round(Number(r.max) * 0.62)); r.dispatchEvent(new Event('input', { bubbles: true }));
      return { out: r.parentElement.querySelector('output')?.textContent, layers: window.klibb.soundUi().state().patches.step.layers.map((l) => l.freq) };
    });
    await sleep(1200);
    const s1 = await lastOsc();
    const li = set ? set.layers.findIndex((f, i) => f !== layers0[i]) : -1;
    const mine1 = await A.evaluate((li) => ({ freq: window.klibb.soundMine()?.patches?.step?.layers?.[li]?.freq, d: window.klibb.dancing(), live: window.klibb.soundUi().liveCount() }), li);
    check(`Steps Pitch (layer ${li + 1}) moved while dancing (${set?.out}) → heard at once on the dance step loop (${s0.fq[li]} → ${s1?.fq?.[li]} Hz), still dancing, not saved`,
      set && li >= 0 && mine1.d && Math.abs(mine1.freq - set.layers[li]) < 1e-6 && s1 && Math.abs(s1.fq[li] - +set.layers[li].toFixed(2)) < 0.02 && Math.abs(s0.fq[li] - s1.fq[li]) > 1 && s1.n > s0.n && mine1.live >= 1, { li, set, s0, s1, mine1 });
    // the waveform (a select)
    const w0 = await A.evaluate(() => window.klibb.soundUi().state().patches.step.layers.map((l) => (l.kind === 'osc' ? l.wave : l.kind)));
    const wave = await A.evaluate(() => { const sel = [...document.querySelectorAll('#snd-body select')].find((x) => [...x.options].some((o) => o.value === 'square') && ![...x.options].some((o) => o.value === 'noise')); if (!sel) return null; sel.value = sel.value === 'square' ? 'sawtooth' : 'square'; sel.dispatchEvent(new Event('change', { bubbles: true })); return sel.value; });
    const w1 = await A.evaluate(() => window.klibb.soundUi().state().patches.step.layers.map((l) => (l.kind === 'osc' ? l.wave : l.kind)));
    const wi = w1.findIndex((w, i) => w !== w0[i]);
    await sleep(1200);
    const s2 = await lastOsc();
    check(`Waveform (layer ${wi + 1}) → ${wave}: the next dance steps play it`, wave && wi >= 0 && s2 && s2.waves[wi] === wave && (await A.evaluate(() => window.klibb.dancing())), { wave, w0, w1, s2 });
    // Tempo while dancing: my step grid + dance follow, and B hears / sees A at the new tempo
    await A.evaluate(() => { const w = document.getElementById('walk-tempo'); w.value = String(Math.round(Number(w.max) * 0.4)); w.dispatchEvent(new Event('input', { bubbles: true })); });
    await sleep(400);
    const t = await A.evaluate(() => ({ bpm: window.klibb.radio().walkBpm, my: window.klibb.myTempo(), d: window.klibb.dancing(), self: window.klibb.selfAvatar() }));
    const seen = await B.waitForFunction(({ id, bpm }) => { const p = window.klibb.players().find((x) => x.id === id); return p && p.dancing && p.tempo && Math.abs(p.tempo.bpm - bpm) < 0.01 ? p.tempo.bpm : false; }, { id: aId, bpm: t.bpm }, { timeout: 5000 }).then((h) => h.jsonValue()).catch(() => null);
    check(`Tempo ${t.bpm} BPM while dancing: my steps + dance follow at once, and B gets it live (${seen})`, t.d && t.my.grooveBpm === t.bpm && seen === t.bpm, { t, seen });
    // Cancel: back to my saved sound (and Tempo), still dancing
    await A.evaluate(() => document.getElementById('snd-cancel').click());
    await sleep(1200);
    const s3 = await lastOsc();
    const after = await A.evaluate(() => ({ step: JSON.stringify(window.klibb.soundMine()?.patches?.step ?? null), d: window.klibb.dancing(), bpm: window.klibb.radio().walkBpm }));
    check(`Cancel: back to my saved Steps sound (${s3?.fq?.join('/')} Hz) and Tempo (${after.bpm}), the dance goes on`, after.d && after.step === before && s3 && JSON.stringify(s3.fq) === JSON.stringify(s0.fq) && JSON.stringify(s3.waves) === JSON.stringify(s0.waves) && after.bpm === 90, { s0, s3, after, before });
    check('no page errors', errors.length === 0, errors);
  } catch (e) { fail++; console.log('  ✗ crashed: ' + (e && e.stack)); }
  finally { await browser.close(); S.child.kill(); }
  console.log(`e2e-dancelive: ${pass} ok, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

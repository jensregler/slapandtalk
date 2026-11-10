// E2E (short): big stickers and peels (Jens, 10 Nov 2026, t785u). Own server (port 8851).
// - Size → pitch over 10 cm – 4 m: a 1.5 m slap is lower than a 30 cm one, a 4 m one lower still
//   (it used to stop getting lower at ~1.5 m).
// - A sticker over 1 m drops NO backing paper (no falling peel, none on the server), but the
//   landing "duff" still plays, pitched by its size. 1 m and below: the paper falls as before.
// - Peeling a sticker off: the peel sound's pitch follows its size too.
const sharp = require('sharp');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startServer } = require('./demo-helpers');

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };

(async () => {
  const S = await startServer(8851, { DEMO_PROFILE: '0', ADMIN_TOKEN: 'bigpeel-e2e-admin' });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-bigpeel-e2e-'));
  console.log(`Big stickers + peels (${S.base})`);
  try {
    const png = path.join(tmp, 'sq.png');
    await sharp({ create: { width: 64, height: 64, channels: 4, background: '#ff00ff' } }).png().toFile(png);
    const { room: { id: R }, roomKey: KEY } = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 650 } });
    await ctx.addInitScript(([r, k]) => { localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })); localStorage.setItem('klibb.devUnlock', '1'); }, [R, KEY]);
    const p = await ctx.newPage(); const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${S.base}/?room=${R}`);
    await p.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    await p.setInputFiles('#file', png);
    await p.waitForFunction(() => window.klibb.state.selected && !window.klibb.state.selected.library, null, { timeout: 20000 });
    await p.waitForFunction(() => window.klibb.peels().on, null, { timeout: 10000 });
    const lim = await p.evaluate(() => ({ min: window.klibb.minSizeCm, max: window.klibb.maxSizeCm }));
    check('normal sticker limits: 10 cm – 4 m', lim.min === 10 && lim.max === 400, lim);
    await p.evaluate(() => { const k = window.klibb; k.moveTo(0, -3); k.look(0, 0.1); });
    const slap = async (cm, x) => { const r = await p.evaluate(async ([cm, x]) => {
      const k = window.klibb; k.moveTo(x, -3); k.look(0, 0.1); k.setSize(cm);
      const n0 = k.soundLog().length, papers0 = k.peels().peels.length;
      const st = await k.stampAt(0, 0);
      const paperNow = k.peels().peels.length - papers0;
      await new Promise((r) => setTimeout(r, 1800)); // longer than any fall (PEEL.fallMax 1.4 s)
      const log = k.soundLog().slice(n0);
      return { id: st && st.id, size: st && st.size, paperNow, slap: log.find((e) => e.kind === 'slap'), duff: log.find((e) => e.kind === 'duff') };
    }, [cm, x]);
      // the server's papers live PEEL.lifeMs (6 s): look right away
      const srv = await (await fetch(`${S.base}/api/rooms/${R}/stamps`)).json();
      r.srvPeel = (srv.peels || []).some((x) => x.id === r.id);
      return r; };
    const s30 = await slap(30, -2), s100 = await slap(100, -0.5), s150 = await slap(150, 1), s400 = await slap(400, 3);
    check('30 cm and 1 m: the backing paper falls (client + server)', s30.paperNow === 1 && s100.paperNow === 1 && s30.srvPeel && s100.srvPeel, { s30, s100 });
    check('1.5 m and 4 m: no backing paper (no falling peel; none on the server)', s150.paperNow === 0 && s400.paperNow === 0 && !s150.srvPeel && !s400.srvPeel && Math.abs(s400.size - 4) < 1e-9, { s150, s400 });
    check('the landing "duff" still plays for every size, carrying the size', [s30, s100, s150, s400].every((s) => s.duff) && Math.abs(s150.duff.size - 1.5) < 1e-3 && Math.abs(s400.duff.size - 4) < 1e-3, [s30.duff, s100.duff, s150.duff, s400.duff]);
    const rates = [s30, s100, s150, s400].map((s) => s.slap && s.slap.rate), drates = [s30, s100, s150, s400].map((s) => s.duff && s.duff.rate);
    check('slap pitch keeps falling past 1.5 m: 30 cm > 1 m > 1.5 m > 4 m', rates.every((r, i) => r && (i === 0 || r < rates[i - 1])) && rates[3] < 0.6, rates);
    check('duff pitch follows the same size → pitch', drates.every((r, i) => r && (i === 0 || r < drates[i - 1])), drates);
    const peel = await p.evaluate(async () => {
      const k = window.klibb, n0 = k.soundLog().length;
      await k.peelLast(); // the 4 m one
      k.setSize(30); await k.stampAt(0, 0); await new Promise((r) => setTimeout(r, 300));
      const n1 = k.soundLog().length; await k.peelLast(); // a 30 cm one
      const log = k.soundLog();
      return { big: log.slice(n0).find((e) => e.kind === 'peel'), small: log.slice(n1).find((e) => e.kind === 'peel') };
    });
    check('peel sound: pitch follows the size (4 m lower than 30 cm)', peel.big && peel.small && Math.abs(peel.big.size - 4) < 1e-3 && peel.big.rate < peel.small.rate * 0.7, peel);
    check('no page errors', !errors.length, errors);
    await ctx.close();
  } catch (e) { fail++; console.log('  ✗ crashed: ' + (e && e.message)); } finally {
    await browser.close(); S.child.kill(); fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\nBig peel e2e: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

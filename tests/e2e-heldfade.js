// E2E: held sticker / aim NEVER auto-fades (Jens, 9 Nov 2026). Visibility only via O / #aim-toggle.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.HELDFADE_E2E_PORT || 8893);
const SHOTS = process.env.HELDFADE_SHOTS || '/workspace/heldfade-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 900) : '')); } };

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', ADMIN_TOKEN: 'heldfade-e2e-admin' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  const room = async () => (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
  try {
    {
      const tag = 'desktop';
      const made = await room();
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      await ctx.addInitScript(([r, k]) => {
        localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k }));
        localStorage.setItem('klibb.devUnlock', '1');
        localStorage.setItem('klibb.aimOff', '0');
      }, [made.room.id, made.roomKey]);
      const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
      await P.goto(`${S.base}/?room=${made.room.id}`);
      await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected, null, { timeout: 30000 });
      await P.evaluate(() => { const k = window.klibb; k.moveTo(0, 1); k.look(0, 0); });
      await P.mouse.click(600, 200); await P.waitForFunction(() => window.klibb.controls.locked, null, { timeout: 5000 });
      await P.evaluate(() => { window.klibb.setMode('slap', { quiet: true }); window.klibb.setAimOff(false, { quiet: true }); });
      await sleep(200);

      check(`${tag}: #aim-toggle present`, !!(await P.$('#aim-toggle')));
      const lab0 = await P.$eval('#aim-toggle', (el) => ({ pressed: el.getAttribute('aria-pressed'), text: el.textContent }));
      check(`${tag}: Aim on by default`, lab0.pressed === 'true' && /Aim on/i.test(lab0.text), lab0);

      const s0 = await P.evaluate(() => window.klibb.deskHeld());
      check(`${tag}: chosen/holding or timed with opacity 1`, s0 && s0.opacity === 1 && s0.canSlap && !s0.aimOff, s0);

      await P.mouse.click(600, 400); await sleep(300);
      const s1 = await P.evaluate(() => window.klibb.deskHeld());
      check(`${tag}: after slap still sharp (timed)`, s1 && s1.state === 'timed' && s1.canSlap && s1.opacity === 1 && s1.previewOpacity === 1, s1);

      await sleep(4500);
      const s2 = await P.evaluate(() => window.klibb.deskHeld());
      check(`${tag}: ~4.5 s untouched: STILL sharp (no auto-fade)`, s2 && s2.opacity === 1 && s2.canSlap && s2.previewVisible && s2.previewOpacity === 1, s2);

      await P.keyboard.press('o'); await sleep(200);
      const s3 = await P.evaluate(() => ({ ...window.klibb.deskHeld(), body: document.body.classList.contains('aim-off'), btn: document.getElementById('aim-toggle').getAttribute('aria-pressed') }));
      check(`${tag}: O → Aim off (hidden, body.aim-off)`, s3 && s3.aimOff && s3.opacity === 0 && !s3.previewVisible && s3.body && s3.btn === 'false', s3);

      // Turn Aim back on via O (same setAimOff path the HUD button uses)
      await P.keyboard.press('o'); await sleep(200);
      const s4 = await P.evaluate(() => ({ ...window.klibb.deskHeld(), body: document.body.classList.contains('aim-off'), lab: document.getElementById('aim-toggle').textContent }));
      check(`${tag}: O → Aim on (sharp again)`, s4 && !s4.aimOff && s4.opacity === 1 && s4.canSlap && !s4.body && /Aim on/i.test(s4.lab), s4);

      // Unlock and exercise the on-screen button
      await P.evaluate(() => { window.klibb.controls?.unlock?.(); try { document.exitPointerLock(); } catch {} });
      await sleep(400);
      await P.evaluate(() => {
        const b = document.getElementById('aim-toggle');
        b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      });
      await sleep(250);
      const s5 = await P.evaluate(() => window.klibb.deskHeld());
      check(`${tag}: HUD button → Aim off`, s5 && s5.aimOff && s5.opacity === 0, s5);

      await P.evaluate(() => {
        const b = document.getElementById('aim-toggle');
        b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      });
      await sleep(250);
      const s6 = await P.evaluate(() => ({ ...window.klibb.deskHeld(), lab: document.getElementById('aim-toggle').textContent }));
      check(`${tag}: HUD button → Aim on`, s6 && !s6.aimOff && s6.opacity === 1 && /Aim on/i.test(s6.lab), s6);

      await P.screenshot({ path: path.join(SHOTS, 'desktop-aim-on.png') });
      await P.screenshot({ path: '/workspace/aim-toggle.png' });
      check(`${tag}: wrote /workspace/aim-toggle.png`, fs.existsSync('/workspace/aim-toggle.png'));

      await ctx.close();
    }

    {
      const tag = 'phone';
      const made = await room();
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true, isMobile: true,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      });
      await ctx.addInitScript(([r, k]) => {
        localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k }));
        localStorage.setItem('klibb.devUnlock', '1');
        localStorage.setItem('klibb.aimOff', '0');
      }, [made.room.id, made.roomKey]);
      const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
      await P.goto(`${S.base}/?room=${made.room.id}`);
      await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected, null, { timeout: 30000 });
      await P.evaluate(() => { window.klibb.setAimOff(false, { quiet: true }); window.klibb.stackMenu()?.chosen?.(); });
      await sleep(300);
      const h0 = await P.evaluate(() => window.klibb.held());
      check(`${tag}: held sharp after choose`, h0 && h0.opacity === 1 && h0.canSlap && h0.heldShown, h0);

      await sleep(4500);
      const h1 = await P.evaluate(() => window.klibb.held());
      check(`${tag}: ~4.5 s untouched: STILL sharp (no auto-fade)`, h1 && h1.opacity === 1 && h1.canSlap && h1.heldShown, h1);

      check(`${tag}: #aim-toggle visible on touch`, await P.$eval('#aim-toggle', (el) => !!el && el.getClientRects().length > 0));

      await P.evaluate(() => window.klibb.setAimOff(true, { quiet: true }));
      await sleep(250);
      const h2 = await P.evaluate(() => ({ held: window.klibb.held(), aimOff: window.klibb.aimOff(), body: document.body.classList.contains('aim-off') }));
      check(`${tag}: Aim off hides held`, h2.aimOff && h2.body && (!h2.held.heldShown || h2.held.heldOpacity === 0 || h2.held.opacity === 0), h2);

      await P.evaluate(() => window.klibb.setAimOff(false, { quiet: true }));
      await sleep(250);
      const h3 = await P.evaluate(() => ({ held: window.klibb.held(), aimOff: window.klibb.aimOff() }));
      check(`${tag}: Aim on restores held`, !h3.aimOff && h3.held.opacity === 1 && h3.held.canSlap, h3);

      await P.screenshot({ path: path.join(SHOTS, 'phone-aim-on.png') });
      await ctx.close();
    }

    if (errors.length) console.log('page errors:', errors.slice(0, 5));
  } finally {
    await browser.close().catch(() => {});
    try { S.child.kill(); } catch {}
  }
  console.log(`\nheldfade (no-fade + aim toggle): ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

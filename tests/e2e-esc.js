// E2E: Esc toggles game ⇄ menu on desktop. In the menu, Esc first closes the topmost open thing
// (chat, Sound settings, My avatar, room look, ⚙ More, Room ▾, a text field); on the plain menu it
// goes back into the game. The Esc that opened the menu doesn't close it again. Touch: unchanged.
const path = require('path');
const os = require('os');

async function escE2E({ browser, BASE, assert, waitReady, devices }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => localStorage.setItem('klibb.devUnlock', '1'));
  const P = await ctx.newPage();
  const errors = [];
  P.on('pageerror', (e) => errors.push(e.message));
  P.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const R = (await (await fetch(`${BASE}/api/rooms`, { method: 'POST' })).json()).room.id;
  try {
    await P.goto(`${BASE}/?room=${R}`); await waitReady(P);
    await P.evaluate(() => window.klibb.entitlementsReady());
    const st = () => P.evaluate(() => ({ locked: window.klibb.controls.locked, resuming: window.klibb.resuming(), panel: document.getElementById('panel').getClientRects().length > 0,
      hint: document.getElementById('resume-hint').getClientRects().length > 0, more: window.klibb.moreOpen() }));
    const inGame = (s) => s.locked || (s.resuming && s.hint && !s.panel);
    // In the game → menu (the browser's own Esc = leave pointer lock; simulated with unlock)
    await P.mouse.click(900, 400); await P.waitForFunction(() => window.klibb.controls.locked, null, { timeout: 3000 });
    await P.evaluate(() => window.klibb.controls.unlock()); await P.waitForFunction(() => !window.klibb.controls.locked);
    await P.keyboard.press('Escape'); // the same Esc arriving right after the unlock
    const s1 = await st();
    assert(!s1.locked && !s1.resuming && s1.panel, 'the Esc that opened the menu does not close it again');
    await P.waitForTimeout(600);
    await P.keyboard.press('Escape');
    await P.waitForTimeout(300);
    const s2 = await st();
    assert(inGame(s2), `Esc on the plain menu goes back into the game (${s2.locked ? 'pointer lock granted' : 'browser refused the lock: menu gone, "Click to enter" shown'})`);
    if (!s2.locked) {
      await P.mouse.click(900, 400); await P.waitForFunction(() => window.klibb.controls.locked, null, { timeout: 3000 });
      assert(!(await st()).hint, 'after a refused lock, one click enters and the hint goes away');
    }
    await P.evaluate(() => window.klibb.controls.unlock()); await P.waitForTimeout(600);
    // Simulate Chrome refusing the lock (Esc isn't a user gesture / ~1 s cooldown after an Esc-exit)
    await P.evaluate(() => { const c = window.klibb.controls.canvas; c.requestPointerLock = () => { document.dispatchEvent(new Event('pointerlockerror')); return Promise.reject(new DOMException('The user has exited the lock before this request was completed.', 'SecurityError')); }; });
    await P.keyboard.press('Escape'); await P.waitForTimeout(300);
    const f1 = await st();
    await P.evaluate(() => { delete window.klibb.controls.canvas.requestPointerLock; });
    await P.mouse.click(900, 400); await P.waitForFunction(() => window.klibb.controls.locked, null, { timeout: 3000 });
    const f2 = await st();
    assert(!f1.locked && f1.resuming && f1.hint && !f1.panel && f2.locked && !f2.hint,
      'lock refused: the menu still closes and "Click to enter" shows (no error toast); one click enters the game');
    await P.evaluate(() => window.klibb.controls.unlock()); await P.waitForTimeout(600);
    // Resuming state: Esc again = back to the menu
    await P.evaluate(() => { window.klibb.escGate.unlockedAt = -1e9; });
    // Precedence: each Esc closes just the topmost thing, then the next one resumes
    const steps = [
      ['⚙ More', () => window.klibb.openMore(), () => window.klibb.moreOpen()],
      ['Room ▾', () => document.getElementById('room-menu-btn').click(), () => !document.getElementById('room-menu').hidden],
      ['Sound settings', () => window.klibb.soundUi().open(), () => !document.getElementById('sound-panel').hidden],
      ['My avatar (fabric panel)', () => window.klibb.openAvatarPanel(), () => !document.getElementById('avatar-panel').hidden],
      ['room look', () => window.klibb.openStylePanel('edit'), () => window.klibb.styleOpen()],
      ['chat', () => window.klibb.openChat(), () => document.getElementById('chat').classList.contains('open')],
    ];
    const closed = [];
    for (const [name, open, isOpen] of steps) {
      await P.evaluate(open); await P.waitForTimeout(250);
      if (!(await P.evaluate(isOpen))) { closed.push(`${name}: did not open`); continue; }
      await P.keyboard.press('Escape'); await P.waitForTimeout(250);
      const s = await st();
      closed.push(!(await P.evaluate(isOpen)) && !s.locked && !s.resuming ? 'ok' : `${name}: ${JSON.stringify(s)}`);
    }
    assert(closed.every((c) => c === 'ok'), `Esc closes only the topmost thing first (${steps.map((s) => s[0]).join(', ')}), without leaving the menu ${closed.filter((c) => c !== 'ok').join('; ')}`);
    // Typing in a field: first Esc leaves the field
    await P.evaluate(() => window.klibb.openMore()); await P.focus('#artist'); await P.keyboard.press('Escape');
    const t = await P.evaluate(() => [document.activeElement && document.activeElement.id, window.klibb.resuming(), window.klibb.controls.locked, window.klibb.moreOpen()]);
    await P.keyboard.press('Escape');
    const t2 = await P.evaluate(() => [window.klibb.moreOpen(), window.klibb.resuming()]);
    assert(t[0] !== 'artist' && !t[1] && !t[2] && t[3] && !t2[0] && !t2[1], 'Esc in a text field just leaves the field; the next Esc closes ⚙ More (still in the menu)');
    await P.waitForTimeout(100); await P.keyboard.press('Escape'); await P.waitForTimeout(300);
    const s3 = await st();
    if (s3.resuming) { await P.keyboard.press('Escape'); await P.waitForTimeout(100); }
    const s4 = await st();
    assert(inGame(s3) && (s3.locked || (!s4.resuming && s4.panel)), 'then Esc resumes; and in the "Click to enter" state Esc toggles back to the menu');
    assert(!errors.some((e) => /pointer ?lock/i.test(e)), 'no pointer-lock errors in the console');
  } finally { await ctx.close(); }
  // Touch: Esc does nothing new
  const mctx = await browser.newContext({ ...devices['iPhone 13'] });
  const M = await mctx.newPage();
  try {
    await M.goto(`${BASE}/?room=${R}`); await waitReady(M);
    await M.waitForTimeout(600); await M.keyboard.press('Escape'); await M.waitForTimeout(200);
    assert(!(await M.evaluate(() => window.klibb.resuming())), 'touch: Esc does not change anything');
  } finally { await mctx.close(); }
}
module.exports = { escE2E };

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  const { chromium, devices } = require('playwright');
  const BASE = process.env.BASE_URL || 'http://localhost:8787';
  const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };
  const waitReady = (page) => page.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 20000 });
  void os;
  (async () => {
    const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    try { await escE2E({ browser, BASE, assert, waitReady, devices }); } finally { await browser.close(); }
  })().catch((e) => { console.error(e); process.exit(1); });
}

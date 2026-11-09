// Verify (a) Face tab clicks change the face (b) patch stamps on Min gubbe.
// Screenshots: /workspace/face-change.png, /workspace/patch-own-menu.png, /workspace/patch-own-stamp.png
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.FACEPATCH_E2E_PORT || 8911);
let passed = 0, failed = 0;
const check = (name, ok, extra) => {
  if (ok) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 800) : '')); }
};

(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1', ADMIN_TOKEN: 'facepatch-e2e' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const R = made.room.id, KEY = made.roomKey;

    // ---- (a) Face change ----
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await ctx.addInitScript(([r, k]) => {
        localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k }));
        localStorage.setItem('klibb.devUnlock', '1');
        // Locked-face identity that USED to force the face photo — must still be editable now.
        // Do not overwrite on reload (preserves Save).
        if (!localStorage.getItem('klibb.avatar')) {
          localStorage.setItem('klibb.avatar', JSON.stringify({
            name: 'Regelverk',
            look: {
              outfit: 'tshirt', hair: 'kort', shirt: '#3a86ff', pants: '#2b4c7e',
              hairColor: '#4a2c17', skin: '#e0ac69', hat: false, hatColor: '#e63946',
              insta: 'jensreglermanniska',
              fabric: { face: { id: '70cf6e844298da52', scale: 1.15, rot: 0, hue: 0, hueHz: 0.25, spinHz: 0.1, scroll: 0, cycleHue: false, spin: false, photo: true } },
            },
          }));
        }
      }, [R, KEY]);
      const P = await ctx.newPage();
      P.on('pageerror', (e) => errors.push('face: ' + e.message));
      await P.goto(`${S.base}/?room=${R}`);
      await P.waitForFunction(() => window.klibb?.ready && window.klibb.net?.status === 'online', null, { timeout: 30000 });
      await P.evaluate(() => { window.klibb.moveTo(0, 0.5); window.klibb.look(0, 0); });
      await P.evaluate(() => window.klibb.openAvatarPanel());
      await P.waitForFunction(() => window.klibb.avatarView()?.visible && window.klibb.selfAvatar()?.face, null, { timeout: 15000 });

      const before = await P.evaluate(() => {
        const f = window.klibb.selfAvatar().face;
        const d = window.klibb.avatarView().draft;
        return { faceId: d.fabric?.face?.id || null, photo: !!d.fabric?.face?.photo, colour: f.colour, skin: f.skin, lockedStill: d.fabric?.face?.id === '70cf6e844298da52' };
      });
      check('face: starts with locked photo id (simulating @jensreglermanniska)', before.lockedStill && before.photo, before);

      // Screenshot before
      const beforePng = '/tmp/face-before.png';
      await P.screenshot({ path: beforePng, clip: { x: 200, y: 40, width: 520, height: 700 } });

      // Click Face 3 button in the face fabric picks
      const clicked = await P.evaluate(() => {
        const row = document.querySelector('#avatar-panel .fab-slot[data-slot="face"]');
        // Open Fabric mode if on Colour
        const fabBtn = row?.querySelector('.fab-seg button[data-mode="fabric"]');
        if (fabBtn && fabBtn.getAttribute('aria-pressed') !== 'true') fabBtn.click();
        const face3 = row?.querySelector('button.face3');
        if (!face3) return { ok: false, reason: 'no Face3 button' };
        face3.click();
        return { ok: true };
      });
      check('face: Face 3 button clicked', clicked.ok, clicked);
      await sleep(800);

      const afterFace3 = await P.evaluate(() => {
        const d = window.klibb.avatarView().draft;
        const f = window.klibb.selfAvatar().face;
        return { faceId: d.fabric?.face?.id || null, photo: !!d.fabric?.face?.photo, colour: f.colour, eyes: f.eyes };
      });
      const FACE3 = await P.evaluate(() => {
        // FACE3_ID from shared – read from draft after click or hardcode from face3.mjs
        return window.klibb.avatarView().draft.fabric?.face?.id;
      });
      check('face: Face 3 changes fabric.face.id away from locked photo', afterFace3.faceId && afterFace3.faceId !== '70cf6e844298da52' && afterFace3.photo, afterFace3);

      // Switch to a plain face colour (Colour mode + a swatch) — another face option
      const colourPick = await P.evaluate(() => {
        const row = document.querySelector('#avatar-panel .fab-slot[data-slot="face"]');
        const colBtn = row?.querySelector('.fab-seg button[data-mode="color"]');
        if (colBtn) colBtn.click();
        const sw = document.querySelector('#av-face button[data-id="#ff70a6"]') || document.querySelector('#av-face button[data-id^="#"]');
        if (!sw) return { ok: false };
        sw.click();
        return { ok: true, id: sw.dataset.id };
      });
      check('face: colour swatch clicked', colourPick.ok, colourPick);
      await sleep(500);
      const afterColour = await P.evaluate(() => {
        const d = window.klibb.avatarView().draft;
        const f = window.klibb.selfAvatar().face;
        return { faceColour: d.face || null, fabricFace: d.fabric?.face || null, live: f.colour, eyes: f.eyes };
      });
      check('face: colour option applied (no forced lock photo)', !afterColour.fabricFace && afterColour.faceColour, afterColour);

      const afterPng = '/tmp/face-after.png';
      await P.screenshot({ path: afterPng, clip: { x: 200, y: 40, width: 520, height: 700 } });

      // Side-by-side
      const b = await sharp(beforePng).resize(520, 700).toBuffer();
      const a = await sharp(afterPng).resize(520, 700).toBuffer();
      await sharp({
        create: { width: 1040 + 20, height: 700 + 40, channels: 3, background: '#111' },
      })
        .composite([
          { input: b, left: 0, top: 40 },
          { input: a, left: 520 + 20, top: 40 },
          { input: await sharp({ create: { width: 200, height: 28, channels: 3, background: '#111' } }).png().toBuffer(), left: 10, top: 8 },
        ])
        .png()
        .toFile('/tmp/face-change-raw.png');
      // labels via SVG overlay
      const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1060" height="740">
        <rect width="1060" height="740" fill="#111"/>
        <text x="20" y="28" fill="#ffd400" font-size="18" font-family="sans-serif">BEFORE (locked face)</text>
        <text x="560" y="28" fill="#8f8" font-size="18" font-family="sans-serif">AFTER (Face tab edit)</text>
      </svg>`);
      await sharp(label)
        .composite([
          { input: b, left: 10, top: 40 },
          { input: a, left: 530, top: 40 },
        ])
        .png()
        .toFile('/workspace/face-change.png');
      check('face: wrote /workspace/face-change.png', fs.existsSync('/workspace/face-change.png'));

      await ctx.close();
    }

    // ---- (b) Patch stamp ----
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await ctx.addInitScript(([r, k]) => {
        localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k }));
        localStorage.setItem('klibb.devUnlock', '1');
        if (!localStorage.getItem('klibb.avatar')) {
          localStorage.setItem('klibb.avatar', JSON.stringify({
            name: 'Patchy',
            look: { outfit: 'tshirt', hair: 'kort', shirt: '#3a86ff', pants: '#2b4c7e', hairColor: '#4a2c17', skin: '#e0ac69', hat: false, hatColor: '#e63946' },
          }));
        }
      }, [R, KEY]);
      const P = await ctx.newPage();
      P.on('pageerror', (e) => errors.push('patch: ' + e.message));
      await P.goto(`${S.base}/?room=${R}`);
      await P.waitForFunction(() => window.klibb?.ready && window.klibb.net?.status === 'online', null, { timeout: 30000 });
      await P.evaluate(() => { window.klibb.moveTo(0, 0.5); window.klibb.look(0, 0); });
      await P.evaluate(() => window.klibb.openAvatarPanel());
      await P.waitForFunction(() => window.klibb.avatarView()?.visible, null, { timeout: 15000 });

      // Patches section has its own fabric-like sliders; garment fabric must NOT list patch tools.
      const uiSep = await P.evaluate(() => {
        const row = document.getElementById('av-patches-row');
        const ctl = document.getElementById('av-patches-ctl');
        const sliders = [...(ctl?.querySelectorAll('.fab-sl') || [])].map((r) => r.dataset.param);
        // Open Trousers → Fabric and ensure no .fab-patches inside that garment panel
        const pants = document.querySelector('.fab-slot[data-slot="pants"]');
        const fabBtn = pants?.querySelector('.fab-seg button[data-mode="fabric"]');
        fabBtn?.click();
        const pantsCtl = pants?.querySelector('.fab-ctl');
        const leaked = !!pantsCtl?.querySelector('.fab-patches, button.patch');
        const hint = pantsCtl?.querySelector('.fab-src small')?.textContent || '';
        // close fabric again so patches stay visible
        const colBtn = pants?.querySelector('.fab-seg button[data-mode="color"]');
        colBtn?.click();
        return {
          rowVisible: row && !row.hidden,
          sliders,
          leaked,
          hint,
          hasPickAPatch: /pick a patch/i.test(hint),
        };
      });
      check('patch: Patches row visible with Scale/Rotation/Hue sliders', uiSep.rowVisible && ['scale','rot','hue'].every((k) => uiSep.sliders.includes(k)), uiSep);
      check('patch: garment fabric picker has no patch tools', !uiSep.leaked && !uiSep.hasPickAPatch, uiSep);
      await P.screenshot({ path: '/workspace/patch-own-menu.png' });
      check('patch: wrote /workspace/patch-own-menu.png', fs.existsSync('/workspace/patch-own-menu.png'));

      // Select black circle patch tool
      const tool = await P.evaluate(async () => {
        const row = document.getElementById('av-patches');
        if (!row) return { ok: false, reason: 'no av-patches' };
        const circle = row.querySelector('button.patch[data-patch-key="circle"]') || row.querySelector('button.patch');
        if (!circle) return { ok: false, reason: 'no circle', html: row.innerHTML.slice(0, 200) };
        circle.click();
        // wait for upload/preset id
        for (let i = 0; i < 50; i++) {
          const t = window.klibb.getPatchTool?.();
          if (t?.id) return { ok: true, id: t.id, key: t.key };
          await new Promise((r) => setTimeout(r, 100));
        }
        return { ok: false, reason: 'tool not ready', tool: window.klibb.getPatchTool?.() };
      });
      check('patch: black circle tool selected', tool.ok, tool);
      await sleep(400);

      // Stamp a few times on the avatar (chest / torso area of canvas)
      // Avatar is centered in showCam view — click mid-canvas
      // Avatar showcase sits left of the panel (panel is right ~360px) — aim at torso/chest.
      const stamps = [];
      for (const [x, y] of [[480, 260], [440, 300], [520, 280], [480, 340]]) {
        const r = await P.evaluate(({ x, y }) => {
          const cam = window.klibb.showCam;
          const ok = window.klibb.stampPatchAt(x, y, cam);
          const draft = window.klibb.avatarView().draft;
          return { ok, n: (draft.patches || []).length };
        }, { x, y });
        stamps.push(r);
        await sleep(200);
      }
      check('patch: at least 2 stamps landed (raycast hits)', stamps.filter((s) => s.ok).length >= 2, stamps);
      const nAfter = stamps[stamps.length - 1]?.n || 0;
      check('patch: draft.patches has multiple entries', nAfter >= 2, { nAfter, stamps });

      // Confirm not shirt fabric tiling
      const tiling = await P.evaluate(() => {
        const d = window.klibb.avatarView().draft;
        return { shirtFabric: d.fabric?.shirt || null, patches: d.patches?.length || 0 };
      });
      check('patch: shirt fabric NOT set by patch tool (no tiling)', !tiling.shirtFabric && tiling.patches >= 2, tiling);
      const shape = await P.evaluate(() => {
        const list = window.klibb.avatarView().draft.patches || [];
        return list.map((p) => ({ id: p.id, slot: p.slot, scale: p.scale, hasQ: 'q' in p, hasSize: 'size' in p, hue: p.hue }));
      });
      check('patch: stamps are atlas ops (slot+scale, no floating q)', shape.length >= 2 && shape.every((p) => p.slot && p.scale > 0 && !p.hasQ), shape);

      // Undo last
      await P.evaluate(() => document.querySelector('.fab-patch-undo')?.click());
      await sleep(200);
      const afterUndo = await P.evaluate(() => (window.klibb.avatarView().draft.patches || []).length);
      check('patch: undo removes last stamp', afterUndo === nAfter - 1, { afterUndo, nAfter });

      // Stamp star too
      await P.evaluate(async () => {
        const star = document.querySelector('#av-patches button.patch[data-patch-key="star"]');
        star?.click();
        for (let i = 0; i < 40; i++) {
          if (window.klibb.getPatchTool?.()?.key === 'star') break;
          await new Promise((r) => setTimeout(r, 100));
        }
      });
      await sleep(300);
      await P.evaluate(() => window.klibb.stampPatchAt(500, 320, window.klibb.showCam));
      await sleep(200);
      const withStar = await P.evaluate(() => window.klibb.avatarView().draft.patches || []);
      check('patch: star stamp added', withStar.length >= afterUndo + 1, { n: withStar.length });

      // Save (av-ok) and check persistence in me.look + localStorage
      await P.click('#av-ok');
      await sleep(500);
      const saved = await P.evaluate(() => {
        const me = window.klibb.me();
        let ls = null;
        try { ls = JSON.parse(localStorage.getItem('klibb.avatar') || '{}'); } catch {}
        return { mePatches: me.look?.patches?.length || 0, lsPatches: ls?.look?.patches?.length || 0, ids: (me.look?.patches || []).map((p) => p.id) };
      });
      check('patch: persisted on Save (me.look + localStorage)', saved.mePatches >= 2 && saved.lsPatches >= 2, saved);

      // Second player joins while A still has patches in the live look
      const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await ctxB.addInitScript(([r, k]) => {
        localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k }));
        localStorage.setItem('klibb.devUnlock', '1');
      }, [R, KEY]);
      const B = await ctxB.newPage();
      B.on('pageerror', (e) => errors.push('B: ' + e.message));
      await B.goto(`${S.base}/?room=${R}`);
      await B.waitForFunction(() => window.klibb?.ready && window.klibb.net?.status === 'online', null, { timeout: 30000 });
      await B.waitForFunction(() => window.klibb.players().some((p) => (p.look?.patches || []).length >= 2), null, { timeout: 15000 }).catch(() => {});
      const seen = await B.evaluate(() => {
        const others = window.klibb.players().filter((p) => p.id !== window.klibb.net.id);
        return others.map((p) => ({ name: p.name, n: p.look?.patches?.length || 0, avatarN: p.avatar?.look?.patches?.length || 0 }));
      });
      check('patch: other player receives look.patches', seen.some((p) => p.n >= 2), seen);

      // Screenshot with patches (open panel again on A)
      await P.evaluate(() => window.klibb.openAvatarPanel());
      await sleep(800);
      await P.screenshot({ path: '/workspace/patch-own-stamp.png' });
      check('patch: wrote /workspace/patch-own-stamp.png', fs.existsSync('/workspace/patch-own-stamp.png'));
      // keep legacy path too for older references
      await P.screenshot({ path: '/workspace/patch-stamp.png' });

      // Reload A — init script must not wipe klibb.avatar
      await P.reload();
      await P.waitForFunction(() => window.klibb?.ready && window.klibb.net?.status === 'online', null, { timeout: 30000 });
      const reloaded = await P.evaluate(() => {
        const me = window.klibb.me();
        const ls = JSON.parse(localStorage.getItem('klibb.avatar') || '{}');
        return { n: me.look?.patches?.length || 0, lsN: ls.look?.patches?.length || 0, patches: me.look?.patches };
      });
      check('patch: survives reload', reloaded.n >= 2 && reloaded.lsN >= 2, reloaded);

      // Clear via panel
      await P.evaluate(() => window.klibb.openAvatarPanel());
      await sleep(400);
      await P.evaluate(() => document.querySelector('.fab-patch-clear')?.click());
      await sleep(200);
      const cleared = await P.evaluate(() => window.klibb.avatarView().draft.patches);
      check('patch: clear removes all', !cleared || cleared.length === 0, cleared);

      await ctxB.close();
      await ctx.close();
    }

    if (errors.length) console.log('page errors:', errors.slice(0, 8));
  } finally {
    await browser.close().catch(() => {});
    try { S.child.kill(); } catch {}
  }
  console.log(`\nface-patch-verify: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

// e2e for the demo profile (DEMO_PROFILE=1, the free version for the Thursday demo).
// Starts its own demo servers (own port + temp data dir), so it does not touch the normal e2e server:
//   A: a normal hour   → name dialog, hidden full-version bits, library palette (R/F), click credit,
//      invites (single use, no entry without one), slots, per-player history, preset room, quick room,
//      voice chat between two headless Chromium pages (fake microphone), phone layout.
//   B: DEMO_ROOM_MINUTES=0.2 → timer, the calm warning, the room closes and its data is gone.
// Run: node tests/e2e-demo.js   (needs a built client: npx vite build)
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const PORT_A = Number(process.env.DEMO_E2E_PORT || 8817), PORT_B = PORT_A + 1;
const ADMIN = 'demo-e2e-admin';
let passed = 0, failed = 0;
function check(name, ok, info = '') {
  if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (info ? '  — ' + (typeof info === 'string' ? info : JSON.stringify(info)) : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitReady = (page) => page.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 20000 });

const { toneWav, startServer: startWith, enter } = require('./demo-helpers');
const startServer = (port, extra) => startWith(port, { ADMIN_TOKEN: ADMIN, ...extra });

(async () => {
  const A = await startServer(PORT_A);
  const B = await startServer(PORT_B, { DEMO_ROOM_MINUTES: '0.2' });
  // The fake microphone: a soft 330 Hz "voice" (0.6 s on, 0.4 s off) from a WAV made here (headless
  // Chromium's built-in fake device can be silent).
  const wav = path.join(os.tmpdir(), 'klibb-demo-voice.wav');
  fs.writeFileSync(wav, toneWav());
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
  try {
    console.log('Demo profile (server A, ' + A.base + ')');
    const cfg = await (await fetch(A.base + '/api/config')).json();
    check('GET /api/config says demo, 5 players, 60 min', cfg.demo === true && cfg.maxPlayers === 5 && cfg.roomMinutes === 60, cfg);
    const up = await fetch(A.base + '/api/stickers', { method: 'POST' });
    check('POST /api/stickers → 403 in the demo', up.status === 403, up.status);

    // ---- Jens: the very first visit ----
    const ctxJ = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
    // A full-access key and dev unlock must NOT unlock anything in the demo.
    await ctxJ.addInitScript(() => { try { localStorage.setItem('klibb.accessKey', 'demo-e2e-key'); } catch { /* */ } });
    const jp = await ctxJ.newPage();
    jp.on('pageerror', (e) => console.log('    [pageerror]', e.message));
    await jp.goto(A.base + '/?unlock=1');
    await jp.waitForSelector('#name-dialog[open]', { timeout: 20000 });
    const before = await jp.evaluate(() => ({ klibb: !!window.klibb, title: document.getElementById('name-title').textContent, focused: document.activeElement && document.activeElement.id }));
    check('the name dialog comes first (before the room loads), in English', !before.klibb && /name/i.test(before.title), before);
    check('the name field has focus', before.focused === 'name-input', before);
    await jp.screenshot({ path: path.join(SHOTS, '60-demo-name.png') });
    await jp.press('#name-input', 'Enter'); // empty: stays
    check('an empty name is not accepted', await jp.evaluate(() => document.getElementById('name-dialog').open));
    await jp.fill('#name-input', 'Jens');
    await jp.press('#name-input', 'Enter');
    await jp.waitForURL(/\?room=/, { timeout: 20000 });
    await waitReady(jp);
    const R1 = await jp.evaluate(() => window.klibb.room); global.__R1 = R1;
    const j1 = await jp.evaluate(() => {
      const k = window.klibb, hid = (id) => { const e = document.getElementById(id); return !e || e.offsetParent === null || getComputedStyle(e).display === 'none'; };
      const sel = (q) => { const e = document.querySelector(q); return !e || getComputedStyle(e).display === 'none' || e.offsetParent === null; };
      const ent = k.entitlements();
      return { demo: k.demo, body: document.body.classList.contains('demo'), me: k.me(), designs: k.designs().length, lib: k.library().length,
        selected: k.state.selected && k.state.selected.id, libIds: k.library().map((d) => d.id), style: k.currentStyle(), canEdit: k.canEditStyle(),
        ent: Object.values(ent.features || ent).filter((v) => v === true).length,
        hidden: { upload: sel('label.upload, #upload-label, .upload'), myAvatar: hid('my-avatar'), editStyle: hid('edit-style'), soundBtn: hid('sound-design-btn'),
          cams: hid('cam-add'), toStad: hid('to-stad'), peels: hid('peels-box'), artist: sel('#artist') && sel('#artist-link') },
        recBox: !document.getElementById('rec-box').hidden && !document.getElementById('rec-box').classList.contains('no-demo'), timer: k.demoState().timer, mic: !hid('mic-btn'), invite: document.getElementById('share-room').textContent };
    });
    check('body.demo and klibb.demo', j1.demo && j1.body, j1);
    check('the name shows as mine ("Jens")', j1.me.name === 'Jens', j1.me);
    check('the root address went straight into a new room of my own', /^[a-z0-9-]+$/i.test(R1) && jp.url().includes('room=' + R1), jp.url());
    check('the palette is the library (6 placeholders), first one selected', j1.designs === 6 && j1.lib === 6 && j1.selected === j1.libIds[0], j1);
    check('the room uses the empty preset (tiles, concrete, standard ceiling)', j1.style && j1.style.floor === 'betong' && j1.style.wall === 'kakel' && j1.style.ceiling === 'klassisk', j1.style);
    check('no room editing, even as creator with a full key', j1.canEdit === false);
    check('dev unlock and a full key unlock nothing', j1.ent === 0, j1.ent);
    check('hidden: Upload, My avatar, room editing, sound settings, placing cameras, City, peels, Instagram tag', Object.values(j1.hidden).every(Boolean), j1.hidden);
    check('recording (● REC) is available to the creator in the demo', j1.recBox === true, j1.recBox);
    check('the remaining-time indicator shows the hour', /(59|60)\s*min/.test(j1.timer || ''), j1.timer);
    check('🎙 and ✉ Invite a friend are there', j1.mic && /invite/i.test(j1.invite), j1);
    await jp.screenshot({ path: path.join(SHOTS, '61-demo-room.png') });

    // R / F browse the library.
    await jp.mouse.move(640, 400);
    const sel = () => jp.evaluate(() => window.klibb.state.selected.id);
    await jp.keyboard.press('KeyR'); const afterR = await sel();
    await jp.keyboard.press('KeyF'); const afterF = await sel();
    check('R = next library sticker, F = back', afterR === j1.libIds[1] && afterF === j1.libIds[0], { afterR, afterF });
    await jp.keyboard.press('KeyR'); await jp.keyboard.press('KeyR'); // index 2
    const chosen = await sel();

    // Slap a library sticker: its artist rides along (not my name) → Look mode click credit.
    await jp.evaluate(() => { const k = window.klibb; k.moveTo(0, 0); k.look(0, 0); });
    const slapped = await jp.evaluate(async () => {
      const k = window.klibb;
      // face a wall: try the four directions until the dot hits something
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) { k.look(yaw, 0); const s = await k.stampAt(0, 0); if (s) return { yaw, stamp: s }; }
      return null;
    });
    await jp.waitForFunction(() => window.klibb.pendingSlaps() === 0, null, { timeout: 8000 }).catch(() => {});
    const stampsJ = await (await fetch(`${A.base}/api/rooms/${R1}/stamps`)).json();
    const st = (stampsJ.stamps || stampsJ)[0] || {};
    check('a slapped library sticker is saved with its artist ("Placeholder")', !!slapped && st.imageId === chosen && st.artist === 'Placeholder', { st, chosen });
    // As in e2e.js: lock the pointer, V = Look mode, then a click dispatched on the canvas (aimed by the dot).
    await jp.mouse.click(900, 400); await jp.waitForFunction(() => window.klibb.controls.locked, null, { timeout: 3000 }).catch(() => {});
    await jp.keyboard.press('v');
    await jp.waitForFunction(() => window.klibb.state.mode === 'view', null, { timeout: 3000 }).catch(() => {});
    await jp.evaluate((yaw) => window.klibb.look(yaw, 0), slapped ? slapped.yaw : 0); await sleep(300);
    await jp.evaluate(() => { const c = document.getElementById('scene'); for (const t of ['mousedown', 'mouseup', 'click']) c.dispatchEvent(new MouseEvent(t, { bubbles: true, button: 0 })); });
    await jp.waitForFunction(() => window.klibb.credit().shown, null, { timeout: 3000 }).catch(() => {});
    const cr = await jp.evaluate(() => ({ ...window.klibb.credit(), count: window.klibb.stamps.count }));
    check('Look mode: a click on the sticker shows the library artist (and does not slap)', cr.shown && /Placeholder/.test(cr.name) && cr.count === 1, cr);
    await jp.screenshot({ path: path.join(SHOTS, '62-demo-credit.png') });
    await jp.keyboard.press('v'); await jp.keyboard.press('Escape');
    await jp.evaluate(() => window.klibb.setMode('slap'));

    // ---- No entry without an invite ----
    const ctxX = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    const xp = await enter(ctxX, `${A.base}/?room=${R1}`, 'Stranger');
    await xp.waitForFunction(() => { const e = document.getElementById('demo-closed'); return e && !e.hidden; }, null, { timeout: 25000 });
    const xs = await xp.evaluate(() => ({ text: document.getElementById('demo-closed-text').textContent, players: window.klibb ? window.klibb.players().length : -1 }));
    check('no invite → refused at the door with a calm note', /invite-only/i.test(xs.text), xs);
    const jPlayers0 = await jp.evaluate(() => window.klibb.players().length);
    check('…and Jens never sees the stranger', jPlayers0 === 0, jPlayers0);
    await xp.screenshot({ path: path.join(SHOTS, '63-demo-denied.png') });
    await ctxX.close(); // (fewer pages rendering at once: the box is shared)

    // ---- Jens invites one friend ----
    await jp.evaluate(() => { navigator.clipboard.writeText = async () => {}; });
    await jp.evaluate(() => window.klibb.inviteFriend());
    await jp.waitForFunction(() => !!window.klibb.lastInvite, null, { timeout: 8000 });
    const inv = await jp.evaluate(() => ({ url: window.klibb.lastInvite, note: window.klibb.demoState().inviteNote }));
    check('✉ Invite a friend gives a single-use link', /[?&]invite=/.test(inv.url) && inv.url.includes('room=' + R1), inv);
    const inviteUrl = inv.url.replace(/^https?:\/\/[^/]+/, A.base);

    const ctxM = await browser.newContext({ viewport: { width: 1000, height: 700 }, permissions: ['microphone'] });
    const mp = await enter(ctxM, inviteUrl, 'Marika');
    await waitReady(mp);
    await mp.waitForFunction(() => window.klibb.net.status === 'online' && window.klibb.players().length === 1, null, { timeout: 20000 });
    await jp.waitForFunction(() => window.klibb.players().some((p) => p.name === 'Marika'), null, { timeout: 20000 });
    const m1 = await mp.evaluate(() => ({ url: location.href, slot: window.klibb.mySlot(), others: window.klibb.players().map((p) => ({ name: p.name, slot: p.slot })) }));
    const jSees = await jp.evaluate(() => window.klibb.players().map((p) => ({ name: p.name, slot: p.slot, colour: window.klibb.voiceOf(p.id).colour })));
    check('Marika gets in with the invite; the token leaves the address bar', !/invite=/.test(m1.url), m1.url);
    check('Jens sees Marika by name (name above the character)', jSees[0] && jSees[0].name === 'Marika', jSees);
    check('each player has a slot (Jens 0, Marika 1) → her sounds are coloured', m1.slot === 1 && jSees[0].slot === 1 && jSees[0].colour === 1 && m1.others[0].slot === 0, { m1, jSees });

    // The link is used up: a third person cannot use it.
    const ctxY = await browser.newContext({ viewport: { width: 900, height: 600 } });
    const yp = await enter(ctxY, inviteUrl, 'Late');
    await yp.waitForFunction(() => { const e = document.getElementById('demo-closed'); return e && !e.hidden; }, null, { timeout: 25000 })
      .catch(async (e) => { console.log('    [late]', JSON.stringify(await yp.evaluate(() => ({ url: location.href, k: !!window.klibb, st: window.klibb && window.klibb.net.status, d: window.klibb && window.klibb.net.denied, dlg: document.getElementById('name-dialog').open })))); throw e; });
    check('a used invite link does not work again', /already been used/i.test(await yp.evaluate(() => document.getElementById('demo-closed-text').textContent)));
    await ctxY.close();
    await jp.waitForFunction(() => window.klibb.demoState().invite === 'used', null, { timeout: 8000 }).catch(() => {});
    await jp.evaluate(() => window.klibb.net.sendInvite('status'));
    await jp.waitForFunction(() => /Marika/.test(window.klibb.demoState().inviteNote), null, { timeout: 8000 }).catch(() => {});
    const js2 = await jp.evaluate(() => ({ ...window.klibb.demoState(), disabled: document.getElementById('share-room').disabled }));
    check('Jens sees his invite was used by Marika and cannot invite again', js2.invite === 'used' && /Marika/.test(js2.inviteNote) && js2.disabled, js2);
    // Marika can invite one friend of her own.
    await mp.evaluate(() => { navigator.clipboard.writeText = async () => {}; window.klibb.inviteFriend(); });
    await mp.waitForFunction(() => !!window.klibb.lastInvite, null, { timeout: 8000 }).catch(() => {});
    check('Marika can invite one friend of her own', /invite=/.test(await mp.evaluate(() => window.klibb.lastInvite || '')));

    // A returning member gets back in without the link (reload).
    await mp.reload(); await waitReady(mp);
    await mp.waitForFunction(() => window.klibb.net.status === 'online', null, { timeout: 20000 }).catch(() => {});
    const mBack = await mp.evaluate(() => ({ status: window.klibb.net.status, name: window.klibb.me().name, dialog: document.getElementById('name-dialog').open }));
    check('Marika comes back after a reload: no name dialog, still a member', mBack.status === 'online' && mBack.name === 'Marika' && !mBack.dialog, mBack);

    // ---- Unique history per participant ----
    await mp.evaluate(() => { const k = window.klibb; k.moveTo(0, 0); });
    const ms = await mp.evaluate(async (yaw) => { const k = window.klibb; k.look(yaw + 0.25, 0); return !!(await k.stampAt(0, 0)); }, slapped ? slapped.yaw : 0);
    await mp.waitForFunction(() => window.klibb.pendingSlaps() === 0, null, { timeout: 8000 }).catch(() => {});
    await jp.waitForFunction(() => window.klibb.stamps.count >= 2, null, { timeout: 5000 }).catch(() => {});
    const hJ = await jp.evaluate(() => window.klibb.roomHistory().map((h) => h.stampId || h.id));
    const hM = await mp.evaluate(() => window.klibb.roomHistory().map((h) => h.stampId || h.id));
    check('history is per participant: Jens has his 1, Marika her 1, no overlap', ms && hJ.length === 1 && hM.length === 1 && hJ[0] !== hM[0], { hJ, hM });
    await mp.evaluate(() => window.klibb.peelLast());
    await sleep(1500);
    const left = await (await fetch(`${A.base}/api/rooms/${R1}/stamps`)).json();
    const ids = (left.stamps || left).map((s) => s.id);
    check('Marika peeling her last sticker leaves Jens\'s alone', ids.includes(hJ[0]) && !ids.includes(hM[0]), { ids, hJ, hM });

    // ---- Voice chat: two headless pages with a fake microphone ----
    // Both pages share one fake microphone file, so with both talking at once each echo canceller
    // would (correctly) remove the other's identical signal. So: Jens talks first, then Marika.
    const off0 = await mp.evaluate(() => ({ state: window.klibb.voice().state, peers: window.klibb.voice().peers.length }));
    check('voice: the mic is off by default (no connections)', off0.state === 'off' && off0.peers === 0, off0);
    await jp.evaluate(() => window.klibb.toggleMic());
    const heard = async (page) => page.waitForFunction(() => { const v = window.klibb.voice(); return v.peers.length === 1 && v.peers[0].conn === 'connected' && v.peers[0].hearing; }, null, { timeout: 20000 }).then(() => true).catch(() => false);
    const listen = async (page, ms = 8000) => {
      let lvl = 0, talk = false, mark = false;
      for (let i = 0; i < ms / 200 && !(talk && mark && lvl > 0); i++) {
        const v = await page.evaluate(() => ({ v: window.klibb.voice(), pl: window.klibb.players() }));
        lvl = Math.max(lvl, v.v.peers[0] ? v.v.peers[0].level : 0);
        talk = talk || !!(v.v.peers[0] && v.v.peers[0].talking);
        mark = mark || v.pl.some((p) => p.speaking);
        await sleep(200);
      }
      return { lvl, talk, mark };
    };
    const hm = await heard(mp);
    const vJ = await jp.evaluate(() => window.klibb.voice());
    check('voice: Jens turns his mic on → a WebRTC connection to Marika, she hears him (she has no mic on)', hm && vJ.state === 'on' && vJ.peers[0] && vJ.peers[0].sending, vJ);
    const l1 = await listen(mp);
    let dbg = null;
    if (!(l1.lvl > 0)) dbg = await mp.evaluate(async () => { const v = window.klibb.voiceObj(), p = [...v.peers.values()][0]; let e = null; (await p.pc.getStats()).forEach((r) => { if (r.type === 'inbound-rtp') e = { lvl: r.audioLevel, energy: r.totalAudioEnergy, packets: r.packetsReceived }; }); return e; });
    check('voice: his (fake) voice arrives (audio level > 0)', l1.lvl > 0, dbg || l1);
    check('voice: the speaking indicator lights up above Jens for Marika', l1.talk && l1.mark, l1);
    await mp.screenshot({ path: path.join(SHOTS, '64-demo-voice.png') });
    const vol = await mp.evaluate(async () => { const k = window.klibb, v = k.voiceObj(); v.near = true; k.moveTo(9, 9); v.update(); const far = k.voice().peers[0].volume; k.moveTo(0, 0); v.near = false; v.update(); const off = k.voice().peers[0].volume; v.near = true; return { far, off }; });
    check('voice: proximity volume (far away → quieter, but never below the floor; off → full)', vol.far < 1 && vol.far >= 0.3 && vol.off === 1, vol);
    await jp.evaluate(() => window.klibb.toggleMic()); // mute
    const muted = await jp.evaluate(() => ({ state: window.klibb.voice().state, btn: document.getElementById('mic-btn').dataset.state }));
    check('voice: the second toggle mutes (🎙 shows muted)', muted.state === 'muted' && muted.btn === 'muted', muted);
    // Now Marika talks: her track is added to the same connection (renegotiation) and Jens hears her.
    await mp.evaluate(() => window.klibb.toggleMic());
    const hj = await heard(jp);
    const l2 = await listen(jp);
    check('voice: Marika turns hers on → Jens hears her over the same connection, with the indicator', hj && l2.lvl > 0 && l2.talk && l2.mark, l2);
    await jp.mouse.move(640, 400);
    await jp.keyboard.press('KeyB'); await sleep(200);
    check('voice: B toggles Jens back on', (await jp.evaluate(() => window.klibb.voice().state)) === 'on');

    // ---- Steps and drags coloured per slot ----
    const steps = await mp.evaluate(() => { const k = window.klibb; return { me: k.voiceOf(k.net.id).colour, other: k.voiceOf(k.players()[0].id).colour }; });
    check('footstep/drag sound colours differ per slot (Marika 1, Jens 0)', steps.me === 1 && steps.other === 0, steps);

    // ---- New quick room: straight in, no style picker ----
    await jp.evaluate(() => window.klibb.openMore && window.klibb.openMore());
    await Promise.all([jp.waitForURL((u) => !u.href.includes('room=' + R1), { timeout: 20000 }), jp.evaluate(() => document.getElementById('new-room').click())]);
    await waitReady(jp);
    const q = await jp.evaluate(() => ({ room: window.klibb.room, style: window.klibb.currentStyle(), panel: window.klibb.styleOpen(), name: window.klibb.me().name }));
    check('"New quick room" goes straight into a new empty room (preset, no picker)', q.room !== R1 && !q.panel && q.style.wall === 'kakel' && q.name === 'Jens', q);

    // ---- Phone ----
    const ctxP = await browser.newContext({ ...devices['Pixel 7'] });
    const pp = await enter(ctxP, A.base + '/', 'Phone');
    await pp.waitForURL(/\?room=/, { timeout: 20000 }); await waitReady(pp);
    const ph = await pp.evaluate(() => ({ mic: !!document.querySelector('#stack-menu #sm-mic.mic'), lib: window.klibb.designs().length }));
    check('phone: name dialog, library palette, 🎙 on the sticker stack menu’s Talk card', ph.mic && ph.lib === 6, ph);
    await pp.screenshot({ path: path.join(SHOTS, '65-demo-phone.png') });
    await Promise.all([ctxJ.close(), ctxM.close(), ctxP.close()]);

    // ---- Server B: the room's hour runs out (12 s here) ----
    console.log('Room expiry (server B, DEMO_ROOM_MINUTES=0.2)');
    const ctxE = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    const ep = await enter(ctxE, B.base + '/', 'Clock');
    await ep.waitForURL(/\?room=/, { timeout: 20000 }); await waitReady(ep);
    const RE = await ep.evaluate(() => window.klibb.room);
    await ep.evaluate(async () => { const k = window.klibb; for (const y of [0, Math.PI / 2, Math.PI]) { k.look(y, 0); if (await k.stampAt(0, 0)) break; } });
    await sleep(800);
    const has = (rel) => fs.existsSync(path.join(B.dir, rel));
    const roomFile = () => fs.readdirSync(path.join(B.dir, 'rooms')).some((f) => f.startsWith(RE));
    // a video file must survive; a recording log must go
    fs.mkdirSync(path.join(B.dir, 'videos', RE), { recursive: true }); fs.writeFileSync(path.join(B.dir, 'videos', RE, 'keep.webm'), 'x');
    fs.mkdirSync(path.join(B.dir, 'recordings', RE), { recursive: true }); fs.writeFileSync(path.join(B.dir, 'recordings', RE, 'log.ndjson'), '{}\n');
    const e1 = await ep.evaluate(() => window.klibb.demoState());
    check('timer shows the remaining time', /left/i.test(e1.timer || ''), e1);
    await ep.waitForFunction(() => /min/i.test(document.getElementById('chat-log') ? document.getElementById('chat-log').textContent : '') || window.klibb.demoState().timer.includes('·'), null, { timeout: 4000 }).catch(() => {});
    const warned = await ep.evaluate(() => document.body.textContent.match(/closes in (a minute|\d+ min)/i));
    check('a calm warning appears within the last 5 minutes', !!warned, warned);
    check('before the end: room data exists', roomFile());
    await ep.waitForFunction(() => window.klibb.demoState().closed, null, { timeout: 25000 });
    const e2 = await ep.evaluate(() => ({ ...window.klibb.demoState(), status: window.klibb.net.status }));
    check('at the end: the closed card ("This room has closed"), no reconnect', /closed/i.test(e2.closedTitle) && e2.status !== 'online', e2);
    await ep.screenshot({ path: path.join(SHOTS, '66-demo-closed.png') });
    await sleep(1500);
    const sj = await (await fetch(`${B.base}/api/rooms/${RE}/stamps`)).json();
    const sn = (sj.stamps || sj).length;
    check('room json and stamps are deleted (the room reads as empty)', !roomFile() && sn === 0, { file: roomFile(), stamps: sn });
    check('recordings/<room>/ logs are deleted, videos/ is untouched', !has(`recordings/${RE}/log.ndjson`) && has(`videos/${RE}/keep.webm`));
    const again = await ctxE.newPage(); await again.goto(`${B.base}/?room=${RE}`);
    await again.waitForFunction(() => { const e = document.getElementById('demo-closed'); return e && !e.hidden; }, null, { timeout: 25000 });
    check('coming back to a closed room says it has closed', /closed/i.test(await again.evaluate(() => document.getElementById('demo-closed-text').textContent)));
    await Promise.all([again.waitForURL((u) => !u.href.includes(RE), { timeout: 20000 }), again.click('#demo-closed-new')]);
    await waitReady(again);
    check('"Start a new room" gives a fresh room', (await again.evaluate(() => window.klibb.room)) !== RE);
    await ctxE.close();
  } catch (e) {
    failed++; console.log('  ✗ crashed: ' + (e && e.stack || e));
    try {
      const WebSocket = require('ws');
      for (const room of [global.__R1, 'zzzz99']) {
        const got = await new Promise((res) => { const w = new WebSocket(`ws://localhost:${PORT_A}/ws?room=${room}`); const t = setTimeout(() => { res('timeout'); w.terminate(); }, 3000);
          w.on('open', () => w.send(JSON.stringify({ t: 'hello', name: 'probe', pass: {} }))); w.on('message', (d) => { clearTimeout(t); res(String(d).slice(0, 120)); w.close(); }); w.on('error', (e) => res('err ' + e.message)); });
        console.log('    [probe ' + room + ']', got);
      }
    } catch (e2) { console.log('probe failed', e2.message); }
    console.log('--- server A log (tail) ---\n' + A.log().split('\n').slice(-30).join('\n'));
  } finally {
    await browser.close();
    A.child.kill(); B.child.kill();
    for (const d of [A.dir, B.dir]) fs.rmSync(d, { recursive: true, force: true });
  }
  console.log(`\nDemo e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

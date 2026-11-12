// E2E (Jens t872u, 12 Nov 2026): the noise room's speakers A + B. Own LOCAL_MODE server (port 8964).
// Speakers on the walls, the zone gains at sample spots (and real sound through the gain), silence + no
// download outside the room, and the next random track when one ends (placeholder tones 7–12 s).
const fs = require('fs'); const os = require('os'); const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const SHOTS = process.env.NOISE_SHOTS || '/workspace/noise-speakers/shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 900) : '')); } };
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-noise-'));
  const S = await startServer(Number(process.env.NOISE_E2E_PORT || 8964), { DEMO_PROFILE: '0', OPEN_ACCESS: '1', LOCAL_MODE: '1', ADMIN_TOKEN: '', DATA_DIR: dir });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [], audioReqs = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx.addInitScript(() => { localStorage.setItem('klibb.avatar', JSON.stringify({ name: 'Jens', look: { outfit: 'casual', hair: 'short', shirt: '#3a7bd5', pants: '#333333', hairColor: '#3b2a1a', skin: '#e0b48c', hat: false, hatColor: '#d33' } })); });
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    P.on('request', (r) => { if (/\/noise-speakers\/.+\.mp3/.test(r.url())) audioReqs.push(r.url()); });
    await P.goto(`${S.base}/?room=stad-byggen`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 90000 });
    await P.mouse.click(800, 500).catch(() => {}); await sleep(300);
    if (await P.evaluate(() => window.klibb.escMenu().info().open)) await P.keyboard.press('Escape');
    await sleep(300);
    // the manifest + its caching
    const man = await (await fetch(S.base + '/noise-speakers/manifest.json')).json();
    const mp3 = await fetch(S.base + '/noise-speakers/' + man.tracks[0].file, { headers: { Range: 'bytes=0-1023' } });
    check(`manifest: ${man.tracks.length} tracks; an mp3 streams with range requests (206) and is cached for good`, man.tracks.length >= 2 && mp3.status === 206 && /immutable/.test(mp3.headers.get('cache-control') || ''), { status: mp3.status, cc: mp3.headers.get('cache-control') });

    const models = await P.evaluate(() => window.klibb.noiseSpeakerModels());
    check('speaker A on the west wall, B on the east wall of plot 7, both labelled', models.every(Boolean) && models[0].at[0] < -7 && models[1].at[0] > 7 && models.every((m) => m.at[2] > 31 && m.at[2] < 33 && m.label && m.visible), models);
    const out0 = await P.evaluate(() => window.klibb.noiseSpeakers());
    check('outside the room (spawn): not inside, nothing loaded or downloaded', !out0.inside && out0.players.every((p) => p.paused && !p.src) && audioReqs.length === 0, { out0, audioReqs });

    // inside: an analyser on each speaker's gain = what really comes out
    const go = async (x, z) => { await P.evaluate(([a, b]) => window.klibb.moveTo(a, b), [x, z]); await sleep(900); };
    await go(0, 34); await sleep(2500);
    await P.evaluate(() => {
      const ns = window.klibb.noiseSpeakersObj(); window.__ana = {};
      for (const p of ns.players) { const a = p.gain.context.createAnalyser(); a.fftSize = 2048; p.gain.connect(a); window.__ana[p.id] = a; }
      window.__rms = (id) => { const a = window.__ana[id], b = new Float32Array(a.fftSize); a.getFloatTimeDomainData(b); let s = 0; for (const v of b) s += v * v; return Math.sqrt(s / b.length); };
    });
    const W = 15.2, x0 = -7.6, master = 0.85;
    // wait until both players are really playing (not at a track change, still loading): headless + swiftshader is slow
    const settle = async () => { for (let k = 0; k < 40; k++) { const i = await P.evaluate(() => window.klibb.noiseSpeakers()); if (i.players.every((p) => !p.paused && p.ready >= 3 && p.time > 0.3 && p.time < 6.5)) break; await sleep(250); } await sleep(300); };
    const zone = (t) => (t <= 2 / 3 ? 1 : t >= 8 / 9 ? 0 : 0.99 * (1 - (t - 2 / 3) / (8 / 9 - 2 / 3)));
    const samples = [0.05, 0.2, 0.5, 0.75, 0.95];
    const rows = [];
    for (const u of samples) {
      await go(x0 + u * W, 32); await settle();
      const r = await P.evaluate(async () => { let a = 0, b = 0; for (let k = 0; k < 8; k++) { a = Math.max(a, window.__rms('A')); b = Math.max(b, window.__rms('B')); await new Promise((ok) => setTimeout(ok, 90)); } return { i: window.klibb.noiseSpeakers(), a, b }; }); // loudest of 8 reads over ~0.7 s
      const [A, B] = r.i.players;
      const want = [zone(u), zone(1 - u)];
      rows.push({ u, x: +(x0 + u * W).toFixed(2), A: A.zone, B: B.zone, wantA: +want[0].toFixed(3), wantB: +want[1].toFixed(3), rmsA: +r.a.toFixed(4), rmsB: +r.b.toFixed(4), playing: [!A.paused, !B.paused] });
      check(`x = ${(x0 + u * W).toFixed(2)} (${Math.round(u * 100)} % across): A ${Math.round(A.zone * 100)} % (want ${Math.round(want[0] * 100)}), B ${Math.round(B.zone * 100)} % (want ${Math.round(want[1] * 100)}); sound out: A ${r.a.toFixed(3)}, B ${r.b.toFixed(3)}`,
        Math.abs(A.zone - want[0]) < 0.01 && Math.abs(B.zone - want[1]) < 0.01
        && (want[0] > 0.3 ? r.a > 0.01 : r.a < 0.003) && (want[1] > 0.3 ? r.b > 0.01 : r.b < 0.003), rows[rows.length - 1]);
    }
    fs.writeFileSync(path.join(SHOTS, 'zones.json'), JSON.stringify(rows, null, 2));
    check(`gains carry the master (${master})`, await P.evaluate((m) => { const i = window.klibb.noiseSpeakers(); return Math.abs(i.players[0].gain - i.players[0].zone * m) < 0.01; }, master));
    // same track for two players: a 2nd page in the room hears the same file at (about) the same second
    const P2 = await ctx.newPage(); P2.on('pageerror', (e) => errors.push('P2: ' + e.message));
    await P2.goto(`${S.base}/?room=stad-byggen`); await P2.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 90000 });
    await P2.mouse.click(800, 500).catch(() => {}); if (await P2.evaluate(() => window.klibb.escMenu().info().open)) await P2.keyboard.press('Escape');
    await P2.evaluate(() => window.klibb.moveTo(0, 32)); await sleep(3000);
    // (read a few times: a read that falls on a track change, while one page is still loading the next file, doesn't count)
    let i1, i2, same = false;
    for (let k = 0; k < 10 && !same; k++) {
      [i1, i2] = await Promise.all([P.evaluate(() => window.klibb.noiseSpeakers()), P2.evaluate(() => window.klibb.noiseSpeakers())]);
      same = i1.players.every((p, n) => p.file === i2.players[n].file && p.ready >= 3 && i2.players[n].ready >= 3 && Math.abs(p.time - i2.players[n].time) < 1.6);
      if (!same) await sleep(700);
    }
    check(`two players in the room: the same tracks on A and B at about the same second (A ${i1.players[0].time} / ${i2.players[0].time} s, B ${i1.players[1].time} / ${i2.players[1].time} s)`, same, { a: i1.players, b: i2.players });
    await P2.close();
    // the next track when one ends
    const before = await P.evaluate(() => window.klibb.noiseSpeakers());
    await sleep(14000);
    const after = await P.evaluate(() => window.klibb.noiseSpeakers());
    check(`next random track after the end: A ${before.players[0].plays} → ${after.players[0].plays} plays, B ${before.players[1].plays} → ${after.players[1].plays}; still playing`,
      after.players.every((p, k) => p.plays > before.players[k].plays && !p.paused), { before: before.players, after: after.players, log: after.log });
    const seq = after.log.filter((l) => l.speaker === 'A').map((l) => l.file);
    check(`never the same track twice in a row (A: ${seq.join(' → ')})`, seq.every((f, k) => k === 0 || f !== seq[k - 1]), seq);
    // screenshots (large): looking at A (west) and at B (east) from the middle
    await go(0, 32); await P.evaluate(() => window.klibb.look(Math.PI / 2, 0.05)); await sleep(800);
    await P.screenshot({ path: path.join(SHOTS, '01-speaker-A-west-wall.png') });
    await P.evaluate(() => window.klibb.look(-Math.PI / 2, 0.05)); await sleep(800);
    await P.screenshot({ path: path.join(SHOTS, '02-speaker-B-east-wall.png') });
    await go(0, 39); await P.evaluate(() => window.klibb.look(0, 0.12)); await sleep(800);
    await P.screenshot({ path: path.join(SHOTS, '03-both-speakers-from-the-opening.png') });
    // out of the room: silent, paused, no more downloads
    await go(0, 44); await sleep(600);
    const nReq = audioReqs.length;
    const out = await P.evaluate(() => ({ i: window.klibb.noiseSpeakers(), a: window.__rms('A'), b: window.__rms('B') }));
    await sleep(3000);
    check('out through the opening: both paused, no src, gain 0, no sound, no further downloads', !out.i.inside && out.i.players.every((p) => p.paused && !p.src && p.gain === 0) && out.a < 0.001 && out.b < 0.001 && audioReqs.length === nReq, { out, n: [nReq, audioReqs.length] });
    await go(-32, 0); // the reverb room: nothing either
    check('in another FX room (reverb, plot 4): silent', await P.evaluate(() => { const i = window.klibb.noiseSpeakers(); return !i.inside && i.players.every((p) => p.paused); }));
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e && e.stack)); }
  finally { await browser.close(); S.child.kill(); }
  console.log(`e2e-noisespeakers: ${passed} ok, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

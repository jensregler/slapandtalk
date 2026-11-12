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
    await P.goto(`${S.base}/?room=stad-byggen&noiseplaylist=test`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 90000 });
    await P.mouse.click(800, 500).catch(() => {}); await sleep(300);
    if (await P.evaluate(() => window.klibb.escMenu().info().open)) await P.keyboard.press('Escape');
    await sleep(300);
    // the manifest + its caching
    const man = await (await fetch(S.base + '/noise-speakers/manifest.json')).json();
    const mp3 = await fetch(S.base + '/noise-speakers/' + man.tracks[0].file, { headers: { Range: 'bytes=0-1023' } });
    check(`the real playlist: ${man.tracks.length} tracks (${(man.tracks.reduce((s, t) => s + t.duration, 0) / 60).toFixed(0)} min), no test tones; an mp3 streams with range requests (206) and is cached for good`, man.tracks.length >= 2 && !man.tracks.some((t) => t.placeholder) && mp3.status === 206 && /immutable/.test(mp3.headers.get('cache-control') || ''), { status: mp3.status, cc: mp3.headers.get('cache-control') });
    const tman = await (await fetch(S.base + '/noise-speakers/test/manifest.json')).json();
    check(`the test playlist (?noiseplaylist=test): ${tman.tracks.length} short tones`, tman.tracks.length === 3 && tman.tracks.every((t) => t.duration < 15));

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
    // the ceiling lamps (t875u): 2 west ← A, 2 east ← B; the existing lights' intensity follows each speaker's own level
    {
      await settle();
      const reads = [];
      for (let k = 0; k < 12; k++) { reads.push(await P.evaluate(() => window.klibb.noiseSpeakers())); await sleep(120); }
      const L = reads[0].lamps, lights = await P.evaluate(() => window.klibb.pointLights ? window.klibb.pointLights() : null);
      check(`lamps split by half: A ${L.A.length} west (x ${L.A.map((l) => l.x)}), B ${L.B.length} east (x ${L.B.map((l) => l.x)})`, L.A.length === 2 && L.B.length === 2 && L.A.every((l) => l.x < 0) && L.B.every((l) => l.x > 0), L);
      const iA = reads.map((r) => r.lamps.A[0].intensity), iB = reads.map((r) => r.lamps.B[0].intensity), base = L.A[0].base;
      const spread = (a) => Math.max(...a) - Math.min(...a);
      check(`A lamps move with A (${Math.min(...iA).toFixed(2)} … ${Math.max(...iA).toFixed(2)} of base ${base}), B lamps with B (${Math.min(...iB).toFixed(2)} … ${Math.max(...iB).toFixed(2)}); never below the glow`,
        spread(iA) > 0.005 * base && spread(iB) > 0.005 * base && [...iA, ...iB].every((v) => v >= base * 0.35 - 1e-6 && v <= base * 1.5 + 1e-6), { iA, iB });
      check('a lamp = base × (min + (max − min) × that speaker\'s level), the level from its RMS (before the position gain)', reads.every((r) => r.players.every((p) => { const want = base * (0.35 + 1.15 * p.level); return r.lamps[p.id].every((l) => Math.abs(l.intensity - want) < 0.05 * base + 0.01); })) && reads.some((r) => r.players[1].rms > 0.01), reads.slice(-1)[0]);
      await go(0, 38.6); await P.evaluate(() => window.klibb.look(0, 0.55)); await sleep(600);
      await P.screenshot({ path: path.join(SHOTS, '04-lamps-follow-the-speakers.png') });
    }
    check(`gains carry the master (${master})`, await P.evaluate((m) => { const i = window.klibb.noiseSpeakers(); return Math.abs(i.players[0].gain - i.players[0].zone * m) < 0.01; }, master));
    // same track for two players: a 2nd page in the room hears the same file at (about) the same second
    const ctx2 = await browser.newContext({ viewport: { width: 480, height: 320 } }); // a light 2nd player (swiftshader is slow)
    await ctx2.addInitScript(() => { localStorage.setItem('klibb.avatar', JSON.stringify({ name: 'Ann', look: { outfit: 'casual', hair: 'short', shirt: '#d53a3a', pants: '#333333', hairColor: '#3b2a1a', skin: '#e0b48c', hat: false, hatColor: '#d33' } })); });
    const P2 = await ctx2.newPage(); P2.on('pageerror', (e) => errors.push('P2: ' + e.message));
    await P2.goto(`${S.base}/?room=stad-byggen&noiseplaylist=test`); await P2.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 90000 });
    await P2.mouse.click(240, 160).catch(() => {}); if (await P2.evaluate(() => window.klibb.escMenu().info().open)) await P2.keyboard.press('Escape');
    await P2.evaluate(() => window.klibb.moveTo(0, 32)); await sleep(3000);
    // (read a few times: a read that falls on a track change, while one page is still loading the next file, doesn't count)
    let i1, i2, same = false;
    for (let k = 0; k < 20 && !same; k++) {
      [i1, i2] = await Promise.all([P.evaluate(() => window.klibb.noiseSpeakers()), P2.evaluate(() => window.klibb.noiseSpeakers())]);
      same = i1.players.every((p, n) => p.file === i2.players[n].file && p.ready >= 3 && i2.players[n].ready >= 3 && Math.abs(p.time - i2.players[n].time) < 1.6);
      if (!same) await sleep(700);
    }
    check(`two players in the room: the same tracks on A and B at about the same second (A ${i1.players[0].time} / ${i2.players[0].time} s, B ${i1.players[1].time} / ${i2.players[1].time} s)`, same, { a: i1.players, b: i2.players });
    await P2.close();
    // the next track when one ends
    const before = await P.evaluate(() => window.klibb.noiseSpeakers());
    await sleep(14000);
    let after = await P.evaluate(() => window.klibb.noiseSpeakers());
    for (let k = 0; k < 12 && after.players.some((p) => p.paused); k++) { await sleep(250); after = await P.evaluate(() => window.klibb.noiseSpeakers()); } // (a read right at a track change)
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
    // out through the door (t879u + t880u): radial 4 m from the opening (x −2.2 … 2.2, z 40), outside only, never through walls
    const doorRows = [];
    const doorAt = async (label, x, z, want) => {
      await go(x, z); if (want > 0) await settle(); else await sleep(500);
      const r = await P.evaluate(async () => { let a = 0, b = 0; for (let k = 0; k < 8; k++) { a = Math.max(a, window.__rms('A')); b = Math.max(b, window.__rms('B')); await new Promise((ok) => setTimeout(ok, 90)); } return { i: window.klibb.noiseSpeakers(), a, b }; });
      const [A, B] = r.i.players; doorRows.push({ label, x, z, door: r.i.door, A: A.zone, B: B.zone, want, rmsA: +r.a.toFixed(4), rmsB: +r.b.toFixed(4), active: r.i.inside });
      check(`${label}: door distance ${r.i.door ?? '–'} m → A ${Math.round(A.zone * 100)} %, B ${Math.round(B.zone * 100)} % (want ${Math.round(want * 100)}); sound out A ${r.a.toFixed(3)}, B ${r.b.toFixed(3)}`,
        Math.abs(A.zone - want) < 0.01 && Math.abs(B.zone - want) < 0.01 && (want > 0.2 ? r.a > 0.005 && r.b > 0.005 : want === 0 ? r.a < 0.003 && r.b < 0.003 : true), doorRows[doorRows.length - 1]);
      return r;
    };
    await doorAt('inside, middle (unchanged)', 0, 32, 1);
    for (const d of [0, 1, 2, 3, 4, 5]) await doorAt(`${d} m out in front of the door`, 0, 40 + d, Math.max(0, 1 - d / 4));
    await doorAt('2 m out, 2 m east of the opening (radial: 2.83 m)', 4.2, 42, 1 - Math.hypot(2, 2) / 4);
    const beside = await doorAt('beside the room, behind the east wall (2 m from the door corner)', 9.6, 38, 0);
    check('beside the room: no sound through the wall, players paused', !beside.i.inside && beside.i.players.every((p) => p.paused));
    await doorAt('behind the west wall', -9.6, 32, 0);
    await doorAt('behind the north wall', 0, 22.5, 0);
    fs.writeFileSync(path.join(SHOTS, 'door.json'), JSON.stringify(doorRows, null, 2));
    await go(0, 42); await settle(); await P.evaluate(() => window.klibb.look(0, 0.05)); await sleep(700);
    await P.screenshot({ path: path.join(SHOTS, '05-two-metres-out-in-front-of-the-door.png') });
    await go(0, 46); await sleep(600); // 6 m out: past the 4 m fade and the 1 m keep margin
    const nReq = audioReqs.length;
    const out = await P.evaluate(() => ({ i: window.klibb.noiseSpeakers(), a: window.__rms('A'), b: window.__rms('B') }));
    await sleep(3000);
    check('6 m out from the door: both paused, no src, gain 0, no sound, no further downloads', !out.i.inside && out.i.players.every((p) => p.paused && !p.src && p.gain === 0) && out.a < 0.001 && out.b < 0.001 && audioReqs.length === nReq, { out, n: [nReq, audioReqs.length] });
    const rest = await P.evaluate(() => window.klibb.noiseSpeakers().lamps);
    check('outside: the lamps back to their normal light', [...rest.A, ...rest.B].every((l) => Math.abs(l.intensity - l.base) < 0.01), rest);
    await go(-32, 0); // the reverb room: nothing either
    check('in another FX room (reverb, plot 4): silent', await P.evaluate(() => { const i = window.klibb.noiseSpeakers(); return !i.inside && i.players.every((p) => p.paused); }));
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e && e.stack)); }
  finally { await browser.close(); S.child.kill(); }
  console.log(`e2e-noisespeakers: ${passed} ok, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

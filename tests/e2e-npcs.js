// E2E (Jens t873u, 12 Nov 2026): dancing NPCs in the city. Three on the plaza (12 m apart) + four in the streets,
// the same for everyone (server welcome, seeded by the city), dancing the X loop on the server clock, their own
// Steps sound + tempo + walk/run/crouch, heard like a remote player (spatial, quieter with distance), not counted
// in "N here". Own LOCAL_MODE server (port 8967). Screenshots → NPCS_SHOTS (default /workspace/dancing-npcs).
const fs = require('fs'); const os = require('os'); const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 1200) : '')); } };
const SHOTS = process.env.NPCS_SHOTS || '/workspace/dancing-npcs';
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-npcs-'));
  const S = await startServer(Number(process.env.NPCS_E2E_PORT || 8967), { DEMO_PROFILE: '0', OPEN_ACCESS: '1', LOCAL_MODE: '1', ADMIN_TOKEN: '', DATA_DIR: dir });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const ROOM = process.env.NPCS_ROOM || 'stad-byggen';
  try {
    const open = async (name, vp = { width: 1600, height: 1000 }) => {
      const ctx = await browser.newContext({ viewport: vp });
      await ctx.addInitScript((n) => { localStorage.setItem('klibb.avatar', JSON.stringify({ name: n, look: { outfit: 'tshirt', hair: 'kort', shirt: '#3a86ff', pants: '#2b4c7e', hairColor: '#3b2a1a', skin: '#e0b48c', hat: false, hatColor: '#d33' } })); }, name);
      const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(name + ': ' + e.message));
      await P.goto(`${S.base}/?room=${ROOM}`);
      await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.net.id, null, { timeout: 90000 });
      await P.mouse.click(vp.width / 2, vp.height / 2).catch(() => {}); await sleep(300);
      if (await P.evaluate(() => window.klibb.escMenu().info().open)) await P.keyboard.press('Escape');
      await P.evaluate(() => window.klibb.setView && window.klibb.setView('first'));
      return P;
    };
    const A = await open('Jens');
    await A.waitForFunction(() => window.klibb.npcs().count > 0 && window.klibb.npcs().npcs.every((n) => n.built), null, { timeout: 30000 });
    // stand south of the plaza, looking north over it: all three in view
    await A.evaluate(() => { window.klibb.moveTo(0, -7.2); window.klibb.look(0, -0.12); });
    await sleep(2500);
    const n0 = await A.evaluate(() => window.klibb.npcs());
    const plaza = n0.npcs.filter((n) => n.plaza);
    const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    check(`7 NPCs from the server, 3 on the plaza (${plaza.map((n) => n.label).join(', ')})`, n0.count === 7 && plaza.length === 3, n0.npcs.map((n) => [n.id, n.x, n.z, n.plaza]));
    check(`plaza NPCs ${d(plaza[0], plaza[1]).toFixed(1)} / ${d(plaza[1], plaza[2]).toFixed(1)} / ${d(plaza[0], plaza[2]).toFixed(1)} m apart`, [d(plaza[0], plaza[1]), d(plaza[1], plaza[2]), d(plaza[0], plaza[2])].every((x) => x > 10 && x < 14));
    check('labelled as NPCs (name tag "<name> · NPC")', n0.npcs.every((n) => /· NPC$/.test(n.tag || '')), n0.npcs.map((n) => n.tag));
    check('plaza NPCs visible and dancing (looping X dance)', plaza.every((n) => n.visible && n.dancing && n.danceBpm >= 60 && n.danceBpm <= 180), plaza);
    const t1 = await A.evaluate(() => window.klibb.npcs().npcs.map((n) => n.danceTime)); await sleep(700);
    const t2 = await A.evaluate(() => window.klibb.npcs().npcs.map((n) => n.danceTime));
    check('the dance moves on (dance time advances)', plaza.every((n, i) => t2[n0.npcs.indexOf(n)] !== t1[n0.npcs.indexOf(n)]), { t1, t2 });
    const bpms = new Set(n0.npcs.map((n) => n.walkBpm)), slots = new Set(n0.npcs.map((n) => n.slot)), freqs = new Set(n0.npcs.map((n) => n.step.find((l) => l.kind === 'osc')?.freq));
    check(`randomized: Tempo ${[...bpms].join('/')} BPM (5 BPM grid), slots ${[...slots].join('/')}, step osc ${[...freqs].join('/')} Hz`, bpms.size >= 4 && freqs.size >= 4 && n0.npcs.every((n) => n.walkBpm % 5 === 0 && n.walkBpm >= 30 && n.walkBpm <= 3000), n0.npcs.map((n) => [n.walkBpm, n.slot, n.run]));
    const pres = await A.evaluate(() => document.getElementById('presence-text').textContent);
    check(`not counted as players: "${pres}", players() = []`, /Just you/.test(pres) && (await A.evaluate(() => window.klibb.players().length)) === 0, pres);
    await A.screenshot({ path: path.join(SHOTS, '01-plaza-three-npcs.png') });
    // a closer, higher look (the third-person camera behind me)
    await A.evaluate(() => { window.klibb.moveTo(0, -10.5); window.klibb.look(0, -0.22); window.klibb.setView('third'); });
    await sleep(1800);
    await A.screenshot({ path: path.join(SHOTS, '02-plaza-three-npcs-third-person.png') });
    await A.evaluate(() => window.klibb.setView('first'));
    // a second player sees the same NPCs at the same beat, in the same gait
    const B = await open('Guest');
    await B.waitForFunction(() => window.klibb.npcs().count > 0 && window.klibb.npcs().npcs.every((n) => n.built), null, { timeout: 30000 });
    await B.evaluate(() => { window.klibb.moveTo(0, -7.2); window.klibb.look(0, -0.12); }); await sleep(1200);
    const [ia, ib] = await Promise.all([A, B].map((P) => P.evaluate(() => ({ n: window.klibb.npcs(), off: window.klibb.groove().offset, gaits: [0, 1, 2, 3, 4, 5].map((k) => window.klibb.npcsObj().gaitsAt(1794500000000 + k * 7777)) }))));
    const sameList = JSON.stringify(ia.n.npcs.map((n) => [n.id, n.label, n.x, n.z, n.walkBpm, n.scale, n.slot, n.run, n.step])) === JSON.stringify(ib.n.npcs.map((n) => [n.id, n.label, n.x, n.z, n.walkBpm, n.scale, n.slot, n.run, n.step]));
    const sameDance = ia.n.npcs.every((n, i) => n.danceAt === 0 && ib.n.npcs[i].danceAt === 0 && n.danceBpm === ib.n.npcs[i].danceBpm);
    check(`B sees the same 7 NPCs (look, place, Steps sound, tempo, run/crouch), the same dance anchor + BPM, the same gait schedule (server-clock offsets here ${Math.abs(ia.off - ib.off).toFixed(0)} ms apart: a busy software-GL tab reads the welcome late – the same clock every player's dance and steps use)`,
      sameList && sameDance && JSON.stringify(ia.gaits) === JSON.stringify(ib.gaits), { ia: ia.n.npcs.map((n) => [n.danceAt, n.danceBpm]), ib: ib.n.npcs.map((n) => [n.danceAt, n.danceBpm]), off: [ia.off, ib.off] });
    await B.screenshot({ path: path.join(SHOTS, '03-plaza-seen-by-second-player.png') });
    const presAB = await A.evaluate(() => document.getElementById('presence-text').textContent);
    check(`with B in: "${presAB}" (NPCs still not counted)`, /^2 here/.test(presAB), presAB);
    await B.close();
    // ---- audio: steps of the nearest NPCs, spatial, quieter with distance ----
    const p0 = plaza[0];
    const at = async (x, z, ms = 2600) => {
      await A.evaluate(([x, z]) => window.klibb.moveTo(x, z), [x, z]); await sleep(900); // (steps already scheduled ahead from the last spot land first)
      await A.evaluate(() => { window.klibb.soundObj().npcHeard = {}; }); await sleep(ms);
      return A.evaluate(() => ({ heard: window.klibb.soundObj().npcHeard || {}, ctx: window.klibb.soundObj().ctx?.state, skipped: window.klibb.soundObj().stepsSkipped || 0, info: window.klibb.npcs(), tracks: window.klibb.groove().tracks.filter((t) => /^npc-/.test(t.id)) }));
    };
    const near = await at(p0.x + 1.2, p0.z + 0.6);
    const ids = Object.keys(near.heard);
    check(`audio running (${near.ctx}); step voices made for ${ids.length} NPCs (${ids.map((k) => k + ' ×' + near.heard[k].n).join(', ')}), ${near.tracks.length} NPC groove tracks, the nearest ${near.info.heard} heard (max 4)`, near.ctx === 'running' && ids.length >= 2 && near.tracks.length >= 1 && near.info.heard <= 4, near);
    const hn = near.heard[p0.id];
    check(`next to ${p0.label} (${hn?.distance} m from my ears): its steps at gain ${hn?.gain}`, hn && hn.n >= 2 && hn.gain > 0.7, near.heard);
    const mid = await at(p0.x + 6, p0.z + 8), far = await at(p0.x + 12, p0.z + 20);
    const hm = mid.heard[p0.id], hf = far.heard[p0.id];
    check(`volume falls with distance for ${p0.label}: ${hn?.gain} (${hn?.distance} m) → ${hm?.gain} (${hm?.distance} m) → ${hf ? hf.gain + ' (' + hf.distance + ' m)' : 'not scheduled (not among the 4 nearest)'}`, hn && hm && hn.gain > hm.gain && (!hf || hm.gain > hf.gain), { hn, hm, hf });
    // between two plaza NPCs: both heard, each at its own level (the "volume range")
    const mid2 = await at((plaza[0].x + plaza[1].x) / 2 - 2, plaza[0].z + 0.5);
    const a0 = mid2.heard[plaza[0].id], a1 = mid2.heard[plaza[1].id];
    check(`walking between ${plaza[0].name} and ${plaza[1].name}: both heard, the nearer louder (${a0?.gain} at ${a0?.distance} m vs ${a1?.gain} at ${a1?.distance} m)`, a0 && a1 && a0.gain > a1.gain, mid2.heard);
    // across the city: nothing scheduled for the plaza NPCs, the far ones not animated
    const away = await at(30, 44, 1500);
    const plazaAway = away.info.npcs.filter((n) => n.plaza);
    check('far away: no plaza NPC step played', !Object.keys(away.heard).some((k) => plazaAway.some((n) => n.id === k)), away.heard);
    check(`far away (30, 44): plaza NPCs ${plazaAway.map((n) => n.dist.toFixed(0) + ' m').join(', ')} not heard (no groove tracks) and hidden past ${60} m`, plazaAway.every((n) => !n.audible) && !away.tracks.some((t) => plazaAway.some((n) => n.id === t.id)) && plazaAway.filter((n) => n.dist > 60).every((n) => !n.visible), { plazaAway, tracks: away.tracks });
    // ---- perf: frame time with and without the NPCs (same spot, looking at the plaza) ----
    await A.evaluate(() => { window.klibb.moveTo(0, -7.2); window.klibb.look(0, -0.12); }); await sleep(1500);
    const frames = (ms) => A.evaluate((ms) => new Promise((res) => { const ts = []; let last = performance.now(); const end = last + ms; const f = (t) => { ts.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else { ts.sort((a, b) => a - b); res({ n: ts.length, avg: +(ts.reduce((s, x) => s + x, 0) / ts.length).toFixed(2), p50: +ts[Math.floor(ts.length / 2)].toFixed(2), p95: +ts[Math.floor(ts.length * 0.95)].toFixed(2) }); } }; requestAnimationFrame(f); }), ms);
    await frames(2000); // warm-up
    const withN = await frames(5000);
    const cost = await A.evaluate(() => window.klibb.npcs().costMs);
    const list = await A.evaluate(() => { const o = window.klibb.npcsObj(); const l = o.list.slice(); o.clear(); window.__npcList = l; return l.length; });
    await sleep(800);
    const without = await frames(5000);
    await A.evaluate(() => window.klibb.npcsObj().set(window.__npcList)); await sleep(1500);
    const withN2 = await frames(5000);
    const perf = { withNpcs: withN, withoutNpcs: without, withNpcsAgain: withN2, npcUpdateMs: cost, list };
    fs.writeFileSync(path.join(SHOTS, 'perf.json'), JSON.stringify(perf, null, 2));
    console.log('    perf', JSON.stringify(perf));
    const best = Math.min(withN.avg, withN2.avg), hit = best - without.avg;
    // (software WebGL here – swiftshader – so a whole frame is ~100+ ms; the check is relative)
    check(`frame time: ${best} ms with 3 NPCs on screen vs ${without.avg} ms without (${hit >= 0 ? '+' : ''}${hit.toFixed(1)} ms, ${(100 * hit / without.avg).toFixed(0)} %; NPC update ${cost} ms/frame)`, hit < without.avg * 0.5 && cost < 3, perf); // (a loaded box with software GL is noisy: the CPU cost of the NPCs themselves is the firm number)
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e && e.stack)); }
  finally { await browser.close(); S.child.kill(); }
  console.log(`e2e-npcs: ${passed} ok, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

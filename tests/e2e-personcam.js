// e2e: a cameraman per participant + the slap motion on the filmed avatar (own server on 8875;
// never 8787). Two people in a room, a recording while one walks and slaps and the other walks;
// the replay offers one view per person ('person:<id>', "🎥 Cameraman: <name>"); through each,
// that person stays in the picture over many frames; the slap's arm movement is on that avatar
// in the replay (pinned to the recording's clock: hand at the wall just after the slap, back
// down later), and live: looking through the auto cameraman shows my own avatar (first person too).
// Screenshots (not committed): AUTOCAM_SHOTS=/workspace/autocam-shots node tests/e2e-personcam.js
// Run: node tests/e2e-personcam.js   (needs a built client: npx vite build)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.PERSONCAM_E2E_PORT || 8875);
const SHOTS = process.env.AUTOCAM_SHOTS || '';
let passed = 0, failed = 0;
const check = (name, ok, info = '') => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (info ? '  — ' + JSON.stringify(info) : '')); } };
// world point → screen (-1…1) for the replay's camera { p, q (quaternion), fov, aspect }
function project(eye, pt) {
  const [x, y, z, w] = eye.q;
  const rot = (v) => { // q · v · q⁻¹
    const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
  };
  const f = rot([0, 0, -1]), u = rot([0, 1, 0]), r = rot([1, 0, 0]);
  const d = pt.map((v, i) => v - eye.p[i]), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const zc = dot(d, f); if (zc <= 0.05) return null;
  const th = Math.tan((eye.fov * Math.PI) / 360);
  return [dot(d, r) / zc / (th * eye.aspect), dot(d, u) / zc / th];
}

(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '' });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  try {
    const { room: { id: R }, roomKey: KEY } = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const api = (m, p, body = {}) => fetch(`${S.base}/api/rooms/${R}${p}`, { method: m, headers: { 'Content-Type': 'application/json', 'x-room-key': KEY }, body: JSON.stringify(body) }).then((r) => r.json());
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    await ctx.addInitScript(([r, k]) => localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })), [R, KEY]);
    const A = await ctx.newPage(); A.on('pageerror', (e) => errors.push(e.message));
    await A.goto(`${S.base}/?room=${R}`);
    await A.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    const ctxB = await browser.newContext({ viewport: { width: 640, height: 360 } });
    const B = await ctxB.newPage(); B.on('pageerror', (e) => errors.push(e.message));
    await B.goto(`${S.base}/?room=${R}`);
    await B.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    await A.waitForFunction(() => window.klibb.players().length === 1 && window.klibb.net.id, null, { timeout: 15000 });
    const idA = await A.evaluate(() => window.klibb.net.id), idB = await B.evaluate(() => window.klibb.net.id);

    // ---------- Live: looking through the auto cameraman shows my own avatar (also in first person) ----------
    await A.evaluate(() => window.klibb.setView('first', { quiet: true }));
    await A.evaluate(() => window.klibb.setAutoCam(true));
    await A.waitForFunction(() => window.klibb.cameras().some((c) => c.auto), null, { timeout: 10000 });
    const before = await A.evaluate(() => window.klibb.selfAvatar());
    const camId = await A.evaluate(() => window.klibb.cameras().find((c) => c.auto).id);
    await A.evaluate((id) => window.klibb.enterCamView(id), camId);
    await A.waitForFunction(() => { const s = window.klibb.selfAvatar(); return s.built && s.visible; }, null, { timeout: 15000 }).catch(() => {});
    const through = await A.evaluate(() => window.klibb.selfAvatar());
    check('live, first person: my own avatar is not shown in my own eyes', !before.visible, before);
    check('live: looking through the auto cameraman, my own avatar is there to be filmed', through.built && through.visible, through);
    await A.evaluate(() => window.klibb.exitCamView());
    await sleep(300);
    const after = await A.evaluate(() => window.klibb.selfAvatar());
    check('…and back in my own eyes it is hidden again', !after.visible, after);

    // ---------- A recording: A walks and slaps, B walks ----------
    await A.setInputFiles('#file', path.join(__dirname, 'demo-klibba.png'));
    await A.waitForFunction(() => window.klibb.state.selected);
    const rec = await api('POST', '/recording/start');
    const walk = async (page, from, to, ms) => { const n = Math.ceil(ms / 100); for (let i = 0; i <= n; i++) { const k = i / n; await page.evaluate(([x, z]) => window.klibb.moveTo(x, z), [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k]); await sleep(100); } };
    await Promise.all([walk(A, [-2, 0], [0, -3.2], 2500), walk(B, [2, 2], [3, -1], 2500)]);
    const slap = async () => { await A.evaluate(() => window.klibb.look(0, 0.15)); await sleep(250); return A.evaluate(() => window.klibb.stampAt(0, 0).then((s) => s && s.id)); };
    const s1 = await slap(); await sleep(1500);
    await Promise.all([walk(A, [0, -3.2], [1.5, -3.2], 1500), walk(B, [3, -1], [0, 1.5], 1500)]);
    const s2 = await slap(); await sleep(1200);
    await Promise.all([walk(A, [1.5, -3.2], [-1, 1], 2000), walk(B, [0, 1.5], [-3, 3], 2000)]);
    await sleep(500);
    const stop = await api('POST', '/recording/stop');
    const REC = (stop.recording || rec.recording).recId;
    const log = (await (await fetch(`${S.base}/api/rooms/${R}/recordings/${REC}/log`, { headers: { 'x-room-key': KEY } })).text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const slaps = log.filter((e) => e.e === 'stamp:add' && e.by === idA);
    check('the recording knows who slapped (stamp:add by = A, 2 slaps)', s1 && s2 && slaps.length === 2, { s1, s2, n: slaps.length });

    // ---------- The replay ----------
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${R}&replay=${REC}`);
    await P.waitForFunction(() => window.replay && window.replay.ready, null, { timeout: 30000 });
    const views = await P.evaluate(() => window.replay.views());
    const labels = await P.evaluate(() => [...document.querySelectorAll('#rp-view option')].map((o) => [o.value, o.textContent]));
    check('replay: one cameraman view per participant (person:<id>), labelled "🎥 Cameraman: <name>", next to the room cameraman', views.includes(`person:${idA}`) && views.includes(`person:${idB}`) && labels.filter(([v, l]) => v.startsWith('person:') && /Cameraman: /.test(l)).length === 2 && views.some((v) => v.startsWith('autocam:')), labels);
    const end = await P.evaluate(() => window.replay.duration);
    const at = async (t) => { await P.evaluate((t) => { window.replay.pause(); window.replay.seek(t); }, t); await sleep(120); return P.evaluate(() => window.replay.state()); };
    for (const [id, who] of [[idA, 'A'], [idB, 'B']]) {
      await P.evaluate((v) => window.replay.setView(v), `person:${id}`);
      let n = 0, inside = 0, worst = 0, kinds = new Set();
      for (let t = 300; t < end - 100; t += 250) {
        const st = await at(t), pl = st.players.find((x) => x.id === id); if (!pl) continue;
        const face = project(st.eye, [pl.pos[0], 1.55, pl.pos[2]]); n++;
        const m = face ? Math.max(Math.abs(face[0]), Math.abs(face[1])) : 9; worst = Math.max(worst, m); if (m <= 0.95) inside++;
        if (st.shot && st.shot.size) kinds.add(st.shot.size);
      }
      check(`replay, person:${who}: the person is in the picture in every sampled frame (${n} frames, worst |ndc| ${worst.toFixed(2)})`, n >= 20 && inside === n, { n, inside, worst });
      check(`…the shots vary (${[...kinds].join(', ')})`, kinds.size >= 2, [...kinds]);
    }
    // the same moment through both cameramen: the recording's clock (time-aligned)
    await P.evaluate((v) => window.replay.setView(v), `person:${idA}`); const ta = await at(4000);
    await P.evaluate((v) => window.replay.setView(v), `person:${idB}`); const tb = await at(4000);
    check('switching views keeps the moment (time-aligned tracks)', ta.t === 4000 && tb.t === 4000 && JSON.stringify(ta.players.map((p) => p.pos)) === JSON.stringify(tb.players.map((p) => p.pos)) && ta.eye.p.join() !== tb.eye.p.join(), { ta: ta.eye.p, tb: tb.eye.p });

    // ---------- The slap motion on the filmed avatar ----------
    await P.evaluate((v) => window.replay.setView(v), `person:${idA}`);
    const wall = slaps[0].stamp.position;
    const handDist = (g) => Math.min(...g.hands.map((h) => Math.hypot(h[0] - wall[0], h[1] - wall[1], h[2] - wall[2])));
    await at(slaps[0].t + 60); await sleep(200);
    const g1 = await P.evaluate((id) => window.replay.gesture(id), idA);
    await at(slaps[0].t + 1200); await sleep(200);
    const g2 = await P.evaluate((id) => window.replay.gesture(id), idA);
    await at(slaps[0].t + 60); await sleep(200);
    const g3 = await P.evaluate((id) => window.replay.gesture(id), idA);
    const gB = await P.evaluate((id) => window.replay.gesture(id), idB);
    check('replay: just after the slap the arm is up, reaching for the wall, on the filmed avatar (pinned to the recording clock)', g1 && g1.active && g1.pinned && g1.kind === 'slap' && Math.abs(g1.age - 60) < 30 && g2 && handDist(g1) < handDist(g2) - 0.2 && Math.max(...g1.hands.map((h) => h[1])) > 1.25, { g1, d: g1 && handDist(g1), rest: g2 && handDist(g2) });
    check('…a second later the arm is back down', g2 && !g2.active && Math.max(...g2.hands.map((h) => h[1])) < 1.1, { g2 });
    check('…seeking back shows the same arm pose again (deterministic)', g3 && g3.active && Math.abs(handDist(g3) - handDist(g1)) < 0.02, { d1: handDist(g1), d3: g3 && handDist(g3) });
    check('…and only on the one who slapped', gB && !gB.active, gB);
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      const near = await at(slaps[0].t + 60); await sleep(300);
      await P.screenshot({ path: path.join(SHOTS, 'person-A-slap.png') });
      // a close-up and a wide shot of A
      const pick = await P.evaluate(([id, end]) => { const out = {}; for (let t = 0; t < end; t += 100) { const q = window.replay.personPose(id, t); if (q && t - q.shot.from > 1500 && !out[q.shot.kind]) out[q.shot.kind] = t; } return out; }, [idA, end]);
      for (const k of ['close', 'medium', 'wide']) if (pick[k] !== undefined) { await at(pick[k]); await sleep(400); await P.screenshot({ path: path.join(SHOTS, `person-A-${k}.png`) }); }
      await P.evaluate((v) => window.replay.setView(v), `person:${idB}`); await at(4000); await sleep(400); await P.screenshot({ path: path.join(SHOTS, 'person-B.png') });
      console.log('  screenshots in ' + SHOTS, near.t, pick);
    }
    check('no page errors', errors.length === 0, errors);
  } finally { await browser.close(); S.child.kill(); fs.rmSync(S.dir, { recursive: true, force: true }); }
  console.log(`\nPerson cameramen e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

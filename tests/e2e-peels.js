// E2E: peels (baksidespapper). Skaparen (A) slår på 🧻 Peels i Room ▾, B ser det. A slappar:
// pappret faller (skärmdump mitt i fallet) och landar på samma ställe för A och B. Golvet fylls,
// och en klibba rakt på ett papper fastnar inte (nope). Skärmdumpar i FABRIC_SHOTS (som tygerna).
const path = require('path');
const fs = require('fs');
const os = require('os');

async function peelsE2E({ browser, BASE, assert, waitReady, testPng, TOKEN }) {
  const OUT = process.env.FABRIC_SHOTS || path.join(os.tmpdir(), 'klibbrum-shots');
  fs.mkdirSync(OUT, { recursive: true });
  const { room: { id: R }, roomKey: KEY } = await (await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
  const actx = await browser.newContext({ viewport: { width: 1100, height: 700 } }), bctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
  await actx.addInitScript(([r, k]) => { if (!localStorage.getItem('klibb.roomKeys')) localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })); }, [R, KEY]);
  const A = await actx.newPage(), B = await bctx.newPage();
  for (const [n, pg] of [['A', A], ['B', B]]) pg.on('pageerror', (e) => console.log(`sidfel (peels ${n}):`, e.message));
  let designId = null;
  try {
    await A.goto(`${BASE}/?room=${R}`); await waitReady(A);
    await B.goto(`${BASE}/?room=${R}`); await waitReady(B);
    await A.waitForFunction(() => window.klibb.players().length === 1, null, { timeout: 15000 });
    await A.setInputFiles('#file', testPng);
    await A.waitForFunction(() => window.klibb.state.selected && !window.klibb.state.selected.library);
    designId = await A.evaluate(() => window.klibb.state.selected.id);
    await A.evaluate(() => window.klibb.setSize(30)); // the papers below are sized for 30 cm stickers (the design itself starts at 10 cm)
    await A.evaluate(() => document.getElementById('room-menu-btn').click());
    await B.evaluate(() => document.getElementById('room-menu-btn').click());
    assert(await A.isVisible('#peels-on') && (await A.isChecked('#peels-on')) && !(await B.isVisible('#peels-box')), 'Room ▾: skaparen ser 🧻 Peels (PÅ från början, alltid vid sidladdning – 28 okt 2026), de andra ser ingen knapp');
    await A.check('#peels-on');
    await B.waitForFunction(() => window.klibb.peels().on, null, { timeout: 5000 });
    await A.waitForFunction(() => window.klibb.peels().on && !document.getElementById('peels-clear').hidden, null, { timeout: 5000 });
    assert((await A.evaluate(() => window.klibb.peels().on)) && (await A.isVisible('#peels-clear')), 'peels på: B får veta det direkt');
    await A.evaluate(() => document.getElementById('room-menu-btn').click());

    // En slap: pappret faller från släphöjden (där klibban satt) och landar
    await A.evaluate(() => { const k = window.klibb; k.setView('third', { quiet: true }); k.moveTo(0.4, -3.0); k.look(0.35, 0.12); });
    await A.waitForFunction(() => window.klibb.selfAvatar().visible, null, { timeout: 10000 });
    await A.waitForTimeout(400);
    // Pappret börjar falla direkt (innan servern svarat): mät mitt i fallet utan att vänta på svaret
    await A.evaluate(() => { window.__first = window.klibb.stampAt(0, 0).then((s) => s && s.id); });
    await A.waitForFunction(() => window.klibb.peels().count === 1, null, { timeout: 5000 });
    await A.waitForTimeout(60);
    const midPose = await A.evaluate(() => window.klibb.peelPose(window.klibb.peels().peels[0].id));
    const first = await A.evaluate(() => window.__first);
    await A.screenshot({ path: path.join(OUT, 'peels-mid-fall.png') });
    assert(first && midPose && midPose.u > 0 && midPose.u < 1 && midPose.p[1] > 0.05, `pappret faller (skärmdump mitt i fallet, ${Math.round(midPose.u * 100)} % av ${midPose.dur} s, ${midPose.p[1].toFixed(2)} m upp)`);
    await A.waitForFunction(() => window.klibb.peels().landed === 1, null, { timeout: 6000, polling: 100 });
    await B.waitForFunction(() => window.klibb.peels().landed === 1, null, { timeout: 6000, polling: 100 });
    const pa = await A.evaluate(() => window.klibb.peels().peels[0]), pb = await B.evaluate(() => window.klibb.peels().peels[0]);
    const srv = await (await fetch(`${BASE}/api/rooms/${R}/stamps`)).json();
    assert(pa.id === first && pb.id === first && pa.x === pb.x && pa.z === pb.z && pa.yaw === pb.yaw && srv.peels[0].x === pa.x && srv.peels[0].z === pa.z,
      `pappret landar på samma ställe för A, B och servern (${pa.x}, ${pa.z})`);

    // Fyll golvet: slappa väggen från en massa ställen
    const spots = [];
    for (let i = 0; i < 28; i++) spots.push([-2.2 + (i % 7) * 0.7, -3.6 + Math.floor(i / 7) * 0.2, (i * 0.7) % 0.8 - 0.4]); // inom räckhåll från norra väggen
    // 1:a person: chase-kameran i 3:e person glider efter en teleport, så siktet skulle peka fel en stund
    await A.evaluate(() => window.klibb.setView('first', { quiet: true }));
    for (const [x, z, yaw] of spots) {
      await A.evaluate(([x, z, yaw]) => { const k = window.klibb; k.moveTo(x, z); k.look(yaw, 0.15); }, [x, z, yaw]);
      await A.evaluate(() => window.klibb.stampAt(0, 0));
    }
    await A.waitForFunction((n) => window.klibb.peels().landed >= n, spots.length + 1, { timeout: 10000 });
    await B.waitForFunction((n) => window.klibb.peels().landed >= n, spots.length + 1, { timeout: 10000 });
    const info = await B.evaluate(() => window.klibb.peels());
    assert(info.count === spots.length + 1 && info.drawCalls === 2, `B ser ${info.count} papper på golvet, ritade med instancing (${info.drawCalls} draw calls)`);
    const outs = await B.evaluate(() => window.klibb.peels().peels.map((p) => p.z + 5));
    assert(outs.every((d) => d > 0.1 && d < 2.0) && Math.max(...outs) - Math.min(...outs) > 0.4,
      `pappren sprids ut på golvet framför väggen efter släphöjden (${Math.min(...outs).toFixed(2)}–${Math.max(...outs).toFixed(2)} m ut), inte i en klump vid foten och inte mitt i rummet`);
    await A.evaluate(() => { const k = window.klibb; k.setView('third', { quiet: true }); k.moveTo(-0.2, 3.4); k.look(0, -0.42); });
    await A.waitForTimeout(700);
    await A.screenshot({ path: path.join(OUT, 'peels-floor-3rd-person.png') });

    // Påskägget: en klibba rakt på ett papper fastnar inte
    await A.evaluate(() => window.klibb.setView('first', { quiet: true }));
    const target = await A.evaluate(() => window.klibb.peels().peels.at(-1));
    const before = await A.evaluate(() => [window.klibb.stamps.count, window.klibb.nopes()]);
    await A.evaluate(({ x, z }) => { const k = window.klibb; k.moveTo(x, z + 0.5); k.camera.position.y = 1.6; k.look(0, -Math.atan(1.6 / 0.5)); }, target);
    const refused = await A.evaluate(() => window.klibb.stampAt(0, 0));
    await A.waitForTimeout(300);
    const after = await A.evaluate(() => [window.klibb.stamps.count, window.klibb.nopes(), window.klibb.soundLog().at(-1).kind, window.klibb.peels().count]);
    assert(refused === null && after[0] === before[0] && after[1] === before[1] + 1 && after[2] === 'nope' && after[3] === info.count,
      'en klibba på golvet som mest hamnar på papper fastnar inte: ett "nope"-ljud, ingen klibba och inget nytt papper');
    const hack = await A.evaluate(async ({ x, z, id }) => (await fetch(`/api/rooms/${window.klibb.room}/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId: id, by: window.klibb.net.id, position: [x, 0, z], normal: [0, 1, 0], quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], size: 0.3, surface: 'golv' }) })).status, { ...target, id: designId });
    assert(hack === 409, 'servern nekar också (409) om någon försöker gå förbi webbläsaren');
    // Samma sak långt ifrån (4 m): golvet på papper nekas oavsett avstånd, det är ingen räckviddsgräns
    const bf = await A.evaluate(() => [window.klibb.stamps.count, window.klibb.nopes()]);
    await A.evaluate(({ x, z }) => { const k = window.klibb; k.moveTo(x, z + 4); k.camera.position.y = 1.6; k.look(0, -Math.atan(1.6 / 4)); }, target);
    const farRefused = await A.evaluate(() => window.klibb.stampAt(0, 0));
    await A.waitForTimeout(300);
    const af2 = await A.evaluate(() => [window.klibb.stamps.count, window.klibb.nopes(), window.klibb.soundLog().at(-1).kind]);
    assert(farRefused === null && af2[0] === bf[0] && af2[1] === bf[1] + 1 && af2[2] === 'nope', 'golvet på papper nekas också 4 m bort (nope), avståndet spelar ingen roll');
    await A.evaluate(() => { const k = window.klibb; k.moveTo(3.6, -3.6); k.look(0, -0.9); });
    const okFloor = await A.evaluate(() => window.klibb.stampAt(0, 0).then((s) => !!s));
    assert(okFloor, 'på tomt golv fastnar klibban som vanligt');

    // Ingen räckviddsgräns: med peels på fastnar klibban även 8 m från väggen, i 1:a och 3:e person
    for (const v of ['first', 'third']) {
      await A.evaluate((v) => { const k = window.klibb; k.setView(v, { quiet: true }); k.moveTo(0, 3); k.look(0, 0.05); }, v);
      await A.waitForTimeout(150);
      const b4 = await A.evaluate(() => [window.klibb.stamps.count, window.klibb.peels().count, window.klibb.nopes()]);
      const ok = await A.evaluate(() => window.klibb.stampAt(0, 0).then((s) => !!s));
      await A.waitForTimeout(250);
      const af = await A.evaluate(() => ({ n: [window.klibb.stamps.count, window.klibb.peels().count, window.klibb.nopes()], dim: document.body.classList.contains('out-of-reach') }));
      assert(ok && af.n[0] === b4[0] + 1 && af.n[1] === b4[1] + 1 && af.n[2] === b4[2] && !af.dim,
        `${v === 'first' ? '1:a' : '3:e'} person, 8 m från väggen med peels på: klibban fastnar och pappret faller (ingen räckviddsgräns, inget "nej")`);
    }
    await A.evaluate(() => window.klibb.setView('first', { quiet: true }));
    await A.evaluate(() => document.getElementById('room-menu-btn').click());
    await A.click('#peels-clear');
    await B.waitForFunction(() => window.klibb.peels().count === 0, null, { timeout: 5000 });
    assert(true, '🧹 Sweep up the peels: golvet blir tomt för alla');
  } finally {
    await actx.close(); await bctx.close();
    if (designId) await fetch(`${BASE}/api/stickers/${designId}`, { method: 'DELETE', headers: { 'x-admin-token': TOKEN } }).catch(() => {});
  }
}
module.exports = { peelsE2E };

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  const { chromium } = require('playwright');
  const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };
  const waitReady = (page) => page.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 20000 });
  (async () => {
    const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    try { await peelsE2E({ browser, BASE: process.env.BASE_URL || 'http://localhost:8787', assert, waitReady, testPng: path.join(__dirname, 'demo-klibba.png'), TOKEN: process.env.ADMIN_TOKEN }); }
    finally { await browser.close(); }
  })().catch((e) => { console.error(e); process.exit(1); });
}

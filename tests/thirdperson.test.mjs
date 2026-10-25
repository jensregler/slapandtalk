// Tredjepersonsvyn och slap-rörelsen, utan webbläsare: kamerans väggkollision, att valet sparas,
// och hur armen rör sig (upp direkt med klibban, sedan ner igen).
// Körs med: node tests/thirdperson.test.mjs (ingår i npm test)
import * as THREE from 'three';
import { CHASE, chaseOpts, VIEW_KEY, chasePose, smoothDist, aimNear, boxCaster, surfaceCaster, loadView, saveView, viewDir } from '../client/src/chasecam.js';
import { gestureAt, ArmGesture, SLAP_MS, SNAP_MS, HOLD_MS, RETURN_MS, PEEL_MS } from '../client/src/slapanim.js';

const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- Valet sparas ----------
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
{
  const st = mem();
  assert(loadView(st) === 'first', 'förstapersonsläget är standard');
  assert(saveView('third', st) === 'third' && st.m.get(VIEW_KEY) === 'third' && loadView(st) === 'third', 'tredjepersonsvyn sparas och läses tillbaka');
  saveView('nonsense', st);
  assert(loadView(st) === 'first', 'okänt värde blir förstapersonsläget');
  st.setItem(VIEW_KEY, '<script>'); assert(loadView(st) === 'first', 'trasigt sparat värde blir förstapersonsläget');
  const broken = { getItem() { throw new Error('nej'); }, setItem() { throw new Error('nej'); } };
  assert(loadView(broken) === 'first' && saveView('third', broken) === 'third', 'utan localStorage (privat läge) kraschar inget');
}

// ---------- Kameran bakom gubben ----------
// Samma låda som rummet (10 x 4 x 10 m), och gubben går inte närmare väggarna än 0,35 m.
const MIN = V(-5, 0, -5), MAX = V(5, 4, 5);
const cast = boxCaster(MIN, MAX);
const inside = (p, m) => p.x >= MIN.x + m && p.x <= MAX.x - m && p.y >= MIN.y + m && p.y <= MAX.y - m && p.z >= MIN.z + m && p.z <= MAX.z - m;
{
  const eye = V(0, 1.6, 0);
  const p = chasePose(eye, 0, 0, cast);
  assert(Math.abs(p.dist - CHASE.dist) < 1e-9, `mitt i rummet: full distans (${CHASE.dist} m bakom axeln)`);
  assert(p.position.z > eye.z + 2 && p.position.x > eye.x && p.position.y > eye.y, 'kameran står bakom, till höger (över axeln) och lite ovanför');
  // Kameran tittar åt samma håll som gubben: siktstrålen går förbi gubben
  const dir = viewDir(0, 0);
  const near = aimNear(p.position, dir, eye);
  assert(Math.abs(near - (p.position.z - eye.z)) < 1e-9, 'siktet räknas från gubben och framåt (inget mellan kameran och gubben träffas)');
  assert(aimNear(V(0, 0, 0), V(0, 0, -1), V(0, 0, 3)) === 0, 'står gubben bakom kameran börjar siktet vid kameran');

  // Ryggen mot väggen: kameran dras in och hamnar aldrig bakom väggen
  const wallEye = V(0, 1.6, 4.65);
  const w = chasePose(wallEye, 0, 0, cast);
  assert(w.dist < CHASE.hideBelow && w.position.z <= MAX.z - CHASE.margin + 1e-9, `ryggen mot väggen: kameran dras in (${w.dist.toFixed(2)} m) och stannar framför väggen`);
  // Hörn och tak, slumpade poser: kameran är alltid inne i rummet, minst nästan hela marginalen från väggen
  let worst = Infinity, n = 0;
  for (let i = 0; i < 2000; i++) {
    const e = V(-4.65 + Math.random() * 9.3, 1.6, -4.65 + Math.random() * 9.3);
    const yaw = Math.random() * Math.PI * 2, pitch = (Math.random() - 0.5) * (Math.PI - 0.02);
    const q = chasePose(e, yaw, pitch, cast);
    if (!inside(q.position, 0.15)) n++;
    worst = Math.min(worst, q.position.x - MIN.x, MAX.x - q.position.x, q.position.y - MIN.y, MAX.y - q.position.y, q.position.z - MIN.z, MAX.z - q.position.z);
  }
  assert(n === 0, `2000 slumpade poser: kameran går aldrig genom en vägg, golv eller tak (minst ${worst.toFixed(2)} m kvar)`);
  // Den riktiga strålen mot rummets ytor ger samma svar som lådan
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(10, 4), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  plane.position.set(0, 2, 5); plane.rotation.y = Math.PI; plane.updateMatrixWorld();
  const real = surfaceCaster([plane]);
  assert(Math.abs(real(V(0, 1.6, 3), V(0, 0, 1), 10) - 2) < 1e-6 && real(V(0, 1.6, 3), V(0, 0, 1), 1) === Infinity && real(V(0, 1.6, 3), V(0, 0, -1), 10) === Infinity,
    'strålen mot rummets ytor: avstånd till väggen, Infinity utanför räckvidd eller åt fel håll');
  // Stående mobilskärm: gubben nästan mitt i bilden (annars utanför den smala bilden), lite längre bort
  const tall = chaseOpts(412 / 839), wide = chaseOpts(16 / 9);
  assert(wide === CHASE && tall.side < 0.2 && tall.dist > CHASE.dist && Math.atan2(tall.side, tall.dist) < Math.atan(Math.tan(Math.PI * 35 / 180) * 412 / 839) / 3,
    'stående mobilskärm: kameran står nästan rakt bakom (gubben syns i den smala bilden)');
  // In direkt, ut mjukt
  assert(smoothDist(2.6, 0.4, 0.016) === 0.4, 'en vägg i vägen: kameran dras in direkt (ingen bildruta genom väggen)');
  const out1 = smoothDist(0.4, 2.6, 0.016);
  assert(out1 > 0.4 && out1 < 1, `väggen borta: kameran glider ut mjukt (${out1.toFixed(2)} m efter en bildruta)`);
  let d = 0.4; for (let i = 0; i < 120; i++) d = smoothDist(d, 2.6, 1 / 60);
  assert(Math.abs(d - 2.6) < 0.01 && smoothDist(null, 2.6, 0.016) === 2.6, 'och är framme efter ungefär en sekund (och börjar på rätt ställe)');
}

// ---------- Slap-rörelsen ----------
{
  const s0 = gestureAt('slap', 0), sImp = gestureAt('slap', SNAP_MS);
  assert(SNAP_MS <= 30 && s0.w === 1 && s0.reach >= 0.5 && sImp.reach === 1, `handen är uppe vid väggen direkt: redan i första bildrutan, framme efter ${SNAP_MS} ms`);
  let pressed = true;
  for (let t = SNAP_MS; t < SNAP_MS + HOLD_MS; t += 5) { const g = gestureAt('slap', t); if (g.w !== 1 || g.reach !== 1 || g.pull > 0) pressed = false; }
  assert(pressed && HOLD_MS >= 60 && HOLD_MS <= 80, `en kort tryckning mot väggen (${HOLD_MS} ms)`);
  let prev = 1, mono = true, first = null;
  for (let t = SNAP_MS + HOLD_MS; t < SLAP_MS; t += 5) { const g = gestureAt('slap', t); if (g.w > prev + 1e-9) mono = false; prev = g.w; first ??= t + 20 < SLAP_MS ? gestureAt('slap', t + 20).w : null; }
  const early = 1 - gestureAt('slap', SNAP_MS + HOLD_MS + RETURN_MS * 0.25).w, late = gestureAt('slap', SNAP_MS + HOLD_MS + RETURN_MS * 0.75).w;
  assert(mono && RETURN_MS >= 250 && RETURN_MS <= 400 && early > 0.4 && late < 0.1, `sedan ner igen med ease-out (${RETURN_MS} ms, snabbast i början)`);
  assert(gestureAt('slap', SLAP_MS) === null && gestureAt('slap', -1) === null && gestureAt('peel', PEEL_MS) === null && gestureAt('peel', 250).pull > 0,
    'rörelsen tar slut av sig själv; peel drar handen bakåt från väggen');
}
// Armen på ett litet skelett (samma bennamn som gubbe.glb) rör sig mot väggen
{
  const root = new THREE.Group();
  const bone = (name, parent, x, y, z) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); parent.add(b); return b; };
  const chest = bone('Chest', root, 0, 1.3, 0);
  for (const [s, x] of [['L', 0.18], ['R', -0.18]]) {
    const up = bone(`UpperArm.${s}`, chest, x, 0.1, 0);
    const lo = bone(`LowerArm.${s}`, up, 0, -0.27, 0); bone(`Wrist.${s}`, lo, 0, -0.25, 0);
  }
  const g = new ArmGesture(root); const wr = root.getObjectByName('Wrist.R'), wl = root.getObjectByName('Wrist.L');
  root.updateMatrixWorld(true);
  const target = V(-0.3, 1.5, 0.4), rest = wr.getWorldPosition(V());
  g.start('slap', target, V(0, 0, -1), 1000);
  g.apply(root, 1000 + SNAP_MS + 10);
  root.updateMatrixWorld(true);
  const hit = wr.getWorldPosition(V()), other = wl.getWorldPosition(V());
  const hand = target.clone().add(V(0, 0, -0.05));
  assert(hit.distanceTo(hand) < 0.05 && rest.distanceTo(hand) > 0.5, `vid träffen är handen vid klibban (${hit.distanceTo(hand).toFixed(3)} m ifrån), med armen närmast väggen`);
  assert(other.distanceTo(V(0.18, 1.4 - 0.52, 0)) < 1e-6, 'den andra armen rör sig inte');
  assert(g.count === 1 && g.active(1000 + 100) && !g.active(1000 + SLAP_MS + 1), 'rörelsen räknas (för testerna) och är över efter slaget');
  // Långt bort: armen sträcks rakt mot klibban (gubben går inte dit)
  g.start('slap', V(-0.18, 1.4, 5), null, 2000); g.apply(root, 2000 + SNAP_MS + 10); root.updateMatrixWorld(true);
  const sh = root.getObjectByName('UpperArm.R').getWorldPosition(V()), far = wr.getWorldPosition(V()).sub(sh);
  assert(far.length() > 0.49 && far.normalize().z > 0.98, 'klibban långt bort: armen pekar rakt mot den, utsträckt');
}
console.log('\nAlla tester för tredjepersonsvyn gick igenom.');

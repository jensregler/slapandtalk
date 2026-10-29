// Tredjepersonsvy ("se sig själv bakifrån"): kameran står bakom och lite ovanför ens egen gubbe,
// över höger axel. Här finns bara matten (ingen rendering), så den går att testa i node:
//   chasePose()  var kameran ska stå, och hur långt den fick vara från axeln utan att gå genom en vägg
//   smoothDist() kameran dras in direkt mot en vägg, men glider ut igen mjukt
//   aimNear()    siktet (strålen från kameran genom skärmens mitt) räknas först från gubben och framåt,
//                så man aldrig stämplar på något mellan kameran och gubben
//   loadView() / saveView()  valet (första eller tredje person) sparas på enheten
import * as THREE from 'three';

export const VIEW_KEY = 'klibb.view';
export const CHASE = {
  dist: 2.6,      // meter bakom axeln
  height: 0.38,   // axeln ligger så här mycket över ögonen
  side: 0.55,     // ... och så här mycket åt höger (över axeln)
  margin: 0.2,    // så nära en vägg får kameran komma
  hideBelow: 0.7, // närmare än så: göm gubben (annars ser man insidan av huvudet)
};

// Stående skärm (mobil): gubben nästan mitt i bilden och lite längre bort, annars hamnar den utanför kanten.
export function chaseOpts(aspect, o = CHASE) {
  if (!(aspect < 1)) return o;
  const a = Math.max(0.3, aspect);
  return { ...o, side: o.side * a * 0.5, dist: o.dist + (1 - a) * 0.8 };
}

// The three views (Jens, 29 Oct 2026): first person, third person (behind) and third person from
// the FRONT (the camera in front of you, looking back at you: look into it, 📷 = a selfie). C cycles.
export const VIEWS = ['first', 'third', 'front'];
export const nextView = (v) => VIEWS[(VIEWS.indexOf(v) + 1) % VIEWS.length];
export function loadView(storage = globalThis.localStorage) {
  try { const v = storage?.getItem(VIEW_KEY); return VIEWS.includes(v) ? v : 'first'; } catch { return 'first'; }
}
export function saveView(view, storage = globalThis.localStorage) {
  const v = VIEWS.includes(view) ? view : 'first';
  try { storage?.setItem(VIEW_KEY, v); } catch { /* privat läge: gäller bara nu */ }
  return v;
}

// Blickriktning för yaw/pitch (samma Euler 'YXZ' som FirstPersonControls).
export const viewDir = (yaw, pitch, out = new THREE.Vector3()) =>
  out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
export const rightDir = (yaw, out = new THREE.Vector3()) => out.set(Math.cos(yaw), 0, -Math.sin(yaw));

const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((a) => new THREE.Vector3(...a));

// cast(origin, dir, max) -> avstånd till första ytan längs dir (Infinity om ingen inom max).
// Returnerar { position, pivot, dist } där dist = avståndet från axeln (pivot) bakåt till kameran.
export function chasePose(eye, yaw, pitch, cast, o = CHASE) {
  const right = rightDir(yaw), up = new THREE.Vector3(0, 1, 0);
  // Axeln: åt sidan och uppåt från ögonen, men aldrig in i en vägg eller taket.
  const sideHit = cast(eye, right, o.side + o.margin);
  const side = Math.max(0, Math.min(o.side, sideHit - o.margin));
  const upFrom = eye.clone().addScaledVector(right, side);
  const upHit = cast(upFrom, up, o.height + o.margin);
  const height = Math.max(0, Math.min(o.height, upHit - o.margin));
  const pivot = upFrom.addScaledVector(up, height);
  // Bakåt (motsatt blicken). Står en vägg i vägen dras kameran in mot gubben.
  const back = viewDir(yaw, pitch).negate();
  const hit = cast(pivot, back, o.dist + o.margin);
  let dist = Math.max(0, Math.min(o.dist, hit - o.margin));
  const position = pivot.clone().addScaledVector(back, dist);
  // Strålen kan gå nästan längs en vägg (snett mot ett hörn): knuffa då ut kameran från väggen,
  // så hela närplanet stannar i rummet.
  let pushed = false;
  for (const d of AXES) {
    const h = cast(position, d, o.margin);
    if (h < o.margin) { position.addScaledVector(d, h - o.margin); pushed = true; }
  }
  if (pushed) dist = position.distanceTo(pivot);
  return { position, pivot, dist };
}

// Third person from the front: the camera stands in front of me (where I look), a little above my
// eyes, and looks back at me (aimed a bit below the eyes, so head and upper body fill the frame).
// Looking up/down swings it a little up/down. A wall in the way pulls it in toward me (never closer
// than minDist), and it is pushed out of walls like the chase camera.
export const FRONT = { dist: 1.9, minDist: 0.45, height: 0.08, lookDown: 0.28, pitchK: 0.6, margin: 0.2 };
export function frontPose(eye, yaw, pitch, cast, o = FRONT) {
  const p = Math.max(-0.7, Math.min(0.7, pitch)) * o.pitchK;
  const fwd = viewDir(yaw, p);
  const hit = cast(eye, fwd, o.dist + o.margin);
  let dist = Math.max(o.minDist, Math.min(o.dist, hit - o.margin));
  const position = eye.clone().addScaledVector(fwd, dist); position.y += o.height;
  for (const d of AXES) {
    const h = cast(position, d, o.margin);
    if (h < o.margin) position.addScaledVector(d, h - o.margin);
  }
  dist = position.distanceTo(eye);
  const target = eye.clone(); target.y -= o.lookDown;
  return { position, target, dist };
}

// In direkt (kameran får aldrig hamna bakom en vägg), ut mjukt.
export function smoothDist(prev, target, dt, rate = 6) {
  if (prev == null || !Number.isFinite(prev) || target <= prev) return target;
  return prev + (target - prev) * (1 - Math.exp(-dt * rate));
}

// Hur långt fram längs siktstrålen gubben står (0 om bakom kameran).
export function aimNear(camPos, dir, eye) {
  return Math.max(0, (eye.x - camPos.x) * dir.x + (eye.y - camPos.y) * dir.y + (eye.z - camPos.z) * dir.z);
}

// Ett "rum" som en låda (för tester): avståndet ut ur lådan längs dir från en punkt inuti.
export function boxCaster(min, max) {
  return (o, d, far = Infinity) => {
    let t = Infinity;
    for (const k of ['x', 'y', 'z']) {
      if (d[k] > 1e-9) t = Math.min(t, (max[k] - o[k]) / d[k]);
      else if (d[k] < -1e-9) t = Math.min(t, (min[k] - o[k]) / d[k]);
    }
    return t <= far ? Math.max(0, t) : Infinity;
  };
}
// Den riktiga: en stråle mot rummets ytor.
export function surfaceCaster(surfaces, raycaster = new THREE.Raycaster()) {
  return (o, d, far = Infinity) => {
    raycaster.set(o, d); raycaster.near = 0; raycaster.far = far;
    const hit = raycaster.intersectObjects(surfaces, false)[0];
    return hit ? hit.distance : Infinity;
  };
}

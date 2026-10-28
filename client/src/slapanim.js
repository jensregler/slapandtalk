// Slap-rörelsen för gubbarna (och en liten peel-rörelse): armen sträcks mot väggen där klibban
// hamnar, med ett snabbt slag. Ren kod, inga extra filer: armens ben (UpperArm/LowerArm/Wrist i
// gubbe.glb) vrids med en enkel tvåbens-IK ovanpå den vanliga animationen (Idle/Walk).
//   gestureAt(kind, t)  hur rörelsen ser ut t ms efter start (testbar i node)
//   ArmGesture          lägger rörelsen på en gubbes skelett varje bildruta
import * as THREE from 'three';

export const SNAP_MS = 25;    // handen är uppe vid väggen på 0–2 bildrutor, samtidigt som klibban och ljudet
export const HOLD_MS = 70;    // en liten tryckning mot väggen
export const RETURN_MS = 320; // sedan glider armen ner igen (det är den rörelsen man ser)
export const SLAP_MS = SNAP_MS + HOLD_MS + RETURN_MS;
export const PEEL_MS = 420;

export const HOLD_IN_MS = 160; // the drag pose (sticker arrays) eases in over this long
// The drag pose while a sticker row is pulled out (slap at A, hold, drag toward B): the arm stays
// up, reaching for where the row ends, the hand pulled a little back from the wall.
export const DRAG_POSE = { reach: 1, lift: 0, pull: 0.06 };
export function holdAt(t) { return t >= 0 ? { w: easeOut(clamp01(t / HOLD_IN_MS)), ...DRAG_POSE } : null; }

const easeOut = (x) => 1 - (1 - x) * (1 - x);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// w = hur mycket armen styrs (0 = vanliga animationen), reach = 0 vilande hand .. 1 vid väggen,
// lift = handen kommer uppifrån (meter), pull = handen dras bakåt från väggen (meter; negativt = trycker mot den).
export function gestureAt(kind, t) {
  if (!(t >= 0)) return null;
  if (kind === 'peel') {
    if (t >= PEEL_MS) return null;
    const reach = t < 150 ? easeOut(t / 150) : 1;
    return { w: t < 50 ? t / 50 : t > 300 ? 1 - (t - 300) / (PEEL_MS - 300) : 1, reach, lift: (1 - reach) * 0.15, pull: t > 190 ? easeOut(clamp01((t - 190) / 140)) * 0.35 : 0 };
  }
  if (t >= SLAP_MS) return null;
  // Upp direkt (ingen fördröjning av klibban), en kort tryckning, och sedan ner med ease-out.
  if (t < SNAP_MS) return { w: 1, reach: 0.6 + 0.4 * (t / SNAP_MS), lift: 0, pull: 0 }; // syns redan i första bildrutan
  if (t < SNAP_MS + HOLD_MS) return { w: 1, reach: 1, lift: 0, pull: -0.02 * Math.sin(Math.PI * (t - SNAP_MS) / HOLD_MS) };
  const k = easeOut((t - SNAP_MS - HOLD_MS) / RETURN_MS);
  return { w: 1 - k, reach: 1, lift: 0, pull: 0 }; // armen svänger tillbaka in i den vanliga animationen
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _wq = new THREE.Quaternion();
// Vrid ett ben (i världen) så att riktningen mot barnet pekar mot target, blandat med weight.
function aimBone(bone, child, target, weight) {
  const pos = bone.getWorldPosition(_a);
  const cur = child.getWorldPosition(_b).sub(pos).normalize();
  const want = _c.copy(target).sub(pos);
  if (want.lengthSq() < 1e-8) return;
  want.normalize();
  _q.setFromUnitVectors(cur, want);
  bone.getWorldQuaternion(_wq);
  bone.parent.getWorldQuaternion(_pq);
  const local = _pq.invert().multiply(_q.multiply(_wq));
  bone.quaternion.slerp(local, weight);
  bone.updateMatrixWorld(true);
}

export class ArmGesture {
  constructor(model) {
    // GLTFLoader tar bort punkten i namnen (UpperArm.L -> UpperArmL); båda varianterna går bra.
    const get = (n, s) => model.getObjectByName(`${n}${s}`) || model.getObjectByName(`${n}.${s}`);
    const side = (s) => {
      const upper = get('UpperArm', s), lower = get('LowerArm', s), wrist = get('Wrist', s);
      return upper && lower && wrist ? { upper, lower, wrist } : null;
    };
    this.arms = [side('L'), side('R')].filter(Boolean);
    this.chest = model.getObjectByName('Chest');
    this.g = null; // { kind, t0, target, normal, arm }
    this.count = 0; // för tester: hur många rörelser som startats
    this.freeze = null; // för tester/skärmdumpar: visa rörelsen som den ser ut så här många ms in
    this.h = null; // the drag pose (sticker arrays): { target, normal, t0, age? } – held until release()
  }
  // The drag pose: the arm reaches for target (world point) until release(). A slap still plays on
  // top of it (the anchor's slap), then the arm stays up in the pose. age (ms): the replay's clock.
  // out (replay): ms since the row was let go – the arm swings back down like after a slap.
  hold(target, normal = null, age = null, out = null, now = performance.now()) {
    if (!this.arms.length || !target) return false;
    const tv = new THREE.Vector3().fromArray(target.toArray ? target.toArray() : target);
    const nv = normal ? new THREE.Vector3().fromArray(normal.toArray ? normal.toArray() : normal).normalize() : null;
    if (!this.h || (out == null && this.h.out0 != null)) this.h = { t0: now, arm: this.h ? this.h.arm : null };
    this.h.target = tv; this.h.normal = nv; this.h.age = age; this.h.out = out;
    return true;
  }
  // Let go (live): the arm swings back down over RETURN_MS, as after a slap.
  release(now = performance.now()) { if (this.h && this.h.out == null && this.h.out0 == null) this.h.out0 = now; }
  holding() { return !!this.h && this.h.out == null && this.h.out0 == null; }
  start(kind, target, normal = null, now = performance.now()) {
    if (!this.arms.length || !target) return false;
    this.g = { kind, t0: now, target: new THREE.Vector3().fromArray(target.toArray ? target.toArray() : target),
      normal: normal ? new THREE.Vector3().fromArray(normal.toArray ? normal.toArray() : normal).normalize() : null, arm: null };
    this.count++;
    return true;
  }
  // The replay (client/src/replay.js): show the gesture that started `age` ms ago on the recording's
  // clock (seeking, pausing and the finished video all agree). key = which gesture (its start time).
  pin(kind, target, normal, age, key) {
    if (!this.g || this.g.key !== key) { if (!this.start(kind, target, normal)) return false; this.g.key = key; }
    this.freeze = Math.max(0, age); this.pinned = true;
    return true;
  }
  unpin() { if (this.pinned) { this.g = null; this.freeze = null; this.pinned = false; } }
  elapsed(now) { return this.freeze != null ? this.freeze : now - this.g.t0; }
  active(now = performance.now()) { return !!(this.g && gestureAt(this.g.kind, this.elapsed(now))) || !!this.h; } // h: the drag pose (or its swing back)
  // Efter mixer.update(): lägg armen ovanpå. root = gubbens rot (för världsmatriserna).
  apply(root, now = performance.now()) {
    let g = this.g;
    let s = g ? gestureAt(g.kind, this.elapsed(now)) : null;
    if (g && !s) { this.g = null; g = null; }
    let h = this.h;
    const away = h ? (h.out != null ? h.out : h.out0 != null ? now - h.out0 : null) : null;
    if (h && away != null && away >= RETURN_MS) { this.h = null; h = null; }
    if (h) {
      const hs = holdAt(h.age != null ? h.age : now - h.t0);
      if (away != null) hs.w *= 1 - easeOut(clamp01(away / RETURN_MS));
      // the slap on top while it is up; as it swings back, the drag pose takes over (never lower than the pose)
      if (!s || s.w < hs.w) { if (g && !h.arm) h.arm = g.arm; g = { target: h.target, normal: h.normal, arm: h.arm }; s = hs; }
    }
    if (!g || !s) return;
    root.updateMatrixWorld(true);
    // Den arm vars axel är närmast målet slår (vänster eller höger).
    if (!g.arm) g.arm = this.arms.reduce((best, a) => (a.upper.getWorldPosition(_a).distanceTo(g.target) < best.upper.getWorldPosition(_b).distanceTo(g.target) ? a : best));
    if (h && !h.arm) h.arm = g.arm; // the drag pose keeps the arm that slapped
    const { upper, lower, wrist } = g.arm;
    const S = upper.getWorldPosition(new THREE.Vector3());
    const E0 = lower.getWorldPosition(new THREE.Vector3()), R = wrist.getWorldPosition(new THREE.Vector3());
    const la = S.distanceTo(E0), lb = E0.distanceTo(R), len = (la + lb) * 0.97;
    // Handen stannar precis framför väggen (inte i den).
    const goal = g.target.clone(); if (g.normal) goal.addScaledVector(g.normal, 0.05);
    const toGoal = goal.clone().sub(S); const d = toGoal.length();
    if (d > len) goal.copy(S).addScaledVector(toGoal.normalize(), len);
    const H = R.clone().lerp(goal, s.reach);
    H.y += s.lift;
    if (s.pull) { const away = g.normal ? g.normal.clone() : S.clone().sub(goal).normalize(); H.addScaledVector(away, s.pull); if (s.pull > 0) H.y -= s.pull * 0.4; }
    // Tvåbens-IK: armbågen nedåt och lite utåt från bröstet.
    const toH = H.clone().sub(S); let c = toH.length();
    c = Math.min(Math.max(c, Math.abs(la - lb) + 1e-3), la + lb - 1e-3);
    const dir = toH.normalize();
    const out = this.chest ? S.clone().sub(this.chest.getWorldPosition(new THREE.Vector3())).setY(0).normalize() : new THREE.Vector3();
    const pole = new THREE.Vector3(0, -1, 0).addScaledVector(out, 0.6);
    pole.addScaledVector(dir, -pole.dot(dir));
    if (pole.lengthSq() < 1e-6) pole.set(0, -1, 0).addScaledVector(dir, -(-dir.y)); // rakt upp/ner: valfri böj
    pole.normalize();
    const cosA = THREE.MathUtils.clamp((la * la + c * c - lb * lb) / (2 * la * c), -1, 1);
    const E = S.clone().addScaledVector(dir, cosA * la).addScaledVector(pole, Math.sqrt(1 - cosA * cosA) * la);
    aimBone(upper, lower, E, s.w);
    aimBone(lower, wrist, H, s.w);
  }
}

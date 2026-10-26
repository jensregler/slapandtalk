// The talking mouth: deliberately bad. A flat black hole with a strip of teeth, stuck on the
// front of the head, that opens with the voice level in chunky steps at ~12 fps and glitches:
// it jumps sideways, tilts, sometimes goes absurdly wide, slips onto a cheek for a frame, or
// tears into a cyan/magenta double (a nod to Backrooms VHS and Digital Circus). Hidden when
// silent, so the avatars stay as simple as before.
//
// Driven by open = 0…1 (shared/director.mjs openOf): live from voice.js, in the replay from the
// recorded talk levels. The glitches come from a hash of (seed, frame number), so a replay at the
// same time looks the same every time (frame number = time · 12).
import * as THREE from 'three';
import { hash01 } from '../../shared/director.mjs';

export const MOUTH = {
  fps: 12,                 // the mouth only changes 12 times a second (on purpose: choppy)
  steps: 4,                // opening in 4 chunky steps
  at: [0, 0.045, 0.11],    // in the head bone's frame (root space): between nose and chin, on the face
  w: 0.058, h: 0.05,       // fully open
  decayMs: 180,            // after the voice stops it snaps shut this fast
};
const geo = new THREE.PlaneGeometry(1, 1);
const mat = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });

export class Mouth {
  constructor(seed = '') {
    this.seed = String(seed);
    this.group = new THREE.Group(); this.group.name = 'mouth'; this.group.visible = false;
    this.inner = new THREE.Group(); this.group.add(this.inner);
    const part = (m, z) => { const o = new THREE.Mesh(geo, m); o.position.z = z; o.raycast = () => {}; o.renderOrder = 3; this.inner.add(o); return o; };
    this.mats = [mat(0x0b0b0b), mat(0xf4f1e6), mat(0xf4f1e6), mat(0x00e5ff, 0.55), mat(0xff2bd6, 0.55), mat(0x8a1f2a)];
    this.ghostA = part(this.mats[3], -0.0008); this.ghostB = part(this.mats[4], -0.0006);
    this.hole = part(this.mats[0], 0); this.tongue = part(this.mats[5], 0.0002);
    this.teethTop = part(this.mats[1], 0.0004); this.teethLow = part(this.mats[2], 0.0004);
    this.open = 0; this.target = 0; this.lastLoud = -1e9; this.frame = -1; this.clock = 0;
    this.info = { open: 0, shown: false, glitch: '' };
  }
  set(open01, nowMs) { this.target = Math.max(0, Math.min(1, Number(open01) || 0)); if (this.target > 0.02) this.lastLoud = nowMs; }
  // dt in s. t (ms) = a fixed timeline time (the replay), otherwise our own clock.
  update(dt, t = null, nowMs = performance.now()) {
    this.clock += dt * 1000;
    const time = t ?? this.clock;
    const frame = Math.floor(time / (1000 / MOUTH.fps));
    const silent = this.target <= 0.02 && nowMs - this.lastLoud > MOUTH.decayMs;
    if (silent) { this.group.visible = false; this.open = 0; this.info = { open: 0, shown: false, glitch: '' }; return; }
    if (frame === this.frame) return; // hold the pose until the next (choppy) frame
    this.frame = frame;
    const r = (k) => hash01(this.seed, frame, k);
    // Chunky opening, a little out of sync with the voice (bad dubbing): sometimes one step off.
    let open = Math.round(this.target * MOUTH.steps) / MOUTH.steps;
    if (r('lag') < 0.25) open = Math.max(0.25, open - 1 / MOUTH.steps);
    if (open < 0.25) open = 0.25;
    this.open = open;
    let sx = 1, x = (r('x') - 0.5) * 0.016, y = 0, rot = (r('rot') - 0.5) * 0.35, glitch = '';
    const g = r('g');
    if (g < 0.07) { sx = 1.9; glitch = 'wide'; }                         // absurdly wide
    else if (g < 0.12) { x += 0.032 * (r('side') < 0.5 ? -1 : 1); y = 0.02; rot += 0.5; glitch = 'slip'; } // onto a cheek
    else if (g < 0.24) glitch = 'tear';                                    // VHS double
    const w = MOUTH.w * sx * (0.75 + open * 0.35), h = 0.006 + MOUTH.h * open;
    this.inner.position.set(x, y, 0); this.inner.rotation.z = rot;
    this.hole.scale.set(w, h, 1);
    this.tongue.scale.set(w * 0.55, h * 0.35, 1); this.tongue.position.y = -h * 0.28; this.tongue.visible = open >= 0.5;
    this.teethTop.scale.set(w * 0.86, Math.min(0.009, h * 0.3), 1); this.teethTop.position.y = h / 2 - Math.min(0.009, h * 0.3) / 2;
    this.teethLow.visible = r('low') < 0.4; this.teethLow.scale.set(w * 0.7, 0.006, 1); this.teethLow.position.y = -h / 2 + 0.003;
    const tear = glitch === 'tear';
    for (const [o, dx] of [[this.ghostA, -0.011], [this.ghostB, 0.011]]) { o.visible = tear; o.scale.set(w, h, 1); o.position.x = dx * (0.6 + r('t' + dx)); o.position.y = (r('ty' + dx) - 0.5) * 0.008; }
    this.group.visible = true;
    this.info = { open: +open.toFixed(2), shown: true, glitch };
  }
  dispose() { for (const m of this.mats) m.dispose(); }
}

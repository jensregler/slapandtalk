// Förstapersonsstyrning.
// Dator: klicka -> musen låses (pointer lock), WASD för att gå, musen för att titta.
// Mobil: styrspak nere till vänster för att gå, dra med fingret för att titta.
import * as THREE from 'three';
import { RUN } from '../../shared/runmode.mjs';

// Skriver man i ett textfält (artistnamn, rumskod …)? Då ska tangenterna inte styra spelet.
export function isTyping(e) {
  const t = e.target;
  if (!t || !t.closest) return false;
  if (t.closest('textarea, select, [contenteditable=""], [contenteditable="true"]')) return true;
  const inp = t.closest('input');
  return !!inp && !['range', 'checkbox', 'radio', 'button', 'file'].includes(inp.type);
}

const SNEAK_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
const MOD_KEYS = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight']);

export class FirstPersonControls {
  constructor(camera, canvas, bounds) {
    this.camera = camera;
    this.canvas = canvas;
    this.bounds = bounds;
    this.yaw = 0; this.pitch = 0;
    this.keys = new Set();
    this.joy = new THREE.Vector2(); // -1..1
    this.speed = 2.6; // m/s
    this.moving = false; this.running = false; this.crouching = false; // crouching = sneak (Ctrl held + moving)
    this.locked = false;
    this.onLockChange = () => {};

    addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      this.keys.add(e.code);
      // Sneak = Ctrl + WASD: keep the browser's Ctrl+S (save page), Ctrl+D (bookmark), Ctrl+A (select all)
      // out of the way. Ctrl+W (close tab) can't be blocked by a page – main.js asks before the tab
      // closes while Ctrl is held (beforeunload).
      if (e.ctrlKey && !e.metaKey && !e.altKey && SNEAK_KEYS.has(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.onLockChange(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (this.locked) this.look(e.movementX * 0.0022, e.movementY * 0.0022);
    });
    this.apply();
  }

  // Held modifier keys, also while not moving (dancing: Shift = run tempo, Ctrl = crouch tempo).
  shiftHeld() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'); }
  ctrlHeld() { return this.keys.has('ControlLeft') || this.keys.has('ControlRight'); }
  // Forget the held movement keys but keep Shift / Ctrl (the dance owns the body, but dance + Shift =
  // run tempo and dance + Ctrl = crouch tempo still need to know they are held).
  clearMoveKeys() { for (const k of [...this.keys]) if (!MOD_KEYS.has(k)) this.keys.delete(k); }

  lock() { this.canvas.requestPointerLock?.(); }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  look(dx, dy) {
    this.yaw -= dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    this.apply();
  }

  apply() { this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ')); }

  // Kopplar en styrspak (div med en knopp i) till rörelse.
  attachJoystick(base, stick) {
    let id = null; let cx = 0; let cy = 0; const R = 50;
    base.addEventListener('pointerdown', (e) => {
      id = e.pointerId; base.setPointerCapture(id);
      const r = base.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      move(e); e.preventDefault();
    });
    const move = (e) => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const len = Math.hypot(dx, dy); if (len > R) { dx *= R / len; dy *= R / len; }
      stick.style.transform = `translate(${dx}px, ${dy}px)`;
      this.joy.set(dx / R, dy / R);
    };
    const end = (e) => { if (e.pointerId !== id) return; id = null; this.joy.set(0, 0); stick.style.transform = ''; };
    base.addEventListener('pointermove', move);
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
  }

  update(dt) {
    let f = 0, s = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) s += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) s -= 1;
    f -= this.joy.y; s += this.joy.x;
    const len = Math.hypot(f, s); if (len > 1) { f /= len; s /= len; }
    // Run mode (shared/runmode.mjs, Jens t544u): Shift (either one) + moving = running – faster, and
    // my footsteps switch to the run tempo/pitch (main.js walkSounds → groove.setRun).
    // Sneak (Jens, 11 Nov 2026): Ctrl (either one) + moving = crouching – slower, and my steps switch to
    // the crouch tempo/pitch. Ctrl wins over Shift (shared/runmode.mjs gaitOf).
    this.moving = len > 0.05;
    this.crouching = this.moving && this.ctrlHeld();
    this.running = this.moving && !this.crouching && this.shiftHeld();
    const sp = this.speed * (this.crouching ? RUN.sneakSpeed : this.running ? RUN.speed : 1) * dt;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const p = this.camera.position, px = p.x, pz = p.z;
    p.addScaledVector(fwd, f * sp).addScaledVector(right, s * sp);
    p.x = THREE.MathUtils.clamp(p.x, this.bounds.min.x, this.bounds.max.x);
    p.z = THREE.MathUtils.clamp(p.z, this.bounds.min.z, this.bounds.max.z);
    // The City (city.js): houses you can't walk through (collide → pushed out to the nearest side)
    // and slabs you step up onto (ground: the eye stays 1.6 m above the ground under you).
    if (this.collide) { const [x, z] = this.collide(p.x, p.z); p.x = x; p.z = z; }
    // 3D props (propsmode.js, shared/propcollide.mjs; Jens t521u): tables, chairs, street furniture block
    // you too – in a room, a house and the city. Only when I moved (a pose set from outside isn't undone).
    if (this.propCollide && (p.x !== px || p.z !== pz)) {
      const clamp = (x, z) => { x = THREE.MathUtils.clamp(x, this.bounds.min.x, this.bounds.max.x); z = THREE.MathUtils.clamp(z, this.bounds.min.z, this.bounds.max.z); return this.collide ? this.collide(x, z) : [x, z]; };
      const [x, z] = this.propCollide(px, pz, p.x, p.z, p.y, clamp); p.x = x; p.z = z;
    }
    if (this.ground) { const want = 1.6 + this.ground(p.x, p.z); p.y += (want - p.y) * Math.min(1, dt * 12); }
  }
}

// Förstapersonsstyrning.
// Dator: klicka -> musen låses (pointer lock), WASD för att gå, musen för att titta.
// Mobil: styrspak nere till vänster för att gå, dra med fingret för att titta.
import * as THREE from 'three';

export class FirstPersonControls {
  constructor(camera, canvas, bounds) {
    this.camera = camera;
    this.canvas = canvas;
    this.bounds = bounds;
    this.yaw = 0; this.pitch = 0;
    this.keys = new Set();
    this.joy = new THREE.Vector2(); // -1..1
    this.speed = 2.6; // m/s
    this.locked = false;
    this.onLockChange = () => {};

    addEventListener('keydown', (e) => { if (!e.target.closest('input')) this.keys.add(e.code); });
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
    const sp = this.speed * (this.keys.has('ShiftLeft') ? 1.8 : 1) * dt;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const p = this.camera.position;
    p.addScaledVector(fwd, f * sp).addScaledVector(right, s * sp);
    p.x = THREE.MathUtils.clamp(p.x, this.bounds.min.x, this.bounds.max.x);
    p.z = THREE.MathUtils.clamp(p.z, this.bounds.min.z, this.bounds.max.z);
  }
}

// Sightline (Jens t866u, 12 Nov 2026) – a small reusable "look and measure" tool: what is the aim (crosshair)
// looking at, and how far away is it? Throttled raycast (SIGHTLINE.intervalMs, 10 a second) against the
// objects you give it, smoothed on a log scale so it never jitters. Maths in shared/sightline.mjs.
//   const s = new Sightline({ cast: () => metres | null });   // you do the raycast (e.g. main.js hitSurface)
//   s.update(nowMs)  – call every frame while it is in use (raycasts only every intervalMs)
//   s.distance       – smoothed metres (1 … 96)      s.value – smoothed 0…1 (log; 0 = 1 m, 1 = 96 m)
//   s.raw            – the last measured metres (null = nothing hit)   s.reset() – forget (next use starts fresh)
// Or let it cast itself: new Sightline({ raycaster, camera, targets: () => [meshes] }).
// Highline + Widthline (Jens t867u) come from the SAME throttled cast when it returns the hit
// ({ distance, point, normal, object, dir }): s.highline 0 = bottom … 1 = top of the aimed surface, s.widthline
// 0 = left … 1 = right (null = nothing hit / no surface). Not smoothed – they jump when the aim moves to another
// surface. s.lines() = { distance, sightline, highline, widthline } together.
import * as THREE from 'three';
import { SIGHTLINE, sightValue, sightMetres, sightSmooth, surfaceLines } from '../../shared/sightline.mjs';

const CENTER = new THREE.Vector2(0, 0);
export class Sightline {
  constructor({ cast = null, raycaster = null, camera = null, targets = () => [], minM = SIGHTLINE.minM, maxM = SIGHTLINE.maxM, intervalMs = SIGHTLINE.intervalMs, smoothMs = SIGHTLINE.smoothMs } = {}) {
    this.opts = { minM, maxM, intervalMs, smoothMs };
    this.cast = cast || (() => {
      const rc = raycaster || (this._rc ||= new THREE.Raycaster());
      camera.updateMatrixWorld(); rc.setFromCamera(CENTER, camera); rc.far = maxM * 2;
      const hit = rc.intersectObjects(targets(), false).find((x) => x.face);
      if (!hit) return null;
      const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (normal.dot(rc.ray.direction) > 0) normal.negate();
      return { distance: hit.distance, point: hit.point, normal, object: hit.object, dir: rc.ray.direction.clone() };
    });
    this.reset();
  }
  reset() { this.highline = null; this.widthline = null; this.surface = null; this.raw = null; this.target = null; this.smooth = null; this.lastCast = -Infinity; this.lastT = null; this.casts = 0; }
  update(now = performance.now()) {
    if (now - this.lastCast >= this.opts.intervalMs) {
      this.lastCast = now; this.casts++;
      let r = null; try { r = this.cast(); } catch { r = null; }
      const d = r && typeof r === 'object' ? r.distance : r;
      this.raw = Number.isFinite(d) ? d : null;
      this.measure(r && typeof r === 'object' ? r : null);
      this.target = sightValue(this.raw ?? Infinity, this.opts);
    }
    const dt = this.lastT == null ? 0 : now - this.lastT; this.lastT = now;
    this.smooth = sightSmooth(this.smooth, this.target, dt, this.opts.smoothMs);
    return this.value;
  }
  // Highline / Widthline from the hit: the hit mesh's world box (geometry box × matrixWorld – cheap, no traversal).
  measure(hit) {
    if (!hit || !hit.point || !hit.normal || !hit.object || !hit.object.geometry) { this.highline = null; this.widthline = null; this.surface = null; return; }
    const g = hit.object.geometry; if (!g.boundingBox) g.computeBoundingBox();
    const box = (this._box ||= new THREE.Box3()).copy(g.boundingBox).applyMatrix4(hit.object.matrixWorld);
    const dir = hit.dir || (hit.point.clone ? hit.point.clone().normalize() : null);
    const l = surfaceLines(hit.point.toArray(), hit.normal.toArray(), box.min.toArray(), box.max.toArray(), dir ? dir.toArray() : null);
    this.highline = l.highline; this.widthline = l.widthline; this.surface = hit.object.name || null;
  }
  lines() { return { distance: this.distance, sightline: this.value, highline: this.highline, widthline: this.widthline }; }
  get value() { return this.smooth ?? 1; }
  get distance() { return sightMetres(this.value, this.opts); }
  info() {
    const r = (v, k = 3) => (v == null ? null : +v.toFixed(k));
    return { raw: this.raw, distance: +this.distance.toFixed(2), value: +this.value.toFixed(4), highline: r(this.highline), widthline: r(this.widthline), surface: this.surface, casts: this.casts };
  }
}

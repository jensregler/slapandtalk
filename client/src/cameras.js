// Virtuella kameror i rummet (för inspelning). En kamera = position, blickriktning (yaw/pitch),
// bildvinkel (fov, lodrät, i grader) och valfritt bildformat (16:9 eller 9:16).
// Här finns bara det som syns: en liten kameramodell med namnskylt, och hur man ställer en
// THREE.PerspectiveCamera så att den ser exakt det kameran ser. Samma kod används i rummet
// och i uppspelaren (replay.js), och senare när en inspelning renderas till video.
import * as THREE from 'three';
import { S } from './strings.js';

export const CAMERA_FOVS = [35, 50, 60, 75, 90];
export const CAMERA_ASPECTS = S.camAspectTitles;
export const aspectRatio = (a) => (a === '16:9' ? 16 / 9 : a === '9:16' ? 9 / 16 : null);

// Ställ en vanlig kamera som den virtuella kameran (eller som en persons ögon: p, y, pi).
export function poseCamera(cam, { p, yaw = 0, pitch = 0, fov = null }) {
  cam.position.set(p[0], p[1], p[2]);
  cam.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  if (fov && cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
  cam.updateMatrixWorld();
}

// Rita bara i en ruta med kamerans format (svarta kanter runt), t.ex. 9:16 mitt på en bred skärm.
// Returnerar rutan { x, y, w, h } i CSS-pixlar.
export function frameRect(aspect, W, H) {
  const r = aspectRatio(aspect);
  if (!r) return { x: 0, y: 0, w: W, h: H };
  let w = W, h = Math.round(W / r);
  if (h > H) { h = H; w = Math.round(H * r); }
  return { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h };
}
export function renderFramed(renderer, scene, cam, aspect) {
  const size = renderer.getSize(new THREE.Vector2());
  const f = frameRect(aspect, size.x, size.y);
  cam.aspect = f.w / f.h; cam.updateProjectionMatrix();
  if (f.w === size.x && f.h === size.y) { renderer.setScissorTest(false); renderer.setViewport(0, 0, size.x, size.y); renderer.render(scene, cam); return f; }
  renderer.setScissorTest(false); renderer.setViewport(0, 0, size.x, size.y); renderer.setClearColor(0x000000, 1); renderer.clear();
  renderer.setScissorTest(true); renderer.setScissor(f.x, size.y - f.y - f.h, f.w, f.h); renderer.setViewport(f.x, size.y - f.y - f.h, f.w, f.h);
  renderer.render(scene, cam);
  renderer.setScissorTest(false); renderer.setViewport(0, 0, size.x, size.y);
  return f;
}

function label(text) {
  const c = document.createElement('canvas'); const g = c.getContext('2d');
  const font = '600 40px system-ui, sans-serif'; g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 36; c.width = w; c.height = 64;
  g.font = font; g.fillStyle = 'rgba(200,20,30,.88)'; g.beginPath(); g.roundRect(0, 0, w, 64, 18); g.fill();
  g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(text, 18, 34);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(w * 0.0019, 64 * 0.0019, 1); s.renderOrder = 10;
  return s;
}

// En liten filmkamera: kropp, objektiv och en tunn "synpyramid" som visar åt vilket håll den filmar.
function cameraModel(cam) {
  const g = new THREE.Group(); g.name = 'kamera';
  const dark = new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.5, metalness: 0.3 });
  const red = new THREE.MeshStandardMaterial({ color: 0xe0202a, emissive: 0x600000 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.22), dark); body.position.z = 0.04; g.add(body);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.09, 20), dark); lens.rotation.x = Math.PI / 2; lens.position.z = -0.11; g.add(lens);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), red); dot.position.set(0.05, 0.075, 0.1); g.add(dot);
  const r = aspectRatio(cam.aspect) || 16 / 9, d = 0.5, hh = Math.tan(THREE.MathUtils.degToRad(cam.fov || 60) / 2) * d, hw = hh * r;
  const pts = [[0, 0, -0.15], [-hw, -hh, -d], [0, 0, -0.15], [hw, -hh, -d], [0, 0, -0.15], [hw, hh, -d], [0, 0, -0.15], [-hw, hh, -d],
    [-hw, -hh, -d], [hw, -hh, -d], [hw, -hh, -d], [hw, hh, -d], [hw, hh, -d], [-hw, hh, -d], [-hw, hh, -d], [-hw, -hh, -d]].flat();
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.7 })));
  const tag = label(cam.name || S.cameraDefault); tag.position.set(0, 0.2, 0); g.add(tag);
  return g;
}

export class CameraLayer {
  constructor(scene) { this.scene = scene; this.map = new Map(); this.visible = true; this.hidden = null; this.eye = null; }
  key(c) { return JSON.stringify([c.name, c.fov, c.aspect]); }
  set(list) {
    const keep = new Set();
    for (const c of list || []) { keep.add(c.id); this.upsert(c); }
    for (const id of [...this.map.keys()]) if (!keep.has(id)) this.remove(id);
  }
  upsert(c) {
    let e = this.map.get(c.id);
    if (e && e.key !== this.key(c)) { this.remove(c.id); e = null; }
    if (!e) { e = { cam: c, key: this.key(c), obj: cameraModel(c) }; this.map.set(c.id, e); this.scene.add(e.obj); }
    e.cam = c;
    e.obj.position.set(c.p[0], c.p[1], c.p[2]);
    e.obj.quaternion.setFromEuler(new THREE.Euler(c.pitch || 0, c.yaw || 0, 0, 'YXZ'));
    this.apply();
  }
  remove(id) {
    const e = this.map.get(id); if (!e) return;
    this.scene.remove(e.obj);
    e.obj.traverse((o) => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
    this.map.delete(id);
  }
  list() { return [...this.map.values()].map((e) => e.cam).sort((a, b) => String(a.name).localeCompare(String(b.name), 'sv', { numeric: true })); }
  get(id) { return this.map.get(id)?.cam || null; }
  // visible = visa kamerorna över huvud taget; hideAll = tillfälligt (när man tittar genom en kamera)
  setVisible(v) { this.visible = !!v; this.apply(); }
  setHideAll(v) { this.hidden = !!v; this.apply(); }
  // Varje bildruta: står jag precis vid en kamera (t.ex. där jag nyss placerade den) döljs den,
  // annars hamnar den rakt framför ögonen.
  update(eye) { this.eye = eye ? eye.clone() : null; this.apply(); }
  apply() {
    for (const e of this.map.values()) {
      const near = this.eye && this.eye.distanceTo(e.obj.position) < 0.7;
      e.obj.visible = this.visible && !this.hidden && !near;
    }
  }
}

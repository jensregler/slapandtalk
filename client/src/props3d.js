// The 3D props' models (shared/props.mjs has the catalogue; Jens t491u/t509u, 4 Nov 2026), drawn in the
// sticker look: flat toon light (three hard steps) and a black ink outline (an inverted hull: the
// back faces pushed out along the normals) like the city's ink lines.
//   - CC0 models (Kenney, Quaternius; CREDITS.md) all in ONE file, /props/props.glb (~155 kB,
//     tools/build-props.sh: one scene per prop in GLB_ORDER), loaded the first time a prop is needed.
//   - Built here in code (no CC0 model): the elskåp, the PostNord box, bike rack, bus stop,
//     affischpelare, kiosk, phone booth, parked car, fountain, the cuboid and the Swedish road signs.
// Every prop of a kind shares one template's geometry and materials (clone(): only the scene graph is
// copied), so 100 street lights cost 100 small draw calls and no extra memory.
// Surfaces you can slap stickers on (the cuboid's six faces, the affischpelare's eight): PlaneGeometry
// meshes with userData.propFace = true; props layer (propsmode.js) adds them to the room's surfaces.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PROP_KINDS } from '../../shared/props.mjs';
import { BODY_TOP } from '../../shared/propcollide.mjs';

// The scenes of props.glb, in order (tools/build-props.sh ORDER).
export const GLB_ORDER = ['table', 'chair', 'sofa', 'plant', 'bookcase', 'floorlamp', 'lamp', 'bin', 'bin2', 'bench', 'market', 'hydrant', 'dumpster', 'statue',
  'lamp2', 'cone', 'barrier', 'trafficlight', 'planter', 'tree', 'treeL', 'parasol'];
export const GLB_URL = '/props/props.glb';
export const INK = 0x15130f;
const LINE = { lamp: 0.035, lamp2: 0.035, trafficlight: 0.03, tree: 0.03, treeL: 0.035, market: 0.025 }; // ink (m) – default 0.015

let gradient = null;
export function toonGradient() {
  if (gradient) return gradient;
  gradient = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter; gradient.needsUpdate = true;
  return gradient;
}
const toonCache = new Map();
export function toon(color) { const k = typeof color === 'number' ? color : String(color); if (!toonCache.has(k)) toonCache.set(k, new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() })); return toonCache.get(k); }
// Jens (t516u, 4 Nov 2026): no black ink outlines. Flip to true to bring the inverted hulls back.
export const INK_OUTLINES = false;
const outlineCache = new Map();
export function outlineMat(thick, color = INK) {
  const k = Math.round(thick * 1e5) + ':' + color;
  if (outlineCache.has(k)) return outlineCache.get(k);
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.userData.thick = thick;
  m.onBeforeCompile = (s) => {
    s.uniforms.thick = { value: thick };
    s.vertexShader = 'uniform float thick;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed += normalize(normal) * thick;');
  };
  m.customProgramCacheKey = () => 'ink' + k;
  outlineCache.set(k, m); return m;
}
// The same ink, thicker and yellow (the selected prop in the Props wheel).
export const highlightOf = (m) => outlineMat((m.userData.thick || 0.015) * 2.2, 0xffd400);
const hullOf = (g, thick) => { if (!INK_OUTLINES) return null; const h = new THREE.Mesh(g, outlineMat(thick)); h.raycast = () => {}; h.name = 'ink'; h.userData.ink = true; return h; };
// A model's meshes: toon materials + a welded hull each (one normal per corner: no cracks on flat-shaded models).
function stylize(root, line) {
  root.updateMatrixWorld(true);
  const meshes = []; root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const ws = new THREE.Vector3();
  for (const o of meshes) {
    const src = Array.isArray(o.material) ? o.material : [o.material];
    const mats = src.map((m) => new THREE.MeshToonMaterial({ color: m.color ? m.color.clone() : 0xffffff, map: m.map || null, gradientMap: toonGradient(), transparent: false }));
    o.material = Array.isArray(o.material) ? mats : mats[0];
    if (!INK_OUTLINES) continue; // no hull: skip building its geometry
    // positions only, as plain floats: the meshopt GLB's are interleaved/quantised, which mergeVertices can't write
    const sp = o.geometry.attributes.position, pos = new Float32Array(sp.count * 3);
    for (let i = 0; i < sp.count; i++) { pos[i * 3] = sp.getX(i); pos[i * 3 + 1] = sp.getY(i); pos[i * 3 + 2] = sp.getZ(i); }
    let g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (o.geometry.index) g.setIndex(Array.from(o.geometry.index.array));
    g = mergeVertices(g, 1e-4); g.computeVertexNormals();
    o.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), ws);
    o.add(hullOf(g, line / Math.max(1e-6, (Math.abs(ws.x) + Math.abs(ws.y) + Math.abs(ws.z)) / 3)));
  }
}
// Scaled to its real height, centred on x/z, standing on y = 0.
function normalize(obj, h) {
  const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3());
  obj.scale.multiplyScalar(h / Math.max(1e-6, size.y));
  const b2 = new THREE.Box3().setFromObject(obj), c = b2.getCenter(new THREE.Vector3());
  obj.position.sub(new THREE.Vector3(c.x, b2.min.y, c.z));
  const wrap = new THREE.Group(); wrap.add(obj); wrap.updateMatrixWorld(true); return wrap;
}

let glb = null;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
function loadGlb() {
  if (!glb) glb = loader.loadAsync(GLB_URL).then((g) => {
    const out = new Map();
    GLB_ORDER.forEach((kind, i) => {
      const sc = g.scenes[i]; if (!sc || !PROP_KINDS[kind]) return;
      const wrap = normalize(sc, PROP_KINDS[kind].h);
      stylize(wrap, LINE[kind] ?? 0.015);
      out.set(kind, wrap);
    });
    return out;
  });
  return glb;
}

// ---------- Built in code ----------
const ink = new THREE.MeshBasicMaterial({ color: INK });
// a part: geometry + material at (x, y, z) with a hull (line m); returns the mesh
function part(g, geo, mat, x, y, z, line = 0.02, rot = null) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (rot) m.rotation.set(...rot);
  if (line && INK_OUTLINES) m.add(hullOf(geo, line)); g.add(m); return m;
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const label = (text, bg, fg, w = 512, h = 128) => canvasTex(w, h, (g) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.font = `900 ${Math.round(h * 0.62)}px Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h * 0.54); });
const basic = (map) => new THREE.MeshBasicMaterial({ map });

function elskap() { // the grey-green Swedish electricity cabinet, a door, a yellow warning sign
  const g = new THREE.Group(), w = 0.9, h = 1.25, d = 0.4;
  part(g, new THREE.BoxGeometry(w, h, d), toon(0x8e9c8a), 0, h / 2, 0);
  part(g, new THREE.BoxGeometry(w + 0.06, 0.05, d + 0.06), toon(0x7c8a78), 0, h + 0.025, 0, 0.015);
  for (const [bw, bh, bx, by] of [[0.02, h * 0.86, 0, 0], [w * 0.86, 0.02, 0, h * 0.43], [w * 0.86, 0.02, 0, -h * 0.43]]) part(g, new THREE.BoxGeometry(bw, bh, 0.01), ink, bx, h / 2 + by, d / 2 + 0.005, 0);
  part(g, new THREE.PlaneGeometry(0.16, 0.14), basic(canvasTex(64, 56, (c) => { c.fillStyle = '#ffd400'; c.beginPath(); c.moveTo(32, 4); c.lineTo(60, 52); c.lineTo(4, 52); c.closePath(); c.fill(); c.strokeStyle = '#111'; c.lineWidth = 4; c.stroke(); c.fillStyle = '#111'; c.font = '900 30px Arial'; c.textAlign = 'center'; c.fillText('⚡', 32, 46); })), -w * 0.22, h * 0.75, d / 2 + 0.012, 0);
  return g;
}
function postlada() { // the yellow PostNord letter box on a post
  const g = new THREE.Group(), lift = 0.95, w = 0.42, h = 0.5, d = 0.3;
  part(g, new THREE.CylinderGeometry(0.04, 0.04, lift, 8), toon(0x555a5e), 0, lift / 2, 0);
  part(g, new THREE.BoxGeometry(w, h, d), toon(0xffc928), 0, lift + h / 2, 0);
  part(g, new THREE.CylinderGeometry(d / 2, d / 2, w, 12, 1, false, 0, Math.PI), toon(0xffc928), 0, lift + h, 0, 0.02, [0, 0, Math.PI / 2]);
  part(g, new THREE.BoxGeometry(w * 0.6, 0.03, 0.01), ink, 0, lift + h * 0.72, d / 2 + 0.006, 0);
  part(g, new THREE.PlaneGeometry(w * 0.8, 0.09), basic(label('PostNord', '#ffc928', '#0a4e8c')), 0, lift + h * 0.35, d / 2 + 0.006, 0);
  return g;
}
function bikerack() { // five bent tubes on a rail
  const g = new THREE.Group(), mat = toon(0x9aa0a6);
  for (let i = 0; i < 5; i++) part(g, new THREE.TorusGeometry(0.36, 0.025, 6, 14, Math.PI), mat, (i - 2) * 0.6, 0.42, 0, 0.012);
  part(g, new THREE.BoxGeometry(2.7, 0.05, 0.08), mat, 0, 0.03, 0, 0.012);
  return g;
}
function busstop() { // a shelter (glass back, roof, a bench) and the stop's sign on a pole
  const g = new THREE.Group(), steel = toon(0x3a3f44), w = 3, h = 2.4, d = 1.3;
  for (const x of [-w / 2, w / 2]) part(g, new THREE.BoxGeometry(0.08, h, 0.08), steel, x, h / 2, -d / 2 + 0.05);
  for (const x of [-w / 2, w / 2]) part(g, new THREE.BoxGeometry(0.08, h, 0.08), steel, x, h / 2, d / 2 - 0.05);
  part(g, new THREE.BoxGeometry(w + 0.3, 0.1, d + 0.2), toon(0x2f6fb4), 0, h + 0.05, 0);
  const glass = new THREE.MeshToonMaterial({ color: 0xbfe3f2, gradientMap: toonGradient(), transparent: true, opacity: 0.45 });
  part(g, new THREE.BoxGeometry(w, h * 0.8, 0.03), glass, 0, h * 0.5, -d / 2 + 0.05, 0.01);
  part(g, new THREE.BoxGeometry(w * 0.7, 0.08, 0.4), toon(0x9b6b3d), 0, 0.46, -d / 2 + 0.3);
  part(g, new THREE.CylinderGeometry(0.04, 0.04, 2.6, 8), steel, w / 2 + 0.6, 1.3, d / 2);
  part(g, new THREE.CircleGeometry(0.28, 24), basic(canvasTex(128, 128, (c) => { c.fillStyle = '#ffd400'; c.beginPath(); c.arc(64, 64, 62, 0, 7); c.fill(); c.lineWidth = 8; c.strokeStyle = '#1c7a3e'; c.stroke(); c.fillStyle = '#1c7a3e'; c.font = '900 44px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('BUSS', 64, 68); })), w / 2 + 0.6, 2.4, d / 2 + 0.05, 0.02);
  return g;
}
// The affischpelare: an 8-sided column (each side a flat face you can put stickers on), a cap and a foot.
const PILLAR = { r: 0.55, h: 2.6, n: 8 };
function pillar() {
  const g = new THREE.Group(), { r, h, n } = PILLAR, side = 2 * r * Math.tan(Math.PI / n);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(side, h), toon(0xf0e8d6));
    m.position.set(Math.sin(a) * r, 0.25 + h / 2, Math.cos(a) * r); m.rotation.y = a; m.userData.propFace = 'f' + k; g.add(m);
  }
  part(g, new THREE.CylinderGeometry(r / Math.cos(Math.PI / n) - 0.005, r / Math.cos(Math.PI / n) - 0.005, h, n), toon(0xf0e8d6), 0, 0.25 + h / 2, 0, 0.02, [0, Math.PI / n, 0]).visible = true;
  part(g, new THREE.CylinderGeometry(r + 0.12, r + 0.15, 0.25, 16), toon(0x2f5a3a), 0, 0.125, 0);
  part(g, new THREE.CylinderGeometry(r + 0.2, r + 0.1, 0.18, 16), toon(0x2f5a3a), 0, 0.25 + h + 0.09, 0);
  part(g, new THREE.ConeGeometry(r + 0.05, 0.35, 16), toon(0x2f5a3a), 0, 0.25 + h + 0.35, 0);
  return g;
}
function kiosk() {
  const g = new THREE.Group(), w = 2.4, h = 2.3, d = 2.0;
  part(g, new THREE.BoxGeometry(w, h, d), toon(0xd94c3d), 0, h / 2, 0);
  part(g, new THREE.BoxGeometry(w + 0.4, 0.14, d + 0.4), toon(0xf4efe6), 0, h + 0.07, 0);
  part(g, new THREE.PlaneGeometry(w * 0.8, 0.9), toon(0x2b3440), 0, 1.45, d / 2 + 0.005, 0);
  part(g, new THREE.BoxGeometry(w * 0.85, 0.06, 0.4), toon(0xf4efe6), 0, 0.98, d / 2 + 0.2);
  part(g, new THREE.PlaneGeometry(w * 0.9, 0.36), basic(label('KIOSK', '#ffd23f', '#d94c3d')), 0, h + 0.36, d / 2 + 0.1, 0.015);
  part(g, new THREE.BoxGeometry(w * 0.9, 0.4, 0.04), toon(0xffd23f), 0, h + 0.36, d / 2 + 0.07, 0.015);
  return g;
}
function phonebooth() {
  const g = new THREE.Group(), w = 1, h = 2.3, frame = toon(0xc43a2e);
  const glass = new THREE.MeshToonMaterial({ color: 0xcfeaf5, gradientMap: toonGradient(), transparent: true, opacity: 0.5 });
  for (const [x, z] of [[-w / 2, -w / 2], [w / 2, -w / 2], [-w / 2, w / 2], [w / 2, w / 2]]) part(g, new THREE.BoxGeometry(0.08, h, 0.08), frame, x, h / 2, z);
  part(g, new THREE.BoxGeometry(w + 0.12, 0.25, w + 0.12), frame, 0, h + 0.12, 0);
  part(g, new THREE.BoxGeometry(w, 0.08, w), frame, 0, 0.04, 0);
  for (const [x, z, ry] of [[0, -w / 2, 0], [-w / 2, 0, Math.PI / 2], [w / 2, 0, Math.PI / 2], [0, w / 2, 0]]) part(g, new THREE.BoxGeometry(w - 0.08, h - 0.2, 0.02), glass, x, h / 2, z, 0.008, [0, ry, 0]);
  part(g, new THREE.PlaneGeometry(w, 0.2), basic(label('TELEFON', '#c43a2e', '#ffffff')), 0, h + 0.12, w / 2 + 0.065, 0);
  part(g, new THREE.BoxGeometry(0.3, 0.4, 0.12), toon(0x2b2b2e), 0, 1.4, -w / 2 + 0.1);
  return g;
}
const CAR_COLOURS = [0xc43a2e, 0x3f7fd0, 0xf4efe6, 0x2f7d4f, 0x2b2b2e];
function car(variant = 0) { // a small estate car, parked
  const g = new THREE.Group(), L = 4.2, W = 1.8, paint = toon(CAR_COLOURS[variant % CAR_COLOURS.length]), dark = toon(0x22262b);
  part(g, new THREE.BoxGeometry(W, 0.6, L), paint, 0, 0.55, 0, 0.025);
  part(g, new THREE.BoxGeometry(W * 0.92, 0.55, L * 0.62), paint, 0, 1.12, -0.25, 0.025);
  const win = toon(0x30475c);
  part(g, new THREE.PlaneGeometry(W * 0.8, 0.42), win, 0, 1.13, L * 0.62 / 2 - 0.25 + 0.003, 0, [0, 0, 0]);
  part(g, new THREE.PlaneGeometry(W * 0.8, 0.42), win, 0, 1.13, -L * 0.62 / 2 - 0.25 - 0.003, 0, [0, Math.PI, 0]);
  for (const s of [-1, 1]) part(g, new THREE.PlaneGeometry(L * 0.56, 0.4), win, s * (W * 0.46 + 0.003), 1.13, -0.25, 0, [0, s * Math.PI / 2, 0]);
  for (const [x, z] of [[-W / 2 + 0.1, L / 2 - 0.75], [W / 2 - 0.1, L / 2 - 0.75], [-W / 2 + 0.1, -L / 2 + 0.75], [W / 2 - 0.1, -L / 2 + 0.75]]) part(g, new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14), dark, x, 0.33, z, 0.02, [0, 0, Math.PI / 2]);
  for (const s of [-1, 1]) part(g, new THREE.BoxGeometry(0.32, 0.12, 0.03), toon(0xfff3c4), s * 0.6, 0.65, L / 2 + 0.01, 0.01);
  for (const s of [-1, 1]) part(g, new THREE.BoxGeometry(0.3, 0.12, 0.03), toon(0xd22b2b), s * 0.6, 0.7, -L / 2 - 0.01, 0.01);
  part(g, new THREE.PlaneGeometry(0.52, 0.12), basic(label('ABC 123', '#ffffff', '#111111', 256, 64)), 0, 0.45, L / 2 + 0.005, 0);
  return g;
}
function fountain() {
  const g = new THREE.Group(), stone = toon(0xbdb6a8);
  part(g, new THREE.CylinderGeometry(1.7, 1.8, 0.55, 24, 1, true), stone, 0, 0.275, 0, 0.03);
  part(g, new THREE.TorusGeometry(1.72, 0.1, 6, 32), stone, 0, 0.56, 0, 0.02, [Math.PI / 2, 0, 0]);
  part(g, new THREE.CircleGeometry(1.68, 32), toon(0x5aa9d6), 0, 0.42, 0, 0, [-Math.PI / 2, 0, 0]);
  part(g, new THREE.CylinderGeometry(0.18, 0.28, 1.1, 12), stone, 0, 0.75, 0);
  part(g, new THREE.CylinderGeometry(0.7, 0.3, 0.22, 16), stone, 0, 1.35, 0);
  part(g, new THREE.SphereGeometry(0.16, 12, 8), toon(0x7cc4ea), 0, 1.56, 0, 0.015);
  return g;
}
// Swedish road signs (Transportstyrelsen's look, simplified): the sign's face is a canvas picture.
const SIGNS = {
  'sign-stop': { shape: 8, draw: (c) => { oct(c, '#d22b2b'); c.strokeStyle = '#fff'; c.lineWidth = 10; oct(c, null, 112); c.fillStyle = '#fff'; c.font = '900 78px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('STOP', 128, 134); } },
  'sign-yield': { shape: 3, draw: (c) => { tri(c, '#d22b2b', 0); tri(c, '#ffd400', 26); } },
  'sign-30': { shape: 0, draw: (c) => { circ(c, '#d22b2b', 124); circ(c, '#ffd400', 96); c.fillStyle = '#111'; c.font = '900 118px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('30', 128, 136); } },
  'sign-crossing': { shape: 4, draw: (c) => { c.fillStyle = '#1f5fae'; rr(c, 8, 8, 240, 240, 22); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(128, 36); c.lineTo(226, 212); c.lineTo(30, 212); c.closePath(); c.fill(); walker(c); } },
  'sign-parking': { shape: 4, draw: (c) => { c.fillStyle = '#1f5fae'; rr(c, 8, 8, 240, 240, 22); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 8; rr(c, 22, 22, 212, 212, 14); c.stroke(); c.fillStyle = '#fff'; c.font = '900 180px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('P', 128, 142); } },
  'sign-oneway': { shape: 4, draw: (c) => { c.fillStyle = '#1f5fae'; rr(c, 8, 8, 240, 240, 22); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(128, 30); c.lineTo(200, 110); c.lineTo(152, 110); c.lineTo(152, 226); c.lineTo(104, 226); c.lineTo(104, 110); c.lineTo(56, 110); c.closePath(); c.fill(); } },
  'sign-noentry': { shape: 0, draw: (c) => { circ(c, '#d22b2b', 124); c.fillStyle = '#fff'; c.fillRect(42, 108, 172, 40); } },
};
function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }
function circ(c, col, r) { c.fillStyle = col; c.beginPath(); c.arc(128, 128, r, 0, Math.PI * 2); c.fill(); }
function oct(c, col, r = 124) { c.beginPath(); for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + (k * Math.PI) / 4; c.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r); } c.closePath(); if (col) { c.fillStyle = col; c.fill(); } else c.stroke(); }
function tri(c, col, inset) { // pointing down (väjningsplikt)
  const t = 14 + inset * 1.15, b = 238 - inset * 1.7, l = 10 + inset * 1.9, r = 246 - inset * 1.9;
  c.fillStyle = col; c.beginPath(); c.moveTo(l, t); c.lineTo(r, t); c.lineTo(128, b); c.closePath(); c.fill();
}
function walker(c) { // the pedestrian on the zebra crossing
  c.fillStyle = '#111'; c.beginPath(); c.arc(128, 92, 13, 0, 7); c.fill();
  c.lineWidth = 12; c.lineCap = 'round'; c.strokeStyle = '#111'; c.beginPath();
  c.moveTo(126, 108); c.lineTo(120, 150); c.lineTo(100, 186); c.moveTo(120, 150); c.lineTo(146, 184); c.moveTo(124, 118); c.lineTo(104, 138); c.moveTo(124, 118); c.lineTo(150, 134); c.stroke();
  c.fillStyle = '#111'; for (let k = 0; k < 4; k++) c.fillRect(60 + k * 36, 196, 22, 10);
}
const signTex = new Map();
function sign(kind) {
  const S = SIGNS[kind], g = new THREE.Group(), size = 0.7, top = PROP_KINDS[kind].h - size / 2;
  part(g, new THREE.CylinderGeometry(0.035, 0.035, top + 0.1, 8), toon(0x9aa0a6), 0, (top + 0.1) / 2, 0, 0.012);
  if (!signTex.has(kind)) signTex.set(kind, canvasTex(256, 256, (c) => S.draw(c)));
  const geo = S.shape === 0 ? new THREE.CircleGeometry(size / 2, 32) : S.shape === 8 ? new THREE.CircleGeometry(size / 2, 8, Math.PI / 8) : S.shape === 3 ? new THREE.CircleGeometry(size / 2 * 1.1, 3, -Math.PI / 2) : new THREE.PlaneGeometry(size, size);
  if (S.shape !== 4) { // UVs from the position (so the picture fills the shape like on the square)
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, 0.5 + pos.getX(i) / size, 0.5 + pos.getY(i) / size);
  }
  const face = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: signTex.get(kind), transparent: true, alphaTest: 0.5 }));
  face.position.set(0, top, 0.03); g.add(face);
  const back = new THREE.Mesh(geo, toon(0xb9bec4)); back.position.set(0, top, 0.025); back.rotation.y = Math.PI; g.add(back);
  if (INK_OUTLINES) back.add(hullOf(geo, 0.012));
  return g;
}
// The cuboid (the build primitive, Jens 4 Nov 2026): six faces you can put stickers on, any size on each
// axis and a toon colour. Built per prop (its own size), rebuilt when resized.
const BOX_FACES = [['px', [1, 0, 0], [0, Math.PI / 2, 0]], ['nx', [-1, 0, 0], [0, -Math.PI / 2, 0]], ['py', [0, 1, 0], [-Math.PI / 2, 0, 0]], ['ny', [0, -1, 0], [Math.PI / 2, 0, 0]], ['pz', [0, 0, 1], [0, 0, 0]], ['nz', [0, 0, -1], [0, Math.PI, 0]]];
export function buildBox(sx, sy, sz, color) {
  const g = new THREE.Group(), mat = toon(color), dims = { x: sx, y: sy, z: sz };
  for (const [name, n, rot] of BOX_FACES) {
    const ax = n[0] ? 'x' : n[1] ? 'y' : 'z';
    const [w, h] = ax === 'x' ? [sz, sy] : ax === 'y' ? [sx, sz] : [sx, sy];
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(n[0] * sx / 2, sy / 2 + n[1] * sy / 2, n[2] * sz / 2); m.rotation.set(...rot);
    m.userData.propFace = name; g.add(m);
  }
  const t = Math.min(0.03, 0.01 + Math.min(sx, sy, sz) * 0.02);
  if (INK_OUTLINES) { const hull = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), outlineMat(t)); hull.position.y = sy / 2; hull.raycast = () => {}; hull.name = 'ink'; hull.userData.ink = true; g.add(hull); }
  g.userData.dims = dims; return g;
}

const CODE = { elskap, postlada, bikerack, busstop, pillar, kiosk, phonebooth, fountain };
const codeCache = new Map();
function codeTemplate(kind, variant) {
  const key = kind + (kind === 'car' ? variant : '');
  if (!codeCache.has(key)) {
    const g = kind === 'car' ? car(variant) : SIGNS[kind] ? sign(kind) : CODE[kind]();
    const box = new THREE.Box3().setFromObject(g), h = box.max.y; // drawn at its real height already (PROP_KINDS h ≈)
    g.userData.height = h; codeCache.set(key, g);
  }
  return codeCache.get(key);
}
const hashOf = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
// One prop's object (a new Group: clone of the kind's template; the cuboid is its own). Async: the
// GLB loads the first time. p: the prop record (for the cuboid's size/colour and the car's colour).
export async function makeProp(p) {
  const K = PROP_KINDS[p.kind]; if (!K) throw new Error('unknown prop ' + p.kind);
  let obj;
  if (K.box) obj = buildBox(p.sx || 1, p.sy || 1, p.sz || 1, p.color || '#f4efe6');
  else if (K.code) obj = codeTemplate(p.kind, hashOf(p.id) % CAR_COLOURS.length).clone(true);
  else { const t = (await loadGlb()).get(p.kind); if (!t) throw new Error('prop model missing: ' + p.kind); obj = t.clone(true); }
  const root = new THREE.Group(); root.add(obj); root.name = 'prop:' + p.kind; root.userData.kind = p.kind;
  return root;
}
export const preloadProps = () => loadGlb();

// Collision (shared/propcollide.mjs; Jens t521u): a prop's boxes in its own frame at scale s – per part
// (mesh), the footprint of its vertices up to BODY_TOP over the foot (so a street light is its pole, a
// tree its trunk, a bus stop its posts, glass and bench), from its lowest to its highest point. Parts
// entirely above that (a roof, a sign's face, a lamp's arm) don't block. Cached per kind and scale: every
// prop of a kind shares its template. The cuboid is its own W × H × D (cuboidBoxes).
const collideCache = new Map();
const _v = new THREE.Vector3(), _inv = new THREE.Matrix4(), _m = new THREE.Matrix4();
export function collisionBoxes(p, root) {
  const K = PROP_KINDS[p.kind]; if (!K || K.box) return null;
  const s = p.s || 1, key = p.kind + '@' + s;
  if (collideCache.has(key)) return collideCache.get(key);
  root.updateMatrixWorld(true); _inv.copy(root.matrixWorld).invert();
  const top = BODY_TOP, out = [];
  root.traverse((m) => {
    if (!m.isMesh || m.userData.ink || !m.geometry?.attributes?.position) return;
    _m.multiplyMatrices(_inv, m.matrixWorld);
    const pos = m.geometry.attributes.position;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity, any = false;
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(_m).multiplyScalar(s);
      if (_v.y < y0) y0 = _v.y; if (_v.y > y1) y1 = _v.y;
      if (_v.y > top) continue;
      any = true; if (_v.x < x0) x0 = _v.x; if (_v.x > x1) x1 = _v.x; if (_v.z < z0) z0 = _v.z; if (_v.z > z1) z1 = _v.z;
    }
    if (any && y0 < top) out.push({ x0, x1, y0: Math.max(0, y0), y1, z0, z1 });
  });
  collideCache.set(key, out);
  return out;
}
export { SIGNS, PILLAR };

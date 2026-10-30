// Fabrics ("tyg") on the avatars: an image tiled over a body part instead of the flat colour.
//  - the shader: triplanar mapping in the avatar's rest pose (attribute fabPos, see avatars.js; the model has no UVs), so the
//    pattern sticks to the body when it walks; scale/rotation/scroll are a UV transform and the
//    hue shift is a rotation around the grey axis, all in the fragment shader. Transparent parts
//    of the image show the slot's colour underneath.
//  - animation (cycle hue, spin, scroll) is computed from the wall clock on each client, so it
//    costs no network traffic and everyone sees the same phase.
//  - textures are cached by id (shared by every avatar wearing the same fabric), freed a little
//    while after nobody uses them, and at most FABRIC.maxTextures are alive at once (beyond that
//    a slot just shows its colour).
//  - images: resized in the browser to a square power of two (max 512 px, WebP/PNG, ≤ ~300 kB)
//    and stored with POST /api/fabrics (content hash id), so others load /uploads/<id>.webp.
import * as THREE from 'three';
import { FABRIC, FABRIC_ID_RE, cleanFabric, fabricPhase, fabricSize } from '../../shared/fabric.mjs';
import { unlockHeaders } from './entitlements.js';

export { FABRIC, cleanFabric, fabricPhase };
export const fabricUrl = (id) => `/uploads/${id}.webp`;

// ---------- Texture cache ----------
const GRACE_MS = 15_000;
const cache = new Map(); // id -> { tex, promise, refs, timer, failed }
const stats = { loads: 0, disposed: 0, denied: 0 };
let loader = null;
function evictOne() {
  for (const [id, e] of cache) if (e.refs <= 0) { clearTimeout(e.timer); drop(id); return true; }
  return false;
}
function drop(id) { const e = cache.get(id); if (!e) return; e.tex?.dispose(); cache.delete(id); stats.disposed++; }
// Fabric images are stored as a square with the picture fitted inside (POST /api/fabrics: 'contain',
// transparent bars beside a portrait / above and below a landscape picture). Tiled as is, those bars
// became wide gaps (the colour under the fabric) between the tiles (Jens, 30 Oct 2026: "it only repeats
// vertically, not sideways"). So when the image is letterboxed like that – content touching two
// opposite edges, equal empty bars on the other two – the bars are cut off and the picture is stretched
// back over the whole square texture (power of two, mipmaps as before); tex.userData.aspect = its real
// width / height, and the shader makes a tile that shape, so it tiles seamlessly both ways, undistorted.
export function letterboxOf(alpha, w, h) {
  const on = (x, y) => alpha[y * w + x] > 8;
  const col = (x) => { for (let y = 0; y < h; y++) if (on(x, y)) return true; return false; };
  const row = (y) => { for (let x = 0; x < w; x++) if (on(x, y)) return true; return false; };
  let l = 0, r = w - 1, t = 0, b = h - 1;
  while (l < w && !col(l)) l++;
  if (l >= w) return null; // empty image
  while (r > l && !col(r)) r--;
  while (t < h && !row(t)) t++;
  while (b > t && !row(b)) b--;
  const tol = Math.max(2, Math.round(w * 0.01));
  const padX = l + (w - 1 - r), padY = t + (h - 1 - b);
  // (cut 2 px further in on the padded side: the resize leaves half-transparent edge pixels – thin seams)
  if (padX > tol && padY <= 1 && Math.abs(l - (w - 1 - r)) <= tol && r - l > 8) return { x: l + 2, y: 0, w: r - l - 3, h };
  if (padY > tol && padX <= 1 && Math.abs(t - (h - 1 - b)) <= tol && b - t > 8) return { x: 0, y: t + 2, w, h: b - t - 3 };
  return null;
}
function unletterbox(tex) {
  const img = tex.image, w = img?.width | 0, h = img?.height | 0;
  tex.userData.aspect = w && h ? w / h : 1;
  if (!w || !h || typeof document === 'undefined') return tex;
  try {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, w, h).data, a = new Uint8Array(w * h);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
    const box = letterboxOf(a, w, h);
    if (!box) return tex;
    const o = document.createElement('canvas'); o.width = w; o.height = h;
    const og = o.getContext('2d'); og.imageSmoothingQuality = 'high';
    og.drawImage(c, box.x, box.y, box.w, box.h, 0, 0, w, h);
    const nt = new THREE.CanvasTexture(o);
    nt.userData.aspect = box.w / box.h; nt.userData.crop = box;
    tex.dispose();
    return nt;
  } catch { return tex; }
}
// Returns a promise of the texture (null if it can't be loaded or too many are in use).
export function acquireFabric(id) {
  if (!FABRIC_ID_RE.test(String(id))) return Promise.resolve(null);
  let e = cache.get(id);
  if (!e) {
    if (cache.size >= FABRIC.maxTextures && !evictOne()) { stats.denied++; return null; }
    loader ||= new THREE.TextureLoader();
    e = { tex: null, refs: 0, timer: 0, failed: false };
    stats.loads++;
    e.promise = loader.loadAsync(fabricUrl(id)).then((t0) => {
      const tex = unletterbox(t0);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.needsUpdate = true;
      if (cache.get(id) !== e) { tex.dispose(); return null; }
      e.tex = tex; return tex;
    }).catch(() => { e.failed = true; return null; });
    cache.set(id, e);
  }
  clearTimeout(e.timer); e.refs++;
  return e.promise;
}
export function releaseFabric(id) {
  const e = cache.get(id); if (!e) return;
  e.refs = Math.max(0, e.refs - 1);
  if (e.refs === 0) { clearTimeout(e.timer); e.timer = setTimeout(() => { if (cache.get(id) === e && e.refs === 0) drop(id); }, e.failed ? 0 : GRACE_MS); }
}
export const fabricStats = () => ({ ...stats, alive: cache.size, inUse: [...cache.values()].filter((e) => e.refs > 0).length,
  ids: [...cache.keys()], max: FABRIC.maxTextures });

// ---------- The shader ----------
const VERT_PARS = 'varying vec3 vFabPos;\nuniform float fabUnit;\n#ifdef USE_SKINNING\nattribute vec3 fabPos;\n#endif\n';
const VERT = `
#ifdef USE_SKINNING
  vFabPos = fabPos * fabUnit; // var hörnet sitter i viloläge (avatars.js), så mönstret följer kroppen
#else
  vFabPos = position * fabUnit;
#endif
`;
const FRAG_PARS = `varying vec3 vFabPos;
uniform sampler2D fabMap; uniform float fabAsp; uniform vec4 fabXf; uniform vec2 fabOff; uniform float fabHue; uniform float fabTint; uniform vec4 fabFace;
vec3 fabHueShift(vec3 c, float a) { const vec3 k = vec3(0.57735); float ca = cos(a); return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca); }
vec4 fabSample(vec2 p, mat2 R) { vec2 q = R * p * fabXf.z; q.x /= fabAsp; return texture2D(fabMap, q + fabOff); } // (a tile is the picture's shape: aspect = width / height)
`;
const FRAG = `
  {
    vec3 fp = vFabPos;
    vec3 fw = abs(normalize(cross(dFdx(fp), dFdy(fp))));
    fw = pow(fw, vec3(4.0)); fw /= (fw.x + fw.y + fw.z + 1e-5);
    mat2 R = mat2(fabXf.x, fabXf.y, -fabXf.y, fabXf.x);
#ifdef USE_FABPHOTO
    // A face photo: one square over the front of the head (avatars.js FACE), zoom = scale, tilt = rot.
    vec2 q = R * ((fp.xy - fabFace.xy) / (fabFace.z * fabXf.w)) + 0.5;
    vec4 fc = texture2D(fabMap, clamp(q, 0.002, 0.998));
    vec2 e = smoothstep(vec2(0.0), vec2(0.02), q) * smoothstep(vec2(0.0), vec2(0.02), 1.0 - q);
    fc.a *= e.x * e.y * smoothstep(fabFace.w, fabFace.w + 0.03, fp.z);
#else
    vec4 fc = fabSample(fp.zy, R) * fw.x + fabSample(fp.xz, R) * fw.y + fabSample(fp.xy, R) * fw.z;
#endif
    fc.rgb = max(fabHueShift(fc.rgb, fabHue), 0.0) * fabTint;
    diffuseColor.rgb = mix(diffuseColor.rgb, fc.rgb, fc.a);
  }
`;
function fabricCompile(shader) {
  const u = this.userData.fab;
  Object.assign(shader.uniforms, { fabMap: u.map, fabAsp: u.asp, fabXf: u.xf, fabOff: u.off, fabHue: u.hue, fabTint: u.tint, fabUnit: u.unit, fabFace: u.face });
  if (!this.defines || !('USE_FABRIC' in this.defines)) return;
  shader.vertexShader = VERT_PARS + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT);
  shader.fragmentShader = FRAG_PARS + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG);
}
const cacheKey = function () { const d = this.defines || {}; return 'fabric3' + ('USE_FABRIC' in d ? '+' : '-') + ('USE_FABPHOTO' in d ? 'p' : ''); };
// Make a material able to wear a fabric (does nothing until setFabric).
// face = avatars.js FACE: this material is the face's and may wear a face photo (f.photo).
export function makeFabricable(mat, { tint = 1, unit = 1, face = null } = {}) {
  mat.userData.fab = { map: { value: null }, asp: { value: 1 }, xf: { value: new THREE.Vector4(1, 0, 4, 0) }, off: { value: new THREE.Vector2() },
    hue: { value: 0 }, tint: { value: tint }, unit: { value: unit }, f: null,
    canPhoto: !!face, face: { value: face ? new THREE.Vector4(face.cx, face.cy, face.size, face.zMin) : new THREE.Vector4(0, 0, 1, 0) } };
  mat.onBeforeCompile = fabricCompile; mat.customProgramCacheKey = cacheKey;
  return mat;
}
export function setFabric(mat, tex, f) {
  const u = mat.userData.fab; if (!u) return;
  const on = !!(tex && f);
  u.map.value = on ? tex : null; u.f = on ? f : null;
  u.asp.value = on ? Math.min(16, Math.max(1 / 16, tex.userData?.aspect || 1)) : 1;
  const photo = on && u.canPhoto && !!f.photo, d = mat.defines || {};
  if (on !== 'USE_FABRIC' in d || photo !== 'USE_FABPHOTO' in d) {
    const nd = { ...d }; delete nd.USE_FABRIC; delete nd.USE_FABPHOTO;
    if (on) nd.USE_FABRIC = ''; if (photo) nd.USE_FABPHOTO = '';
    mat.defines = nd; mat.needsUpdate = true;
  }
  if (on) tickFabric(mat);
}
const DEG = Math.PI / 180;
export function tickFabric(mat, tMs = Date.now()) {
  const u = mat.userData.fab; if (!u || !u.f) return;
  const f = u.f, ph = fabricPhase(f, tMs);
  u.xf.value.set(Math.cos(ph.rot * DEG), Math.sin(ph.rot * DEG), 1 / (FABRIC.tileMeters * f.scale), f.scale);
  u.off.value.set(0, ph.offset); u.hue.value = ph.hue * DEG;
}

// ---------- Images: resize in the browser, then upload ----------
const toBlob = (c, type, q) => new Promise((r) => c.toBlob(r, type, q));
export async function prepareFabricImage(blob) {
  const bmp = await createImageBitmap(blob);
  let size = fabricSize(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  for (;;) {
    c.width = c.height = size;
    const g = c.getContext('2d'); g.clearRect(0, 0, size, size);
    const k = Math.min(size / bmp.width, size / bmp.height), w = bmp.width * k, h = bmp.height * k;
    g.imageSmoothingQuality = 'high'; g.drawImage(bmp, (size - w) / 2, (size - h) / 2, w, h);
    let out = await toBlob(c, 'image/webp', 0.88);
    if (!out || out.type !== 'image/webp') out = await toBlob(c, 'image/png');
    if (out.size <= FABRIC.maxBytes || size <= 64) { bmp.close?.(); return out; }
    size /= 2;
  }
}
// A face photo: the middle square of the picture (cover, not fit), so a portrait fills the face.
export async function prepareFacePhoto(blob) {
  const bmp = await createImageBitmap(blob);
  let size = fabricSize(Math.min(bmp.width, bmp.height), Math.min(bmp.width, bmp.height));
  const side = Math.min(bmp.width, bmp.height), sx = (bmp.width - side) / 2, sy = (bmp.height - side) / 2;
  const c = document.createElement('canvas');
  for (;;) {
    c.width = c.height = size;
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, sx, sy, side, side, 0, 0, size, size);
    let out = await toBlob(c, 'image/webp', 0.88);
    if (!out || out.type !== 'image/webp') out = await toBlob(c, 'image/jpeg', 0.85);
    if (out.size <= FABRIC.maxBytes || size <= 64) { bmp.close?.(); return out; }
    size /= 2;
  }
}
export async function uploadFabric(blob) {
  const fd = new FormData();
  fd.append('file', blob, blob.type === 'image/png' ? 'tyg.png' : 'tyg.webp');
  const res = await fetch('/api/fabrics', { method: 'POST', body: fd, headers: unlockHeaders() }); // full version only (server checks)
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data; // { id, url, width, height, kind: 'fabric' }
}

// ---------- Built-in patterns (drawn here, uploaded the first time someone wears one) ----------
const POP = ['#ff2e63', '#ffd400', '#00d1ff', '#7cff4f', '#ff7a00', '#b14bff', '#111111', '#ffffff'];
export const PRESETS = {
  stripes: { name: 'Stripes', draw(g, s) { g.fillStyle = POP[0]; g.fillRect(0, 0, s, s); g.fillStyle = POP[1]; for (let i = 0; i < 4; i++) g.fillRect(0, i * s / 4, s, s / 8); } },
  checks: { name: 'Checks', draw(g, s) { g.fillStyle = POP[7]; g.fillRect(0, 0, s, s); g.fillStyle = POP[6]; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2) g.fillRect(x * s / 4, y * s / 4, s / 4, s / 4); } },
  dots: { name: 'Dots', transparent: true, draw(g, s) { g.fillStyle = POP[2]; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.beginPath(); g.arc((x + (y % 2) * 0.5) * s / 4 % s + s / 8, y * s / 4 + s / 8, s / 14, 0, 7); g.fill(); } } },
  zigzag: { name: 'Zigzag', draw(g, s) { g.fillStyle = POP[5]; g.fillRect(0, 0, s, s); g.strokeStyle = POP[3]; g.lineWidth = s / 14; for (let r = 0; r < 4; r++) { g.beginPath(); for (let i = 0; i <= 8; i++) g.lineTo(i * s / 8, r * s / 4 + (i % 2 ? s / 8 : s / 16)); g.stroke(); } } },
  stars: { name: 'Stars', transparent: true, draw(g, s) { g.fillStyle = POP[1]; const star = (cx, cy, r) => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.fill(); }; star(s / 4, s / 4, s / 7); star(3 * s / 4, 3 * s / 4, s / 7); } },
  ulla: { name: 'ULLA', draw(g, s) { g.fillStyle = POP[0]; g.fillRect(0, 0, s, s); g.fillStyle = POP[1]; g.font = `900 ${s / 4.2}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ULLA', s / 2, s / 4); g.fillStyle = POP[2]; g.fillText('ULLA', s / 2, 3 * s / 4); } },
};
export function presetCanvas(key, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); PRESETS[key].draw(g, size); return c;
}
export const presetBlob = (key) => toBlob(presetCanvas(key), 'image/png');

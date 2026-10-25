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
// Returns a promise of the texture (null if it can't be loaded or too many are in use).
export function acquireFabric(id) {
  if (!FABRIC_ID_RE.test(String(id))) return Promise.resolve(null);
  let e = cache.get(id);
  if (!e) {
    if (cache.size >= FABRIC.maxTextures && !evictOne()) { stats.denied++; return null; }
    loader ||= new THREE.TextureLoader();
    e = { tex: null, refs: 0, timer: 0, failed: false };
    stats.loads++;
    e.promise = loader.loadAsync(fabricUrl(id)).then((tex) => {
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
uniform sampler2D fabMap; uniform vec4 fabXf; uniform vec2 fabOff; uniform float fabHue; uniform float fabTint;
vec3 fabHueShift(vec3 c, float a) { const vec3 k = vec3(0.57735); float ca = cos(a); return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca); }
vec4 fabSample(vec2 p, mat2 R) { return texture2D(fabMap, R * p * fabXf.z + fabOff); }
`;
const FRAG = `
  {
    vec3 fp = vFabPos;
    vec3 fw = abs(normalize(cross(dFdx(fp), dFdy(fp))));
    fw = pow(fw, vec3(4.0)); fw /= (fw.x + fw.y + fw.z + 1e-5);
    mat2 R = mat2(fabXf.x, fabXf.y, -fabXf.y, fabXf.x);
    vec4 fc = fabSample(fp.zy, R) * fw.x + fabSample(fp.xz, R) * fw.y + fabSample(fp.xy, R) * fw.z;
    fc.rgb = max(fabHueShift(fc.rgb, fabHue), 0.0) * fabTint;
    diffuseColor.rgb = mix(diffuseColor.rgb, fc.rgb, fc.a);
  }
`;
function fabricCompile(shader) {
  const u = this.userData.fab;
  Object.assign(shader.uniforms, { fabMap: u.map, fabXf: u.xf, fabOff: u.off, fabHue: u.hue, fabTint: u.tint, fabUnit: u.unit });
  if (!this.defines || !('USE_FABRIC' in this.defines)) return;
  shader.vertexShader = VERT_PARS + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT);
  shader.fragmentShader = FRAG_PARS + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG);
}
const cacheKey = function () { return 'fabric1' + (this.defines && 'USE_FABRIC' in this.defines ? '+' : '-'); };
// Make a material able to wear a fabric (does nothing until setFabric).
export function makeFabricable(mat, { tint = 1, unit = 1 } = {}) {
  mat.userData.fab = { map: { value: null }, xf: { value: new THREE.Vector4(1, 0, 4, 0) }, off: { value: new THREE.Vector2() },
    hue: { value: 0 }, tint: { value: tint }, unit: { value: unit }, f: null };
  mat.onBeforeCompile = fabricCompile; mat.customProgramCacheKey = cacheKey;
  return mat;
}
export function setFabric(mat, tex, f) {
  const u = mat.userData.fab; if (!u) return;
  const on = !!(tex && f);
  u.map.value = on ? tex : null; u.f = on ? f : null;
  const had = !!mat.defines && 'USE_FABRIC' in mat.defines;
  if (on !== had) { mat.defines = { ...(mat.defines || {}) }; if (on) mat.defines.USE_FABRIC = ''; else delete mat.defines.USE_FABRIC; mat.needsUpdate = true; }
  if (on) tickFabric(mat);
}
const DEG = Math.PI / 180;
export function tickFabric(mat, tMs = Date.now()) {
  const u = mat.userData.fab; if (!u || !u.f) return;
  const f = u.f, ph = fabricPhase(f, tMs);
  u.xf.value.set(Math.cos(ph.rot * DEG), Math.sin(ph.rot * DEG), 1 / (FABRIC.tileMeters * f.scale), 0);
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
export async function uploadFabric(blob) {
  const fd = new FormData();
  fd.append('file', blob, blob.type === 'image/png' ? 'tyg.png' : 'tyg.webp');
  const res = await fetch('/api/fabrics', { method: 'POST', body: fd });
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

// Rummets utseende: golv, väggar (alla väggar likadana), väggfärg och tak.
// Katalogen finns i shared/styles.json (samma fil som servern kontrollerar mot).
//
// Två sorters texturer:
//  - bilder (parkett, betong, asfalt, matta, tegel, träpanel, puts) från ambientCG, CC0.
//    De hämtas först när ett rum faktiskt använder dem, så mobilen laddar bara det som behövs.
//  - ritade i webbläsaren (målat, kakel, linoleum, klinker, klassisk), lätta och skarpa.
// Alla texturer läggs ut i verklig skala: "scale" = hur många meter en textur täcker.
import * as THREE from 'three';
import { S } from './strings.js';
import CATALOG from '../../shared/styles.json';
import { cleanFabric, acquireFabric, releaseFabric, makeFabricable, setFabric, tickFabric } from './fabrics.js';

export { CATALOG };
export const DEFAULT_STYLE = { ...CATALOG.default };

// Gör en stil giltig: okända värden byts mot standard, färg bara där den behövs.
export function normalizeStyle(s) {
  const st = { ...DEFAULT_STYLE, ...(s && typeof s === 'object' ? s : {}) };
  const out = {
    floor: CATALOG.floors[st.floor] ? st.floor : DEFAULT_STYLE.floor,
    wall: CATALOG.walls[st.wall] ? st.wall : DEFAULT_STYLE.wall,
    ceiling: CATALOG.ceilings[st.ceiling] ? st.ceiling : DEFAULT_STYLE.ceiling,
  };
  if (CATALOG.walls[out.wall].colored) out.wallColor = CATALOG.wallColors[st.wallColor] ? st.wallColor : 'vit';
  if (typeof st.seed === 'string' && /^[a-z0-9]{1,12}$/.test(st.seed)) out.seed = st.seed;
  const f = cleanRoomFabric(st.fabric); if (f) out.fabric = f;
  const sf = cleanSurfFabrics(st.surfFabric); if (sf) out.surfFabric = sf;
  return out;
}
// Own image per surface (Jens, 30 Oct 2026): style.surfFabric = { floor?, wall?, ceiling? }, each one a
// room fabric like Färg's (same controls, same image upload). A surface's own image wins over Färg on
// that surface; Färg still covers the surfaces without one; the rest show the catalogue material.
// Same gating as Färg (full version; the server drops it otherwise).
export const SURF_KINDS = ['floor', 'wall', 'ceiling'];
export function cleanSurfFabrics(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const out = {};
  for (const k of SURF_KINDS) { const f = cleanRoomFabric(o[k]); if (f) out[k] = f; }
  return Object.keys(out).length ? out : null;
}
export const kindOf = (mesh) => (mesh.name === 'golv' ? 'floor' : mesh.name === 'tak' ? 'ceiling' : 'wall');
// The fabric a surface shows (its own image, else Färg, else none).
export const surfaceFabric = (s, kind) => s.surfFabric?.[kind] || s.fabric || null;
// "Färg" (Jens, 29 Oct 2026, point 11): the room's own image over the floor, the walls AND the ceiling,
// with every fabric control the avatar has (scale, rotation, hue, cycle hue, spin, scroll) and the
// colour under transparent parts (base). style.fabric = { id, scale, rot, hue, cycleHue, hueHz, spin,
// spinHz, scroll, base }. Full version (entitlements.full.fabrics, like the avatar's fabrics; the
// server drops it for the free version). One tile = scale × ROOM_TILE_M on every surface.
export const ROOM_TILE_M = 1;
const HEX_RE = /^#[0-9a-f]{6}$/i;
export function cleanRoomFabric(f) {
  const c = f && typeof f === 'object' ? cleanFabric(f) : null;
  if (!c) return null;
  c.photo = false;
  c.base = typeof f.base === 'string' && HEX_RE.test(f.base) ? f.base.toLowerCase() : '#ffffff';
  return c;
}

// ---------- Slump-kod -> stil (samma kod ger alltid samma rum) ----------
function hash32(str) { let h = 2166136261; for (const c of str) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];
const SEED_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
export function randomSeed(n = 5) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map((x) => SEED_CHARS[x % SEED_CHARS.length]).join('');
}
export function styleFromSeed(seed) {
  seed = String(seed).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'a';
  const rnd = mulberry32(hash32(seed));
  const floor = pick(rnd, Object.keys(CATALOG.floors).filter((k) => k !== 'klassisk'));
  const wall = pick(rnd, Object.keys(CATALOG.walls).filter((k) => k !== 'klassisk'));
  const wallColor = pick(rnd, Object.keys(CATALOG.wallColors));
  const ceiling = pick(rnd, ['vit', 'vit', 'betong', 'mork']);
  return normalizeStyle({ floor, wall, wallColor, ceiling, seed });
}

export function styleName(s) {
  s = normalizeStyle(s);
  const w = CATALOG.walls[s.wall];
  const own = s.surfFabric || {};
  if (s.fabric && !own.floor && !own.wall && !own.ceiling) return S.styleNameFarg;
  if (own.floor || own.wall || own.ceiling || s.fabric) {
    const nm = (k, catalog) => (own[k] ? S.ownImage.toLowerCase() : s.fabric ? S.farg : catalog);
    return S.styleNameOwn(nm('floor', CATALOG.floors[s.floor].name), nm('wall', w.name), nm('ceiling', CATALOG.ceilings[s.ceiling].name));
  }
  return S.styleName(CATALOG.floors[s.floor].name, w.name, s.wallColor ? CATALOG.wallColors[s.wallColor].name : '');
}

// ---------- Texturer ----------
const loader = new THREE.TextureLoader();
const cache = new Map(); // nyckel -> Promise<Texture>

function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  return new THREE.CanvasTexture(c);
}
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
function noiseInto(g, size, amount) {
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() - 0.5) * amount;
    img.data[i] += v; img.data[i + 1] += v; img.data[i + 2] += v;
  }
  g.putImageData(img, 0, 0);
}
const DRAW = {
  noise: (spec) => canvasTex(256, (g, n) => { const b = spec.base; g.fillStyle = `rgb(${b},${b},${b})`; g.fillRect(0, 0, n, n); noiseInto(g, n, spec.spread); }),
  paint: (spec, color) => canvasTex(256, (g, n) => {
    g.fillStyle = color || spec.color || '#eeeeee'; g.fillRect(0, 0, n, n);
    // mjuka, stora fläckar som när man målat med roller (ritas runt kanterna så texturen går ihop sömlöst)
    for (let i = 0; i < 18; i++) {
      const x = Math.random() * n, y = Math.random() * n, r = n * (0.15 + Math.random() * 0.3), tone = Math.random() < 0.5 ? '0,0,0' : '255,255,255';
      for (const [dx, dy] of [[0, 0], [n, 0], [-n, 0], [0, n], [0, -n]]) {
        const grd = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        grd.addColorStop(0, `rgba(${tone},0.035)`); grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd; g.fillRect(0, 0, n, n);
      }
    }
    noiseInto(g, n, 7);
  }),
  tiles: (spec, color) => canvasTex(512, (g, n) => {
    const count = Math.round(spec.scale / spec.tile), t = n / count, gw = Math.max(2, Math.round(t * 0.035));
    g.fillStyle = spec.grout; g.fillRect(0, 0, n, n);
    const [r, gg, b] = rgb(color || spec.color || '#f1eee7');
    for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) {
      const k = 1 + (Math.random() - 0.5) * 0.08;
      const grd = g.createLinearGradient(x * t, y * t, (x + 1) * t, (y + 1) * t);
      grd.addColorStop(0, `rgb(${Math.min(255, r * k + 14)},${Math.min(255, gg * k + 14)},${Math.min(255, b * k + 14)})`);
      grd.addColorStop(1, `rgb(${r * k * 0.94},${gg * k * 0.94},${b * k * 0.94})`);
      g.fillStyle = grd;
      g.fillRect(x * t + gw / 2, y * t + gw / 2, t - gw, t - gw);
    }
    noiseInto(g, n, 6);
  }),
  checker: (spec) => canvasTex(512, (g, n) => {
    const count = Math.round(spec.scale / spec.tile), t = n / count;
    for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) { g.fillStyle = spec.colors[(x + y) % 2]; g.fillRect(x * t, y * t, t, t); }
    noiseInto(g, n, 12);
  }),
};

function texture(spec, color) {
  const key = spec.kind === 'image' ? `img:${spec.file}` : `${spec.kind}:${JSON.stringify(spec)}:${color || ''}`;
  if (!cache.has(key)) {
    const p = spec.kind === 'image' ? loader.loadAsync(`/textures/${spec.file}.webp`) : Promise.resolve(DRAW[spec.kind](spec, color));
    cache.set(key, p.then((t) => { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; })
      .catch((e) => { cache.delete(key); throw e; }));
  }
  return cache.get(key);
}

// The room's fabric textures (Färg and each surface's own image), ref-counted in fabrics.js's cache:
// one reference per image id in use here; ids no longer used are released.
const roomFab = { ids: new Map(), farg: null, need: [] }; // id -> Promise<Texture|null>
function roomFabricTextures(ids) {
  for (const [id] of roomFab.ids) if (!ids.includes(id)) { roomFab.ids.delete(id); releaseFabric(id); }
  for (const id of ids) if (!roomFab.ids.has(id)) {
    const e = { tex: null };
    e.promise = Promise.resolve(acquireFabric(id) || null).then((t) => { e.tex = t; return t; });
    roomFab.ids.set(id, e);
  }
  roomFab.need = ids;
  return Promise.all(ids.map((id) => roomFab.ids.get(id).promise.then((t) => [id, t]))).then((l) => new Map(l));
}
// Every frame: the room's fabrics spin / cycle / scroll on the wall clock, like the avatars' fabrics.
export function tickRoomFabric(surfaces, tMs = Date.now()) {
  if (!roomFab.ids.size) return;
  for (const m of surfaces) if (m.material?.userData?.fab?.f) tickFabric(m.material, tMs);
}
// id = Färg's image (null without Färg); own = { mesh name: its own image id }; on = surfaces with a fabric.
export const roomFabricInfo = (surfaces) => ({ id: roomFab.farg,
  loaded: roomFab.need.every((id) => roomFab.ids.get(id)?.tex),
  on: surfaces.filter((m) => m.material?.userData?.fab?.f).map((m) => m.name), colors: surfaces.map((m) => '#' + m.material.color.getHexString()),
  own: Object.fromEntries(surfaces.filter((m) => m.userData.ownFab).map((m) => [m.name, m.userData.ownFab])),
  params: Object.fromEntries(surfaces.filter((m) => m.material?.userData?.fab?.f).map((m) => [m.name, m.material.userData.fab.f])) });

// Lägg en stil på rummets ytor. Returnerar ett löfte som blir klart när texturerna laddats.
let applyVersion = 0;
export async function applyStyle(surfaces, style) {
  const s = normalizeStyle(style);
  const v = ++applyVersion;
  const color = s.wallColor ? CATALOG.wallColors[s.wallColor].hex : null;
  for (const mesh of surfaces) if (!mesh.material.userData.fab) makeFabricable(mesh.material, { unit: 0.25 / ROOM_TILE_M }); // fabric space: 25 cm × scale = 1 m × scale
  const ids = [...new Set(surfaces.map((m) => surfaceFabric(s, kindOf(m))?.id).filter(Boolean))];
  roomFab.farg = s.fabric ? s.fabric.id : null;
  const texs = await roomFabricTextures(ids);
  if (v !== applyVersion) return s;
  const jobs = surfaces.map(async (mesh) => {
    const kind = kindOf(mesh);
    const fab = surfaceFabric(s, kind);
    mesh.userData.ownFab = s.surfFabric?.[kind]?.id || null;
    if (fab) {
      const tex = texs.get(fab.id) || null;
      const mat = mesh.material;
      if (mat.map) { mat.map.dispose(); mat.map = null; }
      mat.color.set(fab.base); mat.roughness = 0.9;
      setFabric(mat, tex, tex ? fab : null); // no texture (failed / too many): just the colour under it
      mat.needsUpdate = true;
      return;
    }
    const spec = kind === 'floor' ? CATALOG.floors[s.floor] : kind === 'ceiling' ? CATALOG.ceilings[s.ceiling] : CATALOG.walls[s.wall];
    const base = await texture(spec, kind === 'wall' ? color : null);
    if (v !== applyVersion) return; // en nyare stil hann väljas (t.ex. i förhandsvisningen)
    const { width, height } = mesh.geometry.parameters;
    const t = base.clone(); // egen upprepning per yta, samma bild i minnet
    t.repeat.set(width / spec.scale, height / spec.scale);
    t.needsUpdate = true;
    const mat = mesh.material;
    setFabric(mat, null, null); mat.color.set(0xffffff);
    if (mat.map && mat.map !== t) mat.map.dispose();
    mat.map = t;
    mat.roughness = spec.roughness ?? 0.95;
    mat.needsUpdate = true;
  });
  await Promise.all(jobs);
  return s;
}

// Liten bild för knapparna i rumsmenyn.
export function swatchUrl(kind, id, color) {
  const spec = (kind === 'floor' ? CATALOG.floors : kind === 'ceiling' ? CATALOG.ceilings : CATALOG.walls)[id];
  if (spec.kind === 'image') return `/textures/thumbs/${spec.file}.webp`;
  const tex = DRAW[spec.kind](spec, color);
  return tex.image.toDataURL('image/png');
}

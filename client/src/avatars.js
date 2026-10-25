// Gubbarna: andra spelare i rummet (och förhandsvisningen i "Min gubbe").
// Modellen är Quaternius "Ultimate Modular Men Pack" (CC0), ihopbyggd till en enda liten fil
// (avatars/gubbe.glb) av tools/make-avatar.mjs: ett skelett, animationerna Idle/Walk/Wave
// och utbytbara delar. Vilka delar och färger som finns står i shared/avatar.json.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import AV from '../../shared/avatar.json';
import { ArmGesture } from './slapanim.js';

export const AVATAR = AV;
export const AVATAR_URL = '/avatars/gubbe.glb';
const SCALE = 0.9;              // modellen är 1,87 m; 0,9 ger ögonen ungefär i kamerans höjd (1,6 m)
const TOP = 1.87 * SCALE;       // huvudets topp
const LOOK_KEY = 'klibb.avatar';

const pickColor = (v, list, def) => (typeof v === 'string' && list.includes(v.toLowerCase()) ? v.toLowerCase() : def);
export function normalizeLook(l) {
  const d = AV.default; l = l && typeof l === 'object' ? l : {};
  return {
    outfit: AV.outfits[l.outfit] ? l.outfit : d.outfit,
    hair: AV.hair[l.hair] ? l.hair : d.hair,
    shirt: pickColor(l.shirt, AV.colors.shirt, d.shirt),
    pants: pickColor(l.pants, AV.colors.pants, d.pants),
    hairColor: pickColor(l.hairColor, AV.colors.hair, d.hairColor),
    skin: pickColor(l.skin, AV.colors.skin, d.skin),
    hat: l.hat === true,
    hatColor: pickColor(l.hatColor, AV.colors.hat, d.hatColor),
  };
}
const any = (list) => list[Math.floor(Math.random() * list.length)];
export function randomLook() {
  return normalizeLook({
    outfit: any(Object.keys(AV.outfits)), hair: any(Object.keys(AV.hair)), shirt: any(AV.colors.shirt), pants: any(AV.colors.pants),
    hairColor: any(AV.colors.hair), skin: any(AV.colors.skin), hat: Math.random() < 0.3, hatColor: any(AV.colors.hat),
  });
}
// Samma regler som servern: inga kontroll-/osynliga tecken, högst 24 tecken (emoji klipps inte itu).
export const cleanName = (s) => Array.from(String(s ?? '').normalize('NFC').replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '').replace(/\s+/g, ' ').trim())
  .slice(0, AV.maxName).join('').trim();
// Min gubbe sparas bara på den här enheten.
export function loadMyAvatar() {
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(LOOK_KEY) || '{}') || {}; } catch { /* trasig, börja om */ }
  return { name: cleanName(saved.name), look: normalizeLook(saved.look || (saved.outfit ? saved : randomLook())), saved: !!saved.look };
}
export function saveMyAvatar(name, look) { localStorage.setItem(LOOK_KEY, JSON.stringify({ name: cleanName(name), look: normalizeLook(look) })); }

// ---------- Modellen (laddas en gång, delas av alla gubbar) ----------
let modelPromise = null;
export function loadAvatarModel() {
  if (!modelPromise) {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    modelPromise = loader.loadAsync(AVATAR_URL).then((gltf) => {
      const clips = Object.fromEntries(gltf.animations.map((a) => [a.name, a]));
      return { scene: gltf.scene, clips };
    });
    modelPromise.catch(() => { modelPromise = null; });
  }
  return modelPromise;
}

// Vilken roll har ett material på en viss del? (hud, hår, tröja, byxor eller ingen)
const PART_ROLE = {};
for (const o of Object.values(AV.outfits)) { PART_ROLE[o.body] = { shirt: o.shirt }; PART_ROLE[o.legs] = { pants: o.pants }; PART_ROLE[o.feet] = {}; }
for (const hh of Object.values(AV.hair)) PART_ROLE[hh.head] = { hair: hh.hair };
const PARTS = new Set(Object.keys(PART_ROLE));
function roleOf(part, mat) {
  const r = PART_ROLE[part] || {};
  if (mat === 'Skin') return 'skin';
  if (mat === 'Skin_Darker') return 'skinDark';
  if (mat === 'Eyebrows') return 'brows';
  if (r.hair === mat) return 'hair';
  if (r.shirt === mat) return 'shirt';
  if (r.pants === mat) return 'pants';
  return null;
}

// En keps (byggd med kod, modellen har ingen): kupa + skärm.
const capGeo = (() => {
  const dome = new THREE.SphereGeometry(0.118, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const brim = new THREE.CylinderGeometry(0.11, 0.11, 0.012, 12, 1, false, -Math.PI / 2, Math.PI);
  brim.scale(1, 1, 1.5); brim.translate(0, 0.004, 0.07);
  return [dome, brim];
})();

function labelTexture(text, { bg = 'rgba(0,0,0,.55)', color = '#fff', font = 600, size = 44, maxW = 900, pad = 18, lines = 1 } = {}) {
  const c = document.createElement('canvas'); const g = c.getContext('2d');
  g.font = `${font} ${size}px system-ui, sans-serif`;
  // radbryt (för pratbubblor)
  const words = String(text).split(' '); const rows = []; let row = '';
  for (const w of words) { const t = row ? row + ' ' + w : w; if (g.measureText(t).width > maxW && row) { rows.push(row); row = w; } else row = t; }
  rows.push(row);
  const shown = rows.slice(0, lines); if (rows.length > lines) shown[lines - 1] = shown[lines - 1].replace(/.{0,2}$/, '…');
  const w = Math.min(maxW, Math.max(...shown.map((r) => g.measureText(r).width))) + pad * 2, hgt = shown.length * size * 1.2 + pad * 1.4;
  c.width = Math.ceil(w); c.height = Math.ceil(hgt);
  g.font = `${font} ${size}px system-ui, sans-serif`;
  g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, c.width, c.height, Math.min(28, c.height / 2)); g.fill();
  g.fillStyle = color; g.textBaseline = 'middle'; g.textAlign = 'center';
  shown.forEach((r, i) => g.fillText(r, c.width / 2, pad * 0.7 + size * 0.6 + i * size * 1.2, maxW));
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return { tex, w: c.width, h: c.height };
}
// mpp = meter per pixel i bilden, så texten blir lika stor oavsett hur lång den är
function makeSprite(text, opts, mpp) {
  const { tex, w, h } = labelTexture(text, opts);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.set(w * mpp, h * mpp, 1); s.renderOrder = 10;
  return s;
}

export class Avatar {
  constructor(model, look, name = '') {
    this.root = new THREE.Group();
    this.root.name = 'gubbe';
    this.model = cloneSkinned(model.scene);
    this.model.scale.setScalar(SCALE);
    this.root.add(this.model);
    this.parts = {}; // delnamn -> [meshar]
    this.mats = { skin: [], skinDark: [], brows: [], hair: [], shirt: [], pants: [] };
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      let part = o; while (part && !PARTS.has(part.name)) part = part.parent;
      if (!part) return;
      o.frustumCulled = false; // skinnade meshar har fel "bounding box" när de rör sig
      o.raycast = () => {};    // gubbar ska aldrig träffas av stämpel-strålen
      (this.parts[part.name] ||= []).push(o);
      const role = roleOf(part.name, o.material.name);
      if (role) { o.material = o.material.clone(); this.mats[role].push(o.material); } // bara färgade material klonas, resten delas
    });
    this.head = this.model.getObjectByName('Head');
    const capMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true });
    this.cap = new THREE.Group(); this.capMat = capMat;
    for (const g of capGeo) { const m = new THREE.Mesh(g, capMat); m.raycast = () => {}; this.cap.add(m); }
    this.root.add(this.cap);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const [n, clip] of Object.entries(model.clips)) this.actions[n] = this.mixer.clipAction(clip);
    this.actions.Idle?.play();
    if (this.actions.Walk) { this.actions.Walk.play(); this.actions.Walk.setEffectiveWeight(0); }
    this.walk = 0; this.waveUntil = 0;
    this.gesture = new ArmGesture(this.model); // slap- och peel-rörelsen (slapanim.js)
    this.setLook(look); this.setName(name);
  }
  setLook(look) {
    this.look = normalizeLook(look);
    const L = this.look, o = AV.outfits[L.outfit], hd = AV.hair[L.hair];
    const show = new Set([o.body, o.legs, o.feet, hd.head]);
    for (const [p, list] of Object.entries(this.parts)) for (const m of list) m.visible = show.has(p);
    const set = (role, hex, mul = 1) => this.mats[role].forEach((m) => { m.color.set(hex); if (mul !== 1) m.color.multiplyScalar(mul); });
    set('skin', L.skin); set('skinDark', L.skin, 0.82); set('hair', L.hairColor); set('brows', L.hairColor, 0.55);
    set('shirt', L.shirt); set('pants', L.pants);
    this.cap.visible = L.hat; this.capMat.color.set(L.hatColor);
  }
  setName(name) {
    this.name = name;
    if (this.tag) { this.root.remove(this.tag); this.tag.material.map.dispose(); this.tag.material.dispose(); this.tag = null; }
    if (!name) return;
    this.tag = makeSprite(name, { size: 44 }, 0.0021);
    this.tag.position.set(0, TOP + 0.22, 0);
    this.root.add(this.tag);
  }
  // Pratbubbla ovanför huvudet i några sekunder.
  say(text, ms = 5000) {
    this.unsay();
    this.bubble = makeSprite(text, { bg: 'rgba(255,255,255,.93)', color: '#111', font: 500, size: 40, maxW: 640, lines: 3 }, 0.0021);
    this.bubble.position.set(0, TOP + 0.36 + this.bubble.scale.y / 2, 0);
    this.root.add(this.bubble);
    this.bubbleUntil = performance.now() + ms;
    this.waveUntil = performance.now() + 1600;
  }
  // Slap: armen upp mot punkten (världskoordinater) direkt, och sedan ner igen. Peel: grip och dra.
  slap(point, normal = null) { this.waveUntil = 0; this.actions.Wave?.stop(); return this.gesture.start('slap', point, normal); }
  peel(point, normal = null) { this.waveUntil = 0; this.actions.Wave?.stop(); return this.gesture.start('peel', point, normal); }
  get gestures() { return this.gesture.count; }
  unsay() { if (this.bubble) { this.root.remove(this.bubble); this.bubble.material.map.dispose(); this.bubble.material.dispose(); this.bubble = null; } }
  // speed = hur fort gubben går (m/s) → gå- eller stå-animation
  update(dt, speed = 0) {
    const target = speed > 0.25 ? 1 : 0;
    this.walk += (target - this.walk) * Math.min(1, dt * 8);
    const waving = performance.now() < this.waveUntil && this.walk < 0.2 && this.actions.Wave;
    if (this.actions.Wave) {
      if (waving && !this.actions.Wave.isRunning()) { this.actions.Wave.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.2).play(); }
    }
    this.actions.Walk?.setEffectiveWeight(this.walk);
    if (this.actions.Walk) this.actions.Walk.timeScale = THREE.MathUtils.clamp(speed / 1.6, 0.6, 1.8);
    this.actions.Idle?.setEffectiveWeight(1 - this.walk);
    this.mixer.update(dt);
    this.gesture.apply(this.root);
    if (this.cap.visible && this.head) {
      this.root.updateMatrixWorld(true);
      // Kepsen följer huvudbenet (i gubbens eget koordinatsystem).
      const m = new THREE.Matrix4().copy(this.root.matrixWorld).invert().multiply(this.head.matrixWorld);
      const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      m.decompose(pos, q, sc);
      this.cap.position.copy(new THREE.Vector3(0, 0.205, 0.012).applyQuaternion(q).add(pos));
      this.cap.quaternion.copy(q);
    }
    if (this.bubble && performance.now() > this.bubbleUntil) this.unsay();
  }
  dispose() {
    this.unsay(); this.setName('');
    for (const list of Object.values(this.mats)) list.forEach((m) => m.dispose());
    this.capMat.dispose(); this.mixer.stopAllAction();
  }
}

// ---------- Andra spelare i rummet ----------
// Positioner kommer ~12 gånger per sekund. Vi visar dem 150 ms "i efterhand" och glider
// mellan de två senaste, så rörelsen blir mjuk även om nätet hackar lite.
const DELAY = 150;
export class Players {
  constructor(scene) {
    this.scene = scene; this.map = new Map(); this.model = null;
    loadAvatarModel().then((m) => { this.model = m; for (const p of this.map.values()) this.build(p); }).catch(() => {});
  }
  build(p) {
    if (!this.model || p.avatar) return;
    p.avatar = new Avatar(this.model, p.look, p.name);
    this.scene.add(p.avatar.root);
    this.place(p, performance.now());
  }
  upsert({ id, name, look, p, y }) {
    let pl = this.map.get(id);
    if (!pl) { pl = { id, name, look, snaps: [], pos: new THREE.Vector3(), yaw: 0, speed: 0 }; this.map.set(id, pl); }
    pl.name = name; pl.look = look;
    if (p) this.move(id, p, y, true);
    this.build(pl);
    if (pl.avatar) { pl.avatar.setLook(look); if (pl.avatar.name !== name) pl.avatar.setName(name); }
    return pl;
  }
  move(id, p, y, jump = false) {
    const pl = this.map.get(id); if (!pl || !Array.isArray(p)) return;
    const t = performance.now();
    if (jump) pl.snaps = [];
    pl.snaps.push({ t, x: p[0], z: p[2], y: Number(y) || 0 });
    if (pl.snaps.length > 30) pl.snaps.shift();
  }
  look(id, name, look) { const pl = this.map.get(id); if (pl) this.upsert({ id, name, look }); }
  remove(id) {
    const ids = id === '*' ? [...this.map.keys()] : [id];
    for (const i of ids) { const pl = this.map.get(i); if (!pl) continue; if (pl.avatar) { this.scene.remove(pl.avatar.root); pl.avatar.dispose(); } this.map.delete(i); }
  }
  say(id, text) { const pl = this.map.get(id); if (pl?.avatar) pl.avatar.say(text); }
  // Någon annan slappade (eller peelade): deras gubbe gör rörelsen mot klibban.
  gesture(id, kind, point, normal = null) {
    const pl = this.map.get(id); if (!pl) return false;
    pl.gestures = (pl.gestures || 0) + 1;
    return !!pl.avatar && (kind === 'peel' ? pl.avatar.peel(point, normal) : pl.avatar.slap(point, normal));
  }
  place(pl, now) {
    const s = pl.snaps; if (!s.length) return;
    const t = now - DELAY;
    let a = s[0], b = s[0];
    for (let i = s.length - 1; i >= 0; i--) { if (s[i].t <= t) { a = s[i]; b = s[i + 1] || s[i]; break; } }
    const k = b.t > a.t ? THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1) : 1;
    const x = a.x + (b.x - a.x) * k, z = a.z + (b.z - a.z) * k;
    let dy = b.y - a.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); // kortaste vägen runt
    pl.pos.set(x, 0, z); pl.yaw = a.y + dy * k;
    if (pl.avatar) { pl.avatar.root.position.copy(pl.pos); pl.avatar.root.rotation.y = pl.yaw + Math.PI; }
  }
  update(dt, eye = null) {
    const now = performance.now();
    for (const pl of this.map.values()) {
      const before = pl.pos.clone();
      this.place(pl, now);
      // Står någon precis där jag står? Dölj gubben, annars hamnar kameran inuti den.
      if (pl.avatar && eye) pl.avatar.root.visible = Math.hypot(pl.pos.x - eye.x, pl.pos.z - eye.z) > 0.45;
      const v = dt > 0 ? before.distanceTo(pl.pos) / dt : 0;
      pl.speed += (v - pl.speed) * Math.min(1, dt * 10);
      pl.avatar?.update(dt, pl.speed);
    }
  }
  list() {
    return [...this.map.values()].map((p) => ({ id: p.id, name: p.name, look: p.look, pos: p.pos.toArray(), yaw: p.yaw, speed: p.speed,
      walking: !!p.avatar && p.avatar.walk > 0.5, built: !!p.avatar, tag: p.avatar ? p.avatar.name : null, bubble: p.avatar?.bubble ? true : false,
      gestures: p.gestures || 0, gesturing: !!p.avatar?.gesture.active() }));
  }
}

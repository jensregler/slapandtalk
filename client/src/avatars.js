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
import { cleanFabrics } from '../../shared/fabric.mjs';
import { acquireFabric, releaseFabric, makeFabricable, setFabric, tickFabric } from './fabrics.js';
import { Mouth, MOUTH } from './mouth.js';
import { FACE, isFaceTriangle, effectiveFabrics } from './face.js';
export { FACE, effectiveFabrics };
const MOUTH_AT = MOUTH.at;
import { quantLevel, openOf } from '../../shared/director.mjs';

export const AVATAR = AV;
export const AVATAR_URL = '/avatars/gubbe.glb';
const SCALE = 0.9;              // modellen är 1,87 m; 0,9 ger ögonen ungefär i kamerans höjd (1,6 m)
const TOP = 1.87 * SCALE;       // huvudets topp
const LOOK_KEY = 'klibb.avatar';

export const FACE_HEX = /^#[0-9a-f]{6}$/i;
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
    ...(typeof l.face === 'string' && FACE_HEX.test(l.face) ? { face: l.face.toLowerCase() } : {}), // own face colour; absent = skin
    ...(cleanFabrics(l.fabric) ? { fabric: cleanFabrics(l.fabric) } : {}), // tyger (valfritt), se shared/fabric.mjs
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
      addFabricPositions(gltf.scene);
      addFaceGroups(gltf.scene);
      return { scene: gltf.scene, clips };
    });
    modelPromise.catch(() => { modelPromise = null; });
  }
  return modelPromise;
}

// Tygerna behöver en fast position på kroppen (modellen har inga UV-koordinater, och varje del är
// kvantiserad i sitt eget lilla koordinatsystem). Vi räknar ut var varje hörn sitter när gubben står
// i viloläge (i meter, samma system för alla delar) och sparar det som attributet fabPos, en gång per
// geometri. Då följer mönstret kroppen när den går i stället för att glida.
function addFabricPositions(scene) {
  scene.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isSkinnedMesh || o.geometry.attributes.fabPos) return;
    const n = o.geometry.attributes.position.count, out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld); out.set([v.x, v.y, v.z], i * 3); }
    o.geometry.setAttribute('fabPos', new THREE.BufferAttribute(out, 3));
  });
}

// ---------- The face (Jens, 29 Oct 2026): its own material, independent of the body (face.js) ----------
const HEADS = new Set(Object.values(AV.hair).map((h) => h.head));
const headPart = (o) => { let p = o; while (p && !HEADS.has(p.name)) p = p.parent; return p; };
function addFaceGroups(scene) {
  scene.traverse((o) => {
    if (!o.isSkinnedMesh || !headPart(o)) return;
    const g = o.geometry, name = o.material.name;
    if (name === 'Skin_Darker') { g.userData.faceAll = true; return; } // the stubble patch: all face
    if (name !== 'Skin' || g.userData.faceGroups || !g.index) return;
    const fp = g.attributes.fabPos.array, idx = g.index.array, rest = [], face = [];
    const P = (i) => [fp[i * 3], fp[i * 3 + 1], fp[i * 3 + 2]];
    for (let t = 0; t < idx.length; t += 3) (isFaceTriangle(P(idx[t]), P(idx[t + 1]), P(idx[t + 2])) ? face : rest).push(idx[t], idx[t + 1], idx[t + 2]);
    if (!face.length) return;
    idx.set([...rest, ...face]); g.index.needsUpdate = true;
    g.clearGroups(); g.addGroup(0, rest.length, 0); g.addGroup(rest.length, face.length, 1);
    g.userData.faceGroups = face.length / 3;
  });
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
// The speaking mark: three rounded bars on a soft dark pill, drawn once and shared.
let talkTex = null;
function talkTexture() {
  if (talkTex) return talkTex;
  const c = document.createElement('canvas'); c.width = 128; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,.5)'; g.beginPath(); g.roundRect(4, 4, 120, 56, 28); g.fill();
  g.fillStyle = '#9fe0a0';
  [[38, 22], [64, 34], [90, 22]].forEach(([x, h]) => { g.beginPath(); g.roundRect(x - 6, 32 - h / 2, 12, h, 6); g.fill(); });
  talkTex = new THREE.CanvasTexture(c); talkTex.colorSpace = THREE.SRGBColorSpace;
  return talkTex;
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
    this.mats = { skin: [], skinDark: [], brows: [], hair: [], shirt: [], pants: [], face: [], faceDark: [] };
    this.faceFeatures = []; // the head's eyes and eyebrows (hidden under a face photo, which has its own)
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      let part = o; while (part && !PARTS.has(part.name)) part = part.parent;
      if (!part) return;
      o.frustumCulled = false; // skinnade meshar har fel "bounding box" när de rör sig
      o.raycast = () => {};    // gubbar ska aldrig träffas av stämpel-strålen
      (this.parts[part.name] ||= []).push(o);
      const role = roleOf(part.name, o.material.name), g = o.geometry;
      if (HEADS.has(part.name) && (o.material.name === 'Eye' || o.material.name === 'Eyebrows')) this.faceFeatures.push({ m: o, part: part.name });
      if (role === 'skinDark' && g.userData.faceAll) { o.material = o.material.clone(); o.material.name = 'Face_Darker'; this.mats.faceDark.push(o.material); }
      else if (role === 'skin' && g.userData.faceGroups) { // the head: skin + the face (its own material)
        const skin = o.material.clone(), face = o.material.clone(); face.name = 'Face';
        o.material = [skin, face]; this.mats.skin.push(skin); this.mats.face.push(face);
      } else if (role) { o.material = o.material.clone(); this.mats[role].push(o.material); } // bara färgade material klonas, resten delas
    });
    this.head = this.model.getObjectByName('Head');
    const capMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true });
    this.cap = new THREE.Group(); this.capMat = capMat;
    for (const g of capGeo) { const m = new THREE.Mesh(g, capMat); m.raycast = () => {}; this.cap.add(m); }
    this.root.add(this.cap);
    // The talking mouth (mouth.js): follows the head bone like the cap, hidden while silent.
    this.mouth = new Mouth(name || Math.random()); this.root.add(this.mouth.group); this.mouthT = null;
    // Tyger: varje färgplats kan bära en upprepad bild (fabrics.js). Huden har två material (mörkare skugga).
    for (const [role, list] of Object.entries(this.mats)) for (const m of list) makeFabricable(m, { tint: role === 'skinDark' || role === 'faceDark' ? 0.82 : 1, face: role === 'face' || role === 'faceDark' ? FACE : null });
    makeFabricable(capMat);
    this.slotMats = { shirt: this.mats.shirt, pants: this.mats.pants, hair: this.mats.hair, skin: [...this.mats.skin, ...this.mats.skinDark], hat: [capMat], face: [...this.mats.face, ...this.mats.faceDark] };
    this.fab = {}; // plats -> { id, f, tex, ok }
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
    set('face', L.face || L.skin); set('faceDark', L.face || L.skin, 0.82);
    this.cap.visible = L.hat; this.capMat.color.set(L.hatColor);
    this.applyFabrics(effectiveFabrics(L));
    this.updateFaceFeatures();
  }
  // Samma tyg-id som förut: bara nya värden. Nytt id: hämta texturen (cachad), färgen syns tills den är laddad.
  applyFabrics(fabric) {
    for (const [slot, mats] of Object.entries(this.slotMats)) {
      const want = fabric[slot] || null, cur = this.fab[slot];
      if (cur && (!want || want.id !== cur.id)) { if (cur.ok) releaseFabric(cur.id); delete this.fab[slot]; mats.forEach((m) => setFabric(m, null, null)); }
      if (!want) continue;
      if (this.fab[slot]) { this.fab[slot].f = want; if (this.fab[slot].tex) mats.forEach((m) => setFabric(m, this.fab[slot].tex, want)); continue; }
      const entry = { id: want.id, f: want, tex: null, ok: false };
      this.fab[slot] = entry;
      const p = acquireFabric(want.id);
      if (!p) continue; // för många olika tyger just nu: färgen får duga
      entry.ok = true;
      p.then((tex) => {
        if (this.fab[slot] !== entry || this.disposed || !tex) return;
        entry.tex = tex; mats.forEach((m) => setFabric(m, tex, entry.f));
        if (slot === 'face') this.updateFaceFeatures();
      });
    }
  }
  // A face photo (loaded) brings its own eyes: the model's eyes and eyebrows step aside meanwhile.
  updateFaceFeatures() {
    const L = this.look, o = AV.outfits[L.outfit], hd = AV.hair[L.hair], show = new Set([o.body, o.legs, o.feet, hd.head]);
    const photo = !!(this.fab.face?.tex && this.fab.face.f.photo);
    for (const { m, part } of this.faceFeatures) m.visible = !photo && show.has(part);
  }
  // Tests: what the face shows (its colour, its fabric/photo, whether the model's eyes are shown).
  faceInfo() {
    const f = this.fab.face;
    return { colour: '#' + (this.mats.face[0]?.color.getHexString() || ''), skin: '#' + (this.mats.skin[0]?.color.getHexString() || ''),
      split: this.mats.face.length > 0, fabric: f ? { id: f.id, loaded: !!f.tex, photo: !!f.f.photo } : null, photo: this.facePhoto,
      eyes: this.faceFeatures.some(({ m }) => m.visible) };
  }
  get facePhoto() { return !!(this.fab.face?.tex && this.fab.face.f.photo); }
  fabricInfo() { return Object.fromEntries(Object.entries(this.fab).map(([s, e]) => [s, { id: e.id, loaded: !!e.tex, f: e.f }])); }
  setName(name) {
    this.name = name;
    if (this.tag) { this.root.remove(this.tag); this.tag.material.map.dispose(); this.tag.material.dispose(); this.tag = null; }
    if (!name) return;
    this.tag = makeSprite(name, { size: 44 }, 0.0021);
    this.tag.position.set(0, TOP + 0.22, 0);
    this.root.add(this.tag);
  }
  // Voice: a small, calm "speaking" mark above the name (three soft bars), only while they talk.
  setSpeaking(on, level = 0) {
    if (on && !this.talk) {
      this.talk = new THREE.Sprite(new THREE.SpriteMaterial({ map: talkTexture(), depthWrite: false, transparent: true }));
      this.talk.scale.set(0.16, 0.08, 1); this.talk.renderOrder = 11; this.talk.name = 'speaking';
      this.root.add(this.talk);
    }
    if (!this.talk) return;
    this.talk.visible = !!on;
    if (!on) this.setMouth(0, this.mouthT);
    this.talk.position.set(0, TOP + (this.tag ? 0.36 : 0.22), 0);
    const k = 1 + Math.min(1, level * 6) * 0.25; this.talk.scale.set(0.16 * k, 0.08 * k, 1);
  }
  get speaking() { return !!(this.talk && this.talk.visible); }
  // The mouth: open = 0…1, or a raw voice level (rms / audioLevel) through talkLevel().
  // t = the replay's timeline time (ms), so the glitches are the same every time it is played.
  setMouth(open, t = null) { this.mouth.set(open, performance.now()); this.mouthT = t; }
  talkLevel(rms) { this.setMouth(openOf(quantLevel(rms))); }
  get mouthInfo() { return this.mouth.info; }
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
  // The drag pose while pulling out a sticker row (target = where the row ends now); release() ends it.
  hold(point, normal = null, age = null, out = null) { this.waveUntil = 0; return this.gesture.hold(point, normal, age, out); }
  release() { this.gesture.release(); }
  drop() { this.gesture.h = null; } // no drag pose at all (the replay, seeking away from a row)
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
    const now = Date.now();
    for (const [slot, e] of Object.entries(this.fab)) if (e.tex) this.slotMats[slot].forEach((m) => tickFabric(m, now));
    if (this.cap.visible && this.head) {
      this.root.updateMatrixWorld(true);
      // Kepsen följer huvudbenet (i gubbens eget koordinatsystem).
      const m = new THREE.Matrix4().copy(this.root.matrixWorld).invert().multiply(this.head.matrixWorld);
      const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      m.decompose(pos, q, sc);
      this.cap.position.copy(new THREE.Vector3(0, 0.205, 0.012).applyQuaternion(q).add(pos));
      this.cap.quaternion.copy(q);
    }
    if (this.mouth && this.head) {
      this.mouth.update(dt, this.mouthT);
      if (this.mouth.group.visible) {
        this.root.updateMatrixWorld(true);
        const m = new THREE.Matrix4().copy(this.root.matrixWorld).invert().multiply(this.head.matrixWorld);
        const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
        m.decompose(pos, q, sc);
        this.mouth.group.position.copy(new THREE.Vector3(...MOUTH_AT).applyQuaternion(q).add(pos));
        this.mouth.group.quaternion.copy(q);
      }
    }
    if (this.bubble && performance.now() > this.bubbleUntil) this.unsay();
  }
  dispose() {
    this.mouth?.dispose();
    this.unsay(); this.setName(''); if (this.talk) { this.root.remove(this.talk); this.talk.material.dispose(); this.talk = null; }
    this.disposed = true;
    for (const e of Object.values(this.fab)) if (e.ok) releaseFabric(e.id);
    this.fab = {};
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
  upsert({ id, name, look, p, y, slot }) {
    let pl = this.map.get(id);
    if (!pl) { pl = { id, name, look, snaps: [], pos: new THREE.Vector3(), yaw: 0, speed: 0, slot: 0 }; this.map.set(id, pl); }
    pl.name = name; pl.look = look; if (Number.isInteger(slot)) pl.slot = slot;
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
  speaking(id, on, level = 0) { const pl = this.map.get(id); if (!pl) return false; pl.talking = !!on; pl.avatar?.setSpeaking(on, level); if (on) pl.avatar?.talkLevel(level); return true; }
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
      gestures: p.gestures || 0, slot: p.slot, speaking: !!p.avatar?.speaking, mouth: p.avatar ? p.avatar.mouthInfo : null, gesturing: !!p.avatar?.gesture.active(), fabrics: p.avatar ? p.avatar.fabricInfo() : {}, face: p.avatar ? p.avatar.faceInfo() : null }));
  }
}

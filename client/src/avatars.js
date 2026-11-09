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
import { DANCE, dancePoseAt, dancePhase, danceGrid, danceDuration } from '../../shared/dance.mjs';
export { DANCE, dancePoseAt, dancePhase };
// The master clock the dance's beats lock to (main.js: () => ({ nowMs, tempo })); null = the fixed 120 BPM.
let danceClock = null;
export function setDanceClock(fn) { danceClock = typeof fn === 'function' ? fn : null; }
function clockNow() { try { const c = danceClock && danceClock(); return c && Number.isFinite(c.nowMs) ? c : null; } catch { return null; } }
import { cleanFabrics } from '../../shared/fabric.mjs';
import { acquireFabric, releaseFabric, makeFabricable, setFabric, tickFabric } from './fabrics.js';
import { Mouth, MOUTH } from './mouth.js';
import { FACE, isFaceTriangle, effectiveFabrics } from './face.js';
import { ownsLockedFace, applyLockedFace } from '../../shared/lockedface.mjs';
import { cleanInsta } from '../../shared/insta.mjs';
export { cleanInsta };
import { rollLookOnRestart, keepFace } from './restartlook.js';
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
  const out = {
    outfit: AV.outfits[l.outfit] ? l.outfit : d.outfit,
    hair: AV.hair[l.hair] ? l.hair : d.hair,
    shirt: pickColor(l.shirt, AV.colors.shirt, d.shirt),
    pants: pickColor(l.pants, AV.colors.pants, d.pants),
    hairColor: pickColor(l.hairColor, AV.colors.hair, d.hairColor),
    skin: pickColor(l.skin, AV.colors.skin, d.skin),
    shoes: pickColor(l.shoes, AV.colors.shoes, d.shoes || '#222222'),
    hat: false, // Cap never shown (Jens, 9 Nov 2026); field kept for saved looks / wire compat
    hatColor: pickColor(l.hatColor, AV.colors.hat, d.hatColor),
    ...(typeof l.face === 'string' && FACE_HEX.test(l.face) ? { face: l.face.toLowerCase() } : {}), // own face colour; absent = skin
    ...(cleanFabrics(l.fabric) ? { fabric: cleanFabrics(l.fabric) } : {}), // tyger (valfritt), se shared/fabric.mjs
    ...(cleanInsta(l.insta) ? { insta: cleanInsta(l.insta) } : {}), // Instagram name (shared/insta.mjs)
  };
  // Jens (t587u): lock @jensreglermanniska's face photo (scale included); no face colour of its own.
  return ownsLockedFace(out) ? applyLockedFace(out) : out;
}
const any = (list) => list[Math.floor(Math.random() * list.length)];
export function randomLook(prev) {
  return normalizeLook(keepFace(prev, {
    outfit: any(Object.keys(AV.outfits)), hair: any(Object.keys(AV.hair)), shirt: any(AV.colors.shirt), pants: any(AV.colors.pants),
    hairColor: any(AV.colors.hair), skin: AV.default.skin, shoes: any(AV.colors.shoes), hat: false, hatColor: any(AV.colors.hat),
  }));
}
// Samma regler som servern: inga kontroll-/osynliga tecken, högst 24 tecken (emoji klipps inte itu).
export const cleanName = (s) => Array.from(String(s ?? '').normalize('NFC').replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '').replace(/\s+/g, ' ').trim())
  .slice(0, AV.maxName).join('').trim();
// Min gubbe sparas bara på den här enheten.
export function loadMyAvatar() {
  rollLookOnRestart();
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
// Mohawk (Punk_Head / hair id "tupp") retired from the menu (Jens, 7 Nov 2026). Keep it in HEADS/PARTS so its
// meshes are still tracked and stay hidden; old saved looks with hair:"tupp" fall back via normalizeLook.
const RETIRED_HEADS = { Punk_Head: { hair: 'Red' } };
const HEADS = new Set([...Object.values(AV.hair).map((h) => h.head), ...Object.keys(RETIRED_HEADS)]);
const headPart = (o) => { let p = o; while (p && !HEADS.has(p.name)) p = p.parent; return p; };
const isEarringMesh = (o) => {
  const m = o.material;
  if (Array.isArray(m)) return m.some((x) => x && x.name === 'Earrings');
  return !!(m && m.name === 'Earrings');
};
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
for (const o of Object.values(AV.outfits)) { PART_ROLE[o.body] = { shirt: o.shirt }; PART_ROLE[o.legs] = { pants: o.pants }; PART_ROLE[o.feet] = { shoes: o.shoes }; }
for (const hh of Object.values(AV.hair)) PART_ROLE[hh.head] = { hair: hh.hair };
for (const [head, r] of Object.entries(RETIRED_HEADS)) if (!PART_ROLE[head]) PART_ROLE[head] = r;
const PARTS = new Set(Object.keys(PART_ROLE));
function roleOf(part, mat) {
  const r = PART_ROLE[part] || {};
  if (mat === 'Skin') return 'skin';
  if (mat === 'Skin_Darker') return 'skinDark';
  if (mat === 'Eyebrows') return 'brows';
  if (r.hair === mat) return 'hair';
  if (r.shirt === mat) return 'shirt';
  if (r.pants === mat) return 'pants';
  if (r.shoes === mat) return 'shoes';
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

// ---------- Sitting (3D props) ----------
// The seated pose on the Quaternius rig, as bone turns about axes in the avatar's own frame (x = its
// right side, y = up, z = forward), whatever the rig's local bone axes are. (props-proto, 3 Nov 2026.)
export const SIT = Object.freeze({ leg: -1.5, knee: 1.5, lean: 0.3, armX: -0.9, armZ: 0.3, fore: -0.7, head: 0.25, drop: 0.4, back: 0 });
function turnBone(av, name, axis, angle) {
  const bone = av.model.getObjectByName(name); if (!bone) return;
  av.root.updateMatrixWorld(true);
  const rootQ = av.root.getWorldQuaternion(new THREE.Quaternion());
  const wAxis = new THREE.Vector3(...axis).applyQuaternion(rootQ).normalize();
  const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const qw = new THREE.Quaternion().setFromAxisAngle(wAxis, angle);
  bone.quaternion.premultiply(parentQ.clone().invert().multiply(qw).multiply(parentQ));
}
function sitTurns(av, S) {
  const X = [1, 0, 0], Z = [0, 0, 1];
  turnBone(av, 'UpperLegL', X, S.leg); turnBone(av, 'UpperLegR', X, S.leg);   // thighs forward (level)
  turnBone(av, 'LowerLegL', X, S.knee); turnBone(av, 'LowerLegR', X, S.knee); // shins back down
  turnBone(av, 'Torso', X, S.lean);                                          // lean over the table
  turnBone(av, 'UpperArmR', X, S.armX); turnBone(av, 'UpperArmL', X, S.armX * 0.85);
  turnBone(av, 'UpperArmR', Z, S.armZ); turnBone(av, 'UpperArmL', Z, -S.armZ);
  turnBone(av, 'LowerArmR', X, S.fore); turnBone(av, 'LowerArmL', X, SIT.fore * 0.85);
  turnBone(av, 'Head', X, S.head);
}

// Runway dance (shared/dance.mjs): full-body keyframes on the Quaternius rig. Hands never go to the
// floor – the drop lowers the hips so the bent knees read as kneeling. Chest/abdomen give the pops
// and shimmy when the Idle/Walk clips are muted.
function danceTurns(av, S) {
  const X = [1, 0, 0], Z = [0, 0, 1];
  turnBone(av, 'UpperLegL', X, S.legL); turnBone(av, 'UpperLegR', X, S.legR);
  turnBone(av, 'UpperLegL', Z, S.stanceL); turnBone(av, 'UpperLegR', Z, S.stanceR);
  turnBone(av, 'LowerLegL', X, S.kneeL); turnBone(av, 'LowerLegR', X, S.kneeR);
  turnBone(av, 'Abdomen', X, S.abdomen || 0);
  turnBone(av, 'Torso', X, S.lean);
  turnBone(av, 'Chest', X, S.chest || 0);
  turnBone(av, 'UpperArmL', X, S.armLX); turnBone(av, 'UpperArmR', X, S.armRX);
  turnBone(av, 'UpperArmL', Z, S.armLZ); turnBone(av, 'UpperArmR', Z, S.armRZ);
  turnBone(av, 'LowerArmL', X, S.foreL); turnBone(av, 'LowerArmR', X, S.foreR);
  turnBone(av, 'Head', X, S.head);
}
// "✏️ drawing…" above someone sitting and drawing (one texture for everyone).
let drawTex = null;
function drawTexture() {
  if (drawTex) return drawTex;
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,.95)'; g.strokeStyle = '#15130f'; g.lineWidth = 8; g.beginPath(); g.roundRect(6, 6, 244, 116, 40); g.fill(); g.stroke();
  const t = '✏️ drawing…'; let px = 60; g.font = `700 ${px}px system-ui, sans-serif`; const w = g.measureText(t).width; if (w > 216) { px = Math.floor(px * 216 / w); g.font = `700 ${px}px system-ui, sans-serif`; }
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#15130f'; g.fillText(t, 128, 68);
  drawTex = new THREE.CanvasTexture(c); drawTex.colorSpace = THREE.SRGBColorSpace;
  return drawTex;
}

export class Avatar {
  constructor(model, look, name = '') {
    this.root = new THREE.Group();
    this.root.name = 'gubbe';
    this.model = cloneSkinned(model.scene);
    this.model.scale.setScalar(SCALE);
    this.root.add(this.model);
    this.parts = {}; // delnamn -> [meshar]
    this.mats = { skin: [], skinDark: [], brows: [], hair: [], shirt: [], pants: [], shoes: [], face: [], faceDark: [] };
    this.faceFeatures = []; // the head's eyes and eyebrows (hidden under a face photo, which has its own)
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      let part = o; while (part && !PARTS.has(part.name)) part = part.parent;
      if (!part) return;
      o.frustumCulled = false; // skinnade meshar har fel "bounding box" när de rör sig
      o.raycast = () => {};    // gubbar ska aldrig träffas av stämpel-strålen
      (this.parts[part.name] ||= []).push(o);
      if (isEarringMesh(o)) o.visible = false; // never show earrings (Jens, 7 Nov 2026)
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
    // The cap sits ON the head bone (t509u: it used to be placed from the head once a frame in update(),
    // so a pose set after that – sitting down – left it floating at standing height): a child of the
    // bone, scaled back to real size, so it follows every pose by itself.
    if (this.head) {
      this.root.updateMatrixWorld(true);
      const hs = this.head.getWorldScale(new THREE.Vector3()).x || 1;
      this.cap.scale.setScalar(1 / hs); this.cap.position.set(0, 0.205 / hs, 0.012 / hs);
      this.head.add(this.cap);
    } else this.root.add(this.cap);
    this._rest = new Map(); this.model.traverse((o) => { if (o.isBone) this._rest.set(o, o.quaternion.clone()); });
    this.seated = null; // { draw } while sitting on a chair (setSeated)
    this.dance = null; // { t } while the runway dance plays (startDance)
    // The talking mouth (mouth.js): follows the head bone like the cap, hidden while silent.
    this.mouth = new Mouth(name || Math.random()); this.root.add(this.mouth.group); this.mouthT = null;
    // Tyger: varje färgplats kan bära en upprepad bild (fabrics.js). Huden har två material (mörkare skugga).
    for (const [role, list] of Object.entries(this.mats)) for (const m of list) makeFabricable(m, { tint: role === 'skinDark' || role === 'faceDark' ? 0.82 : 1, face: role === 'face' || role === 'faceDark' ? FACE : null });
    makeFabricable(capMat);
    this.slotMats = { shirt: this.mats.shirt, pants: this.mats.pants, hair: this.mats.hair, skin: [...this.mats.skin, ...this.mats.skinDark], shoes: this.mats.shoes, hat: [capMat], face: [...this.mats.face, ...this.mats.faceDark] };
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
    // Earrings (Beach_Head / Punk_Head) always off – no menu option (Jens, 7 Nov 2026).
    for (const [p, list] of Object.entries(this.parts)) for (const m of list) m.visible = show.has(p) && !isEarringMesh(m);
    const set = (role, hex, mul = 1) => this.mats[role].forEach((m) => { m.color.set(hex); if (mul !== 1) m.color.multiplyScalar(mul); });
    set('skin', L.skin); set('skinDark', L.skin, 0.82); set('hair', L.hairColor); set('brows', L.hairColor, 0.55);
    set('shirt', L.shirt); set('pants', L.pants); set('shoes', L.shoes || '#222222');
    set('face', L.face || L.skin); set('faceDark', L.face || L.skin, 0.82);
    // Cap never shown on the avatar (Jens, 9 Nov 2026) – same idea as earrings always off.
    this.cap.visible = false; this.capMat.color.set(L.hatColor);
    this.applyFabrics(effectiveFabrics(L));
    this.updateFaceFeatures();
    if ((L.insta || '') !== (this.insta ?? '') && this.name !== undefined) this.setName(this.name, L.insta || '');
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
  // The name above the head, and under it (smaller) the Instagram name with an @ (look.insta).
  setName(name, insta = this.look?.insta || '') {
    this.name = name; this.insta = insta || '';
    for (const k of ['tag', 'instaTag']) if (this[k]) { this.root.remove(this[k]); this[k].material.map.dispose(); this[k].material.dispose(); this[k] = null; }
    if (!name) return; // (my own avatar has no tag)
    const lift = this.insta ? 0.09 : 0;
    { this.tag = makeSprite(name, { size: 44 }, 0.0021); this.tag.position.set(0, TOP + 0.22 + lift, 0); this.tag.name = 'name-tag'; this.root.add(this.tag); }
    if (this.insta) {
      this.instaTag = makeSprite('@' + this.insta, { size: 30, font: 500, color: '#ffe680', pad: 14 }, 0.0021);
      this.instaTag.position.set(0, TOP + 0.2, 0); this.instaTag.name = 'insta-tag'; this.root.add(this.instaTag);
    }
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
    this.talk.position.set(0, TOP + (this.tag ? 0.36 : 0.22) + (this.instaTag ? 0.09 : 0), 0);
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
    this.bubble.position.set(0, TOP + 0.36 + (this.instaTag ? 0.09 : 0) + this.bubble.scale.y / 2, 0);
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
    const dancing = !!this.dance;
    const target = (!dancing && speed > 0.25) ? 1 : 0;
    this.walk += (target - this.walk) * Math.min(1, dt * 8);
    const waving = !dancing && performance.now() < this.waveUntil && this.walk < 0.2 && this.actions.Wave;
    if (this.actions.Wave) {
      if (waving && !this.actions.Wave.isRunning()) { this.actions.Wave.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.2).play(); }
      if (dancing && this.actions.Wave.isRunning()) this.actions.Wave.stop();
    }
    this.actions.Walk?.setEffectiveWeight(dancing ? 0 : this.walk);
    if (this.actions.Walk) this.actions.Walk.timeScale = THREE.MathUtils.clamp(speed / 1.6, 0.6, 1.8);
    this.actions.Idle?.setEffectiveWeight(dancing ? 0 : (1 - this.walk));
    this.mixer.update(dt);
    if (this.dance) this.applyDance(dt); // runway dance replaces Idle/Walk (before the arm gesture)
    else if (this.seated) this.applySeat(dt); // the seated pose replaces the animation (before the arm gesture)
    this.gesture.apply(this.root);
    const now = Date.now();
    for (const [slot, e] of Object.entries(this.fab)) if (e.tex) this.slotMats[slot].forEach((m) => tickFabric(m, now));
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
  // Sitting on a chair (3D props, shared/props.mjs seatOf; Jens t491u): the legs bent forward, leaning
  // over the table; draw = the hand moves a pencil (and a small "drawing" mark above the head). The
  // caller places the root on the seat (its x/z, facing the table). off = standing again.
  setSeated(on, draw = false) {
    if (on && this.dance) this.stopDance(); // sitting cancels the dance
    const was = !!this.seated;
    this.seated = on ? { draw: !!draw, t: this.seated ? this.seated.t : 0 } : null;
    if (!on && was) { for (const [b, q] of this._rest) b.quaternion.copy(q); this.model.position.set(0, 0, 0); }
    if (on && !this.drawMark) { this.drawMark = new THREE.Sprite(new THREE.SpriteMaterial({ map: drawTexture(), depthWrite: false, transparent: true })); this.drawMark.scale.set(0.5, 0.25, 1); this.drawMark.renderOrder = 11; this.drawMark.name = 'drawing'; this.root.add(this.drawMark); }
    if (this.drawMark) { this.drawMark.visible = !!(on && draw); this.drawMark.position.set(0, TOP - SIT.drop + 0.45 + (this.tag ? 0.2 : 0), 0); }
    if (this.tag) this.tag.position.y = TOP + 0.22 + (this.insta ? 0.09 : 0) - (on ? SIT.drop : 0);
    if (this.instaTag) this.instaTag.position.y = TOP + 0.2 - (on ? SIT.drop : 0);
  }
  // The seated pose (two of them while drawing: the hand goes to and fro), worked out once per avatar.
  sitPoses() {
    if (this._sit) return this._sit;
    const make = (S) => {
      for (const [b, q] of this._rest) b.quaternion.copy(q);
      sitTurns(this, S);
      const out = new Map(); for (const b of this._rest.keys()) out.set(b, b.quaternion.clone());
      return out;
    };
    this._sit = { a: make(SIT), b: make({ ...SIT, fore: SIT.fore - 0.25, armZ: SIT.armZ + 0.12 }) };
    return this._sit;
  }
  applySeat(dt) {
    const P = this.sitPoses(), st = this.seated;
    st.t += dt;
    const k = st.draw ? 0.5 + 0.5 * Math.sin(st.t * 7) : 0;
    for (const [b, qa] of P.a) { if (k) b.quaternion.slerpQuaternions(qa, P.b.get(b), k); else b.quaternion.copy(qa); }
    this.model.position.set(0, -SIT.drop, SIT.back);
  }
  // Runway dance (Jens t540u/t546u): one-shot keyframe routine on this avatar, 4 bars on the master
  // clock. Refuses while seated. from = { at (server-clock ms of the press), bpm, phaseMs } – someone
  // else's dance as they sent it, so it plays on THEIR clock grid at the same moment on every screen
  // (joined late: picks up mid-dance). Without it: mine, now, on my clock. Returns false if it did
  // not start, else { at, bpm, phaseMs } (what to send to the room).
  startDance(from = null) {
    if (this.seated || this.dance) return false;
    const c = clockNow();
    let at, tempo;
    if (from && Number.isFinite(from.at) && from.bpm > 0) { at = from.at; tempo = { bpm: from.bpm, phaseMs: Number.isFinite(from.phaseMs) ? from.phaseMs : 0 }; }
    else { at = c ? Math.round(c.nowMs) : null; tempo = c && c.tempo ? { bpm: Math.round(c.tempo.bpm * 1000) / 1000, phaseMs: Math.round((c.tempo.phaseMs || 0) * 1000) / 1000 } : null; } // rounded like the server relays it: the same grid everywhere
    const grid = at != null && tempo ? danceGrid(at, tempo) : null;
    const t0 = at != null && c ? Math.max(0, (c.nowMs - at) / 1000) : 0;
    if (t0 >= danceDuration(grid)) return false; // it is already over
    this.waveUntil = 0; this.actions.Wave?.stop();
    this.gesture.h = null; this.gesture.g = null; // no slap/hold fighting the arms
    this.dance = { t: t0, at, grid, end: danceDuration(grid) };
    return { at, bpm: tempo ? tempo.bpm : null, phaseMs: tempo ? tempo.phaseMs || 0 : 0 };
  }
  stopDance() {
    if (!this.dance) return;
    this.dance = null;
    for (const [b, q] of this._rest) b.quaternion.copy(q);
    this.model.position.set(0, 0, 0);
  }
  get dancing() { return !!this.dance; }
  get danceTime() { return this.dance ? this.dance.t : 0; }
  get dancePhase() { return this.dance ? dancePhase(this.dance.t, this.dance.grid) : null; }
  get danceAt() { return this.dance && this.dance.at != null ? this.dance.at : null; }
  get danceGrid() { return this.dance && this.dance.grid ? { ...this.dance.grid } : null; }
  applyDance(dt) {
    const d = this.dance; if (!d) return;
    const c = d.at != null ? clockNow() : null;
    d.t = c ? Math.max(0, (c.nowMs - d.at) / 1000) : d.t + dt; // on the clock: no drift, same moment everywhere
    if (d.t >= d.end) { this.stopDance(); return; }
    for (const [b, q] of this._rest) b.quaternion.copy(q);
    const S = dancePoseAt(d.t, d.grid);
    danceTurns(this, S);
    this.model.position.set(0, -S.drop, S.back || 0);
  }

  dispose() {
    this.stopDance();
    if (this.drawMark) { this.root.remove(this.drawMark); this.drawMark.material.dispose(); this.drawMark = null; }
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
    this.seatOf = () => null; // (chair prop id) → { x, y, z, yaw } | null: where a seated player sits (main.js: the props layer)
    loadAvatarModel().then((m) => { this.model = m; for (const p of this.map.values()) this.build(p); }).catch(() => {});
  }
  build(p) {
    if (!this.model || p.avatar) return;
    p.avatar = new Avatar(this.model, p.look, p.name);
    this.scene.add(p.avatar.root);
    this.place(p, performance.now());
  }
  upsert({ id, name, look, p, y, slot, sit }) {
    let pl = this.map.get(id);
    if (!pl) { pl = { id, name, look, snaps: [], pos: new THREE.Vector3(), yaw: 0, speed: 0, slot: 0, sit: null }; this.map.set(id, pl); }
    if (sit !== undefined) pl.sit = sit && typeof sit.chair === 'string' ? { chair: sit.chair, draw: !!sit.draw } : null;
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
  // Someone sat down on a chair (chair = its prop id; draw = drawing) or stood up (chair null).
  sit(id, chair, draw = false) { const pl = this.map.get(id); if (!pl) return false; pl.sit = chair ? { chair, draw: !!draw } : null; if (!chair) pl.avatar?.setSeated(false); return true; }
  // Someone started the runway dance (others see it on their avatar).
  dance(id, from = null) { const pl = this.map.get(id); if (!pl?.avatar) return false; if (pl.sit) { pl.sit = null; pl.avatar.setSeated(false); } return !!pl.avatar.startDance(from); }
  // They stopped it early (walked off: W/A/S/D or the joystick).
  stopDance(id) { const pl = this.map.get(id); if (!pl?.avatar?.dancing) return false; pl.avatar.stopDance(); return true; }
  seatedOn(chair) { for (const p of this.map.values()) if (p.sit && p.sit.chair === chair) return p.id; return null; }
  takenSeats() { const s = new Set(); for (const p of this.map.values()) if (p.sit) s.add(p.sit.chair); return s; }
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
    const seat = (!pl.avatar?.dancing && pl.sit) ? this.seatOf(pl.sit.chair) : null;
    if (seat) { // on a chair: there, facing the table (the props layer knows where the chair is)
      pl.pos.set(seat.x, 0, seat.z);
      if (pl.avatar) { pl.avatar.root.position.set(seat.x, seat.y0 || 0, seat.z); pl.avatar.root.rotation.y = seat.yaw; pl.avatar.setSeated(true, pl.sit.draw); }
      return;
    }
    if (pl.avatar?.seated) pl.avatar.setSeated(false);
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
      gestures: p.gestures || 0, slot: p.slot, sit: p.sit ? { ...p.sit } : null, seated: !!p.avatar?.seated, dancing: !!p.avatar?.dancing, dancePhase: p.avatar?.dancePhase || null, danceTime: p.avatar ? +p.avatar.danceTime.toFixed(2) : 0, danceAt: p.avatar?.danceAt ?? null, danceBpm: p.avatar?.danceGrid?.bpm ?? null, capWorld: p.avatar?.cap.visible ? p.avatar.cap.getWorldPosition(new THREE.Vector3()).toArray() : null, speaking: !!p.avatar?.speaking, mouth: p.avatar ? p.avatar.mouthInfo : null, gesturing: !!p.avatar?.gesture.active(), fabrics: p.avatar ? p.avatar.fabricInfo() : {}, face: p.avatar ? p.avatar.faceInfo() : null }));
  }
}

// The session film's renderer (Jens, 5 Nov 2026, pt536u; the plan: shared/film.mjs).
// Cheap on purpose: nothing is screen-captured and nothing runs while I play. Only when the film is
// made (leaving the room for the city) ONE offscreen WebGL renderer draws the scenes from my session's
// events – my own character in my outfit (avatars.js, fabrics included), my stickers, my wall, my
// pack – into a 2D canvas that adds the cinema bars, titles, sparkles and speed lines; that canvas
// is recorded (MediaRecorder, webm or mp4) in real time. Afterwards the renderer is thrown away.
import * as THREE from 'three';
import { Avatar } from './avatars.js';
import { sceneAt, pickFilmMime, FILM } from '../../shared/film.mjs';

const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (u, a, b) => clamp01((u - a) / (b - a));
const loadTex = (url) => (url ? new THREE.TextureLoader().loadAsync(url).then((t) => { t.colorSpace = THREE.SRGBColorSpace; return t; }).catch(() => null) : Promise.resolve(null));

// Where sticker n sits on my film wall (deterministic little scatter, eye height).
export function wallSpot(n) {
  const cols = 4, c = n % cols, r = Math.floor(n / cols) % 3;
  const jx = Math.sin(n * 12.9898) * 0.08, jy = Math.cos(n * 7.233) * 0.06;
  return { x: -0.9 + c * 0.6 + jx, y: 1.75 - r * 0.45 + jy, rot: Math.sin(n * 3.1) * 0.12 };
}

function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
// a soft diagonal white band (the wet glue sheen, the pack's gloss)
const sheenTex = () => canvasTex(256, 64, (g, w, h) => { const lg = g.createLinearGradient(0, 0, w, 0); lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.45, 'rgba(255,255,255,0.0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.95)'); lg.addColorStop(0.55, 'rgba(255,255,255,0)'); lg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = lg; g.fillRect(0, 0, w, h); });
// the light burst behind the pack: pink/gold rays (kira-kira)
const burstTex = () => canvasTex(512, 512, (g, w, h) => {
  const cx = w / 2, cy = h / 2, n = 24;
  const bg = g.createRadialGradient(cx, cy, 10, cx, cy, w / 2); bg.addColorStop(0, '#fff6c8'); bg.addColorStop(0.35, '#ffb3dc'); bg.addColorStop(1, '#6a3cff'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) { const a0 = (i / n) * Math.PI * 2, a1 = a0 + Math.PI / n; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, w, a0, a1); g.closePath(); g.fillStyle = i % 2 ? 'rgba(255,255,255,0.28)' : 'rgba(255,220,120,0.22)'; g.fill(); }
});

// The hand that brings the sticker: palm, four fingers, a thumb, and my sleeve (with my shirt's fabric).
function makeHand(skin, sleeveMat) {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.55 });
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.095, 0.028), m); g.add(palm);
  for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.0095, 0.05 - Math.abs(i - 1.5) * 0.006, 4, 8), m); f.position.set(-0.03 + i * 0.02, 0.078 - Math.abs(i - 1.5) * 0.004, 0); g.add(f); }
  const th = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.035, 4, 8), m); th.position.set(-0.055, 0.0, 0.006); th.rotation.z = 0.9; g.add(th);
  const sl = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.2, 16), sleeveMat || new THREE.MeshStandardMaterial({ color: 0x3366cc })); sl.position.set(0, -0.15, 0); g.add(sl);
  g.traverse((o) => { o.frustumCulled = false; });
  return g;
}

// alphaMap reads the GREEN channel: the sticker's own alpha as a white-on-black mask (glue + sheen only where the sticker is).
function alphaMask(tex) {
  const im = tex?.image; if (!im || !im.width) return null;
  const w = 256, h = Math.max(1, Math.round(256 * im.height / im.width));
  const a = document.createElement('canvas'); a.width = w; a.height = h; const ga = a.getContext('2d');
  ga.drawImage(im, 0, 0, w, h); ga.globalCompositeOperation = 'source-in'; ga.fillStyle = '#fff'; ga.fillRect(0, 0, w, h);
  const b = document.createElement('canvas'); b.width = w; b.height = h; const gb = b.getContext('2d');
  gb.fillStyle = '#000'; gb.fillRect(0, 0, w, h); gb.drawImage(a, 0, 0);
  return new THREE.CanvasTexture(b);
}
// A sticker that can curl off the wall: front (the design) + back (glossy adhesive), shared geometry.
function makeSticker(tex, aspect, size = 0.42) {
  const mask = alphaMask(tex);
  const w = aspect >= 1 ? size : size * aspect, h = aspect >= 1 ? size / aspect : size;
  const geo = new THREE.PlaneGeometry(w, h, 24, 6), rest = geo.attributes.position.array.slice();
  const front = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.04, roughness: 0.45, side: THREE.FrontSide }));
  const back = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: 0xf2efe6, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, alphaMap: mask, transparent: true, alphaTest: 0.04, side: THREE.BackSide }));
  const sheen = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: null, alphaMap: mask, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  const strands = new THREE.Group();
  for (let i = 0; i < 6; i++) strands.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, roughness: 0.05, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false })));
  const g = new THREE.Group(); g.add(front, back, sheen); g.traverse((o) => { o.frustumCulled = false; });
  // lift(x) above the wall for every vertex right of `front` (the pressing edge moves → it lies down)
  const bend = (curl, pressX, stretch = 0) => {
    const p = geo.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      const x = rest[i], d = Math.max(0, x - pressX) / w;
      p[i] = x * (1 + stretch); p[i + 1] = rest[i + 1] * (1 + stretch * 0.5);
      p[i + 2] = curl * 0.6 * w * Math.pow(d, 1.6);
    }
    geo.attributes.position.needsUpdate = true; geo.computeVertexNormals();
  };
  return { g, w, h, bend, sheen, strands, front, back };
}

export async function makeFilmRenderer({ model, look, name = '', room = '', wallMat = null, floorMat = null, radioUrl = null, pacUrl = null, plan, size = [1280, 720] }) {
  const [W, H] = size;
  const gl = document.createElement('canvas'); gl.width = W; gl.height = H;
  const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(W, H, false); renderer.outputColorSpace = THREE.SRGBColorSpace;
  const out = document.createElement('canvas'); out.width = W; out.height = H; out.id = 'film-canvas';
  const g2 = out.getContext('2d');
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x161420);
  const cam = new THREE.PerspectiveCamera(40, W / H, 0.02, 60);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x50485a, 0.9));
  const key = new THREE.DirectionalLight(0xfff1dd, 1.5); key.position.set(2, 4, 3); scene.add(key);
  const rim = new THREE.DirectionalLight(0xc9d8ff, 0.8); rim.position.set(-3, 3, -2); scene.add(rim);
  // my room: its floor and wall materials (clones share the textures)
  const wm = wallMat ? wallMat.clone() : new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.95 });
  const fm = floorMat ? floorMat.clone() : new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.95 });
  const WALL_Z = -1.2;
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(16, 8), wm); wall.position.set(0, 4, WALL_Z); scene.add(wall);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), fm); floor.rotation.x = -Math.PI / 2; scene.add(floor);
  // me
  const me = new Avatar(model, look, ''); scene.add(me.root);
  await new Promise((r) => setTimeout(r, 600)); // fabrics: a moment to load (the colour shows until then)
  // the stickers of the film, in order (all stick scenes)
  const stickList = []; for (const s of plan.scenes) if (s.kind === 'stick') for (const st of s.stickers) stickList.push(st);
  const texs = await Promise.all(stickList.map((s) => loadTex(s.url)));
  const sheenT = sheenTex();
  const stickers = stickList.map((s, n) => { const k = makeSticker(texs[n], s.aspect); const sp = wallSpot(n); k.g.position.set(sp.x, sp.y, WALL_Z + 0.002 + n * 0.0004); k.g.rotation.z = sp.rot; k.sheen.material.map = sheenT.clone(); k.sheen.material.map.wrapS = THREE.ClampToEdgeWrapping; k.sheen.material.map.needsUpdate = true; k.g.visible = false; scene.add(k.g); scene.add(k.strands); k.strands.visible = false; k.bend(0, -1); return k; });
  const hand = makeHand(new THREE.Color(me.look.skin), me.mats.shirt[0] ? me.mats.shirt[0] : null); hand.visible = false; scene.add(hand);
  // the radio: a wooden box with the radio sticker's picture as its face, and a dial that turns
  const radio = new THREE.Group();
  const rtex = await loadTex(radioUrl);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.22), new THREE.MeshStandardMaterial({ color: 0x7a4a24, roughness: 0.6 })); radio.add(box);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.28), new THREE.MeshStandardMaterial({ map: rtex, color: rtex ? 0xffffff : 0x222222, roughness: 0.4 })); face.position.z = 0.111; radio.add(face);
  const dial = new THREE.Group(); const dm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.038, 0.03, 24), new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.7, roughness: 0.25 })); dm.rotation.x = Math.PI / 2; dial.add(dm);
  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.026, 0.006), new THREE.MeshStandardMaterial({ color: 0xcc1111 })); mark.position.set(0, 0.016, 0.017); dial.add(mark);
  dial.position.set(-0.44 / 2 + 0.352 * 0.44, 0.28 / 2 - 0.738 * 0.28, 0.13); radio.add(dial);
  const table = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.45), new THREE.MeshStandardMaterial({ color: 0x5b3a22, roughness: 0.7 })); table.position.set(0, -0.17, 0); radio.add(table);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.83, 10), table.material); leg.position.set(0, -0.6, 0); radio.add(leg);
  radio.position.set(0.36, 1.0, 0.32); radio.rotation.y = 0.75; radio.scale.setScalar(0.8); radio.visible = false; scene.add(radio);
  // the pack + its gloss + the light burst behind it
  const ptex = await loadTex(pacUrl);
  const PACK_H = 0.56, PACK_W = PACK_H * (563 / 802);
  const pack = new THREE.Group();
  const pm = new THREE.Mesh(new THREE.PlaneGeometry(PACK_W, PACK_H), new THREE.MeshPhysicalMaterial({ map: ptex, color: ptex ? 0xffffff : 0xffd34d, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, alphaTest: 0.03, side: THREE.DoubleSide }));
  const glossT = sheenT.clone(); glossT.needsUpdate = true;
  const gloss = new THREE.Mesh(pm.geometry, new THREE.MeshBasicMaterial({ map: glossT, alphaMap: alphaMask(ptex), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })); gloss.position.z = 0.003;
  pack.add(pm, gloss); pack.visible = false; pack.traverse((o) => { o.frustumCulled = false; }); scene.add(pack);
  const burst = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: burstTex() })); burst.position.set(0, 1.4, -1.0); burst.visible = false; scene.add(burst);
  const tv = new THREE.Vector3(), wrist = (me.gesture.arms.find((a) => /R$/.test(a.wrist.name)) || me.gesture.arms[0])?.wrist;

  let lastT = 0, lastScene = -1;
  const look2 = (x, y, z, tx, ty, tz, fov = 40) => { cam.position.set(x, y, z); cam.fov = fov; cam.updateProjectionMatrix(); cam.lookAt(tx, ty, tz); };
  const project = (v) => { tv.copy(v).project(cam); return [(tv.x * 0.5 + 0.5) * W, (-tv.y * 0.5 + 0.5) * H]; };

  // ---------- one frame at film time t (s) ----------
  function renderAt(t) {
    const at = sceneAt(plan, t); if (!at) return;
    const { scene: s, u, local, i } = at;
    const dt = Math.max(0, Math.min(0.1, t - lastT)); lastT = t;
    if (i !== lastScene) { me.drop(); lastScene = i; }
    // what shows
    hand.visible = false; radio.visible = false; pack.visible = false; burst.visible = false; wall.visible = true; me.root.visible = true;
    me.root.position.set(0, 0, 0); me.root.rotation.set(0, 0, 0);
    const doneBefore = s.kind === 'stick' ? s.first : s.kind === 'pack' || s.kind === 'end' ? stickers.length : (plan.scenes.slice(0, i).filter((x) => x.kind === 'stick').reduce((n, x) => n + x.stickers.length, 0));
    stickers.forEach((k, n) => { k.g.visible = n < doneBefore; k.strands.visible = false; if (n < doneBefore) { k.bend(0, -1); k.sheen.material.opacity = 0; } });
    let overlay = null;
    if (s.kind === 'open') {
      const e = ease(u);
      look2(lerp(0.6, 0.2, e), lerp(1.7, 1.45, e), lerp(5.2, 2.6, e), 0, 1.15, 0, 40);
      overlay = { title: 'SLAP AND TALK', sub: `${s.name || 'me'}${s.room ? ' · ' + s.room : ''}`, a: seg(u, 0.1, 0.35) * (1 - seg(u, 0.85, 1)) };
    } else if (s.kind === 'stick') {
      me.root.visible = false;
      const n = s.stickers.length, per = 1 / n, k = Math.min(n - 1, Math.floor(u / per)), v = (u - k * per) / per, idx = s.first + k;
      for (let j = 0; j < k; j++) { const kk = stickers[s.first + j]; if (kk) { kk.g.visible = true; kk.bend(0, -1); kk.sheen.material.opacity = 0; } }
      const kk = stickers[idx];
      if (kk) {
        const sp = wallSpot(idx), P = new THREE.Vector3(sp.x, sp.y, WALL_Z);
        look2(sp.x + 0.62 - 0.12 * ease(u), sp.y + 0.12, WALL_Z + 0.72 - 0.1 * ease(u), sp.x + 0.02, sp.y, WALL_Z + 0.05, 40);
        kk.g.visible = true; hand.visible = true;
        // phases: bring (0–.32), press + swipe (.32–.7), let go (.7–1)
        const bring = ease(seg(v, 0, 0.32)), swipe = ease(seg(v, 0.32, 0.7)), away = ease(seg(v, 0.72, 1));
        const left = -kk.w / 2, pressX = v < 0.32 ? left - 0.01 : lerp(left, kk.w / 2 + 0.02, swipe);
        const curl = v < 0.32 ? 0.9 : 0.9 * (1 - swipe);
        const lift = (1 - bring) * 0.35;
        kk.g.position.set(sp.x + lift * 0.9, sp.y - lift * 0.7, WALL_Z + 0.002 + idx * 0.0004 + lift * 0.6);
        kk.bend(curl, pressX, v > 0.32 && v < 0.75 ? 0.04 * Math.sin(Math.PI * seg(v, 0.32, 0.75)) : 0);
        // wet glue: a sheen sweeps behind the pressing edge; strands stretch from the wall to the lifted edge
        kk.sheen.material.opacity = v > 0.3 ? 0.75 * Math.sin(Math.PI * seg(v, 0.3, 0.95)) : 0;
        kk.sheen.material.map.offset.x = lerp(0.6, -0.6, seg(v, 0.3, 0.95));
        kk.strands.visible = curl > 0.05 && v > 0.3;
        if (kk.strands.visible) {
          kk.g.updateMatrixWorld(true);
          kk.strands.children.forEach((st, j) => {
            const fy = (j / 5 - 0.5) * kk.h * 0.8, ex = kk.w / 2, d = Math.max(0, ex - pressX) / kk.w, z = curl * 0.6 * kk.w * Math.pow(d, 1.6);
            const mid = Math.max(pressX, ex - 0.04) + 0.01;
            const a = new THREE.Vector3(mid, fy, 0.001).applyMatrix4(kk.g.matrixWorld), b = new THREE.Vector3(mid + 0.004, fy, z * 0.85).applyMatrix4(kk.g.matrixWorld);
            st.position.copy(a).lerp(b, 0.5); st.scale.set(0.0025 + 0.002 * (1 - d), Math.max(0.001, a.distanceTo(b)), 1);
            st.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
            st.material.opacity = 0.55 * curl;
          });
        }
        // the hand: in from the lower right, with the sticker; presses and smooths it; away
        const hx = v < 0.32 ? lerp(sp.x + 0.65, sp.x + lift * 0.9, bring) : lerp(sp.x + left, sp.x + kk.w / 2, swipe);
        const hy = v < 0.32 ? lerp(sp.y - 0.55, sp.y - lift * 0.7, bring) : sp.y - 0.02 + 0.015 * Math.sin(swipe * 9);
        const hz = WALL_Z + (v < 0.32 ? lerp(0.55, 0.05 + lift * 0.6, bring) : 0.035);
        hand.position.set(hx + away * 0.6, hy - away * 0.6, hz + away * 0.5);
        hand.rotation.set(-0.15, 0.25, 0.55 - 0.25 * swipe);
        overlay = { caption: s.count > n && k === n - 1 ? `+${s.count - n} more` : null, a: 1 };
        void P;
      }
    } else if (s.kind === 'radio') {
      radio.visible = true; me.root.rotation.y = 0.55;
      radio.updateMatrixWorld(true);
      const dp = dial.getWorldPosition(new THREE.Vector3());
      me.hold(dp.clone().add(new THREE.Vector3(0.0, 0.0, 0.04)), new THREE.Vector3(0, 0, -1), local * 1000);
      dial.rotation.z = -Math.sin(Math.min(1, u * 1.3) * Math.PI * 1.5) * 1.4 * ease(seg(u, 0.12, 0.9));
      const e = ease(u), a = lerp(0.95, 0.65, e);
      look2(0.25 + Math.sin(a) * 1.55, 1.38, 0.3 + Math.cos(a) * 1.55, 0.25, 1.22, 0.25, 36);
      overlay = { notes: project(dp), u, caption: '📻', a: 1 };
    } else if (s.kind === 'cut') {
      me.root.visible = false;
      const e = ease(u);
      look2(lerp(-1.4, 1.4, e), 1.55, WALL_Z + 2.2 - 0.4 * e, lerp(-0.8, 0.8, e), 1.45, WALL_Z, 44);
    } else if (s.kind === 'pack') {
      wall.visible = false; burst.visible = true; burst.rotation.z = local * 0.5; pack.visible = true;
      const up = new THREE.Vector3(0.3, 2.05, 0.45);
      me.hold(up, new THREE.Vector3(0, 0, 1), local * 1000);
      const e = ease(seg(u, 0, 0.5));
      look2(0.05, lerp(1.5, 1.7, e), lerp(3.3, 2.7, e), 0.1, lerp(1.4, 1.72, e), 0, 40);
    } else if (s.kind === 'end') {
      me.root.visible = false; look2(0, 1.5, WALL_Z + 2.5, 0, 1.5, WALL_Z, 50);
    }
    me.update(dt, 0);
    const upWrist = me.gesture.h?.arm?.wrist || wrist;
    if (s.kind === 'pack' && upWrist) {
      me.root.updateMatrixWorld(true); const wp = upWrist.getWorldPosition(new THREE.Vector3());
      const pop = ease(seg(u, 0.05, 0.3));
      pack.position.copy(wp).add(new THREE.Vector3(0.04, PACK_H * 0.3, 0.14));
      pack.scale.setScalar(0.6 + 0.4 * pop + 0.04 * Math.sin(local * 9) * pop);
      pack.lookAt(cam.position); pack.rotation.z += Math.sin(local * 2.2) * 0.06;
      glossT.offset.x = lerp(0.7, -0.7, (local * 0.7) % 1);
      overlay = { pack: project(pack.position), u, local, name: s.name, stuck: s.stuck };
    }
    renderer.render(scene, cam);
    g2.drawImage(gl, 0, 0);
    paint(g2, W, H, s, overlay, u, local);
  }

  // ---------- the 2D layer: cinema bars, titles, notes, kira-kira ----------
  function paint(g, W, H, s, o, u, local) {
    const bar = Math.round(H * 0.1);
    g.save();
    if (s.kind === 'pack' && o && o.pack) paintPack(g, W, H, o);
    g.fillStyle = '#000'; g.fillRect(0, 0, W, bar); g.fillRect(0, H - bar, W, bar);
    if (o && o.title) {
      g.globalAlpha = o.a; g.fillStyle = '#fff'; g.textAlign = 'center';
      g.font = `900 ${Math.round(H * 0.1)}px system-ui, sans-serif`; g.fillText(o.title, W / 2, H * 0.47);
      g.font = `700 ${Math.round(H * 0.045)}px system-ui, sans-serif`; g.fillStyle = '#ffd98a'; g.fillText(o.sub, W / 2, H * 0.56);
      g.globalAlpha = 1;
    }
    if (o && o.caption) { g.fillStyle = 'rgba(0,0,0,0.55)'; g.font = `800 ${Math.round(H * 0.05)}px system-ui, sans-serif`; g.textAlign = 'right'; g.fillStyle = '#fff'; g.fillText(o.caption, W - W * 0.04, H - bar - H * 0.04); }
    if (o && o.notes) { // ♪ rising from the dial
      g.textAlign = 'center'; g.font = `800 ${Math.round(H * 0.06)}px system-ui, sans-serif`;
      for (let k = 0; k < 4; k++) { const p = (o.u * 1.6 + k / 4) % 1; g.globalAlpha = Math.sin(Math.PI * p); g.fillStyle = k % 2 ? '#ffe066' : '#9ff'; g.fillText(k % 2 ? '♫' : '♪', o.notes[0] + Math.sin(p * 6 + k) * 30 + 30, o.notes[1] - p * H * 0.3); }
      g.globalAlpha = 1;
    }
    if (s.kind === 'end') { g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, bar, W, H - 2 * bar); g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = `900 ${Math.round(H * 0.08)}px system-ui, sans-serif`; g.fillText('THE END', W / 2, H / 2); }
    // a soft cut: quick dip at scene edges
    const edge = Math.min(local, s.dur - local);
    if (edge < 0.12) { g.fillStyle = `rgba(0,0,0,${(1 - edge / 0.12) * 0.7})`; g.fillRect(0, 0, W, H); }
    g.restore();
  }
  // Japanese "bling": focus (speed) lines, a white flash, star glints, sparkles, kawaii text that pops.
  function paintPack(g, W, H, o) {
    const [cx, cy] = o.pack, u = o.u, L = o.local;
    if (u < 0.35) { // manga focus lines toward the pack
      const a = 1 - seg(u, 0.15, 0.35); g.strokeStyle = `rgba(255,255,255,${0.8 * a})`;
      for (let k = 0; k < 64; k++) { const ang = (k / 64) * Math.PI * 2 + Math.sin(k * 7.1) * 0.05, r0 = H * (0.3 + 0.12 * Math.abs(Math.sin(k * 3.7))), r1 = W; g.lineWidth = 1 + (k % 3); g.beginPath(); g.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0); g.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1); g.stroke(); }
    }
    if (u > 0.05 && u < 0.18) { g.fillStyle = `rgba(255,255,255,${0.85 * (1 - seg(u, 0.05, 0.18))})`; g.fillRect(0, 0, W, H); } // the flash
    const star = (x, y, r, rot, col) => { g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = col; g.beginPath(); for (let k = 0; k < 8; k++) { const rr = k % 2 ? r * 0.18 : r; const a = (k / 8) * Math.PI * 2; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.closePath(); g.fill(); g.restore(); };
    for (let k = 0; k < 18; k++) { // sparkles twinkling around the pack
      const ph = (L * (0.9 + (k % 5) * 0.23) + k * 0.37) % 1, tw = Math.sin(Math.PI * ph);
      const ang = k * 2.39996, rad = H * (0.16 + 0.22 * ((k * 0.618) % 1));
      star(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad * 0.9, H * (0.012 + 0.03 * tw) * (k % 4 === 0 ? 1.8 : 1), L * 0.8 + k, k % 3 ? '#fff7b0' : '#ffffff');
    }
    if (u > 0.2) { const gl = (L * 0.8) % 1; star(cx + H * 0.12, cy - H * 0.18, H * 0.07 * Math.sin(Math.PI * gl), 0.3, '#ffffff'); } // the big glint on the pack
    // kawaii text pop
    const pop = (txt, x, y, size, t0, col, rot) => { const q = seg(L, t0, t0 + 0.35); if (q <= 0) return; const sc = q < 1 ? 0.2 + 1.15 * Math.sin(q * Math.PI * 0.75) : 1 + 0.03 * Math.sin(L * 8); g.save(); g.translate(x, y); g.rotate(rot); g.scale(sc, sc); g.font = `900 ${size}px "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", system-ui, sans-serif`; g.textAlign = 'center'; g.lineJoin = 'round'; g.lineWidth = size * 0.18; g.strokeStyle = '#ff3d8b'; g.strokeText(txt, 0, 0); g.fillStyle = col; g.fillText(txt, 0, 0); g.restore(); };
    pop('キラキラ！', W * 0.22, H * 0.3, Math.round(H * 0.085), 0.55, '#fff6a8', -0.18);
    pop('NEW PACK!', W * 0.78, H * 0.34, Math.round(H * 0.08), 0.85, '#ffffff', 0.12);
    if (o.name) pop(`「${o.name}」`, W * 0.5, H * 0.8, Math.round(H * 0.06), 1.3, '#ffe9f6', 0);
    if (u > 0.86) { const q = seg(u, 0.86, 1); g.fillStyle = `rgba(255,255,255,${q * 0.7})`; g.fillRect(0, 0, W, H); g.fillStyle = `rgba(40,20,60,${q})`; g.textAlign = 'center'; g.font = `900 ${Math.round(H * 0.09)}px system-ui, sans-serif`; g.fillText('おわり · THE END', W / 2, H * 0.52); }
  }

  function dispose() {
    me.dispose?.(); renderer.dispose(); renderer.forceContextLoss?.();
    scene.traverse((o) => { o.geometry?.dispose?.(); const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []; for (const m of ms) { if (m !== wm && m !== fm) m.dispose?.(); } });
  }
  return { canvas: out, renderAt, dispose, size: [W, H] };
}

// Record the film in real time from the 2D canvas. → { blob, mime, ext } (or null: no MediaRecorder,
// then the film can only be watched live: playLive).
export const canRecordFilm = () => typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;
export function filmMime() {
  if (!canRecordFilm()) return null;
  const safari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  return pickFilmMime((m) => MediaRecorder.isTypeSupported(m), { prefer: safari ? 'mp4' : 'webm' });
}
export function recordFilm(fr, plan, { onProgress = () => {}, fps = FILM.fps } = {}) {
  const fm = filmMime();
  return new Promise((resolve) => {
    if (!fm) { resolve(null); return; }
    const stream = fr.canvas.captureStream(fps);
    let rec; try { rec = new MediaRecorder(stream, { mimeType: fm.mime, videoBitsPerSecond: 4_000_000 }); } catch { resolve(null); return; }
    const chunks = []; rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); resolve({ blob: new Blob(chunks, { type: fm.mime.split(';')[0] }), ...fm }); };
    fr.renderAt(0); rec.start(500);
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      fr.renderAt(Math.min(t, plan.length)); onProgress(Math.min(1, t / plan.length));
      if (t < plan.length + 0.15) requestAnimationFrame(tick); else rec.stop();
    };
    requestAnimationFrame(tick);
  });
}
// Without a recorder: show the film live on a canvas (Watch still works; Download doesn't).
export function playLive(fr, plan, onEnd = () => {}) {
  const t0 = performance.now(); let stop = false;
  const tick = () => { if (stop) return; const t = (performance.now() - t0) / 1000; fr.renderAt(Math.min(t, plan.length)); if (t < plan.length) requestAnimationFrame(tick); else onEnd(); };
  requestAnimationFrame(tick); return () => { stop = true; };
}

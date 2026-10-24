// Slap and Talk – startpunkten för webbappen. Här kopplas allt ihop:
// rummet (room.js), styrningen (controls.js), stämplarna (stamps.js) och servern (api.js).
import * as THREE from 'three';
import { buildBoxRoom } from './room.js';
import { FirstPersonControls } from './controls.js';
import { StampLayer, StampPreview } from './stamps.js';
import { api } from './api.js';
import { foldStamp } from './fold.js';
import { connect } from './net.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ROOM = (params.get('room') || 'stad').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'stad';
const isTouch = matchMedia('(pointer: coarse)').matches || params.has('touch');
document.body.classList.toggle('touch', isTouch);
$('room-name').textContent = ROOM;

// ---------- Scen, kamera, rendering ----------
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 100);

const room = buildBoxRoom(); // senare: await loadGltfRoom('/rum/stad.glb')
scene.add(room.group);
camera.position.copy(room.spawn);

const controls = new FirstPersonControls(camera, canvas, room.bounds);
controls.attachJoystick($('joystick'), $('stick'));
const stamps = new StampLayer(scene, room.surfaces);
const preview = new StampPreview(scene, stamps.faces);
const raycaster = new THREE.Raycaster();

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ---------- Tillstånd ----------
const state = {
  selected: null, // vald bild { id, url, width, height }
  mine: JSON.parse(localStorage.getItem('klibb.mine') || '[]'),
  size: 0.3, rotation: 0, jitter: false,
  artist: localStorage.getItem('klibb.artist') || '',
  adminToken: '',
};

// ---------- Meny ----------
let toastTimer;
function toast(msg, ms = 2200) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function updateCount() { $('stamp-count').textContent = stamps.count; }

function renderTray() {
  const tray = $('tray'); tray.innerHTML = '';
  for (const img of state.mine.slice(-12).reverse()) {
    const b = document.createElement('button');
    b.type = 'button'; b.title = 'Välj den här klibban';
    b.className = state.selected?.id === img.id ? 'sel' : '';
    b.innerHTML = `<img src="${img.url}" alt="">`;
    b.onclick = () => select(img);
    tray.appendChild(b);
  }
}
async function select(img) {
  state.selected = img; renderTray();
  preview.setTexture(await stamps.texture(img));
}

$('size').oninput = (e) => { state.size = e.target.value / 100; $('size-val').textContent = `${e.target.value} cm`; };
$('rot').oninput = (e) => { state.rotation = Number(e.target.value); $('rot-val').textContent = `${e.target.value}°`; };
$('jitter').onchange = (e) => { state.jitter = e.target.checked; };
$('artist').value = state.artist;
$('artist').oninput = (e) => { state.artist = e.target.value.trim(); localStorage.setItem('klibb.artist', state.artist); };
function setSize(cm) { cm = THREE.MathUtils.clamp(Math.round(cm), 5, 200); $('size').value = cm; $('size').oninput({ target: $('size') }); }
function setRot(deg) { deg = ((deg + 540) % 360) - 180; $('rot').value = deg; $('rot').oninput({ target: $('rot') }); }

// Bilden krymps i webbläsaren om den är stor, så uppladdningen går fort även på mobilen.
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size <= 5 * 1024 * 1024) return file;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.92));
  return blob && blob.type === 'image/webp' ? blob : new Promise((r) => c.toBlob(r, 'image/png'));
}

$('file').onchange = async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast('Bara PNG, JPG eller WebP, tack.');
  if (file.size > 20 * 1024 * 1024) return toast('Filen är för stor (max 5 MB efter förminskning).');
  try {
    toast('Laddar upp…', 10000);
    const img = await api.uploadSticker(await shrink(file), state.artist);
    state.mine = [...state.mine.filter((m) => m.id !== img.id), img].slice(-30);
    localStorage.setItem('klibb.mine', JSON.stringify(state.mine));
    await select(img);
    toast(isTouch ? 'Klar! Tryck på en yta för att stämpla.' : 'Klar! Gå in i rummet och klicka för att stämpla.');
  } catch (err) { toast(err.message); }
};

// ---------- Stämpla ----------
function hitSurface(ndc) {
  camera.updateMatrixWorld();
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(room.surfaces, false)[0];
  if (!hit) return null;
  const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  if (normal.dot(raycaster.ray.direction) > 0) normal.negate();
  return { point: hit.point, normal, surface: hit.object.name, dir: raycaster.ray.direction.clone() };
}

let pendingJitter = 0;
function nextRotation() { return state.rotation + (state.jitter ? pendingJitter : 0); }

async function stampAt(ndc) {
  if (!state.selected) { toast('Ladda upp eller välj en klibba först.'); return null; }
  const h = hitSurface(ndc); if (!h) return null;
  const q = StampLayer.orientation(h.normal, h.dir, nextRotation());
  pendingJitter = (Math.random() - 0.5) * 30;
  try {
    const { stamp, image } = await api.addStamp(ROOM, {
      imageId: state.selected.id,
      position: h.point.toArray(), normal: h.normal.toArray(), quaternion: q.toArray(),
      size: state.size, rotation: state.rotation, surface: h.surface, artist: state.artist,
    });
    await stamps.add(stamp, image); updateCount();
    return stamp;
  } catch (err) { toast(err.message); return null; }
}

// ---------- Admin (dold): öppna sidan med ?admin=NYCKEL ----------
async function initAdmin() {
  if (params.has('admin')) {
    const t = params.get('admin') || prompt('Admin-nyckel:') || '';
    sessionStorage.setItem('klibb.admin', t);
    params.delete('admin');
    history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : ''));
  }
  const token = sessionStorage.getItem('klibb.admin');
  if (!token) return;
  const { ok } = await api.checkAdmin(token).catch(() => ({ ok: false }));
  if (!ok) { sessionStorage.removeItem('klibb.admin'); toast('Fel admin-nyckel.'); return; }
  state.adminToken = token;
  $('admin-banner').hidden = false;
}

function adminPick(ndc) {
  camera.updateMatrixWorld();
  raycaster.setFromCamera(ndc, camera);
  const picked = stamps.pick(raycaster);
  if (!picked) { toast('Ingen klibba där.'); return; }
  controls.unlock();
  const { stamp, image } = picked;
  $('admin-info').textContent = `Stämpel #${stamp.order} · ${stamp.artist || 'okänd artist'} · ${new Date(stamp.createdAt).toLocaleString('sv-SE')}`;
  $('admin-img').src = image.url;
  const dlg = $('admin-dialog');
  $('admin-del-stamp').onclick = async () => {
    await api.deleteStamp(ROOM, stamp.id, state.adminToken); stamps.remove(stamp.id); updateCount(); dlg.close(); toast('Borttagen.');
  };
  $('admin-del-image').onclick = async () => {
    if (!confirm('Ta bort bilden och ALLA stämplar av den i alla rum?')) return;
    const r = await api.deleteImage(image.id, state.adminToken); stamps.removeImage(image.id); updateCount(); dlg.close();
    toast(`Bilden borttagen (${r.removedStamps} stämplar).`);
  };
  $('admin-cancel').onclick = () => dlg.close();
  dlg.showModal();
}

function action(ndc) { return state.adminToken ? adminPick(ndc) : stampAt(ndc); }

// ---------- Inmatning ----------
const CENTER = new THREE.Vector2(0, 0);
$('enter').onclick = () => controls.lock();
controls.onLockChange = (locked) => {
  document.body.classList.toggle('locked', locked);
  $('crosshair').hidden = !locked;
  if (!locked) preview.hide();
};

if (!isTouch) {
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (!controls.locked) controls.lock(); else action(CENTER);
  });
  addEventListener('wheel', (e) => { if (controls.locked) setSize(state.size * 100 * (e.deltaY > 0 ? 0.9 : 1.1)); }, { passive: true });
  addEventListener('keydown', (e) => {
    if (e.target.closest('input')) return;
    if (e.code === 'KeyQ') setRot(state.rotation - 15);
    if (e.code === 'KeyE') setRot(state.rotation + 15);
  });
} else {
  // Mobil: dra = titta, kort tryck = stämpla.
  const touches = new Map();
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), drag: false });
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = touches.get(e.pointerId); if (!p) return;
    if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 10) p.drag = true;
    if (p.drag) controls.look((e.clientX - p.x) * 0.006, (e.clientY - p.y) * 0.006);
    p.x = e.clientX; p.y = e.clientY;
  });
  const up = (e) => {
    const p = touches.get(e.pointerId); touches.delete(e.pointerId);
    if (p && !p.drag && performance.now() - p.t < 400 && e.type === 'pointerup') {
      action(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1));
    }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  $('panel-toggle').onclick = () => {
    const hidden = $('panel').classList.toggle('hidden');
    $('panel-toggle').setAttribute('aria-expanded', String(!hidden));
  };
}

// ---------- Ladda rummet ----------
async function loadRoom() {
  try {
    const { stamps: list, images } = await api.loadRoom(ROOM);
    await Promise.all(list.map((s) => images[s.imageId] && stamps.add(s, images[s.imageId])));
    updateCount();
  } catch (err) { toast('Kunde inte ladda rummet: ' + err.message); }
}

// Flerspelarläge kommer senare – net.js gör ingenting än.
connect(ROOM, {
  onStampAdd: (s, img) => stamps.add(s, img).then(updateCount),
  onStampRemove: (id) => { stamps.remove(id); updateCount(); },
});

// ---------- Huvudloopen ----------
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  controls.update(dt);
  if (controls.locked && state.selected && !state.adminToken) {
    const h = hitSurface(CENTER);
    if (h) {
      const [w, hh] = StampLayer.dims(state.selected, state.size);
      preview.show(h.point, h.normal, StampLayer.orientation(h.normal, h.dir, nextRotation()), w, hh, h.surface);
    } else preview.hide();
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

renderTray();
if (state.mine.length) select(state.mine.at(-1));
initAdmin();
loadRoom().then(() => { window.klibb.ready = true; });
frame();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// Små hjälpfunktioner för automatiska tester (och för nyfikna i konsolen).
window.klibb = {
  ready: false, state, stamps, camera, controls, preview,
  // Vikningen utan rendering, för tester: vilka ytor hamnar en klibba på och hur stor yta?
  fold(position, quaternion, w, h, surface) {
    const pieces = foldStamp(stamps.faces, { center: new THREE.Vector3(...position), quaternion: new THREE.Quaternion(...quaternion), w, h, surface });
    return pieces.map((p) => ({ face: p.face, depth: p.depth, uv: p.uv, points: p.points.map((v) => v.toArray()) }));
  },
  orientation: (normal, dir, rot) => StampLayer.orientation(new THREE.Vector3(...normal), new THREE.Vector3(...dir), rot).toArray(),
  look(yaw, pitch) { controls.yaw = yaw; controls.pitch = pitch; controls.apply(); },
  moveTo(x, z) { camera.position.x = x; camera.position.z = z; },
  stampAt: (x = 0, y = 0) => stampAt(new THREE.Vector2(x, y)),
};

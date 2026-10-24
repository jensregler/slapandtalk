// Slap and Talk – startpunkten för webbappen. Här kopplas allt ihop:
// rummet (room.js), styrningen (controls.js), stämplarna (stamps.js) och servern (api.js).
import * as THREE from 'three';
import { buildBoxRoom } from './room.js';
import { FirstPersonControls } from './controls.js';
import { StampLayer, StampPreview } from './stamps.js';
import { api } from './api.js';
import { foldStamp } from './fold.js';
import { readMine, addMine, removeMine, updateMine, saveBlob, deleteBlob, getBlob } from './designs.js';
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
  mine: readMine(),
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
  for (const img of designs()) {
    const b = document.createElement('button');
    b.type = 'button'; b.title = 'Välj den här klibban';
    b.className = state.selected?.id === img.id ? 'sel' : '';
    b.innerHTML = `<img src="${img.url}" alt="">`;
    b.onclick = () => select(img);
    tray.appendChild(b);
  }
}
// Mina designs i samma ordning som i menyn (nyaste först). R växlar mellan dem.
function designs() { return state.mine.slice().reverse(); }
// En annan flik ändrade listan: hämta den nya.
addEventListener('storage', (e) => {
  if (e.key !== 'klibb.mine') return;
  state.mine = readMine();
  if (state.selected && !state.mine.some((m) => m.id === state.selected.id)) select(state.mine.at(-1));
  else { renderTray(); renderDesignHud(); }
});

async function select(img) {
  state.selected = img || null; renderTray(); renderDesignHud();
  if (!img) { preview.setTexture(null); return; }
  try {
    const tex = await stamps.texture(img);
    if (state.selected === img) preview.setTexture(tex);
  } catch { stamps.textures.delete(img.id); toast('Kunde inte hämta designen just nu.'); }
}

// Byt till nästa uppladdade design (och börja om från början efter den sista).
function nextDesign() {
  const list = designs();
  if (!list.length) { toast('Ladda upp en klibba först.'); return null; }
  const i = list.findIndex((d) => d.id === state.selected?.id);
  const next = list[(i + 1) % list.length];
  select(next);
  if (list.length === 1) toast('Du har bara en design. Ladda upp fler för att växla med R.');
  return next;
}

function renderDesignHud() {
  const list = designs(), sel = state.selected;
  const i = sel ? list.findIndex((d) => d.id === sel.id) : -1;
  const hud = $('design-hud'), btn = $('design-btn');
  hud.hidden = !sel;
  btn.hidden = !sel;
  if (!sel) return;
  $('design-hud-img').src = sel.url;
  $('design-btn-img').src = sel.url;
  $('design-hud-num').textContent = `${i + 1}/${list.length}`;
  $('design-btn-num').textContent = list.length > 1 ? `${i + 1}/${list.length}` : '';
}

// Designs som säkert inte finns på servern och inte gick att återställa tas bort ur listan.
function dropDesigns(ids) {
  if (!ids.length) return;
  state.mine = removeMine(ids);
  ids.forEach(deleteBlob);
  if (!state.selected || ids.includes(state.selected.id)) select(state.mine.at(-1));
  else { renderTray(); renderDesignHud(); }
}

// Servern har tappat designen (t.ex. omstart på Render): ladda upp den igen från den här
// enheten. Returnerar den nya posten, eller null om bilden inte finns sparad här.
const restoring = new Map();
function restoreDesign(img) {
  if (!restoring.has(img.id)) {
    restoring.set(img.id, (async () => {
      const blob = await getBlob(img);
      if (!blob) return null;
      const fresh = await api.uploadSticker(blob, img.artist || state.artist);
      if (fresh.id !== img.id) { await saveBlob(fresh.id, blob); deleteBlob(img.id); }
      state.mine = addMine(fresh, img.id);
      stamps.textures.delete(img.id);
      if (state.selected?.id === img.id) await select(fresh); else { renderTray(); renderDesignHud(); }
      return fresh;
    })().finally(() => restoring.delete(img.id)));
  }
  return restoring.get(img.id);
}

// Servern har sagt säkert (404/410) att de här designs saknas. Försök återställa varje,
// ta bort bara de som inte går, och berätta vad som hände.
async function handleMissing(list) {
  if (!list.length) return;
  const results = await Promise.all(list.map((img) => restoreDesign(img).catch(() => undefined)));
  const lost = list.filter((img, i) => results[i] === null).map((m) => m.id); // null = ingen lokal kopia
  const restored = results.filter(Boolean).length;
  if (lost.length) dropDesigns(lost);
  if (lost.length) {
    toast(lost.length === 1 ? 'En gammal design fanns inte kvar på servern och kunde inte återställas. Ladda upp den igen.'
      : `${lost.length} gamla designs fanns inte kvar på servern och kunde inte återställas. Ladda upp dem igen.`, 5000);
  } else if (restored) toast(restored === 1 ? 'En design hade försvunnit från servern och laddades upp igen.' : `${restored} designs hade försvunnit från servern och laddades upp igen.`, 3500);
}

// Kolla mot servern att mina sparade designs finns kvar. Bara id:n som servern säkert
// säger saknas räknas (inte fel, timeout eller "för många förfrågningar").
async function validateDesigns() {
  const checked = readMine();
  if (!checked.length) return;
  let res;
  try { res = await api.checkStickers(checked.map((m) => m.id)); } catch { return; /* offline/fel: behåll allt */ }
  if (!res || typeof res.images !== 'object' || !Array.isArray(res.missing)) return; // okänt svar: rör inget
  state.mine = updateMine(res.images);
  renderTray(); renderDesignHud();
  const missing = checked.filter((m) => res.missing.includes(m.id) && !res.images[m.id]);
  await handleMissing(missing);
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
    const blob = await shrink(file);
    const img = await api.uploadSticker(blob, state.artist);
    await saveBlob(img.id, blob); // lokal kopia, så designen kan återställas om servern tappar den
    state.mine = addMine(img);
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
  // Kom ihåg exakt vilken design som stämplas: användaren kan hinna trycka R innan svaret kommer.
  const design = state.selected;
  const body = {
    imageId: design.id,
    position: h.point.toArray(), normal: h.normal.toArray(), quaternion: q.toArray(),
    size: state.size, rotation: state.rotation, surface: h.surface, artist: state.artist,
  };
  try {
    let res;
    try { res = await api.addStamp(ROOM, body); } catch (err) {
      if (!err.gone) throw err;
      // Servern har tappat just den här designen: ladda upp den igen och stämpla en gång till.
      const fresh = await restoreDesign(design).catch(() => undefined);
      if (!fresh) { if (fresh === null) await handleMissing([design]); else toast('Kunde inte stämpla just nu, försök igen.'); return null; }
      res = await api.addStamp(ROOM, { ...body, imageId: fresh.id });
    }
    await stamps.add(res.stamp, res.image); updateCount();
    return res.stamp;
  } catch (err) {
    toast(err.message);
    return null;
  }
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
    if (e.code === 'KeyR' && !e.repeat && !e.ctrlKey && !e.metaKey) nextDesign();
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
  $('design-btn').onclick = (e) => { e.preventDefault(); nextDesign(); };
  $('panel-toggle').onclick = () => {
    const hidden = $('panel').classList.toggle('hidden');
    $('panel-toggle').setAttribute('aria-expanded', String(!hidden));
  };
}

// ---------- Rum: typ, nytt snabbrum, dela länk, till Staden ----------
const TYPE_NAMES = { stad: 'Staden', quick: 'Snabbrum', profile: 'Profilrum' };
function roomUrl(id) { return `${location.origin}/${id === 'stad' ? '' : '?room=' + id}`; }
function showRoomInfo(info) {
  const type = info?.type || (ROOM === 'stad' ? 'stad' : 'quick');
  const badge = $('room-type');
  badge.textContent = TYPE_NAMES[type] || type;
  badge.className = 'badge ' + type;
  $('to-stad').hidden = ROOM === 'stad';
  $('room-note').textContent = type === 'quick'
    ? `Ditt eget rum. Dela länken så kan andra komma in. Det raderas när ingen har varit här på ${info?.quickTtlHours ?? 24} timmar.`
    : type === 'profile' ? `Sparat rum${info.owner?.name ? ' som tillhör ' + info.owner.name : ''}.` : '';
  $('room-hud').textContent = type === 'stad' ? 'Staden' : `${TYPE_NAMES[type] || type} · ${ROOM}`;
  window.klibb && (window.klibb.roomInfo = { ...info, type });
}
showRoomInfo(null);
$('new-room').onclick = async () => {
  try {
    const { room } = await api.createRoom();
    location.href = roomUrl(room.id);
  } catch (err) { toast(err.message); }
};
$('to-stad').onclick = () => { location.href = roomUrl('stad'); };
$('share-room').onclick = async () => {
  const url = roomUrl(ROOM);
  const title = ROOM === 'stad' ? 'Slap and Talk – Staden' : `Slap and Talk – rum ${ROOM}`;
  if (isTouch && navigator.share) { try { await navigator.share({ title, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(url); toast(`Länken är kopierad: ${url}`, 3500); }
  catch { prompt('Kopiera länken:', url); }
};
// Säg till servern med jämna mellanrum att någon är här, så rummet inte städas bort.
setInterval(() => { if (document.visibilityState === 'visible') api.visit(ROOM).catch(() => {}); }, 10 * 60_000);

// ---------- Ladda rummet ----------
async function loadRoom() {
  try {
    const { stamps: list, images, info } = await api.loadRoom(ROOM);
    showRoomInfo(info);
    // allSettled: en enda trasig stämpel ska inte hindra resten av rummet från att laddas.
    await Promise.allSettled(list.map((s) => stamps.add(s, images[s.imageId])));
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
Promise.all([loadRoom(), validateDesigns()]).then(() => { window.klibb.ready = true; });
frame();

// updateViaCache: 'none' = webbläsaren kollar alltid efter en ny sw.js, så appen inte fastnar på en gammal version.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
}

// Små hjälpfunktioner för automatiska tester (och för nyfikna i konsolen).
window.klibb = {
  ready: false, room: ROOM, state, stamps, camera, controls, preview,
  // Vikningen utan rendering, för tester: vilka ytor hamnar en klibba på och hur stor yta?
  fold(position, quaternion, w, h, surface) {
    const pieces = foldStamp(stamps.faces, { center: new THREE.Vector3(...position), quaternion: new THREE.Quaternion(...quaternion), w, h, surface });
    return pieces.map((p) => ({ face: p.face, depth: p.depth, uv: p.uv, points: p.points.map((v) => v.toArray()) }));
  },
  orientation: (normal, dir, rot) => StampLayer.orientation(new THREE.Vector3(...normal), new THREE.Vector3(...dir), rot).toArray(),
  look(yaw, pitch) { controls.yaw = yaw; controls.pitch = pitch; controls.apply(); },
  moveTo(x, z) { camera.position.x = x; camera.position.z = z; },
  stampAt: (x = 0, y = 0) => stampAt(new THREE.Vector2(x, y)),
  nextDesign, designs, validateDesigns,
};

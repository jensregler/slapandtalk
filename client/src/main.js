// Slap and Talk – startpunkten för webbappen. Här kopplas allt ihop:
// rummet (room.js), styrningen (controls.js), stämplarna (stamps.js) och servern (api.js).
import * as THREE from 'three';
import { buildBoxRoom, wallHeight } from './room.js';
import { CATALOG, DEFAULT_STYLE, normalizeStyle, styleFromSeed, randomSeed, styleName, applyStyle, swatchUrl } from './roomstyle.js';
import { FirstPersonControls, isTyping } from './controls.js';
import { StampLayer, StampPreview } from './stamps.js';
import { api } from './api.js';
import { foldStamp } from './fold.js';
import { readHistory, addHistory, removeHistory, roomHistory, HISTORY_KEY } from './history.js';
import { readMine, addMine, removeMine, updateMine, saveBlob, deleteBlob, getBlob } from './designs.js';
import { initTogether } from './together.js';

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
// Lite slumpat var man dyker upp, så inte alla som kommer in står i varandra.
camera.position.x += (Math.random() - 0.5) * 3; camera.position.z += (Math.random() - 0.5) * 1;

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
  mode: 'slap', // 'slap' = Klibbläge (pekaren syns, klick stämplar), 'view' = Tittläge (bara titta)
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

// Största klibban: längsta sidan får vara högst väggens höjd (även bredden, eftersom
// klibban kan vridas så att bredden blir höjd). Storleken = klibbans längsta sida.
const MAX_SIZE_CM = Math.floor(wallHeight(room.surfaces) * 100 + 1e-6);
$('size').max = String(MAX_SIZE_CM);
$('size').oninput = (e) => { state.size = e.target.value / 100; $('size-val').textContent = `${e.target.value} cm`; };
$('rot').oninput = (e) => { state.rotation = Number(e.target.value); $('rot-val').textContent = `${e.target.value}°`; };
$('jitter').onchange = (e) => { state.jitter = e.target.checked; };
$('artist').value = state.artist;
$('artist').oninput = (e) => { state.artist = e.target.value.trim(); localStorage.setItem('klibb.artist', state.artist); };
let maxToastAt = 0;
function setSize(cm) {
  const want = Math.round(cm);
  cm = THREE.MathUtils.clamp(want, 5, MAX_SIZE_CM);
  if (want > MAX_SIZE_CM && performance.now() - maxToastAt > 1500) {
    maxToastAt = performance.now();
    toast(`Max storlek: ${(MAX_SIZE_CM / 100).toLocaleString('sv-SE')} m (väggens höjd)`, 1500);
  }
  $('size').value = cm; $('size').oninput({ target: $('size') });
}
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
    size: Math.min(state.size, MAX_SIZE_CM / 100), rotation: state.rotation, surface: h.surface, artist: state.artist,
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
    if (res.peelToken) {
      addHistory({ room: ROOM, stampId: res.stamp.id, token: res.peelToken, designId: res.image.id, url: res.image.url, time: res.stamp.createdAt || new Date().toISOString() });
    }
    await stamps.add(res.stamp, res.image); updateCount(); renderHistory();
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
  updateStyleUi();
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

function action(ndc) {
  if (state.mode === 'view') return null; // Tittläge: klick och tryck gör ingenting
  if (sp.open || together.busy()) return null; // en panel är öppen: titta, men stämpla inte
  return state.adminToken ? adminPick(ndc) : stampAt(ndc);
}

// ---------- Klibbläge / Tittläge (V, eller ögat på mobilen) ----------
// Tittläge: ingen pekare och inget sikte, klick stämplar inte, scroll och Q/E gör ingenting.
// R byter fortfarande design (man stannar i Tittläge), så man kan förbereda nästa klibba.
function setMode(mode, { quiet = false } = {}) {
  state.mode = mode === 'view' ? 'view' : 'slap';
  const view = state.mode === 'view';
  document.body.classList.toggle('view-mode', view);
  if (view) preview.hide();
  $('mode-hud').textContent = (view ? 'Tittläge' : 'Klibbläge') + (isTouch ? '' : ' · V');
  $('mode-btn').setAttribute('aria-pressed', String(view));
  $('mode-btn').title = view ? 'Tillbaka till klibbläge' : 'Tittläge: dölj pekaren och titta';
  if (!quiet) {
    toast(view ? (isTouch ? 'Tittläge: titta i lugn och ro. Tryck på 👁 för att klibba igen.' : 'Tittläge: titta i lugn och ro. V = klibba igen.')
      : (isTouch ? 'Klibbläge: tryck där du vill stämpla.' : 'Klibbläge: klicka för att stämpla.'), 1600);
  }
  return state.mode;
}
const toggleMode = () => setMode(state.mode === 'view' ? 'slap' : 'view');
setMode('slap', { quiet: true });
$('mode-btn').onclick = (e) => { e.preventDefault(); toggleMode(); };

// ---------- Peel (ångra) och historik ----------
// Peel tar bort en av MINA stämplar: servern kräver den hemliga nyckeln som bara den här
// enheten fick när stämpeln sattes. Upprepade peel går bakåt i historiken.
let peelQueue = Promise.resolve();
const queuePeel = (fn) => (peelQueue = peelQueue.then(fn, fn));

// Peela de här posterna. Returnerar antal som togs bort. Stämplar som inte finns längre
// (eller vars nyckel inte stämmer) tas tyst bort ur historiken.
async function peelEntries(entries) {
  if (!entries.length) return 0;
  let results;
  try { ({ results } = await api.peel(ROOM, entries.map((h) => ({ id: h.stampId, token: h.token })))); } catch (err) {
    toast(err.status === 429 ? 'Lugn i stormen – vänta en liten stund.' : 'Kunde inte peela just nu, försök igen.'); return -1;
  }
  const done = entries.filter((h) => results[h.stampId] === 'ok');
  removeHistory(entries.filter((h) => results[h.stampId]).map((h) => h.stampId));
  await Promise.all(done.map((h) => stamps.peelAway(h.stampId)));
  updateCount(); renderHistory();
  return done.length;
}

function peelLast() {
  return queuePeel(async () => {
    // Gå bakåt tills något faktiskt peelas (hoppa över sådant som redan är borta).
    for (let tries = 0; tries < 20; tries++) {
      const next = roomHistory(ROOM)[0];
      if (!next) { toast('Inga fler egna klibbor här'); return false; }
      const n = await peelEntries([next]);
      if (n < 0) return false;
      if (n > 0) { toast('Peelad', 900); return true; }
    }
    return false;
  });
}

function peelAll() {
  return queuePeel(async () => {
    const all = roomHistory(ROOM);
    if (!all.length) { toast('Inga fler egna klibbor här'); return 0; }
    let total = 0;
    for (let i = 0; i < all.length; i += 200) { const n = await peelEntries(all.slice(i, i + 200)); if (n < 0) return total; total += n; }
    toast(total ? `Peelade ${total} klibb${total === 1 ? 'a' : 'or'}` : 'Inga fler egna klibbor här');
    return total;
  });
}

function fmtTime(iso) {
  const d = new Date(iso), now = new Date();
  const t = d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? t : `${d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })} ${t}`;
}
function renderHistory() {
  const list = roomHistory(ROOM);
  const ul = $('history-list'); ul.innerHTML = '';
  $('history-count').textContent = list.length ? String(list.length) : '';
  $('peel-last').disabled = $('peel-all').disabled = !list.length;
  for (const h of list.slice(0, 200)) {
    const li = document.createElement('li');
    li.dataset.id = h.stampId;
    li.title = 'Peka eller tryck för att se var den sitter';
    li.innerHTML = `<img alt="" src="${h.url || ''}"><span class="t">${fmtTime(h.time)}</span><button type="button" title="Peela den här" aria-label="Peela den här klibban">✕</button>`;
    const hl = (on) => { li.classList.toggle('hl', on); stamps.highlight(h.stampId, on); };
    li.onmouseenter = () => hl(true);
    li.onmouseleave = () => hl(false);
    li.onclick = (e) => { if (e.target.closest('button')) return; hl(true); setTimeout(() => hl(false), 1200); };
    li.querySelector('button').onclick = () => queuePeel(async () => {
      hl(false);
      const n = await peelEntries([h]);
      if (n > 0) toast('Peelad', 900); else if (n === 0) renderHistory();
    });
    ul.appendChild(li);
  }
}
// "Peela alla" kräver två tryck: första gången frågar knappen "Säker?".
let peelAllTimer;
$('peel-all').onclick = () => {
  const b = $('peel-all');
  if (!b.classList.contains('confirm')) {
    b.classList.add('confirm'); b.textContent = `Säker? Tryck igen (${roomHistory(ROOM).length})`;
    clearTimeout(peelAllTimer);
    peelAllTimer = setTimeout(() => { b.classList.remove('confirm'); b.textContent = 'Peela alla'; }, 4000);
    return;
  }
  clearTimeout(peelAllTimer); b.classList.remove('confirm'); b.textContent = 'Peela alla';
  peelAll();
};
$('peel-last').onclick = () => peelLast();
$('peel-btn').onclick = (e) => { e.preventDefault(); peelLast(); };
addEventListener('storage', (e) => { if (e.key === HISTORY_KEY) renderHistory(); });
// Efter att rummet laddats: glöm stämplar som inte finns kvar på servern (raderade, städade).
function pruneHistory(stampIds) {
  const alive = new Set(stampIds);
  const dead = readHistory().filter((h) => h.room === ROOM && !alive.has(h.stampId)).map((h) => h.stampId);
  if (dead.length) removeHistory(dead);
  renderHistory();
}

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
    if (sp.open || together.busy()) return; // panelen för rummets utseende eller Min gubbe är öppen
    if (together.chatOpen()) { together.closeChat(); if (!controls.locked) controls.lock(); return; } // klick = stäng chatten, stämpla inte
    if (!controls.locked) controls.lock(); else action(CENTER);
  });
  addEventListener('wheel', (e) => { if (controls.locked && state.mode === 'slap') setSize(state.size * 100 * (e.deltaY > 0 ? 0.9 : 1.1)); }, { passive: true });
  addEventListener('keydown', (e) => {
    if (isTyping(e)) return; // inte medan man skriver
    // Z eller Ctrl+Z / Cmd+Z = peela senaste (i både Klibbläge och Tittläge)
    if ((e.key === 'z' || e.key === 'Z' || e.code === 'KeyZ') && !e.altKey && !e.shiftKey) {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
      if (!e.repeat) peelLast();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return; // inte Ctrl+V osv.
    if (e.code === 'KeyV' && !e.repeat) toggleMode();
    if (state.mode === 'slap' && e.code === 'KeyQ') setRot(state.rotation - 15);
    if (state.mode === 'slap' && e.code === 'KeyE') setRot(state.rotation + 15);
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
  roomType = type;
  if (info) currentStyle = normalizeStyle(info.style);
  if (info) updateStyleUi();
  window.klibb && (window.klibb.roomInfo = { ...info, type });
}
showRoomInfo(null);
// ---------- Rummets utseende ----------
// Skaparen av ett snabbrum får en hemlig rumsnyckel (sparas på enheten). Med den, eller som
// admin, kan utseendet ändras. Staden kan bara admin ändra.
const ROOM_KEYS = 'klibb.roomKeys';
const roomKeys = () => { try { return JSON.parse(localStorage.getItem(ROOM_KEYS) || '{}') || {}; } catch { return {}; } };
function saveRoomKey(id, key) { const k = roomKeys(); k[id] = key; localStorage.setItem(ROOM_KEYS, JSON.stringify(k)); }
// var (inte let): showRoomInfo längre upp kan köras innan den här raden.
var currentStyle = normalizeStyle(DEFAULT_STYLE); // eslint-disable-line no-var
var roomType = ROOM === 'stad' ? 'stad' : 'quick'; // eslint-disable-line no-var
const canEditStyle = () => !!state.adminToken || (roomType !== 'stad' && !!roomKeys()[ROOM]);
function updateStyleUi() {
  $('edit-style').hidden = !canEditStyle();
  const s = currentStyle;
  $('room-style').textContent = `Utseende: ${styleName(s)}${s.seed ? ` · kod ${s.seed}` : ''}`;
}
async function showStyle(s) {
  try { return await applyStyle(room.surfaces, s); } catch { toast('Kunde inte ladda rummets texturer.'); return null; }
}
showStyle(DEFAULT_STYLE);

const sp = { open: false, mode: 'create', style: null };
function swatchButtons(el, kind, items, selected, onPick, color) {
  el.innerHTML = '';
  for (const [id, spec] of Object.entries(items)) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.id = id; b.title = spec.name;
    if (kind === 'color') { b.style.background = spec.hex; b.setAttribute('aria-label', spec.name); }
    else b.innerHTML = `<img alt="" loading="lazy" src="${swatchUrl(kind, id, color)}"><span>${spec.name}</span>`;
    if (id === selected) b.classList.add('sel');
    b.onclick = () => onPick(id);
    el.appendChild(b);
  }
}
function renderStylePanel() {
  const s = sp.style;
  const color = s.wallColor ? CATALOG.wallColors[s.wallColor].hex : null;
  const custom = (patch) => { sp.style = normalizeStyle({ ...sp.style, ...patch, seed: undefined }); delete sp.style.seed; previewStyle(); };
  swatchButtons($('sw-floor'), 'floor', CATALOG.floors, s.floor, (id) => custom({ floor: id }));
  swatchButtons($('sw-wall'), 'wall', CATALOG.walls, s.wall, (id) => custom({ wall: id }), color);
  swatchButtons($('sw-color'), 'color', CATALOG.wallColors, s.wallColor, (id) => custom({ wallColor: id }));
  swatchButtons($('sw-ceiling'), 'ceiling', CATALOG.ceilings, s.ceiling, (id) => custom({ ceiling: id }));
  $('sp-color-row').hidden = !CATALOG.walls[s.wall].colored;
  if (document.activeElement !== $('style-seed')) $('style-seed').value = s.seed || '';
  $('style-name').textContent = styleName(s);
}
function previewStyle() { renderStylePanel(); showStyle(sp.style); }
function openStylePanel(mode) {
  sp.open = true; sp.mode = mode;
  sp.style = mode === 'create' ? styleFromSeed(randomSeed()) : { ...currentStyle };
  $('style-title').textContent = mode === 'create' ? 'Nytt snabbrum' : 'Ändra rummets utseende';
  $('style-ok').textContent = mode === 'create' ? 'Skapa rum' : 'Spara';
  $('style-panel').hidden = false;
  if (isTouch) { $('panel').classList.add('hidden'); $('panel-toggle').setAttribute('aria-expanded', 'false'); }
  previewStyle();
}
function closeStylePanel(revert = true) {
  sp.open = false; $('style-panel').hidden = true;
  if (revert) showStyle(currentStyle);
}
$('new-room').onclick = () => openStylePanel('create');
$('edit-style').onclick = () => openStylePanel('edit');
$('style-cancel').onclick = () => closeStylePanel(true);
$('style-random').onclick = () => { sp.style = styleFromSeed(randomSeed()); previewStyle(); };
$('style-seed').oninput = (e) => {
  const v = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  if (v !== e.target.value) e.target.value = v;
  if (v) { sp.style = styleFromSeed(v); previewStyle(); }
};
$('style-ok').onclick = async () => {
  const b = $('style-ok'); b.disabled = true;
  try {
    if (sp.mode === 'create') {
      const { room: r, roomKey } = await api.createRoom(sp.style);
      if (roomKey) saveRoomKey(r.id, roomKey);
      location.href = roomUrl(r.id);
      return;
    }
    const res = await api.setStyle(ROOM, sp.style, { key: roomKeys()[ROOM], admin: state.adminToken });
    currentStyle = normalizeStyle(res.style);
    closeStylePanel(false); showStyle(currentStyle); updateStyleUi();
    toast('Rummets utseende är sparat.');
  } catch (err) { toast(err.message); } finally { b.disabled = false; }
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
    if (!sp.open) await showStyle(currentStyle);
    pruneHistory(list.map((s) => s.id));
    // allSettled: en enda trasig stämpel ska inte hindra resten av rummet från att laddas.
    await Promise.allSettled(list.map((s) => stamps.add(s, images[s.imageId])));
    updateCount();
  } catch (err) { toast('Kunde inte ladda rummet: ' + err.message); }
}

// ---------- Tillsammans: andra spelare, chatt, Min gubbe (together.js) ----------
// Händelser från servern: det andra gör i rummet syns direkt, utan att ladda om.
function onRoomEvent(e) {
  if (!e || typeof e.type !== 'string') return;
  if (e.type === 'stamp:add' && e.stamp && e.image) stamps.add(e.stamp, e.image).then(updateCount);
  else if (e.type === 'stamp:remove') {
    stamps.peelAway(e.id).then(updateCount);
    if (roomHistory(ROOM).some((h) => h.stampId === e.id)) { removeHistory([e.id]); renderHistory(); }
  } else if (e.type === 'image:remove') { stamps.removeImage(e.id); updateCount(); }
  else if (e.type === 'room:style' && e.style) {
    currentStyle = normalizeStyle(e.style); updateStyleUi();
    if (!sp.open) { showStyle(currentStyle); toast('Rummets utseende ändrades.', 1800); }
  }
}
// Efter ett avbrott (t.ex. servern startade om): hämta rummet igen och visa det vi missat.
async function resyncRoom() {
  try {
    const { stamps: list, images, info } = await api.loadRoom(ROOM);
    const alive = new Set(list.map((s) => s.id));
    for (const id of [...stamps.meshes.keys()]) if (!alive.has(id)) stamps.remove(id);
    await Promise.allSettled(list.map((s) => stamps.add(s, images[s.imageId])));
    if (info && JSON.stringify(normalizeStyle(info.style)) !== JSON.stringify(currentStyle)) { showRoomInfo(info); if (!sp.open) showStyle(currentStyle); }
    updateCount();
  } catch { /* nästa gång */ }
}
const together = initTogether({
  room: ROOM, scene, camera, controls, isTouch, toast, artist: () => state.artist,
  onEvent: onRoomEvent, onReconnect: resyncRoom,
});

// ---------- Huvudloopen ----------
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  controls.update(dt);
  together.update(dt);
  if (controls.locked && state.selected && !state.adminToken && state.mode === 'slap') {
    const h = hitSurface(CENTER);
    if (h) {
      const [w, hh] = StampLayer.dims(state.selected, Math.min(state.size, MAX_SIZE_CM / 100));
      preview.show(h.point, h.normal, StampLayer.orientation(h.normal, h.dir, nextRotation()), w, hh, h.surface);
    } else preview.hide();
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

renderTray();
renderHistory();
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
  styleFromSeed, randomSeed, normalizeStyle, currentStyle: () => currentStyle, canEditStyle, surfaces: room.surfaces,
  net: together.net, players: () => together.players.list(), me: together.me, openChat: together.openChat,
  openAvatarPanel: together.openAvatarPanel, avatarModel: () => import('./avatars.js').then((m) => m.loadAvatarModel()).then(() => true),
  nextDesign, designs, validateDesigns, setMode, toggleMode, peelLast, peelAll, roomHistory: () => roomHistory(ROOM), setSize, maxSizeCm: MAX_SIZE_CM,
};

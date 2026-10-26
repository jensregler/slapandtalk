// Slap and Talk – startpunkten för webbappen. Här kopplas allt ihop:
// rummet (room.js), styrningen (controls.js), stämplarna (stamps.js) och servern (api.js).
import * as THREE from 'three';
import { buildBoxRoom, wallHeight } from './room.js';
import { CATALOG, DEFAULT_STYLE, normalizeStyle, styleFromSeed, randomSeed, styleName, applyStyle, swatchUrl } from './roomstyle.js';
import { FirstPersonControls, isTyping } from './controls.js';
import { StampLayer, StampPreview } from './stamps.js';
import { api } from './api.js';
import { foldStamp } from './fold.js';
import { readHistory, addHistory, removeHistory, roomHistory, trimHistory, deviceId, HISTORY_KEY, PER_ROOM } from './history.js';
import { readMine, addMine, insertMine, removeMine, updateMine, saveBlob, deleteBlob, getBlob, readFavs, setFav, moveFav, FAV_KEY } from './designs.js';
import { initTogether } from './together.js';
import { CameraLayer, CAMERA_FOVS, CAMERA_ASPECTS, poseCamera, renderFramed } from './cameras.js';
import { S, LOCALE } from './strings.js';
import { Sounds } from './sound.js';
import { CHASE, chaseOpts, chasePose, smoothDist, aimNear, surfaceCaster, loadView, saveView } from './chasecam.js';
import { cleanArtistLink, cleanArtistName, linkLabel } from '../../shared/artistlink.mjs';
import { PeelLayer } from './peels.js';
import { PEEL, peelPlan, onFloor, stampDims, SLAP_REACH, inReach } from '../../shared/peels.mjs';
import { entitlements, loadEntitlements } from './entitlements.js';
import { Footsteps } from './steps.js';
import { loadSoundLook, initSoundUI } from './soundui.js';
import * as synthShared from '../../shared/synth.mjs';

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
// Mina peel-bara klibbor förblir egna meshar; äldre målas in i väggarna (se stamps.js).
stamps.keepLive = () => roomHistory(ROOM).map((h) => h.stampId);
// Peels: baksidespappret som faller till golvet vid varje slap (när rummet har det på), peels.js.
const peelLayer = new PeelLayer(scene);
// The backing paper lands: a soft "duff", louder and lower the bigger the paper, in the
// slapper's own sound (their look.sound), from where it landed.
peelLayer.onLand = (peel, by) => {
  const area = (peel.w || 0.3) * (peel.h || 0.3);
  if (by === 'me') sound.play('duff', [peel.x, 0.02, peel.z], { area, sound: sound.mine });
  else sound.play('duff', [peel.x, 0.02, peel.z], { area, sound: together.voiceOf(by) });
};
let nopes = 0;
// Klibbor fastnar inte på baksidespapper: ett litet "nej" och en axelryckning. (Påskägg, står inte i hjälpen.)
function nope() {
  nopes++; sound.play('nope');
  let el = document.getElementById('nope-shrug');
  if (!el) { el = document.createElement('div'); el.id = 'nope-shrug'; el.textContent = '🤷'; el.setAttribute('aria-hidden', 'true'); document.body.appendChild(el); }
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
// Peels på: man når bara SLAP_REACH meter (ögonen → träffpunkten), så pappret landar nära slappen.
// För långt bort: ingen klibba, ett tyst litet "nej" (inte påskäggets axelryckning) och klibban man
// håller i visas blek och grå där man siktade en kort stund (på mobilen syns den annars inte).
let farSlaps = 0, farSoundAt = 0, farFlash = null;
const outOfReach = (point) => peelLayer.on && !(window.klibb && window.klibb.skipReachCheck) && !inReach(camera.position.toArray(), point.toArray());
function tooFar(h) {
  farSlaps++;
  const now = performance.now();
  if (now - farSoundAt > 450) { farSoundAt = now; sound.play('nope', null, { volume: 0.3 }); }
  if (h && state.selected) farFlash = { h, design: state.selected, until: now + 700 };
}
function setFarUi(far) { preview.setFar(far); document.body.classList.toggle('out-of-reach', !!far); }
const preview = new StampPreview(scene, stamps.faces);
const cams = new CameraLayer(scene); // virtuella kameror (för inspelning)
const viewCam = new THREE.PerspectiveCamera(60, 1, 0.05, 100); // "Titta genom kamera"
const raycaster = new THREE.Raycaster();
// Tredjepersonsvy: en egen kamera bakom och lite ovanför min gubbe. `camera` är fortfarande
// "jag" (ögonen): styrningen, nätet och allt annat utgår från den, precis som i förstapersonsläget.
const tpCam = new THREE.PerspectiveCamera(70, 1, 0.05, 100);
const chaseCast = surfaceCaster(room.surfaces);
const chase = { eye: null, dist: null, pose: null };

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  tpCam.aspect = camera.aspect; tpCam.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ---------- Tillstånd ----------
const state = {
  selected: null, // vald bild { id, url, width, height }
  mine: readMine(),
  favs: readFavs(), // favourite design ids ("staples")
  size: 0.3, rotation: 0, jitter: false,
  mode: 'slap', // 'slap' = Klibbläge (pekaren syns, klick stämplar), 'view' = Tittläge (bara titta)
  artist: localStorage.getItem('klibb.artist') || '',
  artistLink: cleanArtistLink(localStorage.getItem('klibb.artistLink') || ''),
  adminToken: '',
};

// ---------- Ljud (sound.js) ----------
const sound = new Sounds();
sound.setMine({ seed: loadSoundLook().seed }); // custom patches only once the full version is confirmed
const myNonces = new Set(); // mina egna stämplar på väg till servern (så ljudet inte spelas två gånger)
const myPeels = new Set(); // stämplar som jag själv peelar
const fwd = new THREE.Vector3();
function renderSound() {
  $('sound-btn').textContent = sound.muted ? S.soundOff : S.soundOn;
  $('sound-btn').setAttribute('aria-pressed', String(sound.muted));
  $('sound-on').checked = !sound.muted;
}
function setMuted(m, { quiet = false } = {}) {
  sound.setMuted(m); renderSound();
  if (!quiet) toast(sound.muted ? S.soundOffToast : S.soundOnToast, 1200);
  return sound.muted;
}
$('sound-btn').onclick = () => setMuted(!sound.muted);
$('sound-on').onchange = (e) => setMuted(!e.target.checked);
renderSound();

// ---------- ⚙ Mer (allt utom det viktigaste) och rumsmenyn ----------
function openMore() {
  $('more-panel').hidden = false; $('more-btn').setAttribute('aria-expanded', 'true');
  document.body.classList.add('more-open'); closeRoomMenu();
  if (controls.locked) controls.unlock();
}
function closeMore() { $('more-panel').hidden = true; $('more-btn').setAttribute('aria-expanded', 'false'); document.body.classList.remove('more-open'); }
$('more-btn').onclick = () => ($('more-panel').hidden ? openMore() : closeMore());
$('more-close').onclick = () => closeMore();
function closeRoomMenu() { $('room-menu').hidden = true; $('room-menu-btn').setAttribute('aria-expanded', 'false'); }
$('room-menu-btn').onclick = () => {
  const open = $('room-menu').hidden; $('room-menu').hidden = !open; $('room-menu-btn').setAttribute('aria-expanded', String(open));
};
$('my-avatar').addEventListener('click', () => closeMore());

// ---------- Meny ----------
let toastTimer;
const last = (a) => (a.length ? a[a.length - 1] : undefined); // Array#at needs Safari 15.4
function toast(msg, ms = 2200) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function updateCount() { $('stamp-count').textContent = stamps.count; $('stamp-word').textContent = S.stickersWord(stamps.count); }

// The palette. Each thumbnail: pick it (click), and on hover (desktop) or when it is selected /
// long-pressed (touch) a star (favourite) top-left and a small red × top-right (remove it from
// MY list only; stickers already on walls stay). Favourites keep their yellow star showing.
let ctlShown = null, longPressed = false, pressTimer = 0; // touch: long-press state
function renderTray() {
  const tray = $('tray'); tray.innerHTML = '';
  for (const img of designs()) {
    const fav = state.favs.has(img.id);
    const t = document.createElement('div');
    t.className = 'thumb' + (state.selected?.id === img.id ? ' sel' : '') + (fav ? ' fav' : '') + (ctlShown === img.id ? ' show-ctl' : '');
    t.dataset.id = img.id;
    const b = document.createElement('button');
    b.type = 'button'; b.title = S.pickThis; b.className = 'pick';
    b.innerHTML = `<img src="${img.url}" alt="">`;
    b.onclick = () => { if (longPressed) { longPressed = false; return; } select(img); };
    const f = document.createElement('button');
    f.type = 'button'; f.className = 'fav-btn'; f.textContent = fav ? '★' : '☆';
    f.title = fav ? S.favRemove : S.favAdd; f.setAttribute('aria-label', f.title); f.setAttribute('aria-pressed', String(fav));
    f.onclick = (e) => { e.stopPropagation(); toggleFav(img.id); };
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'del-btn'; x.textContent = '×';
    x.title = S.removeDesign; x.setAttribute('aria-label', S.removeDesign);
    x.onclick = (e) => { e.stopPropagation(); removeDesign(img.id); };
    t.append(b, f, x);
    tray.appendChild(t);
  }
}
// Touch (no hover): a long press on a thumbnail shows its star and ×; tapping elsewhere hides them.
// The selected thumbnail always shows them on touch (CSS).
$('tray').addEventListener('touchstart', (e) => {
  const t = e.target.closest('.thumb'); if (!t || e.target.closest('.fav-btn, .del-btn')) return;
  clearTimeout(pressTimer); longPressed = false;
  pressTimer = setTimeout(() => { longPressed = true; ctlShown = t.dataset.id; renderTray(); }, 450);
}, { passive: true });
for (const ev of ['touchend', 'touchmove', 'touchcancel']) $('tray').addEventListener(ev, () => clearTimeout(pressTimer), { passive: true });
$('tray').addEventListener('contextmenu', (e) => { if (e.target.closest('.thumb')) e.preventDefault(); });
document.addEventListener('pointerdown', (e) => {
  if (ctlShown && !e.target.closest?.(`.thumb[data-id="${ctlShown}"]`)) { ctlShown = null; renderTray(); }
});

function toggleFav(id) {
  state.favs = setFav(id, !state.favs.has(id));
  renderTray();
  return state.favs.has(id);
}

// Remove one design from my palette (only this device's list). Undo for UNDO_MS; after that the
// local copy of the image (IndexedDB) goes too. Nothing on the server or on the walls changes.
const UNDO_MS = 5000;
let undoDel = null; // { img, index, fav, wasSelected, timer }
function commitRemove() {
  if (!undoDel) return;
  clearTimeout(undoDel.timer);
  if (!state.mine.some((m) => m.id === undoDel.img.id)) deleteBlob(undoDel.img.id);
  undoDel = null; $('undo-toast').hidden = true;
}
function removeDesign(id) {
  commitRemove(); // only the latest removal can be undone
  const list = readMine(), index = list.findIndex((m) => m.id === id);
  if (index < 0) return false;
  const img = list[index], fav = readFavs().has(id), wasSelected = state.selected?.id === id;
  const order = designs(), pos = order.findIndex((d) => d.id === id);
  state.mine = removeMine([id]);
  if (fav) state.favs = setFav(id, false);
  if (ctlShown === id) ctlShown = null;
  if (wasSelected) { const rest = designs(); select(rest[Math.min(pos, rest.length - 1)]); } else { renderTray(); renderDesignHud(); }
  undoDel = { img, index, fav, wasSelected, timer: setTimeout(commitRemove, UNDO_MS) };
  $('undo-toast').hidden = false;
  return true;
}
function undoRemove() {
  if (!undoDel) return false;
  const { img, index, fav, wasSelected, timer } = undoDel;
  clearTimeout(timer); undoDel = null; $('undo-toast').hidden = true;
  state.mine = insertMine(img, index);
  if (fav) state.favs = setFav(img.id, true);
  if (wasSelected) select(img); else { renderTray(); renderDesignHud(); }
  return true;
}
$('undo-btn').onclick = (e) => { e.stopPropagation(); undoRemove(); };
addEventListener('pagehide', commitRemove);
// Mina designs i samma ordning som i menyn (nyaste först). R växlar mellan dem.
function designs() { return state.mine.slice().reverse(); }
// En annan flik ändrade listan: hämta den nya.
addEventListener('storage', (e) => {
  if (e.key === FAV_KEY) { state.favs = readFavs(); renderTray(); return; }
  if (e.key !== 'klibb.mine') return;
  state.mine = readMine();
  if (state.selected && !state.mine.some((m) => m.id === state.selected.id)) select(last(state.mine));
  else { renderTray(); renderDesignHud(); }
});

async function select(img) {
  state.selected = img || null; renderTray(); renderDesignHud();
  if (!img) { preview.setTexture(null); return; }
  try {
    const tex = await stamps.texture(img);
    if (state.selected === img) preview.setTexture(tex);
  } catch { stamps.textures.delete(img.id); toast(S.designLoadFailed); }
}

// Byt till nästa (R) eller förra (F) uppladdade design, runt i en ring (efter den sista kommer den första).
function nextDesign() { return stepDesign(1); }
function prevDesign() { return stepDesign(-1); }
function stepDesign(dir) {
  const list = designs();
  if (!list.length) { toast(S.uploadFirst); return null; }
  const i = list.findIndex((d) => d.id === state.selected?.id);
  const next = list[i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length];
  select(next);
  if (list.length === 1) toast(S.onlyOneDesign);
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
  if (ids.some((id) => state.favs.has(id))) ids.forEach((id) => { state.favs = setFav(id, false); });
  if (!state.selected || ids.includes(state.selected.id)) select(last(state.mine));
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
      if (fresh.id !== img.id) { await saveBlob(fresh.id, blob); deleteBlob(img.id); state.favs = moveFav(img.id, fresh.id); }
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
    toast(S.designLost(lost.length), 5000);
  } else if (restored) toast(S.designRestored(restored), 3500);
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
  // Removed on purpose (an admin deleted it): gone from the palette, favourite or not, and never
  // uploaded again from the local copy. Only designs the server LOST are restored from here.
  const removed = Array.isArray(res.removed) ? res.removed : [];
  dropDesigns(checked.filter((m) => removed.includes(m.id) && !res.images[m.id]).map((m) => m.id));
  const missing = checked.filter((m) => res.missing.includes(m.id) && !removed.includes(m.id) && !res.images[m.id]);
  await handleMissing(missing);
}

// Största klibban: längsta sidan får vara högst väggens höjd (även bredden, eftersom
// klibban kan vridas så att bredden blir höjd). Storleken = klibbans längsta sida.
// Free version: at most 1 m. Bigger (up to the wall height) is the full version's bigStickers.
const WALL_MAX_CM = Math.floor(wallHeight(room.surfaces) * 100 + 1e-6);
const FREE_MAX_CM = Math.min(100, WALL_MAX_CM);
const maxSizeCm = () => (entitlements.full.bigStickers ? WALL_MAX_CM : FREE_MAX_CM);
function applySizeLimit() {
  $('size').max = String(maxSizeCm());
  if (state.size * 100 > maxSizeCm()) { $('size').value = maxSizeCm(); $('size').oninput({ target: $('size') }); }
}
$('size').oninput = (e) => { state.size = e.target.value / 100; $('size-val').textContent = `${e.target.value} cm`; };
$('rot').oninput = (e) => { state.rotation = Number(e.target.value); $('rot-val').textContent = `${e.target.value}°`; };
applySizeLimit();
$('jitter').onchange = (e) => { state.jitter = e.target.checked; };
$('artist').value = state.artist;
$('artist').oninput = (e) => { state.artist = e.target.value.trim(); localStorage.setItem('klibb.artist', state.artist); };
// Din länk: @namn blir Instagram, annars en https-länk. Fel länk sparas inte på klibborna.
function showLinkMsg(raw) {
  const msg = $('artist-link-msg');
  msg.classList.toggle('bad', !!raw.trim() && !state.artistLink);
  msg.textContent = !raw.trim() ? S.artistLinkHint : state.artistLink ? S.artistLinkOk(linkLabel(state.artistLink)) : S.artistLinkBad;
}
$('artist-link').value = localStorage.getItem('klibb.artistLink') || '';
showLinkMsg($('artist-link').value);
$('artist-link').oninput = (e) => {
  const raw = e.target.value; state.artistLink = cleanArtistLink(raw);
  localStorage.setItem('klibb.artistLink', raw.trim()); showLinkMsg(raw);
};
let maxToastAt = 0;
function setSize(cm) {
  const want = Math.round(cm);
  const max = maxSizeCm();
  cm = THREE.MathUtils.clamp(want, 5, max);
  if (want > max && performance.now() - maxToastAt > 1500) {
    maxToastAt = performance.now();
    toast(S.maxSize((max / 100).toLocaleString(LOCALE), max === WALL_MAX_CM), 1500);
  }
  $('size').value = cm; $('size').oninput({ target: $('size') });
}
function setRot(deg) { deg = ((deg + 540) % 360) - 180; $('rot').value = deg; $('rot').oninput({ target: $('rot') }); }

// Bilden krymps i webbläsaren om den är stor, så uppladdningen går fort även på mobilen.
// Decode an image file: createImageBitmap where it can (Safari < 15 has none, and some Safaris
// can't decode WebP from a Blob with it), otherwise an <img> from an object URL.
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try { const b = await createImageBitmap(file); return { src: b, w: b.width, h: b.height }; } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.decoding = 'async'; img.src = url;
    await (img.decode ? img.decode() : new Promise((ok, no) => { img.onload = ok; img.onerror = no; }));
    return { src: img, w: img.naturalWidth, h: img.naturalHeight };
  } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
}
const toBlob = (c, type, q) => new Promise((r) => { try { c.toBlob(r, type, q); } catch { r(null); } });
async function shrink(file) {
  let im;
  try { im = await decodeImage(file); } catch { im = null; }
  if (!im || !im.w || !im.h) { if (file.size <= 5 * 1024 * 1024) return file; throw new Error(S.fileType); } // the server decodes it
  const scale = Math.min(1, 1024 / Math.max(im.w, im.h));
  if (scale === 1 && file.size <= 5 * 1024 * 1024) return file;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(im.w * scale)); c.height = Math.max(1, Math.round(im.h * scale));
  c.getContext('2d').drawImage(im.src, 0, 0, c.width, c.height);
  const blob = await toBlob(c, 'image/webp', 0.92); // Safari < 16 can't encode WebP: it hands back a PNG
  return blob && blob.type === 'image/webp' ? blob : (await toBlob(c, 'image/png')) || file;
}
// Some browsers (Safari with odd files, drag-ins) leave file.type empty: go by the extension then.
function fileKind(file) {
  if (/^image\/(png|jpeg|webp)$/.test(file.type)) return file.type;
  if (file.type) return null;
  const ext = (/\.([a-z0-9]+)$/i.exec(file.name || '') || [])[1]?.toLowerCase();
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[ext] || null;
}

// The upload button is a <label> around a visually hidden file input. Nothing here may touch
// pointer lock: the click has to stay a plain label click so the browser (Safari!) opens the chooser.
async function onFilePicked(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    if (!fileKind(file)) return toast(S.fileType);
    if (file.size > 20 * 1024 * 1024) return toast(S.fileTooBig);
    toast(S.uploading, 10000);
    const blob = await shrink(file);
    const img = await api.uploadSticker(blob, state.artist);
    try { await saveBlob(img.id, blob); } catch { /* local copy is a nice-to-have (private mode Safari) */ }
    state.mine = addMine(img);
    await select(img);
    toast(isTouch ? S.uploadedTouch : S.uploadedDesktop);
  } catch (err) { toast(err && err.message ? err.message : S.uploadFailed); } finally {
    input.value = ''; // so picking the same file again fires 'change' again
  }
}
$('file').addEventListener('change', (e) => onFilePicked(e.currentTarget));

// ---------- Stämpla ----------
// Siktet: i förstapersonsläget från ögonen, i tredjepersonsvy från kameran bakom gubben, genom
// samma punkt på skärmen (siktet). Strålen räknas då först från gubben och framåt, så man inte
// stämplar på något mellan kameran och gubben. Räckvidden är densamma som förut: rummet.
// var: frame() och setView() kan köras innan raden här (via setMode längre upp).
var view = loadView(); // eslint-disable-line no-var
const third = () => view === 'third' && !camView;
function aimRay(ndc) {
  const cam = third() ? tpCam : camera;
  cam.updateMatrixWorld();
  raycaster.setFromCamera(ndc, cam);
  raycaster.near = cam === tpCam ? aimNear(cam.position, raycaster.ray.direction, camera.position) : 0;
  raycaster.far = Infinity;
  return raycaster;
}
function hitSurface(ndc) {
  aimRay(ndc);
  const hit = raycaster.intersectObjects(room.surfaces, false)[0];
  if (!hit) return null;
  const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  if (normal.dot(raycaster.ray.direction) > 0) normal.negate();
  return { point: hit.point, normal, surface: hit.object.name, dir: raycaster.ray.direction.clone() };
}

let pendingJitter = 0;
function nextRotation() { return state.rotation + (state.jitter ? pendingJitter : 0); }

async function stampAt(ndc) {
  if (!state.selected) { toast(S.pickFirst); return null; }
  const h = hitSurface(ndc); if (!h) return null;
  if (outOfReach(h.point)) { tooFar(h); return null; } // peels på: för långt bort
  const q = StampLayer.orientation(h.normal, h.dir, nextRotation());
  const slapSize = Math.min(state.size, maxSizeCm() / 100);
  // På golvet: ligger den nya klibban mest på baksidespapper fastnar den inte (servern kollar samma sak).
  if (peelLayer.on && peelLayer.count && onFloor(h.surface, h.normal.toArray())) {
    const frac = await peelLayer.overlap(state.selected, { position: h.point.toArray(), quaternion: q.toArray(), size: slapSize });
    if (frac > PEEL.refuseOverlap) { nope(); return null; }
  }
  pendingJitter = (Math.random() - 0.5) * 30;
  // Min gubbe slår handen mot väggen i samma bildruta som klibban syns (bara i tredjepersonsvy).
  together.selfGesture('slap', h.point, h.normal);
  // Kom ihåg exakt vilken design som stämplas: användaren kan hinna trycka R innan svaret kommer.
  const design = state.selected;
  sound.play('slap'); // direkt, utan att vänta på servern: det ska kännas som en riktig klibba
  const nonce = Math.random().toString(36).slice(2, 12);
  myNonces.add(nonce); setTimeout(() => myNonces.delete(nonce), 60_000);
  const body = { nonce, owner: deviceId(), ...(together.net.id ? { by: together.net.id } : {}), // by: så de andra ser min gubbe slappa
    imageId: design.id,
    position: h.point.toArray(), normal: h.normal.toArray(), quaternion: q.toArray(),
    size: slapSize, rotation: state.rotation, surface: h.surface, artist: state.artist,
    peelFrom: { p: [camera.position.x, camera.position.z], yaw: controls.yaw }, // var baksidespappret föds (peels)
    ...(state.artistLink ? { artistLink: state.artistLink } : {}),
  };
  // Klibban syns direkt (med ett tillfälligt id) och byts till serverns stämpel när svaret
  // kommer, via HTTP-svaret eller WebSocket, det som kommer först. Går det fel tas den bort.
  const tempId = 'tmp-' + nonce;
  const temp = { ...body, id: tempId, order: stamps.topOrder() + 1, createdAt: new Date().toISOString(), pending: true };
  delete temp.owner; delete temp.nonce; delete temp.by; delete temp.peelFrom;
  // Peels på: pappret börjar falla direkt (samma bana som servern räknar ut, seed = nonce).
  const tempPeel = 'tmp-' + nonce;
  if (peelLayer.on) {
    const [pw, ph] = stampDims(design, slapSize);
    peelLayer.add({ id: tempPeel, imageId: design.id, w: pw, h: ph, seed: nonce, ...peelPlan(nonce, { x: camera.position.x, z: camera.position.z, yaw: controls.yaw }, body.position) }, design, { animate: true, by: 'me' });
  }
  let settle; const settled = new Promise((r) => { settle = r; });
  pendingSlaps.set(nonce, { tempId, image: design, peel: false, settled });
  stamps.add(temp, design).then(updateCount);
  if (peelLayer.on) together.flushMove(); // servern mäter räckvidden från där den senast hörde att jag stod
  try {
    let res;
    try { res = await api.addStamp(ROOM, body); } catch (err) {
      if (!err.gone) throw err;
      if (err.removed) { dropPending(nonce); dropDesigns([design.id]); toast(err.message); return null; } // removed on purpose: don't bring it back
      // Servern har tappat just den här designen: ladda upp den igen och stämpla en gång till.
      const fresh = await restoreDesign(design).catch(() => undefined);
      if (!fresh) { dropPending(nonce); if (fresh === null) await handleMissing([design]); else toast(S.slapFailed); return null; }
      res = await api.addStamp(ROOM, { ...body, imageId: fresh.id });
    }
    endShown = false; // ny klibba: nästa gång man peelar förbi slutet visas rutan igen
    if (res.peelToken) {
      addHistory({ room: ROOM, stampId: res.stamp.id, token: res.peelToken, designId: res.image.id, url: res.image.url, time: res.stamp.createdAt || new Date().toISOString() });
    }
    confirmSlap(nonce, res.stamp, res.image); updateCount(); renderHistory();
    if (res.peel) { if (!peelLayer.confirm(tempPeel, res.peel)) peelLayer.add(res.peel, res.image, { animate: true, by: 'me' }); } else peelLayer.remove([tempPeel]);
    // Peelad (↩/Z) innan servern hann svara: peela den riktiga nu, tyst (den är redan borta på skärmen).
    if (peelWhenSaved.delete(res.stamp.id)) {
      const h = roomHistory(ROOM).find((x) => x.stampId === res.stamp.id);
      if (h) startPeel([h], { quiet: true });
    }
    return res.stamp;
  } catch (err) {
    dropPending(nonce); peelLayer.remove([tempPeel]);
    if (err.tooFar) tooFar(); else if (err.nope) nope(); else toast(err.message);
    return null;
  } finally { settle(); }
}
// Väntande klibbor: nonce -> { tempId, image }
const pendingSlaps = new Map();
const peelWhenSaved = new Set(); // serverns id för klibbor som peelades medan de väntade
function confirmSlap(nonce, stamp, image) {
  const p = pendingSlaps.get(nonce);
  if (!p) { if (!peelWhenSaved.has(stamp.id)) stamps.add(stamp, image).then(updateCount); return; }
  pendingSlaps.delete(nonce);
  if (p.peel) { stamps.gone.add(p.tempId); stamps.gone.add(stamp.id); peelWhenSaved.add(stamp.id); return; }
  if (!stamps.confirm(p.tempId, stamp, image)) stamps.add(stamp, image).then(updateCount);
}
function dropPending(nonce) {
  const p = pendingSlaps.get(nonce);
  if (!p) return;
  pendingSlaps.delete(nonce); stamps.remove(p.tempId); updateCount();
}

// ---------- Admin (dold): öppna sidan med ?admin=NYCKEL ----------
async function initAdmin() {
  if (params.has('admin')) {
    const t = params.get('admin') || prompt(S.adminPrompt) || '';
    sessionStorage.setItem('klibb.admin', t);
    params.delete('admin');
    history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : ''));
  }
  const token = sessionStorage.getItem('klibb.admin');
  if (!token) return;
  const { ok } = await api.checkAdmin(token).catch(() => ({ ok: false }));
  if (!ok) { sessionStorage.removeItem('klibb.admin'); toast(S.adminWrong); return; }
  state.adminToken = token;
  $('admin-banner').hidden = false;
  updateStyleUi(); renderRecs();
}

function adminPick(ndc) {
  aimRay(ndc);
  const picked = stamps.pick(raycaster);
  if (!picked) { toast(S.noStickerThere); return; }
  controls.unlock();
  const { stamp, image } = picked;
  $('admin-info').textContent = S.adminInfo(stamp.order, stamp.artist, new Date(stamp.createdAt).toLocaleString(LOCALE));
  $('admin-img').src = image.url;
  const dlg = $('admin-dialog');
  $('admin-del-stamp').onclick = async () => {
    await api.deleteStamp(ROOM, stamp.id, state.adminToken); stamps.remove(stamp.id); updateCount(); dlg.close(); toast(S.adminDeleted);
  };
  $('admin-del-image').onclick = async () => {
    if (!confirm(S.adminConfirmImage)) return;
    const r = await api.deleteImage(image.id, state.adminToken); stamps.removeImage(image.id); updateCount(); dlg.close();
    toast(S.adminImageDeleted(r.removedStamps));
  };
  $('admin-cancel').onclick = () => dlg.close();
  dlg.showModal();
}

function action(ndc) {
  if (state.mode === 'view') return null; // Tittläge: klick och tryck gör ingenting
  if (sp.open || together.busy()) return null; // en panel är öppen: titta, men stämpla inte
  if (camView) return null; // tittar genom en kamera
  return state.adminToken ? adminPick(ndc) : stampAt(ndc);
}

// ---------- Klibbläge / Tittläge (V, eller ögat på mobilen) ----------
// Tittläge: ingen pekare och inget sikte, klick stämplar inte, scroll och Q/E gör ingenting.
// R byter fortfarande design (man stannar i Tittläge), så man kan förbereda nästa klibba.
function setMode(mode, { quiet = false } = {}) {
  state.mode = mode === 'view' ? 'view' : 'slap';
  const view = state.mode === 'view';
  document.body.classList.toggle('view-mode', view);
  if (view) preview.hide(); else hideCredit();
  cams.setVisible(!view && camShow);
  $('mode-hud').textContent = S.modeHud(view, isTouch);
  $('mode-btn').setAttribute('aria-pressed', String(view));
  $('mode-btn').title = view ? S.modeBtnToSlap : S.modeBtnToLook;
  $('mode-slap').setAttribute('aria-pressed', String(!view)); $('mode-look').setAttribute('aria-pressed', String(view));
  if (!quiet) toast(view ? S.modeToastLook(isTouch) : S.modeToastSlap(isTouch), 1600);
  return state.mode;
}
const toggleMode = () => setMode(state.mode === 'view' ? 'slap' : 'view');
// var: setMode längre ner använder den innan raden här har körts.
var camShow = localStorage.getItem('klibb.camShow') !== '0'; // eslint-disable-line no-var
setMode('slap', { quiet: true });
$('mode-btn').onclick = (e) => { e.preventDefault(); toggleMode(); };
$('mode-slap').onclick = () => { if (state.mode !== 'slap') setMode('slap'); };
$('mode-look').onclick = () => { if (state.mode !== 'view') setMode('view'); };

// ---------- Peel (ångra) och historik ----------
// Peel tar bort en av MINA stämplar: servern kräver den hemliga nyckeln som bara den här
// enheten fick när stämpeln sattes. Upprepade peel går bakåt i historiken. Bara de senaste
// 20 i rummet går att peela (history.js och servern).
//
// Snabbt och jämnt även när man trycker Z/↩ så fort man kan: klibban peelas på skärmen DIREKT
// (med ljud), och anropen till servern slås ihop. Det går högst ett anrop åt gången; allt som
// hunnit peelas under tiden skickas i nästa anrop, i en klump. Tidigare väntade varje tryck på
// sitt eget anrop + animationen i en kö, så 40 snabba tryck blev 40 anrop i rad (många sekunder
// efter att man slutat trycka), och servern svarade "för många" efter 60 i minuten.
const peeling = new Map(); // stampId -> historikpost: peelad på skärmen, servern har inte svarat än
let peelOutbox = []; // väntar på att skickas
let peelInFlight = null;
const peelable = () => roomHistory(ROOM).filter((h) => !peeling.has(h.stampId));

// Peela de här posterna direkt på skärmen och skicka dem till servern. Returnerar antal.
function startPeel(entries, { quiet = false } = {}) {
  const fresh = entries.filter((h) => !peeling.has(h.stampId));
  if (!fresh.length) return 0;
  peelGesture(fresh[0].stampId);
  for (const h of fresh) {
    peeling.set(h.stampId, h);
    // Servern skickar ut "borttagen" till alla, även mig: det ska inte låta som någon annans peel.
    myPeels.add(h.stampId); setTimeout(() => myPeels.delete(h.stampId), 60_000);
    stamps.highlight(h.stampId, false);
    stamps.peelAway(h.stampId);
  }
  peelOutbox.push(...fresh);
  if (!quiet) sound.play('peel');
  updateCount(); scheduleHistory();
  flushPeels();
  return fresh.length;
}
// Min gubbe griper klibban och drar bort den (tredjepersonsvy).
function peelGesture(id) {
  const st = stamps.meshes.get(id)?.userData.stamp;
  if (st) together.selfGesture('peel', st.position, st.normal);
}
function flushPeels() {
  if (peelInFlight) return peelInFlight;
  if (!peelOutbox.length) return Promise.resolve();
  const batch = peelOutbox.splice(0, 200);
  peelInFlight = (async () => {
    let results = null;
    try { ({ results } = await api.peel(ROOM, batch.map((h) => ({ id: h.stampId, token: h.token })), together.net.id)); } catch (err) {
      toast(err.status === 429 ? S.slowDown : S.peelFailed);
    }
    // ok = borta. notfound = fanns redan inte. forbidden = nyckeln gäller inte längre (för gammal):
    // den finns kvar i rummet. Ett fel (nätet, för många): de finns kvar, och kan peelas igen.
    if (results) removeHistory(batch.filter((h) => results[h.stampId]).map((h) => h.stampId));
    const back = batch.filter((h) => !results || results[h.stampId] === 'forbidden');
    for (const h of batch) peeling.delete(h.stampId);
    if (back.length) { for (const h of back) stamps.gone.delete(h.stampId); await resyncRoom(); }
    updateCount(); scheduleHistory();
    peelInFlight = null;
    return flushPeels();
  })();
  return peelInFlight;
}
// Vänta tills allt som peelats har bekräftats av servern.
async function peelSettled() { while (peelInFlight || peelOutbox.length) await flushPeels(); }

function peelLast() {
  // Den senaste klibban väntar fortfarande på servern: peela den direkt på skärmen, och på
  // riktigt så fort servern har svarat (annars skulle ↩ ta klibban före).
  const pend = last([...pendingSlaps.values()].filter((p) => !p.peel));
  if (pend) {
    pend.peel = true;
    peelGesture(pend.tempId);
    stamps.peelAway(pend.tempId).then(updateCount);
    sound.play('peel'); toast(S.peeled, 900);
    return pend.settled.then(() => peelSettled()).then(() => true);
  }
  const list = peelable();
  // Helst en som syns i rummet (gamla poster som redan är borta städas bort av servern).
  const next = list.find((h) => stamps.meshes.has(h.stampId)) || list[0];
  if (!next) { endOfHistory(); return Promise.resolve(false); }
  startPeel([next]); toast(S.peeled, 900);
  return peelSettled().then(() => true);
}

function peelAll() {
  const all = peelable();
  if (!all.length) { toast(S.nothingToPeel); return Promise.resolve(0); }
  const n = startPeel(all);
  toast(S.peeledN(n));
  return peelSettled().then(() => n);
}

// ---------- "End of slap history" ----------
// Peelar man förbi slutet visas en liten ruta EN gång (inte om och om igen när man håller in Z).
// Skaparen/admin får frågan om att nollställa rummet, alla andra om att starta ett eget rum.
// Efter att man stängt den räcker en liten notis, tills man har satt en ny klibba.
let endShown = false, endShows = 0;
const endDlg = $('end-dialog');
function endOfHistory() {
  if (endDlg.open) return;
  if (endShown) { toast(S.endTitle, 1200); return; }
  endShown = true; endShows++;
  const reset = canEditStyle();
  $('end-q').textContent = reset ? S.endResetQ : S.endFreshQ;
  $('end-text').textContent = reset ? S.endResetText : S.endFreshText;
  const act = $('end-action');
  act.textContent = reset ? S.resetRoom : S.newRoomShort;
  act.className = reset ? 'danger' : '';
  act.dataset.kind = reset ? 'reset' : 'new';
  controls.unlock(); preview.hide(); closeMore();
  endDlg.showModal();
  $('end-keep').focus();
}
$('end-keep').onclick = () => endDlg.close();
$('end-action').onclick = async () => {
  const b = $('end-action');
  if (b.dataset.kind === 'new') { endDlg.close(); openStylePanel('create'); return; }
  b.disabled = true;
  try {
    await api.resetRoom(ROOM, together.me().shownAs || together.me().name, auth());
    endDlg.close();
  } catch (err) { toast(err.message || S.resetFailed, 3000); } finally { b.disabled = false; }
};
// Någon (skaparen eller admin) nollställde rummet: alla klibbor bort, för alla.
function onRoomReset(e) {
  for (const id of [...stamps.meshes.keys()]) stamps.remove(id);
  const mine = readHistory().filter((h) => h.room === ROOM).map((h) => h.stampId);
  if (mine.length) removeHistory(mine);
  sound.play('peel');
  together.sys(S.roomReset(String(e.by || '').slice(0, 24) || '?'));
  updateCount(); scheduleHistory();
}

// Historiklistan ritas om högst en gång per bildruta, hur många peel det än blir.
let historyRaf = 0;
function scheduleHistory() { if (!historyRaf) historyRaf = requestAnimationFrame(() => { historyRaf = 0; renderHistory(); }); }

function fmtTime(iso) {
  const d = new Date(iso), now = new Date();
  const t = d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? t : `${d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })} ${t}`;
}
function renderHistory() {
  const list = peelable();
  const ul = $('history-list'); ul.innerHTML = '';
  $('history-count').textContent = list.length ? String(list.length) : '';
  $('peel-last').disabled = $('peel-all').disabled = !list.length;
  for (const h of list) {
    const li = document.createElement('li');
    li.dataset.id = h.stampId;
    li.title = S.historyItemTitle;
    li.innerHTML = `<img alt="" src="${h.url || ''}"><span class="t">${fmtTime(h.time)}</span><button type="button" title="${S.peelThis}" aria-label="${S.peelThisAria}">✕</button>`;
    const hl = (on) => { li.classList.toggle('hl', on); stamps.highlight(h.stampId, on); };
    li.onmouseenter = () => hl(true);
    li.onmouseleave = () => hl(false);
    li.onclick = (e) => { if (e.target.closest('button')) return; hl(true); setTimeout(() => hl(false), 1200); };
    li.querySelector('button').onclick = () => { hl(false); if (startPeel([h])) toast(S.peeled, 900); };
    ul.appendChild(li);
  }
}
// "Peela alla" kräver två tryck: första gången frågar knappen "Säker?".
let peelAllTimer;
$('peel-all').onclick = () => {
  const b = $('peel-all');
  if (!b.classList.contains('confirm')) {
    b.classList.add('confirm'); b.textContent = S.peelAllConfirm(peelable().length);
    clearTimeout(peelAllTimer);
    peelAllTimer = setTimeout(() => { b.classList.remove('confirm'); b.textContent = S.peelAll; }, 4000);
    return;
  }
  clearTimeout(peelAllTimer); b.classList.remove('confirm'); b.textContent = S.peelAll;
  peelAll();
};
$('peel-last').onclick = () => peelLast();
$('peel-btn').onclick = (e) => { e.preventDefault(); peelLast(); };
addEventListener('storage', (e) => { if (e.key === HISTORY_KEY) scheduleHistory(); });
trimHistory(); // äldre listor kan ha fler än 20 per rum
$('history-limit').textContent = S.historyLimit(PER_ROOM);
// Efter att rummet laddats: glöm stämplar som inte finns kvar på servern (raderade, städade).
function pruneHistory(stampIds) {
  const alive = new Set(stampIds);
  const dead = readHistory().filter((h) => h.room === ROOM && !alive.has(h.stampId)).map((h) => h.stampId);
  if (dead.length) removeHistory(dead);
  renderHistory();
}

// ---------- Vem gjorde klibban? (Tittläge) ----------
// Look mode: CLICK (desktop, the dot on a sticker) or TAP (phone) a sticker to show the artist's name
// and link. Clicking another sticker switches to that one; clicking empty wall, Esc or leaving Look
// mode hides it. No hover trigger. Desktop: L, or clicking the same sticker again, opens the link
// (after a small dialog showing the address); on the phone the link itself is tappable.
// Klibbor utan namn och länk visar ingenting. Länken tvättas igen här (servern har redan gjort det).
// var: setMode längre upp (hideCredit) kan köras innan den här raden.
var credit = { id: null, shown: null, timer: 0 }; // eslint-disable-line no-var
function creditOf(stamp) {
  const name = cleanArtistName(stamp?.artist), link = cleanArtistLink(stamp?.artistLink || '');
  return name || link ? { id: stamp.id, name, link } : null;
}
function pickStampAt(ndc) {
  aimRay(ndc);
  const p = stamps.pick(raycaster);
  if (!p) return null;
  // Står en vägg/golv närmare än klibban (klibban på andra sidan)? Då syns den inte.
  const wall = raycaster.intersectObjects(room.surfaces, false)[0];
  if (wall && wall.distance + 0.05 < p.distance) return null;
  return p;
}
function showCredit(c, at = null) {
  const el = $('credit');
  $('credit-name').textContent = c.name;
  const a = $('credit-link');
  if (c.link) { a.href = c.link; a.textContent = linkLabel(c.link); } else { a.removeAttribute('href'); a.textContent = ''; }
  $('credit-hint').textContent = c.link ? (at ? S.creditOpenTap : S.creditOpenKey) : '';
  el.classList.toggle('tap', !!at);
  el.hidden = false;
  if (at) {
    const r = el.getBoundingClientRect();
    el.style.left = Math.max(12, Math.min(innerWidth - r.width - 12, at.x + 12)) + 'px';
    el.style.top = Math.max(12, Math.min(innerHeight - r.height - 12, at.y - r.height - 14)) + 'px';
    clearTimeout(credit.timer); credit.timer = setTimeout(hideCredit, 6000);
  } else { el.style.left = ''; el.style.top = ''; }
  credit.shown = c;
}
function hideCredit() {
  if (!credit) return; // innan raden ovan har körts
  clearTimeout(credit.timer);
  if (credit.shown) $('credit').hidden = true;
  credit.shown = null; credit.id = null;
}
// The credit only lives in Look mode with the mouse locked (desktop): anything else hides it.
function updateCredit() {
  if (isTouch || !credit.shown) return;
  if (!(controls.locked && state.mode === 'view' && !camView && !sp.open)) hideCredit();
}
// Desktop click in Look mode: the sticker under the dot shows its credit (or switches to it);
// the same sticker again opens its link; empty wall (or a sticker without a name/link) hides it.
function clickCredit() {
  if (camView || sp.open) return;
  const c = creditOf(pickStampAt(CENTER)?.stamp);
  if (!c) { hideCredit(); return; }
  if (credit.shown && credit.shown.id === c.id) { if (c.link) openLink(c.link); return; }
  showCredit(c); credit.id = c.id;
}
const linkDlg = $('link-dialog');
function openLink(url) {
  url = cleanArtistLink(url); if (!url) return false;
  controls.unlock(); hideCredit();
  $('link-url').textContent = url;
  $('link-open').href = url;
  linkDlg.showModal();
  return true;
}
$('link-cancel').onclick = () => linkDlg.close();
$('link-open').onclick = () => setTimeout(() => linkDlg.close(), 0); // länken öppnas i en ny flik (rel=noopener)
$('credit-link').addEventListener('click', () => setTimeout(hideCredit, 0));

// ---------- Inmatning ----------
const CENTER = new THREE.Vector2(0, 0);
$('enter').onclick = () => controls.lock();

// ---------- Esc toggles: game ⇄ menu (desktop) ----------
// In the game, Esc is the browser's own "leave pointer lock" (→ the menu). In the menu, Esc
// closes the topmost open thing first (dialog, chat, Sound settings, My avatar, room look,
// ⚙ More, Room ▾); on the plain menu it goes back into the game.
// Browser limits: Esc is not a "user activation" key, and Chrome refuses a new pointer lock for
// ~1 s after the user left it with Esc. So we try, and if the lock doesn't come we still leave
// the menu and show "Click to enter" – the next click locks (no errors, no toasts).
var escGate = { unlockedAt: -1e9 }; // eslint-disable-line no-var
let resuming = false;
function setResuming(on) {
  resuming = !!on;
  document.body.classList.toggle('resuming', resuming);
  $('resume-hint').hidden = !resuming;
}
function tryLock() {
  try {
    const r = controls.canvas.requestPointerLock?.();
    if (r && typeof r.catch === 'function') r.catch(() => {}); // refused: the hint stays, quietly
  } catch { /* old browsers: same */ }
}
document.addEventListener('pointerlockerror', () => {}, { passive: true }); // handled by the hint
function resumeGame() { setResuming(true); tryLock(); }
// The topmost thing Esc should close, or null.
function escTarget() {
  if (camView) return () => exitCamView();
  if (!$('sound-panel').hidden) return () => soundUi.close();
  if (!$('avatar-panel').hidden) return () => $('av-cancel').click();
  if (sp.open) return () => closeStylePanel(true);
  if (!$('more-panel').hidden) return () => closeMore();
  if (!$('room-menu').hidden) return () => closeRoomMenu();
  if (credit.id) return () => hideCredit();
  return null;
}
function onEscape(e) {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  if (endDlg.open || linkDlg.open) return;          // <dialog> closes itself on Esc
  if (together.chatOpen()) return;                   // the chat input closes itself (together.js)
  if (isTyping(e)) { e.target.blur(); return; }      // first Esc just leaves the text field
  const close = escTarget();
  if (close) { e.preventDefault(); close(); return; }
  if (isTouch) return;
  if (controls.locked) return;                       // the browser handles this one (→ menu)
  if (e.repeat || performance.now() - escGate.unlockedAt < 500) return; // the Esc that opened the menu
  e.preventDefault();
  if (resuming) setResuming(false); else resumeGame();
}
addEventListener('keydown', onEscape);
controls.onLockChange = (locked) => {
  if (!locked) escGate.unlockedAt = performance.now();
  if (locked) setResuming(false);
  document.body.classList.toggle('locked', locked);
  if (locked) { closeMore(); closeRoomMenu(); }
  $('crosshair').hidden = !locked;
  if (!locked) { preview.hide(); hideCredit(); } // Esc (leaving the room) hides the artist credit
};

if (!isTouch) {
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (sp.open || together.busy()) return; // panelen för rummets utseende eller Min gubbe är öppen
    if (together.chatOpen()) { together.closeChat(); if (!controls.locked) controls.lock(); return; } // klick = stäng chatten, stämpla inte
    if (!controls.locked) controls.lock();
    else if (state.mode === 'view') clickCredit(); // Look mode: click a sticker = who made it? (never slaps)
    else action(CENTER);
  });
  addEventListener('wheel', (e) => { if (controls.locked && state.mode === 'slap') setSize(state.size * 100 * (e.deltaY > 0 ? 0.9 : 1.1)); }, { passive: true });
  addEventListener('keydown', (e) => {
    if (isTyping(e)) return; // inte medan man skriver
    if (endDlg.open || linkDlg.open) return; // rutan "End of slap history" eller länkfrågan är öppen
    // Z eller Ctrl+Z / Cmd+Z = peela senaste (i både Klibbläge och Tittläge)
    if ((e.key === 'z' || e.key === 'Z' || e.code === 'KeyZ') && !e.altKey && !e.shiftKey) {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
      if (!e.repeat) peelLast();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return; // inte Ctrl+V osv.
    if (e.code === 'KeyV' && !e.repeat) toggleMode();
    if (e.code === 'KeyM' && !e.repeat) setMuted(!sound.muted);
    if (e.code === 'KeyC' && !e.repeat) toggleView();
    if (e.code === 'KeyL' && !e.repeat && credit.shown?.link) openLink(credit.shown.link);
    if (state.mode === 'slap' && e.code === 'KeyQ') setRot(state.rotation - 15);
    if (state.mode === 'slap' && e.code === 'KeyE') setRot(state.rotation + 15);
    if (e.code === 'KeyR' && !e.repeat && !e.ctrlKey && !e.metaKey) nextDesign();
    if (e.code === 'KeyF' && !e.repeat && !e.ctrlKey && !e.metaKey) prevDesign(); // F = förra designen (spegel av R)
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
      const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      if (state.mode === 'view' && !camView) {
        // Tittläge: tryck på en klibba = vem gjorde den?
        const c = creditOf(pickStampAt(ndc)?.stamp);
        if (c) { showCredit(c, { x: e.clientX, y: e.clientY }); credit.id = c.id; } else hideCredit();
      } else { hideCredit(); action(ndc); }
    }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  $('design-btn').onclick = (e) => { e.preventDefault(); nextDesign(); };
  $('panel-toggle').onclick = () => {
    const hidden = $('panel').classList.toggle('hidden');
    if (hidden) closeMore();
    $('panel-toggle').setAttribute('aria-expanded', String(!hidden));
  };
}

// ---------- Rum: typ, nytt snabbrum, dela länk, till Staden ----------
const TYPE_NAMES = S.roomTypes;
function roomUrl(id) { return `${location.origin}/${id === 'stad' ? '' : '?room=' + id}`; }
function showRoomInfo(info) {
  const type = info?.type || (ROOM === 'stad' ? 'stad' : 'quick');
  const badge = $('room-type');
  badge.textContent = TYPE_NAMES[type] || type;
  badge.className = 'badge ' + type;
  $('to-stad').hidden = ROOM === 'stad';
  $('room-note').textContent = type === 'quick'
    ? S.roomNoteQuick(info?.quickTtlHours ?? 24)
    : type === 'profile' ? S.roomNoteProfile(info.owner?.name) : '';
  $('room-hud').textContent = S.roomHud(type, ROOM);
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
  $('rec-box').hidden = !canEditStyle();
  updatePeelUi();
  const s = currentStyle;
  $('room-style').textContent = S.roomStyleLine(styleName(s), s.seed);
}
// Peels-knappen i Room ▾: bara för den som får ändra rummet (skaparen eller admin).
function updatePeelUi() {
  const box = document.getElementById('peels-box'); if (!box) return;
  box.hidden = !canEditStyle();
  $('peels-on').checked = peelLayer.on;
  $('peels-clear').hidden = !peelLayer.on;
}
$('peels-on').onchange = async (e) => {
  const on = e.target.checked;
  try {
    await api.setPeels(ROOM, on, { key: roomKeys()[ROOM], admin: state.adminToken });
    peelLayer.setOn(on);
    if (on) { const r = await api.loadRoom(ROOM); syncPeels(r.info, r.peels, r.images); }
    toast(on ? S.peelsOnToast : S.peelsOffToast, 1800);
  } catch (err) { e.target.checked = !on; toast(err.message); }
  updatePeelUi();
};
$('peels-clear').onclick = async () => {
  try { await api.clearPeels(ROOM, { key: roomKeys()[ROOM], admin: state.adminToken }); peelLayer.clear(); toast(S.peelsCleared, 1500); } catch (err) { toast(err.message); }
};
async function showStyle(s) {
  sound.setRoom(s); // the room's materials give a subtle, automatic acoustic (free, no UI)
  try { return await applyStyle(room.surfaces, s); } catch { toast(S.texturesFailed); return null; }
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
  $('style-title').textContent = mode === 'create' ? S.styleCreateTitle : S.styleEditTitle;
  $('style-ok').textContent = mode === 'create' ? S.styleCreateOk : S.styleEditOk;
  closeMore(); closeRoomMenu();
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
    toast(S.styleSaved);
  } catch (err) { toast(err.message); } finally { b.disabled = false; }
};
$('to-stad').onclick = () => { location.href = roomUrl('stad'); };
$('share-room').onclick = async () => {
  const url = roomUrl(ROOM);
  const title = S.shareTitle(ROOM);
  if (isTouch && navigator.share) { try { await navigator.share({ title, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(url); toast(S.linkCopied(url), 3500); }
  catch { prompt(S.copyLink, url); }
};
// Säg till servern med jämna mellanrum att någon är här, så rummet inte städas bort.
setInterval(() => { if (document.visibilityState === 'visible') api.visit(ROOM).catch(() => {}); }, 10 * 60_000);

// ---------- Ladda rummet ----------
async function loadRoom() {
  try {
    const { stamps: list, images, info, cameras, peels } = await api.loadRoom(ROOM);
    showRoomInfo(info);
    peelLayer.setOn(!!info?.peels);
    for (const p of peels || []) peelLayer.add(p, images[p.imageId]);
    cams.set(cameras || []); renderCams();
    if (!sp.open) await showStyle(currentStyle);
    pruneHistory(list.map((s) => s.id));
    // allSettled: en enda trasig stämpel ska inte hindra resten av rummet från att laddas.
    await Promise.allSettled(list.map((s) => stamps.add(s, images[s.imageId])));
    updateCount();
  } catch (err) { toast(S.roomLoadFailed(err.message)); }
}

// ---------- Tillsammans: andra spelare, chatt, Min gubbe (together.js) ----------
// Händelser från servern: det andra gör i rummet syns direkt, utan att ladda om.
function onRoomEvent(e) {
  if (!e || typeof e.type !== 'string') return;
  if (e.type === 'stamp:add' && e.stamp && e.image) {
    // Någon annans klibba: ljudet kommer från där den hamnade (tystare ju längre bort).
    if (e.nonce && pendingSlaps.has(e.nonce)) { confirmSlap(e.nonce, e.stamp, e.image); updateCount(); if (e.peel) peelLayer.confirm('tmp-' + e.nonce, e.peel); return; } // min egen, redan synlig
    if (e.peel && !(e.nonce && myNonces.has(e.nonce))) peelLayer.add(e.peel, e.image, { animate: true, by: e.by }); // någon annans papper faller
    if (!(e.nonce && myNonces.has(e.nonce)) && !stamps.meshes.has(e.stamp.id)) sound.play('slap', e.stamp.position, { sound: together.voiceOf(e.by) });
    // Någon annans slap: deras gubbe slår handen mot väggen samtidigt som klibban dyker upp.
    // (by saknas från äldre klienter: då syns bara klibban, som förut.)
    if (typeof e.by === 'string' && e.by !== together.net.id && !stamps.meshes.has(e.stamp.id)) together.players.gesture(e.by, 'slap', e.stamp.position, e.stamp.normal);
    stamps.add(e.stamp, e.image).then(updateCount);
  } else if (e.type === 'stamp:remove') {
    const m = stamps.meshes.get(e.id);
    if (m && !myPeels.has(e.id)) sound.play('peel', m.userData.stamp.position, { sound: together.voiceOf(e.by) });
    if (m && typeof e.by === 'string' && e.by !== together.net.id && !myPeels.has(e.id)) together.players.gesture(e.by, 'peel', m.userData.stamp.position, m.userData.stamp.normal);
    stamps.peelAway(e.id).then(updateCount);
    if (roomHistory(ROOM).some((h) => h.stampId === e.id)) { removeHistory([e.id]); scheduleHistory(); }
  } else if (e.type === 'room:reset') onRoomReset(e);
  else if (e.type === 'image:remove') {
    stamps.removeImage(e.id); peelLayer.removeImage(e.id); updateCount();
    if (e.removed && state.mine.some((m) => m.id === e.id)) dropDesigns([e.id]); // removed on purpose: out of my palette too
  }
  else if (e.type === 'room:peels') {
    if (e.on) api.loadRoom(ROOM).then((r) => syncPeels(r.info, r.peels, r.images)).catch(() => {});
    else { peelLayer.setOn(false); updatePeelUi(); }
  } else if (e.type === 'peels:clear') peelLayer.clear();
  else if (e.type === 'room:style' && e.style) {
    currentStyle = normalizeStyle(e.style); updateStyleUi();
    if (!sp.open) { showStyle(currentStyle); toast(S.styleChanged, 1800); }
  } else if ((e.type === 'camera:add' || e.type === 'camera:update') && e.camera) { cams.upsert(e.camera); renderCams(); }
  else if (e.type === 'camera:remove') { cams.remove(e.id); if (camView === e.id) exitCamView(); renderCams(); }
  else if (e.type === 'rec:start') setRec({ recId: e.recId, startedAt: e.startedAt }, { announce: 'start' });
  else if (e.type === 'rec:stop') setRec(null, { announce: 'stop', reason: e.reason });
}
// Efter ett avbrott (t.ex. servern startade om): hämta rummet igen och visa det vi missat.
// Peels efter ett avbrott eller när någon slår på dem: lägg till det som saknas, ta bort det som sopats.
function syncPeels(info, peels = [], images = {}) {
  peelLayer.setOn(!!info?.peels); updatePeelUi();
  const alive = new Set(peels.map((p) => p.id));
  peelLayer.remove(peelLayer.info().peels.map((p) => p.id).filter((id) => !alive.has(id) && !id.startsWith('tmp-')));
  for (const p of peels) peelLayer.add(p, images[p.imageId]);
}
async function resyncRoom() {
  try {
    const { stamps: list, images, info, cameras, peels } = await api.loadRoom(ROOM);
    cams.set(cameras || []); renderCams();
    syncPeels(info, peels, images);
    const alive = new Set(list.map((s) => s.id));
    for (const id of [...stamps.meshes.keys()]) if (!alive.has(id) && !id.startsWith('tmp-')) stamps.remove(id); // väntande klibbor får vara kvar
    await Promise.allSettled(list.map((s) => stamps.add(s, images[s.imageId])));
    if (info && JSON.stringify(normalizeStyle(info.style)) !== JSON.stringify(currentStyle)) { showRoomInfo(info); if (!sp.open) showStyle(currentStyle); }
    updateCount();
  } catch { /* nästa gång */ }
}
const together = initTogether({
  room: ROOM, scene, camera, controls, isTouch, toast, artist: () => state.artist,
  onEvent: onRoomEvent, onReconnect: resyncRoom,
  onWelcome: (m) => setRec(m.rec || null, { announce: m.rec && !rec ? 'joined' : null }),
  onSound: (s) => sound.setMine(s),
});
// Full version (entitlements.js): free = calm default UI; the deep menus appear when unlocked.
const entitlementsReady = loadEntitlements().then(() => { together.entitlementsChanged(); onEntitlements(); });
function onEntitlements() { $('sound-design-btn').hidden = !entitlements.full.soundDesign; applySizeLimit(); }
// Sound settings (soundui.js): only reachable with entitlements.full.soundDesign.
const soundUi = initSoundUI({ $, sound, toast, onSave: () => together.soundChanged(), onOpenChange: (o) => { if (o) controls.unlock?.(); } });
$('sound-design-btn').onclick = () => { if (entitlements.full.soundDesign) { closeMore(); soundUi.open(); } };

// ---------- Inspelning ('sessionsinspelning') och virtuella kameror ----------
// Den som skapade rummet (rumsnyckeln) eller admin kan starta och stoppa en inspelning och
// placera kameror. Alla i rummet ser ● REC medan det spelas in, och den som kommer in under
// en inspelning får veta det direkt.
// var: setRec kan anropas av anslutningen innan raden här har körts.
var rec = null; // eslint-disable-line no-var
const auth = () => ({ key: roomKeys()[ROOM], admin: state.adminToken });
const REASONS = S.recReasons;
function setRec(status, { announce = null, reason = null } = {}) {
  rec = status;
  $('rec-badge').hidden = !rec;
  document.body.classList.toggle('recording', !!rec);
  $('rec-toggle').textContent = rec ? S.recStop : S.recStart;
  $('rec-toggle').classList.toggle('on', !!rec);
  if (announce === 'start') { together.sys(S.recStarted); toast(S.recStartedToast, 3000); }
  if (announce === 'stop') {
    together.sys(S.recStopped(REASONS[reason]));
    toast(S.recStoppedToast, 2500); if (canEditStyle()) renderRecs();
  }
  if (announce === 'joined') {
    together.sys(S.recJoined);
    const n = $('rec-notice'); n.hidden = false; clearTimeout(setRec.t); setRec.t = setTimeout(() => { n.hidden = true; }, 7000);
  }
  renderRecTime();
}
function renderRecTime() {
  const el = $('rec-time');
  if (!rec) { el.textContent = ''; return; }
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(rec.startedAt)) / 1000));
  el.textContent = `● ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
setInterval(renderRecTime, 1000);
$('rec-notice-ok').onclick = () => { $('rec-notice').hidden = true; };
$('rec-toggle').onclick = async () => {
  const b = $('rec-toggle'); b.disabled = true;
  try {
    if (rec) await api.stopRec(ROOM, auth()); else { const r = await api.startRec(ROOM, auth()); if (!rec) setRec(r.recording, { announce: null }); }
  } catch (err) { toast(err.message, 3500); } finally { b.disabled = false; }
};
const fmtLen = S.fmtLen;
async function renderRecs() {
  let list = [], videos = [];
  try { ({ recordings: list } = await api.listRecs(ROOM, auth())); } catch { return; }
  try { ({ videos } = await api.listVideos(ROOM, auth())); } catch { /* older server: no videos */ }
  $('rec-count').textContent = String(list.length);
  const ul = $('rec-list'); ul.innerHTML = '';
  for (const r of list) {
    const li = document.createElement('li');
    const a = document.createElement('a'); a.href = `/?room=${ROOM}&replay=${r.recId}`; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = `▶ ${new Date(r.startedAt).toLocaleString(LOCALE, { dateStyle: 'short', timeStyle: 'short' })} · ${fmtLen(r.durationMs)}`;
    const info = document.createElement('span'); info.className = 't';
    info.textContent = S.recItemInfo(r.participants.length, (r.bytes / 1024).toFixed(0), r.status);
    li.append(a, info);
    // Finished videos made from this recording (logo intro first), kept for VIDEO_RETENTION_DAYS.
    const mine = videos.filter((v) => v.recId === r.recId);
    if (mine.length) {
      const vl = document.createElement('ul'); vl.className = 'rec-videos';
      for (const v of mine) {
        const vli = document.createElement('li');
        const va = document.createElement('a'); va.href = v.url; va.target = '_blank'; va.rel = 'noopener'; va.className = 'rec-video';
        va.textContent = `🎞 ${new Date(v.createdAt).toLocaleString(LOCALE, { dateStyle: 'short', timeStyle: 'short' })} · ${fmtLen(v.durationMs)} · ${(v.bytes / 1e6).toFixed(1)} MB`;
        vli.appendChild(va); vl.appendChild(vli);
      }
      li.appendChild(vl);
    }
    ul.appendChild(li);
  }
  // Videos whose recording is gone (deleted) still show, last.
  for (const v of videos.filter((x) => !list.some((r) => r.recId === x.recId))) {
    const li = document.createElement('li');
    const va = document.createElement('a'); va.href = v.url; va.target = '_blank'; va.rel = 'noopener'; va.className = 'rec-video';
    va.textContent = `🎞 ${new Date(v.createdAt).toLocaleString(LOCALE, { dateStyle: 'short', timeStyle: 'short' })} · ${fmtLen(v.durationMs)}`;
    li.appendChild(va); ul.appendChild(li);
  }
}

// Kameror: "🎥 Placera kamera här" ställer en kamera där jag står, åt det håll jag tittar.
function renderCams() {
  const ul = $('cam-list'); ul.innerHTML = '';
  for (const c of cams.list()) {
    const li = document.createElement('li'); li.dataset.id = c.id;
    const name = document.createElement('input'); name.type = 'text'; name.maxLength = 24; name.value = c.name; name.className = 'cam-name'; name.setAttribute('aria-label', S.camNameAria);
    name.onchange = () => updateCam(c.id, { name: name.value });
    const fov = document.createElement('select'); fov.className = 'cam-fov'; fov.title = S.camFov;
    for (const f of new Set([...CAMERA_FOVS, c.fov])) { const o = document.createElement('option'); o.value = f; o.textContent = `${f}°`; fov.appendChild(o); }
    fov.value = String(c.fov); fov.onchange = () => updateCam(c.id, { fov: Number(fov.value) });
    const asp = document.createElement('select'); asp.className = 'cam-aspect'; asp.title = S.camAspect;
    for (const [v, t] of Object.entries(CAMERA_ASPECTS)) { const o = document.createElement('option'); o.value = v; o.textContent = S.camAspects[v] ?? v; o.title = t; asp.appendChild(o); }
    asp.value = c.aspect || ''; asp.onchange = () => updateCam(c.id, { aspect: asp.value });
    const btn = (txt, title, fn, cls = '') => { const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.title = title; b.className = cls; b.onclick = fn; return b; };
    li.append(name, fov, asp,
      btn('👁', S.camLook, () => enterCamView(c.id), 'cam-look'),
      btn('⤓', S.camMove, () => updateCam(c.id, here()), 'cam-move'),
      btn('✕', S.camDel, () => removeCam(c.id), 'cam-del'));
    ul.appendChild(li);
  }
  $('cam-count').textContent = cams.map.size ? String(cams.map.size) : '';
}
const here = () => ({ p: camera.position.toArray().map((n) => +n.toFixed(3)), yaw: +controls.yaw.toFixed(4), pitch: +controls.pitch.toFixed(4) });
async function addCam() {
  try { const { camera: c } = await api.addCamera(ROOM, { ...here(), fov: 60 }, auth()); cams.upsert(c); renderCams(); toast(S.camPlaced(c.name), 2200); return c; }
  catch (err) { toast(err.message, 3000); return null; }
}
async function updateCam(id, patch) {
  try { const { camera: c } = await api.updateCamera(ROOM, id, patch, auth()); cams.upsert(c); renderCams(); return c; } catch (err) { toast(err.message, 3000); renderCams(); return null; }
}
async function removeCam(id) {
  try { await api.removeCamera(ROOM, id, auth()); cams.remove(id); if (camView === id) exitCamView(); renderCams(); return true; } catch (err) { toast(err.message, 3000); return false; }
}
$('cam-add').onclick = () => addCam();
$('cam-show').checked = camShow;
$('cam-show').onchange = (e) => { camShow = e.target.checked; localStorage.setItem('klibb.camShow', camShow ? '1' : '0'); cams.setVisible(state.mode !== 'view' && camShow); };

// "Titta genom kamera": skärmen visar exakt det kameran ser (med svarta kanter för 16:9 / 9:16).
// var: används i action() och frame() som kan köras innan den här raden.
var camView = null; // eslint-disable-line no-var
function enterCamView(id) {
  const c = cams.get(id); if (!c) return false;
  camView = id; controls.unlock(); preview.hide(); cams.setHideAll(true);
  document.body.classList.add('camview');
  $('camview-hud').hidden = false; $('camview-name').textContent = S.camViewLabel(c);
  closeMore();
  return true;
}
function exitCamView() {
  camView = null; cams.setHideAll(false); document.body.classList.remove('camview'); $('camview-hud').hidden = true;
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
$('camview-exit').onclick = () => exitCamView();
// (Esc out of a camera view: see onEscape)

// ---------- Första eller tredje person (C, knappen i ⚙ More, 👤 på mobilen) ----------
// Förstapersonsläget är precis som förut (ingen hand syns). I tredjepersonsvy står kameran bakom
// och lite ovanför min gubbe, och gubben slappar mot väggen. Valet sparas på enheten.
function setView(v, { quiet = false } = {}) {
  view = saveView(v);
  const t = view === 'third';
  document.body.classList.toggle('third-person', t);
  chase.eye = null; chase.dist = null; // börja om utan glidning
  together.showSelf(t);
  $('view-first').setAttribute('aria-pressed', String(!t)); $('view-third').setAttribute('aria-pressed', String(t));
  $('view-btn').setAttribute('aria-pressed', String(t));
  $('view-btn').title = t ? S.viewBtnToFirst : S.viewBtnToThird;
  if (!quiet) toast(t ? S.viewToastThird(isTouch) : S.viewToastFirst(isTouch), 1600);
  return view;
}
const toggleView = () => setView(view === 'third' ? 'first' : 'third');
$('view-first').onclick = () => { if (view !== 'first') setView('first'); };
$('view-third').onclick = () => { if (view !== 'third') setView('third'); };
$('view-btn').onclick = (e) => { e.preventDefault(); toggleView(); };
setView(view, { quiet: true });

// Kameran bakom gubben: följer mjukt, dras in mot gubben när en vägg är i vägen.
function updateChase(dt) {
  const eye = camera.position;
  if (!chase.eye) chase.eye = eye.clone(); else chase.eye.lerp(eye, 1 - Math.exp(-dt * 16));
  const pose = chasePose(chase.eye, controls.yaw, controls.pitch, chaseCast, chaseOpts(tpCam.aspect));
  chase.dist = smoothDist(chase.dist, pose.dist, dt);
  const back = pose.position.clone().sub(pose.pivot); if (back.lengthSq() > 1e-9) back.normalize(); else back.set(0, 0, 1).applyQuaternion(camera.quaternion);
  tpCam.position.copy(pose.pivot).addScaledVector(back, chase.dist);
  tpCam.quaternion.copy(camera.quaternion);
  tpCam.updateMatrixWorld();
  chase.pose = { dist: chase.dist, target: pose.dist };
}

// Footsteps (steps.js): mine while I walk, and the others' from where they walk.
const footsteps = new Footsteps(sound);
let stepsTick = 0;
function walkSounds() {
  footsteps.update('me', camera.position.x, camera.position.z);
  const ids = new Set();
  for (const pl of together.players.map.values()) {
    ids.add(pl.id);
    footsteps.update(pl.id, pl.pos.x, pl.pos.z, { at: [pl.pos.x, 0.05, pl.pos.z], voice: pl.look?.sound || null });
  }
  if (++stepsTick % 300 === 0) footsteps.forget(ids);
}

// ---------- Huvudloopen ----------
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (!camView) controls.update(dt);
  const cv = camView && cams.get(camView);
  if (cv) poseCamera(viewCam, { p: cv.p, yaw: cv.yaw, pitch: cv.pitch, fov: cv.fov });
  const tp = !cv && view === 'third';
  if (tp) updateChase(dt);
  const eyeCam = cv ? viewCam : tp ? tpCam : camera;
  // gubbar precis vid kameran döljs, och min egen om kameran kommer för nära (t.ex. mot en vägg)
  together.update(dt, eyeCam.position, { hideSelf: !tp || chase.dist < CHASE.hideBelow });
  cams.update(cv ? null : eyeCam.position);
  peelLayer.update();
  walkSounds();
  updateCredit();
  { const cam = cv ? viewCam : camera; cam.getWorldDirection(fwd); sound.setListener(cam.position, fwd); }
  if (controls.locked && state.selected && !state.adminToken && state.mode === 'slap') {
    const h = hitSurface(CENTER);
    if (h) {
      const [w, hh] = StampLayer.dims(state.selected, Math.min(state.size, maxSizeCm() / 100));
      setFarUi(outOfReach(h.point));
      preview.show(h.point, h.normal, StampLayer.orientation(h.normal, h.dir, nextRotation()), w, hh, h.surface);
    } else { preview.hide(); setFarUi(false); }
    farFlash = null;
  } else if (farFlash) {
    // Utan sikte (mobilen, eller pekaren släppt): en blek, grå skugga där man försökte, en kort stund.
    if (performance.now() < farFlash.until && state.mode === 'slap') {
      const { h, design } = farFlash, [w, hh] = StampLayer.dims(design, Math.min(state.size, maxSizeCm() / 100));
      setFarUi(true); preview.show(h.point, h.normal, StampLayer.orientation(h.normal, h.dir, nextRotation()), w, hh, h.surface);
    } else { farFlash = null; preview.hide(); setFarUi(false); }
  } else if (document.body.classList.contains('out-of-reach')) setFarUi(false);
  if (cv) renderFramed(renderer, scene, viewCam, cv.aspect || '');
  else { if (camView) exitCamView(); renderer.render(scene, tp ? tpCam : camera); }
  requestAnimationFrame(frame);
}

renderTray();
renderHistory();
if (state.mine.length) select(last(state.mine));
initAdmin();
Promise.all([loadRoom(), validateDesigns()]).then(() => { window.klibb.ready = true; if (canEditStyle()) renderRecs(); });
frame();

// updateViaCache: 'none' = webbläsaren kollar alltid efter en ny sw.js, så appen inte fastnar på en gammal version.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
}

// Små hjälpfunktioner för automatiska tester (och för nyfikna i konsolen).
window.klibb = {
  soundUi: () => soundUi, resuming: () => resuming, escGate, openStylePanel: (m = 'edit') => openStylePanel(m), styleOpen: () => sp.open, synthShared: () => synthShared, soundSteps: () => sound.steps, soundMine: () => sound.mine, voiceOf: (id) => together.voiceOf(id),
  // Render every sound offline (Tone.Offline) and report peak/RMS – the "non-silent, no clipping" check.
  synthCheck: async (patches) => { const { offlineCheck } = await import('./synthcheck.js'); return offlineCheck(patches); },
  entitlements: () => JSON.parse(JSON.stringify(entitlements)), entitlementsReady: () => entitlementsReady,
  ready: false, room: ROOM, state, stamps, camera, controls, preview, renderer,
  // Vikningen utan rendering, för tester: vilka ytor hamnar en klibba på och hur stor yta?
  fold(position, quaternion, w, h, surface) {
    const pieces = foldStamp(stamps.faces, { center: new THREE.Vector3(...position), quaternion: new THREE.Quaternion(...quaternion), w, h, surface });
    return pieces.map((p) => ({ face: p.face, depth: p.depth, uv: p.uv, points: p.points.map((v) => v.toArray()) }));
  },
  orientation: (normal, dir, rot) => StampLayer.orientation(new THREE.Vector3(...normal), new THREE.Vector3(...dir), rot).toArray(),
  look(yaw, pitch) { controls.yaw = yaw; controls.pitch = pitch; controls.apply(); },
  moveTo(x, z) { camera.position.x = x; camera.position.z = z; },
  stampAt: (x = 0, y = 0) => stampAt(new THREE.Vector2(x, y)),
  pendingSlaps: () => pendingSlaps.size, // klibbor som syns men inte är bekräftade av servern än
  styleFromSeed, randomSeed, normalizeStyle, currentStyle: () => currentStyle, canEditStyle, surfaces: room.surfaces,
  net: together.net, players: () => together.players.list(), me: together.me, openChat: together.openChat,
  openAvatarPanel: together.openAvatarPanel, avatarModel: () => import('./avatars.js').then((m) => m.loadAvatarModel()).then(() => true),
  cameras: () => cams.list(), camerasVisible: () => [...cams.map.values()].some((e) => e.obj.visible), addCamera: addCam, updateCamera: updateCam, removeCamera: removeCam,
  creditAtDot: () => creditOf(pickStampAt(CENTER)?.stamp), clickCredit,
  credit: () => ({ shown: !!credit.shown && !$('credit').hidden, name: $('credit-name').textContent, link: $('credit-link').getAttribute('href') || '',
    label: $('credit-link').textContent, hint: $('credit-hint').textContent, tap: $('credit').classList.contains('tap'),
    rect: $('credit').hidden ? null : $('credit').getBoundingClientRect().toJSON() }),
  linkDialog: () => ({ open: linkDlg.open, url: $('link-url').textContent, href: $('link-open').getAttribute('href'), rel: $('link-open').rel, target: $('link-open').target }),
  cleanArtistLink,
  endDialog: () => ({ open: endDlg.open, shows: endShows, title: $('end-title').textContent, question: $('end-q').textContent, action: $('end-action').textContent, keep: $('end-keep').textContent }),
  sound, soundLog: () => sound.log.slice(), openMore, closeMore, moreOpen: () => !$('more-panel').hidden,
  enterCamView, exitCamView, camView: () => camView, viewCam, rec: () => rec, renderRecs,
  setView, toggleView, view: () => view, tpCam, chase: () => ({ ...chase.pose, cam: tpCam.position.toArray() }), selfAvatar: () => together.selfInfo(), peels: () => peelLayer.info(), peelPose: (id) => peelLayer.poseOf(id), nopes: () => nopes,
  reach: SLAP_REACH, farSlaps: () => farSlaps, skipReachCheck: false,
  reachState: () => ({ peels: peelLayer.on, far: preview.far, crosshairDim: document.body.classList.contains('out-of-reach'), flash: !!farFlash, visible: preview.mesh.visible, opacity: preview.mat.opacity }),
  peelOverlap: (pos, quat, size) => peelLayer.overlap(state.selected, { position: pos, quaternion: quat, size }), fabricStats: () => together.fabricStats(), previewFabrics: () => together.previewFabrics(), freezeGestures: (ms) => together.freezeGestures(ms), handPos: () => together.handPos(),
  nextDesign, prevDesign, designs, validateDesigns, removeDesign, undoRemove, toggleFav, undoMs: UNDO_MS, setMode, toggleMode, peelLast, peelAll, roomHistory: () => peelable(), peelSettled, peelLimit: PER_ROOM, setSize, get maxSizeCm() { return maxSizeCm(); }, wallMaxCm: WALL_MAX_CM, freeMaxCm: FREE_MAX_CM,
};

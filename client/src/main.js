// Slap and Talk – startpunkten för webbappen. Här kopplas allt ihop:
// rummet (room.js), styrningen (controls.js), stämplarna (stamps.js) och servern (api.js).
import * as THREE from 'three';
import { buildBoxRoom } from './room.js';
import { startSizeCm } from '../../shared/sizeprefix.mjs';
import { CATALOG, DEFAULT_STYLE, normalizeStyle, styleFromSeed, randomSeed, styleName, applyStyle, swatchUrl } from './roomstyle.js';
import { FirstPersonControls, isTyping } from './controls.js';
import { StampLayer, StampPreview } from './stamps.js';
import { api } from './api.js';
import { foldStamp } from './fold.js';
import { readHistory, addHistory, removeHistory, roomHistory, trimHistory, deviceId, HISTORY_KEY, PER_ROOM } from './history.js';
import { readMine, addMine, insertMine, removeMine, updateMine, saveBlob, deleteBlob, getBlob, readFavs, setFav, moveFav, FAV_KEY } from './designs.js';
import { initTogether } from './together.js';
import { CameraLayer, CAMERA_FOVS, CAMERA_ASPECTS, poseCamera, renderFramed, aspectRatio } from './cameras.js';
import * as photo from './photo.js';
import { createAutoCrew, liveStickerTargets, AUTO_CHOICES, autoCamsOf, MAX_AUTO_CAMS } from '../../shared/autocam.mjs';
import { groupFocus } from '../../shared/personcam.mjs';
import { S, LOCALE } from './strings.js';
import { Sounds } from './sound.js';
import { CHASE, chaseOpts, chasePose, smoothDist, aimNear, surfaceCaster, loadView, saveView } from './chasecam.js';
import { cleanArtistLink, cleanArtistName, linkLabel } from '../../shared/artistlink.mjs';
import { PeelLayer } from './peels.js';
import { PEEL, peelPlan, onFloor, stampDims } from '../../shared/peels.mjs';
import { entitlements, loadEntitlements, credentials } from './entitlements.js';
import { initFullVersion } from './fullversion.js';
import { GrooveSteps } from './groove.js';
import { initAutoSlap } from './autoslap.js';
import { AUTO, movedEnough } from '../../shared/autoslap.mjs';
import { GROOVE, cleanGroove, retime, sliderToScale, scaleToSlider, stepScale, grooveLabel } from '../../shared/groove.mjs';
import { loadSoundLook, initSoundUI } from './soundui.js';
import * as synthShared from '../../shared/synth.mjs';
import { config } from './config.js';
import * as demo from './demo.js';
import { noteVisit } from './landing.js';
import { Voice } from './voice.js';
import { ArrayGhosts } from './arraydrag.js';
import { arrayPlan, faceFor, PEELS_PER_ARRAY } from '../../shared/array.mjs';
import { boxFaces } from '../../shared/coverage.mjs';
import { initStackMenu } from './stackmenu.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ROOM = (params.get('room') || 'stad').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'stad';
const isTouch = matchMedia('(pointer: coarse)').matches || params.has('touch');
// The demo profile (server DEMO_PROFILE=1, see demo.js and server/demo.js): the free version –
// library stickers, no uploads, no room editing, invite-only rooms that close after an hour.
const DEMO = !!config.demo;
document.body.classList.toggle('demo', DEMO);
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
// Our own unlocks (a menu, the chat, a camera view …) are told apart from the player's Esc: auto-slap
// pauses for the first and turns off for the second (see onLockChange).
var softUnlockAt = 0; // eslint-disable-line no-var
{ const raw = controls.unlock.bind(controls); controls.unlock = () => { softUnlockAt = performance.now(); raw(); }; }
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
  library: [], // the curated sticker library (GET /api/library); the palette in the demo
  favs: readFavs(), // favourite design ids ("staples")
  size: 0.3, rotation: 0, jitter: false, // size = the held size (longest side, m); each design starts at its own size (startSize)
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
  if (sound.muted && groove) groove.stopAll(); // the footstep buzz too
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
function designs() { return DEMO ? state.library : state.mine.slice().reverse(); }
// En annan flik ändrade listan: hämta den nya.
addEventListener('storage', (e) => {
  if (e.key === FAV_KEY) { state.favs = readFavs(); renderTray(); return; }
  if (e.key !== 'klibb.mine') return;
  state.mine = readMine();
  if (state.selected && !state.mine.some((m) => m.id === state.selected.id)) select(last(state.mine));
  else { renderTray(); renderDesignHud(); }
});

async function select(img) {
  const changed = (img && img.id) !== (state.selected && state.selected.id);
  state.selected = img || null; renderTray(); renderDesignHud();
  if (img && changed) startSize(img);
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
  if (!list.length) { if (!DEMO) toast(S.uploadFirst); return null; }
  const i = list.findIndex((d) => d.id === state.selected?.id);
  const next = list[i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length];
  select(next);
  if (list.length === 1) toast(S.onlyOneDesign);
  return next;
}

function renderDesignHud() {
  const list = designs(), sel = state.selected;
  const i = sel ? list.findIndex((d) => d.id === sel.id) : -1;
  // touch: the stack shows the next two stickers under the one on top
  for (const [k, id] of [[1, 'design-btn-b1'], [2, 'design-btn-b2']]) {
    const d = list.length > k ? list[(i + k + list.length) % list.length] : null;
    $(id).hidden = !d; if (d) $(id).src = d.url;
  }
  const hud = $('design-hud'), btn = $('design-btn');
  hud.hidden = !sel;
  btn.hidden = !sel && !isTouch; // touch: the stack is always there (empty: tap it → 📒 Stickers → ⬆ Upload)
  btn.classList.toggle('empty', !sel);
  if (!sel) { $('design-btn-img').removeAttribute('src'); $('design-btn-num').textContent = ''; return; }
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
      const fresh = await api.uploadSticker(blob, img.artist || state.artist, { startCm: img.startCm });
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
  if (DEMO) return; // the demo has no uploads: the palette is the library
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

// Storleken = klibbans längsta sida. Free version: at most 1 m. The full version (bigStickers)
// has NO upper limit, not even the room (Jens, 26 Oct 2026; he may add one back).
// The slider only travels to SLIDER_FULL_CM (a range input needs a finite end); the wheel goes on
// past it, and the label shows the real size.
const FREE_MAX_CM = 100;
const FREE_MIN_CM = 15; // free version: at least 15 cm (= A_); the full version goes down to 5 cm
const FULL_MIN_CM = 5;
const SLIDER_FULL_CM = 400; // slider travel only, not a limit
const maxSizeCm = () => (entitlements.full.bigStickers ? Infinity : FREE_MAX_CM);
const minSizeCm = () => (entitlements.full.bigStickers ? FULL_MIN_CM : FREE_MIN_CM);
const showSize = () => {
  const cm = Math.round(state.size * 200) / 2;
  $('size').value = String(Math.min(cm, Number($('size').max)));
  $('size-val').textContent = `${cm.toLocaleString(LOCALE)} cm`;
};
function applySizeLimit() {
  $('size').max = String(Number.isFinite(maxSizeCm()) ? maxSizeCm() : SLIDER_FULL_CM);
  $('size').min = String(minSizeCm());
  if (state.size * 100 > maxSizeCm()) state.size = maxSizeCm() / 100;
  if (state.size * 100 < minSizeCm()) state.size = minSizeCm() / 100;
  showSize();
}
$('size').oninput = (e) => { state.size = Number(e.target.value) / 100; showSize(); };
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
  if (!Number.isFinite(cm)) return; // sanity guard only (NaN / endless wheel), not a size limit
  const want = Math.round(cm * 2) / 2; // 0.5 cm steps (the letter sizes are 2.5 cm apart)
  const max = maxSizeCm();
  cm = Math.min(Math.max(want, minSizeCm()), max); // free 15 cm – 1 m, full 5 cm – no limit
  if (want > max && performance.now() - maxToastAt > 1500) {
    maxToastAt = performance.now();
    toast(S.maxSize((max / 100).toLocaleString(LOCALE)), 1500);
  }
  state.size = cm / 100; showSize();
}
// Each design starts at its own size (file-name letter prefix, shared/sizeprefix.mjs: A_ = 15 cm …
// Z_ = 77.5 cm, no prefix = 15 cm; the value the size slider shows) whenever you switch to it: R/F,
// the palette, a new upload. Scaling after that is free, as before, until you switch design again.
function startSize(img) { setSize(startSizeCm(img, { minCm: minSizeCm(), maxCm: maxSizeCm() })); }
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
    const img = await api.uploadSticker(blob, state.artist, { name: file.name }); // the name carries the size prefix
    try { await saveBlob(img.id, blob); } catch { /* local copy is a nice-to-have (private mode Safari) */ }
    state.mine = addMine(img);
    if (state.selected && state.selected.id === img.id) startSize(img); // the same picture again (maybe renamed): its start size
    await select(img);
    stackMenu?.chosen(); stackMenu?.closeBook(); // touch: the new sticker is in your hand
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

// onStart(info): called the moment the sticker shows (before the server answers), with what a
// sticker array (hold + drag) needs: where, how, which design, and info.result = this slap's promise.
// auto: an auto-slap (autoslap.js) { burst, volume, check(h) }: quiet when it can't slap (no "too far",
// no "nope"), and it joins the burst's first sticker's peel key (one undo step per burst).
function stampAt(ndc, { onStart = null, auto = null } = {}) {
  const info = {};
  const p = slapAt(ndc, info, onStart, auto);
  info.result = p;
  return p;
}
async function slapAt(ndc, info, onStart, auto = null) {
  if (!state.selected) { if (!auto) toast(S.pickFirst); return null; }
  const h = hitSurface(ndc); if (!h) return null;
  if (auto && auto.check && !auto.check(h)) return null;
  const q = StampLayer.orientation(h.normal, h.dir, nextRotation());
  const slapSize = Math.max(Math.min(state.size, maxSizeCm() / 100), minSizeCm() / 100);
  // På golvet: ligger den nya klibban mest på baksidespapper fastnar den inte (servern kollar samma sak).
  if (peelLayer.on && peelLayer.count && onFloor(h.surface, h.normal.toArray())) {
    const frac = await peelLayer.overlap(state.selected, { position: h.point.toArray(), quaternion: q.toArray(), size: slapSize });
    if (frac > PEEL.refuseOverlap) { if (!auto) nope(); return null; }
  }
  if (auto) auto.started(h); // counted from here: it shows now
  pendingJitter = (Math.random() - 0.5) * 30;
  // Min gubbe slår handen mot väggen i samma bildruta som klibban syns (bara i tredjepersonsvy).
  together.selfGesture('slap', h.point, h.normal);
  // Kom ihåg exakt vilken design som stämplas: användaren kan hinna trycka R innan svaret kommer.
  const design = state.selected;
  sound.play('slap', null, auto ? { volume: auto.volume } : {}); // direkt, utan att vänta på servern: det ska kännas som en riktig klibba
  const nonce = Math.random().toString(36).slice(2, 12);
  myNonces.add(nonce); setTimeout(() => myNonces.delete(nonce), 60_000);
  const body = { nonce, owner: deviceId(), ...(together.net.id ? { by: together.net.id } : {}), // by: så de andra ser min gubbe slappa
    imageId: design.id,
    position: h.point.toArray(), normal: h.normal.toArray(), quaternion: q.toArray(),
    // A library sticker carries its own artist (the server makes sure of it too).
    size: slapSize, rotation: state.rotation, surface: h.surface, artist: design.library ? design.artist || '' : state.artist,
    peelFrom: { p: [camera.position.x, camera.position.z], yaw: controls.yaw }, // var baksidespappret föds (peels)
    ...(design.library ? (design.artistLink ? { artistLink: design.artistLink } : {}) : state.artistLink ? { artistLink: state.artistLink } : {}),
    ...(auto ? { auto: true } : {}),
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
  pendingSlaps.set(nonce, { tempId, image: design, peel: false, settled, ...(auto ? { burst: auto.burst } : {}) });
  stamps.add(temp, design).then(updateCount);
  if (onStart) { Object.assign(info, { point: h.point.clone(), normal: h.normal.clone(), q: q.clone(), size: slapSize, surface: h.surface, design, nonce, temp }); onStart(info); }
  const burst = auto && auto.burst, firstOfBurst = !!burst && auto.first;
  try {
    if (burst && !firstOfBurst) { // join the burst's first sticker (one peel key = one undo step)
      const f = await burst.first;
      if (f && !burst.peeled) body.join = { id: f.id, token: f.token };
    }
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
    const own = () => addHistory({ room: ROOM, stampId: res.stamp.id, token: res.peelToken, designId: res.image.id, url: res.image.url, time: res.stamp.createdAt || new Date().toISOString() });
    if (burst && !firstOfBurst && res.joined && body.join) {
      // Part of the burst: it goes into the first sticker's history entry (h.extra), Z peels them all.
      const cur = roomHistory(ROOM).find((x) => x.stampId === body.join.id);
      if (cur && !burst.peeled) addHistory({ ...cur, extra: [...(Array.isArray(cur.extra) ? cur.extra : []), res.stamp.id] });
      else { peelWhenSaved.delete(res.stamp.id); startPeel([{ room: ROOM, stampId: res.stamp.id, token: res.peelToken, time: new Date().toISOString() }], { quiet: true }); } // the burst was peeled meanwhile
    } else if (res.peelToken) {
      own();
      if (burst && !firstOfBurst) burst.ended = true; // couldn't join (too many, or the first is gone): the next slap starts a new burst
    }
    if (firstOfBurst) burst.resolve(res.peelToken ? { id: res.stamp.id, token: res.peelToken } : null);
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
    if (firstOfBurst) { burst.resolve(null); burst.ended = true; }
    if (auto) { if (err.status === 429) { autoSlap.setOn(false); toast(S.slowDown); } } // quiet otherwise: the next step tries again
    else if (err.nope) nope(); else toast(err.message);
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

// ---------- Sticker arrays: slap at A, keep the button held, look toward B ----------
// While held, see-through ghosts repeat the sticker from A toward the crosshair, edge to edge on A's
// face (spacing: shared/array.mjs; never round a corner). Release = all copies at once (optimistic,
// like a slap; the server recomputes the row from the saved anchor: POST …/stamps/array). Esc,
// right-click, leaving pointer lock or Look mode = cancel the copies (A stays). A plain click is
// exactly a slap. The row is ONE peel step: A's history entry gets extra = the copies' ids.
// Desktop only (on touch a drag looks around).
let mouseHeld = false;
let arrayDrag = null; // { a: stampAt info, w, h, face, to: Vector3|null, items }
const arrayOps = []; // released rows waiting for the server (Z peels the newest as one step)
const ARRAY_FACES = boxFaces();
const ghosts = new ArrayGhosts(scene, stamps.faces);
const arrayPlane = new THREE.Plane(), arrayHit = new THREE.Vector3();
function startArray(a) {
  const [w, h] = StampLayer.dims(a.design, a.size);
  arrayDrag = { a, w, h, face: faceFor(ARRAY_FACES, a.surface, a.point.toArray(), a.normal.toArray()), to: null, items: [] };
  arrayPlane.setFromNormalAndCoplanarPoint(a.normal, a.point);
  ghosts.setTexture(null);
  stamps.texture(a.design).then((t) => { if (arrayDrag && arrayDrag.a === a) ghosts.setTexture(t); }).catch(() => {});
}
// Every frame while dragging: B = where the crosshair's ray meets A's plane. Returns the ghost count.
function updateArray() {
  const d = arrayDrag;
  aimRay(CENTER);
  if (raycaster.ray.intersectPlane(arrayPlane, arrayHit)) d.to = arrayHit.clone(); // looking away from the plane: keep the last B
  d.items = d.to ? arrayPlan({ position: d.a.point.toArray(), quaternion: d.a.q.toArray(), surface: d.a.surface }, d.w, d.h, d.to.toArray()).items.filter((x) => x.i > 0) : [];
  if (d.items.length) ghosts.show(d.items, d.a.q, d.a.normal, d.w, d.h, d.a.surface, d.face); else ghosts.hide();
  return d.items.length;
}
function cancelArray() { if (!arrayDrag) return; arrayDrag = null; ghosts.hide(); }
// Others' rows: one slap sound per row (the copies arrive as separate stamp:add events).
const rowsHeard = new Map();
function rowHeard(g) {
  const now = performance.now();
  for (const [k, t] of rowsHeard) if (now - t > 5000) rowsHeard.delete(k);
  if (rowsHeard.has(g)) return true;
  rowsHeard.set(g, now); return false;
}
function commitArray() {
  const d = arrayDrag; arrayDrag = null; ghosts.hide();
  if (!d || !d.to) return null;
  const items = d.items.length ? d.items : [];
  if (!items.length) return null;
  const { a } = d, design = a.design;
  const from = { x: camera.position.x, z: camera.position.z, yaw: controls.yaw };
  const op = { a, temps: [], peeled: false, done: null };
  let settle; const settled = new Promise((r) => { settle = r; });
  const now = new Date().toISOString();
  let papers = 0;
  for (const { i, position } of items) {
    const nonce = `${a.nonce}x${i}`;
    myNonces.add(nonce); setTimeout(() => myNonces.delete(nonce), 60_000);
    const tempId = 'tmp-' + nonce;
    pendingSlaps.set(nonce, { tempId, image: design, peel: false, settled, row: a.nonce });
    stamps.add({ ...a.temp, id: tempId, position, order: stamps.topOrder() + 1, createdAt: now, pending: true }, design).then(updateCount);
    if (peelLayer.on && papers < PEELS_PER_ARRAY) {
      papers++;
      const [pw, ph] = stampDims(design, a.size);
      peelLayer.add({ id: tempId, imageId: design.id, w: pw, h: ph, seed: nonce, ...peelPlan(nonce, from, position) }, design, { animate: true, by: 'me' });
    }
    op.temps.push({ i, nonce, tempId });
  }
  // A quick, soft rattle along the row (A already made the real slap sound on the way down).
  for (let k = 0; k < Math.min(3, items.length); k++) setTimeout(() => sound.play('slap', null, { volume: 0.4 - k * 0.1 }), 45 * (k + 1));
  arrayOps.push(op);
  const dropAll = () => { for (const t of op.temps) { dropPending(t.nonce); peelLayer.remove([t.tempId]); } };
  op.done = (async () => {
    try {
      const anchor = await a.result; // the first sticker's own slap (it may still be on its way)
      if (!anchor || op.peeled) { dropAll(); return; }
      const hist = roomHistory(ROOM).find((x) => x.stampId === anchor.id);
      if (!hist) { dropAll(); return; } // peeled (or gone) before the row got there
      let res;
      try {
        res = await api.addArray(ROOM, { anchor: { id: anchor.id, token: hist.token }, to: d.to.toArray(), nonce: a.nonce,
          ...(together.net.id ? { by: together.net.id } : {}), peelFrom: { p: [from.x, from.z], yaw: from.yaw } });
      } catch (err) {
        dropAll();
        if (err.nope) nope(); else if (!err.gone) toast(err.status === 429 ? S.slowDown : err.message);
        return;
      }
      const got = new Map(res.stamps.map((x) => [x.i, x]));
      for (const t of op.temps) {
        const r = got.get(t.i);
        if (!r) { dropPending(t.nonce); peelLayer.remove([t.tempId]); continue; }
        confirmSlap(t.nonce, r.stamp, res.image);
        if (r.peel) { if (!peelLayer.confirm(t.tempId, r.peel)) peelLayer.add(r.peel, res.image, { animate: false }); } else peelLayer.remove([t.tempId]);
      }
      const ids = res.stamps.map((x) => x.stamp.id);
      const cur = roomHistory(ROOM).find((x) => x.stampId === anchor.id);
      if (op.peeled) { // Z while the row was on its way: peel the copies too (same key), quietly
        for (const id of ids) peelWhenSaved.delete(id);
        startPeel([{ ...hist, stampId: ids[0], extra: ids.slice(1) }], { quiet: true });
      } else if (cur && ids.length) addHistory({ ...cur, extra: ids });
      updateCount(); renderHistory();
    } finally {
      settle();
      const k = arrayOps.indexOf(op); if (k >= 0) arrayOps.splice(k, 1);
    }
  })();
  return op.done;
}
// Z while a row is on its way to the server: it all goes at once (the anchor too), as one step.
function peelArrayOp(op) {
  op.peeled = true;
  peelGesture(op.temps[0]?.tempId);
  for (const t of op.temps) { const p = pendingSlaps.get(t.nonce); if (p) p.peel = true; stamps.peelAway(t.tempId); peelLayer.remove([t.tempId]); }
  const pa = pendingSlaps.get(op.a.nonce);
  if (pa) { pa.peel = true; stamps.peelAway(pa.tempId).then(updateCount); } // the anchor itself is still pending
  else op.a.result.then((st) => { const h = st && roomHistory(ROOM).find((x) => x.stampId === st.id); if (h) startPeel([h], { quiet: true }); });
  sound.play('peel'); toast(S.peeled, 900);
  return op.done.then(() => op.a.result).then(() => peelSettled()).then(() => true);
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

function action(ndc, opts) {
  if (state.mode === 'view') return null; // Tittläge: klick och tryck gör ingenting
  if (sp.open || together.busy()) return null; // en panel är öppen: titta, men stämpla inte
  if (camView) return null; // tittar genom en kamera
  return state.adminToken ? adminPick(ndc) : stampAt(ndc, opts);
}

// ---------- Klibbläge / Tittläge (V, eller ögat på mobilen) ----------
// Tittläge: ingen pekare och inget sikte, klick stämplar inte, scroll och Q/E gör ingenting.
// R byter fortfarande design (man stannar i Tittläge), så man kan förbereda nästa klibba.
function setMode(mode, { quiet = false } = {}) {
  state.mode = mode === 'view' ? 'view' : 'slap';
  if (state.mode === 'view') cancelArray();
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
var stackMenu = null; // eslint-disable-line no-var -- touch only: the sticker stack menu + the held sticker's timer (stackmenu.js)
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
// A history entry is one peel step: one sticker, or a whole sticker array (the anchor + h.extra).
const idsOf = (h) => [h.stampId, ...(Array.isArray(h.extra) ? h.extra : [])];

// Peela de här posterna direkt på skärmen och skicka dem till servern. Returnerar antal.
function startPeel(entries, { quiet = false } = {}) {
  const fresh = entries.filter((h) => !peeling.has(h.stampId));
  if (!fresh.length) return 0;
  peelGesture(fresh[0].stampId);
  for (const h of fresh) {
    for (const id of idsOf(h)) {
      peeling.set(id, h);
      // Servern skickar ut "borttagen" till alla, även mig: det ska inte låta som någon annans peel.
      myPeels.add(id); setTimeout(() => myPeels.delete(id), 60_000);
      stamps.highlight(id, false);
      stamps.peelAway(id);
    }
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
  // At most 200 stickers per call (the server's limit); a sticker array is never split.
  const batch = []; let n = 0;
  while (peelOutbox.length && (!batch.length || n + idsOf(peelOutbox[0]).length <= 200)) { const h = peelOutbox.shift(); batch.push(h); n += idsOf(h).length; }
  peelInFlight = (async () => {
    let results = null;
    try { ({ results } = await api.peel(ROOM, batch.flatMap((h) => idsOf(h).map((id) => ({ id, token: h.token }))), together.net.id)); } catch (err) {
      toast(err.status === 429 ? S.slowDown : S.peelFailed);
    }
    // ok = borta. notfound = fanns redan inte. forbidden = nyckeln gäller inte längre (för gammal):
    // den finns kvar i rummet. Ett fel (nätet, för många): de finns kvar, och kan peelas igen.
    if (results) removeHistory(batch.filter((h) => results[h.stampId]).map((h) => h.stampId));
    const back = batch.filter((h) => !results || results[h.stampId] === 'forbidden');
    for (const h of batch) for (const id of idsOf(h)) peeling.delete(id);
    if (back.length) { for (const h of back) for (const id of idsOf(h)) stamps.gone.delete(id); await resyncRoom(); }
    updateCount(); scheduleHistory();
    peelInFlight = null;
    return flushPeels();
  })();
  return peelInFlight;
}
// Vänta tills allt som peelats har bekräftats av servern.
async function peelSettled() { while (peelInFlight || peelOutbox.length) await flushPeels(); }

function peelLast() {
  // A sticker array still on its way to the server: the whole row (and its anchor) goes, as one step.
  const op = last(arrayOps.filter((o) => !o.peeled));
  if (op) return peelArrayOp(op);
  // Den senaste klibban väntar fortfarande på servern: peela den direkt på skärmen, och på
  // riktigt så fort servern har svarat (annars skulle ↩ ta klibban före).
  const pend = last([...pendingSlaps.values()].filter((p) => !p.peel));
  if (pend && pend.burst) return peelBurst(pend.burst);
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

// Z during an auto-slap burst: every sticker of the burst goes, as one step (the ones still on their
// way too), and the next auto slap starts a new burst.
function peelBurst(b) {
  b.peeled = true; b.ended = true;
  const waits = [];
  for (const p of pendingSlaps.values()) if (p.burst === b && !p.peel) { p.peel = true; stamps.peelAway(p.tempId).then(updateCount); waits.push(p.settled); }
  peelGesture(null); sound.play('peel'); toast(S.peeled, 900);
  return b.first.then((f) => { const h = f && roomHistory(ROOM).find((x) => x.stampId === f.id); if (h) startPeel([h], { quiet: true }); })
    .then(() => Promise.all(waits)).then(() => peelSettled()).then(() => true);
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
  const reset = canReset();
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
  if (b.dataset.kind === 'new') { endDlg.close(); if (DEMO) demo.goToNewRoom().catch((e) => toast(e.message)); else openStylePanel('create'); return; }
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

// ---------- Clear hidden stickers ----------
// The creator (or admin) removes every sticker that is completely covered by newer ones; what you
// see stays, in the same order and size, and becomes the room's new base layer (peel history reset).
const clearDlg = $('clear-dialog');
$('clear-hidden').onclick = async () => {
  if (clearDlg.open) return;
  controls.unlock(); preview.hide(); closeRoomMenu(); closeMore();
  $('clear-q').textContent = S.clearCounting;
  $('clear-go').disabled = true;
  clearDlg.showModal();
  $('clear-cancel').focus();
  try {
    const { hidden } = await api.hiddenCount(ROOM, auth());
    $('clear-q').textContent = S.clearQ(hidden);
    $('clear-go').disabled = !hidden;
  } catch (err) { $('clear-q').textContent = err.message || S.clearFailed; }
};
$('clear-cancel').onclick = () => clearDlg.close();
$('clear-go').onclick = async () => {
  const b = $('clear-go');
  b.disabled = true;
  try {
    await api.clearHidden(ROOM, together.me().shownAs || together.me().name, auth());
    clearDlg.close();
  } catch (err) { toast(err.message || S.clearFailed, 3000); b.disabled = false; }
};
// Everyone in the room: the hidden stickers go (quietly; nobody could see them), and nobody's
// peel history reaches past this point any more, so everything left can be painted into the walls.
function onClearHidden(e) {
  for (const id of Array.isArray(e.ids) ? e.ids : []) stamps.remove(id);
  const mine = readHistory().filter((h) => h.room === ROOM).map((h) => h.stampId);
  if (mine.length) removeHistory(mine);
  together.sys(S.clearedN(String(e.by || '').slice(0, 24) || '?', (e.ids || []).length));
  updateCount(); scheduleHistory();
  stamps.scheduleBake();
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
    li.innerHTML = `<img alt="" src="${h.url || ''}"><span class="t">${fmtTime(h.time)}${h.extra && h.extra.length ? ` ×${h.extra.length + 1}` : ''}</span><button type="button" title="${S.peelThis}" aria-label="${S.peelThisAria}">✕</button>`;
    const hl = (on) => { li.classList.toggle('hl', on); for (const id of idsOf(h)) stamps.highlight(id, on); };
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
  if (placingCam) return () => cancelPlacingCam();
  if (camView) return () => exitCamView();
  if (fullUi?.isOpen()) return () => fullUi.close();
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
  if (arrayDrag) { e.preventDefault(); cancelArray(); return; } // Esc while dragging: no copies (the first sticker stays)
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
  if (!locked) cancelArray(); // Esc leaves pointer lock first: that cancels a sticker array too
  // Esc (the player left the game) turns auto-slap off; our own unlocks (menus, chat) and a hidden tab only pause it.
  if (!locked && autoSlap && autoSlap.on && performance.now() - softUnlockAt > 400 && document.visibilityState === 'visible' && document.hasFocus()) autoSlap.setOn(false);
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
    else if (placingCam) placeCamAt(CENTER); // ＋ Add cameraman: this click sets where it starts
    else if (state.mode === 'view') clickCredit(); // Look mode: click a sticker = who made it? (never slaps)
    else {
      // Hold the button and look/drag away: the sticker repeats toward the crosshair (sticker arrays).
      mouseHeld = true;
      action(CENTER, { onStart: (a) => { if (mouseHeld && controls.locked && state.mode === 'slap') startArray(a); } });
    }
  });
  addEventListener('mouseup', (e) => { if (e.button !== 0) return; mouseHeld = false; if (arrayDrag) commitArray(); });
  // Right-click while dragging: cancel the copies (the first sticker stays).
  canvas.addEventListener('mousedown', (e) => { if (e.button === 2 && arrayDrag) { e.preventDefault(); cancelArray(); } });
  canvas.addEventListener('contextmenu', (e) => { if (arrayDrag || controls.locked) e.preventDefault(); });
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
    if (e.code === 'KeyP' && !e.repeat) snapPhoto(); // 📷 Photo
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
      if (placingCam) placeCamAt(ndc);
      else if (stackMenu && !camView && !state.adminToken) heldTap(ndc, e.clientX, e.clientY);
      else if (state.mode === 'view' && !camView) {
        // Tittläge: tryck på en klibba = vem gjorde den?
        const c = creditOf(pickStampAt(ndc)?.stamp);
        if (c) { showCredit(c, { x: e.clientX, y: e.clientY }); credit.id = c.id; } else hideCredit();
      } else { hideCredit(); action(ndc); }
    }
  };
  // Touch: no Slap/Look switch – the held sticker's timer decides (shared/heldtimer.mjs).
  // Sharp = this tap slaps (and restarts the 10 s). Fading/faded = this tap only brings the
  // sticker back (never a slap by accident); on a sticker it also shows who made it.
  // Also used when the sticker is released from its holder (stackmenu.js).
  var heldTap = (ndc, x, y) => { // eslint-disable-line no-var
    if (stackMenu.isOpen()) { stackMenu.close(); return; }
    if (sp.open || together.busy()) return;
    if (stackMenu.tap() === 'wake') {
      const c = creditOf(pickStampAt(ndc)?.stamp);
      if (c) { showCredit(c, { x, y }); credit.id = c.id; } else hideCredit();
    } else {
      hideCredit();
      if (state.selected && hitSurface(ndc)) stackMenu.placed();
      action(ndc);
    }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  // The touch layout: joystick + sticker stack; the panel, ☰ Stickers and the 👤 ↩ 👁 buttons are
  // gone (CSS) – everything they did is in the stack's menu (stackmenu.js).
  $('panel').classList.add('hidden'); $('panel-toggle').setAttribute('aria-expanded', 'false');
  stackMenu = initStackMenu({
    S, locale: LOCALE, state, nextDesign, prevDesign, setSize, setRot, minSizeCm: () => minSizeCm(), maxSizeCm: () => maxSizeCm(),
    peelLast: () => peelLast(), toggleView: () => toggleView(), snapPhoto: () => snapPhoto(), openMore: () => openMore(), closeMore: () => closeMore(),
    chatOpen: () => together.chatOpen(), longPressed: () => longPressed, renderStack: () => renderDesignHud(),
    release: (x, y) => { if (!camView && !placingCam) heldTap(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), x, y); },
  });
}

// ---------- Rum: typ, nytt snabbrum, dela länk, till Staden ----------
const TYPE_NAMES = S.roomTypes;
// The City too gets ?room=stad: the plain address now goes to your own most recent room (landing.js).
function roomUrl(id) { return `${location.origin}/?room=${id}`; }
function showRoomInfo(info) {
  const type = info?.type || (ROOM === 'stad' ? 'stad' : 'quick');
  const badge = $('room-type');
  badge.textContent = TYPE_NAMES[type] || type;
  badge.className = 'badge ' + type;
  $('to-stad').hidden = ROOM === 'stad';
  $('room-note').textContent = type === 'quick'
    ? S.roomNoteQuick(info?.quickTtlHours ?? 24)
    : type === 'profile' ? S.roomNoteProfile(info.owner?.name) : '';
  $('room-hud').textContent = DEMO ? S.demoRoomHud(ROOM) : S.roomHud(type, ROOM);
  if (DEMO) { $('room-note').textContent = S.demoNote(config.roomMinutes || 60); badge.hidden = true; }
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
const canEditStyle = () => !!state.adminToken || (!DEMO && roomType !== 'stad' && !!roomKeys()[ROOM]);
// Reset (all stickers off): the creator, also in the demo (it is not "editing" the room).
const canReset = () => canEditStyle() || (DEMO && !!roomKeys()[ROOM]);
function updateStyleUi() {
  $('edit-style').hidden = !canEditStyle();
  $('clear-hidden').hidden = !canReset(); // same rule as resetting the room
  $('rec-box').hidden = !(canEditStyle() || (DEMO && canReset())); // the demo records too (no cameras there)
  updatePeelUi();
  if (groove) updateGrooveUi();
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
// Demo: straight into a new, empty room (the preset), no look picker.
$('new-room').onclick = () => { if (DEMO) { $('new-room').disabled = true; demo.goToNewRoom().catch((e) => { $('new-room').disabled = false; toast(e.message); }); } else openStylePanel('create'); };
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
  if (DEMO) return inviteFriend();
  const url = roomUrl(ROOM);
  const title = S.shareTitle(ROOM);
  if (isTouch && navigator.share) { try { await navigator.share({ title, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(url); toast(S.linkCopied(url), 3500); }
  catch { prompt(S.copyLink, url); }
};
// Säg till servern med jämna mellanrum att någon är här, så rummet inte städas bort.
setInterval(() => { if (document.visibilityState === 'visible') { api.visit(ROOM).catch(() => {}); noteVisit(ROOM); } }, 10 * 60_000);
noteVisit(ROOM); // one of my rooms now (the City is not): the plain address brings me back here

// ---------- Ladda rummet ----------
async function loadRoom() {
  try {
    const { stamps: list, images, info, cameras, peels } = await api.loadRoom(ROOM);
    showRoomInfo(info);
    applyGroove(info?.groove);
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
    // A sticker array comes as one stamp:add per copy (e.batch = { g, i, n }): one sound, one gesture per row.
    const quietCopy = !!(e.batch && typeof e.batch.g === 'string' && rowHeard(e.batch.g));
    if (!quietCopy && !(e.nonce && myNonces.has(e.nonce)) && !stamps.meshes.has(e.stamp.id)) sound.play('slap', e.stamp.position, { sound: together.voiceOf(e.by) });
    // Någon annans slap: deras gubbe slår handen mot väggen samtidigt som klibban dyker upp.
    // (by saknas från äldre klienter: då syns bara klibban, som förut.)
    if (!quietCopy && typeof e.by === 'string' && e.by !== together.net.id && !stamps.meshes.has(e.stamp.id)) together.players.gesture(e.by, 'slap', e.stamp.position, e.stamp.normal);
    stamps.add(e.stamp, e.image).then(updateCount);
  } else if (e.type === 'stamp:remove' && e.quiet) {
    // The automatic cleanup: a sticker nobody could see any more (completely covered). No sound.
    stamps.remove(e.id); updateCount();
    if (roomHistory(ROOM).some((h) => h.stampId === e.id)) { removeHistory([e.id]); scheduleHistory(); }
  } else if (e.type === 'stamp:remove') {
    const m = stamps.meshes.get(e.id);
    if (m && !myPeels.has(e.id)) sound.play('peel', m.userData.stamp.position, { sound: together.voiceOf(e.by) });
    if (m && typeof e.by === 'string' && e.by !== together.net.id && !myPeels.has(e.id)) together.players.gesture(e.by, 'peel', m.userData.stamp.position, m.userData.stamp.normal);
    stamps.peelAway(e.id).then(updateCount);
    if (roomHistory(ROOM).some((h) => h.stampId === e.id)) { removeHistory([e.id]); scheduleHistory(); }
  } else if (e.type === 'room:reset') onRoomReset(e);
  else if (e.type === 'room:clear-hidden') onClearHidden(e);
  else if (e.type === 'image:remove') {
    stamps.removeImage(e.id); peelLayer.removeImage(e.id); updateCount();
    if (e.removed && state.mine.some((m) => m.id === e.id)) dropDesigns([e.id]); // removed on purpose: out of my palette too
  }
  else if (e.type === 'room:peels') {
    if (e.on) api.loadRoom(ROOM).then((r) => syncPeels(r.info, r.peels, r.images)).catch(() => {});
    else { peelLayer.setOn(false); updatePeelUi(); }
  } else if (e.type === 'peels:clear') peelLayer.clear();
  else if (e.type === 'room:groove' && e.groove) applyGroove(e.groove, { flash: cleanGroove(e.groove).scale !== groove.scale });
  else if (e.type === 'room:style' && e.style) {
    currentStyle = normalizeStyle(e.style); updateStyleUi();
    if (!sp.open) { showStyle(currentStyle); toast(S.styleChanged, 1800); }
  } else if ((e.type === 'camera:add' || e.type === 'camera:update') && e.camera) { cams.upsert(e.camera); renderCams(); }
  else if (e.type === 'camera:remove') { cams.remove(e.id); if (camView === e.id) exitCamView(); renderCams(); }
  else if (e.type === 'room:closed') demoClosed();
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
    applyGroove(info?.groove);
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
  onWelcome: (m) => { if (groove && Number.isFinite(m.now)) groove.setServerClock(m.now); setRec(m.rec || null, { announce: m.rec && !rec ? 'joined' : null }); if (DEMO) demoWelcome(m); if (voice) voice.reset(); },
  onSound: (s) => sound.setMine(s),
  pass: () => (DEMO ? demo.passFor(ROOM) : null),
  onDenied: (m) => { if (DEMO && m.code === 'gone') demo.forgetRoom(ROOM); if (DEMO) demoClosed(demo.deniedText(m.code), m.code === 'gone' ? S.closedTitle : ' '); },
  onInvite: (m) => onInviteMsg(m),
  onPeople: (ids) => { if (voice) voice.setPeople(ids); },
  onSignal: (from, data) => { if (voice) voice.onSignal(from, data); },
});
// Full version (entitlements.js): free = calm default UI; the deep menus appear when unlocked.
const entitlementsReady = loadEntitlements().then(() => { together.entitlementsChanged(); onEntitlements(); fullUi.ready(); });
function onEntitlements() { $('sound-design-btn').hidden = !entitlements.full.soundDesign; applySizeLimit(); fullUi?.refreshEntry(); if (groove) updateGrooveUi(); if (autoSlap) autoSlap.render(); renderCams(); }
// Full version panel (fullversion.js): a quiet entry in ⚙ More → Help; a new key applies right away.
var fullUi = initFullVersion({ // eslint-disable-line no-var
  $, onOpen: () => { closeMore(); controls.unlock?.(); },
  onChange: () => { together.sendUnlock?.(credentials()); together.entitlementsChanged(); onEntitlements(); },
});
// ---------- Footstep groove (shared/groove.mjs) ----------
// Everyone hears the room's groove (free too, at the room's scale; 1.0× unless the creator changed it).
// The scale (bar length) is a deep sound control: the room's creator with the full version
// (soundDesign), or admin. Slider in ⚙ More → Sound, keys [ and ] (Shift = a whole octave).
// var: the WebSocket welcome can arrive before these lines have run.
var groove = new GrooveSteps(sound); // eslint-disable-line no-var
const canGroove = () => !DEMO && canEditStyle() && (!!state.adminToken || !!entitlements.full.soundDesign);
let grooveSend = null, grooveTimer = null, grooveLast = 0, chipTimer = null;
function updateGrooveUi({ flash = false } = {}) {
  const box = document.getElementById('groove-box'); if (!box) return;
  box.hidden = !canGroove();
  const s = groove.scale, l = grooveLabel(s);
  const slider = $('groove-scale'); if (document.activeElement !== slider) slider.value = scaleToSlider(s);
  $('groove-val').textContent = S.grooveValue(l.scale, l.bar);
  const chip = $('groove-chip'); chip.textContent = S.grooveChip(l.scale);
  chip.hidden = s === GROOVE.def && !flash; // calm: only when the room isn't at the default (or just changed)
  chip.classList.toggle('flash', flash);
  clearTimeout(chipTimer); if (flash) chipTimer = setTimeout(() => { chip.classList.remove('flash'); chip.hidden = groove.scale === GROOVE.def; }, 1800);
}
function applyGroove(g, opts) { groove.setGroove(cleanGroove(g)); updateGrooveUi(opts); }
// Change the scale: I hear it right away; the server (throttled to ~5 a second) tells everyone.
function setGrooveScale(scale) {
  if (!canGroove() || scale === null || scale === undefined) return;
  if (scale === groove.scale) return;
  groove.setGroove(retime(groove.groove, scale, groove.now()));
  updateGrooveUi({ flash: true });
  grooveSend = scale;
  const go = () => {
    grooveTimer = null; if (grooveSend === null) return;
    const s = grooveSend; grooveSend = null; grooveLast = Date.now();
    api.setGroove(ROOM, s, { key: roomKeys()[ROOM], admin: state.adminToken })
      .then((r) => { if (grooveSend === null && r && r.groove) applyGroove(r.groove); })
      .catch((err) => toast(err.message));
  };
  if (!grooveTimer) grooveTimer = setTimeout(go, Math.max(0, 200 - (Date.now() - grooveLast)));
}
$('groove-scale').oninput = (e) => setGrooveScale(sliderToScale(e.target.value));
$('groove-reset').onclick = () => setGrooveScale(GROOVE.def);
addEventListener('keydown', (e) => {
  if (isTouch || e.ctrlKey || e.metaKey || e.altKey || isTyping(e) || together.chatOpen()) return;
  if (e.code !== 'BracketLeft' && e.code !== 'BracketRight') return;
  if (!canGroove()) return; // not mine to change: the keys do nothing (no nagging)
  e.preventDefault();
  setGrooveScale(stepScale(groove.scale, e.code === 'BracketLeft' ? -1 : 1, e.shiftKey)); // [ = tighter (faster), ] = looser (slower)
});

// ---------- Auto-slap (autoslap.js + shared/autoslap.mjs) ----------
// The held sticker slaps by itself at the crosshair on a step sequence (on the Groove bar by default).
// Full version (soundDesign), like the Groove scale: a deep control. Desktop only (like arrays).
// Every auto slap goes the normal way (slapAt: optimistic, peels, sizes, room cap, cleanup,
// recording); a burst (from switching on / resuming until a pause, Z or 200 stickers) is ONE undo step.
let autoBurst = null, autoPrev = null, autoInFlight = 0;
function newBurst() { let resolve; const first = new Promise((r) => { resolve = r; }); return { first, resolve, count: 0, ended: false, peeled: false }; }
function autoCanFire() {
  if (!controls.locked) return 'unlocked';
  if (state.mode !== 'slap') return 'look';
  if (document.visibilityState !== 'visible') return 'hidden';
  if (sp.open || together.busy() || together.chatOpen() || !$('more-panel').hidden || endDlg.open || linkDlg.open) return 'menu';
  if (camView || placingCam) return 'camera';
  if (arrayDrag || mouseHeld) return 'drag';
  if (!state.selected || state.adminToken) return 'nodesign';
  return true;
}
function autoFire(step) {
  if (autoInFlight >= AUTO.maxInFlight) return 'busy';
  const h = hitSurface(CENTER); if (!h) return 'nosurface';
  if (!movedEnough(autoPrev, h.point.toArray(), h.surface, state.size)) return 'still'; // no pile in one spot
  if (!autoBurst || autoBurst.ended || autoBurst.count >= AUTO.maxBurst) autoBurst = newBurst();
  const b = autoBurst, first = b.count === 0; b.count++;
  let started = false; autoInFlight++;
  const auto = { burst: b, first, volume: step.vol / 100, started: (hh) => { started = true; autoPrev = { point: hh.point.toArray(), surface: hh.surface }; } };
  Promise.resolve(stampAt(CENTER, { auto })).finally(() => {
    autoInFlight--;
    if (first && !started) { b.resolve(null); b.ended = true; } // refused before it showed: nothing to join
  });
  return true;
}
var autoSlap = initAutoSlap({ $, S, groove, // eslint-disable-line no-var
  canUse: () => !DEMO && !isTouch && !!entitlements.full.soundDesign,
  canFire: autoCanFire, fire: autoFire,
  onPause: () => { if (autoBurst) autoBurst.ended = true; autoPrev = null; },
});
addEventListener('keydown', (e) => {
  if (isTouch || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e) || together.chatOpen()) return;
  if (!['KeyH', 'Comma', 'Period'].includes(e.code)) return;
  if (autoSlap.key(e.code)) { e.preventDefault(); if (e.code === 'KeyH') toast(autoSlap.on ? S.aslapOnToast : S.aslapOffToast, 1500); }
});
addEventListener('pagehide', () => autoSlap.setOn(false)); // leaving the room

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
  let list = [], videos = [], photos = [];
  try { ({ recordings: list } = await api.listRecs(ROOM, auth())); } catch { return; }
  try { ({ videos } = await api.listVideos(ROOM, auth())); } catch { /* older server: no videos */ }
  try { ({ photos } = await api.listPhotos(ROOM, auth())); } catch { /* older server: no photos */ }
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
  // Photos (📷 / P, live or from a replay), next to the videos; each has its own /p/<id> link.
  for (const p of photos) {
    const li = document.createElement('li');
    const pa = document.createElement('a'); pa.href = p.url; pa.target = '_blank'; pa.rel = 'noopener'; pa.className = 'rec-photo';
    pa.textContent = `📷 ${new Date(p.createdAt).toLocaleString(LOCALE, { dateStyle: 'short', timeStyle: 'short' })} · ${p.width}×${p.height}`;
    li.appendChild(pa); ul.appendChild(li);
  }
}

// ---------- 📷 Photo (button, P, and 📷 while looking through a camera) ----------
// Exactly what you see (first or third person, or the camera you look through), re-rendered at
// ≥ 1920 px without the aim preview and the camera models; downloaded at once and saved online.
let photoBusy = null, lastPhoto = null;
function snapPhoto() {
  if (photoBusy) return photoBusy;
  photoBusy = (async () => {
    const cv = camView && cams.get(camView);
    const cam = cv ? viewCam : third() ? tpCam : camera;
    photo.flash(); photo.shutter(sound.ensure(), { muted: sound.muted });
    const wasHidden = cams.hidden;
    const shot = await photo.capture({ THREE, renderer, scene, camera: cam, aspect: cv ? aspectRatio(cv.aspect) : null, free: !entitlements.full.cleanVideo,
      hide: () => { preview.hide(); cams.setHideAll(true); return () => cams.setHideAll(!!wasHidden); } });
    const name = photo.photoName(ROOM);
    photo.download(shot.blob, name);
    lastPhoto = { name, w: shot.w, h: shot.h, bytes: shot.blob.size, upload: null, error: null };
    try {
      const j = await photo.upload(shot.blob, { room: ROOM, source: 'live', view: cv ? (cv.auto ? `autocam:${cv.id}` : `cam:${cv.id}`) : third() ? 'third' : 'eyes' });
      lastPhoto.upload = j; toast(S.photoSaved(j.shareUrl), 4000);
      if (canEditStyle() || canReset()) renderRecs();
    } catch (err) { lastPhoto.error = err.message; toast(S.photoFailed(err.message), 4000); }
    return lastPhoto;
  })().finally(() => { photoBusy = null; });
  return photoBusy;
}
$('photo-btn').onclick = (e) => { e.preventDefault(); snapPhoto(); };
$('camview-photo').onclick = (e) => { e.preventDefault(); snapPhoto(); };

// Kameror: "🎥 Placera kamera här" ställer en kamera där jag står, åt det håll jag tittar.
function renderCams() {
  const ul = $('cam-list'); ul.innerHTML = '';
  const multi = !!entitlements.full.multiCam, autos = autoCamsOf(cams.list());
  $('autocam-free').hidden = multi; $('autocam-on').checked = autos.length > 0;
  $('autocam-add').hidden = !multi; $('autocam-add').disabled = autos.length >= MAX_AUTO_CAMS;
  for (const c of cams.list()) {
    const li = document.createElement('li'); li.dataset.id = c.id;
    if (c.auto) { // a cameraman: no name/fov/format/move; the full version may pick its path
      const b = document.createElement('span'); b.className = 'cam-name'; b.textContent = S.camAutoName(c);
      li.append(b);
      if (multi) {
        const sel = document.createElement('select'); sel.className = 'cam-path'; sel.title = S.camAutoPath;
        for (const v of ['seeded', ...AUTO_CHOICES.filter((x) => x !== 'seeded')]) { const o = document.createElement('option'); o.value = v; o.textContent = S.autoPaths[v]; sel.appendChild(o); }
        sel.value = c.auto; sel.onchange = () => updateCam(c.id, { auto: sel.value });
        li.append(sel);
      }
      const look = document.createElement('button'); look.type = 'button'; look.textContent = '👁'; look.title = S.camLook; look.className = 'cam-look'; look.onclick = () => enterCamView(c.id);
      const del = document.createElement('button'); del.type = 'button'; del.textContent = '✕'; del.title = S.camDel; del.className = 'cam-del'; del.onclick = () => removeCam(c.id);
      li.append(look, del); ul.appendChild(li); continue;
    }
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
// 🎥 Auto cameraman. Stored like cameras ({ auto, start? }), so they are in the recording and the
// replay shows each one's take (and the director uses them as the room shot in silences).
//   free / demo: the checkbox = the one automatic cameraman on/off, nothing to set
//   full version (multiCam): ＋ Add cameraman → click the floor where it starts (up to 6)
async function addAutoCam(body = { auto: 'seeded' }) {
  try { const { camera: c } = await api.addCamera(ROOM, body, auth()); cams.upsert(c); renderCams(); toast(body.start ? S.camAutoPlaced(c.name) : S.camAutoOn, 2400); return c; }
  catch (err) { toast(err.message, 3000); renderCams(); return null; }
}
async function setAutoCam(on) {
  const cur = autoCamsOf(cams.list());
  if (!on) { for (const c of cur) await removeCam(c.id); return true; }
  return cur.length ? cur[0] : addAutoCam();
}
$('autocam-on').onchange = (e) => setAutoCam(e.target.checked);
// var: action() and the click handlers above use it.
var placingCam = false; // eslint-disable-line no-var
function startPlacingCam() {
  if (autoCamsOf(cams.list()).length >= MAX_AUTO_CAMS) return false;
  placingCam = true; document.body.classList.add('placing-cam'); closeMore();
  toast(S.camAutoPlace(isTouch), 5000);
  return true;
}
function cancelPlacingCam() { placingCam = false; document.body.classList.remove('placing-cam'); }
// The click: the floor point under the crosshair (a wall: 1 m into the room in front of it).
function placeCamAt(ndc) {
  const h = hitSurface(ndc); cancelPlacingCam();
  if (!h) { toast(S.camAutoMissed, 2500); return null; }
  const p = h.point.clone(); if (Math.abs(h.normal.y) < 0.7) p.addScaledVector(h.normal, 1);
  return addAutoCam({ auto: 'seeded', start: [+p.x.toFixed(3), +p.z.toFixed(3)] });
}
$('autocam-add').onclick = () => startPlacingCam();
// Live it is a preview: the takes restart every hour (UTC), so everybody's preview agrees; the
// recorded takes are computed in the replay from the recording itself (deterministic).
const liveAuto = { key: '', crew: null, t0: 0 };
function liveCrew() {
  const list = autoCamsOf(cams.list()); if (!list.length) return null;
  const t0 = Math.floor(Date.now() / 3600000) * 3600000, key = `${t0}|${list.map((c) => `${c.id}:${c.auto}:${c.start || ''}`).join(',')}`;
  if (liveAuto.key !== key) {
    liveAuto.key = key; liveAuto.t0 = t0;
    liveAuto.crew = createAutoCrew(list.map((c) => ({ key: c.id, path: c.auto, seed: c.id, start: c.start })), { provider: liveStickerTargets(() => [...stamps.meshes.values()].map((m) => m.userData.stamp).filter((s) => s && !s.pending), t0), focus: livePeople });
  }
  return liveAuto.crew;
}
// The people in the room right now (me included), for the cameramen: they keep everyone in frame.
const livePeople = groupFocus(() => [{ id: 'me', p: [camera.position.x, camera.position.y, camera.position.z] },
  ...[...together.players.map.values()].map((pl) => ({ id: pl.id, p: [pl.pos.x, camera.position.y, pl.pos.z] }))]);
function liveAutoPose(c) { const crew = liveCrew(), m = crew && crew.get(c.id); return m ? m.poseAt(Date.now() - liveAuto.t0) : null; }
$('cam-show').checked = camShow;
$('cam-show').onchange = (e) => { camShow = e.target.checked; localStorage.setItem('klibb.camShow', camShow ? '1' : '0'); cams.setVisible(state.mode !== 'view' && camShow); };

// "Titta genom kamera": skärmen visar exakt det kameran ser (med svarta kanter för 16:9 / 9:16).
// var: används i action() och frame() som kan köras innan den här raden.
var camView = null; // eslint-disable-line no-var
function enterCamView(id) {
  const c = cams.get(id); if (!c) return false;
  camView = id; controls.unlock(); preview.hide(); cams.setHideAll(true);
  document.body.classList.add('camview');
  $('camview-hud').hidden = false; $('camview-name').textContent = c.auto ? S.camAutoName(c) : S.camViewLabel(c);
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
// var: setView() runs at start-up, before this line's neighbours below are reached.
var selfShown = null; // eslint-disable-line no-var -- together.showSelf(): third person, or looking through a camera
function setView(v, { quiet = false } = {}) {
  view = saveView(v);
  const t = view === 'third';
  document.body.classList.toggle('third-person', t);
  chase.eye = null; chase.dist = null; // börja om utan glidning
  together.showSelf(t); selfShown = t;
  $('view-first').setAttribute('aria-pressed', String(!t)); $('view-third').setAttribute('aria-pressed', String(t));
  $('view-btn').setAttribute('aria-pressed', String(t));
  $('view-btn').title = t ? S.viewBtnToFirst : S.viewBtnToThird;
  $('sm-view').setAttribute('aria-pressed', String(t)); $('sm-view').querySelector('.sm-lab').textContent = t ? S.smViewFirst : S.smView;
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

// Footsteps (groove.js + shared/groove.mjs): everyone who walks plays their slot's polyrhythm on
// ONE shared bar, so the room's footsteps are one groove. Mine while I walk, the others' from where they walk.
function walkSounds() {
  const walkers = [{ id: 'me', x: camera.position.x, z: camera.position.z, at: null }];
  for (const pl of together.players.map.values()) walkers.push({ id: pl.id, x: pl.pos.x, z: pl.pos.z, at: [pl.pos.x, 0.05, pl.pos.z], voice: together.voiceOf(pl.id) }); // their seed + slot colour
  groove.update(walkers);
}

// ---------- Demo: the hour, invites, the closing card (demo.js) ----------
// var: the WebSocket welcome can arrive before these lines have run.
var demoTimer = null, demoEnded = false, inviteWanted = false, inviteState = 'none'; // eslint-disable-line no-var
function demoWelcome(m) {
  demo.onWelcome(ROOM, m);
  if (m.expiresAt && !demoTimer) {
    demoTimer = demo.startTimer({ expiresAt: m.expiresAt, serverNow: m.serverNow,
      onWarn: (min) => { toast(S.demoWarn(min), 5000); together.sys(S.demoWarn(min)); },
      onEnd: () => setTimeout(() => { if (!demoEnded) demoClosed(); }, 4000) }); // the server closes the room; this is the fallback
  }
  together.net.sendInvite('status');
}
// title ' ' = refused at the door (no heading), '' = the room's hour is over.
function demoClosed(text = '', title = '') {
  if (demoEnded) return;
  demoEnded = true;
  if (demoTimer) demoTimer();
  if (voice) voice.closeAll();
  try { controls.unlock?.(); preview.hide(); closeMore(); } catch { /* before the room is up */ }
  const mine = readHistory().filter((h) => h.room === ROOM).map((h) => h.stampId);
  if (!text && mine.length) removeHistory(mine);
  if (!text) demo.forgetRoom(ROOM);
  demo.showClosed(text || S.closedText, title.trim() ? { title } : title ? { title: '' } : {});
}
// ✉ Invite a friend: one single-use link per person (the server keeps track).
function inviteNote(text) { const n = $('invite-note'); n.hidden = !text; n.textContent = text || ''; }
async function shareInvite(token) {
  const url = demo.inviteUrl(ROOM, token);
  window.klibb && (window.klibb.lastInvite = url);
  if (isTouch && navigator.share) { try { await navigator.share({ title: S.inviteShareTitle, url }); inviteNote(S.inviteOpen); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(url); toast(S.inviteCopied, 3500); } catch { toast(S.inviteOpen, 3500); prompt(S.copyLink, url); }
  inviteNote(S.inviteOpen);
}
function inviteFriend() {
  const saved = demo.myInvite(ROOM);
  if (saved && inviteState === 'open') return shareInvite(saved);
  inviteWanted = true;
  if (!together.net.sendInvite('create')) { inviteWanted = false; toast(S.noConnection); }
  return null;
}
function onInviteMsg(m) {
  if (m.ok && m.token) { demo.saveInvite(ROOM, m.token); inviteState = 'open'; if (inviteWanted) { inviteWanted = false; shareInvite(m.token); } return; }
  inviteWanted = false;
  if (!m.ok) {
    if (m.code === 'used') { inviteState = 'used'; inviteNote(S.inviteUsed(m.name)); $('share-room').disabled = true; } else if (m.code === 'full') inviteNote(S.inviteFull); else toast(m.error || S.inviteFull);
    return;
  }
  const st = m.status; if (!st) return;
  inviteState = st.state;
  if (st.state === 'used') inviteNote(S.inviteUsed(st.name));
  else if (st.state === 'open' && demo.myInvite(ROOM)) inviteNote(S.inviteOpen);
  else if (st.left === 0) inviteNote(S.inviteFull);
  else inviteNote(S.inviteNone);
  $('share-room').disabled = st.state === 'used' || (st.state === 'none' && st.left === 0);
}
if (DEMO) {
  $('share-room').textContent = S.invite; $('share-room').title = S.inviteTitle;
  for (const el of document.querySelectorAll('.help.desktop-only')) el.innerHTML = S.helpDemoDesktopHtml;
  for (const el of document.querySelectorAll('.help.touch-only')) el.innerHTML = S.helpDemoTouchHtml;
  const qh = document.querySelector('.hint[data-t="quickHelp"]'); if (qh) qh.textContent = S.quickHelpDemo;
}

// ---------- Voice chat (voice.js): 🎙 / B ----------
// var: together's welcome may call voice.reset() before this line has run (then it is undefined).
var voice = new Voice({ // eslint-disable-line no-var
  net: together.net, sound,
  positionOf: (id) => { const pl = together.players.map.get(id); return pl ? { x: pl.pos.x, z: pl.pos.z } : null; },
  listener: () => ({ x: camera.position.x, z: camera.position.z }),
  onSpeaking: (id, on, level) => { together.setSpeaking(id, on, level); if (id === 'me') for (const b of micBtns()) b.classList.toggle('speaking', !!on); },
  onState: (st) => renderMic(st),
  toast: (k) => toast({ on: S.micOnToast, muted: S.micMutedToast, denied: S.micDenied, unsupported: S.micUnsupported }[k] || '', 1800),
});
voice.recording = () => !!rec; // voice levels go to the server only while ● REC (voice.js)
voice.reset = () => { for (const id of [...voice.peers.keys()]) voice.drop(id); voice.setPeople([...together.players.map.keys()]); };
voice.near = localStorage.getItem('klibb.voiceNear') !== '0';
$('voice-near').checked = voice.near;
$('voice-near').onchange = (e) => { voice.near = e.target.checked; localStorage.setItem('klibb.voiceNear', voice.near ? '1' : '0'); };
function micBtns() { return [$('mic-btn'), $('mic-touch'), $('sm-mic')]; }
function renderMic(st = voice.state) {
  for (const b of micBtns()) {
    b.dataset.state = st; b.setAttribute('aria-pressed', String(st === 'on'));
    const t = st === 'on' ? S.micTitleOn : st === 'muted' ? S.micTitleMuted : S.micTitleOff;
    b.title = t; b.setAttribute('aria-label', t);
  }
}
for (const b of micBtns()) b.onclick = (e) => { e.preventDefault(); voice.toggle(); };
addEventListener('keydown', (e) => {
  if (isTouch || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e) || together.chatOpen()) return;
  if (e.code === 'KeyB') voice.toggle();
});
renderMic();

// ---------- Huvudloopen ----------
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (!camView) controls.update(dt);
  for (const ac of autoCamsOf(cams.list())) { const q = liveAutoPose(ac); if (q) cams.place(ac.id, q); }
  let cv = camView && cams.get(camView);
  if (cv && cv.auto) { const q = liveAutoPose(cv); if (q) cv = { ...cv, ...q }; }
  if (cv) poseCamera(viewCam, { p: cv.p, yaw: cv.yaw, pitch: cv.pitch, fov: cv.fov });
  const tp = !cv && view === 'third';
  if (tp) updateChase(dt);
  const eyeCam = cv ? viewCam : tp ? tpCam : camera;
  // Looking through a camera (a placed one or an auto cameraman): my own avatar stands where I
  // stand and is filmed too (also in first person, where it is otherwise not built), unless that
  // camera is right at it. Back in my own eyes the first-person view hides it again.
  const wantSelf = view === 'third' || !!cv;
  if (wantSelf !== selfShown) { selfShown = wantSelf; together.showSelf(wantSelf); }
  const camAtMe = cv && Math.hypot(camera.position.x - viewCam.position.x, camera.position.z - viewCam.position.z) < 0.45;
  // gubbar precis vid kameran döljs, och min egen om kameran kommer för nära (t.ex. mot en vägg)
  together.update(dt, eyeCam.position, { hideSelf: cv ? camAtMe : !tp || chase.dist < CHASE.hideBelow });
  cams.update(cv ? null : eyeCam.position);
  peelLayer.update();
  walkSounds();
  autoSlap.tick();
  voice.update();
  updateCredit();
  { const cam = cv ? viewCam : camera; cam.getWorldDirection(fwd); sound.setListener(cam.position, fwd); }
  if (arrayDrag && controls.locked && updateArray()) preview.hide(); // dragging a row: the ghosts are the preview
  else if (controls.locked && state.selected && !state.adminToken && state.mode === 'slap') {
    const h = hitSurface(CENTER);
    if (h) {
      const [w, hh] = StampLayer.dims(state.selected, Math.min(state.size, maxSizeCm() / 100));
      preview.show(h.point, h.normal, StampLayer.orientation(h.normal, h.dir, nextRotation()), w, hh, h.surface);
    } else preview.hide();
  }
  if (cv) renderFramed(renderer, scene, viewCam, cv.aspect || '');
  else { if (camView) exitCamView(); renderer.render(scene, tp ? tpCam : camera); }
  requestAnimationFrame(frame);
}

renderTray();
renderHistory();
if (!DEMO && state.mine.length) select(last(state.mine));
// The library (the demo's palette; also loaded outside the demo for later use).
const LIB_SEL = 'klibb.libSel';
const libraryReady = fetch('/api/library').then((r) => r.json()).then(({ stickers }) => {
  state.library = Array.isArray(stickers) ? stickers : [];
  if (!DEMO) return;
  const keep = localStorage.getItem(LIB_SEL);
  renderTray(); select(state.library.find((d) => d.id === keep) || state.library[0]);
}).catch(() => {});
if (DEMO) addEventListener('pagehide', () => { if (state.selected) localStorage.setItem(LIB_SEL, state.selected.id); });
initAdmin();
Promise.all([loadRoom(), validateDesigns(), libraryReady]).then(() => { window.klibb.ready = true; if (canEditStyle()) renderRecs(); });
frame();

// updateViaCache: 'none' = webbläsaren kollar alltid efter en ny sw.js, så appen inte fastnar på en gammal version.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
}

// Små hjälpfunktioner för automatiska tester (och för nyfikna i konsolen).
window.klibb = {
  demo: DEMO, config, voice: () => voice.info(), voiceObj: () => voice, toggleMic: () => voice.toggle(), library: () => state.library.slice(),
  demoState: () => ({ timer: $('demo-timer').hidden ? null : $('demo-timer').textContent, closed: !$('demo-closed').hidden, closedTitle: $('demo-closed-title').textContent,
    closedText: $('demo-closed-text').textContent, invite: inviteState, inviteNote: $('invite-note').hidden ? '' : $('invite-note').textContent, left: demoTimer && demoTimer.left ? demoTimer.left() : null }),
  inviteFriend, mySlot: () => together.mySlot(), talking: () => together.talking(),
  soundUi: () => soundUi, resuming: () => resuming, escGate, openStylePanel: (m = 'edit') => openStylePanel(m), styleOpen: () => sp.open, synthShared: () => synthShared, soundSteps: () => groove.events,
  groove: () => ({ ...groove.groove, offset: groove.offset, now: groove.now(), events: groove.events, buzzing: groove.buzzing, log: groove.log.slice(), tracks: [...groove.track].map(([id, t]) => ({ id, v: +t.v.toFixed(3), walking: t.walkUntil > groove.now(), buzz: !!t.buzz })), canChange: canGroove(), ui: { hidden: $('groove-box').hidden, slider: +$('groove-scale').value, value: $('groove-val').textContent, chip: $('groove-chip').hidden ? '' : $('groove-chip').textContent } }),
  setGrooveScale, grooveObj: () => groove,
  autoSlap: () => autoSlap.info(), autoSlapObj: () => autoSlap, soundMine: () => sound.mine, voiceOf: (id) => together.voiceOf(id),
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
  arrayState: () => ({ dragging: !!arrayDrag, ghosts: ghosts.count, inFlight: arrayOps.length, items: arrayDrag ? arrayDrag.items.length : 0 }), arrayPlan,
  pendingSlaps: () => pendingSlaps.size, // klibbor som syns men inte är bekräftade av servern än
  styleFromSeed, randomSeed, normalizeStyle, currentStyle: () => currentStyle, canEditStyle, surfaces: room.surfaces,
  net: together.net, players: () => together.players.list(), me: together.me, openChat: together.openChat,
  openAvatarPanel: together.openAvatarPanel, avatarModel: () => import('./avatars.js').then((m) => m.loadAvatarModel()).then(() => true),
  photo: () => snapPhoto(), lastPhoto: () => lastPhoto,
  setAutoCam, startPlacingCam, placingCam: () => placingCam, autoCamPoses: () => Object.fromEntries(autoCamsOf(cams.list()).map((c) => [c.id, liveAutoPose(c)])),
  autoCamPose: () => { const c = autoCamsOf(cams.list())[0]; return c ? liveAutoPose(c) : null; },
  cameras: () => cams.list(), camerasVisible: () => [...cams.map.values()].some((e) => e.obj.visible), addCamera: addCam, updateCamera: updateCam, removeCamera: removeCam,
  creditAtDot: () => creditOf(pickStampAt(CENTER)?.stamp), clickCredit,
  credit: () => ({ shown: !!credit.shown && !$('credit').hidden, name: $('credit-name').textContent, link: $('credit-link').getAttribute('href') || '',
    label: $('credit-link').textContent, hint: $('credit-hint').textContent, tap: $('credit').classList.contains('tap'),
    rect: $('credit').hidden ? null : $('credit').getBoundingClientRect().toJSON() }),
  linkDialog: () => ({ open: linkDlg.open, url: $('link-url').textContent, href: $('link-open').getAttribute('href'), rel: $('link-open').rel, target: $('link-open').target }),
  cleanArtistLink,
  endDialog: () => ({ open: endDlg.open, shows: endShows, title: $('end-title').textContent, question: $('end-q').textContent, action: $('end-action').textContent, keep: $('end-keep').textContent }),
  sound, soundLog: () => sound.log.slice(), openMore, closeMore, fullUi: () => fullUi, moreOpen: () => !$('more-panel').hidden,
  enterCamView, exitCamView, camView: () => camView, viewCam, rec: () => rec, renderRecs,
  held: () => stackMenu?.info() ?? null, stackMenu: () => stackMenu,
  setView, toggleView, view: () => view, tpCam, chase: () => ({ ...chase.pose, cam: tpCam.position.toArray() }), selfAvatar: () => together.selfInfo(), peels: () => peelLayer.info(), peelPose: (id) => peelLayer.poseOf(id), nopes: () => nopes,
  peelOverlap: (pos, quat, size) => peelLayer.overlap(state.selected, { position: pos, quaternion: quat, size }), fabricStats: () => together.fabricStats(), previewFabrics: () => together.previewFabrics(), freezeGestures: (ms) => together.freezeGestures(ms), handPos: () => together.handPos(),
  nextDesign, prevDesign, designs, validateDesigns, removeDesign, undoRemove, toggleFav, undoMs: UNDO_MS, setMode, toggleMode, peelLast, peelAll, roomHistory: () => peelable(), peelSettled, peelLimit: PER_ROOM, setSize, get maxSizeCm() { return maxSizeCm(); }, freeMaxCm: FREE_MAX_CM, get minSizeCm() { return minSizeCm(); }, freeMinCm: FREE_MIN_CM, startSizeCm: (img) => startSizeCm(img, { minCm: minSizeCm(), maxCm: maxSizeCm() }),
};

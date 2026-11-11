// Slap and Talk – startpunkten för webbappen. Här kopplas allt ihop:
// rummet (room.js), styrningen (controls.js), stämplarna (stamps.js) och servern (api.js).
import * as THREE from 'three';
import { buildBoxRoom } from './room.js';
import { startSizeCm } from '../../shared/sizeprefix.mjs';
import { sizeLimitsCm, isNature, NATURE, STICKER_LIMITS } from '../../shared/nature.mjs';
import { CATALOG, DEFAULT_STYLE, normalizeStyle, styleFromSeed, randomSeed, styleName, applyStyle, swatchUrl, tickRoomFabric, roomFabricInfo, SURF_KINDS } from './roomstyle.js';
import { initFargUI, initFabricPicker } from './fargui.js';
import { FirstPersonControls, isTyping } from './controls.js';
import { StampLayer, StampPreview } from './stamps.js';
import { createWheel } from './wheel.js';
import { api } from './api.js';
import { foldStamp } from './fold.js';
import { readHistory, addHistory, removeHistory, roomHistory, trimHistory, deviceId, HISTORY_KEY, PER_ROOM } from './history.js';
import { readMine, addMine, insertMine, removeMine, updateMine, saveBlob, deleteBlob, getBlob, readFavs, setFav, moveFav, FAV_KEY, clearMineForNewRoom } from './designs.js';
import { initTogether } from './together.js';
import { CameraLayer, CAMERA_FOVS, CAMERA_ASPECTS, poseCamera, renderFramed, aspectRatio } from './cameras.js';
import * as photo from './photo.js';
import { createAutoCrew, liveStickerTargets, AUTO_CHOICES, autoCamsOf, MAX_AUTO_CAMS } from '../../shared/autocam.mjs';
import { groupFocus } from '../../shared/personcam.mjs';
import { S, LOCALE, cityAgeText } from './strings.js';
import { Sounds } from './sound.js';
import { showPose, freeRect } from './avatarview.js';
import { CHASE, chaseOpts, chasePose, smoothDist, aimNear, surfaceCaster, loadView, saveView, nextView, frontPose, FRONT } from './chasecam.js';
import { cleanArtistLink, cleanArtistName, linkLabel } from '../../shared/artistlink.mjs';
import { PeelLayer } from './peels.js';
import { PEEL, peelPlan, pathParams, dropsPaper, onFloor, stampDims } from '../../shared/peels.mjs';
import { entitlements, loadEntitlements, credentials, setStudioUnlock } from './entitlements.js';
import { uploadsToReplace, shownUploads } from '../../shared/uploads.mjs';
import { openNameTag as openNameTagTool, nameTagOpen, nameTagState } from './nametag.js';
import { openDoorPick, doorOpen, doorState } from './door.js';
import { testBusEnabled, isTestBusCity, hallColorFor, openBusSheet, closeBusSheet, busSheetOpen, startCityBots, hitBusStop, TESTBUS_PARAM } from './citybus.js';
import { readPacks, PACKS_MAX } from './packswheel.js';
import { seededLook, roomCharacterSeed } from '../../shared/randomlook.mjs';
import AVATAR_SPEC from '../../shared/avatar.json';
import { initFullVersion } from './fullversion.js';
import { GrooveSteps } from './groove.js';
import { GROOVE, cleanGroove, retime, sliderToScale, scaleToSlider, stepScale, grooveLabel } from '../../shared/groove.mjs';
import { loadSoundLook, initSoundUI, resetPersonalSound, prepareSoundForPlace, personalGet, personalSet, setSoundRoom, soundKey, loadRunMode, VOICE_FX_KEY, VOICE_MON_KEY, VOICE_MIC_KEY } from './soundui.js';
import { runRate, pitchRatio } from '../../shared/runmode.mjs';
import { setDanceClock } from './avatars.js';
import { Radio, radioBlock, fetchRoomPreset, putRoomPreset } from './radio.js';
import * as synthShared from '../../shared/synth.mjs';
import { config } from './config.js';
import * as demo from './demo.js';
import { noteVisit } from './landing.js';
import { Voice, VOICE_FX, cleanVoiceFx, cleanMonitor, pitchLabel } from './voice.js';
import { ArrayGhosts } from './arraydrag.js';
import { arrayPlan, faceFor, PEELS_PER_ARRAY, wheelScaleFactor, clampStampSize } from '../../shared/array.mjs';
import { boxFaces } from '../../shared/coverage.mjs';
import { initStackMenu } from './stackmenu.js';
import { createHeldTimer } from '../../shared/heldtimer.mjs';
import { createRoomSizer, ROOM_RANGE } from './roomsize.js';
import { PresetLayer, bakeFaces, PRESET_PX_PER_M } from './preset.js';
import { WHEEL_EXCLUDE, FORMER_MENU_IDS } from './menustickers.js';
import { initEscMenu } from './escmenu.js';
import { SlapFx } from './slapfx.js';
import { wheelOrder, applySwaps, WHEEL_START } from '../../shared/wheelorder.mjs';
import { buildCityRoom, markDoors } from './city.js';
import { CITY_FX, cityFxAt, placeNeutral, placeHouse, cleanCityFx, PLACE_EVERY_MS, PLACE_SLEW } from '../../shared/cityfx.mjs';
import { delayRoomTimes } from '../../shared/delayroom.mjs';
import { slapHold } from '../../shared/dancehold.mjs';
import { reverbGazeYaw, reverbPitchesAt, insideReverbRoom } from '../../shared/reverbroom.mjs';
import { CITY, CITY_ROOM, isCityRoom, isCityOutside, cityOf, houseNumber, houseId, plotOfHouse, spawnOutside, natureMaxHeightCmIn, CITY_BUILD_PHASE, BUILD_CITY, isBuildCity, isKeptHouse, KEPT_HOUSES, HOUSE_MAX, SUBWAY_SPAWN } from '../../shared/city.mjs';
import { cityWheel, isPackDesign, PACK_DESIGN_ID, refreshPackPicture, openTownHall, townHallOpen, townHallState, takenPacks, readKept, DECK_MAX, openCityPick, cityPickOpen, cityPickState, cityApi } from './citymode.js';
import { enterCity, leaveCity } from './cityleave.js';
import { initProps } from './propsmode.js';
import { canEditProps, propMeshSurface } from '../../shared/props.mjs';
import { unlockHeaders } from './entitlements.js';
import { FilmLog } from './filmlog.js';
import { runFilm, filmState, filmBlob, filmPreview } from './filmui.js';
import { HighlightLog } from './highlightlog.js';
import { HighlightStore } from './highlightstore.js';
import { offerHighlightReel, highlightState, highlightBlob, highlightPreview } from './highlightui.js';
import { findCrossCameraMoments, reelCameras, cityBounds as highlightCityBounds } from '../../shared/highlight.mjs';
import { roomBounds as highlightRoomBounds } from '../../shared/autocam.mjs';
import { FILMS_ENABLED } from '../../shared/features.mjs';
import { createStudioJam } from './studiojam.js';

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

// The cities (t476u, t479u – 2 Nov 2026): ?room=stad-<code> is a city itself (?room=stad the first one;
// shared/city.mjs, city.js) – plots, houses, the Town Hall; its 8 houses (stad-<code>-1 … -8) are
// ordinary box rooms you walk into, started in order. In all of them ("in the city", IN_CITY) the wheel
// holds only what you brought (citymode.js). THIS_CITY = the city's own id (its outside).
const CITY_OUTSIDE = isCityOutside(ROOM), IN_CITY = isCityRoom(ROOM), THIS_CITY = cityOf(ROOM);
// The rebuild (Jens, 10 Nov 2026): only houses 1, 3, 6, 8 are rooms now – an old link to house 2/4/5/7 lands outside.
if (IN_CITY && houseNumber(ROOM) && !isKeptHouse(houseNumber(ROOM))) location.replace(`${location.origin}/?room=${THIS_CITY}`);
const IN_HOUSE = IN_CITY && !CITY_OUTSIDE && isKeptHouse(houseNumber(ROOM)); // a kept house: a quiet room (PLACE_HOUSE)
// FILMS_ENABLED (shared/features.mjs): closed room – code/media stay, no film or reel in the experience.
const filmLog = (FILMS_ENABLED && !IN_CITY) ? new FilmLog(ROOM) : null; // the session film (filmThenCity)
const highlightLog = FILMS_ENABLED ? new HighlightLog(ROOM) : null; // room AND city – automatic cameraman moments
const highlightStore = FILMS_ENABLED ? new HighlightStore(ROOM) : null;
const highlightCrew = FILMS_ENABLED
  ? reelCameras(CITY_OUTSIDE ? highlightCityBounds() : highlightRoomBounds(), { city: !!CITY_OUTSIDE, seed: ROOM })
  : [];
if (highlightLog && !highlightLog.has('start')) highlightLog.add('start', { room: ROOM, city: !!IN_CITY });
if (filmLog && !filmLog.has('start')) filmLog.add('start', { room: ROOM });
// leaving a city drops the packs a free player took; a new visit to a city starts with only my pack
let busKeep = false; try { busKeep = sessionStorage.getItem('klibb.busKeep') === '1'; if (busKeep) sessionStorage.removeItem('klibb.busKeep'); } catch { /* fine */ }
const carryReady = IN_CITY ? enterCity(THIS_CITY, { keepPacks: busKeep }) : leaveCity();
const TESTBUS = testBusEnabled({ search: location.search }); // only ?testbus=1 – never auto-on for random visitors
// Temporary film-studio mode (Jens, Nov 2026): ?studio=1 (or localStorage klibb.studio=1).
// Unlocks the whole sticker library in the city as switchable wheels + mic jam recording.
// Off by default so normal players are unaffected. Toggle live with J (Shift+J also) or klibb.setStudio.
const STUDIO_KEY = 'klibb.studio';
let FILM_STUDIO = params.get('studio') === '1' || params.get('studio') === 'true'
  || (() => { try { return localStorage.getItem(STUDIO_KEY) === '1'; } catch { return false; } })();
document.body.classList.toggle('film-studio', FILM_STUDIO);
setStudioUnlock(FILM_STUDIO); // patches / fabrics / sticker gates open in film studio
var cityBusBots = null; // eslint-disable-line no-var
var cityBusSession = null; // eslint-disable-line no-var
const room = CITY_OUTSIDE ? buildCityRoom({ hallColor: TESTBUS ? hallColorFor(ROOM) : null, busStop: !!(TESTBUS && isTestBusCity(ROOM)) }) : buildBoxRoom(); // senare: await loadGltfRoom('/rum/stad.glb')
scene.add(room.group);
if (room.camFar) { camera.far = room.camFar; camera.updateProjectionMatrix(); }
document.body.classList.toggle('in-city', IN_CITY); document.body.classList.toggle('city-build', IN_CITY && CITY_BUILD_PHASE); document.body.classList.toggle('build-city', isBuildCity(ROOM)); document.body.classList.toggle('city-outside', CITY_OUTSIDE);
// A preset room's six baked images (preset.js; Jens, 29 Oct 2026): over the surfaces, under the stickers.
// var: showRoomInfo may run before this line
var presetLayer = new PresetLayer(scene, room.surfaces); // eslint-disable-line no-var
camera.position.copy(room.spawn);
// Lite slumpat var man dyker upp, så inte alla som kommer in står i varandra.
camera.position.x += (Math.random() - 0.5) * 3; camera.position.z += (Math.random() - 0.5) * 1;
// Back out of a house (?at=<city>-3): in front of its door, looking away from it.
// Up from the subway (?at=subway): on the plaza in front of the station.
const cityAt = CITY_OUTSIDE && params.get('at') === 'subway' ? { ...SUBWAY_SPAWN }
  : CITY_OUTSIDE && houseNumber(params.get('at') || '') && cityOf(params.get('at')) === THIS_CITY ? spawnOutside(params.get('at')) : null;
if (cityAt) camera.position.set(cityAt.x + (Math.random() - 0.5) * 1.5, 1.6 + room.groundAt(cityAt.x, cityAt.z), cityAt.z);

const controls = new FirstPersonControls(camera, canvas, room.bounds);
if (room.city) { controls.ground = room.groundAt; controls.collide = room.pushOut; controls.yaw = cityAt ? cityAt.yaw : 0; controls.apply?.(); }
// Our own unlocks (a menu, the chat, a camera view …) are told apart from the player's Esc: auto-slap
// pauses for the first and turns off for the second (see onLockChange).
var softUnlockAt = 0; // eslint-disable-line no-var
{ const raw = controls.unlock.bind(controls); controls.unlock = () => { softUnlockAt = performance.now(); raw(); }; }
controls.attachJoystick($('joystick'), $('stick'));
const stamps = new StampLayer(scene, room.surfaces);
// Mina peel-bara klibbor förblir egna meshar; äldre målas in i väggarna (se stamps.js).
stamps.keepLive = () => roomHistory(ROOM).map((h) => h.stampId);
// Peels: baksidespappret som faller till golvet vid varje slap (när rummet har det på), peels.js.
const peelLayer = new PeelLayer(scene, { room: CITY_OUTSIDE ? CITY : null });
const slapFx = new SlapFx(scene);
// The backing paper lands: a soft "duff", louder and lower the bigger the paper, in the
// slapper's own sound (their look.sound), from where it landed. Re-enabled (Jens Nov 2026 voice:
// "när peelen landar på marken … aktiverar det igen" – was silenced in 2c0fb85).
// Throttle: peels only land once each (peels.js e.landed); array bursts still get a short gap so
// a fan of papers does not become a machine-gun of thuds.
let lastDuffAt = 0;
const DUFF_GAP_MS = 90;
// Pitch follows the paper's longest side (= the sticker's size, 10 cm – 4 m; shared/synth.mjs sizeRate).
function playDuff(w, h, at, by) {
  const now = performance.now();
  if (now - lastDuffAt < DUFF_GAP_MS) return;
  lastDuffAt = now;
  const area = (w || 0.3) * (h || 0.3), size = Math.max(w || 0.3, h || 0.3);
  if (by === 'me') sound.play('duff', at, { area, size, sound: sound.mine });
  else sound.play('duff', at, { area, size, sound: together.voiceOf(by) });
}
peelLayer.onLand = (peel, by) => playDuff(peel.w, peel.h, [peel.x, 0.02, peel.z], by);
// A sticker over 1 m drops no paper (PEEL.maxPaperSide, Jens 10 Nov 2026: huge falling peels look
// silly) – the landing "duff" still plays, when and where its paper would have landed (seed = nonce).
function paperlessDuff(design, size, seed, from, position, normal, by) {
  if (!peelLayer.on || !dropsPeel(design) || dropsPaper(size)) return false;
  let at = [position[0], 0.02, position[2]], ms = PEEL.fallMin * 1000;
  try {
    ms = pathParams(seed).dur * 1000;
    if (from) { const p = peelPlan(seed, from, position, CITY_OUTSIDE ? CITY : undefined, normal); at = [p.x, 0.02, p.z]; }
  } catch { /* keep the spot under the sticker */ }
  const [w, h] = stampDims(design, size);
  setTimeout(() => playDuff(w, h, at, by), ms);
  return true;
}
let nopes = 0;
// Klibbor fastnar inte på baksidespapper: ett litet "nej" och en axelryckning. (Påskägg, står inte i hjälpen.)
function nope() {
  // Visual only: the "nope" sound was removed (Jens Nov 2026). Shrug still marks a refused slap.
  nopes++;
  let el = document.getElementById('nope-shrug');
  if (!el) { el = document.createElement('div'); el.id = 'nope-shrug'; el.textContent = '🤷'; el.setAttribute('aria-hidden', 'true'); document.body.appendChild(el); }
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
const preview = new StampPreview(scene, stamps.faces);
// The room size test (roomsize.js; Jens, 2 Nov 2026): Height / Width / Depth in the room panel – this
// view only, not synced, not saved. Slapping is off while it is not the normal size.
// (the City is no box: its size test is off – the sliders do nothing there)
const roomSizer = room.city ? { RANGE: ROOM_RANGE, get: () => ({ width: 96, height: 24, depth: 96 }), set() {}, reset() {}, sync() {}, isDefault: () => true }
  : createRoomSizer({ room, scene, stamps, camera, restyle: () => showStyle(shownStyle) });
// The aim tool (Jens, 9–10 Nov 2026): NEVER auto-fades. Same timer on desktop + touch
// (shared/heldtimer.mjs). Available in the sticker, Nature and assets/props wheels. Stays sharp
// after choose / place / switching among those wheels until the user turns Aim off (O key or
// the on-screen Aim toggle). Wheel R/F idle fade (WHEEL_UP_MS) is separate and untouched.
const deskHeld = isTouch ? null : createHeldTimer();
// O toggles the aim tool (crosshair + held sticker / prop ghost). Off = no aim brush; persist klibb.aimOff.
const AIM_OFF_KEY = 'klibb.aimOff';
let aimOff = false;
try { aimOff = localStorage.getItem(AIM_OFF_KEY) === '1'; } catch { /* private */ }
document.body.classList.toggle('aim-off', aimOff);
function syncAimToggleBtn() {
  const btn = $('aim-toggle');
  if (!btn) return;
  btn.setAttribute('aria-pressed', String(!aimOff));
  btn.title = aimOff ? 'Aim off — tap to show aim' : 'Aim on — tap to hide aim';
  btn.setAttribute('aria-label', aimOff ? 'Aim off' : 'Aim on');
  // Keep emoji + label as separate nodes (lab is inside the button)
  const lab = $('aim-toggle-lab');
  const emoji = aimOff ? '👁' : '◎';
  if (lab) {
    // textContent on button would wipe lab; set first text node / rebuild
    btn.childNodes[0].textContent = emoji;
    lab.textContent = aimOff ? 'Aim off' : 'Aim on';
  } else {
    btn.textContent = emoji;
  }
}
function setAimOff(off, { quiet = false } = {}) {
  aimOff = !!off;
  try { localStorage.setItem(AIM_OFF_KEY, aimOff ? '1' : '0'); } catch { /* private */ }
  document.body.classList.toggle('aim-off', aimOff);
  if (aimOff) {
    deskHeld?.hide?.();
    stackMenu?.held?.hide?.();
    preview.hide();
  } else {
    const tNow = performance.now();
    if (deskHeld && state.selected) {
      if (deskHeld.state === 'idle' || deskHeld.state === 'hidden') deskHeld.choose(tNow);
      else deskHeld.show(tNow);
      if (window.klibb?.ready && state.mode === 'view' && !selfieOn() && !camView) setMode('slap', { quiet: true });
    }
    if (stackMenu?.held && state.selected) {
      if (stackMenu.held.state === 'idle' || stackMenu.held.state === 'hidden') stackMenu.held.choose(tNow);
      else stackMenu.held.show(tNow);
    }
  }
  if (controls?.locked) $('crosshair').hidden = aimOff;
  syncAimToggleBtn();
  if (!quiet) toast(aimOff ? 'Aim off (O)' : 'Aim on (O)', 1400);
  return aimOff;
}
function deskActive() {
  // No auto-fade: keepAlive is a no-op; leave faded-by-aim-off alone.
  if (!deskHeld || aimOff) return;
}
// A left press on the 3D view: true = it only woke a completely faded held sticker (do not slap/act).
// Aim off (O): swallow the click – no slap, no wake (turn aim back on with O).
function deskPress() {
  if (aimOff) return true;
  if (!deskHeld || deskHeld.state !== 'timed') return false;
  const t = performance.now();
  if (!deskHeld.faded(t)) return false;
  deskHeld.wake(t);
  return true;
}
const cams = new CameraLayer(scene); // virtuella kameror (för inspelning)
const viewCam = new THREE.PerspectiveCamera(60, 1, 0.05, 100); // "Titta genom kamera"
const raycaster = new THREE.Raycaster();
// Tredjepersonsvy: en egen kamera bakom och lite ovanför min gubbe. `camera` är fortfarande
// "jag" (ögonen): styrningen, nätet och allt annat utgår från den, precis som i förstapersonsläget.
const tpCam = new THREE.PerspectiveCamera(70, 1, 0.05, 100);
const chaseCast = surfaceCaster(room.surfaces);
const chase = { eye: null, dist: null, pose: null };
// 'My avatar' open (Jens, 29 Oct 2026): the room camera in front of my own avatar, zoomed in so it fills
// the screen next to the panel (avatarview.js). show.face = the direction picked when the panel opened.
const showCam = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
const show = { face: null, pose: null };
const showCast = (() => { const o = new THREE.Vector3(), d = new THREE.Vector3(); return (a, b) => chaseCast(o.fromArray(a), d.fromArray(b)); })();
function updateShowcase(avv) {
  const W = innerWidth, H = innerHeight, rect = freeRect(W, H, $('avatar-panel').getBoundingClientRect());
  const at = [camera.position.x, camera.position.z];
  if (show.face === null || avv.faceYaw === null) { show.face = showPose({ at, yaw: controls.yaw, cast: showCast, W, H, rect }).faceYaw; together.setAvatarFace(show.face); }
  const p = show.pose = showPose({ at, yaw: show.face, cast: showCast, W, H, rect, fixed: true });
  showCam.fov = p.fov; showCam.aspect = W / H;
  showCam.setViewOffset(W, H, p.offset[0], p.offset[1], W, H);
  showCam.position.fromArray(p.position); showCam.up.set(0, 1, 0); showCam.lookAt(p.target[0], p.target[1], p.target[2]);
  showCam.updateMatrixWorld();
}

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
  size: 0.3, rotation: 0, jitter: false, // size = the held size (longest side, m); the first sticker starts 30 cm high (startSize), then it stays what you make it
  mode: 'slap', // 'slap' = Klibbläge (pekaren syns, klick stämplar), 'view' = Tittläge (bara titta)
  artist: localStorage.getItem('klibb.artist') || '',
  artistLink: cleanArtistLink(localStorage.getItem('klibb.artistLink') || ''),
  adminToken: '',
};

// ---------- Ljud (sound.js) ----------
// Session model (Jens t572u): room→city keeps personal sound; a fresh load or a NEW room resets
// recordings + settings to defaults (prepareSoundForPlace). Must run before Sounds reads musicVol.
prepareSoundForPlace(IN_CITY ? { kind: 'city', id: THIS_CITY } : { kind: 'room', id: ROOM });
const sound = new Sounds();
setSoundRoom(ROOM); // API kept; personal sound is visit-scoped (soundui.js)
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
// All stickers (Jens, 28 Oct 2026: "all stickers should be loaded"): the whole library under my own
// uploads – in the desktop panel and the phone's sticker book (📒), the same list as the wheel, so it
// is not only reachable by turning the wheel / swiping the stack. Thumbnails load lazily (186+).
// The nature stickers are not in it: they have their own list, 🌿 Nature (N), locked (greyed, a tap
// opens the full version panel) in the free version – like the Nature wheel.
const trayKeys = {};
function fillLibTray(boxId, trayId, countId, list) {
  const box = $(boxId), tray = $(trayId); if (!box || !tray) return;
  const key = list.map((d) => d.id).join();
  if (key !== trayKeys[trayId]) {
    trayKeys[trayId] = key; tray.innerHTML = '';
    for (const img of list) {
      const t = document.createElement('div'); t.className = 'thumb lib'; t.dataset.id = img.id;
      const b = document.createElement('button'); b.type = 'button'; b.title = S.pickThis; b.className = 'pick';
      b.innerHTML = `<img loading="lazy" decoding="async" src="${img.url}" alt="">`;
      b.onclick = () => select(img);
      t.append(b); tray.appendChild(t);
    }
    $(countId).textContent = list.length ? `(${list.length})` : '';
  }
  box.hidden = !list.length;
  for (const t of tray.children) t.classList.toggle('sel', t.dataset.id === state.selected?.id);
}
function renderLibTray() {
  const mine = new Set(designs().map((d) => d.id));
  fillLibTray('lib-box', 'libtray', 'lib-count', DEMO ? [] : state.library.filter((d) => !mine.has(d.id) && !isNat(d)));
  fillLibTray('nature-box', 'naturetray', 'nature-count', natureDesigns());
  $('nature-box')?.classList.toggle('locked', !natureOpen());
}
function renderTray() {
  renderLibTray();
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

// Only my uploads can be starred (Jens, 29 Oct 2026) – never library or nature stickers.
function toggleFav(id) {
  if (!state.mine.some((m) => m.id === id)) return false;
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
// Free version: only the newest own upload is on the palette/wheel (shared/uploads.mjs); full/open: all.
function designs() { return DEMO ? state.library.filter((d) => !isNat(d)) : shownUploads(state.mine, !!entitlements.full.uploads).slice().reverse(); }
// Two wheels (Jens, 28 Oct 2026): the Nature wheel (left) = every nature sticker of the library
// (shared/nature.mjs), a full-version feature (entitlements.full.natureStickers; the server refuses
// nature stamps otherwise); the sticker wheel (right) = everything else, as before. The ACTIVE wheel
// is the one the held sticker is from: clicking/tapping/turning a wheel (or picking from its list)
// makes it active; R/F, the stack's swipes and the stack itself follow the active wheel.
const isNat = (d) => !!d && d.library === true && isNature(d);
// City uses the same Nature wheel rules as the room (full sticker wheel restored).
const natureOpen = () => FILM_STUDIO ? !DEMO : (!DEMO && !!entitlements.full.natureStickers);
const keepSel = (l) => !!state.selected && (l.some((d) => d.id === state.selected.id) || (isNat(state.selected) && natureOpen())); // a nature sticker in hand stays in hand
let natKey = '', natCache = [];
function natureDesigns() {
  if (DEMO) return [];
  if (natKey !== String(state.library.length)) { natKey = String(state.library.length); natCache = state.library.filter(isNat); }
  return natCache;
}
const activeWheel = () => (isNat(state.selected) && natureOpen() ? 'nature' : 'stickers');
// The sticker wheel / R/F / the phone's stack (Jens, 28 Oct 2026): the WHOLE library for everyone,
// not only in the demo – my own uploads first (newest first, as in the palette), then the library in
// manifest order (a library sticker I also have as an upload only once). The palette stays mine.
let wheelKey = '', wheelCache = [];
function wheelDesigns() { return activeWheel() === 'nature' ? natureDesigns() : stickerDesigns(); }
function stickerDesigns() {
  if (DEMO) return designs();
  // City uses the same full deck as the room (CREATE + full wheel restored; not just carried packs).
  return deckDesigns();
}
// Film studio in the city: the WHOLE non-nature library, chunked into switchable ~9-sticker wheels
// (same ←/→ as pack slots). Nature stays on its own wheel (V / ←→).
const STUDIO_WHEEL_SIZE = 9;
let studioKey = '', studioCache = [], studioSlot = 0;
function studioLibraryStickers() {
  return state.library.filter((d) => d && d.url && !isNat(d) && !WHEEL_EXCLUDE.includes(d.id));
}
function studioPackGroups() {
  const all = studioLibraryStickers();
  const groups = [];
  for (let i = 0; i < all.length; i += STUDIO_WHEEL_SIZE) {
    const stickers = all.slice(i, i + STUDIO_WHEEL_SIZE);
    const n = Math.floor(i / STUDIO_WHEEL_SIZE) + 1;
    const total = Math.max(1, Math.ceil(all.length / STUDIO_WHEEL_SIZE));
    groups.push({ id: `studio-${n}`, name: `Studio ${n}/${total}`, stickers });
  }
  if (!groups.length) groups.push({ id: 'studio-0', name: 'Studio', stickers: [] });
  return groups;
}
function studioCityDesigns() {
  const groups = studioPackGroups();
  const key = ['studio', state.library.length, studioSlot, groups.map((g) => g.id).join(',')].join('|');
  if (key === studioKey) return studioCache;
  studioKey = key;
  if (studioSlot >= groups.length) studioSlot %= groups.length;
  if (studioSlot < 0) studioSlot = (studioSlot % groups.length + groups.length) % groups.length;
  studioCache = groups[studioSlot].stickers.slice();
  return studioCache;
}
// My deck (the normal wheel, outside the city). A paying player's kept city stickers (citymode.js
// readKept, t479u) are in it too: each in the place of the sticker it replaced (klibb.swaps, like the
// name tags), or added at the end; never more than DECK_MAX (228) stickers (menu stickers not counted).
function deckDesigns() {
  const mine = designs(), swaps = readSwaps(), kept = readKept(), key = mine.map((d) => d.id).join() + '|' + state.library.length + '|' + JSON.stringify(swaps) + '|' + kept.map((d) => d.id).join();
  // Jens, 2 Nov 2026 / 4 Nov (t507u): 98 in the middle, 26, d74, e14 to its left, the menu stickers to its right, then the list from the back (shared/wheelorder.mjs)
  if (key !== wheelKey) {
    wheelKey = key;
    const order = wheelOrder(state.library.filter((d) => !isNat(d)), mine, { menus: [], exclude: WHEEL_EXCLUDE });
    const have = new Set(order.map((d) => d.id)), extra = kept.filter((d) => !have.has(d.id)).map((d) => ({ ...d, kept: true }));
    let list = applySwaps([...order, ...extra], swaps), n = 0;
    list = list.filter((d) => { if (WHEEL_EXCLUDE.includes(d.id)) return false; return ++n <= DECK_MAX; });
    wheelCache = list;
  }
  return wheelCache;
}
// The city wheel (t476u): my pack's 3 stickers (+ the 2 packs I took in the Town Hall: ≤ 9), the
// exit button and my pack – nothing else (citymode.js cityWheel). ArrowLeft/Right while the wheel is
// lit steps between carried packs (each pack = its own 3-sticker wheel) without leaving the view.
let cityKey = '', cityCache = [];
function cityPackGroups() {
  const byId = (id) => state.library.find((d) => d.id === id) || state.mine.find((d) => d.id === id) || null;
  const groups = [];
  try {
    const pac = JSON.parse(localStorage.getItem('klibb.pac') || 'null');
    if (pac && Array.isArray(pac.stickers) && pac.stickers.length) {
      const stickers = pac.stickers.map((id, k) => byId(id) || pac.designs?.[k] || (pac.urls && pac.urls[k] ? { id, url: pac.urls[k] } : null)).filter(Boolean);
      if (stickers.length) groups.push({ id: pac.id || 'mine', name: pac.name || S.cityMyPack || 'my pack', stickers });
    }
  } catch { /* fine */ }
  for (const p of takenPacks()) {
    const stickers = (p.stickers || []).filter((s) => !s.gone).map((s) => byId(s.id) || { id: s.id, url: s.url, width: s.width, height: s.height });
    if (stickers.length) groups.push({ id: p.id, name: p.name || S.cityMyPack || 'pack', stickers });
  }
  return groups;
}
function cityDesigns() {
  const byId = (id) => state.library.find((d) => d.id === id) || state.mine.find((d) => d.id === id) || null;
  const groups = cityPackGroups();
  const key = [localStorage.getItem('klibb.pac')?.length, localStorage.getItem('klibb.cityTaken'), state.library.length, state.mine.length, cityPackUrl, cityPaid, cityPackSlot, groups.map((g) => g.id).join(',')].join('|');
  if (key === cityKey) return cityCache;
  cityKey = key;
  // Paying player with a huge deck: keep the flat cityWheel list (no per-pack slots).
  if (cityPaid) { cityCache = cityWheel({ byId, exit: null, max: DECK_MAX }); return cityCache; }
  if (!groups.length) { cityCache = cityWheel({ byId, exit: null, max: 9 }); return cityCache; }
  if (cityPackSlot >= groups.length) cityPackSlot = cityPackSlot % groups.length;
  if (cityPackSlot < 0) cityPackSlot = (cityPackSlot % groups.length + groups.length) % groups.length;
  const g = groups[cityPackSlot];
  const pack = { id: PACK_DESIGN_ID, url: cityPackUrl || '/start/pac.webp', width: 563, height: 802, name: g.name, cityPack: true };
  // One pack at a time: its 3 stickers + the pack bag (opens Town Hall) – switch packs with ←/→.
  cityCache = [...g.stickers.slice(0, 3), pack];
  return cityCache;
}
var cityPackUrl = ''; // eslint-disable-line no-var
var cityPaid = false; // eslint-disable-line no-var -- a paying player carries more than 3 packs (the Town Hall says)
if (IN_CITY) carryReady.then(() => refreshPackPicture()).then((u) => { cityPackUrl = u || ''; cityKey = ''; const l = stickerDesigns(); if (state.selected && !keepSel(l)) select(l[0] || null); else renderDesignHud(); });
function cityWheelChanged() { cityKey = ''; refreshPackPicture().then((u) => { cityPackUrl = u || ''; cityKey = ''; const l = stickerDesigns(); if (!keepSel(l)) select(l[0] || null); else renderDesignHud(); }); }
// En annan flik ändrade listan: hämta den nya.
addEventListener('storage', (e) => {
  if (e.key === FAV_KEY) { state.favs = readFavs(); renderTray(); return; }
  if (e.key !== 'klibb.mine') return;
  state.mine = readMine();
  if (state.selected && !state.mine.some((m) => m.id === state.selected.id)) select(last(state.mine));
  else { renderTray(); renderDesignHud(); }
});

// var: select() can run before these lines (the first selection at start).
var lastNatureId = null, lastStickerId = null; // eslint-disable-line no-var
var touchPinch = null; // eslint-disable-line no-var -- touch: two fingers scaling/turning the held sticker { d0, a0, size0, rot0 }
var touchesDown = new Set(); // eslint-disable-line no-var -- touch: fingers on the screen now (the held timer waits while any is down)
var touchAim = null; // eslint-disable-line no-var -- touch: the finger aiming the held sticker { id, x, y } (see the touch input)
async function select(img) {
  if (isNat(img) && !natureOpen()) { fullUi?.open(); return; } // the Nature wheel is the full version's
  const changed = (img && img.id) !== (state.selected && state.selected.id);
  if (img) { if (isNat(img)) lastNatureId = img.id; else lastStickerId = img.id; } // where V goes back to
  state.selected = img || null; renderTray(); renderDesignHud();
  if (changed) applySizeLimit(); // nature stickers have their own size limits (shared/nature.mjs)
  if (img && changed) startSize(img);
  if (img && changed && !aimOff) deskHeld?.choose(performance.now()); // desktop: a newly chosen sticker is sharp until placed
  // desktop, View mode (after a fade): picking another sticker (R / F, the wheel, the book) means slapping
  // again – back to Slap mode. Not the first pick at start: a room starts in View mode.
  if (img && changed && deskHeld && window.klibb?.ready && state.mode === 'view' && !selfieOn() && !camView) setMode('slap', { quiet: true });
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
  const list = wheelDesigns();
  if (!list.length) { if (!DEMO) toast(S.uploadFirst); return null; }
  const i = list.findIndex((d) => d.id === state.selected?.id);
  const next = list[i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length];
  select(next);
  if (list.length === 1) toast(S.onlyOneDesign);
  return next;
}

function renderDesignHud() {
  const list = wheelDesigns(), sel = state.selected;
  const i = sel ? list.findIndex((d) => d.id === sel.id) : -1;
  // touch: the stack shows the next two stickers under the one on top
  for (const [k, id] of [[1, 'design-btn-b1'], [2, 'design-btn-b2']]) {
    const d = list.length > k ? list[(i + k + list.length) % list.length] : null;
    $(id).hidden = !d; if (d) $(id).src = d.url;
  }
  renderStrip(list, sel, i);
  const hud = $('design-hud'), btn = $('design-btn');
  hud.hidden = true; // desktop: replaced by the sticker strip along the bottom (renderStrip)
  btn.hidden = !sel && !isTouch; // touch: the stack is always there (empty: tap it → 📒 Stickers → ⬆ Upload)
  btn.classList.toggle('empty', !sel);
  if (!sel) { $('design-btn-img').removeAttribute('src'); $('design-btn-num').textContent = ''; return; }
  $('design-hud-img').src = sel.url;
  $('design-btn-img').src = sel.url;
  $('design-hud-num').textContent = `${i + 1}/${list.length}`;
  $('design-btn-num').textContent = list.length > 1 ? `${i + 1}/${list.length}` : '';
}

// The sticker wheel (client/src/wheel.js, shared/wheel.mjs; Jens 28 Oct 2026): the same stickers
// R/F cycle through (my palette, or the library in the demo) on a round reel that never ends, the
// held one in the middle (full colour, upright, on top), the others fading to grey, turning and
// tucking in behind outwards. Desktop: along the bottom edge – R/F, the mouse wheel / trackpad, drag
// or click turn it (only while the mouse is free: pointer lock sends clicks to the canvas; a click
// here never slaps or locks the pointer). Touch: a band above the joystick and the stack, up while
// you swipe it (the stack sideways, or the band itself) and a moment after (stackmenu.js).
// Desktop + touch: R/F (or a drag/scroll on the strip) lights the sticker wheel. While you keep
// turning it the strip stays up; after WHEEL_UP_MS idle it fades out (CSS opacity). A click-pick
// fades it at once and leaves the held sticker sharp for slapping (Jens, Nov 2026 wheel-fade).
const WHEEL_UP_MS = 1000;
let wheelUpTimer = 0;
let cityPackSlot = 0; // which carried pack's stickers the city sticker wheel shows (0-based)
function wheelIsLit() { return document.body.classList.contains('wheel-lit') || document.body.classList.contains('wheel-up'); }
function wheelDown({ fromSelect = false } = {}) {
  clearTimeout(wheelUpTimer); wheelUpTimer = 0;
  document.body.classList.remove('wheel-up', 'wheel-lit');
  const lab = $('wheel-label'); if (lab) lab.hidden = true;
  // Idle fade (not an explicit pick): hide the held ghost too – no miljöklibbor while walking.
  if (!fromSelect && deskHeld && (deskHeld.state === 'holding' || deskHeld.state === 'timed')) {
    const t = performance.now();
    deskHeld.placed(t - deskHeld.visibleMs - deskHeld.fadeMs); // opacity 0 immediately
    if (state.mode === 'slap' && !propsMode()) setMode('view', { quiet: true });
  }
  const ae = document.activeElement;
  if (ae && ae.closest && ae.closest('#design-strip, #nature-strip, #packs-strip, #wheel-label')) {
    try { ae.blur(); } catch { /* fine */ }
  }
}
function wheelUp() {
  stackMenu?.held.keepAlive(performance.now()); // turning the wheel = working with the held sticker (no fade)
  document.body.classList.add('wheel-up', 'wheel-lit');
  updateWheelLabel();
  clearTimeout(wheelUpTimer);
  wheelUpTimer = setTimeout(function down() {
    if (wheel.info().dragging || natureWheel.info().dragging || packsWheel.info().dragging) { wheelUpTimer = setTimeout(down, 400); return; }
    wheelDown({ fromSelect: false });
  }, WHEEL_UP_MS);
}
function onWheelPick(img, after) {
  select(img);
  after?.(img);
  // Explicit selection: strip fades now; held sticker stays sharp for aiming/slapping (unless aim off).
  if (deskHeld && img && !aimOff) deskHeld.choose(performance.now());
  if (img && state.mode === 'view' && !selfieOn() && !camView) setMode('slap', { quiet: true });
  wheelDown({ fromSelect: true });
  if (isTouch) stackMenu?.chosen();
}
const wheel = createWheel($('strip-row'), {
  pick: (img) => onWheelPick(img),
  onActivity: wheelUp,
});
// The Nature wheel (left of the sticker wheel): the same reel, the library's nature stickers only.
const natureWheel = createWheel($('nature-row'), {
  pick: (img) => onWheelPick(img),
  onActivity: wheelUp,
});
const packsWheel = createWheel($('packs-row'), {
  pick: (img) => {
    onWheelPick(img, (picked) => {
      if (picked?.packId) {
        try {
          const all = readPacks();
          const p = all.find((x) => x.id === picked.packId);
          if (p) localStorage.setItem('klibb.pac', JSON.stringify(p));
        } catch { /* fine */ }
        cityWheelChanged();
      }
    });
  },
  onActivity: wheelUp,
});
// The wheel R/F and the stack's sideways swipe turn: the active one.
const activeWheelApi = {
  cur: () => (packsMode() ? packsWheel : activeWheel() === 'nature' ? natureWheel : wheel),
  beginDrag: (x) => activeWheelApi.cur().beginDrag(x), dragTo: (x) => activeWheelApi.cur().dragTo(x),
  endDrag: () => activeWheelApi.cur().endDrag(), info: () => activeWheelApi.cur().info(), render: () => activeWheelApi.cur().render(),
};
function packDesigns() {
  return readPacks().map((p) => ({
    id: 'pack:' + p.id, url: p.img || '/start/pac.webp', width: 563, height: 802,
    name: p.name || S.cityMyPack, cityPack: true, packId: p.id,
  }));
}
function renderStrip() {
  const sel = state.selected, list = stickerDesigns(), nat = natureDesigns(), packs = packDesigns();
  const onNat = activeWheel() === 'nature' && !packsMode() && !propsMode();
  const onPacks = packsMode();
  const i = sel && !onNat && !onPacks ? list.findIndex((d) => d.id === sel.id) : -1;
  $('design-strip').hidden = !list.length || onPacks || propsMode();
  wheel.setList(list);
  wheel.setSelected(sel && !onNat && !onPacks ? sel.id : null);
  $('strip-num').textContent = list.length && i >= 0 ? `${i + 1}/${list.length}` : '';
  const open = natureOpen(), j = onNat ? nat.findIndex((d) => d.id === sel.id) : -1;
  $('nature-strip').hidden = !nat.length || onPacks || propsMode();
  $('nature-strip').classList.toggle('locked', !open);
  $('nature-strip').title = open ? S.natureAria : S.natureTitle;
  natureWheel.setList(nat);
  natureWheel.setSelected(onNat ? sel.id : null);
  $('nature-num').textContent = !nat.length ? '' : !open ? S.natureLocked : `🌿 ${j >= 0 ? `${j + 1}/` : ''}${nat.length}`;
  const pk = $('packs-strip');
  if (pk) {
    pk.hidden = !onPacks;
    const k = onPacks && sel ? packs.findIndex((d) => d.id === sel.id) : -1;
    packsWheel.setList(packs);
    packsWheel.setSelected(onPacks && sel ? sel.id : null);
    if (onPacks) packsWheel.render(); // remeasure now that #packs-strip is visible
    $('packs-num').textContent = packs.length ? `📦 ${k >= 0 ? `${k + 1}/` : ''}${packs.length}/${PACKS_MAX}` : (S.packsEmpty || '');
    pk.classList.toggle('active', onPacks);
  }
  document.body.classList.toggle('two-wheels', !!nat.length && !onPacks);
  $('design-strip').classList.toggle('active', !onNat && !onPacks);
  $('nature-strip').classList.toggle('active', onNat);
  syncNatureMode();
}
$('design-strip').addEventListener('mousedown', (e) => { e.stopPropagation(); });
$('nature-strip').addEventListener('mousedown', (e) => { e.stopPropagation(); });
$('packs-strip')?.addEventListener('mousedown', (e) => { e.stopPropagation(); });
// Locked (free version): greyed, nothing turns; a click/tap opens the full version panel.
$('nature-strip').addEventListener('click', (e) => { if (natureOpen()) return; e.preventDefault(); e.stopPropagation(); fullUi?.open(); }, true);

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

// Storleken = klibbans längsta sida (shared/nature.mjs STICKER_LIMITS): 10 cm – 4 m (Jens, 10 Nov 2026,
// t785u). Nature stickers: no upper cap – the size slider needs a finite end → SLIDER_UI_CM (100 m).
const FREE_MAX_CM = STICKER_LIMITS.free.maxCm;
const FREE_MIN_CM = STICKER_LIMITS.free.minCm;
const FULL_MIN_CM = STICKER_LIMITS.full.minCm;
const FULL_MAX_CM = STICKER_LIMITS.full.maxCm;
const SLIDER_UI_CM = 10000; // range-input end when maxCm is Infinity (100 m)
const versionLimits = () => (entitlements.full.bigStickers ? { minCm: FULL_MIN_CM, maxCm: FULL_MAX_CM } : { minCm: FREE_MIN_CM, maxCm: FREE_MAX_CM });
// (nature stickers: up to the space's height – 24 m in the city's outside, t482u)
const limitsFor = (img = state.selected) => (img && img.library === true ? sizeLimitsCm(img, versionLimits(), { maxHeightCm: natureMaxHeightCmIn(ROOM) }) : versionLimits());
const maxSizeCm = (img) => limitsFor(img).maxCm;
// Nature stickers drop no backing paper (Jens, 28 Oct 2026: they get too large) – the server makes none either.
// size (m, longest side; optional): neither does a sticker over 1 m (PEEL.maxPaperSide, Jens 10 Nov 2026).
const dropsPeel = (img, size) => !(img && img.library === true && isNature(img)) && dropsPaper(size);
const minSizeCm = (img) => limitsFor(img).minCm;
const showSize = () => {
  const cm = Math.round(state.size * 200) / 2;
  $('size').value = String(Math.min(cm, Number($('size').max)));
  $('size-val').textContent = `${cm.toLocaleString(LOCALE)} cm`;
};
function applySizeLimit() {
  const max = maxSizeCm();
  $('size').max = String(Number.isFinite(max) ? max : SLIDER_UI_CM);
  $('size').min = String(minSizeCm());
  if (Number.isFinite(max) && state.size * 100 > max) state.size = max / 100;
  if (state.size * 100 < minSizeCm()) state.size = minSizeCm() / 100;
  showSize();
}
$('size').oninput = (e) => { sizeStarted = true; state.size = Number(e.target.value) / 100; showSize(); };
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
  if (!Number.isFinite(cm)) return; // sanity guard (NaN / Infinity), not a product size limit
  const want = Math.round(cm * 2) / 2; // 0.5 cm steps (the letter sizes are 2.5 cm apart)
  const max = maxSizeCm();
  cm = Math.max(want, minSizeCm()); // no upper cap when maxCm is Infinity (Jens Nov 2026)
  if (Number.isFinite(max)) {
    cm = Math.min(cm, max);
    if (want > max && performance.now() - maxToastAt > 1500) {
      maxToastAt = performance.now();
      toast(S.maxSize((max / 100).toLocaleString(LOCALE)), 1500);
    }
  }
  state.size = cm / 100; showSize();
  stackMenu?.held.keepAlive(performance.now()); // touch: resizing = working with it (no fade)
}
// The start size (Jens, 28 Oct 2026 – replaces the per-design start sizes): the first sticker you
// hold in a session spawns 30 cm HIGH (whatever its shape: a wide one is wider than 30 cm, the held
// size being its longest side), within the free/full limits. Switching to another sticker after that
// (the wheel, R/F, a swipe, the book, an upload) keeps the size you had – as before the per-design
// sizes; scaling up/down is free as always. (A design's startCm / X_ file-name prefix is still stored
// and served, but no longer sets the size.)
const START_HEIGHT_CM = 30;
let sizeStarted = false;
const sideForHeightCm = (img, hCm) => { const a = (img && img.width > 0 && img.height > 0) ? img.width / img.height : 1; return a >= 1 ? hCm * a : hCm; };
function startSize(img) {
  if (sizeStarted || !img) return;
  sizeStarted = true;
  setSize(sideForHeightCm(img, START_HEIGHT_CM));
}
function setRot(deg) { deg = ((deg + 540) % 360) - 180; $('rot').value = deg; $('rot').oninput({ target: $('rot') }); stackMenu?.held.keepAlive(performance.now()); }

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
    // Free version: one own sticker – the new one replaces the old (shared/uploads.mjs). Full/open: keep all.
    const replaced = uploadsToReplace(state.mine, img.id, !!entitlements.full.uploads);
    if (replaced.length) dropDesigns(replaced);
    await select(img);
    stackMenu?.chosen(); stackMenu?.closeBook(); // touch: the new sticker is in your hand
    toast(replaced.length ? S.oneUploadReplaced : isTouch ? S.uploadedTouch : S.uploadedDesktop, replaced.length ? 4500 : 2200);
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
const third = () => view !== 'first' && !camView; // 3rd person: from behind ('third') or from the front ('front')
const selfieOn = () => view === 'front' && !camView; // selfie mode: slap mode is off (slapAt, V, the preview, CSS body.front-view)
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
  // the room's surfaces and every 3D prop's meshes (Jens t521u: stickers on any prop)
  const props = propsUi ? propsUi.stickerMeshes() : [];
  const hit = raycaster.intersectObjects(props.length ? [...room.surfaces, ...props] : room.surfaces, false).find((x) => x.face) || null;
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
  // The room is full (FREE_MAX_PLAYERS): watchers can't slap (the server refuses it too) until someone leaves.
  if (together.net.status === 'full') { if (!auto) toast(S.fullNoSlap, 1800); return null; }
  if (!state.selected) { if (!auto) toast(S.pickFirst); return null; }
  // A panel is open (room look, My avatar): no slap from anywhere (click, key, touch, auto-slap, test
  // hooks). Before the library was always on the wheel, nothing was held then and this never came up.
  if (sp.open || together.busy()) return null;
  // Selfie mode (the camera in front of me, view 'front'; Jens, 2 Nov 2026): no slap mode – nothing to aim
  // with, nothing placed (click, tap, the holder, auto-slap, array drags all come through here).
  if (selfieOn()) { if (!auto) toast(S.selfieNoSlap(isTouch), 2200); return null; }
  if (!roomSizer.isDefault()) { if (!auto) toast(S.roomSizeNoSlap, 2600); return null; } // a test size: the stickers would land wrong for everyone else
  // The City (t476u): my pack and the exit button on the wheel are buttons, not stickers; a click on a
  // door (in reach) goes through it.
  if (IN_CITY && isPackDesign(state.selected)) { if (!auto) cityPackAction(); return null; }
  if (CITY_OUTSIDE && !auto) {
    const d = doorHit(ndc); if (d) { openCityDoor(d); return null; }
    if (TESTBUS && room.busStop && hitBusStop(room, ndc, camera, _busRay)) {
      openBusSheet({ here: THIS_CITY, go: (id) => goRoom(id, `&${TESTBUS_PARAM}=1`), toast: toast, S });
      return null;
    }
  }
  const h = hitSurface(ndc); if (!h) return null;
  if (auto && auto.check && !auto.check(h)) return null;
  const q = StampLayer.orientation(h.normal, h.dir, nextRotation());
  const slapSize = (() => { const max = maxSizeCm() / 100, min = minSizeCm() / 100; let s = state.size; if (Number.isFinite(max)) s = Math.min(s, max); return Math.max(s, min); })();
  // På golvet: ligger den nya klibban mest på baksidespapper fastnar den inte (servern kollar samma sak).
  if (peelLayer.on && peelLayer.count && onFloor(h.surface, h.normal.toArray())) {
    const frac = await peelLayer.overlap(state.selected, { position: h.point.toArray(), quaternion: q.toArray(), size: slapSize });
    if (frac > PEEL.refuseOverlap) { if (!auto) nope(); return null; }
  }
  if (auto) auto.started(h); // counted from here: it shows now
  pendingJitter = (Math.random() - 0.5) * 30;
  // Min gubbe slår handen mot väggen i samma bildruta som klibban syns (bara i tredjepersonsvy).
  together.selfGesture('slap', h.point, h.normal);
  // Hit flash + discreet wind puff at the slap (client/src/slapfx.js).
  try { slapFx.burst(h.point, h.normal, camera.position); } catch { /* fx is cosmetic */ }
  // Kom ihåg exakt vilken design som stämplas: användaren kan hinna trycka R innan svaret kommer.
  const design = state.selected;
  if (!auto || auto.first !== false) { const [dw, dh] = stampDims(design, 1); filmLog?.add('stick', { url: String(design.url || '').length < 200_000 ? design.url || '' : '', aspect: dh > 0 ? +(dw / dh).toFixed(3) : 1 }); } // the session film

  // Dance mode (Jens, 11 Nov 2026): while I dance, MY distance (head) to where the sticker lands sets this slap's
  // envelope hold – 0 s within 1 m, 3 s across the city (96 m), linear (shared/dancehold.mjs). Not dancing: untouched.
  const danceHold = slapHold({ dancing: together.dancing(), from: camera.position.toArray(), to: h.point.toArray() });
  { const [aw, ah] = stampDims(design, slapSize); sound.play('slap', null, { area: aw * ah, size: slapSize, ...(auto ? { volume: auto.volume } : {}), ...(danceHold != null ? { hold: danceHold } : {}) }); } // bigger sticker = bigger slap (same curve as duff)
  // The delay room: a slap sets its three delay times from MY distance to each delay (not the sticker's).
  if (CITY_OUTSIDE && delayRoom.slap(camera.position.x, camera.position.z)) placeAt = 0;
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
  if (peelLayer.on && dropsPeel(design, slapSize)) {
    const [pw, ph] = stampDims(design, slapSize);
    peelLayer.add({ id: tempPeel, imageId: design.id, w: pw, h: ph, seed: nonce, ...peelPlan(nonce, { x: camera.position.x, z: camera.position.z, yaw: controls.yaw }, body.position, CITY_OUTSIDE ? CITY : undefined, body.normal) }, design, { animate: true, by: 'me' });
  } else paperlessDuff(design, slapSize, nonce, { x: camera.position.x, z: camera.position.z, yaw: controls.yaw }, body.position, body.normal, 'me');
  let settle; const settled = new Promise((r) => { settle = r; });
  pendingSlaps.set(nonce, { tempId, image: design, peel: false, settled, ...(auto ? { burst: auto.burst } : {}) });
  stamps.add(temp, design).then(updateCount);
  // Highlight reel: log my sticker + neighbours (homage) + cross-camera cameos.
  if (highlightLog && (!auto || auto.first !== false)) {
    const [dw, dh] = stampDims(design, slapSize);
    const others = [...stamps.meshes.values()].map((m) => m.userData.stamp).filter((s) => s && !s.pending && !highlightLog.isMine(s.id) && s.id !== tempId);
    for (const o of others) {
      if (!highlightLog.events().some((e) => e.e === 'other' && e.id === o.id)) {
        highlightLog.add('other', { id: o.id, p: o.position, size: o.size, imageId: o.imageId, by: 'other' });
      }
    }
    highlightLog.add('stick', {
      id: tempId, p: body.position, size: slapSize, by: together.net.id || 'me',
      imageId: design.id, url: String(design.url || '').length < 200_000 ? design.url || '' : '',
      aspect: dh > 0 ? +(dw / dh).toFixed(3) : 1, surface: body.surface, normal: body.normal,
    });
    highlightLog.noteMine(tempId);
    const meP = [camera.position.x, camera.position.y, camera.position.z];
    for (const x of findCrossCameraMoments({ myPos: meP, myId: together.net.id || 'me', cameras: highlightCrew, othersActions: others.length ? [{ by: 'other', t: Date.now() }] : [], t: Date.now() - highlightLog.t0 })) {
      highlightLog.add('cross', { cam: x.cam, playerId: x.playerId, p: x.p, by: x.by, camPose: x.camPose });
    }
  }
  if (onStart) {
    Object.assign(info, { point: h.point.clone(), normal: h.normal.clone(), q: q.clone(), size: slapSize, surface: h.surface, design, nonce, temp });
    // The array path must never cost the slap itself: if starting a row fails, this is a plain slap.
    try { onStart(info); } catch (err) { arrayFailed('start', err); }
  }
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
    if (auto) { if (err.status === 429) { autoSlap?.setOn(false); toast(S.slowDown); } } // quiet otherwise: the next step tries again
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
  if (highlightLog) {
    highlightLog.noteMine(stamp.id);
    // Keep the stick event's id in sync with the server id (homage dedupe).
    for (const e of highlightLog.list) if (e.e === 'stick' && e.id === p.tempId) e.id = stamp.id;
  }
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
let arrayDrag = null; // { a, w, h, endW, endH, endSize, face, to, items }
const arrayOps = []; // released rows waiting for the server (Z peels the newest as one step)
const ARRAY_FACES = boxFaces();
const ghosts = new ArrayGhosts(scene, stamps.faces);
const arrayPlane = new THREE.Plane(), arrayHit = new THREE.Vector3();
// Arrays work in some browsers and not in others. Whatever goes wrong on the array path (starting
// the row, the ghosts, the release, the server's …/stamps/array), the click is still exactly one
// sticker – the first one, which is a normal slap of its own. arrayFaults: test hooks only.
const arrayFaults = { start: false, update: false, commit: false };
let arraysOff = false; // the server has no …/stamps/array (404/405/501): plain slaps from now on
function arrayFailed(where, err) {
  console.warn(`sticker array (${where}) failed – one sticker instead:`, err && err.message ? err.message : err);
  arrayDrag = null; try { ghosts.hide(); } catch { /* the ghosts themselves may be what failed */ }
}
function startArray(a) {
  if (arraysOff) return;
  if (arrayFaults.start) throw new Error('test: array start unavailable');
  if (propMeshSurface(a.surface)) return; // a 3D prop's mesh (not a flat face): no rows there – one sticker
  const [w, h] = StampLayer.dims(a.design, a.size);
  arrayDrag = { a, w, h, endW: w, endH: h, endSize: a.size, face: faceFor(ARRAY_FACES, a.surface, a.point.toArray(), a.normal.toArray()), to: null, items: [] };
  arrayPlane.setFromNormalAndCoplanarPoint(a.normal, a.point);
  ghosts.setTexture(null);
  stamps.texture(a.design).then((t) => { if (arrayDrag && arrayDrag.a === a) ghosts.setTexture(t); }).catch(() => {});
}
// Scroll wheel while dragging: scale the LAST sticker; the row fans from the anchor size to that.
function scaleArrayEnd(deltaY, deltaMode = 0) {
  const d = arrayDrag; if (!d) return;
  const factor = wheelScaleFactor(deltaY, deltaMode);
  const minM = minSizeCm(d.a.design) / 100, maxM = maxSizeCm(d.a.design) / 100;
  d.endSize = clampStampSize(d.endSize * factor, minM, maxM);
  const [ew, eh] = StampLayer.dims(d.a.design, d.endSize);
  d.endW = ew; d.endH = eh;
}
// Every frame while dragging: B = where the crosshair's ray meets A's plane. Returns the ghost count.
function updateArray() {
  const d = arrayDrag;
  if (arrayFaults.update) throw new Error('test: array update unavailable');
  aimRay(CENTER);
  if (raycaster.ray.intersectPlane(arrayPlane, arrayHit)) d.to = arrayHit.clone(); // looking away from the plane: keep the last B
  d.items = d.to ? arrayPlan({ position: d.a.point.toArray(), quaternion: d.a.q.toArray(), surface: d.a.surface }, d.w, d.h, d.to.toArray(), { endW: d.endW, endH: d.endH }).items.filter((x) => x.i > 0) : [];
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
  if (arrayFaults.commit) throw new Error('test: array commit unavailable');
  if (!d || !d.to) return null;
  const items = d.items.length ? d.items : [];
  if (!items.length) return null;
  const { a } = d, design = a.design;
  const from = { x: camera.position.x, z: camera.position.z, yaw: controls.yaw };
  const op = { a, temps: [], peeled: false, done: null };
  let settle; const settled = new Promise((r) => { settle = r; });
  const now = new Date().toISOString();
  let papers = 0;
  for (const it of items) {
    const { i, position } = it;
    const copySize = Math.max(it.w || d.w, it.h || d.h);
    const nonce = `${a.nonce}x${i}`;
    myNonces.add(nonce); setTimeout(() => myNonces.delete(nonce), 60_000);
    const tempId = 'tmp-' + nonce;
    pendingSlaps.set(nonce, { tempId, image: design, peel: false, settled, row: a.nonce });
    stamps.add({ ...a.temp, id: tempId, position, size: copySize, order: stamps.topOrder() + 1, createdAt: now, pending: true }, design).then(updateCount);
    if (peelLayer.on && dropsPeel(design, copySize) && papers < PEELS_PER_ARRAY) {
      papers++;
      const pw = it.w || d.w, ph = it.h || d.h;
      peelLayer.add({ id: tempId, imageId: design.id, w: pw, h: ph, seed: nonce, ...peelPlan(nonce, from, position, CITY_OUTSIDE ? CITY : undefined, a.normal.toArray()) }, design, { animate: true, by: 'me' });
    } else if (papers < PEELS_PER_ARRAY && paperlessDuff(design, copySize, nonce, from, position, a.normal.toArray(), 'me')) papers++;
    op.temps.push({ i, nonce, tempId, size: copySize, area: (it.w || d.w) * (it.h || d.h) });
  }
  // Soft rattle along the row; each copy's slap follows its size (fan → rising/falling slap).
  for (let k = 0; k < Math.min(8, items.length); k++) {
    const it = items[k], area = (it.w || d.w) * (it.h || d.h), sz = Math.max(it.w || d.w, it.h || d.h);
    setTimeout(() => sound.play('slap', null, { volume: Math.max(0.15, 0.45 - k * 0.04), area, size: sz }), 40 * (k + 1));
  }
  arrayOps.push(op);
  // The recording keeps the row (ghosts + drag pose) until the copies are in (see recordHeld).
  const bridge = (arrayRec = { msg: heldMsg({ row: d }) });
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
          endSize: d.endSize, ...(together.net.id ? { by: together.net.id } : {}), peelFrom: { p: [from.x, from.z], yaw: from.yaw } });
      } catch (err) {
        dropAll(); // the row did not make it: the first sticker (its own slap) stays – one sticker
        if ([404, 405, 501].includes(err.status)) { arraysOff = true; console.warn('sticker arrays not supported here – plain slaps'); return; }
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
      if (bridge && arrayRec === bridge) arrayRec = null;
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
  sound.play('peel', null, { size: op.a.size }); toast(S.peeled, 900);
  return op.done.then(() => op.a.result).then(() => peelSettled()).then(() => true);
}

// ---------- Admin (dold): öppna sidan med ?admin=NYCKEL (or bare ?admin → prompt) ----------
// Kept in this browser (localStorage + sessionStorage) after a successful check, so a new tab or
// restart still knows Jens is admin – the key itself never ships in client code or chat.
// Bare ?admin (no ?room=) during the build phase opens the build city, where Props stick into the
// default city preset (shared/city.mjs BUILD_CITY).
const ADMIN_STORE = 'klibb.admin';
const adminGet = () => { try { return sessionStorage.getItem(ADMIN_STORE) || localStorage.getItem(ADMIN_STORE); } catch { return sessionStorage.getItem(ADMIN_STORE); } };
const adminSet = (t) => { try { sessionStorage.setItem(ADMIN_STORE, t); localStorage.setItem(ADMIN_STORE, t); } catch { try { sessionStorage.setItem(ADMIN_STORE, t); } catch { /* private */ } } };
const adminClear = () => { try { sessionStorage.removeItem(ADMIN_STORE); localStorage.removeItem(ADMIN_STORE); } catch { try { sessionStorage.removeItem(ADMIN_STORE); } catch { /* private */ } } };
async function initAdmin() {
  if (params.has('admin')) {
    const t = params.get('admin') || prompt(S.adminPrompt) || '';
    adminSet(t);
    params.delete('admin');
    // No room yet + build phase: go to the build city (props there autosave into the city preset).
    if (!params.has('room') && CITY_BUILD_PHASE) {
      history.replaceState(null, '', `${location.pathname}?room=${encodeURIComponent(BUILD_CITY)}`);
      location.reload();
      return;
    }
    history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
  }
  const token = adminGet();
  if (!token) return;
  const { ok } = await api.checkAdmin(token).catch(() => ({ ok: false }));
  if (!ok) { adminClear(); toast(S.adminWrong); return; }
  adminSet(token); // sync both stores after a good check (e.g. only session had it)
  state.adminToken = token;
  $('admin-banner').hidden = false;
  updateStyleUi(); renderRecs();
  syncNatureMode(); // Props button may appear now that we are admin
}

// Admin: save this room as a preset (Jens designs rooms with the nature stickers and gives the room
// codes): its stickers baked into six images (preset.js) + its look → POST /api/admin/presets.
// Also scripts/make-preset.js (a room code → a preset, headless).
// The preset is a snapshot: the six images + the look are stored with the preset (presets/), so it
// lives on when this room is gone. title = the name the start card's picker shows (else the room code);
// thumb: true = this view, as it is now, is the picker's picture (the button; the script makes its own).
async function savePreset({ name = '', title = '', thumb = false, pxPerM = PRESET_PX_PER_M } = {}) {
  if (!state.adminToken) throw new Error('admin only');
  if (!roomSizer.isDefault()) throw new Error('Room size test is on: Reset the room size first'); // a preset is baked in the real box
  let shot = null;
  // (in a frame callback queued after the render loop's: the frame just drawn, before it is shown and cleared)
  if (thumb) shot = await new Promise((ok) => requestAnimationFrame(() => renderer.domElement.toBlob(ok, 'image/jpeg', 0.88)));
  const { faces, count } = await bakeFaces(renderer, scene, room.surfaces.filter((x) => !x.userData.prop), { pxPerM });
  const fd = new FormData();
  fd.append('sourceRoom', ROOM); fd.append('name', name || ROOM); if (title) fd.append('title', title);
  if (shot) fd.append('thumb', shot, 'thumb.jpg');
  for (const [f, blob] of Object.entries(faces)) fd.append(f, blob, `${f}.png`);
  const r = await fetch('/api/admin/presets', { method: 'POST', headers: { 'x-admin-token': state.adminToken }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return { ...j.preset, stickers: count };
}
async function bakePresetUrls(opts) { // (tests / a look before saving) the six images as blob: URLs
  const { faces, count } = await bakeFaces(renderer, scene, room.surfaces.filter((x) => !x.userData.prop), opts);
  return { count, faces: Object.fromEntries(Object.entries(faces).map(([f, b]) => [f, URL.createObjectURL(b)])) };
}
document.getElementById('save-preset')?.addEventListener('click', async (e) => {
  const b = e.currentTarget; b.disabled = true;
  const title = window.prompt(S.presetNamePrompt, ''); if (title === null) { b.disabled = false; return; } // cancel: nothing saved
  try { const p = await savePreset({ name: ROOM, title: title.trim(), thumb: true }); toast(S.presetSaved(p.id, p.stickers), 5000); } catch (err) { toast(err.message); } finally { b.disabled = false; }
});

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
  if (state.mode === 'view') {
    cancelArray();
    if (propsMode()) propsUi.setActive(false);
    if (packsMode()) document.body.classList.remove('packs-mode');
  }
  const view = state.mode === 'view';
  document.body.classList.toggle('view-mode', view);
  if (view) preview.hide(); else hideCredit();
  cams.setVisible(!view && camShow);
  $('mode-btn').setAttribute('aria-pressed', String(view));
  $('mode-btn').title = view ? S.modeBtnToSlap : S.modeBtnToLook;
  syncNatureMode();
  if (!quiet) toast(view ? S.modeToastLook(isTouch, DEMO) : natureMode() ? S.modeToastNature(isTouch) : S.modeToastSlap(isTouch), 1600);
  return state.mode;
}
const toggleMode = () => setMode(state.mode === 'view' ? 'slap' : 'view');
// ---------- Slap mode / Nature mode (V; Jens, 28 Oct 2026) ----------
// V toggles Slap mode ⇄ Nature mode (it used to toggle Look mode; Look mode is now G, the panel's
// "Look mode" button and the phone's 👁). Nature mode = slapping from the Nature wheel (the held
// sticker is a nature sticker: V picks the one you had last, else the first); V again = back to the
// sticker you had on the sticker wheel. (Nature mode has no sound of its own: the procedural nature
// ambience was removed, Jens 29 Oct 2026.) Picking from the Nature wheel / its list is the same as V (and picking from the
// sticker wheel = Slap mode). Nature is the full version's: free, V opens the full version panel and
// you stay in Slap mode. The demo has no nature stickers: there V stays Look mode.
function natureMode() { return state.mode === 'slap' && activeWheel() === 'nature'; }
function packsMode() { return !!document.body.classList.contains('packs-mode'); }
function syncNatureMode() {
  const on = natureMode() && !propsMode() && !packsMode();
  const m = state.mode === 'view' ? 'look' : packsMode() ? 'packs' : propsMode() ? 'props' : on ? 'nature' : 'slap';
  document.body.classList.toggle('nature-mode', on);
  $('mode-hud').textContent = S.modeHud(m, isTouch, DEMO);
  // Wheel buttons (replaced Slap/Nature/Props/Look). Look mode: G / phone 👁 only.
  const sb = $('mode-stickers'); if (sb) sb.setAttribute('aria-pressed', String(m === 'slap'));
  const nb = $('mode-nature');
  if (nb) { nb.setAttribute('aria-pressed', String(m === 'nature')); nb.classList.toggle('locked', !natureOpen()); nb.hidden = DEMO || !natureDesigns().length; }
  const ab = $('mode-assets'); if (ab) { ab.setAttribute('aria-pressed', String(m === 'props')); ab.hidden = !(propsUi && propsUi.open()); }
  const pb = $('mode-packs'); if (pb) pb.setAttribute('aria-pressed', String(m === 'packs'));
}
function setNatureMode(on, { quiet = false } = {}) {
  // free: the upgrade panel instead – plus a toast that SAYS why, so V never looks dead (Jens, 28 Oct 2026:
  // "Nature mode doesn't work" = the generic panel opened and nothing named Nature mode)
  if (on && !natureOpen()) { fullUi?.open(); if (!quiet) toast(S.natureModeLocked, 2600); return false; }
  if (state.mode === 'view') setMode('slap', { quiet: true });
  if (on) document.body.classList.remove('packs-mode');
  if (on && activeWheel() !== 'nature') {
    const list = natureDesigns(), d = list.find((x) => x.id === lastNatureId) || list[0];
    if (!d) return false;
    select(d);
  } else if (!on && activeWheel() === 'nature') {
    const list = stickerDesigns();
    select(list.find((x) => x.id === lastStickerId) || list[0] || null);
  }
  syncNatureMode();
  if (!quiet) toast(natureMode() ? S.modeToastNature(isTouch) : S.modeToastSlap(isTouch), 1600);
  return natureMode();
}
// V: Look mode → back to slapping (the wheel you were on); else Slap ⇄ Nature.
// In the build phase (the Props wheel open to me): Slap → Nature → Props → Slap (no Nature: Slap ⇄ Props).
function toggleNature() {
  if (DEMO) return toggleMode();
  if (state.mode === 'view') { setMode('slap'); return propsMode() ? 'props' : natureMode() ? 'nature' : 'slap'; }
  if (propsMode()) { propsUi.setActive(false); setNatureMode(false, { quiet: true }); syncNatureMode(); toast(S.modeToastSlap(isTouch), 1600); return 'slap'; }
  const canProps = propsUi && propsUi.open();
  if (canProps && (natureMode() || !natureOpen() || !natureDesigns().length)) { setProps(true); return 'props'; }
  setNatureMode(!natureMode());
  return natureMode() ? 'nature' : 'slap';
}
// Props mode on/off (the third wheel; propsmode.js). On: the sticker wheels step aside.
function setProps(on) {
  if (on && !(propsUi && propsUi.open())) { toast(S.propsLocked || 'Props: the build phase’s builders only.', 2400); return false; }
  if (state.mode === 'view') setMode('slap', { quiet: true });
  if (on) setPacksMode(false, { quiet: true });
  propsUi.setActive(on); syncNatureMode();
  if (on) toast(isTouch ? '🪑 Props: pick one on the wheel, tap the floor to place it, tap a prop to change it.' : '🪑 Props: pick one on the wheel (R/F), click to place it, click a prop to change it. Q/E turn · wheel = size · V = slap mode.', 3200);
  return propsMode();
}
function setPacksMode(on, { quiet = false } = {}) {
  on = !!on;
  if (on) {
    if (propsMode()) propsUi.setActive(false);
    if (state.mode === 'view') setMode('slap', { quiet: true });
    if (natureMode()) setNatureMode(false, { quiet: true });
  }
  document.body.classList.toggle('packs-mode', on);
  syncNatureMode();
  renderStrip();
  if (!quiet && on) toast(S.packsTitle || 'Packs you carry (up to 3)', 1800);
  return packsMode();
}
function updateWheelLabel() {
  const lab = $('wheel-label'); if (!lab) return;
  if (packsMode()) {
    const packs = readPacks();
    lab.textContent = packs.length ? `📦 PACKS · ←/→ ${packs.length}/${PACKS_MAX}` : (S.packsEmpty || 'PACKS');
    lab.hidden = false; return;
  }
  if (activeWheel() === 'nature') {
    lab.textContent = '🌿 NATURE · ←/→';
    lab.hidden = false; return;
  }
  lab.textContent = FILM_STUDIO ? '🎬 STICKERS · ←/→ · J = jam' : 'STICKERS · ←/→';
  lab.hidden = false;
}
/** While the wheel is lit: ←/→ cycles stickers / nature / packs (same in city and room). */
function switchWheelSide(dir) {
  wheelUp();
  // City matches the room: ←/→ cycles stickers / nature / packs (no reduced pack-slot wheels).
  const kinds = ['stickers'];
  if (natureOpen() && natureDesigns().length) kinds.push('nature');
  kinds.push('packs');
  const cur = packsMode() ? 'packs' : activeWheel() === 'nature' ? 'nature' : 'stickers';
  let i = kinds.indexOf(cur); if (i < 0) i = 0;
  const next = kinds[(i + dir + kinds.length) % kinds.length];
  if (next === 'packs') setPacksMode(true, { quiet: true });
  else if (next === 'nature') { setPacksMode(false, { quiet: true }); setNatureMode(true, { quiet: true }); }
  else { setPacksMode(false, { quiet: true }); if (natureMode()) setNatureMode(false, { quiet: true }); else { if (state.mode !== 'slap') setMode('slap', { quiet: true }); syncNatureMode(); renderStrip(); } }
  updateWheelLabel();
  return next;
}

function setStickersWheel() {
  if (propsMode()) propsUi.setActive(false);
  setPacksMode(false, { quiet: true });
  if (state.mode !== 'slap') setMode('slap', { quiet: true });
  if (natureMode()) setNatureMode(false, { quiet: true });
  toast(S.modeToastSlap(isTouch), 1600);
}
// var: setMode längre ner använder den innan raden här har körts.
var stackMenu = null; // eslint-disable-line no-var -- touch only: the sticker stack menu + the held sticker's timer (stackmenu.js)
var camShow = localStorage.getItem('klibb.camShow') !== '0'; // eslint-disable-line no-var
// A room starts in View mode (Jens, 2 Nov 2026): look around first; a click on a free surface = Slap mode.
// Touch has no mode switch: there the held timer's idle / faded state already is the view mode (a tap
// wakes the sticker, a tap on a sticker shows its credit), so a phone starts as before.
if (!isTouch) setMode('view', { quiet: true });
$('mode-btn').onclick = (e) => { e.preventDefault(); toggleMode(); }; // Look mode (touch 👁); desktop Look = G
$('mode-stickers').onclick = () => setStickersWheel();
$('mode-nature').onclick = () => { setPacksMode(false, { quiet: true }); if (propsMode()) propsUi.setActive(false); setNatureMode(true); };
$('mode-assets').onclick = () => { setPacksMode(false, { quiet: true }); setProps(!propsMode()); };
$('mode-packs').onclick = () => setPacksMode(!packsMode());

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
  const size = stamps.meshes.get(fresh[0].stampId)?.userData.stamp?.size; // the peel's pitch follows it (sizeRate)
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
  if (!quiet) sound.play('peel', null, { size });
  updateCount(); scheduleHistory();
  flushPeels();
  return fresh.length;
}
// Min gubbe griper klibban och drar bort den (tredjepersonsvy).
function peelGesture(id) {
  filmLog?.add('peel');
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
    const size = stamps.meshes.get(pend.tempId)?.userData.stamp?.size;
    peelGesture(pend.tempId);
    stamps.peelAway(pend.tempId).then(updateCount);
    sound.play('peel', null, { size }); toast(S.peeled, 900);
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
  // A library sticker's credit (its file name "<name> - <Creator> @<handle>.png", shared/stickercredit.mjs)
  // is looked up too, so stickers placed before their credit was known show it as well.
  const lib = stamp && !stamp.artist && !stamp.artistLink ? state.library.find((d) => d.id === stamp.imageId && d.library) : null;
  const src = lib ? { artist: lib.artist, artistLink: lib.artistLink } : stamp;
  const name = cleanArtistName(src?.artist), link = cleanArtistLink(src?.artistLink || '');
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
  $('credit-hint').textContent = c.link ? (at ? S.creditOpenTap : controls.locked ? S.creditOpenKey : S.creditOpenClick) : '';
  // Big and clear (Jens, 2 Nov 2026), always in the same place (top middle); clickable when the mouse is free.
  el.classList.toggle('tap', !!at || !controls.locked);
  el.hidden = false;
  clearTimeout(credit.timer); credit.timer = setTimeout(hideCredit, 8000);
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
  if (!(state.mode === 'view' && !camView && !sp.open)) hideCredit();
}
// Desktop click in Look mode: the sticker under the dot shows its credit (or switches to it);
// the same sticker again opens its link; empty wall (or a sticker without a name/link) hides it.
// Returns: 'credit' (a sticker with a credit), 'sticker' (one without), or null (no sticker there).
function clickCredit(ndc = CENTER) {
  if (camView || sp.open) return 'sticker';
  const p = pickStampAt(ndc);
  const c = creditOf(p?.stamp);
  if (!c) { hideCredit(); return p ? 'sticker' : null; }
  if (credit.shown && credit.shown.id === c.id) { if (c.link) openLink(c.link); return 'credit'; }
  showCredit(c); credit.id = c.id;
  return 'credit';
}
// View mode (Jens, 2 Nov 2026): a click on a surface with no sticker and no button on it = back to
// Slap mode (the held sticker comes back sharp; this click places nothing).
function viewClick(ndc = CENTER) {
  if (clickCredit(ndc)) return 'sticker';
  if (!hitSurface(ndc)) return null;
  setMode('slap', { quiet: true }); toast(natureMode() ? S.modeToastNature(isTouch) : S.modeToastSlap(isTouch), 1400);
  // back in Slap mode: a sticker not placed yet stays held sharp until placed (holding); one that
  // faded comes back sharp for a fresh 2 s (and fades back to View mode if it is not used)
  if (!aimOff && deskHeld && deskHeld.state !== 'holding') deskHeld.wake(performance.now());
  return 'slap';
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
var escMenu = null; // eslint-disable-line no-var -- assigned after menuActions (Esc big-button menu)
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
// A browser that cannot lock the pointer at all (it never locked once): clicks then slap where they
// land. A refused re-lock after a working one (Chrome: too soon after Esc) is NOT that.
document.addEventListener('pointerlockerror', () => { if (!everLocked) lockBroken = true; }, { passive: true }); // handled by the hint
document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement) { everLocked = true; lockBroken = false; } });
var everLocked = false; // eslint-disable-line no-var
// var: the mousedown handler reads it; no Pointer Lock API at all = broken from the start.
var lockBroken = typeof HTMLCanvasElement !== 'undefined' && !HTMLCanvasElement.prototype.requestPointerLock; // eslint-disable-line no-var
function resumeGame() { setResuming(true); tryLock(); }
// Topmost panel/dialog Esc should close (not the Esc button row). Null when nothing is up.
// Priority: always close a panel before toggling the Esc buttons (Jens, Nov 2026).
function escTopPanel() {
  // CREATE submenu (STICKERS / STICKER PACK) closes first, like any other top panel.
  if (escMenu?.submenuOpen?.()) return () => escMenu.closeSubmenu();
  if (placingCam) return () => cancelPlacingCam();
  if (camView) return () => exitCamView();
  if (fullUi?.isOpen()) return () => fullUi.close();
  if (!$('sound-panel').hidden) return () => soundUi.close();
  if (!$('avatar-panel').hidden) return () => $('av-cancel').click();
  if (!$('room-panel').hidden) return () => closeRoomPanel();
  if (sp.open) return () => closeStylePanel(true);
  if (!$('more-panel').hidden) return () => closeMore();
  if (!$('room-menu').hidden) return () => closeRoomMenu();
  if (!$('menu-choice').hidden) return () => closeChoice();
  if (doorOpen()) return () => $('df-cancel')?.click();
  if (nameTagOpen()) return () => $('nt-exit')?.click();
  if (cityPickOpen()) return () => $('cp-x')?.click();
  if (busSheetOpen()) return () => closeBusSheet();
  if (townHallOpen()) return () => $('th-x')?.click();
  if (credit.id) return () => hideCredit();
  return null;
}
// True only for real text fields – a <select> in Sound settings must not eat Esc (panel should close).
function isEscTextField(e) {
  const t = e.target;
  if (!t || !t.closest) return false;
  if (t.closest('textarea, [contenteditable=""], [contenteditable="true"]')) return true;
  const inp = t.closest('input');
  return !!inp && !['range', 'checkbox', 'radio', 'button', 'file', 'color'].includes(inp.type);
}
function onEscape(e) {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  if (arrayDrag) { e.preventDefault(); cancelArray(); return; } // Esc while dragging: no copies (the first sticker stays)
  if (endDlg.open || linkDlg.open) return;          // <dialog> closes itself on Esc
  if (together.chatOpen()) return;                   // the chat input closes itself (together.js)
  if (isEscTextField(e)) { e.target.blur(); return; } // first Esc just leaves the text field
  // 1) Close the topmost open panel/dialog – do NOT spawn the button row on the same press.
  const close = escTopPanel();
  if (close) { e.preventDefault(); close(); return; }
  if (isTouch) return;                               // touch uses the Menu button (same priority there)
  if (controls.locked) return;                       // the browser unlocks; onLockChange opens the Esc menu
  if (e.repeat) return;
  // 2) Same Esc that just unlocked: keep / spawn the button row (don't resume yet).
  if (performance.now() - escGate.unlockedAt < 500) {
    e.preventDefault();
    if (!escMenu?.isOpen()) escMenu?.open();
    return;
  }
  // 3) No panel up: toggle the button row. Esc with it open resumes the game; Esc with nothing
  //    open shows the buttons (not a silent resumeGame – Jens: panel → Esc closes → Esc shows buttons).
  e.preventDefault();
  if (resuming) setResuming(false);
  if (escMenu?.isOpen()) escMenu.close({ resume: true });
  else escMenu?.open();
}
addEventListener('keydown', onEscape);
controls.onLockChange = (locked) => {
  if (!locked) cancelArray(); // Esc leaves pointer lock first: that cancels a sticker array too
  // Esc (the player left the game) turns auto-slap off; our own unlocks (menus, chat) and a hidden tab only pause it.
  const realEsc = !locked && performance.now() - softUnlockAt > 400 && document.visibilityState === 'visible' && document.hasFocus();
  if (realEsc && autoSlap && autoSlap.on) autoSlap.setOn(false);
  if (!locked) escGate.unlockedAt = performance.now();
  if (locked) { setResuming(false); escMenu?.close(); }
  document.body.classList.toggle('locked', locked);
  if (locked) { closeMore(); closeRoomMenu(); }
  $('crosshair').hidden = !locked || aimOff;
  if (!locked) { preview.hide(); hideCredit(); } // Esc (leaving the room) hides the artist credit
  // Real Esc out of the game → spawn the big-button menu (not a soft unlock for a panel).
  // Never over an open panel (e.g. Sound settings opened from a soft unlock).
  if (realEsc && !escTopPanel()) escMenu?.open();
};

// 'My avatar' open: drag = spin; a tap with a patch tool selected stamps a decal (look.patches).
{
  let avDrag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!together.avatarView() || avDrag) return;
    avDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, sx: e.clientX, sy: e.clientY };
    together.avatarDrag(true);
    try { canvas.setPointerCapture(e.pointerId); } catch { /* fine */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!avDrag || e.pointerId !== avDrag.id) return;
    const dx = e.clientX - avDrag.x, dy = e.clientY - avDrag.y;
    avDrag.moved += Math.abs(dx) + Math.abs(dy);
    avDrag.x = e.clientX; avDrag.y = e.clientY;
    together.spinAvatar(dx);
  });
  const avUp = (e) => {
    if (!avDrag || e.pointerId !== avDrag.id) return;
    const d = avDrag; avDrag = null; together.avatarDrag(false);
    // Tap (little movement) + patch tool → stamp; drag still only spins.
    if (d.moved < 10 && together.getPatchTool?.()) {
      const cam = (typeof showCam !== 'undefined' && showCam) ? showCam : camera;
      together.stampPatchAt?.(d.sx, d.sy, cam);
    }
  };
  canvas.addEventListener('pointerup', avUp); canvas.addEventListener('pointercancel', avUp);
}

var viewDrag = null; // eslint-disable-line no-var -- desktop View mode, mouse free: a press that may become a look-around drag
if (!isTouch) {
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (sp.open || together.busy()) return; // panelen för rummets utseende eller Min gubbe är öppen
    if (together.chatOpen()) { together.closeChat(); if (!controls.locked) controls.lock(); return; } // klick = stäng chatten, stämpla inte
    if (!controls.locked && lockBroken && !placingCam && state.mode === 'slap') {
      if (menuClick(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1))) return; // a menu sticker
      if (deskPress()) return; // faded: this click only brings the held sticker back
      // No pointer lock in this browser: a click still slaps – one sticker where you clicked (no arrays).
      if (state.selected && hitSurface(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1))) { deskHeld.placed(performance.now()); wheelDown({ fromSelect: true }); }
      action(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1));
      return;
    }
    // View mode with the mouse free (e.g. right after entering the room): drag = look around, a click
    // = a button (menu sticker), a sticker's credit, or (a free surface) Slap mode + the mouse locked.
    if (!controls.locked && state.mode === 'view' && !placingCam) { viewDrag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false }; return; }
    if (!controls.locked) { if (state.mode === 'slap') deskPress(); controls.lock(); } // (the click that locks: wakes a faded one too)
    else if (placingCam) placeCamAt(CENTER); // ＋ Add cameraman: this click sets where it starts
    else if (menuClick(CENTER)) { /* a menu sticker: its menu opened (menustickers.js) */ }
    else if (state.mode === 'view') viewClick(); // View mode: a sticker = who made it? (never slaps); a free surface = Slap mode
    else if (propsMode()) propsUi.click(CENTER); // Props mode: place the held prop / select one
    else if (deskPress()) { /* faded: this press only brings the held sticker back – no slap (point 10) */ }
    else {
      // Hold the button and look/drag away: the sticker repeats toward the crosshair (sticker arrays).
      if (state.selected && hitSurface(CENTER)) { deskHeld.placed(performance.now()); wheelDown({ fromSelect: true }); } // each placement restarts its 2 s; strip fades
      mouseHeld = true;
      action(CENTER, { onStart: (a) => { if (mouseHeld && controls.locked && state.mode === 'slap') startArray(a); } });
    }
  });
  addEventListener('mousemove', (e) => {
    if (!viewDrag || controls.locked) return;
    if (Math.hypot(e.clientX - viewDrag.sx, e.clientY - viewDrag.sy) > 5) viewDrag.moved = true;
    if (viewDrag.moved) controls.look((e.clientX - viewDrag.x) * 0.005, (e.clientY - viewDrag.y) * 0.005);
    viewDrag.x = e.clientX; viewDrag.y = e.clientY;
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0 && viewDrag) {
      const d = viewDrag; viewDrag = null;
      if (!d.moved && !controls.locked && state.mode === 'view') {
        const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
        if (!menuClick(ndc) && viewClick(ndc) === 'slap') controls.lock(); // Slap mode: aim with the mouse locked, as always
      }
      return;
    }
    if (e.button !== 0) return; mouseHeld = false;
    if (arrayDrag) { try { commitArray(); } catch (err) { arrayFailed('release', err); } }
  });
  // Right-click while dragging: cancel the copies (the first sticker stays).
  canvas.addEventListener('mousedown', (e) => { if (e.button === 2 && arrayDrag) { e.preventDefault(); cancelArray(); } });
  canvas.addEventListener('contextmenu', (e) => { if (arrayDrag || controls.locked) e.preventDefault(); });
  // any input = working with the held sticker (deskHeld): its 2 s start again while it is up (not once faded)
  addEventListener('mousemove', (e) => { if (e.movementX || e.movementY) deskActive(); }, true);
  addEventListener('keydown', () => deskActive(), true);
  addEventListener('wheel', () => deskActive(), { capture: true, passive: true });
  // Array drag: wheel scales the LAST sticker (fan). preventDefault so the page / camera don't scroll.
  addEventListener('wheel', (e) => {
    if (!arrayDrag) return;
    e.preventDefault();
    try { scaleArrayEnd(e.deltaY, e.deltaMode); updateArray(); } catch (err) { arrayFailed('wheel', err); }
  }, { passive: false });
  addEventListener('wheel', (e) => {
    if (arrayDrag) return; // handled above
    if (propsMode()) { if (controls.locked || propsUi.selected()) propsUi.scaleBy(e.deltaY > 0 ? 1 / 1.08 : 1.08); return; }
    if (controls.locked && state.mode === 'slap') setSize(state.size * 100 * (e.deltaY > 0 ? 0.9 : 1.1));
  }, { passive: true });
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
    if (e.code === 'KeyV' && !e.repeat && !selfieOn()) toggleNature(); // Slap ⇄ Nature mode (the demo: Look mode)
    if (e.code === 'KeyG' && !e.repeat) toggleMode(); // Look mode on/off (was V until 28 Oct 2026)
    if (e.code === 'KeyM' && !e.repeat) setMuted(!sound.muted);
    if (e.code === 'KeyP' && !e.repeat) snapPhoto(); // 📷 Photo
    if (e.code === 'KeyC' && !e.repeat) toggleView();
    if (e.code === 'KeyX' && !e.repeat) toggleDance(); // runway dance (shared/dance.mjs): X starts it looping, X again stops it
    if (e.code === 'KeyL' && !e.repeat && credit.shown?.link) openLink(credit.shown.link);
    if (e.code === 'KeyO' && !e.repeat) setAimOff(!aimOff); // aim tool on/off (sikte; stickers, nature, assets)
    if (propsMode()) { // the Props wheel: Q/E turn, R/F the next/previous prop, Delete removes the selected one, Esc lets go
      if (e.code === 'KeyQ') propsUi.turn(1);
      if (e.code === 'KeyE') propsUi.turn(-1);
      if (e.code === 'KeyR') propsUi.step(1); // hold = keep spinning the Props wheel
      if (e.code === 'KeyF') propsUi.step(-1);
      if ((e.code === 'Delete' || e.code === 'Backspace') && propsUi.selected()) propsUi.removeSelected();
      if (e.code === 'Escape' && propsUi.selected()) propsUi.deselect();
      return;
    }
    if (state.mode === 'slap' && e.code === 'KeyQ') setRot(state.rotation - 15);
    if (state.mode === 'slap' && e.code === 'KeyE') setRot(state.rotation + 15);
    // ←/→ while the sticker wheel is lit: switch pack / wheel without leaving the view
    if (wheelIsLit() && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      e.preventDefault();
      switchWheelSide(e.code === 'ArrowRight' ? 1 : -1);
      return;
    }
    if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) { // first press lights the wheel AND steps
      wheelUp();
      nextDesign();
    }
    if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey) {
      wheelUp();
      prevDesign();
    }
  });
} else {
  // Touch (Jens, 28 Oct 2026): with a sticker in hand (sharp), ONE finger on the room AIMS it: the
  // sticker shows on the wall where the finger points (the ray from the touch point, like a stamp
  // held in front of you; the holder in the middle steps aside meanwhile) and follows the finger;
  // letting go stamps it THERE – a tap or a press of any length, with or without dragging. The room
  // does not turn while aiming. TWO fingers while a sticker is in hand (Jens, 29 Oct 2026; replaces
  // the two edge sliders): pinch = scale it (the distance ratio × the size it had), twist = rotate it
  // (the change of the fingers' angle, clockwise = clockwise), live, through setSize/setRot – the same
  // limits and state as everywhere (free 15–100 cm, full 10–150 cm, nature 10 cm – 8 m high). A second
  // finger cancels the aim (no stamp); after a pinch nothing is stamped or looked until both fingers
  // are up. Looking around: one finger (or two) when nothing is in hand (faded / not chosen yet – as
  // before). Walking: the joystick (its own element, works alongside an aiming finger).
  const touches = new Map();
  const ndcOf = (x, y) => new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  const canAim = () => !!(stackMenu && state.selected && state.mode === 'slap' && !propsMode() && !camView && !placingCam && !state.adminToken
    && !stackMenu.isOpen() && !stackMenu.bookOpen() && !sp.open && !together.busy() && stackMenu.held.canSlap(performance.now()));
  const endAim = () => { touchAim = null; document.body.classList.remove('aiming'); preview.hide(); };
  // Any touch on the screen (Jens, 29 Oct 2026) counts as working with the held sticker: while it is
  // up, its 2 s (HELD_VISIBLE_MS) start again; it only fades after 2 s untouched. (A faded one is not
  // revived by this – a tap wakes it, as before.)
  const touchAlive = (e) => { if (e.pointerType !== 'mouse') stackMenu?.held.keepAlive(performance.now()); };
  addEventListener('pointerdown', (e) => { touchAlive(e); if (e.pointerType !== 'mouse') touchesDown.add(e.pointerId); }, true);
  addEventListener('pointermove', touchAlive, true);
  for (const ev of ['pointerup', 'pointercancel']) addEventListener(ev, (e) => { touchAlive(e); touchesDown.delete(e.pointerId); }, true);
  // Safety (Jens, 29 Oct 2026: "they don't fade"): a finger whose pointerup never arrived (iOS can drop
  // it, e.g. after a system gesture) kept touchesDown non-empty and the held sticker sharp for good.
  // When the last real finger leaves the screen, nothing is down any more.
  for (const ev of ['touchend', 'touchcancel']) addEventListener(ev, (e) => { if (!e.touches || e.touches.length === 0) touchesDown.clear(); }, true);
  // ---- Pinch / twist: the fingers on the room or on the held sticker (window, capture phase) ----
  const canPinch = () => !!(stackMenu && state.selected && state.mode === 'slap' && !camView && !placingCam
    && !stackMenu.isOpen() && !stackMenu.bookOpen() && !sp.open && !together.busy() && stackMenu.held.opacity(performance.now()) > 0);
  const fingers = new Map(); // pointerId -> { x, y } of touches on the room / the held sticker
  const spent = new Set();   // fingers of a pinch: they do nothing else until they are lifted
  const pinchMetrics = () => { const [a, b] = [...fingers.values()]; return { d: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x) }; };
  let pinchAfterT = 0;
  const pinchHud = () => {
    const hud = $('pinch-hud'), r = $('held').getBoundingClientRect();
    hud.textContent = `${(Math.round(state.size * 200) / 2).toLocaleString(LOCALE)} cm · ${state.rotation}°`;
    if (r.height) hud.style.top = `${Math.max(8, r.top - 40)}px`;
  };
  const endPinch = () => {
    if (!touchPinch) return;
    touchPinch = null; document.body.classList.remove('pinching'); document.body.classList.add('pinch-after');
    clearTimeout(pinchAfterT); pinchAfterT = setTimeout(() => document.body.classList.remove('pinch-after'), 1200);
  };
  const onPinchTarget = (e) => e.pointerType !== 'mouse' && (e.target === canvas || !!e.target.closest?.('#held'));
  addEventListener('pointerdown', (e) => {
    if (!onPinchTarget(e)) return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size === 2 && !touchPinch && canPinch()) {
      if (touchAim) endAim();       // the aim is cancelled: no stamp
      stackMenu.cancelRelease();    // a finger on the held sticker does not release it either
      for (const id of fingers.keys()) spent.add(id);
      const m = pinchMetrics();
      touchPinch = { d0: Math.max(m.d, 1), a0: m.ang, size0: state.size * 100, rot0: state.rotation };
      document.body.classList.remove('pinch-after'); document.body.classList.add('pinching'); pinchHud();
      stackMenu.held.keepAlive(performance.now());
    } else if (touchPinch) spent.add(e.pointerId); // a third finger: ignored
  }, true);
  addEventListener('pointermove', (e) => {
    const f = fingers.get(e.pointerId); if (!f) return;
    f.x = e.clientX; f.y = e.clientY;
    if (!touchPinch || fingers.size < 2) return;
    const m = pinchMetrics();
    let da = (m.ang - touchPinch.a0) * 180 / Math.PI; da = ((da + 540) % 360) - 180;
    setSize(touchPinch.size0 * (m.d / touchPinch.d0));
    setRot(Math.round(touchPinch.rot0 + da));
    stackMenu.held.keepAlive(performance.now());
    pinchHud();
  }, true);
  const fingerUp = (e) => {
    if (!fingers.delete(e.pointerId)) return;
    if (touchPinch && fingers.size < 2) endPinch();
    setTimeout(() => spent.delete(e.pointerId), 0); // after the room's own pointerup has seen it
  };
  addEventListener('pointerup', fingerUp, true); addEventListener('pointercancel', fingerUp, true);
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault(); // no text selection / callout / emulated mouse from a press on the room
    canvas.setPointerCapture(e.pointerId);
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), drag: false });
    if (spent.has(e.pointerId)) return; // a pinch finger
    if (touches.size === 1 && canAim()) {
      touchAim = { id: e.pointerId, x: e.clientX, y: e.clientY };
      document.body.classList.add('aiming'); hideCredit();
    } else if (touches.size >= 2) {
      if (touchAim) endAim(); // two fingers = looking around, never a stamp
      for (const t of touches.values()) t.drag = true;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = touches.get(e.pointerId); if (!p) return;
    if (touchPinch || spent.has(e.pointerId)) { p.x = e.clientX; p.y = e.clientY; p.drag = true; return; } // pinching: no look
    if (touchAim && touchAim.id === e.pointerId) {
      touchAim.x = e.clientX; touchAim.y = e.clientY; p.x = e.clientX; p.y = e.clientY;
      stackMenu.held.keepAlive(performance.now()); // aiming = working with it: it does not fade meanwhile
      return;
    }
    if (together.busy()) { p.x = e.clientX; p.y = e.clientY; return; } // 'My avatar' open: a drag spins the avatar instead
    if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 10) p.drag = true;
    // two fingers: each finger's move counts half (= the midpoint's move)
    const k = touches.size >= 2 ? 0.006 / touches.size : 0.006;
    if (p.drag) controls.look((e.clientX - p.x) * k, (e.clientY - p.y) * k);
    p.x = e.clientX; p.y = e.clientY;
  });
  const up = (e) => {
    const p = touches.get(e.pointerId); touches.delete(e.pointerId);
    if (spent.has(e.pointerId)) return; // a pinch finger: no stamp, no tap
    if (touchAim && touchAim.id === e.pointerId) {
      endAim();
      // a short tap (no aiming) on a menu sticker opens its menu instead of slapping
      if (e.type === 'pointerup' && p && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 14 && performance.now() - p.t < 500 && menuClick(ndcOf(e.clientX, e.clientY))) return;
      if (e.type === 'pointerup' && stackMenu) heldTap(ndcOf(e.clientX, e.clientY), e.clientX, e.clientY); // stamp where the finger is
      return;
    }
    if (p && !p.drag && performance.now() - p.t < 400 && e.type === 'pointerup') {
      const ndc = ndcOf(e.clientX, e.clientY);
      if (placingCam) placeCamAt(ndc);
      else if (propsMode()) propsUi.click(ndc); // the Props wheel: tap = place / select
      else if (menuClick(ndc)) { /* a menu sticker (menustickers.js) */ }
      else if (stackMenu && !camView && !state.adminToken) heldTap(ndc, e.clientX, e.clientY);
      else if (state.mode === 'view' && !camView) {
        // Tittläge: tryck på en klibba = vem gjorde den?
        const c = creditOf(pickStampAt(ndc)?.stamp);
        if (c) { showCredit(c, { x: e.clientX, y: e.clientY }); credit.id = c.id; } else hideCredit();
      } else { hideCredit(); action(ndc); }
    }
  };
  // Touch: no Slap/Look switch – the held sticker's timer decides (shared/heldtimer.mjs).
  // Sharp = this tap slaps (and restarts the 2 s, HELD_VISIBLE_MS). Fading/faded = this tap only brings the
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
    pinching: () => !!touchPinch,
    S, locale: LOCALE, state, nextDesign, prevDesign, setSize, setRot, minSizeCm: () => minSizeCm(), maxSizeCm: () => maxSizeCm(),
    peelLast: () => peelLast(), toggleView: () => toggleView(), startDance: () => toggleDance(), snapPhoto: () => snapPhoto(), openMore: () => openMore(), closeMore: () => closeMore(),
    chatOpen: () => together.chatOpen(), longPressed: () => longPressed, renderStack: () => renderDesignHud(), wheel: activeWheelApi, wheelUp, natureOpen: () => natureOpen(),
    release: (x, y) => { if (!camView && !placingCam) heldTap(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), x, y); },
  });
}

// ---------- Rum: typ, nytt snabbrum, dela länk, till Staden ----------
const TYPE_NAMES = S.roomTypes;
// The City too gets ?room=stad: the plain address now goes to your own most recent room (landing.js).
function roomUrl(id) { return `${location.origin}/?room=${id}`; }
// Capture the live outfit before a full-page navigation so the city (and houses) keep the same clothes.
// Also used on Exit to menu and pagehide (reload), so a look picked in Min gubbe is what you wear
// when you enter the next room (Jens room-outfit, 8 Nov 2026).
function persistWornBeforeLeave() {
  try { together.persistWornLook(); } catch { /* together not ready */ }
}
function goRoom(id, extra = '') {
  persistWornBeforeLeave();
  location.href = roomUrl(id) + extra;
}
function goMenu() {
  persistWornBeforeLeave();
  location.href = `${location.origin}/?start=1`;
}
function showRoomInfo(info) {
  const type = info?.type || (IN_CITY ? 'stad' : 'quick');
  const badge = $('room-type');
  badge.textContent = TYPE_NAMES[type] || type;
  badge.className = 'badge ' + type;
  $('to-stad').hidden = ROOM === 'stad';
  $('room-note').textContent = type === 'quick'
    ? S.roomNoteQuick(info?.quickTtlHours ?? 24)
    : type === 'profile' ? S.roomNoteProfile(info.owner?.name) : '';
  $('room-hud').textContent = DEMO ? S.demoRoomHud(ROOM) : S.roomHud(type, ROOM, cityInfo?.name);
  if (DEMO) { $('room-note').textContent = S.demoNote(config.roomMinutes || 60); badge.hidden = true; }
  roomType = type;
  if (info) currentStyle = normalizeStyle(info.style);
  if (info) { presetRoom = !!(info.preset && info.preset.faces); presetLayer.set(presetRoom ? info.preset : null); syncRoomCharacter(); }
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
var roomType = IN_CITY ? 'stad' : 'quick'; // eslint-disable-line no-var
var presetRoom = false; // eslint-disable-line no-var -- a preset room: its look (the walls) is locked, only admin may change it
const canEditStyle = () => !!state.adminToken || (!DEMO && roomType !== 'stad' && !!roomKeys()[ROOM]);
// Reset (all stickers off): the creator, also in the demo (it is not "editing" the room).
const canReset = () => canEditStyle() || (DEMO && !!roomKeys()[ROOM]);
function updateStyleUi() {
  $('edit-style').hidden = !canEditStyle() || (presetRoom && !state.adminToken);
  const sv = document.getElementById('save-preset'); if (sv) sv.hidden = !state.adminToken || DEMO || IN_CITY;
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
  // City outside: peels are always on (no toggle). Room peels: creator/admin only.
  box.hidden = CITY_OUTSIDE || !canEditStyle();
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
// 🧻 Peels is always ON when the page loads (Jens, 28 Oct 2026), whatever the room was left at
// (the setting lives on the server: room.peelsOn, PUT /api/rooms/:room/peels – not in localStorage).
// Whoever may change the room (its key or admin; the box is only theirs) turns it back on at load;
// they can still switch it off for the rest of the visit. Peel mechanics unchanged.
async function peelsOnAtLoad(info) {
  // City outside: always on for everyone (server reports peels:true; no PUT needed).
  if (CITY_OUTSIDE) { peelLayer.setOn(true); updatePeelUi(); return; }
  if (info?.peels || DEMO || !canEditStyle()) return;
  try { await api.setPeels(ROOM, true, { key: roomKeys()[ROOM], admin: state.adminToken }); peelLayer.setOn(true); } catch { /* offline / no right: as it was */ }
  updatePeelUi();
}
$('peels-clear').onclick = async () => {
  try { await api.clearPeels(ROOM, { key: roomKeys()[ROOM], admin: state.adminToken }); peelLayer.clear(); toast(S.peelsCleared, 1500); } catch (err) { toast(err.message); }
};
var shownStyle = DEFAULT_STYLE; // eslint-disable-line no-var -- (the room size test re-tiles with it)
async function showStyle(s) {
  shownStyle = s;
  sound.setRoom(s); // the room's materials give a subtle, automatic acoustic (free, no UI)
  if (room.city) return null; // the City has its own look (city.js), no room style
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
  // Picking a catalogue material for a surface also takes that surface's own image away.
  const custom = (patch, kind) => {
    const st = { ...sp.style, ...patch, seed: undefined };
    if (kind && st.surfFabric?.[kind]) { st.surfFabric = { ...st.surfFabric }; delete st.surfFabric[kind]; ownUi[kind].close(); }
    sp.style = normalizeStyle(st); delete sp.style.seed; previewStyle();
  };
  const own = s.surfFabric || {};
  swatchButtons($('sw-floor'), 'floor', CATALOG.floors, own.floor ? null : s.floor, (id) => custom({ floor: id }, 'floor'));
  swatchButtons($('sw-wall'), 'wall', CATALOG.walls, own.wall ? null : s.wall, (id) => custom({ wall: id }, 'wall'), color);
  swatchButtons($('sw-color'), 'color', CATALOG.wallColors, s.wallColor, (id) => custom({ wallColor: id }));
  swatchButtons($('sw-ceiling'), 'ceiling', CATALOG.ceilings, own.ceiling ? null : s.ceiling, (id) => custom({ ceiling: id }, 'ceiling'));
  $('sp-color-row').hidden = !CATALOG.walls[s.wall].colored || !!own.wall;
  fargUi.render();
  for (const k of SURF_KINDS) { ownUi[k].render(); $('own-' + k).classList.toggle('on', !!own[k]); }
  if (document.activeElement !== $('style-seed')) $('style-seed').value = s.seed || '';
  $('style-name').textContent = styleName(s);
}
function previewStyle() { renderStylePanel(); showStyle(sp.style); }
// Färg (fargui.js): the room's own image on every surface, kept through 🎲 Random and the code.
const fargUi = initFargUI({ $, toast, getStyle: () => sp.style,
  setFabric: (f, rerender) => { const st = { ...sp.style }; if (f) st.fabric = f; else delete st.fabric; sp.style = normalizeStyle(st); if (rerender) previewStyle(); else showStyle(sp.style); } });
// Own image per surface (30 Oct 2026): floor, walls and ceiling each have their own image picker
// (the Färg picker's upload + controls). style.surfFabric[kind]; it wins over Färg on that surface.
const ownUi = Object.fromEntries(SURF_KINDS.map((k) => [k, initFabricPicker({ box: $('own-' + k), file: $(`own-${k}-file`), toast, anyId: `own-${k}-base-any`,
  cur: () => sp.style?.surfFabric?.[k] || null,
  set: (f, rerender) => {
    const st = { ...sp.style }, sf = { ...(st.surfFabric || {}) };
    if (f) sf[k] = f; else delete sf[k];
    st.surfFabric = sf; sp.style = normalizeStyle(st);
    if (rerender) previewStyle(); else showStyle(sp.style);
  },
  open: { label: S.ownOpen, get title() { return S.ownOpenTitle[k]; } },
  txt: { get hint() { return S.ownHint[k]; }, get onHint() { return S.ownOnHint[k]; }, get noneTitle() { return S.ownNoneTitle[k]; }, get uploadTitle() { return S.ownUploadTitle[k]; }, get wildTitle() { return S.ownWildTitle; } } })]));
// 🎲 Random and the code roll the catalogue materials; Färg and the surfaces' own images stay.
const withFarg = (st) => (sp.style?.fabric || sp.style?.surfFabric ? normalizeStyle({ ...st, fabric: sp.style.fabric, surfFabric: sp.style.surfFabric }) : st);
function openStylePanel(mode) {
  sp.open = true; sp.mode = mode;
  for (const k of SURF_KINDS) ownUi[k].close();
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
$('style-random').onclick = () => { sp.style = withFarg(styleFromSeed(randomSeed())); previewStyle(); };
$('style-seed').oninput = (e) => {
  const v = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  if (v !== e.target.value) e.target.value = v;
  if (v) { sp.style = withFarg(styleFromSeed(v)); previewStyle(); }
};
$('style-ok').onclick = async () => {
  const b = $('style-ok'); b.disabled = true;
  try {
    if (sp.mode === 'create') {
      const { room: r, roomKey } = await api.createRoom(sp.style);
      if (roomKey) saveRoomKey(r.id, roomKey);
      // A new quick room starts with a clean sticker wheel (Jens, 29 Oct 2026): my uploads go, except
      // the starred ones (designs.js clearMineForNewRoom). Their local image copies too (≤ 1.5 s).
      if (r.type === 'quick' || !r.type) { const c = clearMineForNewRoom(); await Promise.race([c.done, new Promise((ok) => setTimeout(ok, 1500))]); }
      goRoom(r.id);
      return;
    }
    const res = await api.setStyle(ROOM, sp.style, { key: roomKeys()[ROOM], admin: state.adminToken });
    currentStyle = normalizeStyle(res.style);
    closeStylePanel(false); showStyle(currentStyle); updateStyleUi();
    toast(S.styleSaved);
  } catch (err) { toast(err.message); } finally { b.disabled = false; }
};
$('to-stad').onclick = () => { goRoom('stad'); };
$('share-room').onclick = async () => {
  if (DEMO) return inviteFriend();
  const url = roomUrl(ROOM);
  const title = S.shareTitle(ROOM);
  if (isTouch && navigator.share) { try { await navigator.share({ title, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(url); toast(S.linkCopied(url), 3500); }
  catch { prompt(S.copyLink, url); }
};
// Säg till servern med jämna mellanrum att någon är här, så rummet inte städas bort.
setInterval(() => { if (document.visibilityState === 'visible') { api.visit(ROOM, deviceId()).catch(() => {}); noteVisit(ROOM); } }, 10 * 60_000);
api.visit(ROOM, deviceId()).catch(() => {}); // counted once in 'people visited' (the room info panel)
noteVisit(ROOM); // one of my rooms now (the City is not): the plain address brings me back here

// ---------- Ladda rummet ----------
async function loadRoom() {
  try {
    const { stamps: list, images, info, cameras, peels, props } = await api.loadRoom(ROOM);
    await propsUi.setAll(props || []).catch((e) => console.warn('[props]', e)); // before the stickers: some sit on a cuboid's face
    window.klibb.propsReady = true;
    showRoomInfo(info); roomInfoKnown();
    applyGroove(info?.groove);
    peelLayer.setOn(!!info?.peels);
    for (const p of peels || []) peelLayer.add(p, images[p.imageId]);
    await peelsOnAtLoad(info);
    cams.set(cameras || []); renderCams();
    if (!sp.open) await showStyle(currentStyle);
    pruneHistory(list.map((s) => s.id));
    // allSettled: en enda trasig stämpel ska inte hindra resten av rummet från att laddas.
    await Promise.allSettled(list.map((s) => stamps.add(s, images[s.imageId])));
    updateCount();
  } catch (err) { roomInfoKnown(); toast(S.roomLoadFailed(err.message)); }
}

// ---------- Tillsammans: andra spelare, chatt, Min gubbe (together.js) ----------
// Händelser från servern: det andra gör i rummet syns direkt, utan att ladda om.
function onRoomEvent(e) {
  if (!e || typeof e.type !== 'string') return;
  if (propsUi && propsUi.onEvent(e)) return; // prop:set / prop:remove
  if (e.type === 'stamp:add' && e.stamp && e.image) {
    // Någon annans klibba: ljudet kommer från där den hamnade (tystare ju längre bort).
    if (e.nonce && pendingSlaps.has(e.nonce)) { confirmSlap(e.nonce, e.stamp, e.image); updateCount(); if (e.peel) peelLayer.confirm('tmp-' + e.nonce, e.peel); return; } // min egen, redan synlig
    if (e.peel && !(e.nonce && myNonces.has(e.nonce))) peelLayer.add(e.peel, e.image, { animate: true, by: e.by }); // någon annans papper faller
    else if (!e.peel && !(e.nonce && myNonces.has(e.nonce)) && !stamps.meshes.has(e.stamp.id) && Array.isArray(e.stamp.position)) paperlessDuff(e.image, e.stamp.size, e.nonce || e.stamp.id, null, e.stamp.position, e.stamp.normal, e.by); // over 1 m: no paper, still the landing sound
    // A sticker array comes as one stamp:add per copy (e.batch = { g, i, n }): one gesture per row,
    // but each copy plays its own sized slap so a fan rises/falls across the row (remote hear it too).
    const quietCopy = !!(e.batch && typeof e.batch.g === 'string' && rowHeard(e.batch.g));
    if (!(e.nonce && myNonces.has(e.nonce)) && !stamps.meshes.has(e.stamp.id)) {
      const sz = e.stamp.size || 0.3;
      let area = sz * sz;
      if (e.image) { try { const [aw, ah] = stampDims(e.image, sz); area = aw * ah; } catch { /* keep square */ } }
      const vol = e.batch ? Math.max(0.2, 0.85 - 0.05 * ((e.batch.i || 1) - 1)) : 1;
      sound.play('slap', e.stamp.position, { sound: together.voiceOf(e.by), area, size: sz, volume: vol });
    }
    // Någon annans slap: deras gubbe slår handen mot väggen samtidigt som klibban dyker upp.
    // (by saknas från äldre klienter: då syns bara klibban, som förut.)
    if (!quietCopy && typeof e.by === 'string' && e.by !== together.net.id && !stamps.meshes.has(e.stamp.id)) {
      together.players.gesture(e.by, 'slap', e.stamp.position, e.stamp.normal);
      try { slapFx.burst(e.stamp.position, e.stamp.normal); } catch { /* fx */ }
    }
    stamps.add(e.stamp, e.image).then(updateCount);
  } else if (e.type === 'stamp:remove' && e.quiet) {
    // The automatic cleanup: a sticker nobody could see any more (completely covered). No sound.
    stamps.remove(e.id); updateCount();
    if (roomHistory(ROOM).some((h) => h.stampId === e.id)) { removeHistory([e.id]); scheduleHistory(); }
  } else if (e.type === 'stamp:remove') {
    const m = stamps.meshes.get(e.id);
    if (m && !myPeels.has(e.id)) sound.play('peel', m.userData.stamp.position, { sound: together.voiceOf(e.by), size: m.userData.stamp.size });
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
  else if (e.type === 'peels:expire' && Array.isArray(e.ids)) peelLayer.remove(e.ids);
  else if (e.type === 'room:groove') { /* the groove is personal now (Jens, 2 Nov 2026): a room's change is ignored */ }
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
    const { stamps: list, images, info, cameras, peels, props } = await api.loadRoom(ROOM);
    if (props) await propsUi.setAll(props).catch(() => {});
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
// The first connect waits (max 3 s) for the room info and the entitlements: in a preset room the free
// version's first hello (the join the others and the recording see) already is the room's character.
let roomInfoKnown = () => {}; const roomInfoLoaded = new Promise((r) => { roomInfoKnown = r; });
const together = initTogether({
  ready: DEMO ? null : () => Promise.race([Promise.all([roomInfoLoaded, entitlementsReady]), new Promise((r) => setTimeout(r, 3000))]),
  room: ROOM, scene, camera, controls, isTouch, toast, artist: () => state.artist,
  onEvent: onRoomEvent, onReconnect: resyncRoom,
  onWelcome: (m) => { if (groove && Number.isFinite(m.now)) groove.setServerClock(m.now); setRec(m.rec || null, { announce: m.rec && !rec ? 'joined' : null }); if (DEMO) demoWelcome(m); if (voice) voice.reset(); },
  onSound: (s) => sound.setMine(s),
  pass: () => (DEMO ? demo.passFor(ROOM) : null),
  onDenied: (m) => { if (m.code === 'house-full' && IN_CITY) { houseFullBack(); return; } if (DEMO && m.code === 'gone') demo.forgetRoom(ROOM); if (DEMO) demoClosed(demo.deniedText(m.code), m.code === 'gone' ? S.closedTitle : ' '); },
  onInvite: (m) => onInviteMsg(m),
  onPeople: (ids) => { if (voice) voice.setPeople(ids); },
  onSignal: (from, data) => { if (voice) voice.onSignal(from, data); },
  onSit: (m) => propsUi?.onSit(m),
});
// ---------- 3D props (propsmode.js, shared/props.mjs; Jens t491u/t509u) ----------
// The room's props (a table with 4 chairs by default), sitting down to draw, and – in the build phase –
// the Props wheel (V: Slap → Nature → Props) for admin / the full version where canEditProps allows.
var propsUi = initProps({ // eslint-disable-line no-var
  scene, renderer, camera, controls, room, faces: stamps.faces, roomId: ROOM, outside: CITY_OUTSIDE, isTouch, toast,
  aim: (ndc) => aimRay(ndc),
  aimOff: () => aimOff,
  canEdit: () => !DEMO && canEditProps({ buildPhase: CITY_BUILD_PHASE, admin: !!state.adminToken, full: !!entitlements.full.natureStickers, cityRoom: IN_CITY, buildCity: isBuildCity(ROOM), owner: !!roomKeys()[ROOM] }),
  headers: () => ({ ...unlockHeaders(), ...(roomKeys()[ROOM] ? { 'x-room-key': roomKeys()[ROOM] } : {}), ...(state.adminToken ? { 'x-admin-token': state.adminToken } : {}) }),
  netId: () => together.net.id, sendSit: (chair, draw) => together.net.sendSit(chair, draw), takenSeats: () => together.players.takenSeats(),
  setSelfSeat: (seat) => together.setSelfSeat(seat),
  onModeChange: () => { preview.hide(); renderStrip(); },
  onPropBuilt: (id) => stamps.propBuilt(id),
  wheelUp: () => wheelUp(),
});
together.players.seatOf = (chair) => propsUi.seatPose(chair);
// props block walking (shared/propcollide.mjs) and carry stickers (stamps.js projects them onto a prop's meshes)
controls.propCollide = (px, pz, x, z, eyeY, clamp) => propsUi.collideStep(px, pz, x, z, eyeY, clamp);
stamps.propMeshes = (id) => propsUi.meshesOf(id);
function propsMode() { return !!propsUi && propsUi.active(); } // hoisted: setMode/syncNatureMode run before propsUi exists
// Full version (entitlements.js): free = calm default UI; the deep menus appear when unlocked.
const entitlementsReady = loadEntitlements().then(() => { together.entitlementsChanged(); onEntitlements(); fullUi.ready(); });
// Point 8 (Jens, 29 Oct 2026): in a preset room the free version gives me a random character for that
// room – the same one each time (seed = room + this device), my name kept; the full version
// (entitlements.full.ownAvatar, and OPEN_ACCESS) keeps my own avatar. Not in the demo profile.
function syncRoomCharacter() {
  try { if (!together) return; } catch { return; } // (room info can come before together exists: const, TDZ)
  const on = presetRoom && !DEMO && !entitlements.full.ownAvatar;
  together.setRoomLook(on ? seededLook(AVATAR_SPEC, roomCharacterSeed(ROOM, deviceId())) : null);
}
function onEntitlements() { syncRoomCharacter(); $('sound-design-btn').hidden = !entitlements.full.soundDesign; if (isNat(state.selected) && !natureOpen()) select(stickerDesigns()[0] || null); else { renderTray(); renderDesignHud(); } applySizeLimit(); fullUi?.refreshEntry(); if (groove) updateGrooveUi(); if (autoSlap) autoSlap.render(); renderCams(); }
// Full version panel (fullversion.js): a quiet entry in ⚙ More → Help; a new key applies right away.
var fullUi = initFullVersion({ // eslint-disable-line no-var
  $, onOpen: () => { closeMore(); controls.unlock?.(); },
  onChange: () => { together.sendUnlock?.(credentials()); together.entitlementsChanged(); onEntitlements(); },
});
// ---------- Footstep groove (shared/groove.mjs) ----------
// The scale (bar length) is a PERSONAL sound setting (Jens, 2 Nov 2026: sound settings are per user,
// local, never synced, never set by the room): this visit only (sessionStorage 'klibb.grooveScale',
// reset on Exit-to-menu or a new room – soundui.js resetPersonalSound). The room no longer decides
// it – a room's old stored groove is ignored and nothing is sent. Full version (soundDesign) or admin.
// Slider in ⚙ More → Sound, keys [ and ] (Shift = a whole octave).
// var: the WebSocket welcome can arrive before these lines have run.
var groove = new GrooveSteps(sound); // eslint-disable-line no-var
const canGroove = () => !DEMO && (!!state.adminToken || !!entitlements.full.soundDesign);
let chipTimer = null;
const myGrooveScale = () => { const v = Number(personalGet('klibb.grooveScale')); return personalGet('klibb.grooveScale') != null && Number.isFinite(v) ? v : GROOVE.def; };
function updateGrooveUi({ flash = false } = {}) {
  const box = document.getElementById('groove-box'); if (!box) return;
  box.hidden = !canGroove();
  const s = groove.scale, l = grooveLabel(s);
  const slider = $('groove-scale'); if (document.activeElement !== slider) slider.value = scaleToSlider(s);
  $('groove-val').textContent = S.grooveValue(l.scale, l.bar);
  const chip = $('groove-chip'); chip.textContent = S.grooveChip(l.scale);
  chip.hidden = s === GROOVE.def && !flash; // calm: only when it isn't at the default (or just changed)
  chip.classList.toggle('flash', flash);
  clearTimeout(chipTimer); if (flash) chipTimer = setTimeout(() => { chip.classList.remove('flash'); chip.hidden = groove.scale === GROOVE.def; }, 1800);
}
// (the room's groove from the server: ignored – the scale is mine)
function applyGroove() { if (groove.scale !== myGrooveScale()) groove.setGroove(retime(groove.groove, myGrooveScale(), groove.now())); updateGrooveUi(); }
// Change the scale: only for me, kept for this visit.
function setGrooveScale(scale) {
  if (!canGroove() || scale === null || scale === undefined) return;
  if (scale === groove.scale) return;
  groove.setGroove(retime(groove.groove, scale, groove.now()));
  personalSet('klibb.grooveScale', groove.scale === GROOVE.def ? null : String(groove.scale));
  updateGrooveUi({ flash: true });
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

// ---------- Auto-slap: removed (Jens, 5 Nov 2026 – "remove the auto-drop, keep the sequencer") ----------
// The held sticker no longer slaps by itself (no H / , / . keys, no editor). Its step sequencer
// (shared/autoslap.mjs: the step schema, lengths, clock) lives on as the Sound settings' sequencer
// layers (shared/synth.mjs seq, run by the radio on the master clock). Old saved auto-slap settings
// ('klibb.autoslap') are simply ignored and dropped.
try { localStorage.removeItem('klibb.autoslap'); } catch { /* private */ }
var autoSlap = null; // eslint-disable-line no-var

// Sound settings (soundui.js): only reachable with entitlements.full.soundDesign.
// Volume (was Music vol, Jens 31 Oct 2026): how loud the room's sounds are for me. ONE control only –
// #master-vol in the Sound settings' Master block (Jens, 11 Nov 2026: the header duplicate is gone).
const MUSIC_VOL_DEFAULT = 1;
const musicVol = { def: MUSIC_VOL_DEFAULT, get: () => sound.volume, set: (v) => {
  sound.setVolume(v);
  const pct = String(Math.round(sound.volume * 100));
  const m2 = $('master-vol'); if (m2) m2.value = pct;
  const o2 = $('master-vol-val'); if (o2) o2.textContent = pct + ' %';
} };
// ---------- The radio (radio.js): my sound for this room, per player, never broadcast ----------
// Every room starts from the original sound; Save = this room's preset (on the server, under a private
// key in this browser). The radio's knob morphs original → preset → beyond (seek; not a volume); tempo, bird, wind, four voices.
const RADIO_KEY = `klibb.radio@${ROOM}`;
let presetTimer = null;
function saveRoomPreset() {
  personalSet(RADIO_KEY, JSON.stringify(radio.state));
  if (DEMO) return;
  clearTimeout(presetTimer);
  presetTimer = setTimeout(() => { const cur = loadSoundLook(); putRoomPreset(ROOM, { patches: cur.patches, fx: cur.fx, radio: radio.state }); }, 500);
}
const radio = new Radio({ sound, room: ROOM, clock: () => (groove ? groove.now() : Date.now()), onChange: () => { filmLog?.add('radio', { what: 'dial' }); saveRoomPreset(); } });
radio.setWalkBpm(loadRunMode().walkBpm); // MY walk tempo (per player, run mode; not the room preset)
// The city's place effect (Jens, 5 Nov 2026; shared/cityfx.mjs): the master bus follows where I
// stand – only outside in the city, and only for me (per listener). Houses / other rooms: neutral
// (their own room reverb stays). Every PLACE_EVERY_MS, plain params, slewed (PLACE_SLEW).
let placeCfg = CITY_FX, placeAt = 0, placeNow = null;
// The delay room (plot 5, Jens's sketch t790u; shared/delayroom.mjs): its three delay times are held here –
// set from where I stand when I walk in (every entry) and when I slap in the room, kept while I walk.
const delayRoom = delayRoomTimes();
// The reverb room (plot 4, shared/reverbroom.mjs): nothing is held. Its three sines' volume-LFO frequencies are my
// distance to each point (cityFxAt, live); here only the look is added: pitch from where I look (reverbPitchesAt,
// live even standing still) and the look-out fade (reverbGazeYaw – walk out or look out shuts the tones).
// meWalking (e2e hook only, Jens t814u): really moving = groove track 'me'.moveUntil. Dancing counts as walking
// for the steps and the walk sequencers (walkUntil) but not as moving. Nothing in the reverb room reads it.
const meWalking = () => { const me = groove?.track?.get('me'); return !!(me && !camView && (me.moveUntil || 0) > groove.now()); };
function placeTick() {
  const eng = sound.engine; if (!eng) return;
  const now = performance.now(); if (now - placeAt < PLACE_EVERY_MS) return; placeAt = now;
  const v = CITY_OUTSIDE ? cityFxAt(camera.position.x, camera.position.z, placeCfg) : IN_HOUSE ? placeHouse() : placeNeutral();
  if (CITY_OUTSIDE) { const t = delayRoom.update(camera.position.x, camera.position.z); v.roomTime1 = t[0]; v.roomTime2 = t[1]; v.roomTime3 = t[2]; v.rvGaze = reverbGazeYaw(camera.position.x, camera.position.z, controls.yaw); v.rvTone = (v.rvTone || 0) * v.rvGaze;
    const hz = reverbPitchesAt(camera.position.x, camera.position.z, controls.yaw, controls.pitch || 0, camera.position.y); v.rvHz1 = hz[0]; v.rvHz2 = hz[1]; v.rvHz3 = hz[2]; }
  // City sound dry/wet only outside; in a room keep dry=1 so the slider does not mute the room.
  const city = CITY_OUTSIDE ? (radio.state?.city ?? 0) : 0;
  if (eng.setPlace(v, { slew: PLACE_SLEW, neutral: !CITY_OUTSIDE, city })) placeNow = v;
  radio.amb?.setPlaceMix?.(v.bird, v.wind, PLACE_SLEW);
  if (CITY_OUTSIDE) placeChip(v);
}
// A big, plain label of where I am (sound-wise): the strongest zone, else "Street".
let placeEl = null;
function placeChip(v) {
  if (!placeEl) { placeEl = document.createElement('div'); placeEl.id = 'place-chip'; placeEl.setAttribute('aria-live', 'polite'); document.body.appendChild(placeEl); }
  let best = null, w = 0.5; for (const zn of placeCfg.zones || []) { const x = v.zones?.[zn.id] || 0; if (x >= w) { w = x; best = zn; } }
  const text = `🎛 ${best ? best.name || best.id : 'Street'}`; if (placeEl.textContent !== text) placeEl.textContent = text;
}
try { const r = JSON.parse(personalGet(RADIO_KEY) || 'null'); if (r) radio.set(r, { save: false }); } catch { /* none */ }
const radioReady = DEMO ? Promise.resolve() : fetchRoomPreset(ROOM).then((p) => {
  if (!p) return; // (undefined: offline – keep this visit's copy; null: nothing saved yet – the original)
  // Personal sound follows room→city; a new room resets first (prepareSoundForPlace). A room
  // preset only seeds when personal sound is empty (so city keeps Voice FX / patches / Music vol,
  // and a brand-new room starts from this room's own saved preset or the defaults).
  if ((p.patches || p.fx) && !personalGet(soundKey())) personalSet(soundKey(), JSON.stringify({ patches: p.patches, fx: p.fx }));
  radio.set(p.radio || {}, { save: false }); personalSet(RADIO_KEY, JSON.stringify(radio.state));
  together.soundChanged();
});
const radioImg = () => (state.library || []).find((d) => d.id === '14ea2304625a5827')?.url || '';
const elx = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const soundUi = initSoundUI({ $, sound, toast, musicVol, radio,
  onSave: () => { together.soundChanged(); radio.set({ on: true, knob: 0.5 }, { save: false }); saveRoomPreset(); }, // hear what I saved: knob on 'Mine'
  radioBlock: () => radioBlock({ radio, imgUrl: radioImg(), el: elx, musicVol }),
  onOpenChange: (o) => { if (o) controls.unlock?.(); } });
$('sound-design-btn').onclick = () => { if (entitlements.full.soundDesign) { closeMore(); soundUi.open(); } };

// ---------- Esc menu actions (was menu stickers; Jens, Nov 2026) ----------
// The big Esc buttons call the same actions. openChoice is still used for exit / city / door flows.
function openChoice(what, items) {
  const box = $('menu-choice'), list = $('menu-choice-list');
  controls.unlock?.(); box.dataset.what = what; list.textContent = '';
  for (const it of items) {
    if (it.info) { const p = document.createElement('p'); p.className = 'choice-info'; p.textContent = it.text; p.dataset.id = it.id; list.appendChild(p); continue; } // a line to read, not a button
    const b = document.createElement('button'); b.type = 'button'; b.className = 'choice-btn'; b.textContent = it.text; b.dataset.id = it.id;
    if (it.note) { const n = document.createElement('small'); n.className = 'choice-note'; n.textContent = it.note; b.appendChild(n); }
    b.onclick = () => { closeChoice(); it.go?.(); }; list.appendChild(b);
  }
  box.hidden = false;
}
function closeChoice() { $('menu-choice').hidden = true; delete $('menu-choice').dataset.what; }
$('menu-choice').addEventListener('click', (e) => { if (e.target === $('menu-choice')) closeChoice(); });
// ---------- The city: doors, houses, the Town Hall, my pack (t476u, t479u) ----------
// The city's state from the server (server/cities.js): its name, which houses are started, who is where.
var cityInfo = null; // eslint-disable-line no-var
async function refreshCity() {
  if (!IN_CITY) return null;
  try { cityInfo = (await cityApi.info(THIS_CITY)).city; }
  catch (e) { if (e.status === 404) cityGone(); return null; }
  if (room.doors) markDoors(room.doors, { started: cityInfo.houses, next: cityInfo.next });
  $('room-hud').textContent = S.cityHud(cityInfo.name, houseNumber(ROOM)); $('room-name').textContent = S.cityHud(cityInfo.name, houseNumber(ROOM));
  return cityInfo;
}
// The city closed (everybody left – server/emptyrooms.js) while this page was away: only Exit to menu.
let goneShown = false;
function cityGone() {
  if (goneShown) return; goneShown = true;
  toast(S.cityGone, 6000);
  openChoice('city-gone', [{ id: 'exit-menu', text: S.exitToMenu, go: () => { goMenu(); } }]);
}
if (IN_CITY) { refreshCity(); setInterval(() => { if (!document.hidden) refreshCity(); }, CITY_OUTSIDE ? 8000 : 30000); }
// A door in reach (≤ 14 m) under the aim: its plot ({ n | hall }).
function doorHit(ndc) {
  const rc = aimRay(ndc), hit = rc.intersectObjects([...room.doors, ...room.surfaces], false)[0];
  if (!hit || !hit.object.userData.door || hit.distance > 14) return null;
  return plotOfDoor(hit.object.userData.door);
}
const plotOfDoor = (d) => (d === 'hall' ? { n: 0, hall: true } : d === 'subway' ? { n: 2, subway: true } : { ...plotOfHouse(Number(d)) });
const goHouse = (n) => { goRoom(houseId(THIS_CITY, n)); };
// The rebuild (Jens, 10 Nov 2026, pt781u): the subway's black door → the living cities with room; a kept
// house's black door (1, 3, 6, 8) → go in (started on the way in if nobody has yet), at most HOUSE_MAX
// people – number five is turned away and offered the other houses that have room.
const houseMax = (i) => Math.min(HOUSE_MAX, i?.max || HOUSE_MAX);
function otherHouses(i, n) {
  return KEPT_HOUSES.filter((k) => k !== n && (i.inHouses?.[k] || 0) < houseMax(i))
    .map((k) => ({ id: `try-${k}`, text: S.cityTryHouse(k, i.inHouses?.[k] || 0, houseMax(i)), go: () => walkToDoor(k) }));
}
function houseFullChoice(i, n) {
  const others = otherHouses(i, n);
  openChoice('city-door', [{ id: 'house-full', info: true, text: S.cityHouseFull(n, houseMax(i)) }, ...others,
    ...(others.length ? [] : [{ id: 'none-free', info: true, text: S.cityNoHouseFree }]), { id: 'back', text: S.cityStay }]);
}
async function enterHouse(n) {
  const i = cityInfo || await refreshCity();
  if (i && !i.houses.includes(n)) {
    toast(S.cityStarting, 4000);
    try { await cityApi.startHouse(THIS_CITY, state.artist || '', n); } catch (e) { toast(e.message, 3000); refreshCity(); return; }
  }
  goHouse(n);
}
function openSubway() {
  controls.unlock?.(); closeChoice();
  openCityPick({ toast, subway: true, here: THIS_CITY, go: (id) => { goRoom(id, '&at=subway'); } });
}
async function openCityDoor(p) {
  if (p.hall) { openHall(); return; }
  if (p.subway) { openSubway(); return; }
  const n = p.n, i = await refreshCity() || cityInfo; // fresh head counts: the door decides on them
  if (!i || !isKeptHouse(n)) return;
  const here = i.inHouses?.[n] || 0;
  if (here >= houseMax(i)) { houseFullChoice(i, n); return; }
  openChoice('city-door', [{ id: 'enter-house', text: S.cityEnterHouse(n), note: S.cityHouseQuiet(n, here, houseMax(i)), go: () => enterHouse(n) }, { id: 'back', text: S.cityStay }]);
}
// Turned away by the server (the house filled up on the way in): back out in front of its door, with the choice.
function houseFullBack() { goRoom(THIS_CITY, `&at=${ROOM}&full=${houseNumber(ROOM)}`); }
if (CITY_OUTSIDE && isKeptHouse(Number(params.get('full')))) {
  const n = Number(params.get('full'));
  toast(S.cityHouseFullToast(n, HOUSE_MAX), 4000);
  refreshCity().then((i) => { if (i) houseFullChoice(i, n); });
}
function openHall() {
  controls.unlock?.(); closeChoice();
  openTownHall({ toast, onChange: cityWheelChanged, makePack: () => openDoorPick(doorOpts()), deck: () => deckDesigns(), onDeck: () => { wheelKey = ''; } });
  syncPaid();
}
// City-bus TEST bots when ?testbus=1. Lazy server seed (no CITYBUS_TEST env needed on Render).
// Keep a session alive with /ping so the bot loop stops when Jens leaves (Render memory).
if (TESTBUS && CITY_OUTSIDE && isTestBusCity(ROOM)) {
  carryReady.then(() => { cityBusBots = startCityBots(together.players, { cityId: ROOM, room, toast }); });
  const busHeaders = { 'Content-Type': 'application/json' };
  const seedBody = () => JSON.stringify(cityBusSession ? { session: cityBusSession } : {});
  fetch('/api/citybus/seed', { method: 'POST', headers: busHeaders, body: seedBody() })
    .then((r) => r.json().catch(() => ({})))
    .then((d) => { if (d && d.session) cityBusSession = d.session; })
    .catch(() => {});
  const ping = () => {
    if (!cityBusSession) return;
    fetch('/api/citybus/ping', { method: 'POST', headers: busHeaders, body: JSON.stringify({ session: cityBusSession }) }).catch(() => {});
  };
  const pingTimer = setInterval(ping, 45_000);
  const leaveBus = () => {
    clearInterval(pingTimer);
    if (!cityBusSession) return;
    const body = JSON.stringify({ session: cityBusSession });
    try {
      if (navigator.sendBeacon) navigator.sendBeacon('/api/citybus/leave', new Blob([body], { type: 'application/json' }));
      else fetch('/api/citybus/leave', { method: 'POST', headers: busHeaders, body, keepalive: true }).catch(() => {});
    } catch { /* fine */ }
  };
  window.addEventListener('pagehide', leaveBus);
  window.addEventListener('beforeunload', leaveBus);
}
// what the Town Hall says about me: a paying player carries more (their wheel is not cut at 9)
function syncPaid() { const t = setInterval(() => { const h = townHallState(); if (h.maxPacks != null) { clearInterval(t); if (cityPaid !== !!h.paid) { cityPaid = !!h.paid; cityWheelChanged(); } } }, 300); setTimeout(() => clearInterval(t), 15000); }
// My pack on the city wheel: no pack yet → make one (the door's "choose 3"); else the Town Hall.
function cityPackAction() {
  if (!localStorage.getItem('klibb.pac')) { openDoorPick(doorOpts()); return; }
  // Pac makeover: the pack bag (when present) opens the Town Hall pack shop.
  if (CITY_OUTSIDE) { walkToHall(); return; }
  openChoice('city-pack', [{ id: 'to-city', text: S.cityBackToCity, go: () => { goRoom(THIS_CITY, '&at=' + ROOM); } }, { id: 'back', text: S.choiceBack }]);
}
// (from the pack button: straight in front of the Town Hall's door, then in)
function walkToHall() { camera.position.set(0, 1.6 + (room.groundAt?.(0, 9.6) || 0), 9.6); controls.yaw = 0; controls.apply?.(); openHall(); }
function walkToDoor(n) { const s = spawnOutside(houseId(THIS_CITY, n)); camera.position.set(s.x, 1.6 + (room.groundAt?.(s.x, s.z) || 0), s.z + 1); controls.yaw = 0; controls.apply?.(); atDoor = null; }
// The door's pick: "to city →" = the city picker (start a city and name it, or go into one that is
// alive); in a city already, the new pack is simply what I carry now. Leaving my room for a city is
// one way (Jens, t479u: it may have filled up with people) – no "back to my room".
const doorOpts = () => ({
  S, toast, inCity: IN_CITY,
  skipNewCity: true, // Jens: no mid-flow new-city; city via final button / CITY menu
  onPacksChange: () => { renderStrip(); },
  choices: () => (IN_CITY ? state.library.filter((d) => !isNat(d) && !WHEEL_EXCLUDE.includes(d.id)) : stickerDesigns()),
  needsNewCity: async () => false,
  backToRoom: () => { /* pac saved; stay in the room */ },
  toCity: (cityName) => {
    if (IN_CITY) { cityWheelChanged(); return; }
    if (cityName) {
      const goNamed = async () => {
        try {
          const r = await fetch('/api/cities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: cityName, by: state.artist || '' }) });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || S.cpFailed);
          goRoom(d.city.id);
        } catch (e) { toast(e.message || S.cpFailed, 3000); openCityPick({ toast, go: (id) => { goRoom(id); } }); }
      };
      if (!FILMS_ENABLED) { goNamed(); return; }
      // Films on: still run the reel, then create the named city.
      filmThenCityNamed(goNamed);
      return;
    }
    filmThenCity();
  },
});
function filmThenCityNamed(goNamed) {
  if (!FILMS_ENABLED) { goNamed(); return; }
  const afterReel = () => {
    highlightLog.clear();
    if (!filmLog || window.klibb?.noFilm) { goNamed(); return; }
    let pac = {}; try { pac = JSON.parse(localStorage.getItem('klibb.pac') || '{}') || {}; } catch { /* none */ }
    filmLog.list = filmLog.list.filter((e) => e.e !== 'pack');
    filmLog.add('pack', { name: pac.name || '', bag: pac.bag || 1 });
    filmOpts().then((o) => runFilm({ ...o, onDone: goNamed, onDiscard: () => filmLog.clear() })).catch((err) => { console.warn('film', err); goNamed(); });
  };
  if (window.klibb?.noHighlight) { afterReel(); return; }
  offerHighlightReel({
    events: highlightLog.events(), roomId: ROOM, style: state.style, city: false, place: 'room',
    stickers: stickersForReel(), store: highlightStore, sound, myId: together.net.id || 'me',
    onDone: afterReel,
  }).catch((err) => { console.warn('highlight', err); afterReel(); });
}
// The session film (Jens, 5 Nov 2026, pt536u): leaving the room for the City ends my film – the pack I
// just made is its last scene – then Watch / Download / Discard, then the City picker as before. The
// film is only made here (an offscreen render while the bar runs); any failure or Skip → the City.
function filmThenCity() {
  const toCity = () => openCityPick({ toast, go: (id) => { goRoom(id); } });
  // Closed room (FILMS_ENABLED=false): straight to the city picker – no reel, no session film.
  if (!FILMS_ENABLED) { toCity(); return; }
  const afterReel = () => {
    highlightLog.clear();
    if (!filmLog || window.klibb?.noFilm) { toCity(); return; }
    let pac = {}; try { pac = JSON.parse(localStorage.getItem('klibb.pac') || '{}') || {}; } catch { /* none */ }
    filmLog.list = filmLog.list.filter((e) => e.e !== 'pack'); // made again: this pack
    filmLog.add('pack', { name: pac.name || '', bag: pac.bag || 1 });
    filmOpts().then((o) => runFilm({ ...o, onDone: toCity, onDiscard: () => filmLog.clear() })).catch((err) => { console.warn('film', err); toCity(); });
  };
  if (window.klibb?.noHighlight) { afterReel(); return; }
  offerHighlightReel({
    events: highlightLog.events(), roomId: ROOM, style: state.style, city: false, place: 'room',
    stickers: stickersForReel(), store: highlightStore, sound, myId: together.net.id || 'me',
    onDone: afterReel,
  }).catch((err) => { console.warn('highlight', err); afterReel(); });
}
function stickersForReel() {
  const out = [];
  for (const [id, m] of stamps.meshes) {
    const st = m.userData.stamp, img = m.userData.image;
    if (st && img) out.push({ stamp: st, image: img });
  }
  return out;
}
function leaveWithHighlight(go) {
  // Closed room (FILMS_ENABLED=false): leave straight away – no highlight reel after the city / exit.
  if (!FILMS_ENABLED || window.klibb?.noHighlight) { highlightLog?.clear(); go(); return; }
  offerHighlightReel({
    events: highlightLog.events(), roomId: ROOM, style: state.style, city: !!CITY_OUTSIDE || !!IN_CITY,
    place: IN_CITY ? 'city' : 'room',
    stickers: stickersForReel(), store: highlightStore, sound, myId: together.net.id || 'me',
    onDone: () => { highlightLog.clear(); go(); },
  }).catch((err) => { console.warn('highlight', err); highlightLog.clear(); go(); });
}
async function filmOpts() {
  let pac = {}; try { pac = JSON.parse(localStorage.getItem('klibb.pac') || '{}') || {}; } catch { /* none */ }
  const me = together.me() || {}, wallM = room.surfaces.find((m) => /^vägg/.test(m.name))?.material, floorM = room.surfaces.find((m) => m.name === 'golv')?.material;
  const model = await import('./avatars.js').then((m) => m.loadAvatarModel());
  return { events: filmLog.events(), room: ROOM, name: me.shownAs || me.name || '', model, look: me.look || {}, wallMat: wallM, floorMat: floorM, radioUrl: radioImg(), pacUrl: pac.img || (pac.urls || [])[0] || '' };
}
// Walking into a door's zone (in front of it) opens it once; walk away and back to open it again.
let atDoor = null;
function tickCityDoors() {
  if (!CITY_OUTSIDE) return;
  const p = room.doorAt(camera.position.x, camera.position.z), id = p ? (p.hall ? 'hall' : p.n) : null;
  if (id && id !== atDoor && $('menu-choice').hidden && !townHallOpen() && !doorOpen() && !nameTagOpen() && !cityPickOpen()) openCityDoor(p.hall ? { hall: true } : p);
  atDoor = id;
}
// In a city with no pack: remind them — CREATE / STICKER PACK is available in the city again.
if (IN_CITY) carryReady.then(() => setTimeout(() => { if (!localStorage.getItem('klibb.pac') && !doorOpen()) toast(S.cityNoPack, 3500); }, 1200));
function exitChoices() {
  const out = [];
  if (IN_CITY && !CITY_OUTSIDE) out.push({ id: 'to-city', text: S.cityBackToCity, go: () => { goRoom(THIS_CITY, '&at=' + ROOM); } });
  // Leaving the city (or exiting to menu from a room): highlight reel when FILMS_ENABLED, else straight out.
  out.push({ id: 'exit-menu', text: S.exitToMenu, go: () => leaveWithHighlight(() => { goMenu(); }) }, { id: 'back', text: S.choiceBack });
  return out;
}
const menuActions = {
  character: () => { closeMore(); closeRoomMenu(); together.openAvatarPanel(); },
  radio: () => { closeMore(); filmLog?.add('radio', { what: 'open' }); if (entitlements.full.soundDesign) soundUi.open(); else { fullUi?.open(); toast(S.soundLocked, 2600); } },
  room: () => openRoomPanel(),
  exit: () => openChoice('exit', exitChoices()),
  // Former Esc NAME button → still reachable as CREATE → STICKERS (and menuAction('nametag')).
  nametag: () => openNameTag(),
  // STICKER PACK hook: pac makeover flow (door.js). Available in the city again.
  stickerPack: () => openDoorPick(doorOpts()),
  door: () => openChoice('door', [{ id: 'enter-city', text: S.doorEnterCity, go: () => openDoorPick(doorOpts()) }, { id: 'back', text: S.doorBackToRoom }]),
};
// Esc / touch big-button menu (replaces menu stickers).
escMenu = initEscMenu({
  isTouch,
  // CREATE / STICKERS / STICKER PACK available in the city again (same as the room).
  onSound: () => menuActions.radio(),
  onAvatar: () => menuActions.character(),
  onRoom: () => menuActions.room(),
  // CITY opens Create new city / Join existing submenu (handled inside escmenu.js).
  onCity: () => {},
  onExit: () => menuActions.exit(),
  // CREATE opens the STICKERS / STICKER PACK submenu (handled inside escmenu.js).
  onCreate: () => {},
  onStickers: () => menuActions.nametag(),
  onStickerPack: () => menuActions.stickerPack(),
  // Create new city: reuse city-picker naming flow (POST /api/cities).
  onCreateCity: () => openCityPick({ toast, start: 'name', go: (id) => { goRoom(id); } }),
  // Join existing: picking a row goes straight into that city.
  onPickCity: (c) => { if (c?.id) goRoom(c.id); },
  formatCity: (c) => {
    const age = (typeof cityAgeText === 'function' ? cityAgeText : (S.escCityAge || (() => '–')))(c.createdAt);
    return { ...c, ageText: age, facts: S.escCityFacts(c.stickers || 0, c.visitors || 0, age) };
  },
  onClose: () => resumeGame(),
  // Touch Menu / open(): close the top panel first; only show buttons when nothing is open.
  closeTop: () => { const c = escTopPanel(); if (c) { c(); return true; } return false; },
});
escMenu.setJoinLabels({ loading: S.escCityLoading, none: S.escCityNone, failed: S.escCityFailed });


// The name-tag roll (knappar/editor.png): the "my name is" drawing tool (nametag.js). The finished tag
// is uploaded as my sticker and takes the place of the wheel sticker I chose (klibb.swaps, applySwaps).
const SWAP_KEY = 'klibb.swaps';
function readSwaps() { try { const o = JSON.parse(localStorage.getItem(SWAP_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } }
function openNameTag() {
  closeMore(); closeRoomMenu(); controls.unlock?.();
  // a free chair close by (3D props): I sit down at the table and draw – the others see it
  propsUi.sitToDraw();
  highlightLog?.add('draw', { playerId: together.net.id || 'me', p: [camera.position.x, camera.position.y, camera.position.z] });
  openNameTagTool({
    S, toast,
    onClose: () => propsUi.standUp(),
    choices: () => stickerDesigns(),
    onSave: async (blob, replaceId) => {
      toast(S.uploading, 10000);
      const img = await api.uploadSticker(blob, state.artist, { name: 'name-tag.png' });
      try { await saveBlob(img.id, blob); } catch { /* nice-to-have */ }
      const wasMine = state.mine.some((m) => m.id === replaceId);
      state.mine = addMine(img, wasMine ? replaceId : null);
      const swaps = readSwaps();
      for (const [k, v] of Object.entries(swaps)) if (v === replaceId) swaps[k] = img.id; // replacing an earlier tag: the same slot
      if (!wasMine && !Object.values(swaps).includes(img.id)) swaps[replaceId] = img.id;
      localStorage.setItem(SWAP_KEY, JSON.stringify(swaps));
      const replaced = uploadsToReplace(state.mine, img.id, !!entitlements.full.uploads);
      if (replaced.length) dropDesigns(replaced);
      await select(img);
      toast(S.ntSaved, 2600);
    },
  });
}
// ndc: where (the dot when locked, else the finger/cursor). true = a menu opened (the click is used up).
function menuClick(_ndc) {
  // Menu stickers are gone (Esc menu replaces them). Kept as a no-op so older tests/hooks don't throw.
  return false;
}

// ---------- The room info panel (the 'room' menu sticker) ----------
const rp = { info: null, timer: 0 };
function renderRoomPanel() {
  const i = rp.info || {};
  $('rpi-name').textContent = IN_CITY ? S.cityHud(cityInfo?.name || i.name || S.cityName, houseNumber(ROOM)) : i.name || ROOM;
  const born = Date.parse(i.createdAt || '');
  $('rpi-life').textContent = Number.isFinite(born) ? S.roomAge(Date.now() - born) : '–';
  $('rpi-visitors').textContent = String(i.visitors ?? '–');
  const here = 1 + together.players.map.size;
  $('rpi-here').textContent = i.maxPlayers ? S.roomHereNow(here, i.maxPlayers) : String(here);
  $('rpi-stickers').textContent = String(stamps.count);
}
async function openRoomPanel() {
  closeMore(); closeRoomMenu(); controls.unlock?.();
  $('rpi-confirm').hidden = true; $('rpi-clear').hidden = false;
  $('room-panel').hidden = false; renderRoomPanel();
  clearInterval(rp.timer); rp.timer = setInterval(renderRoomPanel, 5000);
  try { const r = await api.roomInfo(ROOM); rp.info = r.room; } catch { /* the facts we have */ }
  if (!$('room-panel').hidden) renderRoomPanel();
}
function closeRoomPanel() { $('room-panel').hidden = true; clearInterval(rp.timer); }
// Room size test: three big sliders with the value as a number (metres), and reset to the normal size.
{
  const KS = ['height', 'width', 'depth'];
  const fmt = (x) => `${Number(x).toFixed(2).replace(/\.?0+$/, '')} m`;
  const show = () => {
    const d = roomSizer.get();
    for (const k of KS) { $(`rs-${k}`).value = String(d[k]); $(`rs-${k}-val`).textContent = fmt(d[k]); }
    $('rs-sum').textContent = S.roomSizeSum(fmt(d.width), fmt(d.depth), fmt(d.height));
    $('rs-note').textContent = roomSizer.isDefault() ? S.roomSizeNormal : S.roomSizeTest;
    $('room-size').classList.toggle('rs-test', !roomSizer.isDefault());
  };
  for (const k of KS) {
    const inp = $(`rs-${k}`), r = roomSizer.RANGE[k];
    inp.min = String(r.min); inp.max = String(r.max); inp.step = String(r.step);
    $(`rs-${k}-range`).textContent = `${fmt(r.min)} – ${fmt(r.max)}`;
    inp.addEventListener('input', () => { roomSizer.set({ [k]: Number(inp.value) }); show(); });
  }
  $('rs-reset').onclick = () => { roomSizer.reset(); show(); };
  show();
}
$('rp-close').onclick = closeRoomPanel;
$('rpi-clear').onclick = () => { $('rpi-confirm-text').textContent = S.roomPanelClearAsk(null); $('rpi-confirm').hidden = false; $('rpi-clear').hidden = true; };
$('rpi-clear-no').onclick = () => { $('rpi-confirm').hidden = true; $('rpi-clear').hidden = false; };
$('rpi-clear-yes').onclick = async () => {
  const b = $('rpi-clear-yes'); b.disabled = true;
  try {
    const r = await api.clearMine(ROOM, deviceId(), together.net.id || null);
    for (const id of r.ids || []) stamps.remove(id);
    if ((r.ids || []).length) removeHistory(r.ids);
    updateCount();
    toast(r.removed ? S.roomPanelCleared(r.removed) : S.roomPanelNoneMine, 2600);
  } catch (err) { toast(err.message, 3000); } finally { b.disabled = false; $('rpi-confirm').hidden = true; $('rpi-clear').hidden = false; renderRoomPanel(); }
};
// Ask for visitors = share the room's link (the phone's share sheet; else copy it).
async function askForVisitors() {
  const url = roomUrl(ROOM), title = S.shareTitle(ROOM);
  if (isTouch && navigator.share) { try { await navigator.share({ title, url }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'cancelled'; } }
  try { await navigator.clipboard.writeText(url); toast(S.roomPanelInvite, 3000); return 'copied'; }
  catch { prompt(S.copyLink, url); return 'prompt'; }
}
$('rpi-ask').onclick = () => askForVisitors();

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
      const j = await photo.upload(shot.blob, { room: ROOM, source: 'live', view: cv ? (cv.auto ? `autocam:${cv.id}` : `cam:${cv.id}`) : third() ? view : 'eyes' }); // 'front' = a selfie
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
// Three views (Jens, 29 Oct 2026): 1st person, 3rd person (behind) and 3rd person from the FRONT
// (the camera in front of me looking back – look into it; 📷 then takes a selfie). C / 👤 cycle them.
function setView(v, { quiet = false } = {}) {
  view = saveView(v);
  const t = view !== 'first', front = view === 'front';
  document.body.classList.toggle('third-person', t);
  document.body.classList.toggle('front-view', front);
  chase.eye = null; chase.dist = null; // börja om utan glidning
  together.showSelf(t); selfShown = t;
  $('view-first').setAttribute('aria-pressed', String(view === 'first')); $('view-third').setAttribute('aria-pressed', String(view === 'third'));
  $('view-front').setAttribute('aria-pressed', String(front));
  const nx = nextView(view);
  $('view-btn').setAttribute('aria-pressed', String(t));
  $('view-btn').title = nx === 'first' ? S.viewBtnToFirst : nx === 'front' ? S.viewBtnToFront : S.viewBtnToThird;
  $('sm-view').setAttribute('aria-pressed', String(t)); $('sm-view').querySelector('.sm-lab').textContent = nx === 'first' ? S.smViewFirst : nx === 'front' ? S.smViewFront : S.smView;
  if (!quiet) toast(front ? S.viewToastFront(isTouch) : t ? S.viewToastThird(isTouch) : S.viewToastFirst(isTouch), 1800);
  return view;
}
const toggleView = () => setView(nextView(view));

// Runway dance (Jens t540u): X on desktop, 💃 in the phone menu. Switches to 3rd person so you
// can see your own character, plays the keyframe routine, restores the previous view when done.
// Loop (Jens t814u, 11 Nov 2026): X starts it and it LOOPS (4 bars at a time, on the clock) until
// X again – or W/A/S/D / the joystick (cancelDance). While it is on it counts as walking for my
// footsteps and the walk sound's sequencers (walkSounds below).
let dancePrevView = null, danceWatch = 0, danceStarting = false;
function toggleDance() {
  if (together.dancing()) return cancelDance();
  if (danceStarting) return false; // (a second press while my avatar is still being built)
  danceStarting = true;
  return startDance().finally(() => { danceStarting = false; });
}
async function startDance() {
  if (together.dancing()) return false;
  if (together.selfSeat() || propsUi?.seated()) { // stand up first (the dance needs the floor)
    propsUi?.standUp?.();
    together.setSelfSeat(null);
    together.net.sendSit(null);
  }
  if (view === 'first') { dancePrevView = 'first'; setView('third', { quiet: true }); }
  else dancePrevView = null;
  const ok = await together.startDance();
  if (!ok) { if (dancePrevView) setView(dancePrevView, { quiet: true }); dancePrevView = null; toast('Could not start the dance just now.', 1800); return false; }
  toast(isTouch ? '💃 Dance! (tap Dance again to stop)' : '💃 Dance! (X again to stop)', 1600);
  controls.keys.clear(); controls.joy.set(0, 0); // a key/stick already held when it started doesn't cancel it
  clearInterval(danceWatch);
  danceWatch = setInterval(() => {
    if (together.dancing()) return;
    clearInterval(danceWatch); danceWatch = 0;
    if (dancePrevView) { setView(dancePrevView, { quiet: true }); dancePrevView = null; }
  }, 200);
  return true;
}
// Cancel the dance (Jens t544u): W/A/S/D (and the arrows), the phone joystick or X again (t814u) stop it at once;
// the view goes back like when it ends by itself, and the room is told (dance { stop }).
function cancelDance() {
  if (!together.dancing()) return false;
  together.stopDance();
  clearInterval(danceWatch); danceWatch = 0;
  if (dancePrevView) { setView(dancePrevView, { quiet: true }); dancePrevView = null; }
  return true;
}
const DANCE_CANCEL_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
addEventListener('keydown', (e) => { if (!e.repeat && DANCE_CANCEL_KEYS.has(e.code) && !isTyping(e) && together.dancing()) cancelDance(); });
// The dance's beat locks to MY master clock in this room (radio.tempo(): 90 BPM + the room's nudge),
// on the server-corrected wall clock. 4 bars, starting on the next beat (dance.mjs danceGrid); the start
// message carries when + that clock, so everyone sees the same beats at the same moment.
setDanceClock(() => ({ nowMs: groove.now(), tempo: radio.tempo() }));

$('view-first').onclick = () => { if (view !== 'first') setView('first'); };
$('view-third').onclick = () => { if (view !== 'third') setView('third'); };
$('view-front').onclick = () => { if (view !== 'front') setView('front'); };
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

// The camera in front of me, looking back at me (view 'front'): follows as softly as the chase camera.
function updateFront(dt) {
  const eye = camera.position;
  if (!chase.eye) chase.eye = eye.clone(); else chase.eye.lerp(eye, 1 - Math.exp(-dt * 16));
  const pose = frontPose(chase.eye, controls.yaw, controls.pitch, chaseCast);
  chase.dist = smoothDist(chase.dist, pose.dist, dt);
  const dir = pose.position.clone().sub(chase.eye); if (dir.lengthSq() > 1e-9) dir.normalize();
  tpCam.position.copy(chase.eye).addScaledVector(dir, chase.dist);
  tpCam.up.set(0, 1, 0); tpCam.lookAt(pose.target);
  tpCam.updateMatrixWorld();
  chase.pose = { dist: chase.dist, target: pose.dist, front: true };
}

// Footsteps (groove.js + shared/groove.mjs): everyone who walks plays their slot's polyrhythm on
// ONE shared bar, so the room's footsteps are one groove. Mine while I walk, the others' from where they walk.
function walkSounds() {
  // onPeel: feet on backing paper on the floor = the muffled "paper" step (shared/peelstep.mjs)
  // dancing (Jens t814u): while the dance is on it counts as walking – the footsteps and the walk
  // sound's sequencers go on for as long as it does (groove.js: walkUntil kept up, moveUntil not).
  const walkers = [{ id: 'me', x: camera.position.x, z: camera.position.z, at: null, onPeel: peelLayer.under(camera.position.x, camera.position.z), dancing: !camView && together.dancing() }];
  for (const pl of together.players.map.values()) walkers.push({ id: pl.id, x: pl.pos.x, z: pl.pos.z, at: [pl.pos.x, 0.05, pl.pos.z], voice: together.voiceOf(pl.id), onPeel: peelLayer.under(pl.pos.x, pl.pos.z), dancing: !!pl.avatar?.dancing }); // their seed + slot colour
  // Run mode (Jens t544u): Shift + moving = my steps on the run tempo/pitch (shared/runmode.mjs).
  const running = !camView && !together.dancing() && !!controls.running;
  if (running) { const rc = loadRunMode(), rr = runRate(rc); groove.setRun({ rate: rr.rate, tune: pitchRatio(rc.pitch) }); } else groove.setRun(null);
  groove.update(walkers);
  // The walk sound's sequencer layers (radio.js walkLoop, Jens t783u): only while I walk, and on
  // the run tempo/pitch while I run – the same walking test and run state as my footsteps.
  const me = groove.track.get('me');
  radio.setWalk({ until: me && !camView ? me.walkUntil : 0, run: groove.run });
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
  onSpeaking: (id, on, level) => {
    together.setSpeaking(id, on, level);
    if (id === 'me') for (const b of micBtns()) b.classList.toggle('speaking', !!on);
    if (on && level > 0) {
      const who = id === 'me' ? (together.net.id || 'me') : id;
      const p = id === 'me' ? [camera.position.x, camera.position.y, camera.position.z]
        : (() => { const o = together.players.get?.(id); const pos = o?.avatar?.root?.position; return pos ? [pos.x, pos.y + 1.5, pos.z] : [0, 1.55, 0]; })();
      highlightLog?.add('voice', { playerId: who, p, level });
    }
  },
  onState: (st) => { renderMic(st); personalSet(VOICE_MIC_KEY, st === 'on' || st === 'muted' ? st : null); },
  toast: (k) => toast({ on: S.micOnToast, muted: S.micMutedToast, denied: S.micDenied, unsupported: S.micUnsupported }[k] || '', 1800),
  tempo: () => { try { return radio.tempo().bpm; } catch { return 90; } },
});
voice.recording = () => !!rec; // voice levels go to the server only while ● REC (voice.js)
voice.reset = () => {
  for (const id of [...voice.peers.keys()]) voice.drop(id);
  voice.setPeople([...together.players.map.keys()]);
  // Re-apply FX + monitor after peer teardown so the chain and Hear myself survive reconnects.
  try {
    let vf = null; try { vf = JSON.parse(personalGet(VOICE_FX_KEY) || 'null'); } catch { /* none */ }
    voice.setFx(cleanVoiceFx(vf || voice.fx));
    let vm = null; try { vm = JSON.parse(personalGet(VOICE_MON_KEY) || 'null'); } catch { /* none */ }
    voice.setMonitor(cleanMonitor(vm || voice.monitor));
  } catch { /* audio not ready */ }
};
voice.near = localStorage.getItem('klibb.voiceNear') !== '0';
$('voice-near').checked = voice.near;
$('voice-near').onchange = (e) => { voice.near = e.target.checked; localStorage.setItem('klibb.voiceNear', voice.near ? '1' : '0'); };
// voice effect + Hear myself (voice.js): mine for this visit (sessionStorage); follow room→city; reset on a new room.
{
  let vf = null; try { vf = JSON.parse(personalGet(VOICE_FX_KEY) || 'null'); } catch { /* none */ }
  // migrate from the older localStorage key once
  if (!vf) { try { vf = JSON.parse(localStorage.getItem('klibb.voiceFx') || 'null'); if (vf) personalSet(VOICE_FX_KEY, JSON.stringify(cleanVoiceFx(vf))); } catch { /* none */ } }
  voice.setFx(cleanVoiceFx(vf));
  let vm = null; try { vm = JSON.parse(personalGet(VOICE_MON_KEY) || sessionStorage.getItem(VOICE_FX.monKey) || 'null'); } catch { /* none */ }
  voice.setMonitor(cleanMonitor(vm));
  const on = $('voice-fx-on'), kind = $('voice-fx-kind'), amt = $('voice-fx-amt'), out = $('voice-fx-out');
  const div = $('voice-fx-div'), pitch = $('voice-fx-pitch'), harm = $('voice-fx-harm');
  const monOn = $('voice-mon-on'), monVol = $('voice-mon-vol'), monOut = $('voice-mon-out'), monRaw = $('voice-mon-raw'), monHint = $('voice-mon-hint');
  for (const k of VOICE_FX.kinds.filter((x) => x !== 'dry')) { const o = document.createElement('option'); o.value = k; o.textContent = VOICE_FX.names[k]; kind.appendChild(o); }
  for (const d of VOICE_FX.divs) { const o = document.createElement('option'); o.value = d; o.textContent = VOICE_FX.divNames[d]; div.appendChild(o); }
  for (const st of VOICE_FX.pentatonic) { const o = document.createElement('option'); o.value = String(st); o.textContent = pitchLabel(st); pitch.appendChild(o); }
  for (const h of VOICE_FX.harm) { const o = document.createElement('option'); o.value = h; o.textContent = VOICE_FX.harmNames[h]; harm.appendChild(o); }
  const showExtra = () => {
    const f = voice.fx; const k = f.kind;
    div.hidden = !(f.on && k === 'echo'); pitch.hidden = !(f.on && k === 'pitch'); harm.hidden = !(f.on && (k === 'harmony' || k === 'pitch'));
    // pitch select doubles as the interval picker for harmony's base? No – harm has its own. For pitch kind hide harm.
    harm.hidden = !(f.on && k === 'harmony');
  };
  const show = () => {
    const f = voice.fx; on.checked = f.on; kind.value = f.kind; amt.value = String(Math.round(f.amount * 100)); out.textContent = `${Math.round(f.amount * 100)} %`;
    kind.disabled = amt.disabled = !f.on; div.value = f.div; pitch.value = String(f.pitch); harm.value = f.harm;
    showExtra();
    const m = voice.monitor; monOn.checked = m.on; monVol.value = String(Math.round(m.vol * 100)); monOut.textContent = `${Math.round(m.vol * 100)} %`;
    monRaw.checked = m.raw; monVol.disabled = monRaw.disabled = !m.on; monHint.hidden = !m.on;
  };
  const save = (f) => { voice.setFx(f); personalSet(VOICE_FX_KEY, JSON.stringify(voice.fx)); show(); };
  const micRawNow = () => { try { return voice.info().raw; } catch { return false; } };
  const saveMon = async (partial, { toastOn } = {}) => {
    const was = voice.monitor.on;
    const next = cleanMonitor({ ...voice.monitor, ...partial });
    // Turning Hear myself on → raw mic on (instrument-friendly). Turning it off → raw off (chat processing back).
    if (partial.on === true && partial.raw === undefined) next.raw = true;
    if (partial.on === false && partial.raw === undefined) next.raw = false;
    voice.setMonitor(next);
    if (next.raw !== micRawNow()) await voice.setRaw(next.raw);
    personalSet(VOICE_MON_KEY, JSON.stringify(voice.monitor));
    show();
    if (toastOn && next.on && !was) toast(S.voiceMonOnToast, 2200);
    if (toastOn && !next.on && was) toast(S.voiceMonOffToast, 1600);
  };
  on.onchange = () => save({ on: on.checked }); kind.onchange = () => save({ kind: kind.value });
  div.onchange = () => save({ div: div.value }); pitch.onchange = () => save({ pitch: Number(pitch.value) }); harm.onchange = () => save({ harm: harm.value });
  amt.oninput = () => { out.textContent = `${amt.value} %`; }; amt.onchange = () => save({ amount: Number(amt.value) / 100 });
  monOn.onchange = () => saveMon({ on: monOn.checked }, { toastOn: true });
  monVol.oninput = () => { monOut.textContent = `${monVol.value} %`; if (voice.monGain && voice.state !== 'muted') voice.monGain.gain.value = Number(monVol.value) / 100; };
  monVol.onchange = () => saveMon({ vol: Number(monVol.value) / 100 });
  monRaw.onchange = () => saveMon({ raw: monRaw.checked });
  // Apply persisted raw on boot if monitor was on
  if (voice.monitor.raw) voice.setRaw(true).catch(() => {});
  show();
  // Restore mic on/muted across room→city (session only; permission already granted this visit).
  const wantMic = personalGet(VOICE_MIC_KEY);
  if (wantMic === 'on' || wantMic === 'muted') {
    voice.toggle().then(() => { if (wantMic === 'muted' && voice.state === 'on') voice.toggle(); }).catch(() => {});
  }
}
function micBtns() { return [$('mic-btn'), $('mic-touch'), $('sm-mic')]; }
function renderMic(st = voice.state) {
  for (const b of micBtns()) {
    b.dataset.state = st; b.setAttribute('aria-pressed', String(st === 'on'));
    const t = st === 'on' ? S.micTitleOn : st === 'muted' ? S.micTitleMuted : S.micTitleOff;
    b.title = t; b.setAttribute('aria-label', t);
  }
}
for (const b of micBtns()) b.onclick = (e) => { e.preventDefault(); voice.toggle(); };
// Film studio jam: J starts/stops mic (+ room bus when available) → downloads a WebM.
var studioJam = createStudioJam({ sound, toast }); // eslint-disable-line no-var
function setStudio(on, { quiet = false } = {}) {
  FILM_STUDIO = !!on;
  document.body.classList.toggle('film-studio', FILM_STUDIO);
  setStudioUnlock(FILM_STUDIO);
  try { localStorage.setItem(STUDIO_KEY, FILM_STUDIO ? '1' : '0'); } catch { /* fine */ }
  studioKey = ''; cityKey = ''; wheelKey = '';
  if (!FILM_STUDIO) studioJam.dispose();
  else {
    // Warm the mic seat so permission is ready while walking/jamming (user still confirms the prompt).
    import('./mic.js').then((m) => m.getMic('studio-warm')).catch(() => {});
  }
  // Refresh fabric/patch UI; leaving studio re-reads server flags (open access still wins).
  const refreshEnt = () => { try { together.sendUnlock?.(credentials()); } catch {} try { together.entitlementsChanged?.(); } catch {} try { onEntitlements?.(); } catch {} };
  if (FILM_STUDIO) refreshEnt();
  else loadEntitlements().then(refreshEnt).catch(refreshEnt);
  const list = stickerDesigns();
  if (!keepSel(list)) select(list[0] || null); else renderDesignHud();
  renderStrip();
  if (!quiet) toast(FILM_STUDIO
    ? '🎬 Film studio ON – all stickers in the city · ←/→ wheels · J = jam mic'
    : 'Film studio off', 2800);
  return FILM_STUDIO;
}
if (FILM_STUDIO) {
  // URL/localStorage already on: announce once the room is up.
  addEventListener('load', () => setTimeout(() => toast('🎬 Film studio · all stickers · J = jam', 2600), 800), { once: true });
}
addEventListener('keydown', (e) => {
  if (isTouch || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e) || together.chatOpen()) return;
  if (e.code === 'KeyB') voice.toggle();
  if (e.code === 'KeyJ') {
    if (!FILM_STUDIO) { setStudio(true); return; }
    if (e.shiftKey) { setStudio(false); return; }
    studioJam.toggle();
  }
});
renderMic();

// ---------- The held sticker in session recordings ----------
// While the room is being recorded, the sticker I hold and aim with (the preview on the wall) goes
// to the server (~8 a second while it moves, null when I let go / stop aiming), so replays and
// videos show it on the wall from the moment I pick it up – not only once it is slapped.
// Not sent when nobody records; never shown to the others live. (shared/replay.mjs heldAt)
const HELD_SEND_MS = 125;
const heldTx = { key: null, at: 0, img: null };
const r3 = (n) => Math.round(n * 1000) / 1000;
// Pulling out a sticker row (arrays): the same 'held' line carries the row instead – the anchor
// (p, n, q, s = where A sits on the wall, w × h = one copy) and a = { to: the drag target B }, so the
// replay recomputes the ghosts with shared/array.mjs (round corners too) all through the drag, and
// the avatar's drag pose. After release the last row line stays until the server has the copies
// (they are in the recording as stamp:add by then), so the replay goes ghosts → stickers with no gap.
let arrayRec = null; // { msg } between release and the server's answer
function heldMsg(x) {
  if (!x) return null;
  if (x.row) {
    const d = x.row;
    return { img: d.a.design.id, p: d.a.point.toArray().map(r3), n: d.a.normal.toArray().map(r3), q: d.a.q.toArray().map(r3), w: r3(d.w), h: r3(d.h),
      ew: r3(d.endW || d.w), eh: r3(d.endH || d.h), s: d.a.surface, a: { to: d.to.toArray().map(r3) } };
  }
  if (x.msg) return x.msg;
  return { img: state.selected.id, p: x.h.point.toArray().map(r3), n: x.h.normal.toArray().map(r3), q: x.q.toArray().map(r3), w: r3(x.w), h: r3(x.hh), s: x.h.surface };
}
function recordHeld(x) {
  if (!rec || together.net.status !== 'online') { heldTx.key = null; return; }
  const msg = heldMsg(x);
  const key = msg ? JSON.stringify(msg) : 'null';
  if (key === heldTx.key) return;
  const t = performance.now();
  // let go, a new design or the first one: at once; moving the aim: at most every HELD_SEND_MS
  if (!msg || heldTx.key === 'null' || heldTx.key === null || heldTx.img !== msg.img || t - heldTx.at >= HELD_SEND_MS) {
    if (together.net.sendHeld(msg) === false) return;
    heldTx.key = key; heldTx.at = t; heldTx.img = msg ? msg.img : null;
  }
}

// ---------- Huvudloopen ----------
const clock = new THREE.Clock();
let holdSharpForTests = false; // klibb.holdSharp(true): tests about other things (arrays) keep the held sticker sharp
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (holdSharpForTests && deskHeld && deskHeld.state === 'timed') { const t = performance.now(); if (deskHeld.canSlap(t)) deskHeld.keepAlive(t); else deskHeld.wake(t); }
  if (!camView && !together.dancing()) controls.update(dt);
  else if (together.dancing()) {
    if (controls.joy.lengthSq() > 0.04) cancelDance(); // the phone joystick moved: stop dancing, walk
    else { controls.keys.clear(); controls.joy.set(0, 0); } // dance owns the body – no WASD/joystick fight
  }
  propsUi.tick(dt); // props: far ones without ink, my chair, the Props wheel's ghost
  tickCityDoors();
  tickRoomFabric(room.surfaces); if (sp.open) { fargUi.tick(); for (const k of SURF_KINDS) ownUi[k].tick(); } // Färg: the room image spins / cycles / scrolls
  for (const ac of autoCamsOf(cams.list())) { const q = liveAutoPose(ac); if (q) cams.place(ac.id, q); }
  let cv = camView && cams.get(camView);
  if (cv && cv.auto) { const q = liveAutoPose(cv); if (q) cv = { ...cv, ...q }; }
  if (cv) poseCamera(viewCam, { p: cv.p, yaw: cv.yaw, pitch: cv.pitch, fov: cv.fov });
  const tp = !cv && view !== 'first';
  if (tp) { if (view === 'front') updateFront(dt); else updateChase(dt); }
  const avv = !cv && together.avatarView(); // 'My avatar' open: the camera on my avatar (closing = back to normal)
  if (avv) updateShowcase(avv); else show.face = null;
  const eyeCam = avv ? showCam : cv ? viewCam : tp ? tpCam : camera;
  // Looking through a camera (a placed one or an auto cameraman): my own avatar stands where I
  // stand and is filmed too (also in first person, where it is otherwise not built), unless that
  // camera is right at it. Back in my own eyes the first-person view hides it again.
  const wantSelf = view !== 'first' || !!cv;
  if (wantSelf !== selfShown) { selfShown = wantSelf; together.showSelf(wantSelf); }
  const camAtMe = cv && Math.hypot(camera.position.x - viewCam.position.x, camera.position.z - viewCam.position.z) < 0.45;
  // gubbar precis vid kameran döljs, och min egen om kameran kommer för nära (t.ex. mot en vägg)
  together.update(dt, eyeCam.position, { hideSelf: cv ? camAtMe : !tp || chase.dist < (view === 'front' ? FRONT.minDist * 0.8 : CHASE.hideBelow) });
  cams.update(cv ? null : eyeCam.position);
  peelLayer.update();
  slapFx.update();
  walkSounds();
  radio.tick();
  placeTick();
  voice.update();
  updateCredit();
  { const cam = cv ? viewCam : camera; cam.getWorldDirection(fwd); sound.setListener(cam.position, fwd); }
  let dragging = false;
  if (arrayDrag && controls.locked) { try { dragging = updateArray() > 0; } catch (err) { arrayFailed('drag', err); } }
  let heldNow = null; // what goes into a running recording as the sticker I hold (recordHeld)
  // The drag pose on my own avatar while I pull a row out (3rd person, cameras, and the recording).
  const rowEnd = dragging ? arrayDrag.items[arrayDrag.items.length - 1] : null;
  together.selfHold(rowEnd ? rowEnd.position : null, rowEnd ? (rowEnd.normal || arrayDrag.a.normal.toArray()) : null);
  // Jens, 9 Nov 2026: aim never auto-fades → no silent switch to View mode from a fade-out.
  if (dragging) { preview.hide(); heldNow = { row: arrayDrag }; } // dragging a row: the ghosts are the preview
  else if (arrayRec) { preview.hide(); heldNow = { msg: arrayRec.msg }; } // released: until the server has the copies
  else if (propsMode()) preview.hide(); // Props mode: the prop's ghost is the preview (propsmode.js)
  else if (!aimOff && controls.locked && state.selected && !state.adminToken && state.mode === 'slap' && deskHeld && deskHeld.opacity(performance.now()) > 0) {
    if (mouseHeld) deskHeld.keepAlive(performance.now()); // the button held (arrays): no fade meanwhile
    preview.setFade(deskHeld.opacity(performance.now())); // always 1 while aim on (no auto-fade)
    const h = hitSurface(CENTER);
    if (h) {
      const [w, hh] = StampLayer.dims(state.selected, ((Number.isFinite(maxSizeCm()) ? Math.min(state.size, maxSizeCm() / 100) : state.size)));
      const q = StampLayer.orientation(h.normal, h.dir, nextRotation());
      preview.show(h.point, h.normal, q, w, hh, h.surface);
      heldNow = { h, q, w, hh };
    } else preview.hide();
  } else if (isTouch && touchAim && state.selected && !camView) {
    // Touch, a finger aiming: the sticker on the wall where the finger points (the touch's ray).
    preview.setFade(1);
    const h = hitSurface(new THREE.Vector2((touchAim.x / innerWidth) * 2 - 1, -(touchAim.y / innerHeight) * 2 + 1));
    touchAim.hit = h ? h.point.toArray() : null; // (tests: where the preview is)
    if (h) {
      const [w, hh] = StampLayer.dims(state.selected, ((Number.isFinite(maxSizeCm()) ? Math.min(state.size, maxSizeCm() / 100) : state.size)));
      const q = StampLayer.orientation(h.normal, h.dir, nextRotation());
      preview.show(h.point, h.normal, q, w, hh, h.surface);
      heldNow = { h, q, w, hh };
    } else preview.hide();
  } else if (isTouch && stackMenu && rec && !camView && state.selected && !state.adminToken && !stackMenu.isOpen() && !stackMenu.bookOpen()
    && stackMenu.held.opacity(performance.now()) > 0) {
    // Touch: no preview on the wall live (the sticker sits in its holder), but while it is held
    // (sharp, or still fading out) the recording shows it where the middle of the screen aims.
    const h = hitSurface(CENTER);
    if (h) { const [w, hh] = StampLayer.dims(state.selected, ((Number.isFinite(maxSizeCm()) ? Math.min(state.size, maxSizeCm() / 100) : state.size))); heldNow = { h, q: StampLayer.orientation(h.normal, h.dir, nextRotation()), w, hh }; }
  }
  else if (deskHeld) preview.hide(); // desktop: faded (or nothing to aim) – no held sticker on the wall
  // keepAlive kept for API compat; no auto-fade so fingers do not need to refresh a timer
  recordHeld(heldNow);
  roomSizer.sync(); if (!roomSizer.isDefault() || selfieOn()) preview.hide(); // stickers follow the test size; no held sticker on a moved wall, nor in selfie mode
  if (cv) renderFramed(renderer, scene, viewCam, cv.aspect || '');
  else { if (camView) exitCamView(); renderer.render(scene, avv ? showCam : tp ? tpCam : camera); }
  requestAnimationFrame(frame);
}

renderTray();
renderHistory();
if (!DEMO && !IN_CITY && state.mine.length) select(last(state.mine));
const startPick = state.selected; // (replaced by the start sticker (98) once the library is in, unless I picked something meanwhile)
// The library (the demo's palette; also loaded outside the demo for later use).
const LIB_SEL = 'klibb.libSel';
const libraryReady = fetch('/api/library').then((r) => r.json()).then(({ stickers }) => {
  state.library = Array.isArray(stickers) ? stickers : [];
  renderLibTray();
  if (!DEMO) { // the library is on the wheel for everyone; nothing of my own yet → hold the first library sticker
    // from the start the wheel stands on WHEEL_START[0] (98; Jens, 4 Nov 2026) – also when I have uploads of my own
    const first = IN_CITY ? null : state.library.find((d) => d.id === WHEEL_START[0]); // the city: my pack's first sticker
    if (IN_CITY && (!state.selected || state.selected === startPick || !stickerDesigns().some((d) => d.id === state.selected.id))) { select(stickerDesigns()[0] || null); return; }
    if (first && (!state.selected || state.selected === startPick)) select(first);
    else if (!state.selected && state.library.length) select(wheelDesigns()[0]); else renderDesignHud();
    return;
  }
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
// Reload / tab close: keep the clothes actually worn (draft or live mesh), not only last Save.
window.addEventListener('pagehide', () => { persistWornBeforeLeave(); });
// On-screen Aim on/off (desktop + touch HUD); O key also toggles.
{
  const btn = $('aim-toggle');
  if (btn) {
    // pointerdown only (avoids click+pointerdown double-toggle). Unlock so the hit can land under pointer-lock.
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (controls?.locked) controls.unlock?.();
      setAimOff(!aimOff);
    });
  }
  syncAimToggleBtn();
}
window.klibb = {
  filmsEnabled: FILMS_ENABLED,
  filmLog: () => filmLog, filmState, filmBlob, filmThenCity: () => filmThenCity(),
  highlightLog: () => highlightLog, highlightStore: () => highlightStore, highlightState, highlightBlob,
  highlightPreview: (size) => highlightLog ? highlightPreview({ events: highlightLog.events(), roomId: ROOM, style: state.style, stickers: stickersForReel(), city: !!CITY_OUTSIDE, size }) : null,
  offerHighlight: () => leaveWithHighlight(() => {}), highlightCrew: () => highlightCrew,
  filmPreview: async (size) => filmPreview({ ...(await filmOpts()), size }), // tests/stills: a frame of the film at any time
  props: propsUi, propsMode, setProps,
  demo: DEMO, config, voice: () => voice.info(), voiceObj: () => voice, toggleMic: () => voice.toggle(), library: () => state.library.slice(),
  studio: () => FILM_STUDIO, setStudio, studioJam: () => (studioJam ? studioJam.state() : null),
  demoState: () => ({ timer: $('demo-timer').hidden ? null : $('demo-timer').textContent, closed: !$('demo-closed').hidden, closedTitle: $('demo-closed-title').textContent,
    closedText: $('demo-closed-text').textContent, invite: inviteState, inviteNote: $('invite-note').hidden ? '' : $('invite-note').textContent, left: demoTimer && demoTimer.left ? demoTimer.left() : null }),
  inviteFriend, mySlot: () => together.mySlot(), talking: () => together.talking(),
  soundUi: () => soundUi, delayRoom: () => ({ ...delayRoom.state, times: delayRoom.times, live: sound.engine?.place?.room ? sound.engine.place.room.map((r) => ({ time: r.d.delayTime.value, fb: r.fb.gain.value, send: r.send.gain.value, ret: r.ret.gain.value })) : null }), reverbRoom: () => ({ inside: insideReverbRoom(camera.position.x, camera.position.z), gaze: placeNow?.rvGaze, live: sound.engine?.place?.verbRoom ? sound.engine.place.verbRoom.map((r) => ({ time: r.pre.delayTime.value, fb: r.fb.gain.value, send: r.send.gain.value, ret: r.ret.gain.value, toneInLoop: !!r.toneInLoop, toneInSend: !!r.toneInSend, toneInTail: !!r.toneInTail, toneInEars: !!r.toneInEars, toneOut: !!r.toneOut, toneRet: r.toneRet ? r.toneRet.gain.value : null, wires: (r.wires || []).map((w) => w.slice()), toneHz: r.osc.frequency.value, toneLvl: r.lvl.gain.value, toneWet: r.toneWet ? r.toneWet.gain.value : null, lfoHz: r.lfo.frequency.value, lfoBase: r.am.gain.value, lfoDepth: r.depth.gain.value })) : null, street: sound.engine?.place ? { small: sound.engine.place.small.send.gain.value, big: sound.engine.place.big.send.gain.value } : null }), place: () => ({ now: placeNow, bus: !!sound.engine?.place, worklet: !!sound.engine?.place?.node, sets: sound.engine?.place?.sets || 0, cfg: placeCfg }), setCityFx: (cfg) => { placeCfg = cfg ? (cleanCityFx(cfg) || CITY_FX) : CITY_FX; placeAt = 0; return placeCfg; }, resuming: () => resuming, escGate, openStylePanel: (m = 'edit') => openStylePanel(m), styleOpen: () => sp.open, synthShared: () => synthShared, soundSteps: () => groove.events, peelSteps: () => ({ steps: sound.steps, peelSteps: sound.peelSteps, log: sound.stepLog.slice(), under: peelLayer.under(camera.position.x, camera.position.z) }), renderPeelSteps: async (specs) => { const { renderSteps } = await import('./synthcheck.js'); return renderSteps(specs); },
  groove: () => ({ ...groove.groove, offset: groove.offset, now: groove.now(), events: groove.events, buzzing: groove.buzzing, log: groove.log.slice(), tracks: [...groove.track].map(([id, t]) => ({ id, v: +t.v.toFixed(3), walking: t.walkUntil > groove.now(), moving: (t.moveUntil || 0) > groove.now(), buzz: !!t.buzz })), canChange: canGroove(), ui: { hidden: $('groove-box').hidden, slider: +$('groove-scale').value, value: $('groove-val').textContent, chip: $('groove-chip').hidden ? '' : $('groove-chip').textContent } }),
  setGrooveScale, grooveObj: () => groove,
  autoSlap: () => null, autoSlapObj: () => null, radio: () => radio, radioReady: () => radioReady, soundObj: () => sound, soundMine: () => sound.mine, prepareSoundForPlace, resetPersonalSound, voiceOf: (id) => together.voiceOf(id),
  // Render every sound offline (Tone.Offline) and report peak/RMS – the "non-silent, no clipping" check.
  synthCheck: async (patches) => { const { offlineCheck } = await import('./synthcheck.js'); return offlineCheck(patches); },
  entitlements: () => JSON.parse(JSON.stringify(entitlements)), entitlementsReady: () => entitlementsReady,
  ready: false, room: ROOM, state, stamps, camera, controls, preview, renderer, scene,
  nameTag: nameTagState, openNameTag, door: doorState, menuAction: (k) => menuActions[k]?.(),
  city: () => ({ id: THIS_CITY, outside: CITY_OUTSIDE, inCity: IN_CITY, house: houseNumber(ROOM), info: cityInfo, paid: cityPaid, wheel: stickerDesigns().map((d) => d.id), taken: takenPacks().map((p) => p.id), hall: townHallState(), pick: cityPickState(), atDoor, doors: room.doors ? room.doors.length : 0, doorStates: room.doors ? room.doors.map((d) => [d.userData.door, d.userData.state || null]) : [], testBus: !!TESTBUS, busStop: !!room.busStop, busOpen: busSheetOpen(), bots: (() => {
      const fromNet = [...together.players.map.values()].map((pl) => ({
        id: pl.id, name: pl.name, insta: pl.look?.insta || pl.avatar?.insta || '',
        x: pl.pos?.x, z: pl.pos?.z, built: !!pl.avatar,
      }));
      if (fromNet.length) return fromNet;
      return cityBusBots?.bots?.map((b) => ({ id: b.id, name: b.name, insta: b.insta })) || [];
    })() }),
  bus: () => ({
    open: busSheetOpen(),
    openSheet: () => openBusSheet({ here: THIS_CITY, go: (id) => goRoom(id, `&${TESTBUS_PARAM}=1`), toast, S }),
    close: closeBusSheet,
    // Point camera at plaza: hall wall + bus stop + walking bots (for screenshots / e2e).
    lookAtPlaza: () => {
      // Frame hall south face + walking bots (circle ~z=11) + bus stop at ~(5.2, 12).
      camera.position.set(2.5, 1.85, 16.2);
      controls.yaw = 0.22; controls.pitch = -0.06; controls.apply?.();
      return { x: camera.position.x, z: camera.position.z, busStop: !!room.busStop, bots: together.players.map.size };
    },
    lookAtBusStop: () => {
      camera.position.set(5.2, 1.7, 15.5);
      controls.yaw = 0; controls.pitch = -0.05; controls.apply?.();
      return { busStop: !!room.busStop?.mesh, pos: room.busStop ? [room.busStop.x, room.busStop.z] : null };
    },
    lookAtBots: () => {
      const pl = [...together.players.map.values()][0];
      if (pl?.pos) {
        camera.position.set(pl.pos.x + 3.5, 1.8, pl.pos.z + 4.5);
        controls.yaw = Math.atan2(-(pl.pos.x - camera.position.x), -(pl.pos.z - camera.position.z));
        controls.pitch = -0.1; controls.apply?.();
      } else {
        camera.position.set(0, 1.8, 14.5); controls.yaw = 0; controls.pitch = -0.08; controls.apply?.();
      }
      return { bots: [...together.players.map.values()].map((p) => ({ name: p.name, insta: p.look?.insta, x: p.pos?.x, z: p.pos?.z })) };
    },
    lookAtHall: () => {
      camera.position.set(0, 2.3, 11.8);
      controls.yaw = 0; controls.pitch = 0.02; controls.apply?.();
      return { stickers: stamps.count };
    },
  }),
  openHall, cityDoor: (n) => openCityDoor(plotOfDoor(n)), refreshCity, deck: () => deckDesigns().map((d) => d.id), kept: readKept,
  menuClick: (x = 0, y = 0) => menuClick(new THREE.Vector2(x, y)), menuAt: () => null, openRoomPanel, askForVisitors, roomSize: () => ({ ...roomSizer.get(), normal: roomSizer.isDefault() }), setRoomSize: (d) => roomSizer.set(d), roomSurfaces: () => room.surfaces, roomBounds: () => room.bounds, roomPanel: () => ({ open: !$('room-panel').hidden, info: rp.info }), choice: () => ({ open: !$('menu-choice').hidden, what: $('menu-choice').dataset.what || null }),
  // Vikningen utan rendering, för tester: vilka ytor hamnar en klibba på och hur stor yta?
  fold(position, quaternion, w, h, surface) {
    const pieces = foldStamp(stamps.faces, { center: new THREE.Vector3(...position), quaternion: new THREE.Quaternion(...quaternion), w, h, surface });
    return pieces.map((p) => ({ face: p.face, depth: p.depth, uv: p.uv, points: p.points.map((v) => v.toArray()) }));
  },
  orientation: (normal, dir, rot) => StampLayer.orientation(new THREE.Vector3(...normal), new THREE.Vector3(...dir), rot).toArray(),
  look(yaw, pitch) { controls.yaw = yaw; controls.pitch = pitch; controls.apply(); },
  moveTo(x, z) { camera.position.x = x; camera.position.z = z; },
  stampAt: (x = 0, y = 0) => stampAt(new THREE.Vector2(x, y)),
  arrayFaults, arraysOff: () => arraysOff, lockBroken: () => lockBroken,
  arrayState: () => ({ dragging: !!arrayDrag, ghosts: ghosts.count, inFlight: arrayOps.length, items: arrayDrag ? arrayDrag.items.length : 0, endSize: arrayDrag ? arrayDrag.endSize : null, endW: arrayDrag ? arrayDrag.endW : null, endH: arrayDrag ? arrayDrag.endH : null }), arrayPlan, scaleArrayEnd,
  pendingSlaps: () => pendingSlaps.size, // klibbor som syns men inte är bekräftade av servern än
  styleFromSeed, randomSeed, normalizeStyle, currentStyle: () => currentStyle, roomFabric: () => roomFabricInfo(room.surfaces), styleDraft: () => sp.style && JSON.parse(JSON.stringify(sp.style)), canEditStyle, surfaces: room.surfaces,
  net: together.net, players: () => together.players.list(), me: together.me, roomLook: () => together.roomLook(), openChat: together.openChat,
  openAvatarPanel: together.openAvatarPanel, closeAvatarPanel: together.closeAvatarPanel, stampPatchAt: (...a) => together.stampPatchAt(...a), getPatchTool: () => together.getPatchTool?.(), persistWornLook: () => together.persistWornLook(), goRoom: (id, extra) => goRoom(id, extra || ''), avatarModel: () => import('./avatars.js').then((m) => m.loadAvatarModel()).then(() => true),
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
  escMenu: () => escMenu, slapFx: () => slapFx, wheelExclude: () => WHEEL_EXCLUDE, formerMenuIds: () => FORMER_MENU_IDS,
  enterCamView, exitCamView, camView: () => camView, viewCam, rec: () => rec, renderRecs,
  wheelUp, touchAim: () => (touchAim ? { ...touchAim } : null), touchPinch: () => (touchPinch ? { ...touchPinch } : null), hitAt: (x, y) => { const h = hitSurface(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1)); return h ? { point: h.point.toArray(), surface: h.surface } : null; },
  savePreset, bakePresetUrls, preset: () => ({ room: presetRoom, ...presetLayer.info() }), presetLayer: () => presetLayer,
  held: () => stackMenu?.info() ?? null, holdSharp: (on = true) => { holdSharpForTests = !!on; }, deskHeld: () => deskHeld && { ...deskHeld.info(performance.now()), previewVisible: preview.mesh.visible, previewOpacity: +preview.mat.opacity.toFixed(3), aimOff }, aimOff: () => aimOff, setAimOff, syncAimToggleBtn, stackMenu: () => stackMenu, heldRec: () => ({ ...heldTx }),
  strip: () => ({ shown: wheelIsLit() && !$('design-strip').hidden && $('design-strip').getClientRects().length > 0 && Number(getComputedStyle($('design-strip')).opacity) > 0.05, lit: wheelIsLit(), n: $('strip-row').children.length, sel: $('strip-row').querySelector('.sel')?.dataset.id ?? null, num: $('strip-num').textContent, scroll: wheel.info().pos, rect: $('design-strip').getBoundingClientRect().toJSON(), packSlot: FILM_STUDIO ? studioSlot : cityPackSlot, label: $('wheel-label')?.textContent || '' }),
  wheelUp, wheelDown, wheelIsLit,
  wheel: () => wheel.info(), wheelApi: wheel, natureWheel: () => natureWheel.info(), natureWheelApi: natureWheel, activeWheel, stickerDesigns, natureDesigns, natureOpen,
  natureStrip: () => ({ shown: !$('nature-strip').hidden && $('nature-strip').getClientRects().length > 0, locked: $('nature-strip').classList.contains('locked'), n: $('nature-row').children.length, sel: $('nature-row').querySelector('.sel')?.dataset.id ?? null, num: $('nature-num').textContent, rect: $('nature-strip').getBoundingClientRect().toJSON() }),
  // the held sticker's drop shadow, and where it and the sticker are on screen (px), for the tests
  heldShadow: () => {
    const st = preview.shadowState(), cam = camView ? viewCam : view !== 'first' ? tpCam : camera;
    const px = (m) => {
      m.updateMatrixWorld(); const b = new THREE.Box3().setFromObject(m), c = b.getCenter(new THREE.Vector3()).project(cam), r = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i < 8; i++) { const v = new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(cam); const x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight; r[0] = Math.min(r[0], x); r[1] = Math.min(r[1], y); r[2] = Math.max(r[2], x); r[3] = Math.max(r[3], y); }
      return { c: [(c.x + 1) / 2 * innerWidth, (1 - c.y) / 2 * innerHeight], box: r, world: b.getSize(new THREE.Vector3()).toArray() };
    };
    return { ...st, view, screen: st.visible ? { sticker: px(preview.mesh), shadow: px(preview.shadow) } : null };
  },
  setView, toggleView, startDance, cancelDance, toggleDance, dancing: () => together.dancing(), meWalking: () => meWalking(), walkUntil: () => radio.walk.until, runMode: () => ({ ...loadRunMode(), running: !!controls.running, run: groove.run ? { ...groove.run } : null }), view: () => view, tpCam, chase: () => ({ ...chase.pose, cam: tpCam.position.toArray() }), selfAvatar: () => together.selfInfo(), avatarView: () => { const v = together.avatarView(); return v && { ...v, cam: showCam.position.toArray(), fov: showCam.fov, pose: show.pose }; }, showCam, peels: () => peelLayer.info(), peelPose: (id) => peelLayer.poseOf(id), nopes: () => nopes,
  peelOverlap: (pos, quat, size) => peelLayer.overlap(state.selected, { position: pos, quaternion: quat, size }), fabricStats: () => together.fabricStats(), previewFabrics: () => together.previewFabrics(), freezeGestures: (ms) => together.freezeGestures(ms), handPos: () => together.handPos(),
  nextDesign, prevDesign, designs, wheelDesigns, validateDesigns, removeDesign, undoRemove, toggleFav, undoMs: UNDO_MS, setMode, toggleMode, toggleNature, setNatureMode, natureMode, peelLast, peelAll, roomHistory: () => peelable(), peelSettled, peelLimit: PER_ROOM, setSize, get maxSizeCm() { return maxSizeCm(); }, freeMaxCm: FREE_MAX_CM, get minSizeCm() { return minSizeCm(); }, freeMinCm: FREE_MIN_CM, nature: NATURE, limitsFor, dropsPeel, selectDesign: (img) => select(img), startSizeCm: (img) => startSizeCm(img, { minCm: minSizeCm(), maxCm: maxSizeCm() }), startHeightCm: START_HEIGHT_CM, sideForHeightCm,
};

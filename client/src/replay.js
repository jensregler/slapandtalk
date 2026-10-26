// Uppspelaren: /?room=<rum>&replay=<recId>
// Laddar en sessionsinspelning och spelar upp den i 3D-rummet: gubbar som går och tittar,
// klibbor som kommer och peelas, chatten, kamerorna. Välj vy: fri kamera, en placerad kamera
// eller någons ögon (POV). "⏺ Record video" makes a finished video: the logo intro, then what
// you see (free version: + channel bug and link ticker), uploaded with a link to share.
import * as THREE from 'three';
import { buildBoxRoom } from './room.js';
import { applyStyle, normalizeStyle, DEFAULT_STYLE } from './roomstyle.js';
import { StampLayer } from './stamps.js';
import { PeelLayer } from './peels.js';
import { Avatar, loadAvatarModel } from './avatars.js';
import { CameraLayer, poseCamera, renderFramed, aspectRatio } from './cameras.js';
import * as photo from './photo.js';
import { FirstPersonControls } from './controls.js';
import { S, LOCALE } from './strings.js';
import { parseRecording, buildTimeline, snapshotAt, participants } from '../../shared/replay.mjs';
import { planShots, shotAt, shotPose, roomPose, speechSegments, openOf, TALK_LEVELS } from '../../shared/director.mjs';
import { createAutoCam, stickerTargets, recordingCrew, roomShotCamera, crewView, AUTO_PATHS, autoView } from '../../shared/autocam.mjs';
import { createComposer, canRecordVideo } from './videocomposer.js';
import { entitlements, loadEntitlements, unlockHeaders } from './entitlements.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ROOM = (params.get('room') || 'stad').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'stad';
const REC = String(params.get('replay') || '').toLowerCase().replace(/[^a-f0-9]/g, '').slice(0, 16);
const EYE_FOV = 70; // samma bildvinkel som i rummet
document.body.classList.add('replay');
$('replay-bar').hidden = false;
$('room-name').textContent = ROOM;
$('rp-back').href = ROOM === 'stad' ? '/' : `/?room=${ROOM}`;

const entitlementsReady = loadEntitlements(); // free = channel bug + ticker in finished videos
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = true;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x111111);
const camera = new THREE.PerspectiveCamera(EYE_FOV, 1, 0.05, 100); // den fria kameran
const view = new THREE.PerspectiveCamera(EYE_FOV, 1, 0.05, 100); // det som faktiskt visas
const room = buildBoxRoom(); scene.add(room.group);
camera.position.set(0, 2.4, 4.4);
const controls = new FirstPersonControls(camera, canvas, room.bounds);
controls.pitch = -0.22; controls.apply();
const stamps = new StampLayer(scene, room.surfaces);
const cams = new CameraLayer(scene);
// Peels (backing paper): in the same scene, so every view, the finished video and 📷 photos have them.
// Its clock is the replay time, so a fall looks the same at every play, seek and scrub.
const peelLayer = new PeelLayer(scene, { now: () => (rp.snap ? rp.snap.t : 0) });
const avatars = new Map(); // id -> { avatar, last: Vector3, speed }
let model = null;
loadAvatarModel().then((m) => { model = m; }).catch(() => {});

function resize() { renderer.setSize(innerWidth, innerHeight, false); }
addEventListener('resize', resize); resize();

const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const rp = { tl: null, meta: null, t: 0, playing: false, speed: 1, view: 'free', style: '', snap: null, chatShown: '', recorder: null, lastFrameT: 0, plan: null, speakers: [], shot: null, dirCam: null, dirDt: 0, auto: new Map(), rc: null, curShot: null };
// The auto cameraman (shared/autocam.mjs): one take per path, seeded by the recording id, so the
// same recording always gives the same take (the server's shot list has the same ones).
// The room's own cameramen (one or more camera entries { auto }) are a crew (recordingCrew): each
// its own view 'autocam:<id>', seeded `${recId}:${id}`, the same as in the server's shot list.
const autoPose = (path, t = rp.t) => rp.auto.get(path)?.poseAt(t) || null;
const crewPose = (id, t = rp.t) => (rp.rc ? rp.rc.poseAt(id, t) : null);
const crewSpan = (id, t = rp.t) => (rp.rc ? rp.rc.at(id, t) : null);

// ---------- Synka scenen mot inspelningen vid tiden t ----------
async function showStyle(style) {
  const key = JSON.stringify(style || null); if (key === rp.style) return; rp.style = key;
  try { await applyStyle(room.surfaces, normalizeStyle(style || DEFAULT_STYLE)); } catch { /* texturer saknas: rummet är grått */ }
}
function syncStamps(list) {
  const want = new Map(list.map((s) => [s.stamp.id, s]));
  for (const id of [...stamps.meshes.keys()]) if (!want.has(id)) stamps.remove(id);
  for (const [id, s] of want) {
    if (stamps.meshes.has(id) || rp.loading.has(id)) continue;
    stamps.gone.delete(id); // kan ha tagits bort tidigare (om man spolat bakåt)
    rp.loading.add(id);
    stamps.add(s.stamp, s.image).finally(() => {
      rp.loading.delete(id);
      if (!rp.snap?.stamps.some((x) => x.stamp.id === id)) stamps.remove(id); // hann spola förbi
    });
  }
}
// Peels at the snapshot's time: add / remove to match, rewind the ones that should still be falling.
function syncPeels(s) {
  peelLayer.setOn(s.peelsOn);
  const want = new Map(s.peels.map((p) => [p.peel.id, p]));
  const gone = [...peelLayer.peels.keys()].filter((id) => !want.has(id));
  if (gone.length) peelLayer.remove(gone);
  for (const [id, p] of want) {
    const born = p.age === Infinity ? -Infinity : s.t - p.age; // Infinity = already on the floor at the start
    if (peelLayer.peels.has(id)) peelLayer.rewind(id, born);
    else peelLayer.add(p.peel, p.image, { born });
  }
  peelLayer.update(s.t);
}
function syncPlayers(list, dt, jumped) {
  const seen = new Set();
  for (const p of list) {
    seen.add(p.id);
    let a = avatars.get(p.id);
    if (!a && model) { a = { avatar: new Avatar(model, p.look, p.name), last: null, speed: 0 }; avatars.set(p.id, a); scene.add(a.avatar.root); }
    if (!a) continue;
    if (p.look) a.avatar.setLook(p.look);
    if (a.avatar.name !== p.name) a.avatar.setName(p.name);
    const pos = new THREE.Vector3(p.p[0], 0, p.p[2]);
    const v = a.last && dt > 0 && !jumped ? a.last.distanceTo(pos) / dt : 0;
    a.speed += (v - a.speed) * Math.min(1, dt * 10); a.last = pos;
    a.avatar.root.position.copy(pos); a.avatar.root.rotation.y = p.y + Math.PI;
    // Med någons ögon: dölj den egna gubben. Står någon precis där kameran står: dölj den också.
    a.avatar.root.visible = rp.view !== `pov:${p.id}` && Math.hypot(p.p[0] - view.position.x, p.p[2] - view.position.z) > 0.45;
    // The recorded voice level drives the (glitchy) mouth and the speaking mark; t keeps the
    // glitches the same every time this moment is played (mouth.js).
    a.avatar.setSpeaking(p.talk >= 2, p.talk / TALK_LEVELS);
    a.avatar.setMouth(openOf(p.talk), rp.t);
    a.avatar.update(dt, a.speed);
  }
  for (const [id, a] of avatars) if (!seen.has(id)) { scene.remove(a.avatar.root); a.avatar.dispose(); avatars.delete(id); }
}
function syncChat(list, prevT, t) {
  const key = list.map((m) => m.id).join(',');
  if (key !== rp.chatShown) {
    rp.chatShown = key;
    const ul = $('rp-chat'); ul.innerHTML = '';
    for (const m of list) {
      const li = document.createElement('li');
      const tm = document.createElement('span'); tm.className = 'tm'; tm.textContent = fmt(m.t);
      const nm = document.createElement('span'); nm.className = 'n'; nm.textContent = m.name;
      li.append(tm, nm, document.createTextNode(m.text)); ul.appendChild(li);
    }
  }
  // Pratbubblor för det som sägs medan man spelar (inte när man spolar).
  if (t > prevT && t - prevT < 1000) for (const m of list) if (m.t > prevT && m.t <= t) avatars.get(m.from)?.avatar.say(m.text);
}
function apply(t, dt = 0, jumped = false) {
  const prevT = rp.snap ? rp.snap.t : 0;
  const s = snapshotAt(rp.tl, t); rp.snap = s;
  showStyle(s.style);
  syncStamps(s.stamps);
  syncPeels(s);
  cams.set(s.cameras);
  syncPlayers(s.players, dt, jumped);
  syncChat(s.chat, prevT, t);
  renderViewOptions(s);
  $('rp-time').textContent = `${fmt(t)} / ${fmt(rp.tl.duration)}`;
  if (document.activeElement !== $('rp-seek')) $('rp-seek').value = String(Math.round(t));
}

// ---------- Vy: fri kamera, en placerad kamera eller någons ögon ----------
let lastOptions = '';
function renderViewOptions(s) {
  const opts = [['free', S.viewFree]];
  if (rp.speakers.length) opts.unshift(['director', S.viewDirector]);
  // Every cameraman the room had in this recording (off right now = "not here now"), then the generic paths.
  if (rp.rc) for (const id of rp.rc.ids) { const sp = rp.rc.spans.filter((x) => x.id === id), now = crewSpan(id); opts.push([crewView(id), S.viewCrew((now || sp[sp.length - 1]).name, rp.rc.crew.get((now || sp[sp.length - 1]).key).path, !!now)]); }
  for (const p of AUTO_PATHS) opts.push([autoView(p), S.viewAuto(p)]);
  // One take per speaker and angle: pick it and ⏺ Record video for raw material to cut between.
  for (const sp of rp.speakers) for (const k of ['close', 'medium', 'rear']) opts.push([`${k}:${sp.id}`, S.viewAngle(k, s.players.find((x) => x.id === sp.id)?.name || sp.name)]);
  for (const c of s.cameras) if (!c.auto) opts.push([`cam:${c.id}`, S.viewCam(c)]); // the room's auto cameraman = its auto: take above
  for (const p of participants(rp.tl)) opts.push([`pov:${p.id}`, S.viewPov(s.players.find((x) => x.id === p.id)?.name || p.name, s.players.some((x) => x.id === p.id))]);
  const key = JSON.stringify(opts); if (key === lastOptions) return; lastOptions = key;
  const sel = $('rp-view'); sel.innerHTML = '';
  for (const [v, label] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = label; sel.appendChild(o); }
  sel.value = rp.view; if (sel.value !== rp.view) sel.value = rp.speakers.length ? 'director' : 'free';
}
function setView(v) { rp.view = v || 'free'; rp.dirCam = null; $('rp-view').value = rp.view; cams.setHideAll(rp.view !== 'free'); apply(rp.t, 0, true); return rp.view; }
// Var ska kameran stå just nu? Svar: { p, yaw, pitch, fov, aspect, label } eller null (person inte här).
const roomBox = () => ({ minX: room.bounds.min.x, maxX: room.bounds.max.x, minZ: room.bounds.min.z, maxZ: room.bounds.max.z, maxY: room.bounds.max.y - 0.25 });
// The director (and the per-angle takes): a hard cut on every new shot, then the camera follows
// the speaker softly (they may walk or turn) instead of jerking with every step.
function directedPose(kind, speakerId, key) {
  const s = rp.snap, sp = speakerId ? s.players.find((x) => x.id === speakerId) : null;
  let want = null, label = '';
  if (kind !== 'room' && sp) { want = shotPose(kind, sp, roomBox(), { seed: key }); label = S.shotLabel(kind, sp.name); }
  if (!want) {
    // The room shot between speakers: the room's auto cameraman while it is on (no smoothing: it
    // moves smoothly by itself), otherwise the fixed high corner.
    // Several: they take turns, one per silence (shared/autocam.mjs roomShotCamera).
    const sp = rp.rc && rp.curShot ? roomShotCamera(rp.rc, rp.plan, rp.curShot) : null, q = sp && crewPose(sp.id);
    if (q) { rp.dirCam = null; rp.shot = { kind: 'room', speaker: null, key, camera: crewView(sp.id) }; return { ...q, aspect: '', label: `${S.shotLabel('room')} · ${S.crewLabel(sp.name, q.mm)}` }; }
    want = roomPose(roomBox()); label = S.shotLabel('room'); kind = 'room';
  }
  const c = rp.dirCam;
  if (!c || c.key !== key || c.kind !== kind) rp.dirCam = { key, kind, ...want, p: want.p.slice() };
  else {
    const k = 1 - Math.exp(-rp.dirDt * 3);
    for (let i = 0; i < 3; i++) c.p[i] += (want.p[i] - c.p[i]) * k;
    c.yaw += Math.atan2(Math.sin(want.yaw - c.yaw), Math.cos(want.yaw - c.yaw)) * k; c.pitch += (want.pitch - c.pitch) * k; c.fov = want.fov;
  }
  rp.shot = { kind, speaker: kind === 'room' ? null : speakerId, key, camera: kind === 'room' ? 'room' : `${kind}:${speakerId}` };
  return { p: rp.dirCam.p, yaw: rp.dirCam.yaw, pitch: rp.dirCam.pitch, fov: rp.dirCam.fov, aspect: '', label };
}
function viewPose() {
  const s = rp.snap;
  rp.shot = null; rp.curShot = null;
  if (rp.view === 'director' && rp.plan) {
    const sh = shotAt(rp.plan, rp.t); rp.curShot = sh;
    return directedPose(sh ? sh.kind : 'room', sh ? sh.speaker : null, sh ? `${sh.from}` : 'room');
  }
  const m = /^(close|medium|rear):(.+)$/.exec(rp.view);
  if (m) return directedPose(m[1], m[2], rp.view);
  const cm = /^autocam:(\w+)$/.exec(rp.view);
  if (cm) { const q = crewPose(cm[1]), sp = crewSpan(cm[1]); if (q) { rp.shot = { kind: 'auto', speaker: null, key: rp.view, camera: rp.view }; return { ...q, aspect: '', label: S.crewLabel(sp.name, q.mm) }; } return null; }
  const am = /^auto:(\w+)$/.exec(rp.view), aq = am && autoPose(am[1]);
  if (aq) { rp.shot = { kind: 'auto', speaker: null, key: rp.view, camera: rp.view }; return { ...aq, aspect: '', label: S.autoLabel(am[1], aq.mm) }; }
  if (rp.view.startsWith('cam:')) {
    const c = s.cameras.find((x) => x.id === rp.view.slice(4));
    if (c) return { p: c.p, yaw: c.yaw, pitch: c.pitch, fov: c.fov, aspect: c.aspect || '', label: c.name };
  } else if (rp.view.startsWith('pov:')) {
    const p = s.players.find((x) => x.id === rp.view.slice(4));
    if (p) return { p: p.p, yaw: p.y, pitch: p.pi, fov: EYE_FOV, aspect: '', label: S.povLabel(p.name) };
  }
  return null;
}

// ---------- Knappar ----------
$('rp-play').onclick = () => (rp.playing ? pause() : play());
$('rp-seek').oninput = (e) => seek(Number(e.target.value));
$('rp-speed').onchange = (e) => { rp.speed = Number(e.target.value) || 1; };
$('rp-view').onchange = (e) => setView(e.target.value);
$('rp-video').onclick = () => (rp.recorder || rp.composing ? stopVideo() : startVideo());
// 📷 Photo (button or P): a still of the view you are watching right now – director, a speaker
// angle, an auto cameraman, a placed camera, someone's eyes or the free camera – in that view's
// own frame (9:16 stays 9:16), ≥ 1920 px wide, without the player UI. Saved like a live photo.
let photoBusy = null, audio = null;
function snapPhoto() {
  if (photoBusy || !rp.tl) return photoBusy;
  photoBusy = (async () => {
    const pose = rp.view === 'free' ? null : viewPose();
    if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { audio = null; } }
    photo.flash(); photo.shutter(audio);
    if (pose) { poseCamera(view, pose); view.fov = pose.fov; view.updateProjectionMatrix(); }
    await entitlementsReady;
    const shot = await photo.capture({ THREE, renderer, scene, camera: pose ? view : camera, aspect: pose ? aspectRatio(pose.aspect) : null, free: !entitlements.full.cleanVideo,
      hide: () => { cams.setHideAll(true); return () => cams.setHideAll(rp.view !== 'free'); } });
    const name = photo.photoName(ROOM);
    photo.download(shot.blob, name);
    rp.lastPhoto = { name, w: shot.w, h: shot.h, bytes: shot.blob.size, view: rp.view, upload: null, error: null };
    try { const j = await photo.upload(shot.blob, { room: ROOM, source: 'replay', recId: REC, view: rp.view }); rp.lastPhoto.upload = j; toast(S.photoSaved(j.shareUrl), 4000); }
    catch (err) { rp.lastPhoto.error = err.message; toast(S.photoFailed(err.message), 4000); }
    return rp.lastPhoto;
  })().finally(() => { photoBusy = null; });
  return photoBusy;
}
$('rp-photo').onclick = () => snapPhoto();
function play() { if (rp.t >= rp.tl.duration) rp.t = 0; rp.playing = true; $('rp-play').textContent = '⏸'; $('rp-play').title = S.pause; }
function pause() { rp.playing = false; $('rp-play').textContent = '▶'; $('rp-play').title = S.play; }
function seek(t) { rp.t = Math.max(0, Math.min(rp.tl.duration, t)); apply(rp.t, 0, true); return rp.t; }
addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, select, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); rp.playing ? pause() : play(); }
  if (e.code === 'ArrowRight') seek(rp.t + 5000);
  if (e.code === 'ArrowLeft') seek(rp.t - 5000);
  if (e.code === 'Escape' && rp.view !== 'free') setView('free');
  if (e.code === 'KeyP' && !e.repeat) snapPhoto(); // 📷 Photo
});
// Fri kamera: dra med musen eller fingret för att titta.
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => { if (!drag || rp.view !== 'free') return; controls.look((e.clientX - drag.x) * 0.005, (e.clientY - drag.y) * 0.005); drag = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', () => { drag = null; });

// ---------- Spela in video: logo intro + the replay (+ bug and ticker in the free version) ----------
// videocomposer.js draws everything into one recording canvas; after recording the video is
// uploaded (videos/<room>/<id>) and you get a link (/v/<id>) to copy or have emailed.
function startVideo() {
  if (rp.recorder || rp.composing) return false;
  if (!canRecordVideo() || !rp.tl) { toast(S.noVideo); return false; }
  rp.composing = true;
  pause(); seek(0);
  $('rp-video').textContent = S.stopVideo; $('rp-video').classList.add('on');
  setShare(null);
  rp.videoReady = (async () => {
    try {
      await entitlementsReady;
      const comp = await createComposer({ source: canvas, free: !entitlements.full.cleanVideo, onIntroEnd: () => { seek(0); play(); } });
      rp.recorder = comp;
      await comp.start(rp.tl.duration / rp.speed);
      return true;
    } catch (err) {
      rp.recorder = null; $('rp-video').textContent = S.recordVideo; $('rp-video').classList.remove('on');
      toast(S.videoFailed, 4000); console.error(err); return false;
    } finally { rp.composing = false; }
  })();
  rp.videoDone = rp.videoReady.then((ok) => (ok ? new Promise((resolve) => { rp.resolveVideo = resolve; }) : null));
  return rp.videoReady;
}
async function stopVideo() {
  if (rp.composing) await rp.videoReady;
  const comp = rp.recorder;
  if (!comp) return rp.videoDone || null; // redan stoppad (t.ex. när uppspelningen tog slut)
  rp.recorder = null;
  $('rp-video').textContent = S.recordVideo; $('rp-video').classList.remove('on');
  pause();
  const blob = await comp.stop();
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const a = $('rp-download'); a.href = URL.createObjectURL(blob); a.download = `slapandtalk-${ROOM}-${REC}.${ext}`; a.hidden = false;
  a.textContent = S.downloadVideo((blob.size / 1e6).toFixed(1));
  rp.lastVideo = { blob, aspect: comp.state.aspect, durationMs: Math.round(rp.t / (rp.speed || 1)) + 2800, probe: { ...comp.state, bugCanvas: undefined } };
  rp.upload = uploadVideo(rp.lastVideo);
  if (rp.resolveVideo) rp.resolveVideo(blob);
  return blob;
}

// ---------- Upload, link, email ----------
let videoCfg = null;
const loadVideoCfg = () => (videoCfg ||= fetch('/api/videos/config').then((r) => r.json()).catch(() => ({ email: false, retentionDays: 30, maxMB: 80 })));
function setShare(state) {
  const box = $('rp-share');
  if (!state) { box.hidden = true; return; }
  box.hidden = false;
  $('rp-share-status').textContent = state.status || '';
  $('rp-share-link-row').hidden = !state.url;
  if (state.url) { $('rp-share-link').value = state.url; $('rp-share-open').href = state.url; }
  $('rp-email-form').hidden = !(state.url && state.email);
  $('rp-share-note').textContent = state.note || '';
}
function uploadVideo({ blob, aspect, durationMs }) {
  return loadVideoCfg().then((cfg) => new Promise((resolve) => {
    if (blob.size > cfg.maxMB * 1024 * 1024) { setShare({ status: S.videoTooBig(cfg.maxMB) }); return resolve(null); }
    setShare({ status: S.videoUploading(0) });
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/rooms/${ROOM}/recordings/${REC}/videos?aspect=${encodeURIComponent(aspect)}&durationMs=${durationMs}`);
    xhr.setRequestHeader('Content-Type', blob.type || 'video/webm');
    for (const [k, v] of Object.entries(unlockHeaders())) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setShare({ status: S.videoUploading(Math.round((e.loaded / e.total) * 100)) }); };
    xhr.onload = () => {
      let j = {}; try { j = JSON.parse(xhr.responseText); } catch { /* ok */ }
      if (xhr.status !== 200 || !j.video) { setShare({ status: j.error || S.videoUploadFailed }); return resolve(null); }
      rp.video = j.video;
      setShare({ status: S.videoSaved, url: j.watchUrl, email: !!j.email, note: j.email ? S.videoKept(cfg.retentionDays) : S.videoSaveLink(cfg.retentionDays) });
      resolve(j);
    };
    xhr.onerror = () => { setShare({ status: S.videoUploadFailed }); resolve(null); };
    xhr.send(blob);
  }));
}
$('rp-share-copy').onclick = async () => {
  const v = $('rp-share-link').value;
  try { await navigator.clipboard.writeText(v); toast(S.linkCopied); } catch { $('rp-share-link').select(); document.execCommand?.('copy'); toast(S.linkCopied); }
};
$('rp-email-form').onsubmit = async (e) => {
  e.preventDefault();
  const input = $('rp-email'), btn = $('rp-email-send');
  if (!rp.video) return;
  btn.disabled = true;
  try {
    const res = await fetch(`/api/videos/${rp.video.id}/email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: input.value }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || S.videoEmailFailed);
    input.value = ''; // the address is not kept, here either
    $('rp-email-status').textContent = S.videoEmailed;
  } catch (err) { $('rp-email-status').textContent = err.message; } finally { btn.disabled = false; }
};

let toastTimer;
function toast(msg, ms = 2500) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms); }

// ---------- Huvudloopen ----------
const clock = new THREE.Clock();
function frame() {
  const raw = clock.getDelta(), dt = Math.min(raw, 0.1);
  if (rp.tl) {
    if (rp.playing) {
      // Uppspelningen följer klockan även om datorn bara orkar få bilder per sekund.
      rp.t = Math.min(rp.tl.duration, rp.t + Math.min(raw, 1) * 1000 * rp.speed);
      if (rp.t >= rp.tl.duration) { pause(); if (rp.recorder && rp.recorder.state.phase === 'replay') stopVideo(); }
    }
    apply(rp.t, rp.playing ? dt * rp.speed : dt);
    rp.dirDt = dt;
    const pose = viewPose();
    // Close-up and over-the-shoulder: the speaker's own name tag and speaking mark would sit
    // right in the lens, so they are hidden for that shot.
    for (const [id, a] of avatars) {
      const hide = !!(rp.shot && rp.shot.speaker === id && rp.shot.kind !== 'medium');
      if (a.avatar.tag) a.avatar.tag.visible = !hide;
      if (a.avatar.talk && hide) a.avatar.talk.visible = false;
    }
    $('rp-viewlabel').textContent = pose ? pose.label : (rp.view === 'free' ? '' : S.notHereNow);
    // The room's own auto cameraman walks its path in the picture too (seen from the other views).
    for (const c of rp.snap.cameras) if (c.auto) { const q = crewPose(c.id); if (q) cams.place(c.id, q); }
    cams.update(pose ? null : camera.position);
    if (pose) { poseCamera(view, pose); view.fov = pose.fov; renderFramed(renderer, scene, view, pose.aspect); } else {
      controls.update(dt); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
      view.position.copy(camera.position); view.quaternion.copy(camera.quaternion); view.fov = EYE_FOV; view.aspect = camera.aspect;
      renderer.render(scene, camera);
    }
    if (rp.recorder) rp.recorder.frame(); // the finished video: copy this frame right after it was drawn
  } else renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

async function load() {
  try {
    if (!REC) throw new Error(S.replayNone);
    const [metaRes, logRes] = await Promise.all([fetch(`/api/rooms/${ROOM}/recordings/${REC}`), fetch(`/api/rooms/${ROOM}/recordings/${REC}/log`)]);
    if (!logRes.ok) throw new Error(logRes.status === 404 ? S.replayMissing : S.replayError(logRes.status));
    rp.meta = metaRes.ok ? await metaRes.json() : null;
    const rec = parseRecording(await logRes.text());
    rp.tl = buildTimeline(rec);
    rp.loading = new Set();
    // The auto-director's cut (the same as the shot list the server saved with the recording).
    rp.plan = planShots(rp.tl);
    const targets = stickerTargets(rp.tl);
    for (const p of AUTO_PATHS) rp.auto.set(p, createAutoCam({ path: p, seed: `${REC}:${p}`, provider: targets }));
    rp.rc = recordingCrew(rp.tl, { seed: REC, provider: targets });
    const segs = speechSegments(rp.tl);
    rp.speakers = participants(rp.tl).filter((p) => segs.some((x) => x.speaker === p.id));
    if (rp.speakers.length) { rp.view = 'director'; cams.setHideAll(true); }
    else if (rp.rc.ids.length) { rp.view = crewView(rp.rc.ids[0]); cams.setHideAll(true); }
    const sl = $('rp-shots'); sl.href = `/api/rooms/${ROOM}/recordings/${REC}/shots`; sl.download = `slapandtalk-${ROOM}-${REC}-shots.json`; sl.hidden = false;
    const when = new Date(rec.header.startedAt).toLocaleString(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });
    $('rp-title').textContent = S.replayTitle(ROOM, when, fmt(rp.tl.duration), rp.meta?.status === 'recording');
    $('rp-seek').max = String(Math.max(1, Math.round(rp.tl.duration)));
    if (!model) model = await loadAvatarModel().catch(() => null);
    seek(0);
    window.replay.ready = true;
  } catch (err) { $('rp-title').textContent = S.replayFailed(err.message); toast(err.message, 6000); window.replay.error = err.message; }
}
frame();
load();

// För tester (och nyfikna i konsolen).
window.replay = {
  ready: false, room: ROOM, recId: REC, scene, renderer, peelLayer,
  get duration() { return rp.tl?.duration || 0; }, get t() { return rp.t; }, get view() { return rp.view; }, get playing() { return rp.playing; },
  seek, play, pause, setView, setSpeed: (s) => { rp.speed = s; $('rp-speed').value = String(s); },
  views: () => [...$('rp-view').options].map((o) => o.value),
  state: () => ({
    t: rp.t, view: rp.view,
    players: [...avatars.entries()].map(([id, a]) => ({ id, name: a.avatar.name, pos: a.avatar.root.position.toArray().map((n) => +n.toFixed(3)), yaw: +(a.avatar.root.rotation.y - Math.PI).toFixed(3), visible: a.avatar.root.visible })),
    stamps: [...stamps.meshes.keys()].sort(), loading: rp.loading ? rp.loading.size : 0,
    peels: (({ on, count, landed, falling, groups }) => ({ on, count, landed, falling, groups, visible: peelLayer.root.visible }))(peelLayer.info()),
    cameras: cams.list().map((c) => c.id), camerasVisible: [...cams.map.values()].some((e) => e.obj.visible),
    eye: { p: view.position.toArray().map((n) => +n.toFixed(3)), q: view.quaternion.toArray().map((n) => +n.toFixed(3)), fov: view.fov, aspect: +view.aspect.toFixed(3) },
    chat: [...document.querySelectorAll('#rp-chat li')].map((l) => l.textContent),
    shot: rp.shot, mouths: Object.fromEntries([...avatars.entries()].map(([id, a]) => [id, a.avatar.mouthInfo])),
    speaking: [...avatars.entries()].filter(([, a]) => a.avatar.speaking).map(([id]) => id),
  }),
  plan: () => rp.plan, speakers: () => rp.speakers.slice(),
  autoPose: (path, t) => autoPose(path, t), crewPose: (id, t) => crewPose(id, t), crewIds: () => (rp.rc ? rp.rc.ids.slice() : []),
  startVideo, stopVideo, photo: () => snapPhoto(), lastPhoto: () => rp.lastPhoto || null,
  // Finished video (tests): the composer's state, the recording canvas, the upload result.
  composer: () => rp.recorder, lastVideo: () => rp.lastVideo || null, upload: () => rp.upload || null, video: () => rp.video || null,
};

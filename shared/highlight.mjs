// Highlight reel (automatic cameraman): detect visit moments, cross-camera cameos, and assemble
// a short downloadable collage. Pure maths (no Three.js / browser) so unit tests and the client
// share the same rules. Builds on autocam ideas (shared/autocam.mjs): three virtual cameras
// (front / side / overhead) cover the room or city; clips reconstruct shots from recorded state.
//
// Clip kinds (priority high → low when capped to ~60 s):
//   homage   – I placed a sticker next to one or more OTHER players' stickers
//   draw     – I sat down and opened the drawing tool (close-up)
//   voice    – someone talked long enough (VAD / talk level); front cam dollies in
//   cross    – our player is in another player's / another camera's shot (frustum + distance)
//   showcase – a look at a sticker image I made (each sticker id ≤ once in the reel)
//
// Raw footage is kept only until the reel is assembled/downloaded, then discarded (see
// client/src/highlightstore.js). This module never keeps blobs – only event maths.
import { roomBounds } from './autocam.mjs';
import { CITY } from './city.mjs';

export const REEL = Object.freeze({
  maxSec: 60,
  homageDur: 4.5,
  drawDur: 3.5,
  voiceDur: 3.0,
  crossDur: 3.2,
  showcaseDur: 2.5,
  adjacentM: 0.85,
  voiceMinMs: 800,
  voiceGapMs: 2800,
  drawGapMs: 12000,
  crossGapMs: 4000,
  maxHomage: 8,
  maxDraw: 4,
  maxVoice: 6,
  maxCross: 6,
  maxShowcase: 6,
  crossMaxDist: 9,
  crossMinDist: 0.6,
  crossFovDeg: 60,
  crossAspect: 16 / 9,
  priority: Object.freeze({ homage: 5, draw: 4, voice: 3, cross: 3, showcase: 1 }),
  cams: Object.freeze(['front', 'side', 'overhead']),
  dollyM: 1.6,
  closeM: 1.35,
  showcaseM: 1.8,
  homageM: 2.2,
});

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hypot3 = (a, b) => Math.hypot((a[0] || 0) - (b[0] || 0), (a[1] || 0) - (b[1] || 0), (a[2] || 0) - (b[2] || 0));

export function stickerGap(a, b) {
  if (!a?.p || !b?.p) return Infinity;
  const ra = Math.max(0.05, (Number(a.size) || 0.3) / 2);
  const rb = Math.max(0.05, (Number(b.size) || 0.3) / 2);
  return hypot3(a.p, b.p) - ra - rb;
}

export function isAdjacent(a, b, thresh = REEL.adjacentM) {
  if (!a || !b || a.id === b.id) return false;
  return stickerGap(a, b) <= thresh;
}

export function findHomages(mine, others, { thresh = REEL.adjacentM } = {}) {
  const out = [];
  for (const s of mine || []) {
    const near = (others || []).filter((o) => o && o.id !== s.id && isAdjacent(s, o, thresh));
    if (near.length) out.push({ sticker: s, neighbours: near.map((n) => n.id), count: near.length });
  }
  return out;
}

// Is world point p inside the camera frustum and within distance? Optional light occlusion via blockers.
export function inFrame(cam, p, {
  fovDeg = REEL.crossFovDeg, aspect = REEL.crossAspect,
  minDist = REEL.crossMinDist, maxDist = REEL.crossMaxDist,
  blockers = null,
} = {}) {
  if (!cam?.p || !p) return null;
  const eye = cam.p;
  const dx = p[0] - eye[0], dy = p[1] - eye[1], dz = p[2] - eye[2];
  const dist = Math.hypot(dx, dy, dz);
  if (!(dist >= minDist && dist <= maxDist)) return null;
  const yaw = Number(cam.yaw) || 0, pitch = Number(cam.pitch) || 0;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const fx = -sy * cp, fy = sp, fz = -cy * cp;
  const rx = cy, ry = 0, rz = -sy;
  const ux = sy * sp, uy = cp, uz = cy * sp;
  const inv = 1 / dist;
  const lx = dx * inv, ly = dy * inv, lz = dz * inv;
  const z = lx * fx + ly * fy + lz * fz;
  if (z <= 0.05) return null;
  const x = lx * rx + ly * ry + lz * rz;
  const y = lx * ux + ly * uy + lz * uz;
  const vFov = (fovDeg * Math.PI) / 180;
  const halfH = Math.tan(vFov / 2), halfW = halfH * aspect;
  const ndcX = x / (z * halfW), ndcY = y / (z * halfH);
  if (Math.abs(ndcX) > 1 || Math.abs(ndcY) > 1) return null;
  if (Array.isArray(blockers)) {
    for (const b of blockers) {
      if (!b?.p) continue;
      const bx = b.p[0] - eye[0], by = b.p[1] - eye[1], bz = b.p[2] - eye[2];
      const bd = Math.hypot(bx, by, bz);
      if (!(bd > 0.2 && bd < dist - 0.25)) continue;
      const dot = (bx * dx + by * dy + bz * dz) / (bd * dist);
      if (dot > 0.97) return null;
    }
  }
  return { in: true, dist, ndcX, ndcY, z };
}

export function detectHighlights(events = [], { myId = 'me' } = {}) {
  const ev = (Array.isArray(events) ? events : [])
    .filter((e) => e && typeof e.e === 'string' && Number.isFinite(e.t))
    .slice()
    .sort((a, b) => a.t - b.t || String(a.e).localeCompare(String(b.e)));

  const others = [];
  const mine = [];
  const clips = [];
  const seenStick = new Set();
  let lastDraw = -Infinity;
  const lastVoiceAt = new Map();
  let lastCross = -Infinity;

  for (const e of ev) {
    if (e.e === 'other' && e.id && Array.isArray(e.p)) {
      if (!others.some((o) => o.id === e.id)) {
        others.push({ id: e.id, p: e.p.slice(), size: Number(e.size) || 0.3, by: e.by || 'other', imageId: e.imageId || null });
      }
      continue;
    }
    if (e.e === 'draw') {
      if (e.t - lastDraw < REEL.drawGapMs) continue;
      lastDraw = e.t;
      clips.push({
        kind: 'draw', t: e.t, dur: REEL.drawDur, cam: 'side',
        subject: { kind: 'player', id: e.playerId || myId, p: Array.isArray(e.p) ? e.p.slice() : [0, 1.2, 0] },
      });
      continue;
    }
    if (e.e === 'voice') {
      const who = e.playerId || myId;
      const prev = lastVoiceAt.get(who) ?? -Infinity;
      if (e.t - prev < REEL.voiceGapMs) continue;
      lastVoiceAt.set(who, e.t);
      clips.push({
        kind: 'voice', t: e.t, dur: REEL.voiceDur, cam: 'front', motion: 'dolly',
        subject: { kind: 'player', id: who, p: Array.isArray(e.p) ? e.p.slice() : [0, 1.55, 0], level: Number(e.level) || 0 },
      });
      continue;
    }
    if (e.e === 'cross') {
      if (e.playerId && e.playerId !== myId && e.playerId !== 'me') continue;
      if (e.t - lastCross < REEL.crossGapMs) continue;
      lastCross = e.t;
      clips.push({
        kind: 'cross', t: e.t, dur: REEL.crossDur, cam: e.cam || 'front',
        by: e.by || null,
        subject: { kind: 'player', id: myId, p: Array.isArray(e.p) ? e.p.slice() : [0, 1.5, 0] },
        camPose: e.camPose || null,
        background: true,
      });
      continue;
    }
    if (e.e === 'stick' && e.id && Array.isArray(e.p)) {
      if (seenStick.has(e.id)) continue;
      seenStick.add(e.id);
      const st = {
        id: e.id, p: e.p.slice(), size: Number(e.size) || 0.3, by: e.by || myId,
        imageId: e.imageId || null, url: e.url || '', aspect: Number(e.aspect) > 0 ? Number(e.aspect) : 1,
        surface: e.surface || null, normal: Array.isArray(e.normal) ? e.normal.slice() : null,
      };
      mine.push(st);
      const near = others.filter((o) => isAdjacent(st, o));
      if (near.length) {
        clips.push({
          kind: 'homage', t: e.t, dur: REEL.homageDur, cam: 'overhead',
          stickerId: st.id, imageId: st.imageId, url: st.url, aspect: st.aspect,
          subject: { kind: 'sticker', id: st.id, p: st.p.slice(), size: st.size, normal: st.normal },
          neighbours: near.map((n) => n.id),
        });
      } else if (st.url || st.imageId) {
        clips.push({
          kind: 'showcase', t: e.t, dur: REEL.showcaseDur, cam: 'front',
          stickerId: st.id, imageId: st.imageId, url: st.url, aspect: st.aspect,
          subject: { kind: 'sticker', id: st.id, p: st.p.slice(), size: st.size, normal: st.normal },
        });
      }
    }
  }
  return clips;
}

export function findCrossCameraMoments({
  myPos, myId = 'me', othersActions = [], cameras = [], blockers = [],
  t = 0, fovDeg, aspect,
} = {}) {
  if (!Array.isArray(myPos) || !cameras.length) return [];
  const out = [];
  for (const cam of cameras) {
    const hit = inFrame(cam, myPos, { fovDeg, aspect, blockers });
    if (!hit) continue;
    const act = (othersActions || []).find((a) => a && a.by && a.by !== myId && a.by !== 'me') || null;
    out.push({
      t: act?.t ?? t, e: 'cross', cam: cam.role || cam.key || 'front',
      playerId: myId, p: myPos.slice(), by: act?.by || null,
      camPose: { p: cam.p.slice(), yaw: cam.yaw || 0, pitch: cam.pitch || 0, fov: cam.fov || fovDeg || REEL.crossFovDeg },
      dist: hit.dist,
    });
  }
  return out;
}

export function detectFromStamps(mine, others, { t = 0 } = {}) {
  const clips = [];
  const used = new Set();
  for (const h of findHomages(mine, others)) {
    used.add(h.sticker.id);
    clips.push({
      kind: 'homage', t, dur: REEL.homageDur, cam: 'overhead',
      stickerId: h.sticker.id, imageId: h.sticker.imageId || null, url: h.sticker.url || '',
      aspect: Number(h.sticker.aspect) > 0 ? Number(h.sticker.aspect) : 1,
      subject: { kind: 'sticker', id: h.sticker.id, p: h.sticker.p.slice(), size: h.sticker.size, normal: h.sticker.normal || null },
      neighbours: h.neighbours,
    });
  }
  for (const s of mine || []) {
    if (used.has(s.id) || !(s.url || s.imageId)) continue;
    clips.push({
      kind: 'showcase', t, dur: REEL.showcaseDur, cam: 'front',
      stickerId: s.id, imageId: s.imageId || null, url: s.url || '',
      aspect: Number(s.aspect) > 0 ? Number(s.aspect) : 1,
      subject: { kind: 'sticker', id: s.id, p: s.p.slice(), size: s.size, normal: s.normal || null },
    });
  }
  return clips;
}

function pickEven(list, n) {
  if (list.length <= n) return list.slice();
  if (n <= 0) return [];
  if (n === 1) return [list[list.length - 1]];
  return Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1))]);
}

export function assembleReel(raw = [], { maxSec = REEL.maxSec } = {}) {
  const byKind = { homage: [], draw: [], voice: [], cross: [], showcase: [] };
  for (const c of raw || []) if (c && byKind[c.kind]) byKind[c.kind].push(c);
  for (const k of Object.keys(byKind)) byKind[k].sort((a, b) => a.t - b.t);
  byKind.homage = pickEven(byKind.homage, REEL.maxHomage);
  byKind.draw = pickEven(byKind.draw, REEL.maxDraw);
  byKind.voice = pickEven(byKind.voice, REEL.maxVoice);
  byKind.cross = pickEven(byKind.cross, REEL.maxCross);
  byKind.showcase = pickEven(byKind.showcase, REEL.maxShowcase);

  const stickerTaken = new Set();
  const ordered = [];
  for (const k of ['homage', 'draw', 'voice', 'cross', 'showcase']) {
    for (const c of byKind[k]) {
      if (c.stickerId) {
        if (stickerTaken.has(c.stickerId)) continue;
        stickerTaken.add(c.stickerId);
      }
      const camDefault = k === 'homage' ? 'overhead' : k === 'draw' ? 'side' : 'front';
      ordered.push({
        ...c,
        cam: c.cam || camDefault,
        dur: Number(c.dur) > 0 ? Number(c.dur) : REEL[`${k}Dur`] || 2.5,
      });
    }
  }
  ordered.sort((a, b) => a.t - b.t || ((REEL.priority[b.kind] || 0) - (REEL.priority[a.kind] || 0)));
  let total = ordered.reduce((a, c) => a + c.dur, 0);
  if (total > maxSec) {
    const drop = ordered
      .map((c, i) => ({ i, pri: REEL.priority[c.kind] || 0, t: c.t }))
      .sort((a, b) => a.pri - b.pri || b.t - a.t);
    const keep = new Set(ordered.keys());
    for (const d of drop) {
      if (total <= maxSec) break;
      if (!keep.has(d.i)) continue;
      total -= ordered[d.i].dur;
      keep.delete(d.i);
    }
    const kept = ordered.filter((_, i) => keep.has(i));
    ordered.length = 0;
    ordered.push(...kept);
  }
  ordered.sort((a, b) => a.t - b.t || ((REEL.priority[b.kind] || 0) - (REEL.priority[a.kind] || 0)));
  let t0 = 0;
  const clips = ordered.map((c) => {
    const out = { ...c, t0: +t0.toFixed(3) };
    t0 += c.dur;
    return out;
  });
  return { clips, length: +t0.toFixed(3), kinds: clips.map((c) => c.kind), hasAudio: true };
}

export function sceneAt(plan, t) {
  const L = plan?.clips || [];
  if (!L.length) return null;
  const tt = Math.max(0, Math.min(t, (plan.length || 0) - 1e-6));
  let i = L.length - 1;
  while (i > 0 && L[i].t0 > tt) i--;
  const s = L[i];
  return { i, clip: s, local: tt - s.t0, u: Math.max(0, Math.min(1, (tt - s.t0) / Math.max(1e-6, s.dur))) };
}

export function reelCameras(bounds = roomBounds(), { focus = null, seed = 'reel', city = false } = {}) {
  const b = bounds;
  const cx = focus ? focus[0] : (b.minX + b.maxX) / 2;
  const cz = focus ? focus[1] : (b.minZ + b.maxZ) / 2;
  const spanX = city ? 12 : (b.maxX - b.minX);
  const spanZ = city ? 12 : (b.maxZ - b.minZ);
  const eye = city ? 2.4 : 1.6;
  // yaw 0 = look −Z (Three.js default); front stands on +Z looking at the centre, side on +X.
  return [
    { key: `${seed}:front`, role: 'front', path: 'pushin', seed: `${seed}:front`, start: [cx, cz + spanZ * 0.28], eye,
      p: [cx, eye, cz + spanZ * 0.32], yaw: 0, pitch: -0.08, fov: 55, look: [cx, 1.4, cz] },
    { key: `${seed}:side`, role: 'side', path: 'perimeter', seed: `${seed}:side`, start: [cx + spanX * 0.28, cz], eye,
      p: [cx + spanX * 0.32, eye, cz], yaw: Math.PI / 2, pitch: -0.1, fov: 55, look: [cx, 1.3, cz] },
    { key: `${seed}:overhead`, role: 'overhead', path: 'diagonal', seed: `${seed}:overhead`, start: [cx - spanX * 0.18, cz - spanZ * 0.18], eye: city ? 8 : 4.2,
      p: [cx, city ? 8 : 4.2, cz + spanZ * 0.15], yaw: 0, pitch: -1.1, fov: 60, look: [cx, 0.5, cz] },
  ];
}

export function cityBounds() {
  const hw = CITY.width / 2, hd = CITY.depth / 2;
  return { minX: -hw, maxX: hw, minZ: -hd, maxZ: hd, height: CITY.height };
}

export function clipPose(clip, localT = 0, { bounds = roomBounds() } = {}) {
  if (clip.kind === 'cross' && clip.camPose?.p) {
    const u = clamp(localT / Math.max(1e-6, clip.dur || 1), 0, 1);
    const ease = u * u * (3 - 2 * u);
    const base = clip.camPose;
    const look = Array.isArray(clip.subject?.p) ? clip.subject.p : base.look || [0, 1.5, 0];
    const p0 = base.p;
    const p = [p0[0] + (look[0] - p0[0]) * 0.12 * ease, p0[1], p0[2] + (look[2] - p0[2]) * 0.12 * ease];
    const dx = look[0] - p[0], dy = (look[1] || 1.5) - p[1], dz = look[2] - p[2];
    return { p, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), fov: base.fov || 55, look, cam: clip.cam || 'front' };
  }
  const u = clamp(localT / Math.max(1e-6, clip.dur || 1), 0, 1);
  const ease = u * u * (3 - 2 * u);
  const sub = clip.subject || { p: [0, 1.4, 0] };
  const target = Array.isArray(sub.p) ? sub.p.slice() : [0, 1.4, 0];
  if (sub.kind === 'sticker' && target.length === 3 && !(target[1] > 0.3)) target[1] = 1.2;
  const lookY = sub.kind === 'player' ? (target[1] || 1.45) : (target[1] || 1.2);
  const look = [target[0], lookY, target[2]];
  let dist, height, side = 0, fov = 50;
  if (clip.kind === 'draw' || clip.cam === 'side') { dist = REEL.closeM; height = lookY + 0.15; side = 0.55; fov = 42; }
  else if (clip.kind === 'voice' || (clip.cam === 'front' && clip.motion === 'dolly')) {
    const far = REEL.closeM + REEL.dollyM, near = REEL.closeM;
    dist = far + (near - far) * ease; height = lookY + 0.05; fov = 48 - 6 * ease;
  } else if (clip.kind === 'homage' || clip.cam === 'overhead') { dist = REEL.homageM; height = lookY + 2.4; side = 0.2; fov = 55; }
  else { dist = REEL.showcaseM; height = lookY + 0.25; fov = 45; }
  let nx = 0, nz = 1;
  if (Array.isArray(sub.normal) && Math.hypot(sub.normal[0], sub.normal[2]) > 0.2) {
    nx = sub.normal[0]; nz = sub.normal[2];
    const L = Math.hypot(nx, nz) || 1; nx /= L; nz /= L;
  } else {
    const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
    nx = cx - look[0]; nz = cz - look[2];
    const L = Math.hypot(nx, nz) || 1; nx /= L; nz /= L;
  }
  const tx = -nz, tz = nx;
  const p = [look[0] + nx * dist + tx * side, height, look[2] + nz * dist + tz * side];
  const g = 0.5;
  p[0] = clamp(p[0], bounds.minX + g, bounds.maxX - g);
  p[2] = clamp(p[2], bounds.minZ + g, bounds.maxZ - g);
  p[1] = clamp(p[1], 0.4, (bounds.height || 8) - 0.3);
  const dx = look[0] - p[0], dy = look[1] - p[1], dz = look[2] - p[2];
  return { p, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), fov: +fov.toFixed(2), look, cam: clip.cam || 'front' };
}

export function planFromLog(events, opts = {}) {
  return assembleReel(detectHighlights(events, opts), opts);
}

export function assertRawDiscarded(store) {
  const n = store && typeof store.count === 'function' ? store.count() : (store?.raw?.length ?? -1);
  return n === 0;
}

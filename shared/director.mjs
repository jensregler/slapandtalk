// The auto-director: who is talking when, and which shot the replay/video shows then.
// Pure JavaScript (no Three.js, no browser), deterministic: the same recording always gives the
// same cut. Used by the replay (client/src/replay.js), the server (the shot list saved with each
// recording, server/recorder.js) and the tests.
//
// Input: the 'talk' events in a recording ({ t, e: 'talk', id, l }), sent by each browser for its
// OWN microphone only while it is on and the person is actually talking (client/src/voice.js):
// a quantized loudness l = 0…15 at most ~12 times a second, and l = 0 when they stop. Never audio.
//
//   const segs = speechSegments(tl)        // [{ speaker, from, to, peak }]
//   const plan = planShots(tl)             // [{ from, to, kind, speaker }]  kind: room|close|medium|rear
//   shotAt(plan, t)                        // the shot at time t
//   shotPose(shot.kind, speakerPose, bounds, { seed })  // where the camera stands and looks
export const TALK_LEVELS = 15;
export const DIRECTOR = {
  talkOn: 2,          // l ≥ 2 counts as talking (1 = breath / noise floor)
  silenceMs: 650,     // a pause shorter than this does not end a stretch of speech
  minSpeechMs: 350,   // shorter blips are not speech (a cough, a click)
  talkHoldMs: 260,    // a talk sample is valid this long (they come ~every 80 ms)
  minShotMs: 2200,    // no cut before a shot has lasted this long (except the very first)
  maxShotMs: 5200,    // a long speech gets a new angle after ~3.6–5.2 s
  stealMs: 900,       // someone else must have talked this long before the camera leaves the current speaker
  holdMs: 1200,       // stay on the speaker this long after they stop, then go back to the room
  stepMs: 100,        // the planner's time step
  order: ['close', 'medium', 'close', 'rear'], // angles cycle in this order per speaker
};

// RMS from a microphone analyser (0…~0.5) → 0…15. sqrt: quiet speech still moves the mouth.
export function quantLevel(rms) {
  if (!(rms > 0)) return 0;
  return Math.max(0, Math.min(TALK_LEVELS, Math.round(Math.sqrt(Math.min(1, rms / 0.2)) * TALK_LEVELS)));
}
// 0…15 → how far the mouth opens (0…1).
export const openOf = (l) => Math.max(0, Math.min(1, (Number(l) || 0) / TALK_LEVELS));

// Talk samples per player from the timeline (buildTimeline in replay.mjs keeps them in pl.talk).
const lastAt = (list, t) => { let lo = 0, hi = list.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m].t <= t) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; };
// The level of one player at time t (0 if their last sample is stale).
export function talkAt(talk, t, holdMs = DIRECTOR.talkHoldMs) {
  if (!talk || !talk.length) return 0;
  const i = lastAt(talk, t); if (i < 0) return 0;
  return t - talk[i].t <= holdMs ? talk[i].l : 0;
}

// Stretches of speech per person: [{ speaker, from, to, peak }], sorted by from.
export function speechSegments(tl, o = {}) {
  const P = { ...DIRECTOR, ...o };
  const out = [];
  for (const pl of tl.players.values()) {
    let cur = null;
    for (const s of pl.talk || []) {
      if (s.l >= P.talkOn) {
        if (cur && s.t - cur.last <= P.silenceMs) { cur.last = s.t; cur.peak = Math.max(cur.peak, s.l); cur.sum += s.l; cur.n++; } else {
          if (cur) out.push(cur);
          cur = { speaker: pl.id, from: s.t, last: s.t, peak: s.l, sum: s.l, n: 1 };
        }
      }
    }
    if (cur) out.push(cur);
  }
  return out.map((s) => ({ speaker: s.speaker, from: s.from, to: s.last + P.talkHoldMs, peak: s.peak, mean: +(s.sum / s.n).toFixed(2) }))
    .filter((s) => s.to - s.from >= P.minSpeechMs)
    .sort((a, b) => a.from - b.from || String(a.speaker).localeCompare(String(b.speaker)));
}

// A small deterministic hash → 0…1 (so the same recording always cuts the same way).
export function hash01(...parts) {
  let h = 2166136261;
  for (const c of parts.join('|')) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// The cut: [{ from, to, kind, speaker }] covering 0…duration. kind 'room' = the wide room view.
// Rules: who talks gets the camera; the camera stays with the current speaker while they talk
// (someone else must talk ≥ stealMs while they are quiet to take it); a shot lasts at least
// minShotMs; a long speech changes angle (close → medium → close → rear …) after a seeded
// minShot…maxShot; after holdMs of silence the camera goes back to the room.
export function planShots(tl, o = {}) {
  const P = { ...DIRECTOR, ...o };
  const duration = Math.max(0, tl.duration || 0);
  const segs = speechSegments(tl, P);
  // t only grows in the loop below: one pointer per speaker into their own segments (an hour with
  // five talkative people stays cheap).
  const per = new Map(), ptr = new Map();
  for (const sg of segs) { if (!per.has(sg.speaker)) per.set(sg.speaker, []); per.get(sg.speaker).push(sg); }
  const talking = (id, t) => {
    const list = per.get(id); if (!list) return false;
    let i = ptr.get(id) || 0; while (i < list.length && list[i].to <= t) i++; ptr.set(id, i);
    return i < list.length && list[i].from <= t;
  };
  const shots = [];
  let cur = { from: 0, kind: 'room', speaker: null }, n = 0;
  const lastSpoke = new Map(), since = new Map(); // speaker -> last time talking / start of current stretch
  const angle = new Map(); // speaker -> index in order
  const cut = (t, kind, speaker) => {
    if (t > cur.from) shots.push({ from: cur.from, to: t, kind: cur.kind, speaker: cur.speaker });
    cur = { from: t, kind, speaker }; n++;
  };
  const nextAngle = (id) => { const i = angle.has(id) ? angle.get(id) + 1 : 0; angle.set(id, i); return P.order[i % P.order.length]; };
  const shotLen = (c) => P.minShotMs + 1400 + hash01(tl.header?.id || '', c.speaker, c.from) * (P.maxShotMs - P.minShotMs - 1400);
  for (let t = 0; t < duration; t += P.stepMs) {
    for (const pl of tl.players.keys()) {
      if (talking(pl, t)) { if (!since.has(pl) || t - lastSpoke.get(pl) > P.stepMs * 1.5) since.set(pl, t); lastSpoke.set(pl, t); }
    }
    const age = t - cur.from;
    const canCut = age >= P.minShotMs || (n === 0 && cur.kind === 'room');
    const curTalking = cur.speaker && talking(cur.speaker, t);
    // The best other speaker: talking now, longest in their current stretch.
    let best = null, bestLen = -1;
    for (const id of tl.players.keys()) {
      if (id === cur.speaker || !talking(id, t)) continue;
      const len = t - since.get(id);
      if (len > bestLen) { best = id; bestLen = len; }
    }
    if (!canCut) continue;
    if (cur.kind === 'room') {
      if (best !== null && bestLen >= P.stepMs) cut(t, nextAngle(best), best);
      continue;
    }
    const quiet = t - (lastSpoke.get(cur.speaker) ?? -Infinity);
    // Hysteresis: the camera leaves a quiet speaker for someone who has talked stealMs, or sooner
    // once the current speaker has really stopped (a pause longer than silenceMs).
    if (!curTalking && best !== null && (bestLen >= P.stealMs || (quiet >= P.silenceMs && bestLen >= 300))) { cut(t, nextAngle(best), best); continue; }
    if (!curTalking && t - (lastSpoke.get(cur.speaker) ?? -Infinity) >= P.holdMs) { cut(t, 'room', null); continue; }
    if (curTalking && age >= shotLen(cur)) cut(t, nextAngle(cur.speaker), cur.speaker);
  }
  if (duration > cur.from) shots.push({ from: cur.from, to: duration, kind: cur.kind, speaker: cur.speaker });
  // Neighbours with the same kind and speaker merge (can happen when an angle cycle wraps).
  const merged = [];
  for (const s of shots) { const p = merged[merged.length - 1]; if (p && p.kind === s.kind && p.speaker === s.speaker && p.to === s.from) p.to = s.to; else merged.push({ ...s }); }
  return merged;
}
export function shotAt(plan, t) {
  if (!plan || !plan.length) return null;
  let lo = 0, hi = plan.length - 1, ans = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (plan[m].from <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
  return plan[ans];
}

// ---------- Camera poses ----------
// speaker: { p: [x, eyeY, z], y: yaw } (as in the recording). bounds: { minX, maxX, minZ, maxZ, maxY }.
// Returns { p, yaw, pitch, fov } for poseCamera() (cameras.js). Forward at yaw y is (-sin y, -cos y).
export const HEAD_DROP = 0.06;   // the face centre is a little below the recorded eye height
export const SHOTS = {
  close: { dist: 0.78, side: 0.1, up: 0.02, fov: 38, at: 'face' },
  medium: { dist: 2.1, side: 0.75, up: -0.08, fov: 50, at: 'chest' },
  rear: { dist: -0.95, side: 0.38, up: 0.14, fov: 62, at: 'ahead' }, // over the shoulder: behind them, looking where they look
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function lookAtAngles(from, to) {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}
export function shotPose(kind, speaker, bounds, { seed = '' } = {}) {
  const S = SHOTS[kind]; if (!S || !speaker) return null;
  const [x, ey, z] = speaker.p, y = speaker.y || 0;
  const f = [-Math.sin(y), -Math.cos(y)], r = [Math.cos(y), -Math.sin(y)]; // forward, right (seen from above)
  const head = [x, ey - HEAD_DROP, z];
  const b = bounds || { minX: -4.7, maxX: 4.7, minZ: -4.7, maxZ: 4.7, maxY: 3.8 };
  // Which side: seeded per shot, but take the side with more room if one is blocked by a wall.
  const sides = hash01(seed, kind) < 0.5 ? [1, -1] : [-1, 1];
  let best = null;
  for (const sd of sides) {
    for (const k of [1, 0.8, 0.6, 0.45]) { // come closer if a wall is in the way
      const want = [x + f[0] * S.dist * k + r[0] * S.side * sd, ey - HEAD_DROP + S.up, z + f[1] * S.dist * k + r[1] * S.side * sd];
      const p = [clamp(want[0], b.minX, b.maxX), clamp(want[1], 0.4, b.maxY), clamp(want[2], b.minZ, b.maxZ)];
      const off = Math.hypot(p[0] - want[0], p[2] - want[2]);
      const score = off + (1 - k) * 0.3;
      if (!best || score < best.score) best = { p, score };
      if (off < 0.02) break;
    }
    if (best && best.score < 0.02) break;
  }
  const p = best.p.map((v) => +v.toFixed(4));
  const target = S.at === 'face' ? head : S.at === 'chest' ? [x, ey - 0.32, z] : [x + f[0] * 3, ey - 0.2, z + f[1] * 3];
  const { yaw, pitch } = lookAtAngles(p, target);
  return { p, yaw: +yaw.toFixed(4), pitch: +pitch.toFixed(4), fov: S.fov };
}
// The room view between speakers: a fixed wide shot from a high corner, looking at the middle.
export function roomPose(bounds) {
  const b = bounds || { minX: -4.7, maxX: 4.7, minZ: -4.7, maxZ: 4.7, maxY: 3.8 };
  const p = [+(b.maxX - 0.2).toFixed(3), +Math.min(2.7, b.maxY - 0.3).toFixed(3), +(b.maxZ - 0.2).toFixed(3)];
  const { yaw, pitch } = lookAtAngles(p, [(b.minX + b.maxX) / 2, 0.9, (b.minZ + b.maxZ) / 2]);
  return { p, yaw: +yaw.toFixed(4), pitch: +pitch.toFixed(4), fov: 68 };
}

// The shot list saved with a recording (recordings/<room>/<recId>.shots.json and
// GET /api/rooms/<room>/recordings/<recId>/shots): raw material for editing by hand.
// Times are ms from the recording start; a finished video adds the intro (introMs) in front.
export function shotList(tl, o = {}) {
  const names = new Map([...tl.players.values()].map((pl) => [pl.id, pl.looks[pl.looks.length - 1]?.name || pl.id]));
  const segs = speechSegments(tl, o), plan = planShots(tl, o);
  const P = { ...DIRECTOR, ...o };
  return {
    format: 'slapandtalk-shots', v: 1, recId: tl.header?.id || null, room: tl.header?.room || null,
    durationMs: tl.duration, introMs: o.introMs ?? 2800,
    speakers: [...new Set(segs.map((s) => s.speaker))].map((id) => ({ id, name: names.get(id) || id, talkMs: segs.filter((s) => s.speaker === id).reduce((a, s) => a + s.to - s.from, 0) })),
    speech: segs.map((s) => ({ ...s, name: names.get(s.speaker) || s.speaker })),
    shots: plan.map((s) => ({ ...s, name: s.speaker ? names.get(s.speaker) || s.speaker : null })),
    angles: Object.fromEntries(Object.entries(SHOTS).map(([k, v]) => [k, { distM: v.dist, fov: v.fov, aim: v.at }])),
    params: { minShotMs: P.minShotMs, maxShotMs: P.maxShotMs, stealMs: P.stealMs, holdMs: P.holdMs, silenceMs: P.silenceMs },
  };
}

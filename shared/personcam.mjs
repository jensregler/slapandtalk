// Person cameramen: one cameraman PER PARTICIPANT, each with that person as the subject the
// whole time (a separate, time-aligned track per person, so the review can cut to anyone).
// Pure JavaScript, no Three.js, deterministic: the same recording and seed give the same take,
// and any moment can be computed directly (seeking). Used by the replay (views 'person:<id>',
// client/src/replay.js), the server's shot list (withAutoCam → autocam.people) and the tests.
//
// What the cameraman does: a sequence of shots of a few seconds (seeded lengths). Each shot picks
// a distance (close-up / medium / wide = full body) and an angle around the person (front, 3/4,
// side, a little low or high), varied from shot to shot, and curious about what the person does:
// a slap or talking → closer shots and a small push-in, walking → a wider shot that pulls back.
// The camera follows the person (it is placed relative to where they are now), always aims at
// them (so they stay in frame, near the centre), drifts slowly around them during a shot and
// glides (eases) from one shot to the next. It never goes into a wall (the room box minus
// wallGap): if the wanted spot is outside it comes closer along the line to the person, and the
// lens widens so the framing still fits. Panning only happens because the person moves.
//
//   const cam = createPersonCam({ seed, subject, bounds })
//     subject = { at(t) → { p: [x, eyeY, z], y: yaw, talk: 0…15 } | null (not in the room),
//                 gestures: [{ t, kind }] (slaps/peels in time order, optional) }
//   cam.poseAt(t) → { p, yaw, pitch, fov, mm, shot: { kind, angle, from, to }, aim } | null
//   personSubjects(tl) → [{ id, name, spans, subject }]   (from shared/replay.mjs buildTimeline)
//   peopleFocus(tl) → { focusAt(t) } the whole group (for the room's own cameramen, autocam.mjs)
import ROOM from './room.json' with { type: 'json' };
import { hash01 } from './director.mjs';
import { poseAt as trackPose } from './replay.mjs';

export const PERSONCAM = {
  shotMs: [3500, 7000],  // shot lengths
  minShotMs: 1800,       // a shot cut short (the angle would get cornered by a wall) lasts at least this long
  blendMs: 1400,         // a glide from one shot to the next takes at least this long (smoothstep) …
  maxBlendMs: 3000,      // … and at most this long
  glideMps: 1.3,         // m/s the camera travels during a glide
  cutRad: 1.5,           // a new angle further round than this is a cut instead
  wallGap: 0.45,         // m from the walls
  minDist: 0.7,          // m never closer to the person than this
  // dist (m from the person), mm (lens), aim (m below the eyes), half (m of the person that must fit above/below the aim point)
  kinds: {
    close: { dist: 1.05, mm: 50, aim: 0.1, half: 0.32 },
    medium: { dist: 1.9, mm: 38, aim: 0.38, half: 0.62 },
    wide: { dist: 3.1, mm: 30, aim: 0.72, half: 1.0 },
  },
  // around the person, relative to the way they face (0 = straight in front)
  angles: [0, 0.75, -0.75, 1.4, -1.4, 0.35, -0.35],
  heights: [-0.3, 0, 0, 0.25, 0.45], // m camera above/below the aim point (a bit low … a bit high)
  orbit: 0.16,           // rad slow drift around the person over one shot
  push: 0.08,            // the camera comes this much closer over a shot (fraction)
  slapMs: 1600, talkMs: 900, smoothMs: 300,
  lookAheadMs: 700,
  followMs: 1200,        // the camera glides after where it wants to be over this long      // the room around the person is judged where they will be this much later
  sway: { pos: 0.008, yaw: 0.003, pitch: 0.0025 },
  mmRange: [22, 85],
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const r4 = (n) => Math.round(n * 1e4) / 1e4;
export const mmToFov = (mm) => +((2 * Math.atan(12 / mm) * 180) / Math.PI).toFixed(3);
export const personView = (id) => `person:${id}`;
function aim(from, to) {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), dist: Math.hypot(dx, dy, dz) };
}
const boundsOf = (room = ROOM) => ({ minX: -room.width / 2, maxX: room.width / 2, minZ: -room.depth / 2, maxZ: room.depth / 2, height: room.height });

export function createPersonCam({ seed = '', subject, bounds = boundsOf(), ...o } = {}) {
  const P = { ...PERSONCAM, ...o, kinds: { ...PERSONCAM.kinds, ...(o.kinds || {}) }, sway: { ...PERSONCAM.sway, ...(o.sway || {}) } };
  const lim = { minX: bounds.minX + P.wallGap, maxX: bounds.maxX - P.wallGap, minZ: bounds.minZ + P.wallGap, maxZ: bounds.maxZ - P.wallGap };
  const inside = (x, z) => x >= lim.minX && x <= lim.maxX && z >= lim.minZ && z <= lim.maxZ;
  const gest = (subject.gestures || []).filter((g) => g && Number.isFinite(g.t)).slice().sort((a, b) => a.t - b.t);
  const h = (...k) => hash01(seed, 'personcam', ...k);

  // The person, softened over a window of smoothMs centred on t (the whole recording is known, so the
  // softening adds no lag: a walking person stays in the middle of the frame, no jitter from the steps).
  function person(t) {
    const now = subject.at(t); if (!now) return null;
    let x = now.p[0], y = now.p[1], z = now.p[2], w = 1;
    for (let i = 1; i <= 3; i++) {
      const a = subject.at(t - (P.smoothMs * i) / 6), b = subject.at(t + (P.smoothMs * i) / 6);
      if (!a || !b) break; // symmetric only (near a join/leave/end: less softening, never a lag)
      const k = 1 - i / 4; x += (a.p[0] + b.p[0]) * k; y += (a.p[1] + b.p[1]) * k; z += (a.p[2] + b.p[2]) * k; w += 2 * k;
    }
    const back = subject.at(t - 400);
    const speed = back ? Math.hypot(now.p[0] - back.p[0], now.p[2] - back.p[2]) / 0.4 : 0;
    // facing, softened (the average of the directions over the last ~2.4 s): the camera's angle is
    // relative to it, so it swings round softly when they turn, never whips
    let sx = 0, sz = 0; for (let i = 0; i <= 12; i++) { const q = subject.at(t - i * 200); if (!q) break; const w = 1 - i / 13; sx += Math.sin(q.y) * w; sz += Math.cos(q.y) * w; }
    return { p: [x / w, y / w, z / w], y: Math.atan2(sx, sz), talk: now.talk || 0, speed };
  }
  // 0…1: how much is going on right now (smooth envelopes, pure functions of t)
  function slapEnv(t) {
    let lo = 0, hi = gest.length - 1, i = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (gest[m].t <= t) { i = m; lo = m + 1; } else hi = m - 1; }
    if (i < 0) return 0;
    const age = t - gest[i].t; if (age >= P.slapMs) return 0;
    return smooth(age / 250) * (1 - smooth((age - 600) / (P.slapMs - 600)));
  }
  function talkEnv(t) { let n = 0; for (let i = 0; i < 4; i++) { const q = subject.at(t - i * (P.talkMs / 4)); if (q && q.talk >= 2) n++; } return n / 4; }
  function walkEnv(t) { const s = person(t); return s ? smooth((s.speed - 0.25) / 0.6) : 0; }

  // ---------- The shots (in order, from what the person does at the shot's start) ----------
  // How much room a camera at azimuth az (world) and distance dist has around position p (0…1).
  const room = (p, az, dist) => { const f = [-Math.sin(az), -Math.cos(az)]; let k = 1; while (k > 0.1 && !inside(p[0] + f[0] * dist * k, p[2] + f[1] * dist * k)) k -= 0.025; return k; };
  const shots = [];
  function pickShot(j, t0, prev) {
    const s = person(t0);
    const busy = recentGesture(t0, 2500), talking = talkEnv(t0) > 0.4, walking = s && s.speed > 0.5;
    const names = ['close', 'medium', 'wide'];
    let w = walking ? [0.1, 0.35, 0.55] : busy ? [0.5, 0.4, 0.1] : talking ? [0.55, 0.35, 0.1] : [0.3, 0.42, 0.28];
    if (prev) w = w.map((x, i) => (names[i] === prev.kind ? x * 0.25 : x)); // vary
    const sum = w.reduce((a, b) => a + b, 0); let u = h('kind', j) * sum, kind = names[2];
    for (let i = 0; i < 3; i++) { if (u < w[i]) { kind = names[i]; break; } u -= w[i]; }
    const K = P.kinds[kind];
    let dur = lerp(P.shotMs[0], P.shotMs[1], h('len', j)) * (kind === 'close' ? 0.85 : 1) * (walking ? 0.7 : 1);
    // The angle around the person: a seeded order of the preset angles (not the previous one), but
    // judged over the whole shot – where the person will be (a recording knows) – so the camera
    // never ends up pinned against a wall: the angle whose spot keeps the most room wins.
    const start = Math.floor(h('angle', j) * P.angles.length);
    const order = P.angles.map((_, i) => P.angles[(start + i) % P.angles.length]).filter((a) => !prev || Math.abs(a - prev.angle) > 0.2);
    const yaw0 = s ? s.y : h('az', j) * Math.PI * 2;
    const drift = h('drift', j) < 0.5 ? -1 : 1;
    let pick = null;
    for (let c = 0; c < order.length; c++) {
      const az = yaw0 + order[c];
      let minRoom = 1, until = t0 + dur;
      for (let t = t0; t <= t0 + dur; t += 250) {
        const q = person(t); if (!q) continue;
        const u2 = (t - t0) / dur, r = room(q.p, q.y + order[c] + drift * P.orbit * (u2 - 0.5), K.dist * 1.1);
        if (r < 0.6 && t - t0 >= P.minShotMs) { until = t; break; } // this angle gets cornered here: the shot ends (a glide to a new one)
        minRoom = Math.min(minRoom, r);
      }
      const score = minRoom + 0.25 * Math.min(1, (until - t0) / dur) - c * 0.03;
      if (!pick || score > pick.score) pick = { angle: order[c], az, until, score };
    }
    return { j, from: t0, to: Math.max(t0 + P.minShotMs, pick.until), kind, angle: pick.angle, az: pick.az,
      height: P.heights[Math.floor(h('height', j) * P.heights.length)], drift };
  }
  function recentGesture(t, ms) { for (let i = gest.length - 1; i >= 0; i--) { if (gest[i].t > t) continue; return t - gest[i].t < ms ? 1 : 0; } return 0; }
  function shotAt(t) {
    if (!shots.length) shots.push(pickShot(0, 0, null));
    while (shots[shots.length - 1].to <= t && shots.length < 200000) { const L = shots[shots.length - 1]; shots.push(pickShot(shots.length, L.to, L)); }
    let lo = 0, hi = shots.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (shots[m].to <= t) lo = m + 1; else hi = m; }
    return lo;
  }
  // The shot at t, in polar form around the person: azimuth (slow orbit), distance (push-in,
  // curiosity), camera height, aim point.
  function shotPose(S, t, s) {
    const K = P.kinds[S.kind], u = clamp((t - S.from) / (S.to - S.from), 0, 1);
    const az = s.y + S.angle + S.drift * P.orbit * (u - 0.5);
    const curious = 1 - 0.2 * slapEnv(t) - 0.1 * talkEnv(t) + 0.22 * walkEnv(t);
    const dist = Math.max(P.minDist, K.dist * (1 - P.push * u) * curious);
    const target = [s.p[0], Math.max(0.5, s.p[1] - K.aim), s.p[2]];
    return { az, dist, y: target[1] + S.height * Math.min(1, dist / 1.5), target, kind: S.kind };
  }
  // A spot around the person: into a wall? come closer along the line to them (the lens widens).
  // The direction around the person with room for the camera, nearest the shot's own: a soft
  // (weighted) choice – a continuous function of where the person is, so when a wall comes the
  // camera glides around them instead of jumping.
  function roomyAz(az0, s, dist, side) {
    let sx = 0, cz = 0;
    // A detour only ever goes one way round (the shot's drift side, at most to straight behind them): choosing
    // left or right afresh every frame is what would make it flip.
    for (let i = -3; i <= 20; i++) {
      const off = side * (i / 20) * Math.PI, r = room(s.p, az0 + off, dist); // up to straight behind, the one way round
      const score = r - Math.abs(off) * 0.22; // coming a little closer (a wider lens) is preferred to a long way round
      const w = Math.exp((score - 1) / 0.08); sx += Math.sin(off) * w; cz += Math.cos(off) * w; // a mean of directions (an arc across ±π stays one arc)
    }
    return az0 + Math.atan2(sx, cz);
  }
  // A spot around the person: a wall in the way? go around them (roomyAz), and if still short of
  // room come closer along the line to them (the lens widens).
  function place(s, az, dist, y) {
    const k = room(s.p, az, dist);
    const d = Math.max(P.minDist, dist * k), f = [-Math.sin(az), -Math.cos(az)];
    return [clamp(s.p[0] + f[0] * d, lim.minX, lim.maxX), clamp(y, 0.35, bounds.height - 0.2), clamp(s.p[2] + f[1] * d, lim.minZ, lim.maxZ)];
  }
  // From shot i-1 to shot i: a glide around the person at a cameraman's pace (its length from the
  // distance the camera travels, blendMs … maxBlendMs), or a CUT when the new angle is far round
  // (an editor's cut, not a whip pan). Judged once, at the change.
  function glide(i) {
    const S = shots[i]; if (S.glide) return S.glide;
    const B = shots[i - 1], q = person(S.from);
    const d = Math.abs(wrap(S.angle - B.angle)), r = (P.kinds[S.kind].dist + P.kinds[B.kind].dist) / 2;
    const travel = d * r + Math.abs(P.kinds[S.kind].dist - P.kinds[B.kind].dist);
    const ms = clamp((travel / P.glideMps) * 1000, P.blendMs, P.maxBlendMs);
    S.glide = !q || d > P.cutRad || travel > P.glideMps * P.maxBlendMs / 1000 ? { cut: true, ms: 0 } : { cut: false, ms };
    return S.glide;
  }
  // The shot (glided from the previous one) at t, in polar form around the person.
  function polar(t) {
    const s = person(t); if (!s) return null;
    const i = shotAt(t), S = shots[i];
    let A = shotPose(S, t, s), b = 1;
    const G = i > 0 ? glide(i) : null;
    if (G && t - S.from < G.ms) {
      // glide around the person (azimuth, distance, height), not straight through them
      b = smooth((t - S.from) / G.ms);
      const B = shotPose(shots[i - 1], t, s);
      A = { az: B.az + wrap(A.az - B.az) * b, dist: lerp(B.dist, A.dist, b), y: lerp(B.y, A.y, b), target: B.target.map((v, d) => lerp(v, A.target[d], b)), kind: S.kind, prevKind: B.kind };
    }
    return { s, S, i, A, b, roomy: roomyAz(A.az, s, A.dist * 1.1, S.drift) };
  }
  function poseAt(t) {
    t = Math.max(0, t);
    const now = polar(t); if (!now) return null;
    const { s, S, b, i } = now, A = now.A;
    // around the walls: the roomy direction, softened over the last ~1.3 s (a glide, no flicker)
    let vx = 0, vz = 0;
    for (let n = 0; n < 10; n++) {
      const tn = t - n * 140; if (tn < 0) break;
      const W = n ? polar(tn) : now; if (!W || (W.i !== i && i > 0 && glide(i).cut)) break; // not across a cut
      const w = 1 - n / 10, d = W.roomy - W.A.az; // the detour, relative to the shot's own direction then
      vx += Math.sin(d) * w; vz += Math.cos(d) * w;
    }
    const q = place(s, A.az + Math.atan2(vx, vz), A.dist, A.y);
    const ts = t / 1000, W = P.sway, sw = h('sway') * 6.283;
    const p = [clamp(q[0] + W.pos * Math.sin(ts * 1.6 + sw), lim.minX, lim.maxX), q[1] + W.pos * 0.6 * Math.sin(ts * 1.2 + sw * 2), clamp(q[2] + W.pos * Math.sin(ts * 1.4 + sw * 3), lim.minZ, lim.maxZ)];
    // Squeezed by a wall (the camera had to come close): frame less of them – the aim slides up
    // to the face, so the person is still in the picture (a forced close-up), never cut off.
    const sp = s.p, dh = Math.hypot(p[0] - sp[0], p[2] - sp[2]), fits = ((12 / P.mmRange[0]) * dh) / 1.15;
    const want = P.kinds[A.kind], KC = P.kinds.close;
    const wantHalf = A.prevKind ? lerp(P.kinds[A.prevKind].half, want.half, b) : want.half;
    const wantAim = sp[1] - A.target[1];
    if (fits < wantHalf) {
      const k = clamp((fits - KC.half) / Math.max(1e-6, wantHalf - KC.half), 0, 1);
      A.target = [A.target[0], Math.max(A.target[1], sp[1] - lerp(KC.aim, wantAim, k)), A.target[2]];
    }
    const a = aim(p, A.target);
    // the lens: the shot's own, wider if the person would not fit (a wall made the camera come closer)
    // (during a glide: the two shots' framing blended – the aim and how much of them must fit)
    const KP = A.prevKind ? P.kinds[A.prevKind] : want;
    const half = Math.min(lerp(KP.half, want.half, b), Math.max(KC.half, fits)), baseMm = lerp(KP.mm, want.mm, b);
    const mm = clamp(Math.min(baseMm, (12 * Math.max(0.3, a.dist)) / (half * 1.15)), P.mmRange[0], P.mmRange[1]);
    const yaw = wrap(a.yaw + W.yaw * Math.sin(ts * 0.9 + sw));
    const pitch = a.pitch + W.pitch * Math.sin(ts * 1.1 + sw);
    return { p: p.map(r4), yaw: r4(yaw), pitch: r4(pitch), fov: mmToFov(mm), mm: +mm.toFixed(2), aim: A.target.map(r4), shot: { kind: S.kind, angle: S.angle, from: Math.round(S.from), to: Math.round(S.to), cut: i > 0 && glide(i).cut, glideMs: i > 0 ? glide(i).ms : 0 } };
  }
  return {
    poseAt, params: P,
    shotsUntil(duration) { shotAt(duration); return shots.filter((x) => x.from < duration).map((x) => ({ from: Math.round(x.from), to: Math.round(x.to), kind: x.kind, angle: x.angle })); },
    track(duration, stepMs = 1000, on = () => true) { const out = []; for (let t = 0; t <= duration; t += stepMs) { if (!on(t)) continue; const q = poseAt(t); if (q) out.push([Math.round(t), ...q.p, q.yaw, q.pitch, q.mm]); } return out; },
  };
}

// ---------- From a recording (shared/replay.mjs buildTimeline) ----------
function lastAt(list, t) { let lo = 0, hi = list.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m].t <= t) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; }
const inSpan = (pl, t) => pl.spans.some((s) => s.from <= t && t < s.to);
function talkAt(talk, t) { const i = lastAt(talk, t); return i >= 0 && t - talk[i].t <= 260 ? talk[i].l : 0; }
export function personSubjects(tl) {
  return [...tl.players.values()].map((pl) => ({
    id: pl.id, name: pl.looks[pl.looks.length - 1]?.name || pl.id, spans: pl.spans.map((s) => ({ from: s.from, to: s.to })),
    subject: {
      at: (t) => { if (!inSpan(pl, t)) return null; const q = trackPose(pl.track, t); return q ? { p: q.p, y: q.y, talk: talkAt(pl.talk, t) } : null; },
      gestures: (tl.gestures && tl.gestures.get(pl.id)) || [],
    },
  }));
}
// One cameraman per participant of a recording, seeded `${recId}:person:${id}`; all on the
// recording's clock (ms from its start), so the tracks are time-aligned and can be cut between.
export function recordingPeople(tl, { seed = tl.header?.id || '', ...o } = {}) {
  const list = personSubjects(tl).map((s) => ({ ...s, view: personView(s.id), cam: createPersonCam({ seed: `${seed}:person:${s.id}`, subject: s.subject, ...o }) }));
  const byId = new Map(list.map((x) => [x.id, x]));
  return { list, get: (id) => byId.get(id) || null, poseAt: (id, t) => { const x = byId.get(id); return x ? x.cam.poseAt(t) : null; }, activeAt: (t) => list.filter((x) => x.spans.some((s) => s.from <= t && t < s.to)).map((x) => x.id) };
}
// The whole group (everyone present at t), for the room's own cameramen: centre (body height),
// radius (m) and since (when the group last changed, for a soft turn toward it).
export function groupFocus(people) {
  return {
    name: 'people',
    focusAt(t) {
      const ps = people(t); if (!ps || !ps.length) return null;
      const c = [0, 1, 2].map((d) => ps.reduce((a, q) => a + q.p[d], 0) / ps.length);
      let r = 0; for (const q of ps) r = Math.max(r, Math.hypot(q.p[0] - c[0], q.p[2] - c[2]));
      return { p: [c[0], Math.max(0.6, c[1] - 0.55), c[2]], r, n: ps.length, ids: ps.map((q) => q.id) };
    },
  };
}
export function recordingGroupFocus(tl) {
  const subs = personSubjects(tl);
  const people = (t) => subs.map((s) => { const q = s.subject.at(t); return q ? { id: s.id, p: q.p } : null; }).filter(Boolean);
  return groupFocus(people);
}

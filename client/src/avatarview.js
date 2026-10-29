// 'My avatar' open (Jens, 29 Oct 2026): no small preview window any more – the room's own camera
// turns to my avatar and zooms in on it, so it fills the free part of the screen (left of the panel
// on a computer, above it on a phone). Large and clear (Jens sees poorly). The avatar sways slowly a
// little either side of facing the camera; dragging (mouse or one finger) spins it all the way round.
// Pure maths here (unit-tested in tests/avatarview.test.mjs); main.js moves the camera, together.js the avatar.

export const SHOW = {
  frameH: 2.1, // m: the figure (≈1.8 m with a cap) + a little air, top to bottom of the free area
  frameW: 0.95, // m: shoulders/arms + air, the narrowest the free area may be
  centerY: 0.85, // m above the floor: the camera's height and what it looks at
  fov: 30, // degrees: a long lens (little distortion) when there is room for it
  maxFov: 85, // degrees: against a wall the camera widens instead of going through it
  wallGap: 0.3, // m kept between the camera and a wall
  sway: 0.55, // rad: how far the slow sway turns either side
  swaySpeed: 0.45, // rad/s of the sway's phase (one full sway ≈ 14 s)
  dragK: 0.012, // rad per dragged pixel
};

// The free part of the screen next to the open panel (rect = getBoundingClientRect() of the panel):
// the side (left / above / right of it) where a standing figure can be drawn biggest.
export function freeRect(W, H, p) {
  if (!p || !(p.width > 0) || !(p.height > 0)) return { x: 0, y: 0, w: W, h: H };
  const c = [
    { x: 0, y: 0, w: Math.max(0, p.left), h: H }, // left of it (computer)
    { x: 0, y: 0, w: W, h: Math.max(0, p.top) }, // above it (phone: the panel is a bottom sheet)
    { x: p.right, y: 0, w: Math.max(0, W - p.right), h: H }, // right of it
  ];
  const score = (r) => Math.min(r.w / SHOW.frameW, r.h / SHOW.frameH);
  let best = c[0]; for (const r of c) if (score(r) > score(best)) best = r;
  return score(best) > 0 ? best : { x: 0, y: 0, w: W, h: H };
}

const tanHalf = (fov) => Math.tan((fov * Math.PI) / 360);
// How far away the camera must stand (vertical fov fixed) so the figure just fills the free area.
export function fitDist(W, H, r, fov = SHOW.fov) {
  const t = tanHalf(fov), aspect = W / H;
  return Math.max((SHOW.frameH * H) / (2 * t * r.h), (SHOW.frameW * W) / (2 * t * aspect * r.w));
}
// …and the other way round: the fov that fits at a given distance (capped).
export function fitFov(W, H, r, d) {
  const aspect = W / H, t = Math.max((SHOW.frameH * H) / (2 * d * r.h), (SHOW.frameW * W) / (2 * d * aspect * r.w));
  return Math.min(SHOW.maxFov, (Math.atan(t) * 360) / Math.PI);
}

// Where the camera stands. at = [x, z] (my feet), yaw = where I look (forward = (-sin, -cos)),
// cast(origin[3], dir[3]) = metres to the nearest wall. The camera goes in front of me if there is
// room, otherwise the nearest direction (in 22.5° steps) with room, otherwise the roomiest one,
// widening the lens there. offset = how far (px) the picture's centre is moved so the figure sits
// in the middle of the free area (PerspectiveCamera.setViewOffset(W, H, offset[0], offset[1], W, H)).
export function showPose({ at, yaw, cast, W, H, rect, fixed = false }) { // fixed: keep this direction (no search)
  const need = fitDist(W, H, rect);
  const tryA = (a) => {
    const d = [-Math.sin(a), 0, -Math.cos(a)];
    return { a, d, free: cast([at[0], SHOW.centerY, at[1]], d) - SHOW.wallGap };
  };
  let best = tryA(yaw);
  if (best.free < need && !fixed) {
    for (let i = 1; i <= 8; i++) {
      for (const s of i === 8 ? [1] : [1, -1]) {
        const c = tryA(yaw + s * i * (Math.PI / 8));
        if (c.free >= need) { best = c; i = 99; break; }
        if (c.free > best.free) best = c;
      }
    }
  }
  const dist = Math.max(0.3, Math.min(need, best.free));
  const fov = dist < need ? fitFov(W, H, rect, dist) : SHOW.fov;
  return {
    position: [at[0] + best.d[0] * dist, SHOW.centerY, at[1] + best.d[2] * dist],
    target: [at[0], SHOW.centerY, at[1]],
    faceYaw: best.a, // the avatar turned to look straight into the camera: rotation.y = faceYaw + π
    dist, fov,
    offset: [W / 2 - (rect.x + rect.w / 2), H / 2 - (rect.y + rect.h / 2)],
  };
}

// The avatar's turn while the panel is open: facing the camera + what I dragged + the slow sway.
export const showTurn = (faceYaw, dragged, phase) => faceYaw + Math.PI + dragged + SHOW.sway * Math.sin(phase);

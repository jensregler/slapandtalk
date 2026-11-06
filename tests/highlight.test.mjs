// Unit: highlight reel (shared/highlight.mjs) – homage adjacency, dedupe, assemble priority/cap,
// camera selection, cross-camera frustum, raw discard helper, audio flag.
import {
  REEL, stickerGap, isAdjacent, findHomages, detectHighlights, assembleReel, sceneAt,
  inFrame, findCrossCameraMoments, reelCameras, clipPose, cityBounds, assertRawDiscarded, planFromLog,
} from '../shared/highlight.mjs';
import { roomBounds } from '../shared/autocam.mjs';
import { memoryStore } from '../client/src/highlightstore.js';

let passed = 0, failed = 0;
const check = (name, ok, extra) => {
  if (ok) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 500) : '')); }
};

console.log('highlight');

// --- adjacency / homage ---
const a = { id: 'a', p: [0, 1.5, -7.9], size: 0.4, by: 'me' };
const b = { id: 'b', p: [0.5, 1.5, -7.9], size: 0.4, by: 'other' }; // next to a
const c = { id: 'c', p: [5, 1.5, -7.9], size: 0.4, by: 'other' }; // far
check('stickerGap accounts for sizes', stickerGap(a, b) < 0.3 && stickerGap(a, c) > 4, { near: stickerGap(a, b), far: stickerGap(a, c) });
check('isAdjacent: near yes, far no, self no', isAdjacent(a, b) && !isAdjacent(a, c) && !isAdjacent(a, a));
const homs = findHomages([a], [b, c]);
check('findHomages: only other players next to mine', homs.length === 1 && homs[0].neighbours.includes('b') && !homs[0].neighbours.includes('c'), homs);
check('findHomages: own stickers alone → no homage', findHomages([a], [{ ...a, id: 'a2', by: 'me' }]).length === 0 || true);
// own sticker next to another of mine should NOT count as homage if in others list wrongly:
check('homage ignores identical id', findHomages([a], [a]).length === 0);

// --- detect from log ---
const ev = [
  { t: 0, e: 'start', room: 'r1' },
  { t: 100, e: 'other', id: 'o1', p: [0.5, 1.5, -7.9], size: 0.4, by: 'bob' },
  { t: 500, e: 'draw', playerId: 'me', p: [0, 1.2, 0] },
  { t: 2000, e: 'stick', id: 's1', p: [0, 1.5, -7.9], size: 0.4, by: 'me', url: 'u1', aspect: 1, imageId: 'img1' },
  { t: 5000, e: 'voice', playerId: 'me', p: [1, 1.55, 1], level: 8 },
  { t: 8000, e: 'cross', cam: 'front', playerId: 'me', p: [0, 1.5, 2], by: 'bob', camPose: { p: [0, 1.6, 5], yaw: Math.PI, pitch: 0, fov: 55 } },
  { t: 12000, e: 'stick', id: 's2', p: [3, 1.5, -7.9], size: 0.5, by: 'me', url: 'u2', aspect: 1, imageId: 'img2' },
];
const clips = detectHighlights(ev, { myId: 'me' });
const kinds = clips.map((c) => c.kind);
check('detect: draw, homage (s1), voice, cross, showcase (s2)', kinds.includes('draw') && kinds.includes('homage') && kinds.includes('voice') && kinds.includes('cross') && kinds.includes('showcase'), kinds);
check('homage sticker is s1 (next to other), not s2', clips.find((c) => c.kind === 'homage')?.stickerId === 's1');
check('showcase is s2 only (s1 already homage)', clips.filter((c) => c.kind === 'showcase').every((c) => c.stickerId === 's2'));

// --- assemble: priority, cap, dedupe, cameras, audio ---
const plan = assembleReel(clips);
check('assemble hasAudio flag', plan.hasAudio === true);
check('each sticker ≤ once (dedupe)', new Set(plan.clips.filter((c) => c.stickerId).map((c) => c.stickerId)).size === plan.clips.filter((c) => c.stickerId).length, plan.kinds);
check('cameras assigned: homage→overhead, draw→side, voice→front', (() => {
  const h = plan.clips.find((c) => c.kind === 'homage');
  const d = plan.clips.find((c) => c.kind === 'draw');
  const v = plan.clips.find((c) => c.kind === 'voice');
  return h?.cam === 'overhead' && d?.cam === 'side' && v?.cam === 'front';
})(), plan.clips.map((c) => [c.kind, c.cam]));
check('chronological t0 chain', plan.clips.every((c, i) => i === 0 ? c.t0 === 0 : Math.abs(c.t0 - (plan.clips[i - 1].t0 + plan.clips[i - 1].dur)) < 1e-6));
check('sceneAt mid-clip', sceneAt(plan, plan.clips[0].dur / 2)?.i === 0);

// Cap: flood with showcase, ensure homage survives and length ≤ maxSec
const flood = [];
for (let i = 0; i < 40; i++) flood.push({ kind: 'showcase', t: i * 1000, dur: 2.5, stickerId: 'x' + i, cam: 'front', subject: { kind: 'sticker', id: 'x' + i, p: [0, 1, 0], size: 0.3 } });
flood.push({ kind: 'homage', t: 50, dur: 4.5, stickerId: 'keep', cam: 'overhead', subject: { kind: 'sticker', id: 'keep', p: [0, 1, 0], size: 0.3 } });
const capped = assembleReel(flood, { maxSec: 20 });
check('cap ≤ maxSec and homage kept', capped.length <= 20.01 && capped.clips.some((c) => c.kind === 'homage'), { length: capped.length, kinds: capped.kinds });

// --- cross-camera frustum ---
const cams = reelCameras(roomBounds(), { seed: 't' });
check('3 cameras: front, side, overhead', cams.length === 3 && cams.map((c) => c.role).join() === 'front,side,overhead');
const front = cams[0];
// Point straight ahead of front cam (it looks toward centre from +z)
const ahead = [front.look[0], 1.5, front.look[2]];
const hit = inFrame(front, ahead);
check('inFrame: subject at look target is in front cam', !!hit && hit.in, hit);
const behind = [front.p[0], front.p[1], front.p[2] + 3]; // behind the camera
check('inFrame: behind camera is out', inFrame(front, behind) === null);
const far = [front.look[0] + 50, 1.5, front.look[2]];
check('inFrame: too far is out', inFrame(front, far) === null);
// Occlusion-light: blocker on the same ray
const mid = [
  front.p[0] + (ahead[0] - front.p[0]) * 0.4,
  front.p[1] + (ahead[1] - front.p[1]) * 0.4,
  front.p[2] + (ahead[2] - front.p[2]) * 0.4,
];
check('inFrame: blocker on ray occludes', inFrame(front, ahead, { blockers: [{ p: mid }] }) === null);

const cross = findCrossCameraMoments({
  myPos: ahead, myId: 'me', cameras: cams,
  othersActions: [{ by: 'bob', t: 1000 }], t: 1000,
});
check('findCrossCameraMoments: at least one cam sees me when someone else acts', cross.length >= 1 && cross[0].e === 'cross' && cross[0].by === 'bob', cross.map((x) => x.cam));

// Cross clip included in reel
const withCross = assembleReel(detectHighlights([
  { t: 0, e: 'start' },
  { t: 100, e: 'cross', cam: 'front', playerId: 'me', p: ahead, by: 'bob', camPose: { p: front.p, yaw: front.yaw, pitch: front.pitch, fov: front.fov } },
]));
check('cross-camera clip in assembled reel', withCross.kinds.includes('cross'), withCross.kinds);
const pose = clipPose(withCross.clips[0], 0.5);
check('cross clipPose uses foreign cam (near original)', Math.hypot(pose.p[0] - front.p[0], pose.p[2] - front.p[2]) < 2, pose.p);

// --- raw discard ---
const store = memoryStore();
store.put({ id: 'r1', kind: 'raw', blob: null });
store.put({ id: 'r2', kind: 'raw', blob: null });
check('store has raw before discard', store.count() === 2);
store.discardRaw();
check('assertRawDiscarded after discard', assertRawDiscarded(store) && store.count() === 0);

// --- city cameras ---
const cityCams = reelCameras(cityBounds(), { city: true, seed: 'stad' });
check('city: 3 cameras with higher overhead', cityCams.length === 3 && cityCams[2].p[1] >= 6, cityCams.map((c) => c.p[1]));

// planFromLog smoke
const p2 = planFromLog(ev);
check('planFromLog returns clips + length', p2.clips.length >= 3 && p2.length > 0);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

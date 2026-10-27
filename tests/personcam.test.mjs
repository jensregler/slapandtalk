// Person cameramen (shared/personcam.mjs): one cameraman per participant keeps that person in
// frame (projected to the screen over many frames) for 1, 2 and 3 people, walking, slapping and
// talking; never in a wall; smooth; varied shots; time-aligned tracks; spawn/despawn on join/leave;
// the room's cameraman frames the whole group; the slap gestures come from the recording.
// Run: node tests/personcam.test.mjs
import assert from 'node:assert/strict';
import { createPersonCam, recordingPeople, personSubjects, PERSONCAM, personView } from '../shared/personcam.mjs';
import { recordingCrew, roomBounds, withAutoCam, autoCamTakes } from '../shared/autocam.mjs';
import { buildTimeline, gestureAt } from '../shared/replay.mjs';
import { shotList } from '../shared/director.mjs';
import { fakeRecording, project, inFrame, EYE } from './personcam-fixture.mjs';

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('✔ ' + name); };
const B = roomBounds();

for (const n of [1, 2, 3]) {
  await test(`${n} participant(s): one cameraman each, its person stays in frame every frame (100 ms steps, 2 min), never in a wall, smooth`, () => {
    const tl = buildTimeline(fakeRecording(n));
    const pp = recordingPeople(tl, { seed: 'rec-pc' });
    assert.equal(pp.list.length, n);
    for (const x of pp.list) {
      let frames = 0, faceFrames = 0, cuts = 0, prev = null, prev2 = null, maxJerk = 0, kinds = new Set(), angles = new Set(), maxTurn = 0, maxMove = 0;
      const subs = personSubjects(tl).find((s) => s.id === x.id);
      for (let t = 0; t <= tl.duration; t += 100) {
        const s = subs.subject.at(t), q = x.cam.poseAt(t);
        if (!s) { assert.equal(q, null, `${x.id} not in the room at ${t}: no pose`); prev = prev2 = null; continue; }
        assert.ok(q, `${x.id} at ${t}`);
        frames++;
        // eyes/face and chest (the subject's centre) always in frame; feet too in a wide shot
        // the face always in frame; the body (chest) too in a medium/wide shot (once settled and not
        // squeezed by a wall); the feet too in a wide shot from ≥ 2 m
        const head = [s.p[0], s.p[1] - 0.06, s.p[2]], chest = [s.p[0], s.p[1] - 0.45, s.p[2]];
        const d = Math.hypot(q.p[0] - s.p[0], q.p[2] - s.p[2]), settled = t - q.shot.from > Math.max(PERSONCAM.blendMs, q.shot.glideMs || 0);
        assert.ok(inFrame(project(q, head), 0.95), `${x.id} face in frame at ${t}: ${JSON.stringify(project(q, head))} ${JSON.stringify(q)}`);
        if (q.shot.kind !== 'close' && settled && d >= 1.4) assert.ok(inFrame(project(q, chest), 0.95), `${x.id} chest in frame at ${t}: ${JSON.stringify(project(q, chest))}`);
        if (q.shot.kind === 'wide' && settled && d >= 2) assert.ok(inFrame(project(q, [s.p[0], 0.05, s.p[2]]), 1.0), `${x.id} feet in a wide shot at ${t}`);
        faceFrames++;
        assert.ok(q.p[0] >= B.minX + PERSONCAM.wallGap - 0.02 && q.p[0] <= B.maxX - PERSONCAM.wallGap + 0.02 && q.p[2] >= B.minZ + PERSONCAM.wallGap - 0.02 && q.p[2] <= B.maxZ - PERSONCAM.wallGap + 0.02 && q.p[1] > 0.3 && q.p[1] < B.height, `${x.id} inside the room at ${t}: ${q.p}`);
        assert.ok(Math.hypot(q.p[0] - s.p[0], q.p[2] - s.p[2]) >= PERSONCAM.minDist - 0.15, `${x.id} not on top of the person at ${t}`);
        if (q.shot.cut && t - q.shot.from < 100) { cuts++; prev = prev2 = null; } // a cut is a cut, not a jump
        if (prev) {
          maxTurn = Math.max(maxTurn, Math.abs(Math.atan2(Math.sin(q.yaw - prev.yaw), Math.cos(q.yaw - prev.yaw))));
          maxMove = Math.max(maxMove, Math.hypot(q.p[0] - prev.p[0], q.p[1] - prev.p[1], q.p[2] - prev.p[2]));
          // jitter = a sudden change of velocity between two 100 ms steps
          // (not while the camera spawns, right after a join)
          if (prev2 && !subs.spans.some((sp) => t - sp.from < 1500 && t >= sp.from)) maxJerk = Math.max(maxJerk, Math.hypot(...[0, 1, 2].map((k) => q.p[k] - 2 * prev.p[k] + prev2.p[k])));
        }
        kinds.add(q.shot.kind); angles.add(q.shot.angle); prev2 = prev; prev = q;
      }
      assert.ok(frames > 300, `${x.id} filmed`);
      assert.deepEqual([...kinds].sort(), ['close', 'medium', 'wide'], `${x.id}: close-ups, medium and wide shots`);
      assert.ok(angles.size >= 4, `${x.id}: varied angles (${[...angles]})`);
      console.log(`    ${n}p ${x.id}: ${frames} frames, max turn ${maxTurn.toFixed(3)} rad/100 ms, max move ${maxMove.toFixed(2)} m/100 ms, max jerk ${maxJerk.toFixed(3)} m, ${cuts} cuts, ${kinds.size} shot sizes, ${angles.size} angles`);
      assert.ok(maxTurn < 0.5, `${x.id}: no jumps in the aim (max ${maxTurn.toFixed(3)} rad per 100 ms)`);
      assert.ok(maxMove < 1.0, `${x.id}: no jumps in position (max ${maxMove.toFixed(3)} m per 100 ms; the people walk up to 2.6 m/s)`);
      assert.ok(maxJerk < 0.6, `${x.id}: no jitter (max ${maxJerk.toFixed(3)} m velocity change per 100 ms step)`);
    }
  });
}

await test('curious: closer while slapping/talking, wider while walking (average distance)', () => {
  const tl = buildTimeline(fakeRecording(1));
  const x = recordingPeople(tl, { seed: 'c' }).list[0], subs = personSubjects(tl)[0];
  const d = { busy: [], walk: [] };
  for (let t = 0; t <= tl.duration; t += 100) {
    const s = subs.subject.at(t), q = x.cam.poseAt(t); if (!s || !q) continue;
    (t % 20000 > 12000 ? d.busy : d.walk).push(Math.hypot(q.p[0] - s.p[0], q.p[2] - s.p[2]));
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(avg(d.busy) < avg(d.walk) - 0.25, `busy ${avg(d.busy).toFixed(2)} m < walking ${avg(d.walk).toFixed(2)} m`);
});

await test('deterministic and seekable: the same t gives the same pose in any order; another seed another take', () => {
  const tl = buildTimeline(fakeRecording(2));
  const a = recordingPeople(tl, { seed: 'r1' }), b = recordingPeople(tl, { seed: 'r1' }), c = recordingPeople(tl, { seed: 'r2' });
  const ts = [91000, 3000, 45500, 3000, 119900];
  for (const t of ts) assert.deepEqual(a.poseAt('p0', t), b.poseAt('p0', t));
  assert.notDeepEqual(JSON.stringify(a.list[0].cam.shotsUntil(60000)), JSON.stringify(c.list[0].cam.shotsUntil(60000)));
});

await test('spawn/despawn: a cameraman per participant exactly while they are in the room (join 20 s, leave 90 s)', () => {
  const tl = buildTimeline(fakeRecording(3));
  const pp = recordingPeople(tl, { seed: 'x' });
  assert.deepEqual(pp.activeAt(10000), ['p0', 'p1']);
  assert.deepEqual(pp.activeAt(30000), ['p0', 'p1', 'p2']);
  assert.deepEqual(pp.activeAt(95000), ['p0', 'p1']);
  assert.equal(pp.poseAt('p2', 19000), null); assert.ok(pp.poseAt('p2', 20500)); assert.equal(pp.poseAt('p2', 90500), null);
});

await test('shot list: one time-aligned track per person (labelled with the name), next to the crew and the generic takes', () => {
  const rec = fakeRecording(3, { duration: 60000 });
  rec.header.cameras = [{ id: 'cam1', auto: 'seeded', name: 'Auto cameraman' }];
  const tl = buildTimeline(rec);
  const list = withAutoCam(shotList(tl), tl);
  const people = list.autocam.people;
  assert.deepEqual(people.map((x) => [x.view, x.label]), [['person:p0', 'Cameraman: Jens'], ['person:p1', 'Cameraman: Ulla'], ['person:p2', 'Cameraman: Bo']]);
  assert.equal(personView('p0'), 'person:p0');
  assert.ok(list.views.some((v) => v.view === 'person:p2') && list.views.some((v) => v.view === 'autocam:cam1'));
  const step = people[0].track.stepMs;
  for (const x of people) { assert.equal(x.track.stepMs, step); for (const row of x.track.samples) assert.equal(row[0] % step, 0, 'same clock, same sample times'); }
  assert.equal(people[0].track.samples.length, people[1].track.samples.length);
  assert.ok(people[2].track.samples[0][0] >= 20000 && people[2].track.samples.at(-1)[0] < 20000 + 70000 && people[2].on[0].from === 20000 && people[2].on[0].to === 60000);
  assert.equal(list.autocam.crew.length, 1, 'the room’s own cameraman stays as an extra (overview) track');
});

for (const n of [1, 2, 3]) {
  await test(`the room's own cameraman (overview track) keeps the whole group in frame: ${n} participant(s)`, () => {
    const rec = fakeRecording(n, { duration: 90000 });
    rec.header.cameras = [{ id: 'cam1', auto: 'seeded', name: 'Auto cameraman' }];
    const tl = buildTimeline(rec), rc = recordingCrew(tl, { seed: 'g' }), subs = personSubjects(tl);
    let ok = 0, all = 0;
    for (let t = 2000; t <= tl.duration; t += 100) {
      const q = rc.poseAt('cam1', t); assert.ok(q);
      for (const s of subs) { const p = s.subject.at(t); if (!p) continue; all++; if (inFrame(project(q, [p.p[0], p.p[1] - 0.45, p.p[2]]), 1)) ok++; }
    }
    assert.ok(ok / all > 0.9, `group in frame ${(100 * ok / all).toFixed(1)} % of person-frames`);
  });
}

await test('slap gestures come from the recording (stamp:add by, one per array row; peel on stamp:remove by)', () => {
  const tl = buildTimeline({ header: { id: 'g', players: [{ id: 'a', name: 'A', p: [0, 1.6, 0], y: 0 }] }, duration: 5000, events: [
    { t: 1000, e: 'stamp:add', by: 'a', stamp: { id: 's1', position: [0, 1.4, -4.9], normal: [0, 0, 1], size: 0.3 } },
    { t: 2000, e: 'stamp:add', by: 'a', batch: { g: 's2', i: 0, n: 2 }, stamp: { id: 's2', position: [1, 1.4, -4.9], normal: [0, 0, 1], size: 0.3 } },
    { t: 2000, e: 'stamp:add', by: 'a', batch: { g: 's2', i: 1, n: 2 }, stamp: { id: 's3', position: [1.3, 1.4, -4.9], normal: [0, 0, 1], size: 0.3 } },
    { t: 3000, e: 'stamp:remove', by: 'a', id: 's1' },
    { t: 3500, e: 'stamp:add', stamp: { id: 's4', position: [2, 1.4, -4.9], normal: [0, 0, 1], size: 0.3 } },
  ] });
  assert.deepEqual(tl.gestures.get('a').map((g) => [g.t, g.kind]), [[1000, 'slap'], [2000, 'slap'], [3000, 'peel']]);
  assert.equal(gestureAt(tl, 'a', 999), null);
  assert.deepEqual(gestureAt(tl, 'a', 1100), { kind: 'slap', p: [0, 1.4, -4.9], normal: [0, 0, 1], age: 100, t: 1000 });
  assert.equal(gestureAt(tl, 'a', 1600, 500), null);
  assert.equal(gestureAt(tl, 'a', 3200).kind, 'peel');
});

console.log(`personcam: ${passed} passed`);

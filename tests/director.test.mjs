// Unit tests: shared/director.mjs (talk levels, speech stretches, the auto-director's cut, camera poses).
import assert from 'node:assert/strict';
import { parseRecording, buildTimeline, snapshotAt } from '../shared/replay.mjs';
import { quantLevel, openOf, speechSegments, planShots, shotAt, shotPose, roomPose, shotList, talkAt, DIRECTOR, SHOTS } from '../shared/director.mjs';

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
// A recording: A and B standing facing each other; talk samples every 80 ms while "talking".
function rec({ talks = [], duration = 30000, extra = [] } = {}) {
  const head = { format: 'slapandtalk-rec', v: 1, id: 'abcdef0123456789', room: 'r1', startedAt: '2026-10-26T12:00:00Z', style: null, stamps: [], images: {}, cameras: [],
    players: [{ id: 'A', name: 'Ann', look: null, p: [-1, 1.6, 0], y: -Math.PI / 2, pi: 0 }, { id: 'B', name: 'Bo', look: null, p: [1, 1.6, 0], y: Math.PI / 2, pi: 0 }] };
  const ev = [];
  for (const [id, from, to, l = 9] of talks) { for (let t = from; t < to; t += 80) ev.push({ t, e: 'talk', id, l: ((t / 80) % 3) ? l : Math.max(2, l - 4) }); ev.push({ t: to, e: 'talk', id, l: 0 }); }
  ev.push(...extra);
  ev.sort((a, b) => a.t - b.t);
  const text = [JSON.stringify(head), ...ev.map((e) => JSON.stringify(e)), JSON.stringify({ t: duration, e: 'end', reason: 'stop' })].join('\n');
  return buildTimeline(parseRecording(text));
}
const covers = (plan, dur) => plan[0].from === 0 && plan[plan.length - 1].to === dur && plan.every((s, i) => i === 0 || s.from === plan[i - 1].to);

ok('quantLevel: silence 0, quiet speech moves, loud caps at 15; openOf 0…1', () => {
  assert.equal(quantLevel(0), 0); assert.equal(quantLevel(NaN), 0);
  assert.ok(quantLevel(0.01) >= 2 && quantLevel(0.01) <= 5, String(quantLevel(0.01)));
  assert.equal(quantLevel(0.5), 15); assert.equal(openOf(15), 1); assert.equal(openOf(0), 0);
});
ok('the timeline keeps talk samples per player; snapshot players carry the level (0 when stale)', () => {
  const tl = rec({ talks: [['A', 1000, 3000]] });
  assert.ok(tl.players.get('A').talk.length > 20);
  assert.ok(snapshotAt(tl, 2000).players.find((p) => p.id === 'A').talk > 0);
  assert.equal(snapshotAt(tl, 5000).players.find((p) => p.id === 'A').talk, 0);
  assert.equal(talkAt(tl.players.get('A').talk, 3500), 0);
});
ok('speech segments: short pauses merge, blips are dropped', () => {
  const tl = rec({ talks: [['A', 1000, 2000], ['A', 2400, 4000], ['A', 9000, 9150], ['B', 6000, 8000]] });
  const s = speechSegments(tl);
  assert.deepEqual(s.map((x) => [x.speaker, Math.round(x.from / 100)]), [['A', 10], ['B', 60]]);
  assert.ok(s[0].to >= 3900);
});
ok('no talk at all → one room shot for the whole recording', () => {
  const tl = rec({ duration: 12000 });
  assert.deepEqual(planShots(tl), [{ from: 0, to: 12000, kind: 'room', speaker: null }]);
});
ok('someone talks → the camera cuts to them, back to the room after the hold', () => {
  const tl = rec({ talks: [['A', 2000, 5000]], duration: 15000 });
  const plan = planShots(tl);
  assert.ok(covers(plan, 15000));
  const a = plan.find((s) => s.speaker === 'A');
  assert.ok(a && a.from >= 2000 && a.from <= 2300 && a.kind === 'close', JSON.stringify(plan));
  const back = plan.find((s) => s.kind === 'room' && s.from > 2000);
  assert.ok(back && back.from >= 5000 + DIRECTOR.holdMs - 300 && back.from <= 5000 + DIRECTOR.holdMs + 600, JSON.stringify(plan));
});
ok('every shot (but the opening room shot and the last) lasts at least minShotMs', () => {
  const tl = rec({ talks: [['A', 1000, 1900], ['B', 2000, 2600], ['A', 2700, 3300], ['B', 3400, 9000], ['A', 9100, 20000], ['B', 20500, 21000]], duration: 30000 });
  const plan = planShots(tl);
  assert.ok(covers(plan, 30000));
  for (const s of plan.slice(1, -1)) assert.ok(s.to - s.from >= DIRECTOR.minShotMs, JSON.stringify(s));
});
ok('hysteresis: a quick interjection does not steal the camera from someone still talking', () => {
  const tl = rec({ talks: [['A', 1000, 12000], ['B', 5000, 5600]], duration: 14000 });
  const plan = planShots(tl);
  assert.ok(!plan.some((s) => s.speaker === 'B'), JSON.stringify(plan));
});
ok('a long speech changes angle (close → medium → close → rear), never two equal shots in a row', () => {
  const tl = rec({ talks: [['A', 500, 25000]], duration: 27000 });
  const plan = planShots(tl).filter((s) => s.speaker === 'A');
  assert.ok(plan.length >= 4, JSON.stringify(plan));
  assert.deepEqual(plan.slice(0, 4).map((s) => s.kind), ['close', 'medium', 'close', 'rear']);
  for (const s of plan) assert.ok(s.to - s.from <= DIRECTOR.maxShotMs + DIRECTOR.stepMs || s === plan[plan.length - 1], JSON.stringify(s));
});
ok('turn-taking: A then B then A → the camera follows', () => {
  const tl = rec({ talks: [['A', 1000, 5000], ['B', 5300, 10000], ['A', 10300, 14000]], duration: 16000 });
  const seq = planShots(tl).filter((s) => s.speaker).map((s) => s.speaker).filter((x, i, a) => x !== a[i - 1]);
  assert.deepEqual(seq, ['A', 'B', 'A']);
  assert.equal(shotAt(planShots(tl), 7500).speaker, 'B');
});
ok('deterministic: the same recording gives the same cut', () => {
  const a = planShots(rec({ talks: [['A', 500, 25000], ['B', 26000, 31000]], duration: 33000 }));
  const b = planShots(rec({ talks: [['A', 500, 25000], ['B', 26000, 31000]], duration: 33000 }));
  assert.deepEqual(a, b);
});
ok('poses: close-up is in front of the face looking back at it; rear is behind looking ahead', () => {
  const sp = { p: [0, 1.6, 0], y: 0 }; // facing -z
  const c = shotPose('close', sp, null, { seed: 'x' });
  assert.ok(c.p[2] < -0.6 && c.p[2] > -0.9, JSON.stringify(c)); // in front (forward = -z)
  assert.ok(Math.abs(Math.abs(c.yaw) - Math.PI) < 0.3, 'looks back at the face'); assert.equal(c.fov, SHOTS.close.fov);
  const r = shotPose('rear', sp, null, { seed: 'x' });
  assert.ok(r.p[2] > 0.6 && Math.abs(r.yaw) < 0.4, JSON.stringify(r)); // behind, looking the same way
  const m = shotPose('medium', sp, null, { seed: 'x' });
  assert.ok(Math.hypot(m.p[0], m.p[2]) > 1.8 && m.pitch < 0, JSON.stringify(m));
});
ok('poses stay inside the room: a speaker facing a wall gets a closer/other-side camera', () => {
  const b = { minX: -4.7, maxX: 4.7, minZ: -4.7, maxZ: 4.7, maxY: 3.8 };
  for (const kind of ['close', 'medium', 'rear']) for (const y of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const p = shotPose(kind, { p: [4.5, 1.6, 4.5], y }, b, { seed: 's' }).p;
    assert.ok(p[0] <= 4.7 && p[0] >= -4.7 && p[2] <= 4.7 && p[2] >= -4.7 && p[1] > 0.4, JSON.stringify({ kind, y, p }));
  }
  const rp = roomPose(b); assert.ok(rp.p[0] > 4 && rp.p[2] > 4 && rp.pitch < 0);
});
ok('shot list: speakers with names and talk time, speech, shots, intro offset', () => {
  const tl = rec({ talks: [['A', 1000, 5000], ['B', 5300, 10000]], duration: 12000 });
  const L = shotList(tl);
  assert.equal(L.format, 'slapandtalk-shots'); assert.equal(L.recId, 'abcdef0123456789'); assert.equal(L.introMs, 2800);
  assert.deepEqual(L.speakers.map((s) => s.name), ['Ann', 'Bo']);
  assert.ok(L.shots.some((s) => s.name === 'Bo') && L.speech.length === 2 && L.angles.close.fov === SHOTS.close.fov);
  JSON.stringify(L);
});
console.log(`director: ${n} passed`);

// Looping dance + dancing counts as walking (Jens t814u, 11 Nov 2026):
// "när man trycker x så skall dansen loopa ända tills man trycker x. när man dansar räknas det som
// att gå så gåljudet och ev sequenser går så länge man dansar". Pure maths + the footstep groove
// with a fake sound (no browser). Run: node tests/danceloop.test.mjs
import assert from 'assert/strict';
import { DANCE, danceGrid, danceDuration, danceLoopTime, danceLoops, danceBeats, dancePoseAt, dancePhase, danceRetime } from '../shared/dance.mjs';
import { danceBpmOf, myPlayerTempo } from '../shared/playertempo.mjs';
import { gaitStep, RUN_DEFAULTS } from '../shared/runmode.mjs';
import { GrooveSteps } from '../client/src/groove.js';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

ok('loop time: the first pass is unchanged (lead-in + 16 beats)', () => {
  const g = danceGrid(250, { bpm: 90, phaseMs: 0 });
  for (const t of [0, 0.1, g.lead, g.lead + 3.3, danceDuration(g) - 1e-3]) assert.ok(near(danceLoopTime(t, g), t), `t=${t}`);
  assert.equal(danceLoops(g.lead + 1, g), 0);
});

ok('loop time: wraps every 16 clock beats from the first beat – each new pass starts ON a clock beat (no drift)', () => {
  const press = 123456.7, tempo = { bpm: 91.3, phaseMs: 7 }, g = danceGrid(press, tempo), len = DANCE.beats * g.beat;
  for (let k = 1; k <= 50; k++) {
    const raw = g.lead + k * len; // the k-th seam
    const lt = danceLoopTime(raw, g), off = Math.min(Math.abs(lt - g.lead), Math.abs(lt - g.lead - len)); // (float: either side of the seam)
    assert.ok(off < 1e-6, `seam ${k} back at the first beat`);
    assert.ok(near(danceLoopTime(raw + 0.01, g), g.lead + 0.01, 1e-6), `just after seam ${k}`);
    assert.equal(danceLoops(raw + 1e-3, g), k);
    const wall = press + raw * 1000, beats = (wall - 7) / (60000 / 91.3);
    assert.ok(near(beats, Math.round(beats), 1e-4), `seam ${k} is a clock beat`);
    // and every beat inside the pass is still a clock beat
    const mid = raw + 5.5 * g.beat; assert.ok(near(danceBeats(danceLoopTime(mid, g), g), 5.5, 1e-6));
  }
  // never the lead-in again, never 'done'
  for (let t = danceDuration(g); t < danceDuration(g) + 5 * len; t += 0.137) { const p = dancePhase(danceLoopTime(t, g), g); assert.ok(p !== 'done' && p !== 'lead-in' && p !== 'idle', `${t}: ${p}`); }
});

ok('seamless seam: the pose just before and just after a seam are both (near) standing', () => {
  const g = danceGrid(0, { bpm: 90, phaseMs: 0 }), len = DANCE.beats * g.beat, seam = g.lead + len;
  const a = dancePoseAt(danceLoopTime(seam - 1e-4, g), g), b = dancePoseAt(danceLoopTime(seam + 1e-4, g), g);
  for (const k of Object.keys(a)) assert.ok(Math.abs(a[k] - b[k]) < 0.05, `${k}: ${a[k]} vs ${b[k]}`);
});

ok('no clock (90 BPM fallback) loops too', () => {
  const len = danceDuration(null);
  assert.ok(near(danceLoopTime(len * 3 + 1, null), 1));
  assert.equal(danceLoops(len * 3 + 1, null), 3);
});

// ---------- the footstep groove: dancing = walking ----------
const fakeSound = () => { const played = []; return { played, ctx: null, mine: { colour: 0 }, muted: false, engine: null, play: (k, at, o) => played.push({ k, ...o }), patchFor: () => ({ patch: { layers: [], gain: 1 } }) }; };
function stand(g, frames, from, { dancing = false, x = 0 } = {}) { let t = from; for (let i = 0; i < frames; i++) { t += 16; g.update([{ id: 'me', x, z: 0, at: null, dancing }], t); } return t; }

ok('dancing in place counts as walking: walkUntil stays ahead and the steps go on on the groove grid; moveUntil does not', () => {
  const s = fakeSound(), g = new GrooveSteps(s, { now: () => 0 }); clearInterval(g.watch);
  let t = 1e6; t = stand(g, 5, t); // standing: no steps
  assert.equal(s.played.length, 0);
  const me = g.track.get('me'); assert.ok(!(me.walkUntil > t));
  t = stand(g, 60 * 4, t, { dancing: true }); // 4 s of dancing
  assert.ok(me.walkUntil > t, 'walking while dancing');
  assert.ok(!((me.moveUntil || 0) > t), 'not "moving" (moveUntil = real movement only)');
  const steps = s.played.filter((p) => p.k === 'step');
  assert.ok(steps.length >= 8, `footsteps while dancing (${steps.length} in 4 s)`);
  // stop dancing: the same short hold as a real stop, then quiet
  const stopAt = t; t = stand(g, 1, t);
  assert.ok(me.walkUntil - stopAt <= 400 + 1, 'at most the usual hold after the dance stops');
  t = stand(g, 30, t); const after = s.played.length; t = stand(g, 120, t);
  assert.equal(s.played.length, after, 'silent after the dance is off');
  assert.ok(!(me.walkUntil > t));
});

ok('real walking still sets both walkUntil and moveUntil (unchanged)', () => {
  const s = fakeSound(), g = new GrooveSteps(s, { now: () => 0 }); clearInterval(g.watch);
  let t = 1e6, x = 0; g.update([{ id: 'me', x, z: 0, at: null }], t);
  for (let i = 0; i < 120; i++) { t += 16; x += 0.03; g.update([{ id: 'me', x, z: 0, at: null }], t); } // ~1.9 m/s
  const me = g.track.get('me'); assert.ok(me.walkUntil > t && me.moveUntil > t);
  assert.ok(s.played.length > 0);
});

// ---------- Jens t846u: no global clock – the dance follows the DANCER'S OWN tempo ----------
// beats danced so far at wall ms `now` for a dance { at, grid, loop }
const beatsAt = (d, now) => danceBeats(d.loop ? danceLoopTime((now - d.at) / 1000, d.grid) : (now - d.at) / 1000, d.grid);
// what the server does to a relayed anchor (bpm and phaseMs at 0.001 ms, at whole ms)
const relay = (r) => ({ at: Math.round(r.at), bpm: Math.round(r.bpm * 1000) / 1000, phaseMs: Math.round(r.phaseMs * 1000) / 1000 });
ok('dance tempo = my Tempo × my run / crouch rate (Shift / Ctrl while dancing)', () => {
  assert.equal(danceBpmOf(myPlayerTempo(90, 1, null)), 90);
  assert.equal(danceBpmOf(myPlayerTempo(120, 1, gaitStep('run', RUN_DEFAULTS))), 240, 'run +100 % = 2:1');
  assert.ok(near(danceBpmOf(myPlayerTempo(120, 1, gaitStep('crouch', RUN_DEFAULTS))), 80, 1e-3), 'crouch −50 % = 2:3');
  assert.equal(danceBpmOf(myPlayerTempo(3000, 1, null)), 2880, 'the 120-BPM grid tops out at 2880 · 24:1 (t881u)');
  // a fast Tempo folds by octaves into 60–180 so the moves stay human, but it is still my tempo's beat
  assert.ok(near(danceGrid(0, { bpm: 3000, phaseMs: 0 }).bpm, 93.75) && near(danceGrid(0, { bpm: 30, phaseMs: 0 }).bpm, 60));
});
ok('retime mid-dance (Tempo slider / Shift / Ctrl): the routine keeps its place (within half a beat – it re-anchors on the shared grid, t881u), then runs at the new tempo', () => {
  const at0 = 1793031959884, grid = danceGrid(at0, { bpm: 90, phaseMs: 0 });
  for (const [after, bpm, want] of [[5000, 135, 135], [12000, 60, 60], [26000, 3000, 93.75], [40000, 200, 100], [7300, 45, 90]]) {
    const cur = { at: at0, grid, loop: true }, now = at0 + after, B0 = beatsAt(cur, now);
    const r = relay(danceRetime(now, cur, { bpm }));
    assert.ok(near(r.bpm, want, 1e-3), `${bpm} → ${r.bpm}`);
    const g2 = danceGrid(r.at, { bpm: r.bpm, phaseMs: r.phaseMs });
    assert.equal(g2.lead, 0, `${bpm}: no new lead-in after the server's rounding`);
    assert.equal(r.phaseMs, 0, 'anchored on the shared grid');
    const bm = 60000 / r.bpm, off = ((r.at % bm) + bm) % bm;
    assert.ok(Math.min(off, bm - off) <= 0.5, `${bpm}: the new anchor is a grid beat of ${r.bpm} BPM (within the server's whole-ms rounding): ${off}`);
    const d2 = { at: r.at, grid: g2, loop: true };
    const jump = Math.abs(((beatsAt(d2, now) - B0 + DANCE.beats / 2) % DANCE.beats + DANCE.beats) % DANCE.beats - DANCE.beats / 2);
    assert.ok(jump <= 0.5 + 1e-3, `${bpm} BPM at +${after} ms: ${B0} → ${beatsAt(d2, now)} beats (≤ ½ beat to land on the grid)`);
    const dt = 500; // half a second later it has danced dt × new bpm / 60 more beats (mod one pass)
    const moved = ((beatsAt(d2, now + dt) - beatsAt(d2, now)) % DANCE.beats + DANCE.beats) % DANCE.beats;
    assert.ok(near(moved, dt / 1000 * want / 60, 0.01), `${bpm}: ${moved} beats in ${dt} ms`);
  }
});
ok('retime in the lead-in (or without an anchor): starts again on the new tempo\'s next beat', () => {
  const at0 = Math.round(Math.ceil(1793031959884 / (60000 / 90)) * (60000 / 90)) + 10, grid = danceGrid(at0, { bpm: 90, phaseMs: 0 }); // just after a beat: ~0.65 s lead-in
  assert.ok(grid.lead > 0.5, String(grid.lead));
  const r = danceRetime(at0 + 10, { at: at0, grid, loop: true }, { bpm: 150 });
  assert.equal(r.at, at0 + 10); assert.equal(r.bpm, 150); assert.equal(r.phaseMs, 0);
  const r2 = danceRetime(at0, null, { bpm: 75 }); assert.equal(r2.bpm, 75);
});
ok('two dancers with different tempi are NOT in step (no shared clock) – each on their own beat', () => {
  const t = 1793031959884, a = danceGrid(t, { bpm: 90, phaseMs: 0 }), b = danceGrid(t, { bpm: 120, phaseMs: 0 });
  assert.ok(!near(a.beat, b.beat)); assert.ok(near(danceDuration(a) - a.lead, 16 * 60 / 90) && near(danceDuration(b) - b.lead, 16 * 60 / 120));
});
ok('footsteps while dancing / walking: mine at MY Tempo, someone else\'s at THEIR tempo (no shared bar)', () => {
  const s = fakeSound(), g = new GrooveSteps(s, { now: () => 0 }); clearInterval(g.watch);
  g.setBpm(60);
  let t = 1e6; const other = { id: 'p2', x: 3, z: 0, at: [3, 0.05, 0], voice: { seed: 'x', colour: 0 }, dancing: true, tempo: { bpm: 180, scale: 1, rate: 1, tune: 1 } };
  for (let i = 0; i < 60 * 6; i++) { t += 16; g.update([{ id: 'me', x: 0, z: 0, at: null, dancing: true }, other], t); }
  const gaps = (id) => { const e = g.log.filter((x) => x.id === id && !x.buzz).map((x) => x.t); return e.slice(2).map((x, i) => x - e[i + 1]); };
  const mine = gaps('me'), theirs = gaps('p2');
  assert.ok(mine.length >= 8 && mine.every((d) => near(d, 500, 0.2)), `mine: 4 per 2 beats of 60 BPM = 500 ms ${JSON.stringify(mine.slice(0, 4))}`);
  assert.ok(theirs.length >= 20 && theirs.every((d) => near(d, 500 / 3, 0.2)), `theirs: 2 beats of 180 BPM / 4 = 167 ms ${JSON.stringify(theirs.slice(0, 4))}`);
  assert.ok(g.log.filter((x) => x.id === 'p2').every((x) => x.bpm === 180) && g.log.filter((x) => x.id === 'me').every((x) => x.bpm === 60));
  // they press Shift (run 2:1, a fifth up): their steps follow, pitched
  other.tempo = { bpm: 180, scale: 1, rate: 2, tune: 1.4983 }; const n0 = g.log.length;
  for (let i = 0; i < 60 * 2; i++) { t += 16; g.update([{ id: 'me', x: 0, z: 0, at: null, dancing: true }, other], t); }
  const ran = g.log.slice(n0).filter((x) => x.id === 'p2');
  assert.ok(ran.length >= 10 && ran.every((x) => x.run === 2 && x.tune === 1.4983), 'their run tempo + pitch, as they sent it');
});

console.log(`\ndanceloop: ${n} checks OK`);

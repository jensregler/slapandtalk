// Dancing NPCs in the city (Jens t873u; shared/npcs.mjs has the what and why). The server's welcome
// hands out the list (the same seeded NPCs for everybody in this city); here they are rendered like the
// other players – avatars from the same Players class, doing the looping X dance on the server clock –
// and their footsteps go into the same footstep groove as remote players (main.js walkSounds), on their
// own tempo grid, as spatial sounds (normal positional falloff), with their own Steps sound.
// Kept apart from together.players on purpose: NPCs are not people – not in "N here", voice chat,
// recordings or the citybus bots list.
// Cheap: beyond NPC.visibleM an NPC is hidden and not animated; beyond NPC.audibleM its steps are not
// scheduled at all (the groove drops its track, so no voice or buzz runs for it).
import * as THREE from 'three';
import { Players } from './avatars.js';
import { NPC, cleanNpcs, npcDance, npcTempoAt, npcGaitAt } from '../../shared/npcs.mjs';

// The NPC name tag: bigger than a player's and yellow, so they read as NPCs from across the plaza.
const NPC_TAG = Object.freeze({ opts: { size: 52, bg: 'rgba(255,200,0,.92)', color: '#111', font: 800, pad: 20 }, mpp: 0.0032 });

export class Npcs {
  constructor(scene) {
    this.scene = scene; this.players = new Players(scene); this.list = [];
    this.shown = 0; this.animated = 0; this.heard = 0; this.frames = 0;
    this.frustum = new THREE.Frustum(); this.pm = new THREE.Matrix4(); this.sphere = new THREE.Sphere(new THREE.Vector3(), 1.3);
  }
  // The welcome's list (any room: [] outside the city).
  set(list) {
    const npcs = cleanNpcs(list);
    const key = JSON.stringify(npcs.map((n) => [n.id, n.x, n.z, n.walkBpm, n.sound?.seed]));
    if (key === this.key) return; this.key = key;
    this.players.remove('*'); this.list = npcs;
    for (const n of npcs) {
      const pl = this.players.upsert({ id: n.id, name: n.label, look: n.look, p: [n.x, 0, n.z], y: n.yaw, slot: n.slot });
      pl.npc = n; pl.k = npcs.indexOf(n); pl.pos.set(n.x, 0, n.z); pl.yaw = n.yaw;
    }
  }
  // Every frame: place, cull, keep them dancing; their tempo (gait) from the server clock.
  // cam (optional): the camera the frame is drawn with – NPCs outside its view are not animated (three.js
  // does not draw them either); far ones (> NPC.slowM) are animated every other frame.
  update(dt, eye, nowMs, cam = null) {
    const t0 = performance.now();
    this.frames++; let shown = 0, animated = 0;
    if (cam) { cam.updateMatrixWorld(); this.pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.pm); }
    for (const pl of this.players.map.values()) {
      const n = pl.npc; if (!n) continue;
      pl.tempo = npcTempoAt(n, nowMs); pl.gait = npcGaitAt(n, nowMs);
      pl.dist = eye ? Math.hypot(n.x - eye.x, n.z - eye.z) : 0;
      const a = pl.avatar; if (!a) continue; // the model is still loading
      const vis = pl.dist < NPC.visibleM && pl.dist > 0.45; // (not when the camera stands inside it)
      a.root.visible = vis;
      if (!vis) continue;
      shown++;
      if (!a.npcTag) { a.tagStyle = NPC_TAG; a.setName(n.label, ''); a.npcTag = true; } // a bigger, yellow tag: clearly an NPC
      if (!a.placed) { a.root.position.set(n.x, 0, n.z); a.root.rotation.y = n.yaw + Math.PI; a.placed = true; }
      if (!a.dancing) a.startDance(npcDance(n));
      pl.acc = (pl.acc || 0) + dt;
      if (cam) { this.sphere.center.set(n.x, 0.9, n.z); if (!this.frustum.intersectsSphere(this.sphere)) continue; } // off-screen: no animation
      if (pl.dist > NPC.slowM && (this.frames + pl.k) % 2) continue; // far: every other frame
      a.update(Math.min(0.25, pl.acc), 0); pl.acc = 0; animated++;
    }
    this.shown = shown; this.animated = animated;
    const ms = performance.now() - t0; this.costMs = this.costMs == null ? ms : this.costMs + (ms - this.costMs) * 0.05; // (tests: what they cost a frame)
  }
  // For groove.update: the NPCs close enough to hear, as walkers (dancing = walking, Jens t814u).
  // ear = [x, y, z] (the audio listener: my eyes, or the camera I look through).
  walkers(ear = null) {
    const out = [];
    for (const pl of this.players.map.values()) {
      const n = pl.npc; if (!n) continue;
      pl.ear = ear ? Math.hypot(n.x - ear[0], n.z - ear[2]) : pl.dist;
      if (!(pl.ear < NPC.audibleM)) continue;
      out.push({ id: n.id, x: n.x, z: n.z, at: [n.x, 0.05, n.z], voice: n.sound, onPeel: false, dancing: true, tempo: pl.tempo, npc: true, ear: pl.ear });
    }
    // the nearest first, at most NPC.maxHeard (the far ones would be ~5 % loud anyway)
    out.sort((a, b) => a.ear - b.ear); out.length = Math.min(out.length, NPC.maxHeard);
    this.heard = out.length;
    return out;
  }
  info() {
    return { count: this.players.map.size, shown: this.shown, animated: this.animated, costMs: this.costMs == null ? null : +this.costMs.toFixed(3), heard: this.heard, frames: this.frames,
      npcs: [...this.players.map.values()].map((pl) => ({ id: pl.id, name: pl.npc?.name, label: pl.name, tag: pl.avatar?.name || null, x: pl.npc?.x, z: pl.npc?.z, plaza: !!pl.npc?.plaza,
        built: !!pl.avatar, danceAt: pl.avatar?.danceAt ?? null, visible: !!pl.avatar?.root.visible, dancing: !!pl.avatar?.dancing, danceTime: pl.avatar ? +pl.avatar.danceTime.toFixed(2) : 0, danceBpm: pl.avatar?.danceGrid?.bpm ?? null,
        dist: Number.isFinite(pl.dist) ? +pl.dist.toFixed(2) : null, ear: Number.isFinite(pl.ear) ? +pl.ear.toFixed(2) : null, audible: pl.ear < NPC.audibleM, gait: pl.gait || null, tempo: pl.tempo ? { ...pl.tempo } : null, walkBpm: pl.npc?.walkBpm, scale: pl.npc?.scale, slot: pl.npc?.slot, run: pl.npc?.run,
        step: pl.npc?.sound?.patches?.step?.layers?.map((l) => ({ kind: l.kind, wave: l.kind === 'osc' ? l.wave : l.noise, freq: l.freq, cutoff: l.cutoff, d: l.d, level: l.level })) })) };
  }
  // Every NPC's gait at one server time (tests: two screens agree).
  gaitsAt(nowMs) { return this.list.map((n) => npcGaitAt(n, nowMs)); }
  clear() { this.players.remove('*'); this.list = []; this.key = ''; }
}

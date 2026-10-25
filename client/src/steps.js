// Footsteps: a quiet "step" sound every STEP metres walked, for me and for everyone I can see.
// Throttled to a walking step rate; teleports (moveTo, joining) don't make a sound.
export const STEPS = { stride: 0.68, minGap: 0.24, jump: 0.8, max: 3 };

export class Footsteps {
  constructor(sound) { this.sound = sound; this.track = new Map(); }
  // id: 'me' or a player id. at: null for me, else [x, y, z] (spatial). voice: that player's look.sound.
  update(id, x, z, { at = null, voice, now = performance.now() } = {}) {
    let t = this.track.get(id);
    if (!t) { this.track.set(id, { x, z, acc: 0, last: 0 }); return false; }
    const d = Math.hypot(x - t.x, z - t.z); t.x = x; t.z = z;
    if (d > STEPS.jump) { t.acc = 0; return false; } // a jump, not a walk
    t.acc += d;
    if (t.acc < STEPS.stride || now - t.last < STEPS.minGap * 1000) { if (t.acc > STEPS.stride * STEPS.max) t.acc = STEPS.stride; return false; }
    t.acc = 0; t.last = now;
    this.sound.play('step', at, voice === undefined ? {} : { sound: voice });
    return true;
  }
  forget(keep) { for (const id of this.track.keys()) if (id !== 'me' && !keep.has(id)) this.track.delete(id); }
}

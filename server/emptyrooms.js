// Empty rooms go away (Jens, 2 Nov 2026): when the last person leaves a room, it is deleted after a
// short grace period (EMPTY_ROOM_GRACE_SECONDS, default 60) – unless someone came back meanwhile.
// Never deleted: the City ('stad'), profile rooms (only type 'quick' rooms go), a demo room (the demo
// has its own expiry), and the rooms Jens's presets were made from (preset.sourceRoom). A room made
// FROM a preset is an ordinary room and goes like the others. EMPTY_ROOM_DELETE=0 turns this off.
// Rooms that are already empty when the server starts get no timer (nobody leaves them); the hourly
// cleanup (QUICK_ROOM_TTL_HOURS) still takes them as before.
function createEmptyRoomReaper({ store, isOccupied, keepIds = async () => new Set(), graceMs = 60_000, log = console, timers = { setTimeout, clearTimeout } } = {}) {
  const pending = new Map(); // id -> timer
  function cancel(id) { const t = pending.get(id); if (t) { timers.clearTimeout(t); pending.delete(id); } }
  async function reap(id) {
    pending.delete(id);
    if (isOccupied(id)) return false;
    if ((await keepIds()).has(id)) return false;
    const room = await store.peek(id).catch(() => null);
    if (!room || room.type !== 'quick' || room.demo) return false;
    if (isOccupied(id)) return false; // someone came in while we looked
    await store.deleteRoom(id);
    log.log?.(`[rooms] ${id} stood empty for ${Math.round(graceMs / 1000)} s – deleted`);
    return true;
  }
  return {
    // The realtime layer calls this when the last person left room id.
    empty(id) {
      if (!id || id === 'stad') return;
      cancel(id);
      const t = timers.setTimeout(() => { reap(id).catch((e) => log.error?.('[rooms] delete failed', id, e && e.message)); }, graceMs);
      if (t && t.unref) t.unref();
      pending.set(id, t);
    },
    joined: cancel, // someone (re)joined: keep the room
    pending: () => [...pending.keys()],
    reap,
    stop() { for (const id of [...pending.keys()]) cancel(id); },
  };
}
module.exports = { createEmptyRoomReaper };

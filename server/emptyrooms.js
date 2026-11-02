// Empty rooms go away (Jens, 2 Nov 2026: "Jag vill att rummen försvinner så fort dom är tomma"): when
// the last person leaves a room, it is deleted after a short grace period (EMPTY_ROOM_GRACE_SECONDS,
// default 10 – enough to survive a page reload) – unless someone came back meanwhile.
// Never deleted: the City ('stad'), profile rooms (only type 'quick' rooms go), a demo room (the demo
// has its own expiry), and the rooms Jens's presets were made from (preset.sourceRoom). A room made
// FROM a preset is an ordinary room and goes like the others. EMPTY_ROOM_DELETE=0 turns this off.
// sweep(): every room in storage that nobody is in right now goes too, with the same exclusions – run
// at startup (after a grace period, so people reconnecting after a restart keep their room) and every
// few minutes (EMPTY_ROOM_SWEEP_MINUTES). A room made in the last freshMs (default 60 s; nobody has
// walked in yet, e.g. the start card's "save and enter" is still loading it) is left for the next sweep.
function createEmptyRoomReaper({ store, isOccupied, keepIds = async () => new Set(), graceMs = 10_000, freshMs = 60_000, clock = () => Date.now(), log = console, timers = { setTimeout, clearTimeout } } = {}) {
  const pending = new Map(); // id -> timer
  function cancel(id) { const t = pending.get(id); if (t) { timers.clearTimeout(t); pending.delete(id); } }
  async function reap(id, { keep = null, fresh = 0, why = `stood empty for ${Math.round(graceMs / 1000)} s` } = {}) {
    pending.delete(id);
    if (!id || id === 'stad' || isOccupied(id)) return false;
    if ((keep || await keepIds()).has(id)) return false;
    const room = await store.peek(id).catch(() => null);
    if (!room || room.type !== 'quick' || room.demo) return false;
    if (fresh && room.createdAt && clock() - Date.parse(room.createdAt) < fresh) return false;
    if (isOccupied(id)) return false; // someone came in while we looked
    await store.deleteRoom(id);
    log.log?.(`[rooms] ${id} ${why} – deleted`);
    return true;
  }
  async function sweep() {
    const keep = await keepIds(), deleted = [];
    for (const id of await store.listRooms()) {
      if (pending.has(id)) continue; // its own timer takes it
      try { if (await reap(id, { keep, fresh: freshMs, why: 'was empty (sweep)' })) deleted.push(id); } catch (e) { log.error?.('[rooms] sweep: delete failed', id, e && e.message); }
    }
    return deleted;
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
    sweep,
    stop() { for (const id of [...pending.keys()]) cancel(id); },
  };
}
module.exports = { createEmptyRoomReaper };

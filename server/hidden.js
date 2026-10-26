// Hidden stickers: the ones (almost) fully covered by newer stickers (shared/coverage.mjs).
//
//   clear(room)  "Clear hidden stickers" (the room's creator / admin): removes every hidden sticker
//                and clears the peel history of the ones that stay, in ONE locked step, so the kept
//                stickers become the room's new base layer and nobody can peel back into removed ones.
//   count(room)  how many would go (for the confirm dialog).
//   left(room, ids)  automatic cleanup: called when stickers leave the peel history (nobody can peel
//                them any more). Batched per room (debounced), then only those stickers are checked,
//                and the hidden ones are removed and broadcast as ordinary stamp:remove (quiet: true).
//                Kill switch: AUTO_PRUNE_HIDDEN=0.
const coverageMod = import('../shared/coverage.mjs');

function createHidden({ store, imageMeta, imageMask, broadcast, log = console, auto = true, delayMs = 1500, maxWaitMs = 8000 } = {}) {
  // Image sizes and die-cut masks for the stickers (cached by the caller). A sticker whose image
  // is gone is left out: it is not drawn, so it neither covers nor gets removed.
  async function fill(inp, stamps) {
    const ids = [...new Set(stamps.map((s) => s.imageId))].filter((id) => !inp.images.has(id) && !inp.missing.has(id));
    await Promise.all(ids.map(async (id) => {
      const meta = await imageMeta(id).catch(() => null);
      if (!meta) { inp.missing.add(id); return; }
      inp.images.set(id, meta);
      inp.masks.set(id, await imageMask(id).catch(() => null));
    }));
    return inp;
  }
  const fresh = () => ({ images: new Map(), masks: new Map(), missing: new Set() });

  async function count(roomId) {
    const C = await coverageMod;
    const room = await store.getRoom(roomId);
    if (!room) return null;
    const inp = await fill(fresh(), room.stamps);
    return { hidden: C.hiddenStamps(room.stamps, inp).length, total: room.stamps.length };
  }

  async function clear(roomId) {
    const C = await coverageMod;
    const snap = await store.getRoom(roomId); // masks first, outside the lock (slow the first time)
    if (!snap) return null;
    const inp = await fill(fresh(), snap.stamps);
    const t0 = Date.now();
    const r = await store.editRoom(roomId, async (room) => {
      await fill(inp, room.stamps); // anything slapped in the meantime
      const removed = C.hiddenStamps(room.stamps, inp).map((h) => h.id);
      const gone = new Set(removed);
      if (gone.size) room.stamps = room.stamps.filter((s) => !gone.has(s.id));
      let historyCleared = 0;
      for (const s of room.stamps) if (s.peelHash || s.peelOwner) { delete s.peelHash; delete s.peelOwner; historyCleared++; }
      return { removed, historyCleared, kept: room.stamps.length, save: !!(gone.size || historyCleared) };
    });
    if (r === 'notfound') return null;
    pending.delete(roomId); // nothing left in anyone's history in this room
    log.log(`[hidden] room ${roomId}: cleared ${r.removed.length} hidden stickers, ${r.kept} kept, ${r.historyCleared} peel keys dropped (${Date.now() - t0} ms)`);
    return r;
  }

  // ---------- Automatic cleanup ----------
  const pending = new Map(); // room -> Set(ids that left the history)
  const timers = new Map(); // room -> { timer, first }
  const running = new Map(); // room -> Promise
  function left(roomId, ids) {
    if (!auto || !ids || !ids.length) return;
    let set = pending.get(roomId);
    if (!set) pending.set(roomId, (set = new Set()));
    for (const id of ids) set.add(id);
    const now = Date.now(), t = timers.get(roomId);
    if (t) clearTimeout(t.timer);
    const first = t ? t.first : now;
    const wait = Math.max(0, Math.min(delayMs, first + maxWaitMs - now)); // debounced, but never starved by steady slapping
    const timer = setTimeout(() => { timers.delete(roomId); run(roomId).catch((e) => log.error(`[auto-prune] room ${roomId}: ${e && e.message}`)); }, wait);
    if (timer.unref) timer.unref();
    timers.set(roomId, { timer, first });
  }
  function run(roomId) {
    const prev = running.get(roomId) || Promise.resolve();
    const p = prev.then(() => prune(roomId));
    const tail = p.catch(() => {});
    running.set(roomId, tail);
    tail.then(() => { if (running.get(roomId) === tail) running.delete(roomId); });
    return p;
  }
  async function prune(roomId) {
    const ids = pending.get(roomId); pending.delete(roomId);
    if (!ids || !ids.size) return { checked: 0, removed: [] };
    const C = await coverageMod;
    const snap = await store.getRoom(roomId);
    if (!snap) return { checked: 0, removed: [] };
    const inp = await fill(fresh(), snap.stamps);
    const t0 = Date.now();
    const r = await store.editRoom(roomId, async (room) => {
      // Only stickers that are still there and still out of everyone's history.
      const cands = room.stamps.filter((s) => ids.has(s.id) && !s.peelHash).map((s) => s.id);
      if (!cands.length) return { checked: 0, removed: [], save: false };
      await fill(inp, room.stamps);
      const removed = C.hiddenStamps(room.stamps, { ...inp, candidates: cands }).map((h) => h.id);
      const gone = new Set(removed);
      if (gone.size) room.stamps = room.stamps.filter((s) => !gone.has(s.id));
      return { checked: cands.length, removed, save: gone.size > 0 };
    });
    if (r === 'notfound') return { checked: 0, removed: [] };
    for (const id of r.removed) broadcast(roomId, { type: 'stamp:remove', id, quiet: true, reason: 'hidden' });
    log.log(`[auto-prune] room ${roomId}: checked ${r.checked}, removed ${r.removed.length} hidden (${Date.now() - t0} ms)`);
    return r;
  }
  // Tests / shutdown: run everything that is waiting now.
  async function settle() {
    for (const [id, t] of timers) { clearTimeout(t.timer); timers.delete(id); run(id).catch(() => {}); }
    await Promise.all([...running.values()]);
  }
  function close() { for (const t of timers.values()) clearTimeout(t.timer); timers.clear(); pending.clear(); }
  return { count, clear, left, settle, close, get auto() { return auto; } };
}

const autoPruneOn = (env = process.env) => !['0', 'false', 'off', 'no'].includes(String(env.AUTO_PRUNE_HIDDEN ?? '').trim().toLowerCase());
module.exports = { createHidden, autoPruneOn };

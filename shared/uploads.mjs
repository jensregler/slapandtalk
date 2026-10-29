// Own sticker uploads per version (Jens, 29 Oct 2026, point 9): the free version may have exactly
// ONE own uploaded image as a sticker (next to the free library deck); a new upload replaces it.
// The full version (entitlement 'uploads') keeps as many as you like. While OPEN_ACCESS is on
// everyone has 'uploads', so nothing changes until the paywall comes back.
// Uploads live on the device (localStorage klibb.mine, newest last; designs.js) – there are no
// accounts, so this is the browser's rule; the server has no per-person count to check against.
export const FREE_UPLOADS = 1;

// mine = my uploads (oldest first), newId = the one just uploaded, full = has('uploads').
// → the ids to drop so the free version keeps only the new one (none for the full version).
export function uploadsToReplace(mine, newId, full) {
  if (full) return [];
  const others = mine.filter((m) => m.id !== newId);
  return others.slice(0, Math.max(0, others.length - (FREE_UPLOADS - 1))).map((m) => m.id);
}
// What the palette/wheel shows: the free version only the newest upload (older ones stay on the
// device, untouched, and come back with the full version).
export const shownUploads = (mine, full) => (full ? mine : mine.slice(-FREE_UPLOADS));

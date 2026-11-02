// The Instagram name (Jens, 31 Oct 2026): shown with an @ in smaller text under the name above
// your head. Kept in the look (look.insta), so it is synced, recorded and saved like the rest.
// Letters, digits, . and _ only, at most 30 (Instagram's own rule); a leading @ is dropped.
export const INSTA_MAX = 30;
export function cleanInsta(s) {
  return String(s ?? '').trim().replace(/^@+/, '').replace(/[^A-Za-z0-9._]/g, '').slice(0, INSTA_MAX).toLowerCase();
}

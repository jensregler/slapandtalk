// Sticker credits from the file name (Jens, 2 Nov 2026). The rule (Instagram-safe: a handle has no
// spaces, no "-" and no "@"):
//   "<sticker name> - <Creator name> @<instagramhandle>.png"   e.g. "d71 - Jens Tjerngren @jensregler.png"
//   "<sticker name> - <Creator name>.png"                      e.g. "blomma - Jens Tjerngren.png" (no Instagram)
//   "<sticker name>.png"                                       e.g. "blomma.png" (no credit)
// The first " - " (space, dash, space) splits the sticker's name from the creator; a last word that
// starts with @ is the Instagram handle ("blomma - @jensregler.png": only the handle). A size letter
// ("B_…", shared/sizeprefix.mjs) is taken off before this. → { title, artist, insta, link }.
import { cleanInsta } from './insta.mjs';

const tidy = (s) => String(s || '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
export function creditFromName(fileName) {
  const base = String(fileName || '').split(/[\\/]/).pop().replace(/\.[A-Za-z0-9]{2,5}$/, '');
  const i = base.indexOf(' - ');
  if (i < 0) return { title: tidy(base).slice(0, 80), artist: '', insta: '', link: '' };
  const title = tidy(base.slice(0, i)).slice(0, 80);
  let rest = base.slice(i + 3).trim(), insta = '';
  const m = /(?:^|\s)@([A-Za-z0-9._]{1,30})\s*$/.exec(rest);
  if (m) { insta = cleanInsta(m[1]); rest = rest.slice(0, m.index); }
  const artist = tidy(rest).slice(0, 60) || (insta ? '@' + insta : '');
  return { title, artist, insta, link: insta ? `https://www.instagram.com/${insta}` : '' };
}

// Konstnärens länk på en klibba ("Your link" under ⚙ More). Samma regler i webbläsaren och på
// servern: servern kör cleanArtistLink på allt den tar emot, så en elak klient kan inte
// smyga in javascript:, data: eller liknande.
//
//   @namn                      -> https://www.instagram.com/namn
//   instagram.com/namn, x.com/namn, tiktok.com/@namn, youtube.com/@namn (utan https://) -> https://…
//   https://min-sajt.se/…     -> som den är (http:// blir https://)
//   allt annat (andra scheman, inloggning i länken, mellanslag, för långt) -> '' (ingen länk)
export const LINK_MAX = 200;
export const ARTIST_MAX = 60;

const HANDLE_RE = /^@([A-Za-z0-9._]{1,30})$/;
const KNOWN = [
  { re: /(^|\.)instagram\.com$/i, name: 'Instagram' },
  { re: /(^|\.)(x|twitter)\.com$/i, name: 'X' },
  { re: /(^|\.)tiktok\.com$/i, name: 'TikTok' },
  { re: /(^|\.)(youtube\.com|youtu\.be)$/i, name: 'YouTube' },
];

export function cleanArtistLink(input) {
  if (typeof input !== 'string') return '';
  let s = input.trim();
  if (!s || s.length > LINK_MAX) return '';
  if (/[\s\u0000-\u001f\u007f<>"'`\\]/.test(s)) return '';
  const h = HANDLE_RE.exec(s);
  if (h) return 'https://www.instagram.com/' + h[1];
  // Utan schema? Bara om det ser ut som en adress (namn.tld/…), inte "javascript:…".
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    if (s.startsWith('//')) s = s.slice(2);
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#]|$)/i.test(s)) return '';
    s = 'https://' + s;
  }
  let u;
  try { u = new URL(s); } catch { return ''; }
  if (u.protocol === 'http:') u.protocol = 'https:';
  if (u.protocol !== 'https:') return '';
  if (u.username || u.password || u.port) return '';
  const host = u.hostname.toLowerCase();
  // Ett riktigt namn med punkt, inga IP-adresser eller localhost.
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(host) || host.split('.').some((p) => !p || p.startsWith('-') || p.endsWith('-'))) return '';
  const out = u.href;
  return out.length > LINK_MAX ? '' : out;
}

// Kort text för etiketten: "@namn · Instagram", annars "min-sajt.se/sida".
export function linkLabel(url) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  const known = KNOWN.find((k) => k.re.test(host));
  const first = u.pathname.split('/').filter(Boolean)[0] || '';
  if (known && first && !/^(watch|channel|c|p|reel|status)$/i.test(first)) {
    return `@${decodeURIComponentSafe(first).replace(/^@/, '')} · ${known.name}`;
  }
  const rest = (u.pathname + u.search).replace(/\/$/, '');
  const text = host + rest;
  return text.length > 48 ? text.slice(0, 47) + '…' : text;
}

export function cleanArtistName(input) {
  return String(input ?? '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, ARTIST_MAX);
}

function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }

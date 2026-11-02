// The Town Hall's packs (Jens, 2 Nov 2026, t476u). In the city you carry the Priority Mail pack you
// made at the door (3 slaps, a name, a drawing on the label; client/src/door.js). Inside the Town
// Hall you can hand it in: it stays there for one week (PACK_DAYS) for everyone to see. Once yours is
// in, you may take two packs that other people handed in (MAX_TAKES) – so at most 3 packs, 9 stickers
// to slap in the city. Taking a pack copies it (it stays in the Town Hall for the others).
//
// Who you are: handing in returns a secret token (only its hash is stored); the browser keeps it.
// Storage (the same adapter as everything else):
//   "citypacks/<id>.json"  { id, name, stickers: [imageId ×3], ownerHash, takes: [packId], createdAt, expiresAt }
//   "citypacks/<id>.webp"  the pack's picture (the bag with the stickers and the label drawing)
// Expired packs are dropped (files deleted) the next time the list is read.
const crypto = require('crypto');
const sharp = require('sharp');

const PACK_DAYS = 7;
const MAX_TAKES = 2;
const ID_RE = /^[a-f0-9]{12}$/;
const PW = 563, PH = 802;
const cleanName = (v) => Array.from(String(v ?? '').normalize('NFC').replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '').replace(/\s+/g, ' ').trim()).slice(0, 30).join('').trim();
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const err = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

// imageInfo(id) → the sticker's public image ({ id, url, width, height, … }) or null.
function createCityPacks(adapter, { imageInfo, clock = () => Date.now(), log = console } = {}) {
  let cache = null; // id -> pack (this server is the only writer)
  async function load() {
    if (cache) return cache;
    const next = new Map();
    const keys = await adapter.list('citypacks/');
    for (const k of keys) {
      const m = /^citypacks\/([a-f0-9]{12})\.json$/.exec(k); if (!m) continue;
      try { const buf = await adapter.get(k); if (buf) { const p = JSON.parse(buf.toString('utf8')); if (p && p.id === m[1]) next.set(p.id, p); } } catch { /* broken: skip */ }
    }
    cache = next; return cache;
  }
  const active = (p) => p && Date.parse(p.expiresAt) > clock();
  async function drop(p) {
    (await load()).delete(p.id);
    for (const k of [`citypacks/${p.id}.json`, `citypacks/${p.id}.webp`]) await adapter.delete(k).catch((e) => log.error?.('[citypacks] delete failed', k, e && e.message));
  }
  async function sweep() { for (const p of [...(await load()).values()]) if (!active(p)) await drop(p); }
  const save = async (p) => { await adapter.put(`citypacks/${p.id}.json`, Buffer.from(JSON.stringify(p)), 'application/json'); (await load()).set(p.id, p); };
  async function pub(p) {
    const stickers = [];
    for (const id of p.stickers) { const im = await imageInfo(id); stickers.push(im ? { id: im.id, url: im.url, width: im.width, height: im.height } : { id, gone: true }); }
    return { id: p.id, name: p.name, stickers, img: `/api/city/packs/${p.id}.webp?v=${Date.parse(p.createdAt)}`, createdAt: p.createdAt, expiresAt: p.expiresAt };
  }
  async function mineOf(token) {
    if (typeof token !== 'string' || token.length < 20) return null;
    const h = hash(token);
    for (const p of (await load()).values()) if (p.ownerHash === h && active(p)) return p;
    return null;
  }

  // Hand in: { name, stickers: [3 image ids], img: Buffer (the picture) } → { pack, token }.
  async function handIn({ name, stickers, img, token = null }) {
    await sweep();
    const old = await mineOf(token);
    if (old) throw err(409, 'Your pack is already in the Town Hall', { pack: await pub(old) });
    if (!Array.isArray(stickers) || stickers.length !== 3 || new Set(stickers).size !== 3) throw err(400, 'A pack has 3 different stickers');
    for (const id of stickers) if (typeof id !== 'string' || !(await imageInfo(id))) throw err(400, 'One of the stickers is not on the server');
    if (!Buffer.isBuffer(img) || !img.length) throw err(400, 'The pack picture is missing');
    let webp;
    try { webp = await sharp(img).resize(PW, PH, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 86, alphaQuality: 90 }).toBuffer(); } catch { throw err(400, 'The pack picture could not be read'); }
    const t = token && typeof token === 'string' && token.length >= 20 ? token : crypto.randomBytes(24).toString('base64url');
    const now = clock();
    const p = { id: crypto.randomBytes(6).toString('hex'), name: cleanName(name) || 'My pack', stickers, ownerHash: hash(t), takes: [],
      createdAt: new Date(now).toISOString(), expiresAt: new Date(now + PACK_DAYS * 864e5).toISOString() };
    await adapter.put(`citypacks/${p.id}.webp`, webp, 'image/webp');
    await save(p);
    return { pack: await pub(p), token: t };
  }
  // The Town Hall's wall: every pack in it (newest first) + mine (with what I took) if the token is mine.
  async function list(token = null, max = 60) {
    await sweep();
    const mine = await mineOf(token);
    const all = [...(await load()).values()].filter(active).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const packs = [];
    for (const p of all.slice(0, max)) packs.push({ ...(await pub(p)), mine: p === mine, taken: !!mine && mine.takes.includes(p.id) });
    return { packs, mine: mine ? { ...(await pub(mine)), takes: mine.takes.slice(), left: MAX_TAKES - mine.takes.length } : null, maxTakes: MAX_TAKES, days: PACK_DAYS };
  }
  // Take (swap for) someone else's pack: only with my own pack handed in, at most MAX_TAKES.
  async function take(id, token) {
    const mine = await mineOf(token);
    if (!mine) throw err(403, 'Hand in your own pack first');
    if (!ID_RE.test(String(id))) throw err(404, 'No such pack');
    const p = (await load()).get(id);
    if (!active(p)) throw err(404, 'That pack has left the Town Hall');
    if (p.id === mine.id) throw err(400, 'That is your own pack');
    if (mine.takes.includes(p.id)) return { pack: await pub(p), takes: mine.takes.slice(), left: MAX_TAKES - mine.takes.length };
    if (mine.takes.length >= MAX_TAKES) throw err(409, `You have taken ${MAX_TAKES} packs already`);
    mine.takes.push(p.id); await save(mine);
    return { pack: await pub(p), takes: mine.takes.slice(), left: MAX_TAKES - mine.takes.length };
  }
  async function image(id) {
    if (!ID_RE.test(String(id))) return null;
    const p = (await load()).get(id); if (!active(p)) return null;
    return adapter.get(`citypacks/${id}.webp`);
  }
  return { handIn, list, take, image, sweep, PACK_DAYS, MAX_TAKES };
}
module.exports = { createCityPacks, PACK_DAYS, MAX_TAKES };

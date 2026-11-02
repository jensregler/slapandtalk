// The Town Hall's pack shop (Jens, t476u + t479u, 2 Nov 2026). In the city you carry the Priority Mail
// pack you made at the door (3 slaps, a name, a drawing on the label; client/src/door.js).
//  - ONE shop for every city: a pack handed in in one city's Town Hall is in all of them.
//  - Handing in: the pack (its picture and 3 stickers) + a few words about yourself and the stickers
//    (about), your name and Instagram. A free player's pack stays one week (PACK_DAYS); a paying
//    player's stays for good, in the archive (expiresAt null) – and a paying player may hand in more.
//  - Once yours is in, you may take packs from other people: taking copies it (it stays in the shop).
//    A free player carries at most 3 packs (theirs + MAX_TAKES = 2) and drops what they took when
//    they leave the city (drop()); a paying player keeps them (up to PAID_MAX_TAKES).
// Who you are: handing in returns a secret token (only its hash is stored); the browser keeps it.
// "Paid" is decided by the server per request (server/entitlements.js resolve.paid – not OPEN ACCESS).
// Storage (the same adapter as everything else):
//   "citypacks/<id>.json"     { id, name, stickers: [imageId ×3], ownerHash, author: { name, insta }, about,
//                               paid, takenCount, createdAt, expiresAt (null = for good) }
//   "citypacks/<id>.webp"     the pack's picture (the bag with the stickers and the label drawing)
//   "citycarry/<hash>.json"   { takes: [packId], at } – what that owner took (packs that left are skipped)
// Expired packs are dropped (files deleted) the next time the list is read.
const crypto = require('crypto');
const sharp = require('sharp');
const { cleanInsta } = require('../shared/insta.mjs');

const PACK_DAYS = 7;
const MAX_TAKES = 2; // free: your pack + 2 = 3 packs, 9 stickers
const PAID_MAX_TAKES = 74; // paid: (228 − your 3 − the exit/pack buttons) / 3 – the deck holds 228 at most
const ABOUT_MAX = 400;
const ID_RE = /^[a-f0-9]{12}$/;
const PW = 563, PH = 802;
const clean = (v, max) => Array.from(String(v ?? '').normalize('NFC').replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '').replace(/\s+/g, ' ').trim()).slice(0, max).join('').trim();
// the description may keep its line breaks (at most 2 in a row)
const cleanAbout = (v) => Array.from(String(v ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, (c) => (c === '\n' ? c : '')).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()).slice(0, ABOUT_MAX).join('').trim();
const cleanName = (v) => clean(v, 30);
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
  const active = (p) => !!p && (p.expiresAt == null || Date.parse(p.expiresAt) > clock());
  async function drop(p) {
    (await load()).delete(p.id);
    for (const k of [`citypacks/${p.id}.json`, `citypacks/${p.id}.webp`]) await adapter.delete(k).catch((e) => log.error?.('[citypacks] delete failed', k, e && e.message));
  }
  async function sweep() { for (const p of [...(await load()).values()]) if (!active(p)) await drop(p); }
  const save = async (p) => { await adapter.put(`citypacks/${p.id}.json`, Buffer.from(JSON.stringify(p)), 'application/json'); (await load()).set(p.id, p); };
  const newest = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));
  async function pub(p) {
    const stickers = [];
    for (const id of p.stickers) { const im = await imageInfo(id); stickers.push(im ? { id: im.id, url: im.url, width: im.width, height: im.height } : { id, gone: true }); }
    return { id: p.id, name: p.name, stickers, img: `/api/city/packs/${p.id}.webp?v=${Date.parse(p.createdAt)}`, author: p.author || { name: '', insta: '' }, about: p.about || '',
      forever: p.expiresAt == null, takenCount: p.takenCount || 0, createdAt: p.createdAt, expiresAt: p.expiresAt };
  }
  const ownerOf = (token) => (typeof token === 'string' && token.length >= 20 ? hash(token) : null);
  // my packs in the shop now (newest first); mine = the newest
  async function minesOf(token) {
    const h = ownerOf(token); if (!h) return [];
    return [...(await load()).values()].filter((p) => p.ownerHash === h && active(p)).sort(newest);
  }
  // what the owner took (a file per owner; before 3 Nov it was on the pack: p.takes)
  async function carryOf(h, mine) {
    let c = null; try { const b = await adapter.get(`citycarry/${h}.json`); if (b) c = JSON.parse(b.toString('utf8')); } catch { c = null; }
    if (!c) c = { takes: Array.isArray(mine?.takes) ? mine.takes.slice() : [] };
    return { takes: (c.takes || []).filter((id) => ID_RE.test(String(id))), at: c.at || null };
  }
  const saveCarry = (h, c) => adapter.put(`citycarry/${h}.json`, Buffer.from(JSON.stringify({ takes: c.takes, at: new Date(clock()).toISOString() })), 'application/json');
  const limit = (paid) => (paid ? PAID_MAX_TAKES : MAX_TAKES);

  // Hand in: { name, stickers: [3 image ids], img: Buffer, about, author, insta, paid } → { pack, token }.
  async function handIn({ name, stickers, img, token = null, about = '', author = '', insta = '', paid = false }) {
    await sweep();
    const old = (await minesOf(token))[0];
    if (old && !paid) throw err(409, 'Your pack is already in the Town Hall', { pack: await pub(old) });
    if (!Array.isArray(stickers) || stickers.length !== 3 || new Set(stickers).size !== 3) throw err(400, 'A pack has 3 different stickers');
    for (const id of stickers) if (typeof id !== 'string' || !(await imageInfo(id))) throw err(400, 'One of the stickers is not on the server');
    if (!Buffer.isBuffer(img) || !img.length) throw err(400, 'The pack picture is missing');
    let webp;
    try { webp = await sharp(img).resize(PW, PH, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 86, alphaQuality: 90 }).toBuffer(); } catch { throw err(400, 'The pack picture could not be read'); }
    const t = ownerOf(token) ? token : crypto.randomBytes(24).toString('base64url');
    const now = clock();
    const p = { id: crypto.randomBytes(6).toString('hex'), name: cleanName(name) || 'My pack', stickers, ownerHash: hash(t),
      author: { name: clean(author, 24), insta: cleanInsta(insta) }, about: cleanAbout(about), paid: !!paid, takenCount: 0,
      createdAt: new Date(now).toISOString(), expiresAt: paid ? null : new Date(now + PACK_DAYS * 864e5).toISOString() };
    await adapter.put(`citypacks/${p.id}.webp`, webp, 'image/webp');
    await save(p);
    return { pack: await pub(p), token: t };
  }
  // The shop: every pack in it (newest first) + mine and what I carry, if the token is mine.
  async function list(token = null, { paid = false, max = 200 } = {}) {
    await sweep();
    const mines = await minesOf(token), mine = mines[0] || null, h = ownerOf(token);
    const carry = mine ? await carryOf(h, mine) : { takes: [] };
    const all = [...(await load()).values()].filter(active).sort(newest);
    const packs = [];
    for (const p of all.slice(0, max)) packs.push({ ...(await pub(p)), mine: !!h && p.ownerHash === h, taken: carry.takes.includes(p.id) });
    const left = Math.max(0, limit(paid) - carry.takes.length);
    return { packs, mine: mine ? { ...(await pub(mine)), takes: carry.takes.slice(), left } : null, mineCount: mines.length,
      paid: !!paid, maxTakes: limit(paid), maxPacks: limit(paid) + 1, days: PACK_DAYS };
  }
  // Take someone else's pack: only with my own pack handed in; free at most MAX_TAKES.
  async function take(id, token, { paid = false } = {}) {
    const mines = await minesOf(token), mine = mines[0];
    if (!mine) throw err(403, 'Hand in your own pack first');
    if (!ID_RE.test(String(id))) throw err(404, 'No such pack');
    const p = (await load()).get(id);
    if (!active(p)) throw err(404, 'That pack has left the Town Hall');
    if (p.ownerHash === mine.ownerHash) throw err(400, 'That is your own pack');
    const h = mine.ownerHash, carry = await carryOf(h, mine);
    const res = () => ({ pack: p, takes: carry.takes.slice(), left: Math.max(0, limit(paid) - carry.takes.length) });
    if (carry.takes.includes(p.id)) { const r = res(); return { ...r, pack: await pub(p) }; }
    if (carry.takes.length >= limit(paid)) throw err(409, paid ? `You carry ${limit(paid)} packs already` : `You can carry ${limit(paid) + 1} packs: yours and ${limit(paid)} more`);
    carry.takes.push(p.id); await saveCarry(h, carry);
    p.takenCount = (p.takenCount || 0) + 1; await save(p);
    const r = res(); return { ...r, pack: await pub(p) };
  }
  // Leaving the city: a free player drops what they took (their own pack stays in the shop). A paying
  // player keeps it. → { takes, left }
  async function dropTaken(token, { paid = false } = {}) {
    const h = ownerOf(token); if (!h) return { takes: [], left: limit(paid) };
    const mine = (await minesOf(token))[0], carry = await carryOf(h, mine);
    if (!paid && carry.takes.length) { carry.takes = []; await saveCarry(h, carry); }
    return { takes: carry.takes.slice(), left: Math.max(0, limit(paid) - carry.takes.length) };
  }
  // Admin: take a pack out of the shop (illegal content – README "Admin").
  async function remove(id) {
    if (!ID_RE.test(String(id))) return false;
    const p = (await load()).get(id); if (!p) return false;
    await drop(p); return true;
  }
  async function image(id) {
    if (!ID_RE.test(String(id))) return null;
    const p = (await load()).get(id); if (!active(p)) return null;
    return adapter.get(`citypacks/${id}.webp`);
  }
  return { handIn, list, take, dropTaken, remove, image, sweep, PACK_DAYS, MAX_TAKES, PAID_MAX_TAKES };
}
module.exports = { createCityPacks, PACK_DAYS, MAX_TAKES, PAID_MAX_TAKES, ABOUT_MAX };

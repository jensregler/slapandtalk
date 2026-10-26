#!/usr/bin/env node
// Import a folder of sticker images into the curated library (library/manifest.json + library/images/).
//
//   node tools/import-library.mjs <folder> [--csv artists.csv] [--artist "Default Name"] [--replace] [--dry-run]
//
// Each image is re-encoded exactly like an upload (auto-rotate, max 1024 px, WebP q90 with full
// alpha, metadata such as GPS stripped) and gets a content-hash id, so the same picture twice is
// one sticker. Formats: PNG, JPG/JPEG, WebP, GIF (first frame), AVIF, TIFF. Other files are skipped.
//
// The artist's name for each image, first match wins:
//   1. --csv: a CSV with a header row: file,artist[,link]   (file = name relative to <folder>, or just the file name)
//   2. a subfolder: <folder>/<Artist Name>/image.png
//   3. the file name: "Artist Name - title.png" or "Artist Name__title.png"
//   4. --artist "Name"   (else empty: the sticker shows no credit)
// --replace  start from an empty library (otherwise new images are added, existing ids updated)
// --dry-run  report only, write nothing
// After importing, commit library/ and deploy: the server copies new stickers to storage at start-up.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_PX = 1024;
const EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.tif', '.tiff']);

export function parseArgs(argv) {
  const o = { folder: null, csv: null, artist: '', replace: false, dry: false, out: path.join(ROOT, 'library') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--csv') o.csv = argv[++i];
    else if (a === '--artist') o.artist = argv[++i] || '';
    else if (a === '--replace') o.replace = true;
    else if (a === '--dry-run') o.dry = true;
    else if (a === '--out') o.out = argv[++i];
    else if (!o.folder) o.folder = a;
  }
  return o;
}
// A small CSV reader (quoted fields, commas inside quotes).
export function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (ch === '"') q = false; else f += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(f); f = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; } else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const clean = rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some(Boolean));
  if (!clean.length) return new Map();
  const head = clean[0].map((h) => h.toLowerCase());
  const fi = head.indexOf('file'), ai = head.indexOf('artist'), li = head.indexOf('link');
  const map = new Map();
  for (const r of clean.slice(fi >= 0 ? 1 : 0)) {
    const file = r[fi >= 0 ? fi : 0]; if (!file) continue;
    const v = { artist: r[ai >= 0 ? ai : 1] || '', link: li >= 0 ? r[li] || '' : '' };
    map.set(file.replace(/\\/g, '/').toLowerCase(), v);
    map.set(path.basename(file).toLowerCase(), v);
  }
  return map;
}
const tidy = (s) => String(s || '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
// Artist for one file (rel = path relative to the folder, with /).
export function artistFor(rel, { csv = new Map(), fallback = '' } = {}) {
  const hit = csv.get(rel.toLowerCase()) || csv.get(path.basename(rel).toLowerCase());
  if (hit && (hit.artist || hit.link)) return { artist: tidy(hit.artist), link: hit.link || '' };
  const parts = rel.split('/');
  if (parts.length > 1) return { artist: tidy(parts[parts.length - 2]), link: '' };
  const base = path.basename(rel, path.extname(rel));
  const m = /^(.+?)\s+-\s+.+$/.exec(base) || /^(.+?)__.+$/.exec(base);
  if (m) return { artist: tidy(m[1]), link: '' };
  return { artist: tidy(fallback), link: '' };
}
function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out); else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}
// Same treatment as POST /api/stickers in server/app.js.
export async function encode(buf) {
  const out = await sharp(buf, { limitInputPixels: 60e6, animated: false }).rotate()
    .resize(MAX_PX, MAX_PX, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 90, alphaQuality: 100 }).toBuffer({ resolveWithObject: true });
  return { data: out.data, width: out.info.width, height: out.info.height, id: crypto.createHash('sha256').update(out.data).digest('hex').slice(0, 16) };
}

export async function importFolder(o, log = console.log) {
  if (!o.folder || !fs.existsSync(o.folder)) throw new Error('Give a folder: node tools/import-library.mjs <folder> [--csv artists.csv] [--artist "Name"]');
  const csv = o.csv ? parseCsv(fs.readFileSync(o.csv, 'utf8')) : new Map();
  const manPath = path.join(o.out, 'manifest.json'), imgDir = path.join(o.out, 'images');
  let man = { stickers: [] };
  if (!o.replace && fs.existsSync(manPath)) man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
  const byId = new Map(man.stickers.map((s) => [s.id, s]));
  const report = { added: 0, updated: 0, duplicates: 0, skipped: [], failed: [], noArtist: [] };
  const seen = new Set();
  for (const rel of walk(o.folder)) {
    if (!EXT.has(path.extname(rel).toLowerCase())) { report.skipped.push(rel); continue; }
    let enc;
    try { enc = await encode(fs.readFileSync(path.join(o.folder, rel))); } catch (e) { report.failed.push(`${rel}: ${e.message}`); continue; }
    if (seen.has(enc.id)) { report.duplicates++; continue; }
    seen.add(enc.id);
    const { artist, link } = artistFor(rel, { csv, fallback: o.artist });
    if (!artist) report.noArtist.push(rel);
    const entry = { id: enc.id, file: `${enc.id}.webp`, width: enc.width, height: enc.height, artist, ...(link ? { link } : {}), source: path.basename(rel) };
    if (byId.has(enc.id)) report.updated++; else report.added++;
    byId.set(enc.id, entry);
    if (!o.dry) { fs.mkdirSync(imgDir, { recursive: true }); fs.writeFileSync(path.join(imgDir, entry.file), enc.data); }
  }
  const stickers = [...byId.values()];
  if (!o.dry) {
    if (o.replace) for (const f of fs.existsSync(imgDir) ? fs.readdirSync(imgDir) : []) if (!byId.has(path.basename(f, '.webp'))) fs.unlinkSync(path.join(imgDir, f));
    fs.writeFileSync(manPath, JSON.stringify({ _about: 'Curated sticker library. Built by tools/import-library.mjs; the server seeds these into storage at start-up (server/library.js).', stickers }, null, 1) + '\n');
  }
  log(`${o.dry ? '[dry run] ' : ''}library: ${stickers.length} stickers (${report.added} new, ${report.updated} updated, ${report.duplicates} duplicates skipped)`);
  if (report.skipped.length) log(`skipped (not an image): ${report.skipped.join(', ')}`);
  if (report.failed.length) log(`could not read: ${report.failed.join('; ')}`);
  if (report.noArtist.length) log(`no artist name: ${report.noArtist.join(', ')}`);
  return { ...report, total: stickers.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  importFolder(parseArgs(process.argv.slice(2))).catch((e) => { console.error(e.message); process.exit(1); });
}

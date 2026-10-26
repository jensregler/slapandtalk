// Draws a small placeholder sticker set by hand in code (SVG → PNG), until Jens's real library
// arrives, and imports it: node tools/make-placeholder-library.mjs
// (Real stickers: node tools/import-library.mjs <folder> --csv artists.csv --replace)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { importFolder } from './import-library.mjs';

const W = 512;
const die = (inner, w = W, h = W) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`;
const font = 'font-family="Helvetica, Arial, sans-serif" font-weight="800"';
const SET = {
  'Placeholder - hej': die(`<circle cx="256" cy="256" r="244" fill="#fff"/><circle cx="256" cy="256" r="222" fill="#e6a3b4"/><text x="256" y="300" text-anchor="middle" ${font} font-size="150" fill="#2a2a2c">hej</text>`),
  'Placeholder - star': die(`<polygon points="256,14 318,180 496,186 356,294 404,468 256,368 108,468 156,294 16,186 194,180" fill="#fff"/><polygon points="256,52 304,192 452,198 336,286 376,430 256,346 136,430 176,286 60,198 208,192" fill="#f2c94c"/>`),
  'Placeholder - eye': die(`<ellipse cx="256" cy="256" rx="248" ry="160" fill="#fff"/><ellipse cx="256" cy="256" rx="226" ry="140" fill="#4b78b3"/><circle cx="256" cy="256" r="92" fill="#f1eee7"/><circle cx="256" cy="256" r="46" fill="#111"/><circle cx="276" cy="236" r="14" fill="#fff"/>`),
  'Placeholder - slap': die(`<rect x="8" y="128" width="496" height="256" rx="48" fill="#fff"/><rect x="28" y="148" width="456" height="216" rx="34" fill="#2a2a2c"/><text x="256" y="300" text-anchor="middle" ${font} font-size="132" fill="#f1eee7" letter-spacing="6">SLAP</text>`),
  'Placeholder - blob': die(`<path d="M256 16c88 0 120 70 178 110s72 120 30 190-96 138-208 180S56 440 30 360 6 210 70 140 168 16 256 16z" fill="#fff"/><path d="M256 40c78 0 106 62 158 98s64 106 26 170-86 124-184 160S74 424 52 352 32 216 88 154 178 40 256 40z" fill="#5e8d69"/><circle cx="200" cy="230" r="22" fill="#111"/><circle cx="312" cy="230" r="22" fill="#111"/><path d="M196 318q60 44 120 0" stroke="#111" stroke-width="14" fill="none" stroke-linecap="round"/>`),
  'Placeholder - talk': die(`<path d="M60 40h392a52 52 0 0 1 52 52v236a52 52 0 0 1-52 52H220l-110 96 16-96H60a52 52 0 0 1-52-52V92a52 52 0 0 1 52-52z" fill="#fff"/><path d="M66 62h380a36 36 0 0 1 36 36v224a36 36 0 0 1-36 36H212l-80 68 12-68H66a36 36 0 0 1-36-36V98a36 36 0 0 1 36-36z" fill="#b4413a"/><text x="256" y="250" text-anchor="middle" ${font} font-size="104" fill="#fff">talk</text>`),
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-lib-'));
for (const [name, svg] of Object.entries(SET)) await sharp(Buffer.from(svg)).png().toFile(path.join(dir, `${name}.png`));
await importFolder({ folder: dir, csv: null, artist: '', replace: true, dry: false, out: new URL('../library', import.meta.url).pathname });
fs.rmSync(dir, { recursive: true, force: true });

// Gör om CC0-texturer från ambientCG (https://ambientcg.com, licens CC0 1.0) till lätta WebP-filer.
// Körs en gång: ladda ner *_1K-JPG.zip för varje id nedan, packa upp i en mapp och kör
//   node tools/make-textures.js <mapp>
// Resultat: client/public/textures/<namn>.webp (1024 px, eller 512 px för asfalt och matta) och thumbs/<namn>.webp (96 px).
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const SOURCES = {
  parkett: 'WoodFloor051', betong: 'Concrete034', asfalt: 'Asphalt031', matta: 'Carpet012',
  tegel: 'Bricks059', trapanel: 'WoodSiding005', puts: 'Plaster001',
};
const SMALL = ['asfalt', 'matta'];
const src = process.argv[2] || '/tmp/acg';
const out = path.join(__dirname, '..', 'client', 'public', 'textures');
fs.mkdirSync(path.join(out, 'thumbs'), { recursive: true });
(async () => {
  for (const [name, id] of Object.entries(SOURCES)) {
    const file = path.join(src, id, `${id}_1K-JPG_Color.jpg`);
    const px = SMALL.includes(name) ? 512 : 1024; // brusiga ytor (asfalt, matta) klarar sig med 512 px
    await sharp(file).resize(px, px).webp({ quality: 78, effort: 6 }).toFile(path.join(out, `${name}.webp`));
    await sharp(file).resize(96, 96).webp({ quality: 70 }).toFile(path.join(out, 'thumbs', `${name}.webp`));
    console.log(name, id, fs.statSync(path.join(out, `${name}.webp`)).size);
  }
})();

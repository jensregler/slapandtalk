// Ritar appikonerna och demo-klibban (körs en gång: node tools/make-icons.js)
const sharp = require('sharp');
const path = require('path');
const icon = (s) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 100 100">
<rect width="100" height="100" fill="#151515"/>
<g transform="rotate(-8 50 50)"><rect x="18" y="24" width="64" height="52" rx="8" fill="#ffd400"/>
<path d="M82 60 L82 68 Q82 76 74 76 L66 76 Z" fill="#c9a700"/>
<text x="50" y="60" font-family="DejaVu Sans, sans-serif" font-weight="900" font-size="24" text-anchor="middle" fill="#111">S&amp;T</text></g></svg>`);
const demo = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="560" viewBox="0 0 800 560">
<g transform="rotate(-4 400 280)">
<rect x="40" y="40" width="720" height="480" rx="60" fill="#fff" stroke="#111" stroke-width="14"/>
<rect x="70" y="70" width="660" height="420" rx="40" fill="#ffd400"/>
<text x="400" y="230" font-family="DejaVu Sans, sans-serif" font-weight="900" font-size="120" text-anchor="middle" fill="#111">SLAP</text>
<text x="400" y="340" font-family="DejaVu Sans, sans-serif" font-weight="700" font-size="60" text-anchor="middle" fill="#111">AND TALK</text>
<rect x="250" y="390" width="300" height="64" rx="32" fill="#111"/>
<text x="400" y="434" font-family="DejaVu Sans, sans-serif" font-weight="700" font-size="38" text-anchor="middle" fill="#ffd400">DEMO</text>
</g></svg>`);
(async () => {
  const dir = path.join(__dirname, '..', 'client', 'public', 'icons');
  for (const s of [192, 512]) await sharp(icon(s)).png().toFile(path.join(dir, `icon-${s}.png`));
  await sharp(demo).png().toFile(path.join(__dirname, '..', 'tests', 'demo-klibba.png'));
  console.log('klart');
})();

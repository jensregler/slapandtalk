// The random character in a preset room (shared/randomlook.mjs, point 8). Run: node tests/roomcharacter.test.mjs
import { createRequire } from 'module';
import { seededLook, roomCharacterSeed, seededRandom, hashSeed } from '../shared/randomlook.mjs';
const require = createRequire(import.meta.url);
const AV = require('../shared/avatar.json');
const { makeEntitlements, FEATURES } = require('../server/entitlements.js');
const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };

const a = seededLook(AV, roomCharacterSeed('room1', 'devA'));
assert(JSON.stringify(a) === JSON.stringify(seededLook(AV, roomCharacterSeed('room1', 'devA'))), 'same room + same device → the same character (stable on reload)');
const looks = new Set(); for (let i = 0; i < 40; i++) looks.add(JSON.stringify(seededLook(AV, roomCharacterSeed('room' + i, 'devA'))));
assert(looks.size >= 38, 'other rooms → other characters');
const others = new Set(); for (let i = 0; i < 40; i++) others.add(JSON.stringify(seededLook(AV, roomCharacterSeed('room1', 'dev' + i))));
assert(others.size >= 38, 'other people in the same room → other characters');
let ok = true, outfits = new Set(), hats = 0, faces = 0;
for (let i = 0; i < 300; i++) {
  const l = seededLook(AV, 'x' + i); outfits.add(l.outfit); if (l.hat) hats++; if (l.face) faces++;
  ok = ok && l.outfit in AV.outfits && l.hair in AV.hair && AV.colors.shirt.includes(l.shirt) && AV.colors.pants.includes(l.pants) && AV.colors.hair.includes(l.hairColor)
    && AV.colors.skin.includes(l.skin) && AV.colors.hat.includes(l.hatColor) && typeof l.hat === 'boolean' && (!l.face || AV.colors.face.includes(l.face)) && !l.fabric && !('name' in l);
}
assert(ok, 'every character uses only valid outfits, hair and colours (skin and sometimes a face colour), no fabrics, no name');
assert(outfits.size === Object.keys(AV.outfits).length && hats > 50 && hats < 140 && faces > 30 && faces < 130, 'all outfits come up; a hat ~30%, an own face colour ~25%');
const r = seededRandom(hashSeed('s')); const xs = Array.from({ length: 1000 }, r);
assert(xs.every((x) => x >= 0 && x < 1) && Math.abs(xs.reduce((s, x) => s + x, 0) / 1000 - 0.5) < 0.05, 'the PRNG gives [0,1), about even');
assert(FEATURES.includes('ownAvatar'), 'ownAvatar is a feature');
const free = makeEntitlements({ OPEN_ACCESS: '0', DEV_UNLOCK: '1' }), open = makeEntitlements({ OPEN_ACCESS: '1' });
assert(free({}).ownAvatar === false && free({ dev: true }).ownAvatar === true && open({}).ownAvatar === true, 'free: no ownAvatar (the room character); full and OPEN_ACCESS: own avatar');
console.log('roomcharacter: all passed');

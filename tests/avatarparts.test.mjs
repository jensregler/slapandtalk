// Mohawk (tupp) and earrings retired (Jens, 7 Nov 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { seededLook } from '../shared/randomlook.mjs';
import { rollLook, freshLook } from '../client/src/restartlook.js';
const require = createRequire(import.meta.url);
const { cleanLook } = require('../server/realtime.js');
const AV = JSON.parse(fs.readFileSync(new URL('../shared/avatar.json', import.meta.url)));

assert.equal(AV.hair.tupp, undefined, 'Mohawk (tupp) gone from avatar.json');
assert.deepEqual(Object.keys(AV.hair).sort(), ['kammad', 'kort', 'lang', 'lugg']);
assert.equal(cleanLook({ hair: 'tupp' }).hair, AV.default.hair, 'old saved Mohawk → default hair via cleanLook');
assert.equal(cleanLook({ hair: 'tupp', outfit: 'punk', shirt: '#e63946' }).outfit, 'punk');
assert.equal(cleanLook({ hair: 'tupp', outfit: 'punk', shirt: '#e63946' }).shirt, '#e63946');
for (let i = 0; i < 80; i++) {
  const a = rollLook(), b = freshLook(null), c = seededLook(AV, 'seed-' + i);
  assert.ok(a.hair in AV.hair && a.hair !== 'tupp', a);
  assert.ok(b.hair in AV.hair && b.hair !== 'tupp', b);
  assert.ok(c.hair in AV.hair && c.hair !== 'tupp', c);
}
// Earrings: no menu flag exists; Beach_Head (lang) stays selectable, Punk_Head only via retired tracking in avatars.js.
assert.ok(AV.hair.lang.head === 'Beach_Head');
assert.ok(!Object.values(AV.hair).some((h) => h.head === 'Punk_Head'), 'no selectable hair uses Punk_Head');
console.log('avatarparts: ok');

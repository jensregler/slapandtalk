// The sticker credit from the file name (Jens, 2 Nov 2026; shared/stickercredit.mjs).
import assert from 'node:assert/strict';
import { creditFromName } from '../shared/stickercredit.mjs';
const t = (n, want) => { assert.deepEqual(creditFromName(n), want); console.log('  ✓ ' + n); };
t('d71 - Jens Tjerngren @jensregler.png', { title: 'd71', artist: 'Jens Tjerngren', insta: 'jensregler', link: 'https://www.instagram.com/jensregler' });
t('blomma - Jens Tjerngren.png', { title: 'blomma', artist: 'Jens Tjerngren', insta: '', link: '' });
t('blomma.png', { title: 'blomma', artist: '', insta: '', link: '' });
t('stor blomma - Ulla Ek @ulla.ek_.webp', { title: 'stor blomma', artist: 'Ulla Ek', insta: 'ulla.ek_', link: 'https://www.instagram.com/ulla.ek_' });
t('kaktus - @solo.png', { title: 'kaktus', artist: '@solo', insta: 'solo', link: 'https://www.instagram.com/solo' });
t('dir/sub/d72 - Jens Tjerngren @JensRegler.PNG', { title: 'd72', artist: 'Jens Tjerngren', insta: 'jensregler', link: 'https://www.instagram.com/jensregler' });
t('a-b-c.png', { title: 'a-b-c', artist: '', insta: '', link: '' }); // a dash without spaces is part of the name
console.log('stickercredit: all passed');

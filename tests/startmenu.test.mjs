import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageText, cleanCode } from '../client/src/startcard.js';

test('ageText matches Run-DMC join mockup (4d 13h 19min)', () => {
  const now = Date.parse('2026-11-06T20:00:00Z');
  const iso = new Date(now - (((4 * 24 + 13) * 60) + 19) * 60000).toISOString();
  assert.equal(ageText(iso, now), '4d 13h 19min');
  assert.equal(ageText(new Date(now - 5 * 60000).toISOString(), now), '5min');
  assert.equal(ageText(new Date(now - 90 * 60000).toISOString(), now), '1h 30min');
  assert.equal(ageText('nope', now), '–');
});

test('cleanCode accepts pasted room links', () => {
  assert.equal(cleanCode('https://slapandtalk.com/?room=abc-123'), 'abc-123');
  assert.equal(cleanCode(' ABC '), 'abc');
});

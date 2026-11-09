import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ageText, cleanCode, defaultCityName } from '../client/src/startcard.js';

test('ageText matches Run-DMC join mockup (4d 13h 19min)', () => {
  const now = Date.parse('2026-11-06T12:00:00Z');
  const iso = new Date(now - ((4 * 1440) + (13 * 60) + 19) * 60000).toISOString();
  assert.equal(ageText(iso, now), '4d 13h 19min');
  assert.equal(ageText(new Date(now - 5 * 60000).toISOString(), now), '5min');
  assert.equal(ageText(new Date(now - 90 * 60000).toISOString(), now), '1h 30min');
  assert.equal(ageText('nope', now), '–');
});

test('cleanCode accepts pasted room links', () => {
  assert.equal(cleanCode('https://slapandtalk.com/?room=abc-123'), 'abc-123');
  assert.equal(cleanCode(' ABC '), 'abc');
});

test('defaultCityName picks a non-empty name from the pool', () => {
  const a = defaultCityName(() => 0);
  const b = defaultCityName(() => 0.99);
  assert.ok(a && a.length >= 3);
  assert.ok(b && b.length >= 3);
  assert.notEqual(a, b);
});

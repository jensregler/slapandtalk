// Site sample library (Jens t964u): the public one-shots at /sample-lib/. Ids are stable
// (bass-1 … bass-16, hat-1 … hat-8, other-1 … other-13) so patches, room presets and NPCs
// can name a file without embedding the audio. The wavs + manifest live in client/public/sample-lib/.
export const LIBRARY_GROUPS = Object.freeze([
  Object.freeze({ id: 'bass', name: 'Bass', prefix: 'bass', count: 16 }),
  Object.freeze({ id: 'hatsnare', name: 'Hat / snare', prefix: 'hat', count: 8 }),
  Object.freeze({ id: 'other', name: 'Other', prefix: 'other', count: 13 }),
]);

export const LIBRARY_IDS = Object.freeze(LIBRARY_GROUPS.flatMap((g) =>
  Array.from({ length: g.count }, (_, i) => `${g.prefix}-${i + 1}`)));

export function libraryName(id) {
  const m = /^([a-z]+)-([1-9][0-9]*)$/.exec(String(id || ''));
  if (!m) return String(id || '');
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}`;
}

export function libraryGroupOf(id) {
  const prefix = String(id || '').split('-')[0];
  return LIBRARY_GROUPS.find((g) => g.prefix === prefix) || null;
}

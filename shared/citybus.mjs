// Inter-city bus TEST (Jens, Nov 2026): three fake cities with tinted Town Halls, a bus stop,
// and virtual bots. Only active when test mode is on (CITYBUS_TEST=1 / ?testbus=1) – never on
// the normal Join list for real players.
export const TESTBUS_PARAM = 'testbus';
export const TESTBUS_ENV = 'CITYBUS_TEST';

// Fixed ids (letter in the 6-char code) so e2e / screenshots are stable.
export const TEST_CITIES = Object.freeze([
  { id: 'stad-grnhal', name: 'Grönstad', tint: 'green', color: 0x9fd0a8 },
  { id: 'stad-redhal', name: 'Rödby', tint: 'red', color: 0xe08a8a },
  { id: 'stad-bluhal', name: 'Blåvik', tint: 'blue', color: 0x8ab4e0 },
]);

export const TEST_CITY_IDS = Object.freeze(TEST_CITIES.map((c) => c.id));
export const testCityOf = (id) => TEST_CITIES.find((c) => c.id === id) || null;
export const isTestBusCity = (id) => !!testCityOf(id);
export const hallColorFor = (id) => testCityOf(id)?.color ?? null;

export function testBusEnabled({ env, search } = {}) {
  const e = env != null ? env : (typeof process !== 'undefined' ? process.env?.[TESTBUS_ENV] : undefined);
  if (e === '0' || e === 'false') return false;
  if (e === '1' || e === 'true') return true;
  try {
    const q = search != null ? search : (typeof location !== 'undefined' ? location.search : '');
    return new URLSearchParams(q).get(TESTBUS_PARAM) === '1';
  } catch { return false; }
}

/** Age like "4 days, 9 hours, 8 minutes" (English) / Swedish via strings. */
export function cityAgeParts(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  let secs = Math.max(0, Math.floor((now - t) / 1000));
  const days = Math.floor(secs / 86400); secs -= days * 86400;
  const hours = Math.floor(secs / 3600); secs -= hours * 3600;
  const minutes = Math.floor(secs / 60);
  return { days, hours, minutes };
}

export const BOTS_PER_CITY = 3;
export const BOT_NAMES = Object.freeze(['Ada', 'Bo', 'Cleo', 'Dan', 'Eva', 'Finn', 'Gia', 'Hugo', 'Ida']);

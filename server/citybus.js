// City-bus TEST: three tinted cities + bots that SPREAD packs (Jens):
//   hand in own/carried pack at Town Hall → take someone else's → ride bus to next city → repeat.
// Gated by CITYBUS_TEST=1. Test cities stay alive (emptyrooms / cities.always).
const crypto = require('crypto');
const sharp = require('sharp');
const CITY = require('../shared/city.mjs');
const BUS = require('../shared/citybus.mjs');

const BOT_DEVICE = (city, i) => `busbot-${city}-${i}`;
const PW = 563, PH = 802;

function createCityBus(store, { cities, cityPacks, occupancy, clock = () => Date.now(), log = console, enabled = () => false, imageIds = null } = {}) {
  let botTimer = null;
  let tickN = 0;
  /** @type {Map<string, { token: string, name: string, insta: string, cityIdx: number, stickers: string[], homePackId: string|null, carrying: string[], journey: object[] }>} */
  const bots = new Map();
  /** Pack journey log: [{ packId, name, at, city, by, action: 'handIn'|'take'|'arrive' }] */
  const journeys = [];
  const logJourney = (row) => {
    journeys.push({ ...row, at: new Date(clock()).toISOString() });
    if (journeys.length > 200) journeys.splice(0, journeys.length - 200);
  };

  async function libraryStickers() {
    if (typeof imageIds === 'function') {
      const ids = await imageIds();
      if (ids && ids.length >= 3) return ids;
    }
    // Fallbacks often present in the baked library
    return ['c70d4436a5b53efc', 'fe62d4b007728d63', '8497519502bc4cc1', 'a1b2c3d4e5f60718', 'b2c3d4e5f607189a'];
  }

  async function makePackPng(label, color) {
    // Minimal WebP via sharp from SVG
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${PH}">
      <rect width="100%" height="100%" fill="#${color}"/>
      <rect x="40" y="40" width="480" height="200" fill="#fff" rx="12"/>
      <text x="280" y="160" text-anchor="middle" font-size="48" font-family="Arial" fill="#111">${label}</text>
    </svg>`;
    return sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
  }

  async function ensureCity(spec) {
    let room = await store.peek(spec.id).catch(() => null);
    if (!room) {
      try {
        await store.createRoom({
          id: spec.id, type: 'stad',
          extra: { name: spec.name, hallTint: spec.tint, testBus: true, startedBy: 'citybus-test' },
        });
        log.log?.(`[citybus] seeded ${spec.id} "${spec.name}" (${spec.tint})`);
      } catch (e) { if (e.code !== 'EXISTS') throw e; }
    }
    return cities.info(spec.id);
  }

  function botKey(cityId, i) { return `${cityId}#${i}`; }

  async function ensureBot(spec, i, stickerPool) {
    const key = botKey(spec.id, i);
    if (bots.has(key)) return bots.get(key);
    const name = BUS.BOT_NAMES[(i + BUS.TEST_CITIES.indexOf(spec)) % BUS.BOT_NAMES.length];
    const insta = `${spec.tint}_${name.toLowerCase()}_pack`;
    // Unique 3 stickers per bot (cycle pool)
    const stickers = [
      stickerPool[(i * 3) % stickerPool.length],
      stickerPool[(i * 3 + 1) % stickerPool.length],
      stickerPool[(i * 3 + 2) % stickerPool.length],
    ];
    const state = {
      key, homeCity: spec.id, name, insta, cityIdx: BUS.TEST_CITIES.findIndex((c) => c.id === spec.id),
      stickers, token: null, homePackId: null, carrying: [],
    };
    bots.set(key, state);
    return state;
  }

  async function botHandIn(bot, cityId) {
    const img = await makePackPng(bot.name, 'ffd400');
    try {
      const r = await cityPacks.handIn({
        name: `${bot.name}'s pack`,
        stickers: bot.stickers,
        img,
        token: bot.token,
        about: `Bot pack spreading via bus. @${bot.insta}`,
        author: bot.name,
        insta: bot.insta,
        paid: true, // keep takes across city hops (spread packs)
      });
      bot.token = r.token;
      bot.homePackId = r.pack.id;
      logJourney({ packId: r.pack.id, name: r.pack.name, city: cityId, by: bot.name, action: 'handIn', insta: bot.insta });
      return r.pack;
    } catch (e) {
      if (e.status === 409 && e.pack) {
        bot.homePackId = e.pack.id;
        return e.pack;
      }
      // unpaid already in: try list
      log.warn?.(`[citybus] handIn ${bot.name}@${cityId}: ${e.message}`);
      return null;
    }
  }

  async function botTakeOther(bot, cityId) {
    if (!bot.token) return null;
    const list = await cityPacks.list(bot.token, { paid: true });
    const others = (list.packs || []).filter((p) => !p.mine && !p.taken);
    if (!others.length) return null;
    // Prefer a pack not already carried
    const pick = others.find((p) => !bot.carrying.includes(p.id)) || others[0];
    try {
      // If full, dropOne first
      if (list.mine && list.mine.left <= 0 && list.mine.takes?.length) {
        const dropId = list.mine.takes[0];
        await cityPacks.dropOne(bot.token, dropId, { paid: true });
        bot.carrying = bot.carrying.filter((id) => id !== dropId);
        logJourney({ packId: dropId, city: cityId, by: bot.name, action: 'discard' });
      }
      const r = await cityPacks.take(pick.id, bot.token, { paid: true });
      if (!bot.carrying.includes(pick.id)) bot.carrying.push(pick.id);
      logJourney({
        packId: pick.id, name: pick.name, city: cityId, by: bot.name, action: 'take',
        from: pick.author?.name || pick.author?.insta || '?',
        carriedTo: BUS.TEST_CITIES[(bot.cityIdx + 1) % BUS.TEST_CITIES.length].id,
      });
      return r.pack;
    } catch (e) {
      log.warn?.(`[citybus] take ${bot.name}: ${e.message}`);
      return null;
    }
  }

  async function botSlap(cityId, botIdx) {
    const walls = [
      { position: [8 + botIdx, 2.2, 15], normal: [0, 0, -1], rotation: [0, 0, 0, 1] },
      { position: [-10, 1.8, -6 + botIdx], normal: [1, 0, 0], rotation: [0, 0.707, 0, 0.707] },
      { position: [4, 1.6, 18], normal: [0, 0, -1], rotation: [0, 0, 0, 1] },
    ];
    const w = walls[(tickN + botIdx) % walls.length];
    const pool = await libraryStickers();
    const imageId = pool[(tickN + botIdx) % pool.length];
    try {
      await store.addStamp(cityId, {
        imageId, size: 40 + (botIdx * 7) % 50,
        position: w.position, normal: w.normal, rotation: w.rotation,
        owner: BOT_DEVICE(cityId, botIdx),
      });
    } catch (e) { /* image may be missing – skip */ }
    await store.noteVisitor(cityId, BOT_DEVICE(cityId, botIdx)).catch(() => {});
  }

  async function botTick() {
    if (!enabled()) return;
    tickN++;
    const pool = await libraryStickers();
    for (let ci = 0; ci < BUS.TEST_CITIES.length; ci++) {
      const spec = BUS.TEST_CITIES[ci];
      await ensureCity(spec).catch(() => {});
      for (let i = 0; i < BUS.BOTS_PER_CITY; i++) {
        const bot = await ensureBot(spec, i, pool);
        // Bots "live" in rotating cities: home index + tick offset
        const destIdx = (bot.cityIdx + Math.floor(tickN / 2) + i) % BUS.TEST_CITIES.length;
        const here = BUS.TEST_CITIES[destIdx];
        await ensureCity(here).catch(() => {});
        await botSlap(here.id, i);
        // Spread packs: hand in at this city, take another, note journey toward next
        if (tickN % 2 === i % 2) {
          await botHandIn(bot, here.id);
          await botTakeOther(bot, here.id);
          const next = BUS.TEST_CITIES[(destIdx + 1) % BUS.TEST_CITIES.length];
          for (const pid of bot.carrying.slice(-1)) {
            logJourney({ packId: pid, city: next.id, by: bot.name, action: 'arrive', via: 'bus' });
          }
        }
      }
    }
  }

  async function seed() {
    if (!enabled()) throw Object.assign(new Error('City bus test mode is off'), { status: 403 });
    const out = [];
    for (const spec of BUS.TEST_CITIES) out.push(await ensureCity(spec));
    const pool = await libraryStickers();
    for (const spec of BUS.TEST_CITIES) {
      for (let i = 0; i < BUS.BOTS_PER_CITY; i++) {
        await store.noteVisitor(spec.id, BOT_DEVICE(spec.id, i)).catch(() => {});
        await ensureBot(spec, i, pool);
      }
    }
    // Initial hand-ins so shops have packs to trade
    for (const bot of bots.values()) {
      const home = BUS.TEST_CITIES[bot.cityIdx];
      await botHandIn(bot, home.id);
    }
    startBots();
    return { cities: out, botsPerCity: BUS.BOTS_PER_CITY, bots: [...bots.values()].map((b) => ({ name: b.name, insta: b.insta, home: b.homeCity })) };
  }

  async function status() {
    const list = [];
    for (const spec of BUS.TEST_CITIES) {
      const i = await cities.info(spec.id).catch(() => null);
      if (i) list.push({ ...i, tint: spec.tint, bots: BUS.BOTS_PER_CITY });
    }
    // Summarize pack journeys: each packId → cities visited
    const byPack = new Map();
    for (const j of journeys) {
      if (!j.packId) continue;
      if (!byPack.has(j.packId)) byPack.set(j.packId, { packId: j.packId, name: j.name, steps: [] });
      byPack.get(j.packId).steps.push({ action: j.action, city: j.city, by: j.by, at: j.at, from: j.from, via: j.via });
    }
    const ranked = [...byPack.values()].sort((a, b) => b.steps.length - a.steps.length);
    return {
      enabled: enabled(), cities: list, tick: tickN,
      bots: [...bots.values()].map((b) => ({ name: b.name, insta: b.insta, home: b.homeCity, pack: b.homePackId, carrying: b.carrying.slice() })),
      journeys: journeys.slice(-40),
      packJourneys: ranked.slice(0, 30),
      packSpreads: ranked.filter((p) => p.steps.some((s) => s.action === 'take') && p.steps.some((s) => s.action === 'arrive')).slice(0, 15),
    };
  }

  function startBots() {
    if (botTimer || !enabled()) return;
    botTimer = setInterval(() => { botTick().catch((e) => log.warn?.(`[citybus] tick: ${e.message}`)); }, 10000);
    botTick().catch(() => {});
    log.log?.('[citybus] bot pack-spread loop on (10s)');
  }
  function stopBots() { if (botTimer) clearInterval(botTimer); botTimer = null; }

  return { seed, status, startBots, stopBots, ensureCity, TEST_CITIES: BUS.TEST_CITIES, isTestCity: BUS.isTestBusCity, journeys: () => journeys.slice() };
}

module.exports = { createCityBus, BUS: require('../shared/citybus.mjs') };

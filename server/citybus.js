// City-bus TEST: three tinted cities + bots that SPREAD packs (Jens):
//   hand in own/carried pack at Town Hall → take someone else's → ride bus to the next city → repeat.
// Bots are injected into the realtime roster so clients see avatars, nametags (@insta), and
// "N here right now". Stickers land on hall walls via store + broadcast. Gated by CITYBUS_TEST=1.
const crypto = require('crypto');
const sharp = require('sharp');
const { broadcast } = require('./realtime');
const BUS = require('../shared/citybus.mjs');

const PW = 563, PH = 802;
// Stable 10-hex ids (realtime player ids are 10 hex chars).
const botIdFor = (cityIdx, i) => `b0${cityIdx}${i}${crypto.createHash('md5').update(`busbot-${cityIdx}-${i}`).digest('hex').slice(0, 6)}`;

const BOT_LOOKS = [
  { outfit: 'tshirt', hair: 'kort', shirt: '#e63946', pants: '#2b4c7e', hairColor: '#4a2c17', skin: '#f1c27d', shoes: '#222222', hat: false, hatColor: '#e63946' },
  { outfit: 'huvtroja', hair: 'lang', shirt: '#3a86ff', pants: '#1d3557', hairColor: '#1a1a1a', skin: '#c68642', shoes: '#111111', hat: true, hatColor: '#457b9d' },
  { outfit: 'punk', hair: 'kort', shirt: '#2a9d8f', pants: '#264653', hairColor: '#e9c46a', skin: '#8d5524', shoes: '#222222', hat: false, hatColor: '#e63946' },
  { outfit: 'kostym', hair: 'kort', shirt: '#f4a261', pants: '#1d3557', hairColor: '#6b3a2a', skin: '#f1c27d', shoes: '#222222', hat: false, hatColor: '#e63946' },
];

function createCityBus(store, {
  cities, cityPacks, occupancy, clock = () => Date.now(), log = console,
  enabled = () => false, imageIds = null, live = null,
} = {}) {
  let botTimer = null;
  let tickN = 0;
  let liveApi = live; // setLive() after attachRealtime
  /** @type {Map<string, object>} */
  const bots = new Map();
  const journeys = [];
  const logJourney = (row) => {
    journeys.push({ ...row, at: new Date(clock()).toISOString() });
    if (journeys.length > 200) journeys.splice(0, journeys.length - 200);
  };

  const setLive = (api) => { liveApi = api; };

  async function libraryStickers() {
    if (typeof imageIds === 'function') {
      const ids = await imageIds();
      if (ids && ids.length >= 3) return ids;
    }
    // Last-resort: peek store for any library images already seeded
    try {
      const rooms = await store.listRooms?.() || [];
      void rooms;
    } catch { /* fine */ }
    return [];
  }

  async function makePackPng(label, color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${PH}">
      <rect width="100%" height="100%" fill="#${color}"/>
      <rect x="40" y="40" width="480" height="200" fill="#fff" rx="12"/>
      <text x="280" y="160" text-anchor="middle" font-size="48" font-family="Arial" fill="#111">${label}</text>
    </svg>`;
    return sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
  }

  function backdatedIso(spec) {
    const idx = BUS.TEST_CITIES.findIndex((c) => c.id === spec.id);
    // 3–5 days + hours/minutes so age formatting is exercised (not "0 minutes").
    const days = 3 + Math.max(0, idx);
    const hours = 9 + idx * 2;
    const minutes = 8 + idx * 5;
    return new Date(clock() - (((days * 24 + hours) * 60 + minutes) * 60_000)).toISOString();
  }

  async function ensureCity(spec) {
    let room = await store.peek(spec.id).catch(() => null);
    const createdAt = backdatedIso(spec);
    if (!room) {
      try {
        await store.createRoom({
          id: spec.id, type: 'stad',
          extra: {
            name: spec.name, hallTint: spec.tint, testBus: true,
            startedBy: 'citybus-test', createdAt, lastVisitAt: createdAt,
            geo: require('../shared/city.mjs').CITY_GEO,
          },
        });
        log.log?.(`[citybus] seeded ${spec.id} "${spec.name}" (${spec.tint}), age from ${createdAt}`);
      } catch (e) { if (e.code !== 'EXISTS') throw e; }
      room = await store.peek(spec.id).catch(() => null);
    }
    // Always keep a backdated createdAt in TEST so the bus list shows days/hours/minutes.
    if (room) {
      const want = Date.parse(createdAt);
      const have = Date.parse(room.createdAt || '');
      if (!Number.isFinite(have) || Math.abs(have - want) > 60_000) {
        await store.editRoom(spec.id, (r) => {
          r.createdAt = createdAt;
          r.hallTint = spec.tint;
          r.testBus = true;
          if (!r.name) r.name = spec.name;
          return r;
        }).catch(() => {});
      }
    }
    return cities.info(spec.id);
  }

  function botKey(cityId, i) { return `${cityId}#${i}`; }

  async function ensureBot(spec, i, stickerPool) {
    const key = botKey(spec.id, i);
    if (bots.has(key)) return bots.get(key);
    const cityIdx = BUS.TEST_CITIES.findIndex((c) => c.id === spec.id);
    const name = BUS.BOT_NAMES[(i + cityIdx) % BUS.BOT_NAMES.length];
    const insta = `${spec.tint}_${name.toLowerCase()}_pack`.replace(/[^a-z0-9._]/g, '').slice(0, 30);
    const stickers = stickerPool.length >= 3 ? [
      stickerPool[(i * 3 + cityIdx) % stickerPool.length],
      stickerPool[(i * 3 + 1 + cityIdx) % stickerPool.length],
      stickerPool[(i * 3 + 2 + cityIdx) % stickerPool.length],
    ] : [];
    const look = { ...BOT_LOOKS[(i + cityIdx) % BOT_LOOKS.length], insta };
    const state = {
      key, id: botIdFor(cityIdx, i), homeCity: spec.id, name, insta, look,
      cityIdx, stickers, token: null, homePackId: null, carrying: [],
      phase: (i / BUS.BOTS_PER_CITY) * Math.PI * 2, r: 4.5 + i * 0.8,
      roomId: spec.id,
    };
    bots.set(key, state);
    return state;
  }

  function syncBotPresence(bot, roomId) {
    if (!liveApi?.injectBot) return;
    // Leave previous room if hopping
    if (bot.roomId && bot.roomId !== roomId) liveApi.removeBot(bot.roomId, bot.id);
    const angle = bot.phase;
    const x = Math.cos(angle) * bot.r;
    const z = 11.2 + Math.sin(angle) * bot.r * 0.55;
    const yaw = angle + Math.PI / 2;
    liveApi.injectBot(roomId, {
      id: bot.id, name: bot.name, look: bot.look,
      p: [x, 1.6, z], y: yaw,
    });
    bot.roomId = roomId;
  }

  function walkBot(bot) {
    if (!liveApi?.moveBot || !bot.roomId) return;
    bot.phase += 0.18 + (bot.r % 3) * 0.02;
    const x = Math.cos(bot.phase) * bot.r;
    const z = 11.2 + Math.sin(bot.phase) * bot.r * 0.55;
    const yaw = bot.phase + Math.PI / 2;
    liveApi.moveBot(bot.roomId, bot.id, [x, 1.6, z], yaw);
  }

  async function botHandIn(bot, cityId) {
    if (!bot.stickers.length) return null;
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
        paid: true,
      });
      bot.token = r.token;
      bot.homePackId = r.pack.id;
      logJourney({ packId: r.pack.id, name: r.pack.name, city: cityId, by: bot.name, action: 'handIn', insta: bot.insta });
      return r.pack;
    } catch (e) {
      if (e.status === 409 && e.pack) { bot.homePackId = e.pack.id; return e.pack; }
      log.warn?.(`[citybus] handIn ${bot.name}@${cityId}: ${e.message}`);
      return null;
    }
  }

  async function botTakeOther(bot, cityId) {
    if (!bot.token) return null;
    const list = await cityPacks.list(bot.token, { paid: true });
    const others = (list.packs || []).filter((p) => !p.mine && !p.taken);
    if (!others.length) return null;
    const pick = others.find((p) => !bot.carrying.includes(p.id)) || others[0];
    try {
      if (list.mine && list.mine.left <= 0 && list.mine.takes?.length) {
        const dropId = list.mine.takes[0];
        await cityPacks.dropOne(bot.token, dropId, { paid: true });
        bot.carrying = bot.carrying.filter((id) => id !== dropId);
        logJourney({ packId: dropId, city: cityId, by: bot.name, action: 'discard' });
      }
      await cityPacks.take(pick.id, bot.token, { paid: true });
      if (!bot.carrying.includes(pick.id)) bot.carrying.push(pick.id);
      logJourney({
        packId: pick.id, name: pick.name, city: cityId, by: bot.name, action: 'take',
        from: pick.author?.name || pick.author?.insta || '?',
        carriedTo: BUS.TEST_CITIES[(bot.cityIdx + 1) % BUS.TEST_CITIES.length].id,
      });
      return pick;
    } catch (e) {
      log.warn?.(`[citybus] take ${bot.name}: ${e.message}`);
      return null;
    }
  }

  async function botSlap(cityId, bot) {
    const pool = await libraryStickers();
    if (!pool.length) {
      log.warn?.('[citybus] no library sticker ids – cannot slap');
      return null;
    }
    const imageId = pool[(tickN + (bot.cityIdx * 3) + bot.r * 10) % pool.length | 0];
    // Hall south face is at z≈8 (house d=16, centre 0). Stickers face the plaza (+z).
    // size is metres (client stamps.js); hall-s = Town Hall south face (client/src/city.js).
    const slots = [
      { position: [-3.2, 2.4, 8.06], normal: [0, 0, 1], quaternion: [0, 0, 0, 1] },
      { position: [0.0, 3.1, 8.06], normal: [0, 0, 1], quaternion: [0, 0, 0, 1] },
      { position: [3.4, 2.2, 8.06], normal: [0, 0, 1], quaternion: [0, 0, 0, 1] },
      { position: [-5.0, 2.8, 8.06], normal: [0, 0, 1], quaternion: [0, 0, 0, 1] },
      { position: [5.2, 2.6, 8.06], normal: [0, 0, 1], quaternion: [0, 0, 0, 1] },
    ];
    const w = slots[(tickN + bot.cityIdx + Math.floor(bot.r)) % slots.length];
    try {
      const stamp = await store.addStamp(cityId, {
        imageId,
        size: 0.45 + ((Math.floor(bot.r * 7) % 40) / 100), // ~45–85 cm
        position: w.position, normal: w.normal, quaternion: w.quaternion,
        rotation: 0, surface: 'hall-s',
        owner: bot.id,
      });
      const image = await store.getImage(imageId);
      if (image) broadcast(cityId, { type: 'stamp:add', stamp, image, by: bot.id });
      await store.noteVisitor(cityId, bot.id).catch(() => {});
      return stamp;
    } catch (e) {
      log.warn?.(`[citybus] slap ${bot.name}@${cityId}: ${e.message}`);
      return null;
    }
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
        // Avatars stay in the home city (stable presence / "N here right now").
        // Pack spreading still hops: hand in here → take → log arrive in the next city.
        const here = spec;
        syncBotPresence(bot, here.id);
        walkBot(bot);
        await botSlap(here.id, bot);
        if (tickN % 2 === i % 2) {
          await botHandIn(bot, here.id);
          await botTakeOther(bot, here.id);
          // Simulate the bus ride for the carried pack (journey log).
          const next = BUS.TEST_CITIES[(bot.cityIdx + 1) % BUS.TEST_CITIES.length];
          for (const pid of bot.carrying.slice(-1)) {
            logJourney({ packId: pid, city: next.id, by: bot.name, action: 'arrive', via: 'bus' });
          }
        }
      }
    }
  }

  // Lighter walk-only pulse so avatars keep moving between heavy ticks
  let walkTimer = null;
  function startWalk() {
    if (walkTimer) return;
    walkTimer = setInterval(() => {
      if (!enabled()) return;
      for (const bot of bots.values()) walkBot(bot);
    }, 400);
    walkTimer.unref?.();
  }

  async function seed() {
    if (!enabled()) throw Object.assign(new Error('City bus test mode is off'), { status: 403 });
    const out = [];
    for (const spec of BUS.TEST_CITIES) out.push(await ensureCity(spec));
    let pool = await libraryStickers();
    // Library seed may still be finishing on cold start – brief retry
    for (let n = 0; n < 10 && pool.length < 3; n++) {
      await new Promise((r) => setTimeout(r, 200));
      pool = await libraryStickers();
    }
    if (pool.length < 3) log.warn?.(`[citybus] only ${pool.length} library stickers – wall stamps may be empty`);
    for (const spec of BUS.TEST_CITIES) {
      for (let i = 0; i < BUS.BOTS_PER_CITY; i++) {
        const bot = await ensureBot(spec, i, pool);
        await store.noteVisitor(spec.id, bot.id).catch(() => {});
        syncBotPresence(bot, spec.id);
        // Initial slap so the plaza isn't empty on first visit
        await botSlap(spec.id, bot);
      }
    }
    for (const bot of bots.values()) {
      const home = BUS.TEST_CITIES[bot.cityIdx];
      await botHandIn(bot, home.id);
    }
    startBots();
    startWalk();
    return {
      cities: out, botsPerCity: BUS.BOTS_PER_CITY,
      bots: [...bots.values()].map((b) => ({ id: b.id, name: b.name, insta: b.insta, home: b.homeCity, room: b.roomId })),
      libraryStickers: pool.length,
    };
  }

  async function status() {
    const list = [];
    for (const spec of BUS.TEST_CITIES) {
      const i = await cities.info(spec.id).catch(() => null);
      if (i) list.push({ ...i, tint: spec.tint, bots: BUS.BOTS_PER_CITY });
    }
    const byPack = new Map();
    for (const j of journeys) {
      if (!j.packId) continue;
      if (!byPack.has(j.packId)) byPack.set(j.packId, { packId: j.packId, name: j.name, steps: [] });
      byPack.get(j.packId).steps.push({ action: j.action, city: j.city, by: j.by, at: j.at, from: j.from, via: j.via });
    }
    const ranked = [...byPack.values()].sort((a, b) => b.steps.length - a.steps.length);
    return {
      enabled: enabled(), cities: list, tick: tickN,
      bots: [...bots.values()].map((b) => ({
        id: b.id, name: b.name, insta: b.insta, home: b.homeCity, room: b.roomId,
        pack: b.homePackId, carrying: b.carrying.slice(),
      })),
      live: liveApi ? BUS.TEST_CITIES.map((c) => ({ id: c.id, bots: liveApi.listBots?.(c.id)?.length || 0 })) : null,
      journeys: journeys.slice(-40),
      packJourneys: ranked.slice(0, 30),
      packSpreads: ranked.filter((p) => p.steps.some((s) => s.action === 'take') && p.steps.some((s) => s.action === 'arrive')).slice(0, 15),
    };
  }

  function startBots() {
    if (botTimer || !enabled()) return;
    botTimer = setInterval(() => { botTick().catch((e) => log.warn?.(`[citybus] tick: ${e.message}`)); }, 10000);
    botTimer.unref?.();
    botTick().catch(() => {});
    startWalk();
    log.log?.('[citybus] bot pack-spread + presence loop on');
  }
  function stopBots() {
    if (botTimer) clearInterval(botTimer); botTimer = null;
    if (walkTimer) clearInterval(walkTimer); walkTimer = null;
  }

  return {
    seed, status, startBots, stopBots, ensureCity, setLive,
    TEST_CITIES: BUS.TEST_CITIES, isTestCity: BUS.isTestBusCity, journeys: () => journeys.slice(),
  };
}

module.exports = { createCityBus, BUS: require('../shared/citybus.mjs') };

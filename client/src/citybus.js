// City-bus TEST client: bus-stop sheet (destinations + stats), ride with packs kept, local bot fallback.
import * as THREE from 'three';
import { S } from './strings.js';
import { randomLook } from './avatars.js';
import {
  TEST_CITIES, TEST_CITY_IDS, isTestBusCity, hallColorFor, testBusEnabled,
  cityAgeParts, BOTS_PER_CITY, BOT_NAMES, TESTBUS_PARAM,
} from '../../shared/citybus.mjs';

export { TEST_CITIES, TEST_CITY_IDS, isTestBusCity, hallColorFor, testBusEnabled, TESTBUS_PARAM };

export function busAgeText(iso, lang = 'en') {
  const p = cityAgeParts(iso);
  if (!p) return '–';
  const { days, hours, minutes } = p;
  if (lang === 'sv') {
    const bits = [];
    if (days) bits.push(`${days} ${days === 1 ? 'dag' : 'dagar'}`);
    if (hours || days) bits.push(`${hours} ${hours === 1 ? 'timme' : 'timmar'}`);
    bits.push(`${minutes} ${minutes === 1 ? 'minut' : 'minuter'}`);
    return bits.join(', ');
  }
  const bits = [];
  if (days) bits.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours || days) bits.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  bits.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  return bits.join(', ');
}

let sheet = null;
export const busSheetOpen = () => !!(sheet && !sheet.hidden);

export function openBusSheet({ here, go, toast, S: strings } = {}) {
  const Str = strings || S;
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.id = 'bus-sheet';
    sheet.innerHTML = `
      <div class="bus-panel">
        <button type="button" class="bus-x" id="bus-x">✕</button>
        <div class="bus-title" id="bus-title"></div>
        <div class="bus-note" id="bus-note"></div>
        <div class="bus-list" id="bus-list"></div>
      </div>`;
    document.body.appendChild(sheet);
    sheet.querySelector('#bus-x').onclick = () => closeBusSheet();
    sheet.addEventListener('click', (e) => { if (e.target === sheet) closeBusSheet(); });
  }
  sheet.hidden = false;
  sheet.querySelector('#bus-title').textContent = Str.busTitle || 'Bus to another city';
  sheet.querySelector('#bus-note').textContent = Str.busNote || 'Take your packs (up to 3). Trade at the Town Hall.';
  const list = sheet.querySelector('#bus-list');
  list.textContent = '';
  list.appendChild(Object.assign(document.createElement('div'), { className: 'bus-loading', textContent: '…' }));

  fetch('/api/cities?testbus=1', { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => {
      const cities = (d.cities || []).filter((c) => c.id !== here && (c.testBus || isTestBusCity(c.id) || TEST_CITY_IDS.includes(c.id)));
      const byId = new Map(cities.map((c) => [c.id, c]));
      for (const spec of TEST_CITIES) {
        if (spec.id === here) continue;
        if (!byId.has(spec.id)) byId.set(spec.id, { id: spec.id, name: spec.name, stickers: 0, visitors: 0, createdAt: null, hallTint: spec.tint, testBus: true });
      }
      list.textContent = '';
      const rows = [...byId.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
      if (!rows.length) {
        list.appendChild(Object.assign(document.createElement('div'), { className: 'bus-empty', textContent: Str.busNone || 'No other open cities right now.' }));
        return;
      }
      for (const c of rows) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'bus-row'; b.dataset.id = c.id;
        const tint = c.hallTint || TEST_CITIES.find((t) => t.id === c.id)?.tint || '';
        const age = busAgeText(c.createdAt);
        b.innerHTML = `<span class="bus-name">${c.name || c.id}</span>
          <span class="bus-tint bus-tint-${tint}"></span>
          <span class="bus-facts">${Str.escCityFacts?.(c.stickers || 0, c.visitors || 0, age) || `${c.stickers || 0} stickers · ${c.visitors || 0} visitors · ${age}`}</span>`;
        b.onclick = () => {
          closeBusSheet();
          try { sessionStorage.setItem('klibb.busKeep', '1'); } catch { /* fine */ }
          toast?.(Str.busRiding || 'Riding the bus…', 1600);
          go?.(c.id);
        };
        list.appendChild(b);
      }
    })
    .catch(() => {
      list.textContent = '';
      list.appendChild(Object.assign(document.createElement('div'), { className: 'bus-empty', textContent: Str.busLoadFailed || 'Could not load cities.' }));
    });
  return sheet;
}

export function closeBusSheet() { if (sheet) sheet.hidden = true; }

/**
 * Prefer server-injected realtime bots (visible to everyone, counted in presence).
 * If none appear after a short wait (live API not wired yet), spawn local visual fallbacks
 * so the plaza is never empty in test mode.
 */
export function startCityBots(players, { cityId, room, toast } = {}) {
  if (!players || !isTestBusCity(cityId)) return { stop() {}, bots: [] };
  const spec = TEST_CITIES.find((c) => c.id === cityId);
  const local = [];
  let raf = 0, last = performance.now(), alive = true, usedLocal = false;

  const listBots = () => {
    const fromNet = [...players.map.values()].map((pl) => ({
      id: pl.id, name: pl.name, insta: pl.look?.insta || pl.avatar?.insta || '',
    }));
    if (fromNet.length) return fromNet;
    return local.map((b) => ({ id: b.id, name: b.name, insta: b.insta }));
  };

  const spawnLocal = () => {
    if (usedLocal || players.map.size > 0) return;
    usedLocal = true;
    const handles = ['gron_ada', 'rod_bo', 'bla_cleo', 'stad_dan', 'vik_eva', 'by_finn', 'hall_gia', 'bus_hugo', 'pac_ida'];
    for (let i = 0; i < BOTS_PER_CITY; i++) {
      const id = `busbot-local-${cityId}-${i}`;
      const name = BOT_NAMES[(i + (spec?.color || 0)) % BOT_NAMES.length];
      const look = randomLook();
      look.insta = handles[(i * 3 + TEST_CITY_IDS.indexOf(cityId)) % handles.length];
      const angle = (i / BOTS_PER_CITY) * Math.PI * 2;
      const r = 4.5 + i * 0.8;
      const pos = [Math.cos(angle) * r, 1.6, 11.2 + Math.sin(angle) * r * 0.55];
      players.upsert({ id, name, look, p: pos, y: angle + Math.PI / 2, slot: 10 + i });
      local.push({ id, name, insta: look.insta, t: Math.random() * 10, phase: angle, r, slapAt: 4 + i * 3 });
    }
    toast?.(`${BOTS_PER_CITY} visitors walking in ${spec?.name || 'city'}`, 2200);
  };

  // Give the websocket a moment to deliver server bots; then fall back.
  const fallbackTimer = setTimeout(spawnLocal, 2500);

  const tick = (now) => {
    if (!alive) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    for (const b of local) {
      b.t += dt;
      b.phase += dt * (0.35 + (b.r % 5) * 0.02);
      const x = Math.cos(b.phase) * b.r;
      const z = 11.2 + Math.sin(b.phase) * b.r * 0.55;
      const yaw = b.phase + Math.PI / 2;
      players.move(b.id, [x, 1.6, z], yaw);
      if (b.t > b.slapAt) {
        b.slapAt = b.t + 6 + Math.random() * 8;
        players.gesture?.(b.id, 'slap', [x * 0.15, 2.2, 8.2], [0, 0, 1]);
      }
    }
  };
  raf = requestAnimationFrame(tick);

  return {
    get bots() { return listBots(); },
    stop() {
      alive = false; clearTimeout(fallbackTimer); cancelAnimationFrame(raf);
      for (const b of local) players.remove(b.id);
    },
  };
}

export function hitBusStop(room, ndc, camera, raycaster) {
  if (!room?.busStop?.mesh) return false;
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(room.busStop.mesh, false);
  return hits.length > 0;
}

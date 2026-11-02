// The City scene (Jens, 2 Nov 2026, t476u; layout in shared/city.mjs). Like room.js it returns
// { group, surfaces, bounds, spawn } plus { city: true, groundAt, pushOut, doors, camFar }:
//   - surfaces you can slap on: the ground, the sky (4 walls + ceiling, 96 × 24 m / 96 × 96 m), the top
//     of every plot slab, and every house's 4 outer walls + roof (the Town Hall's too).
//   - drawn like Jens's sketch: pale stone slabs and houses, thick black outlines, black arched doors,
//     a green Town Hall of three blocks with black slit windows on its top block.
import * as THREE from 'three';
import { CITY, PLOTS, PLOT, PLOT_GAP, PLOT_SLAB, HOUSE, HALL_BLOCKS, CITY_SPAWN, groundAt, pushOut, doorAt } from '../../shared/city.mjs';

const STONE = 0xd2c9ba, SLAB = 0xc9bfae, HALL_GREEN = 0x9fd0a8, SKY = 0xbfe2f6, STREET = 0x8f8a82, INK = 0x15130f;
const PATH = 0xb5ab9a; // the painted streets: a little darker than the plots, never a dark "ditch"
const LINE = 0.14; // outline thickness (m): reads well from across the city and on a phone

// A soft paper/stone grain (canvas), tiled per metre, so big flat walls aren't plastic-flat.
function grain(base, seed = 1) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'); x.fillStyle = '#' + base.toString(16).padStart(6, '0'); x.fillRect(0, 0, 128, 128);
  let s = seed * 9301 + 49297; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let k = 0; k < 900; k++) { const v = rnd(); x.fillStyle = v < 0.5 ? `rgba(0,0,0,${0.03 + rnd() * 0.05})` : `rgba(255,255,255,${0.03 + rnd() * 0.06})`; x.fillRect(rnd() * 128, rnd() * 128, 1 + rnd() * 2.5, 1 + rnd() * 2.5); }
  for (let k = 0; k < 6; k++) { x.fillStyle = 'rgba(40,30,20,0.35)'; x.beginPath(); x.arc(rnd() * 128, rnd() * 128, 0.8 + rnd(), 0, 7); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
function material(base, w, h, seed, perM = 0.25) {
  const map = grain(base, seed); map.repeat.set(Math.max(1, w * perM), Math.max(1, h * perM));
  return new THREE.MeshStandardMaterial({ color: 0xffffff, map, roughness: 0.95 });
}

// The ground's picture (a canvas over the whole 96 × 96 m): street colour, the 9 plots as pale stone
// squares (PLOT − PLOT_GAP) with a thin ink edge, and a fine grain over everything. Flush: it is paint.
function groundMaterial(W, D) {
  const PX = 40, c = document.createElement('canvas'); c.width = Math.round(W * PX / 2); c.height = Math.round(D * PX / 2); // 20 px a metre
  const g = c.getContext('2d'), k = c.width / W, hex = (n) => '#' + n.toString(16).padStart(6, '0');
  g.fillStyle = hex(PATH); g.fillRect(0, 0, c.width, c.height);
  const s = PLOT - PLOT_GAP;
  for (const p of PLOTS) {
    const x = (p.x - s / 2 + W / 2) * k, y = (p.z - s / 2 + D / 2) * k;
    g.fillStyle = hex(SLAB); g.fillRect(x, y, s * k, s * k);
    g.strokeStyle = 'rgba(21,19,15,.55)'; g.lineWidth = 0.08 * k; g.strokeRect(x, y, s * k, s * k);
  }
  let r = 7 * 9301 + 49297; const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let n = 0; n < 60000; n++) { const v = rnd(); g.fillStyle = v < 0.5 ? `rgba(0,0,0,${0.03 + rnd() * 0.05})` : `rgba(255,255,255,${0.03 + rnd() * 0.06})`; g.fillRect(rnd() * c.width, rnd() * c.height, 1 + rnd() * 2, 1 + rnd() * 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ color: 0xffffff, map: t, roughness: 0.95 });
}

export function buildCityRoom() {
  const group = new THREE.Group(); group.name = 'city';
  const surfaces = [];
  const ink = new THREE.MeshBasicMaterial({ color: INK });
  const add = (name, w, h, mat, pos, rot, slap = true) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.name = name; m.position.set(...pos); m.rotation.set(...rot); m.updateMatrixWorld();
    m.userData.city = true; group.add(m); if (slap) surfaces.push(m);
    return m;
  };
  const bar = (len, axis, at) => { // one outline edge: a thin black box along x/y/z, centred at `at`
    const s = [LINE, LINE, LINE]; s['xyz'.indexOf(axis)] = len + LINE;
    const b = new THREE.Mesh(new THREE.BoxGeometry(...s), ink); b.position.set(...at); group.add(b);
  };
  const outlineBox = (x, y0, z, w, h, d, { top = true, bottom = true, verticals = true } = {}) => {
    const hw = w / 2, hd = d / 2;
    for (const yy of [bottom && y0, top && y0 + h].filter((v) => v !== false)) {
      bar(w, 'x', [x, yy, z - hd]); bar(w, 'x', [x, yy, z + hd]); bar(d, 'z', [x - hw, yy, z]); bar(d, 'z', [x + hw, yy, z]);
    }
    if (verticals) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bar(h, 'y', [x + sx * hw, y0 + h / 2, z + sz * hd]);
  };
  const W = CITY.width, H = CITY.height, D = CITY.depth, hw = W / 2, hd = D / 2;

  // The ground: ONE flat piece (Jens, t481u – no "ditches" between the plots): the plots are painted on
  // it (pale stone squares, a thin ink line round each) with the streets between them a little darker.
  add('golv', W, D, groundMaterial(W, D), [0, 0, 0], [-Math.PI / 2, 0, 0]);
  const sky = new THREE.MeshBasicMaterial({ color: SKY }); // the sky: evenly bright, not lit (a ceiling 24 m up would be dark)
  add('tak', W, D, sky, [0, H, 0], [Math.PI / 2, 0, 0]);
  add('vägg-norr', W, H, sky, [0, H / 2, -hd], [0, 0, 0]);
  add('vägg-söder', W, H, sky, [0, H / 2, hd], [0, Math.PI, 0]);
  add('vägg-väster', D, H, sky, [-hw, H / 2, 0], [0, Math.PI / 2, 0]);
  add('vägg-öster', D, H, sky, [hw, H / 2, 0], [0, -Math.PI / 2, 0]);

  const doors = [];
  const s = PLOT - PLOT_GAP;
  for (const p of PLOTS) {
    // The house (or the Town Hall): 4 walls + a roof, facing out.
    const { x, z, w, d, h, y0 } = p.house, base = p.hall ? HALL_GREEN : STONE, tag = p.hall ? 'hall' : `h${p.k}`;
    const wm = () => material(base, w, h, 20 + p.k, p.hall ? 0.2 : 0.25);
    add(`${tag}-n`, w, h, wm(), [x, y0 + h / 2, z - d / 2], [0, Math.PI, 0]);
    add(`${tag}-s`, w, h, wm(), [x, y0 + h / 2, z + d / 2], [0, 0, 0]);
    add(`${tag}-w`, d, h, wm(), [x - w / 2, y0 + h / 2, z], [0, -Math.PI / 2, 0]);
    add(`${tag}-e`, d, h, wm(), [x + w / 2, y0 + h / 2, z], [0, Math.PI / 2, 0]);
    add(`${tag}-roof`, w, d, material(base, w, d, 40 + p.k), [x, y0 + h, z], [-Math.PI / 2, 0, 0]);
    outlineBox(x, y0, z, w, h, d);
    if (p.hall) { // the three blocks: a black seam (a slight lip) at every block line
      for (let b = 1; b < HALL_BLOCKS; b++) {
        const yy = y0 + b * HOUSE.height;
        bar(w + 0.3, 'x', [x, yy, z - d / 2 - 0.05]); bar(w + 0.3, 'x', [x, yy, z + d / 2 + 0.05]);
        bar(d + 0.3, 'z', [x - w / 2 - 0.05, yy, z]); bar(d + 0.3, 'z', [x + w / 2 + 0.05, yy, z]);
      }
      // the top block's slit windows (the sketch's black dashes), on all four sides
      const wy = y0 + h - HOUSE.height / 2 + 0.6;
      for (const [nx, nz, rot] of [[0, 1, 0], [0, -1, Math.PI], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2]]) {
        for (const off of [-3.6, 3.6]) {
          const slit = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 4.2, 4, 12), ink);
          slit.rotation.set(0, rot, Math.PI / 2);
          const along = nz ? [off, 0] : [0, off];
          slit.position.set(x + nx * (w / 2 + 0.04) + along[0], wy, z + nz * (d / 2 + 0.04) + along[1]); slit.scale.set(1, 1, 0.08);
          group.add(slit);
        }
      }
    }
    // The door: a black arch, just in front of the wall (not a sticker surface).
    const { w: dw, h: dh } = p.door, r = dw / 2, shape = new THREE.Shape();
    shape.moveTo(-r, 0); shape.lineTo(r, 0); shape.lineTo(r, dh - r); shape.absarc(0, dh - r, r, 0, Math.PI, false); shape.lineTo(-r, 0);
    const door = new THREE.Mesh(new THREE.ShapeGeometry(shape, 24), p.hall ? ink : ink.clone());
    door.position.set(p.door.x, p.door.y0, p.door.z + 0.03); door.name = `door-${p.n || 'hall'}`;
    door.userData = { door: p.n || 'hall', plot: p.k }; group.add(door); doors.push(door);
    if (!p.hall) { // the house's number over its door, big (which house is which – they start in order)
      const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
      g.fillStyle = '#15130f'; g.font = '900 104px Arial Black, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(p.n), 128, 68);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const num = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshBasicMaterial({ map: t, transparent: true }));
      num.position.set(p.door.x, p.door.y0 + p.door.h + 0.75, p.door.z + 0.04); group.add(num);
    }
  }

  // Light: an open-air day – sky + ground fill and a low sun from the south-west.
  group.add(new THREE.HemisphereLight(0xf2f8ff, 0x9a9180, 1.9));
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.6); sun.position.set(-40, 60, 50); group.add(sun);
  const back = new THREE.DirectionalLight(0xdfe9ff, 0.5); back.position.set(40, 30, -50); group.add(back);

  const margin = 0.35;
  const bounds = new THREE.Box3(new THREE.Vector3(-hw + margin, 0, -hd + margin), new THREE.Vector3(hw - margin, H, hd - margin));
  const spawn = new THREE.Vector3(CITY_SPAWN.x, 1.6 + groundAt(CITY_SPAWN.x, CITY_SPAWN.z), CITY_SPAWN.z);
  return { group, surfaces, bounds, spawn, city: true, groundAt, pushOut, doorAt, doors, camFar: 260 };
}
// Which houses are started (t479u: houses start in order): a started house's door is black (go in),
// the next one to start is a warm yellow (start it), the ones after it are grey (not yet).
const DOOR_COLOURS = { started: 0x15130f, next: 0xf2b632, later: 0x9a948a };
export function markDoors(doors, { started = [], next = 0 } = {}) {
  const s = new Set(started);
  for (const d of doors) {
    const n = d.userData.door; if (n === 'hall') continue;
    const state = s.has(n) ? 'started' : n === next ? 'next' : 'later';
    d.userData.state = state; d.material.color.setHex(DOOR_COLOURS[state]);
  }
}

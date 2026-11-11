// The City scene (Jens, 2 Nov 2026, t476u; layout in shared/city.mjs). Like room.js it returns
// { group, surfaces, bounds, spawn } plus { city: true, groundAt, pushOut, doors, camFar }:
//   - surfaces you can slap on: the ground, the sky (4 walls + ceiling, 96 × 24 m / 96 × 96 m), the top
//     of every plot slab, and every house's 4 outer walls + roof (the Town Hall's too).
//   - drawn like Jens's sketch: pale stone slabs and houses, thick black outlines, black arched doors,
//     a green Town Hall of three blocks with black slit windows on its top block.
import * as THREE from 'three';
import { CITY, PLOTS, PLOT, PLOT_GAP, PLOT_SLAB, HOUSE, HALL_BLOCKS, CITY_SPAWN, PLAZA, PLAZA_BENCHES, FX_OPENING, groundAt, pushOut, doorAt, isKeptHouse } from '../../shared/city.mjs';

const STONE = 0xd2c9ba, SLAB = 0xc9bfae, HALL_GREEN = 0x9fd0a8, SKY = 0x000000, STREET = 0x8f8a82, INK = 0x15130f;
const PATH = 0xb5ab9a;
const PAVER = 0xc2b6a2, PAVER_DARK = 0xa99d88, SUBWAY_BLUE = 0x1f5fbf, FX_STONE = 0xd8c7b0; // the plaza, the subway sign, the open rooms (a touch warmer) // the painted streets: a little darker than the plots, never a dark "ditch"
// Jens (t516u, 4 Nov 2026): no black edge lines on the houses. Flip to true to bring them back.
const CITY_EDGE_LINES = false;
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
  // The plaza (rebuild, 10 Nov 2026): paving slabs from the subway station down to the Town Hall, over the
  // street between them, with a ring of darker stones in the middle.
  { const px = (PLAZA.x - PLAZA.w / 2 + W / 2) * k, py = (PLAZA.z - PLAZA.d / 2 + D / 2) * k;
    g.fillStyle = hex(PAVER); g.fillRect(px, py, PLAZA.w * k, PLAZA.d * k);
    g.strokeStyle = 'rgba(21,19,15,.18)'; g.lineWidth = 0.04 * k;
    for (let xx = 0; xx <= PLAZA.w; xx += 1.5) { g.beginPath(); g.moveTo(px + xx * k, py); g.lineTo(px + xx * k, py + PLAZA.d * k); g.stroke(); }
    for (let zz = 0; zz <= PLAZA.d; zz += 1.5) { g.beginPath(); g.moveTo(px, py + zz * k); g.lineTo(px + PLAZA.w * k, py + zz * k); g.stroke(); }
    const cx = (PLAZA.x + W / 2) * k, cy = (PLAZA.z + D / 2) * k;
    g.strokeStyle = hex(PAVER_DARK); g.lineWidth = 0.9 * k; g.beginPath(); g.arc(cx, cy, 5 * k, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 0.35 * k; g.beginPath(); g.arc(cx, cy, 2.2 * k, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(21,19,15,.45)'; g.lineWidth = 0.08 * k; g.strokeRect(px, py, PLAZA.w * k, PLAZA.d * k); }
  let r = 7 * 9301 + 49297; const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let n = 0; n < 60000; n++) { const v = rnd(); g.fillStyle = v < 0.5 ? `rgba(0,0,0,${0.03 + rnd() * 0.05})` : `rgba(255,255,255,${0.03 + rnd() * 0.06})`; g.fillRect(rnd() * c.width, rnd() * c.height, 1 + rnd() * 2, 1 + rnd() * 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ color: 0xffffff, map: t, roughness: 0.95 });
}

export function buildCityRoom({ hallColor = null, busStop: wantBus = false } = {}) {
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
    if (!CITY_EDGE_LINES) return;
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
  // Night (Jens, 11 Nov 2026): the sky ceiling + the 4 sky walls are black (were light blue 0xbfe2f6).
  const sky = new THREE.MeshBasicMaterial({ color: SKY }); // the sky: one even colour, not lit
  add('tak', W, D, sky, [0, H, 0], [Math.PI / 2, 0, 0]);
  add('vägg-norr', W, H, sky, [0, H / 2, -hd], [0, 0, 0]);
  add('vägg-söder', W, H, sky, [0, H / 2, hd], [0, Math.PI, 0]);
  add('vägg-väster', D, H, sky, [-hw, H / 2, 0], [0, Math.PI / 2, 0]);
  add('vägg-öster', D, H, sky, [hw, H / 2, 0], [0, -Math.PI / 2, 0]);

  const doors = [];
  const label = (text, w, h, { bg = null, fg = '#15130f', font = '900 104px Arial Black, Arial, sans-serif', cw = 256, ch = 128 } = {}) => {
    const c = document.createElement('canvas'); c.width = cw; c.height = ch; const g = c.getContext('2d');
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, cw, ch); }
    g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, cw / 2, ch / 2 + ch * 0.03);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: !bg }));
  };
  const arch = (p) => { // a black arch, just in front of the wall (not a sticker surface)
    const { w: dw, h: dh } = p.door, r = dw / 2, shape = new THREE.Shape();
    shape.moveTo(-r, 0); shape.lineTo(r, 0); shape.lineTo(r, dh - r); shape.absarc(0, dh - r, r, 0, Math.PI, false); shape.lineTo(-r, 0);
    const door = new THREE.Mesh(new THREE.ShapeGeometry(shape, 24), p.hall ? ink : ink.clone());
    const id = p.hall ? 'hall' : p.subway ? 'subway' : p.n;
    door.position.set(p.door.x, p.door.y0, p.door.z + 0.03); door.name = `door-${id}`;
    door.userData = { door: id, plot: p.k }; group.add(door); doors.push(door);
    return door;
  };
  // A solid box's four outer walls + roof as slap surfaces (houses, the Town Hall, the subway station).
  const solid = (tag, b, base, seed, perM = 0.25) => {
    const { x, z, w, d, h, y0 } = b, wm = () => material(base, w, h, seed, perM);
    add(`${tag}-n`, w, h, wm(), [x, y0 + h / 2, z - d / 2], [0, Math.PI, 0]);
    add(`${tag}-s`, w, h, wm(), [x, y0 + h / 2, z + d / 2], [0, 0, 0]);
    add(`${tag}-w`, d, h, material(base, d, h, seed, perM), [x - w / 2, y0 + h / 2, z], [0, -Math.PI / 2, 0]);
    add(`${tag}-e`, d, h, material(base, d, h, seed, perM), [x + w / 2, y0 + h / 2, z], [0, Math.PI / 2, 0]);
    add(`${tag}-roof`, w, d, material(base, w, d, seed + 20), [x, y0 + h, z], [-Math.PI / 2, 0, 0]);
    outlineBox(x, y0, z, w, h, d);
  };
  for (const p of PLOTS) {
    if (p.open) { // ---- an open FX room (plots 4, 5, 7): wall segments (both faces + their ends) and a roof, no door
      const tag = `fx${p.n}`, wallMat = (w, h, k) => material(FX_STONE, w, h, 60 + p.n * 7 + k);
      p.walls.forEach((b, k) => {
        const { x, z, w, d, h, y0 } = b, cy = y0 + h / 2;
        if (w >= d) { // runs east–west: a north face and a south face
          add(`${tag}-w${k}-n`, w, h, wallMat(w, h, k), [x, cy, z - d / 2], [0, Math.PI, 0]);
          add(`${tag}-w${k}-s`, w, h, wallMat(w, h, k), [x, cy, z + d / 2], [0, 0, 0]);
          add(`${tag}-w${k}-e0`, d, h, wallMat(d, h, k), [x - w / 2, cy, z], [0, -Math.PI / 2, 0], false);
          add(`${tag}-w${k}-e1`, d, h, wallMat(d, h, k), [x + w / 2, cy, z], [0, Math.PI / 2, 0], false);
        } else { // runs north–south: a west face and an east face
          add(`${tag}-w${k}-w`, d, h, wallMat(d, h, k), [x - w / 2, cy, z], [0, -Math.PI / 2, 0]);
          add(`${tag}-w${k}-e`, d, h, wallMat(d, h, k), [x + w / 2, cy, z], [0, Math.PI / 2, 0]);
          add(`${tag}-w${k}-e0`, w, h, wallMat(w, h, k), [x, cy, z - d / 2], [0, Math.PI, 0], false);
          add(`${tag}-w${k}-e1`, w, h, wallMat(w, h, k), [x, cy, z + d / 2], [0, 0, 0], false);
        }
      });
      const rf = p.roof; // the roof: a top you can slap from outside and a ceiling you can slap from inside
      add(`${tag}-roof`, rf.w, rf.d, material(FX_STONE, rf.w, rf.d, 90 + p.n), [rf.x, rf.y0 + rf.h, rf.z], [-Math.PI / 2, 0, 0]);
      add(`${tag}-ceiling`, rf.w, rf.d, material(FX_STONE, rf.w, rf.d, 95 + p.n), [rf.x, rf.y0, rf.z], [Math.PI / 2, 0, 0]);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(rf.w, rf.h, rf.d), material(FX_STONE, rf.w, rf.d, 99 + p.n));
      edge.position.set(rf.x, rf.y0 + rf.h / 2 + 0.01, rf.z); edge.scale.set(1.001, 0.98, 1.001); group.add(edge);
      // a sign over the opening: the plot's number and what the room does
      const word = { reverb: 'REVERB', delay: 'DELAY', noise: 'NOISE' }[p.fx];
      const sign = label(`${p.n} · ${word}`, 4.2, 1.05, { font: '900 88px Arial Black, Arial, sans-serif', cw: 512, ch: 128 });
      sign.name = `fx-sign-${p.n}`;
      const hw = HOUSE.width / 2;
      if (p.n === 4) { sign.position.set(p.x - hw - 0.05, HOUSE.height - 1.2, p.z); sign.rotation.y = -Math.PI / 2; }
      else if (p.n === 5) { sign.position.set(p.x + hw + 0.05, HOUSE.height - 1.2, p.z); sign.rotation.y = Math.PI / 2; }
      else sign.position.set(p.x, HOUSE.height - 1.2, p.z + HOUSE.depth / 2 + 0.05);
      group.add(sign);
      continue;
    }
    if (p.subway) { // ---- the subway station (plot 2): a low stone box, black door, a blue T sign on a pole
      const b = p.house;
      solid('subway', b, STONE, 70, 0.3);
      arch(p);
      const word = label('SUBWAY → cities', 6.4, 0.9, { bg: '#1f5fbf', fg: '#ffffff', font: '800 70px Arial, sans-serif', cw: 768, ch: 108 });
      word.name = 'subway-sign'; word.position.set(b.x, b.y0 + b.h - 0.65, b.z + b.d / 2 + 0.04); group.add(word);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 4.6, 10), ink);
      pole.position.set(b.x + 4.2, 2.3, b.z + b.d / 2 + 1.4); group.add(pole);
      const t = label('T', 1.2, 1.2, { bg: '#1f5fbf', fg: '#ffffff', font: '900 104px Arial Black, Arial, sans-serif', cw: 128, ch: 128 });
      t.name = 'subway-t'; t.position.set(b.x + 4.2, 4.4, b.z + b.d / 2 + 1.46); group.add(t);
      const tb = t.clone(); tb.rotation.y = Math.PI; tb.position.z -= 0.04; group.add(tb);
      continue;
    }
    // ---- a kept house (1, 3, 6, 8) or the Town Hall: 4 walls + a roof, facing out
    const { x, z, w, d, h, y0 } = p.house, base = p.hall ? (hallColor != null ? hallColor : HALL_GREEN) : STONE, tag = p.hall ? 'hall' : `h${p.k}`;
    solid(tag, p.house, base, 20 + p.k, p.hall ? 0.2 : 0.25);
    if (p.hall) { // the three blocks: a black seam (a slight lip) at every block line
      if (CITY_EDGE_LINES) for (let b = 1; b < HALL_BLOCKS; b++) {
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
    arch(p);
    if (!p.hall) { // the house's number over its door, big
      const num = label(String(p.n), 1.6, 0.8);
      num.position.set(p.door.x, p.door.y0 + p.door.h + 0.75, p.door.z + 0.04); group.add(num);
    }
  }
  // The plaza's benches (solid in shared/city.mjs PLAZA_BENCHES): a stone seat on two feet.
  for (const b of PLAZA_BENCHES) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(b.w, 0.12, b.d), material(STONE, b.w, b.d, 81));
    seat.position.set(b.x, b.h, b.z); seat.name = 'plaza-bench'; group.add(seat);
    for (const off of [-b.d / 2 + 0.25, b.d / 2 - 0.25]) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.8, b.h, 0.18), material(PAVER_DARK, 0.5, 0.5, 82));
      foot.position.set(b.x, b.h / 2, b.z + off); group.add(foot);
    }
  }

  // Light: night (Jens, 11 Nov 2026) – a cool moonlit fill and a dimmer moon from the south-west, so the
  // black sky reads as night but the streets, houses and doors stay readable.
  // (Day was: hemisphere 0xf2f8ff/0x9a9180 1.9, sun 0xfff1dc 1.6, back 0xdfe9ff 0.5.)
  group.add(new THREE.HemisphereLight(0x9aa8d0, 0x2a2733, 1.15));
  const sun = new THREE.DirectionalLight(0xc8d4ff, 0.9); sun.position.set(-40, 60, 50); group.add(sun); // the moon
  const back = new THREE.DirectionalLight(0x8090c0, 0.3); back.position.set(40, 30, -50); group.add(back);

  // Bus stop (city-bus TEST): large shelter between spawn and Town Hall, right of the door – in camera view.
  let busStop = null;
  if (wantBus) {
    busStop = { x: 5.2, z: 12.0, w: 4.2, d: 2.0, h: 3.4 };
    const bx = busStop.x, bz = busStop.z, bw = busStop.w, bd = busStop.d, bh = busStop.h;
    const tint = hallColor != null ? hallColor : HALL_GREEN;
    const pole = material(STONE, 0.25, bh, 77, 0.35);
    const roofMat = material(tint, bw, bd, 78, 0.25);
    const postL = new THREE.Mesh(new THREE.BoxGeometry(0.28, bh, 0.28), pole);
    postL.position.set(bx - bw / 2 + 0.25, bh / 2, bz); group.add(postL);
    const postR = new THREE.Mesh(new THREE.BoxGeometry(0.28, bh, 0.28), pole);
    postR.position.set(bx + bw / 2 - 0.25, bh / 2, bz); group.add(postR);
    const top = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.4, 0.18, bd + 0.6), roofMat);
    top.position.set(bx, bh, bz); group.add(top);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(bw - 0.6, 0.18, 0.55), material(STONE, bw, 0.5, 80));
    bench.position.set(bx, 0.55, bz + 0.2); group.add(bench);
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(bw, bh * 0.85, 0.12), material(STONE, bw, bh, 79));
    backWall.position.set(bx, bh * 0.42, bz - bd / 2); group.add(backWall);
    // Tall flagpole + bright sign facing spawn (+z) so the camera at z=17 sees "BUS"
    const poleH = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 10), ink);
    poleH.position.set(bx - bw / 2 - 0.35, 2.1, bz + 0.4); group.add(poleH);
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 320;
    const g2 = cv.getContext('2d');
    g2.fillStyle = '#15130f'; g2.fillRect(0, 0, 512, 320);
    g2.fillStyle = '#ffd400'; g2.fillRect(16, 16, 480, 288);
    g2.fillStyle = '#15130f'; g2.font = '900 140px Arial Black, Arial, sans-serif';
    g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText('BUS', 256, 140);
    g2.font = '700 48px Arial, sans-serif'; g2.fillText('→ cities', 256, 240);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.75), new THREE.MeshBasicMaterial({ map: tex }));
    sign.position.set(bx, 2.05, bz + bd / 2 + 0.08); sign.name = 'bus-stop-sign';
    sign.userData = { busStop: true, city: true };
    group.add(sign); surfaces.push(sign);
    // Back of sign (readable from hall side too)
    const signBack = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.75), new THREE.MeshBasicMaterial({ map: tex }));
    signBack.position.set(bx, 2.05, bz + bd / 2 + 0.05); signBack.rotation.y = Math.PI; group.add(signBack);
    busStop.mesh = sign;
  }

  const margin = 0.35;
  const bounds = new THREE.Box3(new THREE.Vector3(-hw + margin, 0, -hd + margin), new THREE.Vector3(hw - margin, H, hd - margin));
  const spawn = new THREE.Vector3(CITY_SPAWN.x, 1.6 + groundAt(CITY_SPAWN.x, CITY_SPAWN.z), CITY_SPAWN.z);
  return { group, surfaces, bounds, spawn, city: true, groundAt, pushOut, doorAt, doors, busStop, camFar: 260 };
}
// Which houses are started (t479u: houses start in order): a started house's door is black (go in),
// the next one to start is a warm yellow (start it), the ones after it are grey (not yet).
const DOOR_COLOURS = { started: 0x15130f, next: 0xf2b632, later: 0x9a948a };
// Rebuild (10 Nov 2026): every kept house's door is black (pt781u: "via dom svarta dörrarna") – walking in
// starts the house if nobody has yet; the subway door is black too.
export function markDoors(doors, { started = [], next = 0 } = {}) {
  const s = new Set(started);
  for (const d of doors) {
    const n = d.userData.door; if (n === 'hall' || n === 'subway') continue;
    if (isKeptHouse(n)) { d.userData.state = s.has(n) ? 'started' : 'open'; d.material.color.setHex(DOOR_COLOURS.started); continue; }
    const state = s.has(n) ? 'started' : n === next ? 'next' : 'later';
    d.userData.state = state; d.material.color.setHex(DOOR_COLOURS[state]);
  }
}

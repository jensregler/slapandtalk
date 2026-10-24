// Vikning av klibbor över kanter och hörn.
//
// Tidigare projicerades varje klibba bara på den yta där dess mittpunkt låg, så den
// del som stack ut över en kant hamnade bakom grannytan och syntes inte.
// Nu gör vi som med ett riktigt klistermärke som trycks in i ett hörn:
//
//  1. Klibban är en rektangel i planet för ytan man träffade (H).
//  2. Varje grannyta "fälls ut" kring den gemensamma kanten så att den ligger i
//     samma plan som H (som när man viker ut en kartong). Grannens grannar fälls ut
//     i två steg (behövs i rummets hörn: vägg + vägg + tak/golv).
//  3. Klibbans rektangel klipps mot varje utfälld yta. Varje bit fälls sedan
//     tillbaka till sin riktiga yta, med samma bildkoordinater (UV) som på klibban.
//     Inget sträcks ut: alla bitar är bara vridna, aldrig skalade.
//
// I ett rumshörn möts tre ytor, och det går inte att lägga ett platt papper slätt
// över alla tre (det blir en "veck-kil" över). Den kilen delas längs diagonalen och
// varje halva viks ner på den yta den sitter ihop med, under klibbans övriga bitar.
// Ingen del försvinner bakom en vägg och det blir inga glipor.
import * as THREE from 'three';

const EPS = 1e-4;

// ---------- Ytor ----------
// Gör om rummets plana rektanglar (PlaneGeometry-meshar) till ytor med hörn,
// normal (in i rummet) och grannar. Returnerar null om något inte är en rektangel,
// då används den gamla projektionen i stället.
export function facesFromSurfaces(surfaces) {
  const faces = [];
  for (const m of surfaces) {
    const g = m.geometry;
    if (!g || g.type !== 'PlaneGeometry') return null;
    m.updateMatrixWorld();
    const { width: w, height: h } = g.parameters;
    const corners = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
      .map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(m.matrixWorld));
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(m.matrixWorld).normalize();
    const center = corners.reduce((a, c) => a.add(c), new THREE.Vector3()).multiplyScalar(0.25);
    faces.push({ name: m.name, corners, normal, center, neighbors: [] });
  }
  for (const a of faces) {
    for (const b of faces) {
      if (a === b) continue;
      const shared = a.corners.filter((p) => b.corners.some((q) => p.distanceTo(q) < 1e-3));
      if (shared.length === 2) a.neighbors.push({ face: b, edge: shared });
    }
  }
  return faces;
}

// Vridning som fäller ut ytan G kring kanten mot F, så att G hamnar i F:s plan
// (på andra sidan kanten). Returnerar en Matrix4: G:s riktiga läge -> utfällt läge.
function unfoldMatrix(F, G, edge) {
  const [e0, e1] = edge;
  const dir = e1.clone().sub(e0).normalize();
  const mid = e0.clone().add(e1).multiplyScalar(0.5);
  const perp = (v) => v.addScaledVector(dir, -v.dot(dir)).normalize();
  const intoG = perp(G.center.clone().sub(mid)); // från kanten in över G
  const outOfF = perp(mid.clone().sub(F.center)); // från F ut över kanten
  const q = new THREE.Quaternion().setFromUnitVectors(intoG, outOfF);
  return new THREE.Matrix4().makeTranslation(mid.x, mid.y, mid.z)
    .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
    .multiply(new THREE.Matrix4().makeTranslation(-mid.x, -mid.y, -mid.z));
}

// ---------- 2D-klippning (klibbans eget koordinatsystem, meter) ----------
// Behåller den del av polygonen där a*x + b*y + c >= 0.
function clipHalf(poly, a, b, c) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const dp = a * p[0] + b * p[1] + c, dq = a * q[0] + b * q[1] + c;
    if (dp >= 0) out.push(p);
    if ((dp >= 0) !== (dq >= 0)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}
const area = (poly) => poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
function clipConvex(poly, clip) {
  const s = area(clip) >= 0 ? 1 : -1;
  for (let i = 0; i < clip.length && poly.length; i++) {
    const p = clip[i], q = clip[(i + 1) % clip.length];
    // insidan är till vänster om p->q (vid moturs ordning)
    const a = -(q[1] - p[1]) * s, b = (q[0] - p[0]) * s;
    poly = clipHalf(poly, a, b, -(a * p[0] + b * p[1]));
  }
  return poly;
}

// ---------- Själva vikningen ----------
// center: punkt på ytan, quaternion: klibbans vridning (z = ut från ytan), w/h i meter.
// Returnerar bitar: [{ face, uv: [[u,v]...], points: [Vector3...] }], i ritordning
// (veck-kilar först, så de hamnar under). Tom lista om ingen yta hittas.
export function foldStamp(faces, { center, quaternion, w, h, surface }) {
  const n = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
  let H = faces.find((f) => f.name === surface && f.normal.dot(n) > 0.9);
  if (!H) { // äldre data utan yta: ta närmaste yta som vetter åt rätt håll
    let best = Infinity;
    for (const f of faces) {
      const d = Math.abs(center.clone().sub(f.center).dot(f.normal));
      if (f.normal.dot(n) > 0.9 && d < best) { best = d; H = f; }
    }
  }
  if (!H) return [];
  const ex = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
  const ey = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
  // Lägg mittpunkten exakt i H:s plan.
  const c = center.clone().addScaledVector(H.normal, -center.clone().sub(H.center).dot(H.normal));
  const to2 = (p) => { const d = p.clone().sub(c); return [d.dot(ex), d.dot(ey)]; };
  const rect = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  const reach = Math.hypot(w, h) / 2 + EPS;

  // Utfällda ytor: H själv, dess grannar (ett steg) och hörngrannar (två steg).
  const id = new THREE.Matrix4();
  const layouts = [{ face: H, M: id, depth: 0 }];
  const edgeOut = new Map(); // granne -> utåtriktad normal (2D) för H:s kant mot den
  for (const { face: A, edge } of H.neighbors) {
    const M = unfoldMatrix(H, A, edge);
    layouts.push({ face: A, M, depth: 1 });
    const [p, q] = edge.map(to2);
    let nx = q[1] - p[1], ny = -(q[0] - p[0]);
    const l = Math.hypot(nx, ny); nx /= l; ny /= l;
    if (nx * -p[0] + ny * -p[1] > 0) { nx = -nx; ny = -ny; } // peka bort från H:s insida (c ligger på H)
    edgeOut.set(A, { n: [nx, ny], p });
  }
  for (const L of layouts.slice(1)) {
    for (const { face: B, edge } of L.face.neighbors) {
      if (B === H || !edgeOut.has(B)) continue; // bara riktiga hörn: B är granne till både H och A
      const M = L.M.clone().multiply(unfoldMatrix(L.face, B, edge));
      // Hörnpunkten som H, A och B delar.
      const P = H.corners.find((x) => L.face.corners.some((y) => x.distanceTo(y) < 1e-3) && B.corners.some((y) => x.distanceTo(y) < 1e-3));
      if (!P) continue;
      layouts.push({ face: B, M, depth: 2, via: L.face, corner: to2(P) });
    }
  }

  const pieces = [];
  for (const L of layouts) {
    const poly2 = L.face.corners.map((p) => to2(p.clone().applyMatrix4(L.M)));
    // snabbtest: ligger ytan alls inom klibbans räckvidd?
    if (poly2.every((p) => p[0] > reach) || poly2.every((p) => p[0] < -reach) || poly2.every((p) => p[1] > reach) || poly2.every((p) => p[1] < -reach)) continue;
    let poly = clipConvex(rect, poly2);
    if (L.depth === 2 && poly.length) {
      // Veck-kilen i hörnet delas längs diagonalen: den här halvan sitter ihop med L.via.
      const m1 = edgeOut.get(L.via).n, m2 = edgeOut.get(L.face).n;
      const a = m1[0] - m2[0], b = m1[1] - m2[1];
      poly = clipHalf(poly, a, b, -(a * L.corner[0] + b * L.corner[1]));
    }
    if (poly.length < 3 || Math.abs(area(poly)) < 1e-8) continue;
    const back = L.M.clone().invert();
    pieces.push({
      face: L.face.name, depth: L.depth,
      uv: poly.map(([x, y]) => [x / w + 0.5, y / h + 0.5]),
      points: poly.map(([x, y]) => c.clone().addScaledVector(ex, x).addScaledVector(ey, y).applyMatrix4(back)),
      normal: L.face.normal,
    });
  }
  pieces.sort((a, b) => b.depth - a.depth); // djupast (veck-kilar) först = underst
  return pieces;
}

// Bygger en BufferGeometry av bitarna, en hårsmån ut från ytorna.
export function foldGeometry(pieces, lift = 0.0008) {
  const pos = [], uv = [], nor = [], idx = [];
  for (const p of pieces) {
    const base = pos.length / 3;
    p.points.forEach((v, i) => {
      pos.push(v.x + p.normal.x * lift, v.y + p.normal.y * lift, v.z + p.normal.z * lift);
      nor.push(p.normal.x, p.normal.y, p.normal.z);
      uv.push(p.uv[i][0], p.uv[i][1]);
    });
    // Polygonens vinding: se till att framsidan vetter mot rummet.
    const nw = new THREE.Vector3(); // Newells metod: robust även med dubbletter i hörnen
    p.points.forEach((a, i) => {
      const b = p.points[(i + 1) % p.points.length];
      nw.x += (a.y - b.y) * (a.z + b.z); nw.y += (a.z - b.z) * (a.x + b.x); nw.z += (a.x - b.x) * (a.y + b.y);
    });
    const flip = nw.dot(p.normal) < 0;
    for (let i = 1; i < p.points.length - 1; i++) {
      if (flip) idx.push(base, base + i + 1, base + i); else idx.push(base, base + i, base + i + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

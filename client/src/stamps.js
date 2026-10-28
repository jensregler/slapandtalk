// Stämplarna: varje klibba är en "decal", en bild som projiceras på en yta
// (vägg, golv eller tak), ungefär som en diaprojektor som lyser rakt på väggen.
import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { facesFromSurfaces, foldStamp, foldGeometry } from './fold.js';

const loader = new THREE.TextureLoader();
const DEPTH = 0.25; // hur "djup" projektionen är (meter)

// ---------- "Inmålade" klibbor (prestanda) ----------
// Varje klibba som egen mesh blir över tusen ritanrop per bildruta i ett fullt rum. Därför
// "målas" klibbor som inte längre går att peela in i väggarna: de slås ihop till några få
// stora meshar (en per sammanhängande nummerserie, CHUNK_MAX åt gången), med alla designer i
// en gemensam texturlista (DataArrayTexture, ett lager per design). Ritordningen inne i en
// sammanslagen mesh följer klibbornas nummer, så nyare hamnar fortfarande ovanpå äldre.
// Bara de nyaste (LIVE_RECENT i rummet, plus mina egna peel-bara, keepLive) är egna meshar.
export const LIVE_RECENT = 30;
const BAKE_IDLE_MS = 700; // vänta tills det är lugnt en stund innan man målar in
const BAKE_MAX_WAIT_MS = 3000; // ... men aldrig längre än så
const CHUNK_MAX = 4096; // klibbor per sammanslagen mesh
const PAGE_LAYERS_MAX = 64; // designer per texturlista (WebGL2 klarar minst 256)
// Lagerstorlek: telefoner (grov pekare) 512 px, annars 1024 px (designerna är högst 1024 px).
const layerSize = () => ((typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) ? 512 : 1024);

// Samma material som de enskilda klibborna (ljus, alphaTest, polygonOffset), men bilden
// hämtas ur texturlistan med lagret från vertexattributet stampLayer.
function bakedMaterial(uniform) {
  const m = new THREE.MeshStandardMaterial({
    transparent: true, depthWrite: false, depthTest: true, alphaTest: 0.02,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.75,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.stampTex = uniform;
    sh.vertexShader = 'attribute float stampLayer;\nvarying vec3 vStampUv;\n'
      + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvStampUv = vec3(uv, stampLayer);');
    // Lagren laddas upp uppifrån och ner (ingen flipY för 3D-texturer): v vänds här i stället.
    sh.fragmentShader = 'uniform highp sampler2DArray stampTex;\nvarying vec3 vStampUv;\n'
      + sh.fragmentShader.replace('#include <map_fragment>', 'diffuseColor *= texture(stampTex, vec3(vStampUv.x, 1.0 - vStampUv.y, vStampUv.z));');
  };
  m.customProgramCacheKey = () => 'klibb-baked-stamps';
  return m;
}

let scratch = null; // en canvas för att skala om designerna till lagerstorleken
class StampPage {
  constructor(index, size) {
    this.index = index; this.size = size;
    this.layers = new Map(); // imageId -> lager
    this.cap = 0; this.data = null; this.tex = null; this.uploaded = false;
    this.uniform = { value: null };
    this.material = bakedMaterial(this.uniform);
  }
  get full() { return this.layers.size >= PAGE_LAYERS_MAX; }
  grow() {
    const S = this.size, cap = Math.min(PAGE_LAYERS_MAX, this.cap + 8);
    const data = new Uint8Array(S * S * 4 * cap);
    if (this.data) data.set(this.data);
    const tex = new THREE.DataArrayTexture(data, S, S, cap);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true; tex.anisotropy = 8;
    tex.onUpdate = () => { this.uploaded = true; };
    tex.needsUpdate = true;
    if (this.tex) this.tex.dispose();
    this.tex = tex; this.data = data; this.cap = cap; this.uploaded = false;
    this.uniform.value = tex;
  }
  // Lagret för designen (läggs till vid behov). -1 om det inte går (listan full, bilden oläsbar).
  layerOf(image, texture) {
    if (this.layers.has(image.id)) return this.layers.get(image.id);
    if (this.full) return -1;
    const src = texture?.image;
    if (!src || !(src.width || src.naturalWidth)) return -1;
    const S = this.size;
    let px;
    try {
      if (!scratch) scratch = document.createElement('canvas');
      scratch.width = scratch.height = S;
      const ctx = scratch.getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, S, S); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, S, S);
      px = ctx.getImageData(0, 0, S, S).data;
    } catch { return -1; }
    const L = this.layers.size;
    const grew = L >= this.cap;
    if (grew) this.grow();
    this.data.set(px, L * S * S * 4);
    this.layers.set(image.id, L);
    // Redan uppladdad: skicka bara det nya lagret. Annars laddas allt upp första gången den ritas.
    if (!grew && this.uploaded) this.tex.addLayerUpdate(L);
    this.tex.needsUpdate = true;
    return L;
  }
  dispose() { this.tex?.dispose(); this.material.dispose(); }
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _p = new THREE.Vector3();

export class StampLayer {
  constructor(scene, surfaces) {
    this.scene = scene;
    this.surfaces = surfaces;
    // Rektangulära ytor (lådrummet) -> klibbor viks över kanter och hörn.
    // Annars (t.ex. ett rum från Blender) används den gamla projektionen.
    this.faces = facesFromSurfaces(surfaces);
    this.textures = new Map(); // imageId -> Promise<Texture>
    this.loaded = new Map(); // imageId -> Texture (när den har laddats)
    this.recent = []; // senast efterfrågade designer (förhandsvisningen): deras texturer får vara kvar
    this.materials = new Map(); // imageId -> Material
    // stampId -> Mesh (levande klibba) eller { baked: true, userData, renderOrder } (inmålad)
    this.meshes = new Map();
    this.gone = new Set(); // borttagna id:n (så en sen "stamp:add" inte får tillbaka dem)
    this.baked = new Map(); // stampId -> inmålad klibba (geometri + var den ligger i sin chunk)
    this.chunks = new Map(); // nyckel -> sammanslagen mesh
    this.pages = [];
    this.keepLive = null; // () => stampId[] som ska förbli levande (t.ex. mina peel-bara)
    this.bakeEnabled = true;
    this.bakeTimer = 0; this.bakeSince = 0; this.animating = 0;
  }

  // Designens textur (förhandsvisningen använder samma). De senast efterfrågade släpps inte.
  texture(image) {
    this.recent = [image.id, ...this.recent.filter((id) => id !== image.id)].slice(0, 4);
    return this.loadTexture(image);
  }
  loadTexture(image) {
    if (!this.textures.has(image.id)) {
      this.textures.set(image.id, loader.loadAsync(image.url).then((t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        this.loaded.set(image.id, t);
        return t;
      }));
    }
    return this.textures.get(image.id);
  }

  async material(image) {
    if (!this.materials.has(image.id)) {
      const map = await this.loadTexture(image);
      // depthWrite:false + polygonOffset: klibban ritas en aning "framför" väggen
      // utan att flimra. renderOrder (= stämpelns nummer) avgör vilken som hamnar överst.
      if (!this.materials.has(image.id)) {
        this.materials.set(image.id, new THREE.MeshStandardMaterial({
          map, transparent: true, depthWrite: false, depthTest: true, alphaTest: 0.02,
          polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.75,
        }));
      }
    }
    return this.materials.get(image.id);
  }

  // Räknar ut hur klibban ska vändas: rakt ut från ytan, och med "uppåt" uppåt.
  // På golv och tak är "uppåt" den riktning du tittar åt, så den blir rättvänd för dig.
  static orientation(normal, viewDir, rotationDeg) {
    const z = normal.clone().normalize();
    let up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(z.y) > 0.9) {
      up = viewDir.clone().setY(0);
      if (up.lengthSq() < 1e-6) up.set(0, 0, -1);
      up.normalize();
      if (z.y < 0) up.negate(); // i taket: toppen mot dig
    }
    const x = new THREE.Vector3().crossVectors(up, z).normalize();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(-rotationDeg));
    return q.multiply(spin);
  }

  static dims(image, size) {
    const a = (image.width || 1) / (image.height || 1);
    return a >= 1 ? [size, size / a] : [size * a, size];
  }

  findSurface(stamp) {
    return this.surfaces.find((s) => s.name === stamp.surface) || null;
  }

  // Geometrin för en stämpel. Fungerar för gamla sparade stämplar också:
  // allt som behövs (position, quaternion, size, surface) har alltid sparats.
  geometry(stamp, image) {
    const pos = new THREE.Vector3(...stamp.position);
    const quat = new THREE.Quaternion(...stamp.quaternion);
    const [w, h] = StampLayer.dims(image, stamp.size);
    if (this.faces) {
      const pieces = foldStamp(this.faces, { center: pos, quaternion: quat, w, h, surface: stamp.surface });
      return pieces.length ? foldGeometry(pieces) : null;
    }
    const euler = new THREE.Euler().setFromQuaternion(quat);
    const targets = this.findSurface(stamp) ? [this.findSurface(stamp)] : this.surfaces;
    for (const surf of targets) {
      const g = new DecalGeometry(surf, pos, euler, new THREE.Vector3(w, h, DEPTH));
      if (g.attributes.position.count > 0) return g;
      g.dispose();
    }
    return null;
  }

  async add(stamp, image) {
    if (this.meshes.has(stamp.id) || !image) return;
    let mat;
    try { mat = await this.material(image); } catch {
      // Bilden gick inte att hämta (borta från servern): hoppa över stämpeln i stället
      // för att låta den förstöra resten av rummet.
      this.textures.delete(image.id);
      return;
    }
    const geom = this.geometry(stamp, image);
    if (!geom) return;
    if (this.meshes.has(stamp.id) || this.gone.has(stamp.id)) { geom.dispose(); return; } // redan där, eller borttagen medan bilden laddades
    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = 10 + stamp.order;
    mesh.userData = { stamp, image };
    this.scene.add(mesh);
    this.meshes.set(stamp.id, mesh);
    this.scheduleBake();
  }

  // Högsta numret bland klibborna (en ny tillfällig klibba hamnar överst).
  topOrder() {
    let max = 0;
    for (const m of this.meshes.values()) max = Math.max(max, m.userData.stamp.order || 0);
    return max;
  }

  // En tillfällig klibba (visad direkt vid slap) blir serverns stämpel: samma mesh, nytt id.
  // Svar: false om den tillfälliga inte finns (än), då får man lägga till stämpeln vanligt.
  confirm(tempId, stamp, image) {
    const m = this.meshes.get(tempId);
    if (!m) { this.gone.add(tempId); return false; } // laddas den fortfarande ska den inte dyka upp
    this.meshes.delete(tempId); this.gone.add(tempId);
    if (this.meshes.has(stamp.id) || this.gone.has(stamp.id)) { // redan där, eller peelad
      this.scene.remove(m); m.geometry.dispose(); if (m.userData.ownMaterial) m.material.dispose();
      return true;
    }
    const hl = m.userData.hl;
    m.userData = { stamp, image, ...(hl ? { hl } : {}) };
    m.renderOrder = 10 + stamp.order + (hl ? 1e5 : 0);
    this.meshes.set(stamp.id, m);
    this.scheduleBake();
    return true;
  }

  remove(stampId) {
    this.gone.add(stampId);
    const m = this.meshes.get(stampId);
    if (!m) return;
    if (m.baked) { this.unbake(stampId); return; }
    this.scene.remove(m);
    m.geometry.dispose();
    if (m.userData.ownMaterial) m.material.dispose();
    this.meshes.delete(stampId);
    this.scheduleBake();
  }

  // Peel: klibban tonar bort och krymper lite (200 ms) och tas sedan bort.
  // En inmålad klibba (sällsynt: taket på servern, admin) försvinner direkt i stället.
  peelAway(stampId, ms = 200) {
    this.gone.add(stampId);
    const m = this.meshes.get(stampId);
    if (!m) return Promise.resolve();
    if (m.baked) { this.unbake(stampId); return Promise.resolve(); }
    this.meshes.delete(stampId); // syns inte längre i räkning/val
    this.scheduleBake();
    const base = m.material;
    m.material = base.clone(); m.userData.ownMaterial = true;
    m.geometry.computeBoundingSphere();
    const c = m.geometry.boundingSphere.center.clone();
    const t0 = performance.now();
    this.animating++;
    return new Promise((resolve) => {
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        m.material.opacity = 1 - k;
        const s = 1 - 0.25 * k; // krymp mot mitten
        m.scale.setScalar(s); m.position.copy(c).multiplyScalar(1 - s);
        if (k < 1) requestAnimationFrame(step);
        else { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); this.animating--; resolve(); }
      };
      requestAnimationFrame(step);
    });
  }

  // Markera en stämpel (t.ex. när man pekar på den i historiken). Bara levande klibbor.
  highlight(stampId, on) {
    const m = this.meshes.get(stampId);
    if (!m || m.baked) return;
    if (on && !m.userData.hl) {
      m.userData.hl = m.material;
      m.material = m.material.clone();
      m.material.emissive = new THREE.Color(0x665500); m.material.color = new THREE.Color(1, 1, 0.55);
      m.renderOrder += 1e5;
    } else if (!on && m.userData.hl) {
      m.material.dispose(); m.material = m.userData.hl; m.userData.hl = null; m.renderOrder -= 1e5;
      this.scheduleBake();
    }
  }

  removeImage(imageId) {
    for (const [id, m] of this.meshes) if (m.userData.image.id === imageId) this.remove(id);
  }

  // Vilken stämpel träffar strålen? Den översta (högst nummer) om flera ligger på samma ställe.
  // Svar: { stamp, image, distance } eller null. Inmålade klibbor räknas också (t.ex. för
  // konstnärens namn), testade mot sina egna trianglar efter en snabb koll mot en omslutande sfär.
  pick(raycaster) {
    const live = [];
    for (const m of this.meshes.values()) if (!m.baked) live.push(m);
    const hits = raycaster.intersectObjects(live, false).map((h) => ({ distance: h.distance, ud: h.object.userData }));
    const { ray, near: rNear, far: rFar } = raycaster;
    for (const r of this.baked.values()) {
      if (!ray.intersectsSphere(r.sphere)) continue;
      const P = r.pos, I = r.idx;
      let best = Infinity;
      for (let i = 0; i < I.length; i += 3) {
        _a.fromArray(P, I[i] * 3); _b.fromArray(P, I[i + 1] * 3); _c.fromArray(P, I[i + 2] * 3);
        if (!ray.intersectTriangle(_a, _b, _c, true, _p)) continue;
        const d = ray.origin.distanceTo(_p);
        if (d >= rNear && d <= rFar && d < best) best = d;
      }
      if (best < Infinity) hits.push({ distance: best, ud: r.handle.userData });
    }
    if (!hits.length) return null;
    hits.sort((a, b) => a.distance - b.distance);
    const near = hits.filter((h) => h.distance - hits[0].distance < 0.02);
    near.sort((a, b) => b.ud.stamp.order - a.ud.stamp.order);
    return { stamp: near[0].ud.stamp, image: near[0].ud.image, distance: near[0].distance };
  }

  get count() { return this.meshes.size; }

  // ---------- Inmålning ----------
  scheduleBake() {
    if (!this.bakeEnabled) return;
    const now = performance.now();
    if (!this.bakeSince) this.bakeSince = now;
    clearTimeout(this.bakeTimer);
    const wait = Math.max(0, Math.min(BAKE_IDLE_MS, this.bakeSince + BAKE_MAX_WAIT_MS - now));
    this.bakeTimer = setTimeout(() => this.bake(), wait);
  }

  pageFor(image, tex) {
    for (const pg of this.pages) if (pg.layers.has(image.id)) return [pg, pg.layers.get(image.id)];
    let pg = this.pages.find((x) => !x.full);
    if (!pg) { pg = new StampPage(this.pages.length, layerSize()); this.pages.push(pg); }
    const L = pg.layerOf(image, tex);
    return L < 0 ? null : [pg, L];
  }

  // Målar in alla klibbor som inte behöver vara levande, och bygger om de sammanslagna
  // meshar som har ändrats. Svar: hur många som målades in nu.
  bake() {
    clearTimeout(this.bakeTimer); this.bakeTimer = 0; this.bakeSince = 0;
    const keep = new Set(this.keepLive ? this.keepLive() : []);
    const all = [...this.meshes.values()].map((m) => m.userData.stamp);
    if (all.length > LIVE_RECENT) all.sort((a, b) => b.order - a.order);
    for (const s of all.slice(0, LIVE_RECENT)) keep.add(s.id);
    let n = 0;
    for (const [id, m] of this.meshes) {
      if (m.baked || keep.has(id) || id.startsWith('tmp-') || m.userData.stamp.pending || m.userData.hl || m.userData.ownMaterial) continue;
      const { stamp, image } = m.userData;
      const tex = this.loaded.get(image.id);
      const pl = tex && this.pageFor(image, tex);
      if (!pl) continue;
      const g = m.geometry;
      const pos = Float32Array.from(g.attributes.position.array);
      const idx = g.index ? Uint32Array.from(g.index.array) : Uint32Array.from({ length: g.attributes.position.count }, (_, i) => i);
      g.computeBoundingSphere();
      const handle = { baked: true, userData: { stamp, image }, renderOrder: 10 + stamp.order };
      this.baked.set(id, {
        id, stamp, image, handle, page: pl[0], layer: pl[1], pos, idx,
        nor: Float32Array.from(g.attributes.normal.array), uv: Float32Array.from(g.attributes.uv.array),
        sphere: g.boundingSphere.clone(), chunk: null, start: 0,
      });
      this.scene.remove(m); g.dispose();
      this.meshes.set(id, handle);
      n++;
    }
    if (n || this.dirty) this.rechunk();
    this.releaseTextures();
    return n;
  }

  // Delar in de inmålade klibborna i sammanhängande serier (efter nummer). En serie bryts
  // där en levande klibba ligger emellan, så att ritordningen blir exakt som förut.
  rechunk() {
    this.dirty = false;
    const recs = [...this.baked.values()].sort((a, b) => a.stamp.order - b.stamp.order);
    const liveOrders = [];
    for (const m of this.meshes.values()) if (!m.baked) liveOrders.push(m.userData.stamp.order);
    liveOrders.sort((a, b) => a - b);
    const groups = [];
    let cur = null, li = 0;
    for (const r of recs) {
      let split = false;
      while (li < liveOrders.length && liveOrders[li] < r.stamp.order) { li++; split = true; }
      if (!cur || split || cur.page !== r.page || cur.recs.length >= CHUNK_MAX) { cur = { page: r.page, recs: [] }; groups.push(cur); }
      cur.recs.push(r);
    }
    const next = new Map();
    for (const gr of groups) {
      let sum = 0; for (const r of gr.recs) sum += r.stamp.order;
      const key = `${gr.page.index}:${gr.recs[0].id}:${gr.recs.at(-1).id}:${gr.recs.length}:${sum}`;
      const old = this.chunks.get(key);
      if (old) { this.chunks.delete(key); next.set(key, old); continue; }
      next.set(key, this.buildChunk(gr, key));
    }
    for (const c of this.chunks.values()) this.disposeChunk(c);
    this.chunks = next;
  }

  buildChunk({ page, recs }, key) {
    let nv = 0, ni = 0;
    for (const r of recs) { nv += r.pos.length / 3; ni += r.idx.length; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), lay = new Float32Array(nv);
    const idx = new Uint32Array(ni);
    const chunk = { key, mesh: null, alive: recs.length };
    let v = 0, i = 0;
    for (const r of recs) {
      const n = r.pos.length / 3;
      pos.set(r.pos, v * 3); nor.set(r.nor, v * 3); uv.set(r.uv, v * 2); lay.fill(r.layer, v, v + n);
      for (let k = 0; k < r.idx.length; k++) idx[i + k] = r.idx[k] + v;
      r.chunk = chunk; r.start = i;
      v += n; i += r.idx.length;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('stampLayer', new THREE.BufferAttribute(lay, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, page.material);
    // Ritas efter alla äldre levande klibbor och före alla nyare (serien bryts vid levande).
    mesh.renderOrder = 10 + recs.at(-1).stamp.order;
    mesh.matrixAutoUpdate = false;
    mesh.userData = { bakedChunk: true, count: recs.length };
    this.scene.add(mesh);
    chunk.mesh = mesh;
    return chunk;
  }

  disposeChunk(c) { this.scene.remove(c.mesh); c.mesh.geometry.dispose(); }

  // En inmålad klibba tas bort (sällsynt): dess trianglar nollas direkt, och serien byggs om
  // i lugn och ro vid nästa inmålning.
  unbake(id) {
    const r = this.baked.get(id);
    this.baked.delete(id); this.meshes.delete(id);
    if (!r) return;
    const c = r.chunk;
    if (c && this.chunks.get(c.key) === c) {
      if (--c.alive <= 0) { this.disposeChunk(c); this.chunks.delete(c.key); }
      else {
        const ix = c.mesh.geometry.index;
        ix.array.fill(ix.array[r.start], r.start, r.start + r.idx.length);
        ix.addUpdateRange(r.start, r.idx.length); ix.needsUpdate = true;
      }
    }
    this.dirty = true;
    this.scheduleBake();
  }

  // Designer som bara finns inmålade behöver inte sin egen textur på grafikkortet (laddas upp
  // igen av sig själv om de behövs). De senast valda (förhandsvisningen) får vara kvar.
  releaseTextures() {
    if (this.animating) return;
    const used = new Set(this.recent);
    for (const m of this.meshes.values()) if (!m.baked) used.add(m.userData.image.id);
    for (const [id, t] of this.loaded) if (!used.has(id)) t.dispose();
  }

  // För tester och felsökning.
  stats() {
    let live = 0; for (const m of this.meshes.values()) if (!m.baked) live++;
    return { live, baked: this.baked.size, chunks: this.chunks.size, pages: this.pages.length,
      layers: this.pages.reduce((s, p) => s + p.layers.size, 0), layerSize: this.pages[0]?.size || 0 };
  }
}

// Hur genomskinlig klibban man håller i är. 1 = helt ogenomskinlig, som en riktig klibba
// (Tittläget V finns för att se väggen utan klibban i vägen). Sätt t.ex. 0.55 för att gå tillbaka.
export const HELD_OPACITY = 1;

// Förhandsvisningen av klibban man håller i, som följer siktet (1:a och 3:e person).
// Den viks på samma sätt som den riktiga klibban, så man ser hur den hamnar i hörn.
// Formen på utskurna PNG:er behålls med alphaTest; opacity påverkar inte formen.
// The held sticker's drop shadow (Jens, 28 Oct 2026): light from above, so on a wall the shadow
// falls straight down a little below it, tight and soft, and the sticker seems to float just off
// the wall; on a floor/ceiling it lies straight under it (a soft rim). It is the sticker's own
// silhouette, blurred (a padded, blurred alpha copy of its texture), on the same fold/rotation/size
// as the preview, so it follows every turn and scale. Only the held sticker (live: 1st and 3rd
// person; replay/recordings/video: every person's held one) – never the placed stickers.
export const HELD_SHADOW = { opacity: 0.4, pad: 0.07, blur: 0.03, offset: 0.035, offsetMin: 0.006, offsetMax: 0.035 };
const shadowTex = new WeakMap(); // texture -> { tex, kx, ky }
function shadowFor(tex) {
  if (!tex || !tex.image) return null;
  if (shadowTex.has(tex)) return shadowTex.get(tex);
  const img = tex.image, iw = img.naturalWidth || img.videoWidth || img.width, ih = img.naturalHeight || img.videoHeight || img.height;
  if (!(iw > 0 && ih > 0) || typeof document === 'undefined') return null;
  const k = Math.min(1, 256 / Math.max(iw, ih)), w = Math.max(2, Math.round(iw * k)), h = Math.max(2, Math.round(ih * k));
  const m = Math.max(w, h), pad = Math.ceil(HELD_SHADOW.pad * m), blur = Math.max(1, HELD_SHADOW.blur * m);
  const sil = document.createElement('canvas'); sil.width = w; sil.height = h;
  const sc = sil.getContext('2d'); sc.drawImage(img, 0, 0, w, h); sc.globalCompositeOperation = 'source-in'; sc.fillStyle = '#000'; sc.fillRect(0, 0, w, h);
  const c = document.createElement('canvas'); c.width = w + 2 * pad; c.height = h + 2 * pad;
  const ctx = c.getContext('2d');
  if ('filter' in ctx) { ctx.filter = `blur(${blur.toFixed(1)}px)`; ctx.drawImage(sil, pad, pad); ctx.filter = 'none'; }
  else { // no canvas filter (older Safari): average a ring of copies
    const N = 12; ctx.globalAlpha = 1 / (N + 1); ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(sil, pad, pad);
    for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2; ctx.drawImage(sil, pad + Math.cos(a) * blur * 0.8, pad + Math.sin(a) * blur * 0.8); }
  }
  const t = new THREE.CanvasTexture(c); t.flipY = tex.flipY;
  const out = { tex: t, kx: c.width / w, ky: c.height / h };
  shadowTex.set(tex, out);
  return out;
}
const DOWN = new THREE.Vector3(0, -1, 0);

export class StampPreview {
  constructor(scene, faces = null) {
    this.faces = faces;
    this.mat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: HELD_OPACITY, alphaTest: 0.02, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.mesh.renderOrder = 1e6;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.key = '';
    scene.add(this.mesh);
    // the drop shadow (HELD_SHADOW): drawn just before the sticker, a hair closer to the wall
    this.shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: HELD_SHADOW.opacity, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.shadowMat);
    this.shadow.renderOrder = 1e6 - 1;
    this.shadow.visible = false;
    this.shadow.frustumCulled = false;
    this.shadowInfo = null;
    this.skey = '';
    scene.add(this.shadow);
  }
  setTexture(tex) {
    this.mat.map = tex; this.mat.needsUpdate = true;
    this.shadowInfo = shadowFor(tex);
    this.shadowMat.map = this.shadowInfo ? this.shadowInfo.tex : null; this.shadowMat.needsUpdate = true; this.skey = '';
  }
  // Where the shadow goes: world "down" laid onto the surface (walls: straight down; floor/ceiling:
  // nothing – it lies right under), as long as the sticker is big: a tight few cm at most.
  shadowShift(normal, w, h) {
    const n = normal.clone().normalize(), d = DOWN.clone().addScaledVector(n, -DOWN.dot(n));
    const len = HELD_SHADOW.offset * Math.max(w, h);
    return d.multiplyScalar(Math.min(HELD_SHADOW.offsetMax, Math.max(HELD_SHADOW.offsetMin, len)));
  }
  show(point, normal, quaternion, w, h, surface) {
    this.mesh.visible = !!this.mat.map;
    const si = this.shadowInfo; this.shadow.visible = this.mesh.visible && !!si;
    const shift = this.shadowShift(normal, w, h);
    if (!this.faces) {
      if (this.key !== 'plane') { this.mesh.geometry.dispose(); this.mesh.geometry = new THREE.PlaneGeometry(1, 1); this.key = 'plane'; }
      this.mesh.position.copy(point).addScaledVector(normal, 0.003);
      this.mesh.quaternion.copy(quaternion);
      this.mesh.scale.set(w, h, 1);
      if (si) {
        this.shadow.position.copy(point).addScaledVector(normal, 0.0012).add(shift);
        this.shadow.quaternion.copy(quaternion);
        this.shadow.scale.set(w * si.kx, h * si.ky, 1);
      }
      return;
    }
    // Bygg bara om geometrin när något har ändrats.
    const key = [...point.toArray(), ...quaternion.toArray(), w, h, surface].map((v) => (typeof v === 'number' ? v.toFixed(4) : v)).join();
    if (key !== this.key) {
      this.key = key;
      const pieces = foldStamp(this.faces, { center: point, quaternion, w, h, surface });
      this.mesh.geometry.dispose();
      this.mesh.geometry = foldGeometry(pieces, 0.0015);
    }
    if (si) {
      const skey = key + '|' + si.kx.toFixed(4) + si.ky.toFixed(4);
      if (skey !== this.skey) {
        this.skey = skey;
        // the padded shadow rectangle, folded over the same faces as the sticker (UVs 0–1 = the padded texture)
        const sp = foldStamp(this.faces, { center: point.clone().add(shift), quaternion, w: w * si.kx, h: h * si.ky, surface });
        this.shadow.geometry.dispose();
        this.shadow.geometry = foldGeometry(sp, 0.0007);
      }
    }
  }
  hide() { this.mesh.visible = false; this.shadow.visible = false; }
  // for the tests
  shadowState() {
    const c = (m) => { if (!this.faces) return m.position.clone(); m.geometry.computeBoundingBox(); return m.geometry.boundingBox.getCenter(new THREE.Vector3()); };
    const on = this.shadow.visible && this.mesh.visible;
    return { visible: on, hasMap: !!this.shadowMat.map, opacity: this.shadowMat.opacity, kx: this.shadowInfo?.kx ?? 0, ky: this.shadowInfo?.ky ?? 0,
      below: on ? c(this.mesh).y - c(this.shadow).y : null }; // > 0 on a wall: the shadow is lower than the sticker
  }
}

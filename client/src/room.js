// Rummet. I v1 byggs det med kod: en låda på 16 x 8 x 16 meter (shared/room.json; var 10 x 4 x 10 till 2 nov 2026).
// Senare kan det bytas mot en modell från Blender (glTF/.glb): se loadGltfRoom.
// Det enda resten av appen behöver är:  { group, surfaces, bounds }
//   group    = allt som ska läggas i scenen
//   surfaces = de ytor (meshar) man får stämpla på
//   bounds   = hur långt man får gå (så man inte går genom väggarna)
import * as THREE from 'three';
import ROOM_SIZE from '../../shared/room.json';

export function buildBoxRoom({ width = ROOM_SIZE.width, height = ROOM_SIZE.height, depth = ROOM_SIZE.depth } = {}) {
  const group = new THREE.Group();
  const surfaces = [];

  // Varje yta får ett eget material, så texturen kan upprepas rätt för just den ytans mått.
  // Själva utseendet (golv, väggar, tak) läggs på av roomstyle.js (applyStyle).
  const mat = () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  const add = (name, w, h, mat, pos, rot) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.name = name;
    m.position.set(...pos);
    m.rotation.set(...rot);
    m.updateMatrixWorld();
    group.add(m); surfaces.push(m);
  };
  const hw = width / 2, hd = depth / 2;
  add('golv', width, depth, mat(), [0, 0, 0], [-Math.PI / 2, 0, 0]);
  add('tak', width, depth, mat(), [0, height, 0], [Math.PI / 2, 0, 0]);
  add('vägg-norr', width, height, mat(), [0, height / 2, -hd], [0, 0, 0]);
  add('vägg-söder', width, height, mat(), [0, height / 2, hd], [0, Math.PI, 0]);
  add('vägg-väster', depth, height, mat(), [-hw, height / 2, 0], [0, Math.PI / 2, 0]);
  add('vägg-öster', depth, height, mat(), [hw, height / 2, 0], [0, -Math.PI / 2, 0]);

  // Ljus: ett mjukt allmänljus + några lampor i taket (ceilingLights: samma ljus på golvet som i det gamla rummet).
  group.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.6));
  for (const { x, y, z, intensity, distance } of ceilingLights(width, height, depth)) {
    const l = new THREE.PointLight(CEILING_LIGHT_COLOR, intensity, distance, CEILING_LIGHT_DECAY);
    l.position.set(x, y, z);
    group.add(l);
  }

  const margin = 0.35;
  const bounds = new THREE.Box3(new THREE.Vector3(-hw + margin, 0, -hd + margin), new THREE.Vector3(hw - margin, height, hd - margin));
  return { group, surfaces, bounds, spawn: new THREE.Vector3(0, 1.6, depth * 0.35) }; // (3.5 m in the 10 m room, 5.6 m in the 16 m one)
}

// The four ceiling lamps for a box (also roomsize.js): a quarter of the way in from each wall, 0.3 m
// under the ceiling. The old 10 × 4 × 10 m room had intensity 6, reach 9 m, decay 1.6; in a bigger
// room they are further from the floor and from each other, so they get brighter and reach further
// (the same light where you stand as before).
// Their colour (warm white) and fall-off – shared with the city's open FX rooms (city.js).
export const CEILING_LIGHT_COLOR = 0xfff4e0, CEILING_LIGHT_DECAY = 1.6;
export function ceilingLights(width, height, depth) {
  const drop = Math.max(1, (height - 0.3) / 3.7), spread = Math.max(1, Math.max(width, depth) / 10);
  const intensity = 6 * Math.pow(drop, 1.6), distance = 9 * Math.max(drop, spread);
  return [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => ({ x: sx * width / 4, y: height - 0.3, z: sz * depth / 4, intensity, distance }));
}

// För senare: ladda ett rum gjort i Blender (Arkiv > Exportera > glTF 2.0, .glb).
// Alla meshar i filen blir stämplingsbara ytor.
export async function loadGltfRoom(url) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(url);
  const group = gltf.scene;
  group.updateMatrixWorld(true);
  const surfaces = [];
  group.traverse((o) => { if (o.isMesh) surfaces.push(o); });
  const bounds = new THREE.Box3().setFromObject(group).expandByScalar(-0.35);
  group.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.6));
  return { group, surfaces, bounds, spawn: new THREE.Vector3(0, 1.6, 0) };
}

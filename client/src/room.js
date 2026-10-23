// Rummet. I v1 byggs det med kod: en låda på 10 x 4 x 10 meter.
// Senare kan det bytas mot en modell från Blender (glTF/.glb): se loadGltfRoom.
// Det enda resten av appen behöver är:  { group, surfaces, bounds }
//   group    = allt som ska läggas i scenen
//   surfaces = de ytor (meshar) man får stämpla på
//   bounds   = hur långt man får gå (så man inte går genom väggarna)
import * as THREE from 'three';

function noiseTexture(base, spread, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = base + (Math.random() - 0.5) * spread;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildBoxRoom({ width = 10, height = 4, depth = 10 } = {}) {
  const group = new THREE.Group();
  const surfaces = [];

  const wallTex = noiseTexture(232, 14); wallTex.repeat.set(3, 1.5);
  const floorTex = noiseTexture(150, 40); floorTex.repeat.set(6, 6);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95 });
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9 });
  const ceilMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 1 });

  const add = (name, w, h, mat, pos, rot) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.name = name;
    m.position.set(...pos);
    m.rotation.set(...rot);
    m.updateMatrixWorld();
    group.add(m); surfaces.push(m);
  };
  const hw = width / 2, hd = depth / 2;
  add('golv', width, depth, floorMat, [0, 0, 0], [-Math.PI / 2, 0, 0]);
  add('tak', width, depth, ceilMat, [0, height, 0], [Math.PI / 2, 0, 0]);
  add('vägg-norr', width, height, wallMat, [0, height / 2, -hd], [0, 0, 0]);
  add('vägg-söder', width, height, wallMat, [0, height / 2, hd], [0, Math.PI, 0]);
  add('vägg-väster', depth, height, wallMat, [-hw, height / 2, 0], [0, Math.PI / 2, 0]);
  add('vägg-öster', depth, height, wallMat, [hw, height / 2, 0], [0, -Math.PI / 2, 0]);

  // Ljus: ett mjukt allmänljus + några lampor i taket.
  group.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.6));
  for (const [x, z] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]]) {
    const l = new THREE.PointLight(0xfff4e0, 6, 9, 1.6);
    l.position.set(x, height - 0.3, z);
    group.add(l);
  }

  const margin = 0.35;
  const bounds = new THREE.Box3(new THREE.Vector3(-hw + margin, 0, -hd + margin), new THREE.Vector3(hw - margin, height, hd - margin));
  return { group, surfaces, bounds, spawn: new THREE.Vector3(0, 1.6, 3.5) };
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

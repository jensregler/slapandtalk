// Bygger client/public/avatars/gubbe.glb av Quaternius "Ultimate Modular Men Pack" (CC0).
// Ett skelett, 3 animationer, utbytbara delar (huvud/frisyr, överkropp, ben, skor).
// Kör (behövs bara om modellen ska byggas om):
//   npm i --no-save @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 meshoptimizer
//   node tools/make-avatar.mjs <mapp med casual.glb, casual2.glb, beach.glb, suit.glb, punk.glb> client/public/avatars/gubbe.glb
// Källfilerna laddas ner från poly.pizza (se CREDITS.md).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, prune, dedup, resample, quantize, meshopt, weld, unpartition } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
const SRC = process.argv[2], OUT = process.argv[3];
const KEEP = new Set(['Casual_Head','Casual2_Head','Beach_Head','Suit_Head','Punk_Head',
  'Casual_Body','Casual2_Body','Suit_Body','Punk_Body','Casual_Legs','Casual2_Legs','Suit_Legs','Punk_Legs',
  'Casual_Feet','Casual2_Feet','Suit_Feet','Punk_Feet']);
const ANIMS = new Set(['CharacterArmature|Idle','CharacterArmature|Walk','CharacterArmature|Wave']);
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const base = await io.read(`${SRC}/casual.glb`);
const root = base.getRoot();
const killAnim = (a) => { a.listSamplers().forEach((x) => x.dispose()); a.listChannels().forEach((x) => x.dispose()); a.dispose(); };
for (const a of root.listAnimations()) { if (!ANIMS.has(a.getName())) killAnim(a); else a.setName(a.getName().split('|')[1]); }
const scene0 = root.listScenes()[0];
const baseSkin = root.listSkins()[0];
const baseJoints = baseSkin.listJoints();
const idxByName = new Map(baseJoints.map((j, i) => [j.getName(), i]));
const parent = root.listNodes().find((n) => n.getName() === 'Casual_Body').getParentNode();
// Sätt varje dels JOINTS_0 mot bas-skelettet (alla filer har samma skelett och viloställning).
function rebind(node) {
  const skin = node.getSkin(); if (!skin) return;
  const map = skin.listJoints().map((j) => idxByName.get(j.getName()));
  for (const p of node.getMesh().listPrimitives()) {
    const acc = p.getAttribute('JOINTS_0'); const arr = acc.getArray().slice();
    const out = new Uint8Array(arr.length); for (let i = 0; i < arr.length; i++) out[i] = map[arr[i]];
    acc.setArray(out);
  }
  node.setSkin(baseSkin);
}
for (const n of root.listNodes()) if (n.getMesh()) rebind(n);
for (const f of ['casual2', 'beach', 'suit', 'punk']) {
  const d = await io.read(`${SRC}/${f}.glb`);
  for (const a of d.getRoot().listAnimations()) { a.listSamplers().forEach((x) => x.dispose()); a.listChannels().forEach((x) => x.dispose()); a.dispose(); }
  const before = new Set(root.listScenes());
  mergeDocuments(base, d);
  for (const sc of root.listScenes()) if (!before.has(sc)) {
    sc.traverse((n) => { if (n.getMesh() && KEEP.has(n.getName())) { rebind(n); n.detach?.(); parent.addChild(n); } });
    const kill = (n) => { for (const c of n.listChildren()) kill(c); n.dispose(); };
    for (const c of sc.listChildren()) kill(c);
    sc.dispose();
  }
}
for (const n of root.listNodes()) if (n.getMesh() && !KEEP.has(n.getName())) { n.getMesh().dispose(); n.dispose(); }
// Platta färger: inga UV, inga normaler (webbappen räknar fram dem med flatShading) → mycket färre hörn.
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { p.setAttribute('TEXCOORD_0', null); p.setAttribute('NORMAL', null); p.setAttribute('COLOR_0', null); }
for (const n of root.listNodes()) if (!n.getParentNode() && !scene0.listChildren().includes(n) && n !== scene0) { /* lösa noder */ }

await base.transform(prune(), resample({ tolerance: 1e-3 }), dedup(), weld(), meshopt({ encoder: MeshoptEncoder, level: 'high' }), unpartition());
await io.write(OUT, base);
const verts = root.listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + p.getAttribute('POSITION').getCount(), 0), 0);
console.log('scenes', root.listScenes().length, 'skins', root.listSkins().length, 'nodes', root.listNodes().length, 'verts', verts, 'anims', root.listAnimations().map((a) => a.getName()));

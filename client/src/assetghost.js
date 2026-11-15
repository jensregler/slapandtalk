// See-through placement ghosts for assets (ASSETS · V) and for a row of copies.
//
// City surface-texture sheets (client/src/surfacetex.js) sit just off the ground with
// renderOrder 8 and depthWrite: false. The ghost's materials also use depthWrite: false,
// so whichever of the two is drawn later wins in the overlap (the dumpster does not
// write depth the sheet can fail against).
//
// Setting renderOrder only on the root does not work here: makeProp() wraps the model
// in nested THREE.Groups, and three.js projectObject overwrites groupOrder with each
// Group's own renderOrder (default 0). The sheets then sort after the ghost meshes
// (groupOrder 0, renderOrder 8 vs the meshes' 0) and paint over them. Live stickers
// (10 + their number, also depthWrite: false) can hide it the same way.
//
// We set renderOrder on every group and mesh in the ghost (same idea as StampPreview
// / ArrayGhosts at 1e6), keep depthTest on so real walls still hide it, and leave
// depthWrite off so you can see through the preview.
export const ASSET_GHOST_RENDER_ORDER = 1e6;
export const ASSET_GHOST_OPACITY = 0.55;
export const ASSET_ROW_GHOST_OPACITY = 0.45;

export function applyAssetGhostStyle(obj, opacity = ASSET_GHOST_OPACITY) {
  if (!obj) return obj;
  obj.traverse((m) => {
    m.renderOrder = ASSET_GHOST_RENDER_ORDER;
    if (!m.isMesh) return;
    m.raycast = () => {};
    if (m.userData.ink) return;
    const see = (x) => {
      const c = x.clone();
      c.transparent = true;
      c.opacity = opacity;
      c.depthWrite = false;
      c.depthTest = true;
      return c;
    };
    m.material = Array.isArray(m.material) ? m.material.map(see) : see(m.material);
  });
  obj.renderOrder = ASSET_GHOST_RENDER_ORDER;
  return obj;
}

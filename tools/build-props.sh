#!/bin/sh
# Builds client/public/props/props.glb (3D props, Jens t491u/t509u) from the CC0 source models:
# one GLB, one scene per prop in the ORDER below (client/src/props3d.js GLB_ORDER must match),
# textures embedded, deduplicated, pruned and meshopt-compressed (~155 kB).
# SRC: a folder laid out like /workspace/props-build/src (Kenney models next to their kit's
# Textures/colormap.png in roads/, sub/, com/). Sources and licences: CREDITS.md ("3D props").
set -e
SRC=${1:-/workspace/props-build/src}
OUT=$(cd "$(dirname "$0")/.." && pwd)/client/public/props/props.glb
ORDER="table chair sofa plant bookcase floorlamp lamp bin bin2 bench market hydrant dumpster statue roads/lamp2 roads/cone roads/barrier roads/trafficlight sub/planter sub/tree sub/treeL com/parasol"
T=$(mktemp -d)
cd "$SRC"; FILES=""; for n in $ORDER; do FILES="$FILES $n.glb"; done
npx -y @gltf-transform/cli merge $FILES "$T/m.glb"
npx -y @gltf-transform/cli dedup "$T/m.glb" "$T/d.glb"
npx -y @gltf-transform/cli prune "$T/d.glb" "$T/p.glb"
npx -y @gltf-transform/cli meshopt "$T/p.glb" "$OUT"
rm -rf "$T"; ls -la "$OUT"

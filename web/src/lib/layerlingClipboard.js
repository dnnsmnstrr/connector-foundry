import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

// "Copy for Layerling": puts rendered bodies on the system clipboard in
// the form Layerling (https://github.com/henmedia/layerling) writes when
// you copy there, so Ctrl/⌘+V in its editor pastes them as editable
// meshes — no STL round trip through the downloads folder.
//
// The format is Layerling's own, read by pasteShape() in its
// LayerlingEditor.tsx: a "LAYERLING/1\n" line, then
// {"copiedAt": <ms>, "shapes": [...]}. A paste takes the newest copiedAt
// among its clipboards, so the stamp has to be "now". Each body is a
// shape of kind "mesh" built the way its own STL import builds one
// (lib/stlImport.ts there):
//   - Layerling is Y-up, OpenSCAD Z-up: (x, y, z) -> (x, z, -y), its
//     zUpToLayerling().
//   - importedMesh.positions is a triangle soup in the body's own frame:
//     centred on X and Z, bottom at Y = 0, sized by baseWidth/Depth/Height.
//   - The shape's x/z are the footprint centre on the plate, elevation
//     its bottom. Several bodies keep their places relative to each other
//     (the bench's bodies all render in one frame); the group as a whole
//     lands centred on the plate, standing on it.
// Normals are left out — Layerling computes them — and coordinates are
// rounded to a micron, which keeps a big mesh's text a third shorter.

export const LAYERLING_CLIPBOARD_PREFIX = "LAYERLING/1\n";

// Layerling's colour for an imported mesh first, then distinct ones so
// the bodies of a bench tell apart after pasting.
const BODY_COLORS = ["#0098c7", "#e07a1f", "#4caf50", "#c94f7c", "#8e6cd8", "#d4b02a"];

const round = (v) => Math.round(v * 1000) / 1000 || 0;

// Triangle soup of an STL (binary or ASCII), turned Y-up.
function yUpPositions(stlBuffer) {
  const geometry = new STLLoader().parse(stlBuffer);
  const source = geometry.getAttribute("position");
  const positions = new Float64Array(source.count * 3);
  for (let i = 0; i < source.count; i++) {
    positions[i * 3] = source.getX(i);
    positions[i * 3 + 1] = source.getZ(i);
    positions[i * 3 + 2] = -source.getY(i);
  }
  geometry.dispose();
  return positions;
}

function bounds(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const a = i % 3;
    if (positions[i] < min[a]) min[a] = positions[i];
    if (positions[i] > max[a]) max[a] = positions[i];
  }
  return { min, max };
}

// `bodies`: [{ name, stlBuffer }]. Returns Layerling shapes; a body with
// no triangles is skipped.
export function layerlingShapes(bodies) {
  const meshes = bodies
    .map((body) => ({ name: body.name, positions: yUpPositions(body.stlBuffer) }))
    .filter((mesh) => mesh.positions.length >= 9)
    .map((mesh) => ({ ...mesh, ...bounds(mesh.positions) }));
  if (!meshes.length) return [];

  const groupMin = [0, 1, 2].map((a) => Math.min(...meshes.map((m) => m.min[a])));
  const groupMax = [0, 1, 2].map((a) => Math.max(...meshes.map((m) => m.max[a])));
  const groupCentreX = (groupMin[0] + groupMax[0]) / 2;
  const groupCentreZ = (groupMin[2] + groupMax[2]) / 2;

  return meshes.map(({ name, positions, min, max }, index) => {
    const centreX = (min[0] + max[0]) / 2;
    const centreZ = (min[2] + max[2]) / 2;
    const local = new Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      local[i] = round(positions[i] - centreX);
      local[i + 1] = round(positions[i + 1] - min[1]);
      local[i + 2] = round(positions[i + 2] - centreZ);
    }
    // Layerling clamps every size to at least 1 mm (its stlImport does
    // the same), base and shown size alike, so nothing gets rescaled.
    const width = Math.max(1, round(max[0] - min[0]));
    const height = Math.max(1, round(max[1] - min[1]));
    const depth = Math.max(1, round(max[2] - min[2]));
    return {
      id: `connector-foundry-${index + 1}`,
      name,
      kind: "mesh",
      color: BODY_COLORS[index % BODY_COLORS.length],
      x: round(centreX - groupCentreX),
      z: round(centreZ - groupCentreZ),
      elevation: round(min[1] - groupMin[1]),
      size: Math.max(width, depth),
      width,
      depth,
      height,
      rotation: 0,
      rotationX: 0,
      rotationZ: 0,
      importedMesh: {
        positions: local,
        baseWidth: width,
        baseDepth: depth,
        baseHeight: height,
        triangleCount: local.length / 9,
        sourceFormat: "stl",
      },
      locked: false,
      hidden: false,
    };
  });
}

export function layerlingClipboardText(bodies, copiedAt = Date.now()) {
  const shapes = layerlingShapes(bodies);
  if (!shapes.length) throw new Error("There is no geometry to copy.");
  return `${LAYERLING_CLIPBOARD_PREFIX}${JSON.stringify({ copiedAt, shapes })}`;
}

// Writes the text for `bodiesPromise` (bodies, or a promise of them while
// they still render) to the clipboard. Call it straight from the click,
// before any await: Safari only lets a page write the clipboard during the
// click itself, and a ClipboardItem holding a promise is how it allows a
// write whose content arrives later. Without ClipboardItem (older
// Firefox) it falls back to writeText once the text is there.
export async function copyForLayerling(bodiesPromise) {
  const text = Promise.resolve(bodiesPromise).then((bodies) => layerlingClipboardText(bodies));
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    const blob = text.then((value) => new Blob([value], { type: "text/plain" }));
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
    } catch (err) {
      // A failed render fails the write too, but with the browser's
      // generic message — surface the render's own error instead.
      await text;
      throw err;
    }
    return;
  }
  await navigator.clipboard.writeText(await text);
}

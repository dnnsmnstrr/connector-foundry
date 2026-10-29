// "Fold for printing" on the Bench: the body an openConnect head is in,
// cut just in front of the head and laid out to print on its side —
// the head's half on its cut face, the rest beside it, joined by a
// one-layer hinge (folded) or apart (split). lib/fold.scad's
// fold_print() does the cutting; this works out the pose it needs.
//
// fold_print() takes its children posed with the cut on y = 0, the
// head's half on +y, and the hinge along the X axis at z = 0 with
// nothing below it: the far end of the body from the head, which is
// where the two halves' cut faces both reach and a hinge can join them.
// The Bench's tree is in world space, so the generated source wraps it
// in one multmatrix() into that frame (assembly.js's compileToScad()),
// built here from three things:
//  - the head's node frame (benchOrientation.js's nodeWorldFrame():
//    its rotation and its centre, verified against renders);
//  - the catalogue's `fold` entry: the cut's y in that frame, and
//    which way along its z the body runs from the head (`toward`);
//  - where the far end is, which only the geometry knows: the body's
//    own render, unfolded, is measured here (foldPlan()). For a fold,
//    the cut face itself has to reach that end — a GoPro buckle's
//    prongs reaching further out than the base the cut crosses leave
//    nowhere for a hinge, and the plan says so instead of exporting
//    halves the hinge can't join.
import { ROOT_ID, getNode } from "./assembly.js";

export const FOLD_MODE_LABELS = { folded: "Folded", split: "Split" };

/**
 * A catalogue part's fold, with its parameters: the cut's y in the
 * part's own centred frame and which way along its z the rest of the
 * body runs from the head (-1 or 1). null when the part has no head to
 * fold (no `fold` entry, an imported mesh) or the parameter's value
 * has no entry.
 * @param {any} part
 * @param {Record<string, any>} [params]
 * @returns {{ cutY: number, toward: number } | null}
 */
export function foldSpec(part, params = {}) {
  const fold = part?.kind === "imported" ? null : part?.fold;
  if (!fold) return null;
  const value = params[fold.param] ?? part.defaults?.[fold.param];
  const cutY = fold.cut_y?.[value];
  const toward = fold.toward?.[value];
  if (!Number.isFinite(cutY) || (toward !== 1 && toward !== -1)) return null;
  return { cutY, toward };
}

/**
 * The body (assembly.js's bodyTags()) a node is part of: the nearest
 * node up its chain, itself included, that starts a body of its own — a
 * joint child — or the root.
 * @param {any} assembly
 * @param {string} id
 * @returns {string}
 */
export function bodyTagOf(assembly, id) {
  let node = getNode(assembly, id);
  while (node && node.id !== ROOT_ID && node.joint === "fused") node = getNode(assembly, node.parentId);
  return node?.id ?? ROOT_ID;
}

// How close the cut face has to come to the body's far end for a hinge
// there to join both halves (mm): a few float32 roundings of the STL.
const REACH_TOL_MM = 0.01;

/**
 * The pose fold_print() needs for one body, from its unfolded render.
 * `frame` is the head's node frame (nodeWorldFrame(): world = centre +
 * rotation · local), `spec` its foldSpec().
 *
 * Returns `matrix` (4×4, world into fold_print()'s frame) and `split`;
 * or `error`, a sentence for the user, when the body can't be laid out
 * that way: a fold whose cut face doesn't reach the far end (Split
 * still works), or a cut that misses the body altogether.
 * @param {{
 *   stl: ArrayBuffer | ArrayBufferView,
 *   frame: { rotation: number[][], centre: number[] },
 *   spec: { cutY: number, toward: number },
 *   mode: "folded" | "split",
 * }} input
 * @returns {{ matrix: number[][], split: boolean } | { error: string }}
 */
export function foldPlan({ stl, frame, spec, mode }) {
  const { rotation: r, centre: c } = frame;
  // The fold frame's axes in world space: Y is the head's own +Y (the
  // way it slides to seat); Z points from the far end toward the head,
  // against `toward`; X completes a right-handed frame (the head's X,
  // or turned half round about Y when Z is the head's -Z).
  const column = (j) => [r[0][j], r[1][j], r[2][j]];
  const y = column(1);
  const z = column(2).map((v) => -spec.toward * v);
  const x = column(0).map((v) => -spec.toward * v);
  const offset = (axis) => axis[0] * c[0] + axis[1] * c[1] + axis[2] * c[2];
  const toFold = (px, py, pz) => [
    x[0] * px + x[1] * py + x[2] * pz - offset(x),
    y[0] * px + y[1] * py + y[2] * pz - offset(y) - spec.cutY,
    z[0] * px + z[1] * py + z[2] * pz - offset(z),
  ];

  // The lowest z of everything, and of the cut face (where triangles
  // cross y = 0), in the fold frame before it is shifted up onto z = 0.
  let lowest = Infinity;
  let lowestFace = Infinity;
  let behind = false;
  forEachTriangle(stl, (a, b, cc) => {
    const pts = [toFold(...a), toFold(...b), toFold(...cc)];
    for (const p of pts) {
      if (p[2] < lowest) lowest = p[2];
      if (p[1] < 0) behind = true;
    }
    for (let i = 0; i < 3; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % 3];
      if (p[1] === 0 && p[2] < lowestFace) lowestFace = p[2];
      if (p[1] < 0 !== q[1] < 0 && p[1] !== q[1]) {
        const t = p[1] / (p[1] - q[1]);
        const zc = p[2] + t * (q[2] - p[2]);
        if (zc < lowestFace) lowestFace = zc;
      }
    }
  });
  if (!Number.isFinite(lowest)) return { error: "There's nothing in this body to lay out." };
  // Nothing behind the cut: the body is the head's half alone, which
  // lies on its side either way, with no hinge to make.
  const split = mode === "split" || !behind;
  if (!split && !(lowestFace <= lowest + REACH_TOL_MM))
    return {
      error:
        "This can't fold: the cut in front of the head doesn't reach the far side of the part, so there's no edge both halves share for a hinge. Choose Split instead.",
    };
  const matrix = [
    [...x, -offset(x)],
    [...y, -offset(y) - spec.cutY],
    [...z, -offset(z) - lowest],
    [0, 0, 0, 1],
  ];
  return { matrix, split };
}

// Calls `fn(a, b, c)` with each triangle's three vertices of a binary
// STL — what the render pipeline always emits (openscad-worker.js
// passes --export-format=binstl). Throws on anything else.
function forEachTriangle(stl, fn) {
  const view = ArrayBuffer.isView(stl)
    ? new DataView(stl.buffer, stl.byteOffset, stl.byteLength)
    : new DataView(stl);
  const count = view.byteLength >= 84 ? view.getUint32(80, true) : -1;
  if (count < 0 || view.byteLength !== 84 + 50 * count) throw new Error("Not a binary STL.");
  const v = (base) => [
    view.getFloat32(base, true),
    view.getFloat32(base + 4, true),
    view.getFloat32(base + 8, true),
  ];
  for (let t = 0; t < count; t++) {
    const base = 84 + 50 * t + 12;
    fn(v(base), v(base + 12), v(base + 24));
  }
}

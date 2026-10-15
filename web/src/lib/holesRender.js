// The Holes tab's model as render requests: the base on its own, and the
// base with the holes cut through the generated source
// (screwHoles.js's holesToScad()). No React here; Holes.jsx renders the
// preview with these through hooks/useRender.js, and its exports reuse
// them so an export is the same mesh the preview showed.
import { groundedMesh } from "./importedPart.js";
import { meshExtents } from "./meshExtents.js";
import { renderPart } from "./openscad-client.js";
import { holesToScad } from "./screwHoles.js";

/**
 * A mesh source from its validated geometry: grounded on the grid, and
 * turned over first when `flip` is set (importedPart.js's groundedMesh()).
 * @param {string} name
 * @param {import("three").BufferGeometry} geometry
 * @param {boolean} flip
 */
export function meshSource(name, geometry, flip) {
  const { stlBytes, extents } = groundedMesh(geometry, { flip });
  return { kind: "mesh", name, geometry, flip, stlBytes, extents };
}

/**
 * The base model's STL: a catalogue part rendered on its own (cached by
 * openscad-client), or a mesh source's own bytes.
 * @param {any} source a holes document's `source`
 * @param {Map<string, any>} catalogueById
 * @param {object} [globalOverrides]
 * @param {AbortSignal} [signal]
 * @returns {Promise<ArrayBuffer | Uint8Array>}
 */
export function baseBuffer(source, catalogueById, globalOverrides, signal) {
  if (source.kind === "mesh") return Promise.resolve(source.stlBytes);
  const part = catalogueById.get(source.partId);
  if (!part) return Promise.reject(new Error(`Unknown catalogue part ${source.partId}`));
  return renderPart(
    { scadFile: part.file, module: part.module, params: source.params, globalOverrides },
    { signal },
  );
}

/**
 * The render request for the base with its holes cut. `extents` are the
 * base's: a through hole is made as long as the base's diagonal (plus a
 * margin), and a thread is bounded by the box.
 * @param {{ source: any, holes: any[] }} doc
 * @param {Map<string, any>} catalogueById
 * @param {number[]} extents
 * @param {object} [globalOverrides]
 */
export function holedRequest(doc, catalogueById, extents, globalOverrides) {
  const importedFiles = new Map();
  const scadSource = holesToScad(doc, catalogueById, {
    throughLength: Math.hypot(...extents) + 2,
    extents,
    importedFiles,
  });
  return { scadSource, importedFiles, globalOverrides };
}

// Stands in for a request that can't be formed: never in the cache.
const UNKNOWN_REQUEST = { scadSource: "\0unknown" };

/**
 * For a cache probe before debouncing: without the base's extents the
 * request can't be formed yet, and one that can't be formed (a part
 * missing from the catalogue) is never cached.
 * @param {{ source: any, holes: any[] }} doc
 * @param {Map<string, any>} catalogueById
 * @param {number[] | null} extents
 * @param {object} [globalOverrides]
 */
export function holedRequestIfKnown(doc, catalogueById, extents, globalOverrides) {
  if (!extents) return UNKNOWN_REQUEST;
  try {
    return holedRequest(doc, catalogueById, extents, globalOverrides);
  } catch {
    return UNKNOWN_REQUEST;
  }
}

/**
 * The model on screen: the base alone when there are no holes, else the
 * base with the holes cut — which waits on the base, since its extents
 * size the through holes (after the first time that is a cache lookup).
 * Resolves to the STL and the base's extents, which also scale the snap
 * radius.
 * @param {{ source: any, holes: any[] }} doc
 * @param {Map<string, any>} catalogueById
 * @param {object} [globalOverrides]
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ stl: ArrayBuffer | Uint8Array, baseExtents: number[] }>}
 */
export async function renderHoled(doc, catalogueById, globalOverrides, signal) {
  const base = await baseBuffer(doc.source, catalogueById, globalOverrides, signal);
  const baseExtents = meshExtents(base);
  const stl = doc.holes.length
    ? await renderPart(holedRequest(doc, catalogueById, baseExtents, globalOverrides), { signal })
    : base;
  return { stl, baseExtents };
}

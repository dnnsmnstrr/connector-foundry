// Binary STL -> 3MF (core spec 2015/02), for handing a render to a
// slicer that wants one file with every body in it, named: the 3MF
// keeps the Bench's bodies apart as separate objects where a merged STL
// would fuse them into one. A 3MF is a zip of an XML model that indexes
// its vertices, so the first step is welding the STL's triangle soup
// back into a vertex list — every vertex in an OpenSCAD export is
// written bit-identically wherever it is shared, so the weld is exact
// on the float32 bit patterns (no tolerance), which also measured faster
// than three's mergeVertices() (the weld meshValidate.js uses, which
// hashes rounded coordinates). A welded 3MF comes out a fraction of the
// STL's size: each shared vertex is written once as text instead of six
// times as floats, and deflate takes the rest.
//
// The zip is made with the fflate build three.js ships (threeMfMesh.js
// opens 3MFs with the same one), so this runs in Node too and the unit
// tests read the output back through that module's reader.
//
// The written file is handed to somebody's slicer, so the XML is kept
// to exactly what the spec says: the three package parts, the core
// namespace, one <object type="model"> per body with its <mesh>, and a
// <build> placing each once. Coordinates are rounded to a micron, as
// layerlingClipboard.js does, which keeps a large mesh's text a third
// shorter without moving anything a printer can resolve.
import * as fflate from "three/examples/jsm/libs/fflate.module.js";

/**
 * A mesh with its vertices welded: `vertices` holds x, y, z per vertex
 * and `indices` three vertex indices per triangle.
 * @typedef {{ vertices: Float32Array, indices: Uint32Array }} IndexedMesh
 */

/**
 * A body to write: its name (the 3MF object's name attribute) and its
 * welded mesh in millimetres.
 * @typedef {IndexedMesh & { name: string }} ThreeMfBody
 */

const HEADER_BYTES = 84;
const TRIANGLE_BYTES = 50;

/**
 * The indexed mesh of a binary STL: 80-byte header, uint32 LE triangle
 * count, then 50 bytes per triangle (normal 3xf32, three vertices 3xf32,
 * uint16 attribute; the normal and attribute are dropped). Vertices
 * weld exactly on their float32 bit patterns, so a vertex two triangles
 * share is listed once. Every triangle is kept — a slicer tolerates a
 * degenerate one, and dropping it here could open a hole in a mesh that
 * was closed. Throws a TypeError on a buffer shorter than its count
 * says.
 * @param {ArrayBuffer | ArrayBufferView} buffer
 * @returns {IndexedMesh}
 */
export function indexedFromStl(buffer) {
  const view = ArrayBuffer.isView(buffer)
    ? new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : new DataView(buffer);
  if (view.byteLength < HEADER_BYTES) {
    throw new TypeError(`Not a binary STL: ${view.byteLength} bytes is shorter than the 84-byte header.`);
  }
  const count = view.getUint32(80, true);
  const needed = HEADER_BYTES + TRIANGLE_BYTES * count;
  if (view.byteLength < needed) {
    throw new TypeError(
      `Binary STL is truncated: ${count} triangles need ${needed} bytes, got ${view.byteLength}.`,
    );
  }

  // The weld keys on the raw bit patterns, and the vertex list is built
  // from them too — a Uint32Array of the patterns, viewed as Float32 at
  // the end — so each float is read once and the stored value is exactly
  // the file's. Allocated for the worst case (no vertex shared) and
  // trimmed; 200k triangles is 7 MB, freed when the function returns.
  const bits = new Uint32Array(count * 9);
  const indices = new Uint32Array(count * 3);
  /** @type {Map<string, number>} */
  const seen = new Map();
  let vertexCount = 0;
  for (let t = 0; t < count; t++) {
    let offset = HEADER_BYTES + TRIANGLE_BYTES * t + 12;
    for (let corner = 0; corner < 3; corner++, offset += 12) {
      const x = view.getUint32(offset, true);
      const y = view.getUint32(offset + 4, true);
      const z = view.getUint32(offset + 8, true);
      const key = `${x},${y},${z}`;
      let index = seen.get(key);
      if (index === undefined) {
        index = vertexCount++;
        seen.set(key, index);
        bits[3 * index] = x;
        bits[3 * index + 1] = y;
        bits[3 * index + 2] = z;
      }
      indices[3 * t + corner] = index;
    }
  }
  return { vertices: new Float32Array(bits.buffer, 0, vertexCount * 3).slice(), indices };
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
  "</Types>";

const RELS =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rel0" Target="/3D/3dmodel.model" ' +
  'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
  "</Relationships>";

const MODEL_OPEN =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<model unit="millimeter" xml:lang="en-US" ' +
  'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n<resources>\n';

// A coordinate to a micron, as text. `|| 0` turns the -0 that rounding
// a tiny negative yields into 0, so the file never says "-0".
/** @param {number} v */
function micron(v) {
  return String(Math.round(v * 1000) / 1000 || 0);
}

// XML 1.0 forbids the C0 controls other than tab, newline and return
// (and the two non-characters), escaped or not, so they are dropped from
// a name before the five characters that need escaping are escaped.
// Names come from the bench, which a shared URL can fill with anything.
/** @param {string} text */
function xmlAttribute(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "").replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&apos;";
    }
  });
}

/**
 * The checks on one body, with the errors a caller can show. The index
 * check guards the file, not just the reader: an index past the vertex
 * list is undefined geometry in a slicer.
 * @param {ThreeMfBody} body
 * @param {number} position its place in the list, for the message
 */
function checkBody(body, position) {
  const where = `body ${position + 1}`;
  if (!body || typeof body !== "object") throw new TypeError(`${where} is not an object.`);
  const { name, vertices, indices } = body;
  if (typeof name !== "string") throw new TypeError(`${where}: the name must be a string.`);
  if (!(vertices instanceof Float32Array) || vertices.length % 3 !== 0) {
    throw new TypeError(`${where} ("${name}"): vertices must be a Float32Array of x, y, z triples.`);
  }
  if (!(indices instanceof Uint32Array)) {
    throw new TypeError(`${where} ("${name}"): indices must be a Uint32Array.`);
  }
  if (indices.length % 3 !== 0) {
    throw new RangeError(
      `${where} ("${name}"): ${indices.length} indices is not a whole number of triangles.`,
    );
  }
  for (let i = 0; i < vertices.length; i++) {
    if (!Number.isFinite(vertices[i])) {
      throw new RangeError(`${where} ("${name}"): vertex ${Math.floor(i / 3)} has a non-finite coordinate.`);
    }
  }
  const vertexCount = vertices.length / 3;
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] >= vertexCount) {
      throw new RangeError(
        `${where} ("${name}"): triangle ${Math.floor(i / 3)} refers to vertex ${indices[i]} of ${vertexCount}.`,
      );
    }
  }
}

/**
 * The 3MF package (a zip) of the bodies, each its own object on the
 * build plate, coordinates in millimetres. Throws on nothing to print
 * (an empty list), a name that is not a string, a non-finite coordinate,
 * an index outside the body's vertex list, or an index count that is not
 * a multiple of three.
 * @param {ThreeMfBody[]} bodies
 * @returns {Uint8Array} the file's bytes
 */
export function write3mf(bodies) {
  if (!Array.isArray(bodies) || bodies.length === 0) throw new RangeError("Nothing to print: no bodies.");
  bodies.forEach(checkBody);

  // Built as an array of strings joined once: a 200k-triangle mesh is
  // some 13 MB of text, and growing one string by concatenation copies
  // it over and over.
  const xml = [MODEL_OPEN];
  bodies.forEach(({ name, vertices, indices }, i) => {
    xml.push(`<object id="${i + 1}" name="${xmlAttribute(name)}" type="model">\n<mesh>\n<vertices>\n`);
    for (let v = 0; v < vertices.length; v += 3) {
      xml.push(
        `<vertex x="${micron(vertices[v])}" y="${micron(vertices[v + 1])}" z="${micron(vertices[v + 2])}"/>\n`,
      );
    }
    xml.push("</vertices>\n<triangles>\n");
    for (let t = 0; t < indices.length; t += 3) {
      xml.push(`<triangle v1="${indices[t]}" v2="${indices[t + 1]}" v3="${indices[t + 2]}"/>\n`);
    }
    xml.push("</triangles>\n</mesh>\n</object>\n");
  });
  xml.push("</resources>\n<build>\n");
  bodies.forEach((_, i) => xml.push(`<item objectid="${i + 1}"/>\n`));
  xml.push("</build>\n</model>\n");

  // Deflate level 6 (the usual default). Measured on a 200k-triangle
  // heightfield in Node: level 6 gave 1.79 MB in 460 ms, level 1 1.95 MB
  // in 200 ms. The file crosses a share sheet or an upload on a phone,
  // where the bytes cost more than the quarter second.
  return fflate.zipSync(
    {
      "[Content_Types].xml": fflate.strToU8(CONTENT_TYPES),
      "_rels/.rels": fflate.strToU8(RELS),
      "3D/3dmodel.model": fflate.strToU8(xml.join("")),
    },
    { level: 6 },
  );
}

/**
 * The 3MF of rendered bodies straight from their binary STLs: each is
 * welded with indexedFromStl() and written with write3mf().
 * @param {Array<{ name: string, stl: ArrayBuffer | ArrayBufferView }>} bodies
 * @returns {Uint8Array} the file's bytes
 */
export function stlBodiesTo3mf(bodies) {
  if (!Array.isArray(bodies)) throw new TypeError("bodies must be an array.");
  return write3mf(bodies.map(({ name, stl }) => ({ name, ...indexedFromStl(stl) })));
}

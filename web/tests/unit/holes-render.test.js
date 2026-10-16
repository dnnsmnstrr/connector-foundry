import test from "node:test";
import assert from "node:assert/strict";
import {
  BoxGeometry,
  CircleGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Raycaster,
  TorusKnotGeometry,
  Triangle,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import {
  baseBuffer,
  cachedHoled,
  holedRequest,
  meshSource,
  probeGeometry,
  renderHoled,
  stlProbe,
  surfaceProbe,
} from "../../src/lib/holesRender.js";
import { addHole, createHolesDoc } from "../../src/lib/screwHoles.js";
import { meshExtents } from "../../src/lib/meshExtents.js";

const catalogueById = new Map([
  [
    "basics/plate",
    { id: "basics/plate", name: "Flat plate", file: "parts/basics/plate.scad", module: "basics_plate" },
  ],
]);

const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-4);

test("meshSource grounds the mesh: centered on x/y, bottom at z = 0, bytes and extents alike", () => {
  const geometry = new BoxGeometry(20, 10, 4).translate(100, 50, 30);
  const source = meshSource("box", geometry, false);
  assert.equal(source.kind, "mesh");
  assert.equal(source.name, "box");
  assert.equal(source.flip, false);
  assert.equal(source.geometry, geometry);
  assert.ok(close(source.extents, [20, 10, 4]));
  assert.ok(close(meshExtents(source.stlBytes), [20, 10, 4]));
});

test("meshSource with flip turns the mesh over about X: y and z keep their sizes", () => {
  const source = meshSource("box", new BoxGeometry(20, 10, 4), true);
  assert.equal(source.flip, true);
  assert.ok(close(source.extents, [20, 10, 4]));
});

test("meshSource: the same geometry turned the same way gives the same bytes, so a Flip back costs no copy", () => {
  const geometry = new BoxGeometry(20, 10, 4);
  const upright = meshSource("box", geometry, false);
  const flipped = meshSource("box", geometry, true);
  assert.notEqual(flipped.stlBytes, upright.stlBytes);
  assert.equal(meshSource("box", geometry, false).stlBytes, upright.stlBytes);
  assert.equal(meshSource("renamed", geometry, true).stlBytes, flipped.stlBytes);
  // Each source has extents of its own to change.
  assert.notEqual(meshSource("box", geometry, false).extents, upright.extents);
  // Another geometry (another import of the same file) is another mesh.
  assert.notEqual(meshSource("box", new BoxGeometry(20, 10, 4), false).stlBytes, upright.stlBytes);
});

test("baseBuffer: a mesh source is its own bytes; an unknown catalogue part rejects", async () => {
  const source = meshSource("box", new BoxGeometry(20, 10, 4), false);
  assert.equal(await baseBuffer(source, catalogueById), source.stlBytes);
  await assert.rejects(
    baseBuffer({ kind: "catalogue", partId: "nope/missing", params: {} }, catalogueById),
    /Unknown catalogue part nope\/missing/,
  );
});

test("holedRequest cuts the holes from the base and mounts a mesh source's bytes", () => {
  const source = meshSource("box", new BoxGeometry(20, 10, 4), false);
  const { doc } = addHole(createHolesDoc(source), { point: [0, 0, 4], normal: [0, 0, 1] });
  const globals = { FIT_CLEARANCE: 0.2 };
  const request = holedRequest(doc, catalogueById, source.extents, globals);
  assert.match(request.scadSource, /difference\(\)/);
  assert.equal(request.globalOverrides, globals);
  assert.deepEqual([...request.importedFiles.values()], [source.stlBytes]);
});

test("renderHoled with no holes is the base itself, with its extents", async () => {
  const source = meshSource("box", new BoxGeometry(20, 10, 4), false);
  const { stl, baseExtents, base } = await renderHoled(createHolesDoc(source), catalogueById, {});
  assert.equal(stl, source.stlBytes);
  assert.equal(base, source.stlBytes);
  assert.ok(close(baseExtents, [20, 10, 4]));
});

test("cachedHoled: a mesh with no holes needs no render; anything else is a miss until rendered", () => {
  const source = meshSource("box", new BoxGeometry(20, 10, 4), false);
  const hit = cachedHoled(createHolesDoc(source), catalogueById, {});
  assert.equal(hit.stl, source.stlBytes);
  assert.equal(hit.base, source.stlBytes);
  assert.ok(close(hit.baseExtents, [20, 10, 4]));
  const { doc } = addHole(createHolesDoc(source), { point: [0, 0, 4], normal: [0, 0, 1] });
  assert.equal(cachedHoled(doc, catalogueById, {}), null);
  // A catalogue base nobody rendered, and a part the catalogue lacks: misses, not throws.
  const plate = createHolesDoc({ kind: "catalogue", partId: "basics/plate", params: { w: 40 } });
  assert.equal(cachedHoled(plate, catalogueById, {}), null);
  assert.equal(cachedHoled({ ...plate, source: { kind: "catalogue", partId: "nope" } }, catalogueById), null);
});

test("surfaceProbe: on a face turned like the hole, and nowhere else", () => {
  // The grounded box: 20 x 10 x 4, its top face at z = 4.
  const source = meshSource("box", new BoxGeometry(20, 10, 4), false);
  const geometry = probeGeometry(source.stlBytes);
  assert.equal(probeGeometry(source.stlBytes), geometry, "parsed once per buffer");
  const probe = surfaceProbe(geometry);
  assert.equal(probe([0, 0, 4], [0, 0, 1]), true);
  assert.equal(probe([9.5, 4.5, 4], [0, 0, 1]), true);
  assert.equal(probe([10.5, 0, 4], [0, 0, 1]), false, "off the edge");
  assert.equal(probe([0, 0, 3], [0, 0, 1]), false, "below the face");
  assert.equal(probe([0, -5, 2], [0, -1, 0]), true, "the front wall");
  assert.equal(probe([0, 0, 4], [0, -1, 0]), false, "turned the wrong way");
  assert.equal(probe([NaN, 0, 4], [0, 0, 1]), false);
  assert.equal(stlProbe(source.stlBytes), stlProbe(source.stlBytes), "one probe per buffer");
  assert.equal(stlProbe(source.stlBytes)([0, 0, 4], [0, 0, 1]), true);
  // A view of the bytes parses too.
  const view = new Uint8Array(source.stlBytes);
  assert.equal(surfaceProbe(probeGeometry(view))([0, 0, 4], [0, 0, 1]), true);
});

// The probe as it was before its triangle grid: one three.js raycast over
// the whole mesh. The grid must answer exactly as this does.
function raycastProbe(geometry) {
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
  const raycaster = new Raycaster();
  raycaster.far = 1.5;
  return (point, normal) => {
    const n = new Vector3(...normal).normalize();
    raycaster.set(new Vector3(...point).addScaledVector(n, 0.5), n.clone().negate());
    const hit = raycaster.intersectObject(mesh, false)[0];
    return Boolean(hit && Math.abs(hit.distance - 0.5) < 0.05 && hit.face.normal.dot(n) > 0.99);
  };
}

test("surfaceProbe answers as a raycast over every triangle would, on curved, fanned and indexed meshes", () => {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const meshes = {
    // Small triangles all round: the grid's usual case.
    knot: new TorusKnotGeometry(20, 6, 128, 16).toNonIndexed(),
    // A board's small triangles under a fan of long ones, which cross so
    // many cells of the finest grids that a coarser one holds them (as a
    // Skadis board's faces need).
    board: mergeGeometries([
      new PlaneGeometry(100, 100, 60, 60).toNonIndexed(),
      new CircleGeometry(50, 600).toNonIndexed().translate(0, 0, 1),
    ]),
    // Long thin triangles alone, crossing too many cells on any grid: the
    // whole-mesh raycast.
    fan: new CircleGeometry(30, 400).toNonIndexed(),
    // An index: the triangles are read through it.
    indexed: new TorusKnotGeometry(15, 4, 64, 8),
  };
  for (const [name, geometry] of Object.entries(meshes)) {
    const probe = surfaceProbe(geometry);
    const reference = raycastProbe(geometry);
    const position = geometry.getAttribute("position");
    const index = geometry.getIndex();
    const triangles = (index ? index.count : position.count) / 3;
    const corner = (t, k) =>
      new Vector3().fromBufferAttribute(position, index ? index.getX(t * 3 + k) : t * 3 + k);
    let onFace = 0;
    for (let i = 0; i < 300; i++) {
      const t = Math.floor(random() * triangles);
      const triangle = new Triangle(corner(t, 0), corner(t, 1), corner(t, 2));
      const centre = triangle.getMidpoint(new Vector3());
      const normal = triangle.getNormal(new Vector3()).toArray();
      const jitter = [0, 1, 2].map(() => (random() - 0.5) * 3);
      for (const [point, n] of [
        [centre.toArray(), normal],
        [centre.toArray().map((v, k) => v + jitter[k]), normal],
        [centre.toArray(), [random() - 0.5, random() - 0.5, random() - 0.5]],
      ]) {
        const answer = probe(point, n);
        assert.equal(answer, reference(point, n), `${name}: ${point} ${n}`);
        if (answer) onFace++;
      }
    }
    assert.ok(onFace > 100, `${name}: some spots were on a face (${onFace})`);
  }
});

test("cachedHoled: what renderHoled() rendered comes back at once, the same buffers; any other hole is a miss", async () => {
  // A render worker that answers every job with a box (holed or not): the
  // client caches each answer under its request.
  const box = meshSource("box", new BoxGeometry(40, 40, 4), false).stlBytes;
  const previous = globalThis.Worker;
  globalThis.Worker = class {
    postMessage(message) {
      if (message?.type === "warm") return;
      setImmediate(() => this.onmessage({ data: { id: message.id, type: "result", stl: box.slice(0) } }));
    }
    terminate() {}
  };
  try {
    const plate = createHolesDoc({ kind: "catalogue", partId: "basics/plate", params: { w: 40 } });
    const { doc } = addHole(plate, { point: [0, 0, 4], normal: [0, 0, 1] });
    const rendered = await renderHoled(doc, catalogueById, {});
    const hit = cachedHoled(doc, catalogueById, {});
    assert.equal(hit.stl, rendered.stl);
    assert.equal(hit.base, rendered.base);
    assert.notEqual(hit.stl, hit.base);
    assert.ok(close(hit.baseExtents, [40, 40, 4]));
    // The base alone was rendered on the way: a plate with no holes hits too.
    assert.equal(cachedHoled(plate, catalogueById, {}).stl, rendered.base);
    // The hole moved: its cut was never rendered.
    const moved = { ...doc, holes: doc.holes.map((h) => ({ ...h, point: [1, 0, 4] })) };
    assert.equal(cachedHoled(moved, catalogueById, {}), null);
  } finally {
    globalThis.Worker = previous;
  }
});

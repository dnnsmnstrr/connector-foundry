// Shared fixtures for the bench config / URL-state tests: a tiny
// catalogue, an assembly that uses every per-node field, and a real
// (watertight) imported mesh so hydration's validate gate has something
// genuine to pass.

export const catalogue = new Map([
  [
    "basics/plate",
    { id: "basics/plate", name: "Plate", file: "parts/basics/plate.scad", module: "basic_plate" },
  ],
  ["gopro/male", { id: "gopro/male", name: "GoPro", file: "parts/gopro/male.scad", module: "gopro_male" }],
]);

// A 10 mm cube as a binary STL: 12 outward-wound triangles.
export function cubeStl(size = 10) {
  const v = (x, y, z) => [x * size, y * size, z * size];
  const quads = [
    [v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0), [0, 0, -1]],
    [v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1), [0, 0, 1]],
    [v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1), [0, -1, 0]],
    [v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0), [0, 1, 0]],
    [v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0), [-1, 0, 0]],
    [v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1), [1, 0, 0]],
  ];
  const tris = quads.flatMap(([a, b, c, d, n]) => [
    [n, a, b, c],
    [n, a, c, d],
  ]);
  const buffer = new ArrayBuffer(84 + tris.length * 50);
  const view = new DataView(buffer);
  view.setUint32(80, tris.length, true);
  tris.forEach((tri, i) => {
    let at = 84 + i * 50;
    for (const vec of tri) {
      for (const c of vec) {
        view.setFloat32(at, c, true);
        at += 4;
      }
    }
  });
  return buffer;
}

export function samplePartsById() {
  return new Map([
    ...catalogue,
    [
      "imported:900",
      {
        id: "imported:900",
        kind: "imported",
        name: "cube.stl",
        anchors: [{ name: "slot1", point: [0, 0, 5], normal: [0, 0, 1] }],
        stlBytes: cubeStl(),
      },
    ],
  ]);
}

export function sampleAssembly() {
  return {
    name: "Desk hook ✓",
    root: { id: "root", partId: "basics/plate", params: { w: 40, label: 'a"b' } },
    nodes: [
      {
        id: "c900",
        parentId: "root",
        partId: "imported:900",
        params: {},
        slotName: "mount_0_0",
        joint: "fused",
        childAnchor: "slot1",
        overlap: -0.5,
        spin: 90,
        shift: [1.5, 0],
      },
      {
        id: "c901",
        parentId: "c900",
        partId: "gopro/male",
        params: { $fn: 32 },
        slotName: "slot1",
        joint: "bolted",
        childAnchor: "mount",
        overlap: 0,
        spin: 0,
        shift: [0, 0],
      },
    ],
    cropTo: "c901",
  };
}

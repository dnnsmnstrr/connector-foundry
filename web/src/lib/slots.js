// Slot enumeration for a catalogue part — the JS mirror of
// lib/slots.scad's grid_mount_anchors() and mount_anchor(), kept honest
// against the real geometry by tests/test_slots.py. Never parses .scad
// or asks OpenSCAD "what anchors does this have" at runtime: a part's
// slots.pitch (plus, for a feature-locked grid, slots.count_params), or
// its anchors list (catalogue.yaml's `anchors` field), is enough to
// compute every anchor name and its local (x, y, z) position — always
// the exact center of one face of the part's own rendered bounding box,
// per lib/slots.scad's convention.
//
// Every slot returned here carries a full local (x, y, z) — this is
// what makes a non-root Bench node's own open slots computable the same
// way root's are: render that node's part standalone (its own params,
// no attach() context) to get its own extents, then run it through this
// same function. Nothing here needs to know where in a tree the part
// sits.

const FACE_ANCHOR_LOCAL = {
  mount: (e) => [0, 0, e[2] / 2],
  bot: (e) => [0, 0, -e[2] / 2],
  xpos: (e) => [e[0] / 2, 0, 0],
  xneg: (e) => [-e[0] / 2, 0, 0],
  ypos: (e) => [0, e[1] / 2, 0],
  yneg: (e) => [0, -e[1] / 2, 0],
};

function gridCounts(part, params, meshExtents) {
  const { pitch, count_params: countParams } = part.slots;
  if (countParams) {
    const [nxKey, nyKey] = countParams;
    return [params[nxKey] ?? part.defaults[nxKey], params[nyKey] ?? part.defaults[nyKey]];
  }
  // Nearest-odd from the rendered footprint / pitch — same formula as
  // lib/slots.scad's slot_count() and tests/test_slots.py's _grid_counts().
  const nearestOdd = (extent) => Math.max(1, 2 * Math.floor(extent / pitch / 2) + 1);
  return [nearestOdd(meshExtents[0]), nearestOdd(meshExtents[1])];
}

// meshExtents is the part's own rendered bounding box [x, y, z] in mm —
// required for a free-subdivision grid (Gridfinity) or any face anchor;
// only a feature-locked grid (count_params set) can do without it.
export function enumerateSlots(part, params, meshExtents) {
  const extents = meshExtents ?? [0, 0, 0];

  if (part.slots) {
    const pitch = part.slots.pitch;
    const [nx, ny] = gridCounts(part, params, extents);
    const i0 = -(nx - 1) / 2;
    const j0 = -(ny - 1) / 2;
    const z = extents[2] / 2;

    const slots = [];
    for (let i = i0; i <= (nx - 1) / 2; i++) {
      for (let j = j0; j <= (ny - 1) / 2; j++) {
        slots.push({ name: `mount_${i}_${j}`, i, j, x: i * pitch, y: j * pitch, z });
      }
    }
    return slots;
  }

  const names = ["mount", ...(part.anchors ?? [])];
  return names.map((name) => {
    const [x, y, z] = FACE_ANCHOR_LOCAL[name](extents);
    return { name, x, y, z };
  });
}

export function nearestSlot(slots, localX, localY) {
  let best = null;
  let bestDist = Infinity;
  for (const slot of slots) {
    const dist = Math.hypot(slot.x - localX, slot.y - localY);
    if (dist < bestDist) {
      best = slot;
      bestDist = dist;
    }
  }
  return best;
}

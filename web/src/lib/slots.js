// Slot enumeration for a catalogue part — the JS mirror of
// lib/slots.scad's grid_mount_anchors(), kept honest against the real
// geometry by tests/test_slots.py. Never parses .scad or asks OpenSCAD
// "what anchors does this have" at runtime: a part's slots.pitch (plus,
// for a feature-locked grid, slots.count_params) is enough to compute
// every anchor name and its local (x, y) position.
//
// A part without a `slots` field in catalogue.yaml gets the single
// default slot, "mount", at local (0, 0) — unchanged from before
// multi-slot existed.

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

// meshExtents is only consulted for a part without count_params (a free
// subdivision grid, e.g. Gridfinity) — pass the part's own rendered
// bounding box [x, y, z] in mm; omit it for a feature-locked grid.
export function enumerateSlots(part, params, meshExtents) {
  if (!part.slots) return [{ name: "mount", i: 0, j: 0, x: 0, y: 0 }];

  const pitch = part.slots.pitch;
  const [nx, ny] = gridCounts(part, params, meshExtents ?? [0, 0, 0]);
  const i0 = -(nx - 1) / 2;
  const j0 = -(ny - 1) / 2;

  const slots = [];
  for (let i = i0; i <= (nx - 1) / 2; i++) {
    for (let j = j0; j <= (ny - 1) / 2; j++) {
      slots.push({ name: `mount_${i}_${j}`, i, j, x: i * pitch, y: j * pitch });
    }
  }
  return slots;
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

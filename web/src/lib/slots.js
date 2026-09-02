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

// `offset` is the catalogue's `mount_offset` ([x, y], default none): a
// part whose module puts "mount" and "bot" somewhere other than the face
// center — the DeckMate parts put both at their screw pattern's
// reference point — declares it here so the markers land on the real
// anchors. tests/test_anchors.py holds the declaration to the geometry.
const FACE_ANCHOR_LOCAL = {
  mount: (e, [ox, oy]) => [ox, oy, e[2] / 2],
  bot: (e, [ox, oy]) => [ox, oy, -e[2] / 2],
  xpos: (e) => [e[0] / 2, 0, 0],
  xneg: (e) => [-e[0] / 2, 0, 0],
  ypos: (e) => [0, e[1] / 2, 0],
  yneg: (e) => [0, -e[1] / 2, 0],
};

function mountOffset(part) {
  return part.mount_offset ?? [0, 0];
}

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

// Local (x, y, z) of the i-th anchor in a side row on `faceName` — the
// JS mirror of lib/slots.scad's side_row_anchors(), same face/pitch/i
// meaning, same position. The row runs along the OTHER horizontal axis
// from the face's own fixed coordinate (half the matching extent, +/-
// depending on which face), centered at 0.
function sideRowLocal(faceName, extents, pitch, i) {
  const rowOnX = faceName === "xpos" || faceName === "xneg";
  const fixed = rowOnX
    ? (faceName === "xpos" ? extents[0] / 2 : -extents[0] / 2)
    : (faceName === "ypos" ? extents[1] / 2 : -extents[1] / 2);
  return rowOnX ? [fixed, i * pitch, 0] : [i * pitch, fixed, 0];
}

// meshExtents is the part's own rendered bounding box [x, y, z] in mm —
// required for a free-subdivision grid (Gridfinity), any face anchor,
// or any side row; only a feature-locked grid (count_params set) can do
// without it.
//
// A part can combine a top grid (`slots`), single box-face anchors
// (`anchors`), and side rows (`side_slots`) all at once — see
// catalogue.yaml's schema comments and parts/basics/pinhole_plate.scad,
// which declares all three. `slots` alone still skips a separate
// "mount" entry, same as before: mount_0_0 already sits at that exact
// point (lib/slots.scad's own convention), so a plain part-without-a-
// grid is the only case that needs "mount" listed explicitly.
export function enumerateSlots(part, params, meshExtents) {
  const extents = meshExtents ?? [0, 0, 0];
  const slots = [];

  if (part.slots) {
    const pitch = part.slots.pitch;
    const [nx, ny] = gridCounts(part, params, extents);
    const i0 = -(nx - 1) / 2;
    const j0 = -(ny - 1) / 2;
    const z = extents[2] / 2;
    for (let i = i0; i <= (nx - 1) / 2; i++) {
      for (let j = j0; j <= (ny - 1) / 2; j++) {
        slots.push({ name: `mount_${i}_${j}`, i, j, x: i * pitch, y: j * pitch, z });
      }
    }
  } else {
    const [x, y, z] = FACE_ANCHOR_LOCAL.mount(extents, mountOffset(part));
    slots.push({ name: "mount", x, y, z });
  }

  for (const name of part.anchors ?? []) {
    const place = FACE_ANCHOR_LOCAL[name];
    if (!place) {
      // tests/test_catalogue.py rejects this at commit time; at runtime a
      // skipped marker beats taking the whole Bench down.
      console.warn(`slots: ${part.id} declares anchor "${name}", which has no face formula — skipped`);
      continue;
    }
    const [x, y, z] = place(extents, mountOffset(part));
    slots.push({ name, x, y, z });
  }

  for (const face of part.side_slots?.faces ?? []) {
    const enabled = params[face.enabled_param] ?? part.defaults?.[face.enabled_param] ?? true;
    if (!enabled) continue;
    const count = params[face.count_param] ?? part.defaults?.[face.count_param];
    if (!count) continue;
    const i0 = -(count - 1) / 2;
    for (let i = i0; i <= (count - 1) / 2; i++) {
      const [x, y, z] = sideRowLocal(face.name, extents, part.side_slots.pitch, i);
      slots.push({ name: `${face.name}_${i}`, x, y, z });
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

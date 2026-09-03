// Where each Bench node's body is in world space — enough of it to hit-
// test a click on the rendered assembly ("which part did I click?") and
// to draw a selection outline, without reproducing BOSL2's attach()
// rotation. Same footing as benchLayout.js's markers: the assembly is one
// STL, so nothing in the mesh says which triangle belongs to which node;
// what CAN be known exactly is where a part's mating point landed and how
// big the part is, and for a vertically mated catalogue part that pins
// its axis-aligned bounding box down completely (up to the spin-rotated
// footprint, handled below). Anything else — an imported part, a child
// on a side face — gets no box, which means it can't be clicked in the
// scene and its outline isn't drawn; it stays selectable from the
// sidebar. Pure functions; Bench.jsx wires state to them.
import { ROOT_ID, getNode } from "./assembly.js";
import { STACK_ANCHOR, attachPointWorld, matingRise } from "./benchLayout.js";
import { enumerateSlots } from "./slots.js";

// Which way a child mated onto `slotName` of `parentId` points in world
// space, when that direction is vertical: +1 for a slot facing up (root's
// top grid, a stacked part's exposed "bot", an imported anchor whose
// normal is +Z), -1 for one facing down (root's own "bot", or a -Z
// imported anchor). null for anything sideways or unknown.
function verticalMatingDir(assembly, partsById, parentId, slotName) {
  const parent = getNode(assembly, parentId);
  const parentPart = parent && partsById.get(parent.partId);
  if (!parentPart) return null;
  if (parentId !== ROOT_ID) {
    // Deeper than root, the only slot whose world position is known is
    // the exposed "bot" of a catalogue part in an upward stack (see
    // benchLayout.js's exposedTopWorldPosition()).
    return parentPart.kind !== "imported" && slotName === STACK_ANCHOR ? 1 : null;
  }
  if (parentPart.kind === "imported") {
    const anchor = parentPart.anchors.find((a) => a.name === slotName);
    if (!anchor || Math.abs(anchor.normal[2]) < 0.9) return null;
    return anchor.normal[2] > 0 ? 1 : -1;
  }
  if (slotName.startsWith("mount")) return 1;
  if (slotName === STACK_ANCHOR) return -1;
  return null;
}

// Half-extents of a w×d rectangle after turning it `spin` degrees about
// its center — the axis-aligned box that contains the rotated footprint.
// Exact at multiples of 90 (the common case: axes just swap), the
// tightest AABB at any other angle.
function spunHalfExtents(hx, hy, spin) {
  const rad = (spin * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return [c * hx + s * hy, s * hx + c * hy];
}

// World-space axis-aligned box `nodeId` occupies, or null when it can't
// be placed (see the header). `rootSlotWorldPositions` and `nodeExtents`
// are Bench.jsx's — the same inputs benchLayout.js's markers use.
export function nodeWorldBox(assembly, partsById, rootSlotWorldPositions, nodeExtents, nodeId) {
  const extents = nodeExtents.get(nodeId);
  if (!extents) return null;
  const [ex, ey, ez] = extents;
  if (nodeId === ROOT_ID) {
    // Root is placed with anchor=BOTTOM and no rotation: centered on the
    // origin in x/y, bottom on z=0 (benchLayout.js's centeredToWorld()).
    return { min: [-ex / 2, -ey / 2, 0], max: [ex / 2, ey / 2, ez] };
  }
  const node = getNode(assembly, nodeId);
  const part = node && partsById.get(node.partId);
  // A catalogue part attaching through its own "mount": that anchor is on
  // the part's top face, at the face center or the catalogue's
  // mount_offset — either way the part hangs off the mating point by a
  // known amount. An imported part's anchor could be anywhere on it.
  if (!part || part.kind === "imported" || node.childAnchor !== "mount") return null;
  const dir = verticalMatingDir(assembly, partsById, node.parentId, node.slotName);
  if (dir === null) return null;
  const attach = attachPointWorld(assembly, partsById, rootSlotWorldPositions, nodeExtents, nodeId);
  if (!attach) return null;

  // Where "mount" is on the part's own top face. BOSL2 flips the part
  // over onto the slot, then spins it; which horizontal axis the flip is
  // about decides which way an off-center mount ends up displaced, so
  // rather than replicate that, pad the footprint by the offset in both
  // directions — the box then contains the part whatever the flip did,
  // at the cost of being |offset| too generous per side for the few
  // (DeckMate) parts that have one.
  const mount = enumerateSlots(part, node.params, extents).find((s) => s.name === "mount" || s.name === "mount_0_0");
  const [ox, oy] = mount ? [Math.abs(mount.x), Math.abs(mount.y)] : [0, 0];
  const [hx, hy] = spunHalfExtents(ex / 2 + ox, ey / 2 + oy, node.spin ?? 0);

  // The part's own mating face sits a joint's flanges (plus the Offset)
  // out from the slot, along the mating direction.
  const z0 = attach[2] + dir * matingRise(assembly, partsById, node);
  const z1 = z0 + dir * ez;
  return {
    min: [attach[0] - hx, attach[1] - hy, Math.min(z0, z1)],
    max: [attach[0] + hx, attach[1] + hy, Math.max(z0, z1)],
  };
}

// A box per node that has one: Map(nodeId -> { min, max }), root included.
export function nodeWorldBoxes({ assembly, partsById, rootSlotWorldPositions, nodeExtents }) {
  const boxes = new Map();
  if (!assembly) return boxes;
  for (const id of [ROOT_ID, ...assembly.nodes.map((n) => n.id)]) {
    const box = nodeWorldBox(assembly, partsById, rootSlotWorldPositions, nodeExtents, id);
    if (box) boxes.set(id, box);
  }
  return boxes;
}

// A click on the rendered mesh lands ON a surface, so the point is
// exactly on the boundary of the box it belongs to — hence the slack.
// Mesh bounding boxes carry float noise too (see slots.js's FIT_SLACK_MM).
const PICK_SLACK_MM = 0.05;

function boxContains({ min, max }, [x, y, z]) {
  return (
    x >= min[0] - PICK_SLACK_MM && x <= max[0] + PICK_SLACK_MM &&
    y >= min[1] - PICK_SLACK_MM && y <= max[1] + PICK_SLACK_MM &&
    z >= min[2] - PICK_SLACK_MM && z <= max[2] + PICK_SLACK_MM
  );
}

function boxVolume({ min, max }) {
  return (max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2]);
}

// The node whose box contains `point` (a world position on the rendered
// mesh), or null. Where boxes overlap — a child's underside sits exactly
// on its parent's top, and a small part's box lies entirely within a
// big base's at the seam — the smallest box wins, so a click on the
// thing sitting on top selects the thing sitting on top.
export function pickNodeAt(boxes, point) {
  let best = null;
  let bestVolume = Infinity;
  for (const [id, box] of boxes) {
    if (!boxContains(box, point)) continue;
    const volume = boxVolume(box);
    if (volume < bestVolume) {
      best = id;
      bestVolume = volume;
    }
  }
  return best;
}

// Where the scene's floating rotate controls hang: the top center of the
// node's box (so they sit above the part, not on it).
export function boxTopCenter({ min, max }) {
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, max[2]];
}

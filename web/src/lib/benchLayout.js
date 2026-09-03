// Where things are in the Bench scene: which slots a node still offers,
// and the world position of each clickable marker. Pure functions over
// the assembly tree (assembly.js), the parts map, and each node's own
// standalone extents — no React, no three.js — so Bench.jsx only wires
// state to them.
import { ROOT_ID, getNode, occupiedSlotNames } from "./assembly.js";
import { enumerateSlots } from "./slots.js";

// The one further anchor a catalogue part offers for stacking once
// attached. Deliberately narrower than the part's full anchor set: see
// exposedTopWorldPosition() for why "bot" is the one whose 3D position
// can be placed without reproducing BOSL2's attach() rotation.
export const STACK_ANCHOR = "bot";

// A marker's id names the node it belongs to and the slot it stands on,
// so one click handler resolves a click on root's marker and on any
// depth of child's the same way.
const MARKER_ID_SEPARATOR = "::";

export function markerId(parentId, slotName) {
  return `${parentId}${MARKER_ID_SEPARATOR}${slotName}`;
}

export function parseMarkerId(id) {
  const at = id.indexOf(MARKER_ID_SEPARATOR);
  return { parentId: id.slice(0, at), slotName: id.slice(at + MARKER_ID_SEPARATOR.length) };
}

// A named-anchor position is always expressed relative to the part's
// own centered local origin (BOSL2's attachable() convention — every
// module in this repo follows it, generated imported-part wrappers
// included). Rendered as a root with the default anchor=BOTTOM, the
// whole part additionally shifts up by half its height so its bottom
// lands on world z=0 — so a centered-frame anchor position converts to
// a world marker position by adding height/2 on Z only.
export function centeredToWorld([x, y, z], extents) {
  return [x, y, z + extents[2] / 2];
}

// Root's slots as { name, point } in root's centered local frame — a
// catalogue part's enumerated grid/faces/rows, or an imported part's
// user-placed anchors.
export function rootSlots(rootPart, rootParams, rootExtents) {
  if (!rootPart || !rootExtents) return [];
  if (rootPart.kind === "imported") {
    return rootPart.anchors.map((a) => ({ name: a.name, point: a.point }));
  }
  return enumerateSlots(rootPart, rootParams, rootExtents).map((s) => ({
    name: s.name,
    point: [s.x, s.y, s.z],
  }));
}

// Whether `nodeId` currently has its "bot" anchor open for stacking —
// catalogue parts only, for now: imported parts still use
// slotsForNode()'s general button UI, since their anchors are arbitrary
// user-placed points, not a predictable "straight up from here" one.
export function stackSlotFor(assembly, partsById, nodeId) {
  const node = getNode(assembly, nodeId);
  const part = node && partsById.get(node.partId);
  if (!node || !part || part.kind === "imported") return null;
  if (!part.anchors?.includes(STACK_ANCHOR)) return null;
  if (occupiedSlotNames(assembly, nodeId).has(STACK_ANCHOR)) return null;
  return STACK_ANCHOR;
}

// Mating surface available around `slotName` on `parentId`, as [x, y] mm
// of the parent's own footprint: the parent's extent on each axis minus
// twice the slot's offset from center — the largest footprint that can
// sit centered on that slot without overhanging the parent. At the
// center slot that is the whole part (a single Gridfinity base fits a
// 5x5 BitBeam plate); at an off-center slot it shrinks accordingly, so
// a plate attached at a corner slot doesn't hang over the edge. Only
// meaningful for a slot whose mating direction is vertical — a top-grid
// "mount*" or the "bot" anchor of a catalogue part, or an imported
// anchor whose normal is (near) ±Z; a side face returns null and the
// child keeps its defaults. Used by slots.js's fitGridCounts().
export function slotFootprint(assembly, partsById, nodeExtents, parentId, slotName) {
  const node = getNode(assembly, parentId);
  const part = node && partsById.get(node.partId);
  const extents = nodeExtents.get(parentId);
  if (!part || !extents) return null;
  let point;
  if (part.kind === "imported") {
    const anchor = part.anchors.find((a) => a.name === slotName);
    if (!anchor || Math.abs(anchor.normal[2]) < 0.9) return null;
    point = anchor.point;
  } else {
    if (slotName !== STACK_ANCHOR && !slotName.startsWith("mount")) return null;
    const slot = enumerateSlots(part, node.params, extents).find((s) => s.name === slotName);
    if (!slot) return null;
    point = [slot.x, slot.y];
  }
  return [Math.max(0, extents[0] - 2 * Math.abs(point[0])), Math.max(0, extents[1] - 2 * Math.abs(point[1]))];
}

// World position of the point where `nodeId` itself touches its own
// parent. For a root child this is just a lookup in `rootSlotWorldPositions`
// (root's own slots are already computed in the part's local frame and
// converted once). For anything deeper, it's the parent's own exposed
// "bot" point (see exposedTopWorldPosition) — which only has a stable
// meaning if this node actually attached through that exact anchor, so
// this bails to null rather than guess for anything else (an imported
// parent, or — currently unreachable via the UI, but defensive — a
// catalogue node attached through some other anchor).
export function attachPointWorld(assembly, partsById, rootSlotWorldPositions, nodeExtents, nodeId) {
  const node = getNode(assembly, nodeId);
  if (node.parentId === ROOT_ID) return rootSlotWorldPositions.get(node.slotName) ?? null;
  const parentPart = partsById.get(getNode(assembly, node.parentId).partId);
  if (parentPart.kind === "imported" || node.slotName !== STACK_ANCHOR) return null;
  return exposedTopWorldPosition(assembly, partsById, rootSlotWorldPositions, nodeExtents, node.parentId);
}

// World position of `nodeId`'s own "bot" anchor, i.e. where a further
// part could stack on top of it. `bot` sits directly opposite "mount"
// on the same vertical line (same local x/y — at the face center, or at
// the catalogue's `mount_offset` for both; tests/test_anchors.py holds
// every part to that). Every catalogue part attaches via its own "mount"
// (attachChild() never overrides childAnchor), and BOSL2's attach()
// flips the child 180° about a horizontal axis so mount ends up touching
// the parent. For a point on the axis of that rotation through the
// anchor, which horizontal axis BOSL2 picked doesn't matter: any 180°
// turn sends (0,0,h) to (0,0,-h) relative to the anchor, full stop. So
// "bot" ends up exactly `extents.z` above wherever "mount" landed, with
// x/y unchanged — no need to replicate BOSL2's actual rotation to place
// this marker correctly. That equivalence breaks for an anchor NOT on
// mount's vertical (a plate's "xpos", "ypos", etc.), where the axis
// matters; those stay text-only in the sidebar for now rather than risk
// a wrong 3D position. (For the record, BOSL2's flip is about Y — see
// lib/constants.scad's DeckMate section — which is what lets an
// x-symmetric hole pattern survive a chain; this code just doesn't need
// to rely on it.)
export function exposedTopWorldPosition(assembly, partsById, rootSlotWorldPositions, nodeExtents, nodeId) {
  const attachPoint = attachPointWorld(assembly, partsById, rootSlotWorldPositions, nodeExtents, nodeId);
  const extents = nodeExtents.get(nodeId);
  if (!attachPoint || !extents) return null;
  return [attachPoint[0], attachPoint[1], attachPoint[2] + extents[2]];
}

// A non-root node's open slots for the sidebar's "+ Attach" buttons —
// now only reached for an imported part (a catalogue part's one
// possible further slot, "bot", gets a real 3D marker instead; see
// stackSlotFor() and sceneMarkers()).
export function slotsForNode(assembly, partsById, nodeExtents, nodeId) {
  const node = getNode(assembly, nodeId);
  const part = node && partsById.get(node.partId);
  const extents = nodeExtents.get(nodeId);
  if (!node || !part || !extents) return [];
  const all = part.kind === "imported"
    ? part.anchors.map((a) => ({ name: a.name }))
    : enumerateSlots(part, node.params, extents);
  // A slot with a grandchild attached is occupied; so, for a non-root
  // node, is the anchor it used to attach to ITS OWN parent
  // (childAnchor) — that face is already touching the parent, it can't
  // also host something else.
  const occupied = occupiedSlotNames(assembly, nodeId);
  if (nodeId !== ROOT_ID) occupied.add(node.childAnchor);
  return all.filter((s) => !occupied.has(s.name));
}

// Every clickable marker in the scene: root's own open slots, plus one
// more per stacked node that still has its "bot" anchor open.
export function sceneMarkers({ assembly, partsById, openRootSlots, rootExtents, rootSlotWorldPositions, nodeExtents }) {
  if (!assembly || !rootExtents) return [];
  const markers = openRootSlots.map((s) => {
    const [x, y, z] = centeredToWorld(s.point, rootExtents);
    return { id: markerId(ROOT_ID, s.name), x, y, z };
  });
  for (const node of assembly.nodes) {
    if (!stackSlotFor(assembly, partsById, node.id)) continue;
    const pos = exposedTopWorldPosition(assembly, partsById, rootSlotWorldPositions, nodeExtents, node.id);
    if (pos) markers.push({ id: markerId(node.id, STACK_ANCHOR), x: pos[0], y: pos[1], z: pos[2] });
  }
  return markers;
}

// Which way a Bench part ends up facing: the rotation BOSL2's attach()
// gives a child, chained from the root, so the Bench can pick a starting
// spin — "attach this openConnect head to the side of a box with its
// slide direction pointing up" — without the user having to turn it.
//
// The model (vendor/BOSL2/attachments.scad, attach() and
// _attach_transform()): a child attached through an anchor pointing UP
// (every catalogue part's "mount") onto a parent anchor pointing `d` is
//
//     R(UP -> d) · Rz(spin) · Ry(180)
//
// in the parent's frame — the half turn about Y puts its mount face
// down on the parent, the spin turns it on the slot, and the from-to
// rotation stands it on the slot's direction. (attach() actually spins
// about `d` after orienting, which is the same thing.) R(UP -> d) is
// BOSL2's affine3d_rot_from_to(), mirrored below to the case: a turn
// about UP×d, and for d = DOWN — where that axis is undefined — about
// +Y, as BOSL2's vector_axis() picks. The root's frame is the world's.
//
// Verified 2026-10-06 against native renders of Bench-generated
// sources: the head on all four side faces of a plate at two spins, and
// on the side of a plate stacked (so flipped) onto another, at two
// spins of each — see web/tests/unit/bench-orientation.test.js.
import { ROOT_ID, getNode, normalizeShift } from "./assembly.js";
import { matingRise } from "./benchLayout.js";
import { enumerateSlots, mountOffset } from "./slots.js";

const UP = [0, 0, 1];

// A slot's outward direction in its own part's frame: a catalogue
// part's named faces ("mount…" up, "bot" down, "xpos…" and friends —
// slots.js's names, side rows "xpos_<i>" included), or an imported
// part's anchor normal. null when it can't be told.
export function slotDirection(part, slotName) {
  if (!part) return null;
  if (part.kind === "imported") {
    const anchor = part.anchors?.find((a) => a.name === slotName);
    return anchor?.normal ? unit(anchor.normal) : null;
  }
  if (slotName.startsWith("mount")) return [0, 0, 1];
  if (slotName === "bot") return [0, 0, -1];
  const face = slotName.split("_")[0];
  return { xpos: [1, 0, 0], xneg: [-1, 0, 0], ypos: [0, 1, 0], yneg: [0, -1, 0] }[face] ?? null;
}

// The 3x3 rotation a child attached through an upward-pointing anchor
// gets on a slot facing `dir` (parent frame), with `spin` degrees.
export function childRotation(dir, spin = 0) {
  return mul(mul(fromTo(UP, dir), rotZ(spin)), rotY(180));
}

// `nodeId`'s rotation in world space, or null where the chain passes
// through something this model doesn't cover: a part attached by an
// anchor other than its upward "mount" (an imported part's picked
// face), or a slot whose direction is unknown.
export function nodeWorldRotation(assembly, partsById, nodeId) {
  if (nodeId === ROOT_ID) return identity();
  const node = getNode(assembly, nodeId);
  if (!node) return null;
  const part = partsById.get(node.partId);
  if (part?.kind === "imported" || (node.childAnchor ?? "mount") !== "mount") return null;
  const parentRotation = nodeWorldRotation(assembly, partsById, node.parentId);
  if (!parentRotation) return null;
  const parent = getNode(assembly, node.parentId);
  const dir = slotDirection(partsById.get(parent?.partId), node.slotName);
  if (!dir) return null;
  return mul(parentRotation, childRotation(dir, node.spin ?? 0));
}

// Where `nodeId`'s own "mount" anchor is in world space, with the node's
// rotation: { rotation, mount }, or null where nodeWorldRotation() is, or
// where a slot's or the root's position can't be told (extents not
// measured yet). The chain, from what attach() and assembly.js's
// shiftArg() emit: the parent's slot point (its frame) is where the
// child's slot frame — R(UP -> d) · Rz(spin), the child's rotation
// before the half turn — starts; the joint's flanges and the Offset
// (benchLayout.js's matingRise()) push it out along d, the shift slides
// it across in that frame, and the child's "mount" lands there. The
// shift's (x, y, 0) in the slot frame is rotation · (-x, y, 0), the half
// turn about Y undone.
export function nodeWorldMount(assembly, partsById, nodeExtents, nodeId) {
  if (nodeId === ROOT_ID) {
    const extents = nodeExtents.get(ROOT_ID);
    // The root is placed anchor=BOTTOM: its "mount" (top face centre,
    // mount offset aside) is a whole height up.
    return extents ? { rotation: identity(), mount: [0, 0, extents[2]] } : null;
  }
  const node = getNode(assembly, nodeId);
  const rotation = node && nodeWorldRotation(assembly, partsById, nodeId);
  const pivot = rotation && nodeSpinAxis(assembly, partsById, nodeExtents, nodeId);
  if (!pivot) return null;
  const [sx, sy] = normalizeShift(node.shift);
  const shift = apply(rotation, [-sx, sy, 0]);
  return { rotation, mount: pivot.center.map((v, i) => v + shift[i]) };
}

// The line an attached node's spin turns it about, in world space:
// { center, axis }, `axis` the slot's outward direction and `center` the
// slot's point pushed out along it by the joint's flanges and the Offset
// — on the part's mating face, where its "mount" lands before the shift
// slides it across (the shift turns with the spin, so the part orbits
// this line). null for the root, which has no spin, and where
// nodeWorldMount() is.
export function nodeSpinAxis(assembly, partsById, nodeExtents, nodeId) {
  if (nodeId === ROOT_ID) return null;
  const node = getNode(assembly, nodeId);
  if (!node || !nodeWorldRotation(assembly, partsById, nodeId)) return null;
  const parent = nodeWorldFrame(assembly, partsById, nodeExtents, node.parentId);
  const parentNode = getNode(assembly, node.parentId);
  const parentPart = partsById.get(parentNode?.partId);
  const point = slotPoint(
    parentPart,
    parentNode?.params ?? {},
    nodeExtents.get(node.parentId),
    node.slotName,
  );
  const dir = slotDirection(parentPart, node.slotName);
  if (!parent || !point || !dir) return null;
  const slot = add(parent.centre, apply(parent.rotation, point));
  const axis = apply(parent.rotation, dir);
  const rise = matingRise(assembly, partsById, node);
  return { center: slot.map((v, i) => v + axis[i] * rise), axis };
}

// `nodeId`'s rotation and the world position of its own centre (the
// origin every module here is centred on): { rotation, centre }, or null
// as nodeWorldMount(). The centre sits back from "mount" by the anchor's
// own place on the part: the top face's centre, or the catalogue's
// mount_offset off it.
export function nodeWorldFrame(assembly, partsById, nodeExtents, nodeId) {
  const extents = nodeExtents.get(nodeId);
  const placed = extents && nodeWorldMount(assembly, partsById, nodeExtents, nodeId);
  if (!placed) return null;
  const node = getNode(assembly, nodeId);
  const part = partsById.get(node.partId);
  // The root is placed by its bounding box, not by "mount".
  const [ox, oy] = nodeId === ROOT_ID || !part ? [0, 0] : mountOffset(part, node.params ?? {});
  const back = apply(placed.rotation, [ox, oy, extents[2] / 2]);
  return { rotation: placed.rotation, centre: placed.mount.map((v, i) => v - back[i]) };
}

// A named slot's point in its part's own centred frame: a catalogue
// part's enumerated slot, or an imported part's anchor.
function slotPoint(part, params, extents, slotName) {
  if (!part) return null;
  if (part.kind === "imported") return part.anchors?.find((a) => a.name === slotName)?.point ?? null;
  if (!extents) return null;
  const slot = enumerateSlots(part, params, extents).find((s) => s.name === slotName);
  return slot ? [slot.x, slot.y, slot.z] : null;
}

// The spin (whole degrees, in [0, 360)) that points a part's own
// in-plane axis `localUp` ([x, y], the catalogue's `attached_up`) as
// close to world up as it can go, attached on `slotName` of `parentId`.
// null when there is nothing to choose — the slot faces straight up or
// down, so every spin keeps that axis level — or the parent's
// orientation can't be told.
export function uprightSpin(assembly, partsById, parentId, slotName, localUp) {
  const parentRotation = nodeWorldRotation(assembly, partsById, parentId);
  if (!parentRotation) return null;
  const parent = parentId === ROOT_ID ? assembly.root : getNode(assembly, parentId);
  const dir = slotDirection(partsById.get(parent?.partId), slotName);
  if (!dir) return null;
  // World up of the part's axis at spin θ: M · Rz(θ) · Ry(180) · u. The
  // half turn sends (ux, uy, 0) to (-ux, uy, 0); Rz(θ) turns that in
  // the plane, so the z of the result is a·cosθ + b·sinθ for the two
  // numbers below, largest at θ = atan2(b, a).
  const m = mul(parentRotation, fromTo(UP, dir));
  const [ux, uy] = localUp;
  const p = [-ux, uy];
  const a = m[2][0] * p[0] + m[2][1] * p[1];
  const b = -m[2][0] * p[1] + m[2][1] * p[0];
  if (Math.hypot(a, b) < 1e-6) return null;
  const degrees = Math.round((Math.atan2(b, a) * 180) / Math.PI);
  return ((degrees % 360) + 360) % 360;
}

// The world direction `localUp` ends up pointing at for a node — what
// the test checks the renders against.
export function worldAxis(rotation, [ux, uy, uz = 0]) {
  return rotation.map((row) => row[0] * ux + row[1] * uy + row[2] * uz);
}

// --- 3x3 rotations, BOSL2's conventions ---------------------------------

function fromTo(from, to) {
  const f = unit(from);
  const t = unit(to);
  if (close(f, t)) return identity();
  // BOSL2 takes a level pair as a plain turn about Z.
  if (Math.abs(f[2]) < 1e-12 && Math.abs(t[2]) < 1e-12)
    return rotZ(((Math.atan2(t[1], t[0]) - Math.atan2(f[1], f[0])) * 180) / Math.PI);
  // vector_axis(): for opposite vectors, cross with UP — or with RIGHT
  // when the vector is ±UP itself, which is the bot slot's case.
  const opposite = close(
    f,
    t.map((x) => -x),
  );
  const helper = !opposite ? t : !close(f.map(Math.abs), [0, 0, 1]) ? [0, 0, 1] : [1, 0, 0];
  const axis = unit(cross(f, helper));
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(f, t))));
  return axisAngle(axis, angle);
}

function axisAngle([x, y, z], angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = 1 - c;
  return [
    [x * x * k + c, x * y * k - z * s, x * z * k + y * s],
    [y * x * k + z * s, y * y * k + c, y * z * k - x * s],
    [z * x * k - y * s, z * y * k + x * s, z * z * k + c],
  ];
}

function rotZ(degrees) {
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ];
}

function rotY(degrees) {
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [c, 0, s],
    [0, 1, 0],
    [-s, 0, c],
  ];
}

function identity() {
  return [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
}

function apply(m, v) {
  return m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
}

function add(a, b) {
  return a.map((x, i) => x + b[i]);
}

function mul(a, b) {
  return a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function unit(v) {
  const len = Math.hypot(...v) || 1;
  return v.map((x) => x / len);
}

function close(a, b) {
  return a.every((x, i) => Math.abs(x - b[i]) < 1e-6);
}

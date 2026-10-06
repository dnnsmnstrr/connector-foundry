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
import { ROOT_ID, getNode } from "./assembly.js";

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
  if (Math.abs(f[2]) < 1e-12 && Math.abs(t[2]) < 1e-12) return rotZ(((Math.atan2(t[1], t[0]) - Math.atan2(f[1], f[0])) * 180) / Math.PI);
  // vector_axis(): for opposite vectors, cross with UP — or with RIGHT
  // when the vector is ±UP itself, which is the bot slot's case.
  const opposite = close(f, t.map((x) => -x));
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

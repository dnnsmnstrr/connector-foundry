// The Bench's assembly model: a root part plus a tree of parts snapped
// onto open slots — a child's own further slots (if it has any beyond
// the one it used to attach) can host grandchildren, and so on to any
// depth ("stacking": a flat plate on a Gridfinity base, then a GoPro
// mount on the plate). compileToScad() generates the same nested
// attach() style lib/joints.scad's flanges and assemblies/*.scad
// already use, so output stays readable and matches house style.
//
// Every node but the root has a `parentId` naming the node (or "root")
// it's attached to — that's what makes this a tree instead of the
// one-level hub-and-spoke this used to be. Whether stacking onto a
// given node makes sense depends entirely on whether that part exposes
// any anchor besides the one it used to attach: a terminal connector
// (GoPro, 2020-extrusion tab, DeckMate) has only "mount", which is
// spent the moment it's placed, so it naturally has zero open slots as
// a child — nothing else to do there. A part built for branching
// (Basics plate/post, or any multi-slot grid like Gridfinity/openGrid)
// keeps offering the rest of its anchors regardless of where in the
// tree it sits, since slots.js enumerates them from the part's own
// rendered size, never from its position in the assembly.
//
// A part is either a catalogue entry (looked up by id, `file`+`module`
// point at real .scad) or an imported one (see importedPart.js — no
// file, geometry comes from `import()`-ing an uploaded STL, one
// generated wrapper module per import). Both are looked up through the
// same `partsById` map passed to compileToScad(); imported entries
// carry `kind: "imported"` so the codegen below can tell them apart.
import { callArgs } from "./scadLiteral.js";

let nextChildId = 1;

export const ROOT_ID = "root";

// Every way two parts can mate through their mount slots — see
// lib/joints.scad and the root README's "Joints". "fused" is a plain
// attach(); the rest add flanges (emitJointChild, emitScrewedChild) and
// so each start a new printable body (bodyTags).
export const JOINTS = ["fused", "bolted", "snap", "pin", "screwed"];

export const JOINT_LABELS = {
  fused: "fused",
  bolted: "bolted",
  snap: "snap",
  pin: "pin",
  screwed: "screwed (DeckMate)",
};

// The generated flange for each screw pattern a catalogue part can
// declare (`screw_pattern`) — the flange goes on the side of a "screwed"
// joint that has no holes of its own; see lib/joints.scad.
const SCREW_FLANGES = { deckmate: "deckmate_screw_flange" };

export function hasScrewPattern(part) {
  return Boolean(part?.screw_pattern && SCREW_FLANGES[part.screw_pattern]);
}

// "screwed" needs holes on at least one side of the seam.
export function screwedApplies(parentPart, childPart) {
  return hasScrewPattern(parentPart) || hasScrewPattern(childPart);
}

// The joints offered for a child under a given parent.
export function jointsFor(parentPart, childPart) {
  return JOINTS.filter((joint) => joint !== "screwed" || screwedApplies(parentPart, childPart));
}

export function createAssembly(rootPartId, rootParams) {
  return { root: { id: ROOT_ID, partId: rootPartId, params: { ...rootParams } }, nodes: [] };
}

// A node by id, root included — the one place both "root" and a child
// id resolve the same way, since most of the tree-walking below (and
// Bench.jsx's per-node UI) doesn't care which kind it's looking at.
export function getNode(assembly, id) {
  if (id === ROOT_ID) return assembly.root;
  return assembly.nodes.find((n) => n.id === id) ?? null;
}

export function childrenOf(assembly, parentId) {
  return assembly.nodes.filter((n) => n.parentId === parentId);
}

export function occupiedSlotNames(assembly, parentId) {
  return new Set(childrenOf(assembly, parentId).map((c) => c.slotName));
}

// `childAnchor` is which of the CHILD's own anchors touches the
// parent's slot — "mount" for every catalogue part attaching for the
// first time (the only anchor a terminal part exposes for this
// purpose), but a user-chosen name for an imported part, or for a
// multi-anchor part (Basics plate/post) being stacked onto from one of
// its non-"mount" faces.
//
// `overlap` (mm, default 0): how far the child sinks into whatever it's
// directly touching (the parent for a fused joint, the far flange for
// bolted/snap) — negative pulls it out instead, leaving a gap. See
// overlapArg() for the sign flip against BOSL2's own `overlap=`, which
// goes the other way.
//
// `spin` (degrees, default 0): the child's rotation about its own mating
// axis — the line through the slot along the slot's normal, i.e. the
// only rotation that keeps the two mating faces touching. Positive is
// counter-clockwise looking at the slot from outside (right-hand rule
// about the parent anchor's outward direction, BOSL2's own attach()
// `spin=` convention — see spinArg()). Multiples of 90 are what the
// scene's ↺/↻ buttons produce; any angle is allowed via the sidebar.
export function addChild(assembly, { parentId, partId, params, slotName, joint = "fused", childAnchor = "mount", overlap = 0, spin = 0 }) {
  const child = { id: allocateChildId(), parentId, partId, params: { ...params }, slotName, joint, childAnchor, overlap, spin };
  return { ...assembly, nodes: [...assembly.nodes, child] };
}

// The one source of child ids for this session. benchConfig.js's
// hydration re-issues every node id of a loaded config through here, so
// a config saved with "c1".."c5" can't hand out "c1" a second time to
// the next part attached after it's loaded — ids are also the body tags
// (bodyTags()) and the scene's marker ids, so a duplicate would be more
// than cosmetic.
export function allocateChildId() {
  return `c${nextChildId++}`;
}

// Angles wrap to [0, 360) so eight ↻ presses land back on 0, not 720,
// and the exported .scad never carries a `spin=-270`.
export function normalizeSpin(spin) {
  if (!Number.isFinite(spin)) return 0;
  const wrapped = ((spin % 360) + 360) % 360;
  // Round away float dust from repeated +/-90 so 90 stays exactly 90.
  return Math.round(wrapped * 1e6) / 1e6;
}

// Every node attached below `id` — children, their children, and so on —
// as a Set of ids. `id` itself is not in it.
export function descendantIds(assembly, id) {
  const found = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of assembly.nodes) {
      if (!found.has(n.id) && found.has(n.parentId)) {
        found.add(n.id);
        grew = true;
      }
    }
  }
  found.delete(id);
  return found;
}

// Removing a node removes its whole subtree — an orphaned grandchild
// (parent gone, slot gone) has nothing left to attach through. A crop
// (see setCropTo) that pointed into the removed subtree goes with it;
// a mask with nothing in it would cut the whole assembly away.
export function removeChild(assembly, childId) {
  const toRemove = descendantIds(assembly, childId).add(childId);
  const next = { ...assembly, nodes: assembly.nodes.filter((n) => !toRemove.has(n.id)) };
  if (toRemove.has(next.cropTo)) delete next.cropTo;
  return next;
}

// Crop everything else to one node's vertical outline: `cropTo` names
// the node (root or a child) whose footprint — its own body's shadow
// straight up and down, world Z — everything else is intersected with,
// so a part that overhangs it by a few millimetres is trimmed flush
// instead of sticking out (compileToScad() emits the intersection). One
// node at a time; null clears it. The node itself is never changed by
// its own crop (it lies inside its own shadow), and a joint's flanges
// aren't part of the outline — only the part is.
export function setCropTo(assembly, id) {
  if (id === null || id === undefined) {
    if (assembly.cropTo === undefined) return assembly;
    const next = { ...assembly };
    delete next.cropTo;
    return next;
  }
  if (!getNode(assembly, id) || assembly.cropTo === id) return assembly;
  return { ...assembly, cropTo: id };
}

// Re-seats a child on another open slot — another slot of the same
// parent, or one on a different node. Everything else about it (joint,
// anchor, offset, spin, params) stays, and so does everything attached
// to it: a subtree's positions are all relative to the node, so it
// simply comes along. The assembly comes back unchanged when the move
// isn't one: the target is taken, or it's the child itself or something
// attached to it (a node can't hang off its own subtree), or the slot is
// the one the target parent used to attach to ITS parent, or `childId`
// is root. Callers needn't pre-check; "nothing happened" is the answer.
export function moveChild(assembly, childId, { parentId, slotName }) {
  const node = getNode(assembly, childId);
  const parent = getNode(assembly, parentId);
  if (!node || !parent || childId === ROOT_ID) return assembly;
  if (parentId === childId || descendantIds(assembly, childId).has(parentId)) return assembly;
  if (node.parentId === parentId && node.slotName === slotName) return assembly;
  if (parentId !== ROOT_ID && parent.childAnchor === slotName) return assembly;
  if (occupiedSlotNames(assembly, parentId).has(slotName)) return assembly;
  return {
    ...assembly,
    nodes: assembly.nodes.map((n) => (n.id === childId ? { ...n, parentId, slotName } : n)),
  };
}

export function updateChildJoint(assembly, childId, joint) {
  return {
    ...assembly,
    nodes: assembly.nodes.map((c) => (c.id === childId ? { ...c, joint } : c)),
  };
}

export function updateChildOverlap(assembly, childId, overlap) {
  return {
    ...assembly,
    nodes: assembly.nodes.map((c) => (c.id === childId ? { ...c, overlap } : c)),
  };
}

export function updateChildSpin(assembly, childId, spin) {
  const normalized = normalizeSpin(spin);
  return {
    ...assembly,
    nodes: assembly.nodes.map((c) => (c.id === childId ? { ...c, spin: normalized } : c)),
  };
}

// Turn a child by `delta` degrees on top of whatever spin it already has
// — what the scene's ↺ (+90) and ↻ (-90) buttons do.
export function rotateChild(assembly, childId, delta) {
  const node = getNode(assembly, childId);
  if (!node || childId === ROOT_ID) return assembly;
  return updateChildSpin(assembly, childId, (node.spin ?? 0) + delta);
}

// id may be "root" (updates assembly.root.params) or a child id — one
// entry point for the Bench's param editor regardless of which node.
export function updateNodeParams(assembly, id, params) {
  if (id === ROOT_ID) {
    return { ...assembly, root: { ...assembly.root, params: { ...params } } };
  }
  return {
    ...assembly,
    nodes: assembly.nodes.map((n) => (n.id === id ? { ...n, params: { ...params } } : n)),
  };
}

function importedModuleName(part) {
  return `imported_${part.id.split(":")[1]}`;
}

function importedStlPath(part) {
  return `imports/${part.id.split(":")[1]}.stl`;
}

// Generates the one-off attachable() wrapper for an imported part: a
// named_anchor per user-placed slot, geometry recentred on the local
// origin (attachable()'s convention — every catalogue part follows it
// too) by translating out the same bounding-box center the anchors are
// already stored relative to (see importedPart.js's addAnchor()).
function importedModuleSource(part) {
  const name = importedModuleName(part);
  const [ex, ey, ez] = part.extents;
  const [cx, cy, cz] = part.center;
  const anchors = part.anchors
    .map((a) => `named_anchor(${JSON.stringify(a.name)}, [${a.point.join(", ")}], [${a.normal.join(", ")}], 0)`)
    .join(",\n        ");
  return [
    `module ${name}(anchor = BOTTOM, spin = 0, orient = UP) {`,
    `    size = [${ex}, ${ey}, ${ez}];`,
    `    anchors = [`,
    `        ${anchors}`,
    `    ];`,
    `    attachable(anchor, spin, orient, size = size, anchors = anchors) {`,
    `        translate([${-cx}, ${-cy}, ${-cz}]) import("${importedStlPath(part)}");`,
    `        children();`,
    `    }`,
    `}`,
  ].join("\n");
}

function partModule(part) {
  return part.kind === "imported" ? importedModuleName(part) : part.module;
}

function partCallArgs(part, params) {
  return part.kind === "imported" ? "" : callArgs(params);
}

// child always attaches via its OWN "mount"-equivalent anchor
// (`child.childAnchor`), not BOTTOM. BOSL2's attach(parent, child)
// rotates the child so the child anchor's direction is antiparallel to
// the parent anchor's; every mount-style anchor in this catalogue
// (and every imported slot, since it's a real surface normal) points
// away from the part's own body, so using the child's own anchor
// forces the natural flip that makes IT the touching face and leaves
// the child's functional BOTTOM face (or, for a stacked multi-anchor
// part, whichever of its OTHER faces ends up pointing outward after
// the flip) exposed for whatever attaches next — exactly the
// convention lib/joints.scad's flanges and assemblies/*.scad already
// rely on (see gridfinity-to-gopro.scad's header comment). Attaching
// via BOTTOM instead would leave the child's functional face buried
// against the parent, which is never what you want for a part whose
// whole purpose is exposing that face to the outside world.
//
// KNOWN LIMITATION (browser preview only, not a bug in this codegen):
// a bolted/snap joint nests two flanges' attach() calls around the
// child (see below). Each flange is a rounded cuboid
// (`cuboid(..., rounding=...)`), and openscad-wasm@0.0.4 hits a hard
// WASM "memory access out of bounds" crash once a THIRD
// rounded-cuboid part is nested inside that same attach() chain — e.g.
// bolting a Basics plate (also `cuboid(..., rounding=...)`) onto
// anything, or two levels of bolted stacking. Confirmed this is a
// WASM-build resource limit, not a logic error: the identical generated
// .scad renders correctly with a native `openscad --backend=Manifold`
// install (see the CLI). A child hitting this shows a render error in
// the Bench UI rather than silently producing a wrong mesh — annoying,
// not unsafe — and switching that connection to "fused" always works.
// BOSL2's own attach()/align() `overlap=` sinks the child INTO whatever
// it's attached to for a POSITIVE value (see vendor/BOSL2/attachments.scad's
// docs: "Amount to sink the child into the parent"). The Bench's own
// "Offset" field goes the other way — negative sinks in — since that
// reads more naturally ("push it in further" as "more negative", the
// same direction as "move the child's own position back"), so this
// flips the sign once here rather than asking every caller to remember
// which way BOSL2's convention runs. Omitted entirely at 0 (BOSL2's own
// default) to keep generated .scad free of a no-op argument.
function overlapArg(child) {
  return child.overlap ? `, overlap=${-child.overlap}` : "";
}

// BOSL2's attach() `spin=` turns the child about the parent anchor's own
// direction, through the anchor point (`rot(v=spinaxis, a=spin)` right
// after `translate(pos)` in vendor/BOSL2/attachments.scad) — exactly
// "rotate in place on the slot", which is why the Bench stores spin as
// a plain number and hands it straight through. Omitted at 0, like
// overlap. Always on the CHILD's own attach() (the one naming
// `childAnchor`), never on a flange's: a bolted/snap/pin/screwed joint's
// flanges keep their bolt/pin/screw pattern lined up with the parent,
// and only the part on the far side turns.
function spinArg(child) {
  const spin = normalizeSpin(child.spin ?? 0);
  return spin ? `, spin=${spin}` : "";
}

// Everything that adjusts how the child sits on its mating face.
function mateArgs(child) {
  return `${overlapArg(child)}${spinArg(child)}`;
}

// hide_this() only suppresses ONE level's own geometry — its own
// attach()'d children stay visible by default ("Use an invisible
// parent to position children", per BOSL2's own doc example). So
// wrapping a whole multi-level chain (flange + the part fused onto it)
// in a single outer hide_this() does NOT hide the part — only the
// flange. Getting a hidden-but-positioned SUBTREE right means putting
// hide_this() in front of every module call in that chain individually
// (each `emitX(hide)` below takes that as an explicit flag), while a
// DEEPER child's own visibility is decided completely independently by
// ITS OWN tag comparison — an ancestor being hidden has no bearing on
// whether a descendant further down turns out to be the one requested.
// This is the fix for what used to be either a silently empty export
// (for any tag but "all"/"root") or, briefly during development, a
// body that leaked its own children into an unrelated export.
//
// The crop mask copy (ctx.plain — see emitCropped()) has no body
// boundaries at all: every unit is emitted shown, with no `part` test,
// so the copy means the same thing whatever `-D part=` the render asks
// for. (A `let(part = "all")` around the copy was tried first and does
// NOT work: a -D value wins over the rebinding, so an export of one body
// got a mask with its root hidden — an empty mask, an empty export.)
function dispatchBlock(ctx, tag, unitFn, indent) {
  if (ctx.plain) return `${indent}${unitFn(false)}`;
  return (
    `${indent}if (part == "all" || part == "${tag}")\n` +
    `${indent}    ${unitFn(false)}\n` +
    `${indent}else\n` +
    `${indent}    ${unitFn(true)}`
  );
}

// The emitters below share one context: the tree, the parts map, and
// `tagged` — the id of the one node whose own module call gets a
// `tag_this("crop")` prefix, or null. The tree is emitted twice when a
// crop is set (see compileToScad()): once as the assembly, once as the
// crop mask, and the mask copy is the one with a tagged node.
function partCall(ctx, nodeId, part, params) {
  const tag = ctx.tagged === nodeId ? `tag_this("${CROP_TAG}") ` : "";
  return `${tag}${partModule(part)}(${partCallArgs(part, params)})`;
}

// Every direct child of `nodeId`, each inheriting `hide` from its
// parent UNLESS it's a bolted/snap/pin child — those introduce a NEW
// tag boundary of their own (see emitJointChild), so `hide` stops
// propagating there and a fresh dispatchBlock takes over instead. A
// fused child has no boundary of its own: it's the same body as its
// parent, so it just carries `hide` straight through, unchanged, to
// whatever it's attached to and its own further children alike.
function emitChildren(ctx, nodeId, hide, indent) {
  return childrenOf(ctx.assembly, nodeId)
    .map((child) => (child.joint === "fused"
      ? emitFusedChild(ctx, child, hide, indent)
      : child.joint === "screwed"
        ? emitScrewedChild(ctx, child, hide, indent)
        : emitJointChild(ctx, child, hide, indent)))
    .join("\n");
}

// A "screwed" child: one flange at most, on whichever side of the seam
// has no screw holes of its own, fused to THAT side's body; the seam is
// the body boundary. Three shapes (see lib/joints.scad's header):
//   child has the pattern   — flange fused to the parent via "mount",
//                             child screws onto the flange's "seat"
//   parent has the pattern  — flange belongs to the child's body, its
//                             "seat" on the parent's holes, child on its
//                             "mount"
//   both have it            — no flange; a plain attach with a body
//                             boundary at the seam (Universal + Outie)
// The flange's "mount"/"seat" and every DeckMate part's own anchors all
// sit at the hole pattern's reference point, so hole lands on hole by
// construction — tests/test_deckmate.py renders each of these shapes
// and probes both sides of the seam. A "screwed" joint between two parts
// with no pattern at all (the UI doesn't offer it) gets the first shape:
// a flange whose bores face nothing, harmless.
function emitScrewedChild(ctx, child, hide, indent) {
  const { assembly, partsById } = ctx;
  const childPart = partsById.get(child.partId);
  const parentPart = partsById.get(getNode(assembly, child.parentId).partId);
  const call = partCall(ctx, child.id, childPart, child.params);
  const mate = mateArgs(child);
  const pattern = childPart.screw_pattern ?? parentPart.screw_pattern ?? "deckmate";
  const flange = SCREW_FLANGES[pattern] ?? SCREW_FLANGES.deckmate;
  const childHas = hasScrewPattern(childPart);
  const parentHas = hasScrewPattern(parentPart);
  const hidden = (flag) => (flag ? "hide_this() " : "");

  // `attachTo` + the child call + its own subtree, hidden or not, with
  // the subtree's closing brace at `ind`.
  const childUnit = (attachTo, unitHide, ind) => {
    const grandkids = emitChildren(ctx, child.id, unitHide, ind + "    ");
    const body = grandkids ? ` {\n${grandkids}\n${ind}}` : ";";
    return `${attachTo} ${hidden(unitHide)}${call}${body}`;
  };

  if (childHas && parentHas) {
    return dispatchBlock(ctx, child.id,
      (unitHide) => childUnit(`attach("${child.slotName}", "${child.childAnchor}"${mate})`, unitHide, indent + "    "),
      indent);
  }
  if (parentHas) {
    return dispatchBlock(ctx, child.id,
      (unitHide) => `attach("${child.slotName}", "seat") ${hidden(unitHide)}${flange}() `
        + childUnit(`attach("mount", "${child.childAnchor}"${mate})`, unitHide, indent + "    "),
      indent);
  }
  return [
    `${indent}attach("${child.slotName}", "mount") ${hidden(hide)}${flange}() {`,
    dispatchBlock(ctx, child.id,
      (unitHide) => childUnit(`attach("seat", "${child.childAnchor}"${mate})`, unitHide, indent + "        "),
      indent + "    "),
    `${indent}}`,
  ].join("\n");
}

function emitFusedChild(ctx, child, hide, indent) {
  const childPart = ctx.partsById.get(child.partId);
  const call = partCall(ctx, child.id, childPart, child.params);
  const mate = mateArgs(child);
  const grandkids = emitChildren(ctx, child.id, hide, indent + "    ");
  const body = grandkids ? ` {\n${grandkids}\n${indent}}` : ";";
  return `${indent}attach("${child.slotName}", "${child.childAnchor}"${mate}) ${hide ? "hide_this() " : ""}${call}${body}`;
}

// A bolted/snap/pin child: flangeA inherits `hide` directly (it's fused
// to the parent, same body — no new boundary), but flangeB onward is a
// NEW body, so it gets its own dispatchBlock, called once shown and
// once hidden right here, each branch recursing into the child's own
// further children with THAT branch's hide state. A pin joint's pin
// gets a second, independent dispatchBlock alongside it — its own
// separate body, not part of either flange (see lib/joints.scad's
// pin_flange()).
function emitJointChild(ctx, child, hide, indent) {
  const childPart = ctx.partsById.get(child.partId);
  const call = partCall(ctx, child.id, childPart, child.params);
  const mate = mateArgs(child);
  const [flangeA, flangeB] = child.joint === "bolted" ? ["bolted_flange_a", "bolted_flange_b"]
    : child.joint === "snap" ? ["snap_flange_a", "snap_flange_b"]
    : ["pin_flange", "pin_flange"]; // pin: identical flange either side — see joints.scad

  const childUnit = (unitHide) => {
    const grandkids = emitChildren(ctx, child.id, unitHide, indent + "            ");
    const body = grandkids ? ` {\n${grandkids}\n${indent}        }` : ";";
    return (
      `attach(BOTTOM, "mount") ${unitHide ? "hide_this() " : ""}${flangeB}() ` +
      `attach(BOTTOM, "${child.childAnchor}"${mate}) ${unitHide ? "hide_this() " : ""}${call}${body}`
    );
  };

  const lines = [`${indent}attach("${child.slotName}", "mount") ${hide ? "hide_this() " : ""}${flangeA}() {`];
  lines.push(dispatchBlock(ctx, child.id, childUnit, indent + "    "));
  if (child.joint === "pin") {
    // Centered on the seam between the two flanges — BOSL2's own
    // overlap= sinks the child INTO the parent for a positive value
    // (see overlapArg()'s comment), so +half the pin's own length sinks
    // it exactly half into each flange's bore, spanning the join the
    // same way a pin spans two adjacent beams' aligned holes.
    const pinUnit = (unitHide) =>
      `${unitHide ? "hide_this() " : ""}attach(BOTTOM, "mount", overlap = BITBEAM_PIN_LEN / 2) bitbeam_pin();`;
    lines.push(dispatchBlock(ctx, `${child.id}_pin`, pinUnit, indent + "    "));
  }
  lines.push(`${indent}}`);
  return lines.join("\n");
}

// Every FUSED node, plus every bolted/snap/pin flangeA half, is rigidly
// joined to whatever it's fused to, transitively up to the root — one
// body per nearest non-fused boundary, plus one further tag for each
// pin joint's own separate pin body. This generalises "connected
// components restricted to fused edges" from a one-level tree to any
// depth: a bolted child two levels down is its own body regardless of
// whether anything between it and the root is also bolted, and a pin
// joint contributes a third body alongside its two flanges' halves
// rather than being hardcoded to exactly two.
export function bodyTags(assembly) {
  const tags = new Set([ROOT_ID]);
  for (const n of assembly.nodes) {
    if (n.joint !== "fused") tags.add(n.id);
    if (n.joint === "pin") tags.add(`${n.id}_pin`);
  }
  return [...tags];
}

// `partsById`: id -> catalogue entry OR imported part (see file header).
// `importedFiles` (out param, optional Map): if given, gets populated
// with path -> STL bytes (importedPart.js's precomputed `stlBytes`) for
// every imported part referenced, so the caller (Bench.jsx) can hand
// them to the render worker alongside the generated source.
//
// Multi-body export (`part = "all" | "root" | <tag>`, one STL per body)
// used to only work for "all"/"root": everything else silently rendered
// nothing, because the single `if (part=="all"||part=="root") ...`
// wrapping the whole tree excluded any other tag before its nested
// attach() chains — the ones that actually decide which *child* body to
// show — ever ran. dispatchBlock()/emitChildren() fix that by gating
// each tag boundary (root, and each joint child's own body) individually
// with BOSL2's hide_this() instead of a plain `if`: a body that isn't
// wanted this render still gets attached-to (so anything further down
// stays correctly positioned), it just doesn't contribute geometry to
// the output — and that hidden state is threaded explicitly through
// every module call in between (hide_this() only suppresses ONE level
// on its own), not just the outermost one.
export function compileToScad(assembly, partsById, importedFiles) {
  const rootPart = partsById.get(assembly.root.partId);
  const includes = new Set([`include <../vendor/BOSL2/std.scad>`]);
  const needsJoints = assembly.nodes.some((c) => c.joint !== "fused");
  if (needsJoints) includes.add(`include <../lib/joints.scad>`);
  const needsPin = assembly.nodes.some((c) => c.joint === "pin");
  if (needsPin) {
    const pin = partsById.get("bitbeam/pin");
    if (!pin) throw new Error('A pin joint needs the catalogue part "bitbeam/pin", which is not in this catalogue.');
    includes.add(`include <../${pin.file}>`);
  }

  const generatedModules = [];
  const allParts = [rootPart, ...assembly.nodes.map((c) => partsById.get(c.partId))];
  for (const part of allParts) {
    if (part.kind === "imported") {
      generatedModules.push(importedModuleSource(part));
      if (importedFiles) importedFiles.set(importedStlPath(part), part.stlBytes);
    } else {
      includes.add(`include <../${part.file}>`);
    }
  }

  const tags = bodyTags(assembly);

  // Root's own children inherit root's own hide state directly — a
  // fused child stays exactly as visible as root is; a bolted/snap/pin
  // child starts its own independent dispatch regardless (see
  // emitChildren()/emitJointChild()). `indent` is where the tree sits:
  // top level normally, one level in when wrapped in a crop. A `tagged`
  // node makes it the crop mask copy: that node's call tagged, and no
  // body dispatch anywhere (ctx.plain — see dispatchBlock()).
  const emitTree = (tagged, indent) => {
    const ctx = { assembly, partsById, tagged, plain: tagged !== null };
    const rootUnit = (hide) => {
      const rootChildren = emitChildren(ctx, ROOT_ID, hide, indent + "        ");
      const body = rootChildren ? ` {\n${rootChildren}\n${indent}    }` : ";";
      return `${hide ? "hide_this() " : ""}${partCall(ctx, ROOT_ID, rootPart, assembly.root.params)}${body}`;
    };
    return dispatchBlock(ctx, ROOT_ID, rootUnit, indent);
  };

  const cropNode = assembly.cropTo !== undefined ? getNode(assembly, assembly.cropTo) : null;
  const lines = [
    ...includes,
    "",
    ...generatedModules,
    "",
    `part = "all"; // ${JSON.stringify(tags)}`,
    "",
    ...(cropNode ? emitCropped(emitTree, cropNode, partsById) : [emitTree(null, "")]),
    "",
  ];
  return lines.join("\n");
}

// The tag the crop mask shows (see emitCropped) — scoped by nothing, so
// tag_this() and show_only() see the same string. Every part module in
// this repo is a BOSL2 attachable() with no tags of its own, and none of
// the vendored libraries use BOSL2 at all, so nothing else can collide.
const CROP_TAG = "crop";

// Taller than any bench: the mask is a prism straight through the whole
// assembly, so height only has to exceed it (mm, centered on z=0).
const CROP_HEIGHT_MM = 1000;

// The assembly intersected with one node's vertical footprint. The mask
// is the tree emitted a second time with that node's own call tagged and
// everything else hidden by show_only(): BOSL2 attachables still POSITION
// their children while hidden (the same fact hide_this() relies on for
// per-body export), so the tagged part lands exactly where the assembly
// puts it, and projection() of the copy is that part's shadow on XY —
// world XY, because the copy is placed in world space like the original,
// whichever way BOSL2 turned the part on its slot. fill() then keeps
// only the OUTER outline of that shadow: a through-hole in the cropping
// part (a BitBeam plate's grid, a Gridfinity base's screw holes) is not
// a reason to punch the same hole through everything above and below
// it — the crop is about what overhangs the edge. (fill() is a 2024+
// OpenSCAD builtin; both the browser's WASM build, 2025.07.18, and the
// native dev snapshots the CLI targets have it.) tag_this() tags only
// the one call: the part's own module geometry inherits the tag
// (attachable() draws children(0) under it) while its attach()'d
// children get the previous tag back, so a stacked part isn't part of
// the outline and a joint's flanges (separate module calls) aren't
// either. The copy carries no `part` dispatch (dispatchBlock()'s plain
// mode), so it is the same whichever body is being exported — the
// outline is always the whole part, and every export (`-D part=...`)
// gets the same crop, which is the point: the trimmed edge is what
// should print.
function emitCropped(emitTree, cropNode, partsById) {
  const name = partsById.get(cropNode.partId)?.name ?? cropNode.partId;
  return [
    `// Crop: everything outside the vertical outline of ${cropNode.id} (${name}) is cut away.`,
    "intersection() {",
    emitTree(null, "    "),
    `    linear_extrude(height = ${CROP_HEIGHT_MM}, center = true) fill() projection()`,
    `        show_only("${CROP_TAG}")`,
    emitTree(cropNode.id, "            "),
    "}",
  ];
}

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
let nextChildId = 1;

const ROOT_ID = "root";
export { ROOT_ID };

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
// attachChildScad()'s overlapArg() for the sign flip against BOSL2's
// own `overlap=`, which goes the other way.
export function addChild(assembly, { parentId, partId, params, slotName, joint = "fused", childAnchor = "mount", overlap = 0 }) {
  const child = { id: `c${nextChildId++}`, parentId, partId, params: { ...params }, slotName, joint, childAnchor, overlap };
  return { ...assembly, nodes: [...assembly.nodes, child] };
}

// Removing a node removes its whole subtree — an orphaned grandchild
// (parent gone, slot gone) has nothing left to attach through.
export function removeChild(assembly, childId) {
  const toRemove = new Set([childId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of assembly.nodes) {
      if (!toRemove.has(n.id) && toRemove.has(n.parentId)) {
        toRemove.add(n.id);
        grew = true;
      }
    }
  }
  return { ...assembly, nodes: assembly.nodes.filter((n) => !toRemove.has(n.id)) };
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

function scadLiteral(value) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function callArgs(params) {
  return Object.entries(params || {})
    .map(([key, value]) => `${key}=${scadLiteral(value)}`)
    .join(", ");
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

// `innerBlock` is already-rendered .scad for this child's OWN children
// (from a recursive emitChildren() call) — "" for a leaf. Returns one
// complete, self-terminated statement either way: a bare module call
// ends in `;`, one with a children block needs none (the `}` closes it).
function attachChildScad(childPart, child, innerBlock) {
  const call = `${partModule(childPart)}(${partCallArgs(childPart, child.params)})`;
  const body = innerBlock ? ` {\n${innerBlock}\n    }` : ";";
  const overlap = overlapArg(child);
  if (child.joint === "fused") {
    return `attach("${child.slotName}", "${child.childAnchor}"${overlap}) ${call}${body}`;
  }
  const [flangeA, flangeB] = child.joint === "bolted"
    ? ["bolted_flange_a", "bolted_flange_b"]
    : ["snap_flange_a", "snap_flange_b"];
  // Two bodies: flangeA is fused to the parent (part of the parent's
  // own body), flangeB + the child (+ its own descendants) are their
  // own body (part.tag == this child's id). `overlap` applies to the
  // final placement of the child itself, not the flanges — that's the
  // join a user is actually looking at when they reach for this.
  return (
    `attach("${child.slotName}", "mount") ${flangeA}()\n` +
    `        if (part == "all" || part == "${child.id}")\n` +
    `            attach(BOTTOM, "mount") ${flangeB}()\n` +
    `                attach(BOTTOM, "${child.childAnchor}"${overlap}) ${call}${body}`
  );
}

// Every FUSED node, plus every bolted/snap flangeA half, is rigidly
// joined to whatever it's fused to, transitively up to the root — one
// body per nearest non-fused boundary. bodyTagOf() walks a node's
// ancestor chain and stops at the first bolted/snap joint (or the
// root); bodyTags() collects one tag per such boundary in the whole
// tree. This generalises "connected components restricted to fused
// edges" from a one-level tree to any depth: a bolted child two levels
// down is its own body regardless of whether anything between it and
// the root is also bolted.
export function bodyTagOf(assembly, nodeId) {
  let id = nodeId;
  while (id !== ROOT_ID) {
    const node = getNode(assembly, id);
    if (node.joint !== "fused") return node.id;
    id = node.parentId;
  }
  return ROOT_ID;
}

export function bodyTags(assembly) {
  const tags = new Set([ROOT_ID]);
  for (const n of assembly.nodes) if (n.joint !== "fused") tags.add(n.id);
  return [...tags];
}

// `partsById`: id -> catalogue entry OR imported part (see file header).
// `importedFiles` (out param, optional Map): if given, gets populated
// with path -> STL bytes (importedPart.js's precomputed `stlBytes`) for
// every imported part referenced, so the caller (Bench.jsx) can hand
// them to the render worker alongside the generated source.
export function compileToScad(assembly, partsById, importedFiles) {
  const rootPart = partsById.get(assembly.root.partId);
  const includes = new Set([`include <../vendor/BOSL2/std.scad>`]);
  const needsJoints = assembly.nodes.some((c) => c.joint !== "fused");
  if (needsJoints) includes.add(`include <../lib/joints.scad>`);

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
  const rootArgs = partCallArgs(rootPart, assembly.root.params);

  // Recurse depth-first: each node's block is the concatenation of its
  // own attach() call wrapping whatever its own children generate,
  // indented one level deeper each time.
  function emitChildren(parentId, indent) {
    return childrenOf(assembly, parentId)
      .map((child) => {
        const childPart = partsById.get(child.partId);
        const innerBlock = emitChildren(child.id, indent + "    ");
        return indent + attachChildScad(childPart, child, innerBlock);
      })
      .join("\n");
  }

  const lines = [
    ...includes,
    "",
    ...generatedModules,
    "",
    `part = "all"; // ${JSON.stringify(tags)}`,
    "",
    `if (part == "all" || part == "root")`,
    `    ${partModule(rootPart)}(${rootArgs}) {`,
    emitChildren(ROOT_ID, "        "),
    `    }`,
    "",
  ];
  return lines.join("\n");
}

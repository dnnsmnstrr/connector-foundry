// The Bench's assembly model: one root part plus children snapped onto
// its open slots (hub-and-spoke — no grandchildren in this version, see
// compileToScad()'s header comment for why that keeps this both simple
// and correct). compileToScad() generates the same nested attach()
// style lib/joints.scad's flanges and assemblies/*.scad already use, so
// output stays readable and matches house style.
//
// A part is either a catalogue entry (looked up by id, `file`+`module`
// point at real .scad) or an imported one (see importedPart.js — no
// file, geometry comes from `import()`-ing an uploaded STL, one
// generated wrapper module per import). Both are looked up through the
// same `partsById` map passed to compileToScad(); imported entries
// carry `kind: "imported"` so the codegen below can tell them apart.
let nextChildId = 1;

export function createAssembly(rootPartId, rootParams) {
  return { root: { partId: rootPartId, params: { ...rootParams } }, children: [] };
}

export function occupiedSlotNames(assembly) {
  return new Set(assembly.children.map((c) => c.slotName));
}

// `childAnchor` is which of the CHILD's own anchors touches the
// parent's slot — "mount" for every catalogue part (the only anchor
// they expose for this purpose), but a user-chosen name for an
// imported part (whichever slot they placed and picked).
export function addChild(assembly, { partId, params, slotName, joint = "fused", childAnchor = "mount" }) {
  const child = { id: `c${nextChildId++}`, partId, params: { ...params }, slotName, joint, childAnchor };
  return { ...assembly, children: [...assembly.children, child] };
}

export function removeChild(assembly, childId) {
  return { ...assembly, children: assembly.children.filter((c) => c.id !== childId) };
}

export function updateChildJoint(assembly, childId, joint) {
  return {
    ...assembly,
    children: assembly.children.map((c) => (c.id === childId ? { ...c, joint } : c)),
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
// the child's functional BOTTOM face exposed outward — exactly the
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
// anything. Confirmed this is a WASM-build resource limit, not a
// logic error: the identical generated .scad renders correctly with a
// native `openscad --backend=Manifold` install (see the CLI). A
// child hitting this shows a render error in the Bench UI rather than
// silently producing a wrong mesh — annoying, not unsafe — and
// switching that connection to "fused" always works. Fixing this for
// real means either patching/rebuilding the wasm binary or avoiding
// `rounding=` on cuboids used as bolted/snap children, neither of
// which fits in this pass.
function attachChildScad(childPart, child, bodyTag) {
  const call = `${partModule(childPart)}(${partCallArgs(childPart, child.params)})`;
  if (child.joint === "fused") {
    return `attach("${child.slotName}", "${child.childAnchor}") ${call};`;
  }
  const [flangeA, flangeB] = child.joint === "bolted"
    ? ["bolted_flange_a", "bolted_flange_b"]
    : ["snap_flange_a", "snap_flange_b"];
  // Two bodies: flangeA is fused to the root (part of the "root" body),
  // flangeB + the child are their own body (part.tag == this child's id).
  return (
    `attach("${child.slotName}", "mount") ${flangeA}()\n` +
    `        if (part == "all" || part == "${bodyTag}")\n` +
    `            attach(BOTTOM, "mount") ${flangeB}()\n` +
    `                attach(BOTTOM, "${child.childAnchor}") ${call}`
  );
}

// Every FUSED child, plus every bolted/snap flangeA half, is rigidly
// joined to the root -> one body, "root". Each bolted/snap child (with
// its flangeB half) is its own separate printable body, named after the
// child's id. That's "connected components restricted to fused edges",
// specialised to a one-level tree: this is the multi-joint
// generalisation of the two-body part="a"/"b" pattern the hand-written
// assemblies use for a single joint.
export function bodyTags(assembly) {
  return ["root", ...assembly.children.filter((c) => c.joint !== "fused").map((c) => c.id)];
}

// `partsById`: id -> catalogue entry OR imported part (see file header).
// `importedFiles` (out param, optional Map): if given, gets populated
// with path -> STL bytes (importedPart.js's precomputed `stlBytes`) for
// every imported part referenced, so the caller (Bench.jsx) can hand
// them to the render worker alongside the generated source.
export function compileToScad(assembly, partsById, importedFiles) {
  const rootPart = partsById.get(assembly.root.partId);
  const includes = new Set([`include <../vendor/BOSL2/std.scad>`]);
  const needsJoints = assembly.children.some((c) => c.joint !== "fused");
  if (needsJoints) includes.add(`include <../lib/joints.scad>`);

  const generatedModules = [];
  const allParts = [rootPart, ...assembly.children.map((c) => partsById.get(c.partId))];
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

  const childBlocks = assembly.children.map((child) => {
    const childPart = partsById.get(child.partId);
    return "        " + attachChildScad(childPart, child, child.id) +
      (child.joint !== "fused" ? ";" : "");
  });

  const lines = [
    ...includes,
    "",
    ...generatedModules,
    "",
    `part = "all"; // ${JSON.stringify(tags)}`,
    "",
    `if (part == "all" || part == "root")`,
    `    ${partModule(rootPart)}(${rootArgs}) {`,
    ...childBlocks,
    `    }`,
    "",
  ];
  return lines.join("\n");
}

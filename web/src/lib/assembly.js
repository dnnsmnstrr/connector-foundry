// The Bench's assembly model: one root part plus children snapped onto
// its open slots (hub-and-spoke — no grandchildren in this version, see
// compileToScad()'s header comment for why that keeps this both simple
// and correct). compileToScad() generates the same nested attach()
// style lib/joints.scad's flanges and assemblies/*.scad already use, so
// output stays readable and matches house style.
let nextChildId = 1;

export function createAssembly(rootPartId, rootParams) {
  return { root: { partId: rootPartId, params: { ...rootParams } }, children: [] };
}

export function occupiedSlotNames(assembly) {
  return new Set(assembly.children.map((c) => c.slotName));
}

export function addChild(assembly, { partId, params, slotName, joint = "fused" }) {
  const child = { id: `c${nextChildId++}`, partId, params: { ...params }, slotName, joint };
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

// child always attaches via its OWN "mount" anchor, not BOTTOM. BOSL2's
// attach(parent, child) rotates the child so the child anchor's
// direction is antiparallel to the parent anchor's; every mount-style
// anchor in this catalogue points UP, so using the child's "mount"
// forces the natural flip that makes ITS "mount" the touching face and
// leaves ITS functional BOTTOM face exposed outward — exactly the
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
  const args = callArgs(child.params);
  const call = `${childPart.module}(${args})`;
  if (child.joint === "fused") {
    return `attach("${child.slotName}", "mount") ${call};`;
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
    `                attach(BOTTOM, "mount") ${call}`
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

export function compileToScad(assembly, catalogueById) {
  const rootPart = catalogueById.get(assembly.root.partId);
  const includes = new Set([`include <../vendor/BOSL2/std.scad>`]);
  const needsJoints = assembly.children.some((c) => c.joint !== "fused");
  if (needsJoints) includes.add(`include <../lib/joints.scad>`);
  includes.add(`include <../${rootPart.file}>`);
  for (const child of assembly.children) {
    includes.add(`include <../${catalogueById.get(child.partId).file}>`);
  }

  const tags = bodyTags(assembly);
  const rootArgs = callArgs(assembly.root.params);

  const childBlocks = assembly.children.map((child) => {
    const childPart = catalogueById.get(child.partId);
    return "        " + attachChildScad(childPart, child, child.id) +
      (child.joint !== "fused" ? ";" : "");
  });

  const lines = [
    ...includes,
    "",
    `part = "all"; // ${JSON.stringify(tags)}`,
    "",
    `if (part == "all" || part == "root")`,
    `    ${rootPart.module}(${rootArgs}) {`,
    ...childBlocks,
    `    }`,
    "",
  ];
  return lines.join("\n");
}

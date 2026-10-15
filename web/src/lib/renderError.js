// Turning a browser render's failure into something a user can act on.
//
// A bolted/snap/pin joint nests two rounded-cuboid flanges around the
// child; openscad-wasm@0.0.4 hard-crashes with an opaque WASM trap
// once a third rounded-cuboid part (e.g. Basics plate) joins that
// chain — see assembly.js's emitJointChild() for the full story.
// The generated .scad is correct (renders fine natively); this is a
// browser-preview-only limitation, so say so instead of showing a raw
// WASM trap message.
//
// Every message the WASM thread stack running out has been seen to
// produce (see friendlyRenderError()).
export const WASM_STACK_SYMPTOMS =
  /table index|invalid index .* into funcref|memory access out of bounds|is not a function|null function|function signature mismatch|to a BigInt|Maximum call stack size exceeded/i;

/**
 * The message to show for a failed browser render: the WASM stack-limit
 * symptoms become an explanation of what to change, anything else is
 * returned as it is.
 * @param {string} message
 * @returns {string}
 */
export function friendlyRenderError(message) {
  // openscad-wasm@0.0.4 wraps every WASM export in an abort handler
  // (see node_modules/openscad-wasm/openscad.js's makeAbortWrapper());
  // when the same resource limit corrupts that export table, the
  // symptom isn't always the same string — "table index out of
  // bounds"/"memory access out of bounds" from earlier testing, but
  // "original is not a function" from a bolted joint nested one level
  // deeper (a Basics plate — itself a rounded cuboid — fused onto root,
  // then something bolted onto ONE of the plate's own further anchors:
  // that's the plate plus both bolted flanges, three rounded cuboids in
  // one attach() chain, the same limit as bolting a plate directly).
  // All of these are the one known cause, not different bugs: the WASM
  // thread stack, which gives out about 70 nested module levels down
  // (see web/README.md, "Known limit — nesting depth"). Where the
  // overflow lands decides the wording, so the list below is every
  // symptom seen while measuring it (2026-10-06) — "Cannot convert 32
  // to a BigInt" and "null function or function signature mismatch"
  // included, which an openGrid snap body attached as a child produces.
  if (WASM_STACK_SYMPTOMS.test(message)) {
    return (
      "This combination nests too deep for this browser's OpenSCAD build to preview " +
      "(a known limitation, not a bad model). An openGrid snap with its body, attached to another part, " +
      'always does: set its body to "none" to attach just the connector head. Otherwise try "fused" ' +
      "for a bolted/snap/pin joint, or fuse one of the joints in a stacked chain. The generated .scad still " +
      "renders with a native OpenSCAD install."
    );
  }
  return message;
}

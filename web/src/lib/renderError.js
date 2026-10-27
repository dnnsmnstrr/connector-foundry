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

// What a render that ran out of memory looks like. The module's linear
// memory may grow to 4 GB, so on a phone or tablet it is the browser's
// allocation limit that gives out first: growMemory() fails, malloc
// returns null, OpenSCAD's C++ throws, and the export's abort wrapper
// turns that into "Aborted(unhandled exception: …)". JavaScriptCore and
// V8 word their own allocation failures differently, hence the list.
// Checked after the stack symptoms, which own "memory access out of
// bounds".
export const WASM_MEMORY_SYMPTOMS =
  /Aborted\(unhandled exception|Aborted\(OOM|out of memory|Cannot enlarge memory|could not allocate memory|allocation failed/i;

// The browser engine's own "the thread's stack ran out" error: V8 and
// JavaScriptCore throw a RangeError reading "Maximum call stack size
// exceeded" (JavaScriptCore adds a full stop), SpiderMonkey an
// InternalError reading "too much recursion". A WASM call chain deep
// enough to exhaust the native stack ends in one of these — unlike the
// other symptoms above, which come from the WASM module's own stack
// inside its linear memory and are the same on every thread.
const NATIVE_STACK_OVERFLOW = /Maximum call stack size exceeded|too much recursion/i;

/**
 * Did a render fail because the thread it ran on has too little native
 * stack — something a thread with more of it can render?
 *
 * Safari's workers get the system's default thread stack, measured
 * 2026-10-27 at a twelfth of the main thread's (3,600 nested JS calls in
 * a worker against 45,600 on the main thread, macOS Safari and iOS 18
 * Safari alike), and JavaScriptCore's WASM frames are larger than V8's:
 * a recursive OpenSCAD module ran out at 20 levels in Safari's worker,
 * where Chromium's managed 60. A Bench assembly or a Holes model nests
 * deeper than that, as do some parts on a cold start (before the JIT
 * tiers shrink the frames), so in Safari they failed. On the main thread
 * the same render goes on until the WASM module's own stack limit (about
 * 70 levels, see web/README.md), as in Chromium's worker.
 * openscad-client.js renders such a request again there.
 * @param {string} message
 */
export function isNativeStackOverflow(message) {
  return NATIVE_STACK_OVERFLOW.test(message);
}

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
  if (WASM_MEMORY_SYMPTOMS.test(message)) {
    return (
      "The browser most likely ran out of memory while OpenSCAD rendered this (a phone or tablet " +
      "has far less than a computer). Close other tabs or apps and try again, try a smaller size or " +
      "fewer parts, or download the .scad and render it with a native OpenSCAD install."
    );
  }
  return message;
}

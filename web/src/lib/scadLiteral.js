// The one OpenSCAD-literal formatter for everywhere the web app writes
// .scad source or -D flags: assembly.js's codegen and the render worker
// both used to carry their own copy. Mirrors cli/foundry.py's
// openscad_value(), so a parameter value round-trips to the same text
// whichever side renders it.
//
// Every value that reaches this file may have come from outside the app
// (a config file, a #bench= link, an imported settings backup), so
// nothing it emits may be able to end a literal early or smuggle in
// source of its own: anything without a faithful literal throws instead
// of being turned into text.
//
// Strings go through JSON.stringify: OpenSCAD's string escapes (\" and
// \\) are JSON's, so a value containing a quote arrives intact instead
// of ending the literal early. JSON's other escapes are not all
// OpenSCAD's, though — OpenSCAD reads \n, \t and \r, but not \b, \f or
// \u0001-style control escapes, and a lone surrogate's \udXXX names no
// character at all — so those characters are dropped (or, for a lone
// surrogate, replaced) before stringify sees them. None of them can mean
// anything in a part name, anchor name or parameter value.
export function scadLiteral(value) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(scadSafeText(value));
  if (Array.isArray(value)) return `[${value.map(scadLiteral).join(", ")}]`;
  if (typeof value === "number") {
    // NaN/Infinity have no literal; OpenSCAD would read the text as an
    // unknown variable and silently carry on with undef.
    if (!Number.isFinite(value)) throw new Error(`Cannot pass ${value} to OpenSCAD`);
    return String(value);
  }
  if (value === null || value === undefined) return "undef";
  // A plain object used to come out as "[object Object]" — an unknown
  // variable to OpenSCAD, so undef again, silently.
  throw new Error(
    `Cannot pass a ${typeof value === "object" ? "structured value" : typeof value} to OpenSCAD`,
  );
}

// C0 controls other than \t \n \r, and DEL: the characters JSON.stringify
// would escape in a way OpenSCAD's lexer doesn't read (see scadLiteral()).
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNESCAPABLE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

// `text` with every character OpenSCAD can't take in a string literal
// gone — also what a // comment can safely carry once its line breaks
// are replaced (see assembly.js's emitCropped()).
export function scadSafeText(text) {
  return text.replace(UNESCAPABLE_CONTROL, "").replace(LONE_SURROGATE, "�");
}

// An OpenSCAD identifier: what a parameter name may be. `$` is allowed
// anywhere because special variables ($fn, $fa) are parameters too.
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// A parameter name goes into the source verbatim (`name=value`), so one
// that isn't an identifier could carry code of its own — `x=1);evil(` —
// and is refused rather than escaped (an identifier has no escapes).
export function scadIdentifier(name) {
  if (typeof name !== "string" || !IDENTIFIER.test(name)) {
    throw new Error(`${JSON.stringify(String(name))} isn't a valid OpenSCAD parameter name`);
  }
  return name;
}

// `a=1, b="x"` — the argument list of a module call.
export function callArgs(params) {
  return Object.entries(params || {})
    .map(([key, value]) => `${scadIdentifier(key)}=${scadLiteral(value)}`)
    .join(", ");
}

// ["-D", "a=1", "-D", "b=\"x\""] — command-line overrides, which OpenSCAD
// honours over a plain top-level assignment even when that assignment
// came from an included file (same mechanism cli/foundry.py's
// run_openscad() uses).
export function defineArgs(overrides) {
  const args = [];
  for (const [key, value] of Object.entries(overrides || {})) {
    args.push("-D", `${scadIdentifier(key)}=${scadLiteral(value)}`);
  }
  return args;
}

// The one OpenSCAD-literal formatter for everywhere the web app writes
// .scad source or -D flags: assembly.js's codegen and the render worker
// both used to carry their own copy. Mirrors cli/foundry.py's
// openscad_value(), so a parameter value round-trips to the same text
// whichever side renders it.
//
// Strings go through JSON.stringify: OpenSCAD's string escapes (\" and
// \\) are JSON's, so a value containing a quote arrives intact instead
// of ending the literal early.
export function scadLiteral(value) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(scadLiteral).join(", ")}]`;
  if (typeof value === "number") {
    // NaN/Infinity have no literal; OpenSCAD would read the text as an
    // unknown variable and silently carry on with undef.
    if (!Number.isFinite(value)) throw new Error(`Cannot pass ${value} to OpenSCAD`);
    return String(value);
  }
  if (value === null || value === undefined) return "undef";
  return String(value);
}

// `a=1, b="x"` — the argument list of a module call.
export function callArgs(params) {
  return Object.entries(params || {})
    .map(([key, value]) => `${key}=${scadLiteral(value)}`)
    .join(", ");
}

// ["-D", "a=1", "-D", "b=\"x\""] — command-line overrides, which OpenSCAD
// honours over a plain top-level assignment even when that assignment
// came from an included file (same mechanism cli/foundry.py's
// run_openscad() uses).
export function defineArgs(overrides) {
  const args = [];
  for (const [key, value] of Object.entries(overrides || {})) {
    args.push("-D", `${key}=${scadLiteral(value)}`);
  }
  return args;
}

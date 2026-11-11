// Include-once for a render's OpenSCAD sources.
//
// OpenSCAD's `include <file>` is textual and has no include guard: every
// statement lexes and parses its file again. The sources here include
// defensively (a part includes BOSL2's std.scad, then lib/slots.scad and
// lib/util.scad, which each include it again so they work on their own),
// so a plain plate parsed BOSL2's 1.1 MB nearly three times: 293 ms of
// callMain() in Node where one parse is 111 ms, and a Bench assembly
// paid that again for every part in it (a plate with a GoPro mount
// evaluated in 806 ms, 164 ms with each file included once). That was
// most of the wait for a simple part, on a phone several times over.
//
// includeOnce() rewrites the sources of one render so that each file is
// included once per translation unit: the main file with everything it
// includes, and each `use`d file with everything *it* includes (a `use`d
// file is parsed on its own, and sees none of its user's includes). A
// repeated `include` is deleted; a file that had one deleted is written
// as a copy beside the original (`slots.scad` -> `slots.once1.scad`, the
// same directory, so its relative paths and import()s resolve as
// before), and the statements that reach it are pointed at the copy. The
// originals stay as they are.
//
// Why that changes nothing: including a file twice defines the same
// functions and modules twice and repeats the same assignments, and
// OpenSCAD evaluates a repeated assignment where the first one stands.
// The one case that differs is a name defined in two *different* files
// with the second file's definition sitting between two inclusions of
// the first (the repeat would win it back). web/tests/unit/
// scad-includes.test.js reads every catalogue part's sources for that
// pattern. When this went in, the CSG tree OpenSCAD evaluates (-o
// x.csg) was the same text with and without it for all 156 catalogue
// parts and variants and for a dozen Bench and Holes sources. Meshes are
// no test of it: Manifold's output for a few parts differs between two
// runs that differ only in what was allocated before.

// What the scanner steps over or stops at, in the order OpenSCAD's lexer
// would take them: comments and strings (an "include <" inside either is
// text), an include or use statement, any other identifier (so that
// `myinclude <x>` is not a statement).
const TOKEN =
  /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\[\s\S])*"|(include|use)[ \t\r\n]*<([^>\n]*)>|[A-Za-z_$][A-Za-z0-9_$]*/g;

/**
 * @typedef {{ kind: "include" | "use", start: number, end: number, target: string }} IncludeStatement
 * `start` and `end` are the statement's character range in the source.
 */

/**
 * The include and use statements of an OpenSCAD source, in order.
 * @param {string} source
 * @returns {IncludeStatement[]}
 */
export function scanIncludes(source) {
  /** @type {IncludeStatement[]} */
  const found = [];
  // Most files have none; skip the scan for those.
  if (!source.includes("<")) return found;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(source); m; m = TOKEN.exec(source)) {
    if (!m[1]) continue;
    found.push({
      kind: /** @type {"include" | "use"} */ (m[1]),
      start: m.index,
      end: m.index + m[0].length,
      target: m[2],
    });
  }
  return found;
}

/**
 * The absolute path an include's target names, from the file that holds
 * the statement: OpenSCAD looks beside that file first, and takes an
 * absolute target as it is.
 * @param {string} fromPath absolute path of the including file
 * @param {string} target
 */
export function resolveInclude(fromPath, target) {
  const base = target.startsWith("/") ? [] : fromPath.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") base.pop();
    else base.push(part);
  }
  return "/" + base.filter(Boolean).join("/");
}

// `dir/name.scad` -> `dir/name.once<n>.scad`, for a path or an include's
// target alike: only the last segment changes.
function copyName(path, n) {
  const slash = path.lastIndexOf("/") + 1;
  const name = path.slice(slash);
  const dot = name.lastIndexOf(".");
  const renamed = dot > 0 ? `${name.slice(0, dot)}.once${n}${name.slice(dot)}` : `${name}.once${n}`;
  return path.slice(0, slash) + renamed;
}

/**
 * A message from OpenSCAD with the copies' names turned back into the
 * files they copy (`slots.once1.scad` -> `slots.scad`), for the console.
 * @param {string} text
 */
export function withoutCopyNames(text) {
  return text.replace(/\.once\d+(?=\.scad\b)/g, "");
}

/**
 * @typedef {{
 *   paths: Set<string>,
 *   withStatements: Map<string, { source: string, statements: IncludeStatement[] }>,
 * }} IncludeIndex
 */

/**
 * Scans a set of sources once (the bundle, when a thread first loads
 * it), for every later includeOnce(): which paths exist, and the text
 * and statements of the files that have any.
 * @param {Iterable<[string, string]>} files [absolute path, source] pairs
 * @returns {IncludeIndex}
 */
export function indexIncludes(files) {
  /** @type {IncludeIndex} */
  const index = { paths: new Set(), withStatements: new Map() };
  for (const [path, source] of files) {
    index.paths.add(path);
    const statements = scanIncludes(source);
    if (statements.length) index.withStatements.set(path, { source, statements });
  }
  return index;
}

/**
 * Rewrites one render's main source so that every file is included once
 * per translation unit (see the header). A statement whose file is not in
 * the index is left alone.
 * @param {IncludeIndex} index the mounted sources
 * @param {string} mainPath absolute path the main source is written to
 * @param {string} mainSource
 * @returns {{ main: string, copies: [string, string][] }} the main source
 *   to write instead, and the [path, source] copies to write beside the
 *   mounted files
 */
export function includeOnce(index, mainPath, mainSource) {
  /** @type {Map<string, string>} */
  const copies = new Map();
  // A `use`d file's rewrite depends on nothing but the file, so one copy
  // serves every statement that uses it: path -> its copy's path, or null
  // for a file that needed no change.
  /** @type {Map<string, string | null>} */
  const usedUnits = new Map();
  let nextCopy = 1;
  let collided = false;

  // Adds the changed source as a copy and returns the number in its name.
  const addCopy = (path, source) => {
    const n = nextCopy++;
    const copyPath = copyName(path, n);
    if (index.paths.has(copyPath) || copies.has(copyPath)) collided = true;
    copies.set(copyPath, source);
    return n;
  };

  /**
   * The source of one file with its repeated includes deleted and its
   * changed targets renamed; `visited` holds the files its unit has
   * included so far.
   * @param {string} path
   * @param {string} source
   * @param {IncludeStatement[]} statements
   * @param {Set<string>} visited
   */
  const rewrite = (path, source, statements, visited) => {
    let out = "";
    let from = 0;
    const replace = (/** @type {IncludeStatement} */ st, /** @type {string} */ text) => {
      out += source.slice(from, st.start) + text;
      from = st.end;
    };
    for (const st of statements) {
      const target = resolveInclude(path, st.target);
      if (!index.paths.has(target)) continue;
      const entry = index.withStatements.get(target);
      if (st.kind === "use") {
        if (!entry) continue;
        let copyPath = usedUnits.get(target);
        if (copyPath === undefined) {
          // Marked before its own rewrite, so a file that uses itself (or
          // a cycle of them) ends instead of recursing.
          usedUnits.set(target, null);
          const rewritten = rewrite(target, entry.source, entry.statements, new Set([target]));
          copyPath = rewritten === entry.source ? null : copyName(target, addCopy(target, rewritten));
          usedUnits.set(target, copyPath);
        }
        if (copyPath) {
          const name = copyPath.slice(copyPath.lastIndexOf("/") + 1);
          replace(st, `use <${st.target.slice(0, st.target.lastIndexOf("/") + 1)}${name}>`);
        }
        continue;
      }
      if (visited.has(target)) {
        replace(st, "");
        continue;
      }
      visited.add(target);
      if (!entry) continue;
      const rewritten = rewrite(target, entry.source, entry.statements, visited);
      if (rewritten !== entry.source) {
        replace(st, `include <${copyName(st.target, addCopy(target, rewritten))}>`);
      }
    }
    return from === 0 ? source : out + source.slice(from);
  };

  const main = rewrite(mainPath, mainSource, scanIncludes(mainSource), new Set([mainPath]));
  // A file already named like a copy: leave the render as it was rather
  // than overwrite a source.
  if (collided) return { main: mainSource, copies: [] };
  return { main, copies: [...copies] };
}

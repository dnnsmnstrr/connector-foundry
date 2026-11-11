import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

import { REPO_ROOT, SOURCE_DIRS } from "../../scripts/sync-scad.mjs";
import { addChild, compileToScad, createAssembly } from "../../src/lib/assembly.js";
import {
  includeOnce,
  indexIncludes,
  resolveInclude,
  scanIncludes,
  withoutCopyNames,
} from "../../src/lib/scadIncludes.js";

// A small tree shaped like the real one: a part that includes the big
// library, then two lib files that each include it again, and a `use`d
// file with includes of its own.
const FILES = new Map([
  ["/repo/vendor/B/std.scad", "include <a.scad>\ninclude <b.scad>\n"],
  ["/repo/vendor/B/a.scad", "function a() = 1;\n"],
  ["/repo/vendor/B/b.scad", "function b() = a();\n"],
  ["/repo/lib/constants.scad", "X = 1;\n"],
  ["/repo/lib/slots.scad", "include <../vendor/B/std.scad>\ninclude <constants.scad>\nmodule slot() {}\n"],
  ["/repo/lib/used.scad", "include <../vendor/B/std.scad>\ninclude <slots.scad>\nmodule used() {}\n"],
  [
    "/repo/parts/p.scad",
    [
      "include <../vendor/B/std.scad>",
      "include <../lib/constants.scad>",
      "include <../lib/slots.scad>",
      "use <../lib/used.scad>",
      "module p() {}",
      "",
    ].join("\n"),
  ],
]);
const MAIN = "include </repo/parts/p.scad>\np();\n";

// OpenSCAD's own reading of a file set, for checking a rewrite against:
// the files each translation unit includes, in order, repeats and all
// (the main file's unit under "main", each `use`d file's under its path).
function unitsOf(files, mainPath, mainSource) {
  const units = new Map();
  const walk = (unit, filePath, source) => {
    for (const st of scanIncludes(source)) {
      const target = resolveInclude(filePath, st.target);
      if (!files.has(target)) continue;
      if (st.kind === "use") {
        if (!units.has(target)) {
          units.set(target, []);
          walk(target, target, files.get(target));
        }
        continue;
      }
      units.get(unit).push(target);
      walk(unit, target, files.get(target));
    }
  };
  units.set("main", []);
  walk("main", mainPath, mainSource);
  return units;
}

// The files of a tree with a rewrite's copies added.
function withCopies(files, copies) {
  return new Map([...files, ...copies]);
}

const original = (p) => withoutCopyNames(p);

test("scanIncludes finds include and use statements, and only those", () => {
  const source = [
    "include <a.scad>",
    "use  <dir/b.scad>",
    "include\n<c.scad>",
    "// include <commented.scad>",
    "/* use <blocked.scad>\n   include <blocked2.scad> */",
    'x = "include <quoted.scad>";',
    'y = "a \\" include <escaped.scad>";',
    "myinclude <not.scad>;",
    "includes = 1 < 2 && 3 > 2;",
    "z = a < b; include <d.scad>",
  ].join("\n");
  assert.deepEqual(
    scanIncludes(source).map((s) => [s.kind, s.target]),
    [
      ["include", "a.scad"],
      ["use", "dir/b.scad"],
      ["include", "c.scad"],
      ["include", "d.scad"],
    ],
  );
  const [first] = scanIncludes(source);
  assert.equal(source.slice(first.start, first.end), "include <a.scad>");
  assert.deepEqual(scanIncludes("cube(1);"), []);
});

test("resolveInclude looks beside the including file, and takes an absolute path as it is", () => {
  assert.equal(
    resolveInclude("/repo/parts/basics/plate.scad", "../../vendor/BOSL2/std.scad"),
    "/repo/vendor/BOSL2/std.scad",
  );
  assert.equal(resolveInclude("/repo/lib/slots.scad", "constants.scad"), "/repo/lib/constants.scad");
  assert.equal(resolveInclude("/repo/lib/slots.scad", "./sub/x.scad"), "/repo/lib/sub/x.scad");
  assert.equal(resolveInclude("/main.scad", "/repo/parts/p.scad"), "/repo/parts/p.scad");
});

test("a repeated include is deleted, in a copy beside the file that held it", () => {
  const { main, copies } = includeOnce(indexIncludes(FILES), "/main.scad", MAIN);
  const byPath = new Map(copies);
  assert.equal(main, "include </repo/parts/p.once4.scad>\np();\n");
  assert.deepEqual([...byPath.keys()].sort(), [
    "/repo/lib/slots.once1.scad",
    "/repo/lib/slots.once2.scad",
    "/repo/lib/used.once3.scad",
    "/repo/parts/p.once4.scad",
  ]);
  // The main unit's slots.scad: both of its includes were repeats. Its
  // line count is the original's, so a message's line number still fits.
  assert.equal(byPath.get("/repo/lib/slots.once1.scad"), "\n\nmodule slot() {}\n");
  assert.equal(
    byPath.get("/repo/parts/p.once4.scad"),
    [
      "include <../vendor/B/std.scad>",
      "include <../lib/constants.scad>",
      "include <../lib/slots.once1.scad>",
      "use <../lib/used.once3.scad>",
      "module p() {}",
      "",
    ].join("\n"),
  );
});

test("a use'd file is a unit of its own: it keeps the includes its user also has", () => {
  const byPath = new Map(includeOnce(indexIncludes(FILES), "/main.scad", MAIN).copies);
  // used.scad sees none of p.scad's includes, so its first std.scad
  // stays; the slots.scad it includes loses std.scad but keeps
  // constants.scad, which this unit had not included yet.
  assert.equal(
    byPath.get("/repo/lib/used.once3.scad"),
    "include <../vendor/B/std.scad>\ninclude <slots.once2.scad>\nmodule used() {}\n",
  );
  assert.equal(byPath.get("/repo/lib/slots.once2.scad"), "\ninclude <constants.scad>\nmodule slot() {}\n");
});

test("after the rewrite every unit includes the same files, each of them once", () => {
  const before = unitsOf(FILES, "/main.scad", MAIN);
  const { main, copies } = includeOnce(indexIncludes(FILES), "/main.scad", MAIN);
  const after = unitsOf(withCopies(FILES, copies), "/main.scad", main);
  // p, std (a, b), constants, slots (std (a, b) again, constants again).
  assert.equal(before.get("main").length, 10);
  assert.deepEqual(after.get("main").map(original), [...new Set(before.get("main"))]);
  assert.deepEqual(after.get("/repo/lib/used.once3.scad").map(original), [
    ...new Set(before.get("/repo/lib/used.scad")),
  ]);
});

test("a source with nothing repeated comes back as it was", () => {
  const source = "include </repo/lib/constants.scad>\ninclude </repo/vendor/B/std.scad>\ncube(X);\n";
  assert.deepEqual(includeOnce(indexIncludes(FILES), "/main.scad", source), { main: source, copies: [] });
});

test("a file the index does not have is left alone, however often it is included", () => {
  const source = "include <missing.scad>\ninclude <missing.scad>\nuse <gone.scad>\n";
  assert.deepEqual(includeOnce(indexIncludes(FILES), "/main.scad", source), { main: source, copies: [] });
});

test("the main file's own repeats go without a copy", () => {
  const source = "include </repo/lib/constants.scad>\nX = 2;\ninclude </repo/lib/constants.scad>\n";
  assert.deepEqual(includeOnce(indexIncludes(FILES), "/main.scad", source), {
    main: "include </repo/lib/constants.scad>\nX = 2;\n\n",
    copies: [],
  });
});

test("files that include or use each other in a circle end", () => {
  const files = new Map([
    ["/r/a.scad", "include <b.scad>\nuse <c.scad>\n"],
    ["/r/b.scad", "include <a.scad>\n"],
    ["/r/c.scad", "use <c.scad>\ninclude <a.scad>\n"],
  ]);
  const { main, copies } = includeOnce(indexIncludes(files), "/main.scad", "include </r/a.scad>\n");
  assert.match(main, /^include <\/r\/a\.once\d+\.scad>\n$/);
  // b.scad's include of a.scad, which is where it came from, is gone.
  assert.ok(copies.some(([p, source]) => original(p) === "/r/b.scad" && source === "\n"));
});

test("a file already named like a copy stops the rewrite rather than be overwritten", () => {
  const files = new Map([...FILES, ["/repo/lib/slots.once1.scad", "module mine() {}\n"]]);
  assert.deepEqual(includeOnce(indexIncludes(files), "/main.scad", MAIN), { main: MAIN, copies: [] });
});

test("withoutCopyNames gives a message its source file back", () => {
  assert.equal(
    withoutCopyNames("WARNING: bad in file /repo/parts/../lib/slots.once12.scad, line 4"),
    "WARNING: bad in file /repo/parts/../lib/slots.scad, line 4",
  );
  assert.equal(withoutCopyNames("ERROR: once1 is not a file"), "ERROR: once1 is not a file");
});

// --- The real sources ---------------------------------------------------
//
// Including a file once instead of several times gives the same model
// unless a name is defined in two different files and the repeat is what
// decides which definition wins: OpenSCAD keeps the last definition of a
// function or module and the last assignment of a variable, so in
//   include <constants.scad>   // X = 1
//   include <mine.scad>        // X = 2
//   include <slots.scad>       // includes constants.scad again: X = 1
// X is 1 natively and would be 2 with the repeat removed. The check below
// reads every catalogue part (and a Bench assembly) the way OpenSCAD
// does, with and without include-once, and compares which file each
// top-level name ends up coming from. A failure here means the browser
// would render that part differently from the CLI: reorder the includes
// (the override last) rather than loosen the check.

// The functions, modules and variables a file defines at its top level,
// in order, interleaved with its include and use statements.
function topLevelEvents(source) {
  const events = [];
  const token =
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\[\s\S])*"|(include|use)[ \t\r\n]*<([^>\n]*)>|([A-Za-z_$][A-Za-z0-9_$]*)|([{}()[\];])|=(?!=)|\S/g;
  let depth = 0;
  // At the start of a statement; `pending` is the identifier that began it.
  let atStart = true;
  let pending = null;
  let keyword = null;
  for (let m = token.exec(source); m; m = token.exec(source)) {
    const [text, kind, target, ident, bracket] = m;
    if (text.startsWith("//") || text.startsWith("/*")) continue;
    if (kind) {
      events.push({ kind, target });
      atStart = depth === 0;
      continue;
    }
    if (bracket) {
      if ("{([".includes(bracket)) depth++;
      else if ("})]".includes(bracket)) depth = Math.max(0, depth - 1);
      atStart = depth === 0 && (bracket === ";" || bracket === "}");
      pending = null;
      keyword = null;
      continue;
    }
    if (depth !== 0) continue;
    if (ident) {
      if (keyword) {
        events.push({ kind: "def", name: `${keyword} ${ident}` });
        keyword = null;
      } else if (atStart && (ident === "function" || ident === "module")) keyword = ident;
      else if (atStart) pending = ident;
      atStart = false;
      continue;
    }
    if (text === "=" && pending) events.push({ kind: "def", name: `variable ${pending}` });
    pending = null;
    atStart = false;
  }
  return events;
}

// Which file each top-level name comes from in every translation unit of
// a main source, read the way OpenSCAD does (`once`: each file included
// once per unit, as the rewrite leaves it).
function winners(files, eventsOf, mainPath, mainSource, once) {
  const units = new Map();
  const walk = (unit, filePath, events, visited) => {
    for (const event of events) {
      if (event.kind === "def") {
        units.get(unit).set(event.name, filePath);
        continue;
      }
      const target = resolveInclude(filePath, event.target);
      if (!files.has(target)) continue;
      if (event.kind === "use") {
        if (units.has(target)) continue;
        units.set(target, new Map());
        walk(target, target, eventsOf(target), new Set([target]));
        continue;
      }
      if (once && visited.has(target)) continue;
      visited.add(target);
      walk(unit, target, eventsOf(target), visited);
    }
  };
  units.set("main", new Map());
  walk("main", mainPath, topLevelEvents(mainSource), new Set([mainPath]));
  return units;
}

function scadFiles(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) scadFiles(full, out);
    else if (entry.name.endsWith(".scad")) out.push(full);
  }
  return out;
}

// The repository's sources at the paths the render mounts them at.
function repoSources() {
  const files = new Map();
  for (const dir of SOURCE_DIRS) {
    for (const file of scadFiles(path.join(REPO_ROOT, dir), [])) {
      const rel = path.relative(REPO_ROOT, file).split(path.sep).join("/");
      files.set(`/repo/${rel}`, fs.readFileSync(file, "utf8"));
    }
  }
  return files;
}

test("topLevelEvents reads definitions at the top level only", () => {
  const source = [
    "include <a.scad>",
    "X = 1; $fn = 32;",
    "function f(a = 1, b = [1, 2]) = a == b ? 1 : 2;",
    "module m(size = 3) { y = 2; cube(size = y); }",
    "m(size = X);",
    "if (X == 1) cube(1);",
    'Z = "W = 3;"; // V = 4;',
  ].join("\n");
  assert.deepEqual(
    topLevelEvents(source).map((e) => e.name ?? `${e.kind} ${e.target}`),
    ["include a.scad", "variable X", "variable $fn", "function f", "module m", "variable Z"],
  );
});

test("the check sees a repeated include that decides which definition wins", () => {
  const files = new Map([
    ["/r/constants.scad", "X = 1;\nfunction f() = 1;\n"],
    ["/r/mine.scad", "X = 2;\n"],
    ["/r/slots.scad", "include <constants.scad>\n"],
  ]);
  const eventsOf = (file) => topLevelEvents(files.get(file));
  const source = "include </r/constants.scad>\ninclude </r/mine.scad>\ninclude </r/slots.scad>\n";
  const native = winners(files, eventsOf, "/main.scad", source, false).get("main");
  const once = winners(files, eventsOf, "/main.scad", source, true).get("main");
  assert.equal(native.get("variable X"), "/r/constants.scad");
  assert.equal(once.get("variable X"), "/r/mine.scad");
  assert.equal(once.get("function f"), native.get("function f"));
});

test("include-once leaves every catalogue part's definitions coming from the same files", (t) => {
  // BOSL2 is a submodule: a fresh worktree has none (AGENTS.md, "Setup").
  if (!fs.existsSync(path.join(REPO_ROOT, "vendor", "BOSL2", "std.scad"))) {
    t.skip("vendor/BOSL2 is not checked out");
    return;
  }
  const files = repoSources();
  const index = indexIncludes(files);
  const events = new Map();
  const eventsOf = (file) => {
    if (!events.has(file)) events.set(file, topLevelEvents(files.get(file)));
    return events.get(file);
  };
  const { parts } = /** @type {{ parts: any[] }} */ (
    yaml.load(fs.readFileSync(path.join(REPO_ROOT, "catalogue.yaml"), "utf8"))
  );
  const partsById = new Map(parts.map((p) => [p.id, p]));
  let assembly = createAssembly("basics/plate", {});
  assembly = addChild(assembly, { parentId: "root", partId: "gopro/male", params: {}, slotName: "mount" });
  assembly = addChild(assembly, {
    parentId: "root",
    partId: "basics/post",
    params: {},
    slotName: "bot",
    joint: "bolted",
  });
  const sources = [
    ...parts.map((part) => ["/main.scad", `include </repo/${part.file}>\n${part.module}();\n`, part.id]),
    ["/repo/assemblies/_bench.scad", compileToScad(assembly, partsById, new Map()), "a Bench assembly"],
  ];

  let removed = 0;
  for (const [mainPath, source, label] of sources) {
    const native = winners(files, eventsOf, mainPath, source, false);
    const once = winners(files, eventsOf, mainPath, source, true);
    assert.deepEqual([...once.keys()], [...native.keys()], `${label}: the same units`);
    for (const [unit, names] of native) {
      for (const [name, file] of names) {
        assert.equal(
          once.get(unit).get(name),
          file,
          `${label}: ${name} would come from another file with each file included once (unit ${unit})`,
        );
      }
    }
    // And the rewrite does what the model of it above assumes: the same
    // files in every unit, each of them once.
    const before = unitsOf(files, mainPath, source);
    const rewritten = includeOnce(index, mainPath, source);
    const after = unitsOf(withCopies(files, rewritten.copies), mainPath, rewritten.main);
    assert.deepEqual(
      [...after.keys()].map(original),
      [...before.keys()],
      `${label}: units after the rewrite`,
    );
    for (const [unit, list] of after) {
      const unitBefore = before.get(unit === "main" ? unit : original(unit));
      assert.deepEqual(list.map(original), [...new Set(unitBefore)], `${label}: ${unit}`);
      removed += unitBefore.length - list.length;
    }
  }
  // Not a no-op: the sources do repeat their includes (a plate's main
  // unit names BOSL2's thirty-odd files three times over).
  assert.ok(removed > 1000, `only ${removed} repeated includes removed`);
});

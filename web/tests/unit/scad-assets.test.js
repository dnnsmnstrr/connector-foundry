// The bundle's binary assets (the DeckMate and KLIPPT meshes) are a file
// of their own, scad-assets.json, which a render fetches only when its
// include closure reaches a file sync-scad.mjs listed as an importer
// (src/lib/openscadRun.js). A part whose closure import()s a mesh but
// reaches no listed importer would render in the browser with the mesh
// missing — OpenSCAD only warns about an import() it cannot open, and
// draws nothing in its place — so this reads every catalogue part, and
// the Holes sockets cut from those meshes, the way a render does.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

import { REPO_ROOT, collect } from "../../scripts/sync-scad.mjs";
import { indexIncludes, reachableFiles } from "../../src/lib/scadIncludes.js";

const BOSL2 = path.join(REPO_ROOT, "vendor", "BOSL2", "std.scad");
// Any import() of an .stl, comments included: deliberately wider than
// sync-scad's own reading, so the two are not the same code checking
// itself.
const MENTIONS_STL = /import\s*\(\s*(?:file\s*=\s*)?"[^"]*\.stl"/i;

function bundle() {
  const { files, assets, importers } = collect();
  const sources = Object.entries(files).map(([rel, source]) => [`/repo/${rel}`, source]);
  return {
    files: new Map(/** @type {[string, string][]} */ (sources)),
    index: indexIncludes(/** @type {[string, string][]} */ (sources)),
    assets,
    importers: new Set(importers.map((rel) => `/repo/${rel}`)),
  };
}

test("reachableFiles follows include and use, transitively, and stops at a cycle", () => {
  const files = /** @type {[string, string][]} */ ([
    ["/repo/a.scad", "include <b.scad>\n"],
    ["/repo/b.scad", "use <c.scad>\n"],
    ["/repo/c.scad", "include <a.scad>\n"],
    ["/repo/d.scad", "cube(1);\n"],
  ]);
  const reached = reachableFiles(indexIncludes(files), "/main.scad", "include </repo/a.scad>\n");
  assert.deepEqual([...reached].sort(), ["/repo/a.scad", "/repo/b.scad", "/repo/c.scad"]);
});

test("every render that import()s a mesh reaches an importer, and the others reach none", (t) => {
  if (!fs.existsSync(BOSL2)) {
    t.skip("vendor/BOSL2 is not checked out");
    return;
  }
  const { files, index, assets, importers } = bundle();
  assert.ok(Object.keys(assets).length > 0, "the bundle has assets");
  for (const file of importers) assert.ok(files.has(file), `${file} is bundled`);

  const { parts } = /** @type {{ parts: any[] }} */ (
    yaml.load(fs.readFileSync(path.join(REPO_ROOT, "catalogue.yaml"), "utf8"))
  );
  const sources = [
    ...parts.map((part) => ["/main.scad", `include </repo/${part.file}>\n${part.module}();\n`, part.id]),
    // A Holes render's sockets (screwHoles.js's holesToScad()).
    ["/repo/assemblies/_bench.scad", "use <../lib/klippt.scad>\n", "a Holes KLIPPT channel"],
    ["/repo/assemblies/_bench.scad", "use <../lib/deckmate.scad>\n", "a Holes DeckMate socket"],
  ];
  let needing = 0;
  for (const [mainPath, source, label] of sources) {
    const reached = reachableFiles(index, mainPath, source);
    const needsMesh = [...reached].some((file) => MENTIONS_STL.test(files.get(file) ?? ""));
    const fetches = [...reached].some((file) => importers.has(file));
    assert.equal(fetches, needsMesh, `${label}: fetches the assets ${fetches}, imports a mesh ${needsMesh}`);
    if (needsMesh) needing++;
  }
  // Most parts render without them, which is the point of the split.
  assert.ok(needing > 0 && needing < parts.length / 2, `${needing} of ${sources.length} need the assets`);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  MAX_SLICER_BYTES,
  STALE_TEMP_MS,
  TEMP_FOLDER,
  checkSlicerBytes,
  findInstalledSlicer,
  openModelInSlicer,
  pruneStaleTempDirs,
  sanitizeSlicerFilename,
} = require("../../desktop/slicer.cjs");

test("sanitizeSlicerFilename keeps a clean .3mf or .stl basename and refuses other extensions", () => {
  assert.equal(sanitizeSlicerFilename("gridfinity_bin.3mf"), "gridfinity_bin.3mf");
  assert.equal(sanitizeSlicerFilename("Flat-plate_holes.STL"), "Flat-plate_holes.stl");
  assert.equal(sanitizeSlicerFilename("../nested/dir/bench:part?.3mf"), "bench-part.3mf");
  assert.equal(sanitizeSlicerFilename("C:\\Users\\me\\Downloads\\part.stl"), "part.stl");
  assert.equal(sanitizeSlicerFilename("....3mf"), "model.3mf");

  for (const bad of ["", "   ", null, 42, "part.scad", "part.exe", "part", ".3mf"]) {
    assert.throws(() => sanitizeSlicerFilename(bad));
  }
});

test("checkSlicerBytes accepts Buffer, Uint8Array and ArrayBuffer and rejects empty or oversized payloads", () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  assert.deepEqual([...checkSlicerBytes(bytes)], [1, 2, 3, 4]);
  assert.deepEqual([...checkSlicerBytes(bytes.buffer)], [1, 2, 3, 4]);
  assert.deepEqual([...checkSlicerBytes(Buffer.from([9, 8]))], [9, 8]);

  assert.throws(() => checkSlicerBytes(new Uint8Array(0)), /no model geometry/);
  assert.throws(() => checkSlicerBytes(null), /no model geometry/);
  assert.throws(() => checkSlicerBytes({ byteLength: MAX_SLICER_BYTES + 1 }), /no model geometry/);
});

test("findInstalledSlicer checks standard macOS, Windows and Linux locations in priority order", () => {
  const macFound = findInstalledSlicer({
    platform: "darwin",
    homedir: "/Users/alice",
    existsSync: (p) => p === "/Users/alice/Applications/PrusaSlicer.app",
  });
  assert.deepEqual(macFound, {
    name: "PrusaSlicer",
    target: "/Users/alice/Applications/PrusaSlicer.app",
    kind: "mac-app",
  });

  const winFound = findInstalledSlicer({
    platform: "win32",
    env: {
      ProgramFiles: "C:\\Program Files",
      LOCALAPPDATA: "C:\\Users\\alice\\AppData\\Local",
    },
    existsSync: (p) => p === "C:\\Users\\alice\\AppData\\Local\\Programs\\OrcaSlicer\\orca-slicer.exe",
  });
  assert.deepEqual(winFound, {
    name: "OrcaSlicer",
    target: "C:\\Users\\alice\\AppData\\Local\\Programs\\OrcaSlicer\\orca-slicer.exe",
    kind: "binary",
  });

  const linuxFound = findInstalledSlicer({
    platform: "linux",
    env: { PATH: `/usr/local/bin${path.delimiter}/usr/bin` },
    existsSync: (p) => p === path.join("/usr/bin", "bambu-studio"),
  });
  assert.deepEqual(linuxFound, {
    name: "Bambu Studio",
    target: path.join("/usr/bin", "bambu-studio"),
    kind: "binary",
  });

  assert.equal(
    findInstalledSlicer({
      platform: "darwin",
      homedir: "/Users/alice",
      existsSync: () => false,
    }),
    null,
  );
});

test("openModelInSlicer writes the model into a fresh temp directory, prunes stale ones, and opens it", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cf-slicer-test-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const baseDir = path.join(tempRoot, TEMP_FOLDER);
  const staleDir = path.join(baseDir, "old-run");
  const recentDir = path.join(baseDir, "recent-run");
  fs.mkdirSync(staleDir, { recursive: true });
  fs.mkdirSync(recentDir, { recursive: true });
  const now = 2_000_000_000_000;
  const oldTime = new Date(now - STALE_TEMP_MS - 10_000);
  const recentTime = new Date(now - 5_000);
  fs.utimesSync(staleDir, oldTime, oldTime);
  fs.utimesSync(recentDir, recentTime, recentTime);

  const opened = [];
  const result = await openModelInSlicer({
    bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    filename: "gridfinity_bin.3mf",
    tempRoot,
    now,
    openPath: async (filePath) => {
      opened.push(filePath);
      return "";
    },
  });

  assert.equal(result.ok, true);
  assert.equal(opened.length, 1);
  assert.equal(path.basename(result.path), "gridfinity_bin.3mf");
  assert.deepEqual([...fs.readFileSync(result.path)], [0x50, 0x4b, 0x03, 0x04]);
  assert.equal(fs.existsSync(staleDir), false, "stale temp directory was pruned");
  assert.equal(fs.existsSync(recentDir), true, "recent temp directory was kept");
});

test("openModelInSlicer falls back to an installed slicer when the OS has no default handler", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cf-slicer-fallback-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const launched = [];
  const fallback = await openModelInSlicer({
    bytes: new Uint8Array([1, 2, 3]),
    filename: "desk.3mf",
    tempRoot,
    openPath: async () => "No application is associated with the specified file",
    findSlicer: () => ({ name: "OrcaSlicer", target: "/Applications/OrcaSlicer.app", kind: "mac-app" }),
    launchSlicer: async (slicer, filePath) => {
      launched.push({ slicer, filePath });
    },
  });

  assert.equal(fallback.ok, true);
  assert.equal(fallback.slicer, "OrcaSlicer");
  assert.equal(launched.length, 1);
  assert.equal(path.basename(launched[0].filePath), "desk.3mf");

  // Neither a default association nor an installed slicer: returns a structured error.
  const none = await openModelInSlicer({
    bytes: new Uint8Array([1, 2, 3]),
    filename: "desk.3mf",
    tempRoot,
    openPath: async () => "No application is associated",
    findSlicer: () => null,
  });
  assert.equal(none.ok, false);
  assert.match(none.error, /Install PrusaSlicer, OrcaSlicer, Bambu Studio or Cura/);

  // Bad filename or empty bytes: returns { ok: false, error } without writing anything.
  const bad = await openModelInSlicer({
    bytes: new Uint8Array(0),
    filename: "desk.3mf",
    tempRoot,
    openPath: async () => "",
  });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /no model geometry/);

  // pruneStaleTempDirs ignores a missing folder.
  pruneStaleTempDirs(path.join(tempRoot, "does-not-exist"), Date.now());
});

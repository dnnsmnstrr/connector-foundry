import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { webBundle, writeZip } from "../../scripts/web-bundle.mjs";

const { findBundle, readZip, removeBundles, unpackBundle } = createRequire(import.meta.url)(
  "../../desktop/web-bundle.cjs",
);

// Interface updates: the release job's ZIP writer (scripts/web-bundle.mjs)
// and the app's reader and bundle folders (desktop/web-bundle.cjs).

/** A temporary folder, removed after the test. */
async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "foundry-web-bundle-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** A small dist/: the app page, an asset, a file at the root. */
async function fakeDist(dir) {
  const dist = path.join(dir, "dist");
  await mkdir(path.join(dist, "app"), { recursive: true });
  await mkdir(path.join(dist, "assets"), { recursive: true });
  await writeFile(path.join(dist, "app", "index.html"), "<!doctype html><title>app</title>");
  await writeFile(path.join(dist, "assets", "engine.wasm"), Buffer.alloc(50_000, 7));
  await writeFile(path.join(dist, "index.html"), "landing");
  return dist;
}

const file = (name, data) => ({ name, data: Buffer.from(data) });

test("a bundle round-trips: dist/ and its bundle.json, deflated where that's smaller", async (t) => {
  const dir = await tempDir(t);
  const zip = await webBundle(await fakeDist(dir), { version: "0.5.0", shell: 3 });
  const files = await readZip(zip);
  assert.deepEqual(
    files.map((f) => f.name),
    ["bundle.json", "app/index.html", "assets/engine.wasm", "index.html"],
  );
  assert.deepEqual(JSON.parse(files[0].data.toString()), { version: "0.5.0", shell: 3 });
  assert.equal(files[2].data.length, 50_000);
  // The wasm stand-in compresses, so the ZIP is far smaller than it.
  assert.ok(zip.length < 5_000, String(zip.length));
  // The same dist/ makes the same file.
  assert.deepEqual(await webBundle(path.join(dir, "dist"), { version: "0.5.0", shell: 3 }), zip);
  await assert.rejects(webBundle(path.join(dir, "dist"), { version: "v0.5.0" }), /version/);
});

test("the reader refuses names that leave the folder, duplicates, and damaged data", async () => {
  for (const name of ["../evil", "a/../../evil", "/etc/passwd", "C:/x", "a\\b", "a//b", "./a", "a\0b"])
    await assert.rejects(readZip(writeZip([file(name, "x")])), /malformed/, JSON.stringify(name));
  // Two names one case-insensitive file system would write to one file.
  await assert.rejects(readZip(writeZip([file("App.js", "a"), file("app.js", "b")])), /twice/);
  // A flipped byte in a stored entry: its CRC-32 no longer matches.
  const zip = writeZip([file("a.txt", "hello")]);
  const damaged = Buffer.from(zip);
  damaged[30 + "a.txt".length] ^= 1;
  await assert.rejects(readZip(damaged), /checksum/);
  await assert.rejects(readZip(Buffer.from("not a zip at all, not even close")), /end record/);
  // A directory entry is fine, and skipped.
  assert.deepEqual(
    (await readZip(writeZip([{ name: "dir/", data: Buffer.alloc(0) }, file("dir/a", "1")]))).map(
      (f) => f.name,
    ),
    ["dir/a"],
  );
});

test("a bundle unpacks under its version only if it is the version and shell the release named", async (t) => {
  const dir = await tempDir(t);
  const dist = await fakeDist(dir);
  const webDir = path.join(dir, "web");
  const zip = await webBundle(dist, { version: "0.5.0", shell: 3 });
  const root = await unpackBundle(zip, webDir, { version: "0.5.0", shell: 3 });
  assert.equal(root, path.join(webDir, "0.5.0"));
  assert.equal(
    await readFile(path.join(root, "app", "index.html"), "utf8"),
    "<!doctype html><title>app</title>",
  );
  // Another version's or another shell's bundle under this name: thrown
  // away, with nothing half-written left behind.
  await assert.rejects(unpackBundle(zip, webDir, { version: "0.6.0", shell: 3 }), /isn't the version/);
  await assert.rejects(unpackBundle(zip, webDir, { version: "0.5.0", shell: 4 }), /isn't the version/);
  assert.deepEqual(await readdir(webDir), ["0.5.0"]);
  // No app page, no bundle.
  const pageless = writeZip([file("bundle.json", JSON.stringify({ version: "0.7.0", shell: 3 }))]);
  await assert.rejects(unpackBundle(pageless, webDir, { version: "0.7.0", shell: 3 }), /no app page/);
  assert.deepEqual(await readdir(webDir), ["0.5.0"]);
});

test("the app serves the newest bundle for its shell that is newer than its own", async (t) => {
  const dir = await tempDir(t);
  const dist = await fakeDist(dir);
  const webDir = path.join(dir, "web");
  for (const [version, shell] of [
    ["0.4.1", 3],
    ["0.4.3", 3],
    ["0.4.4", 4],
    ["0.10.0", 3],
  ])
    await unpackBundle(await webBundle(dist, { version, shell }), webDir, { version, shell });
  // A folder whose name and bundle.json disagree, and a half-unpacked one.
  await mkdir(path.join(webDir, "0.9.0", "app"), { recursive: true });
  await writeFile(path.join(webDir, "0.9.0", "app", "index.html"), "x");
  await writeFile(path.join(webDir, "0.9.0", "bundle.json"), JSON.stringify({ version: "0.10.0", shell: 3 }));
  await mkdir(path.join(webDir, "0.11.0.partial"));

  const pick = (options) => findBundle(webDir, options)?.version ?? null;
  assert.equal(pick({ shell: 3, newerThan: "0.4.0" }), "0.10.0");
  assert.equal(pick({ shell: 3, newerThan: "0.4.0", skip: "0.10.0" }), "0.4.3");
  assert.equal(pick({ shell: 4, newerThan: "0.4.0" }), "0.4.4");
  assert.equal(pick({ shell: 3, newerThan: "0.10.0" }), null);
  assert.equal(pick({ shell: 5, newerThan: "0.4.0" }), null);
  assert.equal(findBundle(path.join(dir, "missing"), { shell: 3, newerThan: "0.4.0" }), null);

  removeBundles(webDir, ["0.4.3"]);
  assert.deepEqual(await readdir(webDir), ["0.4.3"]);
  removeBundles(webDir, []);
  assert.deepEqual(await readdir(webDir), []);
  removeBundles(path.join(dir, "missing"), []);
  assert.ok(!existsSync(path.join(dir, "missing")));
});

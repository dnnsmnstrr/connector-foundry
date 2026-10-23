import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import serviceWorkerPlugin, {
  BUILD_ID_TOKEN,
  buildId,
  publicVersions,
  withBuildId,
} from "../../scripts/vite-plugin-sw.mjs";

const SOURCE = fs.readFileSync(new URL("../../src/sw.js", import.meta.url), "utf8");

test("the build id is the commit on CI and a timestamp elsewhere", () => {
  assert.equal(buildId({ GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567" }), "0123456789ab");
  assert.equal(
    buildId({}, () => 35),
    "z",
  );
  assert.equal(
    buildId({ GITHUB_SHA: "" }, () => 36),
    "10",
  );
});

test("a build versions the .scad bundle by its content; the dev server versions nothing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-public-"));
  try {
    fs.writeFileSync(path.join(dir, "scad-bundle.json"), '{"files":{}}');
    fs.writeFileSync(path.join(dir, "catalogue.json"), '{"parts":[]}');
    const versions = publicVersions(dir);
    // Only the bundle, by a hash of its bytes: the same bytes, the same URL.
    assert.deepEqual(Object.keys(versions), ["scad-bundle.json"]);
    assert.match(versions["scad-bundle.json"], /^[0-9a-f]{10}$/);
    assert.deepEqual(publicVersions(dir), versions);
    fs.writeFileSync(path.join(dir, "scad-bundle.json"), '{"files":{"a.scad":""}}');
    assert.notEqual(publicVersions(dir)["scad-bundle.json"], versions["scad-bundle.json"]);

    const plugin = serviceWorkerPlugin({ id: "abc123", publicDir: dir });
    assert.equal(plugin.apply, undefined);
    const built = JSON.parse(plugin.config({}, { command: "build" }).define.__PUBLIC_VERSIONS__);
    assert.deepEqual(Object.keys(built), ["scad-bundle.json"]);
    assert.deepEqual(plugin.config({}, { command: "serve" }), { define: { __PUBLIC_VERSIONS__: "{}" } });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // No bundle yet (sync-scad never ran): a plain URL rather than a failed build.
  assert.deepEqual(publicVersions(path.join(os.tmpdir(), "foundry-public-missing")), {});
});

test("generateBundle emits sw.js at the base with the id in place of the token", () => {
  const plugin = serviceWorkerPlugin({ id: "abc123" });
  const emitted = [];
  plugin.generateBundle.call({ emitFile: (file) => emitted.push(file) });
  assert.equal(emitted.length, 1);
  const [file] = emitted;
  assert.equal(file.type, "asset");
  assert.equal(file.fileName, "sw.js");
  assert.ok(file.source.includes('const BUILD_ID = "abc123";'));
  assert.ok(!file.source.includes(BUILD_ID_TOKEN));
  // Everything else is the source as written: no bundler touched it.
  assert.equal(file.source.length, SOURCE.length - BUILD_ID_TOKEN.length + "abc123".length);
});

test("the source carries the token once, as a string, where the worker names its cache", () => {
  assert.equal(SOURCE.split(`"${BUILD_ID_TOKEN}"`).length, 2);
  assert.ok(SOURCE.includes(`const BUILD_ID = "${BUILD_ID_TOKEN}";`));
  assert.doesNotThrow(() => withBuildId(SOURCE, "x"));
});

test("a renamed or duplicated token fails the build rather than shipping a shared cache name", () => {
  assert.throws(() => withBuildId("const BUILD_ID = 'none';", "abc"), /__BUILD_ID__/);
  assert.throws(() => withBuildId('"__BUILD_ID__" "__BUILD_ID__"', "abc"), /__BUILD_ID__/);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { syncThumbnails, thumbnailName } from "../../scripts/sync-scad.mjs";

function tempDirs(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "thumbnails-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const galleryDir = path.join(root, "img");
  const thumbnailDir = path.join(root, "public", "thumbnails");
  fs.mkdirSync(galleryDir, { recursive: true });
  return { galleryDir, thumbnailDir };
}

test("a thumbnail is named as the gallery names a part's render", () => {
  assert.equal(thumbnailName("gridfinity/base"), "gridfinity_base.png");
  assert.equal(thumbnailName("basics/dovetail_rail"), "basics_dovetail_rail.png");
  // Nothing that would leave the folder or need escaping.
  assert.equal(thumbnailName("../secret"), null);
  assert.equal(thumbnailName("a b/c"), null);
});

test("parts with a render get a copy and a thumbnail path; the others neither", (t) => {
  const { galleryDir, thumbnailDir } = tempDirs(t);
  fs.writeFileSync(path.join(galleryDir, "basics_plate.png"), "plate");
  const parts = [{ id: "basics/plate" }, { id: "basics/post" }];
  assert.equal(syncThumbnails(parts, { galleryDir, thumbnailDir }), 1);
  assert.equal(parts[0].thumbnail, "thumbnails/basics_plate.png");
  assert.equal("thumbnail" in parts[1], false);
  assert.equal(fs.readFileSync(path.join(thumbnailDir, "basics_plate.png"), "utf8"), "plate");
});

test("a copy is rewritten only when the render changed, and one no part has is removed", (t) => {
  const { galleryDir, thumbnailDir } = tempDirs(t);
  fs.writeFileSync(path.join(galleryDir, "basics_plate.png"), "plate");
  syncThumbnails([{ id: "basics/plate" }], { galleryDir, thumbnailDir });
  const copy = path.join(thumbnailDir, "basics_plate.png");
  // Whole seconds: file systems keep sub-millisecond times as floats.
  const old = Math.floor(Date.now() / 1000) - 60;
  fs.utimesSync(copy, old, old);
  syncThumbnails([{ id: "basics/plate" }], { galleryDir, thumbnailDir });
  assert.equal(Math.round(fs.statSync(copy).mtimeMs / 1000), old);

  fs.writeFileSync(path.join(galleryDir, "basics_plate.png"), "plate v2");
  fs.writeFileSync(path.join(thumbnailDir, "gone_part.png"), "stale");
  syncThumbnails([{ id: "basics/plate" }], { galleryDir, thumbnailDir });
  assert.equal(fs.readFileSync(copy, "utf8"), "plate v2");
  assert.equal(fs.existsSync(path.join(thumbnailDir, "gone_part.png")), false);
});

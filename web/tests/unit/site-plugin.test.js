import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

import { REPO_ROOT } from "../../scripts/build-docs.mjs";
import { benchLink, fillPage, landingData, siteData } from "../../scripts/vite-plugin-site.mjs";
import { restoreBenchFromUrl } from "../../src/lib/benchUrlState.js";
import { HERO_PAIRS } from "../../src/site/heroPairs.js";

// The catalogue as the build reads it, without the generated
// public/catalogue.json (CI runs these tests before anything is built).
const catalogue = yaml.load(fs.readFileSync(path.join(REPO_ROOT, "catalogue.yaml"), "utf8"));
const WEB = path.join(REPO_ROOT, "web");

after(() => {
  delete globalThis.window;
});

test("the landing page lists exactly the parts the app lists", () => {
  const { parts, systems, exactCount } = landingData(catalogue);
  const listed = catalogue.parts.filter((part) => !part.hidden);
  assert.deepEqual(
    parts.map((part) => part.id),
    listed.map((part) => part.id),
  );
  assert.equal([...systems.values()].flat().length, parts.length);
  assert.equal(exactCount, listed.filter((part) => part.confidence === "exact").length);
});

test("a part's card opens that part on the Bench", () => {
  const byId = new Map(catalogue.parts.map((part) => [part.id, part]));
  for (const part of landingData(catalogue).parts) {
    const link = benchLink(part.id);
    assert.match(link, /^app\/#mode=bench&bench=[\w-]+$/);
    globalThis.window = {
      location: { pathname: "/app/", search: "", hash: link.slice(link.indexOf("#")) },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    };
    const session = restoreBenchFromUrl(byId);
    assert.equal(session?.assembly.root.partId, part.id);
  }
});

test("every hero part is a catalogue part, set only through its own parameters", () => {
  const byId = new Map(catalogue.parts.map((part) => [part.id, part]));
  for (const pair of HERO_PAIRS) {
    for (const side of [pair.base, pair.attached]) {
      const part = byId.get(side.part);
      assert.ok(part, `${pair.key}: ${side.part} is in the catalogue`);
      for (const key of Object.keys(side.params ?? {})) {
        assert.ok(key in (part.defaults ?? {}), `${pair.key}: ${side.part} has a ${key} parameter`);
      }
    }
  }
});

test("the resize demo's part has width and height handles", () => {
  const { resizePart } = siteData(catalogue);
  assert.equal(resizePart.id, "gridfinity/bin");
  assert.ok(resizePart.resize.x && resizePart.resize.z);
});

test("every placeholder on the landing page and a guide is filled", () => {
  const landing = fillPage(
    fs.readFileSync(path.join(WEB, "index.html"), "utf8"),
    "/index.html",
    "/connector-foundry/",
    () => catalogue,
  );
  assert.doesNotMatch(landing, /\{\{|<!-- site:/);
  assert.match(landing, /href="\/connector-foundry\/app\/"/);
  assert.equal(
    (landing.match(/class="part-card"/g) ?? []).length,
    catalogue.parts.filter((part) => !part.hidden).length,
  );

  const guide = fillPage(
    "<!-- site:header --><main></main><!-- site:footer -->",
    "/docs/cli/index.html",
    "/",
    () => assert.fail("a guide needs no catalogue"),
  );
  assert.doesNotMatch(guide, /\{\{|<!-- site:/);
  assert.match(guide, /data-nav="docs" aria-current="page"/);

  const app = "<html>{{base}}</html>";
  assert.equal(
    fillPage(app, "/app/index.html", "/", () => catalogue),
    app,
    "the app's page is left as written",
  );
});

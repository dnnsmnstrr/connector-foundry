import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Marked } from "marked";

import { DOC_GROUPS, REPO_ROOT, githubSlug, renderGuide, resolveDocLink } from "../../scripts/build-docs.mjs";
import { REPO_URL } from "../../src/lib/commandCatalog.js";

test("heading ids are GitHub's, so a #fragment works on both", () => {
  assert.equal(githubSlug("Publishing a release"), "publishing-a-release");
  assert.equal(githubSlug("Find anything with Cmd/Ctrl+K"), "find-anything-with-cmdctrlk");
  assert.equal(githubSlug("Skådis & MOLLE"), "skådis--molle");
  assert.equal(githubSlug("foundry render"), "foundry-render");
});

test("links between guides stay on the website, the rest go to GitHub", () => {
  assert.equal(resolveDocLink("CLI.md"), "../cli/");
  assert.equal(resolveDocLink("GETTING_STARTED.md#save-and-share"), "../getting-started/#save-and-share");
  assert.equal(
    resolveDocLink("MACOS.md#publishing-a-release"),
    `${REPO_URL}/blob/main/docs/MACOS.md#publishing-a-release`,
  );
  assert.equal(resolveDocLink("../README.md#licensing"), `${REPO_URL}/blob/main/README.md#licensing`);
  assert.equal(resolveDocLink("../web/desktop"), `${REPO_URL}/tree/main/web/desktop`);
  assert.equal(resolveDocLink("#install"), "#install");
  assert.equal(resolveDocLink("https://openscad.org/"), "https://openscad.org/");
});

test("a guide renders with its ids, contents, lede and code", () => {
  const guide = renderGuide(
    [
      "# Title",
      "",
      "What it covers. Back to the [README](../README.md).",
      "",
      "## First part",
      "",
      "### A detail",
      "",
      "## First part",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "```bash",
      "foundry list   # every part",
      "echo '<b>' https://example.org/#anchor",
      "```",
    ].join("\n"),
  );
  assert.equal(guide.title, "Title");
  // The way back to the README is GitHub's navigation; the website has its own.
  assert.equal(guide.lede, "What it covers.");
  assert.doesNotMatch(guide.html, /Back to the/);
  assert.deepEqual(
    guide.toc.map((entry) => [entry.depth, entry.id]),
    [
      [2, "first-part"],
      [3, "a-detail"],
      [2, "first-part-1"],
    ],
  );
  assert.match(guide.html, /<div class="table-scroll"><table>/);
  assert.match(guide.html, /<span class="code-comment"># every part<\/span>/);
  assert.match(guide.html, /echo &#39;&lt;b&gt;&#39; https:\/\/example.org\/#anchor/);
});

// Every relative link in the published guides, and every #fragment into a
// guide or the README, has to land: a renamed heading or a moved file
// breaks a link on GitHub and on the website alike.
test("every link in the published guides leads somewhere", () => {
  const idsOf = new Map();
  const ids = (file) => {
    if (!idsOf.has(file)) {
      const { html } = renderGuide(fs.readFileSync(path.join(REPO_ROOT, file), "utf8"));
      idsOf.set(file, new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])));
    }
    return idsOf.get(file);
  };
  const problems = [];
  for (const doc of DOC_GROUPS.flatMap((group) => group.docs)) {
    const file = `docs/${doc.file}`;
    const hrefs = [];
    new Marked({
      walkTokens(token) {
        if (token.type === "link" || token.type === "image") hrefs.push(token.href);
      },
    }).parse(fs.readFileSync(path.join(REPO_ROOT, file), "utf8"));
    for (const href of hrefs) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
      const [target, fragment] = href.split("#");
      const resolved = target ? path.posix.normalize(path.posix.join("docs", target)) : file;
      if (!fs.existsSync(path.join(REPO_ROOT, resolved))) {
        problems.push(`${file}: ${href} (no ${resolved})`);
        continue;
      }
      if (fragment && resolved.endsWith(".md") && !ids(resolved).has(fragment))
        problems.push(`${file}: ${href} (no heading #${fragment} in ${resolved})`);
    }
  }
  assert.deepEqual(problems, []);
});

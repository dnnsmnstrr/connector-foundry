import test from "node:test";
import assert from "node:assert/strict";

import {
  browseSections,
  createCommandRegistry,
  matchRanges,
  normalize,
  rankCommands,
  scoreText,
} from "../../src/lib/commands.js";

const command = (id, title, extra = {}) => ({ id, title, section: "General", actions: [], ...extra });
const titles = (ranked) => ranked.map((r) => r.command.title);

test("a word scores by how it matches: exact, prefix, initials, word start, inside, scattered", () => {
  const field = "open in bench";
  assert.equal(scoreText("bench", "bench"), 100);
  assert.equal(scoreText(field, "open"), 90);
  assert.equal(scoreText(field, "oib"), 85);
  assert.equal(scoreText(field, "ben"), 80);
  assert.equal(scoreText(field, "enc"), 55);
  const scattered = scoreText(field, "obh");
  assert.ok(scattered >= 20 && scattered <= 35, String(scattered));
  // A tighter scatter beats a looser one.
  assert.ok(scoreText("abxc", "abc") > scoreText("axxxxbxxxxc", "abc"));
  assert.equal(scoreText(field, "xyz"), 0);
  // No scattered matches where they aren't asked for (sections, subtitles).
  assert.equal(scoreText(field, "obh", false), 0);
});

test("accents don't matter: skadis finds Skådis", () => {
  assert.equal(normalize("Skådis Hook"), "skadis hook");
  const ranked = rankCommands([command("a", "Skådis hook"), command("b", "Board")], "skadis");
  assert.deepEqual(titles(ranked), ["Skådis hook"]);
});

test("every typed word has to match somewhere", () => {
  const commands = [
    command("m3", "M3 socket cap", { subtitle: "Socket head cap" }),
    command("m4", "M4 socket cap", { subtitle: "Socket head cap" }),
    command("m3c", "M3 countersunk", { subtitle: "Countersunk" }),
  ];
  assert.deepEqual(titles(rankCommands(commands, "m3 cap")), ["M3 socket cap"]);
  assert.deepEqual(titles(rankCommands(commands, "cap m4")), ["M4 socket cap"]);
  assert.deepEqual(rankCommands(commands, "m3 bolt"), []);
  // Nothing typed matches nothing: that's the browse view's case.
  assert.deepEqual(rankCommands(commands, "   "), []);
});

test("initials find a command: oib ranks Open in Bench first", () => {
  const commands = [
    command("lib", "Open in Library"),
    command("bench", "Open in Bench"),
    command("other", "Bench: open in browser"),
  ];
  assert.equal(titles(rankCommands(commands, "oib"))[0], "Open in Bench");
  // The whole phrase starting a title beats the same words elsewhere.
  assert.equal(titles(rankCommands(commands, "open in"))[0], "Open in Library");
});

test("words all in the title beat a keyword and a lucky prefix", () => {
  const commands = [
    command("issue", "Report an issue", { keywords: ["bug", "github"] }),
    command("repo", "Open the GitHub repository", { keywords: ["source", "code"] }),
  ];
  assert.equal(titles(rankCommands(commands, "github repo"))[0], "Open the GitHub repository");
  assert.equal(titles(rankCommands(commands, "github bug"))[0], "Report an issue");
});

test("the title counts more than keywords, keywords more than the section", () => {
  const commands = [
    command("section", "Fit", { section: "Settings" }),
    command("keyword", "Open the preferences", { keywords: ["settings"] }),
    command("title", "Settings"),
  ];
  assert.deepEqual(titles(rankCommands(commands, "settings")), ["Settings", "Open the preferences", "Fit"]);
});

test("an exact alias wins outright", () => {
  const commands = [command("grid", "Grid step…"), command("mine", "My bin", { alias: "gr" })];
  assert.equal(titles(rankCommands(commands, "gr"))[0], "My bin");
  // Only typed exactly: a prefix of the alias is an ordinary match.
  assert.equal(titles(rankCommands(commands, "g"))[0], "Grid step…");
});

test("recently run commands win near-ties, never a clearly better match", () => {
  const commands = [command("a", "Download STL"), command("b", "Download config")];
  assert.deepEqual(titles(rankCommands(commands, "download")), ["Download STL", "Download config"]);
  assert.deepEqual(titles(rankCommands(commands, "download", { recents: ["b"] })), [
    "Download config",
    "Download STL",
  ]);
  // A prefix match isn't overtaken by a recent scattered one.
  const mixed = [command("x", "Fit the view"), command("y", "Flip the model")];
  assert.equal(titles(rankCommands(mixed, "fit", { recents: ["y"] }))[0], "Fit the view");
});

test("ties keep the order the commands came in", () => {
  const commands = [command("1", "Alpha one"), command("2", "Alpha two"), command("3", "Alpha three")];
  assert.deepEqual(titles(rankCommands(commands, "alpha")), ["Alpha one", "Alpha two", "Alpha three"]);
});

test("the browse view: recent first, then sections in order, search-only rows left out", () => {
  const commands = [
    command("go", "Go to Holes", { section: "Go to" }),
    command("set", "Open Settings", { section: "Settings" }),
    command("part", "Flat plate", { section: "Parts", searchOnly: true }),
    command("fit", "Fit the view", { section: "3D view" }),
    command("odd", "Something new", { section: "Unlisted" }),
    command("off", "Cancel renders", { section: "General", disabled: "Nothing to cancel" }),
  ];
  const sections = browseSections(commands, {
    recents: ["part", "missing", "set", "off"],
    sectionOrder: ["General", "3D view", "Go to", "Settings", "Parts"],
  });
  assert.deepEqual(
    sections.map((s) => [s.title, s.items.map((c) => c.id)]),
    [
      // A search-only part is worth a recent row; a disabled one isn't.
      ["Recent", ["part", "set"]],
      ["General", ["off"]],
      ["3D view", ["fit"]],
      ["Go to", ["go"]],
      ["Unlisted", ["odd"]],
    ],
  );
  // At most five recents.
  const many = Array.from({ length: 8 }, (_, i) => command(`c${i}`, `Command ${i}`));
  const recent = browseSections(many, { recents: many.map((c) => c.id) })[0];
  assert.equal(recent.items.length, 5);
});

test("the matched spans of a title, in its own indices", () => {
  assert.deepEqual(matchRanges("Open in Bench", "open"), [[0, 4]]);
  assert.deepEqual(matchRanges("Open in Bench", "oib"), [
    [0, 1],
    [5, 6],
    [8, 9],
  ]);
  assert.deepEqual(matchRanges("Open in Bench", "ben"), [[8, 11]]);
  assert.deepEqual(matchRanges("Open in Bench", "in ope"), [
    [0, 3],
    [5, 7],
  ]);
  // Accents: the span covers the accented letter in the original.
  assert.deepEqual(matchRanges("Skådis hook", "skad"), [[0, 4]]);
  assert.deepEqual(matchRanges("Fit", "zz"), []);
});

test("the registry collects its sources in order, the first of a duplicated id winning", () => {
  const registry = createCommandRegistry();
  const offA = registry.register("a", () => [command("x", "From a"), null, false]);
  registry.register("b", () => [command("x", "From b"), command("y", "Only b")]);
  assert.deepEqual(
    registry.collect().map((c) => c.title),
    ["From a", "Only b"],
  );
  offA();
  assert.deepEqual(
    registry.collect().map((c) => c.title),
    ["From b", "Only b"],
  );
  // Unregistering twice is harmless, and never removes someone else.
  offA();
  assert.equal(registry.collect().length, 2);
});

test("a source that throws is skipped, not the whole list", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const registry = createCommandRegistry();
  registry.register("broken", () => {
    throw new Error("boom");
  });
  registry.register("fine", () => [command("ok", "Still here")]);
  assert.deepEqual(
    registry.collect().map((c) => c.id),
    ["ok"],
  );
  assert.equal(warn.mock.callCount(), 1);
});

test("registering notifies; touch notifies only while someone listens", () => {
  const registry = createCommandRegistry();
  registry.touch();
  assert.equal(registry.version(), 0);
  let calls = 0;
  const off = registry.subscribe(() => calls++);
  registry.register("a", () => []);
  registry.touch();
  assert.equal(calls, 2);
  off();
  registry.touch();
  assert.equal(calls, 2);
});

test("run() runs the first action, or opens the palette on a page", () => {
  const registry = createCommandRegistry();
  const ran = [];
  registry.register("a", () => [
    command("go", "Go", { actions: [{ title: "Go", run: () => ran.push("go") }] }),
    command("off", "Off", { disabled: "no", actions: [{ title: "Off", run: () => ran.push("off") }] }),
    command("page", "View…", { page: () => ({ id: "view", title: "View", items: () => [] }) }),
  ]);
  assert.equal(registry.run("go"), true);
  assert.equal(registry.run("off"), false);
  assert.equal(registry.run("missing"), false);
  // Nobody to open the palette yet.
  assert.equal(registry.run("page"), false);
  const unset = registry.setOpener((id) => ran.push(`open ${id}`));
  assert.equal(registry.run("page"), true);
  unset();
  assert.deepEqual(ran, ["go", "open page"]);
});

test("the home override: the latest wins, and an older unset leaves it alone", () => {
  const registry = createCommandRegistry();
  assert.equal(registry.home(), null);
  const first = () => {};
  const second = () => {};
  const unsetFirst = registry.setHome(first);
  const unsetSecond = registry.setHome(second);
  unsetFirst();
  assert.equal(registry.home(), second);
  unsetSecond();
  assert.equal(registry.home(), null);
});

test("the user's aliases and hotkeys are put on the commands they name", () => {
  const registry = createCommandRegistry();
  registry.register("a", () => [command("app.settings", "Open Settings"), command("other", "Other")]);
  registry.setBindings(new Map([["app.settings", { alias: "prefs", hotkey: "Mod+Shift+P" }]]));
  const [settings, other] = registry.collect();
  assert.equal(settings.alias, "prefs");
  assert.equal(settings.hotkey, "Mod+Shift+P");
  assert.equal(other.alias, undefined);
  assert.equal(titles(rankCommands(registry.collect(), "prefs"))[0], "Open Settings");
});

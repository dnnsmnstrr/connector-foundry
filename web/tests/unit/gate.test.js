import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// public/gate.js, the unsupported-browser gate, run in a vm context with a
// fake document: it runs in <head>, before #root exists, so the message
// has to wait for DOMContentLoaded; and the versions it names must be the
// floor the guide gives.
const SOURCE = fs.readFileSync(new URL("../../public/gate.js", import.meta.url), "utf8");
const GUIDE = fs.readFileSync(new URL("../../../docs/GETTING_STARTED.md", import.meta.url), "utf8");

/**
 * Runs the gate against an engine with or without the features it checks.
 * @param {{ at?: boolean, moduleWorker?: boolean }} [engine]
 */
function run({ at = true, moduleWorker = true } = {}) {
  const listeners = { document: {}, window: {} };
  const root = { innerHTML: "", childElementCount: 0 };
  let parsed = false;
  const document = {
    getElementById: (id) => (id === "root" && parsed ? root : null),
    addEventListener: (type, fn) => (listeners.document[type] ??= []).push(fn),
  };
  const context = vm.createContext({ document });
  const window = vm.runInContext("this", context);
  window.window = window;
  window.addEventListener = (type, fn) => (listeners.window[type] ??= []).push(fn);
  window.HTMLDialogElement = class {
    showModal() {}
  };
  // Like a browser's: the options are read before the URL is parsed, and
  // an engine without module workers (Firefox before 114) never reads type.
  // Bound, so its source reads "[native code]" as the engine's own does
  // (the gate leaves a stand-in Worker alone).
  window.Worker = function Worker(url, options) {
    if (moduleWorker) void options.type;
    throw new SyntaxError(`Failed to construct 'Worker': ${url} cannot be parsed`);
  }.bind(null);
  if (!at) vm.runInContext("delete Array.prototype.at", context);
  vm.runInContext(SOURCE, context, { filename: "gate.js" });
  return {
    window,
    root,
    // The rest of the document arrives, #root with it.
    finishParsing() {
      parsed = true;
      for (const fn of listeners.document.DOMContentLoaded ?? []) fn();
    },
    error(target) {
      for (const fn of listeners.window.error ?? []) fn({ target: target ?? window });
    },
  };
}

test("a supported engine passes and the page is left alone", () => {
  const page = run();
  page.finishParsing();
  assert.equal(page.window.__unsupported, undefined);
  assert.equal(page.root.innerHTML, "");
});

test("a missing feature sets the flag at once and draws the message once #root exists", () => {
  for (const engine of [{ at: false }, { moduleWorker: false }]) {
    const page = run(engine);
    // Set before the module runs, so main.jsx mounts nothing.
    assert.equal(page.window.__unsupported, true, JSON.stringify(engine));
    assert.equal(page.root.innerHTML, "");
    page.finishParsing();
    assert.match(page.root.innerHTML, /can't run Connector Foundry/);
    assert.match(page.root.innerHTML, /role="alert"/);
  }
});

test("only an error at the window says update; a failed script says reload; a stylesheet says nothing", () => {
  const parseError = run();
  parseError.finishParsing();
  parseError.error();
  assert.equal(parseError.window.__unsupported, true);
  assert.match(parseError.root.innerHTML, /can't run/);

  const chunk = run();
  chunk.finishParsing();
  chunk.error({ tagName: "SCRIPT" });
  assert.equal(chunk.window.__unsupported, undefined, "a download is no reason to turn the browser away");
  assert.match(chunk.root.innerHTML, /couldn't load/);

  const stylesheet = run();
  stylesheet.finishParsing();
  stylesheet.error({ tagName: "LINK", rel: "stylesheet" });
  assert.equal(stylesheet.root.innerHTML, "");

  // Once the app has started, its own errors are its own.
  const started = run();
  started.finishParsing();
  started.window.__appStarted = true;
  started.error();
  assert.equal(started.window.__unsupported, undefined);
  assert.equal(started.root.innerHTML, "");
});

test("the message names the floor the guide gives", () => {
  const floor = /Safari or iOS ([\d.]+), Chrome (\d+), Firefox (\d+),? (?:or )?Samsung Internet (\d+)/;
  const inGate = SOURCE.match(floor);
  const inGuide = GUIDE.replace(/\s+/g, " ").match(floor);
  assert.ok(inGate, "the gate names its versions");
  assert.ok(inGuide, "the guide names its versions");
  assert.deepEqual(inGate.slice(1), inGuide.slice(1));
});

test("a stand-in Worker (the browser tests') is no reason to turn the browser away", () => {
  const listeners = {};
  const root = { innerHTML: "" };
  const context = vm.createContext({
    document: { getElementById: () => root, addEventListener: (type, fn) => (listeners[type] = fn) },
  });
  const window = vm.runInContext("this", context);
  window.window = window;
  window.addEventListener = () => {};
  window.HTMLDialogElement = class {
    showModal() {}
  };
  // A plain class, as the specs' fake Workers are: it never reads options.
  window.Worker = class {};
  vm.runInContext(SOURCE, context, { filename: "gate.js" });
  assert.equal(window.__unsupported, undefined);
  assert.equal(root.innerHTML, "");
});

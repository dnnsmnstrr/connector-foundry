import test from "node:test";
import assert from "node:assert/strict";

import { getCommandHud, showCommandHud, subscribeCommandHud } from "../../src/lib/commandHud.js";
import { copyLink, linkActions } from "../../src/lib/commandCatalog.js";

// Short real delays rather than the test runner's mock timers, which are
// still experimental in Node 22 and warn on every run.
const wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

test("a message shows for a moment; a newer one replaces it and restarts the clock", async (t) => {
  let calls = 0;
  const off = subscribeCommandHud(() => calls++);
  t.after(off);
  showCommandHud("Link copied", 60);
  assert.equal(getCommandHud().text, "Link copied");
  await wait(30);
  showCommandHud("Copied again", 60);
  await wait(40);
  // Past the first one's time, inside the second's.
  assert.equal(getCommandHud().text, "Copied again");
  await wait(60);
  assert.equal(getCommandHud(), null);
  assert.equal(calls, 3);
});

test("a link opens on Enter and is copied on Mod+Enter, saying so", async (t) => {
  const opened = [];
  globalThis.window = /** @type {any} */ ({ open: (...args) => opened.push(args) });
  const written = [];
  const clipboard = { writeText: async (text) => void written.push(text) };
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard },
    configurable: true,
    writable: true,
  });
  t.after(() => {
    delete globalThis.window;
    delete globalThis.navigator;
  });
  const [open, copy] = linkActions("https://layerling.com/");
  assert.deepEqual([open.title, copy.title], ["Open", "Copy link"]);
  open.run();
  assert.deepEqual(opened, [["https://layerling.com/", "_blank", "noopener,noreferrer"]]);
  copy.run();
  await Promise.resolve();
  assert.deepEqual(written, ["https://layerling.com/"]);
  assert.equal(getCommandHud().text, "Link copied");

  // No clipboard to write: it says that instead.
  globalThis.navigator = /** @type {any} */ ({});
  copyLink("https://example.com/");
  assert.match(getCommandHud().text, /didn't let/);
});

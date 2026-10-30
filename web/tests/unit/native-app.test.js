import test from "node:test";
import assert from "node:assert/strict";

import {
  APP_FOLDER,
  appFolderLabel,
  appFolderPath,
  freeName,
  goBack,
  nativePlatform,
  onNativeBack,
  toBase64,
} from "../../src/lib/nativeApp.js";

/** Capacitor's bridge as the store apps put it on window. */
const capacitor = (platform, native = true) => ({
  Capacitor: { isNativePlatform: () => native, getPlatform: () => platform },
});

test("the store apps are told apart from a browser by Capacitor's bridge", () => {
  assert.equal(nativePlatform(capacitor("ios")), "ios");
  assert.equal(nativePlatform(capacitor("android")), "android");
  // @capacitor/core loaded in a browser has the object too, but says web.
  assert.equal(nativePlatform(capacitor("web", false)), null);
  assert.equal(nativePlatform({}), null);
  assert.equal(nativePlatform(undefined), null);
  assert.equal(
    nativePlatform({ Capacitor: { isNativePlatform: () => true, getPlatform: () => "electron" } }),
    null,
  );
});

test("iOS saves at the top of the app's own Documents; Android in a folder of the shared one", () => {
  assert.equal(appFolderPath("ios", "bin.stl"), "bin.stl");
  assert.equal(appFolderPath("android", "bin.stl"), `${APP_FOLDER}/bin.stl`);
  assert.equal(appFolderLabel("ios"), "Files › Foundry");
  assert.equal(appFolderLabel("android"), "Documents › Connector Foundry");
});

test("a saved file never replaces one of the same name", async () => {
  const taken = new Set(["bin.stl", "bin 2.stl", "notes"]);
  const exists = async (name) => taken.has(name);
  assert.equal(await freeName("plate.stl", exists), "plate.stl");
  assert.equal(await freeName("bin.stl", exists), "bin 3.stl");
  assert.equal(await freeName("notes", exists), "notes 2");
  // The stem is everything before the last dot; a leading dot is not an extension.
  assert.equal(await freeName("my.bench.json", async (n) => n === "my.bench.json"), "my.bench 2.json");
  assert.equal(await freeName(".hidden", async (n) => n === ".hidden"), ".hidden 2");
  // A filesystem that says everything exists ends the search instead of looping.
  assert.equal(await freeName("x.stl", async () => true), "x 999.stl");
});

test("bytes go over the bridge as base64, in chunks a large STL does not overflow", () => {
  assert.equal(toBase64(new Uint8Array([])), "");
  assert.equal(
    toBase64(new TextEncoder().encode("solid part")),
    Buffer.from("solid part").toString("base64"),
  );
  const big = new Uint8Array(5 * 1024 * 1024);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 0xff;
  assert.equal(toBase64(big), Buffer.from(big).toString("base64"));
});

/** A document with the given dialogs open, each recording what happened to it. */
function fakeDocument(dialogs) {
  return { querySelectorAll: (selector) => (selector === "dialog[open]" ? dialogs : []) };
}

function fakeDialog({ handlesCancel }) {
  const dialog = new EventTarget();
  dialog.closed = false;
  dialog.close = () => {
    dialog.closed = true;
  };
  if (handlesCancel) dialog.addEventListener("cancel", (event) => event.preventDefault());
  return dialog;
}

test("Android's back closes the topmost dialog, then the drawer, then backgrounds the app", () => {
  let backgrounded = 0;
  const toBackground = () => backgrounded++;
  const drawer = [];
  const handlers = [() => drawer.push("closed")];

  // Two dialogs (a confirmation over Settings): the top one, as Escape would.
  const under = fakeDialog({ handlesCancel: true });
  const top = fakeDialog({ handlesCancel: true });
  const cancelled = [];
  top.addEventListener("cancel", () => cancelled.push("top"));
  assert.equal(goBack(fakeDocument([under, top]), handlers, toBackground), "dialog");
  assert.deepEqual(cancelled, ["top"]);
  // The app's dialogs close themselves on cancel (Modal, the palette); one
  // that doesn't handle it closes as Escape would close it.
  assert.equal(top.closed, false);
  const plain = fakeDialog({ handlesCancel: false });
  goBack(fakeDocument([plain]), handlers, toBackground);
  assert.equal(plain.closed, true);
  assert.deepEqual(drawer, []);

  assert.equal(goBack(fakeDocument([]), handlers, toBackground), "handler");
  assert.deepEqual(drawer, ["closed"]);
  assert.equal(backgrounded, 0);

  assert.equal(goBack(fakeDocument([]), [], toBackground), "background");
  assert.equal(backgrounded, 1);
});

test("outside the Android app, registering for back does nothing", () => {
  const unregister = onNativeBack(() => {
    throw new Error("never called");
  });
  assert.equal(typeof unregister, "function");
  unregister();
});

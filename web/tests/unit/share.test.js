import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";

import {
  canShareFile,
  canShareLink,
  CHROMIUM_SHARE_EXTENSIONS,
  EASYPRINT_NOTE,
  EASYPRINT_STEPS,
  EASYPRINT_URL,
  modelFile,
  shareableAppLink,
  shareOrCopyLink,
  shareOrDownload,
} from "../../src/lib/share.js";

// No DOM here: every navigator is a plain object, and the download and
// copy actions are spies that record their calls.

const STL_BYTES = new Uint8Array(84); // an empty binary STL: header and a zero count

function recorder(result) {
  const calls = [];
  const fn = (...args) => {
    calls.push(args);
    return result;
  };
  return { fn, calls };
}

// Safari's navigator: share() and canShare(), no userAgentData.
function webkitNav(share = () => Promise.resolve()) {
  return { share, canShare: () => true };
}

// Chromium's navigator: the same API plus userAgentData, and a canShare()
// that says yes to any file, as Blink's does.
function chromiumNav(share = () => Promise.resolve()) {
  return { ...webkitNav(share), userAgentData: { brands: [] } };
}

const abort = () => Promise.reject(new DOMException("The user cancelled", "AbortError"));
const notAllowed = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));

test("the EasyPrint facts the sheet and the docs read", () => {
  assert.equal(EASYPRINT_URL, "https://www.printables.com/slice");
  assert.equal(EASYPRINT_STEPS.length, 3);
  assert.ok(EASYPRINT_STEPS.every((step) => typeof step === "string" && step.length > 0));
  assert.ok(Object.isFrozen(EASYPRINT_STEPS));
  assert.match(EASYPRINT_STEPS[0], /Save to Files/);
  assert.match(EASYPRINT_STEPS[1], /Prusa Account/);
  assert.match(EASYPRINT_STEPS[2], /Upload model/);
  assert.match(EASYPRINT_NOTE, /STL and 3MF/);
});

test("Chromium's allowlist has the media, text and PDF extensions and no model file", () => {
  for (const ext of ["png", "jpg", "pdf", "txt", "mp4", "svg", "csv"])
    assert.ok(CHROMIUM_SHARE_EXTENSIONS.has(ext));
  for (const ext of ["stl", "3mf", "scad", "json", "zip"]) assert.ok(!CHROMIUM_SHARE_EXTENSIONS.has(ext));
  assert.equal(CHROMIUM_SHARE_EXTENSIONS.size, 40);
});

test("modelFile() names the bytes and types them by extension", () => {
  const stl = modelFile(STL_BYTES, "bracket.stl");
  assert.ok(stl instanceof File);
  assert.equal(stl.name, "bracket.stl");
  assert.equal(stl.type, "model/stl");
  assert.equal(stl.size, 84);
  assert.equal(modelFile(STL_BYTES, "Bench.3MF").type, "model/3mf");
  assert.equal(modelFile(STL_BYTES, "bench.scad").type, "application/octet-stream");
  assert.equal(modelFile(STL_BYTES, "noext").type, "application/octet-stream");
  assert.equal(modelFile(STL_BYTES.buffer, "custom.stl", "text/plain").type, "text/plain");
});

test("without the Web Share API the file is downloaded under its name and type", async () => {
  const download = recorder();
  const file = modelFile(STL_BYTES, "bracket.stl");
  assert.equal(canShareFile(file, { nav: {} }), false);
  assert.equal(canShareFile(file, { nav: { share: () => Promise.resolve() } }), false);
  assert.equal(canShareFile(file, { nav: undefined }), false);
  assert.equal(await shareOrDownload(file, { nav: {}, download: download.fn }), "downloaded");
  assert.equal(download.calls.length, 1);
  const [data, name, type] = download.calls[0];
  assert.equal(data, file);
  assert.equal(name, "bracket.stl");
  assert.equal(type, "model/stl");
});

test("Chromium says it can share an .stl but would refuse it, so the file is downloaded", async () => {
  const share = recorder(Promise.resolve());
  const download = recorder();
  const nav = chromiumNav(share.fn);
  const file = modelFile(STL_BYTES, "bracket.stl");
  assert.equal(nav.canShare({ files: [file] }), true);
  assert.equal(canShareFile(file, { nav }), false);
  assert.equal(canShareFile(modelFile(STL_BYTES, "bench.3mf"), { nav }), false);
  assert.equal(await shareOrDownload(file, { nav, download: download.fn }), "downloaded");
  assert.equal(share.calls.length, 0);
  assert.equal(download.calls.length, 1);
  // A file on the allowlist still goes to the sheet there.
  assert.equal(canShareFile(modelFile(STL_BYTES, "preview.PNG"), { nav }), true);
});

test("WebKit shares the one File, titled by its name", async () => {
  const share = recorder(Promise.resolve());
  const download = recorder();
  const nav = webkitNav(share.fn);
  const file = modelFile(STL_BYTES, "bracket.stl");
  assert.equal(canShareFile(file, { nav }), true);
  assert.equal(await shareOrDownload(file, { nav, download: download.fn }), "shared");
  assert.equal(share.calls.length, 1);
  const [data] = share.calls[0];
  assert.equal(data.files.length, 1);
  assert.ok(data.files[0] instanceof File);
  assert.equal(data.files[0].type, "model/stl");
  assert.equal(data.title, "bracket.stl");
  assert.equal(download.calls.length, 0);
});

test("share() is called before shareOrDownload() first yields, inside the click's activation", () => {
  const share = recorder(Promise.resolve());
  const pending = shareOrDownload(modelFile(STL_BYTES, "bracket.stl"), { nav: webkitNav(share.fn) });
  assert.equal(share.calls.length, 1);
  return pending;
});

test("a dismissed sheet is 'cancelled' and nothing is downloaded", async () => {
  const download = recorder();
  const file = modelFile(STL_BYTES, "bracket.stl");
  assert.equal(await shareOrDownload(file, { nav: webkitNav(abort), download: download.fn }), "cancelled");
  // A plain Error named like the DOMException counts too (an engine's
  // own error class may not be a DOMException across a realm).
  const named = () => Promise.reject(Object.assign(new Error("no targets"), { name: "AbortError" }));
  assert.equal(await shareOrDownload(file, { nav: webkitNav(named), download: download.fn }), "cancelled");
  assert.equal(download.calls.length, 0);
});

test("any other share() failure falls back to the download", async () => {
  const file = modelFile(STL_BYTES, "bracket.stl");
  for (const failure of [
    notAllowed,
    () => Promise.reject(new TypeError("bad data")),
    () => Promise.reject(new DOMException("busy", "InvalidStateError")),
    // A rejection that is not an Error at all must not slip past the
    // AbortError check or crash it.
    // eslint-disable-next-line prefer-promise-reject-errors
    () => Promise.reject("not even an Error"),
  ]) {
    const download = recorder();
    assert.equal(
      await shareOrDownload(file, { nav: webkitNav(failure), download: download.fn }),
      "downloaded",
    );
    assert.equal(download.calls.length, 1);
  }
  // canShare() throwing (an old WebKit on an unexpected member) is a no.
  const download = recorder();
  const nav = {
    share: () => Promise.resolve(),
    canShare: () => {
      throw new TypeError("no files here");
    },
  };
  assert.equal(canShareFile(file, { nav }), false);
  assert.equal(await shareOrDownload(file, { nav, download: download.fn }), "downloaded");
  assert.equal(download.calls.length, 1);
});

test("the desktop app has no share sheet: download, share() untouched", async () => {
  const share = recorder(Promise.resolve());
  const download = recorder();
  const file = modelFile(STL_BYTES, "bracket.stl");
  const nav = webkitNav(share.fn);
  assert.equal(canShareFile(file, { nav, desktop: true }), false);
  assert.equal(await shareOrDownload(file, { nav, desktop: true, download: download.fn }), "downloaded");
  assert.equal(share.calls.length, 0);
  assert.equal(download.calls.length, 1);
});

test("a link is shared where share() exists, else copied", async () => {
  const url = "https://example.test/app/#bench=abc";
  // No share(): copy.
  let copy = recorder();
  assert.equal(canShareLink(url, { nav: {} }), false);
  assert.equal(await shareOrCopyLink(url, "Bench", { nav: {}, copy: copy.fn }), "copied");
  assert.deepEqual(copy.calls, [[url]]);
  // share() without canShare() (early Safari and Chrome Android): share.
  let share = recorder(Promise.resolve());
  copy = recorder();
  assert.equal(canShareLink(url, { nav: { share: share.fn } }), true);
  assert.equal(await shareOrCopyLink(url, "Bench", { nav: { share: share.fn }, copy: copy.fn }), "shared");
  assert.deepEqual(share.calls, [[{ url, title: "Bench" }]]);
  assert.equal(copy.calls.length, 0);
  // Chromium shares a URL fine; its allowlist is about files.
  share = recorder(Promise.resolve());
  assert.equal(await shareOrCopyLink(url, "Bench", { nav: chromiumNav(share.fn), copy: copy.fn }), "shared");
  assert.equal(share.calls.length, 1);
  // canShare({ url }) saying no: copy.
  copy = recorder();
  const refusing = { share: () => Promise.resolve(), canShare: () => false };
  assert.equal(canShareLink(url, { nav: refusing }), false);
  assert.equal(await shareOrCopyLink(url, "Bench", { nav: refusing, copy: copy.fn }), "copied");
  // The desktop app: copy, share() untouched.
  share = recorder(Promise.resolve());
  copy = recorder();
  assert.equal(
    await shareOrCopyLink(url, "Bench", { nav: webkitNav(share.fn), desktop: true, copy: copy.fn }),
    "copied",
  );
  assert.equal(share.calls.length, 0);
  assert.equal(copy.calls.length, 1);
});

test("a dismissed link share is 'cancelled'; another failure copies instead", async () => {
  const url = "https://example.test/app/";
  let copy = recorder();
  assert.equal(await shareOrCopyLink(url, "Bench", { nav: webkitNav(abort), copy: copy.fn }), "cancelled");
  assert.equal(copy.calls.length, 0);
  copy = recorder();
  assert.equal(await shareOrCopyLink(url, "Bench", { nav: webkitNav(notAllowed), copy: copy.fn }), "copied");
  assert.equal(copy.calls.length, 1);
});

test("with neither share() nor a copy action there is nothing to do", async () => {
  assert.equal(await shareOrCopyLink("https://example.test/", "Bench", { nav: {} }), "unavailable");
  assert.equal(
    await shareOrCopyLink("https://example.test/", "Bench", { nav: webkitNav(), desktop: true }),
    "unavailable",
  );
  assert.equal(
    await shareOrCopyLink("https://example.test/", "Bench", { nav: webkitNav(notAllowed) }),
    "unavailable",
  );
});

test("a link from the desktop app points at the website's app, with the same state", () => {
  const site = "https://dnnsmnstrr.github.io/connector-foundry/";
  const bench = "#mode=bench&bench=eyJyIjp7fX0";
  assert.equal(
    shareableAppLink(`foundry://app/${bench}`, { desktop: true, siteUrl: site }),
    `${site}app/${bench}`,
  );
  assert.equal(shareableAppLink("foundry://app/", { desktop: true, siteUrl: site }), `${site}app/`);
  // In a browser the address already opens anywhere.
  const web = `${site}app/${bench}`;
  assert.equal(shareableAppLink(web, { siteUrl: site }), web);
});

test("the guide's EasyPrint steps name the same link and upload path as the sheet", () => {
  const guide = fs.readFileSync(new URL("../../../docs/GETTING_STARTED.md", import.meta.url), "utf8");
  assert.ok(guide.includes(EASYPRINT_URL), "the guide links EasyPrint");
  assert.ok(guide.includes("Models → Add… → Upload model"), "the guide gives the upload path");
  assert.ok(guide.includes("Prusa Account"), "the guide says it needs an account");
});

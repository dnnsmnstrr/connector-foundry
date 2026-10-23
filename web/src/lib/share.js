// Hand a rendered model (an STL or 3MF) to the device's share sheet, or
// save it when there is no sheet that takes it — the phone path to Prusa
// EasyPrint (printables.com/slice), which only accepts a model uploaded
// from the device: share or save the file here, then upload it there.
// The "Print with EasyPrint…" sheet reads EASYPRINT_* for its steps;
// docs/GETTING_STARTED.md ("Print from a phone with EasyPrint") writes the
// same steps by hand, so a change to one is a change to both
// (tests/unit/share.test.js holds the guide to the link and the upload
// path only).
//
// The activation contract: navigator.share() requires and CONSUMES
// transient user activation (5 s in Blink's navigator_share.cc and
// WebKit's Navigator.cpp alike), so shareOrDownload() must be called
// from the click handler's own task with the bytes already in hand —
// never after awaiting a render. Both functions below call share()
// synchronously, before their first await, so the activation is still
// live when the call is made.
//
// What each engine does with a file (MDN browser-compat-data, the Web
// Share spec, and the engine sources, read 2026-10-23):
//   - share() with files: Safari 14+ (iOS and macOS), Chrome Android 76+,
//     Chrome desktop 89+ (Windows/ChromeOS; macOS from 128), Edge 81+,
//     Samsung Internet 11+. Firefox shares no files. Secure context only.
//   - Chromium (chrome/browser/webshare/share_service_impl.cc and its
//     Android counterpart ShareServiceImpl.java) refuses any file whose
//     extension and MIME type are not on its allowlist — images, audio,
//     video, text, CSV, HTML, CSS and PDF — and rejects share() with
//     NotAllowedError ("Permission denied"). canShare({ files }) says
//     TRUE for those same files: Blink's CanShareInternal
//     (third_party/blink/renderer/modules/navigator_share.cc) only checks
//     that some field is present. So a model file cannot be shared from
//     Chromium at all, and the right behaviour there is the download.
//     Chromium engines are the ones with navigator.userAgentData (Safari
//     and Firefox do not implement it), which is the signal used here.
//   - WebKit's share() (Source/WebCore/page/Navigator.cpp) has no type or
//     size check; canShare({ files }) is false only when the File API is
//     off. The share sheet offers Save to Files, AirDrop and the apps.
//   - A URL-only share({ url, title }) works on every engine that has
//     share(): Safari 12.1, Chrome Android 61, Chrome desktop 128 (89 on
//     Windows/ChromeOS), Edge 93; Firefox desktop has no share().
//
// share() rejections: AbortError is the user dismissing the sheet — and
// also the engine finding no share target at all (Blink's
// share_service_impl.cc reports CANCELED for both) — so nothing further
// happens on it. NotAllowedError (the allowlist, or no activation left),
// TypeError (bad data), InvalidStateError (a share already in progress)
// and anything else fall back to the download, which still works.
//
// The desktop app (Electron, the `.desktop` class on <html>) has no share
// sheet; callers pass `desktop: true` and get the download/copy path.
// Nothing here touches the DOM except through its parameters, so the
// module is unit-tested in Node with fake navigators.
import { downloadBlob } from "./download.js";

export const EASYPRINT_URL = "https://www.printables.com/slice";

/** What the sheet tells the user to do, in order. */
export const EASYPRINT_STEPS = Object.freeze([
  "Save or share the file to this device (Save to Files on an iPhone or iPad; Downloads elsewhere).",
  "Open EasyPrint and sign in with a Prusa Account.",
  "Models → Add… → Upload model, pick the file, choose the printer, Print.",
]);

export const EASYPRINT_NOTE =
  "EasyPrint takes STL and 3MF files and needs a Prusa Account; it has no way for a website to send a model in.";

/**
 * The file extensions Chromium's share service lets through
 * (kPermittedExtensions in chrome/browser/webshare/share_service_impl.cc,
 * mirrored by ShareServiceImpl.java on Android): the extensions of the
 * audio/*, image/*, video/*, text/plain, text/csv, text/html, text/css
 * and application/pdf types. Lowercase, no dot. navigator.canShare() does
 * NOT consult this list — Blink's CanShareInternal only checks that a
 * field is present — so it has to be checked here before share() is
 * called, or the call rejects with NotAllowedError after the user already
 * clicked. Typed read-only: Object.freeze() cannot stop Set.add().
 * @type {ReadonlySet<string>}
 */
export const CHROMIUM_SHARE_EXTENSIONS = Object.freeze(
  new Set([
    "avif",
    "bmp",
    "css",
    "csv",
    "ehtml",
    "flac",
    "gif",
    "htm",
    "html",
    "ico",
    "jfif",
    "jpeg",
    "jpg",
    "m4a",
    "mp3",
    "mp4",
    "mpeg",
    "mpg",
    "oga",
    "ogg",
    "ogm",
    "ogv",
    "opus",
    "pdf",
    "pjp",
    "pjpeg",
    "png",
    "shtm",
    "shtml",
    "svg",
    "svgz",
    "text",
    "tif",
    "tiff",
    "txt",
    "wav",
    "weba",
    "webm",
    "webp",
    "xbm",
  ]),
);

/**
 * The part of a Navigator these helpers read. Tests pass a plain object;
 * `userAgentData` is checked with `in` because TypeScript's DOM library
 * does not declare it (isEditableTarget.js notes the same).
 * @typedef {object} ShareNavigator
 * @property {(data: ShareData) => Promise<void>} [share]
 * @property {(data?: ShareData) => boolean} [canShare]
 */

/**
 * @typedef {object} ShareOptions
 * @property {ShareNavigator} [nav] the navigator to ask; defaults to the page's
 * @property {boolean} [desktop] true in the desktop app, which has no share sheet
 */

/** @param {string} name */
function extensionOf(name) {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * The MIME type a model file is shared with, by its extension. IANA
 * registers model/stl and model/3mf; anything else is opaque bytes.
 * @param {string} name
 */
function modelMimeType(name) {
  const ext = extensionOf(name);
  if (ext === "stl") return "model/stl";
  if (ext === "3mf") return "model/3mf";
  return "application/octet-stream";
}

/**
 * The File that share() and the download take: the rendered bytes under
 * the name the user will find in Files or Downloads.
 * @param {ArrayBuffer | ArrayBufferView} bytes
 * @param {string} name e.g. "bracket.stl"
 * @param {string} [type] MIME type; by extension when left out
 * @returns {File}
 */
export function modelFile(bytes, name, type = modelMimeType(name)) {
  // TypeScript 5.7's DOM library keeps a view over a SharedArrayBuffer
  // out of BlobPart; the File constructor copies any view, and the
  // render pipeline and fflate hand back ordinary ones (typed as a view
  // over either), so the assertion only names what runs.
  return new File([/** @type {BlobPart} */ (bytes)], name, { type });
}

/**
 * Whether share() will put this file on a share sheet: false in the
 * desktop app, without the Web Share API, when canShare() says no (or
 * throws, as an old WebKit did on an unexpected field), and on Chromium
 * for any extension off its allowlist, since its canShare() says yes to
 * files its share() then refuses.
 * @param {File} file
 * @param {ShareOptions} [options]
 * @returns {boolean}
 */
export function canShareFile(file, { nav = globalThis.navigator, desktop = false } = {}) {
  if (desktop || !nav || typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
  let allowed;
  try {
    allowed = nav.canShare({ files: [file] });
  } catch {
    return false;
  }
  if (!allowed) return false;
  if ("userAgentData" in nav && !CHROMIUM_SHARE_EXTENSIONS.has(extensionOf(file.name))) return false;
  return true;
}

/** @param {unknown} error */
function isAbort(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    /** @type {{ name?: unknown }} */ (error).name === "AbortError"
  );
}

/**
 * Shares the file, or saves it where sharing is unavailable or refused.
 * Call it from the click handler's task with the bytes in hand (see the
 * header): share() is invoked before the first await. "cancelled" means
 * the user closed the sheet (or there was nothing to share to), and
 * nothing else happened.
 * @param {File} file from modelFile()
 * @param {ShareOptions & { download?: (data: Blob, filename: string, type: string) => void }} [options]
 *   `download` is downloadBlob unless a test passes a spy
 * @returns {Promise<"shared" | "cancelled" | "downloaded">}
 */
export async function shareOrDownload(
  file,
  { nav = globalThis.navigator, desktop = false, download = downloadBlob } = {},
) {
  if (!canShareFile(file, { nav, desktop })) {
    download(file, file.name, file.type);
    return "downloaded";
  }
  try {
    await nav.share({ files: [file], title: file.name });
    return "shared";
  } catch (error) {
    if (isAbort(error)) return "cancelled";
    download(file, file.name, file.type);
    return "downloaded";
  }
}

/**
 * Whether share() will take a URL: not in the desktop app, and only with
 * the API; canShare({ url }) is consulted when the engine has it (Safari
 * 12.1 and Chrome Android 61 had share() before canShare()).
 * @param {string} url
 * @param {ShareOptions} [options]
 * @returns {boolean}
 */
export function canShareLink(url, { nav = globalThis.navigator, desktop = false } = {}) {
  if (desktop || !nav || typeof nav.share !== "function") return false;
  if (typeof nav.canShare !== "function") return true;
  try {
    return !!nav.canShare({ url });
  } catch {
    return false;
  }
}

/**
 * A link to the app that another device can open: the page's own address
 * in a browser; in the desktop app, whose foundry://app/ address opens
 * nowhere else (no system handler is registered for the scheme), the same
 * state — the hash, which is where the app keeps it — on the website's
 * app. That may run a newer or older release than the desktop app; a
 * bench link reads the same either way.
 * @param {string} href the page's address
 * @param {{ desktop?: boolean, siteUrl: string }} options `siteUrl` is the
 *   website's root, ending in a slash (commandCatalog's SITE_URL)
 * @returns {string}
 */
export function shareableAppLink(href, { desktop = false, siteUrl }) {
  if (!desktop) return href;
  return `${siteUrl}app/${new URL(href).hash}`;
}

/**
 * Shares a link, or copies it where sharing is unavailable or refused.
 * Same activation contract as shareOrDownload(). `copy` is the caller's
 * clipboard action (commandCatalog's copyLink, which reports through the
 * HUD itself); without one and without share() there is nothing to do,
 * and "unavailable" says so.
 * @param {string} url
 * @param {string} title the share sheet's caption
 * @param {ShareOptions & { copy?: (url: string) => void | Promise<void> }} [options]
 * @returns {Promise<"shared" | "cancelled" | "copied" | "unavailable">}
 */
export async function shareOrCopyLink(
  url,
  title,
  { nav = globalThis.navigator, desktop = false, copy } = {},
) {
  if (canShareLink(url, { nav, desktop })) {
    try {
      await nav.share({ url, title });
      return "shared";
    } catch (error) {
      if (isAbort(error)) return "cancelled";
    }
  }
  if (typeof copy !== "function") return "unavailable";
  await copy(url);
  return "copied";
}

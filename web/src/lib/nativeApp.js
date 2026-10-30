// The app inside the iOS and Android store apps (Capacitor: web/ios/,
// web/android/, capacitor.config.json). They load the same build the
// website serves, from the app's own files, so almost nothing here knows
// it is in one; this module is the little that does.
//
// Saving. A browser hands a download to its own sheet (iOS asks where to
// put every file) or its downloads folder. The store apps save straight
// into a folder of the app's own, the Filesystem plugin's
// Directory.Documents:
// - iOS: the app's Documents folder, which Files lists as On My iPhone
//   (or iPad) › Foundry (the app's display name), since Info.plist sets
//   UIFileSharingEnabled and LSSupportsOpeningDocumentsInPlace.
// - Android: "Connector Foundry" in the shared Documents folder, where
//   the Files app and a slicer can open it. Android 11 and later let an
//   app write the files it creates there without asking; Android 10 and
//   older need the storage permission, which the plugin asks for on the
//   first save (AndroidManifest.xml declares it up to those versions only).
// A file of the same name is never overwritten: the next free "name 2",
// "name 3" is taken, as browsers do with downloads.
//
// Back (Android). The system's back gesture reaches the shell, not the
// page: Capacitor's default went back in the web view's history, of which
// the app keeps none (the URL mirror replaces its entry), and otherwise
// closed the app, with a dialog or the drawer open as much as without.
// startNativeApp() takes it over (@capacitor/app's backButton): it closes
// the topmost open dialog the way Escape does (its "cancel" event, which
// Modal and the command palette handle), else asks whatever registered
// with onNativeBack() last (the open drawer, App.jsx), else puts the app
// in the background, as Android's own apps do at their root.
//
// The plugins are imported only in the store apps, so the website's bundle
// does not carry them.

export const APP_FOLDER = "Connector Foundry";

/**
 * "ios" or "android" in the store apps, else null (a browser, the desktop
 * app). Capacitor puts its bridge on window before the page's scripts run.
 * @param {any} [win]
 * @returns {"ios" | "android" | null}
 */
export function nativePlatform(win = globalThis.window) {
  const capacitor = win?.Capacitor;
  if (!capacitor || capacitor.isNativePlatform?.() !== true) return null;
  const platform = capacitor.getPlatform?.();
  return platform === "ios" || platform === "android" ? platform : null;
}

/** Whether the page runs in one of the store apps. */
export function isNativeApp() {
  return nativePlatform() !== null;
}

/**
 * Where a saved file goes, relative to Directory.Documents: the app's own
 * Documents folder on iOS is already the app's folder; on Android the
 * shared one needs a folder of the app's in it.
 * @param {"ios" | "android"} platform
 * @param {string} name
 */
export function appFolderPath(platform, name) {
  return platform === "android" ? `${APP_FOLDER}/${name}` : name;
}

/**
 * The words for where saved files are, in the platform's own terms.
 * @param {"ios" | "android"} platform
 */
export function appFolderLabel(platform) {
  return platform === "android" ? `Documents › ${APP_FOLDER}` : "Files › Foundry";
}

/**
 * The first of "name.ext", "name 2.ext", "name 3.ext"… that `exists` says
 * is free. Gives up after 999 and takes the last, rather than loop for
 * ever on a filesystem that says everything exists.
 * @param {string} name
 * @param {(candidate: string) => Promise<boolean>} exists
 * @returns {Promise<string>}
 */
export async function freeName(name, exists) {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let candidate = name;
  for (let n = 2; n <= 999 && (await exists(candidate)); n++) candidate = `${stem} ${n}${ext}`;
  return candidate;
}

/**
 * Bytes as base64, which is how the plugin's bridge carries binary data.
 * In chunks: String.fromCharCode(...bytes) on a whole STL of several
 * megabytes overflows the call stack.
 * @param {Uint8Array} bytes
 */
export function toBase64(bytes) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

/**
 * Saves a file into the app's folder (see above) and resolves to the name
 * it was saved under. Rejects when the plugin fails or, on an old Android,
 * the storage permission is refused.
 * @param {Blob} blob
 * @param {string} name
 * @returns {Promise<string>}
 */
export async function saveToAppFolder(blob, name) {
  const platform = nativePlatform();
  if (!platform) throw new Error("Not in the store app");
  const { Directory, Filesystem } = await import("@capacitor/filesystem");
  const exists = (candidate) =>
    Filesystem.stat({ path: appFolderPath(platform, candidate), directory: Directory.Documents }).then(
      () => true,
      () => false,
    );
  const saved = await freeName(name, exists);
  await Filesystem.writeFile({
    path: appFolderPath(platform, saved),
    data: toBase64(new Uint8Array(await blob.arrayBuffer())),
    directory: Directory.Documents,
    recursive: true,
  });
  return saved;
}

/** @type {(() => void)[]} */
const backHandlers = [];

/**
 * While registered, back on Android calls `close` (when no dialog is open
 * over it): the last registered first. Returns the unregister function; a
 * no-op outside the Android app.
 * @param {() => void} close
 * @returns {() => void}
 */
export function onNativeBack(close) {
  if (nativePlatform() !== "android") return () => {};
  backHandlers.push(close);
  return () => {
    const at = backHandlers.lastIndexOf(close);
    if (at !== -1) backHandlers.splice(at, 1);
  };
}

/**
 * What back does (see above): "dialog", "handler" or "background", for the
 * tests.
 * @param {Document} doc
 * @param {(() => void)[]} handlers
 * @param {() => void} toBackground
 * @returns {"dialog" | "handler" | "background"}
 */
export function goBack(doc, handlers, toBackground) {
  const dialogs = doc.querySelectorAll(/** @type {"dialog"} */ ("dialog[open]"));
  const top = dialogs[dialogs.length - 1];
  if (top) {
    const cancel = new Event("cancel", { cancelable: true });
    top.dispatchEvent(cancel);
    // A dialog nobody handles closes as Escape would close it.
    if (!cancel.defaultPrevented) top.close();
    return "dialog";
  }
  const handler = handlers[handlers.length - 1];
  if (handler) {
    handler();
    return "handler";
  }
  toBackground();
  return "background";
}

/** Starts what the store apps do natively; main.jsx calls it once, before the first render. */
export function startNativeApp() {
  if (nativePlatform() !== "android") return;
  import("@capacitor/app").then(({ App }) =>
    App.addListener("backButton", () => {
      goBack(document, backHandlers, () => {
        App.minimizeApp();
      });
    }),
  );
}

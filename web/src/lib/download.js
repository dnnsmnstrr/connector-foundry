import { showCommandHud } from "./commandHud.js";
import { appFolderLabel, nativePlatform, saveToAppFolder } from "./nativeApp.js";

/**
 * What an export hands its file to: downloadBlob(), or the save function
 * captureDownload() gives a command in its place. The data is a Blob, or
 * what one is made of: a render's bytes (an ArrayBuffer or a view of one),
 * or text.
 * @typedef {(data: Blob | ArrayBuffer | ArrayBufferView | string, filename: string, type?: string) => void} SaveFile
 */

/** @param {Parameters<SaveFile>[0]} data @param {string} type */
const asBlob = (data, type) =>
  data instanceof Blob ? data : new Blob([/** @type {BlobPart} */ (data)], { type });

// Hand the browser a file to save. Every export goes through here: the
// Library's STL, the Bench's bodies, .scad and config, the Holes tab's
// models, the settings backup and the print sheet's files. In the iOS and
// Android store apps the file goes straight into the app's own folder
// instead (lib/nativeApp.js), with no sheet asking where, and the HUD says
// where it went. A coding agent's export in the desktop app never gets
// here: its command is handed captureDownload()'s save function instead.
/** @type {SaveFile} */
export function downloadBlob(data, filename, type = "application/octet-stream") {
  const blob = asBlob(data, type);
  const platform = nativePlatform();
  if (platform) {
    saveToAppFolder(blob, filename).then(
      (saved) => showCommandHud(`Saved ${saved} to ${appFolderLabel(platform)}`, SAVED_NOTE_MS),
      (error) => showCommandHud(`Couldn't save ${filename}: ${error?.message ?? error}`, SAVED_NOTE_MS),
    );
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Not revoked synchronously: Safari starts the download after click()
  // returns, and a URL revoked by then downloads an empty file. On an
  // iPhone the download waits for the user to confirm a sheet, which can
  // take well over a second, so the URL lives a minute (FileSaver.js
  // keeps its for 40 s for the same reason) — a few megabytes the render
  // cache holds anyway — and goes when the page does.
  const revoke = () => {
    clearTimeout(timer);
    window.removeEventListener("pagehide", revoke);
    URL.revokeObjectURL(url);
  };
  const timer = setTimeout(revoke, REVOKE_AFTER_MS);
  window.addEventListener("pagehide", revoke);
}

/**
 * Runs `run` with a save function to use in place of downloadBlob(), and
 * resolves with the first file `run` hands it. For a coding agent's export
 * in the desktop app (lib/webmcp.js's run_command): the file goes to the
 * main process, which saves it where the agent asked without a Save
 * dialog.
 *
 * The export gets its own save function rather than downloadBlob() being
 * intercepted, because most exports render first and the file comes a
 * while after `run` returns: a download the user starts in the meantime
 * is theirs, with its Save dialog, and must not land where the agent
 * asked in place of the agent's file. An export that fails says so in its
 * tab and never hands over a file, which is why there is a limit; a file
 * that comes after the limit, or a second one, is downloaded as any other.
 * @param {(save: SaveFile) => void} run
 * @param {number} timeoutMs
 * @returns {Promise<{ blob: Blob, filename: string }>}
 */
export function captureDownload(run, timeoutMs) {
  return new Promise((resolve, reject) => {
    let waiting = true;
    const timer = setTimeout(() => {
      waiting = false;
      reject(
        new Error(
          `No file came within ${Math.round(timeoutMs / 1000)} s. The export may have failed (get_app_state ` +
            "shows the tab's error), or a question in the window may be waiting for the user.",
        ),
      );
    }, timeoutMs);
    /** @type {SaveFile} */
    const save = (data, filename, type = "application/octet-stream") => {
      if (!waiting) {
        downloadBlob(data, filename, type);
        return;
      }
      waiting = false;
      clearTimeout(timer);
      resolve({ blob: asBlob(data, type), filename });
    };
    try {
      run(save);
    } catch (err) {
      waiting = false;
      clearTimeout(timer);
      reject(err);
    }
  });
}

const REVOKE_AFTER_MS = 60_000;
// Long enough to read a folder's name.
const SAVED_NOTE_MS = 4000;

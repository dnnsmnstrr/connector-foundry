import { showCommandHud } from "./commandHud.js";
import { appFolderLabel, nativePlatform, saveToAppFolder } from "./nativeApp.js";

// Hand the browser a file to save. Every export goes through here: the
// Library's STL, the Bench's bodies, .scad and config, the Holes tab's
// models, the settings backup and the print sheet's files. In the iOS and
// Android store apps the file goes straight into the app's own folder
// instead (lib/nativeApp.js), with no sheet asking where, and the HUD says
// where it went. A coding agent's export in the desktop app is taken
// before any of that (captureDownload()) and saved by the main process.
export function downloadBlob(data, filename, type = "application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  if (capture) {
    const take = capture;
    capture = null;
    take({ blob, filename });
    return;
  }
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

/** @type {((file: { blob: Blob, filename: string }) => void) | null} */
let capture = null;

/**
 * Runs `run` and resolves with the next file it hands downloadBlob(),
 * which then saves nothing itself. For a coding agent's export in the
 * desktop app (lib/webmcp.js's run_command): the file goes to the main
 * process, which saves it where the agent asked without a Save dialog.
 * Most exports render first, so the file can come a while after `run`
 * returns; one that fails says so in its tab and never comes, which is
 * why there is a limit.
 * @param {() => void} run
 * @param {number} timeoutMs
 * @returns {Promise<{ blob: Blob, filename: string }>}
 */
export function captureDownload(run, timeoutMs) {
  if (capture)
    return Promise.reject(new Error("Another export is still running; try again when it is done."));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (capture !== take) return;
      capture = null;
      reject(
        new Error(
          `No file came within ${Math.round(timeoutMs / 1000)} s. The export may have failed (get_app_state ` +
            "shows the tab's error), or a question in the window may be waiting for the user.",
        ),
      );
    }, timeoutMs);
    /** @param {{ blob: Blob, filename: string }} file */
    const take = (file) => {
      clearTimeout(timer);
      resolve(file);
    };
    capture = take;
    try {
      run();
    } catch (err) {
      clearTimeout(timer);
      if (capture === take) capture = null;
      reject(err);
    }
  });
}

const REVOKE_AFTER_MS = 60_000;
// Long enough to read a folder's name.
const SAVED_NOTE_MS = 4000;

import { showCommandHud } from "./commandHud.js";
import { appFolderLabel, nativePlatform, saveToAppFolder } from "./nativeApp.js";

// Hand the browser a file to save. Every export goes through here: the
// Library's STL, the Bench's bodies, .scad and config, the Holes tab's
// models, the settings backup and the print sheet's files. In the iOS and
// Android store apps the file goes straight into the app's own folder
// instead (lib/nativeApp.js), with no sheet asking where, and the HUD says
// where it went.
export function downloadBlob(data, filename, type = "application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
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

const REVOKE_AFTER_MS = 60_000;
// Long enough to read a folder's name.
const SAVED_NOTE_MS = 4000;

// Hand the browser a file to save. Library's STL download, the Bench's
// per-body STL exports and its .scad export all go through here.
export function downloadBlob(data, filename, type = "application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
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

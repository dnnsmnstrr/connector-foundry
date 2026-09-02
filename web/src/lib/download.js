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
  // returns, and a URL revoked by then downloads an empty file.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

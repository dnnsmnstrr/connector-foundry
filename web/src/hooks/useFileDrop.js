import { useRef, useState } from "react";

/**
 * A file dragged onto an element: the handlers to spread on it, and whether
 * a file is over it now — for FileDropzone, the command palette and the
 * empty Bench and Holes tabs. Only drags that carry files count; a dragged
 * text selection or link is left alone. Nested dragenter/dragleave pairs
 * fire as the pointer crosses the element's children, so a counter keeps
 * `over` on until the last leave. The browser's own handling of a dropped
 * file — opening it in place of the app, losing the bench — is always
 * prevented here, so with `onFile` null a drop is refused (the cursor says
 * so) rather than navigating away.
 * @param {((file: File) => void) | null} onFile
 */
export function useFileDrop(onFile) {
  const depth = useRef(0);
  const [over, setOver] = useState(false);
  /** @param {import("react").DragEvent} e */
  const carriesFiles = (e) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

  return {
    over: over && Boolean(onFile),
    handlers: {
      /** @param {import("react").DragEvent} e */
      onDragEnter(e) {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      },
      /** @param {import("react").DragEvent} e */
      onDragOver(e) {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = onFile ? "copy" : "none";
      },
      /** @param {import("react").DragEvent} e */
      onDragLeave(e) {
        if (!carriesFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      },
      /** @param {import("react").DragEvent} e */
      onDrop(e) {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file && onFile) onFile(file);
      },
    },
  };
}

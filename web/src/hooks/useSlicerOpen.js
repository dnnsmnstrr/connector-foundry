import { useEffect, useRef, useState } from "react";
import { showCommandHud } from "../lib/commandHud.js";
import { hasDesktopSlicer, openInDesktopSlicer } from "../lib/desktopBridge.js";
import { stlBodiesTo3mf } from "../lib/threeMfWrite.js";

const LABELS = {
  idle: "Open in Slicer",
  opening: "Opening in slicer…",
  opened: "Opened in slicer",
};

export const SLICER_OPEN_TITLE =
  "Writes a temporary 3MF file (every body in one file on the Bench) and opens it straight in your desktop slicer";

/**
 * State for an "Open in Slicer" button in the desktop app: `open(bodiesPromise, filename)`
 * packs the rendered STL bodies into a 3MF and hands the temporary file to the
 * user's desktop slicer (desktop/slicer.cjs). A failure goes to `onError`.
 * @param {(message: string) => void} onError
 */
export function useSlicerOpen(onError) {
  const [state, setState] = useState(/** @type {"idle" | "opening" | "opened"} */ ("idle"));
  const resetTimer = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  useEffect(() => () => clearTimeout(resetTimer.current ?? undefined), []);

  /**
   * @param {Promise<Array<{ name: string, stlBuffer: ArrayBuffer | Uint8Array }>> | Array<{ name: string, stlBuffer: ArrayBuffer | Uint8Array }>} bodiesPromise
   * @param {string} filename
   */
  function open(bodiesPromise, filename) {
    clearTimeout(resetTimer.current ?? undefined);
    setState("opening");
    Promise.resolve(bodiesPromise)
      .then((bodies) => {
        const bytes = stlBodiesTo3mf(bodies.map(({ name, stlBuffer }) => ({ name, stl: stlBuffer })));
        return openInDesktopSlicer(bytes, filename);
      })
      .then(
        (result) => {
          setState("opened");
          showCommandHud(result?.slicer ? `Opened in ${result.slicer}` : "Opened in slicer");
          resetTimer.current = setTimeout(() => setState("idle"), 2500);
        },
        (err) => {
          setState("idle");
          onError(err?.message ?? String(err));
        },
      );
  }

  return {
    available: hasDesktopSlicer(),
    label: LABELS[state],
    opening: state === "opening",
    open,
  };
}

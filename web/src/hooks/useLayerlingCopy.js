import { useEffect, useRef, useState } from "react";
import { copyForLayerling } from "../lib/layerlingClipboard.js";

const LABELS = {
  idle: "Copy for Layerling",
  copying: "Copying…",
  copied: "Copied — paste in Layerling",
};

export const LAYERLING_COPY_TITLE = "Copies the model so Ctrl/⌘+V in Layerling (layerling.com) pastes it as an editable mesh";

// State for a "Copy for Layerling" button: `copy(bodiesPromise)` must be
// called straight from the click (see copyForLayerling()); the label
// says "Copied" for a moment afterwards. A failure goes to `onError`.
export function useLayerlingCopy(onError) {
  const [state, setState] = useState("idle");
  const resetTimer = useRef(null);
  useEffect(() => () => clearTimeout(resetTimer.current), []);

  function copy(bodiesPromise) {
    clearTimeout(resetTimer.current);
    setState("copying");
    copyForLayerling(bodiesPromise).then(
      () => {
        setState("copied");
        resetTimer.current = setTimeout(() => setState("idle"), 2500);
      },
      (err) => {
        setState("idle");
        onError(err.name === "NotAllowedError" ? "The browser did not allow copying to the clipboard." : err.message);
      },
    );
  }

  return { label: LABELS[state], copying: state === "copying", copy };
}

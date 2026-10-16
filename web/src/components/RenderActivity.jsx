import { useRenderActivity } from "../hooks/useRenderActivity.js";
import { cancelRenders } from "../lib/openscad-client.js";

// The nav's "Rendering…" status and its "Cancel renders" button, while any
// OpenSCAD render is in flight anywhere in the app. A component of its own
// so that the count, which changes at the start and the end of every render,
// re-renders these two elements only — subscribed in App, it re-rendered App
// and with it the whole active mode, twice per render.
export default function RenderActivity() {
  const rendersInFlight = useRenderActivity();
  return (
    <>
      {/* Always mounted so the live region exists before it has news;
          hidden (not unmounted) when idle. */}
      <span
        className="render-indicator"
        role="status"
        aria-live="polite"
        hidden={rendersInFlight === 0}
        title={rendersInFlight > 1 ? `${rendersInFlight} renders in progress` : "Render in progress"}
      >
        <span className="render-spinner" aria-hidden="true" />
        <span className="render-indicator-text">Rendering…</span>
      </span>
      {rendersInFlight > 0 && (
        <button type="button" className="mode-tab" onClick={cancelRenders}>
          Cancel renders
        </button>
      )}
    </>
  );
}

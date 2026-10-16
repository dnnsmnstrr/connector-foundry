import { useGridSnap } from "../../hooks/useGridSnap.js";
import { GRID_SNAP_OPTIONS, setGridSnap } from "../../lib/uiPrefs.js";

// The Grid in the Holes sidebar's Snapping section: the same setting as the
// viewer's Grid menu and Settings' (uiPrefs.js's gridSnap), so placement has
// one grid, not two. A click on a face away from every snap point lands on
// it, a dragged hole moves in its steps, an arrow key nudges by one, and a
// handle snaps a cutout's size to it; Off places and drags exactly (an
// arrow key still moves 0.5 mm). No props.
export default function GridField() {
  const grid = useGridSnap();
  return (
    <label
      className="field bench-offset-field holes-inset-field holes-grid-field"
      title="A click away from the snap points lands on this grid, a dragged hole moves in its steps, an arrow key nudges the selected holes by one (Shift: ten), and the handles snap a cutout's size to it. Shift places or drags freely. The Grid menu in the 3D view is the same setting."
    >
      <span className="field-label">Grid</span>
      <select
        value={String(grid)}
        onChange={(e) => {
          setGridSnap(Number(e.target.value));
          // Let go of the focus, as the viewer's Grid menu does: the arrow
          // keys pressed next are for nudging the holes on the new grid,
          // which a focused select would take (or ignore) instead.
          e.target.blur();
        }}
      >
        {GRID_SNAP_OPTIONS.map((mm) => (
          <option key={mm} value={String(mm)}>
            {mm === 0 ? "Off" : `${mm} mm`}
          </option>
        ))}
      </select>
    </label>
  );
}

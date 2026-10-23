import { memo, useRef } from "react";
import { formatPoint, holeLabel, holeMeta } from "../../lib/screwHoles.js";
import { getPreset, specMatchesPreset } from "../../lib/screwPresets.js";
import ScrewIcon from "./ScrewIcon.jsx";

// One row of the Holes sidebar's list: the hole's cross-section icon, its
// number, preset (or description) and place, and a remove button.
// Memoised: the list can hold a hundred holes (a Repeat pattern), each
// with an SVG icon, and the Holes tab re-renders on every snap change the
// pointer makes over the model — a row only re-renders when its own hole,
// number or selection does, so `onPick` and `onRemove` must keep their
// identity across renders.
//
// `hole` is the hole, `number` its place in the list (1-based), `selected`
// whether it is in the selection; `onPick(id, shiftKey)` is a click on the
// row (Shift adds or removes it; so does a long press with a finger, which
// has no Shift), `onRemove(id)` the ✕.

// How long a finger rests on a row before the press means "add to the
// selection": the usual long-press duration, longer than a tap.
const LONG_PRESS_MS = 500;

/**
 * @param {{
 *   hole: any,
 *   number: number,
 *   selected: boolean,
 *   onPick: (id: string, shiftKey: boolean) => void,
 *   onRemove: (id: string) => void,
 * }} props
 */
function HoleRow({ hole, number, selected, onPick, onRemove }) {
  const preset = getPreset(hole.presetId);
  const pressTimer = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  const longPressed = useRef(false);
  const endPress = () => {
    if (pressTimer.current !== null) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  return (
    <li className={selected ? "holes-row is-selected" : "holes-row"}>
      <button
        type="button"
        className="holes-row-main"
        aria-pressed={selected}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse") return;
          longPressed.current = false;
          endPress();
          pressTimer.current = setTimeout(() => {
            pressTimer.current = null;
            longPressed.current = true;
            onPick(hole.id, true);
          }, LONG_PRESS_MS);
        }}
        onPointerUp={endPress}
        onPointerCancel={endPress}
        onPointerLeave={endPress}
        onClick={(e) => {
          // The click that follows a long press's release would undo it.
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          onPick(hole.id, e.shiftKey);
        }}
        title={`${holeLabel(hole)} — Shift-click (or press and hold) to select several`}
      >
        <ScrewIcon spec={hole.spec} screw={preset?.screw ?? null} className="screw-icon-small" />
        <span className="holes-row-text">
          <span className="holes-row-title">
            {number}. {preset ? preset.name : holeLabel(hole)}
            {preset && !specMatchesPreset(hole.spec, hole.presetId) ? " (edited)" : ""}
          </span>
          <span className="muted holes-row-meta">
            {holeMeta(hole)} · [{formatPoint(hole.point)}]
          </span>
        </span>
      </button>
      <button
        type="button"
        className="bench-remove"
        aria-label={`Remove hole ${number}`}
        title="Remove this hole"
        onClick={() => onRemove(hole.id)}
      >
        ✕
      </button>
    </li>
  );
}

export default memo(HoleRow);

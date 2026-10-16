import { memo, useId, useMemo, useState } from "react";
import { presetGroups } from "../../lib/screwPresets.js";
import { getPresetGroupsOpen, setPresetGroupOpen } from "../../lib/uiPrefs.js";
import ScrewIcon from "./ScrewIcon.jsx";

// The screw presets as a grid of cross-section icons, grouped by kind
// (socket cap, countersunk, heat-set insert, …). `value` is the preset
// id currently in effect; picking one calls onPick(preset) and the
// caller copies its spec into whatever it is editing (the next hole, or
// the selected one).
//
// A search box over the groups filters by name, short label and group;
// every word typed has to match. Each group's heading opens and closes
// it. Closed by default, except the group holding the preset in effect;
// a group opened or closed by hand stays that way (uiPrefs.js). While
// searching, every group with a match shows open.
//
// Memoised (the export below): an open group is a grid of SVG icons, and
// the Holes tab re-renders on every snap change under the pointer; with
// an `onPick` that keeps its identity, the grid re-renders only when the
// preset in effect does.
/** @param {{ value: string | null, onPick: (preset: any) => void }} props */
function PresetPicker({ value, onPick }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [openByHand, setOpenByHand] = useState(getPresetGroupsOpen);
  const groups = useMemo(() => presetGroups(), []);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = words.length
    ? groups
        .map(({ group, presets }) => ({
          group,
          presets: presets.filter((preset) => matches(preset, group, words)),
        }))
        .filter(({ presets }) => presets.length)
    : groups;

  return (
    <div className="holes-presets">
      <input
        type="search"
        className="search-input holes-preset-search"
        placeholder="Search hole types…"
        aria-label="Search hole types"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && query) {
            e.preventDefault();
            e.stopPropagation();
            setQuery("");
          }
        }}
      />
      {shown.length === 0 && (
        <p className="muted no-results" role="status">
          No hole types match "{query}".
        </p>
      )}
      {shown.map(({ group, presets }) => {
        const holdsValue = presets.some((preset) => preset.id === value);
        const open = words.length > 0 || (openByHand[group] ?? holdsValue);
        const gridId = `${id}-${slug(group)}`;
        return (
          <section
            key={group}
            className={open ? "holes-preset-group is-open" : "holes-preset-group"}
            aria-label={group}
          >
            <h4>
              <button
                type="button"
                className="holes-preset-group-toggle"
                aria-expanded={open}
                aria-controls={gridId}
                disabled={words.length > 0}
                onClick={() => setOpenByHand(setPresetGroupOpen(group, !open))}
              >
                <span className="holes-preset-group-caret" aria-hidden="true" />
                <span>{group}</span>
                <span className="holes-preset-group-count">{presets.length}</span>
              </button>
            </h4>
            {open && (
              <div id={gridId} className="holes-preset-grid" role="listbox" aria-label={group}>
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    role="option"
                    aria-selected={preset.id === value}
                    className={preset.id === value ? "holes-preset-button is-active" : "holes-preset-button"}
                    onClick={() => onPick(preset)}
                    aria-label={preset.name}
                    title={`${preset.name} — ${describe(preset.spec)}`}
                  >
                    <ScrewIcon spec={preset.spec} screw={preset.screw} />
                    <span className="holes-preset-name">{shortName(preset)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

export default memo(PresetPicker);

// Every word somewhere in the preset's name, short label or group.
function matches(preset, group, words) {
  const text = `${preset.name} ${preset.short ?? ""} ${group}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

// "M3" under the icon when the group already says what kind it is; a
// preset that names its own short form (the connector slots) uses that.
function shortName(preset) {
  if (preset.short) return preset.short;
  const m = preset.name.match(/^(M\d+(?:\.\d+)?)\b/);
  if (m) return m[1];
  const mm = preset.name.match(/(\d+(?:\.\d+)?) mm/);
  if (mm) return `${mm[1]} mm`;
  return preset.name;
}

function describe(spec) {
  if (spec.kind === "openconnect")
    return `openConnect slot, lock nub ${spec.lock}, ${spec.sideClearance} mm side / ${spec.depthClearance} mm depth clearance`;
  if (spec.kind === "thread")
    return `openGrid snap thread, ${spec.depth > 0 ? `${spec.depth} mm deep` : "through"}, ${spec.clearance} mm clearance`;
  if (spec.kind === "extrusion")
    return `Socket for a 2020 extrusion's end, ${spec.depth > 0 ? `${spec.depth} mm deep` : "through"}, ${spec.clearance} mm clearance${spec.keys ? ", keyed into its slots" : ""}${spec.bolt ? ", M5 bolt hole" : ""}`;
  if (spec.kind === "klippt")
    return `KLIPPT clip channel: slides onto a KLIPPT base; ${spec.pocket ? "a drop-in pocket at the entry" : `open, ${spec.runout} mm lead-in`}, ${spec.clearance} mm clearance a side`;
  if (spec.kind === "deckmate")
    return `A DeckMate Innie's own socket, cut into the part: a DeckMate Outie pushes in and slides along to seat, as in an Innie; the floor ${spec.extraDepth} mm deeper than an Innie's`;
  if (spec.kind === "pinhole")
    return `BitBeam pin hole: Ø4.8 with the groove a Technic pin clicks into, ${spec.depth > 0 ? `${spec.depth} mm deep` : "through"}`;
  if (spec.kind === "cylinder")
    return `Round Ø${spec.diameter} mm, ${spec.depth > 0 ? `${spec.depth} mm deep` : "through"}`;
  if (spec.kind === "rectangle")
    return `${spec.width} × ${spec.height} mm cutout${spec.cornerRadius > 0 ? `, ${spec.cornerRadius} mm corner radius` : ""}, ${spec.depth > 0 ? `${spec.depth} mm deep` : "through"}`;
  if (spec.kind === "multiconnect")
    return `MultiConnect slot, ${spec.length} mm channel${spec.onRamp ? (spec.rampEvery ? " with on-ramps every 28 mm" : " with on-ramp") : ", open-ended"}${spec.detent ? ", detent" : ", no detent"}`;
  const bits = [`Ø${spec.diameter} mm`, spec.depth > 0 ? `${spec.depth} mm deep` : "through"];
  if (spec.head === "counterbore") bits.push(`counterbore Ø${spec.headDiameter} × ${spec.headDepth}`);
  if (spec.head === "countersink") bits.push(`countersink Ø${spec.headDiameter}, ${spec.sinkAngle}°`);
  if (spec.head === "hex") bits.push(`hex pocket ${spec.headDiameter} × ${spec.headDepth}`);
  return bits.join(", ");
}

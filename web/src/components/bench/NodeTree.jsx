import { childrenOf, getNode, jointsFor } from "../../lib/assembly.js";
import { slotsForNode, stackSlotFor } from "../../lib/benchLayout.js";
import ParamsEditor from "../ParamsEditor.jsx";
import JointSelect from "./JointSelect.jsx";
import SpinButtons from "./SpinButtons.jsx";

// One node in the "Attached" tree (always a non-root node — root gets
// its own params panel above this list in Bench's sidebar). Renders
// itself and recurses into whatever's attached to IT, to any depth. A
// catalogue part's own further slot (if it has one — see
// benchLayout.js's stackSlotFor()) is a real 3D marker in the scene and
// an "Attach on top" button here, both resolving to the same
// attachAt(nodeId, "bot"); an imported part's arbitrary user-placed
// anchors get one "attach here" button each, since there's no single
// predictable "up" for those.
//
// Clicking the part's name selects it — the same selection a click on
// the part in the scene makes (`selectedId`), so the row lights up when
// the part is picked either way, and the scene's floating ↺/↻ buttons
// and the outline follow. The "Rotation (°)" field is the exact-value
// twin of those buttons: type any angle, or step by 90 with the arrows.
export default function NodeTree({ assembly, partsById, nodeExtents, nodeId, actions, selectedId }) {
  const node = getNode(assembly, nodeId);
  const part = partsById.get(node.partId);
  const parentPart = partsById.get(getNode(assembly, node.parentId).partId);
  const kids = childrenOf(assembly, nodeId);
  const isImported = part.kind === "imported";
  const openSlots = isImported ? slotsForNode(assembly, partsById, nodeExtents, nodeId) : [];
  const stackSlot = isImported ? null : stackSlotFor(assembly, partsById, nodeId);
  const selected = selectedId === nodeId;

  return (
    <li className={selected ? "bench-tree-node is-selected" : "bench-tree-node"}>
      <div className="bench-child-row">
        <button
          type="button"
          className="bench-node-name"
          onClick={() => actions.select(selected ? null : nodeId)}
          aria-pressed={selected}
          title={selected ? "Deselect" : "Select (shows rotate controls in the scene)"}
        >
          {part.name}
        </button>
        <button
          type="button"
          className="bench-remove"
          onClick={() => actions.remove(nodeId)}
          aria-label={`Remove ${part.name} and anything attached to it`}
          title="Remove (and anything attached to it)"
        >
          ✕
        </button>
      </div>
      <div className="bench-child-meta">
        <span className="muted">{node.slotName}</span>
        <JointSelect
          value={node.joint}
          options={jointsFor(parentPart, part)}
          onChange={(joint) => actions.setJoint(nodeId, joint)}
        />
      </div>
      <label className="field bench-offset-field" title="Negative sinks it into whatever it's attached to; positive pulls it away, leaving a gap.">
        Offset (mm)
        <input
          type="number"
          step="any"
          value={node.overlap ?? 0}
          onChange={(e) => {
            if (e.target.value !== "") actions.setOverlap(nodeId, Number(e.target.value));
          }}
        />
      </label>
      <label
        className="field bench-offset-field bench-rotation-field"
        title="Turn about the slot it sits on. Positive is counter-clockwise viewed from above the slot; the arrows step by 90°."
      >
        Rotation (°)
        <span className="bench-rotation-controls">
          <input
            type="number"
            step="90"
            min="-360"
            max="360"
            value={node.spin ?? 0}
            onChange={(e) => {
              if (e.target.value !== "") actions.setSpin(nodeId, Number(e.target.value));
            }}
          />
          <SpinButtons name={part.name} onRotate={(delta) => actions.rotate(nodeId, delta)} />
        </span>
      </label>
      <label
        className="field field-checkbox bench-crop-field"
        title="Everything else is trimmed to this part's vertical outline — edges that stick out past it are cut away. One part at a time; the scene's Crop button is the same switch."
      >
        <input
          type="checkbox"
          checked={assembly.cropTo === nodeId}
          onChange={(e) => actions.setCrop(nodeId, e.target.checked)}
        />
        <span className="field-label">Crop others to this outline</span>
      </label>
      <details className="bench-node-params-details">
        <summary>Parameters</summary>
        <ParamsEditor
          className="bench-node-params"
          part={part}
          params={node.params}
          onChange={(params) => actions.setParams(nodeId, params)}
          allowSavedDefaults={!isImported}
        />
      </details>
      {stackSlot && (
        <div className="bench-node-slots">
          <button
            type="button"
            className="bench-attach-here"
            title="Same as clicking this part's marker in the scene"
            onClick={() => actions.attachAt(nodeId, stackSlot)}
          >
            + Attach on top
          </button>
        </div>
      )}
      {openSlots.length > 0 && (
        <div className="bench-node-slots">
          {openSlots.map((slot) => (
            <button key={slot.name} className="bench-attach-here" onClick={() => actions.attachAt(nodeId, slot.name)}>
              + Attach: {slot.name}
            </button>
          ))}
        </div>
      )}
      {kids.length > 0 && (
        <ul className="bench-child-list bench-child-list-nested">
          {kids.map((kid) => (
            <NodeTree
              key={kid.id}
              assembly={assembly}
              partsById={partsById}
              nodeExtents={nodeExtents}
              nodeId={kid.id}
              actions={actions}
              selectedId={selectedId}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

import { childrenOf, getNode, jointsFor } from "../../lib/assembly.js";
import { slotsForNode, stackSlotFor } from "../../lib/benchLayout.js";
import ParamsEditor from "../ParamsEditor.jsx";
import JointSelect from "./JointSelect.jsx";

// One node in the "Attached" tree (always a non-root node — root gets
// its own params panel above this list in Bench's sidebar). Renders
// itself and recurses into whatever's attached to IT, to any depth. A
// catalogue part's own further slot (if it has one — see
// benchLayout.js's stackSlotFor()) is a real 3D marker in the scene and
// an "Attach on top" button here, both resolving to the same
// attachAt(nodeId, "bot"); an imported part's arbitrary user-placed
// anchors get one "attach here" button each, since there's no single
// predictable "up" for those.
export default function NodeTree({ assembly, partsById, nodeExtents, nodeId, actions }) {
  const node = getNode(assembly, nodeId);
  const part = partsById.get(node.partId);
  const parentPart = partsById.get(getNode(assembly, node.parentId).partId);
  const kids = childrenOf(assembly, nodeId);
  const isImported = part.kind === "imported";
  const openSlots = isImported ? slotsForNode(assembly, partsById, nodeExtents, nodeId) : [];
  const stackSlot = isImported ? null : stackSlotFor(assembly, partsById, nodeId);

  return (
    <li className="bench-tree-node">
      <div className="bench-child-row">
        <span>{part.name}</span>
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
            />
          ))}
        </ul>
      )}
    </li>
  );
}

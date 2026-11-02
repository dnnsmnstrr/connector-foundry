import { useEffect, useState } from "react";
import Modal from "./Modal.jsx";
import { answerConfirm, hostConfirm } from "../lib/confirm.js";

// The app's yes-or-no questions (lib/confirm.js's askConfirm()): replace
// the bench, drop the holes, delete a preset, make a new token. Mounted
// once, by App.jsx; it shows the question waiting, if any, and nothing
// otherwise.
//
// The yes button has the focus, so Enter answers it as the native
// confirm() did; Escape, the ×, the backdrop and Cancel answer no. A
// question can come up over Settings (a new MCP token, importing
// settings): Escape stops here, so it closes this dialog and not
// Settings under it too (App.jsx's own Escape listener is on the window).
export default function ConfirmDialog() {
  const [request, setRequest] = useState(
    /** @type {import("../lib/confirm.js").ConfirmRequest | null} */ (null),
  );
  useEffect(() => hostConfirm(setRequest), []);
  if (!request) return null;
  return (
    // A new question is a new dialog: Modal takes the focus on mount.
    <Modal
      key={request.question}
      onClose={() => answerConfirm(false)}
      title={request.question}
      className="confirm-modal"
    >
      <div
        onKeyDown={(e) => {
          if (e.key === "Escape") e.stopPropagation();
        }}
      >
        {request.detail && <p className="muted confirm-detail">{request.detail}</p>}
        <div className="confirm-actions">
          <button type="button" className="bench-modal-cancel" onClick={() => answerConfirm(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="render-button confirm-yes"
            onClick={() => answerConfirm(true)}
            data-autofocus
          >
            {request.confirmLabel ?? "OK"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

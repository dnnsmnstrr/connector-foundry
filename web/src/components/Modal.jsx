import { useId, useLayoutEffect, useRef } from "react";

// The one dialog shell for Settings, the Bench's attach-a-part picker and
// its STL import flow — a native <dialog> opened with showModal(), so the
// browser handles what a hand-rolled overlay has to fake: everything
// behind it is inert, Tab stays inside, and focus goes back to whatever
// opened it when it closes.
//
// `title` renders the heading the dialog is labelled by. Clicking the
// backdrop closes (the click lands on the <dialog> itself; anything inside
// the padded panel has a different target). Escape arrives as the
// native "cancel" event and is routed to onClose as well — the window
// keydown listeners in App.jsx / Bench.jsx still fire and close the same
// state, so the two agree. On open, focus goes to whatever is marked
// data-autofocus (the part search box), else to the panel itself so a
// screen reader lands inside the dialog without popping a keyboard.
export default function Modal({ onClose, className, title, children }) {
  const dialogRef = useRef(null);
  const panelRef = useRef(null);
  const titleId = useId();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog.open) dialog.showModal();
    const target = dialog.querySelector("[data-autofocus]") ?? panelRef.current;
    target?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const onCancel = (e) => {
      e.preventDefault();
      onClose();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className={className ? `bench-modal ${className}` : "bench-modal"}
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={panelRef} className="bench-modal-panel" tabIndex={-1}>
        <h3 id={titleId}>{title}</h3>
        {children}
      </div>
    </dialog>
  );
}

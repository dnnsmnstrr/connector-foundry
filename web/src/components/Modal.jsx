// A backdrop that closes on click, around a panel that doesn't — the one
// dialog shell for Settings, the Bench's attach-a-part picker and its
// STL import flow. Escape handling stays with whoever owns the open
// state (App.jsx for Settings, Bench.jsx for its own), since which
// dialog Escape should close depends on what else is open.
export default function Modal({ onClose, className, children }) {
  return (
    <div className="bench-modal-backdrop" onClick={onClose}>
      <div className={className ? `bench-modal ${className}` : "bench-modal"} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

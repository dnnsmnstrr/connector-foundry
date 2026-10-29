import Modal from "./Modal.jsx";

// "Install the app" where the browser has no install dialog of its own to
// show (lib/webApp.js): every browser on iOS and iPadOS adds a site to the
// Home Screen from its Share menu, and an Android browser without
// Chromium's prompt from its own menu. The sheet says how, in that
// platform's words, and what the installed app does that the tab does
// not. Opened from the palette's command and from Settings, never over
// another dialog.
//
// `method` is which platform's steps to show; `onClose` closes the sheet.
/**
 * @param {{
 *   method: "ios" | "android",
 *   onClose: () => void,
 * }} props
 */
export default function InstallSheet({ method, onClose }) {
  return (
    <Modal title="Install the app" className="install-sheet-modal" onClose={onClose}>
      <p className="install-sheet-intro">
        Connector Foundry opens from its own icon, full screen, without the browser around it — offline too,
        once a part has rendered — and updates itself when a new version is out.
      </p>
      {method === "ios" ? (
        <ol className="install-sheet-steps">
          <li>
            Tap <strong>Share</strong> <ShareIcon /> — in Safari it is in the toolbar, or behind{" "}
            <strong>•••</strong>.
          </li>
          <li>
            Scroll down and choose <strong>Add to Home Screen</strong>.
          </li>
          <li>
            Leave <strong>Open as Web App</strong> on, if it is offered, and tap <strong>Add</strong>.
          </li>
        </ol>
      ) : (
        <ol className="install-sheet-steps">
          <li>
            Open the browser&rsquo;s menu <strong>⋮</strong>.
          </li>
          <li>
            Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>, then{" "}
            <strong>Install</strong>.
          </li>
        </ol>
      )}
      <div className="install-sheet-actions">
        <button type="button" className="download-button" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

// The Share symbol as iOS draws it: a box with an arrow out of its top.
function ShareIcon() {
  return (
    <svg
      className="install-sheet-share"
      viewBox="0 0 16 18"
      width="14"
      height="16"
      role="img"
      aria-label="(the box with an arrow up)"
    >
      <path
        d="M8 1v10M4.5 4.5 8 1l3.5 3.5M5.5 7H3v9.5h10V7h-2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

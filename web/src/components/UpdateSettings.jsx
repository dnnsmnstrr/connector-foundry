import { useDesktopUpdates } from "../hooks/useDesktopUpdates.js";
import {
  checkForUpdates,
  restartToUpdate,
  setAutoCheck,
  setKeepUpdated,
  updateSummary,
} from "../lib/desktopUpdates.js";
import InfoTip from "./InfoTip.jsx";

// Settings > Updates, in the desktop app only (desktop/updates.cjs): the
// version running (and the interface's, when an interface update runs),
// where the updater stands, a check by hand, the restart (or reload) that
// installs a downloaded update, and the switches for the automatic checks
// and interface updates. When this copy can't install updates itself (run
// from the DMG, a development build) it says why and links the release
// page. The palette has the same (components/UpdateNotice.jsx). Nothing in
// a browser.

/**
 * "5 minutes ago", for when the last check was.
 * @param {number} then ms since the epoch
 */
function ago(then) {
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (minutes < 60) return format.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  return hours < 24 ? format.format(-hours, "hour") : format.format(-Math.round(hours / 24), "day");
}

export default function UpdateSettings() {
  const status = useDesktopUpdates();
  if (!status) return null;
  const busy = ["checking", "downloading", "installing"].includes(status.state);
  const showRelease =
    status.releaseUrl &&
    ["available", "ready", "error"].includes(status.state) &&
    status.latest !== status.version;

  return (
    <>
      <h4 className="settings-section has-info-tip">
        Updates
        <InfoTip
          label="About updates"
          text="The app asks GitHub for the newest release, downloads it in the background and checks it against the release's checksums. It installs when you restart the app, or the next time you quit it. When a release leaves the app itself as it is, only its interface is downloaded, a few MB, and a reload loads it. Nothing else is sent: the check is a download like any other."
        />
      </h4>
      <p className="settings-update-status" role="status">
        <span>
          Version {status.version}
          {status.web !== status.version && ` · interface ${status.web}`}
        </span>
        <span className="muted">
          {" — "}
          {updateSummary(status)}
          {status.state === "up-to-date" && status.checkedAt ? `, checked ${ago(status.checkedAt)}` : ""}
        </span>
      </p>
      {status.shellNeeded && status.state !== "up-to-date" && (
        <p className="muted settings-help">
          Version {status.latest} changes the app itself, not only its interface, so it comes as the full
          update. Until it is installed, the interface stays at {status.web}.
        </p>
      )}
      {status.manual && status.state !== "up-to-date" && (
        <p className="muted settings-help">{status.manual}</p>
      )}
      <div className="settings-backup">
        {status.state === "ready" ? (
          <button
            type="button"
            className="bench-modal-cancel settings-update-restart"
            onClick={restartToUpdate}
          >
            {status.reload ? "Reload to update" : "Restart to update"}
          </button>
        ) : (
          <button type="button" className="bench-modal-cancel" disabled={busy} onClick={checkForUpdates}>
            Check for updates
          </button>
        )}
        {showRelease && (
          <a
            className="bench-modal-cancel"
            href={status.releaseUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            What's new in {status.latest}
          </a>
        )}
      </div>
      <label className="field field-checkbox">
        <input type="checkbox" checked={status.autoCheck} onChange={(e) => setAutoCheck(e.target.checked)} />
        <span className="field-label">Check for updates automatically</span>
      </label>
      <label className="field field-checkbox">
        <input
          type="checkbox"
          checked={status.keepUpdated}
          onChange={(e) => setKeepUpdated(e.target.checked)}
        />
        <span className="field-label">Update the interface without reinstalling</span>
      </label>
      <p className="muted settings-help">
        When a release only changes the interface, download just that and load it with a reload. Turned off,
        every update is the full download, and the app goes back to its own interface the next time it starts.
      </p>
    </>
  );
}

import { useEffect, useRef } from "react";
import { useCommands } from "../hooks/useCommands.js";
import { useDesktopUpdates } from "../hooks/useDesktopUpdates.js";
import { builtin, openLink } from "../lib/commandCatalog.js";
import { showCommandHud } from "../lib/commandHud.js";
import {
  checkForUpdates,
  getUpdateStatus,
  restartToUpdate,
  setAutoCheck,
  updateSummary,
} from "../lib/desktopUpdates.js";

// The nav's word on a desktop update (desktop/updates.cjs): its progress
// while one downloads, then a "Restart to update" button. A component of
// its own so the progress, reported a few times a second, re-renders it
// alone (lib/desktopUpdates.js). It holds the status the updater's palette
// commands read, so it offers them; and it says once, at the foot of the
// window, when an update is ready and when a restart installed one.
// Nothing in a browser.

const NEWS_MS = 5000;

export default function UpdateNotice() {
  const status = useDesktopUpdates();
  // What was said already: a reload of the page (or StrictMode's second
  // effect) must not say it again.
  const said = useRef(/** @type {Set<string>} */ (new Set()));
  const news =
    status?.state === "ready"
      ? `Version ${status.latest} is ready. Restart to update.`
      : status?.justUpdated
        ? `Updated to version ${status.justUpdated}`
        : null;
  useEffect(() => {
    if (!news || said.current.has(news)) return;
    said.current.add(news);
    showCommandHud(news, NEWS_MS);
  }, [news]);

  useCommands("updates", () => {
    if (!status) return [];
    const busy = ["checking", "downloading", "installing"].includes(status.state);
    return [
      builtin("app.checkUpdates", {
        subtitle: updateSummary(status),
        disabled: busy && updateSummary(status),
        actions: [
          {
            title: "Check",
            run: () => {
              showCommandHud("Checking for updates…");
              // A check that finds an update downloads it before it
              // answers; "ready" has its own news above.
              checkForUpdates()?.then(() => {
                const next = getUpdateStatus();
                if (next && next.state !== "ready") showCommandHud(updateSummary(next), NEWS_MS);
              });
            },
          },
          ...(status.releaseUrl && status.state !== "up-to-date"
            ? [{ title: "Open the release page", run: () => openLink(status.releaseUrl) }]
            : []),
        ],
      }),
      builtin("app.restartToUpdate", {
        when: status.state === "ready",
        subtitle: `Version ${status.latest}`,
        run: restartToUpdate,
      }),
      builtin("app.autoUpdate", {
        checked: status.autoCheck,
        subtitle: status.autoCheck ? "On" : "Off",
        run: () => setAutoCheck(!status.autoCheck),
      }),
    ];
  });

  if (status?.state === "downloading")
    return (
      <span className="render-indicator update-indicator" title={updateSummary(status)}>
        <span className="render-spinner" aria-hidden="true" />
        <span className="render-indicator-text">
          Updating{status.progress === null ? "…" : ` ${Math.floor(status.progress * 100)}%`}
        </span>
      </span>
    );
  if (status?.state === "ready")
    return (
      <button
        type="button"
        className="mode-tab update-tab"
        onClick={restartToUpdate}
        title={`Install version ${status.latest} and restart`}
      >
        Restart to update
      </button>
    );
  return null;
}

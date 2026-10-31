import { useEffect, useRef, useState } from "react";
import { useCommands } from "../hooks/useCommands.js";
import { useDesktopUpdates } from "../hooks/useDesktopUpdates.js";
import { useWebApp } from "../hooks/useWebApp.js";
import { builtin, openLink } from "../lib/commandCatalog.js";
import { showCommandHud } from "../lib/commandHud.js";
import { flushWorkspace } from "../lib/workspace.js";
import { checkForWebUpdate, reloadToUpdate } from "../lib/webApp.js";
import {
  checkForUpdates,
  dismissShellNotice,
  getUpdateStatus,
  needsShellNotice,
  reportStarted,
  restartToUpdate,
  setAutoCheck,
  setKeepUpdated,
  updateSummary,
} from "../lib/desktopUpdates.js";

// The nav's word on a desktop update (desktop/updates.cjs): its progress
// while one downloads, then a "Restart to update" button ("Reload to
// update" for an interface update). A component of its own so the
// progress, reported a few times a second, re-renders it alone
// (lib/desktopUpdates.js). It holds the status the updater's palette
// commands read, so it offers them; and it says once, at the foot of the
// window, when an update is ready and when a restart installed one.
// When the newest interface needs a newer app that this copy can't
// install itself, an "Update the app" button opens the release page,
// once per version. Mounting, it tells the updater the page started,
// which an interface update must do to be kept.
//
// In a browser, the web app's word instead (lib/webApp.js): once a newer
// deploy's service worker has taken over the page, "Reload to update" in
// the nav and the palette, and once after that reload, "Updated". Its
// "Check for updates" asks the server there and then — what an app kept
// open on a phone's home screen for days needs, where a tab would just be
// reloaded. Nothing without a service worker (the dev server).

const NEWS_MS = 5000;

export default function UpdateNotice() {
  const status = useDesktopUpdates();
  const web = useWebApp();
  // What was said already: a reload of the page (or StrictMode's second
  // effect) must not say it again.
  const said = useRef(/** @type {Set<string>} */ (new Set()));
  // Bumped when the "Update the app" notice is acted on, which storage holds.
  const [, setShellNoticeSeen] = useState(0);
  useEffect(() => reportStarted(), []);
  const news =
    status?.state === "ready"
      ? status.reload
        ? `Version ${status.latest} is ready. Reload to update.`
        : status.shellNeeded
          ? `Version ${status.latest} updates the app itself. Restart to update.`
          : `Version ${status.latest} is ready. Restart to update.`
      : status?.justUpdated
        ? `Updated to version ${status.justUpdated}`
        : web.update === "ready"
          ? "A new version is ready. Reload to update."
          : web.justUpdated
            ? "Updated to the latest version"
            : null;
  useEffect(() => {
    if (!news || said.current.has(news)) return;
    said.current.add(news);
    showCommandHud(news, NEWS_MS);
  }, [news]);

  useCommands("updates", () => {
    if (!status) return webCommands(web.update);
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
        ...(status.reload ? { title: "Reload to update" } : {}),
        subtitle: `Version ${status.latest}`,
        run: restartToUpdate,
      }),
      builtin("app.autoUpdate", {
        checked: status.autoCheck,
        subtitle: status.autoCheck ? "On" : "Off",
        run: () => setAutoCheck(!status.autoCheck),
      }),
      builtin("app.keepUpdated", {
        checked: status.keepUpdated,
        subtitle: status.keepUpdated ? "On" : "Off",
        run: () => setKeepUpdated(!status.keepUpdated),
      }),
    ];
  });

  if (!status && web.update === "ready")
    return (
      <button
        type="button"
        className="mode-tab update-tab"
        onClick={reloadWebApp}
        aria-label="Reload to update"
        title="Load the new version: the tab, bench and Holes document come back"
      >
        <span className="update-label">Reload to update</span>
        <span className="update-label-short" aria-hidden="true">
          Update
        </span>
      </button>
    );
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
        title={
          status.reload
            ? `Load version ${status.latest}: a reload, no reinstall`
            : `Install version ${status.latest} and restart`
        }
      >
        {status.reload ? "Reload to update" : "Restart to update"}
      </button>
    );
  if (status && needsShellNotice(status) && status.latest && status.releaseUrl) {
    const { latest, releaseUrl } = status;
    return (
      <button
        type="button"
        className="mode-tab update-tab"
        onClick={() => {
          dismissShellNotice(latest);
          setShellNoticeSeen((n) => n + 1);
          openLink(releaseUrl);
        }}
        title={`Version ${latest} changes the app itself, which this copy can't install on its own: download it from the release page. Until then the interface stays at ${status.web}.`}
      >
        Update the app
      </button>
    );
  }
  return null;
}

// The browser's update commands (lib/webApp.js): a check by hand while
// there is a service worker to ask, and the reload once a new build is in.
/** @param {import("../lib/webApp.js").WebUpdateState} state */
function webCommands(state) {
  if (state === "unavailable") return [];
  return [
    builtin("app.checkUpdates", {
      when: state !== "ready",
      subtitle: state === "checking" ? "Checking…" : undefined,
      disabled: state === "checking" && "Checking…",
      run: () => {
        showCommandHud("Checking for updates…");
        checkForWebUpdate().then((result) => {
          // "ready" has its own news, from UpdateNotice.
          if (result === "up-to-date") showCommandHud("This is the latest version", NEWS_MS);
          else if (result === "offline") showCommandHud("Couldn't reach the server: offline?", NEWS_MS);
        });
      },
    }),
    builtin("app.restartToUpdate", {
      when: state === "ready",
      title: "Reload to update",
      subtitle: "A new version is ready",
      run: reloadWebApp,
    }),
  ];
}

// Reloads into the new build. The workspace is written first, so the
// reload comes back to the same tab, bench and Holes document.
function reloadWebApp() {
  flushWorkspace();
  reloadToUpdate();
}

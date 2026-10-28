// The desktop app's window.foundryDesktop (desktop/preload.cjs): where the
// page registers its tools for coding agents (lib/webmcp.js), the
// Settings switch for the MCP server that serves them (desktop/mcp.cjs),
// and the updater (desktop/updates.cjs, read through lib/desktopUpdates.js).
// Absent in a browser.

/**
 * What the MCP server is doing, as the main process reports it.
 * @typedef {object} DesktopMcpStatus
 * @property {boolean} enabled the user's switch
 * @property {boolean} listening whether agents can connect now
 * @property {string} url the endpoint, http://127.0.0.1:<port>/mcp
 * @property {string | null} token the bearer token, made the first time it is turned on
 * @property {string | null} error why it isn't listening although it is on (the port taken)
 */
/**
 * @typedef {object} DesktopMcp
 * @property {() => Promise<DesktopMcpStatus | null>} status
 * @property {(on: boolean) => Promise<DesktopMcpStatus | null>} setEnabled
 * @property {() => Promise<DesktopMcpStatus | null>} newToken
 * @property {(listener: (status: DesktopMcpStatus) => void) => () => void} onStatus
 */
/**
 * What the updater is doing, as the main process reports it.
 * @typedef {object} DesktopUpdateStatus
 * @property {string} version the running app's
 * @property {boolean} autoCheck whether it checks on its own
 * @property {boolean} keepUpdated whether it takes interface updates
 * @property {string} web the version of the interface the window shows, the app's own or an interface update's
 * @property {"idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "installing" | "error"} state
 *   "available" is newer but not installable from here (`manual` says why); "ready" is downloaded
 * @property {string | null} latest the newest version the last check found
 * @property {number | null} progress 0–1 while downloading
 * @property {string | null} releaseUrl that version's release page
 * @property {number | null} checkedAt when the last check finished (ms since the epoch)
 * @property {string | null} error why the last check, download or install failed
 * @property {string | null} manual why this copy can't install updates itself
 * @property {string | null} justUpdated the version this launch was updated to, if it was
 * @property {boolean} reload "ready" is an interface update, which a reload loads
 * @property {boolean} shellNeeded the newest version's interface needs a newer app than this one
 */
/**
 * @typedef {object} DesktopUpdates
 * @property {() => Promise<DesktopUpdateStatus | null>} status
 * @property {() => Promise<DesktopUpdateStatus | null>} check checks, and downloads what it finds
 * @property {() => Promise<boolean>} install restarts the app to install a downloaded update
 * @property {(on: boolean) => Promise<DesktopUpdateStatus | null>} setAutoCheck
 * @property {(on: boolean) => Promise<DesktopUpdateStatus | null>} setKeepUpdated
 * @property {() => void} loaded tells the updater the page started, which an interface update must in time
 * @property {(listener: (status: DesktopUpdateStatus) => void) => () => void} onStatus
 */
/**
 * @typedef {object} DesktopBridge
 * @property {{ registerTool: (tool: object) => { unregister: () => void } }} modelContext
 * @property {DesktopMcp} mcp
 * @property {DesktopUpdates} updates
 */

/**
 * The bridge, or null outside the desktop app.
 * @returns {DesktopBridge | null}
 */
export function desktopBridge() {
  const bridge = /** @type {any} */ (globalThis).foundryDesktop;
  return bridge && typeof bridge === "object" ? bridge : null;
}

/**
 * What to paste into Claude Code's terminal to add the server, user-wide:
 * the app is one per computer, not one per project.
 * @param {DesktopMcpStatus} status
 */
export function claudeCodeCommand(status) {
  return `claude mcp add --scope user --transport http connector-foundry ${status.url} --header "Authorization: Bearer ${status.token}"`;
}

/**
 * The same as an `mcpServers` entry, the JSON most agents' config files take.
 * @param {DesktopMcpStatus} status
 */
export function mcpJsonConfig(status) {
  return JSON.stringify(
    {
      mcpServers: {
        "connector-foundry": {
          type: "http",
          url: status.url,
          headers: { Authorization: `Bearer ${status.token}` },
        },
      },
    },
    null,
    2,
  );
}

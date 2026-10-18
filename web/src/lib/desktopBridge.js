// The desktop app's window.foundryDesktop (desktop/preload.cjs): where the
// page registers its tools for coding agents (lib/webmcp.js), and the
// Settings switch for the MCP server that serves them (desktop/mcp.cjs).
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
 * @typedef {object} DesktopBridge
 * @property {{ registerTool: (tool: object) => { unregister: () => void } }} modelContext
 * @property {DesktopMcp} mcp
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

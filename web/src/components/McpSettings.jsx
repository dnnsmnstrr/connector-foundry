import { useEffect, useState } from "react";
import { useDesktopMcp } from "../hooks/useDesktopMcp.js";
import { claudeCodeCommand, mcpJsonConfig } from "../lib/desktopBridge.js";
import InfoTip from "./InfoTip.jsx";
import { askConfirm } from "../lib/confirm.js";

// Settings > Coding agents, in the desktop app only: the switch for its MCP
// server (desktop/mcp.cjs), which lets a coding agent on this computer —
// Claude Code and the like — use the same tools an AI agent in a browser
// gets (lib/webmcp.js). Turned on, it shows where agents connect and the
// token they need, with the setup to copy: Claude Code's command, or the
// JSON most other agents' config files take, and the folder an agent's
// exports go to when it names none (they skip the Save dialog). The
// palette has the same (App.jsx's app.mcp* commands). Nothing in a browser.

const COPIED_MS = 2000;

/**
 * Copies `text` to the clipboard; resolves whether it could.
 * @param {string} text
 */
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function McpSettings() {
  const mcp = useDesktopMcp();
  // Which copy button just copied ("command", "json"), or "failed".
  const [copied, setCopied] = useState(/** @type {string | null} */ (null));
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(null), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  if (!mcp) return null;
  const { status } = mcp;

  /** @param {"command" | "json"} which */
  async function copySetup(which) {
    if (!status?.token) return;
    const ok = await copy(which === "command" ? claudeCodeCommand(status) : mcpJsonConfig(status));
    setCopied(ok ? which : "failed");
  }

  async function replaceToken() {
    if (
      await askConfirm("Make a new token?", {
        detail: "Coding agents set up with the old one can't connect until they have the new one.",
        confirmLabel: "Make a new token",
      })
    )
      mcp.newToken();
  }

  return (
    <>
      <h4 className="settings-section has-info-tip">
        Coding agents
        <InfoTip
          label="About coding agents"
          text="Lets a coding agent on this computer, like Claude Code, work in this window over MCP: find and attach parts, load benches and run commands. You see what it does, and Undo reverses it. Only programs with the token can connect."
        />
      </h4>
      <label className="field field-checkbox">
        <input
          type="checkbox"
          checked={status?.enabled ?? false}
          disabled={!status}
          onChange={(e) => mcp.setEnabled(e.target.checked)}
        />
        <span className="field-label">Let coding agents use the app (MCP)</span>
      </label>
      {status?.enabled && status.token && (
        <div className="settings-mcp">
          <label className="field">
            <span className="field-label">Address</span>
            <input type="text" readOnly value={status.url} onFocus={(e) => e.target.select()} />
          </label>
          <label className="field">
            <span className="field-label">Token</span>
            <input type="text" readOnly value={status.token} onFocus={(e) => e.target.select()} />
          </label>
          <div className="settings-backup">
            <button type="button" className="bench-modal-cancel" onClick={() => copySetup("command")}>
              {copied === "command" ? "Copied" : "Copy Claude Code command"}
            </button>
            <button type="button" className="bench-modal-cancel" onClick={() => copySetup("json")}>
              {copied === "json" ? "Copied" : "Copy JSON config"}
            </button>
            <button type="button" className="bench-modal-cancel" onClick={replaceToken}>
              New token…
            </button>
          </div>
          <div className="field">
            <span className="field-label" id="mcp-export-folder">
              Agents' exports go to
            </span>
            <div className="settings-backup settings-mcp-folder">
              <input
                type="text"
                readOnly
                aria-labelledby="mcp-export-folder"
                value={status.exportFolder}
                onFocus={(e) => e.target.select()}
              />
              <button type="button" className="bench-modal-cancel" onClick={() => mcp.chooseExportFolder()}>
                Change…
              </button>
            </div>
          </div>
          {copied === "failed" && (
            <p className="error-text settings-backup-error" role="alert">
              The app couldn't copy it. Select the token above and copy it from there.
            </p>
          )}
        </div>
      )}
      {status?.error && (
        <p className="error-text settings-backup-error" role="alert">
          {status.error}
        </p>
      )}
    </>
  );
}

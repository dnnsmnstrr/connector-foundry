import { useEffect, useState } from "react";
import { desktopBridge } from "../lib/desktopBridge.js";

/**
 * The desktop app's MCP server for coding agents (desktop/mcp.cjs), live:
 * its status as the main process last reported it (null until the first
 * answer), and its two switches. Null in a browser, where there is none.
 * @returns {{
 *   status: import("../lib/desktopBridge.js").DesktopMcpStatus | null,
 *   setEnabled: (on: boolean) => Promise<void>,
 *   newToken: () => Promise<void>,
 * } | null}
 */
export function useDesktopMcp() {
  const mcp = desktopBridge()?.mcp ?? null;
  const [status, setStatus] = useState(
    /** @type {import("../lib/desktopBridge.js").DesktopMcpStatus | null} */ (null),
  );
  useEffect(() => {
    if (!mcp) return undefined;
    // A status that lands after unmount is dropped.
    let current = true;
    mcp.status().then(
      (next) => {
        if (current && next) setStatus(next);
      },
      () => {},
    );
    const off = mcp.onStatus((next) => {
      if (current) setStatus(next);
    });
    return () => {
      current = false;
      off();
    };
  }, [mcp]);
  if (!mcp) return null;
  return {
    status,
    // Each answers with the new status; the broadcast that follows says
    // the same to every other listener (Settings and the palette).
    // The switch moves at once; the server's answer (listening, or why
    // not) follows.
    setEnabled: async (on) => {
      setStatus((s) => s && { ...s, enabled: on });
      const next = await mcp.setEnabled(on);
      if (next) setStatus(next);
    },
    newToken: async () => {
      const next = await mcp.newToken();
      if (next) setStatus(next);
    },
  };
}

import { useEffect, useRef } from "react";
import { createAppTools, getModelContexts, registerTools, tabBridge } from "../lib/webmcp.js";

/**
 * Offers the app's WebMCP tools (lib/webmcp.js) to the browser's AI agent
 * and, in the desktop app, to coding agents (desktop/mcp.cjs), while the
 * caller is mounted — App, once. Where there is neither, nothing happens.
 * The tools are registered once and read the latest `deps` through a ref
 * when called, so they see the tab and the bench as they are then, not as
 * they were at registration; re-registering on every render would fire
 * the browser's toolchange each keystroke.
 * @param {import("../lib/webmcp.js").AppToolDeps} deps
 */
export function useWebMcp(deps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  useEffect(() => {
    const found = getModelContexts();
    if (!found.length) return undefined;
    const controller = new AbortController();
    const tools = createAppTools(() => depsRef.current);
    for (const context of found) registerTools(context, tools, controller.signal);
    return () => controller.abort();
  }, []);
}

/**
 * What a tab hands the tools while it is mounted (lib/webmcp.js's
 * tabBridge): how its preview render went and, on the Bench, its open
 * slots and attach. The latest `tab` is read when a tool asks, through a
 * ref, so its closures are this render's; it is cheap to pass on every
 * render, since nothing is built until then. Set whether or not the
 * browser has WebMCP: one object is cheaper than asking.
 * @param {import("../lib/webmcp.js").MountedTab} tab
 */
export function useWebMcpTab(tab) {
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const name = tab.tab;
  const bench = Boolean(tab.attach);
  useEffect(
    () =>
      tabBridge.set({
        tab: name,
        preview: () => tabRef.current.preview(),
        ...(bench
          ? {
              openSlots: () => tabRef.current.openSlots?.() ?? [],
              attach: (request) => {
                if (!tabRef.current.attach) throw new Error("Parts are attached on the Bench.");
                return tabRef.current.attach(request);
              },
            }
          : {}),
      }),
    [name, bench],
  );
}

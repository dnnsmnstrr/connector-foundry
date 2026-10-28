// What the desktop window's page may ask of the main process: three
// things, two of them for coding agents (mcp-server.cjs). The page stays
// sandboxed with no Node; this is the whole surface, exposed as
// window.foundryDesktop.
//
// `modelContext` is where the page registers its WebMCP tools
// (src/lib/webmcp.js), shaped like Chrome's early-preview
// navigator.modelContext: registerTool() returns a handle to unregister
// with, and a tool's result is MCP's ({ content, isError }). The tools'
// descriptions go to the main process, which lists them to agents; a call
// comes back here by id and runs the page's own execute().
//
// `mcp` is the Settings switch: whether the server is on, its address and
// token, a new token.
//
// `updates` is the updater (updates.cjs): its status, a check, the
// switches for automatic checks and interface updates, the restart (or
// reload) that installs a downloaded update, and the page's word that it
// started, which an interface update has to give in time to be kept.

const { contextBridge, ipcRenderer } = require("electron");

/** @type {Map<string, { name: string, title?: string, description: string, inputSchema: unknown, annotations: unknown, execute: Function }>} */
const tools = new Map();

function publish() {
  ipcRenderer.send(
    "mcp:tools",
    [...tools.values()].map(({ name, title, description, inputSchema, annotations }) => ({
      name,
      title,
      description,
      inputSchema,
      annotations,
    })),
  );
}

ipcRenderer.on("mcp:call", async (_event, { id, name, input }) => {
  const tool = tools.get(name);
  let result;
  try {
    result = tool
      ? await tool.execute(input ?? {})
      : { content: [{ type: "text", text: `There is no tool "${name}" now.` }], isError: true };
  } catch (err) {
    result = { content: [{ type: "text", text: String(err?.message ?? err) }], isError: true };
  }
  ipcRenderer.send("mcp:result", { id, result });
});

contextBridge.exposeInMainWorld("foundryDesktop", {
  modelContext: {
    registerTool(tool) {
      // Read now: the page's object arrives as a copy whose functions call
      // back into the page.
      const entry = {
        name: String(tool?.name ?? ""),
        title: typeof tool?.title === "string" ? tool.title : undefined,
        description: String(tool?.description ?? ""),
        inputSchema: tool?.inputSchema ?? { type: "object" },
        annotations: tool?.annotations ?? {},
        execute: tool?.execute,
      };
      if (!entry.name || typeof entry.execute !== "function")
        throw new Error("A tool needs a name and execute().");
      if (tools.has(entry.name)) throw new Error(`The tool "${entry.name}" is registered already.`);
      tools.set(entry.name, entry);
      publish();
      return {
        unregister() {
          if (tools.get(entry.name) !== entry) return;
          tools.delete(entry.name);
          publish();
        },
      };
    },
  },
  mcp: {
    status: () => ipcRenderer.invoke("mcp:status"),
    setEnabled: (on) => ipcRenderer.invoke("mcp:set-enabled", on === true),
    newToken: () => ipcRenderer.invoke("mcp:new-token"),
    /** Calls `listener` with the new status whenever it changes; returns the unsubscribe. */
    onStatus(listener) {
      const handler = (_event, status) => listener(status);
      ipcRenderer.on("mcp:status", handler);
      return () => ipcRenderer.removeListener("mcp:status", handler);
    },
  },
  updates: {
    status: () => ipcRenderer.invoke("updates:status"),
    check: () => ipcRenderer.invoke("updates:check"),
    install: () => ipcRenderer.invoke("updates:install"),
    setAutoCheck: (on) => ipcRenderer.invoke("updates:set-auto-check", on === true),
    setKeepUpdated: (on) => ipcRenderer.invoke("updates:set-keep-updated", on === true),
    loaded: () => ipcRenderer.send("updates:loaded"),
    /** Calls `listener` with the new status whenever it changes; returns the unsubscribe. */
    onStatus(listener) {
      const handler = (_event, status) => listener(status);
      ipcRenderer.on("updates:status", handler);
      return () => ipcRenderer.removeListener("updates:status", handler);
    },
  },
});

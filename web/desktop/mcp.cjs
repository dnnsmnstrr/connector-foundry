// The desktop app's side of the MCP server (mcp-server.cjs): the Settings
// switch, kept in the profile's mcp.json; the server's tool list, which is
// whatever the window registered (preload.cjs); and its tool calls,
// handed to the window by id and answered from there — so an agent here
// runs exactly the tools an AI agent in a browser does (src/lib/webmcp.js),
// with nothing reimplemented on this side.
//
// Off until the user turns it on. Turned on, it listens on 127.0.0.1 at
// a fixed port (mcp.json's "port", 47811 unless edited there), so the
// command a user pastes into their agent's setup keeps working across
// restarts; the token is made the first time and kept until the user asks
// for a new one.

const { app, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { ENDPOINT, createMcpServer, isToken, newToken } = require("./mcp-server.cjs");

const DEFAULT_PORT = 47811;
// A call can wait on the user: open_part asks before it replaces a bench.
const CALL_TIMEOUT_MS = 120_000;
// The window loads the catalogue before it registers its tools.
const READY_TIMEOUT_MS = 30_000;
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
const TOOLS_MAX = 50;
const TEXT_MAX = 8000;

const INSTRUCTIONS =
  "These tools work the Connector Foundry window open on this computer, a designer for 3D-printable " +
  "connector parts (Gridfinity, openGrid, Multiboard and more): the commands its command palette offers, " +
  "the parts catalogue, opening a part, attaching parts on the Bench, loading a bench, and each tab's state " +
  "with how its render went. What they do shows in the window, and the user can undo it there. Start with " +
  "get_app_state or list_commands.";

/**
 * @param {{
 *   getWindow: () => import("electron").BrowserWindow | null,
 *   openWindow: () => import("electron").BrowserWindow,
 *   isAppURL: (url: string) => boolean,
 * }} options
 */
function setupMcp({ getWindow, openWindow, isAppURL }) {
  const file = path.join(app.getPath("userData"), "mcp.json");
  const settings = readSettings(file);
  /** @type {ReturnType<typeof createMcpServer> | null} */
  let server = null;
  /** @type {string | null} */
  let error = null;
  /** @type {any[]} what the window registered, as it describes them */
  let tools = [];
  /** @type {Set<() => void>} */
  const toolWaiters = new Set();
  /** @type {Map<number, { resolve: (result: any) => void, reject: (err: Error) => void }>} */
  const pending = new Map();
  let nextCall = 1;
  // Turning it on and off in quick succession: one change at a time.
  let applying = Promise.resolve();

  function save() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    } catch (err) {
      error = `The setting couldn't be saved: ${err.message}`;
    }
  }

  function status() {
    return {
      enabled: settings.enabled,
      listening: Boolean(server),
      url: `http://127.0.0.1:${settings.port}${ENDPOINT}`,
      token: settings.token,
      error,
    };
  }

  function broadcast() {
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send("mcp:status", status());
  }

  function apply() {
    applying = applying.then(async () => {
      if (server) {
        await server.close();
        server = null;
      }
      error = null;
      if (settings.enabled) {
        const next = createMcpServer({
          token: settings.token,
          listTools,
          callTool,
          serverInfo: { name: "connector-foundry", title: "Connector Foundry", version: app.getVersion() },
          instructions: INSTRUCTIONS,
        });
        try {
          await next.listen(settings.port);
          server = next;
        } catch (err) {
          error =
            err.code === "EADDRINUSE"
              ? `Port ${settings.port} is in use by another program, so coding agents can't connect. Quit it, or set another "port" in ${file}, and turn this on again.`
              : `The server didn't start: ${err.message}`;
        }
      }
      broadcast();
    });
    return applying;
  }

  // --- Tools, from the window -------------------------------------------

  /** The window, open and with its tools registered. */
  async function ready() {
    if (!getWindow()) openWindow();
    if (!tools.length) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          toolWaiters.delete(done);
          reject(
            new Error(
              "The Connector Foundry window isn't ready. Open it, wait for it to load, and try again.",
            ),
          );
        }, READY_TIMEOUT_MS);
        const done = () => {
          clearTimeout(timer);
          resolve(undefined);
        };
        toolWaiters.add(done);
      });
    }
    return getWindow();
  }

  async function listTools() {
    await ready();
    return tools.map(mcpTool);
  }

  /** @param {string} name @param {Record<string, unknown>} args */
  async function callTool(name, args) {
    const window = await ready();
    if (!window) throw new Error("The Connector Foundry window was closed.");
    const id = nextCall++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error(
            "The app didn't answer within two minutes. A question in the Connector Foundry window may be waiting for the user.",
          ),
        );
      }, CALL_TIMEOUT_MS);
      pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      window.webContents.send("mcp:call", { id, name, input: args });
    });
  }

  /** The page went away (closed, reloaded): its tools and unanswered calls with it. */
  function forgetPage(reason) {
    tools = [];
    for (const call of pending.values()) call.reject(new Error(reason));
    pending.clear();
  }

  // --- IPC: only from the app's own page in its own window ---------------

  /** @param {import("electron").IpcMainEvent | import("electron").IpcMainInvokeEvent} event */
  function fromApp(event) {
    const window = getWindow();
    return Boolean(window) && event.sender === window.webContents && isAppURL(event.senderFrame?.url ?? "");
  }

  ipcMain.on("mcp:tools", (event, list) => {
    if (!fromApp(event)) return;
    tools = checkTools(list);
    if (!tools.length) return;
    for (const done of toolWaiters) done();
    toolWaiters.clear();
  });
  ipcMain.on("mcp:result", (event, message) => {
    if (!fromApp(event)) return;
    const call = pending.get(message?.id);
    if (!call) return;
    pending.delete(message.id);
    call.resolve(message.result);
  });
  ipcMain.handle("mcp:status", (event) => (fromApp(event) ? status() : null));
  ipcMain.handle("mcp:set-enabled", async (event, on) => {
    if (!fromApp(event)) return null;
    settings.enabled = on === true;
    if (settings.enabled && !isToken(settings.token)) settings.token = newToken();
    save();
    await apply();
    return status();
  });
  ipcMain.handle("mcp:new-token", (event) => {
    if (!fromApp(event)) return null;
    settings.token = newToken();
    save();
    server?.setToken(settings.token);
    broadcast();
    return status();
  });
  app.on("will-quit", () => {
    server?.close();
  });

  return {
    /** Starts the server if the user left it on. */
    start() {
      if (settings.enabled && !isToken(settings.token)) {
        settings.token = newToken();
        save();
      }
      return apply();
    },
    /** @param {import("electron").BrowserWindow} window a new window, whose page will register tools */
    watch(window) {
      window.webContents.on("did-start-navigation", (details) => {
        if (details.isMainFrame && !details.isSameDocument)
          forgetPage("The Connector Foundry window reloaded.");
      });
      window.on("closed", () => forgetPage("The Connector Foundry window was closed."));
    },
  };
}

/**
 * mcp.json as stored, or the defaults: off, the default port, no token yet.
 * Read with the same care as any file a person may have edited.
 * @param {string} file
 */
function readSettings(file) {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // Not there yet, or unreadable: the defaults.
  }
  const port = raw?.port;
  return {
    enabled: raw?.enabled === true,
    port: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_PORT,
    token: isToken(raw?.token) ? raw.token : null,
  };
}

/**
 * The window's tool descriptions, as far as they have the shape of one.
 * @param {unknown} list
 */
function checkTools(list) {
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, TOOLS_MAX)
    .filter(
      (t) =>
        t &&
        typeof t.name === "string" &&
        TOOL_NAME.test(t.name) &&
        typeof t.description === "string" &&
        t.description.length <= TEXT_MAX &&
        t.inputSchema &&
        typeof t.inputSchema === "object" &&
        !Array.isArray(t.inputSchema),
    );
}

/**
 * A WebMCP tool as MCP lists it. Of WebMCP's annotations only readOnlyHint
 * has an MCP twin; none of the tools reaches past the app.
 * @param {any} tool
 */
function mcpTool(tool) {
  const title = typeof tool.title === "string" ? tool.title : undefined;
  return {
    name: tool.name,
    ...(title ? { title } : {}),
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      ...(title ? { title } : {}),
      readOnlyHint: tool.annotations?.readOnlyHint === true,
      openWorldHint: false,
    },
  };
}

module.exports = { DEFAULT_PORT, setupMcp };

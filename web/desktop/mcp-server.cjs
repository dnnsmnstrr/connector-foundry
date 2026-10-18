// The desktop app's MCP server: the app's WebMCP tools (src/lib/webmcp.js)
// for coding agents on this computer — Claude Code and the like — over
// MCP's Streamable HTTP transport. Plain Node (no Electron here), so the
// unit tests can drive it; main.cjs starts it when the user turns it on in
// Settings and answers its tool calls from the window (preload.cjs).
//
// What it speaks: the initialize-based revisions, 2025-03-26 to
// 2025-11-25, which the reference SDK and today's clients use. A client of
// the stateless 2026-07-28 revision sends its version in a header; that
// gets a 400 whose body is not one of that revision's errors, which is the
// signal a dual-era client falls back to `initialize` on. No sessions (the
// transport lets a server go without), no GET stream (nothing is ever
// pushed: the tool list doesn't change while the app runs), one JSON
// response per request.
//
// Who may talk to it: a program on this computer that has the token. It
// listens on 127.0.0.1 only; a request needs `Authorization: Bearer
// <token>`; and, against DNS rebinding — a web page whose host name points
// at 127.0.0.1 — a request with an Origin header (every browser request
// across origins has one) or a Host other than 127.0.0.1 or localhost on
// this port is refused before the token is looked at.

const crypto = require("node:crypto");
const http = require("node:http");

const PROTOCOL_VERSIONS = Object.freeze(["2025-11-25", "2025-06-18", "2025-03-26"]);
const ENDPOINT = "/mcp";
// A bench config is the largest thing a tool takes, and imported meshes
// stay behind in the app (load_bench's "(left out)"): a megabyte is plenty.
const BODY_LIMIT = 1024 * 1024;
const TOKEN = /^[0-9a-f]{64}$/;

/** A fresh token: 32 random bytes, as hex. */
function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

/** @param {unknown} token */
function isToken(token) {
  return typeof token === "string" && TOKEN.test(token);
}

/**
 * @typedef {object} McpTool what tools/list says about a tool (MCP's Tool)
 * @property {string} name
 * @property {string} [title]
 * @property {string} description
 * @property {object} inputSchema
 * @property {object} [annotations]
 */
/**
 * @typedef {object} McpServerOptions
 * @property {string} token the bearer token a request must carry
 * @property {() => Promise<McpTool[]>} listTools
 * @property {(name: string, args: Record<string, unknown>) => Promise<object>} callTool
 *   resolves with an MCP CallToolResult ({ content, isError? }); a rejection is
 *   reported as a failed call with its message
 * @property {{ name: string, title?: string, version: string }} serverInfo
 * @property {string} [instructions] what the server is for, for the agent
 */

/**
 * @param {McpServerOptions} options
 */
function createMcpServer({ token, listTools, callTool, serverInfo, instructions }) {
  if (!isToken(token)) throw new Error("The MCP token has to be 64 hex digits.");
  let expected = Buffer.from(token);
  /** @type {number | null} */
  let port = null;

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) send(res, 500, rpcError(null, -32603, `Internal error: ${err.message}`));
      else res.destroy();
    });
  });
  // An agent's HTTP client keeps connections open between calls; nothing
  // here needs more than a request's worth of time, except a tool call
  // waiting on a dialog the user has to answer.
  server.keepAliveTimeout = 5_000;
  server.requestTimeout = 0;

  /** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
  async function handle(req, res) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== ENDPOINT)
      return send(res, 404, rpcError(null, -32000, `Not found: the endpoint is ${ENDPOINT}.`));
    if (req.headers.origin !== undefined) {
      return send(res, 403, rpcError(null, -32000, "Forbidden: web pages may not use this server."));
    }
    if (!hostAllowed(req.headers.host))
      return send(res, 403, rpcError(null, -32000, "Forbidden: unexpected Host."));
    if (!authorized(req.headers.authorization)) {
      return send(
        res,
        401,
        rpcError(
          null,
          -32000,
          "Unauthorized: send the token from Connector Foundry's Settings as a Bearer token.",
        ),
      );
    }
    if (req.method !== "POST") {
      // No server-to-client stream (GET) and no sessions to end (DELETE).
      res.setHeader("Allow", "POST");
      return send(res, 405, rpcError(null, -32000, "Method not allowed: send JSON-RPC messages with POST."));
    }
    if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) {
      return send(res, 415, rpcError(null, -32000, "Unsupported media type: send application/json."));
    }
    const version = req.headers["mcp-protocol-version"];
    if (version !== undefined && !PROTOCOL_VERSIONS.includes(String(version))) {
      return send(
        res,
        400,
        rpcError(
          null,
          -32000,
          `Bad Request: protocol version ${version} isn't supported; this server speaks ${PROTOCOL_VERSIONS.join(", ")}.`,
        ),
      );
    }

    let text;
    try {
      text = await readBody(req);
    } catch (err) {
      return send(res, 413, rpcError(null, -32000, err.message));
    }
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return send(res, 400, rpcError(null, -32700, "Parse error: the body isn't JSON."));
    }
    if (Array.isArray(message)) {
      return send(
        res,
        400,
        rpcError(null, -32600, "Invalid request: send one JSON-RPC message per request."),
      );
    }
    if (!isObject(message) || message.jsonrpc !== "2.0") {
      return send(res, 400, rpcError(null, -32600, "Invalid request: not a JSON-RPC 2.0 message."));
    }
    // A notification (notifications/initialized, a cancellation) or a
    // response to a request this server never sends: accepted, no body.
    if (!("id" in message) || typeof message.method !== "string") {
      res.writeHead(202).end();
      return;
    }
    const { id } = message;
    if (!(typeof id === "string" || (typeof id === "number" && Number.isFinite(id)))) {
      return send(
        res,
        400,
        rpcError(null, -32600, "Invalid request: the id has to be a string or a number."),
      );
    }
    const params = isObject(message.params) ? message.params : {};
    send(res, 200, await answer(id, message.method, params));
  }

  /**
   * @param {string | number} id
   * @param {string} method
   * @param {Record<string, any>} params
   */
  async function answer(id, method, params) {
    switch (method) {
      case "initialize": {
        const requested = params.protocolVersion;
        return rpcResult(id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo,
          ...(instructions ? { instructions } : {}),
        });
      }
      case "ping":
        return rpcResult(id, {});
      case "tools/list":
        try {
          return rpcResult(id, { tools: await listTools() });
        } catch (err) {
          return rpcError(id, -32603, err.message);
        }
      case "tools/call": {
        const { name } = params;
        const args = params.arguments ?? {};
        if (typeof name !== "string")
          return rpcError(id, -32602, "Invalid params: the tool's name is missing.");
        if (!isObject(args)) return rpcError(id, -32602, "Invalid params: arguments have to be an object.");
        let tools;
        try {
          tools = await listTools();
        } catch (err) {
          return rpcError(id, -32603, err.message);
        }
        if (!tools.some((t) => t.name === name)) return rpcError(id, -32602, `Unknown tool: ${name}`);
        try {
          return rpcResult(id, callResult(await callTool(name, args)));
        } catch (err) {
          return rpcResult(id, { content: [{ type: "text", text: err.message }], isError: true });
        }
      }
      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  }

  /** @param {string | string[] | undefined} host */
  function hostAllowed(host) {
    return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
  }

  /** @param {string | undefined} header */
  function authorized(header) {
    const match = /^Bearer (\S+)$/.exec(header ?? "");
    if (!match) return false;
    const given = Buffer.from(match[1]);
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  }

  return {
    /**
     * Listens on 127.0.0.1 only. Rejects with the server's error — EADDRINUSE
     * when another program has the port.
     * @param {number} wanted 0 for any free port (the tests)
     * @returns {Promise<number>} the port
     */
    listen(wanted) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(wanted, "127.0.0.1", () => {
          server.off("error", reject);
          const address = server.address();
          port = typeof address === "object" && address ? address.port : wanted;
          resolve(port);
        });
      });
    },
    /** Stops listening and drops open connections. */
    close() {
      return new Promise((resolve) => {
        server.close(() => resolve(undefined));
        server.closeAllConnections();
      });
    },
    /** @param {string} next a new token; the old one stops working at once */
    setToken(next) {
      if (!isToken(next)) throw new Error("The MCP token has to be 64 hex digits.");
      expected = Buffer.from(next);
    },
  };
}

/** @param {unknown} v @returns {v is Record<string, any>} */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * A tool's answer as MCP's CallToolResult: whatever came back that isn't
 * one is reported as text, so a client never gets a malformed result.
 * @param {any} result
 */
function callResult(result) {
  if (isObject(result) && Array.isArray(result.content)) {
    return { content: result.content, ...(result.isError ? { isError: true } : {}) };
  }
  return { content: [{ type: "text", text: JSON.stringify(result ?? null) }] };
}

/** @param {string | number} id @param {unknown} result */
function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

/** @param {string | number | null} id @param {number} code @param {string} message */
function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** @param {http.ServerResponse} res @param {number} status @param {unknown} body */
function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  res.end(text);
}

/** @param {http.IncomingMessage} req @returns {Promise<string>} */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const onData = (chunk) => {
      size += chunk.length;
      if (size <= BODY_LIMIT) return void chunks.push(chunk);
      // Answered at once; the rest is read and dropped, so the client
      // gets the 413 rather than a reset connection.
      req.off("data", onData);
      req.resume();
      reject(new Error(`Payload too large: at most ${BODY_LIMIT} bytes.`));
    };
    req.on("data", onData);
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

module.exports = { ENDPOINT, PROTOCOL_VERSIONS, createMcpServer, isToken, newToken };

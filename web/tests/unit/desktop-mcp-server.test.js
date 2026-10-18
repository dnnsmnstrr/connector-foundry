import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import http from "node:http";

const { PROTOCOL_VERSIONS, createMcpServer, isToken, newToken } = createRequire(import.meta.url)(
  "../../desktop/mcp-server.cjs",
);

// The desktop app's MCP server (desktop/mcp-server.cjs) on a free port,
// with a stand-in for the window's tools.

const TOKEN = "a".repeat(64);
const TOOLS = [
  {
    name: "search_parts",
    title: "Search the parts catalogue",
    description: "Searches the catalogue.",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

async function start(t, options = {}) {
  const calls = [];
  const server = createMcpServer({
    token: TOKEN,
    listTools: async () => TOOLS,
    callTool: async (name, args) => {
      calls.push({ name, args });
      return { content: [{ type: "text", text: JSON.stringify({ parts: [] }) }] };
    },
    serverInfo: { name: "connector-foundry", title: "Connector Foundry", version: "1.2.3" },
    instructions: "Drives the open Connector Foundry window.",
    ...options,
  });
  const port = await server.listen(0);
  t.after(() => server.close());
  return { server, port, calls };
}

/**
 * A raw HTTP request, so the Host and Origin headers are exactly what the
 * test says (fetch sets Host itself and refuses to send some headers).
 */
function request(port, { method = "POST", path = "/mcp", headers = {}, body } = {}) {
  const text = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          host: `127.0.0.1:${port}`,
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : null }),
        );
      },
    );
    req.on("error", reject);
    if (text !== undefined) req.write(text);
    req.end();
  });
}

const rpc = (id, method, params) => ({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });

test("tokens are 32 random bytes as hex, and only those are accepted", () => {
  const token = newToken();
  assert.ok(isToken(token));
  assert.notEqual(newToken(), token);
  for (const bad of ["", "abc", "A".repeat(64), "g".repeat(64), 42, null]) assert.equal(isToken(bad), false);
  assert.throws(() => createMcpServer({ token: "short" }), /64 hex digits/);
});

test("initialize negotiates a version, and then tools are listed and called", async (t) => {
  const { port, calls } = await start(t);
  const init = await request(port, {
    body: rpc(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    }),
  });
  assert.equal(init.status, 200);
  assert.deepEqual(init.body, {
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "connector-foundry", title: "Connector Foundry", version: "1.2.3" },
      instructions: "Drives the open Connector Foundry window.",
    },
  });
  // No session: nothing to send back on later requests.
  assert.equal(init.headers["mcp-session-id"], undefined);
  // A version it doesn't know gets the newest it does.
  const future = await request(port, { body: rpc(2, "initialize", { protocolVersion: "2099-01-01" }) });
  assert.equal(future.body.result.protocolVersion, PROTOCOL_VERSIONS[0]);

  const initialized = await request(port, {
    headers: { "mcp-protocol-version": "2025-06-18" },
    body: { jsonrpc: "2.0", method: "notifications/initialized" },
  });
  assert.equal(initialized.status, 202);
  assert.equal(initialized.body, null);

  const listed = await request(port, {
    headers: { "mcp-protocol-version": "2025-06-18" },
    body: rpc(3, "tools/list"),
  });
  assert.deepEqual(listed.body.result, { tools: TOOLS });

  const called = await request(port, {
    body: rpc("call-1", "tools/call", { name: "search_parts", arguments: { query: "plate" } }),
  });
  assert.deepEqual(called.body, {
    jsonrpc: "2.0",
    id: "call-1",
    result: { content: [{ type: "text", text: '{"parts":[]}' }] },
  });
  assert.deepEqual(calls, [{ name: "search_parts", args: { query: "plate" } }]);
  assert.deepEqual((await request(port, { body: rpc(4, "ping") })).body, {
    jsonrpc: "2.0",
    id: 4,
    result: {},
  });
});

test("a tool's failure is a failed call; a bad call is a JSON-RPC error", async (t) => {
  const { port } = await start(t, {
    callTool: async () => {
      throw new Error("The app didn't answer in time.");
    },
  });
  const failed = await request(port, { body: rpc(1, "tools/call", { name: "search_parts" }) });
  assert.deepEqual(failed.body.result, {
    content: [{ type: "text", text: "The app didn't answer in time." }],
    isError: true,
  });
  const unknown = await request(port, { body: rpc(2, "tools/call", { name: "rm_rf" }) });
  assert.deepEqual(unknown.body.error, { code: -32602, message: "Unknown tool: rm_rf" });
  const noName = await request(port, { body: rpc(3, "tools/call", {}) });
  assert.equal(noName.body.error.code, -32602);
  const badArgs = await request(port, {
    body: rpc(4, "tools/call", { name: "search_parts", arguments: [1] }),
  });
  assert.equal(badArgs.body.error.code, -32602);
  const method = await request(port, { body: rpc(5, "resources/list") });
  assert.deepEqual(method.body.error, { code: -32601, message: "Method not found: resources/list" });
});

test("a result that isn't MCP's shape is passed on as text", async (t) => {
  const { port } = await start(t, { callTool: async () => ({ ok: true }) });
  const called = await request(port, { body: rpc(1, "tools/call", { name: "search_parts" }) });
  assert.deepEqual(called.body.result, { content: [{ type: "text", text: '{"ok":true}' }] });
});

test("nobody without the token, no web page, no other host name", async (t) => {
  const { port, calls } = await start(t);
  const body = rpc(1, "tools/call", { name: "search_parts" });
  const noToken = await request(port, { headers: { authorization: "" }, body });
  assert.equal(noToken.status, 401);
  assert.match(noToken.body.error.message, /Unauthorized/);
  assert.equal(
    (await request(port, { headers: { authorization: `Bearer ${"b".repeat(64)}` }, body })).status,
    401,
  );
  assert.equal((await request(port, { headers: { authorization: `Basic ${TOKEN}` }, body })).status, 401);
  assert.equal((await request(port, { headers: { authorization: `Bearer ${TOKEN}x` }, body })).status, 401);
  // A browser's request across origins carries an Origin; a rebinding
  // page's carries its own host name. Either is refused, token or not.
  assert.equal((await request(port, { headers: { origin: "https://evil.example" }, body })).status, 403);
  assert.equal((await request(port, { headers: { origin: "null" }, body })).status, 403);
  assert.equal((await request(port, { headers: { host: `evil.example:${port}` }, body })).status, 403);
  assert.equal((await request(port, { headers: { host: "127.0.0.1:1" }, body })).status, 403);
  // localhost is the same computer.
  assert.equal((await request(port, { headers: { host: `localhost:${port}` }, body })).status, 200);
  assert.equal(calls.length, 1);
});

test("one endpoint, POST only, JSON only, one message at a time, in a version it speaks", async (t) => {
  const { port } = await start(t);
  assert.equal((await request(port, { path: "/", body: rpc(1, "ping") })).status, 404);
  const get = await request(port, { method: "GET" });
  assert.equal(get.status, 405);
  assert.equal(get.headers.allow, "POST");
  assert.equal((await request(port, { method: "DELETE" })).status, 405);
  assert.equal(
    (await request(port, { headers: { "content-type": "text/plain" }, body: rpc(1, "ping") })).status,
    415,
  );
  const garbled = await request(port, { body: "{not json" });
  assert.equal(garbled.status, 400);
  assert.equal(garbled.body.error.code, -32700);
  const batch = await request(port, { body: [rpc(1, "ping"), rpc(2, "ping")] });
  assert.equal(batch.status, 400);
  assert.equal(batch.body.error.code, -32600);
  assert.equal((await request(port, { body: { id: 1, method: "ping" } })).status, 400);
  assert.equal((await request(port, { body: rpc({ an: "object" }, "ping") })).status, 400);
  // The stateless 2026-07-28 revision's request: a 400 that isn't one of
  // its errors, so a dual-era client falls back to initialize.
  const modern = await request(port, {
    headers: { "mcp-protocol-version": "2026-07-28" },
    body: rpc(1, "tools/list"),
  });
  assert.equal(modern.status, 400);
  assert.equal(modern.body.error.code, -32000);
  assert.match(modern.body.error.message, /2025-11-25, 2025-06-18, 2025-03-26/);
  const huge = await request(port, {
    body: rpc(1, "tools/call", { name: "x", arguments: { a: "x".repeat(1100000) } }),
  });
  assert.equal(huge.status, 413);
});

test("a new token takes effect at once, and the old one stops working", async (t) => {
  const { server, port } = await start(t);
  const next = newToken();
  server.setToken(next);
  assert.equal((await request(port, { body: rpc(1, "ping") })).status, 401);
  assert.equal(
    (await request(port, { headers: { authorization: `Bearer ${next}` }, body: rpc(1, "ping") })).status,
    200,
  );
  assert.throws(() => server.setToken("nope"), /64 hex digits/);
});

test("a port in use is an error for the caller, not a crash", async (t) => {
  const { port } = await start(t);
  const second = createMcpServer({
    token: TOKEN,
    listTools: async () => [],
    callTool: async () => ({}),
    serverInfo: { name: "x", version: "0" },
  });
  await assert.rejects(second.listen(port), { code: "EADDRINUSE" });
});

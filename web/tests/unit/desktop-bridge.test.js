import test from "node:test";
import assert from "node:assert/strict";

import { claudeCodeCommand, desktopBridge, mcpJsonConfig } from "../../src/lib/desktopBridge.js";

const status = {
  enabled: true,
  listening: true,
  url: "http://127.0.0.1:47811/mcp",
  token: "0123456789abcdef".repeat(4),
  error: null,
};

test("the Claude Code command adds the server user-wide, with the token as a header", () => {
  assert.equal(
    claudeCodeCommand(status),
    `claude mcp add --scope user --transport http connector-foundry http://127.0.0.1:47811/mcp --header "Authorization: Bearer ${status.token}"`,
  );
});

test("the JSON config is an mcpServers entry other agents take", () => {
  assert.deepEqual(JSON.parse(mcpJsonConfig(status)), {
    mcpServers: {
      "connector-foundry": {
        type: "http",
        url: "http://127.0.0.1:47811/mcp",
        headers: { Authorization: `Bearer ${status.token}` },
      },
    },
  });
});

test("outside the desktop app there is no bridge", () => {
  assert.equal(desktopBridge(), null);
  globalThis.foundryDesktop = "not an object";
  try {
    assert.equal(desktopBridge(), null);
  } finally {
    delete globalThis.foundryDesktop;
  }
});

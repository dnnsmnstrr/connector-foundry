import test from "node:test";
import assert from "node:assert/strict";

import {
  claudeCodeCommand,
  desktopBridge,
  hasDesktopSlicer,
  mcpJsonConfig,
  openInDesktopSlicer,
} from "../../src/lib/desktopBridge.js";

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

test("outside the desktop app there is no bridge", async () => {
  assert.equal(desktopBridge(), null);
  assert.equal(hasDesktopSlicer(), false);
  await assert.rejects(() => openInDesktopSlicer(new Uint8Array([1]), "part.3mf"), /only available/);
  globalThis.foundryDesktop = "not an object";
  try {
    assert.equal(desktopBridge(), null);
    assert.equal(hasDesktopSlicer(), false);
  } finally {
    delete globalThis.foundryDesktop;
  }
});

test("openInDesktopSlicer hands bytes and filename to the preload's slicer bridge", async (t) => {
  const calls = [];
  globalThis.foundryDesktop = {
    slicer: {
      open: async (bytes, filename) => {
        calls.push({ bytes, filename });
        return filename === "fail.3mf"
          ? { ok: false, error: "No slicer installed." }
          : { ok: true, path: `/tmp/${filename}`, slicer: "OrcaSlicer" };
      },
    },
  };
  t.after(() => {
    delete globalThis.foundryDesktop;
  });

  assert.equal(hasDesktopSlicer(), true);
  const result = await openInDesktopSlicer(new Uint8Array([1, 2, 3]), "part.3mf");
  assert.deepEqual(result, { ok: true, path: "/tmp/part.3mf", slicer: "OrcaSlicer" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].filename, "part.3mf");
  await assert.rejects(() => openInDesktopSlicer(new Uint8Array([1]), "fail.3mf"), /No slicer installed/);
});

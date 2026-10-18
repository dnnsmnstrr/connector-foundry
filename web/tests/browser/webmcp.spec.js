import { expect, test } from "@playwright/test";
import { BoxGeometry, Mesh } from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

// The app's WebMCP tools (lib/webmcp.js), registered with a stand-in for
// the browser's document.modelContext and called as an agent would. The
// mock worker answers every render with the same cube, as in
// palette.spec.js — except one that names the slot "nope", which fails as
// OpenSCAD would: these check what the tools do to the app, never the
// geometry.

const cube = new STLExporter().parse(new Mesh(new BoxGeometry(10, 10, 4)), { binary: true });
const cubeBytes = [...new Uint8Array(cube.buffer, cube.byteOffset, cube.byteLength)];
const plate = {
  id: "basics/plate",
  name: "Flat plate",
  system: "Basics",
  confidence: "exact",
  file: "parts/basics/plate.scad",
  module: "basics_plate",
  defaults: { w: 40, d: 40, t: 4, r: 3 },
  anchors: ["bot"],
};
// One slot per 28 mm cell, as catalogue.yaml's.
const board = {
  id: "opengrid/board",
  name: "Board",
  system: "openGrid",
  confidence: "exact",
  file: "parts/opengrid/board.scad",
  module: "og_board",
  slots: { pitch: 28, count_params: ["cells_x", "cells_y"] },
  defaults: { cells_x: 2, cells_y: 2, variant: "full" },
  options: { variant: ["full", "lite"] },
};

const TOOLS = [
  "list_commands",
  "run_command",
  "search_parts",
  "open_part",
  "attach_part",
  "get_app_state",
  "load_bench",
];

test.beforeEach(async ({ page }) => {
  await page.route("**/catalogue.json", (route) => route.fulfill({ json: { parts: [plate, board] } }));
  await page.addInitScript(
    ({ bytes }) => {
      window.Worker = class {
        postMessage(request) {
          if (request?.type === "warm") return;
          if (JSON.stringify(request).includes("nope")) {
            queueMicrotask(() =>
              this.onmessage({ data: { id: request.id, type: "error", message: 'No anchor named "nope".' } }),
            );
            return;
          }
          queueMicrotask(() =>
            this.onmessage({ data: { id: request.id, type: "result", stl: new Uint8Array(bytes).buffer } }),
          );
        }
        terminate() {}
      };
      // The draft's API, as far as the app uses it: tools come in with a
      // signal that takes them away again.
      const tools = new Map();
      window.__webmcpTools = tools;
      document.modelContext = {
        registerTool(tool, { signal } = {}) {
          if (tools.has(tool.name)) return Promise.reject(new DOMException("taken", "InvalidStateError"));
          tools.set(tool.name, tool);
          signal?.addEventListener("abort", () => tools.delete(tool.name));
          return Promise.resolve();
        },
      };
    },
    { bytes: cubeBytes },
  );
});

/** Calls a tool the way an agent's browser would. */
function call(page, name, input = {}) {
  return page.evaluate(([n, i]) => window.__webmcpTools.get(n).execute(i, {}), [name, input]);
}

const activeTab = (page) => page.locator(".mode-tab.active");

test("an agent finds a part, opens it on the Bench, attaches to a slot and goes back", async ({ page }) => {
  await page.goto("/app/");
  await expect(page.getByRole("heading", { name: "Flat plate", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => [...window.__webmcpTools.keys()])).toEqual(TOOLS);

  const { parts } = await call(page, "search_parts", { query: "opengrid" });
  expect(parts.map((p) => p.id)).toEqual(["opengrid/board"]);
  expect(parts[0].options).toEqual({ variant: ["full", "lite"] });
  expect(await call(page, "open_part", { partId: "opengrid/board", params: { variant: "duo" } })).toEqual({
    error: '"variant" is one of "full", "lite".',
  });

  expect(
    await call(page, "open_part", { partId: "opengrid/board", params: { cells_x: 3 }, target: "bench" }),
  ).toEqual({ opened: "Board", tab: "bench" });
  await expect(activeTab(page)).toContainText("Bench");
  await expect(page.getByRole("heading", { name: "Attached (0 of 3)" })).toBeVisible();
  const state = await call(page, "get_app_state");
  expect(state.tab).toBe("bench");
  expect(state.bench.root).toEqual({
    partId: "opengrid/board",
    params: { cells_x: 3, cells_y: 2, variant: "full" },
  });

  // The open slots, once the board's render has measured them: one per
  // cell, the same ones Attach a part… lists.
  await expect.poll(async () => (await call(page, "get_app_state")).openSlots?.length).toBe(6);
  const { openSlots, preview } = await call(page, "get_app_state");
  expect(preview).toEqual({ status: "done", error: null });
  const { commands: slots } = await call(page, "list_commands", { within: ["bench.attach"] });
  expect(slots.map((c) => c.title).sort()).toEqual(openSlots.map((s) => s.slotName).sort());
  const [{ parentId, slotName }] = openSlots;
  expect(parentId).toBe("root");

  expect(await call(page, "attach_part", { partId: "basics/plate", slotName: "mount_9_9" })).toEqual({
    error: expect.stringMatching(/^mount_9_9 on root isn't an open slot\. Open ones: /),
  });
  const attached = await call(page, "attach_part", { partId: "basics/plate", slotName, joint: "bolted" });
  expect(attached).toEqual({
    attached: "Flat plate",
    nodeId: expect.any(String),
    parentId,
    slotName,
    joint: "bolted",
  });
  await expect(page.getByRole("heading", { name: "Attached (1 of 3)" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Joint for Flat plate" })).toHaveValue("bolted");
  const undo = page.getByRole("button", { name: "Undo", exact: true }).first();
  await expect(undo).toHaveAttribute("title", /^Undo attach part /);

  // A slot the part doesn't have, written through load_bench: loaded,
  // and the render's failure is there for the agent to read.
  const { bench } = await call(page, "get_app_state");
  expect(bench.nodes).toEqual([expect.objectContaining({ id: attached.nodeId, slotName, joint: "bolted" })]);
  bench.nodes[0].slotName = "nope";
  expect(await call(page, "load_bench", { config: bench })).toEqual({ loaded: true, parts: 2 });
  await expect(undo).toHaveAttribute("title", /^Undo load bench /);
  await expect
    .poll(async () => (await call(page, "get_app_state")).preview)
    .toEqual({ status: "error", error: expect.stringContaining('No anchor named "nope".') });
  await expect(page.getByRole("alert").filter({ hasText: "nope" })).toBeVisible();

  // Commands follow the tab: the Library's are not on offer on the Bench.
  const { commands } = await call(page, "list_commands", { query: "download stl" });
  expect(commands.map((c) => c.id)).toContain("bench.downloadStl:root");
  expect(await call(page, "run_command", { id: "app.library" })).toEqual({
    ran: "Go to the Library",
    action: "Go",
  });
  await expect(activeTab(page)).toContainText("Library");

  // Replacing the bench asks the user, as Open in Bench does; a "no" is
  // the agent's answer too.
  page.once("dialog", (dialog) => dialog.dismiss());
  expect(await call(page, "open_part", { partId: "basics/plate", target: "bench" })).toEqual({
    opened: false,
    reason: "The user chose to keep what they had.",
  });
  await expect(activeTab(page)).toContainText("Library");
});

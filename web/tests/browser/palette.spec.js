import { expect, test } from "@playwright/test";
import { BoxGeometry, Mesh } from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

// The command palette (components/CommandPalette.jsx, Mod+K) and the
// Bench's and Holes' part pickers, which are palette pages. The mock
// worker answers every render with the same 10 × 10 × 4 mm cube, as in
// bench-handles.spec.js: these check what the palette runs, never the
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
const post = {
  id: "basics/post",
  name: "Round post",
  system: "Basics",
  confidence: "exact",
  file: "parts/basics/post.scad",
  module: "basics_post",
  defaults: { d: 12, h: 20 },
  anchors: ["bot"],
};
// As catalogue.yaml's: one slot per 28 mm cell, named by centre-relative
// index, so 2 cells are ±0.5.
const board = {
  id: "opengrid/board",
  name: "Board",
  system: "openGrid",
  confidence: "exact",
  file: "parts/opengrid/board.scad",
  module: "og_board",
  slots: { pitch: 28, count_params: ["cells_x", "cells_y"] },
  defaults: { cells_x: 2, cells_y: 2, variant: "full" },
};

async function catalogue(page, parts = [plate, post, board]) {
  await page.route("**/catalogue.json", (route) => route.fulfill({ json: { parts } }));
}

async function mockWorker(page) {
  await page.addInitScript(
    ({ bytes }) => {
      window.Worker = class {
        postMessage(request) {
          // The client's warm-ups are not jobs and get no answer.
          if (request?.type === "warm") return;
          queueMicrotask(() =>
            this.onmessage({ data: { id: request.id, type: "result", stl: new Uint8Array(bytes).buffer } }),
          );
        }
        terminate() {}
      };
    },
    { bytes: cubeBytes },
  );
}

const palette = (page) => page.locator("dialog.command-palette");
// The palette's rows, not the <option>s of a <select> behind it.
const rows = (page) => palette(page).getByRole("option");
const commandSearch = (page) => page.getByRole("combobox", { name: "Search commands" });

async function openPalette(page) {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(commandSearch(page)).toBeFocused();
}

async function importConfig(page, config) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("option", { name: "Import config…", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "test.bench.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(config)),
  });
}

test("Mod+K opens the palette and puts it away again, as Escape does", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/");
  await expect(page.getByRole("heading", { name: "Flat plate", exact: true })).toBeVisible();
  await openPalette(page);
  await expect(page.getByRole("heading", { name: "Commands", exact: true })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette(page)).toHaveCount(0);
  // The nav's button opens it too; Escape on an empty search closes it.
  await page.getByRole("button", { name: "Command palette" }).click();
  await expect(commandSearch(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);
  // Typed keys are the palette's: "2" is a character, not the Bench.
  await openPalette(page);
  await page.keyboard.type("2");
  await expect(commandSearch(page)).toHaveValue("2");
  await expect(page.locator(".mode-tab.active")).toContainText("Library");
});

test("initials find a command: oib and Enter opens the part in the Bench", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/");
  await expect(page.getByRole("heading", { name: "Flat plate", exact: true })).toBeVisible();
  await openPalette(page);
  await commandSearch(page).fill("oib");
  await expect(rows(page).first()).toHaveAccessibleName("Open in Bench");
  await page.keyboard.press("Enter");
  await expect(palette(page)).toHaveCount(0);
  await expect(page.locator(".mode-tab.active")).toContainText("Bench");
  await expect(page.getByRole("button", { name: "Select root" })).toBeVisible();
});

test("Settings from the palette; Mod+K does nothing over another dialog", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/");
  await openPalette(page);
  await commandSearch(page).fill("sett");
  await page.keyboard.press("Enter");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.waitForTimeout(100);
  await expect(palette(page)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(1);
});

test("what ran lately comes first, after a reload too", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/");
  await openPalette(page);
  await commandSearch(page).fill("keyboard");
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Flat plate", exact: true })).toBeVisible();
  await openPalette(page);
  await expect(palette(page).locator(".command-palette-section").first()).toHaveText("Recent");
  await expect(rows(page).first()).toHaveAccessibleName("Keyboard shortcuts");
});

test("a list of its own: Escape clears, then goes back, then closes; Backspace goes back", async ({
  page,
}) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/");
  await openPalette(page);
  await commandSearch(page).fill("grid");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Grid step", exact: true })).toBeVisible();
  // The step in use is the one highlighted.
  await expect(page.getByRole("option", { name: "0.5 mm", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const steps = page.getByRole("combobox", { name: "Search grid steps" });
  await steps.fill("2");
  await page.keyboard.press("Escape");
  await expect(steps).toHaveValue("");
  await page.keyboard.press("Escape");
  // Back on the list it came from, with the search it had.
  await expect(commandSearch(page)).toHaveValue("grid");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Backspace");
  await expect(commandSearch(page)).toHaveValue("grid");
  await page.keyboard.press("Enter");
  // Choosing one sets it and closes the palette.
  await page.getByRole("option", { name: "1 mm", exact: true }).click();
  await expect(palette(page)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("connector-foundry.gridSnap"))).toBe("1");
  await openPalette(page);
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);
});

test("a part's actions: → lists them all, and Mod+Enter runs the second there too", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/");
  await openPalette(page);
  await commandSearch(page).fill("round post");
  await expect(rows(page).first()).toHaveAccessibleName("Round post exact");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("heading", { name: "Round post", exact: true })).toBeVisible();
  await expect(rows(page)).toHaveText([/Show in the Library/, /Open in Bench/, /Add holes/]);
  // The keys go by position, whichever action is highlighted.
  await expect(rows(page).first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(palette(page)).toHaveCount(0);
  await expect(page.locator(".mode-tab.active")).toContainText("Bench");
  await expect(page.locator(".bench-sidebar")).toContainText("Round post");
});

test("Alt+Enter runs a command's third action", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/");
  await expect(page.getByRole("heading", { name: "Flat plate", exact: true })).toBeVisible();
  await openPalette(page);
  await commandSearch(page).fill("round post");
  await expect(rows(page).first()).toHaveAccessibleName("Round post exact");
  await expect(palette(page).locator(".command-palette-footer")).toContainText("Add holes");
  await page.keyboard.press("Alt+Enter");
  await expect(palette(page)).toHaveCount(0);
  await expect(page.locator(".mode-tab.active")).toContainText("Holes");
  await expect(page.getByRole("heading", { name: "Round post", exact: true })).toBeVisible();
});

test("a link's second action copies it", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/app/");
  await openPalette(page);
  await commandSearch(page).fill("github repo");
  await expect(rows(page).first()).toHaveAccessibleName("Open the GitHub repository");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(palette(page)).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Link copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "https://github.com/dnnsmnstrr/connector-foundry",
  );
});

test("Layerling opens on its own, as a bookmark", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.context().route("https://layerling.com/**", (route) => route.fulfill({ body: "ok" }));
  await page.goto("/app/");
  await openPalette(page);
  await commandSearch(page).fill("layerling");
  await expect(rows(page).first()).toHaveAccessibleName("Open Layerling");
  const popup = page.waitForEvent("popup");
  await page.keyboard.press("Enter");
  const opened = await popup;
  await opened.waitForLoadState();
  expect(opened.url()).toBe("https://layerling.com/");
});

test("the GitHub command opens the repository in a new window", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.context().route("https://github.com/**", (route) => route.fulfill({ body: "ok" }));
  await page.goto("/app/");
  await openPalette(page);
  await commandSearch(page).fill("github repo");
  const popup = page.waitForEvent("popup");
  await page.keyboard.press("Enter");
  const opened = await popup;
  await opened.waitForLoadState();
  expect(opened.url()).toBe("https://github.com/dnnsmnstrr/connector-foundry");
});

test("a hole type found in the palette is the one the sidebar shows", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/#mode=holes");
  await page.getByRole("option", { name: "Flat plate exact", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Flat plate", exact: true })).toBeVisible();
  await openPalette(page);
  await commandSearch(page).fill("m4 counter");
  await expect(rows(page).first()).toHaveAccessibleName("M4 countersunk");
  await page.keyboard.press("Enter");
  await expect(palette(page)).toHaveCount(0);
  await expect(
    page.locator(".holes-presets").getByRole("option", { name: /^M4 countersunk/ }),
  ).toHaveAttribute("aria-selected", "true");
});

test("the Bench's start picker: over the empty tab, put away with Escape, back with Mod+K", async ({
  page,
}) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/#mode=bench");
  await expect(page.getByRole("heading", { name: "Start a bench" })).toBeVisible();
  const search = page.getByRole("combobox", { name: "Search parts" });
  await expect(search).toBeFocused();
  // Its search reaches the rest of the app too.
  await search.fill("holes");
  await expect(palette(page).locator(".command-palette-section", { hasText: "Commands" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Go to Holes" })).toBeVisible();
  await search.fill("");
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);
  const choose = page.getByRole("button", { name: /^Choose a base part…/ });
  await expect(choose).toBeVisible();
  // Mod+K on the empty tab brings its picker back, not the command list.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("heading", { name: "Start a bench" })).toBeVisible();
  await page.keyboard.press("Escape");
  await choose.click();
  await expect(page.getByRole("heading", { name: "Start a bench" })).toBeVisible();

  // The import flow takes its place (never two dialogs) and gives it back.
  await page.getByRole("option", { name: "Import STL / STEP / 3MF…", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(palette(page)).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Start a bench" })).toBeVisible();

  await page.getByRole("option", { name: "Flat plate exact", exact: true }).click();
  await expect(palette(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Select root" })).toBeVisible();
});

test("attaching a part: the picker over the scene, with its joint beside the search", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/#mode=bench");
  await importConfig(page, {
    format: "connector-foundry/bench",
    version: 1,
    name: "bench",
    root: { partId: "opengrid/board", params: { cells_x: 2, cells_y: 2, variant: "full" } },
    nodes: [],
    imports: [],
  });
  await expect(page.getByRole("heading", { name: "Attached (0 of 3)" })).toBeVisible();
  // Attach a part…: a slot, then the part, its joint chosen beside the search.
  // (Offered once the board's own render has measured its slots.)
  await openPalette(page);
  await commandSearch(page).fill("attach");
  await expect(rows(page).first()).toHaveAccessibleName("Attach a part…");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Attach a part to…" })).toBeVisible();
  await expect(rows(page)).toHaveCount(4);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /^Attach to mount_/ })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByRole("combobox", { name: "Joint" }).selectOption("bolted");
  await page.getByRole("combobox", { name: "Search parts" }).fill("plate");
  await page.keyboard.press("Enter");
  await expect(palette(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Attached (1 of 3)" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Joint for Flat plate" })).toHaveValue("bolted");

  // Escape with nothing typed cancels an attach.
  await openPalette(page);
  await commandSearch(page).fill("attach");
  await expect(rows(page).first()).toHaveAccessibleName("Attach a part…");
  await page.keyboard.press("Enter");
  await expect(rows(page)).toHaveCount(3);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /^Attach to mount_/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Attached (1 of 3)" })).toBeVisible();
});

test("part rows show the gallery render, or the system's initial without one", async ({ page }) => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await catalogue(page, [
    { ...plate, thumbnail: "thumbnails/basics_plate.png" },
    { ...post, thumbnail: "thumbnails/basics_post.png" },
    board,
  ]);
  await page.route("**/thumbnails/basics_plate.png", (route) =>
    route.fulfill({ contentType: "image/png", body: png }),
  );
  await page.route("**/thumbnails/basics_post.png", (route) => route.fulfill({ status: 404 }));
  await mockWorker(page);
  await page.goto("/app/#mode=bench");
  const row = (name) => page.getByRole("option", { name, exact: true });
  await expect
    .poll(() =>
      row("Flat plate exact")
        .locator("img")
        .evaluate((img) => img.naturalWidth),
    )
    .toBe(1);
  // A render that doesn't load, and a part without one, show the initial.
  await expect(row("Round post exact").locator(".command-thumb-empty")).toHaveText("B");
  await expect(row("Board exact").locator(".command-thumb-empty")).toHaveText("O");
});

test("the user's own commands: listed first, found by alias, run by hotkey", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  // As a settings import leaves them (lib/userCommands.js).
  await page.addInitScript(() => {
    localStorage.setItem(
      "connector-foundry.userCommands",
      JSON.stringify({
        version: 1,
        commands: [
          {
            id: "post-bench",
            title: "A tall post on the bench",
            alias: "tp",
            hotkey: "Mod+Shift+L",
            action: { kind: "open-part", partId: "basics/post", params: { h: 30 }, target: "bench" },
          },
          { id: "bad", title: "Dropped", action: { kind: "link", url: "javascript:alert(1)" } },
        ],
        bindings: { "app.shortcuts": { alias: "keys" } },
      }),
    );
  });
  await page.goto("/app/");
  await expect(page.getByRole("heading", { name: "Flat plate", exact: true })).toBeVisible();
  await openPalette(page);
  await expect(palette(page).locator(".command-palette-section").first()).toHaveText("Your commands");
  await expect(rows(page).first()).toHaveAccessibleName("A tall post on the bench");
  await expect(palette(page).getByText("Dropped")).toHaveCount(0);
  // An alias typed exactly is that command, title or not.
  await commandSearch(page).fill("keys");
  await expect(rows(page).first()).toHaveAccessibleName("Keyboard shortcuts");
  await commandSearch(page).fill("tp");
  await expect(rows(page).first()).toHaveAccessibleName("A tall post on the bench");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);
  // The hotkey runs it from anywhere outside a dialog.
  await page.keyboard.press("ControlOrMeta+Shift+L");
  await expect(page.locator(".mode-tab.active")).toContainText("Bench");
  await expect(page.locator(".bench-sidebar")).toContainText("Round post");
  expect(await page.evaluate(() => location.hash)).toContain("mode=bench");
});

// A model file dragged from the desktop and dropped on `target`: the
// events a real drag fires, carrying the cube as an STL.
async function dropModel(page, target, name = "cube.stl") {
  const dataTransfer = await page.evaluateHandle(
    ({ bytes, name }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], name, { type: "model/stl" }));
      return dt;
    },
    { bytes: cubeBytes, name },
  );
  await target.dispatchEvent("dragenter", { dataTransfer });
  await target.dispatchEvent("dragover", { dataTransfer });
  return {
    drop: () => target.dispatchEvent("drop", { dataTransfer }),
  };
}

test("a model dropped on the Bench's start picker is imported as the base part", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/#mode=bench");
  await expect(page.getByRole("heading", { name: "Start a bench" })).toBeVisible();
  const dragged = await dropModel(page, palette(page));
  await expect(palette(page).locator(".command-palette-drop")).toHaveText(
    "Drop to import it as the base part",
  );
  await dragged.drop();
  // The import flow takes the picker's place, already reading the file.
  await expect(palette(page)).toHaveCount(0);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  await expect(dialog.getByText("Clean — watertight, single solid, no repairs needed.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Use as base part", exact: true })).toBeVisible();
  // Cancelled, the picker comes back, and nothing of the file stays.
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Start a bench" })).toBeVisible();
  await page.getByRole("option", { name: "Import STL / STEP / 3MF…", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("Clean — watertight")).toHaveCount(0);
});

test("the empty tabs take a dropped model once their picker is put away", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/#mode=holes");
  await expect(page.getByRole("heading", { name: "Drill screw holes" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);
  const empty = page.locator(".bench-empty");
  const dragged = await dropModel(page, empty, "bracket.stl");
  await expect(empty.locator(".bench-empty-drop")).toHaveText("Drop to drill holes in it");
  await dragged.drop();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Clean — watertight, single solid, no repairs needed.")).toBeVisible();
  await dialog.getByRole("button", { name: "Use this mesh", exact: true }).click();
  await expect(page.getByRole("heading", { name: "bracket.stl", exact: true })).toBeVisible();

  // The Bench's empty tab too.
  await page.getByTitle("Bench (2)").click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Choose a base part…/ })).toBeVisible();
  await (await dropModel(page, page.locator(".bench-empty"))).drop();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Use as base part", exact: true }),
  ).toBeVisible();
});

test("a model dropped on the palette over a model in Holes replaces it", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/#mode=holes");
  await page.getByRole("option", { name: "Flat plate exact", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Flat plate", exact: true })).toBeVisible();
  await openPalette(page);
  const dragged = await dropModel(page, palette(page), "lid.stl");
  await expect(palette(page).locator(".command-palette-drop")).toHaveText(
    "Drop to drill holes in this model instead",
  );
  await dragged.drop();
  await expect(palette(page)).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button", { name: "Use this mesh", exact: true }).click();
  await expect(page.getByRole("heading", { name: "lid.stl", exact: true })).toBeVisible();
  // Undoable, as Pick another model is.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByRole("heading", { name: "Flat plate", exact: true })).toBeVisible();
});

test("the Library's palette refuses a dropped file rather than opening it", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/");
  await expect(page.getByRole("heading", { name: "Flat plate", exact: true })).toBeVisible();
  await openPalette(page);
  const dragged = await dropModel(page, palette(page));
  await expect(palette(page).locator(".command-palette-drop")).toHaveCount(0);
  await dragged.drop();
  await expect(palette(page)).toHaveCount(1);
  expect(page.url()).toMatch(/^http:\/\/127\.0\.0\.1:4175\/app\//);
});

test("a model dropped on the attach picker is imported to attach on that slot", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/#mode=bench");
  await importConfig(page, {
    format: "connector-foundry/bench",
    version: 1,
    name: "bench",
    root: { partId: "opengrid/board", params: { cells_x: 2, cells_y: 2, variant: "full" } },
    nodes: [],
    imports: [],
  });
  await expect(page.getByRole("heading", { name: "Attached (0 of 3)" })).toBeVisible();
  await openPalette(page);
  await commandSearch(page).fill("attach");
  await expect(rows(page).first()).toHaveAccessibleName("Attach a part…");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /^Attach to mount_/ })).toBeVisible();
  const dragged = await dropModel(page, palette(page));
  await expect(palette(page).locator(".command-palette-drop")).toHaveText(
    "Drop to import it and attach it here",
  );
  await dragged.drop();
  await expect(palette(page)).toHaveCount(0);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Clean — watertight, single solid, no repairs needed.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Attach here", exact: true })).toBeVisible();
});

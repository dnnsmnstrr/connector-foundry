import test from "node:test";
import assert from "node:assert/strict";

import { hydrateBenchConfig } from "../../src/lib/benchConfig.js";
import { createCommandRegistry } from "../../src/lib/commands.js";
import {
  createAppTools,
  createTabBridge,
  getModelContexts,
  registerTools,
  toolError,
  toolResult,
} from "../../src/lib/webmcp.js";
import { catalogue, sampleAssembly, samplePartsById } from "./bench-fixtures.js";

// A registry like the app's: a command per kind the tools treat
// differently — a plain one, a link with two actions, one that opens a
// page, a disabled one, a search-only part, and one whose only action is
// a file the user picks.
function sampleRegistry(log = []) {
  const registry = createCommandRegistry();
  registry.register("test", () => [
    {
      id: "app.settings",
      title: "Open Settings",
      section: "Settings",
      actions: [{ title: "Open", run: () => log.push("settings") }],
    },
    {
      id: "app.github",
      title: "Open the GitHub repository",
      section: "Help",
      actions: [
        { title: "Open", run: () => log.push("open link") },
        { title: "Copy link", run: () => log.push("copy link") },
      ],
    },
    {
      id: "app.grid",
      title: "Grid step…",
      section: "Settings",
      subtitle: "5 mm",
      page: () => ({
        id: "grid",
        title: "Grid step",
        note: "What handle drags snap to.",
        items: () => [
          {
            id: "app.grid:1",
            title: "1 mm",
            section: "Grid step",
            actions: [{ title: "Use", run: () => log.push(1) }],
          },
          {
            id: "app.grid:5",
            title: "5 mm",
            section: "Grid step",
            checked: true,
            actions: [{ title: "Use", run: () => log.push(5) }],
          },
          null,
        ],
      }),
    },
    {
      id: "bench.retry",
      title: "Retry the preview",
      section: "Bench",
      disabled: "Rendering the bench…",
      actions: [{ title: "Run", run: () => log.push("retry") }],
    },
    {
      id: "part:basics/plate",
      title: "Flat plate",
      section: "Parts",
      badge: "exact",
      searchOnly: true,
      thumbnail: "thumbnails/basics_plate.png",
      actions: [{ title: "Show in the Library", run: () => log.push("plate") }],
    },
    {
      id: "app.importSettings",
      title: "Import settings…",
      section: "Settings",
      actions: [{ title: "Choose a file", file: { accept: ".json", onFile: () => {} } }],
    },
  ]);
  return registry;
}

const parts = [
  {
    id: "gridfinity/bin",
    name: "Bin",
    system: "Gridfinity",
    confidence: "exact",
    print_note: "Feet down.",
    defaults: { gx: 1, gy: 1, style: "plain" },
    options: { style: ["plain", "scoop"] },
    minimums: { gx: 1 },
    maximums: { gx: 8 },
    variants: [{ name: "lip", params: { lip: true } }],
  },
  { id: "opengrid/board", name: "Board", system: "openGrid", confidence: "exact", defaults: { cells_x: 2 } },
  { id: "bitbeam/pin", name: "Pin", system: "Bitbeam", confidence: "parametric", hidden: true, defaults: {} },
];

function sampleDeps(overrides = {}) {
  const calls = [];
  const imported = samplePartsById().get("imported:900");
  const deps = {
    registry: sampleRegistry(calls),
    parts,
    catalogueById: new Map([...catalogue, ...parts.map((p) => [p.id, p])]),
    tab: "library",
    librarySelection: () => ({ part: parts[0], params: { gx: 2, gy: 1, style: "plain" } }),
    benchSession: () => ({ assembly: null, importedParts: new Map() }),
    holesSession: () => ({ doc: null }),
    renders: () => 0,
    openPart: (part, params, target) => {
      calls.push({ open: part.id, params, target });
      return true;
    },
    loadBench: (doc) => calls.push({ load: doc }),
    mounted: () => null,
    ...overrides,
  };
  return { deps, calls, imported };
}

function tools(deps) {
  return Object.fromEntries(createAppTools(() => deps).map((t) => [t.name, t]));
}

// --- Finding the API and registering ----------------------------------------

test("the draft's document.modelContext before the preview's navigator.modelContext, and the desktop's too", () => {
  const draft = { registerTool() {} };
  const preview = { registerTool() {} };
  const desktop = { modelContext: { registerTool() {} } };
  assert.deepEqual(getModelContexts({ modelContext: draft }, { modelContext: preview }, null), [
    { context: draft, mcp: false },
  ]);
  assert.deepEqual(getModelContexts({}, { modelContext: preview }, null), [{ context: preview, mcp: true }]);
  assert.deepEqual(getModelContexts({ modelContext: draft }, {}, desktop), [
    { context: draft, mcp: false },
    { context: desktop.modelContext, mcp: true },
  ]);
  assert.deepEqual(getModelContexts({}, {}, desktop), [{ context: desktop.modelContext, mcp: true }]);
  assert.deepEqual(getModelContexts({}, {}, null), []);
  assert.deepEqual(getModelContexts(undefined, undefined, undefined), []);
  // Something there that isn't the API is no API.
  assert.deepEqual(
    getModelContexts({ modelContext: {} }, { modelContext: { registerTool: "no" } }, { modelContext: 1 }),
    [],
  );
});

test("the desktop bridge gets no signal, which it couldn't carry", () => {
  const calls = [];
  const context = {
    registerTool(...args) {
      calls.push(args.length);
      return { unregister() {} };
    },
  };
  const { deps } = sampleDeps();
  registerTools(
    { context, mcp: true },
    createAppTools(() => deps),
    new AbortController().signal,
  );
  assert.deepEqual(new Set(calls), new Set([1]));
});

test("the draft gets each tool with the signal, and plain results", async () => {
  const registered = [];
  const context = {
    registerTool(tool, options) {
      registered.push({ tool, options });
      return Promise.resolve();
    },
  };
  const controller = new AbortController();
  const { deps } = sampleDeps();
  registerTools(
    { context, mcp: false },
    createAppTools(() => deps),
    controller.signal,
  );
  assert.deepEqual(
    registered.map((r) => r.tool.name),
    [
      "list_commands",
      "run_command",
      "search_parts",
      "open_part",
      "attach_part",
      "get_app_state",
      "load_bench",
    ],
  );
  for (const { tool, options } of registered) {
    assert.equal(options.signal, controller.signal);
    assert.match(tool.name, /^[A-Za-z0-9_.-]{1,128}$/);
    assert.ok(tool.description.length > 40, tool.name);
    assert.equal(tool.inputSchema.type, "object");
  }
  const list = registered.find((r) => r.tool.name === "search_parts").tool;
  const result = await list.execute({ query: "board" });
  assert.deepEqual(
    result.parts.map((p) => p.id),
    ["opengrid/board"],
  );
  // A failure is a result the model can read, not a rejection.
  const run = registered.find((r) => r.tool.name === "run_command").tool;
  assert.deepEqual(await run.execute({}), { error: '"id" is required.' });
  assert.deepEqual(await run.execute("app.settings"), { error: "The input has to be an object." });
});

test("the preview gets MCP-shaped results and is told to unregister", async () => {
  const registered = new Map();
  const unregistered = [];
  const context = {
    registerTool(tool) {
      registered.set(tool.name, tool);
    },
    unregisterTool(name) {
      unregistered.push(name);
    },
  };
  const controller = new AbortController();
  const { deps } = sampleDeps();
  registerTools(
    { context, mcp: true },
    createAppTools(() => deps),
    controller.signal,
  );
  const ok = await registered.get("run_command").execute({ id: "app.settings" });
  assert.deepEqual(ok, { content: [{ type: "text", text: '{"ran":"Open Settings","action":"Open"}' }] });
  const failed = await registered.get("run_command").execute({ id: "nope" });
  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /There is no command "nope"/);
  controller.abort();
  assert.equal(unregistered.length, 7);
});

test("a handle with unregister() is used instead of unregisterTool", () => {
  let unregistered = 0;
  const context = {
    registerTool: () => ({ unregister: () => (unregistered += 1) }),
    unregisterTool: () => assert.fail("not this one"),
  };
  const controller = new AbortController();
  const { deps } = sampleDeps();
  registerTools(
    { context, mcp: true },
    createAppTools(() => deps),
    controller.signal,
  );
  controller.abort();
  assert.equal(unregistered, 7);
});

test("a tool the browser refuses is skipped; the rest are registered", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const names = [];
  const context = {
    registerTool(tool) {
      if (tool.name === "run_command") throw new Error("InvalidStateError");
      names.push(tool.name);
      return tool.name === "open_part" ? Promise.reject(new Error("taken")) : Promise.resolve();
    },
  };
  const { deps } = sampleDeps();
  registerTools(
    { context, mcp: false },
    createAppTools(() => deps),
    new AbortController().signal,
  );
  assert.equal(names.length, 6);
  assert.ok(!names.includes("run_command"));
  assert.equal(warn.mock.callCount(), 1);
});

test("an aborted signal registers nothing", () => {
  const controller = new AbortController();
  controller.abort();
  const { deps } = sampleDeps();
  registerTools(
    { context: { registerTool: () => assert.fail("registered") }, mcp: false },
    createAppTools(() => deps),
    controller.signal,
  );
});

test("results and failures in each API's shape", () => {
  assert.deepEqual(toolResult({ a: 1 }, false), { a: 1 });
  assert.deepEqual(toolResult({ a: 1 }, true), { content: [{ type: "text", text: '{"a":1}' }] });
  assert.deepEqual(toolError("No.", false), { error: "No." });
  assert.deepEqual(toolError("No.", true), { content: [{ type: "text", text: "No." }], isError: true });
});

// --- list_commands and run_command -------------------------------------------

test("list_commands lists what the palette lists on an empty query, without file-only commands", () => {
  const { deps } = sampleDeps();
  const { commands, list } = tools(deps).list_commands.execute({});
  assert.equal(list, "Commands");
  // In SECTION_ORDER: Bench before Settings before Help; the search-only
  // part and Import settings… (a file only the user can pick) left out.
  assert.deepEqual(
    commands.map((c) => c.id),
    ["bench.retry", "app.settings", "app.grid", "app.github"],
  );
  assert.deepEqual(commands[0], {
    id: "bench.retry",
    title: "Retry the preview",
    section: "Bench",
    disabled: "Rendering the bench…",
    actions: ["Run"],
  });
  assert.deepEqual(commands[2], {
    id: "app.grid",
    title: "Grid step…",
    section: "Settings",
    subtitle: "5 mm",
    opens: "a list of choices",
  });
  assert.deepEqual(commands[3].actions, ["Open", "Copy link"]);
});

test("list_commands finds search-only commands by query, and opens lists with within", () => {
  const { deps } = sampleDeps();
  const { list_commands } = tools(deps);
  const found = list_commands.execute({ query: "flat plate" }).commands;
  assert.deepEqual(found, [
    {
      id: "part:basics/plate",
      title: "Flat plate",
      section: "Parts",
      badge: "exact",
      actions: ["Show in the Library"],
    },
  ]);
  const grid = list_commands.execute({ within: ["app.grid"] });
  assert.equal(grid.list, "Grid step");
  assert.equal(grid.note, "What handle drags snap to.");
  assert.deepEqual(
    grid.commands.map((c) => [c.id, c.checked ?? false]),
    [
      ["app.grid:1", false],
      ["app.grid:5", true],
    ],
  );
  const limited = list_commands.execute({ limit: 2 });
  assert.equal(limited.commands.length, 2);
  assert.equal(limited.more, 2);
});

test("list_commands says what is wrong with a path or an input", () => {
  const { deps } = sampleDeps();
  const { list_commands } = tools(deps);
  assert.throws(() => list_commands.execute({ within: ["nope"] }), /There is no command "nope" right now/);
  assert.throws(() => list_commands.execute({ within: ["app.settings"] }), /doesn't open a list/);
  assert.throws(() => list_commands.execute({ within: ["bench.retry"] }), /isn't available now: Rendering/);
  assert.throws(() => list_commands.execute({ within: "app.grid" }), /"within" has to be a list/);
  assert.throws(() => list_commands.execute({ within: Array(9).fill("app.grid") }), /at most 8/);
  assert.throws(() => list_commands.execute({ query: 42 }), /"query" has to be text/);
  assert.throws(() => list_commands.execute({ limit: 0 }), /whole number from 1 to 300/);
  assert.throws(() => list_commands.execute({ limit: 1.5 }), /whole number/);
});

test("run_command runs the first action, or one by title, the way the palette does", () => {
  const { deps, calls } = sampleDeps();
  const { run_command } = tools(deps);
  assert.deepEqual(run_command.execute({ id: "app.github" }), {
    ran: "Open the GitHub repository",
    action: "Open",
  });
  assert.deepEqual(run_command.execute({ id: "app.github", action: "copy LINK" }), {
    ran: "Open the GitHub repository",
    action: "Copy link",
  });
  run_command.execute({ id: "app.grid:1", within: ["app.grid"] });
  // A search-only command runs by id, without a query first.
  run_command.execute({ id: "part:basics/plate" });
  assert.deepEqual(calls, ["open link", "copy link", 1, "plate"]);
});

test("run_command refuses what it can't run, and says what to do instead", () => {
  const { deps, calls } = sampleDeps();
  const { run_command } = tools(deps);
  assert.throws(() => run_command.execute({ id: "nope" }), /There is no command "nope" on offer/);
  assert.throws(
    () => run_command.execute({ id: "app.grid" }),
    /opens a list of choices\. List them with list_commands and within: \["app\.grid"\]/,
  );
  assert.throws(() => run_command.execute({ id: "bench.retry" }), /can't run now: Rendering the bench…/);
  assert.throws(
    () => run_command.execute({ id: "app.github", action: "Delete" }),
    /has no action "Delete"; it has "Open", "Copy link"/,
  );
  assert.throws(() => run_command.execute({ id: "app.importSettings" }), /needs a file the user chooses/);
  // An item of a list isn't on the global one.
  assert.throws(() => run_command.execute({ id: "app.grid:1" }), /There is no command "app\.grid:1"/);
  assert.deepEqual(calls, []);
});

// --- Parts ---------------------------------------------------------------------

test("search_parts lists parts with their parameters, leaving out the hidden ones", () => {
  const { deps } = sampleDeps();
  const { search_parts } = tools(deps);
  assert.deepEqual(
    search_parts.execute({}).parts.map((p) => p.id),
    ["gridfinity/bin", "opengrid/board"],
  );
  const [bin] = search_parts.execute({ query: "gridfinity bin" }).parts;
  assert.deepEqual(bin, {
    id: "gridfinity/bin",
    name: "Bin",
    system: "Gridfinity",
    confidence: "exact",
    printNote: "Feet down.",
    params: { gx: 1, gy: 1, style: "plain" },
    options: { style: ["plain", "scoop"] },
    minimums: { gx: 1 },
    maximums: { gx: 8 },
    variants: [{ name: "lip", params: { lip: true } }],
  });
  assert.deepEqual(search_parts.execute({ query: "pin" }).parts, []);
  assert.equal(search_parts.execute({ limit: 1 }).more, 1);
  assert.throws(() => tools(sampleDeps({ parts: null }).deps).search_parts.execute({}), /still loading/);
});

test("open_part opens a part with checked parameters in the tab asked for", () => {
  const { deps, calls } = sampleDeps();
  const { open_part } = tools(deps);
  assert.deepEqual(open_part.execute({ partId: "gridfinity/bin", params: { gx: 3, style: "scoop" } }), {
    opened: "Bin",
    tab: "library",
  });
  open_part.execute({ partId: "opengrid/board", target: "bench" });
  assert.deepEqual(calls, [
    { open: "gridfinity/bin", params: { gx: 3, style: "scoop" }, target: "library" },
    { open: "opengrid/board", params: {}, target: "bench" },
  ]);
  // A variant's parameter is known; one nobody lists gets a note.
  assert.equal(open_part.execute({ partId: "gridfinity/bin", params: { lip: true } }).note, undefined);
  assert.match(
    open_part.execute({ partId: "gridfinity/bin", params: { colour: "red" } }).note,
    /"colour" isn't among the part's listed parameters/,
  );
});

test("open_part rejects what the Library's fields would", () => {
  const { deps, calls } = sampleDeps();
  const { open_part } = tools(deps);
  assert.throws(() => open_part.execute({ partId: "nope/nope" }), /There is no part "nope\/nope"/);
  // Hidden parts are only for joints.
  assert.throws(() => open_part.execute({ partId: "bitbeam/pin" }), /There is no part/);
  assert.throws(() => open_part.execute({ partId: "opengrid/board", target: "cli" }), /"target" is one of/);
  const bin = (params) => () => open_part.execute({ partId: "gridfinity/bin", params });
  assert.throws(bin({ style: "fancy" }), /"style" is one of "plain", "scoop"/);
  assert.throws(bin({ gx: 0 }), /"gx" is at least 1/);
  assert.throws(bin({ gx: 9 }), /"gx" is at most 8/);
  assert.throws(bin({ "gx); evil(": 1 }), /has to map parameter names/);
  assert.throws(bin({ gx: { nested: 1 } }), /has to map parameter names/);
  assert.throws(bin([1, 2]), /has to map parameter names/);
  assert.deepEqual(calls, []);
});

test("open_part says when the user kept what they had", () => {
  const { deps } = sampleDeps({ openPart: () => false });
  assert.deepEqual(tools(deps).open_part.execute({ partId: "opengrid/board", target: "bench" }), {
    opened: false,
    reason: "The user chose to keep what they had.",
  });
});

// --- State and benches ---------------------------------------------------------

test("get_app_state reports each tab, the bench as a config without its meshes' bytes", () => {
  const { deps, imported } = sampleDeps({
    tab: "bench",
    benchSession: () => ({ assembly: sampleAssembly(), importedParts: new Map([[imported.id, imported]]) }),
    holesSession: () => ({
      doc: {
        source: { kind: "catalogue", partId: "opengrid/board", params: { cells_x: 3 } },
        holes: [{}, {}],
      },
    }),
    renders: () => 2,
  });
  const state = tools(deps).get_app_state.execute({});
  assert.equal(state.tab, "bench");
  assert.deepEqual(state.library, {
    partId: "gridfinity/bin",
    name: "Bin",
    params: { gx: 2, gy: 1, style: "plain" },
  });
  assert.equal(state.bench.format, "connector-foundry/bench");
  assert.equal(state.bench.savedAt, undefined);
  assert.equal(state.bench.nodes.length, sampleAssembly().nodes.length);
  assert.deepEqual(
    state.bench.imports.map((i) => [i.id, i.stl]),
    [["imported:900", "(left out)"]],
  );
  assert.deepEqual(state.holes, { model: { partId: "opengrid/board", params: { cells_x: 3 } }, holes: 2 });
  assert.equal(state.rendering, true);

  const empty = tools(sampleDeps({ librarySelection: () => null }).deps).get_app_state.execute({});
  assert.deepEqual(empty, {
    tab: "library",
    preview: null,
    library: null,
    bench: null,
    holes: null,
    rendering: false,
  });
});

test("get_app_state says how the showing tab's render went, and the Bench's open slots", () => {
  const bridge = createTabBridge();
  const slots = [{ parentId: "root", slotName: "mount_0_0", on: "Plate" }];
  bridge.set({
    tab: "bench",
    preview: () => ({ status: "error", error: "No anchor nope." }),
    openSlots: () => slots,
  });
  const { deps } = sampleDeps({ tab: "bench", mounted: bridge.get });
  const state = tools(deps).get_app_state.execute({});
  assert.deepEqual(state.preview, { status: "error", error: "No anchor nope." });
  assert.deepEqual(state.openSlots, slots);
  // Right after a switch, the tab that is leaving speaks for nobody.
  const switched = tools({ ...deps, tab: "library" }).get_app_state.execute({});
  assert.equal(switched.preview, null);
  assert.equal(switched.openSlots, undefined);
});

test("the tab bridge: the latest set wins, and an older unset leaves it alone", () => {
  const bridge = createTabBridge();
  const library = { tab: "library", preview: () => ({ status: "done", error: null }) };
  const bench = { tab: "bench", preview: () => ({ status: "rendering", error: null }) };
  const unsetLibrary = bridge.set(library);
  const unsetBench = bridge.set(bench);
  unsetLibrary();
  assert.equal(bridge.get(), bench);
  unsetBench();
  assert.equal(bridge.get(), null);
});

// --- attach_part -----------------------------------------------------------------

function benchDeps(overrides = {}) {
  const attached = [];
  const bridge = createTabBridge();
  bridge.set({
    tab: "bench",
    preview: () => ({ status: "done", error: null }),
    openSlots: () => [
      { parentId: "root", slotName: "mount_0_0", on: "Plate" },
      { parentId: "c900", slotName: "bot", on: "cube.stl" },
    ],
    attach: (request) => {
      attached.push(request);
      return "c950";
    },
  });
  const one = { ...sampleAssembly(), nodes: sampleAssembly().nodes.slice(0, 1) };
  const sample = sampleDeps({
    tab: "bench",
    mounted: bridge.get,
    benchSession: () => ({ assembly: one, importedParts: new Map() }),
    ...overrides,
  });
  return { ...sample, attached };
}

test("attach_part attaches a part to an open slot, with checked parameters and joint", () => {
  const { deps, attached } = benchDeps();
  const { attach_part } = tools(deps);
  assert.deepEqual(
    attach_part.execute({
      partId: "gridfinity/bin",
      slotName: "mount_0_0",
      params: { gx: 2 },
      joint: "bolted",
    }),
    { attached: "Bin", nodeId: "c950", parentId: "root", slotName: "mount_0_0", joint: "bolted" },
  );
  attach_part.execute({ partId: "opengrid/board", parentId: "c900", slotName: "bot" });
  assert.deepEqual(
    attached.map(({ part, ...rest }) => ({ partId: part.id, ...rest })),
    [
      {
        partId: "gridfinity/bin",
        parentId: "root",
        slotName: "mount_0_0",
        params: { gx: 2 },
        joint: "bolted",
      },
      { partId: "opengrid/board", parentId: "c900", slotName: "bot", params: {}, joint: "fused" },
    ],
  );
});

test("attach_part says what is wrong: the tab, the part, the slot, the joint, room on the bench", () => {
  const { deps, attached } = benchDeps();
  const { attach_part } = tools(deps);
  const attach = (input) => () =>
    attach_part.execute({ partId: "gridfinity/bin", slotName: "mount_0_0", ...input });
  assert.throws(
    attach({ slotName: "mount_9_9" }),
    /mount_9_9 on root isn't an open slot\. Open ones: mount_0_0 on root, bot on c900\./,
  );
  assert.throws(attach({ parentId: "c900" }), /mount_0_0 on c900 isn't an open slot/);
  assert.throws(attach({ joint: "glued" }), /"joint" is one of fused, bolted/);
  assert.throws(attach({ params: { gx: 99 } }), /"gx" is at most 8/);
  assert.throws(attach({ partId: "bitbeam/pin" }), /There is no part "bitbeam\/pin"/);
  assert.throws(attach({ slotName: undefined }), /"slotName" is required/);
  assert.deepEqual(attached, []);

  // Not on the Bench, or nothing there yet, or no room left.
  const elsewhere = tools(sampleDeps({ tab: "library" }).deps).attach_part;
  assert.throws(() => elsewhere.execute({ partId: "gridfinity/bin", slotName: "x" }), /go there first/);
  const empty = tools(benchDeps({ benchSession: () => ({ assembly: null, importedParts: new Map() }) }).deps);
  assert.throws(
    () => empty.attach_part.execute({ partId: "gridfinity/bin", slotName: "x" }),
    /There is no bench yet/,
  );
  const full = {
    ...sampleAssembly(),
    nodes: [...sampleAssembly().nodes, { ...sampleAssembly().nodes[0], id: "c3" }],
  };
  const crowded = tools(
    benchDeps({ benchSession: () => ({ assembly: full, importedParts: new Map() }) }).deps,
  );
  assert.throws(
    () => crowded.attach_part.execute({ partId: "gridfinity/bin", slotName: "mount_0_0" }),
    /The bench has 3 parts attached, the most it takes/,
  );
});

test("attach_part waits for slots to be measured, and passes on the Bench's refusal", () => {
  const bridge = createTabBridge();
  bridge.set({
    tab: "bench",
    preview: () => ({ status: "rendering", error: null }),
    openSlots: () => [],
    attach: () => assert.fail("attached"),
  });
  const { deps } = benchDeps({ mounted: bridge.get });
  assert.throws(
    () => tools(deps).attach_part.execute({ partId: "gridfinity/bin", slotName: "mount_0_0" }),
    /There are no open slots yet: they are measured when the bench renders/,
  );
  bridge.set({
    tab: "bench",
    preview: () => ({ status: "done", error: null }),
    openSlots: () => [{ parentId: "root", slotName: "mount_0_0", on: "Plate" }],
    attach: () => {
      throw new Error("A screwed joint needs a screw pattern on one side.");
    },
  });
  assert.throws(
    () =>
      tools(deps).attach_part.execute({ partId: "gridfinity/bin", slotName: "mount_0_0", joint: "screwed" }),
    /A screwed joint needs a screw pattern/,
  );
});

test("load_bench takes get_app_state's config back, putting the meshes' bytes back in", () => {
  const { deps, calls, imported } = sampleDeps({
    benchSession: () => ({ assembly: sampleAssembly(), importedParts: new Map([[imported.id, imported]]) }),
  });
  const { get_app_state, load_bench } = tools(deps);
  const config = get_app_state.execute({}).bench;
  config.root.params.w = 60;
  assert.deepEqual(load_bench.execute({ config }), { loaded: true, parts: 3 });
  const [{ load }] = calls;
  assert.equal(load.root.params.w, 60);
  assert.notEqual(load.imports[0].stl, "(left out)");
  // What load_bench passes on is a document the app's own loader takes.
  const { assembly, importedParts } = hydrateBenchConfig(load, catalogue);
  assert.equal(assembly.root.params.w, 60);
  assert.equal(importedParts.size, 1);
  // The agent's object is copied, not passed on.
  assert.equal(config.imports[0].stl, "(left out)");
});

test("load_bench rejects what Import config… would, before anything changes", () => {
  const { deps, calls } = sampleDeps();
  const { load_bench } = tools(deps);
  const doc = () => ({
    format: "connector-foundry/bench",
    version: 1,
    root: { partId: "basics/plate", params: {} },
    nodes: [],
  });
  assert.throws(() => load_bench.execute({}), /"config" has to be a bench config object/);
  assert.throws(() => load_bench.execute({ config: { format: "other" } }), /isn't a Connector Foundry bench/);
  const infinite = doc();
  infinite.nodes.push({
    id: "a",
    parentId: "root",
    partId: "basics/plate",
    slotName: "mount",
    overlap: Infinity,
  });
  assert.throws(() => load_bench.execute({ config: infinite }), /non-numeric offset/);
  const meshless = doc();
  meshless.imports = [{ id: "imported:1", name: "gone.stl", anchors: [], stl: "(left out)" }];
  assert.throws(() => load_bench.execute({ config: meshless }), /"gone\.stl" isn't on the bench now/);
  assert.throws(
    () => tools(sampleDeps({ catalogueById: null }).deps).load_bench.execute({ config: doc() }),
    /still loading/,
  );
  assert.deepEqual(calls, []);
  assert.deepEqual(load_bench.execute({ config: doc() }), { loaded: true, parts: 1 });
});

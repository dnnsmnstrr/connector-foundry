// WebMCP (https://webmachinelearning.github.io/webmcp/, a W3C Community
// Group draft): a page hands the browser's AI agent tools to call — a name,
// a description, a JSON Schema for the input and a function each. These
// are the app's. No React here, so the unit tests can drive all of it; the
// app registers them through hooks/useWebMcp.js.
//
// The tools are built on what is already there rather than beside it.
// list_commands and run_command are the command palette (commands.js):
// whatever a person can do from Mod+K right now, an agent can, and a
// command added for the palette needs nothing more to reach agents.
// The rest cover what the palette has no rows for: the catalogue with its
// parameters, a part opened with parameters of the agent's, a part
// attached to a slot in one call (the palette's attach ends in a picker
// for a person), the state of each tab with how its preview render went,
// and a bench config loaded as a whole (benchConfig.js's format, so the
// agent edits the same document "Download config" saves).
//
// What only the mounted tab knows — its render's status, the Bench's open
// slots and attach — it hands over through tabBridge while mounted
// (hooks/useWebMcp.js's useWebMcpTab()), as it hands the palette its
// commands.
//
// Everything an agent sends is untrusted, like a shared .bench.json: an
// agent acts on pages and prompts that anyone can write. Inputs are checked
// here (shapes, names, finite numbers) and then go through the same gates
// the app's own files do (isParamSet(), checkBenchConfig()). Nothing here
// is more than a person could do with the same tab open, and every change
// to a bench is an undo step.
//
// Two versions of the API are in the wild. The draft has
// document.modelContext, registerTool(tool, { signal }) and a result of
// any JSON-ready value. Chrome's early preview (146–149) had
// navigator.modelContext, unregistered with unregisterTool(name) or the
// handle registerTool returned, and took MCP's result shape
// ({ content: [{ type: "text", text }] }). getModelContext() finds either,
// and registerTools() speaks to each in its own terms.

import { JOINTS, MAX_ATTACHED } from "./assembly.js";
import { checkBenchConfig, isParamSet, serializeBenchConfig } from "./benchConfig.js";
import { matchesSearch } from "./catalogueUtils.js";
import { SECTION_ORDER } from "./commandCatalog.js";
import { browseSections, rankCommands } from "./commands.js";

/** @typedef {import("./commands.js").Command} Command */
/** @typedef {import("./commands.js").CommandPage} CommandPage */
/** @typedef {import("./commands.js").CommandRegistry} CommandRegistry */

/**
 * @typedef {object} ModelContextLike
 * @property {(tool: object, options?: { signal?: AbortSignal }) => any} registerTool
 * @property {(name: string) => void} [unregisterTool] the early preview's
 */
/**
 * @typedef {object} FoundModelContext
 * @property {ModelContextLike} context
 * @property {boolean} legacy navigator.modelContext: MCP-shaped results, no signal
 */
/**
 * @typedef {object} AppTool
 * @property {string} name
 * @property {string} title
 * @property {string} description
 * @property {object} inputSchema
 * @property {{ readOnlyHint?: boolean, untrustedContentHint?: boolean, consequentialHint?: boolean }} annotations
 * @property {(input: Record<string, unknown>) => any} execute returns the result, throws a message for the agent
 */
/**
 * What the tools read and do, from App (hooks/useWebMcp.js reads the
 * latest each call).
 * @typedef {object} AppToolDeps
 * @property {CommandRegistry} registry
 * @property {any[] | null} parts the catalogue, null while it loads
 * @property {Map<string, any> | null} catalogueById
 * @property {string} tab "library", "bench" or "holes"
 * @property {() => { part: any, params: Record<string, any> } | null} librarySelection
 * @property {() => { assembly: any, importedParts: Map<string, any> }} benchSession
 * @property {() => { doc: any }} holesSession
 * @property {() => number} renders how many renders are running
 * @property {(part: any, params: Record<string, any>, target: "library" | "bench" | "holes") => boolean} openPart
 *   false when the user chose to keep what was there
 * @property {(doc: any) => void} loadBench throws, with a message for the user, when it can't
 * @property {() => MountedTab | null} mounted what the tab on screen hands over (tabBridge)
 */
/**
 * An open slot on the Bench, as the attach markers show it.
 * @typedef {object} OpenSlot
 * @property {string} parentId the node it is on ("root", or an attached part's id in the bench config)
 * @property {string} slotName
 * @property {string} on that node's part name
 */
/**
 * @typedef {object} AttachRequest
 * @property {string} parentId
 * @property {string} slotName
 * @property {any} part a catalogue entry
 * @property {Record<string, any>} params over what the part starts with on that slot
 * @property {string} joint one of assembly.js's JOINTS
 */
/**
 * What the mounted tab hands the tools (useWebMcpTab()).
 * @typedef {object} MountedTab
 * @property {"library" | "bench" | "holes"} tab
 * @property {() => { status: string, error: string | null }} preview its preview render, as
 *   useRender reports it: "idle", "rendering" (a render scheduled or running), "done", "error"
 * @property {() => OpenSlot[]} [openSlots] the Bench's: where a part can go now, once the
 *   parts' renders have measured their slots
 * @property {(request: AttachRequest) => string} [attach] the Bench's: attaches as the attach
 *   picker does, an undo step; returns the new node's id, throws a message for the agent
 */

// The longest a text input may be: a command id, a query, a part id.
const TEXT_MAX = 200;
// How deep a list of choices nests: Attach a part… → a slot → a part.
const WITHIN_MAX = 8;
const LIST_LIMIT = 100;
const PART_LIMIT = 50;
const TABS = ["library", "bench", "holes"];
// How many open slots an error message names before "…".
const SLOTS_SHOWN = 12;

/**
 * Where the mounted tab hands over what only it knows. The latest set
 * wins, and an older unset leaves a newer one alone — StrictMode's
 * mount-unmount-mount, or a tab switch whose new tab mounts before the old
 * one's cleanup runs — as commands.js's drop target does.
 */
export function createTabBridge() {
  /** @type {{ token: object, tab: MountedTab } | null} */
  let current = null;
  return {
    /** @param {MountedTab} tab @returns {() => void} the unset */
    set(tab) {
      const token = {};
      current = { token, tab };
      return () => {
        if (current?.token === token) current = null;
      };
    },
    /** @returns {MountedTab | null} */
    get() {
      return current?.tab ?? null;
    },
  };
}

// The one the app uses; tests make their own.
export const tabBridge = createTabBridge();

/**
 * The page's WebMCP entry point, or null where the browser has none (most
 * of them, as of 2026: Chrome behind a flag or an origin trial).
 * @param {any} [doc]
 * @param {any} [nav]
 * @returns {FoundModelContext | null}
 */
export function getModelContext(doc = globalThis.document, nav = globalThis.navigator) {
  const current = doc?.modelContext;
  if (typeof current?.registerTool === "function") return { context: current, legacy: false };
  const preview = nav?.modelContext;
  if (typeof preview?.registerTool === "function") return { context: preview, legacy: true };
  return null;
}

/**
 * A tool's result as the API wants it: the draft's any JSON-ready value,
 * or the preview's MCP text content.
 * @param {unknown} value
 * @param {boolean} legacy
 */
export function toolResult(value, legacy) {
  return legacy ? { content: [{ type: "text", text: JSON.stringify(value) }] } : value;
}

/**
 * A failure, as a result rather than a rejection: best practice is a
 * message the model can read and correct its input from, and a rejection
 * reaches some agents as a bare "error". The preview's MCP shape has a
 * flag for it.
 * @param {string} message
 * @param {boolean} legacy
 */
export function toolError(message, legacy) {
  return legacy ? { content: [{ type: "text", text: message }], isError: true } : { error: message };
}

/**
 * Registers `tools` until `signal` aborts. A tool the browser refuses (a
 * name already taken, a schema it can't read) is skipped with a warning:
 * the rest still work, and the app never depends on any of them.
 * @param {FoundModelContext} found
 * @param {AppTool[]} tools
 * @param {AbortSignal} signal
 */
export function registerTools({ context, legacy }, tools, signal) {
  for (const tool of tools) {
    if (signal.aborted) return;
    const definition = {
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
      execute: async (/** @type {unknown} */ input) => {
        try {
          return toolResult(await tool.execute(inputObject(input)), legacy);
        } catch (err) {
          return toolError(messageOf(err), legacy);
        }
      },
    };
    const refused = (/** @type {unknown} */ err) =>
      console.warn(`WebMCP: the browser refused the tool "${tool.name}"`, err);
    let handle;
    try {
      handle = context.registerTool(definition, { signal });
    } catch (err) {
      refused(err);
      continue;
    }
    // The draft returns a promise (rejected for a name already taken),
    // and the abort signal unregisters; the preview has to be told.
    if (typeof handle?.then === "function") handle.then(undefined, refused);
    if (!legacy) continue;
    signal.addEventListener(
      "abort",
      () => {
        try {
          if (typeof handle?.unregister === "function") handle.unregister();
          else context.unregisterTool?.(tool.name);
        } catch {
          // Gone already (the page is being torn down): nothing to undo.
        }
      },
      { once: true },
    );
  }
}

/** @param {unknown} err */
function messageOf(err) {
  return err instanceof Error ? err.message : String(err);
}

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** @param {unknown} input @returns {Record<string, unknown>} */
function inputObject(input) {
  if (input === undefined || input === null) return {};
  if (!isObject(input)) throw new Error("The input has to be an object.");
  return /** @type {Record<string, unknown>} */ (input);
}

/**
 * An optional text field, trimmed; throws when it is something else.
 * @param {Record<string, unknown>} input
 * @param {string} key
 * @returns {string | undefined}
 */
function optionalText(input, key) {
  const v = input[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || v.length > TEXT_MAX) {
    throw new Error(`"${key}" has to be text of at most ${TEXT_MAX} characters.`);
  }
  return v.trim();
}

/** @param {Record<string, unknown>} input @param {string} key */
function requiredText(input, key) {
  const v = optionalText(input, key);
  if (!v) throw new Error(`"${key}" is required.`);
  return v;
}

/**
 * @param {Record<string, unknown>} input
 * @param {string} key
 * @param {number} fallback
 * @param {number} max
 */
function limitOf(input, key, fallback, max) {
  const v = input[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > max) {
    throw new Error(`"${key}" has to be a whole number from 1 to ${max}.`);
  }
  return v;
}

/** @param {Record<string, unknown>} input @returns {string[]} */
function withinOf(input) {
  const v = input.within;
  if (v === undefined || v === null) return [];
  if (
    !Array.isArray(v) ||
    v.length > WITHIN_MAX ||
    !v.every((id) => typeof id === "string" && id.length > 0 && id.length <= TEXT_MAX)
  ) {
    throw new Error(`"within" has to be a list of at most ${WITHIN_MAX} command ids.`);
  }
  return v;
}

// --- The palette's lists ---------------------------------------------------
// The same walk the palette makes (components/CommandPalette.jsx): from the
// global list, each id in `within` names a command whose page is the next
// list. A page that searches the registry too (a part picker) finds the
// rest of the app's commands by id, as the palette does by query.

/** @param {CommandPage} page @returns {Command[]} */
function ownItems(page) {
  return /** @type {Command[]} */ (page.items().filter(Boolean));
}

/**
 * @param {CommandRegistry} registry
 * @param {CommandPage} page
 * @param {string} id
 */
function findOnPage(registry, page, id) {
  return (
    ownItems(page).find((c) => c.id === id) ??
    (page.searchCommands ? (registry.collect().find((c) => c.id === id) ?? null) : null)
  );
}

/**
 * @param {CommandRegistry} registry
 * @param {string[]} within
 * @returns {{ page: CommandPage, root: boolean }}
 */
function resolveList(registry, within) {
  /** @type {CommandPage} */
  let page = { id: "root", title: "Commands", items: () => registry.collect() };
  for (const [depth, id] of within.entries()) {
    const command = findOnPage(registry, page, id);
    const where = depth === 0 ? "" : ` in "${page.title}"`;
    if (!command) {
      throw new Error(`There is no command "${id}"${where} right now. list_commands shows what there is.`);
    }
    if (command.disabled)
      throw new Error(`"${command.title}" isn't available now${disabledReason(command)}.`);
    if (!command.page) throw new Error(`"${command.title}" doesn't open a list; run it with run_command.`);
    page = command.page();
  }
  return { page, root: within.length === 0 };
}

/** @param {Command} command */
function disabledReason(command) {
  return typeof command.disabled === "string" ? `: ${command.disabled}` : "";
}

/** @param {Command} command */
function runnableActions(command) {
  return (command.actions ?? []).filter((a) => typeof a.run === "function");
}

/**
 * A command as an agent sees it: what it is called and does, not how the
 * palette draws it (no icons, thumbnails or key hints). Null for one an
 * agent can't use — its only action is a file the user picks.
 * @param {Command} command
 */
function describeCommand(command) {
  const actions = runnableActions(command).map((a) => a.title);
  if (!actions.length && !command.page) return null;
  return {
    id: command.id,
    title: command.title,
    section: command.section,
    ...(command.subtitle ? { subtitle: command.subtitle } : {}),
    ...(command.badge ? { badge: command.badge } : {}),
    ...(command.checked ? { checked: true } : {}),
    ...(command.disabled ? { disabled: typeof command.disabled === "string" ? command.disabled : true } : {}),
    ...(command.page ? { opens: "a list of choices" } : {}),
    ...(actions.length ? { actions } : {}),
  };
}

// --- The catalogue -----------------------------------------------------------

/** @param {any} part */
function describePart(part) {
  return {
    id: part.id,
    name: part.name,
    system: part.system,
    confidence: part.confidence,
    ...(part.print_note ? { printNote: part.print_note } : {}),
    params: { ...(part.defaults ?? {}) },
    ...(part.options ? { options: part.options } : {}),
    ...(part.minimums ? { minimums: part.minimums } : {}),
    ...(part.maximums ? { maximums: part.maximums } : {}),
    ...(part.variants?.length
      ? { variants: part.variants.map((/** @type {any} */ v) => ({ name: v.name, params: v.params })) }
      : {}),
  };
}

/**
 * The parameters an agent gave a part, checked against what the catalogue
 * says about them: a value from a fixed list has to be on it, a number has
 * to be inside its floor and ceiling — what the Library's fields enforce.
 * A name the catalogue doesn't list passes with a note (a variant can set
 * one the defaults leave out); OpenSCAD ignores a parameter its module
 * doesn't take.
 * @param {any} part
 * @param {unknown} params
 * @returns {{ params: Record<string, any>, unknown: string[] }}
 */
function checkPartParams(part, params) {
  if (params === undefined || params === null) return { params: {}, unknown: [] };
  if (!isParamSet(params)) {
    throw new Error(
      '"params" has to map parameter names to text, true/false, finite numbers, or lists of those.',
    );
  }
  const set = /** @type {Record<string, any>} */ (params);
  const known = new Set(Object.keys(part.defaults ?? {}));
  for (const variant of part.variants ?? [])
    for (const key of Object.keys(variant.params ?? {})) known.add(key);
  for (const [key, value] of Object.entries(set)) {
    const options = part.options?.[key];
    if (Array.isArray(options) && !options.includes(value)) {
      throw new Error(`"${key}" is one of ${options.map((o) => JSON.stringify(o)).join(", ")}.`);
    }
    const min = part.minimums?.[key];
    if (typeof min === "number" && typeof value === "number" && value < min) {
      throw new Error(`"${key}" is at least ${min}.`);
    }
    const max = part.maximums?.[key];
    if (typeof max === "number" && typeof value === "number" && value > max) {
      throw new Error(`"${key}" is at most ${max}.`);
    }
  }
  return { params: set, unknown: Object.keys(set).filter((key) => !known.has(key)) };
}

/**
 * A note on parameters the catalogue doesn't list, for a tool's result.
 * @param {string[]} unknown
 */
function unknownNote(unknown) {
  if (!unknown.length) return {};
  return {
    note:
      `${unknown.map((k) => JSON.stringify(k)).join(", ")} isn't among the part's listed parameters; ` +
      "OpenSCAD ignores one its module doesn't take.",
  };
}

// --- State -------------------------------------------------------------------

/**
 * The bench as its config document, with each imported mesh's STL left
 * out: it is megabytes of base64 an agent can do nothing with.
 * load_bench puts it back from the bench, by id.
 * @param {AppToolDeps} deps
 */
function benchConfig(deps) {
  const { assembly, importedParts } = deps.benchSession();
  if (!assembly || !deps.catalogueById) return null;
  // When it was saved means nothing here: it is now.
  const { savedAt, ...doc } = serializeBenchConfig(
    assembly,
    new Map([...deps.catalogueById, ...importedParts]),
  );
  return { ...doc, imports: doc.imports.map((imp) => ({ ...imp, stl: "(left out)" })) };
}

/** @param {any} doc */
function holesState(doc) {
  if (!doc) return null;
  const { source } = doc;
  return {
    model:
      source?.kind === "catalogue"
        ? { partId: source.partId, params: { ...(source.params ?? {}) } }
        : { imported: source?.name ?? "an imported model" },
    holes: doc.holes.length,
    ...(doc.name ? { name: doc.name } : {}),
  };
}

// --- The tools ---------------------------------------------------------------

/**
 * The app's tools. `get` returns the latest deps on each call, so a tool
 * always sees the tab and bench as they are when the agent calls it.
 * @param {() => AppToolDeps} get
 * @returns {AppTool[]}
 */
export function createAppTools(get) {
  /** @returns {Map<string, any>} */
  const catalogue = () => {
    const byId = get().catalogueById;
    if (!byId) throw new Error("The catalogue is still loading; try again in a moment.");
    return byId;
  };
  /** The catalogue part `input.partId` names. Hidden ones are only for joints (a Bitbeam pin). */
  const catalogPart = (/** @type {Record<string, unknown>} */ input) => {
    const partId = requiredText(input, "partId");
    const part = catalogue().get(partId);
    if (!part || part.hidden) throw new Error(`There is no part "${partId}". search_parts lists them.`);
    return part;
  };

  return [
    {
      name: "list_commands",
      title: "List commands",
      description:
        "Lists what can be done in Connector Foundry, a designer for 3D-printable connector parts, right now: " +
        "the commands its command palette (Cmd/Ctrl+K) offers. They follow the tab in use (Library, Bench, " +
        "Holes) and what is selected, so list again after a change. Without a query the everyday commands " +
        "are listed; parts, hole types, camera views and guides are found with a query. A command marked " +
        '"opens" leads to a list of choices (Grid step, Attach a part…): list those by passing its id in ' +
        '"within". Run a command with run_command.',
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              'Words to look for, as typed into the palette: "download stl", "m3", "gridfinity bin".',
          },
          within: {
            type: "array",
            items: { type: "string" },
            description: 'Ids of the commands whose lists to open, outermost first: ["bench.attach"].',
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 300,
            description: `At most this many (${LIST_LIMIT}).`,
          },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute(input) {
        const { registry } = get();
        const query = optionalText(input, "query") ?? "";
        const within = withinOf(input);
        const limit = limitOf(input, "limit", LIST_LIMIT, 300);
        const { page, root } = resolveList(registry, within);
        const own = ownItems(page);
        /** @type {Command[]} */
        let commands;
        if (query) {
          commands = rankCommands(own, query).map((r) => r.command);
          if (page.searchCommands) {
            const ownIds = new Set(own.map((c) => c.id));
            const more = registry.collect().filter((c) => !ownIds.has(c.id));
            commands.push(...rankCommands(more, query).map((r) => r.command));
          }
        } else {
          commands = browseSections(own, { sectionOrder: root ? SECTION_ORDER : [] }).flatMap((s) => s.items);
        }
        const rows = commands.map(describeCommand).filter((row) => row !== null);
        return {
          list: page.title,
          ...(page.note ? { note: page.note } : {}),
          ...(page.error ? { error: page.error } : {}),
          commands: rows.slice(0, limit),
          ...(rows.length > limit ? { more: rows.length - limit } : {}),
        };
      },
    },
    {
      name: "run_command",
      title: "Run a command",
      description:
        "Runs one of the commands list_commands lists, as pressing Enter on it in the command palette " +
        'would — or another of its actions, by title ("Copy link", "Open in Bench"). A command from a list ' +
        'of choices needs the same "within" it was listed with. Changes to a bench or holes can be undone ' +
        "by the user (Undo). The app updates once it has run: get_app_state shows the result.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "The command's id, from list_commands." },
          within: {
            type: "array",
            items: { type: "string" },
            description: "The ids of the lists it is on, as passed to list_commands.",
          },
          action: {
            type: "string",
            description: "Which of its actions, by title. The first one if left out.",
          },
        },
        required: ["id"],
      },
      annotations: {},
      execute(input) {
        const { registry } = get();
        const id = requiredText(input, "id");
        const within = withinOf(input);
        const actionTitle = optionalText(input, "action");
        const { page } = resolveList(registry, within);
        const command = findOnPage(registry, page, id);
        if (!command) {
          throw new Error(
            `There is no command "${id}" ${within.length ? `in "${page.title}"` : "on offer"} right now. ` +
              "list_commands shows what there is.",
          );
        }
        if (command.disabled) throw new Error(`"${command.title}" can't run now${disabledReason(command)}.`);
        const actions = runnableActions(command);
        if (!actionTitle && command.page) {
          throw new Error(
            `"${command.title}" opens a list of choices. List them with list_commands and within: ` +
              `${JSON.stringify([...within, id])}.`,
          );
        }
        const action = actionTitle
          ? actions.find((a) => a.title.toLowerCase() === actionTitle.toLowerCase())
          : command.actions?.[0];
        if (!action) {
          const titles = actions.map((a) => JSON.stringify(a.title)).join(", ");
          throw new Error(
            actionTitle
              ? `"${command.title}" has no action "${actionTitle}"${titles ? `; it has ${titles}` : ""}.`
              : `"${command.title}" has nothing to run.`,
          );
        }
        if (typeof action.run !== "function") {
          throw new Error(`"${command.title}" needs a file the user chooses; ask them to run it themselves.`);
        }
        action.run();
        return { ran: command.title, action: action.title };
      },
    },
    {
      name: "search_parts",
      title: "Search the parts catalogue",
      description:
        "Searches the catalogue of parts: connectors and accessories for Gridfinity, openGrid, Multiboard, " +
        "Skådis and other systems. Each part comes with its parameters and their defaults, the values a " +
        "parameter can take, and its named variants. Open one with open_part. Without a query, lists them all.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: 'Words in the part\'s name, system or id: "gridfinity bin", "opengrid board".',
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: PART_LIMIT,
            description: `At most this many (${PART_LIMIT}).`,
          },
        },
      },
      annotations: { readOnlyHint: true },
      execute(input) {
        const parts = get().parts;
        if (!parts) throw new Error("The catalogue is still loading; try again in a moment.");
        const words = (optionalText(input, "query") ?? "").split(/\s+/).filter(Boolean);
        const limit = limitOf(input, "limit", PART_LIMIT, PART_LIMIT);
        // Parts the catalogue marks hidden are ones only joints use (a
        // Bitbeam pin); the user's own hidden systems are a tidier list,
        // not parts that are off limits, so they are found here.
        const found = parts.filter((p) => !p.hidden && words.every((w) => matchesSearch(p, w)));
        return {
          parts: found.slice(0, limit).map(describePart),
          ...(found.length > limit ? { more: found.length - limit } : {}),
        };
      },
    },
    {
      name: "open_part",
      title: "Open a part",
      description:
        "Opens a catalogue part with the given parameters: in the Library to preview and download it, on " +
        "the Bench as the base of a new assembly, or in Holes to drill holes into it. Parameters left out " +
        "keep their defaults (search_parts lists them). Replacing a bench or placed holes asks the user first.",
      inputSchema: {
        type: "object",
        properties: {
          partId: { type: "string", description: 'The part\'s id, from search_parts: "gridfinity/bin".' },
          params: {
            type: "object",
            description: 'Parameter values by name: { "gx": 2, "gy": 3 }.',
            additionalProperties: true,
          },
          target: { type: "string", enum: TABS, description: "Which tab to open it in (library)." },
        },
        required: ["partId"],
      },
      annotations: {},
      execute(input) {
        const deps = get();
        const part = catalogPart(input);
        const target = optionalText(input, "target") ?? "library";
        if (!TABS.includes(target)) throw new Error(`"target" is one of ${TABS.join(", ")}.`);
        const { params, unknown } = checkPartParams(part, input.params);
        const tab = /** @type {"library" | "bench" | "holes"} */ (target);
        if (!deps.openPart(part, params, tab)) {
          return { opened: false, reason: "The user chose to keep what they had." };
        }
        return { opened: part.name, tab, ...unknownNote(unknown) };
      },
    },
    {
      name: "attach_part",
      title: "Attach a part",
      description:
        "Attaches a catalogue part to an open slot on the Bench, as picking it in Attach a part… does: it " +
        "starts with the parameters it would get there (a grid part sized to the surface, a part turned " +
        "upright on a side face), and params given here go over those. get_app_state lists the open " +
        "slots once the bench has rendered. A bench takes at most " +
        `${MAX_ATTACHED} attached parts. The user can undo it.`,
      inputSchema: {
        type: "object",
        properties: {
          partId: { type: "string", description: 'The part\'s id, from search_parts: "basics/plate".' },
          parentId: {
            type: "string",
            description: 'The node the slot is on, from get_app_state\'s openSlots ("root" if left out).',
          },
          slotName: {
            type: "string",
            description: 'The slot, from get_app_state\'s openSlots: "mount_0_0".',
          },
          params: {
            type: "object",
            description: "Parameter values by name, over the ones it starts with.",
            additionalProperties: true,
          },
          joint: { type: "string", enum: JOINTS, description: "How it joins the part below (fused)." },
        },
        required: ["partId", "slotName"],
      },
      annotations: {},
      execute(input) {
        const deps = get();
        const mounted = deps.mounted();
        if (mounted?.tab !== "bench" || !mounted.attach || !mounted.openSlots) {
          throw new Error(
            'Parts are attached on the Bench: go there first (run_command with id "app.bench").',
          );
        }
        const part = catalogPart(input);
        const parentId = optionalText(input, "parentId") || "root";
        const slotName = requiredText(input, "slotName");
        const joint = optionalText(input, "joint") || "fused";
        if (!JOINTS.includes(joint)) throw new Error(`"joint" is one of ${JOINTS.join(", ")}.`);
        const { params, unknown } = checkPartParams(part, input.params);
        const { assembly } = deps.benchSession();
        if (!assembly) throw new Error('There is no bench yet: start one with open_part and target "bench".');
        if (assembly.nodes.length >= MAX_ATTACHED) {
          throw new Error(
            `The bench has ${MAX_ATTACHED} parts attached, the most it takes. Remove one first.`,
          );
        }
        const open = mounted.openSlots();
        if (!open.some((s) => s.parentId === parentId && s.slotName === slotName)) {
          if (!open.length) {
            throw new Error(
              "There are no open slots yet: they are measured when the bench renders. Check " +
                "get_app_state's preview, then try again.",
            );
          }
          const names = open.slice(0, SLOTS_SHOWN).map((s) => `${s.slotName} on ${s.parentId}`);
          throw new Error(
            `${slotName} on ${parentId} isn't an open slot. Open ones: ${names.join(", ")}` +
              `${open.length > SLOTS_SHOWN ? ", …" : ""}.`,
          );
        }
        const nodeId = mounted.attach({ parentId, slotName, part, params, joint });
        return { attached: part.name, nodeId, parentId, slotName, joint, ...unknownNote(unknown) };
      },
    },
    {
      name: "get_app_state",
      title: "Read the app's state",
      description:
        "Says which tab is showing and what is on each: the Library's part and its parameters, the Bench's " +
        "assembly as a bench config (the document load_bench takes), and the Holes tab's model and how " +
        "many holes it has. Imported meshes' STL data is left out. preview is how the showing tab's " +
        'render went: "rendering" until it lands, then "done", or "error" with the message — check it ' +
        "after a change, since a bad parameter or slot only shows there. On the Bench, openSlots lists " +
        "where attach_part can put a part.",
      inputSchema: { type: "object", properties: {} },
      // Bench and part names are the user's, and a shared bench link
      // brings someone else's.
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute() {
        const deps = get();
        const selection = deps.librarySelection();
        // Only the showing tab's: right after a switch, the tab that is
        // leaving may not have handed over yet.
        const mounted = deps.mounted();
        const own = mounted?.tab === deps.tab ? mounted : null;
        return {
          tab: deps.tab,
          preview: own ? own.preview() : null,
          library: selection
            ? { partId: selection.part.id, name: selection.part.name, params: { ...selection.params } }
            : null,
          bench: benchConfig(deps),
          ...(own?.openSlots ? { openSlots: own.openSlots() } : {}),
          holes: holesState(deps.holesSession().doc),
          rendering: deps.renders() > 0,
        };
      },
    },
    {
      name: "load_bench",
      title: "Load a bench",
      description:
        "Replaces the Bench's assembly with a bench config and shows the Bench. Read the current one with " +
        "get_app_state, change it (a part's params, a joint, a rotation), and pass the whole document back. " +
        'An imported mesh may keep "stl": "(left out)" when it is on the bench now. To attach a part, use ' +
        "attach_part: which slots a part has depends on its rendered size. Joints: " +
        `${JOINTS.join(", ")}. The user can undo it.`,
      inputSchema: {
        type: "object",
        properties: {
          config: {
            type: "object",
            description:
              'A bench config: { "format": "connector-foundry/bench", "version": 1, "root", "nodes" }.',
            additionalProperties: true,
          },
        },
        required: ["config"],
      },
      annotations: {},
      execute(input) {
        const deps = get();
        catalogue();
        if (!isObject(input.config)) throw new Error('"config" has to be a bench config object.');
        // Through JSON and back: whatever the agent's object was, what is
        // checked is plain data (no getters, no Infinity — that turns into
        // null, which the check rejects).
        const doc = JSON.parse(JSON.stringify(input.config));
        restoreMeshes(doc, deps);
        checkBenchConfig(doc);
        deps.loadBench(doc);
        return { loaded: true, parts: 1 + doc.nodes.length };
      },
    },
  ];
}

/**
 * Puts each imported mesh's STL back from the bench where the agent left it
 * out, by the id get_app_state gave it.
 * @param {any} doc
 * @param {AppToolDeps} deps
 */
function restoreMeshes(doc, deps) {
  if (!Array.isArray(doc?.imports) || !doc.imports.some((/** @type {any} */ imp) => isLeftOut(imp?.stl))) {
    return;
  }
  const { assembly, importedParts } = deps.benchSession();
  const current = assembly
    ? serializeBenchConfig(assembly, new Map([...(deps.catalogueById ?? []), ...importedParts]))
    : null;
  const stlById = new Map((current?.imports ?? []).map((imp) => [imp.id, imp.stl]));
  for (const imp of doc.imports) {
    if (!isObject(imp) || !isLeftOut(imp.stl)) continue;
    const stl = stlById.get(imp.id);
    if (stl === undefined) {
      throw new Error(
        `The imported mesh "${imp.name ?? imp.id}" isn't on the bench now, so its STL can't be left out.`,
      );
    }
    imp.stl = stl;
  }
}

/** @param {unknown} stl */
function isLeftOut(stl) {
  return stl === undefined || stl === null || stl === "(left out)";
}

// What the built-in commands are called, where they are listed and which
// key does the same outside the palette — data only. The behaviour is
// bound where the state lives (hooks/useCommands.js, in App, the tabs and
// the viewer) through builtin(), which takes the id: tsc checks the id
// against this table at every call site, and a unit test holds every key
// hint here to a row of the shortcuts sheet (shortcuts.js), so the
// palette can't advertise a key that does something else.

import { showCommandHud } from "./commandHud.js";

/** @typedef {import("./commands.js").Command} Command */
/** @typedef {import("./commands.js").CommandAction} CommandAction */

export const REPO_URL = "https://github.com/dnnsmnstrr/connector-foundry";
export const ISSUES_URL = `${REPO_URL}/issues/new`;
export const RELEASES_URL = `${REPO_URL}/releases/latest`;
// The website's guides, rendered from docs/*.md (scripts/build-docs.mjs).
// The whole address, not a path beside the app's: the desktop app is served
// from foundry://app/, which has no guides.
export const GUIDES_URL = "https://dnnsmnstrr.github.io/connector-foundry/docs/";
// Layerling, where "Copy for Layerling" pastes (lib/layerlingClipboard.js).
export const LAYERLING_URL = "https://layerling.com/";

// The order sections are listed in on an empty query, after "Recent"
// (commands.js's browseSections()). Only the tab in use has commands, so
// its section is the first of the three. The sections at the end are
// search-only: a part, a hole type, a camera view is found by typing.
export const SECTION_ORDER = Object.freeze([
  "Your commands",
  "General",
  "Library",
  "Bench",
  "Holes",
  "3D view",
  "Go to",
  "Settings",
  "Help",
  "Parts",
  "Hole types",
  "Saved presets",
  "Views",
]);

/**
 * @typedef {object} BuiltinMeta
 * @property {string} title
 * @property {string} section
 * @property {readonly string[]} [keywords]
 * @property {readonly (readonly string[])[]} [keys] shortcuts.js tokens, a chord per alternative
 * @property {string} [action] what Enter does, for the footer ("Open", "Download"); "Run" otherwise
 */

export const BUILTIN_COMMANDS = Object.freeze({
  // --- Go to
  "app.library": {
    title: "Go to the Library",
    section: "Go to",
    keywords: ["switch", "tab", "parts"],
    keys: [["1"]],
    action: "Go",
  },
  "app.bench": {
    title: "Go to the Bench",
    section: "Go to",
    keywords: ["switch", "tab", "assembly"],
    keys: [["2"]],
    action: "Go",
  },
  "app.holes": {
    title: "Go to Holes",
    section: "Go to",
    keywords: ["switch", "tab", "screw", "drill"],
    keys: [["3"]],
    action: "Go",
  },
  "app.searchParts": {
    title: "Search the Library's parts",
    section: "Go to",
    keywords: ["find", "part", "filter"],
    keys: [["/"]],
  },
  "app.sidebar": {
    title: "Show or hide the sidebar",
    section: "Go to",
    keywords: ["toggle", "panel", "collapse"],
    keys: [["["]],
  },
  // --- General
  "app.cancelRenders": {
    title: "Cancel renders",
    section: "General",
    keywords: ["stop", "abort", "rendering"],
  },
  // --- Settings
  "app.settings": {
    title: "Open Settings",
    section: "Settings",
    keywords: ["preferences", "options", "configure"],
    keys: [["S"]],
    action: "Open",
  },
  "app.grid": { title: "Grid step…", section: "Settings", keywords: ["snap", "nudge", "mm"] },
  "app.circleDetail": {
    title: "Circle detail…",
    section: "Settings",
    keywords: ["$fn", "resolution", "quality", "facets", "smooth"],
  },
  "app.benchFollowsLibrary": {
    title: "Start an empty Bench with the Library's part",
    section: "Settings",
    keywords: ["bench follows library"],
    action: "Toggle",
  },
  "app.exportSettings": {
    title: "Export settings…",
    section: "Settings",
    keywords: ["backup", "download", "save"],
    action: "Export",
  },
  "app.importSettings": {
    title: "Import settings…",
    section: "Settings",
    keywords: ["backup", "restore", "load"],
    action: "Choose a file",
  },
  // --- Library
  "library.openInBench": {
    title: "Open in Bench",
    section: "Library",
    keywords: ["bench", "assemble", "root", "base"],
    action: "Open",
  },
  "library.addHoles": {
    title: "Add holes to this part",
    section: "Library",
    keywords: ["drill", "screw", "holes"],
    action: "Open",
  },
  "library.render": { title: "Render", section: "Library", keywords: ["preview", "refresh", "again"] },
  "library.downloadStl": {
    title: "Download STL",
    section: "Library",
    keywords: ["export", "save", "print"],
    action: "Download",
  },
  "library.layerling": {
    title: "Copy for Layerling",
    section: "Library",
    keywords: ["clipboard", "slicer"],
    action: "Copy",
  },
  "library.resetParams": {
    title: "Reset the parameters",
    section: "Library",
    keywords: ["catalogue", "defaults", "reset all"],
    action: "Reset",
  },
  "library.source": {
    title: "Open the part's source",
    section: "Library",
    keywords: ["upstream", "licence", "license", "original"],
    action: "Open",
  },
  "library.undo": { title: "Undo", section: "Library", keywords: ["back"], keys: [["Mod", "Z"]] },
  "library.redo": { title: "Redo", section: "Library", keywords: ["again"], keys: [["Mod", "Shift", "Z"]] },
  // --- Bench
  "bench.attach": { title: "Attach a part…", section: "Bench", keywords: ["add", "slot", "place"] },
  "bench.selectRoot": {
    title: "Select the base part",
    section: "Bench",
    keywords: ["root", "handles", "resize"],
    action: "Select",
  },
  "bench.deselect": { title: "Deselect", section: "Bench", keywords: ["clear selection"], keys: [["Esc"]] },
  "bench.move": {
    title: "Move the selected part",
    section: "Bench",
    keywords: ["slot", "reseat"],
    keys: [["M"]],
    action: "Move",
  },
  "bench.remove": {
    title: "Remove the selected part",
    section: "Bench",
    keywords: ["delete"],
    keys: [["Delete"]],
    action: "Remove",
  },
  "bench.turnLeft": {
    title: "Turn the selected part counter-clockwise",
    section: "Bench",
    keywords: ["rotate", "spin", "90"],
    action: "Turn",
  },
  "bench.turnRight": {
    title: "Turn the selected part clockwise",
    section: "Bench",
    keywords: ["rotate", "spin", "90"],
    action: "Turn",
  },
  "bench.crop": {
    title: "Crop to the selected part",
    section: "Bench",
    keywords: ["isolate", "only", "section"],
    action: "Toggle",
  },
  "bench.startOver": {
    title: "Start over",
    section: "Bench",
    keywords: ["new", "clear", "reset", "empty"],
  },
  "bench.downloadStl": {
    title: "Download STL",
    section: "Bench",
    keywords: ["export", "save", "print", "body"],
    action: "Download",
  },
  "bench.downloadScad": {
    title: "Download .scad",
    section: "Bench",
    keywords: ["openscad", "source", "export"],
    action: "Download",
  },
  "bench.downloadConfig": {
    title: "Download config",
    section: "Bench",
    keywords: ["bench.json", "save", "export", "share"],
    action: "Download",
  },
  "bench.layerling": {
    title: "Copy for Layerling",
    section: "Bench",
    keywords: ["clipboard", "slicer"],
    action: "Copy",
  },
  "bench.importConfig": {
    title: "Import config…",
    section: "Bench",
    keywords: ["load", "open", "bench.json"],
    action: "Choose a file",
  },
  "bench.loadPreset": { title: "Load a saved preset…", section: "Bench", keywords: ["preset", "saved"] },
  "bench.retry": { title: "Retry the preview", section: "Bench", keywords: ["render", "again"] },
  "bench.undo": { title: "Undo", section: "Bench", keywords: ["back"], keys: [["Mod", "Z"]] },
  "bench.redo": { title: "Redo", section: "Bench", keywords: ["again"], keys: [["Mod", "Shift", "Z"]] },
  // --- Holes
  "holes.holeType": {
    title: "Hole type…",
    section: "Holes",
    keywords: ["preset", "screw", "insert", "nut", "magnet", "slot"],
  },
  "holes.selectAll": { title: "Select all holes", section: "Holes", keywords: ["every"], action: "Select" },
  "holes.deselect": { title: "Deselect", section: "Holes", keywords: ["clear selection"], keys: [["Esc"]] },
  "holes.delete": {
    title: "Delete the selected holes",
    section: "Holes",
    keywords: ["remove"],
    keys: [["Delete"]],
    action: "Delete",
  },
  "holes.repeat": {
    title: "Repeat the selected hole…",
    section: "Holes",
    keywords: ["pattern", "array", "row", "grid", "circle", "copies"],
    action: "Open",
  },
  "holes.snap": {
    title: "Snap to the face's points and lines",
    section: "Holes",
    keywords: ["snapping", "guides"],
    action: "Toggle",
  },
  "holes.flip": {
    title: "Flip the mesh upside down",
    section: "Holes",
    keywords: ["turn over", "invert"],
    action: "Toggle",
  },
  "holes.pickAnother": {
    title: "Pick another model",
    section: "Holes",
    keywords: ["change", "base", "start over", "new"],
  },
  "holes.downloadStl": {
    title: "Download STL",
    section: "Holes",
    keywords: ["export", "save", "print"],
    action: "Download",
  },
  "holes.downloadScad": {
    title: "Download .scad",
    section: "Holes",
    keywords: ["openscad", "source", "export"],
    action: "Download",
  },
  "holes.layerling": {
    title: "Copy for Layerling",
    section: "Holes",
    keywords: ["clipboard", "slicer"],
    action: "Copy",
  },
  "holes.retry": { title: "Retry the preview", section: "Holes", keywords: ["render", "again"] },
  "holes.undo": { title: "Undo", section: "Holes", keywords: ["back"], keys: [["Mod", "Z"]] },
  "holes.redo": { title: "Redo", section: "Holes", keywords: ["again"], keys: [["Mod", "Shift", "Z"]] },
  // --- 3D view
  "view.fit": {
    title: "Fit the view",
    section: "3D view",
    keywords: ["zoom", "frame", "centre", "center"],
    keys: [["F"]],
  },
  "view.helpers": {
    title: "Show or hide the helpers",
    section: "3D view",
    keywords: ["grid", "markers", "labels", "handles"],
    keys: [["H"]],
    action: "Toggle",
  },
  "view.camera": {
    title: "View from…",
    section: "3D view",
    keywords: ["camera", "angle", "home", "top", "front", "right"],
  },
  // --- Help
  "app.shortcuts": {
    title: "Keyboard shortcuts",
    section: "Help",
    keywords: ["keys", "help", "cheat sheet"],
    keys: [["?"]],
    action: "Show",
  },
  "app.guides": {
    title: "Open the guides",
    section: "Help",
    keywords: ["docs", "documentation", "help", "manual", "getting started", "tutorial"],
    action: "Open",
  },
  "app.github": {
    title: "Open the GitHub repository",
    section: "Help",
    keywords: ["source", "code", "repo"],
    action: "Open",
  },
  "app.issue": {
    title: "Report an issue",
    section: "Help",
    keywords: ["bug", "github", "feedback", "problem"],
    action: "Open",
  },
  "app.layerling": {
    title: "Open Layerling",
    section: "Help",
    keywords: ["layerling.com", "slicer", "editor", "paste", "bookmark"],
    action: "Open",
  },
  "app.releases": {
    title: "Download the desktop app",
    section: "Help",
    keywords: ["mac", "windows", "electron", "release"],
    action: "Open",
  },
});

/** @typedef {keyof typeof BUILTIN_COMMANDS} BuiltinCommandId */

/**
 * @typedef {object} BuiltinBinding
 * @property {boolean} [when] false leaves the command out (nothing selected, nothing to undo)
 * @property {string} [id] a different id for one of several (a body's STL download)
 * @property {string} [title] a title that says more ("Undo choose base part")
 * @property {string} [section] another heading, on a page of its own (a picker's "History")
 * @property {string} [subtitle]
 * @property {string[]} [keywords] added to the catalogue's
 * @property {() => void} [run] the whole behaviour, as its only action
 * @property {CommandAction[]} [actions]
 * @property {() => import("./commands.js").CommandPage} [page]
 * @property {boolean} [checked]
 * @property {false | string} [disabled]
 * @property {boolean} [searchOnly]
 * @property {string} [alias]
 * @property {string} [hotkey]
 * @property {any} [icon]
 */

/**
 * A built-in command with its behaviour bound, or null when `when` is false.
 * @param {BuiltinCommandId} id
 * @param {BuiltinBinding} [binding]
 * @returns {Command | null}
 */
export function builtin(id, binding = {}) {
  const { when = true, run, keywords, ...rest } = binding;
  if (!when) return null;
  /** @type {BuiltinMeta} */
  const meta = BUILTIN_COMMANDS[id];
  /** @type {Command} */
  const command = {
    id,
    title: meta.title,
    section: meta.section,
    keywords: [...(meta.keywords ?? []), ...(keywords ?? [])],
    keys: meta.keys?.map((chord) => [...chord]),
  };
  // A binding left undefined (`title: moving ? "Stop moving…" : undefined`)
  // keeps the catalogue's value rather than blanking it.
  for (const [key, value] of Object.entries(rest)) if (value !== undefined) command[key] = value;
  if (run) command.actions = [{ title: meta.action ?? "Run", run }];
  return command;
}

/**
 * A catalogue part as a row: its name, its confidence as the badge (the
 * accessible name reads "Flat plate exact", as in every part list), its
 * system, its gallery thumbnail when the build found one (sync-scad.mjs).
 * An imported mesh has no system.
 * @param {any} part a catalogue.json entry
 * @param {{ id: string, actions: CommandAction[], section?: string, searchOnly?: boolean,
 *   checked?: boolean }} options
 * @returns {Command}
 */
export function partCommand(part, { id, actions, section = "Parts", searchOnly = false, checked }) {
  return {
    id,
    title: part.name,
    badge: part.confidence,
    subtitle: part.system ?? "Imported",
    section,
    keywords: [part.id, part.system ?? "imported"],
    thumbnail: part.thumbnail,
    actions,
    searchOnly,
    checked,
  };
}

// --- Links ---------------------------------------------------------------
// A command that is a web page: Enter opens it, Mod+Enter copies it.

/**
 * Opens a page in a new tab — in the desktop app, the system browser, which
 * every window.open() is handed to (web/desktop/main.cjs).
 * @param {string} url
 */
export function openLink(url) {
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Puts a link on the clipboard and says so (commandHud.js). Called straight
 * from the key or the click: browsers let a page write the clipboard only
 * while handling the user's gesture.
 * @param {string} url
 */
export function copyLink(url) {
  const failed = () => showCommandHud("The browser didn't let the app copy the link");
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return failed();
  navigator.clipboard.writeText(url).then(() => showCommandHud("Link copied"), failed);
}

/**
 * A link command's actions: open it (Enter), copy it (Mod+Enter).
 * @param {string} url
 * @returns {CommandAction[]}
 */
export function linkActions(url) {
  return [
    { title: "Open", run: () => openLink(url) },
    { title: "Copy link", run: () => copyLink(url) },
  ];
}

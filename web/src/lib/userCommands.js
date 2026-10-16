// The user's own commands in the command palette, and their aliases and
// hotkeys for the built-in ones — a validated store in localStorage. There
// is no editor for them yet: they come in with a settings backup
// (settingsBackup.js copies every "connector-foundry." key), so a
// hand-edited .settings.json is how they are made for now. That file
// stores each key's value as a string, so this document sits in it as
// JSON inside a string:
//
//   "connector-foundry.userCommands": "{\"version\":1,\"commands\":[{\"id\":\"my-bin\",
//     \"title\":\"My 2x3 bin\",\"alias\":\"bin\",\"hotkey\":\"Mod+Shift+B\",
//     \"action\":{\"kind\":\"open-part\",\"partId\":\"gridfinity/bin\",
//     \"params\":{\"gridx\":2,\"gridy\":3},\"target\":\"library\"}}],
//     \"bindings\":{\"app.settings\":{\"alias\":\"prefs\"}}}"
//
// Anyone can write that file and share it, so everything in it is checked
// on the way in, entry by entry — a bad command is dropped with a reason
// (warned once in the console), the good ones around it still work: a
// link must be http(s), parameters must be names and values the code
// generator can write (benchConfig.js's isParamSet()), hotkeys must be
// ones hotkeys.js allows and not taken. What an action does is described
// by its `kind`; ACTION_KINDS is the list, and App.jsx runs each one
// (hooks/useUserCommands.js) — a new kind is a `check` here and a runner
// there.

import { isParamSet } from "./benchConfig.js";
import { BUILTIN_COMMANDS } from "./commandCatalog.js";
import { hotkeyProblem, parseChord } from "./hotkeys.js";
import { isMacPlatform } from "./isEditableTarget.js";
import { getPreset } from "./screwPresets.js";

export const USER_COMMANDS_KEY = "connector-foundry.userCommands";
export const USER_COMMANDS_VERSION = 1;
export const USER_COMMANDS_MAX = 100;

const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const ALIAS = /^[a-z0-9][a-z0-9-]{0,15}$/;
const TITLE_MAX = 80;
const TEXT_MAX = 200;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const MODES = ["library", "bench", "holes"];

/**
 * @typedef {{ kind: string, [field: string]: any }} UserAction
 * @typedef {{ id: string, title: string, subtitle?: string, alias?: string, hotkey?: string,
 *   action: UserAction }} UserCommand
 * @typedef {{ alias?: string, hotkey?: string }} UserBinding
 * @typedef {{ commands: UserCommand[], bindings: Map<string, UserBinding>, problems: string[] }} UserCommandSet
 */

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** @param {unknown} v @param {number} max */
function isText(v, max) {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max && !CONTROL_CHARS.test(v);
}

/**
 * What each action kind is: `check` says what is wrong with one (null when
 * nothing is), `describe` is the row's subtitle when the command gives none.
 * @type {Readonly<Record<string, { check: (a: UserAction) => string | null, describe: (a: UserAction) => string }>>}
 */
export const ACTION_KINDS = Object.freeze({
  // A catalogue part, with parameters of the user's, in a tab: the Library
  // shows it, the Bench starts on it, Holes drills into it.
  "open-part": {
    check: (a) => {
      if (!isText(a.partId, TEXT_MAX)) return "needs a partId";
      if (!MODES.includes(a.target ?? "library")) return `has an unknown target "${a.target}"`;
      if (a.params !== undefined && !isParamSet(a.params)) return "has parameters that can't be used";
      return null;
    },
    describe: (a) => `${a.partId} in the ${a.target === "holes" ? "Holes tab" : (a.target ?? "library")}`,
  },
  // One of the Bench's saved presets (benchPresets.js), by name.
  "bench-preset": {
    check: (a) => (isText(a.name, TEXT_MAX) ? null : "needs the preset's name"),
    describe: (a) => `Bench preset "${a.name}"`,
  },
  // A hole type (screwPresets.js), for the selected holes or the next ones.
  "hole-preset": {
    check: (a) =>
      typeof a.presetId !== "string"
        ? "needs a presetId"
        : getPreset(a.presetId)
          ? null
          : `names no hole type "${a.presetId}"`,
    describe: (a) => getPreset(a.presetId)?.name ?? a.presetId,
  },
  // A web page. http and https only: a javascript: or file: URL from a
  // shared file is not something to open.
  link: {
    check: (a) => {
      if (typeof a.url !== "string" || a.url.length > 2000) return "needs a url";
      let url;
      try {
        url = new URL(a.url);
      } catch {
        return `has a url that isn't one: "${a.url}"`;
      }
      return url.protocol === "https:" || url.protocol === "http:" ? null : "may only link to http(s)";
    },
    describe: (a) => {
      try {
        return new URL(a.url).host;
      } catch {
        return a.url;
      }
    },
  },
  // Switch to a tab.
  view: {
    check: (a) => (MODES.includes(a.mode) ? null : `has an unknown mode "${a.mode}"`),
    describe: (a) => `Go to the ${a.mode === "holes" ? "Holes tab" : a.mode}`,
  },
  // Run a built-in command by id — whatever the palette would list at that
  // moment (a tab's command only on that tab). Not one of the user's own:
  // two that ran each other would never stop.
  command: {
    check: (a) => {
      if (!isText(a.id, TEXT_MAX)) return "needs the command's id";
      return a.id.startsWith("user:") ? "can't run another of your own commands" : null;
    },
    describe: (a) => BUILTIN_COMMANDS[a.id]?.title ?? a.id,
  },
});

/**
 * Checks a stored document (the parsed object, or its JSON text) and keeps
 * what is usable. Never throws: a store that can't be read reads as empty.
 * @param {unknown} raw
 * @param {{ mac?: boolean, taken?: ReadonlyMap<string, string> }} [options] `taken`: chords already
 *   bound elsewhere, to their owners' titles
 * @returns {UserCommandSet}
 */
export function checkUserCommands(raw, { mac = isMacPlatform(), taken = new Map() } = {}) {
  /** @type {UserCommandSet} */
  const result = { commands: [], bindings: new Map(), problems: [] };
  /** @type {any} */
  let doc = raw;
  if (typeof raw === "string") {
    try {
      doc = JSON.parse(raw);
    } catch {
      result.problems.push("The user commands aren't JSON.");
      return result;
    }
  }
  if (doc === null || doc === undefined) return result;
  if (!isObject(doc) || doc.version !== USER_COMMANDS_VERSION) {
    result.problems.push(`The user commands aren't version ${USER_COMMANDS_VERSION} of the format.`);
    return result;
  }
  const chords = new Map(taken);
  const aliases = new Set();
  /** @param {any} entry @param {string} owner @param {string} where */
  const keysOf = (entry, owner, where) => {
    /** @type {UserBinding} */
    const keys = {};
    if (entry.alias !== undefined) {
      const alias = typeof entry.alias === "string" ? entry.alias.toLowerCase() : null;
      if (!alias || !ALIAS.test(alias))
        result.problems.push(`${where}: the alias "${entry.alias}" isn't one.`);
      else if (aliases.has(alias)) result.problems.push(`${where}: the alias "${alias}" is taken.`);
      else {
        aliases.add(alias);
        keys.alias = alias;
      }
    }
    if (entry.hotkey !== undefined) {
      const problem = hotkeyProblem(String(entry.hotkey), { mac, taken: chords });
      if (problem) result.problems.push(`${where}: ${problem}.`);
      else {
        keys.hotkey = parseChord(entry.hotkey);
        chords.set(keys.hotkey, owner);
      }
    }
    return keys;
  };

  const commands = Array.isArray(doc.commands) ? doc.commands : [];
  if (commands.length > USER_COMMANDS_MAX) {
    result.problems.push(`Only the first ${USER_COMMANDS_MAX} user commands are kept.`);
  }
  const ids = new Set();
  for (const [i, entry] of commands.slice(0, USER_COMMANDS_MAX).entries()) {
    const where = `User command ${i + 1}`;
    if (!isObject(entry)) {
      result.problems.push(`${where} isn't an object.`);
      continue;
    }
    if (typeof entry.id !== "string" || !ID.test(entry.id) || ids.has(entry.id)) {
      result.problems.push(`${where}: its id is missing, malformed or used twice.`);
      continue;
    }
    if (!isText(entry.title, TITLE_MAX)) {
      result.problems.push(`${where}: its title is missing or too long.`);
      continue;
    }
    if (entry.subtitle !== undefined && !isText(entry.subtitle, TEXT_MAX)) {
      result.problems.push(`${where}: its subtitle isn't text.`);
      continue;
    }
    const action = entry.action;
    const kind =
      isObject(action) && Object.hasOwn(ACTION_KINDS, action.kind) ? ACTION_KINDS[action.kind] : null;
    if (!kind) {
      result.problems.push(`${where}: its action has no known kind.`);
      continue;
    }
    const problem = kind.check(action);
    if (problem) {
      result.problems.push(`${where}: its ${action.kind} action ${problem}.`);
      continue;
    }
    ids.add(entry.id);
    result.commands.push({
      id: entry.id,
      title: entry.title.trim(),
      subtitle: entry.subtitle?.trim(),
      action: { ...action },
      ...keysOf(entry, entry.title.trim(), where),
    });
  }

  if (doc.bindings !== undefined && !isObject(doc.bindings)) {
    result.problems.push("The user commands' bindings aren't an object.");
  } else {
    for (const [id, entry] of Object.entries(doc.bindings ?? {})) {
      const where = `The binding for "${id}"`;
      if (!Object.hasOwn(BUILTIN_COMMANDS, id)) {
        result.problems.push(`${where}: there is no such built-in command.`);
        continue;
      }
      if (!isObject(entry)) {
        result.problems.push(`${where} isn't an object.`);
        continue;
      }
      const keys = keysOf(entry, BUILTIN_COMMANDS[id].title, where);
      if (keys.alias || keys.hotkey) result.bindings.set(id, keys);
    }
  }
  return result;
}

// --- The store ---------------------------------------------------------------
// Read once and cached (the palette and the hotkey listener ask on every
// keystroke); a write, or another tab's write, refreshes it.

/** @type {UserCommandSet | null} */
let cached = null;
let warned = false;
const listeners = new Set();
const NONE = Object.freeze({ commands: [], bindings: new Map(), problems: [] });

function read() {
  let text = null;
  try {
    text = localStorage.getItem(USER_COMMANDS_KEY);
  } catch {
    return NONE;
  }
  if (text === null) return NONE;
  const set = checkUserCommands(text);
  if (set.problems.length && !warned) {
    warned = true;
    console.warn(`Some of your commands were left out:\n${set.problems.join("\n")}`);
  }
  return set;
}

/** @returns {UserCommandSet} */
export function getUserCommands() {
  if (cached === null) cached = read();
  return cached;
}

/**
 * Replaces the stored document (a future editor, and the tests). Returns
 * null, or why it couldn't be saved; what is saved is read back through
 * the same checks as a stored one.
 * @param {unknown} doc
 */
export function setUserCommands(doc) {
  try {
    if (doc === null) localStorage.removeItem(USER_COMMANDS_KEY);
    else localStorage.setItem(USER_COMMANDS_KEY, JSON.stringify(doc));
  } catch {
    return "This browser isn't letting the app save its storage.";
  }
  cached = null;
  warned = false;
  for (const listener of listeners) listener();
  return null;
}

/** For useSyncExternalStore. */
export function subscribeUserCommands(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Every hotkey in a set, for the shortcuts sheet's "Your hotkeys": the
 * command's title and the chord, as shortcuts.js tokens.
 * @param {UserCommandSet} set
 * @returns {{ title: string, keys: string[] }[]}
 */
export function hotkeyRows(set) {
  const rows = set.commands
    .filter((c) => c.hotkey)
    .map((c) => ({ title: c.title, keys: c.hotkey.split("+") }));
  for (const [id, binding] of set.bindings) {
    if (binding.hotkey) rows.push({ title: BUILTIN_COMMANDS[id].title, keys: binding.hotkey.split("+") });
  }
  return rows;
}

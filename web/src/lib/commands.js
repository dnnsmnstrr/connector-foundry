// The command palette's model (components/CommandPalette.jsx): what a
// command is, the registry every part of the app adds its commands to,
// and the ranking that turns what the user typed into an ordered list.
// No React here, so the unit tests can drive all of it.
//
// A command is data plus closures: the closures are the source's own
// handlers (Bench's attach, Holes' pickPreset), bound where that state
// lives by hooks/useCommands.js. The palette never reaches into a tab —
// a tab that is not mounted has no commands, which is also how the list
// follows the mode the user is in.
//
// Built-in commands take their title, section, search keywords and key
// hint from lib/commandCatalog.js, so a unit test can hold the hints to
// the shortcuts sheet (lib/shortcuts.js) without mounting anything.

/**
 * @typedef {object} CommandFileAction
 * @property {string} accept the file input's `accept`
 * @property {(file: File) => void} onFile called with the chosen file; the palette stays open until then
 */
/**
 * @typedef {object} CommandAction
 * @property {string} title what the footer and the Actions page call it ("Open in Bench")
 * @property {() => void} [run]
 * @property {CommandFileAction} [file] pick a file instead of running (the palette's own file input)
 * @property {string[][]} [keys] a key hint for this action alone (shortcuts.js tokens)
 */
/**
 * @typedef {object} Command
 * @property {string} id stable: the recents list and user hotkeys refer to it
 *   ("app.settings", "part:basics/plate", "bench.base:basics/plate")
 * @property {string} title
 * @property {string} section the heading it is listed under on an empty query
 * @property {string} [subtitle] a part's system, a preset's group: searchable, not in the name
 * @property {string} [badge] a part's confidence: part of the accessible name ("Flat plate exact"),
 *   as the part lists have always had it
 * @property {string[]} [keywords] more words it is found by ("preferences" for Settings)
 * @property {string} [alias] typed exactly, puts this command first (a user's own, userCommands.js)
 * @property {string[][]} [keys] the key that does the same outside the palette, as a hint
 *   (shortcuts.js tokens; display only — the key is handled by its own listener)
 * @property {string} [hotkey] a user hotkey ("Mod+Shift+K", hotkeys.js), shown as a hint
 * @property {string} [thumbnail] a public path to an image (a part's gallery render)
 * @property {any} [icon] a React node drawn in place of a thumbnail (a hole type's ScrewIcon)
 * @property {boolean} [checked] in effect now (the current grid step, the hole type in use)
 * @property {false | string} [disabled] a string says why ("Rendering the bench…")
 * @property {boolean} [searchOnly] left out of the list until something is typed — the
 *   38 parts and 78 hole types would bury everything else
 * @property {CommandAction[]} [actions] [0] runs on Enter, [1] on Mod+Enter, [2] on Alt+Enter, all
 *   on the Actions page
 * @property {() => CommandPage} [page] a nested list to open instead (View…, Hole type…)
 */
/**
 * @typedef {object} CommandPage
 * @property {string} id
 * @property {string} title the dialog's heading ("Start a bench", "Attach to top")
 * @property {string} [searchLabel] the search box's accessible name (default "Search commands")
 * @property {string} [placeholder]
 * @property {string} [note] a line under the search box while nothing is typed
 * @property {string | null} [error] shown as an alert above the list
 * @property {any} [accessory] a React node beside the search box (the attach picker's joint)
 * @property {() => (Command | null | false | undefined)[]} items what is on offer now; a falsy
 *   entry is one that isn't, left out
 * @property {boolean} [searchCommands] a typed query also searches the registry, listed
 *   under "Commands" — so a picker that opens on its own still reaches the rest of the app
 * @property {string} [emptyText] what to say when nothing matches
 * @property {() => CommandDrop | null} [drop] what a model file dropped on the palette does
 *   (a part picker imports it), or null for nothing
 * @property {"recent"} [browse] the empty query lists recent commands first and orders the
 *   sections by commandCatalog.js's SECTION_ORDER (the global palette); otherwise the items
 *   are listed as given, under their sections in order of appearance (a picker)
 */
/** @typedef {{ title: string | null, items: Command[] }} CommandSection */
/**
 * @typedef {object} CommandDrop
 * @property {string} label what a drop does, shown while a file is over the palette
 *   ("Drop to import it as the base part")
 * @property {(file: File) => void} onFile
 */

/**
 * The registry the palette collects from. Sources register a getter, not a
 * list: the getter runs only when an open palette asks, so a tab that
 * re-renders on every pointer move (Holes' snap preview) never builds its
 * hundred-odd commands for nothing.
 */
export function createCommandRegistry() {
  /** @type {Map<object, { source: string, getter: () => (Command | null | false | undefined)[] }>} */
  const sources = new Map();
  const listeners = new Set();
  let version = 0;
  /** @type {{ token: object, open: () => void } | null} */
  let home = null;
  /** @type {{ token: object, open: (id: string) => void } | null} */
  let opener = null;
  /** @type {{ token: object, target: CommandDrop } | null} */
  let dropTarget = null;
  // The user's aliases and hotkeys for commands they didn't write
  // (userCommands.js's bindings), by command id.
  /** @type {ReadonlyMap<string, { alias?: string, hotkey?: string }>} */
  let bindings = new Map();

  function emit() {
    version += 1;
    for (const listener of listeners) listener();
  }

  return {
    /**
     * Adds a source; returns its unregister. Each call gets its own token,
     * so StrictMode's mount-unmount-mount of an effect (or two instances of
     * one source) can never unregister someone else's entry.
     * @param {string} source a name for the warning when its getter throws
     * @param {() => (Command | null | false | undefined)[]} getter
     */
    register(source, getter) {
      const token = {};
      sources.set(token, { source, getter });
      emit();
      return () => {
        if (sources.delete(token)) emit();
      };
    },

    /**
     * Every registered command, in registration order, the first of a
     * duplicated id winning. A getter that throws is skipped with a
     * warning: the palette sits outside the modes' error boundary, and one
     * broken source must not take the rest of the list with it.
     * @returns {Command[]}
     */
    collect() {
      /** @type {Command[]} */
      const out = [];
      const seen = new Set();
      for (const { source, getter } of sources.values()) {
        let list;
        try {
          list = getter();
        } catch (err) {
          console.warn(`commands: the ${source} commands failed to build`, err);
          continue;
        }
        for (const command of list ?? []) {
          if (!command || seen.has(command.id)) continue;
          seen.add(command.id);
          const bound = bindings.get(command.id);
          out.push(bound ? { ...command, ...bound } : command);
        }
      }
      return out;
    },

    /** @param {string} id */
    find(id) {
      return this.collect().find((c) => c.id === id) ?? null;
    },

    /**
     * Runs a command by id the way Enter would (its first action), or
     * opens the palette on its page when it has one. For a user's hotkey
     * and a command that names another (userCommands.js). False when there
     * is no such command now, or nothing to run.
     * @param {string} id
     */
    run(id) {
      const command = this.find(id);
      if (!command || command.disabled) return false;
      if (command.page) {
        if (!opener) return false;
        opener.open(id);
        return true;
      }
      const action = command.actions?.[0];
      if (!action?.run) return false;
      action.run();
      return true;
    },

    /**
     * Aliases and hotkeys the user gave commands by id, put on them as
     * they are collected — whichever source offers them.
     * @param {ReadonlyMap<string, { alias?: string, hotkey?: string }>} next
     */
    setBindings(next) {
      bindings = next;
      emit();
    },

    /** For useSyncExternalStore: an open palette re-collects on a change. */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version() {
      return version;
    },
    /**
     * A source re-rendered: its getter may answer differently now. Only
     * worth a notification while someone listens (an open palette), so a
     * closed palette costs every render nothing.
     */
    touch() {
      if (listeners.size) emit();
    },

    /**
     * What Mod+K opens instead of the global palette — an empty Bench or
     * Holes tab's own part picker, which Escape put away. Returns the unset;
     * the latest set wins, and an older unset leaves a newer one alone.
     * @param {() => void} open
     */
    setHome(open) {
      const token = {};
      home = { token, open };
      return () => {
        if (home?.token === token) home = null;
      };
    },
    home() {
      return home?.open ?? null;
    },

    /**
     * What a file dropped on the global palette does — the mounted tab's
     * (the Bench starts a bench from it, Holes drills into it). Returns the
     * unset; the latest set wins, and an older unset leaves a newer one
     * alone.
     * @param {CommandDrop} target
     */
    setDropTarget(target) {
      const token = {};
      dropTarget = { token, target };
      return () => {
        if (dropTarget?.token === token) dropTarget = null;
      };
    },
    dropTarget() {
      return dropTarget?.target ?? null;
    },

    /**
     * How run() opens the palette on a command's page (App, which owns the
     * global palette). Returns the unset.
     * @param {(id: string) => void} open
     */
    setOpener(open) {
      const token = {};
      opener = { token, open };
      return () => {
        if (opener?.token === token) opener = null;
      };
    },
  };
}

/** @typedef {ReturnType<typeof createCommandRegistry>} CommandRegistry */

// The one registry the app uses; tests make their own.
export const commandRegistry = createCommandRegistry();

// --- Ranking -----------------------------------------------------------------
// Raycast-style: what was typed is matched word by word against a command's
// title (and, weighted lower, its keywords, subtitle and section). Every
// typed word has to match somewhere — "m3 cap" narrows rather than widens,
// as the Holes tab's hole-type search already does. A match scores by how
// it matched, in tiers far enough apart that recency (below) can only
// break near-ties, never lift a scattered match over a real one.

const EXACT = 100;
const PREFIX = 90;
const INITIALS = 85; // "oib" for Open in Bench
// A word start inside the title is nearly as good as the title's start:
// "repo" means "repository" in "Open the GitHub repository" as much as it
// means "Report an issue".
const WORD_PREFIX = 80;
const SUBSTRING = 55;
const SUBSEQUENCE = 35; // the most a scattered match can score
const SCATTERED_FLOOR = 20;

// Recently run commands come first on an ambiguous query: the newest gets
// this much, older ones less. Below the 10-point gap between tiers.
const RECENT_BONUS = 9;
const ALIAS_BONUS = 1000;
// The whole query (spaces and all) starting the title: "open in" should
// rank "Open in Bench" above "Bench: open in Library…".
const PHRASE_BONUS = 8;
// Every typed word found in the title, not some of them in its keywords:
// "github repo" is "Open the GitHub repository", whose title has both,
// before "Report an issue", whose keywords have "github". In proportion
// to the share of the words the title has.
const TITLE_BONUS = 12;

const FIELD_WEIGHTS = { title: 1, keyword: 0.75, badge: 0.6, subtitle: 0.7, section: 0.5 };

/**
 * Lowercase, with accents stripped, so "skadis" finds "Skådis".
 * @param {string} text
 */
export function normalize(text) {
  return String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Word starts: after a space or punctuation, and at a lower-to-upper case
// change would be nice too, but titles here are prose.
const WORD_SPLIT = /[\s\-_/.,:;()[\]…'"]+/;

/**
 * How well one typed word matches a field, both normalized: 0 is no match.
 * @param {string} field normalized
 * @param {string} word normalized, no spaces
 * @param {boolean} [scattered] whether a subsequence counts (titles and keywords only:
 *   on a section name it matches nearly anything)
 */
export function scoreText(field, word, scattered = true) {
  if (!word || !field) return 0;
  if (field === word) return EXACT;
  if (field.startsWith(word)) return PREFIX;
  const words = field.split(WORD_SPLIT).filter(Boolean);
  if (word.length >= 2 && words.length >= word.length) {
    const initials = words.map((w) => w[0]).join("");
    if (initials.startsWith(word)) return INITIALS;
  }
  if (words.some((w) => w.startsWith(word))) return WORD_PREFIX;
  if (field.includes(word)) return SUBSTRING;
  if (!scattered || word.length < 2) return 0;
  // In order but scattered: tighter is better, SCATTERED_FLOOR to SUBSEQUENCE.
  let from = 0;
  let first = -1;
  let last = -1;
  for (const ch of word) {
    const at = field.indexOf(ch, from);
    if (at < 0) return 0;
    if (first < 0) first = at;
    last = at;
    from = at + 1;
  }
  const spread = last - first + 1;
  return SCATTERED_FLOOR + Math.round((SUBSEQUENCE - SCATTERED_FLOOR) * (word.length / spread));
}

/** @param {Command} command */
function fieldsOf(command) {
  /** @type {[string, number, boolean][]} */
  const fields = [[normalize(command.title), FIELD_WEIGHTS.title, true]];
  for (const keyword of command.keywords ?? [])
    fields.push([normalize(keyword), FIELD_WEIGHTS.keyword, true]);
  if (command.badge) fields.push([normalize(command.badge), FIELD_WEIGHTS.badge, false]);
  if (command.subtitle) fields.push([normalize(command.subtitle), FIELD_WEIGHTS.subtitle, false]);
  fields.push([normalize(command.section), FIELD_WEIGHTS.section, false]);
  return fields;
}

/**
 * Split a query into its normalized words.
 * @param {string} query
 */
export function queryWords(query) {
  return normalize(query).split(/\s+/).filter(Boolean);
}

/**
 * The commands that match `query`, best first, with their scores. An empty
 * query matches nothing here (browseSections() lists that case).
 * @param {Command[]} commands
 * @param {string} query
 * @param {{ recents?: readonly string[] }} [options] `recents`: command ids, newest first
 * @returns {{ command: Command, score: number }[]}
 */
export function rankCommands(commands, query, { recents = [] } = {}) {
  const words = queryWords(query);
  if (!words.length) return [];
  const phrase = words.join(" ");
  const recentRank = new Map(recents.map((id, i) => [id, i]));
  /** @type {{ command: Command, score: number, index: number }[]} */
  const ranked = [];
  commands.forEach((command, index) => {
    const fields = fieldsOf(command);
    // An alias typed exactly is the user saying which command they mean,
    // whether or not its title has those letters in it.
    const aliased = Boolean(command.alias) && normalize(command.alias) === phrase;
    let total = 0;
    let inTitle = 0;
    for (const word of words) {
      let best = 0;
      for (const [text, weight, scattered] of fields)
        best = Math.max(best, scoreText(text, word, scattered) * weight);
      if (best === 0 && !aliased) return;
      total += best;
      if (scoreText(fields[0][0], word) > 0) inTitle += 1;
    }
    let score = total / words.length + (TITLE_BONUS * inTitle) / words.length;
    if (words.length > 1 && fields[0][0].startsWith(phrase)) score += PHRASE_BONUS;
    if (aliased) score += ALIAS_BONUS;
    const recent = recentRank.get(command.id);
    if (recent !== undefined) score += Math.max(0, RECENT_BONUS - recent);
    ranked.push({ command, score, index });
  });
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked.map(({ command, score }) => ({ command, score }));
}

/**
 * The list on an empty query: recently run commands first (any of them,
 * search-only ones too — a part opened yesterday is worth a row), then the
 * rest under their sections in `sectionOrder`, search-only ones left out.
 * A section `sectionOrder` does not name keeps its first-appearance place
 * after the named ones. A command is listed once.
 * @param {Command[]} commands
 * @param {{ recents?: readonly string[], sectionOrder?: readonly string[], recentLimit?: number }} [options]
 * @returns {CommandSection[]}
 */
export function browseSections(commands, { recents = [], sectionOrder = [], recentLimit = 5 } = {}) {
  const byId = new Map(commands.map((c) => [c.id, c]));
  /** @type {Command[]} */
  const recent = [];
  for (const id of recents) {
    const command = byId.get(id);
    if (command && !command.disabled) recent.push(command);
    if (recent.length >= recentLimit) break;
  }
  const shown = new Set(recent.map((c) => c.id));
  /** @type {Map<string, Command[]>} */
  const groups = new Map();
  for (const command of commands) {
    if (command.searchOnly || shown.has(command.id)) continue;
    if (!groups.has(command.section)) groups.set(command.section, []);
    groups.get(command.section).push(command);
  }
  const order = [
    ...sectionOrder.filter((s) => groups.has(s)),
    ...[...groups.keys()].filter((s) => !sectionOrder.includes(s)),
  ];
  /** @type {CommandSection[]} */
  const sections = [];
  if (recent.length) sections.push({ title: "Recent", items: recent });
  for (const title of order) sections.push({ title, items: groups.get(title) });
  return sections;
}

/**
 * The spans of `text` the query matched, to highlight: [start, end) pairs in
 * `text`'s own indices, sorted and merged. Each word marks where scoreText()
 * found it — the start, a word start, the initials, the substring or the
 * scattered letters.
 * @param {string} text
 * @param {string} query
 * @returns {[number, number][]}
 */
export function matchRanges(text, query) {
  // Normalize character by character, remembering where each normalized
  // character came from: NFD can grow or shrink the string.
  /** @type {number[]} */
  const origin = [];
  let norm = "";
  [...text].forEach((ch, i) => {
    const n = normalize(ch);
    for (const c of n) {
      norm += c;
      origin.push(i);
    }
  });
  // Offsets above are per code point; map them to UTF-16 indices.
  const starts = [];
  let at = 0;
  for (const ch of text) {
    starts.push(at);
    at += ch.length;
  }
  starts.push(at);

  /** @type {[number, number][]} */
  const spans = [];
  const mark = (from, to) => spans.push([starts[origin[from]], starts[origin[to - 1] + 1]]);
  for (const word of queryWords(query)) {
    if (norm.startsWith(word)) {
      mark(0, word.length);
      continue;
    }
    const wordStarts = [];
    const re = /[^\s\-_/.,:;()[\]…'"]+/g;
    for (let m = re.exec(norm); m; m = re.exec(norm)) wordStarts.push(m.index);
    const initials = wordStarts.map((i) => norm[i]).join("");
    if (word.length >= 2 && wordStarts.length >= word.length && initials.startsWith(word)) {
      for (let i = 0; i < word.length; i++) mark(wordStarts[i], wordStarts[i] + 1);
      continue;
    }
    const boundary = wordStarts.find((i) => norm.startsWith(word, i));
    if (boundary !== undefined) {
      mark(boundary, boundary + word.length);
      continue;
    }
    const inside = norm.indexOf(word);
    if (inside >= 0) {
      mark(inside, inside + word.length);
      continue;
    }
    let from = 0;
    /** @type {number[]} */
    const hits = [];
    for (const ch of word) {
      const hit = norm.indexOf(ch, from);
      if (hit < 0) break;
      hits.push(hit);
      from = hit + 1;
    }
    if (hits.length === word.length) for (const hit of hits) mark(hit, hit + 1);
  }
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  /** @type {[number, number][]} */
  const merged = [];
  for (const span of spans) {
    const lastSpan = merged[merged.length - 1];
    if (lastSpan && span[0] <= lastSpan[1]) lastSpan[1] = Math.max(lastSpan[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  return merged;
}

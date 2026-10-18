// The command palette demo: the app's own commands (lib/commandCatalog.js)
// and parts, searched with the app's own ranking (lib/commands.js), so
// "oib" finds Open in Bench here exactly as it does there. Choosing one
// opens it where it lives: a part on the Bench, a tab of the app, a guide
// or a link; a command that only means something inside the app opens
// the app. The same palette also floats over the page
// (createPaletteDialog()), for Cmd/Ctrl+K far from the demo.
import siteData from "virtual:site-data";
import {
  BUILTIN_COMMANDS,
  ISSUES_URL,
  LAYERLING_URL,
  REPO_URL,
  SECTION_ORDER,
} from "../../lib/commandCatalog.js";
import { browseSections, matchRanges, rankCommands } from "../../lib/commands.js";
import { chordText } from "../../lib/shortcuts.js";
import { onVisibility } from "../common.js";

/** @typedef {import("../../lib/commands.js").Command} Command */
/** @typedef {Command & { href: string, opens: string }} DemoCommand */

const BASE = import.meta.env.BASE_URL;
// What the demo types to itself until someone types instead.
const TOUR = ["oib", "gf bin", "skadis", "dl stl", "undo"];
const TYPE_MS = 120;
const HOLD_MS = 1700;

// Where a built-in command leads from the website. Anything not listed
// acts on the app's current part or bench, so it opens the app.
const LINKS = {
  "app.library": `${BASE}app/`,
  "app.bench": `${BASE}app/#mode=bench`,
  "app.holes": `${BASE}app/#mode=holes`,
  "app.guides": `${BASE}docs/`,
  "app.website": BASE,
  "app.github": REPO_URL,
  "app.issue": ISSUES_URL,
  "app.layerling": LAYERLING_URL,
  "app.releases": "#download",
};

/** @returns {DemoCommand[]} */
function demoCommands() {
  /** @type {DemoCommand[]} */
  const commands = Object.entries(BUILTIN_COMMANDS).map(([id, builtin]) => {
    /** @type {{ title: string, section: string, keywords?: readonly string[], keys?: readonly (readonly string[])[] }} */
    const entry = builtin;
    return {
      id,
      title: entry.title,
      section: entry.section,
      keywords: entry.keywords ? [...entry.keywords] : [],
      keys: entry.keys ? entry.keys.map((chord) => [...chord]) : undefined,
      href: LINKS[id] ?? `${BASE}app/`,
      opens: LINKS[id] ? "opens it" : "opens the app",
    };
  });
  const guides = [
    {
      title: "Getting started",
      path: "docs/getting-started/",
      keywords: ["guide", "tutorial", "help", "first"],
    },
    {
      title: "Install the desktop app",
      path: "docs/desktop/",
      keywords: ["mac", "windows", "download", "install"],
    },
    { title: "Use the command line", path: "docs/cli/", keywords: ["cli", "terminal", "foundry", "python"] },
    { title: "All guides", path: "docs/", keywords: ["docs", "documentation", "manual"] },
  ];
  for (const { title, path, keywords } of guides) {
    commands.push({
      id: `site:${path}`,
      title,
      section: "Guides",
      keywords,
      href: `${BASE}${path}`,
      opens: "opens the guide",
    });
  }
  for (const part of siteData.parts) {
    commands.push({
      id: `part:${part.id}`,
      title: part.name,
      subtitle: part.system,
      badge: part.confidence,
      section: "Parts",
      keywords: [part.id],
      thumbnail: part.thumbnail ?? undefined,
      // As in the app: the parts would bury everything else until something is typed.
      searchOnly: true,
      href: `${BASE}${part.bench}`,
      opens: "opens it on the Bench",
    });
  }
  return commands;
}

function highlight(text, query) {
  const fragment = document.createDocumentFragment();
  let at = 0;
  for (const [from, to] of query ? matchRanges(text, query) : []) {
    fragment.append(text.slice(at, from));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(from, to);
    fragment.append(mark);
    at = to;
  }
  fragment.append(text.slice(at));
  return fragment;
}

/**
 * @param {HTMLElement} root the palette's container: its search box, list and footer
 * @param {object} options
 * @param {boolean} options.still no typing tour (reduced motion, or the floating palette)
 * @param {string} [options.idPrefix] its options' ids, unique on the page
 * @param {boolean} [options.inDialog] Esc is left to the dialog, which closes on it
 * @param {(command: DemoCommand) => void} [options.onRun] called just before a command runs
 * @returns {{ input: HTMLInputElement, reset(): void }}
 */
export function mountPalette(root, { still, idPrefix = "palette-option", inDialog = false, onRun }) {
  const input = /** @type {HTMLInputElement} */ (root.querySelector("[data-palette-input]"));
  const list = /** @type {HTMLElement} */ (root.querySelector("[data-palette-results]"));
  const footer = /** @type {HTMLElement} */ (root.querySelector("[data-palette-footer]"));
  const commands = demoCommands();
  /** @type {DemoCommand[]} */
  let shown = [];
  let selected = 0;
  // Someone already in the search box (Cmd/Ctrl+K got there before the
  // demo started) gets no tour typing over them.
  let touched = still || root.contains(document.activeElement);
  let tourTimer = 0;

  function render() {
    const query = input.value.trim();
    list.replaceChildren();
    /** @type {{ title: string | null, items: DemoCommand[] }[]} */
    const sections = query
      ? [
          {
            title: null,
            items: rankCommands(commands, query)
              .map((r) => /** @type {DemoCommand} */ (r.command))
              .slice(0, 40),
          },
        ]
      : /** @type {any} */ (
          browseSections(commands, { sectionOrder: ["Go to", "Guides", ...SECTION_ORDER] })
        );
    shown = sections.flatMap((section) => section.items);
    selected = Math.min(selected, Math.max(0, shown.length - 1));
    if (!shown.length) {
      const empty = document.createElement("li");
      empty.className = "palette-empty";
      empty.setAttribute("role", "presentation");
      empty.textContent = "Nothing matches. Try a part, a tab or an action.";
      list.append(empty);
      input.removeAttribute("aria-activedescendant");
      updateFooter();
      return;
    }
    let index = 0;
    for (const section of sections) {
      if (section.title) {
        const heading = document.createElement("li");
        heading.className = "palette-heading";
        heading.setAttribute("role", "presentation");
        heading.textContent = section.title;
        list.append(heading);
      }
      for (const command of section.items) {
        list.append(option(command, index, query));
        index += 1;
      }
    }
    select(selected, false);
  }

  function option(command, index, query) {
    const item = document.createElement("li");
    item.className = "palette-option";
    item.id = `${idPrefix}-${index}`;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", "false");
    if (command.thumbnail) {
      const thumb = document.createElement("span");
      thumb.className = "palette-thumb";
      thumb.style.backgroundImage = `url("${BASE}${command.thumbnail}")`;
      item.append(thumb);
    } else {
      const glyph = document.createElement("span");
      glyph.className = "palette-glyph";
      glyph.setAttribute("aria-hidden", "true");
      glyph.textContent = command.section.slice(0, 1);
      item.append(glyph);
    }
    const text = document.createElement("span");
    text.className = "palette-option-text";
    const title = document.createElement("span");
    title.className = "palette-option-title";
    title.append(highlight(command.title, query));
    text.append(title);
    const sub = document.createElement("span");
    sub.className = "palette-option-sub";
    sub.textContent = command.subtitle ? `${command.subtitle} · ${command.section}` : command.section;
    text.append(sub);
    item.append(text);
    if (command.keys?.length) {
      const keys = document.createElement("span");
      keys.className = "palette-option-keys";
      const kbd = document.createElement("kbd");
      kbd.textContent = chordText(command.keys[0]);
      keys.append(kbd);
      item.append(keys);
    }
    item.addEventListener("pointermove", () => {
      if (selected !== index) select(index, false);
    });
    item.addEventListener("click", () => run(command));
    return item;
  }

  function select(index, scroll = true) {
    selected = index;
    for (const item of list.querySelectorAll('[role="option"]')) {
      item.setAttribute("aria-selected", String(item.id === `${idPrefix}-${index}`));
    }
    const active = list.querySelector(`#${idPrefix}-${index}`);
    if (active) {
      input.setAttribute("aria-activedescendant", active.id);
      if (scroll) active.scrollIntoView({ block: "nearest" });
    }
    updateFooter();
  }

  function updateFooter() {
    const command = shown[selected];
    const action = footer.lastElementChild;
    if (!action) return;
    action.replaceChildren();
    const key = document.createElement("kbd");
    key.textContent = "↵";
    action.append(key, ` ${command ? command.opens : "opens it"}`);
  }

  function run(command) {
    onRun?.(command);
    if (command.href.startsWith("#")) {
      document.querySelector(command.href)?.scrollIntoView();
      return;
    }
    window.location.href = command.href;
  }

  input.addEventListener("input", () => {
    selected = 0;
    render();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!shown.length) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      select((selected + delta + shown.length) % shown.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (shown[selected]) run(shown[selected]);
    } else if (event.key === "Escape" && !inDialog) {
      if (input.value) {
        event.preventDefault();
        input.value = "";
        selected = 0;
        render();
      } else input.blur();
    }
  });

  // Typing a few searches by itself, until anyone interacts with it.
  function stopTour() {
    if (touched) return;
    touched = true;
    clearTimeout(tourTimer);
    input.value = "";
    selected = 0;
    render();
  }
  for (const type of ["focus", "pointerdown"])
    root.addEventListener(type, stopTour, { once: true, capture: true });

  let step = 0;
  function tour() {
    if (touched) return;
    const query = TOUR[step % TOUR.length];
    let typed = 0;
    const typeNext = () => {
      if (touched) return;
      typed += 1;
      input.value = query.slice(0, typed);
      selected = 0;
      render();
      if (typed < query.length) tourTimer = window.setTimeout(typeNext, TYPE_MS);
      else
        tourTimer = window.setTimeout(() => {
          step += 1;
          tour();
        }, HOLD_MS);
    };
    input.value = "";
    render();
    tourTimer = window.setTimeout(typeNext, 500);
  }

  render();
  let started = false;
  onVisibility(root, (visible) => {
    if (touched) return;
    if (visible && !started) {
      started = true;
      tour();
    } else if (!visible && started) {
      // Off screen: wait, and start over from the next search when back.
      clearTimeout(tourTimer);
      started = false;
    }
  });

  return {
    input,
    reset() {
      input.value = "";
      selected = 0;
      render();
    },
  };
}

/**
 * The palette over the page, as the app floats its own: a native modal
 * <dialog> built from a copy of the demo's markup taken before the demo
 * ran. Esc clears the search, then closes; so does a click beside it, and
 * running a command.
 * @param {HTMLElement} template the demo's container, as the page has it
 * @returns {{ open(): void, close(): void, isOpen(): boolean }}
 */
export function createPaletteDialog(template) {
  const dialog = document.createElement("dialog");
  dialog.className = "palette-dialog";
  dialog.setAttribute("aria-label", "Command palette");
  const panel = /** @type {HTMLElement} */ (template.cloneNode(true));
  panel.removeAttribute("data-demo");
  panel.removeAttribute("data-reveal");
  const list = /** @type {HTMLElement} */ (panel.querySelector("[data-palette-results]"));
  list.id = "palette-dialog-results";
  panel.querySelector("[data-palette-input]")?.setAttribute("aria-controls", list.id);
  dialog.append(panel);
  document.body.append(dialog);
  const palette = mountPalette(panel, {
    still: true,
    idPrefix: "palette-dialog-option",
    inDialog: true,
    onRun: () => dialog.close(),
  });
  dialog.addEventListener("cancel", (event) => {
    if (!palette.input.value) return;
    event.preventDefault();
    palette.reset();
  });
  // A click on the backdrop lands on the dialog itself, outside its panel.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  return {
    open() {
      palette.reset();
      dialog.showModal();
      palette.input.focus();
    },
    close() {
      dialog.close();
    },
    isOpen: () => dialog.open,
  };
}

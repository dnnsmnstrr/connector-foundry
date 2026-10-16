import { Component, Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useRegistryVersion } from "../hooks/useCommands.js";
import { SECTION_ORDER } from "../lib/commandCatalog.js";
import { browseSections, commandRegistry, matchRanges, rankCommands } from "../lib/commands.js";
import {
  hasCommandModifier,
  isMacPlatform,
  paletteShortcut,
  pickerUndoKey,
} from "../lib/isEditableTarget.js";
import { publicUrl } from "../lib/publicAsset.js";
import { chordTokens } from "../lib/shortcuts.js";
import { getCommandRecents, recordCommandRecent } from "../lib/uiPrefs.js";

/** @typedef {import("../lib/commands.js").Command} Command */
/** @typedef {import("../lib/commands.js").CommandPage} CommandPage */
/** @typedef {"dismiss" | "run" | "command"} CloseReason */
/**
 * @typedef {{ id: string, kind: "page" | "actions", query: string, activeId: string | null,
 *   fromRegistry: boolean }} StackEntry
 */
/** @typedef {{ command: Command, fromRegistry: boolean }} Row */

// The keys for a command's first three actions, in order: Enter, Mod+Enter,
// Alt+Enter (Option on a Mac). A fourth and later are on its Actions page.
const ACTION_KEYS = [["Enter"], ["Mod", "Enter"], ["Alt", "Enter"]];

/**
 * Which of a command's actions an Enter (or a click) asks for: 0 plain, 1
 * with Mod, 2 with Alt; null for any other modifier mix.
 * @param {{ metaKey: boolean, ctrlKey: boolean, altKey: boolean, shiftKey: boolean }} e
 * @param {boolean} mac
 */
function actionIndex(e, mac) {
  const mod = mac ? e.metaKey : e.ctrlKey;
  if (e.shiftKey || (mod && e.altKey)) return null;
  return e.altKey ? 2 : mod ? 1 : 0;
}

// Rows without a picture of their own get a glyph for their section, so
// the list keeps one column of icons to scan down.
const SECTION_GLYPHS = {
  "Go to": "→",
  Settings: "⚙",
  Help: "?",
  "3D view": "◎",
  General: "•",
  Library: "▤",
  Bench: "▦",
  Holes: "◉",
  Views: "◎",
  "Saved presets": "★",
  "Your commands": "★",
  Import: "⇪",
  History: "↺",
  Actions: "›",
};

// The command palette (Mod+K) and the Bench's and Holes' part pickers —
// one Raycast-style list over the workspace: a search box, the page's
// commands under their sections (lib/commands.js), and the keys to run
// them without the pointer. What it lists is `page`, rebuilt by its owner
// on every render so its closures are current: App's global palette lists
// the whole registry (every mounted source's commands, hooks/
// useCommands.js); a picker lists its own parts.
//
// A native <dialog> opened with showModal(), like Modal.jsx: everything
// behind is inert to the pointer, and every window key handler in the app
// already stands aside while a dialog is open (isEditableTarget.js's
// isBehindOpenDialog()). On top of that this stops each plain key from
// propagating, as the viewer's View menu does, so none of those handlers
// sees an Escape or an arrow meant for the list.
//
// A command with a `page` opens a nested list (View…, Hole type…), and →
// at the end of the search opens one listing all of a command's actions.
// The stack holds command ids, resolved again from the page above on every
// render — never a stale copy — and a level whose command has gone (a
// preset deleted from its own Actions page) is dropped.
//
// Running closes first: `onClose("run")`, or "command" for a command that
// came from the registry rather than the page's own list (a picker's
// search also finds the app's commands), then the action — in the same
// event, so a file chooser or a new window keeps the user's click, and in
// the same React batch as the owner's state change, so the palette is gone
// before whatever the command opens (Settings, an import) shows: there is
// never a second modal dialog under this one. `closeOnRun` (App's palette)
// also closes the element at once, so a confirm() a command asks is not
// drawn over the list. A picker's own items don't close it — their change
// to the owner's state (a base part chosen) is what unmounts it, and one
// that changes nothing (a file chooser cancelled) leaves it open.
//
// `undo`: the picker's tab history. Cmd/Ctrl+Z in the search box before
// anything is typed into it is the tab's undo (Start over, Pick another
// model), as on the start screens these pickers replace; once typed into,
// the box keeps its own text undo.
/**
 * @param {{
 *   page: CommandPage,
 *   onClose: (reason: CloseReason) => void,
 *   initialPath?: string[],
 *   closeOnRun?: boolean,
 *   undo?: { onUndo: () => void, onRedo: () => void } | null,
 *   registry?: import("../lib/commands.js").CommandRegistry,
 *   className?: string,
 * }} props `initialPath`: ids of commands whose pages to open on (a user hotkey for "View…")
 */
export default function CommandPalette({
  page,
  onClose,
  initialPath = [],
  closeOnRun = false,
  undo = null,
  registry = commandRegistry,
  className,
}) {
  useRegistryVersion(registry);
  const dialogRef = useRef(/** @type {HTMLDialogElement | null} */ (null));
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const panelRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const fileRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const pendingFile = useRef(
    /** @type {{ onFile: (file: File) => void, reason: CloseReason } | null} */ (null),
  );
  const [stack, setStack] = useState(
    /** @returns {StackEntry[]} */
    () => initialPath.map((id) => ({ id, kind: "page", query: "", activeId: null, fromRegistry: true })),
  );
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(/** @type {string | null} */ (null));
  // Whether the search box has been typed into since the palette opened:
  // until then, Cmd/Ctrl+Z is the tab's (`undo`).
  const [typed, setTyped] = useState(false);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const listId = `${baseId}-list`;
  const mac = isMacPlatform();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog.open) dialog.showModal();
    // Not the keyboard on a touch screen: it would cover the list.
    if (hasCoarsePointer()) panelRef.current?.focus();
    else inputRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  // A close request that isn't the Escape key (handled below, which also
  // cancels this event): Android's back gesture, the browser's own.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const onCancel = (e) => {
      e.preventDefault();
      onCloseRef.current("dismiss");
    };
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, []);

  // --- Resolve the stack -------------------------------------------------
  // A page's items, without the ones that are not on offer now (a source
  // writes `cond && command`, as builtin()'s `when` leaves a null).
  /** @param {CommandPage} p @returns {Command[]} */
  const ownItems = (p) => /** @type {Command[]} */ (p.items().filter(Boolean));
  /** @param {CommandPage} p @param {string} id */
  const findIn = (p, id) =>
    ownItems(p).find((c) => c.id === id) ??
    (p.searchCommands ? registry.collect().find((c) => c.id === id) : undefined) ??
    null;

  /** @type {{ page: CommandPage, command: Command | null, fromRegistry: boolean }[]} */
  const levels = [{ page, command: null, fromRegistry: false }];
  for (const entry of stack) {
    const parent = levels[levels.length - 1];
    const command = findIn(parent.page, entry.id);
    const nested = !command ? null : entry.kind === "actions" ? actionsPage(command) : command.page?.();
    if (!nested) break;
    levels.push({ page: nested, command, fromRegistry: parent.fromRegistry || entry.fromRegistry });
  }
  const depth = levels.length - 1;
  const level = levels[depth];
  const current = level.page;
  const onActionsPage = depth > 0 && stack[depth - 1].kind === "actions";

  // A level whose command went away: drop it (and anything above it) and
  // put back the search that was showing when it was opened.
  useEffect(() => {
    if (depth >= stack.length) return;
    setQuery(stack[depth].query);
    setActiveId(stack[depth].activeId);
    setStack(stack.slice(0, depth));
  }, [depth, stack]);

  // --- What to list ------------------------------------------------------
  const recents = getCommandRecents();
  const own = ownItems(current);
  const searching = query.trim() !== "";
  /** @type {{ title: string | null, rows: Row[] }[]} */
  let sections;
  if (!searching) {
    const browse = current.browse === "recent";
    sections = browseSections(own, {
      recents: browse ? recents : [],
      sectionOrder: browse ? SECTION_ORDER : [],
    }).map((s) => ({ title: s.title, rows: s.items.map((command) => ({ command, fromRegistry: false })) }));
  } else {
    const ranked = rankCommands(own, query, { recents }).map(({ command }) => ({
      command,
      fromRegistry: false,
    }));
    sections = [{ title: null, rows: ranked }];
    if (current.searchCommands) {
      const ownIds = new Set(own.map((c) => c.id));
      const more = rankCommands(
        registry.collect().filter((c) => !ownIds.has(c.id)),
        query,
        { recents },
      ).map(({ command }) => ({ command, fromRegistry: true }));
      if (more.length) sections.push({ title: "Commands", rows: more });
    }
  }
  const rows = sections.flatMap((s) => s.rows);
  const enabled = rows.filter((r) => !r.command.disabled);
  // Until the pointer or the arrows pick one: the setting in effect on a
  // list of choices (Grid step's current value), else the first row.
  const active =
    enabled.find((r) => r.command.id === activeId) ??
    (searching || current.browse === "recent" ? null : enabled.find((r) => r.command.checked)) ??
    enabled[0] ??
    null;
  const activeIndex = active ? rows.indexOf(active) : -1;
  const optionId = (i) => `${baseId}-option-${i}`;

  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
    // optionId() is a pure function of baseId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, query, depth]);

  // --- Doing things ------------------------------------------------------
  function dismiss() {
    onClose("dismiss");
  }

  /** @param {Command} command @param {"page" | "actions"} kind @param {boolean} fromRegistry */
  function push(command, kind, fromRegistry) {
    setStack([
      ...stack.slice(0, depth),
      { id: command.id, kind, query, activeId: active?.command.id ?? null, fromRegistry },
    ]);
    setQuery("");
    setActiveId(null);
    inputRef.current?.focus();
  }

  function pop() {
    const entry = stack[depth - 1];
    setStack(stack.slice(0, depth - 1));
    setQuery(entry.query);
    setActiveId(entry.activeId);
    inputRef.current?.focus();
  }

  /**
   * @param {CloseReason} reason
   * @param {() => void} [then]
   */
  function finish(reason, then) {
    if (closeOnRun || reason === "command") dialogRef.current?.close();
    onClose(reason);
    then?.();
  }

  /** @param {Row} row @param {number} index which action: 0 for Enter, 1 for Mod+Enter */
  function choose(row, index) {
    const { command } = row;
    if (command.disabled) return;
    const fromRegistry = level.fromRegistry || row.fromRegistry;
    if (command.page && index === 0) {
      push(command, "page", row.fromRegistry);
      return;
    }
    const action = command.actions?.[index];
    if (!action) return;
    // An action picked from a command's Actions page counts for that command.
    recordCommandRecent(onActionsPage ? level.command.id : command.id);
    const reason = fromRegistry ? "command" : "run";
    if (action.file) {
      const input = fileRef.current;
      pendingFile.current = { onFile: action.file.onFile, reason };
      input.accept = action.file.accept;
      input.value = "";
      input.click();
      return;
    }
    finish(reason, action.run);
  }

  function onFileChosen(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const pending = pendingFile.current;
    pendingFile.current = null;
    if (!file || !pending) return;
    finish(pending.reason, () => pending.onFile(file));
  }

  /** @param {number} delta */
  function move(delta) {
    if (!enabled.length) return;
    const at = active ? enabled.indexOf(active) : -1;
    const next = enabled[(at + delta + enabled.length) % enabled.length];
    setActiveId(next.command.id);
  }

  function onKeyDown(e) {
    if (e.nativeEvent.isComposing) return;
    if (paletteShortcut(e)) {
      e.preventDefault();
      e.stopPropagation();
      dismiss();
      return;
    }
    const target = e.target;
    const inList = target === inputRef.current || target === panelRef.current;
    const which = undo && depth === 0 && target === inputRef.current ? pickerUndoKey(e, typed, mac) : null;
    if (which) {
      // Prevented, so the window's undo listener (which stands aside for an
      // open dialog anyway) leaves it alone too.
      e.preventDefault();
      if (which === "undo") undo.onUndo();
      else undo.onRedo();
      return;
    }
    const mod = mac ? e.metaKey : e.ctrlKey;
    let handled = true;
    if (e.key === "Escape") {
      if (query) setQuery("");
      else if (depth > 0) pop();
      else dismiss();
    } else if (!inList) {
      handled = false;
    } else if (e.key === "ArrowDown" && !mod) {
      move(1);
    } else if (e.key === "ArrowUp" && !mod) {
      move(-1);
    } else if (mac && e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "n" || e.key === "p")) {
      // Emacs keys, as every list on a Mac takes them.
      move(e.key === "n" ? 1 : -1);
    } else if (e.key === "Enter" && actionIndex(e, mac) !== null) {
      const index = actionIndex(e, mac);
      // On a command's own Actions page the keys stand for its actions by
      // position, as the rows and the footer say, whichever row is
      // highlighted: Mod+Enter is the second there too.
      if (onActionsPage && index > 0) {
        if (own[index]) choose({ command: own[index], fromRegistry: false }, 0);
      } else if (active) choose(active, index);
    } else if (
      e.key === "ArrowRight" &&
      !hasCommandModifier(e) &&
      !e.shiftKey &&
      active &&
      (active.command.actions?.length ?? 0) > 1 &&
      caretAtEnd(inputRef.current)
    ) {
      push(active.command, "actions", active.fromRegistry);
    } else if (e.key === "Backspace" && query === "" && depth > 0 && !hasCommandModifier(e)) {
      pop();
    } else {
      handled = false;
    }
    if (handled) e.preventDefault();
    // Plain keys are the palette's: none of the tabs' window listeners may
    // act on an Escape, an arrow or a Delete typed here. Modifier chords
    // pass, so the browser's own (copy, paste) and Mod+Z still work.
    if (!hasCommandModifier(e)) e.stopPropagation();
  }

  // --- Rendering ---------------------------------------------------------
  // What the footer's keys do: the highlighted command's actions, or on an
  // Actions page the actions themselves (Enter the highlighted one).
  const keyed = onActionsPage ? own.map((c) => c.actions[0]) : (active?.command.actions ?? []);
  const primaryTitle = active
    ? active.command.page
      ? "Open"
      : (active.command.actions?.[0]?.title ?? null)
    : null;
  const keyHint = (chord) => (
    <span className="command-keys" aria-hidden="true">
      {chordTokens(chord, mac, true).map((t, i) => (
        <kbd key={i} className="command-key">
          {t.text}
        </kbd>
      ))}
    </span>
  );
  let rowIndex = -1;

  return (
    <dialog
      ref={dialogRef}
      className={className ? `command-palette ${className}` : "command-palette"}
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div ref={panelRef} className="command-palette-panel" tabIndex={-1}>
        <div className="command-palette-header">
          {depth > 0 && (
            <button type="button" className="command-palette-back" onClick={pop} aria-label="Back">
              ‹
            </button>
          )}
          <h2 id={titleId} className="command-palette-title">
            {current.title}
          </h2>
          <button type="button" className="command-palette-close" onClick={dismiss} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="command-palette-search">
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
            aria-label={current.searchLabel ?? "Search commands"}
            placeholder={current.placeholder ?? "Search for a command…"}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveId(null);
              setTyped(true);
            }}
          />
          {current.accessory && <div className="command-palette-accessory">{current.accessory}</div>}
        </div>
        {current.error && (
          <p className="error-text command-palette-error" role="alert">
            {current.error}
          </p>
        )}
        {!searching && current.note && <p className="command-palette-note muted">{current.note}</p>}
        {/* Mousedown on the list keeps focus in the search box, so typing
            and the arrow keys carry on after a click. */}
        <div
          id={listId}
          className="command-palette-list"
          role="listbox"
          aria-label={current.title}
          onMouseDown={(e) => e.preventDefault()}
        >
          {rows.length === 0 && (
            <p className="command-palette-empty muted" role="status">
              {searching
                ? (current.emptyText ?? `Nothing matches "${query.trim()}".`)
                : (current.emptyText ?? "Nothing here.")}
            </p>
          )}
          {sections.map((section, s) => {
            if (!section.rows.length) return null;
            const headingId = `${baseId}-section-${s}`;
            return (
              <div
                key={`${section.title ?? "results"}-${s}`}
                role="group"
                aria-labelledby={section.title ? headingId : undefined}
                aria-label={section.title ? undefined : "Results"}
              >
                {section.title && (
                  <div id={headingId} className="command-palette-section" role="presentation">
                    {section.title}
                  </div>
                )}
                {section.rows.map((row) => {
                  rowIndex += 1;
                  const i = rowIndex;
                  const { command } = row;
                  const isActive = row === active;
                  const hint = command.hotkey ? command.hotkey.split("+") : command.keys?.[0];
                  return (
                    <div
                      key={command.id}
                      id={optionId(i)}
                      role="option"
                      aria-selected={isActive}
                      aria-disabled={command.disabled ? true : undefined}
                      aria-checked={command.checked === undefined ? undefined : command.checked}
                      aria-keyshortcuts={
                        hint ? hint.join("+").replace("Mod", mac ? "Meta" : "Control") : undefined
                      }
                      className={[
                        "command-row",
                        isActive && "is-active",
                        command.disabled && "is-disabled",
                        command.checked && "is-checked",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      title={typeof command.disabled === "string" ? command.disabled : undefined}
                      onMouseMove={() => {
                        if (!command.disabled && activeId !== command.id) setActiveId(command.id);
                      }}
                      onClick={(e) => choose(row, onActionsPage ? 0 : (actionIndex(e, mac) ?? 0))}
                    >
                      <CommandIcon command={command} />
                      <span className="command-row-text">
                        <span className="command-row-title">
                          <Highlighted text={command.title} query={searching ? query : ""} />
                        </span>
                        {command.badge && (
                          <>
                            {" "}
                            <span className={`badge badge-${command.badge}`}>{command.badge}</span>
                          </>
                        )}
                        {(command.subtitle || typeof command.disabled === "string") && (
                          <span className="command-row-subtitle" aria-hidden="true">
                            {typeof command.disabled === "string" ? command.disabled : command.subtitle}
                          </span>
                        )}
                      </span>
                      <span className="command-row-end" aria-hidden="true">
                        {command.checked && <span className="command-row-check">✓</span>}
                        {searching && section.title === null && current.browse === "recent" && (
                          <span className="command-row-section">{command.section}</span>
                        )}
                        {hint && keyHint(hint)}
                        {command.page && <span className="command-row-more">›</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="command-palette-footer" aria-hidden="true">
          {primaryTitle && (
            <span className="command-palette-hint">
              {keyHint(["Enter"])} {primaryTitle}
            </span>
          )}
          {keyed.slice(1, ACTION_KEYS.length).map((action, i) => (
            <span key={i} className="command-palette-hint">
              {keyHint(ACTION_KEYS[i + 1])} {action.title}
            </span>
          ))}
          {(active?.command.actions?.length ?? 0) > 1 && (
            <span className="command-palette-hint">{keyHint(["→"])} Actions</span>
          )}
          <span className="command-palette-hint command-palette-hint-end">
            {keyHint(["Esc"])} {query ? "Clear" : depth > 0 ? "Back" : "Close"}
          </span>
        </div>
        <input ref={fileRef} type="file" hidden onChange={onFileChosen} />
      </div>
    </dialog>
  );
}

/**
 * A command's actions as a list of their own (→ on a row).
 * @param {Command} command
 * @returns {CommandPage | null}
 */
function actionsPage(command) {
  const actions = command.actions ?? [];
  if (!actions.length) return null;
  return {
    id: `actions:${command.id}`,
    title: command.title,
    searchLabel: "Search actions",
    placeholder: "Search actions…",
    items: () =>
      actions.map((action, i) => ({
        id: `${command.id}\u0000${i}`,
        title: action.title,
        section: "Actions",
        keys: action.keys ?? (ACTION_KEYS[i] ? [ACTION_KEYS[i]] : undefined),
        actions: [action],
      })),
  };
}

/**
 * The part's thumbnail, a hole type's drawing, or the section's glyph.
 * @param {{ command: Command }} props
 */
function CommandIcon({ command }) {
  const [broken, setBroken] = useState(false);
  if (command.icon) return <span className="command-icon">{command.icon}</span>;
  if (command.thumbnail && !broken) {
    return (
      <span className="command-icon command-thumb">
        <img
          src={publicUrl(command.thumbnail)}
          alt=""
          loading="lazy"
          decoding="async"
          width={40}
          height={30}
          onError={() => setBroken(true)}
        />
      </span>
    );
  }
  // A part with no picture: its system's initial, in the thumbnail's box.
  if (command.badge) {
    return (
      <span className="command-icon command-thumb command-thumb-empty" aria-hidden="true">
        {(command.subtitle ?? command.title).slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <span className="command-icon command-glyph" aria-hidden="true">
      {SECTION_GLYPHS[command.section] ?? "•"}
    </span>
  );
}

/**
 * `text` with the spans the query matched marked.
 * @param {{ text: string, query: string }} props
 */
function Highlighted({ text, query }) {
  if (!query) return text;
  const ranges = matchRanges(text, query);
  if (!ranges.length) return text;
  const out = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) out.push(text.slice(at, start));
    out.push(<mark key={start}>{text.slice(start, end)}</mark>);
    at = end;
  }
  if (at < text.length) out.push(text.slice(at));
  return <Fragment>{out}</Fragment>;
}

/** @param {HTMLInputElement | null} input */
function caretAtEnd(input) {
  if (!input) return true;
  return input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
}

function hasCoarsePointer() {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
}

// The palette renders outside the modes' error boundary (it is App's, and
// a picker's palette lists more than its tab's own state): a command whose
// row fails to draw closes the palette with a warning rather than taking
// the shell down with it.
/** @extends {Component<{ onError: () => void, children: import("react").ReactNode }, { failed: boolean }>} */
export class CommandPaletteBoundary extends Component {
  /** @param {{ onError: () => void, children: import("react").ReactNode }} props */
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error("The command palette crashed:", error);
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

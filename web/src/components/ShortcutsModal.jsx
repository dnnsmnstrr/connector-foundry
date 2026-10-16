import { Fragment, useMemo, useState, useSyncExternalStore } from "react";
import { isMacPlatform } from "../lib/isEditableTarget.js";
import { chordTokens, filterShortcutSections, shortcutSections } from "../lib/shortcuts.js";
import { getUserCommands, hotkeyRows, subscribeUserCommands } from "../lib/userCommands.js";
import Modal from "./Modal.jsx";

// The "Keyboard shortcuts" sheet, opened with "?", from Settings' header or
// from the command palette (App.jsx). Everything on it comes from lib/shortcuts.js's one table,
// resolved for this platform once per opening: Cmd and Option on a Mac,
// Ctrl and Alt elsewhere. Each section is a <dl> of key → what it does; a
// row with several alternatives reads "Delete or Backspace", since a "/"
// between them would read as the "/" key. The user's own hotkeys
// (lib/userCommands.js) come last, under "Your hotkeys", when there are any.
//
// A search box beside the title narrows it to the rows with every word typed,
// in their text, their keys or their section (shortcuts.js's
// filterShortcutSections()). It has the focus on opening (not on a touch
// screen, where the keyboard would cover the sheet); Esc in it clears what
// was typed before it closes the sheet, and "?" in it is a character once
// something is typed — before that, a second "?" still puts the sheet away.
//
// `onClose` puts the sheet away: the Close button, Esc and a backdrop
// click (Modal.jsx) all call it. App.jsx also closes it on a second "?"
// typed anywhere else in the sheet.
/**
 * @param {{ onClose: () => void }} props
 */
export default function ShortcutsModal({ onClose }) {
  const userCommands = useSyncExternalStore(subscribeUserCommands, getUserCommands);
  const sections = useMemo(() => {
    const mac = isMacPlatform();
    const own = hotkeyRows(userCommands).map((row) => ({
      chords: [chordTokens(row.keys, mac)],
      action: row.title,
    }));
    const app = shortcutSections(mac);
    return own.length ? [...app, { title: "Your hotkeys", note: null, rows: own }] : app;
  }, [userCommands]);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterShortcutSections(sections, query), [sections, query]);
  const focusOnOpen = !hasCoarsePointer();

  /** @param {import("react").KeyboardEvent<HTMLInputElement>} e */
  function onSearchKeyDown(e) {
    if (e.key === "Escape" && query) {
      // Not the dialog's cancel, nor App's Escape: only the search goes.
      e.preventDefault();
      e.stopPropagation();
      setQuery("");
    } else if (e.key === "?" && !query) {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }

  return (
    <Modal
      onClose={onClose}
      title="Keyboard shortcuts"
      className="shortcuts-modal"
      actions={
        <input
          type="search"
          className="search-input shortcuts-search"
          placeholder="Search shortcuts…"
          aria-label="Search shortcuts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKeyDown}
          autoComplete="off"
          spellCheck={false}
          data-autofocus={focusOnOpen ? "" : undefined}
        />
      }
    >
      {shown.length === 0 && (
        <p className="muted no-results" role="status">
          No shortcuts match "{query.trim()}".
        </p>
      )}
      {shown.map((section) => (
        <Fragment key={section.title}>
          <h4 className="settings-section">{section.title}</h4>
          <dl className="shortcuts-list">
            {section.rows.map((row, i) => (
              <div key={i} className="shortcuts-row">
                <dt className="shortcuts-keys">
                  {row.chords.map((chord, c) => (
                    <Fragment key={c}>
                      {c > 0 &&
                        (c === row.chords.length - 1 ? (
                          <span className="shortcuts-or">or</span>
                        ) : (
                          <span className="shortcuts-or shortcuts-comma">,</span>
                        ))}
                      <span className="shortcuts-chord">
                        {chord.map((token, t) => (
                          <Fragment key={t}>
                            {t > 0 && <span className="shortcuts-plus">+</span>}
                            {token.kbd ? (
                              <kbd className="shortcuts-key">{token.text}</kbd>
                            ) : (
                              <span className="shortcuts-pointer">{token.text}</span>
                            )}
                          </Fragment>
                        ))}
                      </span>
                    </Fragment>
                  ))}
                </dt>
                <dd className="shortcuts-action">{row.action}</dd>
              </div>
            ))}
          </dl>
          {section.note && <p className="shortcuts-note muted">{section.note}</p>}
        </Fragment>
      ))}
      <button type="button" className="bench-modal-cancel" onClick={onClose}>
        Close
      </button>
    </Modal>
  );
}

function hasCoarsePointer() {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
}

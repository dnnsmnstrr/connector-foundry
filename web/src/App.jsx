import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Bench from "./Bench.jsx";
import Library from "./Library.jsx";
import SettingsModal from "./components/SettingsModal.jsx";
import { useBenchSession } from "./hooks/useBenchSession.js";
import { useCatalogue, useGlobalDefaults } from "./hooks/useCatalogue.js";
import { useRenderActivity } from "./hooks/useRenderActivity.js";
import { createAssembly } from "./lib/assembly.js";
import { replaceBenchSession } from "./lib/benchSession.js";
import { readUrlState, restoreBenchFromUrl, saveSessionImports, writeUrlState } from "./lib/benchUrlState.js";
import { isEditableTarget } from "./lib/isEditableTarget.js";
import { getBenchFollowsLibrary, getSidebarCollapsed, setSidebarCollapsed } from "./lib/uiPrefs.js";

// Between the last bench edit and the URL catching up with it — typing a
// parameter value shouldn't rewrite the address bar once per keystroke.
const URL_MIRROR_DEBOUNCE_MS = 300;

// Every single-key shortcut below checks isEditableTarget() first (a
// keystroke in a search box or param field means "type a character", not
// "trigger a shortcut"); Escape doesn't need to, since "close the dialog"
// is expected to work from inside a focused field too (native <dialog>
// behaves the same way).

// The shell: nav bar, the Library/Bench mode switch, the Settings modal,
// the sidebar-collapsed preference both modes share, and the URL mirror
// of the bench (lib/benchUrlState.js) so a reload comes back to it.
export default function App() {
  const { parts, error } = useCatalogue();
  const globalDefaults = useGlobalDefaults();
  const rendersInFlight = useRenderActivity();
  // "library" | "bench" — from the URL hash on first load, so a reload
  // lands on the tab that was showing.
  const [mode, setMode] = useState(() => readUrlState().mode ?? "library");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(getSidebarCollapsed);
  // The live bench (lib/benchSession.js) — read here only to mirror it
  // into the URL and to decide whether a switch may seed it.
  const { assembly, importedParts } = useBenchSession();
  // Library's current { part, params }, kept in a ref (it changes on
  // every parameter keystroke; nothing here needs to re-render for it).
  // Read by switchToBench() when the "Bench follows Library" setting is
  // on — the same hand-over "Open in Bench" does, just on a plain switch.
  const librarySelection = useRef(null);
  const onLibrarySelectionChange = useCallback((selection) => {
    librarySelection.current = selection;
  }, []);

  // The bench in the URL -> the session. A link that can't be restored
  // (cut short, or naming an imported mesh only the original tab had)
  // leaves an empty bench with a note for its start screen rather than
  // failing silently. `keepCurrent`: a URL with no bench leaves the
  // session alone on first load (there's nothing to replace) but clears
  // it on a later external hash change (the user navigated to "no bench").
  const catalogueById = useMemo(() => (parts ? new Map(parts.map((p) => [p.id, p])) : null), [parts]);
  const restoreFromUrl = useCallback(
    (keepCurrent) => {
      try {
        const session = restoreBenchFromUrl(catalogueById);
        if (session) replaceBenchSession(session);
        else if (!keepCurrent) replaceBenchSession({ assembly: null, importedParts: new Map() });
      } catch (err) {
        replaceBenchSession({
          assembly: null,
          importedParts: new Map(),
          notice: `Couldn't restore the bench from this link: ${err.message}`,
        });
      }
    },
    [catalogueById],
  );

  // Once, before showing either mode, as soon as the catalogue the tree
  // has to be checked against is here. Gates the URL mirror below too:
  // writing before restoring would wipe the very hash being restored.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!catalogueById || restored) return;
    restoreFromUrl(true);
    setRestored(true);
  }, [catalogueById, restored, restoreFromUrl]);

  // And again whenever the hash changes from OUTSIDE — a bench link
  // pasted into this tab's address bar, or the hash edited by hand.
  // replaceState (the mirror below) never fires hashchange, so every
  // event here is external and means "load this instead".
  useEffect(() => {
    if (!restored) return;
    function onHashChange() {
      restoreFromUrl(false);
      setMode(readUrlState().mode ?? "library");
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [restored, restoreFromUrl]);

  // Mode and tree -> URL hash. replaceState, so the back button still
  // leaves the app rather than stepping through edits. A mode switch is
  // written at once (a reload right after switching tabs should land on
  // the new tab); tree edits are debounced, since a parameter being typed
  // changes the tree once per keystroke.
  useEffect(() => {
    if (!restored) return;
    writeUrlState({ mode, assembly });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, mode]);
  // (`mode` is a dependency here too, so a pending write can't fire with
  // the mode of the render it was scheduled in.)
  useEffect(() => {
    if (!restored) return;
    const timer = setTimeout(() => writeUrlState({ mode, assembly }), URL_MIRROR_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [restored, mode, assembly]);

  // Imported meshes -> sessionStorage, for a reload of this tab (they
  // are far too big for the URL). Keyed on which meshes the tree
  // references, not on every edit, since serialising a mesh is the one
  // expensive part of this.
  const referencedImports = assembly
    ? [assembly.root.partId, ...assembly.nodes.map((n) => n.partId)].filter((id) => importedParts.has(id)).join(",")
    : "";
  useEffect(() => {
    if (!restored || !catalogueById) return;
    saveSessionImports(assembly, new Map([...catalogueById, ...importedParts]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, catalogueById, importedParts, referencedImports, assembly === null]);

  // Library's selection (with its current parameters) becomes the root of
  // a fresh bench — "Open in Bench" and, with the setting on, a plain
  // switch. The button asks first when there is a bench to lose; the
  // setting never replaces one (a tab switch is not a request to reset).
  function seedBench(part, params) {
    replaceBenchSession({ assembly: createAssembly(part.id, params), importedParts: new Map() });
  }

  // The one path for switching to the Bench (tab and `2` shortcut both
  // use it). Only on an actual switch — from inside the Bench, `2` is a
  // no-op, not "reset my bench".
  function switchToBench() {
    if (mode === "bench") return;
    if (!assembly && getBenchFollowsLibrary() && librarySelection.current) {
      seedBench(librarySelection.current.part, librarySelection.current.params);
    }
    setMode("bench");
  }

  function toggleSidebar() {
    setSidebarCollapsedState((collapsed) => {
      const next = !collapsed;
      setSidebarCollapsed(next);
      return next;
    });
  }

  // Global shortcuts: 1/2 switch mode, s opens Settings, [ toggles the
  // sidebar, Escape closes Settings. Bench's own modals (attach-a-part,
  // STL import) close on Escape too, but that's handled locally in
  // Bench.jsx — it owns that state, App doesn't need to reach into it.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        if (settingsOpen) setSettingsOpen(false);
        return;
      }
      if (isEditableTarget(e.target)) return;
      switch (e.key) {
        case "1":
          setMode("library");
          break;
        case "2":
          switchToBench();
          break;
        case "s":
          setSettingsOpen(true);
          break;
        case "[":
          toggleSidebar();
          break;
        default:
          return;
      }
      e.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // switchToBench() reads `mode` and `assembly`, so the listener is
    // re-bound with them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen, mode, assembly]);

  if (error) return <div className="error-screen">Failed to load catalogue: {error}</div>;
  if (!parts || !restored) return <div className="loading-screen">Loading catalogue&hellip;</div>;
  if (parts.length === 0) return <div className="error-screen">The catalogue is empty.</div>;

  function openInBench(part, params) {
    if (assembly && !window.confirm(`Replace the current bench with a new one on ${part.name}?`)) return;
    seedBench(part, params);
    setMode("bench");
  }

  return (
    <div className="shell">
      <nav className="mode-tabs" aria-label="Main">
        <h1 className="brand">Connector Foundry</h1>
        <button
          type="button"
          className={mode === "library" ? "mode-tab active" : "mode-tab"}
          aria-current={mode === "library" ? "page" : undefined}
          onClick={() => setMode("library")}
          title="Library (1)"
        >
          Library<kbd className="shortcut-hint">1</kbd>
        </button>
        <button
          type="button"
          className={mode === "bench" ? "mode-tab active" : "mode-tab"}
          aria-current={mode === "bench" ? "page" : undefined}
          onClick={switchToBench}
          title="Bench (2)"
        >
          Bench<kbd className="shortcut-hint">2</kbd>
        </button>
        <div className="nav-end">
          {/* Always mounted so the live region exists before it has news;
              hidden (not unmounted) when idle. */}
          <span
            className="render-indicator"
            role="status"
            aria-live="polite"
            hidden={rendersInFlight === 0}
            title={rendersInFlight > 1 ? `${rendersInFlight} renders in progress` : "Render in progress"}
          >
            <span className="render-spinner" aria-hidden="true" />
            <span className="render-indicator-text">Rendering…</span>
          </span>
          <button
            type="button"
            className="mode-tab settings-tab"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            aria-haspopup="dialog"
            title="Settings (s)"
          >
            <span aria-hidden="true">⚙</span>
            <span className="settings-label"> Settings</span>
          </button>
        </div>
      </nav>
      <div className="shell-body">
        {mode === "library" ? (
          <Library
            parts={parts}
            onOpenInBench={openInBench}
            onSelectionChange={onLibrarySelectionChange}
            initialSelection={librarySelection.current}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={toggleSidebar}
          />
        ) : (
          <Bench
            parts={parts}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={toggleSidebar}
          />
        )}
      </div>
      {settingsOpen && (
        <SettingsModal parts={parts} globalDefaults={globalDefaults} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}

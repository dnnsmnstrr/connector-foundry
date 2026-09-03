import { useCallback, useEffect, useRef, useState } from "react";
import Bench from "./Bench.jsx";
import Library from "./Library.jsx";
import SettingsModal from "./components/SettingsModal.jsx";
import { useCatalogue, useGlobalDefaults } from "./hooks/useCatalogue.js";
import { useRenderActivity } from "./hooks/useRenderActivity.js";
import { getBenchFollowsLibrary, getSidebarCollapsed, setSidebarCollapsed } from "./lib/uiPrefs.js";

// True while the event's target is somewhere a keystroke means "type a
// character", not "trigger a shortcut" — a search box, a param field, a
// <select>. Every single-key shortcut below checks this first; Escape
// doesn't need to, since "close the dialog" is expected to work from
// inside a focused field too (native <dialog> behaves the same way).
function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

// The shell: nav bar, the Library/Bench mode switch, the Settings modal,
// and the sidebar-collapsed preference both modes share.
export default function App() {
  const { parts, error } = useCatalogue();
  const globalDefaults = useGlobalDefaults();
  const rendersInFlight = useRenderActivity();
  const [mode, setMode] = useState("library"); // "library" | "bench"
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(getSidebarCollapsed);
  // { part, params } | null — set by Library's "Open in Bench", carrying
  // over whatever's currently showing there (not necessarily catalogue
  // defaults). Bench consumes it once, on the mount that follows the
  // mode switch (it fully unmounts when not the active mode, so this
  // never needs to re-seed an already-running Bench session).
  const [pendingBenchRoot, setPendingBenchRoot] = useState(null);
  // Library's current { part, params }, kept in a ref (it changes on
  // every parameter keystroke; nothing here needs to re-render for it).
  // Read by switchToBench() when the "Bench follows Library" setting is
  // on — the same hand-over "Open in Bench" does, just on a plain switch.
  const librarySelection = useRef(null);
  const onLibrarySelectionChange = useCallback((selection) => {
    librarySelection.current = selection;
  }, []);

  // The one path for switching to the Bench (tab and `2` shortcut both
  // use it): with the setting on, the Bench starts on Library's selected
  // part instead of its own picker. Only on an actual switch — from
  // inside the Bench, `2` is a no-op, not "reset my bench".
  function switchToBench() {
    if (mode === "bench") return;
    if (getBenchFollowsLibrary() && librarySelection.current) setPendingBenchRoot(librarySelection.current);
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
    // switchToBench() reads `mode`, so the listener is re-bound with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen, mode]);

  if (error) return <div className="error-screen">Failed to load catalogue: {error}</div>;
  if (!parts) return <div className="loading-screen">Loading catalogue&hellip;</div>;
  if (parts.length === 0) return <div className="error-screen">The catalogue is empty.</div>;

  function openInBench(part, params) {
    setPendingBenchRoot({ part, params });
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
            pendingRoot={pendingBenchRoot}
            onConsumePendingRoot={() => setPendingBenchRoot(null)}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={toggleSidebar}
          />
        )}
      </div>
      {settingsOpen && <SettingsModal globalDefaults={globalDefaults} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

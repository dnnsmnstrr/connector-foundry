import { useEffect, useState } from "react";
import Bench from "./Bench.jsx";
import Library from "./Library.jsx";
import SettingsModal from "./components/SettingsModal.jsx";
import { useCatalogue, useGlobalDefaults } from "./hooks/useCatalogue.js";
import { getSidebarCollapsed, setSidebarCollapsed } from "./lib/uiPrefs.js";

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
  const [mode, setMode] = useState("library"); // "library" | "bench"
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(getSidebarCollapsed);
  // { part, params } | null — set by Library's "Open in Bench", carrying
  // over whatever's currently showing there (not necessarily catalogue
  // defaults). Bench consumes it once, on the mount that follows the
  // mode switch (it fully unmounts when not the active mode, so this
  // never needs to re-seed an already-running Bench session).
  const [pendingBenchRoot, setPendingBenchRoot] = useState(null);

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
          setMode("bench");
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
  }, [settingsOpen]);

  if (error) return <div className="error-screen">Failed to load catalogue: {error}</div>;
  if (!parts) return <div className="loading-screen">Loading catalogue&hellip;</div>;
  if (parts.length === 0) return <div className="error-screen">The catalogue is empty.</div>;

  function openInBench(part, params) {
    setPendingBenchRoot({ part, params });
    setMode("bench");
  }

  return (
    <div className="shell">
      <nav className="mode-tabs">
        <span className="brand">Connector Foundry</span>
        <button
          className={mode === "library" ? "mode-tab active" : "mode-tab"}
          onClick={() => setMode("library")}
          title="Library (1)"
        >
          Library<kbd className="shortcut-hint">1</kbd>
        </button>
        <button
          className={mode === "bench" ? "mode-tab active" : "mode-tab"}
          onClick={() => setMode("bench")}
          title="Bench (2)"
        >
          Bench<kbd className="shortcut-hint">2</kbd>
        </button>
        <button
          className="mode-tab settings-tab"
          onClick={() => setSettingsOpen(true)}
          title="Printer settings (s)"
        >
          ⚙ Settings<kbd className="shortcut-hint">s</kbd>
        </button>
      </nav>
      <div className="shell-body">
        {mode === "library" ? (
          <Library
            parts={parts}
            onOpenInBench={openInBench}
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

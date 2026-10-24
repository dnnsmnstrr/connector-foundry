import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Bench from "./Bench.jsx";
import Holes from "./Holes.jsx";
import Library from "./Library.jsx";
import CommandPalette, { CommandPaletteBoundary } from "./components/CommandPalette.jsx";
import ModeErrorBoundary from "./components/ModeErrorBoundary.jsx";
import RenderActivity from "./components/RenderActivity.jsx";
import UpdateNotice from "./components/UpdateNotice.jsx";
import SettingsModal from "./components/SettingsModal.jsx";
import ShortcutsModal from "./components/ShortcutsModal.jsx";
import { useBenchSession } from "./hooks/useBenchSession.js";
import { useCatalogue, useGlobalDefaults } from "./hooks/useCatalogue.js";
import { useCommands, usePaletteShortcut } from "./hooks/useCommands.js";
import { useDesktopMcp } from "./hooks/useDesktopMcp.js";
import { useUserCommands } from "./hooks/useUserCommands.js";
import { useWebMcp } from "./hooks/useWebMcp.js";
import { createAssembly } from "./lib/assembly.js";
import { getPreset as getBenchPreset } from "./lib/benchPresets.js";
import {
  clearBenchHistory,
  getBenchSession,
  loadBenchConfig,
  replaceBenchSession,
} from "./lib/benchSession.js";
import { getHolesSession, setHolesDoc } from "./lib/holesSession.js";
import { recordLibrary, requestLibrarySelection } from "./lib/librarySession.js";
import { createHolesDoc, setNextSpec } from "./lib/screwHoles.js";
import { getPreset as getHolePreset, presetSpecFor } from "./lib/screwPresets.js";
import { readUrlState, restoreBenchFromUrl, saveSessionImports, writeUrlState } from "./lib/benchUrlState.js";
import { listedParts } from "./lib/catalogueUtils.js";
import {
  GUIDES_URL,
  ISSUES_URL,
  LAYERLING_URL,
  RELEASES_URL,
  REPO_URL,
  SITE_URL,
  builtin,
  copyText,
  guideCommands,
  linkActions,
  openLink,
  partCommand,
} from "./lib/commandCatalog.js";
import { getCommandHud, subscribeCommandHud } from "./lib/commandHud.js";
import { EASYPRINT_URL } from "./lib/share.js";
import { claudeCodeCommand, mcpJsonConfig } from "./lib/desktopBridge.js";
import { commandRegistry } from "./lib/commands.js";
import { hasCommandModifier, ignoresShortcut, isEditableTarget } from "./lib/isEditableTarget.js";
import { cancelRenders, getRenderActivity } from "./lib/openscad-client.js";
import { SETTINGS_EXTENSION, downloadSettings, importSettingsFile } from "./lib/settingsBackup.js";
import { chordText } from "./lib/shortcuts.js";
import { tabBridge } from "./lib/webmcp.js";
import {
  GRID_SNAP_OPTIONS,
  getBenchFollowsLibrary,
  getGridSnap,
  getHiddenLibrary,
  getSidebarCollapsed,
  getSidebarWidth,
  setBenchFollowsLibrary,
  setGridSnap,
  setSidebarCollapsed,
  subscribeSidebarWidth,
} from "./lib/uiPrefs.js";
import { CIRCLE_DETAILS, getGlobalOverrides, resolveParams, setCircleDetail } from "./lib/userOverrides.js";

// Between the last bench edit and the URL catching up with it — typing a
// parameter value shouldn't rewrite the address bar once per keystroke.
const URL_MIRROR_DEBOUNCE_MS = 300;

// For the error boundary's "Something went wrong in …".
const MODE_LABELS = { library: "the Library", bench: "the Bench", holes: "Holes" };

// The palette's Mod+K, as the nav button's hint shows it: ⌘K on a Mac.
const PALETTE_KEYS = chordText(["Mod", "K"]);

// The global palette's list: every command the mounted sources offer
// (hooks/useCommands.js), recent ones first; a model file dropped on it goes
// to the mounted tab (useCommandDrop() — the Bench and Holes), or nowhere.
/** @type {import("./lib/commands.js").CommandPage} */
const ROOT_PAGE = {
  id: "root",
  title: "Commands",
  searchLabel: "Search commands",
  placeholder: "Search for a command, a part, a setting…",
  browse: "recent",
  items: () => commandRegistry.collect(),
  drop: () => commandRegistry.dropTarget(),
};

// The palette has closed by the time a command runs, so a problem it
// reports has nowhere else to go.
function report(problem) {
  if (problem) window.alert(problem);
}

// What a command that leaves nothing else to see says it did ("Link
// copied", lib/commandHud.js), for a moment at the foot of the window.
// Always mounted, so the live region is there before it has news; hidden
// (not unmounted) between messages.
function CommandHud() {
  const hud = useSyncExternalStore(subscribeCommandHud, getCommandHud);
  return (
    <div className="command-hud" role="status" aria-live="polite" hidden={!hud}>
      {hud?.text}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      className="nav-link-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="6.5" cy="6.5" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <path d="M10.2 10.2 14 14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg
      className="nav-link-icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

// The workspace under the nav. The sidebar's width (dragged on its edge,
// components/SidebarResizer.jsx) goes onto it as --sidebar-width straight
// from the store, through a ref, not through React state: a drag changes it
// on every pointer move, and as App state each of those re-rendered the
// active mode — the Bench's tree, the Holes sidebar, the viewer's props —
// for a value only the stylesheet reads. A layout effect, so the first
// paint already has the stored width rather than the default's.
/**
 * @param {{ children: import("react").ReactNode }} props
 */
function ShellBody({ children }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const apply = () => el.style.setProperty("--sidebar-width", `${getSidebarWidth()}px`);
    apply();
    const unsubscribe = subscribeSidebarWidth(apply);
    return () => {
      unsubscribe();
    };
  }, []);
  return (
    <div ref={ref} className="shell-body">
      {children}
    </div>
  );
}

// Every single-key shortcut below checks ignoresShortcut() first (a
// keystroke in a search box or param field means "type a character", not
// "trigger a shortcut", and one under an open dialog is the dialog's);
// Escape doesn't need to, since "close the dialog"
// is expected to work from inside a focused field too (native <dialog>
// behaves the same way).

// The shell: nav bar, the Library/Bench/Holes mode switch, the Settings and
// keyboard-shortcuts dialogs, the sidebar-collapsed preference both modes
// share, and the URL mirror of the bench (lib/benchUrlState.js) so a reload
// comes back to it.
export default function App() {
  const { parts, error } = useCatalogue();
  const globalDefaults = useGlobalDefaults();
  // "library" | "bench" | "holes" — from the URL hash on first load, so a
  // reload lands on the tab that was showing.
  const [mode, setMode] = useState(() => readUrlState().mode ?? "library");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The "?" sheet (components/ShortcutsModal.jsx).
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // The command palette (components/CommandPalette.jsx): null when closed,
  // else the ids of the command pages to open it on (none: the full list).
  const [palette, setPalette] = useState(/** @type {{ path: string[] } | null} */ (null));
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(getSidebarCollapsed);
  // The live bench (lib/benchSession.js) — read here only to mirror it
  // into the URL and to decide whether a switch may seed it.
  const { assembly, importedParts } = useBenchSession();
  // The desktop app's MCP server for coding agents; null in a browser.
  const desktopMcp = useDesktopMcp();
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
  //
  // Not an undoable step, and the bench's undo history goes with it: a
  // link opened or a hash typed is navigation to another bench, not an
  // edit of this one. Undo would otherwise bring back the previous bench
  // and then step back through its edits, none of which the user made to
  // this one. (Open in Bench and the other replacements made inside the
  // app do record a step.)
  const catalogueById = useMemo(() => (parts ? new Map(parts.map((p) => [p.id, p])) : null), [parts]);
  const restoreFromUrl = useCallback(
    (keepCurrent) => {
      try {
        const session = restoreBenchFromUrl(catalogueById);
        if (session) replaceBenchSession(session, { record: false });
        else if (!keepCurrent) {
          replaceBenchSession({ assembly: null, importedParts: new Map() }, { record: false });
        }
      } catch (err) {
        replaceBenchSession(
          {
            assembly: null,
            importedParts: new Map(),
            notice: `Couldn't restore the bench from this link: ${err.message}`,
          },
          { record: false },
        );
      }
      clearBenchHistory();
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
      // The restored tab may open a part picker of its own: never two
      // palettes at once.
      setPalette(null);
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
    ? [assembly.root.partId, ...assembly.nodes.map((n) => n.partId)]
        .filter((id) => importedParts.has(id))
        .join(",")
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
  // An undo step, named like the Bench's own ("Undo open in bench").
  function seedBench(part, params) {
    replaceBenchSession(
      { assembly: createAssembly(part.id, params), importedParts: new Map() },
      { label: "open in bench" },
    );
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

  // "/": the Library, its sidebar open, the search box focused with its
  // text selected to type over. From another mode, or with the sidebar
  // collapsed, the box only exists once the Library has rendered with it,
  // so keep looking for half a second.
  function jumpToLibrarySearch() {
    const switching = mode !== "library" || sidebarCollapsed;
    setMode("library");
    if (sidebarCollapsed) toggleSidebar();
    let tries = 0;
    const focus = () => {
      const box =
        !switching || tries > 0
          ? /** @type {HTMLInputElement | null} */ (document.querySelector(".sidebar .search-input"))
          : null;
      if (box) {
        box.focus();
        box.select();
      } else if (++tries < 30) {
        setTimeout(focus, 16);
      }
    };
    focus();
  }

  // Global shortcuts: 1/2/3 switch mode, s opens Settings, [ toggles the
  // sidebar, / jumps to the Library's part search, ? opens the shortcuts
  // sheet, Escape closes Settings or the sheet. Bench's own modals
  // (attach-a-part, STL import) and the Holes tab's import close on Escape
  // too, but that's handled locally in Bench.jsx / Holes.jsx — they own
  // that state, App doesn't need to reach into it.
  //
  // "/" and "?" share a key on a US layout; they are told apart by e.key,
  // which is the character typed ("?" with Shift, "/" without) on every
  // layout — a German one types "/" with Shift+7 and "?" with Shift+ß, and
  // e.key is still "/" and "?". hasCommandModifier() leaves Shift alone,
  // so both get here.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.repeat || hasCommandModifier(e)) return;
      if (e.key === "Escape") {
        if (settingsOpen) setSettingsOpen(false);
        if (shortcutsOpen) setShortcutsOpen(false);
        return;
      }
      // "?" again puts the sheet away, as in most apps with one. It comes
      // before the check below because that one ignores every key while a
      // dialog — this one — is open; but not from the sheet's search box,
      // where it is a character (ShortcutsModal takes its own "?" there
      // while the box is empty).
      if (e.key === "?" && shortcutsOpen && !isEditableTarget(e.target)) {
        e.preventDefault();
        setShortcutsOpen(false);
        return;
      }
      // Not while typing, and nothing from under an open dialog (Settings,
      // an attach-a-part picker): 1/2/3 would switch mode out from behind
      // it, unmounting the Bench mid-attach.
      if (ignoresShortcut(e)) return;
      switch (e.key) {
        case "1":
          setMode("library");
          break;
        case "2":
          switchToBench();
          break;
        case "3":
          setMode("holes");
          break;
        case "s":
          setSettingsOpen(true);
          break;
        case "[":
          toggleSidebar();
          break;
        case "/":
          jumpToLibrarySearch();
          break;
        case "?":
          setShortcutsOpen(true);
          break;
        default:
          return;
      }
      e.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // switchToBench() reads `mode` and `assembly`, jumpToLibrarySearch()
    // `sidebarCollapsed`, so the listener is re-bound with them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen, shortcutsOpen, mode, assembly, sidebarCollapsed]);

  // Each of these says whether it opened the part: false when the user
  // chose to keep what was there (an agent's tool reports it, webmcp.js).
  function openInBench(part, params) {
    if (assembly && !window.confirm(`Replace the current bench with a new one on ${part.name}?`))
      return false;
    seedBench(part, params);
    setMode("bench");
    return true;
  }

  // Library's "Add Holes": the selected part, with its current parameters,
  // as the Holes tab's base. Asks first only when there are holes to lose;
  // a base with none drilled yet is just replaced. An undo step, named
  // like the Holes tab's own ("Undo add holes").
  function openInHoles(part, params) {
    const current = getHolesSession().doc;
    if (
      current?.holes.length &&
      !window.confirm(`Replace the holes you've placed with a new start on ${part.name}?`)
    )
      return false;
    setHolesDoc(createHolesDoc({ kind: "catalogue", partId: part.id, params }), { label: "add holes" });
    setMode("holes");
    return true;
  }

  // Mod+K: the palette, or an empty tab's own part picker (the home
  // override, useCommandHome()). And how a command that opens a list of
  // its own (Grid step…) is run from outside the palette — a user hotkey.
  const openPalette = () => (commandRegistry.home() ?? (() => setPalette({ path: [] })))();
  usePaletteShortcut(() => setPalette({ path: [] }));
  useEffect(() => commandRegistry.setOpener((id) => setPalette({ path: [id] })), []);

  // A part in the Library — from the palette on another tab, where the
  // Library's own part commands aren't mounted, or a user's command with
  // parameters of its own. A mounted Library takes it as a pick in its
  // list (librarySession.js's requestLibrarySelection()); otherwise its
  // next mount starts on the part (initialSelection), and the switch is
  // an undo step in its history all the same.
  function showInLibrary(part, params = resolveParams(part, {})) {
    if (!requestLibrarySelection(part.id, params)) {
      const previous = librarySelection.current;
      if (previous)
        recordLibrary({ partId: previous.part.id, params: previous.params }, { label: "switch part" });
      librarySelection.current = { part, params };
    }
    setMode("library");
  }

  // A part, with parameters over its defaults, in a tab — a user's command
  // or an agent's (webmcp.js's open_part). False when the user chose to
  // keep the bench or holes it would replace.
  function openPart(part, params, target = "library") {
    const full = { ...resolveParams(part, {}), ...params };
    if (target === "bench") return openInBench(part, full);
    if (target === "holes") return openInHoles(part, full);
    showInLibrary(part, full);
    return true;
  }

  // A user's command for a bench preset: the Bench's own presets list does
  // the same, asking before it replaces a bench.
  function loadBenchPreset(name) {
    const preset = getBenchPreset(name);
    if (!preset) return report(`There is no bench preset called "${name}".`);
    if (assembly && !window.confirm(`Replace the current bench with the preset "${name}"?`)) return;
    try {
      loadBenchConfig(preset.config, catalogueById, "load preset");
    } catch (err) {
      return report(`Couldn't load the preset "${name}": ${err.message}`);
    }
    setMode("bench");
  }

  // A user's command for a hole type: on the Holes tab, its own command
  // (the selected holes, or the next ones); from elsewhere, the next holes'
  // type in the Holes document, which needs a model to belong to.
  function applyHolePreset(presetId) {
    if (mode === "holes" && commandRegistry.run(`holes.preset:${presetId}`)) return;
    const preset = getHolePreset(presetId);
    setMode("holes");
    if (!getHolesSession().doc) return report(`Pick a model in Holes first, then ${preset.name}.`);
    setHolesDoc((d) => setNextSpec(d, presetSpecFor(d.nextSpec, preset.spec), preset.id), {
      label: `pick ${preset.name}`,
    });
  }

  // The user's own commands (lib/userCommands.js): one runner per kind of
  // action, each the same path a button or the palette takes.
  useUserCommands({
    "open-part": ({ partId, params, target = "library" }) => {
      const part = catalogueById?.get(partId);
      if (!part) return report(`There is no part "${partId}" in the catalogue.`);
      openPart(part, params, target);
    },
    "bench-preset": ({ name }) => loadBenchPreset(name),
    "hole-preset": ({ presetId }) => applyHolePreset(presetId),
    link: ({ url }) => openLink(url),
    view: ({ mode: next }) => (next === "bench" ? switchToBench() : setMode(next)),
    command: ({ id }) => {
      if (!commandRegistry.run(id)) report(`"${id}" isn't something that can run here.`);
    },
  });

  // Settings > Coding agents' switch, copy buttons and New token…, in the
  // desktop app (components/McpSettings.jsx does the same in Settings).
  function mcpCommands() {
    const status = desktopMcp?.status;
    if (!desktopMcp || !status) return [];
    const ready = status.enabled && Boolean(status.token);
    return [
      builtin("app.mcp", {
        checked: status.enabled,
        subtitle: !status.enabled ? "Off" : status.listening ? "On" : "On, not connected",
        run: () => desktopMcp.setEnabled(!status.enabled),
      }),
      builtin("app.mcpSetup", {
        when: ready,
        actions: [
          {
            title: "Copy Claude Code command",
            run: () => copyText(claudeCodeCommand(status), "Claude Code command copied"),
          },
          { title: "Copy JSON config", run: () => copyText(mcpJsonConfig(status), "MCP config copied") },
        ],
      }),
      builtin("app.mcpNewToken", {
        when: ready,
        run: () => {
          if (
            window.confirm(
              "Make a new token? Coding agents set up with the old one can't connect until they have the new one.",
            )
          )
            desktopMcp.newToken();
        },
      }),
    ];
  }

  // The shell's commands: the tabs, Settings and its quick settings, help
  // and links, and — off the Library, which offers its own — every part.
  // Each tab and the viewer add their own while mounted.
  useCommands("app", () => {
    const detailDefault = globalDefaults?.CIRCLE_DETAIL ?? "normal";
    const detail = () => getGlobalOverrides().CIRCLE_DETAIL ?? detailDefault;
    const gridLabel = (mm) => (mm === 0 ? "Off" : `${mm} mm`);
    const benchFollows = getBenchFollowsLibrary();
    return [
      builtin("app.library", { when: mode !== "library", run: () => setMode("library") }),
      builtin("app.bench", { when: mode !== "bench", run: switchToBench }),
      builtin("app.holes", { when: mode !== "holes", run: () => setMode("holes") }),
      builtin("app.searchParts", { run: jumpToLibrarySearch }),
      builtin("app.sidebar", {
        title: sidebarCollapsed ? "Show the sidebar" : "Hide the sidebar",
        run: toggleSidebar,
      }),
      builtin("app.cancelRenders", { when: getRenderActivity() > 0, run: cancelRenders }),
      builtin("app.settings", { run: () => setSettingsOpen(true) }),
      builtin("app.grid", {
        subtitle: gridLabel(getGridSnap()),
        page: () => ({
          id: "grid",
          title: "Grid step",
          searchLabel: "Search grid steps",
          note: "What handle drags snap to, and how far lengths and hole nudges step.",
          items: () =>
            GRID_SNAP_OPTIONS.map((mm) => ({
              id: `app.grid:${mm}`,
              title: gridLabel(mm),
              section: "Grid step",
              checked: getGridSnap() === mm,
              actions: [{ title: "Use", run: () => setGridSnap(mm) }],
            })),
        }),
      }),
      builtin("app.circleDetail", {
        subtitle: capitalize(detail()),
        page: () => ({
          id: "circle-detail",
          title: "Circle detail",
          searchLabel: "Search circle details",
          note: "How smooth holes and curves come out. Draft renders faster, fine is rounder and slower.",
          items: () =>
            CIRCLE_DETAILS.map((value) => ({
              id: `app.circleDetail:${value}`,
              title: capitalize(value),
              section: "Circle detail",
              checked: detail() === value,
              actions: [{ title: "Use", run: () => setCircleDetail(value, detailDefault) }],
            })),
        }),
      }),
      builtin("app.benchFollowsLibrary", {
        checked: benchFollows,
        subtitle: benchFollows ? "On" : "Off",
        run: () => setBenchFollowsLibrary(!benchFollows),
      }),
      builtin("app.exportSettings", { run: () => report(downloadSettings()) }),
      builtin("app.importSettings", {
        actions: [
          {
            title: "Choose a file",
            file: {
              accept: `${SETTINGS_EXTENSION},.json,application/json`,
              onFile: async (file) => report(await importSettingsFile(file)),
            },
          },
        ],
      }),
      // The desktop app's switch for coding agents, as Settings has it.
      ...mcpCommands(),
      builtin("app.shortcuts", { run: () => setShortcutsOpen(true) }),
      // Links: Enter opens them, Mod+Enter copies them.
      builtin("app.guides", { actions: linkActions(GUIDES_URL) }),
      builtin("app.website", { actions: linkActions(SITE_URL) }),
      builtin("app.github", { actions: linkActions(REPO_URL) }),
      builtin("app.issue", { actions: linkActions(ISSUES_URL) }),
      builtin("app.layerling", { subtitle: "layerling.com", actions: linkActions(LAYERLING_URL) }),
      builtin("app.easyprint", { subtitle: "printables.com/slice", actions: linkActions(EASYPRINT_URL) }),
      // The desktop app knows where it came from.
      builtin("app.releases", {
        when: !document.documentElement.classList.contains("desktop"),
        actions: linkActions(RELEASES_URL),
      }),
      // After the rest: a guide ties with the command of its name ("bench"),
      // and a tie goes to the one listed first.
      ...guideCommands(),
      ...(mode === "library" || !parts
        ? []
        : listedParts(parts, getHiddenLibrary()).map((part) =>
            partCommand(part, {
              id: `part:${part.id}`,
              searchOnly: true,
              actions: [
                { title: "Show in the Library", run: () => showInLibrary(part) },
                { title: "Open in Bench", run: () => openInBench(part, resolveParams(part, {})) },
                { title: "Add holes", run: () => openInHoles(part, resolveParams(part, {})) },
              ],
            }),
          )),
    ];
  });

  // The same, for the browser's AI agent where it has WebMCP
  // (lib/webmcp.js): the palette's commands, and what the palette has no
  // rows for — parts with parameters, the state of each tab, a bench
  // config loaded whole (an undo step, as Import config… is).
  useWebMcp({
    registry: commandRegistry,
    parts,
    catalogueById,
    tab: mode,
    librarySelection: () => librarySelection.current,
    benchSession: getBenchSession,
    holesSession: getHolesSession,
    renders: getRenderActivity,
    openPart,
    loadBench: (doc) => {
      loadBenchConfig(doc, catalogueById, "load bench");
      setMode("bench");
    },
    mounted: tabBridge.get,
  });

  if (error) return <div className="error-screen">Failed to load catalogue: {error}</div>;
  if (!parts || !restored) return <div className="loading-screen">Loading catalogue&hellip;</div>;
  if (parts.length === 0) return <div className="error-screen">The catalogue is empty.</div>;

  return (
    <div className="shell">
      <nav className="mode-tabs" aria-label="Main">
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
        <button
          type="button"
          className={mode === "holes" ? "mode-tab active" : "mode-tab"}
          aria-current={mode === "holes" ? "page" : undefined}
          onClick={() => setMode("holes")}
          title="Holes (3)"
        >
          Holes<kbd className="shortcut-hint">3</kbd>
        </button>
        <div className="nav-end">
          <button
            type="button"
            className="mode-tab palette-tab"
            onClick={openPalette}
            aria-label="Command palette"
            aria-haspopup="dialog"
            title={`Command palette (${PALETTE_KEYS})`}
          >
            <SearchIcon />
            <span className="palette-label">Search</span>
            <kbd className="shortcut-hint">{PALETTE_KEYS}</kbd>
          </button>
          <RenderActivity />
          <UpdateNotice />
          <a
            className="mode-tab nav-link"
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="Source code and desktop apps on GitHub"
            aria-label="GitHub"
          >
            <GitHubMark />
          </a>
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
      <ShellBody>
        {/* Keyed by mode: a switch to another tab starts with a fresh
            boundary rather than the last mode's error. */}
        <ModeErrorBoundary key={mode} label={MODE_LABELS[mode]}>
          {mode === "library" ? (
            <Library
              parts={parts}
              onOpenInBench={openInBench}
              onAddHoles={openInHoles}
              onSelectionChange={onLibrarySelectionChange}
              initialSelection={librarySelection.current}
              sidebarCollapsed={sidebarCollapsed}
              onToggleSidebar={toggleSidebar}
              onFindPart={jumpToLibrarySearch}
            />
          ) : mode === "holes" ? (
            <Holes
              parts={parts}
              sidebarCollapsed={sidebarCollapsed}
              onToggleSidebar={toggleSidebar}
              librarySelection={librarySelection.current}
            />
          ) : (
            <Bench parts={parts} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar} />
          )}
        </ModeErrorBoundary>
      </ShellBody>
      {settingsOpen && (
        <SettingsModal
          parts={parts}
          globalDefaults={globalDefaults}
          onClose={() => setSettingsOpen(false)}
          onShowShortcuts={() => {
            setSettingsOpen(false);
            setShortcutsOpen(true);
          }}
        />
      )}
      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
      <CommandHud />
      {palette && (
        <CommandPaletteBoundary onError={() => setPalette(null)}>
          <CommandPalette
            page={ROOT_PAGE}
            initialPath={palette.path}
            closeOnRun
            onClose={() => setPalette(null)}
          />
        </CommandPaletteBoundary>
      )}
    </div>
  );
}

/** @param {string} text */
function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

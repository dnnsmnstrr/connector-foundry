import { useEffect, useRef, useSyncExternalStore } from "react";
import { commandRegistry } from "../lib/commands.js";
import { paletteShortcut } from "../lib/isEditableTarget.js";

// The React side of the command registry (lib/commands.js): how App, the
// tabs and the viewer offer commands, and how Mod+K reaches the palette.

/**
 * Offers `build()`'s commands while the calling component is mounted. The
 * latest `build` is kept in a ref and called only when an open palette
 * collects — never on a render — so its closures always see the
 * component's current state without the component paying for a list
 * nobody is looking at (Holes re-renders on every pointer move). Call it
 * before any early return, like every hook.
 * @param {string} source a name, for the warning when `build` throws
 * @param {() => (import("../lib/commands.js").Command | null | false | undefined)[]} build
 * @param {import("../lib/commands.js").CommandRegistry} [registry]
 */
export function useCommands(source, build, registry = commandRegistry) {
  const buildRef = useRef(build);
  buildRef.current = build;
  useEffect(() => registry.register(source, () => buildRef.current()), [registry, source]);
  // The component re-rendered: an open palette asks again (a selection
  // made, a render finished). Free while no palette is open.
  useEffect(() => {
    registry.touch();
  });
}

/**
 * While `open` is a function, Mod+K calls it instead of opening the global
 * palette: an empty Bench or Holes tab whose part picker Escape put away
 * brings that picker back, since a command list would only lead there.
 * @param {(() => void) | null} open
 * @param {import("../lib/commands.js").CommandRegistry} [registry]
 */
export function useCommandHome(open, registry = commandRegistry) {
  const openRef = useRef(open);
  openRef.current = open;
  const active = typeof open === "function";
  useEffect(() => {
    if (!active) return undefined;
    return registry.setHome(() => openRef.current?.());
  }, [active, registry]);
}

/**
 * While `target` is set, a file dropped on the global palette goes to it:
 * the Bench and Holes import a model with it. The latest `target` is read
 * at the drop, through a ref, so its closure is this render's.
 * @param {import("../lib/commands.js").CommandDrop | null} target
 * @param {import("../lib/commands.js").CommandRegistry} [registry]
 */
export function useCommandDrop(target, registry = commandRegistry) {
  const targetRef = useRef(target);
  targetRef.current = target;
  const active = Boolean(target);
  useEffect(() => {
    if (!active) return undefined;
    return registry.setDropTarget({
      get label() {
        return targetRef.current?.label ?? "";
      },
      onFile: (file) => targetRef.current?.onFile(file),
    });
  }, [active, registry]);
}

/**
 * Re-renders the caller when the registry changes (a source mounted or
 * unmounted, or re-rendered) — for the open palette.
 * @param {import("../lib/commands.js").CommandRegistry} [registry]
 */
export function useRegistryVersion(registry = commandRegistry) {
  return useSyncExternalStore(registry.subscribe, registry.version);
}

/**
 * Mod+K anywhere outside a dialog opens the palette — the home override
 * (useCommandHome()) when there is one, else `onOpen`. An open palette
 * closes itself on Mod+K (components/CommandPalette.jsx) and stops the
 * key there, so this listener never sees that one. Inside someone else's
 * dialog (Settings, an import) it does nothing: two modal dialogs at once
 * leave isBehindOpenDialog() looking at the wrong one. The browser's own
 * Ctrl+K (the address bar's search, off the Mac) is cancelled either way,
 * so the key never does two things.
 * @param {() => void} onOpen
 * @param {import("../lib/commands.js").CommandRegistry} [registry]
 */
export function usePaletteShortcut(onOpen, registry = commandRegistry) {
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  useEffect(() => {
    function onKeyDown(e) {
      if (!paletteShortcut(e)) return;
      // Taken already: a handle drag swallows every key (StlViewer).
      const taken = e.defaultPrevented;
      e.preventDefault();
      if (taken || e.repeat || document.querySelector("dialog[open]")) return;
      (registry.home() ?? onOpenRef.current)();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [registry]);
}

import { useEffect, useRef, useSyncExternalStore } from "react";
import { copyLink } from "../lib/commandCatalog.js";
import { commandRegistry } from "../lib/commands.js";
import { chordOf } from "../lib/hotkeys.js";
import { ignoresHotkey } from "../lib/isEditableTarget.js";
import { ACTION_KINDS, getUserCommands, subscribeUserCommands } from "../lib/userCommands.js";
import { useCommands } from "./useCommands.js";

/** @typedef {import("../lib/userCommands.js").UserAction} UserAction */

/**
 * The user's own commands (lib/userCommands.js) in the palette, under
 * "Your commands"; their aliases and hotkeys for built-in commands, put on
 * those as the registry collects them; and one window listener for all
 * the hotkeys, which runs the command as Enter in the palette would — so a
 * hotkey for a tab's command does nothing on another tab, where that
 * command isn't on offer. `runners` does each action kind (App.jsx, which
 * has the handlers): one per ACTION_KINDS entry.
 * @param {Record<keyof typeof ACTION_KINDS, (action: UserAction) => void>} runners
 * @param {import("../lib/commands.js").CommandRegistry} [registry]
 */
export function useUserCommands(runners, registry = commandRegistry) {
  const set = useSyncExternalStore(subscribeUserCommands, getUserCommands);
  const runnersRef = useRef(runners);
  runnersRef.current = runners;

  useEffect(() => {
    registry.setBindings(set.bindings);
  }, [set, registry]);

  useCommands(
    "user",
    () =>
      set.commands.map((command) => ({
        id: `user:${command.id}`,
        title: command.title,
        subtitle: command.subtitle ?? ACTION_KINDS[command.action.kind].describe(command.action),
        section: "Your commands",
        keywords: [command.action.kind],
        alias: command.alias,
        hotkey: command.hotkey,
        actions: [
          { title: "Run", run: () => runnersRef.current[command.action.kind]?.(command.action) },
          // A link can be copied too, as the built-in ones can.
          ...(command.action.kind === "link"
            ? [{ title: "Copy link", run: () => copyLink(command.action.url) }]
            : []),
        ],
      })),
    registry,
  );

  useEffect(() => {
    function onKeyDown(e) {
      const chord = chordOf(e);
      if (!chord || ignoresHotkey(e)) return;
      const { commands, bindings } = getUserCommands();
      const own = commands.find((c) => c.hotkey === chord);
      const id = own ? `user:${own.id}` : [...bindings].find(([, b]) => b.hotkey === chord)?.[0];
      if (!id) return;
      // The chord is the user's now, whether or not its command is on
      // offer here: the browser's own meaning for it is not what they want.
      e.preventDefault();
      registry.run(id);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [registry]);
}

// A line of feedback for a command that leaves nothing else to see — "Link
// copied" — shown for a moment after the palette has closed (App.jsx's
// CommandHud, a polite live region, so a screen reader hears it too). One
// at a time: a new one replaces the one showing and restarts its clock.

export const COMMAND_HUD_MS = 1800;

/** @type {{ text: string, id: number } | null} */
let hud = null;
let shown = 0;
let timer = null;
const listeners = new Set();

function emit() {
  for (const listener of listeners) listener();
}

/**
 * @param {string} text
 * @param {number} [ms] how long it stays
 */
export function showCommandHud(text, ms = COMMAND_HUD_MS) {
  clearTimeout(timer);
  shown += 1;
  hud = { text, id: shown };
  emit();
  timer = setTimeout(() => {
    hud = null;
    emit();
  }, ms);
}

/** The message showing now, or null. */
export function getCommandHud() {
  return hud;
}

/** For useSyncExternalStore. */
export function subscribeCommandHud(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

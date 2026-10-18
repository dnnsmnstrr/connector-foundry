// The command line card: a short session with `foundry`, typed out. The
// commands and their output are real (docs/CLI.md has them); the page
// only replays them.
import { onVisibility } from "../common.js";

const SESSION = [
  ["foundry render gridfinity/bin --gx 2 --magnets -o out/", "wrote out/gridfinity_bin.stl"],
  ["foundry defaults set gridfinity/bin --set gz=6", "gridfinity/bin: saved user default {'gz': 6}"],
  ["foundry render gridfinity/bin --gx 3 -o out/", "wrote out/gridfinity_bin.stl"],
];
const TYPE_MS = 28;
const OUTPUT_MS = 520;
const NEXT_MS = 900;
const RESTART_MS = 4200;

/**
 * @param {HTMLElement} root the terminal's container
 * @param {{ still: boolean }} options still: show the session, don't type it
 */
export function mountTerminal(root, { still }) {
  const body = /** @type {HTMLElement} */ (root.querySelector("[data-terminal]"));
  // The session is typed on `live`, over an unseen copy of all of it in
  // the same grid cell (landing.css), so the box is always as tall as the
  // whole session. When its height followed the text, it fed back through
  // onVisibility() below: with the terminal at the top of the window,
  // starting over shrank it under the visibility threshold, showing it all
  // grew it back over, and the Download section under it jumped between
  // the two heights every frame.
  const ghost = document.createElement("span");
  ghost.className = "terminal-ghost";
  ghost.setAttribute("aria-hidden", "true");
  const live = document.createElement("span");
  body.replaceChildren(ghost, live);
  body.classList.add("is-stacked");
  let timer = 0;
  let running = false;

  function line(command, output, typed = command.length) {
    const fragment = document.createDocumentFragment();
    const prompt = document.createElement("span");
    prompt.className = "terminal-prompt";
    prompt.textContent = "$";
    fragment.append(prompt, ` ${command.slice(0, typed)}`);
    if (output !== null) {
      const out = document.createElement("span");
      out.className = "terminal-dim";
      out.textContent = `\n${output}`;
      fragment.append(out);
    }
    return fragment;
  }

  function showAll(target = live) {
    target.replaceChildren();
    SESSION.forEach(([command, output], i) => {
      if (i) target.append("\n");
      target.append(line(command, output));
    });
  }

  function play(index = 0, typed = 0) {
    if (!running) return;
    live.replaceChildren();
    for (let i = 0; i < index; i++) live.append(line(SESSION[i][0], SESSION[i][1]), "\n");
    if (index >= SESSION.length) {
      timer = window.setTimeout(() => play(0, 0), RESTART_MS);
      return;
    }
    const [command] = SESSION[index];
    const done = typed >= command.length;
    live.append(line(command, null, typed));
    const cursor = document.createElement("span");
    cursor.className = "terminal-cursor";
    live.append(cursor);
    if (!done) {
      timer = window.setTimeout(() => play(index, typed + 1), TYPE_MS);
      return;
    }
    timer = window.setTimeout(() => {
      live.replaceChildren();
      for (let i = 0; i <= index; i++) live.append(line(SESSION[i][0], SESSION[i][1]), i < index ? "\n" : "");
      timer = window.setTimeout(() => play(index + 1, 0), NEXT_MS);
    }, OUTPUT_MS);
  }

  showAll(ghost);
  if (still) {
    showAll();
    return;
  }
  onVisibility(root, (visible) => {
    if (visible === running) return;
    running = visible;
    clearTimeout(timer);
    if (running) play(0, 0);
    else showAll();
  });
}

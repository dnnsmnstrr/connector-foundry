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

  function showAll() {
    body.replaceChildren();
    SESSION.forEach(([command, output], i) => {
      if (i) body.append("\n");
      body.append(line(command, output));
    });
  }

  function play(index = 0, typed = 0) {
    if (!running) return;
    body.replaceChildren();
    for (let i = 0; i < index; i++) body.append(line(SESSION[i][0], SESSION[i][1]), "\n");
    if (index >= SESSION.length) {
      timer = window.setTimeout(() => play(0, 0), RESTART_MS);
      return;
    }
    const [command] = SESSION[index];
    const done = typed >= command.length;
    body.append(line(command, null, typed));
    const cursor = document.createElement("span");
    cursor.className = "terminal-cursor";
    body.append(cursor);
    if (!done) {
      timer = window.setTimeout(() => play(index, typed + 1), TYPE_MS);
      return;
    }
    timer = window.setTimeout(() => {
      body.replaceChildren();
      for (let i = 0; i <= index; i++) body.append(line(SESSION[i][0], SESSION[i][1]), i < index ? "\n" : "");
      timer = window.setTimeout(() => play(index + 1, 0), NEXT_MS);
    }, OUTPUT_MS);
  }

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

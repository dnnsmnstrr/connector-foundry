// Fails a build whose output an engine at the app's floor (Safari/iOS
// 15.4, Chrome 93, Firefox 114, Samsung Internet 17; public/gate.js) could
// not parse. Run after `vite build` (package.json's postbuild), so the
// deploy, CI and the desktop builds all stop on it.
//
// Vite lowers syntax to its target but leaves what esbuild cannot lower,
// and the build pulls in code no source test sees: the dependencies, and
// what scripts/vite-plugin-*.mjs splice into chunks. Two checks over every
// emitted .js file:
// - regex lookbehind, `(?<=` / `(?<!`: Safari before 16.4. esbuild keeps
//   such a pattern as text, inside a `new RegExp("…")` when it lowers a
//   literal, so a text match finds it either way. It blanked the app on
//   iOS 15 and 16 until 2026-10 (tests/unit/no-lookbehind.test.js guards
//   the sources the same way).
// - a parse at ECMAScript 2022, ESLint's own parser (no new dependency):
//   anything newer — the regex v flag (Safari 17), syntax from 2023 on —
//   fails it. 2022 itself is not entirely at the floor (class static
//   blocks are Safari 16.4), but the build target lowers those.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Linter } from "eslint";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (entry.endsWith(".js")) yield full;
  }
}

/**
 * The problems in one built file, as messages.
 * @param {string} text the file's source
 * @param {"module" | "script"} sourceType
 * @param {Linter} [linter]
 * @returns {string[]}
 */
export function compatProblems(text, sourceType, linter = new Linter()) {
  const problems = [];
  const lookbehind = text.search(/\(\?<[=!]/);
  if (lookbehind !== -1)
    problems.push(`regex lookbehind (Safari before 16.4): …${text.slice(lookbehind - 20, lookbehind + 20)}…`);
  const parsed = linter.verify(text, [{ languageOptions: { ecmaVersion: 2022, sourceType } }]);
  for (const message of parsed.filter((m) => m.fatal)) {
    problems.push(`not ECMAScript 2022 at ${message.line}:${message.column}: ${message.message}`);
  }
  return problems;
}

// Run as a script: check dist/. The chunks under assets/ are modules; the
// files at the root (gate.js, sw.js) are classic scripts.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const linter = new Linter();
  let failed = 0;
  for (const file of files(DIST)) {
    const rel = path.relative(DIST, file);
    const sourceType = rel.startsWith(`assets${path.sep}`) ? "module" : "script";
    for (const problem of compatProblems(readFileSync(file, "utf8"), sourceType, linter)) {
      console.error(`check-dist-compat: ${rel}: ${problem}`);
      failed++;
    }
  }
  if (failed) {
    console.error(`check-dist-compat: ${failed} problem(s); the app would not load at its browser floor.`);
    process.exit(1);
  }
}

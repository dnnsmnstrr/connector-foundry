import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  {
    // Build output and generated files; everything here is in .gitignore too.
    ignores: [
      "dist/",
      "node_modules/",
      "public/",
      "release/",
      "desktop/generated/",
      "test-results/",
      "playwright-report/",
    ],
  },
  js.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  reactHooks.configs.flat.recommended,
  {
    settings: { react: { version: "detect" } },
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    rules: {
      // Plain .jsx without TypeScript or the prop-types package: the
      // components document their props in comments and the call sites.
      "react/prop-types": "off",
      // An apostrophe in JSX text ("Couldn't") reads better than &apos;.
      "react/no-unescaped-entities": "off",
      // eslint-plugin-react-hooks 7 ships the React Compiler's rules in
      // "recommended". The app does not use the compiler, and the code
      // leans on the patterns they forbid on purpose: a ref written
      // during render to hold the latest callback (DecimalInput, Holes),
      // and setState at the top of an effect to reset derived state when
      // its input changes (Bench, Holes, Library, StlViewer). The
      // memoization and immutability rules only matter when the compiler
      // is what memoizes. rules-of-hooks and exhaustive-deps stay on.
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/immutability": "off",
    },
  },
  // Browser code: the app itself.
  {
    files: ["src/**/*.{js,jsx}"],
    ignores: ["src/worker/**"],
    languageOptions: { globals: globals.browser },
  },
  // Web Workers: self, postMessage, importScripts, but no window or document.
  {
    files: ["src/worker/**/*.js"],
    languageOptions: { globals: globals.worker },
  },
  // Node: build scripts, the Electron main process, and the tests.
  {
    files: ["scripts/**", "desktop/**", "tests/**", "*.config.js", "eslint.config.js"],
    languageOptions: { globals: globals.node },
  },
  // Playwright specs (and the Electron test, and the benchmark) run in
  // Node but hand page.evaluate() callbacks to the browser, where window
  // and document exist.
  {
    files: ["tests/browser/**", "tests/desktop/**", "scripts/benchmark-runtime.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
  },
  prettier,
];

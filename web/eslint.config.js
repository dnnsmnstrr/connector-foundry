import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  {
    // Build output and generated files; everything here is in .gitignore
    // too, but for public/gate.js, which is linted below.
    ignores: [
      "dist/",
      "node_modules/",
      "public/**/*",
      "!public/gate.js",
      "release/",
      "desktop/generated/",
      "docs/",
      "test-results/",
      "playwright-report/",
      // The store apps' native projects (Capacitor), which hold a copy of
      // dist/ after `cap sync`.
      "ios/",
      "android/",
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

      // Bug-catching rules beyond "recommended". Each one had no or only
      // a handful of violations when it was switched on, so a new one
      // is a new mistake, not old style.
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": ["error", { destructuring: "all" }],
      "no-unused-vars": ["error", { args: "after-used", caughtErrors: "all", ignoreRestSiblings: true }],
      "array-callback-return": "error",
      "no-self-compare": "error",
      "no-unmodified-loop-condition": "error",
      "no-promise-executor-return": "error",
      "no-throw-literal": "error",
      "prefer-promise-reject-errors": "error",
      "no-implicit-coercion": ["error", { allow: ["!!"] }],
      // A <button> inside a <form> submits it by default (NameBenchModal,
      // PresetsPanel), so every button says which kind it is.
      "react/button-has-type": "error",
    },
  },
  // `__PUBLIC_VERSIONS__` is a build-time constant (scripts/vite-plugin-sw.mjs)
  // that the app and the worker both read, `__BUILD_ID__` one only the app
  // does; src/build-id.d.ts types them.
  // Browser code: the app itself.
  {
    files: ["src/**/*.{js,jsx}"],
    ignores: ["src/worker/**", "src/sw.js"],
    languageOptions: {
      globals: { ...globals.browser, __PUBLIC_VERSIONS__: "readonly", __BUILD_ID__: "readonly" },
    },
    // Debug logging does not ship; console.warn/error are how the app
    // reports a recoverable problem (bad localStorage, a failed render).
    rules: { "no-console": ["error", { allow: ["warn", "error"] }] },
  },
  // Web Workers: self, postMessage, importScripts, but no window or document.
  {
    files: ["src/worker/**/*.js"],
    languageOptions: { globals: { ...globals.worker, __PUBLIC_VERSIONS__: "readonly" } },
  },
  // The unsupported-browser gate: it has to parse on the engines it turns
  // away, so it is held to ES5 (a trailing comma in a call, ES2017, once
  // slipped in), and Prettier leaves it alone (.prettierignore), since it
  // would add such commas back.
  {
    files: ["public/gate.js"],
    languageOptions: { ecmaVersion: 5, sourceType: "script", globals: globals.browser },
    // ES5 has no let or const, and a catch clause must name its error.
    rules: { "no-var": "off", "prefer-const": "off", "no-unused-vars": ["error", { caughtErrors: "none" }] },
  },
  // The service worker: a classic script (no imports) with caches, clients
  // and registration on top of the worker globals.
  {
    files: ["src/sw.js"],
    languageOptions: { sourceType: "script", globals: globals.serviceworker },
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

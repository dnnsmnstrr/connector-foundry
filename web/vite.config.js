import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import openscadWasmMemoPlugin from "./scripts/vite-plugin-openscad-wasm-memo.mjs";
import scadWatchPlugin from "./scripts/vite-plugin-scad-watch.mjs";

export default defineConfig({
  base: process.env.GITHUB_PAGES ? "/connector-foundry/" : "/",
  plugins: [react(), scadWatchPlugin(), openscadWasmMemoPlugin()],
  worker: {
    format: "es",
    // Build-time worker bundling is a separate Rollup pass with its own
    // plugin list; `plugins` above only reaches the worker in dev.
    plugins: () => [openscadWasmMemoPlugin()],
  },
  optimizeDeps: {
    exclude: ["openscad-wasm"],
    // Only the STEP worker imports it, and only once someone imports a
    // STEP file — left to be discovered then, the dev server would
    // pre-bundle it mid-import and reload the page, losing the upload.
    include: ["occt-import-js"],
  },
  build: {
    chunkSizeWarningLimit: 20000,
  },
});

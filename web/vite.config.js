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
  },
  build: {
    chunkSizeWarningLimit: 20000,
  },
});

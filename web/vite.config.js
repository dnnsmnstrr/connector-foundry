import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import scadWatchPlugin from "./scripts/vite-plugin-scad-watch.mjs";

export default defineConfig({
  base: process.env.GITHUB_PAGES ? "/connector-foundry/" : "/",
  plugins: [react(), scadWatchPlugin()],
  worker: {
    format: "es",
  },
  optimizeDeps: {
    exclude: ["openscad-wasm"],
  },
  build: {
    chunkSizeWarningLimit: 20000,
  },
});

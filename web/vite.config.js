import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.GITHUB_PAGES ? "/connector-foundry/" : "/",
  plugins: [react()],
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

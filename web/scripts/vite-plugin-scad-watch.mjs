// Dev-only: Vite's watcher only covers the project root (`web/`) by
// default, but the .scad sources live one level up in the main repo
// (lib/, parts/, assemblies/, vendor/BOSL2/, catalogue.yaml). This
// plugin adds those paths to the watcher explicitly, re-bundles
// scad-bundle.json/catalogue.yaml on any change, and full-reloads the
// page so the worker refetches the new bundle — the same thing
// restarting `npm run dev` would do, without the restart.
import path from "node:path";
import { REPO_ROOT, SOURCE_DIRS, syncScad } from "./sync-scad.mjs";

const WATCH_DIRS = SOURCE_DIRS.map((dir) => path.join(REPO_ROOT, dir) + path.sep);
const CATALOGUE_SRC = path.join(REPO_ROOT, "catalogue.yaml");
const WATCH_PATHS = [...SOURCE_DIRS.map((dir) => path.join(REPO_ROOT, dir)), CATALOGUE_SRC];

// Only react to the *source* files (repo root), never to the generated
// copies this same plugin writes into web/public/ — those live inside
// Vite's default project-root watch scope too, so without this check a
// resync would re-trigger itself forever.
function isWatchedSource(file) {
  if (file === CATALOGUE_SRC) return true;
  return WATCH_DIRS.some((dir) => file.startsWith(dir)) && file.endsWith(".scad");
}

export default function scadWatchPlugin() {
  let debounceTimer = null;

  return {
    name: "scad-watch",
    apply: "serve",
    configureServer(server) {
      server.watcher.add(WATCH_PATHS);

      const onChange = (file) => {
        if (!isWatchedSource(file)) return;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const count = syncScad();
          server.config.logger.info(`[scad-watch] resynced ${count} .scad files (${path.relative(REPO_ROOT, file)} changed)`, {
            timestamp: true,
          });
          server.ws.send({ type: "full-reload" });
        }, 150);
      };

      server.watcher.on("change", onChange);
      server.watcher.on("add", onChange);
      server.watcher.on("unlink", onChange);
    },
  };
}

## What and why

<!-- What changed, and the reason. Link the issue if there is one. -->

## How it was checked

- [ ] `make check` (ruff, non-rendering pytest, ESLint, type check, Prettier, unit tests)
- [ ] `make test` / `make verify` — if a `.scad` file or `catalogue.yaml` changed
- [ ] `cd web && npm run test:browser` — if web UI behaviour changed
- [ ] Tried in the browser app — if a part or generated `.scad` changed (the WASM build has limits the native one does not; see AGENTS.md)

## Docs

- [ ] `CHANGELOG.md` Unreleased, for a user-visible change
- [ ] `web/README.md` module table / `docs/*.md` / `catalogue.yaml` header, if they describe what changed

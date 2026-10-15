# Working on Connector Foundry

Read this before changing anything. It is the map: what the pieces are, which command proves a
change, and the rules that are easy to break without noticing. The detail lives in the documents
it points to. (`CLAUDE.md` imports this file, so Claude Code and other agents read the same text.)

## What the pieces are

One set of OpenSCAD sources, three consumers:

```
catalogue.yaml ──┬─> cli/foundry.py ──> openscad (native, Manifold backend) ──> STL / PNG
 (what exists,   ├─> tests/*.py      ──> renders every catalogue entry and probes it
  its defaults)  └─> web/scripts/sync-scad.mjs ──> web/public/{scad-bundle,catalogue}.json
                                                      └─> web app: openscad-wasm in a Worker
lib/*.scad ──── shared conventions (slots, joints, constants), included by parts/
parts/<system>/*.scad ── one file per part; thin wrappers around vendor/ where an upstream exists
vendor/ ─────── upstream libraries as git submodules (BOSL2, gridfinity-rebuilt, ...). Never edit.
references.yaml + tools/ ── `make verify`: compare parts against other people's models
web/ ────────── React app (Library, Bench, Holes tabs) + Electron wrapper (web/desktop/)
```

- `catalogue.yaml` is the single source of truth for what parts exist. Its header documents every
  field; `tests/test_catalogue_schema.py` rejects unknown keys and wrong types.
- The web app never reimplements geometry. It generates small `.scad` stubs (or whole assemblies,
  `web/src/lib/assembly.js`) and compiles them with the same sources the CLI uses.
- Where the web app needs to know a geometric fact without rendering (slot positions, mount
  offsets), it mirrors the `.scad` logic in `web/src/lib/` and a Python test holds the two
  together. Change both sides or neither.

Deeper reading, by topic:

| Topic | Document |
| --- | --- |
| Parts, slot convention, catalogue table, licensing | `README.md` |
| Web app internals, module-by-module table, the WASM limits | `web/README.md` |
| Joints, Bench, Holes, overrides, accuracy checks | `docs/JOINTS.md`, `docs/BENCH.md`, `docs/HOLES.md`, `docs/OVERRIDES.md`, `docs/ACCURACY.md` |
| Desktop packaging | `docs/MACOS.md`, `docs/WINDOWS.md` |
| Deferred work | `docs/IMPROVEMENTS.md` |
| What changed | `CHANGELOG.md` (add user-visible changes under **Unreleased**) |

## Setup

```bash
git submodule update --init --recursive    # vendor/ — nothing renders without it
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
cd web && npm ci                           # Node >= 22.12 (see web/package.json engines)
```

Rendering natively needs an **OpenSCAD dev snapshot** (the stable release has no Manifold
backend): put it on `PATH` as `openscad` or point `OPENSCAD_BIN` at it. Without one, only the
tests that do not render can run (`tests/test_catalogue*.py`). A fresh git worktree has empty
`vendor/` directories: run the submodule command there too, or the web build bundles no BOSL2
and the one real-WASM browser test fails for a reason that looks like a code regression.

## Proving a change

Run the narrowest check that covers the change while working, and `make check` before calling
it done. CI (`.github/workflows/ci.yml`) runs all of the rows below.

| Command | What it covers | Needs |
| --- | --- | --- |
| `make check` | ruff, the non-rendering pytest files, and `npm run check` (ESLint, `tsc` type check, Prettier, unit tests) | nothing extra — **the minimum before every commit** |
| `make lint` / `make format` | Python lint + format (ruff, config in `pyproject.toml`) | — |
| `cd web && npm run lint` / `typecheck` / `format` / `test` | the parts of `npm run check` one at a time | — |
| `make test` | the full pytest suite: renders every catalogue entry and variant (~4 min) | OpenSCAD snapshot |
| `make verify` | reference comparisons and fit checks (`make refs` fetches the references first) | OpenSCAD, network once |
| `cd web && npm run test:browser` | Playwright against the built app (its `pretest` builds; don't call bare `playwright test`, it reuses a stale bundle) | Playwright's Chromium |
| `cd web && npm run test:desktop` | Electron smoke test against `dist/` (build first) | — |

Which ones to add on top of `make check`:

- Changed a `.scad` file or `catalogue.yaml`: `make test` (or at least the affected part's tests,
  `pytest tests -k <part>`), and `make verify` for an `exact` part. A recorded bounding box that
  moved on purpose: `make goldens`.
- Changed web UI behaviour: `npm run test:browser`. A new test that clicks an export button must
  name the bench first (the name prompt opens otherwise and `waitForEvent("download")` times out).
- Changed `web/desktop/` or anything the packaged app loads: `npm run test:desktop`.

## Rules that are easy to break

**Generated OpenSCAD source.** Every value or name that ends up in generated `.scad` goes through
`web/src/lib/scadLiteral.js` (`scadLiteral`, `callArgs`, `defineArgs`) — on the CLI side,
`openscad_value()` in `cli/foundry.py`. Never interpolate a string into source with a template
literal: part names, anchor names and parameter keys come from config files and shared URLs that
anyone can write. Non-finite numbers must throw, not be emitted.

**The browser's OpenSCAD is not the native one.** `openscad-wasm` 0.0.4 runs out of stack about
70 nested module levels deep (each `attach()`, joint flange or BOSL2 attachable adds levels),
still runs `hull()` through CGAL (which asserts on some BOSL2 rounded cuboids), and can run
`callMain` once per instance. A part that renders natively can fail in the browser. Details and
the measured numbers: `web/README.md`, "Known limit — nesting depth", and the worker's header.

**Mirrored logic.** `web/src/lib/slots.js` mirrors `lib/slots.scad`; `scadLiteral.js` mirrors
`openscad_value()`; `mount_offset` is evaluated in both `cli/foundry.py` and `slots.js`. Python
tests render the geometry and check the formulas; when you change one side, change the other.

**Catalogue fields have two readers.** The CLI (PyYAML) and the web build (js-yaml) parse
`catalogue.yaml`. A new field must be documented in the file's header, added to the schema test's
allowed keys, and handled by both readers (or explicitly only one, with a comment saying so).
Quote strings like `yes`, `on`, `1e3`: the two parsers read them differently.

**Persisted and shared state is untrusted.** localStorage, sessionStorage, the URL hash
(`#bench=`), imported `.bench.json` / `.settings.json` files: validate the shape *and* the values
(finite numbers, string names, known keys) before use, and keep the app working when storage
throws (private mode, quota). `benchConfig.js`'s `checkBenchConfig` is the pattern.

**Keyboard shortcuts** go through the shared guard in `web/src/lib/isEditableTarget.js`: no
single-key shortcut fires while typing in a field, while a dialog the event did not come from is
open, or with a modifier key held.

**React conventions.** Plain JSX, no TypeScript; components document their props in a comment.
Async work in an effect (renders, imports) must ignore stale results, because a slow render
finishing after the user moved on is the common bug here. A preview render goes through
`web/src/hooks/useRender.js`, which does that (and the debounce and cancellation) for every mode;
other async work needs its own guard — a flag the effect's cleanup clears, or an `AbortSignal`. Dispose what three.js allocates. `web/eslint.config.js` switches off
four React-Compiler rules on purpose and says why; don't "fix" those patterns.

**`vendor/` is upstream.** Don't edit it; wrap or re-express in `lib/` (see `lib/opengrid.scad`
and `lib/ogthread.scad` for how and why). Mind each upstream's licence: README "Licensing".

## Recipes

**Add a part.** Write `parts/<system>/<name>.scad` following the slot convention (functional face
down, a `"mount"` anchor on TOP; see an existing part of the same system). Add its entry to
`catalogue.yaml` (fields: the file's header). Then `make check`, `pytest tests -k <system>`,
`make goldens` for its recorded dimensions (review the diff: only the new part should move),
its gallery image with `foundry.render_preview()` from a Python one-liner (`foundry preview --all`
re-renders every image, and a different OpenSCAD build changes all their bytes), and
`foundry readme` for the README table. If it is `exact`, add its check to `references.yaml` and
run `make verify`. The web app picks it up from the catalogue; try it there for the WASM limits.

**Add a web lib module.** Pure logic goes in `web/src/lib/` with no React in it, gets a
`web/tests/unit/<name>.test.js` (Node's test runner; three.js resolves because the test lives
under `web/`), JSDoc on its exports, and a row in `web/README.md`'s module table. It is type
checked automatically (`web/jsconfig.json` includes `src/lib`).

**Add a catalogue field, a Holes preset, a joint, a setting.** Find the closest existing one with
`grep`, follow every place it appears (YAML header, CLI, `sync-scad`, web lib, tests, docs), and
do the same for the new one. `docs/HOLES.md` and `docs/JOINTS.md` list what exists.

## Conventions

- **Comments say why**, in full sentences: the constraint, the measured number, the bug the line
  prevents. The code says what. Keep that density in new code.
- **Formatting is automatic**: Prettier for `web/` (110 columns), ruff for Python (110 columns).
  Markdown is formatted by hand.
- **Commit messages**: a short `area: what changed` subject (`web:`, `Holes tab:`, `CI:`,
  `catalogue:` …) and a body that says why. One logical change per commit.
- **Docs move with the code**: a user-visible change gets a line under `CHANGELOG.md`'s
  Unreleased; a new module gets its row in `web/README.md`; a new field, preset or joint gets
  its entry in the matching `docs/` page.
- **Releasing**: bump `web/package.json` and `pyproject.toml`, add the CHANGELOG section, run the
  `desktop.yml` workflow on `main` and wait for it to pass (the Windows desktop tests run nowhere
  else before a tag), then push the `v<version>` tag.

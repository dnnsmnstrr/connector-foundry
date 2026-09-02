"""User-level persisted overrides: a layer between catalogue.yaml's
committed defaults and a single render's --set flags.

Stored as OpenSCAD Customizer JSON (fileFormatVersion + parameterSets)
rather than an invented format — the plan's own section 6 already
pointed at this as the way to make parameter sets data instead of CLI
flags, and it means a saved file also opens correctly as a parameter
set in the OpenSCAD GUI. One file per part under the user config dir,
holding a single reserved preset named "user-default"; a reserved
pseudo part id, "__global__", holds cross-part settings (currently
just FIT_CLEARANCE) under the same mechanism, since a printer-level
override is the same kind of persisted preference as a per-part one —
just not scoped to one part's module parameters.

Resolution order everywhere in this codebase (CLI and the web
Bench/Library alike):

    catalogue default -> user override -> this-render/this-instance value

This must never leak into a test run: every render the test suite
does passes use_user_config=False explicitly (tests/conftest.py), and
render_part()'s own default is False for the same reason — a saved
override on one developer's machine would otherwise make
test_dimensions fail confusingly there and pass in CI, which is
exactly the class of bug this file exists to avoid.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

PRESET_NAME = "user-default"
GLOBAL_ID = "__global__"


def config_dir() -> Path:
    base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return base / "connector-foundry"


def _override_path(part_id: str) -> Path:
    return config_dir() / "overrides" / f"{part_id.replace('/', '_')}.json"


def _read(part_id: str) -> dict:
    """The saved preset, or {} for a missing, unreadable, or malformed
    file — a hand-edited config that no longer parses should degrade to
    "no overrides", never take `foundry render` down with a traceback."""
    path = _override_path(part_id)
    if not path.exists():
        return {}
    try:
        doc = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return {}
    if not isinstance(doc, dict):
        return {}
    sets = doc.get("parameterSets")
    preset = sets.get(PRESET_NAME) if isinstance(sets, dict) else None
    return preset if isinstance(preset, dict) else {}


def _write(part_id: str, params: dict) -> None:
    """Write via a sibling temp file and an atomic replace, so a crash
    mid-write leaves the previous config intact rather than a truncated
    file that _read() would then silently treat as empty."""
    path = _override_path(part_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = {"parameterSets": {PRESET_NAME: params}, "fileFormatVersion": "1"}
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, indent=2) + "\n")
    os.replace(tmp, path)


def get_overrides(part_id: str) -> dict:
    """Saved user overrides for one part id — {} if none saved."""
    return _read(part_id)


def update_overrides(part_id: str, params: dict) -> dict:
    """Merge params into whatever's already saved; returns the result."""
    merged = {**_read(part_id), **params}
    _write(part_id, merged)
    return merged


def clear_overrides(part_id: str, keys: list[str] | None = None) -> None:
    """Clear one part's saved overrides — all of them, or just `keys`."""
    path = _override_path(part_id)
    if keys is None:
        path.unlink(missing_ok=True)
        return
    remaining = {k: v for k, v in _read(part_id).items() if k not in keys}
    if remaining:
        _write(part_id, remaining)
    else:
        path.unlink(missing_ok=True)


def overridden_part_ids(catalogue: dict) -> list[str]:
    """Every catalogue part id with a saved override file."""
    return [p["id"] for p in catalogue["parts"] if _override_path(p["id"]).exists()]


def get_global_overrides() -> dict:
    return _read(GLOBAL_ID)


def update_global_overrides(params: dict) -> dict:
    return update_overrides(GLOBAL_ID, params)


def clear_global_overrides(keys: list[str] | None = None) -> None:
    clear_overrides(GLOBAL_ID, keys)

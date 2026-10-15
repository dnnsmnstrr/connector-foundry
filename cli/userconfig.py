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


class ConfigError(ValueError):
    """A saved config file exists but cannot be parsed, so writing over
    it would throw away whatever the user had hand-edited into it."""


def config_dir() -> Path:
    # `or`, not a get() default: the XDG spec says an empty
    # XDG_CONFIG_HOME means unset, and Path("") would otherwise turn the
    # config into a directory relative to wherever foundry was run from.
    base = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    return base / "connector-foundry"


def _override_path(part_id: str) -> Path:
    # "/" becomes "__", which no catalogue id contains (ids are
    # lower-case words joined by single "_" or "-"), so the mapping is
    # injective: the old single-"_" form sent both "a/b_c" and "a_b/c"
    # to a_b_c.json, and saving one part's defaults silently became the
    # other's.
    return config_dir() / "overrides" / f"{part_id.replace('/', '__')}.json"


def _legacy_override_path(part_id: str) -> Path:
    """Where files were saved before the "__" separator. Still read (and
    removed once the part is written again) so an upgrade keeps
    everyone's saved defaults."""
    return config_dir() / "overrides" / f"{part_id.replace('/', '_')}.json"


def _existing_path(part_id: str) -> Path | None:
    for path in (_override_path(part_id), _legacy_override_path(part_id)):
        if path.exists():
            return path
    return None


def _parse(path: Path) -> dict | None:
    """The preset in `path`, or None when the file does not parse into
    the expected shape."""
    try:
        doc = json.loads(path.read_text())
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return None
    if not isinstance(doc, dict):
        return None
    sets = doc.get("parameterSets")
    if sets is None:
        return {}
    if not isinstance(sets, dict):
        return None
    preset = sets.get(PRESET_NAME, {})
    return preset if isinstance(preset, dict) else None


def _read(part_id: str) -> dict:
    """The saved preset, or {} for a missing, unreadable, or malformed
    file — a hand-edited config that no longer parses should degrade to
    "no overrides", never take `foundry render` down with a traceback."""
    path = _existing_path(part_id)
    if path is None:
        return {}
    return _parse(path) or {}


def _read_for_update(part_id: str) -> dict:
    """Like _read(), but a file that exists and does not parse is an
    error rather than {}: the caller is about to write, and merging into
    {} would replace the hand-edited file with just the new keys."""
    path = _existing_path(part_id)
    if path is None:
        return {}
    preset = _parse(path)
    if preset is None:
        raise ConfigError(
            f"{path} exists but is not a valid OpenSCAD Customizer parameter file; "
            "fix or delete it before saving new values (it was left untouched)"
        )
    return preset


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
    legacy = _legacy_override_path(part_id)
    if legacy != path:
        legacy.unlink(missing_ok=True)


def get_overrides(part_id: str) -> dict:
    """Saved user overrides for one part id — {} if none saved."""
    return _read(part_id)


def update_overrides(part_id: str, params: dict) -> dict:
    """Merge params into whatever's already saved; returns the result."""
    merged = {**_read_for_update(part_id), **params}
    _write(part_id, merged)
    return merged


def clear_overrides(part_id: str, keys: list[str] | None = None) -> None:
    """Clear one part's saved overrides — all of them, or just `keys`."""
    paths = (_override_path(part_id), _legacy_override_path(part_id))
    if keys is None:
        for path in paths:
            path.unlink(missing_ok=True)
        return
    remaining = {k: v for k, v in _read_for_update(part_id).items() if k not in keys}
    if remaining:
        _write(part_id, remaining)
    else:
        for path in paths:
            path.unlink(missing_ok=True)


def overridden_part_ids(catalogue: dict) -> list[str]:
    """Every catalogue part id with a saved override file."""
    return [p["id"] for p in catalogue["parts"] if _existing_path(p["id"]) is not None]


def get_global_overrides() -> dict:
    return _read(GLOBAL_ID)


def update_global_overrides(params: dict) -> dict:
    return update_overrides(GLOBAL_ID, params)


def clear_global_overrides(keys: list[str] | None = None) -> None:
    clear_overrides(GLOBAL_ID, keys)

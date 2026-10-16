"""Shared fixtures. `cli/` and `tools/` are on the import path via
pyproject.toml's [tool.pytest.ini_options] pythonpath, so test modules
import `foundry`, `refcache` and `verify` directly."""

import hashlib
import math
from pathlib import Path

import foundry
import pytest


@pytest.fixture(scope="session")
def catalogue() -> dict:
    return foundry.load_catalogue()


@pytest.fixture(scope="session")
def render_dir(tmp_path_factory) -> Path:
    return tmp_path_factory.mktemp("renders")


# (part id, params) -> rendered STL. OpenSCAD is essentially the whole
# cost of this suite, and several files ask for the very same render:
# test_dimensions and test_manifold both want every catalogue case,
# test_slots wants each grid part at defaults again. One render per
# distinct request, for the session, instead of one per test.
_RENDERED: dict[tuple, Path] = {}


def _render_key(part: dict, params: dict) -> tuple:
    # Raw("TOP") and "TOP" are different OpenSCAD values (a bare name vs
    # a string literal) that a plain str() would conflate, so the type
    # is part of the key.
    return (part["id"], tuple(sorted((k, type(v).__name__, str(v)) for k, v in params.items())))


def render_variant(part: dict, params: dict, render_dir: Path, tag: str) -> Path:
    """Render `part` with `params` (memoised per session) and return the STL.

    use_user_config=False is render_part()'s own default too, but stated
    explicitly here on purpose: every test render must reflect true
    catalogue.yaml defaults regardless of that default ever changing, or
    a saved `foundry defaults`/`foundry settings` on whoever's machine
    runs this would make test_dimensions fail confusingly here and pass
    in CI. See cli/userconfig.py.

    `tag` only names the file the first time a given (part, params) is
    asked for; a later request with a different tag gets the same path.
    The filename also carries a hash of the key: two different param
    sets that happened to share a tag would otherwise be renamed onto
    the same file, and the first one's mesh would quietly be replaced
    by the second's under a still-cached path.
    """
    key = _render_key(part, params)
    cached = _RENDERED.get(key)
    if cached is not None and cached.exists():
        return cached
    out_dir = render_dir / foundry.slug(part["id"])
    stl_path = foundry.render_part(part, params, out_dir, use_user_config=False)
    digest = hashlib.sha256(repr(key).encode()).hexdigest()[:10]
    renamed = stl_path.rename(out_dir / f"{tag}-{digest}.stl")
    _RENDERED[key] = renamed
    return renamed


def resize_applies(part: dict, entry: dict, params: dict) -> bool:
    """Whether a `resize` entry has a handle on the part with `params`
    (over its defaults): every `when` value matches, compared the way
    resize.js's `===` does — Python's `1 == True` would match a value
    the web app never matches."""
    merged = {**part.get("defaults", {}), **params}
    return all(_same_value(merged.get(k), v) for k, v in entry.get("when", {}).items())


def _same_value(a, b) -> bool:
    return isinstance(a, bool) == isinstance(b, bool) and type(a) in (bool, int, float, str) and a == b


def _positive(value) -> float | None:
    return value if _is_number(value) and value > 0 else None


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def resize_bounds(part: dict, entry: dict) -> tuple[float, float]:
    """The range a `resize` entry's handle keeps its parameter in, resolved
    exactly as web/src/lib/resize.js's resizeAxes() does — a mirrored pair
    (AGENTS.md): change both or neither. Up from the larger of the
    catalogue minimum and the entry's own `min`, or else (also when that
    is 0 or below, which no part renders) from one `step`, or else from
    0.1mm of outside size; up to the smaller of the catalogue maximum and
    the entry's `max`, or unbounded. A ceiling under the floor is raised
    to it, so crossed bounds come back as an empty range (low == high),
    which test_catalogue.py reports."""
    param = entry["param"]
    per = _positive(entry.get("per")) or 1
    step = _positive(entry.get("step"))
    floor = step if step is not None else 0.1 / per
    lows = [v for v in (part.get("minimums", {}).get(param), entry.get("min")) if _is_number(v)]
    highs = [v for v in (part.get("maximums", {}).get(param), entry.get("max")) if _is_number(v)]
    low = max(lows) if lows else floor
    if not low > 0:
        low = floor
    return low, max(low, min(highs) if highs else math.inf)

"""Shared fixtures. `cli/` and `tools/` are on the import path via
pyproject.toml's [tool.pytest.ini_options] pythonpath, so test modules
import `foundry`, `refcache` and `verify` directly."""
from pathlib import Path

import pytest

import foundry


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
    """
    key = _render_key(part, params)
    cached = _RENDERED.get(key)
    if cached is not None and cached.exists():
        return cached
    out_dir = render_dir / foundry.slug(part["id"])
    stl_path = foundry.render_part(part, params, out_dir, use_user_config=False)
    renamed = stl_path.rename(out_dir / f"{tag}.stl")
    _RENDERED[key] = renamed
    return renamed

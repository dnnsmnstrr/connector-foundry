import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "cli"))

import foundry  # noqa: E402


@pytest.fixture(scope="session")
def catalogue() -> dict:
    return foundry.load_catalogue()


@pytest.fixture(scope="session")
def render_dir(tmp_path_factory) -> Path:
    return tmp_path_factory.mktemp("renders")


def render_variant(part: dict, params: dict, render_dir: Path, tag: str) -> Path:
    out_dir = render_dir / part["id"].replace("/", "_")
    stl_path = foundry.render_part(part, params, out_dir)
    renamed = out_dir / f"{tag}.stl"
    stl_path.rename(renamed)
    return renamed

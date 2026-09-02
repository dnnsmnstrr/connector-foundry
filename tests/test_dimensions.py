"""Recorded bounding box and volume per catalogue entry.

This is a change detector, not a correctness claim. It catches a part
moving when nobody meant to move it — and it is worth being clear that a
wrong part has a perfectly stable bounding box, so passing here says
nothing about whether a part fits anything. That question belongs to
references.yaml and tests/test_reference.py.

Regenerate after an intended change:  foundry goldens --update
"""
import sys
from pathlib import Path

import pytest
import trimesh
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "cli"))
import foundry  # noqa: E402

from conftest import render_variant  # noqa: E402

BBOX_TOL_MM = 0.05
VOLUME_TOL_PCT = 0.5

GOLDEN = yaml.safe_load(foundry.GOLDEN_PATH.read_text()) if foundry.GOLDEN_PATH.exists() else {}


def cases():
    catalogue = foundry.load_catalogue()
    return [(part, params, tag) for part, params, tag in foundry.catalogue_cases(catalogue)]


def test_every_catalogue_entry_is_recorded():
    """A part with no recorded dimensions is a part nothing is watching."""
    missing = [f"{part['id']} [{tag}]" for part, _, tag in cases()
               if tag not in GOLDEN.get(part["id"], {})]
    assert not missing, (
        "no recorded dimensions for: " + ", ".join(missing)
        + " — run `foundry goldens --update`")


@pytest.mark.parametrize("part,params,tag", cases(),
                         ids=lambda v: v if isinstance(v, str) else "")
def test_recorded_dimensions(part, params, tag, render_dir):
    expected = GOLDEN.get(part["id"], {}).get(tag)
    if expected is None:
        pytest.skip("not recorded; covered by test_every_catalogue_entry_is_recorded")

    mesh = trimesh.load(render_variant(part, params, render_dir, f"golden-{tag}"))

    for axis, (actual, want) in enumerate(zip(mesh.extents, expected["bbox"])):
        assert actual == pytest.approx(want, abs=BBOX_TOL_MM), (
            f"{part['id']} [{tag}] bbox {list(mesh.extents)} != recorded "
            f"{expected['bbox']} on axis {'xyz'[axis]}")

    assert mesh.volume == pytest.approx(expected["volume_mm3"], rel=VOLUME_TOL_PCT / 100), (
        f"{part['id']} [{tag}] volume {mesh.volume:.2f} != recorded "
        f"{expected['volume_mm3']}")

"""Every catalogue entry, and each declared variant, must render to one
sound solid.

A note on what is NOT asserted here. trimesh's `is_watertight` is not
used: OpenSCAD's Manifold backend already guarantees a closed solid or
fails the render outright (which `foundry.run_openscad` raises on), and
its STL export writes zero-area triangle flaps at some seams plus
coincident duplicate vertices that trimesh will not stitch back
together. Those artifacts make watertight-by-mesh-inspection report
false on parts that are provably closed, which is a test that fails for
reasons no one can act on.

What is worth asserting is the thing OpenSCAD will happily let through:
geometry that renders fine but arrives as several disconnected lumps —
a part that falls apart on the build plate.
"""
import sys
from pathlib import Path

import pytest
import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "cli"))
import foundry  # noqa: E402

from conftest import render_variant  # noqa: E402

# Below this a "body" is an export artifact, not geometry.
MIN_BODY_AREA_MM2 = 1e-6


def cases():
    return list(foundry.catalogue_cases(foundry.load_catalogue()))


@pytest.mark.parametrize("part,params,tag", cases(),
                         ids=lambda v: v if isinstance(v, str) else "")
def test_part_is_a_single_sound_solid(part, params, tag, render_dir):
    mesh = trimesh.load(render_variant(part, params, render_dir, tag))

    assert mesh.is_winding_consistent, f"{part['id']} [{tag}] has inconsistent winding"
    assert mesh.volume > 0, f"{part['id']} [{tag}] has non-positive volume"

    bodies = [b for b in mesh.split(only_watertight=False)
              if b.area > MIN_BODY_AREA_MM2]
    assert len(bodies) == 1, (
        f"{part['id']} [{tag}] rendered {len(bodies)} disconnected bodies "
        f"(areas {sorted(round(b.area, 2) for b in bodies)}), expected 1 — "
        f"this part would print as separate pieces")

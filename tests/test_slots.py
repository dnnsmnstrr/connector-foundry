"""catalogue.yaml's `slots.pitch` has to match the real spacing between
mount_<i>_<j> anchors lib/slots.scad's grid_mount_anchors() generates —
the web editor enumerates slot positions from that number alone (plus a
rendered bounding box), never by parsing .scad or running OpenSCAD, so a
declared pitch that drifted from the geometry would silently misplace
every snap in the editor.

Indices run -(n-1)/2 .. (n-1)/2, so they're integers for an odd count
(Gridfinity's derived grid) but half-integers for an even one (openGrid:
count_params is the cell count directly, and the default 2x2 has no
center cell) — a test that assumed integer names would just be wrong for
half of the catalogue, so every anchor name here is derived from the
part's own (nx, ny), never hardcoded.

Reuses test_anchors.py's technique: anchoring a render to a named anchor
moves that anchor to the origin, so the offset between two such renders
is exactly the real-world distance between the two anchors. And BOSL2
hard-fails a render that anchors to an unknown name (attachments.scad:
`assert(found!=[], str("\nUnknown anchor: ",anchor))`), so the declared
grid's edge can be checked precisely: the outermost declared slot must
render, and one step further out must not.
"""
import math

import pytest
import trimesh

import foundry
from conftest import render_variant

TOL_MM = 0.01


def _slotted_parts():
    return [p for p in foundry.load_catalogue()["parts"] if "slots" in p]


def _grid_counts(part, render_dir):
    """(nx, ny) the same way the web editor would compute it: exactly
    the named params for a feature-locked grid (e.g. openGrid's cells),
    or nearest-odd from the rendered footprint / pitch otherwise."""
    slots = part["slots"]
    if "count_params" in slots:
        nx_param, ny_param = slots["count_params"]
        defaults = part["defaults"]
        return defaults[nx_param], defaults[ny_param]

    # The same default render test_manifold/test_dimensions already
    # asked for — a cache hit, not a third render of the part.
    mesh = trimesh.load(render_variant(part, {}, render_dir, "default"))
    size_x, size_y, _ = mesh.extents
    pitch = slots["pitch"]
    nx = max(1, 2 * math.floor(size_x / pitch / 2) + 1)
    ny = max(1, 2 * math.floor(size_y / pitch / 2) + 1)
    return nx, ny


def _corner(part, anchor_name, render_dir):
    stl = render_variant(part, {"anchor": anchor_name}, render_dir, f"anchor-{anchor_name}")
    mesh = trimesh.load(stl)
    return mesh.bounds[0]  # rigid translation between renders -> any fixed point works


@pytest.mark.parametrize("part", _slotted_parts(), ids=lambda p: p["id"])
def test_declared_pitch_matches_the_geometry(part, render_dir):
    pitch = part["slots"]["pitch"]
    nx, ny = _grid_counts(part, render_dir)

    i0, j0 = -(nx - 1) / 2, -(ny - 1) / 2  # the grid's first index on each axis
    origin_name = f"mount_{i0:g}_{j0:g}"
    x_neighbor_name = f"mount_{i0 + 1:g}_{j0:g}"
    y_neighbor_name = f"mount_{i0:g}_{j0 + 1:g}"

    origin = _corner(part, origin_name, render_dir)
    x_neighbor = _corner(part, x_neighbor_name, render_dir)
    y_neighbor = _corner(part, y_neighbor_name, render_dir)

    assert abs(x_neighbor[0] - origin[0]) == pytest.approx(pitch, abs=TOL_MM), (
        f"{part['id']}: {origin_name} to {x_neighbor_name} is "
        f"{abs(x_neighbor[0] - origin[0]):.3f}mm apart on X, "
        f"catalogue.yaml declares slots.pitch={pitch}"
    )
    assert abs(y_neighbor[1] - origin[1]) == pytest.approx(pitch, abs=TOL_MM), (
        f"{part['id']}: {origin_name} to {y_neighbor_name} is "
        f"{abs(y_neighbor[1] - origin[1]):.3f}mm apart on Y, "
        f"catalogue.yaml declares slots.pitch={pitch}"
    )


@pytest.mark.parametrize("part", _slotted_parts(), ids=lambda p: p["id"])
def test_grid_edge_matches_the_declared_count(part, render_dir):
    nx, ny = _grid_counts(part, render_dir)

    last_i, j0 = (nx - 1) / 2, -(ny - 1) / 2
    edge_name = f"mount_{last_i:g}_{j0:g}"
    beyond_name = f"mount_{last_i + 1:g}_{j0:g}"

    render_variant(part, {"anchor": edge_name}, render_dir, f"anchor-{edge_name}")  # must exist

    with pytest.raises(foundry.OpenSCADError):
        render_variant(part, {"anchor": beyond_name}, render_dir, f"anchor-{beyond_name}")

"""Every part's attachable() envelope must match the solid inside it.

BOSL2 anchors are computed from the `size` a part declares, not from the
geometry it actually emits. Declare a size that is too big, too small, or
off-centre and every anchor on the part is wrong by that much — silently.
Nothing about the part looks broken: it renders, it is watertight, its
bounding box is stable, and it lands in the wrong place the moment
anyone attaches anything to it.

So: render each part anchored to each of its six faces and check that
face lands exactly on the origin. This is what catches the class of bug
where a wrapper inherits an upstream module that centres itself on
something other than its own bounding box.
"""
import pytest
import trimesh

import foundry
from conftest import render_variant

TOL_MM = 0.001
# mount_offset is written to 3 decimals in catalogue.yaml.
OFFSET_TOL_MM = 0.005

# anchor name -> (axis, which bound must be zero)
FACES = {
    "BOTTOM": (2, 0), "TOP": (2, 1),
    "LEFT": (0, 0), "RIGHT": (0, 1),
    "FWD": (1, 0), "BACK": (1, 1),
}


def _parts():
    return foundry.load_catalogue()["parts"]


@pytest.mark.parametrize("part", _parts(), ids=lambda p: p["id"])
def test_named_anchors_sit_where_the_catalogue_says(part, render_dir):
    """The web editor never asks OpenSCAD where "mount" and "bot" are: it
    places them at the center of the top/bottom face of the rendered
    bounding box, shifted by the catalogue's `mount_offset` (default
    none). A part whose module puts them anywhere else — a DeckMate part
    puts both at its screw pattern's reference point — declares that
    offset, and this is what holds the declaration to the geometry.

    Anchoring a render to a named anchor moves that anchor to the origin
    without rotating (same technique as test_slots.py), so the bounding
    box center lands at minus the anchor's local position, and the face
    the anchor is on lands at z=0.
    """
    ox, oy = part.get("mount_offset", [0, 0])
    names = ["mount"] + (["bot"] if "bot" in part.get("anchors", []) else [])
    for name in names:
        mesh = trimesh.load(render_variant(part, {"anchor": name}, render_dir, f"anchor-{name}"))
        center = (mesh.bounds[0] + mesh.bounds[1]) / 2
        assert center[0] == pytest.approx(-ox, abs=OFFSET_TOL_MM) and center[1] == pytest.approx(-oy, abs=OFFSET_TOL_MM), (
            f"{part['id']} anchored {name!r}: the anchor sits at ({-center[0]:.3f}, {-center[1]:.3f}) from "
            f"the bounding-box center, but the catalogue says mount_offset={[ox, oy]} — the web editor "
            f"would draw its marker in the wrong place")
        face_z = mesh.bounds[1][2] if name == "mount" else mesh.bounds[0][2]
        assert face_z == pytest.approx(0.0, abs=TOL_MM), (
            f"{part['id']} anchored {name!r}: expected that anchor on the "
            f"{'top' if name == 'mount' else 'bottom'} face, but the face sits at z={face_z:.4f}")


@pytest.mark.parametrize("part", _parts(), ids=lambda p: p["id"])
def test_face_anchors_land_on_the_origin(part, render_dir):
    for name, (axis, side) in FACES.items():
        stl = render_variant(part, {"anchor": foundry.Raw(name)}, render_dir, f"anchor-{name}")
        mesh = trimesh.load(stl)

        actual = mesh.bounds[side][axis]
        assert actual == pytest.approx(0.0, abs=TOL_MM), (
            f"{part['id']} anchored {name}: that face sits at "
            f"{actual:.4f}mm, not 0. The declared attachable() size does "
            f"not match the geometry, so every anchor on this part is off."
        )

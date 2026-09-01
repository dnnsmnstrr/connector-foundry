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
import sys
from pathlib import Path

import pytest
import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "cli"))
import foundry  # noqa: E402

TOL_MM = 0.001

# anchor name -> (axis, which bound must be zero)
FACES = {
    "BOTTOM": (2, 0), "TOP": (2, 1),
    "LEFT": (0, 0), "RIGHT": (0, 1),
    "FWD": (1, 0), "BACK": (1, 1),
}


def _parts():
    return foundry.load_catalogue()["parts"]


@pytest.mark.parametrize("part", _parts(), ids=lambda p: p["id"])
def test_face_anchors_land_on_the_origin(part, render_dir):
    out_dir = render_dir / "anchors" / part["id"].replace("/", "_")
    for name, (axis, side) in FACES.items():
        stl = foundry.render_part(part, {"anchor": foundry.Raw(name)}, out_dir)
        mesh = trimesh.load(stl)
        stl.rename(out_dir / f"{name}.stl")

        actual = mesh.bounds[side][axis]
        assert actual == pytest.approx(0.0, abs=TOL_MM), (
            f"{part['id']} anchored {name}: that face sits at "
            f"{actual:.4f}mm, not 0. The declared attachable() size does "
            f"not match the geometry, so every anchor on this part is off."
        )


def test_option_lists_agree_with_defaults_and_variants():
    """`options` in the catalogue drives the web app's dropdowns and the
    CLI's validation, so it has to stay in step with the values the
    catalogue itself uses. A list that has drifted from its default is
    worse than no list: it offers a menu that excludes what you get."""
    problems = []
    for part in _parts():
        options = part.get("options", {})
        defaults = part.get("defaults", {})
        for key, allowed in options.items():
            if key not in defaults:
                problems.append(f"{part['id']}: options list {key!r}, which has no default")
            elif defaults[key] not in allowed:
                problems.append(
                    f"{part['id']}: default {key}={defaults[key]!r} is not in {allowed}")
        for variant in part.get("variants", []):
            for key, value in variant["params"].items():
                if key in options and value not in options[key]:
                    problems.append(
                        f"{part['id']} [{variant['name']}]: {key}={value!r} "
                        f"is not in {options[key]}")
    assert not problems, "\n".join(problems)

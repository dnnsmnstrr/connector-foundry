"""The catalogue's `resize` slopes, held to the geometry.

The web app's resize handles never work a part's size out from its
parameters. A drag shows a ghost: the box measured off the current mesh,
grown by `per` mm for every unit the parameter moves — half on each side
in X and Y, since every part is centred there, and upward in Z, its
bottom staying on z = 0. The one render on release has to land on that
ghost, or the part jumps when the mesh arrives and the handle's numbers
were wrong all along. So each entry is rendered at the catalogue defaults
and one step on (one `step`, or 1mm of outside size for a free length),
and the second mesh's bounding box is held to the ghost built from the
first. Every variant the entry applies to that sets an option gets the
same pair: an entry holds for all of them, and their options (a bin
without its lip, flat HSW edges, a heavy openGrid board) are where a
slope would quietly change. Where the handle's lower bound is not the default, the pair is
rendered from there too: the low end is where slopes stop holding (an
HSW wall's second column hangs half a cell lower, so 1 -> 2 columns grows
Y as well), and an entry that fails there needs a `min`.

A diameter (an `xy` entry) gets one allowance on top. The mesh is a
polygon whose side count changes with the diameter, so on an axis with
no vertex its box stops short of the circle by up to _facet_gap(), and
by a different amount at the next size: the ghost, grown from the last
box, can be off by that much.
"""

import math

import foundry
import pytest
import trimesh
from conftest import render_variant, resize_applies, resize_bounds

# test_dimensions' BBOX_TOL_MM: the same meshes, the same float32 noise.
GHOST_TOL_MM = 0.05

# The box axes each kind of entry grows on both sides of the centre.
SIDEWAYS = {"x": [0], "y": [1], "xy": [0, 1], "z": []}


def _facet_gap(dia: float) -> float:
    """How far inside a circle of `dia` OpenSCAD's polygon of it can stop
    on an axis with no vertex on it: r(1 - cos(180°/n)) for n fragments.
    n is OpenSCAD's own count at the repository's default detail ($fa 12,
    $fs 2 — lib/constants.scad's DETAIL_FA/DETAIL_FS at CIRCLE_DETAIL
    "normal", which every test render uses; BOSL2's segs() is the same
    formula). A post at dia 11 is 18-sided and 0.08mm short of the circle
    in Y on each side, while at dia 10 it is 16-sided and exact."""
    r = dia / 2
    n = max(5, math.ceil(min(360 / 12, r * 2 * math.pi / 2)))
    return r * (1 - math.cos(math.pi / n))


def _cases() -> list:
    cases = []
    for part in foundry.load_catalogue()["parts"]:
        defaults = part.get("defaults", {})
        for axis, entry in part.get("resize", {}).items():
            param = entry["param"]
            # Only the `when` values the defaults do not have already: the
            # plain-defaults start is then `{}`, and a variant's start its
            # own params, the very requests test_dimensions and
            # test_manifold make, so conftest's memo renders each once.
            start = {k: v for k, v in entry.get("when", {}).items() if defaults.get(k) != v}
            cases.append(pytest.param(part, axis, start, id=f"{part['id']}-{axis}"))
            low, _ = resize_bounds(part, entry)
            if low != defaults[param]:
                cases.append(
                    pytest.param(part, axis, {**start, param: low}, id=f"{part['id']}-{axis}-from-{low}")
                )
            # A variant that only sets sizes the handles drive (Skådis 3x6) is
            # another point on the same lines; one that sets an option is
            # where a slope could change, and is worth its render.
            sizes = {e["param"] for e in part["resize"].values()}
            for variant in part.get("variants", []):
                if set(variant["params"]) <= sizes:
                    continue
                if resize_applies(part, entry, variant["params"]):
                    cases.append(
                        pytest.param(
                            part, axis, variant["params"], id=f"{part['id']}-{axis}-{variant['name']}"
                        )
                    )
    return cases


@pytest.mark.parametrize(("part", "axis", "start"), _cases())
def test_one_step_lands_on_the_ghost(part, axis, start, render_dir):
    entry = part["resize"][axis]
    param, per = entry["param"], entry.get("per", 1)
    value = start.get(param, part["defaults"][param])
    # One step up, or down for a value already at the handle's ceiling,
    # where the handle could not go up either.
    delta = entry.get("step", 1 / per)
    if value + delta > resize_bounds(part, entry)[1]:
        delta = -delta
    stepped = {**start, param: value + delta}

    before = trimesh.load(render_variant(part, start, render_dir, f"resize-{axis}")).bounds
    after = trimesh.load(render_variant(part, stepped, render_dir, f"resize-{axis}-step")).bounds

    grow = per * delta
    ghost = before.copy()
    for i in SIDEWAYS[axis]:
        ghost[0][i] -= grow / 2
        ghost[1][i] += grow / 2
    if axis == "z":
        ghost[1][2] += grow

    for i, name in enumerate("xyz"):
        tol = GHOST_TOL_MM
        if axis == "xy" and i in SIDEWAYS[axis]:
            tol += max(_facet_gap(value), _facet_gap(stepped[param]))
        for end, label in ((0, "min"), (1, "max")):
            assert after[end][i] == pytest.approx(ghost[end][i], abs=tol), (
                f"{part['id']} {param} {value} -> {stepped[param]}: {label}.{name} is "
                f"{after[end][i]:.3f}, the ghost says {ghost[end][i]:.3f} "
                f"(box {before.tolist()} -> {after.tolist()})"
            )

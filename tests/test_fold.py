"""A part's `fold` entry must say where its head really is.

The Bench's Fold for printing (web/src/lib/benchFold.js) cuts a whole
assembly just in front of an openConnect head's flat front edge, and
lays the head's half on its side. It never asks OpenSCAD where that
edge is: it reads the cut from the catalogue's `fold.cut_y`, in the
part's own centred frame, and which way along the part's z the rest of
it runs from the head from `fold.toward`. A cut that is off by a
fraction of a millimetre either slices a sliver off the head's front
or leaves a ledge of the body in front of it; one with `toward` the
wrong way round puts the hinge on the head. So for every value of the
parameter the entry names, render the part centred and check that the
head — the 2.5 mm at the end `toward` points away from — starts
FOLD_EPS past the cut, and that the far end, where the body is, reaches
past it.
"""

import foundry
import pytest
import trimesh
from conftest import render_variant

# lib/constants.scad's FOLD_EPS: how far in front of the head the cut runs.
FOLD_EPS = 0.005
# Less than the head's 2.6 mm, so the band holds nothing but head.
HEAD_BAND_MM = 2.5
TOL_MM = 0.002


def _cases():
    return [
        (part, value)
        for part in foundry.load_catalogue()["parts"]
        if "fold" in part
        for value in part["fold"]["cut_y"]
    ]


@pytest.mark.parametrize("part,value", _cases(), ids=lambda v: v if isinstance(v, str) else v["id"])
def test_fold_cut_runs_just_in_front_of_the_head(part, value, render_dir):
    fold = part["fold"]
    params = {fold["param"]: value, "anchor": foundry.Raw("CENTER")}
    mesh = trimesh.load(render_variant(part, params, render_dir, f"fold-{value}"))
    cut, toward = fold["cut_y"][value], fold["toward"][value]
    z = mesh.vertices[:, 2]
    head_end, body_end = (z.max(), z.min()) if toward < 0 else (z.min(), z.max())
    head = mesh.vertices[abs(z - head_end) <= HEAD_BAND_MM]
    assert head[:, 1].min() == pytest.approx(cut + FOLD_EPS, abs=TOL_MM), (
        f"{part['id']} [{value}]: the head's front edge is at y={head[:, 1].min():.4f}, but fold.cut_y says "
        f"{cut} — the Bench would cut {'into the head' if head[:, 1].min() < cut else 'short of it'}"
    )
    body = mesh.vertices[abs(z - body_end) <= HEAD_BAND_MM]
    if value != "none":
        # The snap or thread reaches past the cut: that is what folds over.
        assert body[:, 1].min() < cut, (
            f"{part['id']} [{value}]: nothing on the far side of the cut at its body end"
        )

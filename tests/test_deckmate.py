"""The DeckMate screw pattern, held to Mechanism's own meshes.

lib/constants.scad's DM_SCREW_HOLES was measured from two of Mechanism's
models (the Outie's base and the Universal plate); the parts' "mount"/
"bot" anchors and lib/joints.scad's deckmate_screw_flange() are all built
from it. Two things can go wrong, and both are silent in a render:

- the numbers drift from the files (a re-export from Mechanism, a typo),
  so a generated flange's bores miss the part's holes — checked by
  probing each rendered mesh for empty space exactly where the pattern
  says a hole is, and for material right next to it;
- the attach() chain mirrors the pattern. It is symmetric in x but not
  y, so it survives BOSL2's flips only because they are all 180° about
  Y (see the comment above DM_SCREW_HOLES). That is a reading of BOSL2's
  source, not something to take on faith: every joint shape the web
  editor's codegen can emit for the "screwed" joint is rendered here and
  probed on both sides of the seam at the same (x, y).
"""
import math
import re
from pathlib import Path

import pytest
import trimesh

import foundry
from conftest import render_variant

REPO_ROOT = foundry.REPO_ROOT
CONSTANTS_SRC = foundry.CONSTANTS_PATH.read_text()
JOINTS_SRC = (REPO_ROOT / "lib" / "joints.scad").read_text()


def _const(name: str, source: str = CONSTANTS_SRC) -> float:
    m = re.search(rf"^{name}\s*=\s*(-?[0-9.]+)", source, re.MULTILINE)
    assert m, f"{name} not found"
    return float(m.group(1))


SPAN = _const("DM_SCREW_SPAN")
DROP = _const("DM_SCREW_DROP")
OUTIE_PATTERN_Y = _const("DM_OUTIE_PATTERN_Y")
UNIVERSAL_PATTERN_Y = _const("DM_UNIVERSAL_PATTERN_Y")
FLANGE_T = _const("JOINT_FLANGE_T", JOINTS_SRC)

# Relative to the pattern's reference point (the "mount"/"bot"/"seat"
# anchor of every part and flange that carries it).
HOLES = [(SPAN / 2, 0.0), (-SPAN / 2, 0.0), (0.0, -DROP)]
CENTROID = (0.0, -DROP / 3)

# How far from a hole's centre the "there is material here" probe sits.
# The Outie's base is a hollow shell (~2.7mm walls, bosses around the
# holes), so a probe out in the middle of the pattern lands in air; every
# hole on both parts and the flange has solid wall out to at least 3mm
# from its centre, and the bores themselves are under 2.4mm in radius.
BESIDE_R = 2.6

PATTERNED_PARTS = ["deckmate/outie", "deckmate/universal"]


def _part(part_id: str) -> dict:
    return foundry.find_part(foundry.load_catalogue(), part_id)


def _inside(mesh, x, y, z) -> bool:
    return bool(mesh.contains([[x, y, z]])[0])


def _beside(x, y):
    """A point BESIDE_R from the hole's centre, stepping toward the
    pattern's centroid — inside the boss wall on every part that carries
    the pattern, so a passing hole probe is a hole, not empty air."""
    dx, dy = CENTROID[0] - x, CENTROID[1] - y
    d = math.hypot(dx, dy)
    return (x + dx / d * BESIDE_R, y + dy / d * BESIDE_R)


def _assert_pattern(mesh, label, origin_xy, z):
    """Every hole empty and its neighbour solid, at height z, with the
    pattern reference at `origin_xy`."""
    ox, oy = origin_xy
    for hx, hy in HOLES:
        x, y = ox + hx, oy + hy
        assert not _inside(mesh, x, y, z), (
            f"{label}: expected a hole at ({x:.3f}, {y:.3f}, z={z}) but found material — "
            f"the pattern is not where DM_SCREW_HOLES says")
        bx, by = _beside(hx, hy)
        assert _inside(mesh, ox + bx, oy + by, z), (
            f"{label}: expected material beside the hole at ({ox + bx:.3f}, {oy + by:.3f}, z={z}) — "
            f"the probe is not even inside the part")


@pytest.mark.parametrize("part_id", PATTERNED_PARTS)
def test_holes_sit_at_the_declared_pattern(part_id, render_dir):
    """Anchored at "mount" the reference point is at the origin and the
    part hangs below z=0, so each hole is a vertical line through
    DM_SCREW_HOLES; probe 1mm into the part from the mount face."""
    mesh = trimesh.load(render_variant(_part(part_id), {"anchor": "mount"}, render_dir, "anchor-mount"))
    _assert_pattern(mesh, part_id, (0.0, 0.0), z=-1.0)


# Each screwed-joint shape web/src/lib/assembly.js's emitScrewedChild()
# can emit, as a hand-written chain, with where the pattern reference and
# the two bodies end up when the root is anchored BOTTOM at the origin:
#   (source, pattern reference xy, probe z in the parent-side body, probe z in the child-side body)
CHAINS = {
    # flange fused to a plain parent, Outie screws onto its "seat": flange z 0..4, Outie hangs below
    "flange-then-outie": (
        'deckmate_screw_flange() attach("seat", "mount") deckmate_outie();',
        (0.0, OUTIE_PATTERN_Y), FLANGE_T / 2, -1.0),
    # Outie is the parent (root, rail down): its base face is on top; the flange's "seat" sits on it
    "outie-then-flange": (
        'deckmate_outie() attach("mount", "seat") deckmate_screw_flange();',
        (0.0, OUTIE_PATTERN_Y), 7.7 - 1.0, 7.7 + FLANGE_T / 2),
    # both carry the pattern: Universal's pattern face is its BOTTOM ("bot"), Outie stacks on it directly
    "universal-then-outie": (
        'deckmate_universal() attach("bot", "mount") deckmate_outie();',
        (0.0, UNIVERSAL_PATTERN_Y), 1.5, -1.0),
}


@pytest.mark.parametrize("name", sorted(CHAINS))
def test_screwed_joint_lines_the_holes_up(name, render_dir):
    source, ref_xy, z_parent, z_child = CHAINS[name]
    out_dir = render_dir / "deckmate"
    out_dir.mkdir(parents=True, exist_ok=True)
    stub = out_dir / f"{name}.scad"
    stub.write_text(
        f"include <{REPO_ROOT / 'lib' / 'joints.scad'}>\n"
        f"include <{REPO_ROOT / 'parts' / 'deckmate' / 'outie.scad'}>\n"
        f"include <{REPO_ROOT / 'parts' / 'deckmate' / 'universal.scad'}>\n"
        f"{source}\n")
    out = out_dir / f"{name}.stl"
    foundry.run_openscad(stub, out, {})
    mesh = trimesh.load(out)

    _assert_pattern(mesh, f"{name} (parent side)", ref_xy, z_parent)
    _assert_pattern(mesh, f"{name} (child side)", ref_xy, z_child)


# Where the fill_holes probes sit below the mount face: just inside it,
# and near the far end of the SHALLOWEST hole (the third, 6.0mm — see
# outie.scad's DM_OUTIE_HOLE_DEPTHS), so a plug that stops short shows.
FILL_PROBE_Z = (-1.0, -5.5)


def test_fill_holes_plugs_every_hole(render_dir):
    """fill_holes=true (an Outie fused onto something, holes unused) puts
    material exactly where the pattern says each hole is, top to bottom,
    without moving the part's footprint — and the default still leaves the
    holes open, so the "screwed" joint keeps working."""
    part = _part("deckmate/outie")
    filled = trimesh.load(render_variant(part, {"fill_holes": True, "anchor": "mount"}, render_dir, "filled-mount"))
    plain = trimesh.load(render_variant(part, {"anchor": "mount"}, render_dir, "anchor-mount"))
    for hx, hy in HOLES:
        for z in FILL_PROBE_Z:
            assert _inside(filled, hx, hy, z), (
                f"fill_holes: hole at ({hx:.3f}, {hy:.3f}) is still open at z={z}")
            assert not _inside(plain, hx, hy, z), (
                f"default: expected an open hole at ({hx:.3f}, {hy:.3f}, z={z})")
    assert filled.is_watertight, "fill_holes: plugs left the mesh non-manifold"
    assert list(filled.extents) == pytest.approx(list(plain.extents), abs=0.01), (
        "fill_holes must not change the footprint — a plug is poking out of a face")
    assert filled.volume > plain.volume, "fill_holes added no material"

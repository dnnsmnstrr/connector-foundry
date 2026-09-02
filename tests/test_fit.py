"""Fit checks for assemblies/*.scad: render both printable halves of a
joint and check they're each sound, and that their flange bolt/peg
patterns actually land on the same (x, y) as each other.

Assemblies aren't in catalogue.yaml (no "part" schema there), so this
renders directly via foundry.run_openscad with -D part=... instead of
going through render_part/render_variant.
"""
import re
from pathlib import Path

import pytest
import trimesh

import foundry

REPO_ROOT = foundry.REPO_ROOT
ASSEMBLIES_DIR = REPO_ROOT / "assemblies"
JOINTS_SRC = (REPO_ROOT / "lib" / "joints.scad").read_text()


def _joint_const(name: str) -> float:
    m = re.search(rf"^{name}\s*=\s*([0-9.]+)", JOINTS_SRC, re.MULTILINE)
    assert m, f"{name} not found in lib/joints.scad"
    return float(m.group(1))


JOINT_FLANGE_SIZE = _joint_const("JOINT_FLANGE_SIZE")
JOINT_BOLT_OFFSET = _joint_const("JOINT_BOLT_OFFSET")
JOINT_FLANGE_T = _joint_const("JOINT_FLANGE_T")
JOINT_PEG_H = _joint_const("JOINT_PEG_H")

# corner_pattern(size, inset) puts each point at size/2 - inset, not at
# `inset` itself — see lib/util.scad.
_HOLE_COORD = JOINT_FLANGE_SIZE / 2 - JOINT_BOLT_OFFSET
_HOLE_XY = [(sx * _HOLE_COORD, sy * _HOLE_COORD) for sx in (1, -1) for sy in (1, -1)]

# Per assembly half: which end of its own bbox the flange sits at, and
# whether that flange face shows holes (bolted, or snap_flange_b) or
# proud pegs (snap_flange_a).
ASSEMBLIES = {
    "gridfinity-to-gopro": {
        "a": {"flange_side": "top", "feature": "hole"},
        "b": {"flange_side": "top", "feature": "hole"},
    },
    "corner-bracket": {
        "a": {"flange_side": "top", "feature": "peg"},
        "b": {"flange_side": "bottom", "feature": "hole"},
    },
}

_RENDERED: dict[tuple[str, str], Path] = {}


def render_assembly(name: str, part: str, render_dir: Path) -> Path:
    """Both tests below want both halves of every assembly; render each
    half once per session."""
    key = (name, part)
    if key not in _RENDERED:
        out = render_dir / name.replace("-", "_") / f"{part}.stl"
        foundry.run_openscad(ASSEMBLIES_DIR / f"{name}.scad", out, {"part": part})
        _RENDERED[key] = out
    return _RENDERED[key]


@pytest.mark.parametrize("name", sorted(ASSEMBLIES))
def test_halves_are_sound(name, render_dir):
    for part in ("a", "b"):
        mesh = trimesh.load(render_assembly(name, part, render_dir))
        assert mesh.is_watertight, f"{name} [{part}] is not watertight"
        assert mesh.is_winding_consistent, f"{name} [{part}] has inconsistent winding"
        bodies = mesh.split(only_watertight=False)
        assert len(bodies) == 1, f"{name} [{part}] rendered {len(bodies)} bodies, expected 1"


@pytest.mark.parametrize("name", sorted(ASSEMBLIES))
def test_flange_features_align(name, render_dir):
    """Both halves' bolt-hole/peg patterns sit at the same (x, y) offsets
    from center — the actual regression check for "do the two printed
    halves mate." A hole on one side with no matching hole/peg on the
    other (drifted JOINT_BOLT_OFFSET, wrong corner_pattern usage, etc.)
    fails this."""
    for part, spec in ASSEMBLIES[name].items():
        mesh = trimesh.load(render_assembly(name, part, render_dir))
        zmin, zmax = mesh.bounds[0][2], mesh.bounds[1][2]

        if spec["feature"] == "hole":
            z = zmax - JOINT_FLANGE_T / 2 if spec["flange_side"] == "top" else zmin + JOINT_FLANGE_T / 2
            assert mesh.contains([[0, 0, z]])[0], (
                f"{name} [{part}] flange center ({z=}) should be solid material"
            )
            for x, y in _HOLE_XY:
                assert not mesh.contains([[x, y, z]])[0], (
                    f"{name} [{part}] expected a bolt hole at ({x}, {y}, {z}) but found solid material"
                )
        else:  # "peg": proud of the flange's outward face, not inside its slab
            z = zmax - JOINT_PEG_H / 2 if spec["flange_side"] == "top" else zmin + JOINT_PEG_H / 2
            for x, y in _HOLE_XY:
                assert mesh.contains([[x, y, z]])[0], (
                    f"{name} [{part}] expected a peg at ({x}, {y}, {z}) but found empty space"
                )

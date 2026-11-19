"""tools/refcache.py's source resolution, without OpenSCAD or the network:
a file its user supplies is skipped when it isn't there, while a source
that could be fetched and wasn't still fails `make refs`."""

import pytest
import refcache


def test_a_missing_hand_supplied_file_is_skipped_not_fatal(tmp_path):
    present = tmp_path / "present.stl"
    present.write_bytes(b"solid x\nendsolid x\n")
    config = {
        "sources": {
            "here": {"kind": "file", "path": str(present)},
            "gone": {"kind": "file", "path": "refs/manual/nowhere/gone.stl"},
        }
    }
    roots, missing = refcache.resolve_all(config)
    assert roots["here"] == present
    assert "gone" not in roots
    assert list(missing) == ["gone"]
    assert "file you supply yourself" in missing["gone"]


def test_a_source_that_could_be_fetched_still_fails(tmp_path):
    config = {
        "sources": {
            "gone": {"kind": "file", "path": "refs/manual/nowhere/gone.stl"},
            "uncached": {"kind": "file", "url": "https://example.invalid/x.stl", "sha256": "0" * 64},
        }
    }
    with pytest.raises(refcache.RefError, match="--offline"):
        refcache.resolve_all(config, offline=True)


def test_the_checks_skip_a_missing_hand_supplied_file_too():
    config = {"sources": {"gone": {"kind": "file", "path": "refs/manual/nowhere/gone.stl"}}}
    available, unavailable = refcache.resolve_available(config)
    assert "gone" not in available
    assert "file you supply yourself" in unavailable["gone"]


def test_closed_bodies_drops_the_open_ones(tmp_path, monkeypatch):
    """A vendor model with a hole in one body (Flic's Twist: its ring) keeps
    the closed ones, which OpenSCAD can intersect, and nothing else."""
    import trimesh

    closed = trimesh.creation.box((2, 2, 2))
    # A cylinder 10mm along without its top: a hole bigger than the
    # triangles and quads trimesh fills by itself when it splits a mesh.
    cylinder = trimesh.creation.cylinder(radius=1, height=2, sections=16)
    sides = cylinder.face_normals[:, 2] < 0.9
    open_ = trimesh.Trimesh(vertices=cylinder.vertices, faces=cylinder.faces[sides])
    open_.apply_translation((10, 0, 0))
    source = tmp_path / "model.stl"
    trimesh.util.concatenate([closed, open_]).export(source)
    monkeypatch.setattr(refcache, "MESH_CACHE", tmp_path / "mesh")

    out = refcache.resolve_source("model", {"kind": "file", "path": str(source), "closed_bodies": True})
    kept = trimesh.load(out)
    assert kept.is_watertight
    assert kept.bounds.tolist() == closed.bounds.tolist()
    # Without the option an STL is used as it is.
    assert refcache.resolve_source("model", {"kind": "file", "path": str(source)}) == source

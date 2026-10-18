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

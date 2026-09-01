"""Every catalogue entry (and its declared variants) must render to a
single, watertight, consistently-wound solid."""
import trimesh

from conftest import render_variant


def all_cases(catalogue):
    for part in catalogue["parts"]:
        yield part, {}, "default"
        for variant in part.get("variants", []):
            yield part, variant["params"], variant["name"]


def test_every_part_is_manifold(catalogue, render_dir):
    for part, params, tag in all_cases(catalogue):
        stl_path = render_variant(part, params, render_dir, tag)
        mesh = trimesh.load(stl_path)
        assert mesh.is_watertight, f"{part['id']} [{tag}] is not watertight"
        assert mesh.is_winding_consistent, f"{part['id']} [{tag}] has inconsistent winding"
        assert mesh.volume > 0, f"{part['id']} [{tag}] has non-positive volume"
        bodies = mesh.split(only_watertight=False)
        assert len(bodies) == 1, f"{part['id']} [{tag}] rendered {len(bodies)} bodies, expected 1"

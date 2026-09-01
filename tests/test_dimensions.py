"""Golden bounding boxes and volumes per part, from catalogue.yaml. A
part that drifts from its published dimensions should fail loudly."""
import pytest
import trimesh

from conftest import render_variant

BBOX_TOL_MM = 0.05
VOLUME_TOL_PCT = 0.5


def golden_cases(catalogue):
    for part in catalogue["parts"]:
        if "golden" in part:
            yield part, {}, "default", part["golden"]
        for variant in part.get("variants", []):
            if "golden" in variant:
                yield part, variant["params"], variant["name"], variant["golden"]


def test_golden_dimensions(catalogue, render_dir):
    cases = list(golden_cases(catalogue))
    assert cases, "catalogue.yaml has no golden values to check"
    for part, params, tag, golden in cases:
        stl_path = render_variant(part, params, render_dir, f"golden-{tag}")
        mesh = trimesh.load(stl_path)

        bbox = mesh.extents
        expected_bbox = golden["bbox"]
        for actual, expected in zip(bbox, expected_bbox):
            assert actual == pytest.approx(expected, abs=BBOX_TOL_MM), (
                f"{part['id']} [{tag}] bbox {bbox} != expected {expected_bbox}"
            )

        expected_vol = golden["volume_mm3"]
        assert mesh.volume == pytest.approx(expected_vol, rel=VOLUME_TOL_PCT / 100), (
            f"{part['id']} [{tag}] volume {mesh.volume:.2f} != expected {expected_vol}"
        )

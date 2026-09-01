"""The checks that say whether a part is actually right.

Everything else in this directory checks that a part is well-formed and
has not changed. Only this file checks that it matches, and mates with,
somebody else's independent model of the same standard — which is the
only evidence that a printed part will fit real hardware.

Reference sources come from references.yaml. Submodule-backed sources
(vendor/) work offline; anything fetched into refs/ needs a network on
first run, and its checks skip rather than fail without one:

    make refs      populate the cache
    make verify    run the checks with the full report
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import refcache  # noqa: E402
import verify  # noqa: E402

CONFIG = refcache.load()


def _sources():
    """Resolve every source once, remembering why any failed."""
    available, unavailable = {"repo": refcache.REPO_ROOT}, {}
    for name, spec in CONFIG.get("sources", {}).items():
        try:
            available[name] = refcache.resolve_source(name, spec)
        except refcache.RefError as exc:
            unavailable[name] = str(exc)
    return available, unavailable


AVAILABLE, UNAVAILABLE = _sources()
SCAD_PATH = verify._paths(CONFIG, AVAILABLE)


def _run(check, runner):
    need = check.get("reference_source")
    if need in UNAVAILABLE:
        pytest.skip(f"reference source {need!r} unavailable: {UNAVAILABLE[need]}")
    result = runner(check, AVAILABLE, SCAD_PATH)
    assert result.passed, (
        f"{check['id']}\n  " + "\n  ".join(result.failures)
        + f"\n  metrics: {result.metrics}")


@pytest.mark.parametrize("check", CONFIG.get("shape_checks", []),
                         ids=lambda c: c["id"])
def test_shape_matches_reference(check):
    """Our part and the reference are the same solid, to tolerance."""
    _run(check, verify.run_shape_check)


@pytest.mark.parametrize("check", CONFIG.get("fit_checks", []),
                         ids=lambda c: c["id"])
def test_parts_actually_mate(check):
    """Our part and its real counterpart go together without interference."""
    _run(check, verify.run_fit_check)


def test_every_exact_part_has_a_reference():
    """`confidence: exact` is a claim. This is the thing that makes it
    cost something to write down."""
    import yaml

    catalogue = yaml.safe_load((refcache.REPO_ROOT / "catalogue.yaml").read_text())
    checked = {c.get("part") for c in
               CONFIG.get("shape_checks", []) + CONFIG.get("fit_checks", [])}

    unchecked = [
        part["id"] for part in catalogue["parts"]
        if part["confidence"] == "exact"
        and part["id"] not in checked
        and "not tied to an external spec" not in part.get("source", "")
    ]
    assert not unchecked, (
        "these parts claim confidence: exact but nothing in references.yaml "
        f"checks them: {unchecked}. Either add a check or drop the claim.")

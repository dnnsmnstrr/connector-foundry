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
import pytest
import yaml

import refcache
import verify

CONFIG = refcache.load()
AVAILABLE, UNAVAILABLE = refcache.resolve_available(CONFIG)
SCAD_PATH = verify.openscad_path(CONFIG, AVAILABLE)


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
    cost something to write down.

    Two, deliberately distinct, ways to be exempt from an automated
    check — conflating them would let a part that *could* be checked
    quietly go unchecked instead:

    - "not tied to an external spec": nothing to diverge from. There is
      no reference at all, so there is nothing a check could compare
      against (parts/basics/plate.scad and friends).
    - "no reference geometry to check against": a published numeric
      spec exists (so there IS something to be wrong about), but no
      reference implementation or CAD model of it exists anywhere to
      render and diff against — only the numbers themselves
      (parts/bitbeam/pin.scad, shaft.scad). If one ever turns up, this
      exemption is what should get replaced with a real shape/fit
      check, not kept.
    - "the manufacturer's own model": the part IS the reference — a
      vendor's published mesh imported unmodified (parts/deckmate/). A
      shape check would compare the file against itself; what can go
      wrong is the wrapper's declared size and anchors, which
      tests/test_anchors.py and tests/test_deckmate.py cover.
    """
    catalogue = yaml.safe_load((refcache.REPO_ROOT / "catalogue.yaml").read_text())
    checked = {c.get("part") for c in
               CONFIG.get("shape_checks", []) + CONFIG.get("fit_checks", [])}
    exempt_phrases = ("not tied to an external spec", "no reference geometry to check against",
                      "the manufacturer's own model")

    unchecked = [
        part["id"] for part in catalogue["parts"]
        if part["confidence"] == "exact"
        and part["id"] not in checked
        and not any(phrase in part.get("source", "") for phrase in exempt_phrases)
    ]
    assert not unchecked, (
        "these parts claim confidence: exact but nothing in references.yaml "
        f"checks them: {unchecked}. Either add a check or drop the claim.")

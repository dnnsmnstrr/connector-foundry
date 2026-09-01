"""Run every check in references.yaml and report.

    python tools/verify.py                 # everything
    python tools/verify.py gridfinity      # only ids containing "gridfinity"
    python tools/verify.py --offline       # fail rather than fetch
    python tools/verify.py --json report.json

Exit status is non-zero if any check fails, so this is usable from CI.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parent))

import geometry  # noqa: E402
import refcache  # noqa: E402

REPO_ROOT = refcache.REPO_ROOT


@dataclass
class Result:
    id: str
    kind: str
    passed: bool
    metrics: dict = field(default_factory=dict)
    failures: list[str] = field(default_factory=list)
    skipped: str | None = None

    @property
    def status(self) -> str:
        if self.skipped:
            return "SKIP"
        return "pass" if self.passed else "FAIL"


def _load(path: Path) -> trimesh.Trimesh:
    mesh = trimesh.load(path, force="mesh")
    mesh.merge_vertices()
    return mesh


def _paths(config: dict, roots: dict[str, Path]) -> list[Path]:
    return [Path(p.format(**{k: str(v) for k, v in roots.items()}))
            for p in config.get("openscad_path", [])]


# ----------------------------------------------------------------- shape

def run_shape_check(check: dict, roots: dict, scad_path: list[Path]) -> Result:
    res = Result(id=check["id"], kind="shape", passed=True)
    tol = check.get("tolerances", {})

    ours = _load(refcache.render(check["ours"], roots, f"ours-{_slug(check['id'])}", scad_path))
    ref = _load(refcache.render(check["reference"], roots, f"ref-{_slug(check['id'])}", scad_path))

    aligned, _ = geometry.align(ours, ref, mode=check.get("align", "none"))

    bbox_delta = (aligned.extents - ref.extents)
    res.metrics["bbox_ours"] = [round(v, 3) for v in aligned.extents]
    res.metrics["bbox_ref"] = [round(v, 3) for v in ref.extents]
    res.metrics["bbox_delta_mm"] = [round(v, 3) for v in bbox_delta]
    _check(res, abs(bbox_delta).max(), tol.get("max_bbox_mm"), "bbox delta", "mm")

    vol_pct = abs(aligned.volume - ref.volume) / ref.volume * 100
    res.metrics["volume_ours_mm3"] = round(float(aligned.volume), 2)
    res.metrics["volume_ref_mm3"] = round(float(ref.volume), 2)
    res.metrics["volume_delta_pct"] = round(float(vol_pct), 3)
    _check(res, vol_pct, tol.get("max_volume_pct"), "volume delta", "%")

    dist = geometry.surface_distance(aligned, ref)
    res.metrics["surface_rms_mm"] = round(dist.rms, 4)
    res.metrics["surface_max_mm"] = round(dist.max, 4)
    _check(res, dist.rms, tol.get("max_surface_rms_mm"), "surface RMS", "mm")
    _check(res, dist.max, tol.get("max_surface_max_mm"), "surface max", "mm")

    sections = []
    worst_iou = 1.0
    for z in check.get("sections_z", []):
        sd = geometry.section_diff(aligned, ref, z)
        sections.append({"z": z, "iou": round(sd.iou, 4),
                         "ours_mm2": round(sd.ours_mm2, 2),
                         "ref_mm2": round(sd.ref_mm2, 2),
                         "ours_extent": sd.ours_extent, "ref_extent": sd.ref_extent})
        worst_iou = min(worst_iou, sd.iou)
    if sections:
        res.metrics["sections"] = sections
        res.metrics["worst_section_iou"] = round(worst_iou, 4)
        floor = tol.get("min_section_iou")
        if floor is not None and worst_iou < floor:
            res.passed = False
            res.failures.append(f"worst section IoU {worst_iou:.4f} < {floor}")
    return res


# ------------------------------------------------------------------- fit

def run_fit_check(check: dict, roots: dict, scad_path: list[Path]) -> Result:
    res = Result(id=check["id"], kind="fit", passed=True)
    expect = check.get("expect", {})

    slug = _slug(check["id"])
    a_src = refcache.expand(check["a"], roots)
    b_src = refcache.expand(check["b"], roots)
    a = _load(refcache.render(a_src, roots, f"fita-{slug}", scad_path, expanded=True))
    b = _load(refcache.render(b_src, roots, f"fitb-{slug}", scad_path, expanded=True))
    overlap = _load(refcache.render(
        refcache.compose_intersection(a_src, b_src),
        roots, f"fitx-{slug}", scad_path, expanded=True))

    fit = geometry.fit(a, b, overlap)
    res.metrics["interference_mm3"] = round(fit.interference_mm3, 3)
    res.metrics["clearance_mm"] = round(fit.clearance_mm, 4)
    res.metrics["ours_volume_mm3"] = round(fit.ours_volume_mm3, 2)

    limit = expect.get("max_interference_mm3")
    if limit is not None and fit.interference_mm3 > limit:
        res.passed = False
        res.failures.append(
            f"interference {fit.interference_mm3:.3f}mm3 > {limit}mm3 "
            f"({fit.interference_mm3 / fit.ours_volume_mm3 * 100:.1f}% of the part) "
            f"— these do not go together")

    window = expect.get("clearance_mm")
    if window is not None:
        low, high = window
        if not (low <= fit.clearance_mm <= high):
            res.passed = False
            res.failures.append(
                f"clearance {fit.clearance_mm:.3f}mm outside [{low}, {high}]mm")
    return res


# ---------------------------------------------------------------- helpers

def _check(res: Result, value: float, limit, label: str, unit: str) -> None:
    if limit is not None and value > limit:
        res.passed = False
        res.failures.append(f"{label} {value:.4f}{unit} > {limit}{unit}")


def _slug(part_id: str) -> str:
    return part_id.replace("/", "_")


def _needs(check: dict) -> str | None:
    return check.get("reference_source")


# ------------------------------------------------------------------- main

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("filter", nargs="?", help="only run checks whose id contains this")
    ap.add_argument("--offline", action="store_true",
                    help="fail instead of fetching an uncached source")
    ap.add_argument("--json", type=Path, help="also write the full report here")
    args = ap.parse_args(argv)

    config = refcache.load()
    available: dict[str, Path] = {"repo": REPO_ROOT}
    unavailable: dict[str, str] = {}
    for name, spec in config.get("sources", {}).items():
        try:
            available[name] = refcache.resolve_source(name, spec, offline=args.offline)
        except refcache.RefError as exc:
            unavailable[name] = str(exc)

    scad_path = _paths(config, available)

    results: list[Result] = []
    for kind, key, runner in (("shape", "shape_checks", run_shape_check),
                              ("fit", "fit_checks", run_fit_check)):
        for check in config.get(key, []):
            if args.filter and args.filter not in check["id"]:
                continue
            need = _needs(check)
            if need and need in unavailable:
                results.append(Result(id=check["id"], kind=kind, passed=True,
                                      skipped=unavailable[need]))
                continue
            try:
                results.append(runner(check, available, scad_path))
            except Exception as exc:  # a broken recipe is a failed check, not a crash
                results.append(Result(id=check["id"], kind=kind, passed=False,
                                      failures=[f"{type(exc).__name__}: {exc}"]))

    _report(results)
    if args.json:
        args.json.write_text(json.dumps(
            [{"id": r.id, "kind": r.kind, "status": r.status,
              "metrics": r.metrics, "failures": r.failures, "skipped": r.skipped}
             for r in results], indent=2))
    return 1 if any(not r.passed and not r.skipped for r in results) else 0


def _report(results: list[Result]) -> None:
    width = max((len(r.id) for r in results), default=10)
    print()
    for r in results:
        print(f"{r.status:>4}  {r.id:<{width}}  {_summary(r)}")
        for line in r.failures:
            print(f"      {'':<{width}}  -> {line}")
        if r.skipped:
            print(f"      {'':<{width}}  -> {r.skipped}")
    failed = [r for r in results if not r.passed and not r.skipped]
    skipped = [r for r in results if r.skipped]
    print(f"\n{len(results) - len(failed) - len(skipped)} passed, "
          f"{len(failed)} failed, {len(skipped)} skipped")


def _summary(r: Result) -> str:
    m = r.metrics
    if r.kind == "shape" and "volume_delta_pct" in m:
        return (f"vol {m['volume_delta_pct']:>6.2f}%  "
                f"rms {m['surface_rms_mm']:>7.4f}mm  "
                f"max {m['surface_max_mm']:>7.4f}mm  "
                f"section IoU {m.get('worst_section_iou', float('nan')):.4f}")
    if r.kind == "fit" and "interference_mm3" in m:
        return (f"interference {m['interference_mm3']:>9.3f}mm3  "
                f"clearance {m['clearance_mm']:>7.4f}mm")
    return ""


if __name__ == "__main__":
    raise SystemExit(main())

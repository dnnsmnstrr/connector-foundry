"""Mesh comparison primitives used by the reference checks.

Everything here works on trimesh meshes in millimetres. The metrics are
chosen so that a failure points at *what* is wrong, not just that
something is:

  bbox / volume     coarse, catches "wrong size" and "wrong amount of
                    material" but averages away profile errors
  surface distance  every point on one surface to the nearest point on
                    the other, both directions — catches local shape
                    error anywhere on the part
  section profiles  the 2D outline at a given height, compared by
                    symmetric-difference area — this is what actually
                    catches a mating profile that is the right overall
                    size but the wrong shape through its depth
"""
from __future__ import annotations

import itertools
from dataclasses import dataclass, field

import numpy as np
import trimesh


# ----------------------------------------------------------------- align

def _axis_aligned_rotations() -> list[np.ndarray]:
    """The 24 rotations that map a box onto itself, as 4x4 matrices."""
    mats = []
    for perm in itertools.permutations(range(3)):
        for signs in itertools.product((1, -1), repeat=3):
            m = np.zeros((3, 3))
            for row, (col, sign) in enumerate(zip(perm, signs)):
                m[row, col] = sign
            if np.isclose(np.linalg.det(m), 1.0):
                full = np.eye(4)
                full[:3, :3] = m
                mats.append(full)
    return mats


AXIS_ROTATIONS = _axis_aligned_rotations()


def _centered(mesh: trimesh.Trimesh) -> tuple[trimesh.Trimesh, np.ndarray]:
    m = mesh.copy()
    centroid = m.bounding_box.centroid.copy()
    m.apply_translation(-centroid)
    return m, centroid


def align(mesh: trimesh.Trimesh, reference: trimesh.Trimesh, mode: str = "auto",
          icp: bool = True) -> tuple[trimesh.Trimesh, np.ndarray]:
    """Return `mesh` moved into `reference`'s frame, plus the transform used.

    mode "none"  -- both meshes are already authored in the same frame
                    (both rendered by OpenSCAD from the same origin
                    convention). Preferred: no alignment means no chance
                    of alignment hiding a real error.
    mode "auto"  -- for geometry that arrives in an arbitrary CAD frame
                    (a downloaded STEP). Centres both, tries all 24
                    axis-aligned rotations, keeps the best by surface
                    RMS, then optionally refines with ICP.
    """
    if mode == "none":
        return mesh, np.eye(4)
    if mode != "auto":
        raise ValueError(f"unknown align mode {mode!r}")

    src, src_c = _centered(mesh)
    dst, dst_c = _centered(reference)

    to_origin = trimesh.transformations.translation_matrix(-src_c)
    back = trimesh.transformations.translation_matrix(dst_c)

    best, best_rms = None, np.inf
    for rot in AXIS_ROTATIONS:
        trial = src.copy()
        trial.apply_transform(rot)
        rms = surface_distance(trial, dst, samples=2000).rms
        if rms < best_rms:
            best, best_rms = rot, rms

    transform = back @ best @ to_origin
    if icp:
        moved = mesh.copy()
        moved.apply_transform(transform)
        try:
            refine, _ = trimesh.registration.mesh_other(
                moved, reference, samples=2000, scale=False)
            transform = refine @ transform
        except Exception:  # ICP is a refinement, never a requirement
            pass

    out = mesh.copy()
    out.apply_transform(transform)
    return out, transform


# -------------------------------------------------------------- distance

@dataclass
class SurfaceDistance:
    rms: float
    mean: float
    max: float  # one-sided Hausdorff, symmetrised by the caller

    def as_dict(self) -> dict:
        return {"rms_mm": self.rms, "mean_mm": self.mean, "max_mm": self.max}


def _one_way(a: trimesh.Trimesh, b: trimesh.Trimesh, samples: int) -> np.ndarray:
    points, _ = trimesh.sample.sample_surface(a, samples)
    _, distance, _ = trimesh.proximity.closest_point(b, points)
    return np.abs(distance)


def surface_distance(a: trimesh.Trimesh, b: trimesh.Trimesh,
                     samples: int = 20000) -> SurfaceDistance:
    """Symmetric surface distance: sample both ways so that material
    missing from either mesh shows up. A one-way sample can score a part
    with a whole feature missing as near-perfect."""
    d = np.concatenate([_one_way(a, b, samples), _one_way(b, a, samples)])
    return SurfaceDistance(rms=float(np.sqrt(np.mean(d ** 2))),
                           mean=float(d.mean()), max=float(d.max()))


# -------------------------------------------------------------- sections

@dataclass
class SectionDiff:
    z: float
    ours_mm2: float
    ref_mm2: float
    symmetric_difference_mm2: float
    iou: float
    ours_extent: tuple[float, float] | None = None
    ref_extent: tuple[float, float] | None = None


def _section_polygon(mesh: trimesh.Trimesh, z: float):
    section = mesh.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
    if section is None:
        return None
    # to_2D() with no argument picks its own in-plane frame per mesh, so
    # two identical sections can come back translated relative to each
    # other and score a low IoU. Pin the frame to the world x/y axes.
    to_2D = trimesh.transformations.translation_matrix([0, 0, -z])
    planar = section.to_2D(to_2D=to_2D, check=False)[0]
    polys = planar.polygons_full
    if len(polys) == 0:
        return None
    from shapely.ops import unary_union
    return unary_union(list(polys))


def section_diff(ours: trimesh.Trimesh, reference: trimesh.Trimesh,
                 z: float) -> SectionDiff:
    """Compare the horizontal cross-section of two meshes at height z.

    z is absolute in the shared frame. Both parts sit on the bed by this
    repo's convention, so z is "height above the functional face".
    """
    a, b = _section_polygon(ours, z), _section_polygon(reference, z)
    if a is None or b is None:
        return SectionDiff(z=z, ours_mm2=0.0 if a is None else a.area,
                           ref_mm2=0.0 if b is None else b.area,
                           symmetric_difference_mm2=float("inf"), iou=0.0)
    union = a.union(b).area
    return SectionDiff(
        z=z, ours_mm2=a.area, ref_mm2=b.area,
        symmetric_difference_mm2=a.symmetric_difference(b).area,
        iou=(a.intersection(b).area / union) if union else 1.0,
        ours_extent=_extent(a), ref_extent=_extent(b),
    )


def _extent(poly) -> tuple[float, float]:
    minx, miny, maxx, maxy = poly.bounds
    return (round(maxx - minx, 3), round(maxy - miny, 3))


# ------------------------------------------------------------------- fit

@dataclass
class FitResult:
    interference_mm3: float
    clearance_mm: float
    ours_volume_mm3: float
    counterpart_volume_mm3: float | None


def _surface_volume(mesh: trimesh.Trimesh | None) -> float:
    """Volume of a possibly-imperfect mesh.

    Upstream models sometimes export as several bodies meeting along an
    edge: OpenSCAD calls that manifold, a mesh library does not. The
    divergence-theorem volume is still correct for such a mesh as long as
    the winding is consistent, which is what we check.
    """
    if mesh is None or len(mesh.faces) == 0:
        return 0.0
    if not mesh.is_winding_consistent:
        raise ValueError("mesh winding is inconsistent; volume is meaningless")
    return abs(float(mesh.volume))


def fit(ours: trimesh.Trimesh, counterpart: trimesh.Trimesh,
        overlap: trimesh.Trimesh | None) -> FitResult:
    """Do these two solids actually mate?

    All three meshes are already in the assembled pose, and `overlap` is
    their intersection as computed by OpenSCAD. The two numbers that
    matter for a printed interface:

      interference  volume the two solids try to occupy at once. Above a
                    print's worth of slop, the parts do not go together.
      clearance     smallest gap between the surfaces. Zero means they
                    touch; a large value means a rattly fit.
    """
    points, _ = trimesh.sample.sample_surface(ours, 20000)
    _, distance, _ = trimesh.proximity.closest_point(counterpart, points)

    return FitResult(
        interference_mm3=_surface_volume(overlap),
        clearance_mm=float(np.abs(distance).min()),
        ours_volume_mm3=_surface_volume(ours),
        counterpart_volume_mm3=_surface_volume(counterpart),
    )

"""Obtain reference geometry to compare our parts against.

Nothing third-party is committed to this repository. Sources are either
a git submodule already vendored under vendor/ (only for licenses
compatible with this repo), or a pinned git commit fetched on demand
into refs/ (gitignored) — used for sources we may read and measure but
may not redistribute, such as CC-BY-NC-SA or GPL upstreams.

Reference meshes are produced by rendering a recipe through the same
OpenSCAD binary the rest of the toolchain uses, so a difference in the
result is a difference in the model rather than in the mesher.
"""
from __future__ import annotations

import functools
import hashlib
import os
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
REFS_YAML = REPO_ROOT / "references.yaml"
OPENSCAD_BIN = os.environ.get("OPENSCAD_BIN", "openscad")

CACHE = REPO_ROOT / "refs"
SRC_CACHE = CACHE / "src"
MESH_CACHE = CACHE / "mesh"


class RefError(RuntimeError):
    pass


def load() -> dict:
    return yaml.safe_load(REFS_YAML.read_text())


# ---------------------------------------------------------------- sources

def _git(*args: str, cwd: Path | None = None) -> str:
    proc = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RefError(f"git {' '.join(args)} failed:\n{proc.stderr.strip()}")
    return proc.stdout.strip()


def resolve_source(name: str, spec: dict, offline: bool = False) -> Path:
    """Return the local root directory for one reference source."""
    kind = spec["kind"]

    if kind == "submodule":
        path = REPO_ROOT / spec["path"]
        if not path.is_dir() or not any(path.iterdir()):
            raise RefError(
                f"submodule {spec['path']} is not checked out — run "
                f"`git submodule update --init --recursive`")
        return path

    if kind == "file":
        return _resolve_file_source(name, spec, offline=offline)

    if kind != "git":
        raise RefError(f"source {name}: unknown kind {kind!r}")

    commit = spec["commit"]
    dest = SRC_CACHE / f"{name}@{commit[:12]}"

    # `.git` existing is not the same as the checkout being usable. A
    # fetch interrupted after `git init` leaves the directory looking
    # cached forever, and every later run would hand back an empty tree
    # — the reference workflow silently broken until someone worked out
    # to delete refs/src by hand. Ask git what is actually checked out.
    if (dest / ".git").exists():
        try:
            if _git("rev-parse", "HEAD", cwd=dest) == commit:
                return dest
        except RefError:
            pass
        print(f"  discarding incomplete checkout of {name}", file=sys.stderr)
        shutil.rmtree(dest)

    if offline:
        raise RefError(
                f"source {name} is not cached and --offline was given; "
                f"run `make refs`")

    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  fetching {name} @ {commit[:12]} ...", file=sys.stderr)
    _git("init", "-q", str(dest))
    _git("remote", "add", "origin", spec["url"], cwd=dest)
    _git("fetch", "-q", "--depth", "1", "origin", commit, cwd=dest)
    _git("checkout", "-q", "FETCH_HEAD", cwd=dest)
    got = _git("rev-parse", "HEAD", cwd=dest)
    if got != commit:
        raise RefError(f"source {name}: expected {commit}, fetched {got}")
    return dest


def resolve_all(config: dict, offline: bool = False) -> dict[str, Path]:
    """Every source's root, or the first RefError — for `make refs`,
    where an unavailable source is a failure."""
    roots = {"repo": REPO_ROOT}
    for name, spec in config.get("sources", {}).items():
        roots[name] = resolve_source(name, spec, offline=offline)
    return roots


def resolve_available(config: dict, offline: bool = False) -> tuple[dict[str, Path], dict[str, str]]:
    """Every source that resolves, plus why each of the rest did not —
    for the checks (verify.py, tests/test_reference.py), which skip a
    check whose source is missing rather than refusing to run at all."""
    available: dict[str, Path] = {"repo": REPO_ROOT}
    unavailable: dict[str, str] = {}
    for name, spec in config.get("sources", {}).items():
        try:
            available[name] = resolve_source(name, spec, offline=offline)
        except RefError as exc:
            unavailable[name] = str(exc)
    return available, unavailable


# ------------------------------------------------------------ file sources

# A STEP file carries its own units; the glTF that cascadio writes is
# always metres, so converted geometry needs scaling back to the
# millimetres everything else here is in.
STEP_SUFFIXES = {".step", ".stp"}
DEFAULT_SCALE = {".step": 1000.0, ".stp": 1000.0}

FILES_CACHE = CACHE / "files"


DOWNLOAD_TIMEOUT_S = 60


def _download(url: str, sha256: str, dest: Path) -> Path:
    import urllib.error
    import urllib.request

    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  downloading {url}", file=sys.stderr)
    try:
        with urllib.request.urlopen(url, timeout=DOWNLOAD_TIMEOUT_S) as response:
            payload = response.read()
    except (urllib.error.URLError, OSError) as exc:
        raise RefError(f"could not download {url}: {exc}") from exc
    got = hashlib.sha256(payload).hexdigest()
    if got != sha256:
        raise RefError(
            f"checksum mismatch for {url}\n  expected {sha256}\n  got      {got}")
    # Only a verified payload ever lands at `dest`: the existence check in
    # _resolve_file_source() is the cache, so a partial write there would
    # be served as the reference forever after.
    tmp = dest.with_name(dest.name + ".part")
    tmp.write_bytes(payload)
    os.replace(tmp, dest)
    return dest


def _resolve_file_source(name: str, spec: dict, offline: bool = False) -> Path:
    """A CAD file — a supplier's STEP, a downloaded STL — as an STL that
    a recipe can `import()`.

    Converting to STL rather than loading the mesh directly is what lets
    a file reference be posed, cut and intersected by exactly the same
    OpenSCAD recipes as every other reference. There is one mechanism for
    "put these two solids in the assembled position", not two.
    """
    source = spec.get("path")
    if source:
        source = (REPO_ROOT / source).resolve()
        if not source.exists():
            raise RefError(
                f"source {name}: {spec['path']} not found. This source is a "
                f"file you supply yourself — see references.yaml.")
    else:
        url, sha256 = spec.get("url"), spec.get("sha256")
        if not (url and sha256):
            raise RefError(f"source {name}: needs either `path`, or `url` + `sha256`")
        source = FILES_CACHE / f"{name}{Path(url).suffix}"
        if not source.exists():
            if offline:
                raise RefError(
                f"source {name} is not cached and --offline was given; "
                f"run `make refs`")
            _download(url, sha256, source)

    suffix = source.suffix.lower()
    if suffix == ".stl":
        return source

    scale = spec.get("scale", DEFAULT_SCALE.get(suffix, 1.0))
    out = MESH_CACHE / f"file-{name}-{_file_key(source, scale)}.stl"
    if out.exists():
        return out

    MESH_CACHE.mkdir(parents=True, exist_ok=True)
    mesh = _load_cad(source, suffix)
    mesh.apply_scale(scale)
    mesh.export(out)
    return out


def _file_key(source: Path, scale: float) -> str:
    digest = hashlib.sha256(source.read_bytes())
    digest.update(str(scale).encode())
    return digest.hexdigest()[:16]


def _load_cad(source: Path, suffix: str):
    import trimesh

    if suffix in STEP_SUFFIXES:
        try:
            import cascadio
        except ImportError as exc:  # pragma: no cover - depends on the install
            raise RefError(
                "reading STEP needs the `cascadio` package: "
                "pip install -e '.[dev]'") from exc
        glb = MESH_CACHE / f".{source.stem}.glb"
        MESH_CACHE.mkdir(parents=True, exist_ok=True)
        cascadio.step_to_glb(str(source), str(glb), tol_linear=0.01, tol_angular=0.05)
        loaded = trimesh.load(glb)
        glb.unlink(missing_ok=True)
    else:
        loaded = trimesh.load(source)

    mesh = loaded.to_mesh() if hasattr(loaded, "to_mesh") else loaded
    # Tessellated CAD arrives as per-face triangles with duplicated
    # vertices, which reads as an open shell of zero volume until the
    # coincident vertices are welded.
    mesh.merge_vertices()
    return mesh


# ---------------------------------------------------------------- render

def expand(recipe: str, roots: dict[str, Path]) -> str:
    """Resolve {repo} / {source-name} placeholders to absolute paths."""
    try:
        return recipe.format(**{k: str(v) for k, v in roots.items()})
    except KeyError as exc:
        raise RefError(f"recipe references unknown source {exc}") from exc


SCAD_DIRS = ("lib", "parts", "assemblies")


@functools.cache
def source_fingerprint() -> str:
    """A hash over everything a recipe's output can depend on.

    A recipe is a handful of lines that `include` real sources, so keying
    the mesh cache on the recipe text alone means editing a part leaves
    the cache serving its old geometry — a verify run that reports on
    code you have already changed, which is worse than having no checks
    at all. Hash our own .scad tree by content, and each vendored
    upstream by its checked-out commit. Computed once per process: the
    sources do not change under a running check.
    """
    digest = hashlib.sha256()
    for directory in SCAD_DIRS:
        for path in sorted((REPO_ROOT / directory).rglob("*.scad")):
            digest.update(str(path.relative_to(REPO_ROOT)).encode())
            digest.update(path.read_bytes())
    vendor = REPO_ROOT / "vendor"
    for sub in sorted(p for p in vendor.iterdir() if p.is_dir()):
        digest.update(sub.name.encode())
        try:
            digest.update(_git("rev-parse", "HEAD", cwd=sub).encode())
        except RefError:
            digest.update(b"unknown")
    return digest.hexdigest()


def render(recipe: str, roots: dict[str, Path], tag: str,
           openscad_path: list[Path] | None = None,
           expanded: bool = False) -> Path:
    """Render a .scad recipe to STL, cached on recipe + source state."""
    source = recipe if expanded else expand(recipe, roots)
    key = hashlib.sha256(
        (source + source_fingerprint()).encode()).hexdigest()[:16]
    out = MESH_CACHE / f"{tag}-{key}.stl"
    if out.exists():
        return out

    MESH_CACHE.mkdir(parents=True, exist_ok=True)
    scad = MESH_CACHE / f".{tag}-{key}.scad"
    scad.write_text(source)

    env = None
    if openscad_path:
        env = {**os.environ,
               "OPENSCADPATH": ":".join(str(p) for p in openscad_path)}

    cmd = [OPENSCAD_BIN, "--backend=Manifold", "-o", str(out), str(scad)]
    proc = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True, env=env)
    scad.unlink(missing_ok=True)
    # An empty result is an error to openscad but a legitimate answer
    # here: an intersection check *wants* the overlap to be empty.
    empty = "top level object is empty" in proc.stderr.lower()
    if proc.returncode != 0 and not empty:
        raise RefError(f"openscad failed rendering {tag}:\n{proc.stderr.strip()}")
    if not out.exists():
        if not empty:
            raise RefError(f"openscad wrote nothing for {tag}:\n{proc.stderr.strip()}")
        out.write_text("solid empty\nendsolid empty\n")
    return out


def _split_includes(recipe: str) -> tuple[list[str], list[str]]:
    """Separate a recipe's file-level include/use lines from its body.

    OpenSCAD only accepts include/use at file level, so composing two
    recipes into one CSG operation means hoisting their includes.
    """
    heads, body = [], []
    for line in recipe.splitlines():
        stripped = line.strip()
        (heads if stripped.startswith(("include <", "use <")) else body).append(line)
    return heads, body


def compose_intersection(a: str, b: str) -> str:
    """A recipe whose output is the overlap of two other recipes.

    Both recipes must already be expanded — the composed source contains
    braces of its own, which a later .format() would try to read as
    placeholders.

    The boolean is done by OpenSCAD's Manifold backend rather than by a
    mesh library: it is the same kernel that produced both solids, and it
    copes with upstream models that export as several bodies touching
    along an edge, which a mesh boolean refuses outright.
    """
    a_head, a_body = _split_includes(a)
    b_head, b_body = _split_includes(b)
    heads = list(dict.fromkeys(a_head + b_head))
    return "\n".join([
        *heads, "",
        "module __fit_a() {", *a_body, "}", "",
        "module __fit_b() {", *b_body, "}", "",
        "intersection() { __fit_a(); __fit_b(); }", "",
    ])


def sync(offline: bool = False) -> dict[str, Path]:
    """Fetch every source and pre-render every recipe."""
    config = load()
    roots = resolve_all(config, offline=offline)
    for name, path in roots.items():
        if name != "repo":
            print(f"  {name:<20} {path.relative_to(REPO_ROOT)}", file=sys.stderr)
    return roots


if __name__ == "__main__":
    offline = "--offline" in sys.argv
    print("resolving reference sources", file=sys.stderr)
    sync(offline=offline)
    print("done", file=sys.stderr)

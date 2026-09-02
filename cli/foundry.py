"""Connector Foundry CLI — wraps the openscad binary around catalogue.yaml.

    foundry list
    foundry render gridfinity/base --gx 2 --gy 1 --magnets -o out/
    foundry render assemblies/corner-bracket --part a -o out/
    foundry build --all
    foundry preview --all
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import typer
import yaml

app = typer.Typer(add_completion=False, help=__doc__)

REPO_ROOT = Path(__file__).resolve().parent.parent
CATALOGUE_PATH = REPO_ROOT / "catalogue.yaml"

# Every render needs --backend=Manifold, which the stable OpenSCAD
# release predates. Distributions that ship only the stable build usually
# also package the dev snapshot under another name, so let the binary be
# named rather than assuming "openscad" is the right one.
OPENSCAD_BIN = os.environ.get("OPENSCAD_BIN", "openscad")
GOLDEN_PATH = REPO_ROOT / "tests" / "golden" / "dimensions.yaml"


def load_catalogue() -> dict:
    return yaml.safe_load(CATALOGUE_PATH.read_text())


def find_part(catalogue: dict, part_id: str) -> dict:
    for part in catalogue["parts"]:
        if part["id"] == part_id:
            return part
    raise typer.BadParameter(f"Unknown part '{part_id}'. Run `foundry list`.")


def parse_scalar(raw: str):
    """Parse a --set VALUE into the narrowest type OpenSCAD will accept."""
    if raw in ("true", "false"):
        return raw == "true"
    for cast in (int, float):
        try:
            return cast(raw)
        except ValueError:
            pass
    return raw


class Raw(str):
    """A value to emit into OpenSCAD verbatim rather than as a string.

    BOSL2 anchors are vectors bound to bare names (TOP is [0,0,1]), so
    passing anchor="TOP" gives OpenSCAD a string it cannot use. Raw("TOP")
    passes the name through.
    """


def openscad_value(value) -> str:
    if isinstance(value, Raw):
        return str(value)
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return f'"{value}"'
    return str(value)


def openscad_env() -> dict[str, str]:
    """vendor/ on the OpenSCAD library path.

    Vendored upstreams written for the OpenSCAD library folder ask for
    their dependencies by library name (`include <BOSL2/std.scad>`)
    rather than by relative path, so vendor/ has to be searchable for
    those to resolve. Our own parts use relative includes and do not
    depend on this.
    """
    return {**os.environ, "OPENSCADPATH": str(REPO_ROOT / "vendor")}


def run_openscad(scad_file: Path, out_file: Path, params: dict[str, object]) -> None:
    out_file.parent.mkdir(parents=True, exist_ok=True)
    cmd = [OPENSCAD_BIN, "--backend=Manifold", "-o", str(out_file)]
    for key, value in params.items():
        cmd += ["-D", f"{key}={openscad_value(value)}"]
    cmd.append(str(scad_file))
    result = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True,
                            env=openscad_env())
    if result.returncode != 0:
        typer.echo(result.stderr, err=True)
        raise typer.Exit(1)


def module_parameters(part: dict) -> list[str]:
    """The named parameters of a part's module, read from its source.

    OpenSCAD does not treat an unknown named argument as an error — it
    warns and carries on with the default, so `--set leg_height=20` on a
    module whose parameter is `leg_h` reports a successful render of
    something that ignored you entirely. The signature is the only real
    answer to what a part accepts, so read it.
    """
    source = (REPO_ROOT / part["file"]).read_text()
    match = re.search(rf"\bmodule\s+{re.escape(part['module'])}\s*\(", source)
    if not match:
        raise typer.BadParameter(
            f"{part['id']}: no module {part['module']}() in {part['file']}")

    # Walk to the matching close paren: defaults contain their own
    # brackets ([0, 0, 1]) and calls (named_anchor(...)), so counting
    # depth is the only way to find where the signature ends.
    depth, start = 1, match.end()
    index = start
    while depth and index < len(source):
        depth += {"(": 1, "[": 1, ")": -1, "]": -1}.get(source[index], 0)
        index += 1
    signature = source[start:index - 1]

    names, depth, token = [], 0, ""
    for char in signature + ",":
        if char in "([":
            depth += 1
        elif char in ")]":
            depth -= 1
        if char == "," and depth == 0:
            name = token.split("=")[0].strip()
            if name:
                names.append(name)
            token = ""
        else:
            token += char
    return names


def check_parameters(part: dict, overrides: dict[str, object]) -> None:
    """Reject an override that is not a parameter of the part."""
    known = module_parameters(part)
    unknown = [key for key in overrides if key not in known]
    if unknown:
        raise typer.BadParameter(
            f"{part['id']}: {', '.join(repr(k) for k in unknown)} "
            f"{'is not a parameter' if len(unknown) == 1 else 'are not parameters'} "
            f"of {part['module']}(). Accepts: {', '.join(known)}")


def check_options(part: dict, params: dict[str, object]) -> None:
    """Reject a value outside a parameter's declared option list.

    OpenSCAD compares these strings literally, so a typo does not fail —
    it quietly takes the fallback branch and renders something plausible
    and wrong. Better to stop here and name the alternatives.
    """
    for key, allowed in part.get("options", {}).items():
        value = params.get(key)
        if value is not None and value not in allowed:
            raise typer.BadParameter(
                f"{part['id']}: {key}={value!r} is not one of "
                + ", ".join(repr(a) for a in allowed))


def render_part(part: dict, overrides: dict[str, object], out_dir: Path) -> Path:
    check_parameters(part, overrides)
    params = {**part.get("defaults", {}), **overrides}
    check_options(part, params)
    call_args = ", ".join(f"{k}={openscad_value(v)}" for k, v in params.items())
    scad_source = REPO_ROOT / part["file"]
    stub = out_dir / f".{part['id'].replace('/', '_')}_stub.scad"
    stub.parent.mkdir(parents=True, exist_ok=True)
    stub.write_text(f'include <{scad_source}>\n{part["module"]}({call_args});\n')
    out_stl = out_dir / f"{part['id'].replace('/', '_')}.stl"
    run_openscad(stub, out_stl, {})
    stub.unlink()
    return out_stl


@app.command("list")
def list_parts():
    """Catalogue, grouped by system."""
    catalogue = load_catalogue()
    by_system: dict[str, list[dict]] = {}
    for part in catalogue["parts"]:
        by_system.setdefault(part["system"], []).append(part)
    for system, parts in sorted(by_system.items()):
        typer.echo(f"\n{system}")
        for part in parts:
            # Licence varies per part now that some wrap non-MIT
            # upstreams, so it belongs next to the part, not in a footnote.
            licence = part.get("license", "MIT")
            typer.echo(f"  {part['id']:<28} [{part['confidence']:<10}] "
                       f"{licence:<15} {part['name']}")


@app.command("render")
def render(
    part_id: str = typer.Argument(..., help="Catalogue id, e.g. gridfinity/base"),
    gx: int = typer.Option(None),
    gy: int = typer.Option(None),
    magnets: bool = typer.Option(None),
    screws: bool = typer.Option(None),
    set_: list[str] = typer.Option(
        None, "--set", metavar="KEY=VALUE",
        help="Any other module parameter, repeatable: --set thumbscrew=true"),
    out: Path = typer.Option(Path("out"), "-o", "--out"),
):
    """Render one catalogue part to STL."""
    catalogue = load_catalogue()
    part = find_part(catalogue, part_id)
    overrides = {}
    for name, value in [("gx", gx), ("gy", gy), ("magnets", magnets), ("screws", screws)]:
        if value is not None:
            overrides[name] = value
    for item in set_ or []:
        if "=" not in item:
            raise typer.BadParameter(f"--set expects KEY=VALUE, got {item!r}")
        key, _, raw = item.partition("=")
        overrides[key.strip()] = parse_scalar(raw.strip())
    stl_path = render_part(part, overrides, out)
    typer.echo(f"wrote {stl_path}")


@app.command("build")
def build(all_: bool = typer.Option(False, "--all"), out: Path = typer.Option(Path("out"), "-o", "--out")):
    """Render every catalogue entry at defaults."""
    catalogue = load_catalogue()
    if not all_:
        typer.echo("pass --all to build the whole catalogue")
        raise typer.Exit(1)
    for part in catalogue["parts"]:
        stl_path = render_part(part, {}, out)
        typer.echo(f"wrote {stl_path}")


@app.command("preview")
def preview(all_: bool = typer.Option(False, "--all"), out: Path = typer.Option(Path("docs/img"), "-o", "--out")):
    """Render a PNG per catalogue entry, for the README gallery."""
    catalogue = load_catalogue()
    if not all_:
        typer.echo("pass --all to preview the whole catalogue")
        raise typer.Exit(1)
    out.mkdir(parents=True, exist_ok=True)
    for part in catalogue["parts"]:
        call_args = ", ".join(f"{k}={openscad_value(v)}" for k, v in part.get("defaults", {}).items())
        scad_source = REPO_ROOT / part["file"]
        stub = out / f".{part['id'].replace('/', '_')}_stub.scad"
        stub.write_text(f'include <{scad_source}>\n{part["module"]}({call_args});\n')
        png_path = out / f"{part['id'].replace('/', '_')}.png"
        cmd = [OPENSCAD_BIN, "--backend=Manifold", "--autocenter", "--viewall",
               "--colorscheme=Tomorrow", "--imgsize=640,480", "-o", str(png_path), str(stub)]
        result = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True,
                                env=openscad_env())
        stub.unlink()
        if result.returncode != 0:
            typer.echo(result.stderr, err=True)
            raise typer.Exit(1)
        typer.echo(f"wrote {png_path}")


def catalogue_cases(catalogue: dict):
    """Every (part, params, tag) the catalogue declares — defaults first,
    then each named variant. The one place that enumeration lives."""
    for part in catalogue["parts"]:
        yield part, {}, "default"
        for variant in part.get("variants", []):
            yield part, variant["params"], variant["name"]


@app.command("goldens")
def goldens(update: bool = typer.Option(False, "--update",
                                        help="rewrite tests/golden/dimensions.yaml")):
    """Show, or regenerate, the recorded bounding box and volume per part.

    These are a change detector, not a correctness claim: they catch a
    part silently moving. Whether a part is *right* is what
    references.yaml and `make verify` answer.
    """
    import trimesh

    catalogue = load_catalogue()
    recorded: dict[str, dict] = {}
    with tempfile.TemporaryDirectory() as tmp:
        for part, params, tag in catalogue_cases(catalogue):
            stl = render_part(part, params, Path(tmp) / tag)
            mesh = trimesh.load(stl)
            recorded.setdefault(part["id"], {})[tag] = {
                "bbox": [round(float(v), 3) for v in mesh.extents],
                "volume_mm3": round(float(mesh.volume), 2),
            }
            typer.echo(f"{part['id']:<28} {tag:<24} "
                       f"{[round(float(v), 2) for v in mesh.extents]} "
                       f"{mesh.volume:.2f}mm3")

    if update:
        GOLDEN_PATH.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN_PATH.write_text(
            "# Generated by `foundry goldens --update`. Do not hand-edit.\n"
            "#\n"
            "# A change detector for catalogue geometry: it catches a part\n"
            "# moving when nobody meant to move it. It does NOT say a part is\n"
            "# correct — a wrong part has a perfectly stable bounding box.\n"
            "# Correctness lives in references.yaml (`make verify`).\n"
            + yaml.safe_dump(recorded, sort_keys=True))
        typer.echo(f"\nwrote {GOLDEN_PATH.relative_to(REPO_ROOT)}")


@app.command("readme")
def readme():
    """Regenerate the catalogue table in README.md from catalogue.yaml."""
    catalogue = load_catalogue()
    lines = ["| Part | System | Confidence | Licence | Print note |",
             "| --- | --- | --- | --- | --- |"]
    for part in catalogue["parts"]:
        img = f"docs/img/{part['id'].replace('/', '_')}.png"
        cell = (f"![{part['name']}]({img})<br>{part['name']}"
                if (REPO_ROOT / img).exists() else part["name"])
        licence = part.get("license", "MIT")
        note = " ".join(part["print_note"].split())
        lines.append(f"| {cell} | {part['system']} | {part['confidence']} "
                     f"| {licence} | {note} |")
    table = "\n".join(lines)

    readme_path = REPO_ROOT / "README.md"
    text = readme_path.read_text()
    start, end = "<!-- CATALOGUE:START -->", "<!-- CATALOGUE:END -->"
    if start not in text or end not in text:
        raise typer.BadParameter(f"README.md is missing {start}/{end} markers")
    before, rest = text.split(start, 1)
    _, after = rest.split(end, 1)
    readme_path.write_text(f"{before}{start}\n{table}\n{end}{after}")
    typer.echo("README.md catalogue table updated")


if __name__ == "__main__":
    app()

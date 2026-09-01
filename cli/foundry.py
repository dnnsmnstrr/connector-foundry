"""Connector Foundry CLI — wraps the openscad binary around catalogue.yaml.

    foundry list
    foundry render gridfinity/base --gx 2 --gy 1 --magnets -o out/
    foundry render assemblies/corner-bracket --part a -o out/
    foundry build --all
    foundry preview --all
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import typer
import yaml

app = typer.Typer(add_completion=False, help=__doc__)

REPO_ROOT = Path(__file__).resolve().parent.parent
CATALOGUE_PATH = REPO_ROOT / "catalogue.yaml"
VENDOR_DIR = REPO_ROOT / "vendor"


def load_catalogue() -> dict:
    return yaml.safe_load(CATALOGUE_PATH.read_text())


def find_part(catalogue: dict, part_id: str) -> dict:
    for part in catalogue["parts"]:
        if part["id"] == part_id:
            return part
    raise typer.BadParameter(f"Unknown part '{part_id}'. Run `foundry list`.")


def openscad_value(value) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return f'"{value}"'
    return str(value)


def run_openscad(scad_file: Path, out_file: Path, params: dict[str, object]) -> None:
    out_file.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["openscad", "--backend=Manifold", "-o", str(out_file)]
    for key, value in params.items():
        cmd += ["-D", f"{key}={openscad_value(value)}"]
    cmd.append(str(scad_file))
    result = subprocess.run(cmd, cwd=REPO_ROOT, env={**os.environ, "OPENSCADPATH": str(VENDOR_DIR)},
                             capture_output=True, text=True)
    if result.returncode != 0:
        typer.echo(result.stderr, err=True)
        raise typer.Exit(1)


def render_part(part: dict, overrides: dict[str, object], out_dir: Path) -> Path:
    params = {**part.get("defaults", {}), **overrides}
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
            typer.echo(f"  {part['id']:<28} [{part['confidence']}]  {part['name']}")


@app.command("render")
def render(
    part_id: str = typer.Argument(..., help="Catalogue id, e.g. gridfinity/base"),
    gx: int = typer.Option(None),
    gy: int = typer.Option(None),
    magnets: bool = typer.Option(None),
    screws: bool = typer.Option(None),
    bridge: float = typer.Option(None),
    out: Path = typer.Option(Path("out"), "-o", "--out"),
):
    """Render one catalogue part to STL."""
    catalogue = load_catalogue()
    part = find_part(catalogue, part_id)
    overrides = {}
    for name, value in [("gx", gx), ("gy", gy), ("magnets", magnets),
                         ("screws", screws), ("bridge", bridge)]:
        if value is not None:
            overrides[name] = value
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
        cmd = ["openscad", "--backend=Manifold", "--autocenter", "--viewall",
               "--colorscheme=Tomorrow", "--imgsize=640,480", "-o", str(png_path), str(stub)]
        result = subprocess.run(cmd, cwd=REPO_ROOT, env={**os.environ, "OPENSCADPATH": str(VENDOR_DIR)},
                                 capture_output=True, text=True)
        stub.unlink()
        if result.returncode != 0:
            typer.echo(result.stderr, err=True)
            raise typer.Exit(1)
        typer.echo(f"wrote {png_path}")


@app.command("readme")
def readme():
    """Regenerate the catalogue table in README.md from catalogue.yaml."""
    catalogue = load_catalogue()
    lines = ["| Part | System | Confidence | Print note |", "| --- | --- | --- | --- |"]
    for part in catalogue["parts"]:
        img = f"docs/img/{part['id'].replace('/', '_')}.png"
        cell = f"![{part['name']}]({img})<br>{part['name']}" if (REPO_ROOT / img).exists() else part["name"]
        lines.append(f"| {cell} | {part['system']} | {part['confidence']} | {part['print_note']} |")
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

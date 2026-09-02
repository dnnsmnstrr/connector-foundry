"""Connector Foundry CLI — wraps the openscad binary around catalogue.yaml.

    foundry list
    foundry render gridfinity/base --gx 2 --gy 1 --magnets -o out/
    foundry render assemblies/corner-bracket --part a -o out/
    foundry build --all
    foundry preview --all

    foundry defaults set gridfinity/base --magnets   # always render this on
    foundry defaults show gridfinity/base
    foundry settings set --fit-clearance 0.25        # printer runs tight
    foundry render gridfinity/base                   # picks both up automatically
    foundry render gridfinity/base --no-user-config  # true catalogue defaults (what CI does)

The module doubles as the library the test suite and tools import:
everything above the `# CLI` marker has no typer in its signatures and
raises OpenSCADError (a render failed) or typer.BadParameter (the input
named something that does not exist) rather than exiting the process.
"""
from __future__ import annotations

import functools
import json
import os
import re
import subprocess
import tempfile
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from pathlib import Path

import typer
import yaml

import userconfig

app = typer.Typer(add_completion=False, help=__doc__)

REPO_ROOT = Path(__file__).resolve().parent.parent
CATALOGUE_PATH = REPO_ROOT / "catalogue.yaml"
CONSTANTS_PATH = REPO_ROOT / "lib" / "constants.scad"
GOLDEN_PATH = REPO_ROOT / "tests" / "golden" / "dimensions.yaml"

# Every render needs --backend=Manifold, which the stable OpenSCAD
# release predates. Distributions that ship only the stable build usually
# also package the dev snapshot under another name, so let the binary be
# named rather than assuming "openscad" is the right one.
OPENSCAD_BIN = os.environ.get("OPENSCAD_BIN", "openscad")

# openscad flags that turn an STL export into the README gallery's PNG.
PREVIEW_ARGS = ("--autocenter", "--viewall", "--colorscheme=Tomorrow", "--imgsize=640,480")


class OpenSCADError(RuntimeError):
    """An `openscad` invocation failed. The message is its stderr, or why
    it could not be started at all."""


# ------------------------------------------------------------- catalogue

def load_catalogue() -> dict:
    return yaml.safe_load(CATALOGUE_PATH.read_text())


def find_part(catalogue: dict, part_id: str) -> dict:
    for part in catalogue["parts"]:
        if part["id"] == part_id:
            return part
    raise typer.BadParameter(f"Unknown part '{part_id}'. Run `foundry list`.")


def slug(part_id: str) -> str:
    """A part id as a filename stem: gridfinity/base -> gridfinity_base."""
    return part_id.replace("/", "_")


def catalogue_cases(catalogue: dict) -> Iterator[tuple[dict, dict, str]]:
    """Every (part, params, tag) the catalogue declares — defaults first,
    then each named variant. The one place that enumeration lives."""
    for part in catalogue["parts"]:
        yield part, {}, "default"
        for variant in part.get("variants", []):
            yield part, variant["params"], variant["name"]


# ------------------------------------------------------- OpenSCAD values

class Raw(str):
    """A value to emit into OpenSCAD verbatim rather than as a string.

    BOSL2 anchors are vectors bound to bare names (TOP is [0,0,1]), so
    passing anchor="TOP" gives OpenSCAD a string it cannot use. Raw("TOP")
    passes the name through.
    """


def openscad_value(value) -> str:
    """A Python value as an OpenSCAD literal.

    Strings go through json.dumps: OpenSCAD's string escapes (\\" and \\\\)
    are JSON's, so a value containing a quote arrives intact instead of
    ending the literal early. web/src/lib/scadLiteral.js does the same.
    """
    if isinstance(value, Raw):
        return str(value)
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (list, tuple)):
        return "[" + ", ".join(openscad_value(v) for v in value) + "]"
    return str(value)


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


# ------------------------------------------------------------ signatures

@functools.lru_cache(maxsize=None)
def _module_parameters(scad_file: str, module: str) -> tuple[str, ...]:
    source = (REPO_ROOT / scad_file).read_text()
    match = re.search(rf"\bmodule\s+{re.escape(module)}\s*\(", source)
    if not match:
        raise typer.BadParameter(f"no module {module}() in {scad_file}")

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
    return tuple(names)


def module_parameters(part: dict) -> list[str]:
    """The named parameters of a part's module, read from its source.

    OpenSCAD does not treat an unknown named argument as an error — it
    warns and carries on with the default, so `--set leg_height=20` on a
    module whose parameter is `leg_h` reports a successful render of
    something that ignored you entirely. The signature is the only real
    answer to what a part accepts, so read it (once per file/module —
    a build renders every part and this is called per render).
    """
    return list(_module_parameters(part["file"], part["module"]))


def constants_names() -> list[str]:
    """Top-level constant names declared in lib/constants.scad — the
    same idea as module_parameters(), applied to `foundry settings` so
    an unknown -D name is caught here instead of silently doing nothing
    at render time (OpenSCAD ignores a -D that names nothing)."""
    source = CONSTANTS_PATH.read_text()
    return re.findall(r"^([A-Za-z_][A-Za-z0-9_]*)\s*=", source, re.MULTILINE)


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


def resolve_params(part: dict, overrides: dict[str, object], use_user_config: bool) -> dict:
    """catalogue default -> saved user override -> this render's overrides.

    The one place this merge happens; see userconfig.py's module
    docstring for why the web app's resolveParams() has to agree with
    this order rather than being free to drift. Checked against the
    merged (user + this-render) set, not just this-render's overrides,
    so a saved override that's gone stale (e.g. a renamed parameter)
    surfaces as a clear error instead of OpenSCAD silently ignoring it.
    """
    user = userconfig.get_overrides(part["id"]) if use_user_config else {}
    check_parameters(part, {**user, **overrides})
    return {**part.get("defaults", {}), **user, **overrides}


# ------------------------------------------------------------- rendering

def openscad_env() -> dict[str, str]:
    """vendor/ on the OpenSCAD library path.

    Vendored upstreams written for the OpenSCAD library folder ask for
    their dependencies by library name (`include <BOSL2/std.scad>`)
    rather than by relative path, so vendor/ has to be searchable for
    those to resolve. Our own parts use relative includes and do not
    depend on this.
    """
    return {**os.environ, "OPENSCADPATH": str(REPO_ROOT / "vendor")}


def run_openscad(scad_file: Path, out_file: Path, params: dict[str, object],
                 extra_args: Sequence[str] = ()) -> None:
    """Render `scad_file` to `out_file` (format by extension) with each
    param passed as a -D override. Raises OpenSCADError on failure."""
    out_file.parent.mkdir(parents=True, exist_ok=True)
    cmd = [OPENSCAD_BIN, "--backend=Manifold", *extra_args, "-o", str(out_file)]
    for key, value in params.items():
        cmd += ["-D", f"{key}={openscad_value(value)}"]
    cmd.append(str(scad_file))
    try:
        result = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True,
                                env=openscad_env())
    except FileNotFoundError as exc:
        raise OpenSCADError(
            f"{OPENSCAD_BIN!r} not found. Install an OpenSCAD dev snapshot (the "
            f"Manifold backend needs one) or point OPENSCAD_BIN at it.") from exc
    if result.returncode != 0:
        raise OpenSCADError(
            result.stderr.strip() or f"openscad exited {result.returncode} without output")


def stub_source(part: dict, params: dict[str, object]) -> str:
    """The two-line .scad that renders one catalogue part: include its
    file, call its module with these parameters."""
    call_args = ", ".join(f"{k}={openscad_value(v)}" for k, v in params.items())
    return f'include <{REPO_ROOT / part["file"]}>\n{part["module"]}({call_args});\n'


@contextmanager
def _stub_file(part: dict, params: dict[str, object], out_dir: Path) -> Iterator[Path]:
    """Write the stub next to the output and remove it afterwards — on a
    failed render too, so a broken part does not leave a stray .scad
    behind for the next `git status` to find."""
    out_dir.mkdir(parents=True, exist_ok=True)
    stub = out_dir / f".{slug(part['id'])}_stub.scad"
    stub.write_text(stub_source(part, params))
    try:
        yield stub
    finally:
        stub.unlink(missing_ok=True)


def render_part(part: dict, overrides: dict[str, object], out_dir: Path,
                use_user_config: bool = False) -> Path:
    """Render one catalogue part to <out_dir>/<slug>.stl and return that path."""
    params = resolve_params(part, overrides, use_user_config)
    check_options(part, params)
    out_stl = out_dir / f"{slug(part['id'])}.stl"
    global_overrides = userconfig.get_global_overrides() if use_user_config else {}
    with _stub_file(part, params, out_dir) as stub:
        run_openscad(stub, out_stl, global_overrides)
    return out_stl


def render_preview(part: dict, out_dir: Path) -> Path:
    """Render one catalogue part at its defaults to <out_dir>/<slug>.png."""
    out_png = out_dir / f"{slug(part['id'])}.png"
    with _stub_file(part, part.get("defaults", {}), out_dir) as stub:
        run_openscad(stub, out_png, {}, extra_args=PREVIEW_ARGS)
    return out_png


# =================================================================== CLI

def _exits_on_render_failure(command):
    """A failed render is an error message and exit status 1, not a
    traceback. Library callers (the tests) still get the exception."""
    @functools.wraps(command)
    def wrapper(*args, **kwargs):
        try:
            return command(*args, **kwargs)
        except OpenSCADError as exc:
            typer.echo(str(exc), err=True)
            raise typer.Exit(1) from exc
    return wrapper


def parse_set_items(items: list[str] | None, metavar: str = "KEY=VALUE") -> dict[str, object]:
    """--set KEY=VALUE, repeatable, into {key: typed value}."""
    overrides: dict[str, object] = {}
    for item in items or []:
        if "=" not in item:
            raise typer.BadParameter(f"--set expects {metavar}, got {item!r}")
        key, _, raw = item.partition("=")
        overrides[key.strip()] = parse_scalar(raw.strip())
    return overrides


def _collect_overrides(gx, gy, magnets, screws, set_) -> dict[str, object]:
    overrides: dict[str, object] = {}
    for name, value in [("gx", gx), ("gy", gy), ("magnets", magnets), ("screws", screws)]:
        if value is not None:
            overrides[name] = value
    overrides.update(parse_set_items(set_))
    return overrides


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
@_exits_on_render_failure
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
    no_user_config: bool = typer.Option(
        False, "--no-user-config",
        help="Ignore saved `foundry defaults`/`foundry settings` and render at "
             "true catalogue values plus only what's passed here — what CI does."),
):
    """Render one catalogue part to STL.

    Applies your saved `foundry defaults`/`foundry settings` unless
    --no-user-config is given: catalogue default -> saved user default
    -> the flags passed here, in that order.
    """
    catalogue = load_catalogue()
    part = find_part(catalogue, part_id)
    overrides = _collect_overrides(gx, gy, magnets, screws, set_)
    stl_path = render_part(part, overrides, out, use_user_config=not no_user_config)
    typer.echo(f"wrote {stl_path}")


defaults_app = typer.Typer(add_completion=False, help=(
    "Persisted per-part parameter overrides, layered between catalogue.yaml's "
    "committed defaults and a single `render` call's flags — 'gridfinity should "
    "always have magnet holes on'. Applied automatically by `foundry render` "
    "(pass --no-user-config to skip); never applied to build/preview/goldens or "
    "the test suite, which always reflect true catalogue.yaml defaults. Saved as "
    "OpenSCAD Customizer JSON under ~/.config/connector-foundry/overrides/, one "
    "file per part, so it also opens as a parameter set in the OpenSCAD GUI."
))
app.add_typer(defaults_app, name="defaults")


@defaults_app.command("set")
def defaults_set(
    part_id: str = typer.Argument(..., help="Catalogue id, e.g. gridfinity/base"),
    gx: int = typer.Option(None),
    gy: int = typer.Option(None),
    magnets: bool = typer.Option(None),
    screws: bool = typer.Option(None),
    set_: list[str] = typer.Option(None, "--set", metavar="KEY=VALUE"),
):
    """Save (merging into any already saved) this part's user defaults."""
    catalogue = load_catalogue()
    part = find_part(catalogue, part_id)
    overrides = _collect_overrides(gx, gy, magnets, screws, set_)
    if not overrides:
        raise typer.BadParameter("nothing to save — pass at least one parameter")
    check_parameters(part, overrides)
    merged = userconfig.update_overrides(part_id, overrides)
    typer.echo(f"{part_id}: saved user default {merged}")


@defaults_app.command("show")
def defaults_show(part_id: str = typer.Argument(..., help="Catalogue id, e.g. gridfinity/base")):
    """Catalogue default, saved user override, and the effective merge."""
    catalogue = load_catalogue()
    part = find_part(catalogue, part_id)
    catalogue_defaults = part.get("defaults", {})
    user = userconfig.get_overrides(part_id)
    typer.echo(f"catalogue default: {catalogue_defaults}")
    typer.echo(f"user override:     {user or '(none)'}")
    typer.echo(f"effective:         {({**catalogue_defaults, **user})}")


@defaults_app.command("clear")
def defaults_clear(
    part_id: str = typer.Argument(..., help="Catalogue id, e.g. gridfinity/base"),
    param: list[str] = typer.Option(
        None, "--param", help="Clear only these; omit to clear every saved override for this part."),
):
    """Forget this part's saved user defaults (all, or just --param ones)."""
    userconfig.clear_overrides(part_id, param or None)
    typer.echo(f"{part_id}: cleared {'all' if not param else ', '.join(param)} saved override(s)")


@defaults_app.command("list")
def defaults_list():
    """Every part with a saved user override."""
    catalogue = load_catalogue()
    ids = userconfig.overridden_part_ids(catalogue)
    if not ids:
        typer.echo("no saved user defaults")
        return
    for part_id in ids:
        typer.echo(f"{part_id}: {userconfig.get_overrides(part_id)}")


settings_app = typer.Typer(add_completion=False, help=(
    "Persisted printer-level overrides — constants from lib/constants.scad, "
    "e.g. fit clearance ('my printer runs tight'). Same override layer and "
    "storage mechanism as `defaults`, just not scoped to one part: applied to "
    "every render regardless of which part it is."
))
app.add_typer(settings_app, name="settings")


@settings_app.command("set")
def settings_set(
    fit_clearance: float = typer.Option(None, help="Shorthand for --set FIT_CLEARANCE=..."),
    set_: list[str] = typer.Option(
        None, "--set", metavar="NAME=VALUE",
        help="Any constant from lib/constants.scad, repeatable."),
):
    """Save (merging into any already saved) printer-level constants."""
    overrides = parse_set_items(set_, metavar="NAME=VALUE")
    if fit_clearance is not None:
        overrides["FIT_CLEARANCE"] = fit_clearance
    if not overrides:
        raise typer.BadParameter("nothing to save — pass --fit-clearance or --set")
    known = constants_names()
    unknown = [k for k in overrides if k not in known]
    if unknown:
        raise typer.BadParameter(f"not a constant in lib/constants.scad: {', '.join(unknown)}")
    merged = userconfig.update_global_overrides(overrides)
    typer.echo(f"saved global settings: {merged}")


@settings_app.command("show")
def settings_show():
    """Every saved printer-level constant."""
    saved = userconfig.get_global_overrides()
    typer.echo(saved if saved else "no saved global settings")


@settings_app.command("clear")
def settings_clear(
    param: list[str] = typer.Option(
        None, "--param", help="Clear only these; omit to clear every saved global setting."),
):
    """Forget saved printer-level constants (all, or just --param ones)."""
    userconfig.clear_global_overrides(param or None)
    typer.echo(f"cleared {'all' if not param else ', '.join(param)} saved global setting(s)")


@app.command("build")
@_exits_on_render_failure
def build(all_: bool = typer.Option(False, "--all"), out: Path = typer.Option(Path("out"), "-o", "--out")):
    """Render every catalogue entry at defaults."""
    catalogue = load_catalogue()
    if not all_:
        typer.echo("pass --all to build the whole catalogue")
        raise typer.Exit(1)
    for part in catalogue["parts"]:
        stl_path = render_part(part, {}, out, use_user_config=False)
        typer.echo(f"wrote {stl_path}")


@app.command("preview")
@_exits_on_render_failure
def preview(all_: bool = typer.Option(False, "--all"), out: Path = typer.Option(Path("docs/img"), "-o", "--out")):
    """Render a PNG per catalogue entry, for the README gallery."""
    catalogue = load_catalogue()
    if not all_:
        typer.echo("pass --all to preview the whole catalogue")
        raise typer.Exit(1)
    for part in catalogue["parts"]:
        png_path = render_preview(part, out)
        typer.echo(f"wrote {png_path}")


@app.command("goldens")
@_exits_on_render_failure
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
            stl = render_part(part, params, Path(tmp) / tag, use_user_config=False)
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
        img = f"docs/img/{slug(part['id'])}.png"
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

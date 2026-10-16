"""catalogue.yaml's shape, checked without OpenSCAD.

The file is read by three programs — the CLI (PyYAML, YAML 1.1), the web
app's build (a YAML 1.2 parser) and these tests — and none of them
rejects a field it does not know: a misspelt `minimum:` or `print-note:`
is silently ignored everywhere, which is the same failure mode as a
misspelt module parameter (see test_catalogue.py). This file is the
schema the catalogue never had: which keys exist, which are required,
and what shape each value takes. The meaning of each field is in the
comment block at the top of catalogue.yaml; when adding a field there,
add it to KNOWN_KEYS here too.
"""

import math
import re

import foundry
import pytest
import yaml

CATALOGUE_TEXT = foundry.CATALOGUE_PATH.read_text()
CATALOGUE = yaml.safe_load(CATALOGUE_TEXT)

REQUIRED_KEYS = {"id", "name", "file", "module", "system", "confidence", "source", "print_note"}
# Every key some reader acts on: cli/foundry.py, tests/, and
# web/src + web/scripts (grep for part.<field>).
KNOWN_KEYS = REQUIRED_KEYS | {
    "anchors",
    "attached_defaults",
    "attached_up",
    "defaults",
    "hidden",
    "license",
    "maximums",
    "minimums",
    "mount_offset",
    "options",
    "resize",
    "screw_pattern",
    "side_slots",
    "slots",
    "source_url",
    "variants",
}
# "imported" is deliberately absent: it is a label the web Bench gives a
# user-dragged STL at runtime and is never written to this file.
CONFIDENCE = {"exact", "parametric", "unverified"}

# <system>/<name>: lower-case words joined by single "-" or "_". No "__"
# anywhere — cli/userconfig.py turns "/" into "__" for a filename and
# relies on that to keep the mapping one-to-one.
ID_RE = re.compile(r"^[a-z0-9]+(?:[-_][a-z0-9]+)*/[a-z0-9]+(?:[-_][a-z0-9]+)*$")
# Variant names become render filenames (tests/conftest.py, `foundry goldens`).
VARIANT_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def _parts() -> list[dict]:
    return CATALOGUE["parts"]


def _is_scalar(value) -> bool:
    return isinstance(value, (bool, int, float, str))


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def test_top_level_is_exactly_parts():
    assert isinstance(CATALOGUE, dict) and set(CATALOGUE) == {"parts"}, (
        f"catalogue.yaml's top level must be just `parts:`, got {sorted(CATALOGUE or {})}"
    )
    assert isinstance(CATALOGUE["parts"], list) and CATALOGUE["parts"]


def test_every_key_is_known_and_required_keys_are_present():
    problems = []
    for index, part in enumerate(_parts()):
        label = part.get("id", f"parts[{index}]")
        unknown = sorted(set(part) - KNOWN_KEYS)
        if unknown:
            problems.append(f"{label}: unknown key(s) {unknown} — a typo, or add it to KNOWN_KEYS")
        missing = sorted(REQUIRED_KEYS - set(part))
        if missing:
            problems.append(f"{label}: missing required key(s) {missing}")
        for key in REQUIRED_KEYS & set(part):
            if not isinstance(part[key], str) or not part[key].strip():
                problems.append(f"{label}: {key} must be a non-empty string")
    assert not problems, "\n".join(problems)


def test_ids_are_unique_and_shaped():
    ids = [part["id"] for part in _parts()]
    duplicates = sorted({i for i in ids if ids.count(i) > 1})
    assert not duplicates, f"duplicate part ids: {duplicates}"
    malformed = [i for i in ids if not ID_RE.match(i)]
    assert not malformed, f"ids must look like system/name in lower case: {malformed}"


def test_one_display_system_per_id_prefix():
    """The web app groups by `system` and the CLI's slugs by id prefix;
    two spellings of one system would split it into two groups."""
    systems: dict[str, set[str]] = {}
    for part in _parts():
        systems.setdefault(part["id"].split("/")[0], set()).add(part["system"])
    split = {prefix: sorted(names) for prefix, names in systems.items() if len(names) > 1}
    assert not split, f"id prefixes with more than one `system`: {split}"


def test_files_exist_and_confidence_is_known():
    problems = []
    for part in _parts():
        if not (foundry.REPO_ROOT / part["file"]).is_file():
            problems.append(f"{part['id']}: file {part['file']} does not exist")
        if part["confidence"] not in CONFIDENCE:
            problems.append(
                f"{part['id']}: confidence {part['confidence']!r} is not one of {sorted(CONFIDENCE)}"
            )
        if "hidden" in part and not isinstance(part["hidden"], bool):
            problems.append(f"{part['id']}: hidden must be true or false")
        if "license" in part and not isinstance(part["license"], str):
            problems.append(f"{part['id']}: license must be a string")
        if "source_url" in part and not str(part["source_url"]).startswith(("https://", "http://")):
            problems.append(f"{part['id']}: source_url must be an http(s) URL")
    assert not problems, "\n".join(problems)


def _param_map_problems(label: str, params) -> list[str]:
    if not isinstance(params, dict):
        return [f"{label} must be a map of parameter -> value"]
    return [
        f"{label}.{key} = {value!r} is not a scalar (number, string or boolean)"
        for key, value in params.items()
        if not _is_scalar(value)
    ]


def test_defaults_and_variant_params_are_maps_of_scalars():
    problems = []
    for part in _parts():
        for field in ("defaults", "attached_defaults"):
            if field in part:
                problems += _param_map_problems(f"{part['id']}: {field}", part[field])
        for variant in part.get("variants", []):
            problems += _param_map_problems(
                f"{part['id']}: variant {variant.get('name')!r} params", variant.get("params")
            )
    assert not problems, "\n".join(problems)


def test_variants_are_well_formed():
    problems = []
    for part in _parts():
        variants = part.get("variants", [])
        if not isinstance(variants, list):
            problems.append(f"{part['id']}: variants must be a list")
            continue
        names = []
        for variant in variants:
            if not isinstance(variant, dict) or set(variant) != {"name", "params"}:
                problems.append(f"{part['id']}: a variant has exactly `name` and `params`, got {variant!r}")
                continue
            name = variant["name"]
            names.append(name)
            if not isinstance(name, str) or not VARIANT_NAME_RE.match(name):
                problems.append(f"{part['id']}: variant name {name!r} is not filename-safe")
            elif name == "default":
                # catalogue_cases() already yields the defaults under that tag.
                problems.append(f"{part['id']}: variant name 'default' is reserved")
        duplicates = sorted({n for n in names if names.count(n) > 1})
        if duplicates:
            problems.append(f"{part['id']}: duplicate variant names {duplicates}")
    assert not problems, "\n".join(problems)


def test_options_minimums_and_maximums_are_shaped():
    problems = []
    for part in _parts():
        defaults = part.get("defaults", {})
        for key, allowed in part.get("options", {}).items():
            if not isinstance(allowed, list) or not allowed or not all(_is_scalar(a) for a in allowed):
                problems.append(f"{part['id']}: options.{key} must be a non-empty list of scalars")
            elif key in defaults and defaults[key] not in allowed:
                problems.append(
                    f"{part['id']}: options.{key} {allowed} does not contain the default {defaults[key]!r}"
                )
        for field in ("minimums", "maximums"):
            limits = part.get(field, {})
            if not isinstance(limits, dict):
                problems.append(f"{part['id']}: {field} must be a map")
                continue
            for key, limit in limits.items():
                if not _is_number(limit):
                    problems.append(f"{part['id']}: {field}.{key} = {limit!r} is not a number")
    assert not problems, "\n".join(problems)


# `resize`: the web app's resize handles (see the catalogue.yaml header).
# `xy` is one parameter growing X and Y together, so it replaces both.
RESIZE_AXES = {"x", "y", "z", "xy"}
RESIZE_ENTRY_KEYS = {"param", "per", "step", "min", "max", "when"}


def _resize_entry_problems(label: str, entry, part: dict) -> list[str]:
    if not isinstance(entry, dict):
        return [f"{label} must be a map with at least `param`, got {entry!r}"]
    problems = []
    unknown = sorted(set(entry) - RESIZE_ENTRY_KEYS)
    if unknown:
        problems.append(f"{label}: unknown key(s) {unknown}, not one of {sorted(RESIZE_ENTRY_KEYS)}")
    defaults = part.get("defaults", {})
    options = part.get("options", {})
    param = entry.get("param")
    # The handle measures the current size and adds `per` per unit, so it
    # needs a number to add to; a bool default reads as 0 or 1 in Python.
    if not isinstance(param, str):
        problems.append(f"{label}: param must name a parameter, got {param!r}")
    elif not _is_number(defaults.get(param)):
        problems.append(f"{label}: param {param!r} has no number default to resize from")
    for field in ("per", "step", "min", "max"):
        # YAML's .inf is a number to both parsers; an unbounded handle
        # leaves `max` out instead.
        if field in entry and not (_is_number(entry[field]) and 0 < entry[field] < math.inf):
            problems.append(f"{label}: {field} must be a finite number over 0, got {entry[field]!r}")
    low, high = entry.get("min"), entry.get("max")
    if _is_number(low) and _is_number(high) and low >= high:
        problems.append(f"{label}: min {low} is not under max {high}")
    when = entry.get("when")
    if when is None:
        return problems
    if not isinstance(when, dict) or not when:
        return [*problems, f"{label}: when must be a non-empty map of parameter -> value, got {when!r}"]
    for key, value in when.items():
        if key == param:
            problems.append(f"{label}: when tests {key!r}, the parameter the handle itself changes")
        elif key not in defaults:
            problems.append(f"{label}: when names {key!r}, which has no default")
        elif not _is_scalar(value):
            problems.append(f"{label}: when.{key} = {value!r} is not a scalar")
        elif _kind(value) != _kind(defaults[key]):
            # resize.js compares with ===, so `when: {flat_edges: 1}` never
            # matches a true, though Python's 1 == True says it does.
            problems.append(
                f"{label}: when.{key} = {value!r} is a {_kind(value)}, but its default "
                f"{defaults[key]!r} is a {_kind(defaults[key])}"
            )
        elif key in options and value not in options[key]:
            problems.append(f"{label}: when.{key} = {value!r} is not one of its options {options[key]}")
    return problems


def _kind(value) -> str:
    return "bool" if isinstance(value, bool) else "number" if _is_number(value) else type(value).__name__


def _exclusive(a: dict, b: dict) -> bool:
    """Whether two `when` maps can never both hold: some parameter they
    both test has a different value in each."""
    return any(k in b and (_kind(v), v) != (_kind(b[k]), b[k]) for k, v in a.items())


def _repeated_resize_axes(text: str) -> list[str]:
    """Axes a `resize` map names twice. PyYAML keeps the last of two equal
    keys without a word (js-yaml, in the web build, refuses the whole
    file), so the parsed catalogue cannot show this: read the node tree."""
    problems = []
    root = yaml.compose(text)
    parts = next(value for key, value in root.value if key.value == "parts")
    for part in parts.value:
        fields = {key.value: value for key, value in part.value}
        resize = fields.get("resize")
        if not isinstance(resize, yaml.MappingNode):
            continue
        axes = [key.value for key, _ in resize.value]
        repeated = sorted({a for a in axes if axes.count(a) > 1})
        if repeated:
            problems.append(f"{fields['id'].value}: resize names {repeated} more than once")
    return problems


def _resize_problems(part: dict) -> list[str]:
    resize = part["resize"]
    if not isinstance(resize, dict) or not resize:
        return [f"{part['id']}: resize must be a non-empty map of axis -> entry"]
    problems = []
    unknown = sorted(set(resize) - RESIZE_AXES)
    if unknown:
        problems.append(f"{part['id']}: resize axis {unknown} is not one of {sorted(RESIZE_AXES)}")
    if "xy" in resize and {"x", "y"} & set(resize):
        problems.append(f"{part['id']}: resize has xy, which already drives x and y")
    for axis, entry in resize.items():
        problems += _resize_entry_problems(f"{part['id']}: resize.{axis}", entry, part)
    # Two handles on one parameter at once would fight over it: a corner
    # drag sets it from the X and the Y size in the same gesture. The 2020
    # rail's len is X or Z, never both, because the `when`s exclude each
    # other; a diameter is what `xy` is for.
    entries = [(axis, e) for axis, e in resize.items() if isinstance(e, dict)]
    for i, (axis_a, a) in enumerate(entries):
        for axis_b, b in entries[i + 1 :]:
            if a.get("param") != b.get("param"):
                continue
            when_a, when_b = a.get("when"), b.get("when")
            if isinstance(when_a, dict) and isinstance(when_b, dict) and _exclusive(when_a, when_b):
                continue
            problems.append(
                f"{part['id']}: resize.{axis_a} and resize.{axis_b} both drive {a.get('param')!r} at "
                "once — give them `when`s that exclude each other, or use xy for a diameter"
            )
    return problems


def test_resize_is_shaped():
    """`resize` is read by the web app alone, which trusts it: a typo'd
    key there is ignored and a stray string `per` turns a drag into NaN.
    tests/test_catalogue.py holds the bounds to the defaults, and
    tests/test_resize.py the slopes to the geometry."""
    problems = _repeated_resize_axes(CATALOGUE_TEXT)
    for part in _parts():
        if "resize" in part:
            problems += _resize_problems(part)
    assert not problems, "\n".join(problems)


@pytest.mark.parametrize(
    ("resize", "complaint"),
    [
        ({"x": {"param": "w"}}, None),
        ({"xy": {"param": "w"}, "z": {"param": "d"}}, None),
        ({"xy": {"param": "w"}, "x": {"param": "d"}}, "already drives x and y"),
        ({"w": {"param": "w"}}, "is not one of"),
        ({}, "non-empty map"),
        ({"x": {"param": "r"}}, "has no number default"),
        ({"x": {"param": "flag"}}, "has no number default"),
        ({"x": {"param": "w", "per": 0}}, "per must be a finite number over 0"),
        ({"x": {"param": "w", "per": "42"}}, "per must be a finite number over 0"),
        ({"x": {"param": "w", "min": 9, "max": 9}}, "is not under max"),
        ({"x": {"param": "w", "pitch": 1}}, "unknown key"),
        ({"x": {"param": "w", "when": {"kind": "a"}}}, None),
        ({"x": {"param": "w", "when": {"kind": "c"}}}, "is not one of its options"),
        ({"x": {"param": "w", "when": {"w": 1}}}, "the handle itself changes"),
        ({"x": {"param": "w", "when": {"nope": 1}}}, "which has no default"),
        ({"x": "w"}, "must be a map"),
        ({"x": {"param": "w", "max": float("inf")}}, "max must be a finite number"),
        ({"x": {"param": "w", "when": {"flag": True}}}, None),
        ({"x": {"param": "w", "when": {"flag": 1}}}, "is a number, but its default"),
        ({"x": {"param": "w", "when": {"kind": 1}}}, "is a number, but its default"),
        ({"x": {"param": "w"}, "y": {"param": "w"}}, "both drive 'w' at once"),
        ({"x": {"param": "w", "when": {"kind": "a"}}, "z": {"param": "w"}}, "both drive"),
        (
            {"x": {"param": "w", "when": {"kind": "a"}}, "z": {"param": "w", "when": {"kind": "a"}}},
            "both drive",
        ),
        ({"x": {"param": "w", "when": {"kind": "a"}}, "z": {"param": "w", "when": {"kind": "b"}}}, None),
        (
            {"x": {"param": "w", "when": {"flag": True}}, "z": {"param": "w", "when": {"kind": "b"}}},
            "both drive",
        ),
    ],
)
def test_the_resize_shape_check_itself(resize, complaint):
    part = {
        "id": "test/part",
        "defaults": {"w": 10, "d": 5, "flag": True, "kind": "a"},
        "options": {"kind": ["a", "b"]},
        "resize": resize,
    }
    problems = _resize_problems(part)
    if complaint is None:
        assert not problems, problems
    else:
        assert any(complaint in p for p in problems), problems


def test_repeated_resize_axes_are_caught():
    text = "parts:\n  - id: a/b\n    resize:\n      x: { param: w }\n      x: { param: d }\n"
    assert _repeated_resize_axes(text) == ["a/b: resize names ['x'] more than once"]


# ------------------------------------------------- YAML 1.1 vs 1.2 guard

# A plain scalar that YAML 1.1 (PyYAML, the CLI) and YAML 1.2 (the web
# build) read as different types. `on`/`yes` are booleans to PyYAML and
# strings to a 1.2 parser; `y`/`n` are strings to PyYAML but booleans in
# the 1.1 spec other tools follow; `1e3` is a string to PyYAML (its float
# needs a dot and a signed exponent) but 1000 in 1.2. Quoting makes
# every reader agree.
YAML11_BOOL_WORDS = {"yes", "no", "on", "off", "y", "n"}
# ...except `y`/`n` as mapping keys: mount_offset's documented schema is
# `{x: ..., y: ...}`, and both parsers actually in use (PyYAML and the
# web build's 1.2 parser) read a bare `y` as the string "y".
KEY_SAFE_WORDS = {"y", "n"}
YAML12_INT = re.compile(r"^(?:[-+]?[0-9]+|0o[0-7]+|0x[0-9a-fA-F]+)$")
YAML12_FLOAT = re.compile(
    r"^(?:[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?"
    r"|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$"
)
YAML11_OCTAL = re.compile(r"^[-+]?0[0-9_]+$")
STR_TAG = "tag:yaml.org,2002:str"
NUMBER_TAGS = {"tag:yaml.org,2002:int", "tag:yaml.org,2002:float"}


def ambiguous_scalars(text: str) -> list[str]:
    """Each plain scalar in `text` whose type depends on the YAML version,
    as "line N: value — why"."""
    problems = []
    stack = [(yaml.compose(text), False)]
    while stack:
        node, is_key = stack.pop()
        if node is None:
            continue
        if isinstance(node, yaml.MappingNode):
            for key, value in node.value:
                stack += [(key, True), (value, False)]
            continue
        if isinstance(node, yaml.SequenceNode):
            stack += [(item, False) for item in node.value]
            continue
        if node.style is not None:  # quoted or block: a string to everyone
            continue
        value, where = node.value, f"line {node.start_mark.line + 1}: {node.value!r}"
        if value.lower() in YAML11_BOOL_WORDS and not (is_key and value.lower() in KEY_SAFE_WORDS):
            problems.append(f"{where} is a boolean in YAML 1.1 and a string in 1.2 — quote it")
        elif node.tag == STR_TAG and (YAML12_INT.match(value) or YAML12_FLOAT.match(value)):
            problems.append(f"{where} is a string to PyYAML but a number in YAML 1.2 — quote it")
        elif node.tag in NUMBER_TAGS and (
            YAML11_OCTAL.match(value) or not (YAML12_INT.match(value) or YAML12_FLOAT.match(value))
        ):
            # 1_000, 1:30, 0b11: numbers only to a 1.1 parser; 010 is 8
            # to it and 10 to a 1.2 one.
            problems.append(f"{where} is a number only in YAML 1.1 — quote it or write it plainly")
    return sorted(problems)


def test_no_scalar_changes_type_between_yaml_versions():
    problems = ambiguous_scalars(CATALOGUE_TEXT)
    assert not problems, "catalogue.yaml:\n" + "\n".join(problems)


@pytest.mark.parametrize(
    ("snippet", "flagged"),
    [
        ("a: on", True),
        ("a: Yes", True),
        ("a: n", True),
        ("y: 1", False),
        ("on: 1", True),
        ("a: 1e3", True),
        ("a: 0o17", True),
        ("a: 1_000", True),
        ("a: 010", True),
        ("a: 'on'", False),
        ('a: "1e3"', False),
        ("a: 1.5e3", True),
        ("a: 1.5e+3", False),
        ("a: 12", False),
        ("a: true", False),
        ("a: lite", False),
    ],
)
def test_the_yaml_version_guard_itself(snippet, flagged):
    assert bool(ambiguous_scalars(snippet)) is flagged, ambiguous_scalars(snippet)

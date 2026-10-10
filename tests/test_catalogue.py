"""The catalogue has to describe the modules that actually exist.

catalogue.yaml drives the CLI, the web app's parameter form, the golden
dimensions and the README. Nothing in OpenSCAD enforces that a parameter
named there is a parameter the module takes: an unknown named argument
is a warning, not an error, and the render proceeds with the default. So
a typo in this file does not fail anywhere — it quietly produces the
wrong part, and every test that only checks the part renders will pass.
"""
import pytest
import typer

import foundry

# The face anchors web/src/lib/slots.js knows how to place — the only
# names catalogue.yaml's `anchors` field may use (see FACE_ANCHOR_LOCAL).
FACE_ANCHORS = {"bot", "xpos", "xneg", "ypos", "yneg"}

# Screw patterns web/src/lib/assembly.js has a generated flange for.
SCREW_PATTERNS = {"deckmate"}


def _parts():
    return foundry.load_catalogue()["parts"]


def test_declared_parameters_exist_on_the_module():
    problems = []
    for part in _parts():
        known = set(foundry.module_parameters(part))
        declared = {
            "defaults": part.get("defaults", {}).keys(),
            "options": part.get("options", {}).keys(),
            "minimums": part.get("minimums", {}).keys(),
            "attached_defaults": part.get("attached_defaults", {}).keys(),
        }
        for variant in part.get("variants", []):
            declared[f"variant {variant['name']}"] = variant["params"].keys()

        for where, keys in declared.items():
            for key in keys:
                if key not in known:
                    problems.append(
                        f"{part['id']} [{where}]: {key!r} is not a parameter of "
                        f"{part['module']}() — it accepts {sorted(known)}")
    assert not problems, "\n".join(problems)


def test_option_lists_agree_with_defaults_and_variants():
    """`options` drives the web app's dropdowns and the CLI's validation,
    so it has to stay in step with the values the catalogue itself uses.
    A list that has drifted from its default is worse than no list: it
    offers a menu that excludes what you actually get."""
    problems = []
    for part in _parts():
        options = part.get("options", {})
        defaults = part.get("defaults", {})
        for key, allowed in options.items():
            if key not in defaults:
                problems.append(f"{part['id']}: options list {key!r}, which has no default")
            elif defaults[key] not in allowed:
                problems.append(
                    f"{part['id']}: default {key}={defaults[key]!r} is not in {allowed}")
        for variant in part.get("variants", []):
            for key, value in variant["params"].items():
                if key in options and value not in options[key]:
                    problems.append(
                        f"{part['id']} [{variant['name']}]: {key}={value!r} "
                        f"is not in {options[key]}")
        # `attached_up` is an [x, y] axis the Bench turns up on a side face.
        up = part.get("attached_up")
        if up is not None and not (
                isinstance(up, list) and len(up) == 2 and all(_is_mm(v) for v in up) and any(up)):
            problems.append(f"{part['id']}: attached_up must be a non-zero [x, y], got {up!r}")
        # `attached_defaults` is the same kind of promise as `defaults`:
        # the Bench hands these values to the module unchecked.
        for key, value in part.get("attached_defaults", {}).items():
            if key not in defaults:
                problems.append(f"{part['id']}: attached_defaults {key!r} has no default")
            elif key in options and value not in options[key]:
                problems.append(
                    f"{part['id']}: attached default {key}={value!r} is not in {options[key]}")
    assert not problems, "\n".join(problems)


def test_minimums_hold_for_defaults_and_variants():
    """`minimums` stops the web field and the CLI at a floor; the
    catalogue's own values must not sit under it, or its default would be
    a value the editor refuses."""
    problems = []
    for part in _parts():
        minimums = part.get("minimums", {})
        defaults = part.get("defaults", {})
        values = [("default", defaults), ("attached default", part.get("attached_defaults", {}))]
        values += [(f"variant {v['name']}", v["params"]) for v in part.get("variants", [])]
        for key, floor in minimums.items():
            if not _is_mm(floor):
                problems.append(f"{part['id']}: minimum {key}={floor!r} is not a number")
            elif not _is_mm(defaults.get(key)):
                problems.append(f"{part['id']}: minimum for {key!r}, which has no number default")
            for where, params in values:
                if key in params and _is_mm(params[key]) and params[key] < floor:
                    problems.append(f"{part['id']} [{where}]: {key}={params[key]} is under its minimum {floor}")
    assert not problems, "\n".join(problems)


def test_check_minimums_rejects_a_value_under_the_floor():
    female = next(p for p in _parts() if p["id"] == "gopro/female")
    foundry.check_minimums(female, {"outer_w": 3})
    with pytest.raises(typer.BadParameter, match="outer_w=2.5 is under its minimum of 3"):
        foundry.check_minimums(female, {"outer_w": 2.5})


def test_slot_count_params_are_real_defaults():
    """`slots.count_params`, when present, names the two parameters whose
    values the web editor reads as the slot grid's (nx, ny) — a typo'd
    or stale name here would make the editor enumerate the wrong grid
    (or crash) without any render ever failing. tests/test_slots.py
    checks the pitch/count against the geometry; this just checks the
    two names actually resolve to something."""
    problems = []
    for part in _parts():
        count_params = part.get("slots", {}).get("count_params")
        if not count_params:
            continue
        if len(count_params) != 2:
            problems.append(f"{part['id']}: slots.count_params must name exactly 2 params, got {count_params!r}")
            continue
        for key in count_params:
            if key not in part.get("defaults", {}):
                problems.append(f"{part['id']}: slots.count_params names {key!r}, which has no default")
    assert not problems, "\n".join(problems)


def test_side_slot_params_are_real_parameters():
    """`side_slots.faces[].enabled_param`/`count_param` point at the
    part's own module parameters the same way count_params does; the web
    editor reads them to decide which side rows exist right now."""
    problems = []
    for part in _parts():
        for face in part.get("side_slots", {}).get("faces", []):
            known = set(foundry.module_parameters(part))
            for field in ("enabled_param", "count_param"):
                name = face.get(field)
                if name is None:
                    problems.append(f"{part['id']}: side_slots face {face.get('name')!r} has no {field}")
                elif name not in known:
                    problems.append(
                        f"{part['id']}: side_slots face {face.get('name')!r} {field}={name!r} "
                        f"is not a parameter of {part['module']}()")
    assert not problems, "\n".join(problems)


def _is_mm(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _mount_offset_problems(part: dict) -> list[str]:
    """The shapes catalogue.yaml's schema comment allows for
    `mount_offset`: a fixed [x, y], or a map of x/y to a number or a
    `{param, scale, unless}` naming real parameters of the module (a
    typo there would make slots.js place the marker from an undefined
    value — the same class of bug test_declared_parameters_exist_on_the_module
    catches for defaults)."""
    offset = part.get("mount_offset")
    if offset is None:
        return []
    if isinstance(offset, list):
        if len(offset) == 2 and all(_is_mm(v) for v in offset):
            return []
        return [f"{part['id']}: mount_offset must be [x, y] in mm, got {offset!r}"]
    if not isinstance(offset, dict) or not offset or set(offset) - {"x", "y"}:
        return [f"{part['id']}: mount_offset must be [x, y] or a map of x/y, got {offset!r}"]
    known = set(foundry.module_parameters(part))
    defaults = part.get("defaults", {})
    problems = []
    for axis, expr in offset.items():
        if _is_mm(expr):
            continue
        if not isinstance(expr, dict) or "param" not in expr or set(expr) - {"param", "offset", "scale", "unless"}:
            problems.append(f"{part['id']}: mount_offset.{axis} must be a number or {{param, offset, scale, unless}}, got {expr!r}")
            continue
        for field in ("param", "unless"):
            name = expr.get(field)
            if name is None:
                continue
            if name not in known:
                problems.append(f"{part['id']}: mount_offset.{axis} {field}={name!r} is not a parameter of {part['module']}()")
            elif name not in defaults:
                problems.append(f"{part['id']}: mount_offset.{axis} {field}={name!r} has no catalogue default to evaluate from")
        for field in ("offset", "scale"):
            if field in expr and not _is_mm(expr[field]):
                problems.append(f"{part['id']}: mount_offset.{axis} {field} must be a number, got {expr[field]!r}")
    return problems


def test_screw_pattern_and_mount_offset_are_well_formed():
    """`screw_pattern` names a flange the web editor can generate;
    `mount_offset` has one of the two shapes the schema allows (the
    "mount"/"bot" anchors' position relative to the bounding-box center,
    fixed or evaluated from the part's parameters). tests/test_anchors.py
    checks the offset against the rendered geometry; this only checks
    the shape."""
    problems = []
    for part in _parts():
        pattern = part.get("screw_pattern")
        if pattern is not None and pattern not in SCREW_PATTERNS:
            problems.append(f"{part['id']}: screw_pattern {pattern!r} is not one of {sorted(SCREW_PATTERNS)}")
        problems.extend(_mount_offset_problems(part))
    assert not problems, "\n".join(problems)


def test_mount_offset_evaluates_as_documented():
    """The GoPro female's offset is the worked example of the parameter
    form: half of what the far leg has over a standard 3mm one, gone when
    the buckle is symmetric.
    Pins cli/foundry.py's mount_offset() to the schema comment's meaning."""
    female = next(p for p in _parts() if p["id"] == "gopro/female")
    assert foundry.mount_offset(female) == (0.0, 1.5)
    assert foundry.mount_offset(female, {"outer_w": 3}) == (0.0, 0.0)
    assert foundry.mount_offset(female, {"outer_w": 7}) == (0.0, 2.0)
    assert foundry.mount_offset(female, {"symmetric": True}) == (0.0, 0.0)
    fixed = next(p for p in _parts() if isinstance(p.get("mount_offset"), list))
    assert foundry.mount_offset(fixed, {"anything": 1}) == tuple(float(v) for v in fixed["mount_offset"])
    assert foundry.mount_offset({"id": "x"}) == (0.0, 0.0)


def test_declared_anchors_are_placeable():
    """catalogue.yaml's `anchors` lists face names the web editor turns
    into positions by formula (the center of that face of the bounding
    box). A name outside that set has no formula, so the editor could
    not place it — better caught here than as a marker that never shows."""
    problems = [
        f"{part['id']}: anchors names {name!r}, not one of {sorted(FACE_ANCHORS)}"
        for part in _parts()
        for name in part.get("anchors", [])
        if name not in FACE_ANCHORS
    ]
    assert not problems, "\n".join(problems)

"""The catalogue has to describe the modules that actually exist.

catalogue.yaml drives the CLI, the web app's parameter form, the golden
dimensions and the README. Nothing in OpenSCAD enforces that a parameter
named there is a parameter the module takes: an unknown named argument
is a warning, not an error, and the render proceeds with the default. So
a typo in this file does not fail anywhere — it quietly produces the
wrong part, and every test that only checks the part renders will pass.
"""
import foundry

# The face anchors web/src/lib/slots.js knows how to place — the only
# names catalogue.yaml's `anchors` field may use (see FACE_ANCHOR_LOCAL).
FACE_ANCHORS = {"bot", "xpos", "xneg", "ypos", "yneg"}


def _parts():
    return foundry.load_catalogue()["parts"]


def test_declared_parameters_exist_on_the_module():
    problems = []
    for part in _parts():
        known = set(foundry.module_parameters(part))
        declared = {
            "defaults": part.get("defaults", {}).keys(),
            "options": part.get("options", {}).keys(),
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
    assert not problems, "\n".join(problems)


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

"""The catalogue has to describe the modules that actually exist.

catalogue.yaml drives the CLI, the web app's parameter form, the golden
dimensions and the README. Nothing in OpenSCAD enforces that a parameter
named there is a parameter the module takes: an unknown named argument
is a warning, not an error, and the render proceeds with the default. So
a typo in this file does not fail anywhere — it quietly produces the
wrong part, and every test that only checks the part renders will pass.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "cli"))

import foundry  # noqa: E402


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

"""What the CLI writes into OpenSCAD source and -D flags, and how it
stores user overrides — none of it needs OpenSCAD to check.

openscad_value() and openscad_identifier() mirror
web/src/lib/scadLiteral.js's scadLiteral() and scadIdentifier(): a value
that cannot be written faithfully is refused, never turned into text
OpenSCAD would read as something else (usually undef, silently).
"""

import json
import math

import foundry
import pytest
import typer
import userconfig

# ------------------------------------------------------------ literals


@pytest.mark.parametrize(
    ("value", "literal"),
    [
        (True, "true"),
        (3, "3"),
        (2.5, "2.5"),
        ("lite", '"lite"'),
        ('a "quoted" \\ value', '"a \\"quoted\\" \\\\ value"'),
        ("tab\there\nnewline", '"tab\\there\\nnewline"'),
        ([1, "a", [False]], '[1, "a", [false]]'),
        (None, "undef"),
        (foundry.Raw("TOP"), "TOP"),
    ],
)
def test_openscad_value_writes_faithful_literals(value, literal):
    assert foundry.openscad_value(value) == literal


def test_control_characters_are_dropped_not_escaped():
    # json.dumps would write \u0001 / \b / \f, none of which OpenSCAD reads.
    assert foundry.openscad_value("a\x01b\x08c\x0cd\x7fe") == '"abcde"'


def test_lone_surrogates_are_replaced():
    assert foundry.openscad_value("a\ud800b") == '"a�b"'


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf, [1, math.nan]])
def test_non_finite_numbers_are_refused(value):
    with pytest.raises(typer.BadParameter, match="finite"):
        foundry.openscad_value(value)


@pytest.mark.parametrize("value", [{"a": 1}, {1, 2}, object(), b"bytes"])
def test_values_without_a_literal_are_refused(value):
    with pytest.raises(typer.BadParameter, match="no OpenSCAD literal"):
        foundry.openscad_value(value)


# --------------------------------------------------------- identifiers


@pytest.mark.parametrize("name", ["gx", "_x", "$fn", "FIT_CLEARANCE", "a1$"])
def test_identifiers_pass(name):
    assert foundry.openscad_identifier(name) == name


@pytest.mark.parametrize("name", ["", "1x", "x y", "x=1);evil(", "a-b", "é", 3])
def test_non_identifiers_are_refused(name):
    with pytest.raises(typer.BadParameter, match="not a valid OpenSCAD parameter name"):
        foundry.openscad_identifier(name)


def test_stub_source_refuses_a_bad_parameter_name():
    part = {"file": "parts/x.scad", "module": "m"}
    with pytest.raises(typer.BadParameter):
        foundry.stub_source(part, {"x=1);evil(": 1})


def test_set_items_refuse_bad_names_and_non_finite_values():
    assert foundry.parse_set_items(["gx = 2", "variant=lite"]) == {"gx": 2, "variant": "lite"}
    with pytest.raises(typer.BadParameter):
        foundry.parse_set_items(["a);evil(b=2"])
    with pytest.raises(typer.BadParameter, match="finite"):
        foundry.parse_set_items(["gx=nan"])
    with pytest.raises(typer.BadParameter, match="finite"):
        foundry.parse_set_items(["gx=-inf"])


def test_run_openscad_refuses_a_bad_define_name(tmp_path):
    with pytest.raises(typer.BadParameter):
        foundry.run_openscad(tmp_path / "a.scad", tmp_path / "a.stl", {"A;B": 1})


# ------------------------------------------------- signature scanning


def test_signature_scan_ignores_comments_and_strings():
    source = (
        "// module m(wrong)\n"
        "/* module m(also, wrong) */\n"
        'module m(a = "x, (y", b = [1, 2] /* c, */, // d,\n'
        "  e = f(1, 2)) {}\n"
    )
    stripped = foundry._strip_comments_and_strings(source)
    assert "wrong" not in stripped and "(y" not in stripped
    assert stripped.count("\n") == source.count("\n")


# ---------------------------------------------------------- userconfig


@pytest.fixture
def config_home(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    return tmp_path / "connector-foundry" / "overrides"


def test_empty_xdg_config_home_means_the_default(monkeypatch, tmp_path):
    monkeypatch.setenv("XDG_CONFIG_HOME", "")
    monkeypatch.setenv("HOME", str(tmp_path))
    assert userconfig.config_dir() == tmp_path / ".config" / "connector-foundry"


def test_part_ids_map_to_distinct_files(config_home):
    userconfig.update_overrides("a/b_c", {"x": 1})
    userconfig.update_overrides("a_b/c", {"x": 2})
    assert userconfig.get_overrides("a/b_c") == {"x": 1}
    assert userconfig.get_overrides("a_b/c") == {"x": 2}


def test_legacy_filename_is_read_and_migrated(config_home):
    config_home.mkdir(parents=True)
    legacy = config_home / "gridfinity_base.json"
    legacy.write_text(json.dumps({"parameterSets": {"user-default": {"gx": 4}}}))
    assert userconfig.get_overrides("gridfinity/base") == {"gx": 4}
    assert userconfig.update_overrides("gridfinity/base", {"gy": 2}) == {"gx": 4, "gy": 2}
    assert not legacy.exists()
    assert (config_home / "gridfinity__base.json").exists()


@pytest.mark.parametrize(
    "content",
    ["{broken", "[]", '{"parameterSets": []}', '{"parameterSets": {"user-default": [1]}}'],
)
def test_a_malformed_file_reads_as_empty_but_is_never_overwritten(config_home, content):
    config_home.mkdir(parents=True)
    path = config_home / "gridfinity__base.json"
    path.write_text(content)
    # Rendering degrades to "no overrides" (the web side likewise ignores
    # a stored set that is not a plain object) ...
    assert userconfig.get_overrides("gridfinity/base") == {}
    # ... but saving into it would throw the hand-edited file away.
    with pytest.raises(userconfig.ConfigError, match="left untouched"):
        userconfig.update_overrides("gridfinity/base", {"gx": 1})
    with pytest.raises(userconfig.ConfigError):
        userconfig.clear_overrides("gridfinity/base", ["gx"])
    assert path.read_text() == content
    # Clearing everything is an explicit "delete it", so it is allowed.
    userconfig.clear_overrides("gridfinity/base")
    assert not path.exists()

.PHONY: all preview test venv refs verify goldens clean-refs lint format check

VENV := .venv/bin

venv:
	python3 -m venv .venv
	$(VENV)/pip install -e ".[dev]"

all:
	$(VENV)/python cli/foundry.py build --all -o out

preview:
	$(VENV)/python cli/foundry.py preview --all -o docs/img

# Recorded bounding box / volume per catalogue entry. A change detector,
# not a correctness claim — see `verify` for that.
goldens:
	$(VENV)/python cli/foundry.py goldens --update

test:
	$(VENV)/python -m pytest tests/

# Python lint + format check (config: [tool.ruff] in pyproject.toml).
lint:
	$(VENV)/ruff check cli tools tests
	$(VENV)/ruff format --check cli tools tests

format:
	$(VENV)/ruff check --fix cli tools tests
	$(VENV)/ruff format cli tools tests

# Everything that needs neither OpenSCAD nor a browser: Python lint, the
# catalogue tests that do not render, and the web app's lint, types,
# formatting and unit tests. The pre-push minimum; CI runs the rest.
check: lint
	$(VENV)/python -m pytest tests/test_catalogue.py tests/test_catalogue_schema.py tests/test_openscad_values.py -q
	cd web && npm run check

# Fetch every reference source into refs/ (gitignored). Submodule-backed
# sources need nothing; the rest need a network on first run.
refs:
	git submodule update --init --recursive
	$(VENV)/python tools/refcache.py

# The check that says whether a part is actually right: compare each one
# against somebody else's model of the same standard, and prove the ones
# that mate really mate.
verify:
	$(VENV)/python tools/verify.py

# The whole cache, fetched checkouts included — `refs` rebuilds it.
clean-refs:
	rm -rf refs

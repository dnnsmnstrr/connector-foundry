.PHONY: all preview test venv refs verify goldens clean-refs

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

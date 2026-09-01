.PHONY: all preview test venv

VENV := .venv/bin

venv:
	python3 -m venv .venv
	$(VENV)/pip install -e .

all:
	$(VENV)/python cli/foundry.py build --all -o out

preview:
	$(VENV)/python cli/foundry.py preview --all -o docs/img

test:
	$(VENV)/python -m pytest tests/

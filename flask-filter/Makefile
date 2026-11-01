# Common developer tasks. Run `make help` for the list.
PYTHON ?= python3
VENV   ?= .venv
BIN    := $(VENV)/bin

.DEFAULT_GOAL := help
.PHONY: help install dev run test lint format audit check clean

help: ## Show this help
	@grep -E '^[a-z]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  \033[36m%-9s\033[0m %s\n", $$1, $$2}'

$(BIN)/python:
	$(PYTHON) -m venv $(VENV)
	$(BIN)/pip install --upgrade pip

install: $(BIN)/python ## Create venv, install the app and Chrome driver
	$(BIN)/pip install -e .
	$(BIN)/python -m patchright install chromium

dev: $(BIN)/python ## Install the app with dev tools (pytest, ruff)
	$(BIN)/pip install -e '.[dev]'

run: ## Start the app (loads .env if present)
	@set -a; [ -f .env ] && . ./.env; set +a; $(BIN)/af-filter

test: ## Run the test suite
	$(BIN)/pytest

lint: ## Lint + format check with ruff
	$(BIN)/ruff check src tests
	$(BIN)/ruff format --check src tests

format: ## Auto-format with ruff
	$(BIN)/ruff format src tests
	$(BIN)/ruff check --fix src tests

audit: ## Scan dependencies for known vulnerabilities
	$(BIN)/pip-audit --skip-editable

check: lint test ## Lint + tests (what CI runs)

clean: ## Remove caches and build artefacts
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
	rm -rf .pytest_cache .ruff_cache build dist src/*.egg-info

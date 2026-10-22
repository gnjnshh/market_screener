"""
JSON Schema validation tests for VolEdge India.
Verifies docs/data/meta.json, docs/data/regime.json, docs/data/scanner_eod.json,
and docs/data/history/*.json strictly conform to their JSON schemas.
"""

import glob
import json
import os
import pytest
from jsonschema import validate, Draft7Validator


def load_json(filepath: str):
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


def test_meta_json_schema():
    """Validate docs/data/meta.json against schema/meta.schema.json."""
    schema = load_json("schema/meta.schema.json")
    data = load_json("docs/data/meta.json")
    Draft7Validator.check_schema(schema)
    validate(instance=data, schema=schema)


def test_regime_json_schema():
    """Validate docs/data/regime.json against schema/regime.schema.json."""
    schema = load_json("schema/regime.schema.json")
    data = load_json("docs/data/regime.json")
    Draft7Validator.check_schema(schema)
    validate(instance=data, schema=schema)


def test_scanner_eod_json_schema():
    """Validate docs/data/scanner_eod.json against schema/scanner_eod.schema.json."""
    schema = load_json("schema/scanner_eod.schema.json")
    data = load_json("docs/data/scanner_eod.json")
    Draft7Validator.check_schema(schema)
    validate(instance=data, schema=schema)
    assert len(data) > 0, "scanner_eod.json should contain rows"


def test_history_json_schema():
    """Validate docs/data/history/*.json against schema/history.schema.json."""
    schema = load_json("schema/history.schema.json")
    Draft7Validator.check_schema(schema)
    history_files = glob.glob(os.path.join("docs", "data", "history", "*.json"))
    assert len(history_files) > 0, "docs/data/history should contain history JSON files"
    for hf in history_files:
        data = load_json(hf)
        validate(instance=data, schema=schema)

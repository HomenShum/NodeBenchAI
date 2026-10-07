from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest


EVAL_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = EVAL_DIR / "src"

if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    assert isinstance(value, dict)
    return value


@pytest.fixture
def eval_dir() -> Path:
    return EVAL_DIR


@pytest.fixture
def input_schema(eval_dir: Path) -> dict[str, Any]:
    return load_json(eval_dir / "schemas" / "graph-hop-input.v1.schema.json")


@pytest.fixture
def output_schema(eval_dir: Path) -> dict[str, Any]:
    return load_json(eval_dir / "schemas" / "graph-hop-output.v1.schema.json")


@pytest.fixture
def nodekit_export_schema(eval_dir: Path) -> dict[str, Any]:
    return load_json(eval_dir / "schemas" / "nodekit-run-export.v1.schema.json")


@pytest.fixture
def nodekit_replay_output_schema(eval_dir: Path) -> dict[str, Any]:
    return load_json(
        eval_dir / "schemas" / "nodekit-replay-output.v1.schema.json"
    )


@pytest.fixture
def image_attestation_schema(eval_dir: Path) -> dict[str, Any]:
    return load_json(
        eval_dir / "schemas" / "image-attestation.v1.schema.json"
    )


@pytest.fixture
def upstream_record(eval_dir: Path) -> dict[str, Any]:
    return load_json(eval_dir / "UPSTREAM.json")


@pytest.fixture
def golden_input(eval_dir: Path) -> dict[str, Any]:
    return load_json(
        eval_dir / "fixtures" / "golden-selection-flip.input.v1.json"
    )

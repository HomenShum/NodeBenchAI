from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import ValidationError


def validator(schema: dict[str, Any]) -> Draft202012Validator:
    return Draft202012Validator(schema, format_checker=FormatChecker())


def test_schemas_are_valid_draft_2020_12(
    input_schema: dict[str, Any],
    output_schema: dict[str, Any],
    image_attestation_schema: dict[str, Any],
) -> None:
    Draft202012Validator.check_schema(input_schema)
    Draft202012Validator.check_schema(output_schema)
    Draft202012Validator.check_schema(image_attestation_schema)


def test_golden_input_matches_schema(
    input_schema: dict[str, Any],
    golden_input: dict[str, Any],
) -> None:
    validator(input_schema).validate(golden_input)
    assert golden_input["determinism"]["timestamp_iso"].endswith("z")
    assert "t" in golden_input["determinism"]["timestamp_iso"]
    for candidate in golden_input["candidates"]:
        assert "graph_score_bp" not in candidate
        assert candidate["hop_path"]
        assert all(
            set(edge)
            == {
                "source_id",
                "target_id",
                "evidence_id",
                "graph_score_bp",
            }
            for edge in candidate["hop_path"]
        )


@pytest.mark.parametrize(
    ("mutate", "expected_path_fragment"),
    [
        (
            lambda value: value["candidates"].pop(),
            "candidates",
        ),
        (
            lambda value: value["candidates"][0].update(
                {"semantic_score_bp": 10001}
            ),
            "semantic_score_bp",
        ),
        (
            lambda value: value["determinism"].update(
                {"parent_run_id": "not-a-run-id"}
            ),
            "parent_run_id",
        ),
        (
            lambda value: value.update({"unexpected": True}),
            "",
        ),
        (
            lambda value: value["candidates"][0].update({"hop_path": []}),
            "hop_path",
        ),
        (
            lambda value: value["candidates"][0].update(
                {"graph_score_bp": 3000}
            ),
            "candidates.0",
        ),
    ],
)
def test_input_schema_rejects_malformed_documents(
    input_schema: dict[str, Any],
    golden_input: dict[str, Any],
    mutate: Any,
    expected_path_fragment: str,
) -> None:
    malformed = deepcopy(golden_input)
    mutate(malformed)

    with pytest.raises(ValidationError) as exc_info:
        validator(input_schema).validate(malformed)

    rendered_path = ".".join(str(part) for part in exc_info.value.absolute_path)
    assert expected_path_fragment in rendered_path


def test_input_schema_documents_cross_field_runner_invariants(
    input_schema: dict[str, Any],
) -> None:
    description = input_schema["description"]
    weights_description = input_schema["$defs"]["policy"]["properties"][
        "weights_bp"
    ]["description"]

    assert "Candidate and evidence ID uniqueness" in description
    assert "Graph scores are derived" in description
    assert "path connectivity and endpoints" in description
    assert "sum" in description.lower()
    assert "total exactly 10000" in weights_description


def test_output_schema_pins_activegraph_release(
    output_schema: dict[str, Any],
) -> None:
    activegraph = output_schema["properties"]["activegraph"]["properties"]

    assert activegraph["version"]["const"] == "1.10.0"
    assert (
        activegraph["inspected_ref"]["const"]
        == "8aedb1866cf5dce056af97529152ffd6f468a1ed"
    )
    required_limitation = output_schema["properties"]["limitations"]["contains"][
        "const"
    ]
    assert "synthetic golden case" in required_limitation
    assert "separate offline replay lane" in required_limitation


def test_upstream_provenance_matches_runtime_contract(
    upstream_record: dict[str, Any],
    output_schema: dict[str, Any],
) -> None:
    activegraph = output_schema["properties"]["activegraph"]["properties"]

    assert upstream_record["repository"] == (
        "https://github.com/yoheinakajima/activegraph"
    )
    assert upstream_record["pinned_version"] == activegraph["version"]["const"]
    assert upstream_record["release_tag"] == "v1.10.0"
    assert (
        upstream_record["release_commit"]
        == "148e12c2969f18fa12a1a3c2e75f3affd9aa0616"
    )
    assert (
        upstream_record["annotated_tag_object"]
        == "3fbcd8fc56a45ae68622d4e2b18a6d5844180527"
    )
    assert (
        upstream_record["inspected_ref"]
        == activegraph["inspected_ref"]["const"]
    )
    assert upstream_record["test_dependencies"] == {
        "jsonschema": "4.26.0",
        "pytest": "9.1.1",
    }


def test_requirements_pin_activegraph_release(eval_dir: Path) -> None:
    requirements = (eval_dir / "requirements.in").read_text(
        encoding="utf-8"
    ).splitlines()

    assert requirements == [
        "activegraph==1.10.0",
        "jsonschema==4.26.0",
        "pytest==9.1.1",
        "rfc8785==0.1.4",
    ]

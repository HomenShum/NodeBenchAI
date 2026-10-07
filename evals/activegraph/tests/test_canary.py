from __future__ import annotations

from copy import deepcopy
import json
import os
from pathlib import Path
import subprocess
import sys
from typing import Any

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from nodebench_activegraph_canary import (
    canonical_json_bytes,
    canonical_sha256,
    inspect_payload_isolation,
    run_canary,
)


EXPECTED_INPUT_SHA256 = (
    "41c7bd138518e7235fb5a18594eb5051852ecdc6696bbd0a421da569064ab309"
)
BASELINE_WEIGHTS = {
    "semantic_score_bp": 8000,
    "graph_score_bp": 1000,
    "source_quality_bp": 1000,
}
VARIANT_WEIGHTS = {
    "semantic_score_bp": 3000,
    "graph_score_bp": 6000,
    "source_quality_bp": 1000,
}
GRAPH_EVIDENCE = [
    {
        "candidate_id": "cand_a",
        "graph_score_bp": 3000,
        "node_ids": ["query#1", "hop_evidence#5", "candidate#2"],
        "relation_ids": ["rel_001", "rel_002"],
        "evidence_ids": [
            "ev_a_query_signal",
            "ev_a_signal_candidate",
        ],
    },
    {
        "candidate_id": "cand_b",
        "graph_score_bp": 9500,
        "node_ids": ["query#1", "hop_evidence#4", "candidate#3"],
        "relation_ids": ["rel_003", "rel_004"],
        "evidence_ids": [
            "ev_b_query_signal",
            "ev_b_signal_candidate",
        ],
    },
]


def validate_output(
    output: dict[str, Any],
    output_schema: dict[str, Any],
) -> None:
    Draft202012Validator(
        output_schema,
        format_checker=FormatChecker(),
    ).validate(output)


def event_pairs(events: list[dict[str, str]]) -> list[tuple[str, str]]:
    return [(event["id"], event["type"]) for event in events]


def test_canonical_helpers_are_stable(golden_input: dict[str, Any]) -> None:
    canonical = canonical_json_bytes(golden_input)

    assert canonical.endswith(b"\n")
    assert b"\r" not in canonical
    assert canonical_sha256(golden_input) == EXPECTED_INPUT_SHA256
    assert canonical_sha256(deepcopy(golden_input)) == EXPECTED_INPUT_SHA256


def test_golden_selection_flip(
    tmp_path: Path,
    golden_input: dict[str, Any],
    output_schema: dict[str, Any],
) -> None:
    output = run_canary(golden_input, tmp_path / "golden.sqlite3")
    validate_output(output, output_schema)

    assert output["schema_version"] == "nodebench.activegraph.graph-hop-output.v1"
    assert output["case_id"] == "golden-selection-flip"
    assert output["input_sha256"] == EXPECTED_INPUT_SHA256
    assert output["activegraph"] == {
        "version": "1.10.0",
        "inspected_ref": "8aedb1866cf5dce056af97529152ffd6f468a1ed",
    }
    assert output["fork_point"] == {
        "event_id": "evt_010",
        "event_type": "object.created",
        "object_id": "evaluation_request#6",
    }

    baseline = output["runs"]["baseline"]
    variant = output["runs"]["variant"]
    assert baseline["run_id"] == "01J00000000000000000000001"
    assert baseline["policy_id"] == "semantic_v1"
    assert baseline["winner_candidate_id"] == "cand_a"
    assert baseline["ranking"] == [
        {"candidate_id": "cand_a", "score_bp": 8700},
        {"candidate_id": "cand_b", "score_bp": 7450},
    ]
    assert baseline["weights_bp"] == BASELINE_WEIGHTS
    assert baseline["event_count"] == 17

    assert variant["run_id"] == "01J00000000000000000000002"
    assert variant["policy_id"] == "graph_v1"
    assert variant["winner_candidate_id"] == "cand_b"
    assert variant["ranking"] == [
        {"candidate_id": "cand_b", "score_bp": 8700},
        {"candidate_id": "cand_a", "score_bp": 5450},
    ]
    assert variant["weights_bp"] == VARIANT_WEIGHTS
    assert variant["event_count"] == 17
    assert baseline["event_log_sha256"] != variant["event_log_sha256"]

    diff = output["diff"]
    assert diff["is_identical"] is False
    assert event_pairs(diff["shared_events"]) == [
        ("evt_001", "object.created"),
        ("evt_002", "object.created"),
        ("evt_003", "object.created"),
        ("evt_004", "object.created"),
        ("evt_005", "object.created"),
        ("evt_006", "relation.created"),
        ("evt_007", "relation.created"),
        ("evt_008", "relation.created"),
        ("evt_009", "relation.created"),
        ("evt_010", "object.created"),
    ]
    expected_tail = [
        ("evt_012", "object.created"),
        ("evt_013", "relation.created"),
        ("evt_014", "graph_hop.completed"),
        ("evt_016", "context.read"),
    ]
    assert event_pairs(diff["parent_only_events"]) == expected_tail
    assert event_pairs(diff["fork_only_events"]) == expected_tail
    baseline_result = {
        "policy_id": "semantic_v1",
        "winner_candidate_id": "cand_a",
        "ranking": baseline["ranking"],
        "weights_bp": BASELINE_WEIGHTS,
        "graph_evidence": GRAPH_EVIDENCE,
    }
    variant_result = {
        "policy_id": "graph_v1",
        "winner_candidate_id": "cand_b",
        "ranking": variant["ranking"],
        "weights_bp": VARIANT_WEIGHTS,
        "graph_evidence": GRAPH_EVIDENCE,
    }
    assert diff["decision_delta"] == {
        "baseline": baseline_result,
        "variant": variant_result,
    }
    baseline_decision = {
        "id": "decision#7",
        "type": "decision",
        "data": {
            "policy_id": "semantic_v1",
            "winner_candidate_id": "cand_a",
            "ranked": baseline["ranking"],
            "weights_bp": BASELINE_WEIGHTS,
            "graph_evidence": GRAPH_EVIDENCE,
        },
        "version": 1,
    }
    variant_decision = {
        "id": "decision#7",
        "type": "decision",
        "data": {
            "policy_id": "graph_v1",
            "winner_candidate_id": "cand_b",
            "ranked": variant["ranking"],
            "weights_bp": VARIANT_WEIGHTS,
            "graph_evidence": GRAPH_EVIDENCE,
        },
        "version": 1,
    }
    assert diff["divergent_objects"] == [
        {
            "id": "decision#7",
            "in_parent": baseline_decision,
            "in_fork": variant_decision,
        }
    ]
    baseline_relation = {
        "id": "rel_005",
        "source": "decision#7",
        "target": "candidate#2",
        "type": "selects",
        "data": {"candidate_id": "cand_a"},
    }
    variant_relation = {
        "id": "rel_005",
        "source": "decision#7",
        "target": "candidate#3",
        "type": "selects",
        "data": {"candidate_id": "cand_b"},
    }
    assert diff["divergent_relations"] == [
        {
            "id": "rel_005",
            "in_parent": baseline_relation,
            "in_fork": variant_relation,
        }
    ]

    assert output["verdict"] == "pass"
    assert output["assertions"]
    assert all(assertion["passed"] for assertion in output["assertions"])
    assertions_by_name = {
        assertion["name"]: assertion for assertion in output["assertions"]
    }
    traversal = assertions_by_name["graph-topology-traversal"]
    assert traversal["passed"] is True
    assert traversal["actual"] == {
        "baseline": GRAPH_EVIDENCE,
        "variant": GRAPH_EVIDENCE,
    }
    reload_parity = assertions_by_name["persisted-reload-parity"]
    assert reload_parity["passed"] is True
    assert reload_parity["actual"] == reload_parity["expected"]
    for lane, result, decision, relation in (
        ("baseline", baseline_result, baseline_decision, baseline_relation),
        ("variant", variant_result, variant_decision, variant_relation),
    ):
        fingerprint = reload_parity["actual"][lane]
        assert fingerprint["event_count"] == 17
        assert fingerprint["event_log_sha256"] == output["runs"][lane][
            "event_log_sha256"
        ]
        assert fingerprint["projection"] == {
            "decisions": [decision],
            "selects_relations": [relation],
        }
        assert fingerprint["result"] == result
    assert output["limitations"]
    assert (
        "This synthetic golden case characterizes fork/diff mechanics only; "
        "canonical NodeKit export replay is evaluated by the separate offline "
        "replay lane."
    ) in output["limitations"]


def test_repeatability_across_reconstructed_stores(
    tmp_path: Path,
    golden_input: dict[str, Any],
) -> None:
    first = run_canary(deepcopy(golden_input), tmp_path / "first.sqlite3")
    second = run_canary(deepcopy(golden_input), tmp_path / "second.sqlite3")

    assert first == second
    assert (tmp_path / "first.sqlite3").is_file()
    assert (tmp_path / "second.sqlite3").is_file()


def test_runner_does_not_mutate_caller_input(
    tmp_path: Path,
    golden_input: dict[str, Any],
) -> None:
    caller_input = deepcopy(golden_input)
    before = deepcopy(caller_input)

    run_canary(caller_input, tmp_path / "no-mutation.sqlite3")

    assert caller_input == before


def test_issue_67_containment_covers_live_persisted_and_reloaded_payloads(
    tmp_path: Path,
    golden_input: dict[str, Any],
) -> None:
    db_path = tmp_path / "payload-isolation.sqlite3"
    caller_input = deepcopy(golden_input)
    before = deepcopy(caller_input)

    observed = inspect_payload_isolation(caller_input, db_path)

    assert caller_input == before
    expected = observed["expected_candidate"]
    assert expected == before["candidates"][0]
    assert observed == {
        "expected_candidate": expected,
        "live_event_candidate": expected,
        "live_projection_candidate": expected,
        "persisted_event_candidate": expected,
        "reloaded_projection_candidate": expected,
    }
    assert db_path.is_file()


def test_runner_rejects_weight_sum_other_than_10000(
    tmp_path: Path,
    golden_input: dict[str, Any],
) -> None:
    malformed = deepcopy(golden_input)
    malformed["policies"]["variant"]["weights_bp"]["graph_score_bp"] = 5999

    with pytest.raises(ValueError, match="10000"):
        run_canary(malformed, tmp_path / "bad-weight.sqlite3")


def test_runner_rejects_identical_baseline_and_variant_policies(
    tmp_path: Path,
    golden_input: dict[str, Any],
) -> None:
    malformed = deepcopy(golden_input)
    malformed["policies"]["variant"] = deepcopy(
        malformed["policies"]["baseline"]
    )
    db_path = tmp_path / "identical-policies.sqlite3"

    with pytest.raises(ValueError, match="baseline|variant|policy"):
        run_canary(malformed, db_path)

    assert not db_path.exists()


def test_runner_rejects_duplicate_candidate_ids(
    tmp_path: Path,
    golden_input: dict[str, Any],
) -> None:
    malformed = deepcopy(golden_input)
    malformed["candidates"][1]["candidate_id"] = "cand_a"

    with pytest.raises(ValueError, match="candidate"):
        run_canary(malformed, tmp_path / "duplicate-id.sqlite3")


def test_runner_rejects_schema_invalid_input(
    tmp_path: Path,
    golden_input: dict[str, Any],
) -> None:
    malformed = deepcopy(golden_input)
    del malformed["query"]["text"]

    with pytest.raises(ValueError, match="query|text|schema"):
        run_canary(malformed, tmp_path / "invalid-input.sqlite3")


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (
            lambda value: value["candidates"][0].update({"hop_path": []}),
            "hop_path",
        ),
        (
            lambda value: value["candidates"][0]["hop_path"][1].update(
                {"source_id": "evidence:disconnected"}
            ),
            "contiguous|source",
        ),
        (
            lambda value: value["candidates"][0]["hop_path"][0].update(
                {"source_id": "query:wrong"}
            ),
            "query|source",
        ),
        (
            lambda value: value["candidates"][0]["hop_path"][-1].update(
                {"target_id": "candidate:wrong"}
            ),
            "candidate|target",
        ),
        (
            lambda value: value["candidates"][1]["hop_path"][0].update(
                {
                    "evidence_id": value["candidates"][0]["hop_path"][0][
                        "evidence_id"
                    ]
                }
            ),
            "evidence",
        ),
        (
            lambda value: value["candidates"][0]["hop_path"][1].update(
                {"graph_score_bp": 3001}
            ),
            "graph_score|agree|common",
        ),
    ],
)
def test_runner_rejects_invalid_graph_topology(
    tmp_path: Path,
    golden_input: dict[str, Any],
    mutation: Any,
    message: str,
) -> None:
    malformed = deepcopy(golden_input)
    mutation(malformed)
    db_path = tmp_path / "invalid-topology.sqlite3"

    with pytest.raises(ValueError, match=message):
        run_canary(malformed, db_path)

    assert not db_path.exists()


def test_cli_writes_valid_failed_report_and_exits_nonzero(
    tmp_path: Path,
    golden_input: dict[str, Any],
    output_schema: dict[str, Any],
    eval_dir: Path,
) -> None:
    failing_input = deepcopy(golden_input)
    failing_input["expected"]["baseline_winner_id"] = "cand_b"
    input_path = tmp_path / "failing-input.json"
    output_path = tmp_path / "failed-report.json"
    db_path = tmp_path / "failed.sqlite3"
    input_path.write_text(
        json.dumps(failing_input, ensure_ascii=False),
        encoding="utf-8",
    )
    environment = os.environ.copy()
    prior_pythonpath = environment.get("PYTHONPATH")
    environment["PYTHONPATH"] = os.pathsep.join(
        [
            str(eval_dir / "src"),
            *([prior_pythonpath] if prior_pythonpath else []),
        ]
    )

    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "nodebench_activegraph_canary",
            "--input",
            str(input_path),
            "--output",
            str(output_path),
            "--db",
            str(db_path),
        ],
        check=False,
        capture_output=True,
        text=True,
        env=environment,
    )

    assert completed.returncode == 2
    assert output_path.is_file()
    report = json.loads(output_path.read_text(encoding="utf-8"))
    validate_output(report, output_schema)
    assert report["verdict"] == "fail"
    winners = next(
        item for item in report["assertions"] if item["name"] == "expected-winners"
    )
    assert winners["passed"] is False

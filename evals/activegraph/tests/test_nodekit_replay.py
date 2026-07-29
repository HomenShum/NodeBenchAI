from __future__ import annotations

from copy import deepcopy
import json
import os
from pathlib import Path
import subprocess
import sys
from typing import Any

import pytest
from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

from nodebench_activegraph_canary.nodekit_replay import (
    ACTIVEGRAPH_VERSION,
    EVENT_SCHEMA_VERSION,
    EXPORT_SCHEMA_VERSION,
    GENESIS_HASH,
    OUTPUT_SCHEMA_VERSION,
    SAFE_FIELDS_BY_EVENT,
    SAFE_PAYLOAD_SCHEMA_VERSION,
    NodeKitReplayContractError,
    canonical_hash,
    canonical_json_text,
    run_nodekit_replay_canary,
    validate_nodekit_export,
)

SANDBOX_IMAGE = f"sha256:{'a' * 64}"
BUILD_INPUTS_HASH = f"sha256:{'b' * 64}"
UPSTREAM_HASH = f"sha256:{'c' * 64}"
IMAGE_ATTESTATION_HASH = f"sha256:{'d' * 64}"
NODEBENCH_CANDIDATE_COMMIT = "e" * 40


@pytest.fixture(autouse=True)
def _sandbox_build_attestation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(
        "NODEBENCH_ACTIVEGRAPH_BUILD_INPUTS_SHA256",
        BUILD_INPUTS_HASH,
    )
    monkeypatch.setenv(
        "NODEBENCH_ACTIVEGRAPH_UPSTREAM_SHA256",
        UPSTREAM_HASH,
    )
    monkeypatch.setenv(
        "NODEBENCH_ACTIVEGRAPH_IMAGE_ATTESTATION_SHA256",
        IMAGE_ATTESTATION_HASH,
    )
    monkeypatch.setenv(
        "NODEBENCH_CANDIDATE_COMMIT",
        NODEBENCH_CANDIDATE_COMMIT,
    )

def _safe_payload(event_type: str, source: dict[str, Any]) -> dict[str, Any]:
    fields = {
        key: source[key]
        for key in SAFE_FIELDS_BY_EVENT[event_type]
        if key in source and type(source[key]) in {str, int, float, bool}
    }
    return {
        "projectionVersion": SAFE_PAYLOAD_SCHEMA_VERSION,
        "sourceDigest": canonical_hash(source),
        "sourceBytes": len(canonical_json_text(source).encode("utf-8")),
        "fields": fields,
    }


def _event(
    *,
    run_id: str,
    sequence: int,
    event_type: str,
    recorded_at: int,
    payload: dict[str, Any],
    previous_hash: str,
) -> dict[str, Any]:
    body = {
        "contractVersion": EVENT_SCHEMA_VERSION,
        "runId": run_id,
        "sequence": sequence,
        "eventType": event_type,
        "recordedAt": recorded_at,
        "payload": _safe_payload(event_type, payload),
        "previousHash": previous_hash,
    }
    return {**body, "contentHash": canonical_hash(body)}


def _export() -> dict[str, Any]:
    run_id = "trace_python_cross_language_contract"
    started = _event(
        run_id=run_id,
        sequence=0,
        event_type="run.started",
        recorded_at=1_725_000_000_000,
        payload={
            "workflowName": "NodeKit replay",
            "sessionType": "agent",
            "sessionStartedAt": 1_724_999_999_000,
            "nested": {"z": 2, "a": 1},
        },
        previous_hash=GENESIS_HASH,
    )
    evidence = _event(
        run_id=run_id,
        sequence=1,
        event_type="evidence.attached",
        recorded_at=1_725_000_000_010,
        payload={"sourceRefs": [{"label": "source-a"}]},
        previous_hash=started["contentHash"],
    )
    completed = _event(
        run_id=run_id,
        sequence=2,
        event_type="run.completed",
        recorded_at=1_725_000_000_020,
        payload={"status": "completed"},
        previous_hash=evidence["contentHash"],
    )
    events = [started, evidence, completed]
    base = {
        "schemaVersion": EXPORT_SCHEMA_VERSION,
        "runId": run_id,
        "session": {
            "id": "session-python-contract",
            "typeAtRunStart": "agent",
            "startedAt": 1_724_999_999_000,
        },
        "trace": {
            "id": "trace-row-python-contract",
            "runId": run_id,
            "workflowName": "NodeKit replay",
            "status": "completed",
            "startedAt": 1_725_000_000_000,
            "endedAt": 1_725_000_000_020,
        },
        "events": events,
        "completeness": {
            "eventChainComplete": True,
            "spanLifecycleComplete": True,
            "contractVersion": EVENT_SCHEMA_VERSION,
            "eventCount": 3,
            "firstSequence": 0,
            "lastSequence": 2,
            "terminalEventType": "run.completed",
        },
        "hashes": {
            "algorithm": "sha256",
            "chainHead": completed["contentHash"],
        },
    }
    return {
        **base,
        "hashes": {
            **base["hashes"],
            "exportHash": canonical_hash(base),
        },
    }


def _rehash_export(document: dict[str, Any]) -> None:
    previous_hash = GENESIS_HASH
    for event in document["events"]:
        event["previousHash"] = previous_hash
        event["contentHash"] = canonical_hash(
            {
                "contractVersion": event["contractVersion"],
                "runId": event["runId"],
                "sequence": event["sequence"],
                "eventType": event["eventType"],
                "recordedAt": event["recordedAt"],
                "payload": event["payload"],
                "previousHash": event["previousHash"],
            }
        )
        previous_hash = event["contentHash"]
    document["hashes"]["chainHead"] = previous_hash
    document["hashes"]["exportHash"] = canonical_hash(
        {
            **document,
            "hashes": {
                "algorithm": "sha256",
                "chainHead": previous_hash,
            },
        }
    )


def test_nodekit_export_and_report_schemas_are_valid(
    nodekit_export_schema: dict[str, Any],
    nodekit_replay_output_schema: dict[str, Any],
) -> None:
    Draft202012Validator.check_schema(nodekit_export_schema)
    Draft202012Validator.check_schema(nodekit_replay_output_schema)
    Draft202012Validator(nodekit_export_schema).validate(_export())


def test_nodekit_export_schema_rejects_terminal_status_contradiction(
    nodekit_export_schema: dict[str, Any],
) -> None:
    document = _export()
    document["events"][-1]["payload"]["fields"]["status"] = "error"

    with pytest.raises(ValidationError):
        Draft202012Validator(nodekit_export_schema).validate(document)


def test_canonical_hash_matches_typescript_for_numeric_and_unicode_edges() -> None:
    fixture = {
        "z": -0.0,
        "tiny": 1e-7,
        "threshold": 1e-6,
        "huge": 1e21,
        "fraction": 0.8,
        "nested": {"😀": 2, "\ue000": 1},
    }

    assert canonical_hash(fixture) == (
        "sha256:d4f50ebd3e2d78d0975c68bafdbdf327"
        "b64a13c9acddd09cc95a747a1eaa1812"
    )


def test_replay_persists_and_reloads_the_exact_exported_sequence(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    nodekit_replay_output_schema: dict[str, Any],
) -> None:
    monkeypatch.setenv("NODEBENCH_ACTIVEGRAPH_MODE", "offline-observer")
    monkeypatch.setenv(
        "NODEBENCH_ACTIVEGRAPH_SANDBOX_IMAGE",
        SANDBOX_IMAGE,
    )
    document = _export()
    original = deepcopy(document)
    report = run_nodekit_replay_canary(
        document,
        tmp_path / "nodekit.sqlite3",
        _test_only_allow_host_runtime=True,
    )

    Draft202012Validator(nodekit_replay_output_schema).validate(report)
    assert document == original
    assert report["schema_version"] == OUTPUT_SCHEMA_VERSION
    assert report["activegraph"]["version"] == ACTIVEGRAPH_VERSION
    assert report["isolation"] == {
        "runtime": "docker",
        "image": SANDBOX_IMAGE,
        "network": "none",
        "rootFilesystem": "read-only",
        "writableMount": "/evidence",
        "buildInputsHash": BUILD_INPUTS_HASH,
        "nodebenchCandidateCommit": NODEBENCH_CANDIDATE_COMMIT,
        "upstreamHash": UPSTREAM_HASH,
        "imageAttestationHash": IMAGE_ATTESTATION_HASH,
    }
    assert report["run_id"] == document["runId"]
    assert report["event_count"] == len(document["events"])
    assert report["nodekit_chain_head"] == document["hashes"]["chainHead"]
    assert report["replayed_events_sha256"] == canonical_hash(document["events"])
    assert report["input_export_sha256"] == document["hashes"]["exportHash"]
    assert report["persisted_reload_parity"] is True
    assert report["verdict"] == "pass"


@pytest.mark.parametrize(
    ("mutate", "code"),
    [
        (
            lambda value: value["events"][1].update({"sequence": 4}),
            "sequence_not_contiguous",
        ),
        (
            lambda value: value["events"][1]["payload"].update(
                {"sourceDigest": f"sha256:{'f' * 64}"}
            ),
            "content_hash_mismatch",
        ),
        (
            lambda value: value["events"].pop(),
            "terminal_event_missing",
        ),
        (
            lambda value: value["trace"].update({"id": "tampered"}),
            "export_hash_mismatch",
        ),
        (
            lambda value: value["trace"].update(
                {"reconstructedSummary": "not canonical"}
            ),
            "shape_invalid",
        ),
        (
            lambda value: value["trace"].update({"status": "running"}),
            "run_not_terminal",
        ),
    ],
)
def test_validation_fails_closed_before_creating_sqlite(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    mutate: Any,
    code: str,
) -> None:
    monkeypatch.setenv("NODEBENCH_ACTIVEGRAPH_MODE", "offline-observer")
    monkeypatch.setenv(
        "NODEBENCH_ACTIVEGRAPH_SANDBOX_IMAGE",
        SANDBOX_IMAGE,
    )
    document = _export()
    mutate(document)
    db_path = tmp_path / "must-not-exist.sqlite3"

    with pytest.raises(NodeKitReplayContractError) as exc_info:
        run_nodekit_replay_canary(
            document,
            db_path,
            _test_only_allow_host_runtime=True,
        )

    assert exc_info.value.code == code
    assert not db_path.exists()


def test_replay_requires_explicit_offline_mode_before_any_write(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("NODEBENCH_ACTIVEGRAPH_MODE", raising=False)
    monkeypatch.setenv(
        "NODEBENCH_ACTIVEGRAPH_SANDBOX_IMAGE",
        SANDBOX_IMAGE,
    )
    db_path = tmp_path / "must-not-exist.sqlite3"

    with pytest.raises(NodeKitReplayContractError) as exc_info:
        run_nodekit_replay_canary(
            _export(),
            db_path,
            _test_only_allow_host_runtime=True,
        )

    assert exc_info.value.code == "offline_mode_required"
    assert not db_path.exists()


def test_replay_requires_immutable_sandbox_image_before_any_write(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("NODEBENCH_ACTIVEGRAPH_MODE", "offline-observer")
    monkeypatch.delenv(
        "NODEBENCH_ACTIVEGRAPH_SANDBOX_IMAGE",
        raising=False,
    )
    db_path = tmp_path / "must-not-exist.sqlite3"

    with pytest.raises(NodeKitReplayContractError) as exc_info:
        run_nodekit_replay_canary(
            _export(),
            db_path,
            _test_only_allow_host_runtime=True,
        )

    assert exc_info.value.code == "sandbox_image_required"
    assert not db_path.exists()


def test_replay_requires_exact_build_attestation_before_any_write(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("NODEBENCH_ACTIVEGRAPH_MODE", "offline-observer")
    monkeypatch.setenv(
        "NODEBENCH_ACTIVEGRAPH_SANDBOX_IMAGE",
        SANDBOX_IMAGE,
    )
    monkeypatch.delenv(
        "NODEBENCH_ACTIVEGRAPH_BUILD_INPUTS_SHA256",
        raising=False,
    )
    db_path = tmp_path / "must-not-exist.sqlite3"

    with pytest.raises(NodeKitReplayContractError) as exc_info:
        run_nodekit_replay_canary(
            _export(),
            db_path,
            _test_only_allow_host_runtime=True,
        )

    assert exc_info.value.code == "image_attestation_required"
    assert not db_path.exists()


def test_validation_rejects_terminal_run_with_open_span() -> None:
    document = _export()
    started = document["events"][0]
    span_started = _event(
        run_id=document["runId"],
        sequence=1,
        event_type="span.started",
        recorded_at=started["recordedAt"] + 1,
        payload={"spanId": "span-open"},
        previous_hash=started["contentHash"],
    )
    completed = _event(
        run_id=document["runId"],
        sequence=2,
        event_type="run.completed",
        recorded_at=started["recordedAt"] + 2,
        payload={"status": "completed"},
        previous_hash=span_started["contentHash"],
    )
    document["events"] = [started, span_started, completed]
    document["trace"]["endedAt"] = completed["recordedAt"]
    document["hashes"]["chainHead"] = completed["contentHash"]
    document["hashes"]["exportHash"] = canonical_hash(
        {
            **document,
            "hashes": {
                "algorithm": "sha256",
                "chainHead": completed["contentHash"],
            },
        }
    )

    with pytest.raises(NodeKitReplayContractError) as exc_info:
        validate_nodekit_export(document)

    assert exc_info.value.code == "span_lifecycle_incomplete"


@pytest.mark.parametrize(
    ("terminal_type", "trace_status", "payload_status"),
    [
        ("run.completed", "completed", "error"),
        ("run.failed", "error", "completed"),
    ],
)
def test_validation_rejects_semantically_contradictory_terminal_payload(
    terminal_type: str,
    trace_status: str,
    payload_status: str,
) -> None:
    document = _export()
    terminal = document["events"][-1]
    terminal["eventType"] = terminal_type
    terminal["payload"]["fields"]["status"] = payload_status
    document["trace"]["status"] = trace_status
    document["completeness"]["terminalEventType"] = terminal_type
    _rehash_export(document)

    with pytest.raises(NodeKitReplayContractError) as exc_info:
        validate_nodekit_export(document)

    assert exc_info.value.code == "terminal_status_mismatch"


def test_validation_rejects_hash_valid_backward_event_time() -> None:
    document = _export()
    document["events"][1]["recordedAt"] = (
        document["events"][0]["recordedAt"] - 1
    )
    _rehash_export(document)

    with pytest.raises(NodeKitReplayContractError) as exc_info:
        validate_nodekit_export(document)

    assert exc_info.value.code == "recorded_at_not_monotonic"


def test_cli_refuses_host_execution_before_writing_outputs(
    tmp_path: Path,
    eval_dir: Path,
) -> None:
    source_path = tmp_path / "disposable-export.json"
    output_path = tmp_path / "report.json"
    db_path = tmp_path / "activegraph.sqlite3"
    source_path.write_text(
        json.dumps(_export(), ensure_ascii=False),
        encoding="utf-8",
    )
    before = source_path.read_bytes()
    environment = os.environ.copy()
    environment["NODEBENCH_ACTIVEGRAPH_MODE"] = "offline-observer"
    environment["NODEBENCH_ACTIVEGRAPH_SANDBOX_IMAGE"] = SANDBOX_IMAGE
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    environment["PYTHONPATH"] = str(eval_dir / "src")

    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "nodebench_activegraph_canary.nodekit_replay_cli",
            "--input",
            str(source_path),
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

    assert completed.returncode != 0
    assert "sandbox_runtime_required" in completed.stderr
    assert source_path.read_bytes() == before
    assert not output_path.exists()
    assert not db_path.exists()


def test_cli_rejects_oversized_input_before_reading_or_writing(
    tmp_path: Path,
    eval_dir: Path,
) -> None:
    source_path = tmp_path / "oversized-export.json"
    output_path = tmp_path / "report.json"
    db_path = tmp_path / "activegraph.sqlite3"
    source_path.write_bytes(b"{}")
    with source_path.open("r+b") as handle:
        handle.truncate(1024 * 1024 + 1)
    environment = os.environ.copy()
    environment["NODEBENCH_ACTIVEGRAPH_MODE"] = "offline-observer"
    environment["NODEBENCH_ACTIVEGRAPH_SANDBOX_IMAGE"] = SANDBOX_IMAGE
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    environment["PYTHONPATH"] = str(eval_dir / "src")

    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "nodebench_activegraph_canary.nodekit_replay_cli",
            "--input",
            str(source_path),
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

    assert completed.returncode != 0
    assert "export_too_large" in completed.stderr
    assert not output_path.exists()
    assert not db_path.exists()


def test_validate_nodekit_export_returns_an_isolated_copy() -> None:
    source = _export()
    validated = validate_nodekit_export(source)
    validated["trace"]["workflowName"] = "caller mutation"

    assert source["trace"]["workflowName"] == "NodeKit replay"

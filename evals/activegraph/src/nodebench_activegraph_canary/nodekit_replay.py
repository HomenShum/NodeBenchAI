"""Fail-closed replay of a canonical NodeKit run export in ActiveGraph.

The input is a disposable file copy staged by the Node wrapper. This module
never imports a NodeBench client and never writes back to the source runtime.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import os
from pathlib import Path
import re
from typing import Any

import activegraph
from activegraph import Event, FrozenClock, Graph, Runtime
import rfc8785


EXPORT_SCHEMA_VERSION = "nodekit.run-export/v1"
EVENT_SCHEMA_VERSION = "nodekit.run-event/v1"
SAFE_PAYLOAD_SCHEMA_VERSION = "nodekit.safe-event-payload/v1"
OUTPUT_SCHEMA_VERSION = "nodebench.activegraph.nodekit-replay-output.v1"
ACTIVEGRAPH_VERSION = "1.10.0"
ACTIVEGRAPH_RELEASE_COMMIT = "148e12c2969f18fa12a1a3c2e75f3affd9aa0616"
ACTIVEGRAPH_ANNOTATED_TAG_OBJECT = (
    "3fbcd8fc56a45ae68622d4e2b18a6d5844180527"
)
ACTIVEGRAPH_INSPECTED_REF = "8aedb1866cf5dce056af97529152ffd6f468a1ed"
GENESIS_HASH = f"sha256:{'0' * 64}"
OFFLINE_MODE = "offline-observer"
SANDBOX_IMAGE_ENV = "NODEBENCH_ACTIVEGRAPH_SANDBOX_IMAGE"
BUILD_INPUTS_HASH_ENV = "NODEBENCH_ACTIVEGRAPH_BUILD_INPUTS_SHA256"
UPSTREAM_HASH_ENV = "NODEBENCH_ACTIVEGRAPH_UPSTREAM_SHA256"
IMAGE_ATTESTATION_HASH_ENV = (
    "NODEBENCH_ACTIVEGRAPH_IMAGE_ATTESTATION_SHA256"
)
CANDIDATE_COMMIT_ENV = "NODEBENCH_CANDIDATE_COMMIT"
MAX_EVENTS = 256
MAX_REDACTED_SOURCE_BYTES = 32 * 1024
MAX_STORED_PAYLOAD_BYTES = 2 * 1024
EVENT_TYPES = frozenset(
    {
        "run.started",
        "span.started",
        "span.completed",
        "step.recorded",
        "decision.recorded",
        "verification.recorded",
        "evidence.attached",
        "approval.requested",
        "node.started",
        "edge.consumed",
        "artifact.produced",
        "node.completed",
        "node.failed",
        "barrier.opened",
        "barrier.blocked",
        "run.completed",
        "run.failed",
    }
)
TERMINAL_TYPES = frozenset({"run.completed", "run.failed"})
SAFE_FIELDS_BY_EVENT = {
    "run.started": frozenset(
        {
            "workflowName",
            "origin",
            "groupId",
            "model",
            "goalId",
            "sessionType",
            "sessionStartedAt",
            "identityRef",
            "workspaceId",
            "agentId",
            "nativeSessionId",
            "nativeSessionGeneration",
            "peerId",
            "identitySnapshotHash",
        }
    ),
    "span.started": frozenset(
        {"spanId", "parentSpanId", "spanSequence", "depth", "spanType"}
    ),
    "span.completed": frozenset(
        {"spanId", "spanSequence", "status", "durationMs"}
    ),
    "step.recorded": frozenset(
        {
            "spanId",
            "parentSpanId",
            "spanSequence",
            "stage",
            "type",
            "tool",
            "durationMs",
        }
    ),
    "decision.recorded": frozenset({"decisionType", "confidence"}),
    "verification.recorded": frozenset({"status"}),
    "evidence.attached": frozenset(),
    "approval.requested": frozenset(
        {"approvalId", "toolName", "riskLevel"}
    ),
    "node.started": frozenset(
        {
            "graphId",
            "graphHash",
            "caseId",
            "stageId",
            "caseContentHash",
            "nodeId",
            "nodeRunId",
            "nodeKind",
            "frontierHash",
            "reviewContextRef",
        }
    ),
    "edge.consumed": frozenset(
        {
            "graphId",
            "graphHash",
            "caseId",
            "stageId",
            "caseContentHash",
            "nodeId",
            "nodeRunId",
            "edgeId",
            "bindingId",
            "bindingHash",
            "artifactId",
            "artifactSchemaVersion",
            "artifactContentHash",
            "authorityKind",
        }
    ),
    "artifact.produced": frozenset(
        {
            "graphId",
            "graphHash",
            "caseId",
            "stageId",
            "caseContentHash",
            "nodeId",
            "nodeRunId",
            "artifactId",
            "artifactSchemaVersion",
            "artifactContentHash",
            "authorityKind",
        }
    ),
    "node.completed": frozenset(
        {
            "graphId",
            "graphHash",
            "caseId",
            "stageId",
            "caseContentHash",
            "nodeId",
            "nodeRunId",
            "status",
            "reviewContextRef",
            "reviewSeparation",
            "protectedEvaluator",
        }
    ),
    "node.failed": frozenset(
        {
            "graphId",
            "graphHash",
            "caseId",
            "stageId",
            "caseContentHash",
            "nodeId",
            "nodeRunId",
            "status",
            "reasonCode",
        }
    ),
    "barrier.opened": frozenset(
        {
            "graphId",
            "graphHash",
            "caseId",
            "stageId",
            "caseContentHash",
            "nodeId",
            "nodeRunId",
            "frontierHash",
            "status",
        }
    ),
    "barrier.blocked": frozenset(
        {
            "graphId",
            "graphHash",
            "caseId",
            "stageId",
            "caseContentHash",
            "nodeId",
            "nodeRunId",
            "frontierHash",
            "status",
            "reasonCode",
            "blockingEdgeCount",
        }
    ),
    "run.completed": frozenset(
        {"status", "totalDurationMs", "crossCheckStatus", "dogfoodRunId"}
    ),
    "run.failed": frozenset(
        {"status", "totalDurationMs", "crossCheckStatus", "dogfoodRunId"}
    ),
}
REQUIRED_FIELDS_BY_EVENT = {
    "run.started": frozenset(
        {"workflowName", "sessionType", "sessionStartedAt"}
    ),
    "span.started": frozenset({"spanId"}),
    "span.completed": frozenset({"spanId"}),
    "node.started": frozenset(
        {
            "graphId",
            "graphHash",
            "caseId",
            "stageId",
            "caseContentHash",
            "nodeId",
            "nodeRunId",
        }
    ),
    "edge.consumed": frozenset(
        {
            "graphId",
            "graphHash",
            "caseId",
            "stageId",
            "caseContentHash",
            "nodeId",
            "nodeRunId",
            "edgeId",
            "bindingId",
            "bindingHash",
            "artifactId",
            "artifactSchemaVersion",
            "artifactContentHash",
            "authorityKind",
        }
    ),
    "artifact.produced": frozenset(
        {
            "graphId",
            "graphHash",
            "caseId",
            "stageId",
            "caseContentHash",
            "nodeId",
            "nodeRunId",
            "artifactId",
            "artifactSchemaVersion",
            "artifactContentHash",
            "authorityKind",
        }
    ),
    "node.completed": frozenset(
        {
            "graphId",
            "graphHash",
            "caseId",
            "stageId",
            "caseContentHash",
            "nodeId",
            "nodeRunId",
            "status",
        }
    ),
    "node.failed": frozenset(
        {
            "graphId",
            "graphHash",
            "caseId",
            "stageId",
            "caseContentHash",
            "nodeId",
            "nodeRunId",
            "status",
        }
    ),
    "barrier.opened": frozenset(
        {
            "graphId",
            "graphHash",
            "caseId",
            "stageId",
            "caseContentHash",
            "nodeId",
            "nodeRunId",
            "frontierHash",
        }
    ),
    "barrier.blocked": frozenset(
        {
            "graphId",
            "graphHash",
            "caseId",
            "stageId",
            "caseContentHash",
            "nodeId",
            "nodeRunId",
            "frontierHash",
        }
    ),
    "run.completed": frozenset({"status"}),
    "run.failed": frozenset({"status"}),
}
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


class NodeKitReplayContractError(ValueError):
    """Typed fail-closed error for malformed or incomplete exports."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code


def _fail(code: str, message: str) -> None:
    raise NodeKitReplayContractError(code, message)


def canonical_json_text(value: Any) -> str:
    """RFC 8785 bytes shared with the TypeScript/ECMAScript exporter."""

    try:
        return rfc8785.dumps(value).decode("utf-8")
    except (TypeError, ValueError, rfc8785.CanonicalizationError) as exc:
        _fail("non_json_value", f"Value is not canonical JSON: {exc}")


def canonical_hash(value: Any) -> str:
    encoded = canonical_json_text(value).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _expect_object(value: Any, path: str) -> dict[str, Any]:
    if type(value) is not dict:
        _fail("shape_invalid", f"{path} must be an object")
    return value


def _expect_exact_keys(
    value: dict[str, Any],
    path: str,
    expected: set[str],
) -> None:
    actual = set(value)
    if actual != expected:
        _fail(
            "shape_invalid",
            f"{path} keys differ: missing={sorted(expected - actual)}, "
            f"unexpected={sorted(actual - expected)}",
        )


def _expect_hash(value: Any, path: str) -> str:
    if (
        not isinstance(value, str)
        or not value.startswith("sha256:")
        or len(value) != 71
        or any(character not in "0123456789abcdef" for character in value[7:])
    ):
        _fail("hash_invalid", f"{path} must be a lowercase sha256: digest")
    return value


def _expect_string(
    value: Any,
    path: str,
    *,
    non_empty: bool = False,
    max_length: int | None = None,
) -> str:
    if (
        not isinstance(value, str)
        or (non_empty and not value.strip())
        or (max_length is not None and len(value) > max_length)
    ):
        _fail("shape_invalid", f"{path} must be a valid string")
    return value


def _expect_timestamp(value: Any, path: str) -> int:
    if (
        type(value) is not int
        or value < 0
        or value > 9_007_199_254_740_991
    ):
        _fail(
            "shape_invalid",
            f"{path} must be a non-negative JavaScript-safe integer",
        )
    return value


def _expect_safe_payload(
    value: Any,
    path: str,
    event_type: str,
) -> dict[str, Any]:
    payload = _expect_object(value, path)
    _expect_exact_keys(
        payload,
        path,
        {"projectionVersion", "sourceDigest", "sourceBytes", "fields"},
    )
    if payload["projectionVersion"] != SAFE_PAYLOAD_SCHEMA_VERSION:
        _fail("payload_version_mismatch", f"{path} version is unsupported")
    _expect_hash(payload["sourceDigest"], f"{path}.sourceDigest")
    source_bytes = payload["sourceBytes"]
    if (
        type(source_bytes) is not int
        or source_bytes < 0
        or source_bytes > MAX_REDACTED_SOURCE_BYTES
    ):
        _fail("payload_size_invalid", f"{path}.sourceBytes exceeds its bound")
    fields = _expect_object(payload["fields"], f"{path}.fields")
    allowed = SAFE_FIELDS_BY_EVENT[event_type]
    for field, field_value in fields.items():
        if field not in allowed:
            _fail(
                "payload_field_invalid",
                f"{path}.fields.{field} is not allowed",
            )
        if (
            field_value is not None
            and type(field_value) not in {str, int, float, bool}
        ):
            _fail(
                "payload_field_invalid",
                f"{path}.fields.{field} must be scalar",
            )
        if (
            isinstance(field_value, str)
            and len(field_value) > 256
        ) or (
            type(field_value) is float
            and not (-float("inf") < field_value < float("inf"))
        ):
            _fail(
                "payload_field_invalid",
                f"{path}.fields.{field} exceeds its bound",
            )
    missing = REQUIRED_FIELDS_BY_EVENT.get(event_type, frozenset()) - set(
        fields
    )
    if missing:
        _fail(
            "payload_field_missing",
            f"{path} is missing safe fields {sorted(missing)}",
        )
    expected_terminal_status = {
        "run.completed": "completed",
        "run.failed": "error",
    }.get(event_type)
    if (
        expected_terminal_status is not None
        and fields.get("status") != expected_terminal_status
    ):
        _fail(
            "terminal_status_mismatch",
            f"{path} requires status {expected_terminal_status}",
        )
    if event_type == "run.started":
        identity_fields = {
            "identityRef",
            "workspaceId",
            "agentId",
            "nativeSessionId",
            "nativeSessionGeneration",
            "identitySnapshotHash",
        }
        present = identity_fields & set(fields)
        if present and present != identity_fields:
            _fail(
                "native_identity_incomplete",
                f"{path} must bind the complete native identity snapshot",
            )
        if present:
            _expect_hash(
                fields["identitySnapshotHash"],
                f"{path}.fields.identitySnapshotHash",
            )
            generation = fields["nativeSessionGeneration"]
            if (
                type(generation) is not int
                or generation < 0
                or generation > 9_007_199_254_740_991
            ):
                _fail(
                    "native_session_generation_invalid",
                    f"{path}.fields.nativeSessionGeneration is invalid",
                )
    if event_type in {
        "node.started",
        "edge.consumed",
        "artifact.produced",
        "node.completed",
        "node.failed",
        "barrier.opened",
        "barrier.blocked",
    }:
        graph_id = fields.get("graphId")
        if (
            not isinstance(graph_id, str)
            or re.fullmatch(
                r"execution-graph:sha256:[a-f0-9]{64}",
                graph_id,
            )
            is None
        ):
            _fail("graph_id_invalid", f"{path}.fields.graphId is invalid")
        for field in {
            "graphHash",
            "caseContentHash",
            "frontierHash",
            "bindingHash",
            "artifactContentHash",
        }:
            if field in fields and (
                not isinstance(fields[field], str)
                or re.fullmatch(r"[a-f0-9]{64}", fields[field]) is None
            ):
                _fail(
                    "graph_hash_invalid",
                    f"{path}.fields.{field} is invalid",
                )
        binding_id = fields.get("bindingId")
        if binding_id is not None and (
            not isinstance(binding_id, str)
            or re.fullmatch(
                r"execution-edge-binding:sha256:[a-f0-9]{64}",
                binding_id,
            )
            is None
        ):
            _fail(
                "edge_binding_id_invalid",
                f"{path}.fields.bindingId is invalid",
            )
    if len(canonical_json_text(payload).encode("utf-8")) > MAX_STORED_PAYLOAD_BYTES:
        _fail("projected_payload_too_large", f"{path} exceeds its stored bound")
    return payload


def _event_hash_body(event: dict[str, Any]) -> dict[str, Any]:
    return {
        "contractVersion": event["contractVersion"],
        "runId": event["runId"],
        "sequence": event["sequence"],
        "eventType": event["eventType"],
        "recordedAt": event["recordedAt"],
        "payload": event["payload"],
        "previousHash": event["previousHash"],
    }


def validate_nodekit_export(value: Any) -> dict[str, Any]:
    """Validate exact shape, order, hash-chain, completeness, and export hash."""

    document = _expect_object(deepcopy(value), "$")
    _expect_exact_keys(
        document,
        "$",
        {
            "schemaVersion",
            "runId",
            "session",
            "trace",
            "events",
            "completeness",
            "hashes",
        },
    )
    if document["schemaVersion"] != EXPORT_SCHEMA_VERSION:
        _fail("export_schema_mismatch", "Unsupported NodeKit export schema")
    run_id = document["runId"]
    if (
        not isinstance(run_id, str)
        or not run_id.strip()
        or len(run_id) > 256
    ):
        _fail("run_id_invalid", "$.runId must contain 1-256 characters")
    session = _expect_object(document["session"], "$.session")
    trace = _expect_object(document["trace"], "$.trace")
    completeness = _expect_object(document["completeness"], "$.completeness")
    hashes = _expect_object(document["hashes"], "$.hashes")
    _expect_exact_keys(
        session,
        "$.session",
        {
            "id",
            "typeAtRunStart",
            "startedAt",
            *(["nativeIdentity"] if "nativeIdentity" in session else []),
        },
    )
    _expect_exact_keys(
        trace,
        "$.trace",
        {"id", "runId", "workflowName", "status", "startedAt", "endedAt"},
    )
    _expect_exact_keys(
        completeness,
        "$.completeness",
        {
            "eventChainComplete",
            "spanLifecycleComplete",
            "contractVersion",
            "eventCount",
            "firstSequence",
            "lastSequence",
            "terminalEventType",
        },
    )
    _expect_string(session["id"], "$.session.id", non_empty=True)
    _expect_string(
        session["typeAtRunStart"],
        "$.session.typeAtRunStart",
        non_empty=True,
        max_length=256,
    )
    session_started_at = _expect_timestamp(
        session["startedAt"],
        "$.session.startedAt",
    )
    native_identity = None
    if "nativeIdentity" in session:
        native_identity = _expect_object(
            session["nativeIdentity"],
            "$.session.nativeIdentity",
        )
        _expect_exact_keys(
            native_identity,
            "$.session.nativeIdentity",
            {
                "schemaVersion",
                "identityRef",
                "agentId",
                "workspaceId",
                "nativeSessionId",
                "nativeSessionGeneration",
                *(["peerId"] if "peerId" in native_identity else []),
                "snapshotHash",
            },
        )
        if (
            native_identity["schemaVersion"]
            != "nodekit.native-agent-session-identity/v1"
        ):
            _fail(
                "native_identity_snapshot_mismatch",
                "$.session.nativeIdentity schema is unsupported",
            )
        for field in {
            "identityRef",
            "agentId",
            "workspaceId",
            "nativeSessionId",
        }:
            _expect_string(
                native_identity[field],
                f"$.session.nativeIdentity.{field}",
                non_empty=True,
                max_length=256,
            )
        if "peerId" in native_identity:
            _expect_string(
                native_identity["peerId"],
                "$.session.nativeIdentity.peerId",
                non_empty=True,
                max_length=256,
            )
        generation = native_identity["nativeSessionGeneration"]
        if (
            type(generation) is not int
            or generation < 0
            or generation > 9_007_199_254_740_991
        ):
            _fail(
                "native_session_generation_invalid",
                "$.session.nativeIdentity.nativeSessionGeneration is invalid",
            )
        _expect_hash(
            native_identity["snapshotHash"],
            "$.session.nativeIdentity.snapshotHash",
        )
    _expect_string(trace["id"], "$.trace.id", non_empty=True)
    _expect_string(
        trace["runId"],
        "$.trace.runId",
        non_empty=True,
        max_length=256,
    )
    _expect_string(
        trace["workflowName"],
        "$.trace.workflowName",
        non_empty=True,
    )
    if trace["status"] not in {"completed", "error"}:
        _fail("run_not_terminal", "$.trace.status must be completed or error")
    trace_started_at = _expect_timestamp(
        trace["startedAt"],
        "$.trace.startedAt",
    )
    trace_ended_at = _expect_timestamp(
        trace["endedAt"],
        "$.trace.endedAt",
    )
    if trace_ended_at < trace_started_at:
        _fail(
            "shape_invalid",
            "$.trace.endedAt cannot precede startedAt",
        )
    if trace.get("runId") != run_id:
        _fail("run_id_mismatch", "Trace and export run IDs differ")
    events = document["events"]
    if not isinstance(events, list) or len(events) < 2:
        _fail(
            "terminal_event_missing",
            "A complete run requires start and terminal events",
        )
    if len(events) > MAX_EVENTS:
        _fail(
            "event_limit_exceeded",
            f"Run exceeds the {MAX_EVENTS}-event bound",
        )

    previous_hash = GENESIS_HASH
    terminal_indexes: list[int] = []
    event_keys = {
        "contractVersion",
        "runId",
        "sequence",
        "eventType",
        "recordedAt",
        "payload",
        "previousHash",
        "contentHash",
    }
    open_spans: set[str] = set()
    completed_spans: set[str] = set()
    open_nodes: dict[str, str] = {}
    closed_node_runs: set[str] = set()
    graph_scope: str | None = None
    for index, candidate in enumerate(events):
        event = _expect_object(candidate, f"$.events[{index}]")
        _expect_exact_keys(event, f"$.events[{index}]", event_keys)
        if event["contractVersion"] != EVENT_SCHEMA_VERSION:
            _fail(
                "contract_version_mismatch",
                f"$.events[{index}] contract is unsupported",
            )
        if event["runId"] != run_id:
            _fail("run_id_mismatch", f"$.events[{index}] belongs to another run")
        if type(event["sequence"]) is not int or event["sequence"] != index:
            _fail(
                "sequence_not_contiguous",
                f"Expected sequence {index}, received {event['sequence']!r}",
            )
        if event["eventType"] not in EVENT_TYPES:
            _fail(
                "event_type_invalid",
                f"$.events[{index}].eventType is unsupported",
            )
        payload = _expect_safe_payload(
            event["payload"],
            f"$.events[{index}].payload",
            event["eventType"],
        )
        recorded_at = _expect_timestamp(
            event["recordedAt"],
            f"$.events[{index}].recordedAt",
        )
        if index > 0 and recorded_at < events[index - 1]["recordedAt"]:
            _fail(
                "recorded_at_not_monotonic",
                f"$.events[{index}] was recorded before its predecessor",
            )
        _expect_hash(event["previousHash"], f"$.events[{index}].previousHash")
        _expect_hash(event["contentHash"], f"$.events[{index}].contentHash")
        if event["previousHash"] != previous_hash:
            _fail(
                "previous_hash_mismatch",
                f"$.events[{index}] does not point to the preceding event",
            )
        if event["contentHash"] != canonical_hash(_event_hash_body(event)):
            _fail(
                "content_hash_mismatch",
                f"$.events[{index}] content does not match its hash",
            )
        if event["eventType"] in TERMINAL_TYPES:
            terminal_indexes.append(index)
        if event["eventType"] == "span.started":
            span_id = payload["fields"].get("spanId")
            if (
                not isinstance(span_id, str)
                or not span_id
                or span_id in open_spans
                or span_id in completed_spans
            ):
                _fail(
                    "span_duplicate_start",
                    f"Invalid start for span {span_id!r}",
                )
            open_spans.add(span_id)
        if event["eventType"] == "span.completed":
            span_id = payload["fields"].get("spanId")
            if not isinstance(span_id, str) or span_id not in open_spans:
                _fail(
                    "span_completion_without_start",
                    f"Invalid completion for span {span_id!r}",
                )
            open_spans.remove(span_id)
            completed_spans.add(span_id)
        if event["eventType"] in {
            "node.started",
            "edge.consumed",
            "artifact.produced",
            "node.completed",
            "node.failed",
            "barrier.opened",
            "barrier.blocked",
        }:
            fields = payload["fields"]
            current_scope = "|".join(
                str(fields[field])
                for field in (
                    "graphId",
                    "graphHash",
                    "caseId",
                    "stageId",
                    "caseContentHash",
                )
            )
            if graph_scope is None:
                graph_scope = current_scope
            if current_scope != graph_scope:
                _fail(
                    "graph_scope_mismatch",
                    "One export cannot mix execution graphs, cases, or stages",
                )
            node_run_id = fields["nodeRunId"]
            node_id = fields["nodeId"]
            if event["eventType"] == "node.started":
                if (
                    node_run_id in open_nodes
                    or node_run_id in closed_node_runs
                ):
                    _fail(
                        "graph_node_duplicate_start",
                        f"Invalid start for {node_run_id}",
                    )
                open_nodes[node_run_id] = node_id
            else:
                if open_nodes.get(node_run_id) != node_id:
                    _fail(
                        "graph_node_not_running",
                        f"{event['eventType']} is not bound to {node_run_id}",
                    )
                if event["eventType"] in {"node.completed", "node.failed"}:
                    del open_nodes[node_run_id]
                    closed_node_runs.add(node_run_id)
        previous_hash = event["contentHash"]

    if events[0]["eventType"] != "run.started":
        _fail("start_event_missing", "Sequence 0 must be run.started")
    if events[0]["previousHash"] != GENESIS_HASH:
        _fail(
            "previous_hash_mismatch",
            "run.started must point to the genesis hash",
        )
    if not terminal_indexes:
        _fail("terminal_event_missing", "The event chain has no terminal event")
    if terminal_indexes != [len(events) - 1]:
        _fail(
            "terminal_event_not_last",
            "Exactly one terminal event must be last",
        )
    if open_spans:
        _fail(
            "span_lifecycle_incomplete",
            f"Terminal run retains {len(open_spans)} open span(s)",
        )
    if open_nodes:
        _fail(
            "graph_node_lifecycle_incomplete",
            f"Terminal run retains {len(open_nodes)} open graph node(s)",
        )

    terminal_type = events[-1]["eventType"]
    expected_trace_status = (
        "completed" if terminal_type == "run.completed" else "error"
    )
    if trace["status"] != expected_trace_status:
        _fail(
            "terminal_status_mismatch",
            f"Trace status {trace['status']} does not match {terminal_type}",
        )
    start_fields = events[0]["payload"]["fields"]
    if (
        trace["workflowName"] != start_fields["workflowName"]
        or trace["startedAt"] != events[0]["recordedAt"]
        or trace["endedAt"] != events[-1]["recordedAt"]
        or session["typeAtRunStart"] != start_fields["sessionType"]
        or session["startedAt"] != start_fields["sessionStartedAt"]
        or session_started_at > trace_started_at
    ):
        _fail(
            "event_snapshot_mismatch",
            "Session or trace metadata differs from immutable event snapshots",
        )
    identity_fields = {
        "identityRef",
        "workspaceId",
        "agentId",
        "nativeSessionId",
        "nativeSessionGeneration",
        "identitySnapshotHash",
    }
    present_identity_fields = identity_fields & set(start_fields)
    if not present_identity_fields and native_identity is not None:
        _fail(
            "native_identity_snapshot_mismatch",
            "Session identity is absent from run.started",
        )
    if present_identity_fields:
        if present_identity_fields != identity_fields:
            _fail(
                "native_identity_incomplete",
                "run.started does not bind a complete native identity snapshot",
            )
        expected_identity_body = {
            "schemaVersion": "nodekit.native-agent-session-identity/v1",
            "identityRef": start_fields["identityRef"],
            "agentId": start_fields["agentId"],
            "workspaceId": start_fields["workspaceId"],
            "nativeSessionId": start_fields["nativeSessionId"],
            "nativeSessionGeneration": start_fields[
                "nativeSessionGeneration"
            ],
            **(
                {}
                if "peerId" not in start_fields
                else {"peerId": start_fields["peerId"]}
            ),
        }
        expected_identity = {
            **expected_identity_body,
            "snapshotHash": canonical_hash(expected_identity_body),
        }
        if (
            native_identity != expected_identity
            or start_fields["identitySnapshotHash"]
            != expected_identity["snapshotHash"]
        ):
            _fail(
                "native_identity_snapshot_mismatch",
                "Session identity differs from immutable run.started fields",
            )
    expected_completeness = {
        "eventChainComplete": True,
        "spanLifecycleComplete": True,
        "contractVersion": EVENT_SCHEMA_VERSION,
        "eventCount": len(events),
        "firstSequence": 0,
        "lastSequence": len(events) - 1,
        "terminalEventType": terminal_type,
    }
    if completeness != expected_completeness:
        _fail(
            "completeness_mismatch",
            "Completeness receipt does not match the event chain",
        )
    _expect_exact_keys(
        hashes,
        "$.hashes",
        {"algorithm", "chainHead", "exportHash"},
    )
    if hashes["algorithm"] != "sha256" or hashes["chainHead"] != previous_hash:
        _fail("chain_head_mismatch", "Export chain head does not match events")
    _expect_hash(hashes["exportHash"], "$.hashes.exportHash")
    expected_export_hash = canonical_hash(
        {
            "schemaVersion": document["schemaVersion"],
            "runId": run_id,
            "session": session,
            "trace": trace,
            "events": events,
            "completeness": completeness,
            "hashes": {
                "algorithm": hashes["algorithm"],
                "chainHead": hashes["chainHead"],
            },
        }
    )
    if hashes["exportHash"] != expected_export_hash:
        _fail("export_hash_mismatch", "Export content does not match exportHash")
    return document


def _activegraph_run_id(nodekit_run_id: str) -> str:
    """Map a NodeKit run ID deterministically into a valid 128-bit ULID string."""

    value = int.from_bytes(
        hashlib.sha256(nodekit_run_id.encode("utf-8")).digest()[:16],
        "big",
    )
    output = []
    for _ in range(26):
        output.append(_CROCKFORD[value & 31])
        value >>= 5
    return "".join(reversed(output))


def _clock_iso(recorded_at_ms: int) -> str:
    return datetime.fromtimestamp(
        recorded_at_ms / 1000,
        tz=timezone.utc,
    ).isoformat().replace("+00:00", "Z")


def _close_runtime(runtime: Runtime | None) -> None:
    if runtime is None:
        return
    store = runtime.graph.store
    if store is not None:
        store.close()


def _nodekit_payloads(runtime: Runtime) -> list[dict[str, Any]]:
    return [
        deepcopy(event.payload["nodekit_event"])
        for event in runtime.graph.events
        if event.type == "nodekit.event"
    ]


def run_nodekit_replay_canary(
    input_doc: dict[str, Any],
    db_path: Path,
    *,
    _test_only_allow_host_runtime: bool = False,
) -> dict[str, Any]:
    """Persist and reload an exact canonical export in isolated ActiveGraph."""

    if os.environ.get("NODEBENCH_ACTIVEGRAPH_MODE") != OFFLINE_MODE:
        _fail(
            "offline_mode_required",
            "NODEBENCH_ACTIVEGRAPH_MODE=offline-observer is required",
        )
    sandbox_image = os.environ.get(SANDBOX_IMAGE_ENV, "")
    if re.fullmatch(
        r"(?:[a-z0-9._/-]+@)?sha256:[a-f0-9]{64}",
        sandbox_image,
    ) is None:
        _fail(
            "sandbox_image_required",
            f"{SANDBOX_IMAGE_ENV} must identify an immutable Docker image",
        )
    attested_digests: dict[str, str] = {}
    for name in (
        BUILD_INPUTS_HASH_ENV,
        UPSTREAM_HASH_ENV,
        IMAGE_ATTESTATION_HASH_ENV,
    ):
        value = os.environ.get(name, "")
        if re.fullmatch(r"sha256:[a-f0-9]{64}", value) is None:
            _fail(
                "image_attestation_required",
                f"{name} must be an attested sha256 digest",
            )
        attested_digests[name] = value
    nodebench_candidate_commit = os.environ.get(CANDIDATE_COMMIT_ENV, "")
    if re.fullmatch(r"[a-f0-9]{40}", nodebench_candidate_commit) is None:
        _fail(
            "image_attestation_required",
            f"{CANDIDATE_COMMIT_ENV} must be a full Git SHA-1",
        )
    if (
        not _test_only_allow_host_runtime
        and not Path("/.dockerenv").is_file()
    ):
        _fail(
            "sandbox_runtime_required",
            "The replay CLI must execute inside its locked Docker boundary",
        )
    if activegraph.__version__ != ACTIVEGRAPH_VERSION:
        raise RuntimeError(
            "ActiveGraph version mismatch: "
            f"expected {ACTIVEGRAPH_VERSION}, got {activegraph.__version__}"
        )
    if not isinstance(db_path, Path):
        raise TypeError("db_path must be a pathlib.Path")
    document = validate_nodekit_export(input_doc)
    if db_path.exists():
        _fail("db_exists", f"db_path already exists: {db_path}")
    db_path.parent.mkdir(parents=True, exist_ok=True)

    live_runtime: Runtime | None = None
    reloaded_runtime: Runtime | None = None
    try:
        graph = Graph(
            clock=FrozenClock(_clock_iso(document["events"][0]["recordedAt"])),
            run_id=_activegraph_run_id(document["runId"]),
        )
        live_runtime = Runtime(
            graph,
            behaviors=[],
            persist_to=str(db_path),
            seed=0,
            trace_context_reads=True,
        )
        for event in document["events"]:
            graph.emit(
                Event(
                    id=graph.ids.event(),
                    type="nodekit.event",
                    payload={"nodekit_event": deepcopy(event)},
                    actor="nodebench-offline-observer",
                    timestamp=_clock_iso(event["recordedAt"]),
                )
            )
        live_runtime.run_until_idle()
        live_payloads = _nodekit_payloads(live_runtime)

        _close_runtime(live_runtime)
        reloaded_runtime = Runtime.load(
            str(db_path),
            run_id=live_runtime.run_id,
            behaviors=[],
            seed=0,
            trace_context_reads=True,
        )
        reloaded_payloads = _nodekit_payloads(reloaded_runtime)
        parity = (
            live_payloads == document["events"]
            and reloaded_payloads == document["events"]
        )
        return {
            "schema_version": OUTPUT_SCHEMA_VERSION,
            "activegraph": {
                "version": ACTIVEGRAPH_VERSION,
                "release_commit": ACTIVEGRAPH_RELEASE_COMMIT,
                "annotated_tag_object": ACTIVEGRAPH_ANNOTATED_TAG_OBJECT,
                "inspected_ref": ACTIVEGRAPH_INSPECTED_REF,
            },
            "isolation": {
                "runtime": "docker",
                "image": sandbox_image,
                "network": "none",
                "rootFilesystem": "read-only",
                "writableMount": "/evidence",
                "buildInputsHash": attested_digests[BUILD_INPUTS_HASH_ENV],
                "nodebenchCandidateCommit": nodebench_candidate_commit,
                "upstreamHash": attested_digests[UPSTREAM_HASH_ENV],
                "imageAttestationHash": attested_digests[
                    IMAGE_ATTESTATION_HASH_ENV
                ],
            },
            "mode": OFFLINE_MODE,
            "run_id": document["runId"],
            "input_export_sha256": document["hashes"]["exportHash"],
            "event_count": len(document["events"]),
            "nodekit_chain_head": document["hashes"]["chainHead"],
            "replayed_events_sha256": canonical_hash(reloaded_payloads),
            "persisted_reload_parity": parity,
            "verdict": "pass" if parity else "fail",
            "limitations": [
                (
                    "Offline observer only: this disposable SQLite history "
                    "cannot answer, approve, mutate, or replace NodeBench state."
                ),
                (
                    "A passing replay proves exact persistence/reload parity "
                    "for this exported event sequence, not production adoption."
                ),
                (
                    "ActiveGraph upstream issue #67 remains an adoption blocker; "
                    "the adapter deep-copies every accepted event payload."
                ),
            ],
        }
    finally:
        _close_runtime(reloaded_runtime)
        _close_runtime(live_runtime)

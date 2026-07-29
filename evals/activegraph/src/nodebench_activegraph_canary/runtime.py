"""Offline ActiveGraph graph-hop fork/diff canary.

This module deliberately uses only ActiveGraph's instance-level ``Behavior``
surface. It does not touch the process-global decorator registry.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from pathlib import Path
import re
from typing import Any

import activegraph
from activegraph import Behavior, FrozenClock, Graph, IDGen, Runtime

from .canonical import canonical_sha256


INPUT_SCHEMA_VERSION = "nodebench.activegraph.graph-hop-input.v1"
OUTPUT_SCHEMA_VERSION = "nodebench.activegraph.graph-hop-output.v1"
ACTIVEGRAPH_VERSION = "1.10.0"
ACTIVEGRAPH_INSPECTED_REF = "8aedb1866cf5dce056af97529152ffd6f468a1ed"

_SCORE_FIELDS = (
    "semantic_score_bp",
    "graph_score_bp",
    "source_quality_bp",
)
_DOMAIN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:#/-]*$")
_CASE_ID_RE = re.compile(r"^[a-z0-9]+(?:[-_][a-z0-9]+)*$")
_RUN_ID_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")
_RFC3339_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}"
    r"(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$"
)

_LIMITATIONS = [
    (
        "ActiveGraph strict replay checks behavior execution boundaries but "
        "does not prove arbitrary nested payload equality."
    ),
    (
        "This canary is offline, SQLite-backed, and single-writer; it does "
        "not validate a production NodeBench integration."
    ),
    (
        "Upstream ActiveGraph issue #67 blocks system-of-record use until "
        "accepted nested payloads are protected from caller mutation."
    ),
    (
        "This synthetic golden case characterizes fork/diff mechanics only; "
        "canonical NodeKit export replay is evaluated by the separate offline "
        "replay lane."
    ),
]


class DeterministicRunIDGen(IDGen):
    """Use one configured run ID for the single fork created by this canary."""

    def __init__(self, fork_run_id: str) -> None:
        super().__init__()
        self._fork_run_id = fork_run_id
        self._issued = False

    def run(self) -> str:
        if self._issued:
            raise RuntimeError(
                "DeterministicRunIDGen is configured for exactly one fork run"
            )
        self._issued = True
        return self._fork_run_id


def run_canary(input_doc: dict[str, Any], db_path: Path) -> dict[str, Any]:
    """Run one deterministic baseline/fork graph-hop comparison.

    ``input_doc`` is deep-copied before validation and never mutated. ``db_path``
    must not already exist because a canary database is immutable evidence for
    one invocation.
    """

    if type(input_doc) is not dict:
        raise ValueError("input must be a JSON object")
    if not isinstance(db_path, Path):
        raise TypeError("db_path must be a pathlib.Path")
    if activegraph.__version__ != ACTIVEGRAPH_VERSION:
        raise RuntimeError(
            "ActiveGraph version mismatch: "
            f"expected {ACTIVEGRAPH_VERSION}, got {activegraph.__version__}"
        )

    document = deepcopy(input_doc)
    _validate_input(document)
    input_sha256 = canonical_sha256(document)

    if db_path.exists():
        raise ValueError(f"db_path already exists: {db_path}")
    db_path.parent.mkdir(parents=True, exist_ok=True)

    determinism = document["determinism"]
    timestamp_iso = _normalize_rfc3339_for_clock(
        determinism["timestamp_iso"]
    )
    baseline_policy = document["policies"]["baseline"]
    variant_policy = document["policies"]["variant"]

    parent_runtime: Runtime | None = None
    fork_runtime: Runtime | None = None
    reloaded_parent_runtime: Runtime | None = None
    reloaded_fork_runtime: Runtime | None = None
    try:
        ids = DeterministicRunIDGen(determinism["fork_run_id"])
        parent_graph = Graph(
            ids=ids,
            clock=FrozenClock(timestamp_iso),
            run_id=determinism["parent_run_id"],
        )
        parent_runtime = Runtime(
            parent_graph,
            behaviors=[_selection_behavior(baseline_policy)],
            persist_to=str(db_path),
            seed=0,
            trace_context_reads=True,
        )

        evaluation_request = _materialize_topology(parent_graph, document)
        fork_event = parent_graph.events[-1]

        fork_runtime = parent_runtime.fork(
            at_event=fork_event.id,
            label="graph-hop-policy-variant",
            behaviors=[_selection_behavior(variant_policy)],
        )
        # Runtime.fork reconstructs a Graph with its default wall clock.
        # Replace it before any queued behavior is allowed to run.
        fork_runtime.graph.clock = FrozenClock(timestamp_iso)

        parent_runtime.run_until_idle()
        fork_runtime.run_until_idle()

        activegraph_diff = parent_runtime.diff(fork_runtime)
        normalized_diff = _normalize_diff(activegraph_diff)
        baseline_run = _summarize_run(parent_runtime, baseline_policy)
        variant_run = _summarize_run(fork_runtime, variant_policy)

        assertions = _build_assertions(
            document=document,
            baseline_runtime=parent_runtime,
            fork_runtime=fork_runtime,
            baseline_run=baseline_run,
            variant_run=variant_run,
            normalized_diff=normalized_diff,
        )

        live_fingerprints = {
            "baseline": _event_log_fingerprint(parent_runtime),
            "variant": _event_log_fingerprint(fork_runtime),
        }
        # Prove the stored log can reconstruct both projections from fresh
        # Runtime instances. Close the live writers first so this exercises
        # the same handle boundary callers encounter on Windows.
        _close_runtime_store(fork_runtime)
        _close_runtime_store(parent_runtime)
        reloaded_parent_runtime = Runtime.load(
            str(db_path),
            run_id=parent_runtime.run_id,
            behaviors=[],
            seed=0,
            trace_context_reads=True,
        )
        reloaded_fork_runtime = Runtime.load(
            str(db_path),
            run_id=fork_runtime.run_id,
            behaviors=[],
            seed=0,
            trace_context_reads=True,
        )
        reloaded_fingerprints = {
            "baseline": _event_log_fingerprint(reloaded_parent_runtime),
            "variant": _event_log_fingerprint(reloaded_fork_runtime),
        }
        assertions.append(
            _assertion(
                "persisted-reload-parity",
                live_fingerprints,
                reloaded_fingerprints,
            )
        )

        return {
            "schema_version": OUTPUT_SCHEMA_VERSION,
            "activegraph": {
                "version": ACTIVEGRAPH_VERSION,
                "inspected_ref": ACTIVEGRAPH_INSPECTED_REF,
            },
            "case_id": document["case_id"],
            "input_sha256": input_sha256,
            "fork_point": {
                "event_id": fork_event.id,
                "event_type": fork_event.type,
                "object_id": evaluation_request.id,
            },
            "runs": {
                "baseline": baseline_run,
                "variant": variant_run,
            },
            "diff": normalized_diff,
            "assertions": assertions,
            "verdict": (
                "pass" if all(assertion["passed"] for assertion in assertions)
                else "fail"
            ),
            "limitations": list(_LIMITATIONS),
        }
    finally:
        # Each runtime owns a distinct SQLite connection to the same file.
        # Close the fork first, then the parent, so Windows releases every
        # handle before the caller moves or deletes the artifact.
        for runtime in (
            reloaded_fork_runtime,
            reloaded_parent_runtime,
            fork_runtime,
            parent_runtime,
        ):
            if runtime is None:
                continue
            _close_runtime_store(runtime)


def inspect_payload_isolation(
    input_doc: dict[str, Any],
    db_path: Path,
) -> dict[str, Any]:
    """Exercise the adapter's deepcopy boundary while the live graph is open.

    The helper mutates an internal caller-side copy after emitting a separate
    deepcopy, then returns the accepted live, persisted, and reloaded candidate
    payloads. It makes the upstream issue #67 boundary observable without
    exposing a live Runtime or mutating the caller's document.
    """

    if type(input_doc) is not dict:
        raise ValueError("input must be a JSON object")
    if not isinstance(db_path, Path):
        raise TypeError("db_path must be a pathlib.Path")
    if activegraph.__version__ != ACTIVEGRAPH_VERSION:
        raise RuntimeError(
            "ActiveGraph version mismatch: "
            f"expected {ACTIVEGRAPH_VERSION}, got {activegraph.__version__}"
        )
    document = deepcopy(input_doc)
    _validate_input(document)
    if db_path.exists():
        raise ValueError(f"db_path already exists: {db_path}")
    db_path.parent.mkdir(parents=True, exist_ok=True)

    caller_side_candidate = deepcopy(
        sorted(
            document["candidates"],
            key=lambda candidate: candidate["candidate_id"],
        )[0]
    )
    expected_candidate = deepcopy(caller_side_candidate)
    live_runtime: Runtime | None = None
    reloaded_runtime: Runtime | None = None
    persisted_store: Any = None
    try:
        graph = Graph(
            clock=FrozenClock(
                _normalize_rfc3339_for_clock(
                    document["determinism"]["timestamp_iso"]
                )
            ),
            run_id=document["determinism"]["parent_run_id"],
        )
        live_runtime = Runtime(
            graph,
            behaviors=[],
            persist_to=str(db_path),
            seed=0,
        )
        candidate_object = graph.add_object(
            "candidate",
            deepcopy(caller_side_candidate),
        )

        # This is the caller-accessible object. Mutating it while the graph is
        # live must not alter the separate payload passed across our boundary.
        caller_side_candidate["label"] = "mutated after emit"
        caller_side_candidate["hop_path"][0][
            "evidence_id"
        ] = "mutation:must-not-cross-boundary"

        live_event = next(
            event
            for event in graph.events
            if event.type == "object.created"
            and event.payload["object"]["id"] == candidate_object.id
        )
        live_event_candidate = deepcopy(
            live_event.payload["object"]["data"]
        )
        projected = graph.get_object(candidate_object.id)
        if projected is None:
            raise RuntimeError("live candidate projection is missing")
        live_projection_candidate = deepcopy(projected.data)

        from activegraph import SQLiteEventStore

        persisted_store = SQLiteEventStore(
            str(db_path),
            run_id=live_runtime.run_id,
        )
        persisted_event = next(
            event
            for event in persisted_store.iter_events()
            if event.type == "object.created"
            and event.payload["object"]["id"] == candidate_object.id
        )
        persisted_event_candidate = deepcopy(
            persisted_event.payload["object"]["data"]
        )
        persisted_store.close()
        persisted_store = None

        _close_runtime_store(live_runtime)
        reloaded_runtime = Runtime.load(
            str(db_path),
            run_id=live_runtime.run_id,
            behaviors=[],
            seed=0,
        )
        reloaded = reloaded_runtime.graph.get_object(candidate_object.id)
        if reloaded is None:
            raise RuntimeError("reloaded candidate projection is missing")

        return {
            "expected_candidate": expected_candidate,
            "live_event_candidate": live_event_candidate,
            "live_projection_candidate": live_projection_candidate,
            "persisted_event_candidate": persisted_event_candidate,
            "reloaded_projection_candidate": deepcopy(reloaded.data),
        }
    finally:
        if reloaded_runtime is not None:
            _close_runtime_store(reloaded_runtime)
        if persisted_store is not None:
            persisted_store.close()
        if live_runtime is not None:
            _close_runtime_store(live_runtime)


def _selection_behavior(policy_input: dict[str, Any]) -> Behavior:
    policy = deepcopy(policy_input)

    def select_candidate(event: Any, graph: Any, ctx: Any) -> None:
        query_id = event.payload["object"]["data"]["query_id"]
        query_objects = sorted(
            ctx.view.objects(type="query"),
            key=lambda query: query.data["query_id"],
        )
        matching_queries = [
            query for query in query_objects if query.data["query_id"] == query_id
        ]
        if len(matching_queries) != 1:
            raise RuntimeError(
                f"expected one query object for {query_id!r}, "
                f"found {len(matching_queries)}"
            )
        query_object = matching_queries[0]
        candidate_objects = sorted(
            ctx.view.objects(type="candidate"),
            key=lambda candidate: candidate.data["candidate_id"],
        )
        hop_objects = sorted(
            ctx.view.objects(type="hop_evidence"),
            key=lambda hop: hop.data["hop_id"],
        )
        topology_objects = {
            item.id: item
            for item in [query_object, *candidate_objects, *hop_objects]
        }
        hop_relations = ctx.view.relations(type="graph_hop")
        weights = policy["weights_bp"]
        candidates_by_id = {
            candidate.data["candidate_id"]: candidate
            for candidate in candidate_objects
        }
        graph_evidence = [
            _traverse_graph_evidence(
                query_object=query_object,
                candidate_object=candidate,
                hop_relations=hop_relations,
                topology_objects=topology_objects,
            )
            for candidate in candidate_objects
        ]
        evidence_by_candidate = {
            item["candidate_id"]: item for item in graph_evidence
        }
        ranking = []
        for candidate in candidate_objects:
            candidate_id = candidate.data["candidate_id"]
            score_values = {
                "semantic_score_bp": candidate.data["semantic_score_bp"],
                "graph_score_bp": evidence_by_candidate[candidate_id][
                    "graph_score_bp"
                ],
                "source_quality_bp": candidate.data["source_quality_bp"],
            }
            ranking.append(
                {
                    "candidate_id": candidate_id,
                    "score_bp": (
                        sum(
                            score_values[field] * weights[field]
                            for field in _SCORE_FIELDS
                        )
                        // 10_000
                    ),
                }
            )
        ranking.sort(
            key=lambda entry: (-entry["score_bp"], entry["candidate_id"])
        )
        winner_candidate_id = ranking[0]["candidate_id"]
        decision = graph.add_object(
            "decision",
            {
                "policy_id": policy["policy_id"],
                "winner_candidate_id": winner_candidate_id,
                "ranked": deepcopy(ranking),
                "weights_bp": deepcopy(weights),
                "graph_evidence": deepcopy(graph_evidence),
            },
        )
        graph.add_relation(
            decision.id,
            candidates_by_id[winner_candidate_id].id,
            "selects",
            {"candidate_id": winner_candidate_id},
        )
        graph.emit(
            "graph_hop.completed",
            {
                "policy_id": policy["policy_id"],
                "decision_id": decision.id,
                "winner_candidate_id": winner_candidate_id,
                "graph_score_bp": evidence_by_candidate[winner_candidate_id][
                    "graph_score_bp"
                ],
                "relation_ids": deepcopy(
                    evidence_by_candidate[winner_candidate_id]["relation_ids"]
                ),
            },
        )

    return Behavior(
        name="graph_hop_selector",
        fn=select_candidate,
        on=["object.created"],
        where={"object.type": "evaluation_request"},
        view_spec={
            "include_types": [
                "query",
                "candidate",
                "hop_evidence",
                "evaluation_request",
            ],
            "recent_events": 50,
        },
        creates=["decision"],
    )


def _materialize_topology(graph: Graph, document: dict[str, Any]) -> Any:
    """Project explicit hop edges into graph objects and relations."""

    query = graph.add_object("query", deepcopy(document["query"]))
    candidates = sorted(
        document["candidates"],
        key=lambda candidate: candidate["candidate_id"],
    )
    candidate_objects: dict[str, Any] = {}
    for candidate in candidates:
        candidate_objects[candidate["candidate_id"]] = graph.add_object(
            "candidate",
            {
                "candidate_id": candidate["candidate_id"],
                "label": candidate["label"],
                "semantic_score_bp": candidate["semantic_score_bp"],
                "source_quality_bp": candidate["source_quality_bp"],
            },
        )

    endpoint_objects = {
        f"query:{document['query']['query_id']}": query,
        **{
            f"candidate:{candidate_id}": candidate_object
            for candidate_id, candidate_object in candidate_objects.items()
        },
    }
    intermediate_ids = sorted(
        {
            endpoint_id
            for candidate in candidates
            for edge in candidate["hop_path"]
            for endpoint_id in (edge["source_id"], edge["target_id"])
            if endpoint_id not in endpoint_objects
        }
    )
    for hop_id in intermediate_ids:
        endpoint_objects[hop_id] = graph.add_object(
            "hop_evidence",
            {"hop_id": hop_id},
        )

    for candidate in candidates:
        for ordinal, edge in enumerate(candidate["hop_path"]):
            graph.add_relation(
                endpoint_objects[edge["source_id"]].id,
                endpoint_objects[edge["target_id"]].id,
                "graph_hop",
                {
                    "candidate_id": candidate["candidate_id"],
                    "ordinal": ordinal,
                    "evidence_id": edge["evidence_id"],
                    "graph_score_bp": edge["graph_score_bp"],
                },
            )

    return graph.add_object(
        "evaluation_request",
        {"query_id": document["query"]["query_id"]},
    )


def _traverse_graph_evidence(
    *,
    query_object: Any,
    candidate_object: Any,
    hop_relations: list[Any],
    topology_objects: dict[str, Any],
) -> dict[str, Any]:
    """Walk one candidate's ordered path and derive its graph score."""

    candidate_id = candidate_object.data["candidate_id"]
    relations = sorted(
        [
            relation
            for relation in hop_relations
            if relation.data.get("candidate_id") == candidate_id
        ],
        key=lambda relation: relation.data.get("ordinal", -1),
    )
    if not relations:
        raise RuntimeError(f"candidate {candidate_id!r} has no graph_hop path")

    current_object_id = query_object.id
    node_ids = [current_object_id]
    relation_ids: list[str] = []
    evidence_ids: list[str] = []
    graph_scores: list[int] = []
    for expected_ordinal, relation in enumerate(relations):
        if relation.data.get("ordinal") != expected_ordinal:
            raise RuntimeError(
                f"candidate {candidate_id!r} has a non-contiguous hop ordinal"
            )
        if relation.source != current_object_id:
            raise RuntimeError(
                f"candidate {candidate_id!r} has a disconnected graph_hop path"
            )
        if relation.target not in topology_objects:
            raise RuntimeError(
                f"candidate {candidate_id!r} targets an unknown hop object"
            )
        current_object_id = relation.target
        node_ids.append(current_object_id)
        relation_ids.append(relation.id)
        evidence_ids.append(relation.data["evidence_id"])
        graph_scores.append(relation.data["graph_score_bp"])

    if current_object_id != candidate_object.id:
        raise RuntimeError(
            f"candidate {candidate_id!r} graph_hop path does not terminate "
            "at its candidate object"
        )
    unique_scores = set(graph_scores)
    if len(unique_scores) != 1:
        raise RuntimeError(
            f"candidate {candidate_id!r} graph_hop edges disagree on score"
        )

    return {
        "candidate_id": candidate_id,
        "graph_score_bp": graph_scores[0],
        "node_ids": node_ids,
        "relation_ids": relation_ids,
        "evidence_ids": evidence_ids,
    }


def _summarize_run(
    runtime: Runtime,
    policy: dict[str, Any],
) -> dict[str, Any]:
    decisions = [
        obj for obj in runtime.graph.all_objects() if obj.type == "decision"
    ]
    if len(decisions) != 1:
        raise RuntimeError(
            f"expected exactly one decision object, found {len(decisions)}"
        )
    decision_data = decisions[0].data
    event_envelopes = [deepcopy(event.to_dict()) for event in runtime.graph.events]
    return {
        "run_id": runtime.run_id,
        "policy_id": policy["policy_id"],
        "winner_candidate_id": decision_data["winner_candidate_id"],
        "ranking": deepcopy(decision_data["ranked"]),
        "weights_bp": deepcopy(decision_data["weights_bp"]),
        "event_count": len(event_envelopes),
        "event_log_sha256": canonical_sha256(event_envelopes),
    }


def _normalize_diff(diff: Any) -> dict[str, Any]:
    def event_summary(event: Any) -> dict[str, str]:
        return {"id": event.id, "type": event.type}

    divergent_objects = [
        {
            "id": item.id,
            "in_parent": deepcopy(item.in_parent),
            "in_fork": deepcopy(item.in_fork),
        }
        for item in sorted(diff.divergent_objects, key=lambda item: item.id)
    ]
    divergent_relations = [
        {
            "id": item.id,
            "in_parent": deepcopy(item.in_parent),
            "in_fork": deepcopy(item.in_fork),
        }
        for item in sorted(diff.divergent_relations, key=lambda item: item.id)
    ]
    decision_entries = [
        item
        for item in divergent_objects
        if (item["in_parent"] or item["in_fork"] or {}).get("type") == "decision"
    ]
    if len(decision_entries) != 1:
        raise RuntimeError(
            "expected exactly one divergent decision for decision_delta"
        )
    decision_entry = decision_entries[0]

    return {
        "is_identical": bool(diff.is_identical),
        "shared_events": [event_summary(event) for event in diff.shared_events],
        "parent_only_events": [
            event_summary(event) for event in diff.parent_only_events
        ],
        "fork_only_events": [
            event_summary(event) for event in diff.fork_only_events
        ],
        "divergent_objects": divergent_objects,
        "divergent_relations": divergent_relations,
        "decision_delta": {
            "baseline": _decision_result_from_snapshot(
                decision_entry["in_parent"]
            ),
            "variant": _decision_result_from_snapshot(
                decision_entry["in_fork"]
            ),
        },
    }


def _decision_result_from_snapshot(
    decision_snapshot: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if decision_snapshot is None:
        return None
    data = decision_snapshot["data"]
    return {
        "policy_id": data["policy_id"],
        "winner_candidate_id": data["winner_candidate_id"],
        "ranking": deepcopy(data["ranked"]),
        "weights_bp": deepcopy(data["weights_bp"]),
        "graph_evidence": deepcopy(data["graph_evidence"]),
    }


def _build_assertions(
    *,
    document: dict[str, Any],
    baseline_runtime: Runtime,
    fork_runtime: Runtime,
    baseline_run: dict[str, Any],
    variant_run: dict[str, Any],
    normalized_diff: dict[str, Any],
) -> list[dict[str, Any]]:
    candidate_count = len(document["candidates"])
    intermediate_ids = _intermediate_hop_ids(document)
    intermediate_count = len(intermediate_ids)
    hop_relation_count = sum(
        len(candidate["hop_path"]) for candidate in document["candidates"]
    )
    seed_object_count = candidate_count + intermediate_count + 2
    seed_event_count = seed_object_count + hop_relation_count
    expected_event_count = seed_event_count + 7
    decision_object_id = f"decision#{seed_object_count + 1}"
    selection_relation_id = f"rel_{hop_relation_count + 1:03d}"

    expected_winners = {
        "baseline": document["expected"]["baseline_winner_id"],
        "variant": document["expected"]["variant_winner_id"],
    }
    actual_winners = {
        "baseline": baseline_run["winner_candidate_id"],
        "variant": variant_run["winner_candidate_id"],
    }

    expected_counts = {
        "baseline": expected_event_count,
        "variant": expected_event_count,
    }
    actual_counts = {
        "baseline": baseline_run["event_count"],
        "variant": variant_run["event_count"],
    }

    expected_tail = [
        {"id": _event_id(seed_event_count + 2), "type": "object.created"},
        {"id": _event_id(seed_event_count + 3), "type": "relation.created"},
        {
            "id": _event_id(seed_event_count + 4),
            "type": "graph_hop.completed",
        },
        {"id": _event_id(seed_event_count + 6), "type": "context.read"},
    ]
    seed_topology_object_events = candidate_count + intermediate_count + 1
    expected_shared_events = [
        {"id": _event_id(index), "type": "object.created"}
        for index in range(1, seed_topology_object_events + 1)
    ]
    expected_shared_events.extend(
        {
            "id": _event_id(index),
            "type": "relation.created",
        }
        for index in range(
            seed_topology_object_events + 1,
            seed_topology_object_events + hop_relation_count + 1,
        )
    )
    expected_shared_events.append(
        {"id": _event_id(seed_event_count), "type": "object.created"}
    )
    expected_diff_summary = {
        "is_identical": False,
        "shared_events": expected_shared_events,
        "parent_only_events": expected_tail,
        "fork_only_events": expected_tail,
        "divergent_object_ids": [decision_object_id],
        "divergent_relation_ids": [selection_relation_id],
    }
    actual_diff_summary = {
        "is_identical": normalized_diff["is_identical"],
        "shared_events": normalized_diff["shared_events"],
        "parent_only_events": normalized_diff["parent_only_events"],
        "fork_only_events": normalized_diff["fork_only_events"],
        "divergent_object_ids": [
            item["id"] for item in normalized_diff["divergent_objects"]
        ],
        "divergent_relation_ids": [
            item["id"] for item in normalized_diff["divergent_relations"]
        ],
    }

    topology_read_ids = [
        "query#1",
        *[
            f"candidate#{index}"
            for index in range(2, candidate_count + 2)
        ],
        *[
            f"hop_evidence#{index}"
            for index in range(
                candidate_count + 2,
                candidate_count + intermediate_count + 2,
            )
        ],
    ]
    expected_read_sets = {
        "baseline": topology_read_ids,
        "variant": topology_read_ids,
    }
    actual_read_sets = {
        "baseline": _context_read_object_ids(baseline_runtime),
        "variant": _context_read_object_ids(fork_runtime),
    }

    runtime_errors = {
        "baseline": _runtime_errors(baseline_runtime),
        "variant": _runtime_errors(fork_runtime),
    }
    expected_graph_evidence = _expected_graph_evidence(document)
    actual_graph_evidence = {
        lane: normalized_diff["decision_delta"][lane]["graph_evidence"]
        for lane in ("baseline", "variant")
    }

    return [
        _assertion(
            "expected-winners",
            expected_winners,
            actual_winners,
        ),
        _assertion("event-counts", expected_counts, actual_counts),
        _assertion(
            "fork-diff",
            expected_diff_summary,
            actual_diff_summary,
        ),
        _assertion(
            "graph-topology-traversal",
            {
                "baseline": expected_graph_evidence,
                "variant": expected_graph_evidence,
            },
            actual_graph_evidence,
        ),
        _assertion(
            "context-read-set",
            expected_read_sets,
            actual_read_sets,
        ),
        _assertion(
            "no-runtime-errors",
            {"baseline": [], "variant": []},
            runtime_errors,
        ),
    ]


def _intermediate_hop_ids(document: dict[str, Any]) -> list[str]:
    endpoint_ids = {
        f"query:{document['query']['query_id']}",
        *{
            f"candidate:{candidate['candidate_id']}"
            for candidate in document["candidates"]
        },
    }
    return sorted(
        {
            endpoint_id
            for candidate in document["candidates"]
            for edge in candidate["hop_path"]
            for endpoint_id in (edge["source_id"], edge["target_id"])
            if endpoint_id not in endpoint_ids
        }
    )


def _expected_graph_evidence(
    document: dict[str, Any],
) -> list[dict[str, Any]]:
    candidates = sorted(
        document["candidates"],
        key=lambda candidate: candidate["candidate_id"],
    )
    candidate_count = len(candidates)
    intermediate_ids = _intermediate_hop_ids(document)
    endpoint_object_ids = {
        f"query:{document['query']['query_id']}": "query#1",
        **{
            f"candidate:{candidate['candidate_id']}": f"candidate#{index}"
            for index, candidate in enumerate(candidates, start=2)
        },
        **{
            hop_id: f"hop_evidence#{index}"
            for index, hop_id in enumerate(
                intermediate_ids,
                start=candidate_count + 2,
            )
        },
    }
    relation_number = 1
    expected: list[dict[str, Any]] = []
    for candidate in candidates:
        path = candidate["hop_path"]
        relation_ids = []
        for _edge in path:
            relation_ids.append(f"rel_{relation_number:03d}")
            relation_number += 1
        expected.append(
            {
                "candidate_id": candidate["candidate_id"],
                "graph_score_bp": path[0]["graph_score_bp"],
                "node_ids": [
                    endpoint_object_ids[path[0]["source_id"]],
                    *[
                        endpoint_object_ids[edge["target_id"]]
                        for edge in path
                    ],
                ],
                "relation_ids": relation_ids,
                "evidence_ids": [
                    edge["evidence_id"] for edge in path
                ],
            }
        )
    return expected


def _assertion(name: str, expected: Any, actual: Any) -> dict[str, Any]:
    return {
        "name": name,
        "passed": actual == expected,
        "expected": expected,
        "actual": actual,
    }


def _context_read_object_ids(runtime: Runtime) -> list[str]:
    events = [
        event for event in runtime.graph.events if event.type == "context.read"
    ]
    if len(events) != 1:
        return []
    return list(events[0].payload.get("object_ids", []))


def _runtime_errors(runtime: Runtime) -> list[dict[str, str]]:
    return [
        {
            "behavior": failure.behavior,
            "event_id": failure.event_id,
            "exception_type": failure.exception_type,
            "message": failure.message,
        }
        for failure in runtime.errors
    ]


def _event_log_fingerprint(runtime: Runtime) -> dict[str, Any]:
    envelopes = [deepcopy(event.to_dict()) for event in runtime.graph.events]
    projection = _projection_snapshot(runtime)
    decisions = projection["decisions"]
    if len(decisions) != 1:
        raise RuntimeError(
            f"expected one projected decision, found {len(decisions)}"
        )
    return {
        "event_count": len(envelopes),
        "event_log_sha256": canonical_sha256(envelopes),
        "projection": projection,
        "result": _decision_result_from_snapshot(decisions[0]),
    }


def _projection_snapshot(runtime: Runtime) -> dict[str, Any]:
    decisions = sorted(
        (
            _normalize_object_snapshot(obj)
            for obj in runtime.graph.all_objects()
            if obj.type == "decision"
        ),
        key=lambda item: item["id"],
    )
    selects_relations = sorted(
        (
            _normalize_relation_snapshot(relation)
            for relation in runtime.graph.all_relations()
            if relation.type == "selects"
        ),
        key=lambda item: item["id"],
    )
    return {
        "decisions": decisions,
        "selects_relations": selects_relations,
    }


def _normalize_object_snapshot(obj: Any) -> dict[str, Any]:
    snapshot = deepcopy(obj.to_dict())
    snapshot.pop("provenance", None)
    return snapshot


def _normalize_relation_snapshot(relation: Any) -> dict[str, Any]:
    snapshot = deepcopy(relation.to_dict())
    snapshot.pop("provenance", None)
    return snapshot


def _close_runtime_store(runtime: Runtime) -> None:
    store = runtime.graph.store
    if store is not None:
        store.close()


def _event_id(number: int) -> str:
    return f"evt_{number:03d}"


def _validate_input(document: dict[str, Any]) -> None:
    _expect_keys(
        document,
        "$",
        {
            "schema_version",
            "case_id",
            "determinism",
            "query",
            "candidates",
            "policies",
            "expected",
        },
    )
    if document["schema_version"] != INPUT_SCHEMA_VERSION:
        raise ValueError(
            f"$.schema_version must equal {INPUT_SCHEMA_VERSION!r}"
        )
    _expect_string(document["case_id"], "$.case_id", pattern=_CASE_ID_RE)

    determinism = _expect_mapping(document["determinism"], "$.determinism")
    _expect_keys(
        determinism,
        "$.determinism",
        {"timestamp_iso", "parent_run_id", "fork_run_id"},
    )
    _expect_timestamp(determinism["timestamp_iso"], "$.determinism.timestamp_iso")
    parent_run_id = _expect_string(
        determinism["parent_run_id"],
        "$.determinism.parent_run_id",
        pattern=_RUN_ID_RE,
    )
    fork_run_id = _expect_string(
        determinism["fork_run_id"],
        "$.determinism.fork_run_id",
        pattern=_RUN_ID_RE,
    )
    if parent_run_id == fork_run_id:
        raise ValueError("parent_run_id and fork_run_id must be different")

    query = _expect_mapping(document["query"], "$.query")
    _expect_keys(query, "$.query", {"query_id", "text"})
    _expect_domain_id(query["query_id"], "$.query.query_id")
    _expect_string(query["text"], "$.query.text")

    candidates = document["candidates"]
    if type(candidates) is not list or len(candidates) < 2:
        raise ValueError("$.candidates must be an array with at least 2 items")
    candidate_ids: list[str] = []
    evidence_ids: list[str] = []
    for index, candidate_value in enumerate(candidates):
        path = f"$.candidates[{index}]"
        candidate = _expect_mapping(candidate_value, path)
        _expect_keys(
            candidate,
            path,
            {
                "candidate_id",
                "label",
                "semantic_score_bp",
                "source_quality_bp",
                "hop_path",
            },
        )
        candidate_ids.append(
            _expect_domain_id(candidate["candidate_id"], f"{path}.candidate_id")
        )
        _expect_string(candidate["label"], f"{path}.label")
        for field in ("semantic_score_bp", "source_quality_bp"):
            _expect_basis_points(candidate[field], f"{path}.{field}")
        hop_path = candidate["hop_path"]
        if type(hop_path) is not list or not hop_path:
            raise ValueError(f"{path}.hop_path must contain at least 1 edge")
        expected_source_id = f"query:{query['query_id']}"
        path_node_ids = [expected_source_id]
        edge_scores: list[int] = []
        for edge_index, edge_value in enumerate(hop_path):
            edge_path = f"{path}.hop_path[{edge_index}]"
            edge = _expect_mapping(edge_value, edge_path)
            _expect_keys(
                edge,
                edge_path,
                {
                    "source_id",
                    "target_id",
                    "evidence_id",
                    "graph_score_bp",
                },
            )
            source_id = _expect_domain_id(
                edge["source_id"],
                f"{edge_path}.source_id",
            )
            target_id = _expect_domain_id(
                edge["target_id"],
                f"{edge_path}.target_id",
            )
            evidence_ids.append(
                _expect_domain_id(
                    edge["evidence_id"],
                    f"{edge_path}.evidence_id",
                )
            )
            edge_scores.append(
                _expect_basis_points(
                    edge["graph_score_bp"],
                    f"{edge_path}.graph_score_bp",
                )
            )
            if source_id != expected_source_id:
                raise ValueError(
                    f"{edge_path}.source_id must continue the contiguous "
                    f"hop path from {expected_source_id!r}"
                )
            if source_id == target_id:
                raise ValueError(
                    f"{edge_path} source_id and target_id must be different"
                )
            expected_source_id = target_id
            path_node_ids.append(target_id)
        expected_target_id = f"candidate:{candidate['candidate_id']}"
        if expected_source_id != expected_target_id:
            raise ValueError(
                f"{path}.hop_path must terminate at {expected_target_id!r}"
            )
        if len(set(edge_scores)) != 1:
            raise ValueError(
                f"{path}.hop_path graph_score_bp values must agree"
            )
        if len(set(path_node_ids)) != len(path_node_ids):
            raise ValueError(
                f"{path}.hop_path must not contain cycles or repeated nodes"
            )
    if len(set(candidate_ids)) != len(candidate_ids):
        raise ValueError("candidate_id values must be unique")
    if len(set(evidence_ids)) != len(evidence_ids):
        raise ValueError("evidence_id values must be globally unique")
    reserved_endpoint_ids = {
        f"query:{query['query_id']}",
        *{f"candidate:{candidate_id}" for candidate_id in candidate_ids},
    }
    for index, candidate in enumerate(candidates):
        internal_node_ids = [
            edge["target_id"] for edge in candidate["hop_path"][:-1]
        ]
        reserved_internal_ids = sorted(
            set(internal_node_ids) & reserved_endpoint_ids
        )
        if reserved_internal_ids:
            raise ValueError(
                f"$.candidates[{index}].hop_path internal evidence nodes "
                "must not reuse query or candidate endpoints: "
                f"{', '.join(reserved_internal_ids)}"
            )

    policies = _expect_mapping(document["policies"], "$.policies")
    _expect_keys(policies, "$.policies", {"baseline", "variant"})
    for lane in ("baseline", "variant"):
        policy_path = f"$.policies.{lane}"
        policy = _expect_mapping(policies[lane], policy_path)
        _expect_keys(policy, policy_path, {"policy_id", "weights_bp"})
        _expect_domain_id(policy["policy_id"], f"{policy_path}.policy_id")
        weights_path = f"{policy_path}.weights_bp"
        weights = _expect_mapping(policy["weights_bp"], weights_path)
        _expect_keys(weights, weights_path, set(_SCORE_FIELDS))
        for field in _SCORE_FIELDS:
            _expect_basis_points(weights[field], f"{weights_path}.{field}")
        if sum(weights[field] for field in _SCORE_FIELDS) != 10_000:
            raise ValueError(f"{weights_path} values must total exactly 10000")
    baseline_policy = policies["baseline"]
    variant_policy = policies["variant"]
    if baseline_policy["policy_id"] == variant_policy["policy_id"]:
        raise ValueError("baseline and variant policy_id values must differ")
    if baseline_policy["weights_bp"] == variant_policy["weights_bp"]:
        raise ValueError(
            "baseline and variant policy weights_bp must differ"
        )

    expected = _expect_mapping(document["expected"], "$.expected")
    _expect_keys(
        expected,
        "$.expected",
        {"baseline_winner_id", "variant_winner_id"},
    )
    for field in ("baseline_winner_id", "variant_winner_id"):
        winner_id = _expect_domain_id(expected[field], f"$.expected.{field}")
        if winner_id not in candidate_ids:
            raise ValueError(
                f"$.expected.{field} must reference an existing candidate_id"
            )


def _expect_mapping(value: Any, path: str) -> dict[str, Any]:
    if type(value) is not dict:
        raise ValueError(f"{path} must be an object")
    return value


def _expect_keys(
    value: dict[str, Any],
    path: str,
    required: set[str],
) -> None:
    actual = set(value)
    missing = sorted(required - actual)
    extra = sorted(actual - required)
    if missing:
        raise ValueError(f"{path} is missing required keys: {', '.join(missing)}")
    if extra:
        raise ValueError(f"{path} has unsupported keys: {', '.join(extra)}")


def _expect_string(
    value: Any,
    path: str,
    *,
    pattern: re.Pattern[str] | None = None,
) -> str:
    if type(value) is not str or not value:
        raise ValueError(f"{path} must be a non-empty string")
    if pattern is not None and pattern.fullmatch(value) is None:
        raise ValueError(f"{path} has an invalid format")
    return value


def _expect_domain_id(value: Any, path: str) -> str:
    return _expect_string(value, path, pattern=_DOMAIN_ID_RE)


def _expect_basis_points(value: Any, path: str) -> int:
    if type(value) is not int or not 0 <= value <= 10_000:
        raise ValueError(f"{path} must be an integer from 0 through 10000")
    return value


def _expect_timestamp(value: Any, path: str) -> str:
    timestamp = _expect_string(value, path)
    if _RFC3339_RE.fullmatch(timestamp) is None:
        raise ValueError(f"{path} must be an RFC 3339 date-time")
    normalized = timestamp
    if timestamp.endswith(("Z", "z")):
        normalized = f"{timestamp[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ValueError(f"{path} must be an RFC 3339 date-time") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{path} must include a UTC offset")
    return timestamp


def _normalize_rfc3339_for_clock(timestamp: str) -> str:
    normalized = f"{timestamp[:10]}T{timestamp[11:]}"
    if normalized.endswith("z"):
        normalized = f"{normalized[:-1]}Z"
    return normalized

# NodeKit stage-local runtime integration

- **Status:** Candidate; reviewed deployment required
- **Contract date:** 2026-07-30
- **Upstream NodeKit change:** [node-platform PR #30](https://github.com/HomenShum/node-platform/pull/30)
- **Runtime owner:** NodeBench execution trace and MCP gateway

## Decision

NodeBench records and exports the exact execution evidence produced by NodeKit's
current-stage graph contracts. It does not compile a second graph, infer a
frontier from process status, approve findings, or advance Caseflow.

The authority chain is:

```text
Canonical Caseflow
    -> NodeKit current-stage compiled projection
    -> verified runnable frontier
    -> exact edge bindings
    -> bounded NodeBench run-event evidence
    -> owner-scoped terminal export
    -> optional offline ActiveGraph replay
```

Only canonical Caseflow records, protected approvals, and NodeProof receipts may
authorize a stage transition. Every later surface is derived, rebuildable, or
evidentiary.

## Compatibility matrix

| NodeKit contract                                                                                         | NodeBench representation                                                                           | Enforced boundary                                                              |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `nodekit.execution-graph/v1`                                                                             | `graphId`, `graphHash`, `caseId`, `stageId`, `caseContentHash` on graph events                     | One run cannot mix graph, case, or stage scope                                 |
| `nodekit.execution-edge-binding/v1`                                                                      | `edge.consumed` with exact binding, artifact, schema, content hash, and authority                  | No readiness from exit code; all required binding fields verify                |
| `nodekit.runnable-frontier/v1`                                                                           | `frontierHash` on `node.started`                                                                   | NodeBench records the NodeKit-derived frontier and never derives its own       |
| `nodekit.review-context/v1`                                                                              | Review context reference, separation class, and protected-evaluator flag on terminal node evidence | Recording a review never grants approval or stage-advance authority            |
| `nodekit.native-workspace/v1`, `nodekit.native-agent-session/v1`, `nodekit.native-session-checkpoint/v1` | Optional refs-and-digests-only projection on sessions, traces, and `run.started`                   | Caseflow remains canonical; the projection cannot authorize resume             |
| `nodekit.run-event/v1`                                                                                   | Bounded append-only hash chain                                                                     | At most 256 events, safe-field projection, lifecycle and terminal closure      |
| `nodekit.run-export/v1`                                                                                  | Owner-scoped terminal transfer document                                                            | Identity and graph evidence derive from immutable events, not mutable profiles |

## Native session references

NodeBench does not own native-session lifecycle state. `start_execution_run`
may receive only the canonical workspace/session IDs plus exact workspace,
session, and latest-checkpoint artifact refs and digests. It hashes and records
that bounded projection on the session, trace, and `run.started`.

The projection contains no owner input, provider session ID, agent ID,
generation, host, credential, cursor, lifecycle status, or resumable flag. A
recorded reference cannot authorize `session_resume`; that decision stays in
NodeKit's Caseflow-canonical five-operation API with trusted adapter receipts
and a newly persisted checkpoint.

The internal bounded migration page removes the superseded combined snapshots
from sessions and traces and removes native lifecycle fields from legacy agent
profiles. It is dry-run capable and idempotent. Schema removal happens only
after every page verifies zero remaining legacy rows.

## Graph event lifecycle

The supported graph vocabulary is deliberately fixed:

```text
node.started
edge.consumed
artifact.produced
node.completed
node.failed
barrier.opened
barrier.blocked
```

Every non-start event must address a currently open `nodeRunId` and its exact
`nodeId`. A run cannot terminate with an open node. Stale-run retention first
appends `node.failed` for every open graph node, closes explicit spans, and then
appends `run.failed`; it never fabricates completion.

NodeBench reserves enough of the 256-event budget to close all open spans and
graph nodes plus the run terminal. Event payloads remain sensitivity-redacted,
event-specific, and bounded to the existing 2 KiB stored / 32 KiB redacted
source limits.

## MCP boundary

`start_execution_run` may provide `nativeSessionReference`. The internal
`mcpStartExecutionRun` mutation validates and content-hashes the exact
refs-and-digests-only projection before inserting any session, trace, or event.

`record_execution_graph_event` calls the secret-gated
`recordExecutionGraphEvent` dispatcher entry. The gateway injects the service
owner. The mutation verifies trace ownership and running status before the
canonical run-event projector validates all event-specific fields and appends
the hash-chained event.

This endpoint performs no external fetch. It returns a content hash only after
the event transaction succeeds.

## ActiveGraph boundary

ActiveGraph receives only a validated terminal `nodekit.run-export/v1`. The
representative fixture now contains canonical session artifact references plus
a real stage-local sequence: start, frontier-bound node start, exact edge
consumption, artifact production, node completion, and run completion.

ActiveGraph remains an offline disposable replay observer. It is not a graph
compiler, scheduler, workflow database, or approval authority.

## Reliability checklist

| Gate           | Result                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| BOUND          | 256-event run cap, reserved lifecycle closure, bounded reference fields and payload sizes                         |
| HONEST_STATUS  | Mutations throw on ownership, lifecycle, reference, or persistence failure                                        |
| HONEST_SCORES  | No score or confidence is generated                                                                               |
| TIMEOUT        | New mutations perform no network I/O; the existing offline canary retains its process timeout                     |
| SSRF           | No caller URL is accepted or fetched                                                                              |
| BOUND_READ     | 100-row migration pages and bounded run-prefix reads; gateway body cap remains unchanged                          |
| ERROR_BOUNDARY | Validation happens before persistence; a failed append aborts the owning mutation                                 |
| DETERMINISTIC  | Canonical sorted-key SHA-256 hashes bind references, events, chains, exports, graph references, and edge bindings |

## Required verification

```powershell
npx tsc --noEmit --pretty false
npx vitest run `
  backend/convex/domains/operations/taskManager/nodeKitRuntimeIdentity.test.ts `
  backend/convex/domains/operations/taskManager/nodeKitGraphRunEvents.test.ts `
  backend/convex/domains/operations/taskManager/nodeKitRunExport.test.ts `
  backend/convex/domains/operations/taskManager/nodeKitRunRetention.test.ts `
  backend/convex/domains/mcp/mcpExecutionTraceEndpoints.integration.test.ts `
  packages/mcp-local/src/__tests__/executionTraceTools.test.ts `
  scripts/__tests__/nodekitActiveGraphCanary.test.ts
npm run build
```

Production completion additionally requires a reviewed PR merge, a fresh
deployment tied to that merge, raw-response content evidence, and an operational
browser journey. A local pass or Git push is not deployment proof.

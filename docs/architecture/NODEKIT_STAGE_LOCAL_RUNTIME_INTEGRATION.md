# NodeKit stage-local runtime integration

- **Status:** Candidate; reviewed deployment required
- **Contract date:** 2026-07-29
- **Upstream NodeKit change:** [node-platform PR #29](https://github.com/HomenShum/node-platform/pull/29)
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

| NodeKit contract                           | NodeBench representation                                                                           | Enforced boundary                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `nodekit.execution-graph/v1`               | `graphId`, `graphHash`, `caseId`, `stageId`, `caseContentHash` on graph events                     | One run cannot mix graph, case, or stage scope                                 |
| `nodekit.execution-edge-binding/v1`        | `edge.consumed` with exact binding, artifact, schema, content hash, and authority                  | No readiness from exit code; all required binding fields verify                |
| `nodekit.runnable-frontier/v1`             | `frontierHash` on `node.started`                                                                   | NodeBench records the NodeKit-derived frontier and never derives its own       |
| `nodekit.review-context/v1`                | Review context reference, separation class, and protected-evaluator flag on terminal node evidence | Recording a review never grants approval or stage-advance authority            |
| `nodekit.native-agent-session-identity/v1` | Optional immutable identity snapshot on sessions, traces, and `run.started`                        | Owner/workspace scope, monotonic generation, reconnect and peer continuity     |
| `nodekit.run-event/v1`                     | Bounded append-only hash chain                                                                     | At most 256 events, safe-field projection, lifecycle and terminal closure      |
| `nodekit.run-export/v1`                    | Owner-scoped terminal transfer document                                                            | Identity and graph evidence derive from immutable events, not mutable profiles |

## Native session identity

The persistent identity contract separates four concerns:

- `identityRef`: durable NodeBench identity row;
- `agentId` and `workspaceId`: owner-scoped execution boundary;
- `nativeSessionId` and monotonic generation: native runtime continuity;
- optional `peerId`: reconnect binding for the active generation.

Reconnect requires the same generation and session ID. Rotation requires a
higher generation. A lower generation, same-generation session collision, or
peer replacement fails before any session, trace, or event is inserted.

The current identity snapshot is stored on the mutable identity row for future
continuity checks. Every run also stores an immutable snapshot and commits its
hash into `run.started`; export reads only the event-bound snapshot.

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

`start_execution_run` may provide `nativeIdentity`. The internal
`mcpStartExecutionRun` mutation resolves it against an owner/workspace-scoped
identity and returns `created`, `reconnect`, or `rotate`.

`record_execution_graph_event` calls the secret-gated
`recordExecutionGraphEvent` dispatcher entry. The gateway injects the service
owner. The mutation verifies trace ownership and running status before the
canonical run-event projector validates all event-specific fields and appends
the hash-chained event.

This endpoint performs no external fetch. It returns a content hash only after
the event transaction succeeds.

## ActiveGraph boundary

ActiveGraph receives only a validated terminal `nodekit.run-export/v1`. The
representative fixture now contains native identity plus a real stage-local
sequence: start, frontier-bound node start, exact edge consumption, artifact
production, node completion, and run completion.

ActiveGraph remains an offline disposable replay observer. It is not a graph
compiler, scheduler, workflow database, or approval authority.

## Reliability checklist

| Gate           | Result                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| BOUND          | 256-event run cap, reserved lifecycle closure, bounded identity fields and payload sizes                          |
| HONEST_STATUS  | Mutations throw on ownership, lifecycle, identity, or persistence failure                                         |
| HONEST_SCORES  | No score or confidence is generated                                                                               |
| TIMEOUT        | New mutations perform no network I/O; the existing offline canary retains its process timeout                     |
| SSRF           | No caller URL is accepted or fetched                                                                              |
| BOUND_READ     | Indexed identity lookup and bounded run-prefix reads; gateway body cap remains unchanged                          |
| ERROR_BOUNDARY | Validation happens before persistence; a failed append aborts the owning mutation                                 |
| DETERMINISTIC  | Canonical sorted-key SHA-256 hashes bind identities, events, chains, exports, graph references, and edge bindings |

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

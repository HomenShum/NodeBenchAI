# NodeKit Stage-Local Runtime

Append-only lane for NodeKit graph, exact edge-binding, native-session identity,
run-event, export, MCP, and offline ActiveGraph compatibility. Newest entries
first.

## 2026-07-30 — Remove NodeBench native-session lifecycle authority

The candidate replaces the combined native identity snapshot and generation
protocol with a `nodekit.native-session-reference/v1` projection containing
only Caseflow-canonical workspace/session/checkpoint refs and digests.
NodeBench no longer creates or updates an agent-identity row when a trace
starts, and the run/export/canary boundaries reject raw provider IDs,
generation, host, credential, status, cursor, and resumable fields.

A bounded, dry-run-capable internal migration removes the obsolete snapshots
and native lifecycle fields before their schema fields are retired. ActiveGraph
remains a disposable offline observer and receives only the verified terminal
export.

## 2026-07-29 — Bind NodeBench traces to NodeKit's current-stage graph

The shipped integration adds an owner/workspace-scoped native-agent session
identity, records NodeKit's exact stage-local graph, frontier, edge-binding,
artifact, barrier, and separated-review evidence, and exports the immutable
identity snapshot with the terminal run chain. The MCP gateway exposes a
secret-gated graph-event mutation with injected service ownership. The
ActiveGraph canary remains offline and non-authoritative but now exercises a
representative graph-and-identity corpus.

Caseflow remains canonical. NodeBench does not compile a second graph, infer
readiness from exit codes, approve review findings, or advance stages.

**PR / canonical main commit**: #603 / `1e034f5fd3bf109f6283669c2c24774c78962b86`.

**Evidence state**:

- Source: merged to `main` through PR #603 from `feat/nodekit-stage-local-integration`.
- Checks: root typecheck passed; 74 focused contract, database, export, retention, MCP, and ActiveGraph scenarios passed; the 370-scenario runtime smoke pack, root production build, MCP-local package build, and required main-branch CI passed.
- Visual proof: not applicable; this slice changes backend and tool contracts.
- Preview: PR preview and post-deploy verification passed.
- Production live: Vercel deployment `dpl_BhEFBRrSuUg2MszCZLwa9fbkMQqW` reached `READY` from commit `1e034f5`; `https://www.nodebenchai.com/` returned HTTP 200 with the production app shell. Convex Deploy run `30509168208` passed. The secret-gated production gateway verified native identity `created`, `reconnect`, and `rotate`, rejected a stale generation, stored an eight-event graph lifecycle with a valid hash chain, bound the current frontier and review context, exercised blocked/opened barriers plus an exact edge binding, and terminalized every proof trace. Production configuration now includes the required owner-scoped `MCP_SERVICE_USER_ID`.

**Author**: Homen Shum + Codex.
**Touches**: [`../../docs/architecture/NODEKIT_STAGE_LOCAL_RUNTIME_INTEGRATION.md`](../../docs/architecture/NODEKIT_STAGE_LOCAL_RUNTIME_INTEGRATION.md) and [`../../docs/architecture/NODEKIT_ACTIVEGRAPH_CANARY.md`](../../docs/architecture/NODEKIT_ACTIVEGRAPH_CANARY.md).

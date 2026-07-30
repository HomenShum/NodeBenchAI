# NodeKit Stage-Local Runtime

Append-only lane for NodeKit graph, exact edge-binding, native-session identity,
run-event, export, MCP, and offline ActiveGraph compatibility. Newest entries
first.

## 2026-07-29 — Bind NodeBench traces to NodeKit's current-stage graph

The pending candidate adds an owner/workspace-scoped native-agent session
identity, records NodeKit's exact stage-local graph, frontier, edge-binding,
artifact, barrier, and separated-review evidence, and exports the immutable
identity snapshot with the terminal run chain. The MCP gateway exposes a
secret-gated graph-event mutation with injected service ownership. The
ActiveGraph canary remains offline and non-authoritative but now exercises a
representative graph-and-identity corpus.

Caseflow remains canonical. NodeBench does not compile a second graph, infer
readiness from exit codes, approve review findings, or advance stages.

**PR / canonical main commit**: #602 / PENDING MAIN SHA / FINAL QA.

**Evidence state**:

- Source: pending in PR #602 from `codex/nodekit-stage-local-integration`.
- Checks: root typecheck passed; 74 focused contract, database, export, retention, MCP, and ActiveGraph scenarios passed; the root production build and MCP-local package build passed. CI remains pending.
- Visual proof: not applicable; this slice changes backend and tool contracts.
- Preview: not recorded.
- Production live: not recorded.

**Author**: Homen Shum + Codex.
**Touches**: [`../../docs/architecture/NODEKIT_STAGE_LOCAL_RUNTIME_INTEGRATION.md`](../../docs/architecture/NODEKIT_STAGE_LOCAL_RUNTIME_INTEGRATION.md) and [`../../docs/architecture/NODEKIT_ACTIVEGRAPH_CANARY.md`](../../docs/architecture/NODEKIT_ACTIVEGRAPH_CANARY.md).

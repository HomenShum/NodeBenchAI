# NodeBench × NodeKit standard repository tree

Status: **Phase 2 physically migrated; flat v1 contracts aligned.**

PRs #589 and #590 established the authored surface and moved the application
into the standard physical tree. The July 28 alignment selectively carries
forward the still-valid contract changes from draft PR #592 without merging its
stale generated `.nodeagent/` snapshot or its conflicting branch wholesale.

The alignment does not replace the production runtime. NodeBench remains a
brownfield application whose live execution engine is
`repo-local-nodebench`.

## Current standard surface

```text
nodekit.yaml                         repository contract (`nodekit.repo/v1`)
nodeagent.yaml                       application contract (`nodeagent.application/v1`)
agent/                               filesystem-authored brownfield projection
packs/entity-intelligence/
├── pack.yaml                        logical capability ownership
└── SKILL.md                         usage contract and live-source map
apps/web/                            Vite application
backend/convex/                      Convex functions and durable state
workers/node/                        Node workers, routes, and pipeline
evals/                               tests and NodeAgent evaluation bindings
proof/ui-contract/                   UI contracts and captured evidence
adw/                                 improvement workflows and goal governance
```

The root `public/`, `api/`, environment files, and build output intentionally
remain at repository root. NodeBench-specific packages such as
`packages/mcp-local` remain first-class distribution artifacts.

`.nodeagent/` is compiler-owned output. This alignment deliberately does not
copy the generated snapshot from PR #592 because its discovery graph was based
on an older branch and conflicts with current `main`. Generate it from the
current authored tree when a workflow explicitly requires it; never hand-edit
or use a stale snapshot as runtime authority.

## Mapping and authority

Legend: `✓` standard location, `◐` mapped but not runtime-authoritative,
`✗` missing.

| Standard concern                        | State | Current authority                                                                     |
| --------------------------------------- | ----: | ------------------------------------------------------------------------------------- |
| Repository and application manifests    |     ✓ | flat `nodekit.repo/v1` and `nodeagent.application/v1` files at root                   |
| Web application                         |     ✓ | `apps/web/`                                                                           |
| Production backend                      |     ✓ | `backend/convex/`; `convex.json` points to it                                         |
| Node workers                            |     ✓ | `workers/node/`                                                                       |
| Evaluation tree                         |     ✓ | `evals/`, including five top-level NodeAgent bindings                                 |
| Proof tree                              |     ✓ | `proof/ui-contract/` plus other proof artifacts                                       |
| ADW tree                                |     ✓ | `adw/improvement-loop/` and `adw/goals/`                                              |
| Authored agent surface                  |     ◐ | `agent/` mirrors runtime truth in backend and worker code                             |
| Entity-intelligence pack                |     ◐ | logical pack at `packs/entity-intelligence/`; implementations remain distributed      |
| Canonical NodeKit run export            |     ◐ | append-only owner-scoped chain in `backend/convex/domains/operations/taskManager/`    |
| ActiveGraph replay                      |     ◐ | isolated evaluator under `evals/activegraph/`; never application authority            |
| Compiled application definition         |     ◐ | generated on demand from current source; no stale snapshot is committed by this slice |
| Pi AI provider adapter                  |     ✗ | live product path uses direct Gemini REST                                             |
| Canonical NodeAgent runtime consumption |     ✗ | production still runs `repo-local-nodebench`                                          |

## Brownfield conformance level

Current level: **L2 — physically mapped with flat v1 authored contracts.**

- **L1 registered:** the repository contract uses the platform's canonical flat
  schema dialect.
- **L2 mapped:** application, provider, backend, pack, policies, and existing
  evaluation commands resolve through current standard-tree paths.
- **L3 wrapped is partial:** new execution traces emit a canonical,
  append-only `nodekit.run-event/v1` chain and expose
  `nodekit.run-export/v1`, but the production runtime is not otherwise replaced.
- **L4 shadowing starts offline only:** ActiveGraph may read a validated,
  disposable export copy. It cannot write NodeBench state, answer for
  production, or approve an action.
- **L5 hybrid through L7 enforced remain:** promote no runtime path without a
  separate corpus, security, migration, and rollback decision.

The immutable export advances a proof boundary; it is not a claim that
ActiveGraph or the canonical NodeAgent runtime now executes production work.

## NodeKit run-export boundary

For newly created execution traces, every meaningful step, decision,
verification, evidence attachment, approval request, span lifecycle event, and
terminal outcome is appended to `nodeKitRunEvents` in the same Convex
transaction as the owning mutation. Events have:

- a contiguous sequence;
- a previous-event hash;
- a canonical SHA-256 content hash;
- a required `run.started` event; and
- exactly one terminal `run.completed` or `run.failed` event.

The owner-scoped query
`domains/operations/taskManager/nodeKitRunExport:exportNodeKitRun` exports only
terminal runs and verifies order, chain integrity, ownership, completeness, and
the whole-export hash. Legacy traces without the append-only chain fail closed;
the exporter never synthesizes missing history from mutable metadata.

## NodeAgent evaluation bindings

The manifest requires these repository-local bindings:

| ID                              | Role                                                                |
| ------------------------------- | ------------------------------------------------------------------- |
| `nodebench-conformance`         | UI contract conformance                                             |
| `nodebench-smoke`               | local dogfood smoke verification                                    |
| `nodebench-entity-intelligence` | search-quality benchmark                                            |
| `nodebench-production`          | live production verification                                        |
| `nodebench-activegraph-canary`  | offline export validation and ActiveGraph persistence/reload parity |

The ActiveGraph binding is an evaluator, not a runtime selection.

## Known gaps, declared rather than hidden

1. **Repo-local runtime:** the mature NodeBench harness remains the migration
   source. `nodeagent-native` is the target, not a current fact.
2. **Manual tool registry:** `packages/mcp-local/src/toolRegistry.ts` remains
   hand-maintained; generated registry authority is future work.
3. **Compiled/runtime split:** a compiler projection proves authored
   consistency, not that production consumes the same path.
4. **Provider portability:** the current product path uses direct Gemini REST;
   provider adapters need an independent runtime migration.
5. **ProofLoop receipt:** `nodekit.run-export/v1` is a NodeBench execution
   export, not a claim to implement `proofloop.receipt/v1`.
6. **Existing traces:** traces created before the append-only chain are not
   backfilled. They intentionally return a typed `legacy_trace` export error.

## Next migration gates

| Gate                          | Change                                                                                | Proof required                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 3 — complete wrapper coverage | Prove every production execution entrypoint starts and terminates the canonical chain | mutation/source audit plus end-to-end owner tests                     |
| 4 — shadow corpus             | Replay about 20 representative immutable exports with all writes prohibited           | output, evidence, mutation, cost, and latency receipts                |
| 5 — decide                    | Write a separate adoption or rejection ADR                                            | corpus result, issue #67 disposition, threat model, rollback          |
| 6 — extract                   | Move stable pack implementations only when a second consumer needs them               | pack conformance in two hosts                                         |
| 7 — enforce                   | Retire legacy paths and reject new forks in CI                                        | same current compiled definition in local, eval, and production paths |

Rule for later work: preserve the physical tree, build through declared
boundaries, and do not combine broad path moves with behavioral changes.

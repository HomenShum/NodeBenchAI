# agent/ — authored agent surface

This directory is the NodeKit-standard, filesystem-first authoring surface for
the NodeBench agent application. **Brownfield rule: this surface documents the
live system; the repo-local code remains the runtime source of truth.** NodeKit
validates and hashes the projection into `.nodeagent/`, but production does not
load that compiled definition yet. Compilation proves internal consistency; it
does not claim that runtime migration or same-path benchmark parity is complete.

Every file carries a `Source:` pointer to the code that actually enforces it.
When NodeBench switches from `repo-local-nodebench` to `nodeagent-native`, the
direction reverses: these files become runtime source and legacy pointers become
compatibility inputs or generated output.

| Standard slot | Status | Lives today at |
|---|---|---|
| instructions.md | authored here | mirrors `backend/convex/domains/redesign/chatRuns.ts` |
| policies/ | authored here | mirrors guards in workers/node/, backend/convex/, adw/goals/ |
| subagents/ | index only | `backend/convex/domains/agents/**` orchestrator-workers |
| tools/ | index only | `packages/mcp-local/src/tools/**` (304 tools) |
| planner/ context/ memory/ hooks/ channels/ schedules/ sandbox/ | not yet authored | see `docs/architecture/STANDARD_REPO_TREE.md` mapping |

Do not add `.ts` files here during brownfield mapping — the app's tsconfig does
not include this directory and nothing should import from it until the runtime
adapter phase.

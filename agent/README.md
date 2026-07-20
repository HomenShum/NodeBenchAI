# agent/ — authored agent surface (phase 0)

This directory is the NodeKit-standard, filesystem-first authoring surface for
the NodeBench agent application. **Phase 0 rule: this surface documents the
live system; the code remains the source of truth.** Nothing here is loaded at
runtime yet — there is no manifest compiler, so we do not pretend there is
(`requireCompiledManifest: false` in `nodekit.yaml`, no fake `.nodeagent/`).

Every file carries a `Source:` pointer to the code that actually enforces it.
When the `@nodeagent` compiler exists, the direction reverses: these files
become the source and the pointers become generated output.

| Standard slot | Status | Lives today at |
|---|---|---|
| instructions.md | authored here | mirrors `backend/convex/domains/redesign/chatRuns.ts` |
| policies/ | authored here | mirrors guards in workers/node/, backend/convex/, adw/goals/ |
| subagents/ | index only | `backend/convex/domains/agents/**` orchestrator-workers |
| tools/ | index only | `packages/mcp-local/src/tools/**` (304 tools) |
| planner/ context/ memory/ hooks/ channels/ schedules/ sandbox/ | not yet authored | see `docs/architecture/STANDARD_REPO_TREE.md` mapping |

Do not add `.ts` files here in phase 0 — the app's tsconfig does not include
this directory and nothing should import from it until the compiler phase.

# agent/ — authored agent surface (phase 0)

This directory is the NodeKit-standard, filesystem-first authoring surface for
the NodeBench agent application. **Phase 0 rule: this surface documents the
live system; the code remains the source of truth.** NodeKit now validates and
hashes this surface into `.nodeagent/`, but the production runtime does not load
that compiled definition yet. Compilation proves the canonical authored
projection is internally valid; it does not bind every legacy implementation
file or falsely claim that the runtime migration is complete.

Every file carries a `Source:` pointer to the code that actually enforces it.
When NodeBench switches from `repo-local-nodebench` to `nodeagent-native`, the
direction reverses: these files become runtime source and the legacy pointers
become compatibility inputs or generated output.

| Standard slot | Status | Lives today at |
|---|---|---|
| instructions.md | authored here | mirrors `convex/domains/redesign/chatRuns.ts` |
| policies/ | authored here | mirrors guards in server/, convex/, goals/ |
| subagents/ | index only | `convex/domains/agents/**` orchestrator-workers |
| tools/ | index only | `packages/mcp-local/src/tools/**` (304 tools) |
| planner/ context/ memory/ hooks/ channels/ schedules/ sandbox/ | not yet authored | see `docs/architecture/STANDARD_REPO_TREE.md` mapping |

Do not add `.ts` files here in phase 0 — the app's tsconfig does not include
this directory and nothing should import from it until the runtime-adapter phase.

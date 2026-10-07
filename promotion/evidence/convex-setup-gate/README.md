# Convex setup gate — evidence

Producer, committed and re-runnable from a fresh clone after `npm install`:

    node scripts/capture-convex-setup-gate.mjs [--port 4301]

It boots Vite twice — once with `VITE_CONVEX_URL` unset, once with the
placeholder read live out of `.env.example` — loads `/redesign/chat` at 1280×900
and 375×812, and asserts on each: the `Convex backend not configured` heading is
present, no product surface is mounted, zero console/page errors, no horizontal
overflow. Exits nonzero otherwise.

| Path | What it is |
|---|---|
| `report.json`, `unset-*.png`, `env-example-placeholder-*.png` | The current tree. `verdict: PASS`, 4/4 cases. |
| `before/` | The same producer on the pre-fix tree, with the fix stashed. `verdict: FAIL`, 2/4 cases: the `.env.example` placeholder mounted `[data-agent-runtime-surface="redesign-chat"]` against a dead socket and logged an uncaught `[CONVEX FATAL ERROR] Couldn't parse deployment name your-project`. |

To regenerate `before/`: `git stash push -- apps/web/src/main.tsx
apps/web/src/hooks/useConvexSearch.ts
apps/web/src/features/workspace/lib/useEventWorkspacePersistence.ts
apps/web/src/features/notebook/hooks/useEntityExpansion.ts`, run the producer,
then `git stash pop`.

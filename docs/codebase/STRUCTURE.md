# STRUCTURE — where things are, and which directories you can ignore

This repository has about 6,800 tracked files. A new reader's first problem is
not understanding a file, it is knowing which 30 files matter. This page is
sorted by that: **the shipping path first, everything else after.**

File counts come from `git ls-files "<dir>/*" | wc -l` at the commit carrying
this document.

## The shipping path — read these

| Path | Files | What lives here |
|---|---:|---|
| `apps/web/` | 1,448 | The browser app. Entry: `apps/web/index.html` → `src/main.tsx` → `src/App.tsx`. |
| `apps/web/src/features/redesign/` | — | **The one canonical product surface.** `RedesignShell.tsx` → `surfaces/ChatSurface.tsx` → `hooks/useRedesignChatRun.ts`. If you only read one folder, read this one. |
| `backend/convex/` | 1,706 | The entire backend: schema, queries, mutations, actions, scheduled jobs, HTTP routes. |
| `backend/convex/domains/redesign/chatRuns.ts` | 1 file, ~2,700 lines | The chat run lifecycle end to end — validation, orchestration, the model call, persistence, failure, and source verification. Steps 5–10 of `docs/START_HERE.md` are all inside this file. |
| `shared/` | 47 | Code imported by **both** the browser and Convex — e.g. `shared/redesign/promptClassifier`. Anything here must run in both runtimes. |

## Supporting runtimes — read when you need them

| Path | Files | What lives here |
|---|---:|---|
| `workers/node/` | 117 | A standalone Node service for voice, search and shared-context routes. Separate process, separate tsconfig, not needed for the chat path. |
| `api/` | 16 | Vercel serverless functions. `middleware.ts` at the repo root is the Vercel edge middleware. Both are platform entry points, which is why static analysis reports them as unused. |
| `packages/` | 478 | Publishable side products: four MCP server distributions (`mcp-local`, `mcp-power`, `mcp-admin`, `convex-mcp-nodebench`, `openclaw-mcp-nodebench`), an eval engine, a project scaffolder. Each has its own `package.json` and its own test command. |
| `mcp-services/`, `python-mcp-servers/`, `services/` | 148 | Deployed MCP gateways, including Python ones. Independent of the web app. |
| `mobile/` | 73 | Capacitor shell. |

## Verification and evidence — where proof lives

| Path | Files | What lives here |
|---|---:|---|
| `evals/e2e/` | — | Playwright specs. This is the browser check. |
| `evals/` | 114 | Everything else evaluation-shaped: prompt packs, scenario catalogues, dataset runners. |
| `benchmarks/` | 253 | Recorded benchmark inputs and outputs. Data, not code. |
| `proof/`, `evidence/`, `.qa/`, `promotion/evidence/` | 73 + | Captured screenshots and reports that back specific claims. `promotion/` in particular holds the product-loop scorecard and defect ledger this work continues. |
| `scripts/` | 455 | Operational scripts. Roughly 200 of them are wired to npm scripts. See CONCERNS.md — this is the largest single navigation problem in the repo. |

## Documentation

`docs/` has 1,113 files, most of them historical audits, plans and findings. The
short list a new reader should actually open:

- `docs/START_HERE.md` — the runtime-ordered walkthrough (start here, literally).
- `docs/SIMPLIFICATION_REPORT.md` — what was measured and removed, with commands.
- `docs/codebase/` — this folder.
- `promotion/PROMOTION_LOG.md` — the honest defect ledger for the product loop.
- `.tours/` — CodeTour files that walk the same path inside the real source.

Everything else under `docs/` is archive. Treat a document there as evidence of
what someone believed on a date, not as a specification.

## Naming that will otherwise confuse you

- **`redesign`** is not a work-in-progress redesign. It is the *current* product
  surface; the older cockpit under `apps/web/src/features/` (documents, notebook,
  agents, …) is the part that is legacy.
- **`domains/`** inside `backend/convex` is a flat namespace of ~70 product
  areas, not a DDD layer. `domains/redesign` is the chat product.
- **`evals/`** holds both automated tests (`evals/e2e`) and research artefacts.
  The Playwright config points at `evals/e2e`.

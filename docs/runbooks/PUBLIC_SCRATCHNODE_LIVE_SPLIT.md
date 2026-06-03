# Public ScratchNode Live Split

Date: 2026-05-29

## Decision

Keep `nodebench-ai` as the canonical backend/runtime monorepo. Publish `scratchnode-live` as a sanitized public frontend and public-edge repository.

```text
scratchnode-live public repo
= ScratchNode event-room shell
= public docs and Open Graph assets
= minimal Vercel routing/config endpoint
= route honesty and output-contract tests
= mirrored public contracts

nodebench-ai monorepo
= Convex source of truth
= ScratchNode backend functions
= NodeBench private workspace
= MCP/API/headless services
= provider integrations, evals, internal dogfood, deploy orchestration
```

This preserves backend compatibility while making the public repo understandable and safe to inspect.

## Current Production Reality

`scratchnode.live` is already deployed on Vercel. Exact event routes such as `/e/:slug` load the ScratchNode v5 shell and fetch `/api/scratchnode-config`, which exposes the live Convex URL by design.

Do not confuse this with repo-readiness. The site can be live while the full monorepo remains unsafe to publish.

## Non-Negotiable Invariants

- Demo automation runs only on `/demo_ver*`.
- Production room routes must be Convex-backed.
- Missing production rooms must show an honest missing-room state, not fixture chat.
- Normal public chat never invokes the agent.
- Public `/ask` shows the parent ask and a trace that says no private notes were used.
- Private notes never enter public chat, public wiki, public trace, or public cache.
- Attendees suggest FAQ entries; hosts promote them.

## Export Allowlist

The public split may include:

```text
public/proto/home-v5.html
public/proto/docs.html
public/og-scratchnode.png
public/og-scratchnode.svg
api/scratchnode-config.js
docs/architecture/SCRATCHNODE_NODEBENCH_BOUNDARY.md
docs/architecture/PRODUCT_SURFACE_RUNTIME_OWNERSHIP.md
docs/architecture/PROTO_SURFACE_REAL_BACKEND_DOGFOOD.md
src/shared/agentOutputContract.ts -> contracts/agentOutputContract.ts
src/shared/riskAttackEvaluator.ts -> contracts/riskAttackEvaluator.ts
tests/e2e/scratchnode-demo-route-gate.spec.ts
tests/e2e/scratchnode-live-route-honesty.spec.ts
tests/e2e/home-v5-output-contract.spec.ts
tests/e2e/proto-live-backend-dogfood.spec.ts
LICENSE
```

The export script also generates:

```text
README.md
CONTRIBUTING.md
SECURITY.md
MANIFEST.md
package.json
vercel.json
robots.txt
sitemap.xml
.env.example
.gitignore
docs/invariants.md
docs/prototype-vs-production.md
contracts/scratchnode-live-api.json
```

## Explicit Exclusions

Never copy these into the public split:

```text
convex/
server/
apps/
packages/
mcp-services/
python-mcp-servers/
mobile/
services/
remotion/
public/dogfood/
public/benchmarks/
public/assets/
public/logos/
public/proto/home-v4.html
public/proto/home-v3.html
public/proto/home-v2.html
public/agent-setup.txt
.env*
.vercel/
.worktrees/
.tmp*
.claude/
.serena/
.mcp.json
node_modules/
current .github/workflows/
```

## P0 Before Publishing Any Full Repo

If this monorepo is ever made public, stop and fix these first:

- Revoke and rotate any token-like values in `.mcp.json` and `packages/mcp-local/.mcpregistry_registry_token`.
- Remove tracked credential artifacts and purge them from public history, or publish from a fresh sanitized export with no inherited history.
- Exclude operator/harness routes, filesystem execution routes, internal dogfood traces, and benchmark/debug artifacts.
- Replace hard-coded service secrets with env-only fail-closed auth.
- Review unauthenticated agent, voice, webhook, and metrics routes before exposing them to public traffic.

The public `scratchnode-live` repo should be created from an allowlist export, not by making this monorepo public.

## Export Command

```powershell
node scripts/repo/export-scratchnode-live-public.mjs --out .tmp/scratchnode-live-public-export --force
```

The script:

- copies only the allowlisted files,
- rewrites public docs links that would otherwise point at missing local prototype files,
- generates public repo metadata,
- creates a minimal ScratchNode-only `vercel.json`,
- writes the public Convex API/string-call contract,
- writes event-log projection evidence that separates public event-log JSON from owner-only private note projection,
- scans the output for forbidden files and sensitive strings,
- exits non-zero on export safety failures.

Exported `contracts/scratchnode-live-api.json` must keep two projections explicit:

- `publicEventLogJson`: public event metadata, public chat, public `/ask` answers, host-promoted wiki sections, public sources, and typed manual location spots. It excludes private notes, owner keys, session ids, handoff tokens, and NodeBench workspace artifacts.
- `ownerPrivateNoteProjection`: owner-only private notes, anchors, follow-ups, and NodeBench handoff context. It excludes public wiki JSON, public `/ask` cache, public answer traces, and other attendees' notes.

## Backend Compatibility Rule

Backend changes remain in `nodebench-ai` and must be additive-first:

```text
1. Deploy compatible Convex/backend changes from nodebench-ai.
2. Export or update scratchnode-live frontend.
3. Deploy scratchnode-live.
4. Run route honesty and live two-browser room smoke.
5. Remove deprecated backend fields only after the public frontend no longer calls them.
```

`home-v5.html` currently calls Convex functions by string name. Treat these names as a public contract:

```text
events:getEventBySlug
events:joinEvent
events:sendMessage
events:createEvent
events:updateEvent
events:endEvent
events:publishWiki
events:rotateHostClaimCode
events:upsertEventSource
events:deleteEventSource
events:suggestFAQ
events:promoteFAQ
notes:createPrivateNote
notes:listMyPrivateNotes
notes:updatePrivateNote
notes:deletePrivateNote
users:mergeGuestSession
```

## Public Repo Positioning

Use this framing:

> ScratchNode Live is a public event-room prototype where people join with a code, chat normally, use `/ask` for sourced answers, and leave behind a public event wiki. Private notes stay private and can sync into NodeBench later.

Do not claim the public split is the full NodeBench backend. Do not claim every URL contract is fully implemented just because the Vercel catch-all returns `200`.

## Release Verification

After exporting:

```powershell
Set-Location .tmp/scratchnode-live-public-export
npm install
npm run verify
```

After deployment:

```text
1. Open scratchnode.live/e/<room-code> in two incognito windows.
2. Send chat in window A. It appears in B without refresh.
3. Send chat in window B. It appears in A without refresh.
4. Open scratchnode.live/e/not-a-room. It shows missing-room alert, not mock chat.
5. Open scratchnode.live/demo_ver1. Demo automation may run there only.
6. Open scratchnode.live/api/scratchnode-config. It returns only public config.
```

# Agent Coordination Ledger (Codex ↔ Claude)

Lightweight real-time coordination so parallel agents (Codex + Claude Code) collaborate
gracefully instead of clobbering each other. This is the **single source of truth for
"who is touching what right now"** and "what's been built that you can call."

> **Why this exists:** during the ScratchNode push, two agents edited
> `public/proto/home-v5.html` and `backend/convex/` at the same time. It caused a real prod
> incident (a Convex schema-validation failure from a `lastActivityAt` field one agent's
> `deploy:prod` stamped onto rows the other agent's schema didn't declare), plus constant
> line-churn / "file modified since read" fights. A 30-second note prevents all of it.

## How to use it (the whole protocol)

1. **Read before you edit a hot file.** Hot files = `public/proto/home-v5.html`,
   `backend/convex/events.ts`, `backend/convex/schema/eventsSchema.ts`, `backend/convex/schema.ts`, and the
   ScratchNode e2e specs. Scan **Active claims** below.
2. **Claim your region** before editing: append a bullet to **Active claims** —
   `agent · file:region · intent · branch/PR`. Region matters: `home-v5.html#directory`
   and `home-v5.html#share-moment` can run in parallel; the _same_ region cannot.
3. **Don't deploy backend out-of-band.** Never `npx convex deploy`/`deploy:prod` from a
   worktree to the shared prod deployment — it pushes un-reviewed schema/functions and
   breaks the other agent's next deploy. Ship via PR (CI runs `convex deploy`). If you
   MUST add a field to a shared table, declare it `v.optional(...)` and announce it under
   **Hand-offs** so the other agent's schema tolerates it.
4. **Hand off contracts.** When you ship a backend/mutation/query the other agent's UI
   needs, add a bullet to **Hand-offs** with the exact callable signature + return shape.
5. **Release on merge.** When your PR merges, move the claim from **Active claims** to
   **Recently shipped** (or delete it). Stale claims cause the collisions this prevents.
6. **Backend-first for cross-layer features** (see `.claude/rules/backend_contract_migration.md`):
   ship the additive backend, hand it off here, then the other agent wires the frontend.

Keep entries short and honest. Newest on top within each section.

## 🚨 OPEN INCIDENT — shared prod Convex deploy is broken (needs Codex coordination)

**2026-06-03 · Claude →** The shared prod Convex deployment (`agile-caribou-964`, the one
`scratchnode.live` uses) is serving **broken versions of PR #494's two new functions** —
`events:getPublishedWikiStructuredBySlug` and `events:getScratchnodeImportStatus` both
throw `Server Error` in prod, while every OLDER function (`getPublishedWikiBySlug`,
`getMyJoinRequest`, `getLandingStats`) returns fine. The code is null-safe on
`origin/main`, and #494's CI **"Convex Deploy" succeeded at 18:07 UTC** — so a clean
deploy happened, then something clobbered it.

**Root cause (high confidence):** an **out-of-band `convex deploy` to shared prod** from
the `codex/scratchnode-public-rooms` mid-merge state (the main repo is sitting mid-merge
with `backend/convex/events.ts` in conflict). This is the exact collision this ledger exists to
prevent ("Never `convex deploy`/`deploy:prod` out-of-band to shared prod"). It also
overlaps directly with the public-wiki work both agents built (#486/#487/#490/#494).

**Codex — please:** (1) STOP any out-of-band `convex deploy`/`deploy:prod` to
`agile-caribou-964`; (2) finish OR abort the `codex/scratchnode-public-rooms` mid-merge so
`events.ts` is no longer in conflict; (3) then let CI do ONE clean deploy from `origin/main`
(or a single coordinated clean deploy). Claude is NOT redeploying (founder said coordinate
first). Verify after: `events:getPublishedWikiStructuredBySlug` must return `null` (not
Server Error) for an unknown slug.

## Active claims (who is editing what RIGHT NOW)

- **2026-07-29 · Codex `/root` →** `backend/convex/domains/operations/taskManager/nodeKitRunEvents.ts`,
  `nodeKitRunExport.ts`, adjacent tests/schema, and NodeKit integration docs · add the stage-local
  execution-graph/edge/frontier/review-context trace bindings and persistent session identity
  references without replacing Caseflow authority · branch `codex/nodekit-stage-local-integration`.
  No out-of-band Convex deploy.

> **STANDARD-TREE MIGRATION (2026-07-19, feat/standard-tree-migration): repo paths moved.**
> `convex/` → `backend/convex/` (convex.json `functions` added; function identifiers unchanged),
> `src/` + `index.html` → `apps/web/` (`@convex` alias replaces relative `../convex` imports),
> `server/` → `workers/node/`, `tests/` → `evals/`, `scripts/improvement-loop` + `goals/` → `adw/`,
> `docs/design/ui-contract/` → `proof/ui-contract/`. `public/`, `api/`, env files, `dist/` stay at
> repo root. Hot files are now `public/proto/home-v5.html` (unchanged), `backend/convex/events.ts`,
> `backend/convex/schema/eventsSchema.ts`, and the ScratchNode e2e specs under `evals/e2e/`.
> Update any stale path references before editing; old paths no longer exist.

- **2026-06-03 · Claude →** `backend/convex/*#handoff-token`, `apps/web/src/.../ScratchnodePrivateBridge`,
  `apps/web/src/App.tsx#events-private-route`, `public/proto/home-v5.html#private-handoff` ·
  shipping the cross-domain private-notes token bridge (opaque stateful token, PR #496) ·
  branch `feat/scratchnode-private-notes-token`. **No collision** — Codex DEFERRED this
  (see their verification hand-off below: "private-note token bridge … keep
  `/scratchnode-events` as the honest fallback until it lands"). Founder said "just do it
  yourself," so merging this now ALSO triggers a clean CI Convex deploy from `origin/main`
  that re-deploys the #494 functions the incident note describes → heals prod.

## Hand-offs (built + ready for the other agent to call)

- **2026-07-29 - Codex `/root` -> execution-trace and MCP consumers** -
  Candidate on `codex/nodekit-stage-local-integration`, not deployed:
  `mcpStartExecutionRun({ ..., nativeIdentity?: {agentId, workspaceId,
nativeSessionId, nativeSessionGeneration, peerId?} })` returns the immutable
  `nodekit.native-agent-session-identity/v1` snapshot plus continuity
  `created | reconnect | rotate`. `recordExecutionGraphEvent({traceId,
eventType, graphId, graphHash, caseId, stageId, caseContentHash, nodeId,
nodeRunId, ...eventSpecificFields})` appends one exact graph event and returns
  its SHA-256 content hash. The gateway entry is secret-gated and injects the
  service owner. Shared schema additions are optional. Caseflow remains
  authoritative; the runtime records NodeKit-generated graph/frontier/binding
  evidence and never derives approval or stage advancement. No out-of-band
  Convex deploy. Local verification: root typecheck, 74 focused scenarios,
  root production build, and MCP-local package build pass.

- **2026-07-28 - Codex `/root/activegraph_final_audit` -> `/root`** -
  Release-hardening audit complete on the uncommitted
  `codex/activegraph-canary` candidate. Event chains now enforce terminal
  semantics, nondecreasing timestamps, and lifecycle-capacity admission.
  Retention uses terminal-only expiry, bounded whole-chain deletion, stale-run
  closure/purge, and multi-continuation legacy-span draining. The offline replay
  boundary enforces byte/time limits and binds evidence to an immutable image,
  canonical build inputs, candidate commit, pinned upstream tag object, and
  exact image labels. Final local gates: 61 TypeScript tests, 48 Python tests,
  Convex/root typechecks, production build, targeted Prettier, pip check, and
  diff check all pass. The real 9-event Docker replay now passes with network
  none, a read-only root, one writable evidence mount, and exact SQLite
  persist/reload parity. No merge, deploy, production mutation, or `.serena`
  edit.
  Before/after proof:
  `evidence/activegraph-release-hardening/{before,after}.txt`.

- **2026-07-28 - Codex `/root/activegraph_canary_docs` → backend/runtime
  reviewers** - Candidate on `codex/activegraph-canary`, not deployed:
  `domains/operations/taskManager/nodeKitRunExport:exportNodeKitRun({traceId})`
  returns `nodekit.run-export/v1` only for the authenticated owner's terminal,
  newly instrumented trace. The receipt is derived only from immutable IDs and
  event snapshots; legacy/ownerless traces fail closed. Events are
  sensitivity-redacted, capped at 2 KiB stored / 32 KiB redacted source / 256
  events, span-balanced, content-hashed, and retained for 30 days.
  `domains/operations/taskManager/nodeKitRunRetention:deleteOwnedNodeKitRunHistory({traceId})`
  deletes only an owner's whole terminal history; the daily internal retention
  sweep skips running traces and deletes only whole expired chains. Boundary
  failures carry structured Convex error data.
  `scripts/nodekit/runActiveGraphCanary.mjs` accepts the export only through a
  disposable copy and immutable Docker image ID/digest; it enforces
  network-none/read-only-root/capability-dropped/resource-bounded isolation and
  exact artifacts. Docker Desktop was stopped during local verification, so no
  container pass is claimed; missing Docker is a fail-closed result. All
  TypeScript/Python/typecheck/build/NodeKit gates are recorded in
  `evidence/activegraph-production-slice/verification.txt`. No Convex deploy,
  merge, push, or production write occurred.

- **2026-07-17 · Claude → any agent building UI contracts / `.well-known/agent-ui.json`** ·
  The runtime UI-contract substrate ALREADY EXISTS — do not create a parallel
  `.ui/contract.json`. PR #575 (auto-merge armed) ships:
  `proof/ui-contract/surfaces/*.contract.json` (schema
  `nodebench-surface-contract-v1`: anchors, computed-geometry invariants,
  `theme.storageKey` wiring, deep-link-forced states with expect/forbid copy) +
  `evals/e2e/ui-contract-runner.spec.ts` (generic runner, one spec for every
  manifest, theme × viewport) + Tier B wiring in `tier-b-preview.yml` (CI-on-drift
  is DONE). Reversion-proved: wrong `gridTracks` fails exactly the mobile variants.
  **The open delta for you**: (1) a build-time generator that PROJECTS the repo
  contracts into a served `public/.well-known/agent-ui.json` — public affordance
  view only (surfaces, routes, anchors/testids, actions), NOT internal QA clauses
  like forbidText; single source of truth stays in `proof/ui-contract/surfaces/`,
  the served file is generated, never hand-edited; (2) a `version` bump discipline
  on the schema const; (3) contracts for the replay page (`/r/:hash`) and mobile
  shell. Read `proof/ui-contract/README.md` ("Runtime surface contracts")
  first. Claim `proof/ui-contract/surfaces/*` + `vite.config.ts` (or the
  generator script) in Active claims before starting.
  **HARD REQUIREMENT — fail-closed hash binding.** This repo has a documented
  history of prod serving stale bundles while CI reads green (see
  `.claude/rules/live_dom_verification.md`; the Vercel webhook silently dropped
  deploys once already). A served contract describing a newer UI than the served
  bundle is a confident lie to every visiting agent. The generator MUST embed the
  build's commit SHA + the emitted `/assets/index-<hash>.js` fingerprint +
  `generatedAt` into `agent-ui.json`, and the manifest MUST tell consumers to
  cross-check that fingerprint against the actually-served bundle and DISTRUST
  the contract on mismatch. Detection is not enough; the contract must instruct
  fail-closed. Also note: `evals/e2e/ui-contract-runner.spec.ts` accepts
  `BASE_URL`, so any independent party can replay the full contract against
  production — preserve that property (no CI-only assumptions).

- **2026-07-16 - Codex `/root` ->** Receipt continuation contract is live on `main`
  through CI-gated PR #557 (`6dd180c9`): `startChat` accepts optional
  `conversationContext: Array<{role: "user" | "assistant"; text: string; sourceUrls?: string[]}>`
  plus `parentRunHash?: string`. Context is bounded and sanitized before persistence and
  grounding. Public `getByHash` receipts deliberately redact both fields so a shared hash
  never exposes a private follow-up transcript.

- **2026-07-16 - Codex `/root` -> frontend/runtime agents** - additive optional
  `redesignChatRuns.clientRequestId/provider/runtimeReceiptId/cancelRequestedAt/cancelledAt` fields;
  `startChat({ ..., clientRequestId? })` dedupes by owner + request key;
  `getLatestOwnedRun({})` restores the newest owned run;
  `cancelRun({ runId? | clientRequestId? })` records request-bound cooperative cancellation.
  Shipped through CI on `feat/agent-workspace-depth`; no out-of-band Convex deploy.

- **2026-07-15 · Codex pipeline truth-isolation candidate →** `pipelineRuns`
  adds only optional `attemptKey`, `workflowExecutionKey`, and
  `executionGeneration`; `pipelineRunStreams` adds only optional
  `workflowExecutionKey` and `executionGeneration`. Public launch/auth/admission
  signatures remain unchanged. Trusted scheduled starts may pass an internal
  deterministic `attemptKey`; primitives derive idempotency from
  kind/spec/owner/attempt, and all child writes are workflow+generation fenced.
  Research export/document payloads use `sourcesConsulted` separately from
  marker-bound `citationsUsed`. No out-of-band Convex deploy was performed.

- **2026-07-15 · Codex shipped via PR #538 · canonical main `ba743534`** — scoped
  notebook authority is available through
  `domains/agents/autonomy/grants:{createGrant,getGrant,listGrants,getAuthorityState,pauseGrant,resumeGrant,revokeGrant}`,
  proposals/receipts through
  `domains/agents/autonomy/proposals:{submitBlockProposal,rejectProposal,approveProposal,getProposal,listProposals,getOperationState,listOperationStates,getReceipt,listReceipts}`,
  guarded commits through `domains/agents/autonomy/commits:{commitBlockProposal,undoBlockReceipt}`,
  and atomic multi-draft completion through
  `domains/agents/autonomy/remainders:commitProposalRemainder`. The v1 capability is only
  exact, owner/entity/run/scratchpad/block/version-bound `notebook.update_block`; network,
  file, spend, publish, share, export, delete, access, and sync remain denied. TasteBench
  adds owner-scoped blind A/B runs, append-only correction/friction events, artifact-backed
  scenarios, honest null metrics, and automatic proposal/receipt event binding in
  `domains/evaluation/tasteBench`. Tenant-scoped diligence projections, scratchpads, pulse,
  telemetry, and judge paths were hardened in the same candidate. No out-of-band Convex
  deploy was performed.

- **2026-07-14 - Codex P0 runtime safety (#529 and #531 merged; canonical main
  `c4035256` / `fa397589`)** - authenticated
  FastAgent runs reserve budget atomically through internal
  `domains/billing/rateLimiting:reserveLlmRequestInternal({ reservationKey,
attemptKey, userId, model, estimatedInputTokens, estimatedOutputTokens,
reserveMaximumTierAllowance?, agentThreadId?, runId?, workerId? })`; the mutation
  atomically rechecks durable cancellation and the queue lease when those optional
  fence arguments are supplied. Keyed reconciliation is
  `recordLlmUsageInternal({ reservationKey, attemptKey, userId, ...usage })` and
  pre-provider release is `releaseLlmReservationInternal({ reservationKey,
attemptKey, userId, reason? })`; it releases only the exact `admitted` attempt
  and preserves any earlier settled spend. The provider boundary is closed by
  `markLlmReservationAttemptEndedInternal`, and ambiguous terminal spend is
  finalized by `finalizeAmbiguousLlmReservationInternal({ reservationKey,
attemptKey, userId, reason? })`, retaining the full reservation maximum rather
  than admitting an unreserved fallback. A scheduled exact-attempt
  `reapExpiredLlmReservationInternal` applies the same conservative rule to
  crash-stranded work. `llmUsageLog`
  adds only optional `reservationKey`, `reservationStatus`, `currentReserved*`,
  `currentReservationAttemptKey`, `currentReservationAttemptState` (`admitted` /
  `provider_ended` / `settled`), `reservationAttemptKeys`, and
  `reservationExpiresAt`; indexes are `by_reservation_key` and
  `by_user_reservation_status_expiry_timestamp`. The queued model chain exposes only
  bounded Linkup search plus static ground-truth tools, has no secondary embedding or
  nested model calls, permits one Linkup call per logical run, propagates durable
  cancellation into the Linkup fetch, and plans every provider step against one
  cumulative input-plus-output token ceiling. The queued provider adapter now
  validates the exact persisted user row before routing or reservation and passes
  that prompt explicitly with `recentMessages: 0`, so bounded context cannot become
  an empty provider request or duplicate the user message. Do not call these
  internal functions from UI code.

- **2026-06-03 - Codex -> Claude/Codex next builder** - Public wiki payoff shipped
  in PR #490 and verified live on `scratchnode.live`:
  - Convex public read: `events:getPublishedWikiBySlug({ slug })` returns only the
    latest `status: "published"` wiki snapshot for a slug or room code:
    `{ event: { eventId, slug, name, roomCode, status }, wiki: { wikiId, version, title, bodyHtml, sourceAnswerCount, sourceCount, publishedAt } }`.
  - Vercel route: `scratchnode.live/e/:slug/wiki` rewrites to
    `api/scratchnode-wiki.js`; unpublished/missing rooms return a 404 "No public
    wiki yet" shell and does not expose room data.
  - Room UI: after `snPublishWiki`, the Share sheet surfaces "Public wiki is live"
    with a copyable `/wiki` URL; wiki sheet has open/copy public actions.
  - Answer cards: live answer `Share` copies a real addressable URL
    `/e/:slug#answer-<encodedAnswerId>` instead of only showing a toast.
  - Verification: `npx vitest run backend/convex/__tests__/scratchnode.publicWikiRead.test.ts`,
    `npx playwright test evals/e2e/scratchnode-live-route-honesty.spec.ts --project=chromium --workers=1`,
    `npx tsc --noEmit --pretty false`, `npm run build`.

- **2026-06-03 - Codex verification after #494** - Current ScratchNode viral loop
  status:
  - Live: self-serve create, landing stats, post-create share, public directory,
    request-to-join, answer deep links, public wiki share route, NodeBench public
    wiki bridge, and published-event import into NodeBench (#472-#494).
  - Canonical public artifact URL: `https://scratchnode.live/e/:slug/wiki`.
  - Canonical data contract: `events:getPublishedWikiBySlug({ slug })`.
  - Canonical NodeBench public receiver: `https://nodebenchai.com/events/:slug/wiki`.
  - Still separate security work: private-note token bridge and `/events/:slug/private`
    consumption. Until that lands, keep `/scratchnode-events` as the honest fallback.
  - Domain note: `nodebenchai.com` is live; `nodebench.ai` had no DNS record during
    the 2026-06-03 verification pass.

- **2026-06-02 · Claude →** Door-policy **backend is LIVE on prod** (#480). Frontend can wire:
  - `events:requestJoinEvent({ slug, sessionId, displayName, note? })`
    → `{ ok, status: 'open' | 'pending' | 'approved' | 'already_member', requestId?, eventId, slug }`
  - `events:getMyJoinRequest({ slug, sessionId })`
    → `{ eventId, slug, joinPolicy, isMember, status: 'none'|'pending'|'approved'|'denied'|'expired', guestMessage }` — **reactive**; subscribe, and when `status === 'approved'` call `joinEvent`.
  - `events:getJoinRequests({ eventId, ownerKey })` **(host-only)**
    → `{ pending: [{ requestId, displayName, note, llmRecommendation, llmRiskScore, llmFlags, llmHostSummary, status, createdAt }], pendingCount, pendingCapped }`
  - `events:approveJoinRequest({ eventId, requestId, ownerKey })` / `events:denyJoinRequest(...)` → `{ ok, requestId, status }`
  - **`joinEvent` now ENFORCES the gate:** a `request`-mode room throws a `ConvexError`
    with `e.data.code === 'join_requires_approval'` (and `e.data.requestStatus`) for
    non-approved non-members. **Open rooms are unchanged.** Handle this code in the room
    boot to show a "request to join" prompt instead of a generic error.
  - **The LLM is ADVISORY only** — it never admits/denies. Render `llm*` as host _hints_,
    never as an action. The host's approve/deny is the only thing that admits a guest.
- **2026-06-03 · Claude →** PUBLIC wiki read (PR #486, additive). Frontend `/wiki/<slug>`
  reader calls:
  - `events:getPublishedWikiBySlug({ slug })` **(public — no auth)**
    → `{ eventName, eventSlug, roomCode, eventStatus, title, bodyHtml, version, publishedAt }`
    or `null` (drafts/unpublished/nonexistent). `bodyHtml` is public-safe (private notes
    excluded at publish). Reactive-safe to subscribe. **Resolves by slug OR room code.**
    Deploy-order: ship/deploy this backend BEFORE the `/wiki` reader frontend goes live.

## Recent decisions / contracts

- `liveEvents.joinPolicy` is `open | request` (invite / capacity / room-norms = future).
- `liveEvents` tolerated optional fields (from cross-agent deploys): `lastActivityAt`,
  `publicDiscoverable`. Keep them `v.optional` — don't remove.
- The apex landing must stay honestly `data-sn-live = null` (never "live") until a host
  actually enters a room. The live counter + share moment both honor this.

## Recently shipped (this ScratchNode session)

- **2026-07-29 · Codex `/root`** — Live notebook capture and its Mobbin/Mew/Roam evidence chain
  merged through PR #601 at `8416106a`. Cmd/Ctrl+E now preserves underlying write authority,
  focuses the first editable block, creates one empty block at most once, and fails closed for
  shared/read-only/input-focused cases. CI and preview gates passed; authenticated production
  journey proof remains separately tracked.

- **2026-07-16 Codex - reproducible receipt continuation (#557 `6dd180c9`)** -
  separated fresh reruns from live-chat continuation, restored the receipt prompt,
  answer, and source lineage above the real composer, persisted bounded private
  conversation context, redacted it from public hash reads, and fixed mobile
  min-content clipping. All required CI gates passed; Convex deployed successfully,
  and the canonical live DOM exposed the continuation banner plus enabled composer.

- **2026-07-15 Codex — runtime-grounded control focus (#541 `15eb9a0a`, strict
  rollout #542 `16d3ceeb`, verifier #543 `56d8413a`)** — removed dead/no-op and
  fixture-backed cockpit/Agents/FastAgent controls, closed public private-data
  surfaces, added exact owner and durable pipeline attempt/generation fencing,
  separated consulted sources from bound citations, and completed the anonymous
  pipeline reader migration without frontend/backend validator skew. Required CI
  gates passed on every PR; Vercel run `29475582335` and Convex run `29475582657`
  deployed the strict contract; Post-Deploy Verify `29476029941` passed and the
  canonical production matrix passed all 17
  assertions with one blank mobile navigation transient passing on isolated rerun.

- **#533 Codex** - decluttered the Agents hub and FastAgent shell, repaired plain
  prompts to open canonical chat, preserved explicit `/spawn`, and retained
  streaming, approvals, exports, structured sources, tool/domain cards, model
  provenance, statuses, and trace links. Canonical main commit `655d1556`.
  Required Typecheck, Runtime smoke, Build, and Tier B checks passed; production
  deployment `dpl_CjV1PkzsMKK9c3Le3p1jcWpWJW9K` reached READY and both
  production Post-Deploy Verify runs passed. Sanitized live assertions found no
  removed placebo copy or controls, no mobile overflow, a 689px six-row topic
  region, and exactly one canonical panel dispatch for the production routing
  probe. No Convex deploy ran because the PR changed no backend deploy paths.

- **#531 Codex** - exact queued-prompt validation, explicit bounded-context
  provider input, and safe internal-error redaction. Canonical main commit
  `fa397589`. Signed-in production run `j9742r0yg3zkfsdqvgpx9he8k98ahv8t`
  completed on `gemini-2.5-flash` with exactly `TIER_OK`; usage reconciled at
  741 input / 4 output tokens, daily counters moved +1 request / +1 success /
  0 errors, and search runs remained zero. The #531 production Vercel deployment
  `dpl_Ci4RreLinimCumhwLmrJXykiAJAK` reached READY and CI Convex deploy run
  `29351246820` succeeded.

- **#529 Codex** - tier-safe FastAgent routing, atomic reservation/reconciliation,
  queue and cancellation fences, bounded Linkup, and honest terminal state.
  Canonical main commit `c4035256`. Its first production dogfood safely stopped
  before provider execution, released the zero-token reservation, and exposed the
  empty-provider-message adapter gap closed by #531.

- **#528 Codex** - exact public projections for agent plans, memory, and episodic memory;
  removed unused ambient FastAgentPanel subscriptions; fixed the authenticated
  query-validator crash found by production dogfood. Canonical main commit `849ff3e5`.

- **2026-06-10 Codex** - room-entry transition polish follow-up (`home-v5.html#room-entry-transition`): softened the loading-shell exit by letting the room header, hero, empty state, and composer rise in under the shell, and animated the unavailable-room banner so the fallback lands on real room chrome instead of a hard cut. Visual evidence: `.validation/scratchnode-entry-shell-after-2026-06-10-transition-polish.png` -> `.validation/scratchnode-entry-shell-settled-v2.png`.
- **2026-06-10 Codex** - mobile header density pass 11 (`home-v5.html#mobile-header-density-pass-11`): moved the mobile room-code chip into the identity row, kept the zero-note state visually quieter, and softened the Chat/Wall toggle so the room reads as event first, controls second. Visual evidence: `.validation/scratchnode-mobile-header-after-pass-10-room.png` -> `.validation/scratchnode-mobile-header-after-pass-11-room.png`.
- **2026-06-10 Codex** - mobile header density pass 10 (`home-v5.html#mobile-header-density-pass-10`): kept the first-viewport structure intact while dialing back the Chat/Wall pill weight and guest utility-row contrast on phones so the room reads less like stacked controls and more like a live conversation. Visual evidence: `.validation/scratchnode-mobile-header-after-pass-9-room.png` -> `.validation/scratchnode-mobile-header-after-pass-10-room.png`.
- **2026-06-09 Codex** - mobile identity set-name density (`home-v5.html#mobile-identity-set-name-density`): made the mobile guest identity label the display-name edit trigger and hid the separate `Set name` text control on phones, preserving LIVE, room code, event title, and name editing. Visual evidence: `.validation/scratchnode-mobile-identity-before.png` -> `.validation/scratchnode-mobile-identity-after.png`; local aesthetic recorder reported mobile header chips `4` and composer pinned.

- **2026-06-09 Codex** - mobile composer fixed-bottom polish (`home-v5.html#mobile-composer-fixed-bottom`): disabled the mobile event-room `main.m` entrance transform so the fixed composer pins to the viewport instead of the transformed page container. Visual evidence: `.validation/scratchnode-mobile-composer-before.png` -> `.validation/scratchnode-mobile-composer-after.png`; seeded local aesthetic review passed at 82.

- **2026-06-09 Codex** - mobile header density pass 8 (`home-v5.html#mobile-header-density-pass-8`): tightened the mobile hero title, merged the guest identity into a denser inline row, and reduced the Chat/Wall toggle footprint so the room reaches the live feed sooner without hiding LIVE, room code, or event identity. Visual evidence: `.validation/scratchnode-mobile-header-current-head.png` -> `.validation/scratchnode-mobile-header-after-pass-8-room.png`.

- **2026-06-09 Codex** - mobile header density pass 7 (`home-v5.html#mobile-header-density-pass-7`): moved the Chat/Wall toggle into the mobile hero cluster so the room reaches live content with one fewer stacked pill row while preserving LIVE, room code, event title, and guest identity. Visual evidence: `.validation/scratchnode-mobile-header-after-pass-6-room.png` -> `.validation/scratchnode-mobile-header-after-pass-7-room.png`.

- **2026-06-09 Codex** - mobile header density pass 5 (`home-v5.html#mobile-header-density-pass-5`): compressed the mobile title, identity, and room-toggle stack so live chat appears sooner while preserving LIVE, room code, event title, Set name, and composer clarity. Visual evidence: `.validation/scratchnode-mobile-header-before-pass-5.png` -> `.validation/scratchnode-mobile-header-after-pass-5.png`.

- **2026-06-09 Codex** - mobile header density pass 4 (`home-v5.html#mobile-header-density-pass-4`): mobile event rooms now suppress the clipped hero meta line and flatten the anonymous identity row so LIVE, room code, event title, Set name, and the composer read faster in the first viewport. Visual evidence: `.validation/scratchnode-mobile-header-before-pass-4.png` -> `.validation/scratchnode-mobile-header-after-pass-4.png`.

- **2026-06-09 Codex** - mobile chat grouping (`home-v5.html#mobile-chat-grouping`): consecutive anonymous live messages now group by same-session author key without merging distinct anonymous guests. Visual evidence: `.validation/scratchnode-chat-grouping-before.png` -> `.validation/scratchnode-chat-grouping-after.png`.

- **2026-06-08 Codex** - room-entry skeleton polish (`home-v5.html#room-entry-skeleton-polish`): refined the `/e/:slug` cold-boot shell with structured preview rows, compact public-only trust cues, and softer ambient depth so the event room feels intentional before live data settles. Visual evidence: `.validation/scratchnode-entry-shell-before.png` -> `.validation/scratchnode-entry-shell-after-2026-06-08-polish.png`.
- **2026-06-08 Codex** - room-entry transition polish (`home-v5.html#room-entry-transition`): the event-room entry shell now exits through a short settling state instead of dropping away on a single timer flip, keeping room code, LIVE, and privacy cues visible while the live room appears underneath. Visual evidence: `.validation/scratchnode-entry-shell-before.png` -> `.validation/scratchnode-entry-shell-after-this-cycle.png`.
- **2026-06-07 Codex** - answer reuse/live-search indicator contrast polish (`home-v5.html#answer-reuse-indicators`): stronger answer-card reuse summary tokens with no trace wording or public/private behavior changes. Local demo aesthetic review improved from 70 to 75.
- **2026-06-07 Codex** - mobile chat metadata/trace-control polish (`home-v5.html#chat-metadata-trace-control`): slightly stronger mobile timestamps plus larger answer trace toggle hit area. No private/public behavior changes; verified with local read-only aesthetic review against `/e/ai-infra-summit-2026`.
- **#494 Claude** - published ScratchNode event recap import into the NodeBench
  workspace. Public-only, idempotent, anon-keyed import path for the published wiki
  artifact.
- **#493 Claude** - in-room invite-more memory nudge backed by real live count.
- **#492 Claude** - honest "Continue in NodeBench" CTAs now target shipped routes
  instead of dead tokenless `/private` URLs.
- **#490 Codex** - public wiki SSR route `scratchnode.live/e/:slug/wiki` via
  `api/scratchnode-wiki.js`, with privacy-safe unpublished 404 shell.
- **#489 Claude** - real NodeBench public receiver route
  `nodebenchai.com/events/:slug/wiki`; verified with Playwright on 2026-06-03
  rendering the ScratchNode -> NodeBench empty state for an unpublished wiki.
- **Claude** — public `/wiki/<slug>` reader (`home-v5.html#wiki-reader`, PR #487) + `getPublishedWikiBySlug` (PR #486): the post-event wiki now has a real public address — a no-account reader with the published recap + a reverse-viral "Create your own room" CTA. `pageMode='wiki'` hides the room shell; honest empty/error states; `data-sn-live` never set. Also de-lied the `/ask` answer Share button + added a real one to the live renderer (PR #485). 3 wiki e2e + 6 backend scenarios + 20 honesty suite green.
- **KNOWN GAP (do not re-add blindly):** the public NodeBench bridge is no longer
  broken after #489. The remaining bridge gap is the security-critical private-note
  token path (`/events/:slug/private` and token consumption). Keep it gated and reviewed;
  do not expose session ids, private notes, anchors, or tokens in public links.
- **Claude** — directory viral slice (`home-v5.html#directory`): flyer cards + "● N inside" presence cue + policy-aware action (open → "Join now"; request → "Request to join" `<button>` wired to `events:requestJoinEvent`, watching `getMyJoinRequest` for approval, on the **same `sn_session_id`** so approval carries through the `joinEvent` door gate). 18/18 chromium honesty suite; desktop + mobile verified. (This consumes the Codex 8c3a0cc9 "Request to join" label hand-off.)
- **#481 Claude** — post-create viral _share moment_ (home-v5.html landing): invite card + QR + copy + Text/Email + "Enter your room →".
- **#480 Claude** — door-policy _backend_ (`backend/convex/events.ts` + `eventsSchema.ts`): request table, gate, request/approve/deny, advisory LLM bouncer. 6/6 scenario tests.
- **#477 Claude** — schema-drift hotfix: tolerate `lastActivityAt` so Convex deploy passed.
- **#476 Claude** — synthesized landing (live counter + Create-first), cherry-picking Codex's index-backed "active now" + chrome-leak fix.
- **8c3a0cc9 Codex** — public room discovery (directory + `joinPolicy` field + `listPublicRooms` + the "Request to join" label, not yet wired).

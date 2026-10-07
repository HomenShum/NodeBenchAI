# Runtime-grounded UI declutter audit

Date: 2026-07-14 to 2026-07-15  
Scope: canonical cockpit surfaces, `/agents`, FastAgentPanel, pipelines/reports, receipts, and runtime projections  
Status: final local prod-parity candidate; all identified P0/P1 audit blockers repaired; not yet committed, merged, deployed, or production-verified

## Intent

Remove controls and projections that do not expose a real capability, repeat the same action elsewhere, fabricate certainty from presentation heuristics, or consume disproportionate space. Preserve live Convex-backed flows, structured tool/domain cards, source provenance, canonical markdown, streaming, exports, approvals, and the web navigation contract.

The release rule is: a visible control must perform a real runtime action, disclose measured runtime state, or be absent.

## Baseline

Production was captured before implementation at desktop, tablet, and mobile sizes. The baseline showed:

- 657 visible elements and a Prettify score of 8/16.
- 36 visible interactive candidates on mobile.
- A 3,381 px mobile topic canvas made mostly of static pillar and metric cards.
- A clipped five-item hub rail at 390 px.
- 11 empty-panel controls on desktop and 15 on mobile, including empty tabs, duplicate command chips, a mount toast, and decorative rails.
- Message-bubble confidence, citation dots, and media/link cards inferred from text shape rather than backend truth.

Baseline artifacts are in `baseline/` and `pixels-production-baseline.json`.

## Changes

- Made a plain Agents prompt open the real FastAgent chat path; kept `/spawn` as the explicit swarm path.
- Removed placebo modes, fake agent metrics, no-op configure/start/expand controls, an empty approval celebration, a static research banner, duplicate sidebars, and explanatory marketing cards.
- Replaced the oversized topic canvas with a compact list containing only recorded runtime fields.
- Replaced the clipped mobile hub rail with an accessible compact selector while preserving the desktop rail and disabled Roadmap semantics.
- Reduced the unopened FastAgentPanel to useful starters plus the composer; removed empty tabs, duplicate chips, mount toast, minimap, scroll decoration, heuristic follow-ups, toolbar clutter, and fake Focus/Tone controls.
- Removed hedge-derived confidence, positional citation dots, regex-derived media/file/link cards, and automatic source-to-claim citation injection. Retrieved-but-unbound URLs remain sources consulted, never cited claims.
- Removed dead cockpit commands, duplicate rails, placeholder entity actions, local-only model labels, fake precision, and unconditional success/health copy.
- Grounded Home, Reports, Inbox, Me, Agents operations, receipts, TRACE, and pipelines in caller-scoped runtime data with explicit loading, empty, unavailable, and authorization states.
- Added anonymous-session ownership for guest chat and pipeline reads, owner isolation for TRACE/receipts, authenticated pipeline controls, bounded admission quotas, and truthful cost/share/stream disclosures.
- Preserved one canonical responsive component tree instead of parallel desktop/mobile copies.

## Measured result

- 462 visible elements, down 195 (29.7%) in the broad before/after scan.
- 24 mobile interactive candidates, down from 36. The scan conservatively counts closed disclosure children.
- Mobile topic region: 688.8 px, down from 3,381 px.
- Mobile command region: 118 px; desktop: 79 px.
- No horizontal overflow at desktop, tablet, or mobile widths.
- Prettify score: 9/16; stray-alignment rate improved from 0.529 to 0.388.
- Earlier hub and panel captures passed in light/dark themes with no layout overflow or mojibake; the mobile title cleared the simulated iOS status bar.
- A later, narrower hub scan found 25 desktop and 16 mobile controls with no overflow. Those figures are not compared to the broader baseline because the selectors differ.

After artifacts are in `after/`; capture inputs are in `pixels-local-after.json`.

## Final local verification

- `npx tsc --noEmit --pretty false` - pass
- `npx tsc -p convex/tsconfig.json --noEmit --pretty false` - pass
- Broad changed-surface and FastAgent suite - 459 passed, 19 skipped. Three tests hit the default 5-second timeout under parallel resource contention; all three files passed serially, 11/11, with a 15-second timeout.
- Focused runtime, ownership, and security suite - 17/17 pass
- Latest due-diligence validator/caller contract regressions - 6/6 pass
- `npm run test:design` - 13/13 pass
- `npm run lint:design` - pass; existing repo-wide medium/low findings remain, no high-severity finding
- `npm run build` - pass
- Exact desktop Chromium - 9/9 pass
- Mobile runtime Chromium - 5/5 pass
- Canonical five-surface shell contract - 2/2 pass
- `git diff --check` - pass
- Added-literal secret scan - no findings
- Independent no-op sweep - initially no P0/P1 in its narrower surface scope

## Resolved independent audit findings

- P0: server-side retrieval was automatically converted into inline claim citations without claim/source binding. Citation rendering now distinguishes consulted sources from claim-bound citations.
- P1: manual fresh pipeline launches and recurring schedule occurrences were not isolated into distinct attempt rows. Attempt identity, generation fencing, and schedule-occurrence isolation are now explicit.
- P1: desktop Chat/header commands, palette document/search commands, product focus shortcuts, stream-follow behavior, and offline labeling had no-op or contradictory wiring. Dead controls were removed or reconnected to their canonical paths.
- P1: public due-diligence, investor, demo, and evaluation entrypoints trusted caller-supplied ownership or exposed global reads. The retained execution chain is internal-only and revalidates exact job, branch, memo, task-tree, and investor ownership.
- P1: due-diligence tier options were spread into a narrower create-job validator, and successful task completion sent a confidence field the validator rejected. The storage payload is now explicit; completion accepts and persists only finite 0-1 confidence, with real-payload regression tests.
- P1: Inbox and Me each contained an unreachable duplicate render tree with hardcoded plan, usage, connector, and local-draft state. Both now wrap one canonical runtime-backed responsive surface.
- P1: dormant bearer streaming, the parallel-task UI/orchestrator, and stale generated references kept non-operational surfaces alive. They were removed with absence guards while streaming, approvals, exports, tool/domain cards, and provenance remain protected.

## Residuals and live-proof boundary

- Autonomous Operations remains a dense operator surface because its retained controls are live and operational, not ornamental.
- Broader typography, radius, and icon-size consolidation remains a separate design-system pass.
- The local FastAgent panel cannot prove the new guest-thread contract against the older production Convex deployment: the local client sends new anonymous-session arguments while production exposes the previous signature. The production build deploys Convex before the web bundle, so panel and Reports proof must be re-captured against the merged production revision.
- Production-live behavior is not claimed until the CI-gated source PR merges and direct production browser/bundle checks pass.

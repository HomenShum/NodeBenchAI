# Goal: Host public-write actions fail cleanly (frontend consistency + defense-in-depth)

`snPromoteFaq` (home-v5.html:6584) and `snPublishWiki` (6591) call `_snReadHostOwnerKey()`, which
falls back to `sessionId` (6377-6383), while the other 5 host mutations use the strict
`_snRequireVerifiedHostOwnerKey()` (6233) that returns null + a "Host verification required" toast.
Make the two public-write actions consistent with the rest, and add a regression test.

- **status:** shipping — **PR #500** (founder-approved "land #469"; CI-gated auto-merge under the HomenShum account, satisfying the host-action-gating HARD GATE). Rebuilt fresh on `main` after the original #469 went DIRTY. Verified: honesty 27/27 + output-contract green.
- **surface:** scratchnode
- **severity:** **P1** (NOT P0). **Verified:** the backend `requireHost` (`convex/events.ts:439`,
  called at 2626 + 2642) already rejects a bare `sessionId` server-side → **no public write occurs**.
  This is a frontend consistency + UX-honesty + defense-in-depth fix, not a breach.
- **HARD GATE:** touches host-action gating (a permission rule) → **human approves the merge** (HARD_GATES.md). Do not auto-merge.

## Scope
- **Allowed:** `public/proto/home-v5.html` (`snPromoteFaq` ~6583, `snPublishWiki` ~6590, and `_snReadHostOwnerKey` ~6377 if needed); `tests/e2e/scratchnode-live-route-honesty.spec.ts` (regression test)
- **Forbidden:** `convex/**` (backend already enforces — out of scope here); any demo/runDemoFull path; any new surface/route; the `sessionId` bootstrap used by `getHostStatus` boot (~6600) — only the two public-WRITE callers change
- **Core-loop flow:** `/ask → answer → FAQ suggestion → host promotion → public wiki` (the private→public crossing steps)
- **Invariant that must NOT break:** the verified-host happy path keeps working (token in `sn_host_owner_key_v2`, `_sn_live.hostVerified===true`); the existing `verified host can manage room metadata` e2e stays green.

## Definition of done
- [ ] `snPromoteFaq` + `snPublishWiki` early-return with "Host verification required" when `_snRequireVerifiedHostOwnerKey()` returns null (mirror `snUpdateEventFromHostSheet` at 6242), instead of attempting the mutation with a `sessionId`.
- [ ] Browser-reviewable: in a guest session (no `sn_host_owner_key_v2`), calling `window.snPromoteFaq('x')`/`window.snPublishWiki()` shows the toast and fires NO `events:promoteAnswerToFaq`/`events:publishWiki` mutation (verify via the mock-mutation log).
- [ ] New e2e case: no host key set → invoke both → assert mutation log contains neither `promoteAnswerToFaq` nor `publishWiki`. Existing verified-host CRUD test still green.
- [ ] `tsc --noEmit` clean; targeted Playwright suite green; `home-v5-output-contract` still green.

## Constraints
- No new surface/route/helper — reuse `_snRequireVerifiedHostOwnerKey`. This card tightens the boundary; never weakens it.

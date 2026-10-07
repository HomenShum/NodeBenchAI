# Agent live QA hardening audit

Date: 2026-07-16  
Production: https://www.nodebenchai.com/redesign/chat  
Final receipt: https://www.nodebenchai.com/redesign/chat/r/1oicws5io3h2  
Final main commit: `9fa3fdba1ab23b0ca0284ca66a7dd0cf4f705dcd`

## Shipped pull requests

- #550: stable Gemini 3.5 Flash routing, exact paid preflight, cancellation arming, compact response shaping, evidence honesty, and mobile clipping fixes.
- #551: exclude fetched page chrome from compact bullets and require explicit limitations for missing clean claims.
- #552: canonicalize user-requested URLs while retaining provider redirects in the evidence ledger.
- #553: preserve complete URLs through the unheaded response parser.
- #554: strip model-emitted URL fragments and emit exactly one canonical URL per explicit URL-contract bullet.
- #555: preserve persisted line breaks in live and reproducible short-answer rendering.

All PRs used CI-gated squash auto-merge. No admin bypass was used.

## Local verification

- Focused response policy/parser suite: 10 tests passed.
- Composer cancellation/preflight suite: 2 tests passed.
- Responsive and compact-render guards passed.
- `npx tsc --noEmit --pretty false` passed after every slice.
- `npm run test:design`: 13 tests passed.
- `npm run lint:design`: exit 0, no new high-severity finding.
- `npm run build` passed after every slice.
- 390px mobile light/dark geometry: document width 390px, main padding 0px, all transcript/composer descendants within viewport.

## Production live-agent findings loop

1. Gemini 3.5 Flash and paid receipt worked, but fallback page chrome became a second bullet.
2. Provider grounding redirects duplicated through inline citation rendering.
3. A 240-character parser limit cut canonical URLs before policy enforcement.
4. Model-emitted partial URLs survived alongside the canonical URL.
5. Backend text was correct, but normal CSS whitespace collapsed two persisted bullet lines visually.

Each finding was fixed, gated, merged, deployed, and retested before continuing.

## Final production acceptance

- Provider: `google-gemini`.
- Model: `gemini-3.5-flash`.
- Paid runtime preflight visible before submission.
- Intentional double-click submission did not cancel the new run.
- Runtime completed with nonzero tokens/cost telemetry and a reproducible receipt.
- Exact response contains two persisted bullet lines.
- Each bullet contains exactly one canonical URL: `https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash`.
- No provider redirect, citation marker, fetched-page chrome, or broken partial URL appears in the answer.
- Why, Evidence, Risks, and Next Action panels remain absent for the compact response.
- Reloaded receipt preserves the same two bullets and model metadata.
- Shipped replay paragraph computes to `white-space: pre-wrap`; final screenshot visibly shows separate bullet lines.

## Evidence

- `after/chat-mobile-light.png`
- `after/chat-mobile-dark.png`
- `final/production-gemini-35-final.png`
- `final/production-replay-linebreaks-final.png`

QA artifacts are intentionally private/untracked.

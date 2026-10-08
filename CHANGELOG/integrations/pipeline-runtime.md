# Pipeline Runtime

Append-only lane for pipeline launch, activity, streaming, evaluation, schedule,
and secret-gated MCP bridge ownership contracts. Newest entries first.

## 2026-10-07 — Stop failed research from becoming a successful report

A developer or coding agent requesting a company brief needs an explicit failure
when search or analysis fails. Previously JSON returned HTTP200, streaming sent
`complete`, and failed runs could create report, replay, evaluation or retention
records. The existing Pipeline now stops at its first terminal failure, propagates
client cancellation and one 55-second budget through owned provider reads, and
keeps usable evidence when another eligible provider fails.

**PR / canonical main commit**: `PENDING MAIN SHA / FINAL QA`.

**Changes**:
- JSON uses 503 for missing configuration, 422 for valid empty evidence, 502 for upstream/invalid responses, 504 for the total deadline and 500 for internal failure. Cancellation writes no response. After SSE headers, a terminal failure emits one `error` and no `complete` or successful artifact.
- Search/Gemini/SEC bodies have byte caps, readers retain at most 4,096 chunks, and complete SEC lookup maps retain at most 25,000 keys. Invalid or oversized ticker input is never admitted partially. Required provider source text is checked before shared filtering, so one malformed result cannot erase another provider's usable evidence. Existing successful paid-secondary eligibility, source order and ranker remain intact; exhausted paid variants use already configured free evidence without another paid retry.
- Finite provided source scores keep their actual value within 0–100; missing/nonfinite source scores stay absent and genuine model confidence 0 stays 0. Source quality and the existing readiness calculation are heuristics/provided scores, not calibrated certainty. Provider-reported token counts remain; JSON/SSE and Attrition report total cost as `null` / `not_measured`. The cost-requiring evaluator and promotion are explicitly skipped instead of recording a fabricated zero. Shared cost schema/archive and envelope/asset identities are unchanged.

**Evidence state**:
- Same frozen 46-scenario public-route harness on Windows Node 22.22.2/npm 10.9.7, Vitest 3.2.7 and unchanged application manifest/lock: canonical `643d705d` baseline 2 PASS / 44 FAIL; final candidate on `b46bfec9` 46 PASS / 0 FAIL. The latter main update changes only an orphan Git index entry and its existing cleanup lane; all Pipeline/runtime/graph inputs stay identical. Final runner binds 17 source/graph hashes before and after. Harness SHA256 `66EF3539A6C35E4495AE56EC5407625A1BA747F20DB2728FAEF9FEDEFD535C5F`; final raw JSON SHA256 `4940F6C1645EE090B92187234EF2CDE507FA1C165D991A5473382B578B712B3C`.
- Actual provider-fixture cascade: baseline 57,026 ms completed without a terminal failure; candidate 55,002 ms ends with `TIMEOUT` and zero active work. Separate 60,018 ms paced observation: 54 requests, 18 malformed inputs return 502, 36 valid/stall-recovery requests return 200, no fixture errors, zero active work and bounded existing context cache. Twelve concurrent mixed requests pass. These are bounded local observations, not a speedup, SLA or lifetime memory certificate.
- Five selected regression suites pass 25/25, including five new-only provider-alias/cache cases plus the explicit browser SSE-error case. Production search bundle and Vite build pass; existing Vite native-config and PostCSS warnings remain. Root `tsc --noEmit` exits 0 but its reference-only configuration does not typecheck the application; the new HTTP helper's strict check passes. Full worker strict baseline reached its 90-second limit without diagnostics and remains NOT_VERIFIED. SQLite evaluator/archive tests are NOT_RUN under the explicitly script-disabled install; route persistence/evaluation boundaries are mocked before imports.
- Local source is pending publication and automatic CI. Six relevant suites were added to the existing required Runtime smoke list without changing its gate/install policy. The local npm 10 proof differs from declared npm 11.5.2. No real provider, backend, deployed endpoint, Golden quality, UI/SEO, all-checks-green or production security claim is made. An explicit received SSE error avoids the browser's legacy JSON retry; untouched pre-header 503 fallback may still retry. Earlier V3/V5 proof attempts are retained as confounded; the V4 single-stage budget fixture is superseded by the final real-clock V6 comparison.

**Reproduction**: `npx vitest run workers/node/pipelineRoute.test.ts workers/node/pipeline/searchPipeline.test.ts workers/node/searchPipelineStateToResultPacket.test.ts workers/node/streamingSearchRoute.test.ts apps/web/src/hooks/useStreamingSearch.test.ts apps/web/src/features/controlPlane/components/proofModel.test.ts` after installing this checkout's locked dependencies. Fixtures run the actual public JSON/SSE routes with external provider responses and persistence mocked; this command makes no live-provider claim.

**Named proof**: `PIPELINE-HONEST-FAILURE-01`.
**Author**: Homen Shum + Codex.

## 2026-10-07 — Replace the provider HTTP dependency path with a measured transport

A developer fetching source material needs private-address blocking and streaming
behavior preserved when replacing a vulnerable HTTP dependency. Add a parent-scoped
Undici 6.29.0 override for the existing provider-utils range, retain locked
provider-utils 3.0.41 and all 233 application ranges, and keep the exact comparison
harness at `scripts/provider-http-compat.mjs`. This removes the old production
Undici/Busboy path; the remaining findings still need separate repairs.

**PR / canonical main commit**: #644 / `PENDING MAIN SHA / FINAL QA`.

**Evidence state**:
- External matched study: the same frozen harness `5D30EE0091F1A1799971C038BE693EF1352372F65D18F70A2309CF5964820292` ran on the actual original and replacement graphs with Linux Node 22.22.2/npm 11.5.2. Each returned 49 PASS / 0 FAIL / 1 NOT_VERIFIED. Real consumer-relative Undici changed from 5.29.0 to 6.29.0; the provider-utils 3.0.41 module stayed byte-identical. All 30 default DNS negative cases retained zero socket/global-wrapper calls; direct local transport, 12-client burst and one 60-second paced rejection/recovery observation passed on both graphs.
- Dependency comparison: 2,452 to 2,451 lock records, with 2,449 unchanged. Root Undici changes; an existing development Vercel/blob copy deduplicates; Busboy 2.1.1 becomes development-only through unchanged Vercel/node. Production audit findings change from 29 to 21, HIGH 11 to 9. Full findings change from 57 to 51, with HIGH 27 and CRITICAL 2 unchanged. All four audit processes exit 1; the remaining OSS Stats/Pi-AI and development findings are unresolved.
- Source boundary: the external images compile pinned `0f5b3cc9e2403a1bbcb1df841ec5b39a7ddecd3f`. This adoption starts from the normally integrated local source `25b6a1698ef717fd3c8f680de1d92a93ec4c49d8`; the copied manifest/lock/harness are exact studied bytes, but combined-source automatic CI and final main QA remain pending. Earlier lane entries retain their original observation dates and source scopes.
- Limits: the Undici major override is outside provider-utils' declared `^5.29.0` dependency range and is qualified to the observed 3.0.41/Node 22.22.2 graph. Default guarded public success is NOT_VERIFIED; direct localhost, custom-fetch and trusted-origin positives do not replace that proof. No provider-backed Golden result, deployment, strict application typecheck (`build:voice` uses `--noCheck`), performance/SLA, lifetime memory or whole-application security claim is made.
- External receipts: `NODEBENCH-PROVIDER-HTTP-SECURITY-STUDY-20261007.json`, SHA256 `E7F6816ECE5F0894FFCAFC36A61058779D3D1246D4AA57EB7A7200D9CE9AC17F`; independent study judge `74FB808A4A6D5075C42E2068656A0242C4D4EB475546E539AC88A1E9E074BB0B`; root acceptance `NODEBENCH-PROVIDER-HTTP-SECURITY-INDEPENDENT-ROOT-20261007.json`, SHA256 `774C44F7ED95E8F0F4DEFD195E0AFB8FBF2FB5E51ED5AE47E55D3D0063B59914`.

**Reproduction**: [`Provider HTTP compatibility without credentials`](../../docs/runbooks/PIPELINE_QUALITY_BENCHMARK.md#verify-provider-http-compatibility-without-credentials).
**Author**: Homen Shum + Codex.

## 2026-10-07 — Align the worker release contract with its pinned runtime

A release operator needs the compiler and runtime to share the supported Node
image. The container repair in #644 uses one digest-pinned base, but its existing
release test still required two independent Node 20 stages. Read the declared
Node major from `.nvmrc`, require a version and digest pin, and require both
stages to inherit the shared base. Existing compile, production-install, asset,
credential-exclusion and emitted-ESM checks remain unchanged.

**PR / canonical main commit**: #644 / `PENDING MAIN SHA / FINAL QA`.

**Evidence state**:
- Before: automatic Linux Runtime smoke on `0f5b3cc9e2403a1bbcb1df841ec5b39a7ddecd3f` passes 405/406 regressions; the stale stage assertion fails and dependent Build is skipped.
- Comparison: the same 14 existing source-contract scenarios on Windows Node 22.22.2 and the unchanged existing Vitest 4.1.11 graph change from 13 pass/1 fail to 14 pass/0 fail, with no skips. Removing the image digest or making runtime use an independent image still fails the intended existing case. Both counterexamples affect only an isolated source copy.
- Source review: independent root verification binds all 24 raw artifacts, 135 source inputs and the exact two assertion substitutions. Dockerfile, application manifest and packaging lock remain unchanged. Proof: `NODEBENCH-PR644-RELEASE-CONTRACT-01`.
- Limits: this local graph differs from the packaging lock and Linux Vitest 3 graph; exact updated-source automatic CI is pending. Existing Vite configuration warnings remain. No timing improvement, security pass, provider/Golden result, deployment or UI change is claimed. The separate HTTP dependency study has not been adopted.

**Reproduction**: `npx vitest run scripts/__tests__/releaseWorkflowContracts.test.ts --reporter verbose` after installing the reviewed checkout's dependencies. This command does not itself certify container startup.

## 2026-10-07 — Verify the standalone worker's clean build inputs

A developer starting the standalone worker needs the committed dependency
inputs and actual compiled startup, rather than a frontend build. This local
packaging candidate restores the root lock, shares supported Node 22/npm 11.5.2
and the public peer policy, removes the missing patch-script copy, promotes
the existing dotenv range to runtime dependencies and excludes credential
files from cloud context. The worker entrypoint, routes and all 233 declared
version ranges remain unchanged.

**PR / canonical main commit**: `PENDING MAIN SHA / FINAL QA`.

**Evidence state**:
- Source at local-proof capture: local worktree candidate on baseline `e2e82cafe7619e5ea986cb883601f2bca1c4b073`; not committed, published or merged. All six packaging/helper source files match the independently reviewed candidate; only this lane and the existing runbook record observed outcomes.
- Checks: current-manifest npm 11.5.2 lock generation and `npm ci --dry-run` pass. The first Docker attempt could not reach the Linux engine; after recovery, the actual unchanged clean-source build exits 1 because `package-lock.json` and `scripts/patch-crons-exports.mjs` are absent at `COPY`. The repaired native Linux/amd64 image builds and runs the compiled worker with Node v22.22.2/npm 11.5.2. Local proof `NODEBENCH-PIPELINE-CLEAN-BUILD-01` passes: actual Docker network `none`, empty mounts/host-port bindings, only seven expected public environment-variable names, HTTP200 root/MCP/Pipeline health, 573 registered tools, Linkup/Gemini configuration false, 12 concurrent plus 20 repeated empty-query HTTP400s, malformed JSON HTTP400 and zero sessions. These 33 rejections completed in 94 ms, a burst/repeated observation. A separate 60,005 ms paced stability observation in the same image retained healthy responses and zero sessions across 61 invalid HTTP400 requests and 13 recovery snapshots; it does not certify a production SLA or long-term memory behavior. Both owned worker containers were stopped normally.
- Security limit: install audit reports 29 production vulnerabilities (7 low, 11 moderate, 11 high) and 57 full-build vulnerabilities (7 low, 21 moderate, 27 high, 2 critical). Separate audit-only proof `PIPELINE-LOCK-AUDIT-01` used the same image/lock and public npm registry on Docker network `bridge`, ran no worker and exited 1 with the same 29 production findings (zero critical). No dependency update or security pass is claimed; no baseline installed graph existed for a vulnerability comparison. This registry diagnostic is separate from the worker containers' network isolation.
- Visual proof: not applicable; no UI change.
- Preview: not recorded; no deployment.
- Production live: not verified; no worker URL, provider-backed golden result or all-green certificate.

**Author**: Homen Shum + Codex.
**Runbook**: [`Clean container prerequisite`](../../docs/runbooks/PIPELINE_QUALITY_BENCHMARK.md#verify-the-clean-container-prerequisite).

## 2026-07-16 - Ground chat follow-ups in bounded receipt context

The pending candidate extends redesign chat runs with optional, sanitized conversation
turns and a parent receipt hash. The live action includes this transcript as context while
requiring factual claims to be re-grounded, and public hash receipts redact the private
continuation fields. See [`../pages/redesign-chat.md`](../pages/redesign-chat.md).

## 2026-07-15 — Derive pipeline ownership on the server

The pending candidate removes browser-selected `ownerKey` authority from public pipeline launch, history, detail, bundle, stream, scorecard, and schedule APIs. Cost-bearing single and composed launches and all schedule controls now require an authenticated server identity. Guest history, detail, bundle, stream, and evaluation reads require an anonymous-session possession credential; schedule changes verify row ownership, public responses omit owner keys, and cron or secret-gated MCP work uses explicit internal service contracts. Legacy anonymous schedules do not execute.

Durable per-owner admission allows four launch units per ten minutes and thirty per day; composed runs consume two units and scheduled launches consume quota. Specs, titles, and model IDs are bounded to 4,000, 120, and 160 characters, and each owner may keep at most twenty schedules. The scorecard reports recorded `verifiedShare` instead of fabricated verdict accuracy or Brier calibration, costs are labeled as estimates, streamed-output controls appear only for an active or recorded stream, and schedule copy distinguishes hourly polling, next-run time, and a run that actually started.

Force-fresh launches now mint a unique logical attempt before the durable workflow starts. Workflow retries retain that attempt and an execution-generation fence, while each recurring schedule occurrence derives its attempt from the schedule id plus the exact due `nextRunAt`. Overlapping sweeps dedupe the same occurrence and compare-and-set advancement prevents cadence skips. A terminal retry clears stale completion, error, token, output, step, stream, and generated-document state before incrementing its generation; stale generations and overlapping workflows cannot mutate the active row.

Research bundles and Workspace documents now distinguish `sourcesConsulted` from `citationsUsed`. Only in-range `[N]` markers that actually appear in the synthesis bind a citation. Zero-source, unbound-source, non-canonical, or out-of-range citation states deterministically prevent a `verified` verdict and land on `needs_review`, regardless of a model's requested tier.

**PR / canonical main commit**: #541 / `15eb9a0a`; strict session rollout #542 / `16d3ceeb`; live-verifier alignment #543 / `56d8413a`.

**Evidence state**:
- Source: merged to `main` through CI-gated squash PRs #541, #542, and #543.
- Checks: required Typecheck, Runtime smoke, Build, and Tier B checks passed on all three PRs; source CI `29474652151`, strict-rollout CI `29475282082`, and verifier CI `29475698322`.
- Visual proof: private responsive/theme artifacts remain outside git; the production exact/mobile/product/one-flow matrix passed all 17 assertions, with one blank mobile navigation transient passing on immediate isolated rerun.
- Preview: #541 exact-head preview `nodebench-2otgtyneq-hshum2018-gmailcoms-projects.vercel.app` passed Tier B run `29474652192`; #542 preview `nodebench-iwmpxngv3-hshum2018-gmailcoms-projects.vercel.app` passed `29475281999`.
- Production live: Vercel main deploy verification run `29475582335` and Convex deploy `29475582657` passed for strict SHA `16d3ceeb`; canonical `https://www.nodebenchai.com` passed the runtime-grounded production matrix and automated Post-Deploy Verify run `29476029941`.

**Author**: Homen Shum + Codex.
**Touches**: [`../pages/exact-cockpit.md`](../pages/exact-cockpit.md), [`../pages/agents.md`](../pages/agents.md), and [`../components/fast-agent-panel.md`](../components/fast-agent-panel.md).

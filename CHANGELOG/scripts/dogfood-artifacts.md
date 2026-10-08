# Dogfood artifact capture

## 2026-10-07 — Close the observed-state capture repair

A PR reviewer can distinguish an observed guest state from research that was never submitted. PR #652 merged the reviewed capture repair; its canonical source tree exactly matches the tested nine-file candidate.

**PR / canonical main commit**: [#652](https://github.com/HomenShum/NodeBenchAI/pull/652) / `92969cfe5aed32ba23151f4d09abf045ac81918b`.

**Evidence state**:
- Source: merged; canonical tree `f18f03d87577008edc3577fd4d77f5d03d159d10` matches reviewed head `6aaf21eca2f68e74775e5b277e3453879a16b0a2`.
- Checks: that PR head settled at **16 success, 1 skipped, 1 failure, 0 pending**. Visual QA Gate, Typecheck, Runtime smoke and Build passed. Pipeline quality benchmark failed because `https://scratchnode.live` exceeded the 65,536-byte response cap; no golden queries were evaluated. The failure was preserved.
- Visual proof: the prior entry records the seven Before/seven After PNGs, nine Scribe steps, ten settled frames, 23/23 integrity checks and one missing-composer knockout. Generated captures were excluded from the commit.
- Preview: fixed local guest proof completed; owned previews stopped.
- Production build identity: Production deployment `6929128872` succeeded at `2026-10-08T06:49:19Z`. A bounded unauthenticated GET of `https://www.nodebenchai.com/` at `06:49:46–06:49:47Z` returned HTTP 200 and raw `nodebench-build-sha` exactly matching the canonical commit. This verifies build identity, not a new authenticated workflow or a whole-app grade.

A separate new-main snapshot contained 14 check runs: **8 success, 4 Dependabot failures, 2 pending** (Pipeline benchmark and post-deploy verification), with an additional successful Vercel status. This snapshot is distinct from the settled PR results and does not establish all-CI-green. Live research and saved-report reopening remain **NOT_RUN**.

**Author**: Homen Shum + Codex.

## 2026-10-07 — Verify truthful guest captures

A PR reviewer can now tell which guest state was observed and which research action was not performed. A fresh seven-image baseline reproduced the light settings screenshot mislabeled as dark; the repaired gallery records light from the actual page attribute. Nine Scribe steps and ten settled video frames now describe ready entries, an unsubmitted question, the actual theme toggle, and Saved research instructions without claiming a completed answer or reopened report.

**PR / canonical main commit**: `PENDING MAIN SHA / FINAL QA` — this source candidate is uncommitted.

**Evidence state**:
- Source: pending against `b46bfec9950a2dc9e203303f6b492a03af4099fa`; public UI behavior is unchanged.
- Checks: Before and After Vite builds and the targeted guest scenario passed. The After artifact-integrity gate passed **23/23**. One isolated missing-composer knockout passed by requiring a clear rejection instead of a preparation caption.
- Visual proof: all seven Before and seven After PNGs, nine After Scribe PNGs, and ten time-linked After video frames were viewed. Desktop `1440×900` and phone `390×844` captures cover both themes; the MP4 is included. Old Scribe/video comparison still uses the immutable historical artifact below, not a local rerun of their sign-in attempts.
- Preview: `http://127.0.0.1:5177`; owned previews were stopped and the port was released after all three roles.
- Production live: **NOT_RUN**.

Live research and saved-report reopening remain **NOT_RUN** with explicit causes. These results prove the recorded guest states and capture integrity, not an authenticated workflow, full video playback or decoded duration, keyboard/tablet coverage, a visual grade, or a whole-app score. Unchanged Vite and PostCSS build warnings remain recorded separately.

**Author**: Homen Shum + Codex.

## 2026-10-07 — Prepare truthful guest captures

A developer reviewing a PR needs to distinguish a ready workspace from research that actually finished. The capture sources previously skipped obsolete controls but still described live answers and reopened saved reports as complete; the gallery also inferred the wrong theme from a filename, and video frames used navigation times on a delayed clock.

The prepared repair shares current guest observations between Scribe and video, requires the current composer controls, records live research and saved-report reopening as **NOT_RUN** with their causes, and captures composer preparation under its own name. Screenshot metadata comes from the actual theme attribute and viewport. Video chapters expose a settled sample time, and extraction uses that time. The gate checks artifact integrity without claiming a visual grade or completed research; CI includes the promised video. Existing minimum counts and public UI behavior are unchanged.

**PR / canonical main commit**: `PENDING MAIN SHA / FINAL QA` — no PR or commit created for this candidate.

**Evidence state**:
- Source: prepared, uncommitted against `b46bfec9950a2dc9e203303f6b492a03af4099fa`.
- Checks: **NOT_RUN**. Source review is required before runners, build, browser, or dependency preparation.
- Visual proof: before evidence is the immutable native artifact `11526629677` from run `37725161656`; the new local guest capture and missing-composer knockout are prepared, **NOT_RUN**.
- Preview: **NOT_RUN**.
- Production live: **NOT_RUN**.

The fixed comparison captures the same public UI before and after. It does not run the old Scribe/video sign-in attempts; their before evidence remains the already-reviewed native artifact. Live answer, saved-report reopening, keyboard, tablet, provenance, and production claims remain separate unverified work.

**Author**: Homen Shum + Codex.

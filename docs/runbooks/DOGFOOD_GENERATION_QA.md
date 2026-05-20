# Dogfood Generation QA

## Goal

Make every product dogfood loop auditable as a retained generation:

- each strict QA run has a stable generation archive
- screenshots, video frames, walkthrough video, scribe states, Gemini judge output, and agentic evidence are retained together
- the latest run is compared against the previous run, ten-run window, oldest retained generation, and best retained generation
- the last ten runs also have immediate predecessor deltas so regressions are visible as a sequence
- release status is explicit and based on real issues, not only build success

## Commands

Run the full first-class gate:

```bash
npm run dogfood:qa:first-class
```

Rebuild only the retained ledger and archive from the latest existing dogfood artifacts:

```bash
npm run dogfood:qa:ledger
```

Verify retained evidence without recapturing:

```bash
npm run dogfood:verify:first-class
```

## Outputs

- `public/dogfood/qa-generation-ledger.md`
- `public/dogfood/qa-generation-ledger.json`
- `public/dogfood/generations/index.md`
- `public/dogfood/generations/index.json`
- `public/dogfood/generations/gen-*/summary.md`
- `public/dogfood/generations/gen-*/summary.json`

Each generation archive retains:

- public screenshot captures
- extracted video frames
- scribe step screenshots
- walkthrough video
- Gemini screen and video judge outputs
- agentic interaction screenshots
- JSON manifests used to reproduce the run

## Evidence Model

The archive is organized around a before, during, and after triad:

- Before: static route screenshots before interaction playback
- During: walkthrough video, extracted frames, scribe steps, and agentic interaction screenshots
- After: Gemini judge output, issue triage, and final ledger state

Large volatile videos are copied only when they are already retained under `public/dogfood` or fit the script's size policy. Oversized `.tmp` videos are recorded in the archive manifest with an explicit skip reason instead of silently bloating git history.

## Release Interpretation

Build success is necessary but not sufficient.

The ledger marks the current run as:

- `release-clean` when the latest retained run has no real issues and no critical issues
- `release-risk` when any real issue remains

That means a run can pass typecheck, build, artifact validation, and Gemini execution while still being blocked by interaction or UX findings.

# Dogfood QA Generation Ledger

Generated: 2026-05-20T07:54:50.941Z

Git: `main` at `d89d654f` (upstream `d89d654f`)

Dirty checkout: yes (106 paths)

## Latest Status

Latest generation: **gen 100**

Score: **93 / A**

Real issues: **6** (0 critical, 6 warning, 0 info)

Release interpretation: **release-risk** - Latest retained run has 6 real issue(s), 0 critical, and 6 warning(s).

## Retained Archive

Archive sequence: **100**

Archive path: `public/dogfood/generations/gen-0100-20260520T073019Z-d89d654f`

Copied evidence files: **81**

## Generation Comparisons

| Comparison | Baseline Gen | Baseline Score | Latest Score | Score delta | Issue delta | Critical delta | Warning delta |
| --- | --- | --- | --- | --- | --- | --- | --- |
| previous_run | 99 | 92 | 93 | +1 | +4 | -1 | +5 |
| ten_run_window | 91 | 93 | 93 | 0 | 0 | 0 | +1 |
| twenty_five_run_window | 76 | 97 | 93 | -4 | +5 | 0 | +5 |
| oldest_retained_generation | 1 | 90 | 93 | +3 | -5 | -4 | +4 |
| best_retained_generation | 98 | 100 | 93 | -7 | +6 | 0 | +6 |

## Delta Chain

| Run | Gen | Baseline Gen | Score | Score delta | Issue delta | Critical delta | Warning delta |
| --- | --- | --- | --- | --- | --- | --- | --- |
| gen_100_vs_previous | 100 | 99 | 93 | +1 | +4 | -1 | +5 |
| gen_99_vs_previous | 99 | 98 | 92 | -8 | +2 | +1 | +1 |
| gen_98_vs_previous | 98 | 97 | 100 | +3 | -1 | 0 | -1 |
| gen_97_vs_previous | 97 | 96 | 97 | 0 | 0 | 0 | 0 |
| gen_96_vs_previous | 96 | 95 | 97 | 0 | -2 | 0 | -2 |
| gen_95_vs_previous | 95 | 94 | 97 | +4 | +2 | -1 | +3 |
| gen_94_vs_previous | 94 | 93 | 93 | -3 | 0 | 0 | 0 |
| gen_93_vs_previous | 93 | 92 | 96 | -4 | +1 | +1 | 0 |
| gen_92_vs_previous | 92 | 91 | 100 | +7 | -6 | 0 | -5 |
| gen_91_vs_previous | 91 | 90 | 93 | -4 | +5 | 0 | +4 |

## Last Ten Generations

| Gen | Timestamp | Score | Grade | Real Issues | Critical | Warning | Model |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 2026-05-20T07:30:19.634Z | 93 | A | 6 | 0 | 6 | gemini-3-pro-preview |
| 99 | 2026-05-20T01:14:31.630Z | 92 | A | 2 | 1 | 1 | gemini-3-pro-preview |
| 98 | 2026-04-22T22:51:25.650Z | 100 | A | 0 | 0 | 0 | gemini-3-pro-preview |
| 97 | 2026-04-22T22:15:10.476Z | 97 | A | 1 | 0 | 1 | gemini-3-pro-preview |
| 96 | 2026-04-22T20:42:24.539Z | 97 | A | 1 | 0 | 1 | gemini-3.1-pro-preview |
| 95 | 2026-04-22T19:17:39.638Z | 97 | A | 3 | 0 | 3 | gemini-3-pro-preview |
| 94 | 2026-04-22T17:06:34.269Z | 93 | A | 1 | 1 | 0 | gemini-3.1-pro-preview |
| 93 | 2026-04-22T16:27:52.308Z | 96 | A | 1 | 1 | 0 | gemini-3.1-pro-preview |
| 92 | 2026-04-22T15:45:36.906Z | 100 | A | 0 | 0 | 0 | gemini-3.1-pro-preview |
| 91 | 2026-04-22T15:13:06.052Z | 93 | A | 6 | 0 | 5 | gemini-3.1-pro-preview |

## Current Real Issues

- P2 Left sidebar accordions trigger unexpected chat navigation instead of expanding (home)
- P2 Expandable card fails to open (inbox)
- P2 Accordion section fails to expand (inbox)
- P2 Map tab click navigates to Sources (report-notebooknb)
- P2 Loading failure in Briefing agent sidebar (home)
- P2 Tabs fail to load content (workspace)

## Evidence Artifacts

| Artifact | Exists | Bytes | Updated |
| --- | --- | --- | --- |
| `public/dogfood/manifest.json` | yes | 3589 | 2026-05-20T07:12:20.872Z |
| `public/dogfood/walkthrough.json` | yes | 1426 | 2026-05-20T07:12:54.906Z |
| `public/dogfood/walkthrough.mp4` | yes | 756581 | 2026-05-20T07:12:54.861Z |
| `public/dogfood/frames.json` | yes | 1965 | 2026-05-20T07:12:56.414Z |
| `public/dogfood/scribe.json` | yes | 2567 | 2026-05-20T07:12:33.544Z |
| `.tmp/dogfood-gemini-qa/video-qa.json` | yes | 3486 | 2026-05-20T07:29:06.508Z |
| `.tmp/dogfood-gemini-qa/screens-qa.json` | yes | 47872 | 2026-05-20T07:29:47.107Z |
| `.tmp/dogfood-gemini-qa/agentic-results.json` | yes | 3902 | 2026-05-20T07:28:17.458Z |
| `.tmp/dogfood-gemini-qa/qa-loop-context.json` | yes | 56433 | 2026-05-20T07:30:19.678Z |
| `.tmp/dogfood-gemini-qa/agentic-session.webm` | yes | 36245303 | 2026-05-20T07:22:47.995Z |

## Interpretation

This ledger makes each dogfood run comparable as a retained generation. Use it after `npm run dogfood:verify:strict` or `npm run dogfood:loop` to compare the current run against the previous run, a ten-run window, the oldest retained generation, and the best retained generation.

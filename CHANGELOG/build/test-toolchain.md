# Test and component-preview toolchain

Append-only lane for the test runner, Storybook component discovery, and their
shared build checks. Newest entries first.

## 2026-10-08 — Record matched toolchain checks and isolate Storybook PWA hooks

Developers can retain the authored component catalog without making Storybook
precache the application's service worker. The preview now uses the installed
`withoutVitePlugins` helper to remove the five reviewed PWA hooks only inside
Storybook. Application Vite configuration, PWA behavior and Workbox limits are
unchanged.

**PR / canonical main commit at proof capture time**: `PENDING — local proof; not published`. The publication PR will be recorded separately.

**Matched local evidence**: baseline and candidate source were anchored at
`b46bfec9950a2dc9e203303f6b492a03af4099fa`, using normal npm 11.5.2 installs and
Windows x64 Node 22.22.2. Original runs and failed outputs are preserved.

**Contributor prerequisite**: use Node 22 for the test and component-preview
toolchain. The four subordinate packages retain their existing
`engines.node: >=18.0.0` runtime declarations; this contributor prerequisite
does not change their advertised runtime support.

| Check | Baseline | Candidate / repaired preview |
| --- | --- | --- |
| Selected Vitest scenarios | 3.2.7: 406/406 PASS in 28 files | 4.1.11: 406/406 PASS in the same 28 files |
| Actual App compiler (`tsc -p tsconfig.app.json --noEmit`) | FAIL: exit 2, 5,380 diagnostics | FAIL: exit 2, 5,380 diagnostics |
| Normal application build | PASS: exit 0 | PASS: exit 0 |
| Original Storybook build | 9.1.20: FAIL at inherited PWA precache limit | 10.6.1 before isolation: FAIL at the same PWA limit |
| Original authored-index observer | FAIL: empty index, zero stories | PASS: exactly 51 stories and 5 docs |
| Repaired Storybook 10.6.1 build | Not a baseline rerun | PASS: exit 0; 2,177 modules transformed; receipt `B1872E0B…` |
| New authored-index observer | Not a baseline rerun | NOT_RUN: first controller stopped at the 6 GiB free-memory gate before observer launch |

The repaired build's 25,489-byte index has SHA256
`FC268A2C188220E752C887E7F77C7C680D47C9F1621667D43DBF65CF46C648A4`,
identical to the prior candidate index that the unchanged 51-story/5-doc
observer validated. This is reused byte evidence; the repaired build has no
new native observer receipt or `storybook-proof.json`. The memory budget was
not changed and the observer was not retried.

The repaired build used a fresh source role with the existing normal candidate
graph. Its raw streams completed, source/index/dependency guards matched before
and after, and `registerSW.js`, `manifest.webmanifest` and `sw.js` were absent
from the Storybook output. Native application `vite.config.ts` remains
SHA256 `1663AF9AE78D5666F05B339175B3AB335353D6237801911E15CB8913B64B963A`.

Existing MDX-pattern, large-chunk and future Vite-loader warnings remain in the
logs; the repaired run also reports plugin callback timings. These results do
not establish a speed improvement, an App typecheck pass, rendered pixels,
responsive/interaction/accessibility grades, Linux CI success or a deployment.
The first new index controller stop is preserved separately from the successful
build; no observer phase streams were produced.

**Author**: Homen Shum + Codex.


## 2026-10-07 — Align the test runner and retain component examples

Prepare Vitest 4.1.11 and the seven existing Storybook packages at 10.6.1 on
current main so developers can use a supported Vite 8 combination without
losing authored examples. Correct the moved story paths, retain prior test
exclusions, isolate the preview from app environment files, and add the bounded
51-story/5-autodoc identity check to the existing Build job.

**PR / canonical main commit**: `PENDING #NNN MAIN SHA / FINAL QA`.

**Evidence state**:
- Source at preparation capture: local candidate on baseline `b46bfec9950a2dc9e203303f6b492a03af4099fa`;
  the existing root lock is deliberately unchanged pending the separate resolver
  gate. The proposed package versions are not yet a resolved or tested graph.
- Checks: not run on this candidate. Baseline core run
  [37723399071](https://github.com/HomenShum/NodeBenchAI/actions/runs/37723399071)
  passed 20 workflow-event scenarios, 406 Vitest cases in 28 files, 37 launch
  cases and build on Node 22.23.3/npm 10.9.9. These are a reference, not matched
  npm 11.5.2 before/after results. Both baseline Pipeline runs
  [37723579209](https://github.com/HomenShum/NodeBenchAI/actions/runs/37723579209)
  and [37723725858](https://github.com/HomenShum/NodeBenchAI/actions/runs/37723725858)
  failed health preflight after 11 contract cases; zero Golden queries ran.
- Security: current Undici/UUID overrides and dependency placement are preserved.
  Advisory improvement and the complete candidate graph remain unverified.
- Visual proof: not recorded. A built index is not a rendered interaction or
  responsive/accessibility grade.
- Preview: not recorded.
- Production live: not recorded; no deployment is part of this slice.

**Author**: Homen Shum + Codex.

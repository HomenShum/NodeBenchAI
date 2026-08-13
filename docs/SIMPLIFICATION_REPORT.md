# SIMPLIFICATION REPORT

Every number below was produced by running the command in its row, twice: once
on a clean `git clone --depth 20` of `main` before any edit, and once on the
same tree after. Where a tool does not fit this stack, the row says so instead
of guessing.

Baseline commit: `f0b17fc` ("Gate the Convex setup door on validity, not
presence"). Machine: Windows 11, Node 22, `npm install --no-audit --no-fund`.

**The optimization target was concepts removed, not lines.** This repository is
about a million lines of production source; shaving lines off it would be
theatre. What a new engineer actually pays for is the number of things they must
hold in their head — dependencies, npm scripts, lifecycle hooks, files that
appear in search results but are dead. Those are what moved.

---

## The table

| Measure | Before | After | Change | Evidence command |
|---|---:|---:|---:|---|
| Production files | 3,241 | 3,227 | −14 | `git ls-files 'apps/*' 'backend/*' 'shared/*' 'workers/*' 'packages/*' 'api/*' 'services/*' 'mcp-services/*' 'middleware.ts' \| grep -E '\.(ts\|tsx\|js\|jsx\|mjs\|cjs)$' \| grep -vE '(\.test\.\|\.spec\.\|\.stories\.\|/tests?/\|/__tests__/\|/__mocks__/)' \| wc -l` |
| Production source lines | 1,037,982 | 1,036,216 | −1,766 | same file list piped through `xargs wc -l`, summing the `total` rows |
| Direct dependencies | 246 | 232 | **−14** | `node -e "const p=require('./package.json');console.log(Object.keys(p.dependencies).length+Object.keys(p.devDependencies).length)"` |
| — of which runtime deps | 185 | 172 | −13 | same, `p.dependencies` |
| — of which devDeps | 61 | 60 | −1 | same, `p.devDependencies` |
| npm scripts | 200 | 198 | −2 | `node -e "console.log(Object.keys(require('./package.json').scripts).length)"` |
| npm lifecycle hooks | 1 (`postinstall`) | 0 | **−1** | `node -e "console.log(Object.keys(require('./package.json').scripts).filter(s=>/^(pre\|post)?(install\|pack\|publish\|prepare)$/.test(s)))"` |
| Unused files (Knip) | 926 | 912 | −14 | `npx knip --no-exit-code --reporter json > k.json` then `node -e "console.log(require('./k.json').files.length)"` |
| Unused exports (Knip) | 991 | 991 | 0 | same JSON, summing `issues[].exports` |
| Unused types (Knip) | 908 | 908 | 0 | same JSON, summing `issues[].types` |
| Unused dependencies (Knip) | 52 | 39 | **−13** | same JSON, summing `issues[].dependencies` |
| Duplicate blocks (jscpd) | 2,486 | 2,480 | −6 | `npx jscpd apps/web/src backend/convex shared workers packages --ignore "**/*.test.ts,**/*.test.tsx,**/*.spec.ts,**/node_modules/**,**/_generated/**"` |
| Duplicate percentage (jscpd) | 3.76% | 3.76% | 0 | same command, `Total` row |
| Circular dependencies | 1,196 | 1,196 | 0 | `npx madge --circular --extensions ts,tsx --ts-config tsconfig.json apps/web/src` (602) + `npx madge --circular --extensions ts --ts-config tsconfig.json backend/convex` (594) |
| Circular dependencies (dependency-cruiser) | — | — | — | **not applicable — see "dependency-cruiser does not fit this stack" below** |
| Canonical workflow tests | exit 1 · app segment 22 failed / 1,426 passed / 20 skipped | exit 1 · app segment 22 failed / 1,426 passed / 20 skipped | **0 new failures** | `npm run test:run` |
| Typecheck | **not re-measured in this pass** — `promotion/PROMOTION_LOG.md` records exit 2 / 5,383 errors at the Wave 1 baseline | exit 2 · **5,378** errors | no delta claimed | `npx tsc -p tsconfig.app.json --noEmit --pretty false 2>&1 \| grep -c "error TS"` |
| Browser workflow passes | not run — needs a Convex deployment | not run — same reason | — | `npx playwright test evals/e2e/one-flow-regression.spec.ts` (requires `VITE_CONVEX_URL`) |
| Production bundle size | exit 0 · PWA precache 338 entries / 22,522.18 KiB | exit 0 · PWA precache 338 entries / **22,522.06 KiB** | −0.12 KiB | `npm run build` |
| CodeTour steps resolving | n/a (no tours existed) | 27 / 27 | +27 | `node scripts/validate-tours.mjs` |
| Additions/deletions | — | — | 34 files, +1,700 / −1,885 | `git diff --shortstat` |


**On the unused-files arithmetic:** 926 − **15** deleted + **1** added = 912.
The one added is `scripts/validate-tours.mjs`, the CodeTour validator, which
Knip reports as unused because nothing imports it — it is a command-line entry
point. It is named in `docs/codebase/TESTING.md` and in all three tour
descriptions, and it is deliberately **not** wired to a 199th npm script in a
repository whose script count is itself a documented problem (CONCERNS C5).

**On the typecheck row specifically:** the "before" figure is quoted from an
earlier wave, not produced by this pass, so the five-error difference is not
offered as a result — a number measured before the change it is used to justify
proves nothing. What *is* this pass's measurement is the after figure: exit 2,
5,378 errors, 4,637 of them `TS2339`, 4,361 error lines containing `never`,
first error `apps/web/src/App.tsx(88,20)`. That profile matches the known
`ApiFromModules` cause exactly (CONCERNS C1), which is the useful conclusion.

---

## dependency-cruiser does not fit this stack

The gate names `dependency-cruiser` for the circular-dependency row. It was
tried four ways and the row is recorded as **not applicable** for a specific,
reproducible reason rather than left blank:

- Given a **directory** (`apps/web/src`), it reports "1 modules, 0 dependencies
  cruised" on Windows — it never walks the tree.
- Given the **entry file** (`apps/web/src/main.tsx`) with no config, it resolves
  78 modules and then stops: every `@/…` import fails, because this repo's path
  aliases are declared in `vite.config.ts` and `tsconfig.json`, and
  dependency-cruiser reads webpack or tsconfig, never a vite config.
- Adding `tsConfig: { fileName: "tsconfig.json" }` makes it **worse** (14
  modules) — with a tsConfig set, even sibling `./App` fails to resolve.
- Its `enhancedResolveOptions` schema rejects an `alias` key
  (`data/options/enhancedResolveOptions must NOT have additional properties`),
  so the aliases cannot be supplied directly.

Making it work would require adding a webpack config to the repository purely to
feed a measurement tool — a new config file, i.e. exactly the kind of concept
this pass exists to remove. `madge --ts-config tsconfig.json` resolves the
aliases correctly and walks 3,020 + 1,741 files, so it is used for that row and
the deviation is recorded here.

The finding it produced stands either way: **1,196 circular import chains**, and
nothing in CI forbids them. That is logged as CONCERNS C3, unresolved.

---

## What was deleted

**Thirteen runtime dependencies that nothing imports.** Verified twice — Knip's
report, then a literal `git grep` for `from "<pkg>"`, `require("<pkg>")` and
`import("<pkg>")` across every `.ts/.tsx/.js/.jsx/.mjs/.cjs` file, which returned
zero hits for each:

`@ai-sdk/provider`, `@convex-dev/crons`, `@lexical/history`, `@lexical/html`,
`@lexical/utils`, `@remotion/player`, `ag-grid-community`, `ag-grid-react`,
`discord-interactions`, `install`, `react-data-grid`, `reactflow`, `tavily-mcp`.

`install` is worth naming on its own: it is the npm package literally called
`install`, the classic residue of a mistyped `npm install install`.
`discord-interactions` appears only in two *comments* describing an approach the
code took instead.

**One devDependency that this pass made dead:** `lighthouse`. It existed for the
`perf:lighthouse` script, which was already broken — it ended in
`&& node analyze-lighthouse.cjs`, and that file does not exist in the
repository. Removing the broken script left the dependency with no consumer.
Pruning it removed **78 packages** from `node_modules`.

**The `postinstall` hook and the script it ran.**
`scripts/patch-crons-exports.mjs` (71 lines) ran on every single `npm install`
to patch the `exports` field of `@convex-dev/crons` — a package that
`backend/convex/convex.config.ts` never registers and no module imports. A
lifecycle hook is the most expensive kind of concept in a repository, because it
runs for everyone, silently, forever. This one existed to maintain a dependency
that was not used.

**Fourteen unreferenced source files** under `apps/web/src`. Selection rule,
stated so it is checkable: a file qualified only if Knip listed it as unused
**and** a repo-wide `git grep -F` for its module basename returned no hit in any
other tracked file. Of Knip's 532 unused files under `apps/web/src`, exactly 20
passed both checks; six of those were kept because they are real —
`vite-env.d.ts` is an ambient TypeScript declaration and five `*.stories.tsx`
are discovered by Storybook's glob rather than by import. The other 14 went:
`hooks/useAgentStateApi.ts`, `hooks/useMousePosition.ts`,
`hooks/useUnifiedItems.ts`, `lib/llmProvider.ts`, `types/wx-react-gantt.d.ts`
(an ambient declaration for a package that is not installed),
`shared/components/PillAction.tsx`, `shared/ui/AnimatedNumber.tsx`,
`shared/ui/AnimatedProgressBar.tsx`,
`features/chat/components/EntityDisambiguationCard.tsx`,
`features/entities/hooks/useCanonicalFastLane.ts`,
`features/graph/lib/graphTypes.ts`,
`features/onboarding/utils/dossierParser.ts`,
`features/redesign/hooks/useLongHorizonRetrospectiveSwr.ts`,
`features/research/components/MorningBriefingHeader.tsx`.

**One duplicated script.** `evals/linkupSmoke.js` was a CommonJS transcription of
`evals/linkupSmoke.mjs` — same twenty lines, `require` instead of `import`. The
repository declares `"type": "module"`, so the `.js` copy could not have run.

**One accidentally committed file.** A zero-byte file whose name was a mangled
Windows path (`C:UsershshumAppDataLocalTempchat-diff.txt`) sitting in the
repository root.

---

## Custom code replaced by an existing capability

One, and it is the `postinstall` case above: a 74-line hand-written patch script
maintaining a dependency the platform never loaded. The replacement was not a
library — it was deletion. That is the correct top rung of the reuse ladder:
*does this need to exist at all.*

Nothing else was replaced. Two candidates were examined and rejected on purpose:

- **The hand-rolled SSE parse loop** in `chatRuns.ts` (reader, decoder, manual
  `\n` scan) duplicates what the installed `ai` SDK does. Replacing it is a
  rewrite of the one path every answer flows through, on a repo whose test suite
  is already red — that is feature-shaped risk wearing a cleanup costume. Logged,
  not done.
- **The `*Swr` hook pairs** duplicate Convex's own reactive `useQuery`. Both
  variants have live callers, so this is a behavioural fork, not dead code.
  Merging them changes what renders during loading, which is externally
  observable. Logged as CONCERNS C6; it needs a characterization test on the
  loading states before anyone touches it.

---

## Findings left unresolved, with the reason

| Finding | Size | Why it was left |
|---|---|---|
| `tsc -p tsconfig.app.json` red | 5,378 errors | One upstream cause: Convex's `ApiFromModules` over ~1,537 backend modules exceeds a TypeScript type-level limit, `api` collapses to `never`, and 4,637 `TS2339`s cascade from it. The fix is a backend module-count or codegen change — a system change, out of scope for a reduction pass, and explicitly excluded by the brief. CONCERNS C1. |
| 912 files reported unused | 912 | Knip cannot see dynamic imports, string-built paths, or platform entry points (`api/*.js` are Vercel functions, Convex modules are invoked by the platform). Separating dead from platform-invoked needs per-file judgement; only the 14 that failed **two independent checks** were deleted. CONCERNS C2. |
| 991 unused exports, 908 unused types | 1,899 | Same reason, at higher volume and lower per-item value. Removing an export is a public-API change to modules that other packages in this repo consume; without a per-package API surface definition, a bulk pass would break consumers silently. CONCERNS C2. |
| 1,196 circular imports | 1,196 | Breaking a cycle means moving code, which is a structural refactor of paths with no characterization tests. Rule 2 of the gate says the test comes first. CONCERNS C3. |
| Test suite red in 3 of 4 segments | 27 assertion failures + 1 timeout | Pre-existing, and the app segment's failing set is byte-identical before and after this pass. Fixing them is triage work, not reduction work, and mixing the two would make it impossible to tell which change caused what. CONCERNS C4. |
| 198 npm scripts | 198 | Only two could be *proven* stale by static means (a referenced file that does not exist). A script that runs but does the wrong thing is undetectable without executing all 198, several of which deploy or call paid APIs. CONCERNS C5. |
| `package-lock.json` is gitignored | — | Committing a lockfile changes what every contributor's `npm install` resolves. That is a policy decision for the maintainer, not a cleanup. CONCERNS C5b. |
| 2,480 duplicate blocks (3.76%) | 3.76% | Below the threshold where mechanical deduplication pays for itself, and the blocks are spread across 3,636 files rather than concentrated. CONCERNS C7. |
| Product defects D1, D3 | — | D1 (no product route without a Convex cloud deployment) needs a backend, which this pass may not create. D3 (graph rail dies at zero viewport and never recovers) is a behaviour fix, not a structural one. Both stay in `promotion/PROMOTION_LOG.md`. |

---

## Behavior preservation — how it was checked, not asserted

1. **Build.** `npm run build` exits 0 before and after; PWA precache stays at 338
   entries and moves 0.12 KiB, which is the deleted source, not a bundle change.
   The removed dependencies were never bundled, because nothing imported them.
2. **Dependency removal was verified against a pruned tree.** `npm install` was
   re-run after editing `package.json` so `node_modules` actually lost the 22 +
   78 packages before the build and tests were re-measured. Otherwise the build
   would have passed on packages that were still on disk.
3. **Tests.** `npm run test:run` before and after. Rather than compare counts,
   the `FAIL` lines were extracted, ANSI-stripped, sorted and diffed:

   ```bash
   npm run test:run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -o "FAIL.*" | sort -u
   ```

   The app segment's 22 failures and the convex-mcp segment's 5 are
   **byte-identical** before and after. The `mcp-local` segment differs, and the
   honest reading of that is in CONCERNS C4: it is killed by a 300-second
   timeout, so its failure list is truncated at a different point each run. It
   was additionally checked directly — no test in that package asserts on
   anything this pass touched, and the three files that changed there
   (`index.ts`, `metaTools.ts`) were re-run green apart from three failures
   present in the baseline.
4. **The one behavioural edit** was removing the `perf:lighthouse` npm script.
   Three strings in `packages/mcp-local` told users to run it; all three were
   updated in the same change, so the MCP server no longer advertises a command
   that does not exist. That is a defect fix with its cause named, not a silent
   removal.

---

## What this pass did not attempt

Reducing a million-line repository to a comprehensible one is not a one-pass
job, and pretending otherwise would be the dishonest version of this document.
What was done is the subset that is *provably* safe: things with zero references
by two independent methods, and machinery maintaining something that does not
exist. The large findings — 912 unused files, 1,899 unused exports, 1,196
cycles — are measured, reproducible, and left with their reasons, so the next
person starts from a number rather than an impression.

# TESTING — what to run, what it proves, and what is already red

## The four commands you actually need

```bash
npx vitest run <path>          # one file, fast — this is your inner loop
npm run test:run               # the full suite, four segments, ~8 minutes
npx playwright test evals/e2e/<spec>.spec.ts   # browser + a configured Convex deployment
node scripts/validate-tours.mjs                # START_HERE.md and .tours/ cite the right lines
```

The last one is the only one that needs neither an install nor a backend, which
is why CI runs it before `npm install`. It asserts each citation matches the
text it names, not merely that the line number is in range — a range check
passes a citation that has drifted onto a different symbol, which is the
failure it exists to prevent.

## The suite is segmented, and that is deliberate

`npm run test:run` is `node scripts/testing/runSegmentedVitest.mjs`, which runs
four independent Vitest processes and gives **each one a 300-second wall clock**:

| Segment | Scope | Command it shells out to |
|---|---|---|
| `app-vitest` | `apps/web/src` and `backend/convex` | `npm run test:run:app` |
| `mcp-local-vitest` | `packages/mcp-local` | `npm --prefix packages/mcp-local test` |
| `convex-mcp-vitest` | `packages/convex-mcp-nodebench` | `npm run test:run:convex-mcp` |
| `openclaw-mcp-vitest` | `packages/openclaw-mcp-nodebench` | `npm run test:run:openclaw-mcp` |

The segmentation exists because one flat run exceeds the budget. The 300-second
timeout is a hard kill, which matters for reading results: a segment can be
reported "failed" because it was **killed**, not because an assertion failed.
`mcp-local-vitest` is currently in exactly that state.

## Current state — measured, not assumed

`npm run test:run` at the commit carrying this document:

| Segment | Result | Detail |
|---|---|---|
| `app-vitest` | **failed** | 22 failed / 1,426 passed / 20 skipped (208 files) |
| `mcp-local-vitest` | **failed** | killed by the 300 s timeout; its reported failure list is truncated and differs run to run |
| `convex-mcp-vitest` | **failed** | 5 failed / 58 passed |
| `openclaw-mcp-vitest` | passed | 30 passed |
| overall | **exit 1** | |

**Read this before you panic about a red suite you did not cause.** The set of
22 failing app tests is stable — re-running before and after an unrelated change
produces a byte-identical list. Diff the `FAIL` lines rather than counting them:

```bash
npm run test:run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -o "FAIL.*" | sort -u > after.txt
diff before.txt after.txt
```

That diff is the honest regression check in this repo. A changed *count* in the
`mcp-local` segment usually means the timeout landed in a different place, not
that you broke something.

## Where tests live

- **Unit and contract tests sit next to their source.** `foo.ts` →
  `foo.test.ts`. There is no `__tests__` mirror tree in the web app (the MCP
  packages do use one).
- **Browser tests live in `evals/e2e/*.spec.ts`.** `playwright.config.ts` points
  `testDir` there, defaults `baseURL` to `http://localhost:5173`, and gives each
  test 30 seconds.
- **`convex-test`** is installed for exercising Convex functions in-process.

## The tests that hold the canonical flow

These are the ones to run when you touch chat. They are listed with what each
would catch, because a test name alone does not tell you that.

| File | Catches |
|---|---|
| `apps/web/src/lib/convexUrl.test.ts` | The setup door accepting a placeholder URL again, which mounts the app against a dead socket with no remedy on screen |
| `apps/web/src/features/redesign/hooks/useRedesignChatRun.test.ts` | A tier the backend does not accept; a non-unique idempotency key (double-charge); a malformed answer projection |
| `backend/convex/domains/redesign/chatRuns.contract.test.ts` | The answer packet dropping a required field or leaking a forbidden one — driven through the **real** runtime functions, so the contract cannot silently disagree with the code |
| `backend/convex/domains/redesign/chatRuns.responseShape.test.ts` | Compact answers rendering as full ones |
| `apps/web/src/features/redesign/lib/oneSurfaceRouting.test.ts` | A second reachable destination appearing next to `/redesign/chat` |
| `evals/e2e/redesign-runtime-route-ownership.spec.ts` | One user reading another user's run |
| `evals/e2e/one-flow-regression.spec.ts` | The surface failing to render end to end |

## Browser checks need a running app

Playwright talks to `BASE_URL` (default `http://localhost:5173`). Start the
frontend with `npx vite --port 5173` first. Specs that exercise a signed-in
product journey additionally need a configured Convex deployment — without one
they hit the "Convex backend not configured" card, which is why
`promotion/PROMOTION_LOG.md` records four of five product journeys as
**UNVERIFIED** rather than passing or failing.

## Repository-specific rules worth keeping

- **Add the characterization test before the refactor**, not after. The suite is
  red enough that "it still passes" is not a signal unless you diffed the
  failure list.
- **Scenario over unit.** The existing contract tests are written as a persona
  driving a real constraint (see the header comment in
  `chatRuns.contract.test.ts`). Match that.
- **A weakened assertion is a defect.** If you edit an expected value, the
  justification must trace to a spec or a measurement, and the old value should
  stay in a comment so the change is auditable.

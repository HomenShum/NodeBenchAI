# CONVENTIONS — the patterns that are real, and the ones that only look real

Every rule below is one you can check with a command. Where a convention is
inconsistently followed, that is said out loud rather than described as a
standard.

## Naming

| Kind | Convention | Example |
|---|---|---|
| React component file | `PascalCase.tsx`, one main export | `apps/web/src/features/redesign/surfaces/ChatSurface.tsx` |
| Hook | `useThing.ts`, exports `useThing` | `apps/web/src/features/redesign/hooks/useRedesignChatRun.ts` |
| Convex module | `camelCase.ts` under `backend/convex/domains/<area>/` | `backend/convex/domains/redesign/chatRuns.ts` |
| Unit test | sits **next to** the file it tests, `*.test.ts(x)` | `apps/web/src/lib/convexUrl.test.ts` |
| Browser test | `evals/e2e/*.spec.ts` | `evals/e2e/one-flow-regression.spec.ts` |
| Path alias | `@/` = `apps/web/src`, `@convex/` = `backend/convex`, `shared/` = `shared` | declared in `tsconfig.json` **and** `vite.config.ts` |

A test file's suffix tells you which runner owns it: `.test.ts` → Vitest,
`.spec.ts` under `evals/e2e` → Playwright.

## Convex function kinds — the prefix tells you who may call it

This is the most load-bearing convention in the repo:

- `query` / `mutation` / `action` — **public**. Any signed-in browser can call
  them. Treat every argument as hostile.
- `internalQuery` / `internalMutation` / `internalAction` — **not reachable from
  any client.** Only other Convex functions, the scheduler, cron, or a CLI call
  with a deploy key.

So `startChat` is a `mutation` and validates identity; `runStreamingChat` is an
`internalAction` and does not, because nothing outside the server can reach it.
If you change one of those keywords you have changed the security boundary.

## Validation

Arguments are declared with Convex's `v.*` validators in the `args` block. That
declaration **is** the schema — the platform rejects a bad call before your
handler runs. Do not add a second hand-written check for the same field
underneath; enforce a rule once, at the layer that owns it.

Business rules that validators cannot express (identity, quota, ownership) go in
small named helpers at the top of the module: `requirePaidChatUserId`,
`assertRunReadable`. Those names are the convention — a reader should be able to
tell from the call site what is being asserted.

## Comments

The house style is: **a comment explains why a line exists, and cites the
measurement or defect that forced it.** Real examples in the tree:

```ts
// Validity, not presence. A non-empty but non-deployment URL (the value
// .env.example ships) used to pass this gate and leave the app rendered with a
// dead socket. See apps/web/src/lib/convexUrl.ts.
```

```ts
// BUG FIX (2026-07-01): `userLoading` means the account's eligibility check hasn't
// resolved yet ... See docs/LIVE-USER-BENCHMARK-FINDING.md.
```

Follow it. A comment that restates the code is noise; a comment naming the
production incident that produced the branch is the reason the branch survives
review.

## Error handling

- Server-side: `throw new Error("<sentence a user could read>")`. Those strings
  reach the UI, so they are written for a person, not a log grep.
- The one sentinel string in the chat path is `"RUN_CANCELLED"`, which the catch
  block tests for by exact value to distinguish "the user stopped it" from "it
  broke". Adding another sentinel means adding another branch to that catch —
  prefer a status field on the row.
- Client-side: `ErrorBoundary` wraps each top-level route in `App.tsx`.

## TypeScript settings you will trip over

`tsconfig.app.json` sets `"strict": true` but `"noImplicitAny": false`. Implicit
`any` is therefore legal, and the Convex handlers use `ctx: any` in several
helpers. This is a real, deliberate looseness, not an oversight — but it means
the compiler is not protecting you as much as `strict` suggests.

`tsc -p tsconfig.app.json` is **red at HEAD** for a known, separate reason. See
CONCERNS.md before you spend an afternoon on it.

## Conventions that are aspirational, not enforced

State plainly, because believing these are enforced will mislead you:

- **No import-direction rule.** Nothing stops a feature importing another
  feature, or the browser importing from `backend/convex` beyond the generated
  API. Measured result: 1,196 import cycles (CONCERNS.md).
- **No dead-code gate.** 926 files are reported unused by `npx knip` and nothing
  in CI fails because of it.
- **`domains/` is not a layer.** It is a flat folder of ~70 product areas with no
  allowed-dependency rules between them.
- **npm scripts are not curated.** There are ~198 of them. Assume any script you
  did not just run may be stale.

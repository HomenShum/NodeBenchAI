# CONCERNS — what is known-broken, known-messy, or known-unverified

Every item here has a reproduction. A hunch is not a concern. Severity is the
effect on **a new engineer trying to work here**, which is not always the same
as the effect on a user.

Product-facing defects live in `promotion/PROMOTION_LOG.md` and are referenced by
their ledger id (D1–D4) rather than restated.

---

## C1 — CRITICAL for a new engineer: `tsc` is red, and it is not your fault

**Reproduce**

```bash
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

Exit code 2. Thousands of errors, the overwhelming majority `TS2339`
("property does not exist"), with the word `never` in most of the message lines.
Exact counts at the commit carrying this file are in
`docs/SIMPLIFICATION_REPORT.md`.

**Cause.** Convex generates `api` from every module under `backend/convex`
through `ApiFromModules`. That type instantiation exceeds a TypeScript
type-level limit at this module count — around 1,537 modules fails, around 1,515
is fine, so roughly twenty more modules tipped it. The `api` object collapses to
`never`, and every `api.domains.x.y` reference in the app then reports
"property does not exist". One upstream failure, thousands of downstream
symptoms.

**Why it is not being chased here.** The fix is a backend module-count or
codegen change, which is a system change, not a cleanup. It was explicitly out
of scope for this pass.

**What you must know anyway:** `npm run build` exits **0**. Vite does not
typecheck. So a red typecheck is invisible to anyone who only builds, and
`npm run lint` — which does run `tsc` — will fail for you on day one for reasons
unrelated to your change. Do not spend an afternoon on it. This is
`promotion/PROMOTION_LOG.md` defect **D2**.

---

## C2 — MAJOR: 912 files are reported unused, and nothing fails because of it

**Reproduce**

```bash
npx knip --no-exit-code --reporter json > knip.json
node -e "const j=require('./knip.json');console.log(j.files.length)"
```

**What it means for you.** When you search for a component and find three
plausible matches, two of them are probably dead. There is no gate that fails on
dead code, so the count only grows.

**What was verified rather than assumed.** knip cannot see dynamic imports or
string-built paths, so its list is an upper bound, not a verdict. Cross-checking
knip's 532 unused files under `apps/web/src` against a plain text search for each
file's basename left only **20** files with no reference of any kind. Of those,
`vite-env.d.ts` is a TypeScript ambient declaration and five `*.stories.tsx` are
discovered by Storybook's glob — both are real, both look dead to a static
analyser. The remaining 14 were deleted (see `docs/SIMPLIFICATION_REPORT.md`).

**So the honest statement is:** most of the 912 are probably dead, a knowable
minority are platform entry points (`api/*.js` are Vercel functions,
`middleware.ts` is Vercel edge middleware, Convex modules are invoked by the
platform), and separating them requires per-file judgement that no tool in this
stack does for you.

---

## C3 — MAJOR: 1,196 import cycles, and no rule against them

**Reproduce**

```bash
npx madge --circular --extensions ts,tsx --ts-config tsconfig.json apps/web/src    # 602
npx madge --circular --extensions ts   --ts-config tsconfig.json backend/convex    # 594
```

**Why it matters to a reader specifically.** A cycle has no first file. When you
ask "what runs first here", a cycle means there is no answer, and module
initialisation order becomes something you discover by running rather than by
reading.

**Why nothing prevents it.** There is no dependency-direction lint. Nothing stops
a feature importing another feature, or a shared module importing back into a
feature.

**Note on tooling:** `dependency-cruiser` is the tool the gate names, and it
does not fit this stack — see the row in `docs/SIMPLIFICATION_REPORT.md` for the
exact failure. `madge` resolves the repo's `@/` aliases correctly and is used
instead.

---

## C4 — MAJOR: the test suite is red at HEAD, in three of four segments

`npm run test:run` exits 1. Exact per-segment counts are in
`docs/codebase/TESTING.md`. Two properties matter more than the counts:

- The **app segment's** 22 failures are a **stable set** — re-running before and
  after an unrelated change produced a byte-identical `FAIL` list.
- The **`mcp-local` segment is killed by a 300-second timeout**, not by an
  assertion. Its reported failure list is therefore truncated and differs between
  runs. Comparing counts across runs of that segment will mislead you; diff the
  `FAIL` lines instead.

A red suite is a real concern because it destroys the signal a suite exists to
give. Treat "no new `FAIL` lines" as the working regression check until the
existing failures are triaged.

---

## C5 — MAJOR: 198 npm scripts, unknown proportion stale

`node -e "console.log(Object.keys(require('./package.json').scripts).length)"`

Two were found pointing at files that do not exist. One (`perf:lighthouse`) was
removed along with its now-dead `lighthouse` devDependency and the three places
in `packages/mcp-local` that told users to run it. The other
(`start:voice` → `dist/workers/node/index.js`) is legitimate — that path is a
build output.

**The residual risk:** a script that *runs* but does the wrong thing is not
detectable this way. Assume any script you did not personally just run may be
stale, and prefer the four commands listed at the top of
`docs/codebase/TESTING.md`.

---

## C5b — MODERATE: `package-lock.json` is gitignored

`.gitignore:47` excludes `package-lock.json`. A fresh `npm install` therefore
resolves versions itself, and two people cloning on different days can get
different trees for the same commit. Every caret range in `package.json` — and
almost all of them are carets — is a place that can drift.

This matters for the cold reader specifically: "it works on my machine" and "it
works at this commit" are not the same statement here, and a reproduction that
depends on a transitive version cannot be reproduced from the repository alone.

---

## C6 — MODERATE: duplicated `*Swr` hooks, left in place deliberately

`apps/web/src/features/redesign/hooks/` contains pairs like
`useTodayPulse.ts` / `useTodayPulseSwr.ts`, `useTopForecasts` / `useTopForecastsSwr`,
`useEditionFootnotes` / `useEditionFootnotesSwr`, and four more.

This is suspicious on its face — a Convex `useQuery` is already a live
subscription, so a stale-while-revalidate variant is duplicating a platform
capability. **But both variants have live callers** (`EditorialHomeSurface.tsx`
uses several of each), so this is not dead code; it is a real behavioural fork.

Left unresolved on purpose: merging them changes what renders during loading,
which is externally observable behaviour, and this pass was not allowed to
change behaviour that has not been proven a defect. Resolving it needs a
characterization test on the loading states first.

---

## C7 — MODERATE: 3.76% duplicated lines, 2,480 clone blocks

```bash
npx jscpd apps/web/src backend/convex shared workers packages \
  --ignore "**/*.test.ts,**/*.test.tsx,**/*.spec.ts,**/node_modules/**,**/_generated/**"
```

3.76% is not alarming in isolation. It is listed because the absolute count
(2,480 blocks) means that when you find a helper, there is a real chance a
near-copy exists elsewhere. Search before you write — that is the cheapest
version of the reuse ladder.

---

## C7b — MAJOR for a new engineer: the product is unobservable until you stand up a Convex deployment, and the door has three locks, not one

This is the first thing that will happen to you, so it is the first thing you
should read. Every product route renders **"Convex backend not configured"**
until `VITE_CONVEX_URL` points at a real deployment. That is by design — this
repo keeps all durable state in Convex and ships no local substitute — but
until 2026-08-14 the setup instructions covered one of the three things you
actually need, and the other two failed in ways that do not name themselves.

**Reproduce the working path** (needs a Convex account and a Gemini key; the
full version with the traps is `docs/START_HERE.md` → "Before Step 1"):

```bash
npx convex dev --once --configure new --project <yours> --team <yours>
npx @convex-dev/auth                       # JWT_PRIVATE_KEY + JWKS + SITE_URL
npx convex env set GEMINI_API_KEY -- "<key>"
npx vite --port 4902 --strictPort --host 127.0.0.1
node scripts/capture-live-journey.mjs --port 4902     # drives J1/J2/J4, costs model calls
```

The three locks, in the order they bite:

1. **A missing transitive dependency stops the first push.**
   `@erquhart/convex-oss-stats@0.8.2` imports `@convex-dev/crons/convex.config`
   and declares it in neither `dependencies` nor `peerDependencies`. With
   `package-lock.json` gitignored (C5b), a fresh install can land a tree without
   it and `convex dev` dies on `Could not resolve
   "@convex-dev/crons/convex.config"`. Fixed by declaring `@convex-dev/crons`
   directly; if you see this again, that is what regressed.
2. **A missing OPTIONAL model key used to fail the ENTIRE deploy.** Convex
   analyses every backend module on every push.
   `domains/agents/core/coordinatorAgent.ts` builds `DEFAULT_MODEL`
   (`kimi-k2.6`, OpenRouter) at module scope, and `buildLanguageModel` threw at
   construction when `OPENROUTER_API_KEY` was unset — so the push failed with
   `InvalidModules: Failed to analyze domains/agents/digestAgent.js` and you got
   no backend at all, for a provider `/redesign/chat` never calls. The error now
   lives on `doGenerate`/`doStream` instead, so an unconfigured provider fails
   the call that needs it rather than the deploy.
   Gated by `backend/convex/domains/agents/mcp_tools/models/modelResolver.test.ts`.
3. **Convex Auth needs its own keys, and nothing on screen says so.** Without
   `JWT_PRIVATE_KEY`/`JWKS`, sign-in throws `Missing environment variable
   'JWT_PRIVATE_KEY'` from the server. You cannot skip this: live research
   rejects anonymous accounts (`requirePaidChatUserId`,
   `backend/convex/domains/redesign/chatRuns.ts:159`), so the journey is
   unreachable signed out.

**What it costs you if you skip it.** Nine of the twelve promotion conditions
are judged on what a browser shows. Tests and typecheck tell you nothing about
them. See `promotion/PROMOTION_LOG.md` iteration 2.

---

## C8 — Documented product defects, not restated here

`promotion/PROMOTION_LOG.md` carries the reproductions:

- **D1** — no product route works without a Convex cloud deployment; there is no
  offline or fixture backend for the product surfaces. **Closed 2026-08-14** as
  a *blocker*: with a deployment the journeys run end to end
  (`promotion/evidence/live-journey/report.json`). The dependency itself is not
  a defect, it is the architecture; the setup path is C7b above.
- **D2** — the red typecheck (C1 above).
- **D3** — the graph rail dies permanently if mounted at zero viewport width
  (collapsed drawer, `display:none` tab) and never recovers without a reload.
- **D4** — `npm run dev` blocks on interactive credentials; the frontend-only
  path is now documented in the README.

As of 2026-08-14, **J1, J2 and J4 are driven end to end** against a live
deployment by `node scripts/capture-live-journey.mjs`; J3 (inline correction) and
the product half of J5 are still UNVERIFIED. Read UNVERIFIED literally — it does
not mean they work, it means nobody has watched them.

---

## What is deliberately *not* listed

Subjective style, speculative abstractions, and low-value code compression. If
something bothers you but you cannot write its reproduction, it belongs in a
review comment, not here.

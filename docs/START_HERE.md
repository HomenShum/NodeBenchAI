# START HERE — one question, followed all the way down

You have never seen this repository. Somebody types a question into NodeBench,
presses Enter, and an answer streams back with sources under it. This page walks
that one action through the code **in the order the machine runs it**, not in
the order an architecture diagram would draw it.

Read it top to bottom once. Then open `.tours/` in VS Code (CodeTour extension)
and walk the same path inside the real files — the tour points at live source,
so it cannot go stale the way a copied snippet can.

**The gate this page answers to** is the shared HUMAN-READY gate, kept in one
place and never restated here:
<https://raw.githubusercontent.com/HomenShum/NodeKit/main/templates/promotion/HUMAN_READY.md>

---

## Before Step 1 — can you even run it?

```bash
nvm use                      # Node version from .nvmrc
npm install
npx vite --port 5173         # frontend only — this is the honest local start
```

Open <http://localhost:5173/redesign/chat>.

You will see a card that says **"Convex backend not configured."** That is the
designed state, not a bug. NodeBench keeps every piece of durable state — users,
chat runs, reports, entities — in **Convex**, a hosted backend that this repo
does not ship a local substitute for. Without a deployment URL there is no
database, so there is no product.

To get past that card you need `VITE_CONVEX_URL` pointing at a real Convex
deployment. Everything from Step 3 down needs that backend. Steps 1–2 you can
read and run without it.

Do **not** start with `npm run dev`. That command runs three processes in
parallel and two of them block on credentials you may not have. See
`docs/codebase/CONCERNS.md`, defect D4.

### Standing the backend up — the whole list, in order

This is the part that used to be missing, and it is the reason nine of the
twelve promotion conditions sat at UNVERIFIED: **you cannot observe anything
below Step 2 without doing this.** It needs a Convex account and a Gemini API
key. There is no offline, fixture, or local-backend substitute in this repo.

```bash
npx convex dev --once --configure new --project <yours> --team <yours>
#   provisions an isolated DEV deployment and writes CONVEX_DEPLOYMENT,
#   VITE_CONVEX_URL and VITE_CONVEX_SITE_URL into .env.local (gitignored).

npx @convex-dev/auth
#   generates JWT_PRIVATE_KEY + JWKS and sets SITE_URL on that deployment.
#   Without them every sign-in fails with
#   "Missing environment variable `JWT_PRIVATE_KEY`" and no journey can run,
#   because live research refuses anonymous callers (Step 5).

npx convex env set GEMINI_API_KEY -- "<your key>"
#   Step 7 calls Gemini directly. Without this the run fails at the model call.

npx vite --port 4902 --strictPort --host 127.0.0.1
```

Two traps that cost real time here, so they are written down rather than
rediscovered:

- **`@erquhart/convex-oss-stats` imports `@convex-dev/crons` without declaring
  it.** `package-lock.json` is gitignored (CONCERNS C5b), so a fresh
  `npm install` can resolve a tree where that transitive package is absent and
  the very first push dies with
  `Could not resolve "@convex-dev/crons/convex.config"`. It is now a direct
  dependency for exactly this reason.
- **A missing OPTIONAL model key used to break the whole deploy.** Convex
  analyses every backend module on every push, and
  `domains/agents/core/coordinatorAgent.ts` builds `DEFAULT_MODEL`
  (`kimi-k2.6`, an OpenRouter model) at module scope. Building a model for an
  unconfigured provider threw *at construction*, so `convex dev` failed with
  `InvalidModules: Failed to analyze domains/agents/digestAgent.js` unless you
  had an OpenRouter account — even though `/redesign/chat` never touches
  OpenRouter. `modelResolver.ts` now defers that error to the call that needs
  the key. You do **not** need `OPENROUTER_API_KEY` to run the primary journey.

### Proving it, without trusting this page

```bash
node scripts/capture-live-journey.mjs --port 4902
```

That drives J1 (ask → stream → answer with sources), J2 (open the permanent
receipt link cold and get the same answer, proven by the latest-run id being
unchanged) and J4 (cancel, honest terminal state, keep working) in a real
browser at 1280 and 375, and reads the durable rows back out of Convex. It
writes `promotion/evidence/live-journey/report.json` plus eight screenshots, and
exits nonzero if any of it stops being true. **It costs real model calls.**

---

## Step 1 — The browser loads the app and decides whether the backend is usable

**File:** `apps/web/src/main.tsx`
**Symbol:** module top level → `createRoot(...).render(...)`
**Called by:** the browser, via `<script type="module" src="/src/main.tsx">` in `apps/web/index.html`
**Calls next:** `configuredConvexUrl()` in `apps/web/src/lib/convexUrl.ts`, then `<App />`

**Why this exists**
This is the only place in the app that decides "do we have a backend at all."
The person here is a developer or a first-time visitor whose environment may be
half-configured. The failure this prevents is the ugliest kind: the app looks
like it loaded, the user types a question, and nothing ever comes back because
the socket underneath was pointed at a host that does not exist. So the check
tests the URL for **validity**, not merely for presence.

**Core code**

```tsx
// apps/web/src/main.tsx:156
const convexUrl = configuredConvexUrl();
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;
```

**Input** — `import.meta.env.VITE_CONVEX_URL`, a string or undefined.
**Output** — either a live `ConvexReactClient` wrapped in `<ConvexAuthProvider>`,
or `null`, in which case `MissingConvexUrlScreen` renders instead of the app.
**Failure behavior** — a missing *or* structurally invalid URL renders the setup
card with copy-paste remediation. Nothing partially mounts.
**Next** — with a client, React Router hands the path to `App` in Step 2.

---

## Step 2 — The path `/redesign/chat` resolves to the one canonical surface

**File:** `apps/web/src/App.tsx`
**Symbol:** `App`
**Called by:** `main.tsx` render tree
**Calls next:** `RedesignShell` (`apps/web/src/features/redesign/RedesignShell.tsx`)

**Why this exists**
NodeBench deliberately has **one** working surface, not five. Home, Reports,
Inbox and Me are states of the same conversation, reached with `?intent=`, not
separate destinations. `App` is a plain if-ladder over `location.pathname` — there
are no `<Route>` elements anywhere in this codebase, which is worth knowing
before you go looking for them.

**Core code**

```tsx
// apps/web/src/App.tsx:209
const isRedesignRoute = location.pathname === "/redesign" || location.pathname.startsWith("/redesign/");
if (isRedesignRoute) {
  return (<ThemeProvider><ErrorBoundary title="Something went wrong">
    <Suspense fallback={<ViewSkeleton />}><RedesignShell /></Suspense>
  </ErrorBoundary></ThemeProvider>);
}
```

**Input** — the current URL from `useLocation()`.
**Output** — a lazily-imported `RedesignShell` inside an error boundary.
**Failure behavior** — any render error below this point is caught by
`ErrorBoundary` and shown as "Something went wrong" rather than a white page.
`RedesignShell` then normalises legacy paths (`/redesign/reports` →
`/redesign/chat?intent=reports`) so only one URL shape survives.
**Next** — the shell renders `ChatSurface`, where the user actually types.

---

## Step 3 — The user types a question and presses Enter

**File:** `apps/web/src/features/redesign/components/UniversalComposer.tsx`
**Symbol:** `handleSubmit`
**Called by:** the composer's form submit and Enter key handler
**Calls next:** `sendMessage` in `ChatSurface.tsx` (passed in as the `onSubmit` prop)

**Why this exists**
This is the primary user action of the whole product. The composer owns exactly
two decisions: is there any text, and is a previous answer still streaming. It
does not know what a run is.

**Core code**

```tsx
// apps/web/src/features/redesign/components/UniversalComposer.tsx:248
const handleSubmit = (mode: ComposerMode = "research") => {
  const trimmed = text.trim();
  if (!trimmed || streaming) return;
  if (mode === "chat" && onChatNow) { onChatNow(trimmed, tier); }
  else { onSubmit?.(trimmed, tier, mode); }
  setText("");
};
```

**Input** — the textarea contents and the selected speed tier
(`free | fast | auto | deep | answer | compare`).
**Output** — one call to the parent's `onSubmit(text, tier, mode)`.
**Failure behavior** — empty input and mid-stream input are dropped silently;
this is a guard, not an error path.
**Next** — `ChatSurface.sendMessage` in Step 4.

---

## Step 4 — The surface decides whether a live run is even allowed, and paints the optimistic turn

**File:** `apps/web/src/features/redesign/surfaces/ChatSurface.tsx`
**Symbol:** `sendMessage`
**Called by:** `UniversalComposer` `onSubmit`, the starter chips, and the
regenerate button
**Calls next:** `chatRun.submit(...)` from `useRedesignChatRun`

**Why this exists**
Live research costs money, so it requires a real signed-in account. The failure
this prevents is a user typing a question, seeing a spinner, and getting silence
because their session was anonymous. Instead the assistant bubble is filled
immediately with a plain-English reason.

**Core code**

```tsx
// apps/web/src/features/redesign/surfaces/ChatSurface.tsx:637
const sendMessage = (text: string, submittedTier: RouterTier) => {
  const canRunLiveChat = chatRun.state.available && !_skipLiveSeed;
  // ... push the user turn + an assistant turn (thinking, or the reason it can't run)
  if (canRunLiveChat) {
    void chatRun.submit(text, submittedTier, contextRef, pinnedClaims, conversationContext, parentRunHash);
  }
};
```

**Input** — the prompt text, the tier, and the surface's own state (auth,
pinned claims, prior turns, the currently open report as `contextRef`).
**Output** — two new turns appended to local state, and at most one call to
`submit`.
**Failure behavior** — when a live run is not allowed, an assistant turn is
still appended carrying the specific reason (still loading / not signed in /
anonymous account). No network call is made.
**Next** — `useRedesignChatRun.submit` in Step 5.

---

## Step 5 — Input becomes trusted: validation and the durable run identity

**File:** `backend/convex/domains/redesign/chatRuns.ts`
**Symbol:** `startChat` (a public Convex `mutation`)
**Called by:** `useRedesignChatRun.submit` (`apps/web/src/features/redesign/hooks/useRedesignChatRun.ts:501`)
**Calls next:** `ctx.scheduler.runAfter(0, internal…chatRuns.runStreamingChat, …)`

**Why this exists**
This is the trust boundary. Everything above it is browser state a user can
edit; everything below it is server-owned. Three things happen here and nowhere
else: the caller is proven to be a non-anonymous account, the prompt is bounded
and length-checked, and the submission is made **idempotent** — a `clientRequestId`
that has already been seen returns the original `runId` instead of starting a
second paid run. That is the guard against a double-click costing twice.

The argument shapes are declared with Convex's `v.*` validators in the `args`
block, so a malformed call is rejected by the platform before the handler runs.
Those validators *are* the domain types for this path — there is no separate
schema layer.

**Core code**

```ts
// backend/convex/domains/redesign/chatRuns.ts:1492
const prompt = args.prompt.slice(0, MAX_PROMPT_CHARS);
if (prompt.trim().length < 3) throw new Error("Prompt too short — write at least a 3-character question.");
const userId = await requirePaidChatUserId(ctx);          // line 159: rejects anonymous accounts
const clientRequestId = args.clientRequestId?.trim().slice(0, 160);
if (clientRequestId) { /* by_user_client_request index → return existing.runId */ }
```

**Input** — `{ prompt, tier, contextRef?, pinnedClaims?, conversationContext?, clientRequestId? }`.
**Output** — a `runId` string, returned synchronously in well under a second.
**Failure behavior** — unauthenticated or anonymous callers get a thrown error
that surfaces as the composer's error toast; no row is written and no model is
called.
**Next** — the row is inserted (Step 7) and the background action is scheduled
(Step 6).

---

## Step 6 — Agent orchestration starts, on the server, out of band

**File:** `backend/convex/domains/redesign/chatRuns.ts`
**Symbol:** `runStreamingChat` (an `internalAction` — no client can call it)
**Called by:** the Convex scheduler, from `startChat`
**Calls next:** `classifyPrompt` → `resolveContextRuntimePacket` → `buildBoardState` → the model call in Step 7

**Why this exists**
A Convex mutation must be short and transactional; it cannot hold a socket open
to a model for thirty seconds. So `startChat` returns immediately and the slow
work runs as a scheduled action. The consequence a reader must internalise: **the
answer is never returned to the caller.** It is written to the database, and the
browser learns about it by subscription (Step 9).

The orchestration is a fixed pipeline, not an agent loop: classify the question,
resolve context, decide whether live grounding is worth it, call the model,
parse, bind evidence, seal.

**Core code**

```ts
// backend/convex/domains/redesign/chatRuns.ts:1868
export const runStreamingChat = internalAction({
  handler: async (ctx, args) => {
    const append = (eventType, payload) =>
      ctx.runMutation(internal.domains.redesign.chatRuns.appendEvent, { runId: args.runId, eventType, payload });
    const classification = classifyPrompt(args.prompt);
    const runtimeContext = await ctx.runQuery(internal…chatRuns.resolveContextRuntimePacket, { contextRef: args.contextRef });
    const liveGrounding = decideLiveGrounding({ /* prompt, cache hits, context counts */ });
```

**Input** — the `runId` plus everything `startChat` validated.
**Output** — a stream of ordered event rows, then a sealed run row.
**Failure behavior** — the whole handler is wrapped in one `try/catch`
(Step 10). A missing `GEMINI_API_KEY` fails on the first line of the try.
**Next** — the model call and its one tool.

---

## Step 7 — Tool registration and invocation

**File:** `backend/convex/domains/redesign/chatRuns.ts`
**Symbol:** the `fetch` to Gemini `streamGenerateContent`, inside `runStreamingChat`
**Called by:** `runStreamingChat`
**Calls next:** the SSE parse loop, which emits `scratchpad` and `grounding_chunk` events

**Why this exists**
Set your expectations correctly before you go looking: **NodeBench does not have
a tool registry on this path.** There is exactly one tool, `google_search`, and it
is not implemented in this repo — it is a capability of the Gemini API, switched
on per-run by a boolean. The "tool calls" the user sees in the trace panel are
*stage records* the orchestrator writes itself (`append("tool_call", …)`), not
model-issued function calls.

Multi-tool agent machinery does exist elsewhere in the repo (`packages/convex-mcp-nodebench`
publishes 36 MCP tools, `packages/mcp-local` publishes more; `apps/web/src/features/agents/`
renders multi-step agent panels). None of it is on the `/redesign/chat` path. See
`docs/codebase/ARCHITECTURE.md` for which runtime owns what.

**Core code**

```ts
// backend/convex/domains/redesign/chatRuns.ts:2077
const url = `https://generativelanguage.googleapis.com/v1beta/models/${args.model}:streamGenerateContent?alt=sse&key=${apiKey}`;
const res = await fetch(url, { method: "POST", signal: controller.signal, body: JSON.stringify({
  systemInstruction: { parts: [{ text: systemPrompt }] },
  contents: [{ role: "user", parts: [{ text: args.prompt }] }],
  ...(liveGrounding.useLiveGrounding ? { tools: [{ google_search: {} }] } : {}),   // ← the only tool
  generationConfig: { temperature: 0.3, maxOutputTokens: 1500 },
}) });
```

**Input** — the composed system prompt, the user prompt, and the grounding
decision.
**Output** — a server-sent-event body, read chunk by chunk; grounding URIs arrive
as `groundingChunks` alongside the text.
**Failure behavior** — an `AbortController` armed with `TIMEOUT_MS` cancels a
hung request; a non-2xx response throws with the status and the first 200
characters of the body; the loop re-checks for cancellation on every chunk.
**Next** — every chunk becomes a durable event row.

---

## Step 8 — Persistence: every stage becomes an ordered, durable row

**File:** `backend/convex/domains/redesign/chatRuns.ts`
**Symbol:** `appendEvent` (internal mutation), then `finalizeRun`
**Called by:** `runStreamingChat`, once per stage and per text chunk
**Calls next:** nothing — this is the bottom of the write path

**Why this exists**
The browser is not the place where the answer lives. If the user reloads
mid-answer, closes the laptop, or opens the same run on their phone, the run must
still be there. So progress is *state*, not a message: each stage appends a row
with a monotonically increasing `idx`, and the final answer patches the run row
to `status: "complete"` with its content hash.

**Core code**

```ts
// backend/convex/domains/redesign/chatRuns.ts:1775
export const appendEvent = internalMutation({
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("redesignChatStreamEvents")
      .withIndex("by_run_idx", (q) => q.eq("runId", args.runId)).order("desc").take(1);
    const nextIdx = (existing[0]?.idx ?? -1) + 1;
    return await ctx.db.insert("redesignChatStreamEvents", { runId: args.runId, idx: nextIdx, ...args });
  },
});
```

**Input** — `runId`, an event type (`stage`, `tool_call`, `scratchpad`,
`grounding_chunk`, `board_state`, `packet_complete`, `error`), and a payload.
**Output** — one row in `redesignChatStreamEvents`, ordered by `idx`.
**Failure behavior** — Convex mutations are transactional; a failed append
leaves no partial row. `finalizeRun` (line 1821) is what makes an answer
readable, so a crash before it leaves the run visibly unfinished rather than
silently truncated.
**Next** — the browser is already subscribed to those rows.

---

## Step 9 — Streaming and rendering, with no SSE between server and browser

**File:** `apps/web/src/features/redesign/hooks/useRedesignChatRun.ts`
**Symbol:** `useRedesignChatRun`
**Called by:** `ChatSurface` (line 339)
**Calls next:** `buildPartialChatAnswer` → `ChatAssistantMessage`

**Why this exists**
This is the part most readers guess wrong. There is **no SSE endpoint, no
WebSocket route, and no polling loop in this application's code.** The hook
subscribes to two ordinary Convex queries; Convex re-runs them and pushes new
results whenever the underlying rows change. The event rows written in Step 8
*are* the stream.

**Core code**

```ts
// apps/web/src/features/redesign/hooks/useRedesignChatRun.ts:290
const events = useQuery(api.domains.redesign.chatRuns.streamEventsForRun, activeRunId ? { runId: activeRunId } : "skip");
const runRow = useQuery(api.domains.redesign.chatRuns.getRun,               activeRunId ? { runId: activeRunId } : "skip");
```

**Input** — the active `runId` (or `"skip"`, Convex's idiom for "do not
subscribe yet").
**Output** — a projected `RealChatRun`: partial answer, evidence rows, trace
rows and metrics, rebuilt on every batch of new events by
`buildPartialChatAnswer` (line 186).
**Failure behavior** — both queries call `assertRunReadable` on the server
(line 175), so a run belonging to someone else throws instead of leaking. If the
tab reloads, `getLatestOwnedRun` re-attaches to the newest owned run, and the
answer resumes from the durable rows.
**Next** — failure and recovery.

---

## Step 10 — Failure, cancellation and after-the-fact verification

**File:** `backend/convex/domains/redesign/chatRuns.ts`
**Symbol:** the `catch` at the end of `runStreamingChat`, plus `failRun`,
`cancelRun` and `validateRunSources`
**Called by:** the runtime itself
**Calls next:** the same reactive queries as Step 9 — a failure is delivered the
same way an answer is

**Why this exists**
Three different bad endings need three different behaviours, and conflating them
is the classic bug. A **user cancel** is not an error and must not be written as
one. A **model or network failure** must reach the screen with a real message. A
**source that does not actually contain the quoted text** must not silently pass
as evidence.

**Core code**

```ts
// backend/convex/domains/redesign/chatRuns.ts:2366
} catch (err: any) {
  if ((err?.message || String(err)) === "RUN_CANCELLED" || await isCancelled()) return;   // cancel ≠ error
  const errorMessage = (err?.message || String(err)).slice(0, 280);
  await append("error", { errorMessage });
  await ctx.runMutation(internal.domains.redesign.chatRuns.failRun, { runId: args.runId, errorMessage });
}
```

**Input** — any thrown value from the orchestration.
**Output** — an `error` event row plus `status: "error"` on the run row — unless
the run was cancelled, in which case nothing is overwritten (`failRun`, line
1849, explicitly refuses to touch a `cancelled` row).
**Failure behavior** — there is no retry on this path. A failed run stays failed
and the user re-asks. After a *successful* run, `validateRunSources` (line 2464)
is scheduled: it re-fetches each cited URL through an SSRF check (`isUrlSafe`,
line 2384) and asserts the quoted text is literally a substring of the page,
patching verification flags onto the evidence rows. The UI updates through the
same subscription, so verification appears after the answer rather than delaying
it.
**Next** — the tests that hold all of this in place.

---

## Step 11 — The tests that prove this flow

| What it proves | File | Run it |
|---|---|---|
| The setup door in Step 1 accepts only routable deployment URLs | `apps/web/src/lib/convexUrl.test.ts` | `npx vitest run apps/web/src/lib/convexUrl.test.ts` |
| Step 4's tier mapping, idempotency key and answer projection | `apps/web/src/features/redesign/hooks/useRedesignChatRun.test.ts` | `npx vitest run apps/web/src/features/redesign/hooks/useRedesignChatRun.test.ts` |
| The answer packet keeps required fields and leaks no forbidden ones, driven through the real runtime functions | `backend/convex/domains/redesign/chatRuns.contract.test.ts` | `npx vitest run backend/convex/domains/redesign/chatRuns.contract.test.ts` |
| The response-shape policy (compact vs. full) matches the UI contract | `backend/convex/domains/redesign/chatRuns.responseShape.test.ts` | `npx vitest run backend/convex/domains/redesign/chatRuns.responseShape.test.ts` |
| Only owners can read a run's route and events | `evals/e2e/redesign-runtime-route-ownership.spec.ts` | `npx playwright test evals/e2e/redesign-runtime-route-ownership.spec.ts` |
| The whole surface renders end to end in a browser | `evals/e2e/one-flow-regression.spec.ts` | `npx playwright test evals/e2e/one-flow-regression.spec.ts` |

The full suite is four segments — `npm run test:run`. It is **red at HEAD** for
reasons that predate this document; the exact counts and causes are in
`docs/codebase/CONCERNS.md`, so you can tell a pre-existing failure from one you
just caused.

---

## Where you would add the next capability

- **A new answer field** (say, "confidence"): the parse in `runStreamingChat`,
  the packet builder `buildPartialChatAnswer`, and a case in
  `chatRuns.contract.test.ts`. Three files.
- **A second real tool** (not Gemini's built-in search): this path has no tool
  registry, so you would add the loop — model call, tool dispatch, result
  append, model call again — inside `runStreamingChat`, and every step still has
  to become an `appendEvent` row or it will not reach the screen.
- **A new surface**: do not add a route. Add an `?intent=` value and handle it in
  `RedesignShell` / `ChatSurface`; the one-surface rule is enforced by
  `apps/web/src/features/redesign/lib/oneSurfaceRouting.ts` and its test.

# Prod benchmark baseline — proof-looped, honest

> Run via proof-looping against **prod** Convex (`agile-caribou-964`), the real Fast Agent
> (`fastAgentPanelStreaming.sendMessageInternal`), default model `kimi-k2.6`. This is the *honest*
> answer to "can nodebench-ai pass all benchmark tasks" — not a fabricated all-green.

## Result: **1 / 43 pass (2%)**

`convex run tools/evaluation/comprehensiveTest:runComprehensiveTest` — 43 tool-use tasks across 38
categories (Document read/analyze/create/edit, Tasks, Events, Media, Search, SEC, …).

| outcome | count |
|---|---|
| **pass** | **1** (SEC Filing Search — called `searchSecFilings` + `getCompanyInfo`) |
| fail — **agent called ZERO tools** | **28** |
| fail — bad tool arguments | 11 |
| fail — wrong tool | 2 |
| fail — weak grounding/accuracy | 1 |

## Root cause: ONE systemic routing bug, not 42 task bugs

> **CORRECTION (2026-07-01, verified against the code — the proofloop gate catching its own author):**
> the specific attribution below (tool-needing queries hitting the no-tools **FastResponder/MiniNote**
> lane) is **WRONG.** `shouldUseFastResponder` returns `false` whenever `requestLikelyNeedsTooling`
> matches — and it matches `show|read|report|document|task|event|…`, i.e. exactly these queries — so
> they do **not** reach FastResponder. The eval invokes `sendMessageInternal` with a non-anonymous test
> user and **no `useCoordinator`**, which routes to the **COORDINATOR** lane (advisor profile). The
> Coordinator *has* tools but **delegates** rather than calling them directly, so the eval's synchronous
> `toolsCalled` capture reads empty even when work is delegated. **Real cause = the coordinator-delegation
> path (or the model not emitting tool calls) — UNCONFIRMED, pending a per-task deployment-log trace;
> testable via `useCoordinator:false` (executor → ChatAgent direct-tool lane).** The **1/43 baseline
> number stands** (verified); only the lane attribution in the paragraph below was premature.

The failures are dominated (28/42) by the agent **not calling any tool** on tasks that require one
(read/create/edit documents, list tasks, create events, list/search media). The tools **exist** and
are wired into the Fast Agent — but `sendMessageInternal` routes each turn to one of **three lanes**:

- `MiniNoteAgent` — `tools: {}` ("No tools for speed")
- `FastResponder` — `tools: {}` ("fast path responder … no tool calls", `stepCountIs(1)`)
- `createChatAgent` — **the full toolset** (documents, tasks, events, media, search, SEC, …)

Tool-needing queries are landing on a **no-tools lane** (FastResponder / MiniNote), so the
document/task/calendar/media tools never fire — the agent punts with a generic reply
(e.g. *"I don't have access to your calendar"*) and fails the criteria. The existing safety net
(`sendMessageInternal` ~L5956: *"No tools called. Forcing tool-first follow-up…"*) is **not recovering**
these — the forced follow-up still doesn't land the needed tools. The only tasks that pass/partially
work are the ones whose tools fire regardless (search / SEC / web).

**This is a real product finding, not a benchmark artifact:** real users asking the prod agent to
read/create/edit a document likely also get punted to the no-tools lane.

## The fix (proposed — PR-gated, NOT blind-deployed to the live agent)

Locus: `convex/domains/agents/fastAgentPanelStreaming.ts` — the lane selection in
`sendMessageInternal` (~L5561–5586) + the forced-follow-up (~L5956).

1. Route **tool-needing intents** (document/task/event/media CRUD) to `createChatAgent` (full tools),
   not FastResponder/MiniNote. The planner/classifier (~L1803) must not send "read/create/edit X" to a
   no-tools lane.
2. Make the **forced tool-first follow-up actually use the full-tools lane** so the safety net recovers
   a no-tool turn instead of re-punting.
3. Verify by re-running ONLY the failing slice (proof-loop: a fix counts only if the task's score flips
   with evidence), then the full 43. Do **not** claim a higher pass rate until re-run.

## Status (PROVE-BEFORE-CLAIM)

- ✅ Benchmark **runs on prod** (the eval executes inside live Convex) — verified, this baseline is its output.
- ✅ Baseline **1/43** — verified (committed run output).
- ✅ Root cause — verified by reading the lane routing + the failure classes.
- ⏳ Fix — **proposed, not applied/verified.** Ships as a reviewed PR with before/after; the live agent
  is not blind-deployed. All-green is **not** claimed and won't be until a re-run proves it.

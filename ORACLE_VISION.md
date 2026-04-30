# Oracle Vision

Canonical source: `docs/architecture/oracle/VISION.md`

This root copy exists so prompt packs, local agents, and repo-level tests all anchor to the same Oracle contract without guessing paths.

## Scope

Oracle v1 is an internal-builder system. It is not a consumer career coach and it is not a generic chatbot shell. The first shipped surface is the builder-facing control tower that helps operators see whether an agent is behaving like institutional memory or institutional hallucination.

## Immutable Product Intent

- Start from the harness, not from a one-off feature request.
- Preserve the original implementation idea as a first-class artifact.
- Make every long-running task observable across time, cost, tool order, and drift.
- Prefer progressive disclosure over dumping every tool and rule into context at once.
- Keep the evidence layer deterministic even when presentation uses game-like framing.

## Non-Negotiables

- The agent must always read `ORACLE_VISION.md`, `ORACLE_STATE.md`, and `ORACLE_LOOP.md` before extending the system.
- Every long-running task or session must track `goalId`, `visionSnapshot`, `successCriteria`, `sourceRefs`, `crossCheckStatus`, `deltaFromVision`, and `dogfoodRunId`.
- Claims and recommendations must cite source references.
- Performance, cost, or reliability claims must be backed by measured evidence, not LLM self-review.
- The system must explicitly record what could still be wrong instead of presenting a flattering first draft as final truth.
- Translate jargon immediately into plain English and explain intuition before mechanics.
- Game or anime framing is presentation only. Timestamps, citations, budgets, and deterministic checks remain the source of truth.

## Architectural Boundaries

- Reuse existing repo primitives for telemetry, progressive disclosure, confirmation flows, task/session state, and dogfood verification.
- Defer autonomous tool-writing sandboxes in v1.
- Defer full end-user career Oracle workflows in v1.
- Prefer small, verifiable slices over large speculative rewrites.
- Treat LLM output as a draft generator, not as an authority on correctness or performance invariants.

## Builder-Facing Outcome

The control tower should let a builder answer five questions quickly:

1. What was the original idea?
2. What has the agent done so far?
3. What did it cost in time, tools, and tokens?
4. Is the work aligned, drifting, or violated?
5. What is the next recommended action?

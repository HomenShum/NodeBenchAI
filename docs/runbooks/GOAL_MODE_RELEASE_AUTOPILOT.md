# Goal-Mode Release Autopilot

Use this runbook when a task needs a long-running agent loop with a concrete definition of done.

The goal is not a normal prompt. It is the stop condition. Keep implementation details in the task thread and durable project rules in `AGENTS.md` or the relevant runbook. Put only observable completion criteria in `/goal`.

## Tool Support

Claude Code:

- `/goal` was introduced in Claude Code `v2.1.139`.
- It sets one active session-scoped completion condition.
- Claude keeps taking turns until an evaluator model decides the surfaced evidence satisfies the condition.
- The evaluator does not run commands or inspect files itself, so the agent must report command output, browser evidence, and remaining risks.
- Pair with auto mode when the loop should continue without per-turn prompts.

Reference:
- https://code.claude.com/docs/en/goal
- https://github.com/anthropics/claude-code/releases/tag/v2.1.139
- https://github.com/anthropics/claude-code/releases/tag/v2.1.140

Codex CLI:

- `/goal` is experimental and requires `features.goals = true`.
- It is attached to the active CLI thread and does not override sandbox, approval, policy, or network limits.

Reference:
- https://developers.openai.com/codex/cli/slash-commands
- https://developers.openai.com/codex/guides/agents-md

## Usage

Claude Code:

```bash
claude --permission-mode auto
/goal <paste the release goal>
```

Codex CLI:

```toml
# ~/.codex/config.toml
[features]
goals = true
```

```bash
codex --sandbox workspace-write --ask-for-approval on-request
/goal <paste the release goal>
```

In Codex Desktop, emulate the same contract by treating the goal text as the active acceptance checklist and continuing the local fix, verify, and evidence loop until every gate is satisfied.

## Self-Directed Loop Pattern

Use a batched issue queue instead of chasing one warning at a time. Classify every pass into blockers, actionable attention, known-safe cautions, and exactly one next development candidate.

Run specialist passes in a stable order so the loop stays comparable across turns: housekeeping, product workflow, backend or handoff contracts, privacy and reliability, performance and accessibility, and automation evidence.

Track cost/effort accounting before taking a slice. Prefer a small detector, targeted test, or local product fix that can be verified and committed in the same turn; defer work that would need deploys, live writes, or broad refactors.

## Goal Template

```text
/goal NodeBench <scope> is ACTUALLY done when:

1. The work starts from the intended prod-parity branch or worktree, not a stale dirty branch, and any pre-existing user changes are preserved.

2. The shipped behavior matches the named product target across all relevant routes, states, and breakpoints. For UI work, verify desktop, narrow desktop, and mobile.

3. Live runtime flows remain intact. Production routes must not silently fall back to fixtures, fake data, or disabled backend wiring.

4. The important user workflows are dogfooded end to end in the browser, including navigation, primary actions, empty/loading/error states, and any cross-panel synchronization.

5. Required checks pass:
   - npx tsc --noEmit --pretty false
   - targeted Vitest for touched surfaces
   - targeted Playwright or browser automation for changed workflows
   - npm run build

6. Release artifacts are updated when applicable:
   - QA matrix rows include status, evidence, and remaining risk
   - runbooks or AGENTS.md are updated for new operational behavior
   - screenshots or trace artifacts are captured for changed views

7. Any failure is root-caused and fixed, not waived. If the same failure repeats three times, change strategy by instrumenting, isolating, rolling back the risky slice, or reducing scope.

8. Done means the final answer lists exact evidence: commands run, browser views verified, files changed, matrix rows updated, residual risks, and explicitly deferred items with rationale.
```

## Home-v2 Product Release Goal

Use this for the current home-v2 parity and release-readiness loop.

```text
/goal NodeBench home-v2/product-release parity is ACTUALLY done when all of the following are true:

1. The implementation starts from origin/main/prod-parity, not stale dirty branches, and preserves live Convex-backed runtime flows with no silent production fixture fallback.

2. /redesign?qa=home-v2-implementation visually matches the latest home-v2.html target across Home, Reports, Chat, Inbox, and Me at desktop 1440x900, desktop 1280x720, and mobile 390x844.

3. Web navigation remains exactly Home, Reports, Chat, Inbox, Me. Workspace stays a separate deployed surface, not a sixth web tab.

4. Reports entity-card selection updates the selected card, left rail, center context, right coverage rail, score, signals, related entities, drawer toggle, and composer placeholder.

5. Chat includes the rich product flow: report banner, checkpoints, structured answer packet, entity pills, evidence table, risks or open questions, next actions, tool or source chips, composer controls, and switching right-rail tabs.

6. Inbox and Me match the intended richer product surfaces: ranked queue, actions, expanded rows for Inbox, and memory, integrations, settings, and session controls for Me.

7. Landing and Home copy avoids unsupported predictive claims. It reads as an editorial intelligence brief: what changed, why it matters to the user, what to do next, reports touched, sources used, and actions created.

8. The release QA matrix CSV is updated with pass/fail/evidence for every row touched or verified.

9. Required checks pass:
   - npx tsc --noEmit --pretty false
   - targeted Vitest for touched surfaces
   - BASE_URL=http://127.0.0.1:5180 npx playwright test tests/e2e/home-v2-parity.spec.ts
   - npm run build

10. Browser screenshots are captured and inspected for every changed view. Any console, runtime, or layout failure is root-caused and fixed, not waived.

11. Done means the final answer lists exact evidence: commands run, screenshots or views verified, CSV updated, residual risks, and any explicitly deferred item with rationale. If any gate fails, continue fixing.
```

## Runtime-Trace Release Goal

Use this when the home-v2 shell already renders but the question is whether the product is actually live-wired end to end.

```text
/goal NodeBench redesign runtime-readiness is ACTUALLY done when:

1. /redesign/chat starts a real Convex-backed run for anonymous and signed-in users without inserting showcase answers.

2. Every visible answer packet exposes a Runtime board with context candidates, tool decisions, claim/source checks, and cost/latency metrics. If the deployed backend predates first-class runtime events, the frontend must show an honest compatibility projection from the persisted run row and trace rather than hiding the missing data.

3. The packet and stream contract include durable event names for board_state, context_candidate, tool_decision, claim_check, run_metrics, and packet_complete.

4. Active-looking actions are either durable or explicitly labeled as local-only / preview-only.

5. Required checks pass: tsc, targeted Vitest, home-v2 Playwright, npm run build, and browser dogfood of /redesign/chat?q=<probe> with the Runtime board visible.

6. The QA matrix records PASS/NEEDS_RUN/NEEDS_FIX with evidence and remaining gaps for runtime observability, production proof, action durability, responsive parity, and console cleanliness.
```

## Execution Rule

Before declaring success, surface enough evidence for the evaluator or reviewer to independently judge the goal:

- exact commands and pass/fail state
- exact routes and viewport sizes inspected
- changed files
- QA matrix rows updated
- deployment target or local URL
- known residual risks

If the agent cannot complete a gate directly, it must engineer a workaround, reduce the task to a verifiable slice, or clearly mark the gate as failed. Do not call an unverified gate done.

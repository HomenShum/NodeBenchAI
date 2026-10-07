---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.html"
  - "**/*.css"
related_: [analyst_diagnostic, reexamine_design_reduction, reexamine_process, completion_traceability, gemini_qa_loop]
---

# Dogfood Verification Protocol — Product Design Review

Every UI change MUST be visually verified in the running app before declaring done. Code-level changes without visual confirmation are unverified assumptions. But verification is not just "does it render?" — it's "does it belong?"

## Mindset: Analyst, Not Junior Dev

Guide yourself like an analyst diagnosing root cause, not a junior dev slapping on a bandaid. Before touching code:

1. **Form a hypothesis** — What is actually wrong? "It looks broken" is not a hypothesis. "The date picker generates UTC dates but the data is keyed by local dates" is.
2. **Trace the render path** — Which component ACTUALLY renders on screen? Follow: sidebar item → view key → MainLayout switch → lazy import → component file. Don't assume — the component you grep for may not be the one the user sees.
3. **Identify the data layer** — Is this Convex backend (needs `convex deploy`), React frontend (needs `vite build`), stored DB records (needs migration), or MCP tools (needs `tsc`)? Changing the wrong layer wastes a cycle.
4. **Ask "why" before "what"** — If a gauge shows 0%, don't change the label. Ask why it's 0%. Missing data? Wrong query? Unconfigured system? Each has a different fix.

## Jony Ive Product Design Critique

After verifying it renders, apply the design critique. Every element must earn its place:

### Does it communicate or decorate?
- Every stat must drive a decision. If a number doesn't change behavior, it's decoration — remove it.
- "14 threads" means nothing without context. "14 threads (3 escalating)" drives action.
- Streak counters, "free runs today", total counts without trends — vanity. Remove.

### Does it respect the user's time?
- Empty states: "No data yet. Run: `npm run local:sync`" gives agency. "Nothing here" wastes time.
- Loading states: skeleton shimmer, not blank void. User should never stare at white.
- Error states: what went wrong + what to do about it. Never just "Error".

### Does the language earn trust?
- Replace jargon: "Act I/II/III" → "Quick Pulse / Analysis / Deep Dive"
- Replace internal labels: "Orchestrator" → "Agent", "Trajectory" → "History"
- Test: would a non-technical person understand this label in 2 seconds?

### Does it survive edge cases?
- Grammar: "1 items" → "1 item". Always handle singular/plural.
- Timezone: `toISOString().slice(0,10)` returns UTC, not local. This WILL mismatch.
- Zero state: What happens with 0 items? 1 item? 10,000 items?
- First-run: What does a new user see before any data exists?

### Does it reduce, not accumulate?
- Prefer 3-5 tabs maximum per view
- Before adding a new tab: try accordion, inline section, or progressive disclosure
- If removing an element loses no function, remove it
- If two sections serve the same purpose, combine them

## Verification Checklist

## One-command dogfood capture (recommended)

Runs a full Scribe-like dogfood session locally and makes it UI-verifiable at `/dogfood`:

- `npm run dogfood:full:local` (screenshots + publish + how-to + video)
- `npm run dogfood:full:local:play` (same, then opens the video)

### Before writing any fix
1. Reproduce the exact failure. Screenshot it.
2. Trace upstream: symptom → intermediate state → root cause.
3. Confirm your fix addresses the root cause, not just the symptom.
4. Check if the same root cause exists elsewhere.

### After writing a fix
1. **Build**: `npx vite build` (frontend) or `npx convex deploy` (backend) or `npx tsc` (MCP)
2. **Navigate**: Use Playwright or manual browser to reach the EXACT page
3. **Screenshot**: Capture at 1440x900. Compare before/after.
4. **Edge-case sweep**: Test with 0 items, 1 item, and the singular/plural boundary
5. **Design critique**: Run through the Ive checklist above. Does every pixel earn its place?
6. **Make it UI-verifiable**: Publish the latest evidence so `/dogfood` can render it (`npm run dogfood:publish` or `npm run dogfood:full:local`).

## Red Flags You're Bandaiding

- Adding `try/catch` that swallows errors without understanding them
- Adding `?.` optional chaining to mask `undefined` instead of finding why it's undefined
- Changing "0/7 healthy" to "7 scheduled" — hides a monitoring signal
- Fixing text in an empty state instead of addressing why it's empty
- Changing a generation constant but not migrating existing stored data
- "It works now" without understanding why it didn't before
- Editing a component that isn't reachable from the user's navigation path

## Layered Deployment Model

| Layer | Changes to | Deployed via | Visible when |
|-------|-----------|-------------|--------------|
| React components | `.tsx` in `apps/web/src/` | `vite build` | Preview server restarted |
| Convex functions | `.ts` in `backend/convex/` | `npx convex deploy` | Backend redeployed |
| Convex schema | `backend/convex/schema.ts` | `npx convex deploy` | Backend redeployed |
| MCP tools | `packages/mcp-local/` | `npx tsc` in package | MCP server restarted |
| Stored data | DB records | Data migration or mutation | After migration runs |
| Dashboard HTML | `briefHtml.ts` / `html.ts` | Inline — restart server | Server restarted |

## Navigation Map (Common Gotchas)

- Sidebar "Industry Updates" → `industry-updates` view → `IndustryUpdatesPanel` (NOT `PublicSignalsLog`)
- Sidebar "Agent Templates" → `agent-marketplace` view → `AgentMarketplace` (NOT `AgentsHub`)
- Sidebar "Recommendations" → `document-recommendations` view → `DocumentRecommendations`
- `AgentsHub` with `AutonomousOperationsPanel` → `agents` view (top nav / Research mode)
- `PublicSignalsLog` → `signals` view (Research mode)
- Local Dashboard → `http://127.0.0.1:6275` (MCP server auto-starts)

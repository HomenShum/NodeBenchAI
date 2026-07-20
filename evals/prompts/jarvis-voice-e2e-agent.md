# Jarvis Voice E2E Builder Prompt

Use this prompt when the task is:

`EVERYTHING WITHIN NODEBENCH AI INTERFACE MUST BE ACCESSIBLE VIA VOICE`

This is not a reporting prompt. This is an implementation prompt. The agent must test, build the missing bridge, fix failures, and re-verify until voice control works end-to-end.

## Operating Mode

You are a coding and verification agent with:

- Full repository read/write access
- Shell access for `npm`, `vite`, `playwright`, `tsc`, and project scripts
- Browser automation for the local app at `http://127.0.0.1:5173` or `http://localhost:5173`
- Permission to modify product code and tests

You are a builder. Every phase follows:

`TEST -> IMPLEMENT -> VERIFY`

If a check fails, you do not stop and report. You fix the cause, then re-run the check.

## Goal

Every interactive surface in NodeBench AI must be reachable by voice without relying on an LLM to interpret UI commands.

Voice must be able to:

- Navigate across the cockpit
- Switch modes
- Open settings and command surfaces
- Create documents and other primary objects
- Run utility commands like search, back, refresh, and scroll
- Fall through to agent chat for non-command prompts

## Current Problem

Voice transcription exists, but direct UI command handling is incomplete.

Two important entry points exist today:

- `src/components/hud/JarvisHUDLayout.tsx`
  - `handlePromptSubmit(text)` currently routes directly to `multi.createAndSend(text)`
- `src/features/agents/components/FastAgentPanel/FastAgentPanel.InputBar.tsx`
  - has speech-to-text support, but no shared deterministic intent router

The missing bridge is a deterministic `useVoiceIntentRouter` hook that intercepts UI commands before they fall through to the agent.

## Non-Negotiable Constraints

1. Intent parsing must be deterministic.
   Use regex or string matching only. No LLM classification for UI intent.

2. Add zero new dependencies.
   Pure TypeScript only.

3. Fallthrough is sacred.
   If input does not match a command, send it to the existing agent flow unchanged.

4. Ignore interim voice text.
   Do not treat `Listening...`, `Listening...` with stylized punctuation, `Transcribing...`, or `Transcribing...` with stylized punctuation as commands or chat prompts.

5. Every new voice command needs an E2E test.

6. Fix until green.
   Do not stop at "found issue". Ship the fix and verify it.

## Thompson Protocol — Voice Response Quality

When the agent generates responses to fallthrough prompts (non-command voice input routed to the AI agent), all output MUST follow Thompson Protocol constraints:

1. **Plain English Mandate**: Every technical term must be immediately followed by an analogy or "in other words" translation. No unexplained jargon.

2. **Acknowledge Difficulty**: Start complex explanations with validation ("This sounds complicated, but..." / "Most explanations make this harder than it is..."). NEVER use: "It is obvious that...", "As we all know...", "Simply put...", "Clearly..."

3. **Intuition Before Mechanics**: Explain WHY something exists before HOW it works. Structure: [What problem does this solve?] → [Analogy] → [Mechanics].

4. **Anti-Elitism**: Zero tolerance for gatekeeping language. Banned phrases include "real engineers know...", "you should already know...", "this is basic...", "trivially...", "any competent...". The reader/listener should feel invited, not tested.

5. **Readability Gate**: Voice responses should target Flesch-Kincaid grade level 6-8. Short sentences. One idea per sentence. If a sentence has more than 20 words, break it up.

6. **Analogy Density**: For any response over 100 words, include at least one concrete analogy. For 200+ words, include at least two. Analogies should use household objects, everyday experiences, or physical metaphors — not other technical concepts.

## Core Design To Implement

Create:

- `src/hooks/useVoiceIntentRouter.ts`

This hook should accept callbacks for UI actions and expose a single handler:

```ts
type HandleVoiceIntent = (text: string) => boolean;
```

Behavior:

- Return `true` when the text matched and executed a UI action
- Return `false` when the text should fall through to the agent

The router must sit before agent chat in both voice-enabled entry points:

- `JarvisHUDLayout`
- `FastAgentInputBar`

## Command Coverage

The command set to support and verify is:

### Navigation

Support direct navigation for the cockpit surfaces exposed in the current branch, including aliases.

Primary targets:

- `research`
- `signals`
- `for-you-feed`
- `industry-updates`
- `github-explorer`
- `pr-suggestions`
- `funding`
- `benchmarks`
- `linkedin-posts`
- `entity`
- `footnotes`
- `showcase`
- `documents`
- `spreadsheets`
- `calendar`
- `roadmap`
- `timeline`
- `public`
- `document-recommendations`
- `agents`
- `agent-marketplace`
- `activity`
- `mcp-ledger`
- `analytics-hitl`
- `analytics-components`
- `analytics-recommendations`
- `cost-dashboard`
- `dogfood`

Also inspect the branch for extra routed surfaces such as `engine-demo`. If present in the active routing path, include them in voice coverage instead of silently ignoring them.

Navigation phrases to support:

- `go to {view}`
- `open {view}`
- `show {view}`
- `navigate to {view}`
- `switch to {view}`

Representative aliases:

- `home` -> `research`
- `for you` -> `for-you-feed`
- `industry` -> `industry-updates`
- `pull requests` -> `pr-suggestions`
- `linkedin` -> `linkedin-posts`
- `sources` -> `footnotes`
- `shared` -> `public`
- `recommendations` -> `document-recommendations`
- `assistants` -> `agents`
- `mcp` -> `mcp-ledger`
- `review` -> `analytics-hitl`
- `performance` -> `analytics-components`
- `feedback` -> `analytics-recommendations`
- `costs` -> `cost-dashboard`
- `qa` -> `dogfood`

### Mode Switching

Support:

- `mission mode`
- `intel mode`
- `build mode`
- `agents mode`
- `system mode`

Also allow:

- `switch to mission`
- `switch to intel`
- `switch to build`
- `switch to agents`
- `switch to system`

### Create And System Actions

Support:

- `new document`
- `create document`
- `new doc`
- `new task`
- `create task`
- `add task`
- `new event`
- `create event`
- `add event`
- `new meeting`
- `open settings`
- `settings`
- `preferences`
- `command palette`
- `commands`
- `open commands`

### Theme And Layout

Support:

- `dark mode`
- `light mode`
- `toggle theme`
- `toggle dark`
- `classic layout`
- `cockpit layout`
- `switch layout`

### Utilities

Support:

- `search for {query}`
- `search {query}`
- `find {query}`
- `look up {query}`
- `thread {n}`
- `switch to thread {n}`
- `tab {n}`
- `go back`
- `back`
- `previous`
- `refresh`
- `reload`
- `scroll to top`
- `scroll up`
- `scroll to bottom`
- `scroll down`

### Fallthrough

Verify that open-ended prompts still go to the agent, for example:

- `explain quantum computing`
- `summarize this repo`
- `what changed in AI this week`

## Live Code Targets

Inspect and wire the real code, not an imagined architecture.

Key files:

- `src/components/hud/JarvisHUDLayout.tsx`
- `src/features/agents/components/FastAgentPanel/FastAgentPanel.InputBar.tsx`
- `src/hooks/useMainLayoutRouting.ts`
- `src/layouts/CockpitLayout.tsx`
- `src/layouts/cockpitModes.ts`
- `src/contexts/ThemeContext.tsx`
- `tests/e2e/voice-input.spec.ts`

Expected wiring targets from the current codebase:

- `setCurrentView(...)`
- `openSettings(...)`
- command palette open state or open callback
- document creation event dispatch
- mode switching callback
- theme and layout setters from theme context
- thread selection callback
- search population or search dispatch

If a required callback is not exposed yet, expose it cleanly instead of hacking around it.

## Required Implementation Shape

### 1. Create The Router

Add `src/hooks/useVoiceIntentRouter.ts`.

Suggested interface:

```ts
export interface VoiceIntentActions {
  navigateToView: (viewId: string) => void;
  openSettings: () => void;
  openCommandPalette: () => void;
  createDocument: () => void;
  createTask: () => void;
  createEvent: () => void;
  setCockpitMode: (mode: string) => void;
  setLayout: (layout: "cockpit" | "classic") => void;
  setThemeMode?: (mode: "light" | "dark") => void;
  toggleDarkMode?: () => void;
  selectThread: (index: number) => void;
  triggerSearch: (query: string) => void;
  scrollTo: (position: "top" | "bottom") => void;
  goBack: () => void;
  refresh: () => void;
}

export function parseVoiceIntent(text: string): {
  matched: boolean;
  intent: string;
  params?: Record<string, string | number>;
} | null;

export function useVoiceIntentRouter(
  actions: Partial<VoiceIntentActions>,
): { handleIntent: (text: string) => boolean };
```

The hook must be fast and deterministic.

### 2. Wire Jarvis HUD

In `JarvisHUDLayout`, intercept before `multi.createAndSend(text)`.

Desired flow:

```ts
const handled = handleVoiceIntent(text);
if (handled) {
  return;
}
multi.createAndSend(text);
```

### 3. Wire Fast Agent Input

Apply the same router before `onSend`.

Do not let the HUD and fast agent panel drift into two separate command grammars.

### 4. Add Lightweight Confirmation

When a voice command is matched:

- show a brief success confirmation in the voice surface
- expose the confirmation through an `aria-live="polite"` region
- clear it automatically after a short delay

No toast library. No modal. No heavy animation.

## Verification Plan

Run and pass these phases in order.

### Phase 0: Baseline

- App loads locally
- No blocking console errors
- Voice affordance is visible
- Mic button meets 44x44 target

### Phase 1: Router Core

Prove current failure first, then implement and verify:

- `go to documents`
- `open settings`
- `new document`
- `mission mode`
- `dark mode`
- unmatched input falls through to agent

### Phase 2: Full Navigation Sweep

Verify voice navigation for every routed cockpit view supported by this branch.

### Phase 3: Create And Modal Actions

Verify:

- document creation
- task creation
- event creation
- settings
- command palette

### Phase 4: Mode, Theme, Layout

Verify:

- all 5 cockpit modes
- dark and light mode
- classic and cockpit layout

### Phase 5: Search, Threads, Back, Scroll, Refresh

Verify:

- `thread 1`
- `thread 2`
- `search for funding rounds`
- `go back`
- `scroll to top`
- `scroll to bottom`
- `refresh`

### Phase 6: Voice Lifecycle

Mock speech recognition or transcription and verify the full path:

- mic starts
- transcript appears
- command routes correctly
- fallback goes to agent
- permission-denied path is accessible
- silence path is safe

### Phase 7: Mobile And Tablet

Verify at:

- `375x812`
- `768x1024`
- desktop viewport

Check visibility, spacing, touch target, clipping, and successful command execution.

### Phase 8: Accessibility

Verify:

- logical tab order
- labels for mic and submit controls
- `role="alert"` for errors
- `aria-live="polite"` for command confirmations
- reduced-motion behavior
- keyboard operation for mic start and stop

### Phase 9: Stress And Edge Cases

Verify:

- rapid sequential commands
- commands during transition
- commands with modal already open
- unknown views fall through cleanly
- mixed-case input
- long freeform transcript still falls through

### Phase 10: Full Command Matrix

Run the explicit command matrix end-to-end.

Target baseline:

- 29 view navigations
- 5 mode switches
- 8 create/system actions
- 5 utilities
- 3 fallthrough checks

If the active branch exposes more routed views, expand the matrix and test them too.

### Phase 11: Regression Sweep

Before stopping, re-run:

- typecheck
- relevant unit tests if added
- `tests/e2e/voice-input.spec.ts`

Existing voice tests must keep passing. Add new tests; do not remove coverage to make failures disappear.

## Test Requirements

Add E2E coverage in:

- `tests/e2e/voice-input.spec.ts`

Minimum expectations:

- deterministic typed-command tests for the router behavior
- mocked speech lifecycle tests
- fallthrough tests
- mobile viewport checks
- accessibility checks for confirmation and error announcements

Every supported command family needs at least one direct assertion.

## Stop Condition

You are done only when all of the following are true:

- voice commands can drive all supported cockpit surfaces in this branch
- unmatched prompts still reach the agent
- existing voice tests still pass
- new voice coverage tests pass
- no obvious dead-end remains where the user can say a UI command and get dumped into agent chat instead

## Output Format

When you finish, report:

```json
{
  "voiceReachableBefore": 0,
  "voiceReachableAfter": 50,
  "filesCreated": ["src/hooks/useVoiceIntentRouter.ts"],
  "filesModified": [],
  "testsAdded": 0,
  "testsPassing": 0,
  "notes": []
}
```

Do not claim success without rerunning verification after the last fix.

# Voice Intent Router — Implementation Notes for Coworking Agent

## Architecture

```
User speaks/types → JarvisHUDLayout.handlePromptSubmit / FastAgentInputBar.handleSend
                        ↓
                  onVoiceIntent?(text)     ← deterministic regex router
                        ↓
                  matched? → execute action + show confirmation (aria-live)
                  no match? → fall through to agent chat (AsyncIterable stream)
```

### File Map

| File | Role |
|------|------|
| `src/hooks/useVoiceIntentRouter.ts` | Pure parser (`parseVoiceIntent`) + React hook (`useVoiceIntentRouter`) |
| `src/layouts/CockpitLayout.tsx` | Wires all 14 action callbacks into `voiceIntentActions` useMemo |
| `src/features/agents/components/ConvexJarvisHUD.tsx` | Passes `onVoiceIntent` prop through to JarvisHUDLayout |
| `src/components/hud/JarvisHUDLayout.tsx` | Intercepts in `handlePromptSubmit`, shows voice confirmation |
| `src/features/agents/components/FastAgentPanel/FastAgentPanel.tsx` | Passes `onVoiceIntent` to InputBar |
| `src/features/agents/components/FastAgentPanel/FastAgentPanel.InputBar.tsx` | Intercepts in `handleSend` before `/spawn` |
| `tests/e2e/voice-input.spec.ts` | Scenarios 7-13: navigation, modes, create, theme, utilities, fallthrough, a11y |

### Prop Threading

```
CockpitLayout (owns all callbacks: navigate, setMode, openSettings, etc.)
  ├─ ConvexJarvisHUD  →  JarvisHUDLayout    (onVoiceIntent prop)
  └─ FastAgentPanel   →  FastAgentInputBar   (onVoiceIntent prop)
```

## How to Add a New Voice Command

1. **Open `src/hooks/useVoiceIntentRouter.ts`**
2. **Add regex pattern** in `parseVoiceIntent()` — follow existing pattern:
   ```typescript
   // Example: "summarize this page"
   const summarizeMatch = lower.match(/^(?:summarize|sum up)\s+(?:this\s+)?(?:page|view)$/);
   if (summarizeMatch) {
     return { intent: 'summarize', action: 'Summarizing current view', params: {} };
   }
   ```
3. **Add action callback** to `VoiceIntentActions` interface if needed:
   ```typescript
   summarizeView?: () => void;
   ```
4. **Wire callback** in `useVoiceIntentRouter` hook's switch/if block
5. **Wire implementation** in `CockpitLayout.tsx` → `voiceIntentActions` useMemo
6. **Add E2E test** in `tests/e2e/voice-input.spec.ts` under the appropriate scenario

## Key Design Decisions

### Why Regex, Not LLM?
Deterministic, zero-latency, no API cost. Voice commands are short imperative phrases (2-5 words). Regex handles this perfectly. Agent chat handles everything else via fallthrough.

### Why 80-char Length Guard?
Inputs longer than 80 chars are almost certainly agent prompts, not UI commands. The guard prevents false positives like "go to the research page and then check..." being caught by "go to research".

### Why CustomEvent for Some Actions?
Some actions (document create, thread selection, search, refresh) don't have callback props exposed at the CockpitLayout level. CustomEvent dispatch (`window.dispatchEvent(new CustomEvent('voice:search', ...))`) bridges this gap. Components that handle these events:
- `document:create` — listened by DocumentsHomeHub
- `voice:select-thread` — listened by FastAgentPanel thread list
- `voice:search` — listened by InstantSearchBar / CommandPalette
- `voice:refresh` — listened by any data-fetching component

### setMode Naming Conflict
- `useTheme().setMode` = ThemeMode (dark/light/system)
- `useCockpitMode().setMode` = CockpitMode (mission/intel/build/agents/system)
- In CockpitLayout: `const { setMode: setThemeMode } = useTheme()`

## VIEW_ALIASES Coverage (40+ aliases → 29 views)

The `VIEW_ALIASES` map in `useVoiceIntentRouter.ts` maps spoken phrases to `MainView` IDs. Every view has at least one alias. Common aliases:
- "home" / "dashboard" → "research"
- "costs" / "billing" → "cost-dashboard"
- "docs" / "documents" → "documents"
- "agents" / "marketplace" → "agent-marketplace"

## Known Gaps / TODOs

### P1 — Should Implement Soon
- [ ] **CustomEvent listeners**: `voice:select-thread`, `voice:search`, `voice:refresh` events are dispatched but NO component currently listens for them. Need to add `useEffect` listeners in FastAgentPanel (thread), InstantSearchBar/CommandPalette (search), and a global refresh handler.
- [ ] **"help" command**: "what can I say" / "voice help" should show a command cheat sheet overlay. Pattern exists in `parseVoiceIntent` but no UI panel yet.

### P2 — Nice to Have
- [ ] **Fuzzy alias matching**: Currently exact match only. "go to resarch" (typo) won't match. Could add Levenshtein distance < 2 fallback.
- [ ] **Contextual commands**: "edit this" / "delete this" / "share this" should act on the currently focused item. Requires a focus context provider.
- [ ] **Compound commands**: "go to funding and refresh" — currently only first match wins. Could chain with "and"/"then" splitting.
- [ ] **Voice feedback sounds**: The `useFeedback` hook mentioned in the plan isn't implemented. Currently only visual confirmation via aria-live.

### P3 — Future
- [ ] **Agent-delegated commands**: For commands the router can't handle deterministically (e.g., "find me companies doing Series A in healthcare"), the fallthrough to agent chat is correct. But the agent could trigger `onNavigate` back to show results in a specific view.
- [ ] **Whisper mode STT accuracy**: Whisper sometimes returns partial/hallucinated text. Consider a confidence threshold before routing.

## Testing

```bash
# Unit test the pure parser (no React needed)
# parseVoiceIntent is exported — can be tested standalone
npx vitest run tests/e2e/voice-input.spec.ts

# Full E2E with running app
npx playwright test tests/e2e/voice-input.spec.ts
```

Scenarios 7-13 in `voice-input.spec.ts` cover:
- 7: Navigation (11 view targets + confirmation display)
- 8: Mode switching (5 cockpit modes)
- 9: Create & system commands (document, task, event, settings, command palette)
- 10: Theme & layout (dark/light, focus/default)
- 11: Utilities (scroll, refresh, back, search)
- 12: Fallthrough (unmatched text reaches agent)
- 13: Accessibility (aria-live confirmation region)

## WCAG Compliance

- Touch targets: mic button and submit button are 44x44px (WCAG 2.5.8)
- Voice confirmation: `aria-live="polite"` + `role="status"` region
- Voice errors: `role="alert"` for immediate screen reader announcement
- All voice commands have keyboard equivalents (the router works on typed text too)

# Browser-Driven Top-5 Leaderboard — 2026-04-29T18-56-02

**Path tested:** browser composer → `runChatAgent` Convex action → pi-ai → OpenRouter → DOM render
**Judge:** `z-ai/glm-4.5-air:free`
**Queries per model:** 8
**Base URL:** http://localhost:5200

## Rankings (live browser, top-5 free models)

| Rank | Model | Score | Pass | Partial | Fail | Err | Avg Latency |
|---|---|---|---|---|---|---|---|
| 1 | Hunyuan 3 Preview | 0.00/4 | 0 | 0 | 0 | 8 | 90.1s |

Live browser run validates that every model is reachable through the full UI path:
composer keyboard input → React state → `runChatAgent` action →
`recordActivity` user-turn ledger write → pi-ai `complete()` →
OpenRouter response → `recordActivity` agent-turn ledger write →
React state update → DOM rendering of the assistant turn.

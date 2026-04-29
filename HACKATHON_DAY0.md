# NodeBench — Day 0 Hackathon Onboarding

**For attendees** trying NodeBench live for the first time.
**For organizers** verifying multi-user readiness before the event.

---

## What is NodeBench?

An entity-intelligence agent. You type messy notes ("Met Alex from
Orbital Labs"), it captures structured side effects (entities, claims,
sources, relationships, follow-ups) — every chat turn lands in your
workspace ledger.

Two ways to use it during the hackathon:

1. **Browser** — open the URL (below), start chatting. Anonymous,
   no signup required.
2. **Your own AI tool** (Claude Desktop / Cursor / Windsurf) via the
   MCP server — your AI can read + write your NodeBench workspace.

---

## Attendee Quick Start (60 seconds)

### Step 1 — Open the live URL

```
https://www.nodebenchai.com/?surface=workspace
```

Click the **Chat** tab if you land elsewhere.

### Step 2 — Pick your model

Click the model badge in the composer (bottom of chat). Default is
**Nemotron 3 Super 120B** (free, leaderboard #1 reliable). The picker
shows benchmark scores per model so you can compare.

Recommended for hackathon use:
- **Nemotron 3 Super 120B** — best free, 5/8 pass @ 0 errors
- **Hunyuan 3 Preview** — fastest free, sub-5s avg
- **Kimi K2.6** — paid frontier (~$0.002/call); use sparingly

### Step 3 — Try a capture

Type into the composer:

```
Met Priya from Acme Bio at SciCon. AI lab notebooks with Benchling
integration. Looking for early users in pharma R&D.
```

Click send. You should see:
- An optimistic user turn appear immediately
- ~5-30s later, an agent turn with:
  - Run bar showing `model · duration · cost`
  - Inline run-update chips: `Entity captured · Acme Bio`, `Edge ·
    priya works-at acme-bio`, `Claim · needs_review`, etc.
  - 4 hover-revealed action chips (Save / Watch / Re-run / Share)

### Step 4 — Try the prompt enhancer

Type a vague prompt like `"Tell me about Mercury"` then click the
**Sparkles** icon (left of textarea, in the attach row). The composer
text gets rewritten with workspace context + acceptance criteria.
Edit if needed, then send.

### Step 5 — Reload the page

Your captures persist. The "Temporary workspace" banner shows your
session id — captures save under that id on this browser only. Click
**Claim workspace →** to sign in with Google and migrate everything
to a permanent account (cross-device).

---

## Organizer Pre-flight Checklist

Run before the event opens to attendees.

### A. Backend health
- [ ] Convex prod deployment is current
      `npx convex deploy --prod` (or `npx convex dev --once` against prod)
      Verify: https://agile-caribou-964.convex.cloud
- [ ] OPENROUTER_API_KEY env var set in Convex
      `npx convex env get OPENROUTER_API_KEY` returns a value
- [ ] AUTH_GOOGLE_ID + AUTH_GOOGLE_SECRET set (for Claim Workspace flow)
      `npx convex env get AUTH_GOOGLE_ID`

### B. Frontend deployment
- [ ] Vercel deploy is current; bundle hash on prod matches the
      latest main branch commit
- [ ] `https://www.nodebenchai.com` loads without console errors
- [ ] `/?surface=workspace` renders the chat surface (not blank)
- [ ] Model picker opens; the top free model shows leaderboard rank
      `#2 green` (Nemotron 3 Super) as the default

### C. Cost ceiling guards
- [ ] Per-anon-session rate limit active in `runChatAgent`:
      - 60 calls per 10-min window
      - $0.50 cumulative paid cost per 60-min window
      - Returns ok=false with reason on cap; does NOT silently drop
- [ ] If using paid models, set OpenRouter spending limits via their
      dashboard as a hard cap (in addition to per-session limits)

### D. Multi-tenancy verification
Open two incognito windows. Each should:
- [ ] Get a different `localStorage["nodebench:product-anon-session"]`
- [ ] See the seed turns + banner on first land
- [ ] Independent captures (incognito A's "Met Alex" doesn't appear
      in incognito B's chat thread)
- [ ] Independent rate-limit budgets

### E. MCP server (for advanced attendees)
- [ ] `packages/mcp-nodebench-workspace/dist/index.js` is built
      `cd packages/mcp-nodebench-workspace && npm run build`
- [ ] README on session-id linking is current and accessible at
      `packages/mcp-nodebench-workspace/README.md`

---

## Sharing one workspace across browser + AI tool

Power users — link Claude Desktop, Cursor, or Windsurf to your
browser workspace:

1. In your browser, DevTools → Application → Local Storage →
   copy the value of `nodebench:product-anon-session`
2. Add to your MCP config:

```json
{
  "mcpServers": {
    "nodebench-workspace": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp-nodebench-workspace/dist/index.js"],
      "env": {
        "CONVEX_URL": "https://agile-caribou-964.convex.cloud",
        "NODEBENCH_ANON_SESSION_ID": "PASTE-YOUR-BROWSER-SESSION-HERE"
      }
    }
  }
}
```

3. Restart your MCP client.
4. Now your AI tool can:
   - `listEntities` to see what you've captured
   - `recallEntityMemory(slug)` to read prior context
   - `upsertEntity` / `recordClaim` / `attachSource` /
     `createFollowup` / `addGraphEdge` to write
   - `enhancePrompt` to rewrite vague queries
   - `createGmailDraft` for outreach

⚠️ **Treat the session id as a bearer token.** Don't share it.

---

## Cost expectations

| Pattern | Estimated cost per attendee per hour |
|---|---|
| All free models | $0.00 |
| Mostly free, occasional Kimi K2.6 | $0.05 - $0.15 |
| Heavy Kimi K2.6 use | $0.30 - $0.50 (capped by per-session ceiling) |

The $0.50/hour cap is enforced server-side. After hitting the cap,
the agent returns `ok: false, errorMessage: "cost_limit: ..."`. The
user can switch to a free model and continue.

For 30 concurrent hackathon attendees with a mix of usage:
- Worst case ~$15/hour
- Realistic ~$3-5/hour given most queries hit free models

---

## Known limits / what's NOT in day-0

These are deferred for post-hackathon iteration:

1. **No "claim workspace" auto-prompt** — banner is always visible
   for anon users; we don't yet upsell after N captures
2. **No anon-token rotation** — session id is the bearer; if a user
   shares it, the recipient gets full read/write
3. **No cross-device anon sync** — sign in with Google to merge
4. **MCP server local-only** — attendees need to install + build
   it themselves (no hosted MCP gateway yet)
5. **Rate limit is in-memory** — restarts reset the windows. For
   a single Convex worker process this is fine; multi-worker would
   need a shared store (Convex's own rate-limit primitives, etc.)

---

## Troubleshooting

### "Agent unavailable: rate_limit"
You hit 60 calls in 10 minutes. Wait ~30 seconds; pruning is sliding-
window, so older calls drop out continuously. If you're using paid
models, you may have hit the $0.50/hour cap — switch to a free model.

### "Agent unavailable: rate"
The model returned a 429 from the upstream provider. The auto-router
will park that model for 60s and try the next. Wait or pick a
different model from the picker.

### Tool calls fired but no DB record
Check the Convex deployment URL in DevTools → Network. The HTTP call
to `/api/action/.../runChatAgent` should be 200. If 401/403,
`anonymousSessionId` may not be plumbed through (check
`localStorage["nodebench:product-anon-session"]` exists).

### Banner says "Claim workspace" but Google sign-in fails
Likely the `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` Convex env vars
aren't set, or the redirect URI isn't allow-listed in your Google
OAuth console. Fix in Convex env + Google Cloud Console.

---

## Files for the curious

- `convex/domains/product/chatAgent.ts` — the agent, tools, rate-limit, cooldown
- `convex/domains/product/activity.ts` — ledger insert
- `convex/domains/product/helpers.ts` — `requireProductIdentity`,
  `resolveProductReadOwnerKeys`
- `src/features/designKit/exact/ExactKit.tsx` — chat surface, banner,
  model picker, send turn
- `src/features/financialOperator/components/ModelPicker.tsx` —
  benchmark-aware model selector
- `packages/mcp-nodebench-workspace/` — MCP server (12 tools)
- `docs/architecture/MULTI_TENANCY.md` — full identity model
- `scripts/eval/model-leaderboard/runs/2026-04-29T17-42-30/leaderboard.md` —
  16-model free-tier leaderboard
- `scripts/eval/nodebench-loop/KIMI_VS_FREE.md` — paid vs free at +12pts

# Multi-Tenancy & End-to-End Identity

How NodeBench keeps user data isolated across the chat surface, the
agent action, the MCP server, and external MCP clients (Claude Desktop,
Cursor, Windsurf).

---

## TL;DR

- Every product table has an `ownerKey: string` column.
- `ownerKey` shape:
  - `"anon:<sessionId>"` for anonymous users (per-browser localStorage)
  - `"user:<userId>"` for authenticated users (Convex Auth)
- Every Convex query/mutation/action that touches product data calls
  `requireProductIdentity(ctx, anonymousSessionId)` or
  `resolveProductReadOwnerKeys(ctx, anonymousSessionId)` to derive the
  caller's `ownerKey`.
- All writes carry `ownerKey`; all reads filter by `ownerKey` via the
  `by_owner_*` indexes.
- On sign-up, anonymous data is migrated `anon:<sessionId>` →
  `user:<userId>` so the user keeps everything they captured.
- For MCP clients: each config sets `NODEBENCH_ANON_SESSION_ID` to a
  stable id; if it matches the user's browser session id, the same
  workspace is shared.

---

## The two identity layers

### Layer A — anonymous browser session

Lives in `localStorage` under `nodebench:product-anon-session`. Created
by `getAnonymousProductSessionId()` in
`src/features/product/lib/productIdentity.ts` on first page load. The
value is a stable random string of the form `anon-<base36>`.

Pros:
- Zero-friction onboarding (no sign-up before first capture)
- Survives reloads
- Survives across days (localStorage persists)

Limits:
- Per-browser (clearing storage = losing data; phone vs laptop = two
  different workspaces)
- Per-device (no cross-device sync)
- Per-incognito-window (each incognito is its own anon session)

### Layer B — authenticated user

Convex Auth (`@convex-dev/auth`). `getAuthUserId(ctx)` returns the
user's id when signed in. `ownerKey` becomes `"user:<userId>"`.

Pros:
- Cross-device (sign in on phone, see same data)
- Cross-browser
- Survives storage clear
- Enables shared entity workspaces (`productEntityWorkspaceMembers`,
  `productEntityWorkspaceInvites` tables)

The migration from anon → user happens in `requireProductIdentity` on
first call after sign-up. Existing rows with
`ownerKey="anon:<oldSessionId>"` get patched to
`ownerKey="user:<newUserId>"`.

---

## End-to-end story when a new user lands

### t=0 — first paint

```
1. Browser hits /?surface=ask
2. App boots → getAnonymousProductSessionId() runs
   - localStorage["nodebench:product-anon-session"] is null
   - Generates "anon-{base36}" + writes it to localStorage
   - Returns the new id
3. Demo data renders (no Convex calls required for ask surface)
4. User sees the landing pitch — no auth wall, no friction
```

### t=1 — user clicks Chat tab → /?surface=workspace

```
5. ExactChatSurface mounts
6. useQuery(getMostRecentChatThread, { anonymousSessionId })
   - Convex receives anonymousSessionId="anon-{base36}"
   - resolveProductReadOwnerKeys returns ["anon:anon-{base36}"]
   - Index lookup on productActivityLedger by_owner_activity_created
   - First-time user → 0 rows → query returns null
7. Seed turns render (ORBITAL_THREAD_TURNS demo)
   - User sees Alex/Orbital Labs sample conversation
   - Clear visual signal this is demo, not their data
```

**Gap fixed in this commit:** anonymous session banner now visible above
the chat header so the user knows the demo is fake and their captures
will be saved under a temporary anon id.

### t=2 — user sends first message

```
8. User types "Met Priya from Acme Bio…" + clicks send
9. sendTurn(text):
   a. Optimistic local user turn appended to React state
   b. runChatAgent({
        text, model: activeModel, sessionId: chatSessionIdRef.current,
        anonymousSessionId: "anon-{base36}",
      })
10. Convex action runChatAgent:
    a. recordActivity({
         anonymousSessionId, activityType: "chat_message",
         actorType: "user", payloadPreview: { metadata: { text } }
       })
       → requireProductIdentity returns
         { ownerKey: "anon:anon-{base36}", isAnonymous: true }
       → ledger row inserted with that ownerKey
    b. pi-ai complete() with TOOLS array (5 atomic edits)
    c. For each tool_call returned by the model:
       executeTool(ctx, name, args, {
         anonymousSessionId: "anon-{base36}",  // ← fixed
         sessionId,
       })
       → each tool calls recordActivity with the SAME anonymousSessionId
       → all side effects scoped to "anon:anon-{base36}"
    d. Final agent turn persisted with toolExecs metadata
11. liveThread query refreshes (Convex reactive subscription)
    a. getMostRecentChatThread now returns 2 turns
    b. UI swaps seed → live thread
    c. User sees their actual capture rendered with run-bar
```

### t=∞ — same browser, days later

```
12. localStorage still has "anon-{base36}"
13. All queries scope to ownerKey="anon:anon-{base36}"
14. User's accumulated captures, entities, claims, follow-ups all
    show up
```

### Sign-up flow

```
15. User clicks "Sign in" → Convex Auth flow (Google/email/etc.)
16. After sign-in, getAuthUserId returns the new userId
17. Next requireProductIdentity call:
    - Detects anonymousSessionId still in client request
    - Migrates "anon:anon-{base36}" rows → "user:<userId>"
    - Returns { ownerKey: "user:<userId>", isAnonymous: false }
18. From now on, queries filter by user:<userId>
19. User installs the app on phone:
    - Phone has different localStorage (no anon session)
    - User signs in with same account → ownerKey="user:<userId>"
    - Sees the same data
```

---

## Multi-tenancy correctness invariants

These are the rules every new query/mutation MUST honor:

1. **Always derive ownerKey from the request, never trust client args.**
   `requireProductIdentity(ctx, anonymousSessionId)` is the only
   sanctioned path. Don't accept `ownerKey` as a direct argument.

2. **Index every read by ownerKey first.**
   Every product table has `by_owner_*` indexes. Use them. A query that
   does `ctx.db.query("productEntities").collect()` with manual filter
   leaks data on large tables.

3. **Write ownerKey on every insert.**
   `insertProductActivity` does this for the activity ledger. Each
   table has an analogous insert helper that requires ownerKey.

4. **Resolve READ owner keys for sharing.**
   Use `resolveProductReadOwnerKeys` which can return multiple keys
   when a workspace is shared. Don't assume the caller's ownerKey is
   the only one to query.

5. **Anonymous rate-limit by sessionId.**
   To prevent one bad actor spinning up many anon sessions, server-side
   rate-limits should bucket by `ownerKey` not by IP.

---

## MCP server multi-tenancy

`packages/mcp-nodebench-workspace` runs as a stdio server in the user's
MCP client (Claude Desktop, Cursor, Windsurf). Each client config
provides:

```json
{
  "mcpServers": {
    "nodebench-workspace": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": {
        "CONVEX_URL": "https://agile-caribou-964.convex.cloud",
        "NODEBENCH_ANON_SESSION_ID": "anon-USER-SPECIFIC-ID-HERE"
      }
    }
  }
}
```

### Two patterns for `NODEBENCH_ANON_SESSION_ID`

**Pattern 1 — fresh anon session for the MCP client.**
Don't set the env var. The server generates `mcp-anon-<timestamp>` on
start. All tool calls scope to that session. Pros: clean isolation.
Cons: a new session each time the MCP server restarts.

**Pattern 2 — link MCP to your browser session.**
1. Open `nodebenchai.com` in your browser.
2. DevTools → Application → Local Storage → copy the value of
   `nodebench:product-anon-session`.
3. Paste that into `NODEBENCH_ANON_SESSION_ID` in your MCP config.
4. Restart your MCP client.
5. Now tool calls from Claude Desktop / Cursor / Windsurf land in
   the SAME workspace as your browser. Read tools see your captures;
   write tools update them.

**Pattern 3 (future) — auth-token-based linking.**
Once Convex Auth is wired into the MCP server, the env var becomes
`NODEBENCH_AUTH_TOKEN` and the server resolves it to the userId
server-side. Cross-device, cross-tool, single source of truth. Tracked
as a follow-up; not shipped yet.

### What if multiple MCP clients share the same session id?

That's fine — they all write to the same `ownerKey`. Useful for power
users who want Cursor + Claude Desktop + their browser to see one
shared workspace. The server doesn't need to negotiate; Convex
serializes writes per row.

What's NOT fine: leaving `NODEBENCH_ANON_SESSION_ID` unset across many
MCP clients on different users' machines. They'd get different
auto-generated ids each restart. Set the env var explicitly.

---

## Threats and mitigations

| Threat | Mitigation |
|---|---|
| Adversarial client passes another user's anon session id | Anon ids are random; bruteforce-impractical at base36 ≥ 10 chars. Sign-up + migration is the long-term answer for sensitive data. |
| Anonymous session id leaks via URL / shared screenshot | Never put the id in URLs; only in localStorage + Authorization header equivalents. Future: hash the id server-side before using as ownerKey suffix. |
| Cross-user data via shared MCP server process | Single process, single user — that's the point. NEVER share the MCP `NODEBENCH_ANON_SESSION_ID` across operators. |
| Anonymous data lost on storage clear | Sign-up + migration. Surface the "claim your workspace" prompt after N captures. |
| MCP server impersonates Convex action calls | Convex auth gate is server-side; MCP just forwards a session id. The session id itself is the bearer token here. Treat it like one. |

---

## What's shipped vs queued

**Shipped (this PR):**
- Anonymous session banner on chat surface (this commit).
- Multi-tenancy doc (this file).
- MCP README updated with the three session-linking patterns.
- Per-tool `anonymousSessionId` plumbed through `runChatAgent` →
  `executeTool` → `recordActivity` (fixed in earlier commit
  092b2679).

**Queued (follow-ups):**
- "Claim your workspace" prompt after N captures (anon → user upsell).
- `NODEBENCH_AUTH_TOKEN` env var for MCP (auth-based linking).
- Server-side anon session hashing before owner-key derivation.
- Cross-device anon → anon merging via QR code (low priority).

---

## Where to read the code

- Anon session id: `src/features/product/lib/productIdentity.ts`
- Identity gate: `convex/domains/product/helpers.ts` →
  `requireProductIdentity`, `resolveProductReadOwnerKeys`
- Activity ledger insert: `convex/domains/product/activity.ts` →
  `insertProductActivity`
- Chat agent action: `convex/domains/product/chatAgent.ts` →
  `runChatAgent`, `enhancePrompt`, `executeTool`
- MCP server: `packages/mcp-nodebench-workspace/src/index.ts`
- Identity workspace sharing: `convex/domains/product/shares.ts`,
  `convex/domains/product/schema.ts` →
  `productEntityWorkspaceMembers`, `productEntityWorkspaceInvites`

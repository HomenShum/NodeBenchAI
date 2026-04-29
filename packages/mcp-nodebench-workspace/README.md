# nodebench-mcp-workspace

Atomic-edit MCP server for NodeBench. Lets ANY MCP-capable agent
(Claude Desktop, Cursor, Windsurf, custom) call NodeBench's 5
canonical workspace primitives — not just our pi-ai chat surface.

## Tools

| Tool | Purpose |
|---|---|
| `upsertEntity` | Create / update a typed entity (company / person / topic / event) |
| `recordClaim` | Record a claim with `verified` / `needs_review` / `rumor` status |
| `attachSource` | Attach a source URL to an entity |
| `createFollowup` | Create a concrete next-action task |
| `addGraphEdge` | Record a typed edge between two entities |

These mirror the same 5 atomic-edit primitives in
`convex/domains/product/chatAgent.ts` so the chat surface and external
agents share one canonical write path through `productActivityLedger`.

## Setup

1. `cd packages/mcp-nodebench-workspace && npm install && npm run build`
2. Add to your MCP client config (Claude Desktop example):

```json
{
  "mcpServers": {
    "nodebench-workspace": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp-nodebench-workspace/dist/index.js"],
      "env": {
        "CONVEX_URL": "https://agile-caribou-964.convex.cloud",
        "NODEBENCH_SESSION_ID": "your-session-id-here"
      }
    }
  }
}
```

3. Restart your MCP client. The 5 tools should appear in the tool list.

## Cursor / Windsurf

Same `mcpServers` shape works for Cursor and Windsurf — refer to their
respective MCP server config docs.

## Multi-tenancy & session linking

Each `NODEBENCH_ANON_SESSION_ID` value maps to a distinct workspace
(scoped to `ownerKey="anon:<sessionId>"` server-side). Three patterns
to choose from:

### Pattern 1 — Fresh anon session per MCP client
Don't set the env var. The server generates `mcp-anon-<timestamp>` on
each start. Cleanest isolation; downside is a new session every restart.

### Pattern 2 — Link MCP to your browser workspace (recommended)
1. Open `https://nodebenchai.com` in your browser.
2. DevTools → Application → Local Storage → copy the value of
   `nodebench:product-anon-session`.
3. Paste it as `NODEBENCH_ANON_SESSION_ID` in your MCP config.
4. Restart your MCP client.

Now Claude Desktop / Cursor / Windsurf see the same captures, entities,
and claims as your browser. `listEntities` from the MCP returns
everything you've captured in the chat surface, and vice-versa.

### Pattern 3 — Multi-tool single workspace
Set the same `NODEBENCH_ANON_SESSION_ID` in every MCP config you have.
All your AI tools land in one shared workspace.

⚠️ NEVER share `NODEBENCH_ANON_SESSION_ID` across operators / users.
The session id IS the bearer token — anyone with it can read and
write the workspace.

See [`docs/architecture/MULTI_TENANCY.md`](../../docs/architecture/MULTI_TENANCY.md)
for the full identity model, anon → user migration, and threat model.

## Why a separate package?

- The pi-ai chat surface uses these tools internally via Convex action
  (`runChatAgent`). External agents don't have Convex action access; they
  speak MCP.
- One canonical write path: every tool call from any agent (chat, MCP,
  CLI) lands in `productActivityLedger` with the same shape. Single
  source of truth for the workspace state.
- BOUND_READ + 30s timeout per tool call enforced at the MCP layer.

## Reliability invariants

Per `.claude/rules/agentic_reliability.md`:

- **HONEST_STATUS**: each tool returns the real Convex success/failure;
  never fakes a 2xx
- **BOUND_READ**: payload bounds enforced server-side by the Convex
  validator (text ≤ 280, slug ≤ 200, url ≤ 500)
- **TIMEOUT**: 30s per tool call (Promise.race)
- **ERROR_BOUNDARY**: every tool wrapped in try/catch
- **DETERMINISTIC**: tool call IDs derive from MCP request IDs so
  replays produce stable activity ids

## Local smoke

```bash
# After `npm run build`:
CONVEX_URL=https://agile-caribou-964.convex.cloud node dist/index.js
# Then send MCP requests via stdio (see Anthropic MCP docs).
```

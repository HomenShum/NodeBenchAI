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

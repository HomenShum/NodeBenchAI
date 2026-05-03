# NodeBench MCP Tool Profiles

The unified NodeBench MCP gateway keeps one deployable service, but clients should not receive the full internal tool catalog by default. Tool profiles provide small, task-specific catalogs for external builders while preserving the full 114-tool internal surface.

## Production Endpoint

```txt
https://nodebench-mcp-unified.onrender.com
```

## Profiles

| Profile | Intended client | Tool count |
| --- | --- | ---: |
| `public-research` | External apps that need public entity research memory | 14 |
| `gmail-research` | Gmail/job-match integrations | 10 |
| `documents` | Document and spreadsheet agents | 21 |
| `memory` | Agent memory clients | 5 |
| `financial` | Market, macro, crypto, and news lookups | 10 |
| `knowledge` | Knowledge graph and source registry clients | 11 |
| `builder` | Builder-facing agents that need research, docs, memory, planning, and search | 55 |
| `internal-full` / `full` | Internal NodeBench operators and eval harnesses | 114 |

Counts include the profile-scoped `findTools` meta-tool. In a profile, `findTools` only searches the visible tools for that profile.

## Selecting A Profile

HTTP MCP clients can request a profile with either a query parameter or header:

```txt
https://nodebench-mcp-unified.onrender.com?profile=public-research
```

```http
x-nodebench-profile: public-research
```

or:

```http
x-mcp-profile: public-research
```

If the server is configured with a profile-scoped token, the token wins over query/header profile requests. For example, a `gmail-research` token cannot request `full`.

Hosted production allows anonymous access to the public profiles listed in `MCP_PUBLIC_PROFILES`:

```txt
public-research,gmail-research
```

That means external Gmail/job integrations can call the hosted MCP URL with `?profile=gmail-research` and no token. Internal, builder, document, memory, and full profiles still require a token when `MCP_HTTP_TOKEN` or `MCP_PROFILE_TOKENS` is configured.

## Accounts, Metering, And Cost Tracking

The hosted MCP gateway is frictionless for public research, but still account-aware:

- Token calls are attributed to a stable `token:<hash>` account key.
- Anonymous public calls are attributed to a stable `anon:<profile>:<hash>` account key derived from request metadata without storing raw tokens.
- Every tool call writes to the MCP ledger with profile, auth mode, client name, request id, estimated cost units, and estimated USD.
- Daily rollups are stored by tier, tool, profile, account, account/tool, and account/profile.

Every JSON-RPC response includes the same accounting metadata:

```json
{
  "result": {
    "_meta": {
      "nodebench": {
        "requestId": "uuid",
        "profile": "gmail-research",
        "authMode": "anonymous",
        "accountKey": "anon:gmail-research:...",
        "accounting": {
          "ledger": "mcpToolCallLedger",
          "costModel": "mcp-cost-v1-2026-05",
          "costType": "estimated"
        }
      }
    }
  }
}
```

The gateway also sends these HTTP headers so apps and agents can log them without parsing the MCP result:

```txt
x-nodebench-request-id
x-nodebench-profile
x-nodebench-auth-mode
x-nodebench-account-key
```

Recommended client headers:

```http
x-nodebench-client: gmail-dashboard
x-nodebench-client-version: 1.0.0
x-nodebench-client-id: stable-install-or-workspace-id
```

`x-nodebench-client-id` is optional but recommended. It gives anonymous public-profile clients stable usage attribution without requiring a NodeBench login or token. Do not put private email text, resume text, API keys, or other sensitive data in this header. Rotate this value only when you intentionally want a new anonymous accounting bucket.

For operations views, use Convex:

```powershell
npx convex run --push "domains/mcp/mcpToolLedger:getUsageAndCostSnapshot" "{dateKey:'2026-05-03',limit:20}"
```

For one requester:

```powershell
npx convex run --push "domains/mcp/mcpToolLedger:getUsageAndCostSnapshot" "{accountKey:'anon:gmail-research:<hash>',limit:20}"
```

Cost values are estimates for product control and abuse detection. Provider invoices remain the source of truth for final billing reconciliation.

## Environment Variables

```txt
MCP_HTTP_TOKEN=<internal full-access token>
MCP_DEFAULT_PROFILE=full
MCP_PROFILE_TOKENS=<token1>:public-research,<token2>:gmail-research,<token3>:builder
MCP_PUBLIC_PROFILES=public-research,gmail-research
```

Recommended production setup:

- Keep `MCP_HTTP_TOKEN` as the internal full-access token.
- Keep `public-research` and `gmail-research` anonymous for frictionless public-source integrations.
- Issue external users profile-scoped tokens through `MCP_PROFILE_TOKENS` when they need non-public profiles or custom budgets.
- Use `MCP_DEFAULT_PROFILE=public-research` only for a public demo service where full internal access is not needed through the same endpoint.

For stdio clients:

```txt
MCP_PROFILE=public-research
```

or:

```txt
MCP_DEFAULT_PROFILE=public-research
```

## Public Research Client Config

```json
{
  "mcpServers": {
    "nodebench-public-research": {
      "transport": "http",
      "url": "https://nodebench-mcp-unified.onrender.com?profile=public-research"
    }
  }
}
```

Visible tools:

```txt
nodebench.entities.resolve
nodebench.search_public_sources
nodebench.research_company
nodebench.research_person
nodebench.research_role
nodebench.dossiers.get
nodebench.context.pack
nodebench.get_matching_context
nodebench.compile_interview_packet
nodebench.claims.submit_public
nodebench.claims.verify
nodebench.watch_entity
nodebench.link_private_signal_to_public_entity
findTools
```

## Gmail Research Client Config

```json
{
  "mcpServers": {
    "nodebench-gmail-research": {
      "transport": "http",
      "url": "https://nodebench-mcp-unified.onrender.com?profile=gmail-research"
    }
  }
}
```

Visible tools:

```txt
nodebench.entities.resolve
nodebench.search_public_sources
nodebench.research_company
nodebench.research_person
nodebench.research_role
nodebench.dossiers.get
nodebench.context.pack
nodebench.get_matching_context
nodebench.compile_interview_packet
findTools
```

## Smoke Tests

```powershell
$url = "https://nodebench-mcp-unified.onrender.com?profile=public-research"

Invoke-RestMethod "$url" -Method Post -ContentType "application/json" -Body (@{
  jsonrpc = "2.0"
  id = 1
  method = "tools/list"
} | ConvertTo-Json)
```

Expected:

- `result.profile` is `public-research`
- `result.authMode` is `anonymous` on hosted production
- `result.tools.length` is `14`
- no document, planning, eval, or internal-only tools appear

Blocked-call check:

```powershell
Invoke-RestMethod "$url" -Method Post -ContentType "application/json" -Body (@{
  jsonrpc = "2.0"
  id = 2
  method = "tools/call"
  params = @{
    name = "createDocument"
    arguments = @{ title = "Should be blocked" }
  }
} | ConvertTo-Json -Depth 5)
```

Expected JSON-RPC error message:

```txt
Tool not found in profile "public-research": createDocument
```

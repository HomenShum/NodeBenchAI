# NodeBench Public Research Integration

NodeBench is the public research memory and tool server. Calling apps send entity signals and research intent. NodeBench resolves entities, runs public-source research, stores sourced public claims, and returns compact context packs.

Private apps keep private context and actions. Gmail, CRM, calendar, and resume-aware apps must not store raw private data in NodeBench public research memory.

## Production Status

This surface is production-ready when these checks pass against the deployed API host:

- `npx tsc --noEmit --pretty false`
- `npx convex codegen`
- `npx convex dev --once --typecheck=enable`
- `npx vitest run apps/api-headless/src/routes/publicResearch.routes.test.ts src/features/home/views/HomeLanding.test.ts packages/mcp-local/src/__tests__/nodebenchResearchTools.test.ts`
- `npm --prefix apps/api-headless run build`
- `npm run build`
- Live smoke commands in this guide return 2xx responses with source refs.

## Base URLs

Local:

```txt
http://127.0.0.1:8020/v1/public-research
```

Production:

```txt
https://<nodebench-api-host>/v1/public-research
```

## Authentication

Production requires an API key:

```http
Authorization: Bearer <NODEBENCH_API_KEY>
```

or:

```http
X-API-Key: <NODEBENCH_API_KEY>
```

Configure API keys in `apps/api-headless` with `API_KEYS`:

```json
[
  {
    "key": "nb_live_partner_...",
    "clientId": "gmail-app-prod",
    "clientOrg": "partner-app",
    "scopes": ["public_research:read", "public_research:write"],
    "rateLimit": 120
  }
]
```

Use `public_research:read` for dossier/context reads and `public_research:write` for resolve, research runs, claim submission, verification, private-signal linking, and watch operations.

## Private/Public Boundary

Allowed inputs:

- Company/person/role/product names
- Company domain
- Public job URL
- Sender domain
- Short private-signal summary if necessary
- Approved pinned artifact summary, not raw content

Forbidden inputs:

- Raw email bodies
- Raw resume text
- Private notes
- Private file contents
- Personal preferences
- Private fit scoring features

NodeBench returns public context only. The calling app performs private scoring locally.

## Gmail Job Flow

```txt
Gmail job email
-> extract companyName, roleTitle, senderDomain, recruiterName
-> call NodeBench public research
-> receive company/person/role context pack
-> store/display "Research: verified" and source refs
-> score fit locally against private resume/profile
```

## Endpoints

### Resolve Entity

```http
POST /entities/resolve
```

Request:

```json
{
  "entityType": "company",
  "name": "OpenAI",
  "domain": "openai.com",
  "aliases": ["OpenAI recruiter email"]
}
```

Response includes:

```json
{
  "entityId": "...",
  "entityKey": "company:openai.com",
  "canonicalName": "OpenAI",
  "aliases": ["OpenAI"],
  "domains": ["openai.com"],
  "confidence": 0.86,
  "candidates": []
}
```

### Research Company

```http
POST /research/company
```

Request:

```json
{
  "companyName": "OpenAI",
  "domain": "openai.com",
  "visibility": "private_guided",
  "goal": "Public job-match context for Product Engineer at OpenAI"
}
```

This stores public claims and returns a sourced dossier.

### Research Person

```http
POST /research/person
```

Request:

```json
{
  "personName": "Sam Altman",
  "visibility": "private_guided",
  "goal": "Public recruiter or interview-prep context"
}
```

Do not ask NodeBench to infer sensitive traits.

### Research Role

```http
POST /research/role
```

Request:

```json
{
  "roleTitle": "Product Engineer",
  "companyName": "OpenAI",
  "goal": "Public role and company context for Gmail job review"
}
```

Response includes a `contextPack` suitable for Gmail-local scoring.

### Get Context Pack

```http
POST /context/pack
```

Request:

```json
{
  "entityKey": "company:openai.com",
  "useCase": "job_match"
}
```

Supported `useCase` values:

```txt
job_match
interview_prep
sales_research
general
```

Response shape:

```json
{
  "contextPack": {
    "entity_id": "...",
    "entity_key": "company:openai.com",
    "entity_name": "OpenAI",
    "use_case": "job_match",
    "summary": "...",
    "signals": [
      {
        "type": "product",
        "text": "...",
        "confidence": 0.72
      }
    ],
    "risks": [],
    "missing_info": [],
    "freshness": {
      "last_researched_at": 1777760000000,
      "ttl_ms": 2592000000
    },
    "sources": [
      {
        "title": "OpenAI",
        "url": "https://openai.com",
        "evidence": "...",
        "retrievedAt": 1777760000000
      }
    ],
    "private_boundary": "Public pack only. Private fit scoring must remain in the calling app."
  }
}
```

### Get Dossier

```http
GET /dossiers/:entityKey
```

Use URL encoding for keys:

```txt
/dossiers/company%3Aopenai.com
```

### Submit Public Claim

```http
POST /claims/submit-public
```

Request:

```json
{
  "entity": {
    "entityType": "company",
    "name": "OpenAI",
    "domain": "openai.com"
  },
  "claim": "OpenAI publishes API documentation for developers.",
  "claimType": "product",
  "sourceUrl": "https://platform.openai.com/docs",
  "sourceTitle": "OpenAI API docs",
  "evidenceSnippet": "Public documentation page for OpenAI API developers.",
  "confidence": 0.8,
  "submittedBySurface": "gmail"
}
```

The verifier rejects non-public URLs and private email/resume language.

### Verify Claim

```http
POST /claims/verify
```

Request:

```json
{
  "claimId": "<claim id>"
}
```

### Latest Public Research

```http
GET /latest?limit=8
```

Used by the NodeBench Home landing page to show recent public entity research.

## TypeScript Client Example

```ts
type NodeBenchContextPackResponse = {
  requestId: string;
  contextPack: {
    entity_key: string;
    entity_name: string;
    summary: string;
    signals: Array<{ type: string; text: string; confidence: number }>;
    risks: string[];
    sources: Array<{ title: string; url: string; evidence: string; retrievedAt: number }>;
    private_boundary: string;
  } | null;
};

export async function getNodeBenchJobContext(input: {
  apiBaseUrl: string;
  apiKey: string;
  companyName: string;
  roleTitle?: string;
  senderDomain?: string;
}): Promise<NodeBenchContextPackResponse> {
  const research = await fetch(`${input.apiBaseUrl}/v1/public-research/research/company`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      companyName: input.companyName,
      domain: input.senderDomain,
      visibility: "private_guided",
      goal: input.roleTitle
        ? `Public job-match context for ${input.roleTitle} at ${input.companyName}`
        : `Public job-match context for ${input.companyName}`,
    }),
  });

  if (!research.ok) {
    throw new Error(`NodeBench research failed: ${research.status} ${await research.text()}`);
  }

  const researchJson = await research.json();
  const entityKey = researchJson.dossier?.entity?.entityKey;
  if (!entityKey) {
    return { requestId: researchJson.requestId, contextPack: null };
  }

  const pack = await fetch(`${input.apiBaseUrl}/v1/public-research/context/pack`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({ entityKey, useCase: "job_match" }),
  });

  if (!pack.ok) {
    throw new Error(`NodeBench context pack failed: ${pack.status} ${await pack.text()}`);
  }

  return await pack.json();
}
```

## MCP Usage

For hosted MCP, use the scoped public research profile so clients see only the research-memory tools:

```txt
https://nodebench-mcp-unified.onrender.com?profile=public-research
```

The hosted `public-research` and `gmail-research` profiles are designed for tokenless public-source integrations. Use a profile-scoped token only when you need custom budgets or non-public profiles:

```http
x-mcp-token: <NODEBENCH_PUBLIC_RESEARCH_TOKEN>
```

Gmail/job integrations should use:

```txt
NODEBENCH_MCP_URL=https://nodebench-mcp-unified.onrender.com?profile=gmail-research
NODEBENCH_MCP_PROFILE=gmail-research
```

No `NODEBENCH_MCP_TOKEN` is required for this public profile. The calling app must still keep Gmail, resume, and fit scoring local.

See `docs/guides/MCP_TOOL_PROFILES.md` for token-scoped profiles and full gateway configuration.

For local/package MCP, set:

```txt
NODEBENCH_API_URL=https://<nodebench-api-host>
NODEBENCH_API_KEY=<partner key>
```

Tools exposed by `nodebench-mcp`:

```txt
nodebench.entities.resolve
nodebench.search_public_sources
nodebench.research_company
nodebench.research_person
nodebench.research_role
nodebench.get_entity_dossier
nodebench.get_matching_context
nodebench.compile_interview_packet
nodebench.context.pack
nodebench.submit_public_claim
nodebench.claims.verify
nodebench.watch_entity
nodebench.link_private_signal_to_public_entity
```

## Live Smoke

Replace variables first:

```powershell
$base = "https://<nodebench-api-host>/v1/public-research"
$key = "<NODEBENCH_API_KEY>"
```

Resolve:

```powershell
Invoke-RestMethod "$base/entities/resolve" -Method Post -Headers @{Authorization="Bearer $key"} -ContentType "application/json" -Body (@{
  entityType = "company"
  name = "OpenAI"
  domain = "openai.com"
} | ConvertTo-Json)
```

Research:

```powershell
Invoke-RestMethod "$base/research/company" -Method Post -Headers @{Authorization="Bearer $key"} -ContentType "application/json" -Body (@{
  companyName = "OpenAI"
  domain = "openai.com"
  visibility = "private_guided"
  goal = "Public job-match smoke test"
} | ConvertTo-Json)
```

Context pack:

```powershell
Invoke-RestMethod "$base/context/pack" -Method Post -Headers @{Authorization="Bearer $key"} -ContentType "application/json" -Body (@{
  entityKey = "company:openai.com"
  useCase = "job_match"
} | ConvertTo-Json)
```

Latest:

```powershell
Invoke-RestMethod "$base/latest?limit=5" -Headers @{Authorization="Bearer $key"}
```

## Acceptance Criteria For Other Apps

- No raw private text is sent to NodeBench.
- Every displayed public fact has at least one source URL.
- Private fit score is computed and stored only in the calling app.
- UI distinguishes `Research: verified`, `Research: needs review`, and `Research: failed`.
- Stale context packs trigger `/research/company` or `/research/role` refresh before scoring.

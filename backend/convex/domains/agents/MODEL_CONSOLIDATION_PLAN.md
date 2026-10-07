# 2025 Agent Architecture Restructure Plan

## Overview

This document outlines the **complete restructure** of the NodeBench AI agent system:

1. **Model Consolidation** - Use ONLY approved 2025 models
2. **Directory Restructure** - Clean separation of concerns
3. **Native SDK Removal** - Replace with AI SDK providers
4. **Python MCP Integration** - Convex-aware Python servers
5. **5 Agent Patterns** - Implement 2025 orchestration patterns

### Approved Models (EXCLUSIVE - No Others Allowed)
- **OpenAI**: GPT-5.2 series only
- **Anthropic**: Claude 4.5 series only
- **Google**: Gemini 3 and 2.5 series only

---

# Part 1: Model Consolidation

## Models to KEEP (7 Total)

| Provider | Model ID (Your Format) | AI SDK Model ID | Notes |
|----------|------------------------|-----------------|-------|
| OpenAI | `gpt-5.2` | `gpt-4o` (until real API) | GPT-5.2 flagship |
| Anthropic | `claude-opus-4.5` | `claude-opus-4-5` | Most capable |
| Anthropic | `claude-sonnet-4.5` | `claude-sonnet-4-5` | Balanced |
| Anthropic | `claude-haiku-4.5` | `claude-haiku-4-5` | Fast/cheap |
| Google | `gemini-3-pro-preview` | `gemini-3-pro-preview` | Multimodal flagship |
| Google | `gemini-2.5-pro` | `gemini-2.5-pro` | Best quality (2M ctx) |
| Google | `gemini-3.1-flash-lite-preview` | `gemini-3.1-flash-lite-preview` | Fast (1M ctx) |

## Models to DELETE (16 Total)

### OpenAI (8 to delete)
- `gpt-5.1` - Not GPT-5.2 series
- `gpt-5.1-codex` - Not GPT-5.2 series
- `gpt-5-mini` - Not GPT-5.2 series
- `gpt-5-nano` - Not GPT-5.2 series
- `gpt-4.1` - Old 4.x series
- `gpt-4.1-mini` - Old 4.x series
- `gpt-4.1-nano` - Old 4.x series
- `gpt-4o` - Old 4.x series (keep as SDK mapping target only)

### Anthropic (5 to delete)
- `claude-sonnet-4-5-20250929` - Use `claude-sonnet-4.5` (no date suffix)
- `claude-opus-4-5-20251101` - Use `claude-opus-4.5` (no date suffix)
- `claude-haiku-4-5-20251001` - Use `claude-haiku-4.5` (no date suffix)
- `claude-sonnet-4` - Old Claude 4.0 series
- `claude-opus-4` - Old Claude 4.0 series

### Google (1 to delete)
- `gemini-3.1-flash-lite-preview-lite` - Not in approved list

---

## Model Alias vs Provider Model ID (Bridge Mapping Policy)

We enforce a **7‑model alias surface** that callers may request. Underlying SDK model IDs
may temporarily differ due to provider availability:

| Alias (what code requests) | Provider SDK ID (what actually runs) | Notes |
|----------------------------|--------------------------------------|-------|
| `gpt-5.2`                  | `gpt-4o` (bridge until GPT-5.2 API)  | Will update when 5.2 is released |
| `claude-opus-4.5`          | `claude-opus-4-5`                    | Direct Anthropic ID (dash format) |
| `claude-sonnet-4.5`        | `claude-sonnet-4-5`                  | Direct Anthropic ID |
| `claude-haiku-4.5`         | `claude-haiku-4-5`                   | Direct Anthropic ID |
| `gemini-3-pro-preview`     | `gemini-3-pro-preview`               | Direct Google ID |
| `gemini-2.5-pro`           | `gemini-2.5-pro`                     | Direct Google ID |
| `gemini-3.1-flash-lite-preview`         | `gemini-3.1-flash-lite-preview`                   | Direct Google ID |

**Logging requirement:** Every model resolution **must** log both `requestedAlias` and
`resolvedSdkModelId` so we can:
- Audit which bridge mappings are in use.
- Track cost/latency differences when we flip to real IDs.
- Reproduce past behavior for eval / incident triage.

### Dated Model IDs (for Evals and Reproducibility)

Dated Anthropic IDs (e.g. `claude-sonnet-4-5-20250929`) are removed from the UI and
catalog as *user-selectable* models. However, they remain **valid internal pinned variants**:

- Stored in **evaluation configs** to ensure deterministic baselines.
- Recorded in **toolRun metadata** for incident investigation.
- Accepted by `resolveModelAlias()` as valid inputs, but mapped silently to the floating alias.

This preserves reproducibility without polluting the user-facing model list.

---

# Part 2: Complete Directory Restructure

## Current Structure (BEFORE)

```
nodebench-ai/
├── shared/
│   └── llm/
│       └── modelCatalog.ts           # ⚠️ Has 23+ models, needs cleanup
│
├── convex/
│   └── domains/
│       └── agents/
│           ├── core/
│           │   ├── coordinatorAgent.ts
│           │   ├── delegation/
│           │   ├── subagents/
│           │   └── tools/
│           ├── coordinator/
│           ├── mcp_tools/
│           │   ├── context/
│           │   ├── tracking/
│           │   └── native_sdks/      # ❌ TO DELETE
│           │       ├── openaiAgentTool.ts
│           │       ├── claudeAgentTool.ts
│           │       ├── geminiAgentTool.ts
│           │       └── index.ts
│           ├── nativeAgents/         # ❌ TO DELETE
│           │   ├── testClaudeAgent.ts
│           │   └── testOpenAIAgent.ts
│           ├── dataAccess/
│           ├── arbitrage/
│           └── hitl/
│
└── python-mcp-servers/               # ⚠️ Separate, not Convex-aware
```

## Target Structure (AFTER)

```
nodebench-ai/
├── shared/
│   └── llm/
│       └── modelCatalog.ts           # ✅ ONLY 7 approved models
│
├── convex/
│   └── domains/
│       └── agents/
│           │
│           ├── core/                  # ✅ KEEP - Main orchestration
│           │   ├── coordinatorAgent.ts
│           │   ├── multiAgentWorkflow.ts
│           │   ├── prompts.ts
│           │   ├── delegation/
│           │   │   └── delegationTools.ts
│           │   ├── subagents/
│           │   │   ├── document_subagent/
│           │   │   ├── media_subagent/
│           │   │   ├── sec_subagent/
│           │   │   ├── openbb_subagent/
│           │   │   └── entity_subagent/
│           │   └── tools/
│           │
│           ├── coordinator/           # ✅ KEEP - Modular coordinator
│           │   ├── agent.ts
│           │   ├── config.ts
│           │   ├── contextPack.ts
│           │   └── tools/
│           │
│           ├── mcp_tools/             # ✅ RESTRUCTURE
│           │   ├── index.ts           # Updated exports (no native_sdks)
│           │   ├── context/           # Pattern 1: Context Initializer
│           │   │   └── contextInitializerTool.ts
│           │   ├── tracking/          # Pattern 2: Task Tracker
│           │   │   ├── initTaskTracker.ts
│           │   │   ├── updateTaskStatus.ts
│           │   │   └── getTaskSummary.ts
│           │   └── models/            # 🆕 NEW - Model utilities
│           │       ├── index.ts
│           │       ├── modelResolver.ts
│           │       └── providerFactory.ts
│           │
│           ├── mcp_clients/           # 🆕 NEW - Python MCP callers
│           │   ├── index.ts
│           │   ├── registry.ts        # Server manifest with convexAware flag
│           │   ├── callTool.ts        # Generic MCP caller
│           │   └── types.ts           # Shared types
│           │
│           ├── dataAccess/            # ✅ KEEP
│           ├── arbitrage/             # ✅ KEEP
│           └── hitl/                  # ✅ KEEP
│
└── mcp/                               # 🆕 NEW - Python MCP servers
    └── python/
        ├── pyproject.toml
        ├── README.md
        └── src/
            └── nodebench_mcp/
                ├── __init__.py
                ├── common/
                │   ├── __init__.py
                │   ├── convex_client.py   # ConvexClient factory
                │   └── output_schema.py   # StandardToolOutput
                └── servers/
                    ├── __init__.py
                    └── research/
                        ├── __init__.py
                        └── server.py      # FastMCP + ConvexClient
```

---

# Part 3: Files to Delete

| Path | Type | Reason |
|------|------|--------|
| `convex/domains/agents/mcp_tools/native_sdks/` | Directory | Entire directory - replaced by AI SDK providers |
| `convex/domains/agents/mcp_tools/native_sdks/openaiAgentTool.ts` | File | Native OpenAI SDK tool |
| `convex/domains/agents/mcp_tools/native_sdks/claudeAgentTool.ts` | File | Native Anthropic SDK tool |
| `convex/domains/agents/mcp_tools/native_sdks/geminiAgentTool.ts` | File | Native Google SDK tool |
| `convex/domains/agents/mcp_tools/native_sdks/index.ts` | File | Exports for native SDK tools |
| `convex/domains/agents/nativeAgents/testClaudeAgent.ts` | File | Test file |
| `convex/domains/agents/nativeAgents/testOpenAIAgent.ts` | File | Test file |
| `convex/domains/agents/nativeAgents/2025_AGENT_ORCHESTRATION_RESEARCH.md` | File | Research doc (archive first) |
| `convex/domains/agents/nativeAgents/2025_MODEL_UPDATE_SUMMARY.md` | File | Summary doc (archive first) |
| `convex/domains/agents/nativeAgents/IMPLEMENTATION_SUMMARY.md` | File | Summary doc (archive first) |
| `convex/domains/agents/nativeAgents/README.md` | File | README (archive first) |

**Total: 11 files/directories to delete**

---

# Part 4: Files to Create

## 4.1 Model Resolver (`mcp_tools/models/`)

### `mcp_tools/models/modelResolver.ts`

```typescript
/**
 * Model Resolver - Typed registry-based model routing
 *
 * APPROVED MODELS (7 total):
 * - OpenAI:    gpt-5.2
 * - Anthropic: claude-opus-4.5, claude-sonnet-4.5, claude-haiku-4.5
 * - Google:    gemini-3-pro-preview, gemini-2.5-pro, gemini-3.1-flash-lite-preview
 *
 * Design:
 * - NO prefix-based inference (brittle).
 * - Explicit typed registry (ModelSpec) for each approved model.
 * - Safe entry point: getLanguageModel(ApprovedModel) — compile-time enforced.
 * - Alias resolver: resolveModelAlias(string) → ApprovedModel | null for legacy input.
 * - Convenience: getLanguageModelOrThrow(string) for APIs that accept strings.
 */

import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import type { LanguageModelV1 } from "ai";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Provider = "openai" | "anthropic" | "google";

export type ApprovedModel =
  | "gpt-5.2"
  | "claude-opus-4.5"
  | "claude-sonnet-4.5"
  | "claude-haiku-4.5"
  | "gemini-3-pro-preview"
  | "gemini-2.5-pro"
  | "gemini-3.1-flash-lite-preview";

export interface ModelSpec {
  alias: ApprovedModel;
  provider: Provider;
  sdkId: string; // what actually gets sent to the provider SDK
  capabilities: {
    vision: boolean;
    toolUse: boolean;
    maxContext: number; // tokens
  };
}

// ---------------------------------------------------------------------------
// Registry (single source of truth)
// ---------------------------------------------------------------------------

export const MODEL_SPECS: Record<ApprovedModel, ModelSpec> = {
  "gpt-5.2": {
    alias: "gpt-5.2",
    provider: "openai",
    sdkId: "gpt-4o", // bridge until real GPT-5.2 API
    capabilities: { vision: true, toolUse: true, maxContext: 128_000 },
  },
  "claude-opus-4.5": {
    alias: "claude-opus-4.5",
    provider: "anthropic",
    sdkId: "claude-opus-4-5",
    capabilities: { vision: true, toolUse: true, maxContext: 200_000 },
  },
  "claude-sonnet-4.5": {
    alias: "claude-sonnet-4.5",
    provider: "anthropic",
    sdkId: "claude-sonnet-4-5",
    capabilities: { vision: true, toolUse: true, maxContext: 200_000 },
  },
  "claude-haiku-4.5": {
    alias: "claude-haiku-4.5",
    provider: "anthropic",
    sdkId: "claude-haiku-4-5",
    capabilities: { vision: true, toolUse: true, maxContext: 200_000 },
  },
  "gemini-3-pro-preview": {
    alias: "gemini-3-pro-preview",
    provider: "google",
    sdkId: "gemini-3-pro-preview",
    capabilities: { vision: true, toolUse: true, maxContext: 1_000_000 },
  },
  "gemini-2.5-pro": {
    alias: "gemini-2.5-pro",
    provider: "google",
    sdkId: "gemini-2.5-pro",
    capabilities: { vision: true, toolUse: true, maxContext: 2_000_000 },
  },
  "gemini-3.1-flash-lite-preview": {
    alias: "gemini-3.1-flash-lite-preview",
    provider: "google",
    sdkId: "gemini-3.1-flash-lite-preview",
    capabilities: { vision: true, toolUse: true, maxContext: 1_000_000 },
  },
};

export const APPROVED_MODELS = Object.keys(MODEL_SPECS) as ApprovedModel[];

// Legacy aliases (old names → approved names). Empty by default; add if needed.
const LEGACY_ALIASES: Record<string, ApprovedModel> = {
  // Uncomment during a transition period:
  // "gpt-5.1": "gpt-5.2",
  // "gpt-5-mini": "gpt-5.2",
  // "claude-sonnet-4-5-20250929": "claude-sonnet-4.5",
};

// ---------------------------------------------------------------------------
// Alias Resolver (for untrusted string input)
// ---------------------------------------------------------------------------

/**
 * Attempt to resolve an arbitrary string to an approved model.
 * - Returns the ApprovedModel if input is valid or a known legacy alias.
 * - Returns null if input is unrecognised.
 */
export function resolveModelAlias(input: string): ApprovedModel | null {
  if ((APPROVED_MODELS as string[]).includes(input)) {
    return input as ApprovedModel;
  }
  return LEGACY_ALIASES[input] ?? null;
}

// ---------------------------------------------------------------------------
// Language Model Builders
// ---------------------------------------------------------------------------

function buildLanguageModel(spec: ModelSpec): LanguageModelV1 {
  switch (spec.provider) {
    case "openai":
      return openai(spec.sdkId);
    case "anthropic":
      return anthropic(spec.sdkId);
    case "google":
      return google(spec.sdkId);
  }
}

/**
 * Safe entry point — accepts only ApprovedModel (compile-time enforced).
 * Use this when model name comes from trusted code.
 */
export function getLanguageModel(model: ApprovedModel): LanguageModelV1 {
  const spec = MODEL_SPECS[model];
  return buildLanguageModel(spec);
}

/**
 * Convenience for APIs that accept arbitrary strings.
 * - Resolves via alias map.
 * - Throws a descriptive error if the model is not allowed.
 */
export function getLanguageModelOrThrow(input: string): LanguageModelV1 {
  const resolved = resolveModelAlias(input);
  if (!resolved) {
    throw new Error(
      `Unsupported model: "${input}". Allowed models: ${APPROVED_MODELS.join(", ")}`
    );
  }
  return getLanguageModel(resolved);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getDefaultModel(
  task: "agent" | "chat" | "coding" | "fast" | "vision"
): ApprovedModel {
  switch (task) {
    case "agent":
      return "claude-sonnet-4.5";
    case "coding":
      return "claude-opus-4.5";
    case "fast":
      return "gemini-3.1-flash-lite-preview";
    case "vision":
      return "gemini-3-pro-preview";
    case "chat":
    default:
      return "gpt-5.2";
  }
}

export function getProvider(model: ApprovedModel): Provider {
  return MODEL_SPECS[model].provider;
}

export function getModelSpec(model: ApprovedModel): ModelSpec {
  return MODEL_SPECS[model];
}
```

### `mcp_tools/models/index.ts`

```typescript
export {
  MODEL_SPECS,
  APPROVED_MODELS,
  getLanguageModel,
  getLanguageModelOrThrow,
  resolveModelAlias,
  getDefaultModel,
  getProvider,
  getModelSpec,
  type ApprovedModel,
  type Provider,
  type ModelSpec,
} from "./modelResolver";
```

## 4.2 MCP Clients (`mcp_clients/`)

### `mcp_clients/registry.ts`

```typescript
/**
 * Python MCP Server Registry (HTTP-based)
 *
 * Lists all available Python MCP servers and their capabilities.
 *
 * IMPORTANT:
 * - Convex **never** spawns Python or other processes directly.
 * - These servers are started by dev tooling / Docker / external services.
 * - Convex (or a Node "MCP runner" service) talks to them over HTTP/JSON-RPC.
 */

export interface McpServerConfig {
  id: string;                // Stable identifier (e.g. "research")
  name: string;
  description: string;
  baseUrl: string;           // e.g. "http://localhost:8003/mcp" (dev) or prod URL
  convexAware: boolean;      // Can access Convex DB via ConvexClient
  tools: string[];           // Available tool names
}

export const MCP_SERVER_REGISTRY: Record<string, McpServerConfig> = {
  research: {
    id: "research",
    name: "Research MCP Server",
    description: "Iterative research with context initialization and task tracking",
    baseUrl: "http://localhost:8003/mcp", // dev default; override in prod
    convexAware: true,
    tools: [
      "initialize_context",
      "init_task_tracker",
      "update_task_status",
      "get_task_summary",
      "iterative_search",
    ],
  },
};

export function getServerConfig(serverId: string): McpServerConfig | undefined {
  return MCP_SERVER_REGISTRY[serverId];
}

export function getAllConvexAwareServers(): string[] {
  return Object.values(MCP_SERVER_REGISTRY)
    .filter((config) => config.convexAware)
    .map((config) => config.id);
}
```

### `mcp_clients/callTool.ts`

```typescript
/**
 * Generic MCP Tool Caller (HTTP/JSON-RPC)
 *
 * Calls tools on Python MCP servers over HTTP using JSON-RPC 2.0.
 *
 * NOTE:
 * - Process startup is handled **outside** Convex (docker-compose, CLI, etc.).
 * - This module only knows how to talk to already-running servers via baseUrl.
 */

import { getServerConfig } from "./registry";

export interface McpToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

export async function callMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const config = getServerConfig(serverId);
  if (!config) {
    return { success: false, error: `Unknown server: ${serverId}` };
  }

  if (!config.tools.includes(toolName)) {
    return { success: false, error: `Tool ${toolName} not available on ${serverId}` };
  }

  try {
    const response = await fetch(config.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now().toString(),
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args,
        },
      }),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    if (data.error) {
      return { success: false, error: data.error.message ?? "MCP tool error" };
    }

    return { success: true, result: data.result };
  } catch (error: any) {
    return { success: false, error: error?.message ?? "Failed to call MCP tool" };
  }
}
```

### `mcp_clients/index.ts`

```typescript
export { MCP_SERVER_REGISTRY, getServerConfig, getAllConvexAwareServers } from "./registry";
export { callMcpTool, type McpToolResult } from "./callTool";
```

---

# Part 5: Files to Update

## 5.1 `shared/llm/modelCatalog.ts`

**Changes:**
1. Remove all models except the 7 approved ones
2. Update `modelPricing` to only include approved models
3. Update `llmModelCatalog` task mappings
4. Update `modelAliases`
5. Update `modelEquivalents` for failover
6. Update `DEFAULT_FALLBACK_MODEL` to `gpt-5.2`
7. Update tier limits to use approved models only

## 5.2 `convex/domains/agents/mcp_tools/index.ts`

**Changes:**
1. Remove all exports from `native_sdks`
2. Add exports from `models`
3. Keep exports from `context` and `tracking`

**Before:**
```typescript
export * from "./native_sdks";
export * from "./context";
export * from "./tracking";
```

**After:**
```typescript
export * from "./models";
export * from "./context";
export * from "./tracking";
```

## 5.3 `convex/domains/agents/core/coordinatorAgent.ts`

**Changes:**
1. Import `getLanguageModel` from `mcp_tools/models` instead of using `MODEL_NAME_MAP`
2. Remove any references to native SDK tools
3. Use `APPROVED_MODELS` for model validation

---

# Part 6: Python MCP Server Structure

## 6.1 `mcp/python/pyproject.toml`

```toml
[project]
name = "nodebench-mcp"
version = "0.1.0"
description = "NodeBench AI Python MCP Servers with Convex Integration"
requires-python = ">=3.11"
dependencies = [
    "convex>=0.7.0",
    "mcp>=1.0.0",
    "fastmcp>=0.1.0",
    "pydantic>=2.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
    "pytest-asyncio>=0.21.0",
]
```

## 6.2 `mcp/python/src/nodebench_mcp/common/convex_client.py`

```python
"""
Convex Client Factory - Connects Python MCP servers to the same Convex DB

NOTE: The official `convex` Python package exposes synchronous methods.
We wrap them with asyncio.to_thread() so the event loop is never blocked.
"""

import os
import asyncio
from convex import ConvexClient

_client: ConvexClient | None = None


def get_convex_client() -> ConvexClient:
    """Get or create the singleton Convex client."""
    global _client
    if _client is None:
        url = os.environ.get("CONVEX_URL")
        if not url:
            raise ValueError("CONVEX_URL environment variable not set")
        _client = ConvexClient(url)
    return _client


async def query(function_name: str, args: dict | None = None):
    """Execute a Convex query (non-blocking)."""
    client = get_convex_client()
    return await asyncio.to_thread(client.query, function_name, args or {})


async def mutation(function_name: str, args: dict | None = None):
    """Execute a Convex mutation (non-blocking)."""
    client = get_convex_client()
    return await asyncio.to_thread(client.mutation, function_name, args or {})


async def action(function_name: str, args: dict | None = None):
    """Execute a Convex action (non-blocking)."""
    client = get_convex_client()
    return await asyncio.to_thread(client.action, function_name, args or {})
```

## 6.3 `mcp/python/src/nodebench_mcp/common/output_schema.py`

```python
"""
Standard Output Schema for MCP Tools
"""

from pydantic import BaseModel
from typing import Any

class StandardToolOutput(BaseModel):
    """Standard output format for all MCP tools."""
    success: bool
    data: Any | None = None
    error: str | None = None
    metadata: dict | None = None

    def to_llm_string(self) -> str:
        """Format output for LLM consumption."""
        if not self.success:
            return f"ERROR: {self.error}"
        if isinstance(self.data, str):
            return self.data
        return str(self.data)
```

---

# Part 6A: MCP Transport Contract

This section defines the exact wire protocol between Convex (or any TS caller) and
MCP servers (TS or Python). Without a clear contract, mismatches between caller and
server implementations will cause hard-to-debug failures.

## 6A.1 Wire Protocol

| Property | Value |
|----------|-------|
| **Transport** | HTTP POST (JSON-RPC 2.0 over plain HTTP) |
| **Content-Type** | `application/json` |
| **Request body** | `{ "jsonrpc": "2.0", "id": <string>, "method": "<method>", "params": {...} }` |
| **Response body** | `{ "jsonrpc": "2.0", "id": <string>, "result": {...} }` or `{ ... "error": { "code": int, "message": string } }` |

## 6A.2 Supported Methods

| Method | Description | Params | Result |
|--------|-------------|--------|--------|
| `tools/list` | Discover available tools | `{}` | `{ tools: ToolDef[] }` |
| `tools/call` | Invoke a tool | `{ name: string, arguments: Record<string, unknown> }` | `{ content: ContentBlock[], isError?: boolean }` |

**`ToolDef`** shape (simplified):
```ts
interface ToolDef {
  name: string;
  description: string;
  inputSchema: JSONSchema7;
}
```

## 6A.3 Streaming (optional, future)

For long-running tools (e.g. iterative search), the server **may** upgrade to SSE:

1. Server responds with `Content-Type: text/event-stream`.
2. Each `data:` line is a JSON chunk: `{ type: "progress" | "final", payload: ... }`.
3. Caller accumulates chunks and renders intermediate UI.

For v1, **non-streaming JSON-RPC is sufficient**. Streaming is optional and can be added
per-server once the baseline works.

## 6A.4 Timeouts & Retries

| Setting | Default | Notes |
|---------|---------|-------|
| HTTP timeout | 60 s | Increase for heavy tools (SEC search, iterative research) |
| Retry count | 2 | Only retry on network/5xx errors, not 4xx |
| Backoff | Exponential (1s, 2s) | Jitter optional |

Callers should surface partial progress via Task Tracker before timing out so users
understand what happened.

## 6A.5 Tool Schema Discovery (`tools/list`)

Callers **should** call `tools/list` once per server on startup and cache the result.
This enables:
- Compile-time validation of tool calls (optional).
- Auto-generated TS types from JSON Schema.
- UI that shows available tools per server.

---

# Part 6B: Security & Authorization for Convex-Aware MCP Servers

Python MCP servers marked `convexAware: true` can read/write the same Convex DB.
Without explicit controls, this is a security risk.

## 6B.1 Credential Model

| Credential | Description | When to Use |
|------------|-------------|-------------|
| **Admin key** | Full read/write to all tables | Never in prod MCP servers |
| **Service identity key** | Scoped key with explicit table access | Preferred for prod |
| **User-delegated token** | Short-lived token tied to user session | For user-initiated MCP calls |

**Recommendation:** Create a dedicated Convex service identity (or API key) for MCP
servers with access limited to:
- **Read:** `documents`, `agentScratchpads`, `userPreferences`, `tags`
- **Write:** `toolRuns`, `agentScratchpads` (session-scoped), `artifacts`

## 6B.2 Actor Metadata

Every mutation performed by an MCP server **must** include actor metadata:

```python
await mutation("toolRuns:insert", {
    "actor": {
        "type": "mcp_server",
        "serverId": "research",
        "toolName": tool_name,
        "userId": user_id,       # from SessionContext
        "requestId": request_id, # unique per call
    },
    "input": {...},
    "output": {...},
})
```

This enables:
- Audit trail for all MCP writes.
- Rollback/undo by actor.
- Rate limiting per server or user.

## 6B.3 Input Validation

MCP servers **must** validate all inputs before executing:

- Use Pydantic models for request validation (Python).
- Reject requests with unexpected fields or out-of-range values.
- Never interpolate raw user input into Convex queries without sanitization.

## 6B.4 Network Isolation (Prod)

In production:
- MCP servers should run in a private network (VPC / Docker network).
- Only the Convex backend (via `callMcpTool` action) can reach MCP server URLs.
- External clients cannot call MCP servers directly.

---

# Part 7: 5 Agent Orchestration Patterns

This section documents the **canonical 2025 agent patterns** used across NodeBench AI.
It is the architecture reference for how the Convex agents, MCP tools, and (eventually)
Python MCP servers should work together.

---

## Pattern 1: Context Initializer

**Status:** ✅ Implemented in `convex/domains/agents/mcp_tools/context/`
**Primary file:** `context/contextInitializerTool.ts`
**Primary tool:** `contextInitializerTool`

**Purpose:**
- Load **project context**, **user preferences**, and **previous session state** at the
  start of every agent session.
- Prevent wasted tool calls where the agent re-discovers how the app works.

**Entry points / call sites (intended):**
- First tool call from the **Coordinator Agent** when starting a new agent thread.
- Any long-running workflow that needs an explicit session context object.

**Data flow:**
1. Coordinator creates/receives an `agentThreadId` + `userId`.
2. Calls `contextInitializerTool` via MCP with optional `taskDescription` and `features`.
3. Tool:
   - Looks up existing scratchpad (`agentScratchpads.getByAgentThread`).
   - Fetches user preferences (`auth.userPreferences.getUserPreferences`).
   - Builds a `SessionContext` object (projectName, capabilities, featureList, etc.).
4. Returned `SessionContext` is attached to the agent's working memory and passed into
   subsequent tools / LLM calls (either explicitly or via scratchpad).

**Notes:**
- This pattern should **always be the first MCP tool** in a new session.
- The 7-model consolidation does *not* change this pattern directly, but any LLM
  calls that summarize or transform the `SessionContext` must use `modelResolver`.

---

## Pattern 2: Task Tracker

**Status:** ✅ Implemented in `convex/domains/agents/mcp_tools/tracking/`
**Primary file:** `tracking/taskTrackerTool.ts`
**Primary tools:** `initTaskTracker`, `updateTaskStatus`, `getTaskSummary`

**Purpose:**
- Implement the **Feature List / Planning Tool** pattern:
  - Structured list of tasks with statuses and test criteria.
  - Prevents the "premature victory" failure mode.

**Entry points / call sites (intended):**
- Immediately after `contextInitializerTool` in long-running workflows.
- Whenever an agent begins a multi-step request where correctness matters.

**Data flow:**
1. Coordinator (or subagent) calls `initTaskTracker` with:
   - `sessionId` from Context Initializer.
   - `tasks[]` with `name`, `description`, `testCriteria`, `blockedBy`.
2. Agent then interleaves:
   - `updateTaskStatus` calls as work progresses.
   - `getTaskSummary` calls to choose the next task or show progress to user.
3. Task state is **persisted to the Convex scratchpad** (keyed by `sessionId`) so it
   survives server restarts and long async waits (required for production workflows).

**Persistence decision (REQUIRED for v1):**
Task Tracker state **must** be persisted via Convex for correctness of long-running
and HITL-paused workflows. In-memory-only state is acceptable only for single-turn
demos. Production code must call `agentScratchpads.upsert()` on every status change.

**Notes:**
- For user-facing UIs, `getTaskSummary` can power a progress panel.
- HITL (Pattern 4) can read task status to decide where to place human checkpoints.
- Persisted tasks enable post-hoc debugging and "resume workflow" features.

---

## Pattern 3: Multi-LLM Architecture (Central Model Router)

**Status:** 🔄 Needs update to use `modelResolver` and 7 approved models only.
**Primary location (after migration):** `convex/domains/agents/mcp_tools/models/`
**Dependent agents:**
- `core/coordinatorAgent.ts`
- `coordinator/agent.ts`
- `dataAccess/agent.ts`
- `arbitrage/agent.ts`
- LLM-using tools like `secCompanySearch.ts`, `tags_actions.ts`, `search/rag.ts`

**Purpose:**
- Provide a **single, shared routing layer** that:
  - Accepts high-level model names (or task types).
  - Validates against `APPROVED_MODELS` (7 models only).
  - Resolves to a concrete AI SDK model (`openai`, `anthropic`, `google`).

**Key exports (see Part 4.1 for full code):**
- `MODEL_SPECS` — typed registry mapping `ApprovedModel` → `{ provider, sdkId, capabilities }`
- `APPROVED_MODELS` — array of all 7 allowed aliases
- `ApprovedModel` / `Provider` / `ModelSpec` types
- `getLanguageModel(model: ApprovedModel)` — **safe entry point** (compile-time enforced)
- `resolveModelAlias(input: string): ApprovedModel | null` — for untrusted string input
- `getLanguageModelOrThrow(input: string)` — convenience that throws on invalid input
- `getDefaultModel(task)` — returns the recommended model for a task type
- `getProvider(model: ApprovedModel)` / `getModelSpec(model)` — lookup helpers

**Data flow (example):**
1. Fast Agent Panel sends `selectedModel` (one of the 7 approved names) to Convex.
2. Coordinator Agent receives `modelName` string.
   - Calls `resolveModelAlias(modelName)` to validate.
   - If null, falls back to `getDefaultModel("agent")`.
3. Coordinator calls `getLanguageModel(resolved)` from `mcp_tools/models`.
4. `modelResolver`:
   - Looks up `MODEL_SPECS[resolved]` to get `{ provider, sdkId }`.
   - Builds the AI SDK model instance via explicit switch (no prefix inference).
5. All downstream LLM calls use that instance; no agent defines its own MODEL_MAP.
6. Logging: `{ requestedAlias, resolvedAlias, provider, sdkId, caller }` for audit.

**Notes:**
- This pattern is where we **enforce** the 7-model exclusivity policy.
- All previous `MODEL_MAP` / `MODEL_NAME_MAP` constants in agents will be deleted
  and replaced with imports from `mcp_tools/models`.

---

## Pattern 4: Built-in Breakpoints (HITL)

**Status:** ✅ Implemented in `convex/domains/agents/hitl/`
**Primary files:**
- `hitl/index.ts`
- `hitl/config.ts`
- `hitl/interruptManager.ts`
- `hitl/tools/askHuman.ts`

**Purpose:**
- Insert **Human-in-the-Loop breakpoints** into long workflows:
  - Ask the user for clarification.
  - Get approval before executing risky steps.
  - Allow humans to correct or steer the plan.

**Data flow (conceptual):**
1. An agent determines a step is high-risk or ambiguous.
2. Instead of continuing autonomously, it calls an HITL tool (e.g. `askHuman`).
3. The HITL layer:
   - Stores a pending question / decision in Convex.
   - Surfaces a UI prompt to the user.
   - Pauses the workflow (or schedules a resume).
4. When the user responds, the agent resumes with the new information and continues.

**Notes:**
- Pattern 4 is **orthogonal** to models; it wraps around LLM calls.
- Once Pattern 3 is in place, HITL will automatically use the centralized model router.

---

## Pattern 5: Iterative Search with Reflection (Python MCP)

**Status:** 📋 To implement in new Python MCP package under `mcp/python/`.
**Primary locations (planned):**
- `mcp/python/src/nodebench_mcp/common/convex_client.py`
- `mcp/python/src/nodebench_mcp/common/output_schema.py`
- `mcp/python/src/nodebench_mcp/servers/research/server.py`

**Purpose:**
- Implement a **Search → Evaluate → Refine** loop supervised by LLM(s), with:
  - Access to Convex data/documents.
  - Integration with Task Tracker & Context Initializer.
  - Optional HITL checkpoints.

**High-level flow (intended):**
1. TS Coordinator calls Python MCP tool `iterative_search` with:
   - Problem statement.
   - `SessionContext` snapshot.
   - Current task list or goals.
2. Python server:
   - Uses `convex_client.py` to fetch relevant documents / notes.
   - Plans a small batch of search/refinement steps.
   - Optionally calls back into Convex tools (e.g., to log progress, update tasks).
3. After each iteration, Python server emits `StandardToolOutput` with:
   - `success`, `data` (summary / findings), `metadata` (intermediate traces).
4. TS side can:
   - Show intermediate results in the Fast Agent Panel.
   - Decide whether to continue iterating, ask for human input (Pattern 4), or stop.

**Notes:**
- Model selection for this pattern should still obey Pattern 3:
  - Either TS side selects the LLM and passes that through, or
  - Python side mirrors the `MODEL_TO_SDK_ID` mapping using the same 7 models.

---

## End-to-End Example: Fast Agent Panel Research Query (Patterns 1–5)

This example shows how a single Fast Agent Panel request flows through all five patterns.

**Scenario:**
- User opens the Fast Agent Panel and asks:
  - _"Research the latest FDA developments for Company X and summarize key risks for investors."_
- They either pick a model in the UI or let the system choose a default.

**Step-by-step flow:**
1. **Frontend → Convex (entry + model hint)**
   - Fast Agent Panel sends a Convex action:
     - `message`: user query.
     - `selectedModel`: optional (one of the 7 approved models).
     - `sessionId`: Fast Agent session identifier.
   - If `selectedModel` is missing, Convex will later use `getDefaultModel("agent")` (Pattern 3).

2. **Pattern 1 – Context Initializer**
   - Coordinator Agent checks whether this `sessionId` has an initialized context.
   - If not, it calls the MCP tool `contextInitializerTool`:
     - Loads scratchpads, user preferences, tracked hashtags, and previous summaries.
     - Builds a `SessionContext` with feature list and initial progress log.
   - Result is stored in Convex and attached to the agent turn.

3. **Pattern 2 – Task Tracker / Feature List**
   - Coordinator derives concrete tasks from the high-level request, e.g.:
     - `"Collect recent FDA filings for Company X"`.
     - `"Summarize clinical trial status and key risks"`.
     - `"Produce investor-focused summary"`.
   - It calls `initTaskTracker` with this task list and the `sessionId`.
   - As the agent works, it calls `updateTaskStatus` to mark tasks `in_progress` / `completed`, and uses `getTaskSummary` when it needs a structured overview for the final answer.

4. **Pattern 3 – Central Model Resolver (Multi-LLM)**
   - For every LLM call (planning, retrieval-augmented summarization, drafting), Coordinator uses `mcp_tools/models/modelResolver`:
     - If user chose a model: validate it is in `APPROVED_MODELS`.
     - Otherwise: call `getDefaultModel("agent")`.
     - Use `getLanguageModel(modelName)` to obtain the concrete AI SDK model instance.
   - All downstream Convex agents and tools rely on this resolver; no component hardcodes its own model map.

5. **Pattern 5 – Iterative Search (Python MCP)**
   - For deeper research, Coordinator calls the Python MCP server (e.g. `research` server) via `callMcpTool` / `executeToolWithSdk`:
     - Tool name: `"iterative_search"`.
     - Arguments include: problem statement, `SessionContext`, current tasks, and any constraints.
   - The Python server:
     - Uses `convex_client` to fetch relevant documents, dossiers, and notes.
     - Runs a Search → Evaluate → Refine loop, logging progress back to Convex when appropriate.
     - Emits intermediate `StandardToolOutput` results that Convex can stream to the Fast Agent Panel.

6. **Pattern 4 – HITL Breakpoints (optional)**
   - If the workflow reaches a risky or ambiguous decision (e.g. proposing concrete investment actions), Coordinator inserts a Human-in-the-Loop step:
     - Calls HITL tool (e.g. `askHuman`) with a summarized proposal and open questions.
     - HITL layer stores a pending decision and surfaces a UI prompt.
     - Workflow pauses until the user responds; upon response, Coordinator resumes with updated context.

7. **Final answer + UI integration**
   - Coordinator composes a final structured answer using the model selected via Pattern 3, summarizing:
     - Key FDA developments.
     - Risk analysis for investors.
     - References to documents and timelines gathered via Python MCP.
   - Task Tracker state is updated so users can see what was done.
   - Fast Agent Panel renders:
     - The final answer.
     - Rich media / documents from MCP tools.
     - Optional task summary and progress, all tied to the same `sessionId`.

This end-to-end flow shows how Context Initialization (1), Task Tracking (2), centralized Model Routing (3), HITL (4), and Python-based Iterative Search (5) cooperate for a single Fast Agent request.

---

# Part 8: Additional Files to Update (DISCOVERED)

These files were found to have hardcoded old model references that must be updated:

## 8.1 Frontend Components

### `src/components/ModelSelector.tsx`
**Issue:** Contains hardcoded MODELS array with old model IDs
```typescript
// OLD - to remove
{ id: "gpt-5.1", name: "GPT-5.1", ... }
{ id: "gpt-5-mini", name: "GPT-5 Mini", ... }
{ id: "gpt-5-nano", name: "GPT-5 Nano", ... }
{ id: "gpt-5.1-codex", name: "GPT-5.1 Codex", ... }
{ id: "gemini-3.1-flash-lite-preview-lite", name: "Gemini Flash Lite", ... }
```
**Fix:** Replace with 7 approved models only

### `src/features/agents/components/FastAgentPanel/FastAgentPanel.tsx`
**Issue:** Has TypeScript type with old model IDs
```typescript
// OLD
useState<'gpt-5.1' | 'gpt-5-mini' | 'gpt-5-nano' | 'gemini' | 'claude-sonnet-4-5-20250929'>
```
**Fix:** Update to approved model type

### `src/features/agents/components/FastAgentPanel/FastAgentPanel.InputBar.tsx`
**Issue:** Model dropdown with old model options
```typescript
// OLD - hardcoded model list
{ id: 'gpt-5.1', label: 'GPT-5.1', ... }
{ id: 'gpt-5-mini', label: 'GPT-5 Mini', ... }
{ id: 'gpt-5-nano', label: 'GPT-5 Nano', ... }
{ id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet', ... }
```
**Fix:** Use approved models and import from shared source

## 8.2 Agent Files with Duplicate MODEL_MAP

### `convex/domains/agents/core/coordinatorAgent.ts`
**Issue:** Has its own `MODEL_NAME_MAP` constant
**Fix:** Import from `mcp_tools/models/modelResolver.ts`

### `convex/domains/agents/coordinator/agent.ts`
**Issue:** Has its own `MODEL_MAP` constant
**Fix:** Import from `mcp_tools/models/modelResolver.ts`

### `convex/domains/agents/dataAccess/agent.ts`
**Issue:** Has its own `MODEL_MAP` constant
**Fix:** Import from `mcp_tools/models/modelResolver.ts`

### `convex/domains/agents/arbitrage/agent.ts`
**Issue:** Has its own `MODEL_MAP` constant
**Fix:** Import from `mcp_tools/models/modelResolver.ts`

## 8.3 Other Backend Files

### `convex/tools/sec/secCompanySearch.ts`
**Issue:** Has its own `getLanguageModel()` helper
**Fix:** Import from `mcp_tools/models/modelResolver.ts`

### `convex/domains/search/rag.ts`
**Issue:** Hardcoded fallback model
```typescript
const model = process.env.OPENAI_MODEL || 'gpt-5-nano';
```
**Fix:** Change to `gpt-5.2` or import from modelResolver

### `convex/tags_actions.ts`
**Issue:** Uses `getLlmModel()` which returns old models
**Fix:** Will be fixed when modelCatalog.ts is updated

## 8.4 Existing Python MCP Servers

### `python-mcp-servers/` Directory
**Status:** Existing directory with:
- `core_agent/` - Core agent server
- `openbb/` - OpenBB financial data server
- `shared/` - Common utilities

**Decision Required:**
- [ ] Option A: Keep as-is (separate from new `mcp/python/`)
- [ ] Option B: Migrate to new structure under `mcp/python/`
- [ ] Option C: Add Convex client integration to existing servers

**Recommendation:** Option C - Add ConvexClient to existing servers and keep them in place

---

# Part 9: Migration Checklist

## Pre-Migration
- [ ] Archive `nativeAgents/` documentation to project wiki
- [ ] Backup current `modelCatalog.ts`
- [ ] Document all current model usages across codebase

## Phase 1: Model Catalog Update
- [ ] Update `shared/llm/modelCatalog.ts` with only 7 models
- [ ] Update pricing for 7 models only
- [ ] Update task mappings
- [ ] Update aliases
- [ ] Update equivalents for failover
- [ ] Run build to check for errors

## Phase 2: Create Model Resolver
- [ ] Create `mcp_tools/models/` directory
- [ ] Create `modelResolver.ts`
- [ ] Create `index.ts` exports
- [ ] Run build to verify

## Phase 3: Update Imports
- [ ] Update `mcp_tools/index.ts` to export from models
- [ ] Update `coordinatorAgent.ts` to use modelResolver
- [ ] Search for any other native_sdks imports
- [ ] Run build to verify

## Phase 4: Delete Native SDK Files
- [ ] Delete `mcp_tools/native_sdks/openaiAgentTool.ts`
- [ ] Delete `mcp_tools/native_sdks/claudeAgentTool.ts`
- [ ] Delete `mcp_tools/native_sdks/geminiAgentTool.ts`
- [ ] Delete `mcp_tools/native_sdks/index.ts`
- [ ] Delete `mcp_tools/native_sdks/` directory

## Phase 5: Delete Test Files
- [ ] Delete `nativeAgents/testClaudeAgent.ts`
- [ ] Delete `nativeAgents/testOpenAIAgent.ts`
- [ ] Delete or archive `nativeAgents/*.md` files
- [ ] Delete `nativeAgents/` directory if empty

## Phase 6: Create MCP Clients
- [ ] Create `mcp_clients/` directory
- [ ] Create `registry.ts`
- [ ] Create `callTool.ts`
- [ ] Create `index.ts`
- [ ] Run build to verify

## Phase 7: Setup Python MCP
- [ ] Create `mcp/python/` directory
- [ ] Create `pyproject.toml`
- [ ] Create `src/nodebench_mcp/` package structure
- [ ] Create `common/convex_client.py`
- [ ] Create `common/output_schema.py`
- [ ] Create `servers/research/server.py`
- [ ] Test Python MCP server startup

## Post-Migration
- [ ] Run full build
- [ ] Run existing tests
- [ ] Test coordinator agent with new models
- [ ] Test Fast Agent Panel
- [ ] Verify model switching works
- [ ] Document any breaking changes

---

## Validation Checklist

After implementation:

- [ ] Only 7 models exist in modelCatalog.ts
- [ ] native_sdks/ directory is deleted
- [ ] nativeAgents/ directory is deleted
- [ ] All imports updated to use modelResolver
- [ ] Build passes with no errors
- [ ] Coordinator agent uses new model resolver
- [ ] Model aliases map to correct 7 models
- [ ] mcp_clients/ directory created
- [ ] mcp/python/ directory structure created
- [ ] Python MCP server can connect to Convex

---

# Part 10: Rollout, Feature Flags & Observability

## 10.1 Feature Flags / Safety Switches

To reduce risk during rollout, we can add a small number of guardrails:

- [ ] **Environment flag for 2025 model set**
      `NB_AI_MODELS_2025_ENABLED=true|false` (default `true` in dev, `false` in prod until ready).
  - When `false`, coordinator can:
    - Log a warning and refuse requests that explicitly ask for non-approved models, or
    - Route ALL requests to a single safe default (`gpt-5.2`).
- [ ] **Emergency override for legacy aliases**
      `NB_ALLOW_LEGACY_MODEL_ALIASES=true|false` (default `false`).
  - When `true`, `resolveModelAlias()` in `modelCatalog.ts` may still accept old names like `gpt-5.1` but **always map them to one of the 7 approved models**.
  - This does *not* re-enable old models; it only avoids hard failures if some stray legacy name remains.

## 10.2 Logging & Metrics

Add structured logging around model selection to detect misconfigurations and measure usage:

- [ ] Log at **INFO** (or structured event) whenever a model is resolved:
  - requested model name
  - resolved model name (approved name)
  - SDK model ID (e.g. `gpt-4o`, `claude-sonnet-4-5`)
  - provider (`openai` / `anthropic` / `google`)
  - calling domain (`coordinator`, `dataAccess`, `secCompanySearch`, etc.)
- [ ] Add basic counters (even if just logs for now):
  - calls per provider per model
  - error rate per model (timeouts, 4xx/5xx from provider)

This can later feed into a simple dashboard (Convex logs, or external) to answer:
- “Which models are used most?”
- “Are any endpoints still trying to use deleted models?”
- "What bridge mappings are in use?"

### Canonical `ModelResolution` Log Event Schema

```typescript
interface ModelResolutionEvent {
  event: "ModelResolution";
  timestamp: number;           // Date.now()
  requestedAlias: string;      // what the caller asked for
  resolvedAlias: ApprovedModel | null; // null if invalid
  sdkModelId: string;          // what the provider SDK receives
  provider: Provider;          // "openai" | "anthropic" | "google"
  caller: string;              // e.g. "coordinatorAgent", "secCompanySearch"
  userId?: string;             // if available
  sessionId?: string;          // if available
  success: boolean;            // false if resolution failed
  errorMessage?: string;       // if success=false
}
```

Use this schema for all model resolution logging across Convex agents and MCP tools.


## 10.3 Backwards Compatibility Behavior

Decisions to document clearly:

- When a **deleted** model name is requested:
  - [ ] Prefer: treat it as an alias and map to the closest approved model (via `resolveModelAlias` + `MODEL_TO_SDK_ID`).
  - [ ] Alternatively: throw a clear error: `Unsupported model: <name>. Allowed models are: gpt-5.2, claude-*, gemini-*`.
- For **public APIs** (if any) that accept `model` string from the client:
  - [ ] Validate against `APPROVED_MODELS` and provide a helpful error message with the allowed list.

---

# Part 11: Testing & Verification Plan

## 11.1 CI Gate: Block Disallowed Model Strings

Add a **CI check** (script or lint rule) that fails the build if any disallowed model
string appears outside `modelResolver.ts` or `modelCatalog.ts`:

```bash
#!/usr/bin/env bash
# scripts/ci-check-models.sh

DISALLOWED=(
  "gpt-5.1" "gpt-5.1-codex" "gpt-5-mini" "gpt-5-nano"
  "gpt-4.1" "gpt-4.1-mini" "gpt-4.1-nano" "gpt-4o"
  "claude-sonnet-4-5-20250929" "claude-opus-4-5-20251101" "claude-haiku-4-5-20251001"
  "gemini-3.1-flash-lite-preview-lite"
)

EXCLUDE="modelResolver.ts|modelCatalog.ts|MODEL_CONSOLIDATION_PLAN.md"

for model in "${DISALLOWED[@]}"; do
  if grep -r --include="*.ts" --include="*.tsx" "$model" src/ convex/ | grep -Ev "$EXCLUDE"; then
    echo "ERROR: Found disallowed model '$model' outside allowed files."
    exit 1
  fi
done
echo "Model string check passed."
```

Add to CI workflow (GitHub Actions, etc.) so regressions are caught before merge.

## 11.2 Automated / Programmatic Checks

- [ ] **TypeScript build** for entire repo.
- [ ] **Convex type generation** (if applicable) still succeeds.
- [ ] Run `scripts/ci-check-models.sh` to verify no disallowed model strings.
- [ ] Grep / search for any remaining references to:
  - `gpt-5.1`, `gpt-5-mini`, `gpt-5-nano`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-4o`
  - `claude-sonnet-4-5-20250929`, `claude-opus-4-5-20251101`, `claude-haiku-4-5-20251001`
  - `gemini-3.1-flash-lite-preview-lite`

## 11.2 Critical Flows to Manually Verify

### Agents & Coordinator
- [ ] Fast Agent Panel basic query with default model (`gpt-5.2`).
- [ ] Fast Agent Panel switching between:
  - `gpt-5.2`
  - `claude-sonnet-4.5`
  - `claude-opus-4.5`
  - `claude-haiku-4.5`
  - `gemini-3-pro-preview`
  - `gemini-2.5-pro`
  - `gemini-3.1-flash-lite-preview`
- [ ] Multi-agent coordinator flow (delegation to subagents) still runs end-to-end.

### Data Access & Arbitrage
- [ ] `convex/domains/agents/dataAccess/agent.ts` flows (calendar/tasks) still respond and call the correct provider.
- [ ] `convex/domains/agents/arbitrage/agent.ts` can fan out across providers without model errors.

### Search, SEC, Tags
- [ ] `convex/domains/search/rag.ts` uses the new default model and returns answers.
- [ ] `convex/tools/sec/secCompanySearch.ts` can call its LLM helper via `modelResolver`.
- [ ] `convex/tags_actions.ts` can still generate tags using the new model catalog.

### Python MCP (Once Implemented)
- [ ] Start Python MCP server (`research` server).
- [ ] Call `initialize_context`, `init_task_tracker`, `update_task_status`, `get_task_summary` successfully.
- [ ] Run at least one end-to-end “iterative_search” LLM workflow that reads/writes from Convex.

---

# Part 12: Risks & Open Questions

## 12.1 Known Risks

- **Hidden model references**: there might still be hardcoded model IDs in rarely used scripts or docs.
- **Provider changes**: OpenAI / Anthropic / Google may update or deprecate some of the 2025 models.
- **Cost profile changes**: consolidating to higher-end models might change cost characteristics for some tiers.

Mitigations:
- Centralize all model names in `modelCatalog.ts` + `modelResolver.ts`.
- Keep `MODEL_TO_SDK_ID` mapping small and explicit.
- Use logging to quickly detect unresolved or deprecated models.

## 12.2 Decisions to Finalize Before Implementation

- [ ] Exact behavior when a client passes an **unsupported** model string (hard error vs alias).
- [ ] Whether to keep any **legacy aliases** (e.g. `gpt-5.1` → `gpt-5.2`) during a transition period.
- [ ] Whether `python-mcp-servers/` should be **migrated** into `mcp/python/` or simply augmented with ConvexClient.
- [ ] Copy/UX for model selection UI in Fast Agent Panel & ModelSelector (names, descriptions, provider badges).

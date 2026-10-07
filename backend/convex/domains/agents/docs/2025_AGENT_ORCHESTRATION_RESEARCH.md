# 2025 Agent Orchestration Research

## Overview

This document synthesizes research from five key 2025 sources on agent orchestration patterns:

1. **LangChain Multi-Agent Guide (April 2025)** - Supervisor/Worker patterns
2. **LangChain Agent Architectures (July 2025)** - Memory and orchestration patterns
3. **Anthropic: Building Effective Agents (April 2025)** - Simplicity over complexity
4. **Anthropic: Context Engineering (June 2025)** - Agentic context optimization
5. **Anthropic: Production Agent Patterns (November 2025)** - Enterprise deployment

---

## 1. LangChain Multi-Agent Architecture (April 2025)

### Key Patterns

**Supervisor Pattern:**
- Central supervisor agent routes work to specialized workers
- Each worker has focused toolset and expertise domain
- Supervisor maintains conversation state and delegates tasks

**Worker Specialization:**
- Document workers (search, edit, create)
- Data access workers (calendar, tasks, database)
- Research workers (web search, SEC filings, news)
- Media workers (images, videos, embeddings)

### Implementation Notes
- Use explicit handoff protocols between agents
- Maintain shared context via scratchpads
- Keep worker prompts focused and domain-specific

---

## 2. LangChain Agent Architectures (July 2025)

### Memory Patterns

**Working Memory:**
- Current task context and active documents
- User preferences and session state
- Intermediate results and scratchpad data

**Long-term Memory:**
- User teaching and corrections
- Successful patterns and workflows
- Domain-specific knowledge

### Orchestration Strategies

1. **ReAct Loop** - Reason, Act, Observe cycle
2. **Plan-then-Execute** - Generate plan first, execute steps
3. **Reflexion** - Self-critique and iteration
4. **Tree of Thoughts** - Explore multiple reasoning paths

---

## 3. Anthropic: Building Effective Agents (April 2025)

### Core Philosophy
> "Start with the simplest solution, add complexity only when needed."

### Recommended Approach

1. **Direct Prompting** - Try simple prompts first
2. **Tool Augmentation** - Add tools when prompting fails
3. **Chained Workflows** - Sequence multiple LLM calls
4. **Agentic Loops** - Only when iteration is required

### Anti-Patterns to Avoid

- Over-engineering with multi-agent systems when single agent suffices
- Complex reasoning chains when direct answers work
- Excessive tool calls that waste tokens and latency

---

## 4. Anthropic: Context Engineering (June 2025)

### The 9 Principles

1. **Context is Everything** - Quality of context determines output quality
2. **Explicit Over Implicit** - Don't assume LLM knows your system
3. **Structure Matters** - Well-organized context improves reasoning
4. **Freshness Counts** - Stale context leads to stale answers
5. **Relevance Filtering** - Include only what's needed
6. **User Context Integration** - Preferences, history, permissions
7. **Tool Documentation** - Clear, complete tool descriptions
8. **KV Cache Optimization** - Structure prompts for cache efficiency
9. **Evolving Strategies** - Agents that learn and adapt

### Agentic Context Patterns

- **Context Initializer** - Load session state at start
- **Task Tracker** - Maintain feature list with completion status
- **Progress Logging** - Track what's been attempted
- **Reflection Loops** - Evaluate and adjust approach

---

## 5. Anthropic: Production Agent Patterns (November 2025)

### Enterprise Requirements

1. **Observability** - Full logging of all LLM calls and tool usage
2. **Auditability** - Track who did what, when, why
3. **Reliability** - Graceful degradation, retries, fallbacks


---

## 6. NodeBench Implementation: 5 Canonical Patterns

Based on this research, NodeBench implements these patterns:

### Pattern 1: Context Initializer
**Location:** `convex/domains/agents/mcp_tools/context/`

At session start:
- Load user preferences and recent documents
- Fetch previous session state from scratchpads
- Build `SessionContext` with feature list and capabilities

### Pattern 2: Task Tracker
**Location:** `convex/domains/agents/mcp_tools/tracking/`

For multi-step workflows:
- Initialize task list with `initTaskTracker`
- Update status with `updateTaskStatus`
- Get progress with `getTaskSummary`
- Prevents "premature victory" - all tasks must pass

### Pattern 3: Multi-LLM Central Router
**Location:** `convex/domains/agents/mcp_tools/models/`

Single source of truth for model selection:
- 7 approved models only (GPT-5.2, Claude 4.5 series, Gemini 3/2.5 series)
- Type-safe `getLanguageModel()` function
- Provider failover and logging
- No scattered MODEL_MAP constants

### Pattern 4: Human-in-the-Loop (HITL)
**Location:** `convex/domains/agents/hitl/`

Breakpoints for:
- Risky actions (sending email, external API calls)
- Ambiguous requests needing clarification
- Approval gates before destructive operations

### Pattern 5: Iterative Search with Reflection
**Location:** `mcp/python/` (planned Python MCP servers)

Search → Evaluate → Refine loop:
- Python MCP server with Convex integration
- Accesses documents and scratchpads via ConvexClient
- Emits progress via StandardToolOutput
- Integrates with Task Tracker for status updates

---

## 7. Search Tool Implementation

### Current State (Convex-Native)

The existing search implementation uses **Convex-native hybrid search**:

```typescript
// convex/domains/search/rag.ts
// BM25 keyword search + Vector semantic search + Reciprocal Rank Fusion
```

**Components:**
1. `hybridSearch()` - Combines BM25 and vector search
2. `ragEnhanced.ts` - RAG with LLM validation
3. `ragQuery/ragAction` - Exposed Convex functions

### Future: Python MCP Search Server

The MODEL_CONSOLIDATION_PLAN outlines a Python MCP search server:

**Architecture:**
```
Frontend → Convex Action → HTTP/JSON-RPC → Python MCP Server
                                              ↓
                                         ConvexClient → Convex DB
```

**Tools Exposed:**
- `iterative_search` - Multi-step search with reflection
- `initialize_context` - Context loading (Pattern 1)
- `init_task_tracker`, `update_task_status`, `get_task_summary` (Pattern 2)

**Why Python MCP?**
1. Rich Python ecosystem for NLP/ML (sentence-transformers, spacy)
2. Convex Python client for DB access
3. FastMCP framework for tool definition
4. Can run long-duration search loops

### Implementation Details

**Wire Protocol:**
- JSON-RPC 2.0 over HTTP
- Methods: `tools/list`, `tools/call`
- Standard request/response format

**Server Registry:**
```typescript
// convex/domains/agents/mcp_clients/registry.ts
export const MCP_SERVER_REGISTRY = {
  research: {
    id: "research",
    baseUrl: "http://localhost:8003/mcp",
    convexAware: true,
    tools: ["initialize_context", "iterative_search", ...]
  }
};
```

**Calling from Convex:**
```typescript
// convex/domains/agents/mcp_clients/callTool.ts
export async function callMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<McpToolResult>
```

**Python Server Structure:**
```python
# mcp/python/src/nodebench_mcp/servers/research/server.py
from fastmcp import FastMCP
from ..common.convex_client import query, mutation

mcp = FastMCP("research")

@mcp.tool()
async def iterative_search(query: str, context: dict) -> dict:
    # 1. Fetch relevant documents via ConvexClient
    docs = await query("documents.search", {"query": query})

    # 2. LLM evaluation of results
    # 3. Refine search if needed
    # 4. Return structured StandardToolOutput
```

---

## References

1. LangChain. "Multi-Agent Supervisor Pattern." April 2025.
2. LangChain. "Agent Memory and Orchestration." July 2025.
3. Anthropic. "Building Effective Agents." April 2025.
4. Anthropic. "Agentic Context Engineering." June 2025.
5. Anthropic. "Production Agent Patterns." November 2025.

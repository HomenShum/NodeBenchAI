# Fast Agents - Deep Agents 2.0 Architecture

This directory contains the Deep Agents 2.0 implementation for NodeBench AI, following the [Deep Agents 2.0 architecture](https://www.philschmid.de/agents-2.0-deep-agents) and [Convex Agent documentation](https://docs.convex.dev/agents).

## 🏗️ Architecture

The Fast Agents system uses a **hierarchical delegation pattern** with four pillars:

1. **Explicit Planning** - Task plans as tool-accessible documents
2. **Hierarchical Delegation** - Coordinator → Specialized subagents
3. **Persistent Memory** - External storage for intermediate results
4. **Extreme Context Engineering** - Detailed orchestrator instructions

### Directory Structure

```
fast_agents/
├── coordinatorAgent.ts          # Deep Agents 2.0 orchestrator
├── prompts.ts                    # Shared prompt templates
├── delegation/                   # Delegation infrastructure
│   ├── delegationHelpers.ts     # Thread management, response formatting
│   ├── delegationTools.ts       # Delegation tool factory
│   └── README.md
└── subagents/                    # Specialized sub-agents
    ├── document_subagent/        # Document operations
    ├── media_subagent/           # Media discovery
    ├── sec_subagent/             # SEC filings
    └── openbb_subagent/          # Financial data
```

### Key Files

- **`coordinatorAgent.ts`** - Deep Agents 2.0 orchestrator with delegation, planning, and memory tools
- **`delegation/`** - Delegation infrastructure for hierarchical agent coordination
- **`subagents/`** - Specialized agents with domain-specific tools
- **`prompts.ts`** - Shared prompt templates

## Agent Configuration

All agents follow the latest Convex Agent patterns:

```typescript
import { Agent, stepCountIs } from "@convex-dev/agent";
import { openai } from "@ai-sdk/openai";
import { components } from "../_generated/api";

const agent = new Agent(components.agent, {
  name: "AgentName",
  languageModel: openai.chat("gpt-5.4-mini"),
  textEmbeddingModel: openai.embedding("text-embedding-3-small"),
  instructions: "System prompt...",
  tools: {
    // Explicitly pass all tools
    toolName: createTool({ ... }),
  },
  stopWhen: stepCountIs(15),
  usageHandler: async (ctx, args) => {
    // Track usage for billing/analytics
  },
});
```

## 🛠️ Available Tools

The coordinator agent has access to three categories of tools:

### 1. Delegation Tools (Primary)
- `delegateToDocumentAgent` - Delegate document operations
- `delegateToMediaAgent` - Delegate media discovery
- `delegateToSECAgent` - Delegate SEC filings research
- `delegateToOpenBBAgent` - Delegate financial data queries

### 2. Planning & Memory Tools (MCP)
**Planning:**
- `createPlan` - Create explicit task plan
- `updatePlanStep` - Update plan step status
- `getPlan` - Retrieve plan

**Memory:**
- `writeAgentMemory` - Store intermediate results
- `readAgentMemory` - Retrieve stored data
- `listAgentMemory` - List all memory entries
- `deleteAgentMemory` - Clean up memory

### 3. Direct Access Tools
**Web Search:**
- `linkupSearch` - Web search
- `youtubeSearch` - YouTube search

**Data Access:**
- `listTasks`, `createTask`, `updateTask`
- `listEvents`, `createEvent`
- `getFolderContents`

**Hashtags & Dossiers:**
- `searchHashtag`, `createHashtagDossier`, `getOrCreateHashtagDossier`

**Funding Research:**
- `searchTodaysFunding`, `enrichFounderInfo`, `enrichInvestmentThesis`, `enrichPatentsAndResearch`, `enrichCompanyDossier`

### Subagent Tools (Accessed via Delegation)

Each subagent has its own specialized tools. See `subagents/*/README.md` for details.

## 🚀 Usage

### Basic Usage

```typescript
import { createCoordinatorAgent } from "./fast_agents/coordinatorAgent";

// Create the orchestrator
const coordinator = createCoordinatorAgent("gpt-4o");

// The coordinator automatically delegates to subagents
const result = await coordinator.generateText(
  ctx,
  { threadId, userId },
  { prompt: "Find documents about revenue" }
);
```

### Streaming Usage

```typescript
// In fastAgentPanelStreaming.ts
const agent = createCoordinatorAgent(args.model);

const result = await agent.streamText(
  ctx,
  { threadId: thread._id },
  { prompt: args.prompt, userId: args.userId }
);
```

## 📚 Documentation

For detailed information, see:

- **[Quick Start Guide](../../QUICK_START_GUIDE.md)** - Getting started with Deep Agents 2.0
- **[Implementation Summary](../../IMPLEMENTATION_SUMMARY.md)** - Complete implementation details
- **[Changelog](../../CHANGELOG_2025-11-22_DEEP_AGENTS_MCP_ARCHITECTURE.md)** - Full architecture documentation
- **[Subagents README](./subagents/README.md)** - Subagent architecture
- **[Delegation README](./delegation/README.md)** - Delegation infrastructure

## 🎯 Best Practices

1. **Delegate First** - Always check if a subagent can handle the task before using direct tools
2. **Use Planning** - Create explicit plans for complex multi-step tasks (3+ steps)
3. **Use Memory** - Store intermediate results to avoid context overflow
4. **Track Progress** - Update plan steps as you complete them
5. **Synthesize Results** - When using multiple agents, combine their outputs into a coherent answer
6. **Step Limits** - Coordinator uses 25 steps for orchestration overhead; subagents use 8-10 steps

## 📖 References

- [Deep Agents 2.0 Article](https://www.philschmid.de/agents-2.0-deep-agents) - Architecture inspiration
- [Convex Agent Documentation](https://docs.convex.dev/agents) - Convex Agent framework
- [Convex Agent Component](https://www.convex.dev/components/agent) - Agent component

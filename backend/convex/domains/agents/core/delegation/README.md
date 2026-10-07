# Delegation Infrastructure

Utilities and tools for hierarchical delegation in the Deep Agents 2.0 architecture.

## 🎯 Purpose

This directory contains the infrastructure that enables the coordinator agent to delegate tasks to specialized subagents.

## 📁 Files

### `delegationHelpers.ts`

Utility functions for managing delegation:

- **`DelegationCtx`** - Extended context type with optional `evaluationUserId`
- **`pickUserId(ctx)`** - Select appropriate user ID from context
- **`ensureThread(agent, ctx, threadId?)`** - Create or reuse agent thread
- **`formatDelegationResult(...)`** - Format delegation response consistently
- **`extractToolNames(result)`** - Extract tool names from agent result

### `delegationTools.ts`

Delegation tools for the coordinator agent:

- **`buildDelegationTools(model)`** - Factory function that creates all delegation tools
- **`delegateToDocumentAgent`** - Delegate document tasks
- **`delegateToMediaAgent`** - Delegate media discovery tasks
- **`delegateToSECAgent`** - Delegate SEC filing tasks
- **`delegateToOpenBBAgent`** - Delegate financial data tasks

## 🚀 Usage

```typescript
import { buildDelegationTools } from "./delegation/delegationTools";

// In coordinator agent
const delegationTools = buildDelegationTools("gpt-4o");

const coordinator = new Agent(components.agent, {
  name: "CoordinatorAgent",
  tools: {
    ...delegationTools,
    // ... other tools
  },
});
```

## 🔄 Delegation Flow

1. **Coordinator receives user query**
2. **Coordinator decides which subagent to delegate to**
3. **Coordinator calls delegation tool** (e.g., `delegateToDocumentAgent`)
4. **Delegation tool**:
   - Ensures thread exists
   - Calls subagent with query
   - Waits for subagent to complete
   - Extracts tool usage
   - Returns formatted result
5. **Coordinator receives result** with:
   - `delegate`: Name of subagent
   - `threadId`: Thread ID for follow-ups
   - `messageId`: Message ID
   - `text`: Subagent's answer
   - `toolsUsed`: Array of tools used
6. **Coordinator synthesizes final response** for user

## 📋 Delegation Response Format

```typescript
{
  delegate: "DocumentAgent",
  threadId: "thread_abc123",
  messageId: "msg_xyz789",
  text: "I found 3 documents matching your query...",
  toolsUsed: ["findDocument", "getDocumentContent"]
}
```

## 🎯 When to Delegate

The coordinator should delegate when:

- **Document operations** → DocumentAgent
- **Media discovery** → MediaAgent
- **SEC filings** → SECAgent
- **Financial data** → OpenBBAgent

The coordinator should handle directly:

- Simple queries that don't need specialized tools
- Multi-agent coordination (e.g., "find documents and videos")
- Planning and memory operations
- User interaction and clarification

## 📞 Owner

Core Agent Team


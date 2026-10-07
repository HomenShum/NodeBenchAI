# MCP Tool Wrappers

Convex Agent tools that wrap MCP server functionality.

## 🎯 Purpose

These wrappers provide a clean interface for agents to access MCP server tools. Each wrapper:

1. Uses `createTool` from `@convex-dev/agent`
2. Calls `ctx.runAction(api.mcpClient.callMcpTool, {...})` with a Convex fallback for resilience
3. Handles errors gracefully
4. Returns formatted strings for agent consumption

## 📁 Files

### `coreAgentTools.ts`

Wrappers for planning and memory tools from `core_agent_server` (MCP-first with Convex fallback):

**Planning Tools**:
- `createPlan` - Create explicit task plan
- `updatePlanStep` - Update plan step status
- `getPlan` - Retrieve existing plan

**Memory Tools**:
- `writeAgentMemory` - Store intermediate results
- `readAgentMemory` - Retrieve stored data
- `listAgentMemory` - List all memory entries
- `deleteAgentMemory` - Delete memory entry

### `dataAccessTools.ts` (TODO)

Wrappers for task, event, and folder management from `data_access_server`.

### `researchTools.ts` (TODO)

Wrappers for funding research, people profiles, and news discovery from `research_server`.

### `newsletterTools.ts` (TODO)

Wrappers for newsletter generation and management from `newsletter_server`.

## 🚀 Usage

```typescript
import { createPlan, writeAgentMemory } from "../tools/wrappers/coreAgentTools";

const coordinator = new Agent(components.agent, {
  name: "CoordinatorAgent",
  tools: {
    createPlan,
    writeAgentMemory,
    // ... other tools
  },
});
```

## 🔧 Pattern

All wrappers follow this pattern:

```typescript
export const myTool = createTool({
  description: "Tool description for the agent",
  args: z.object({
    param: z.string().describe("Parameter description"),
  }),
  handler: async (ctx, args): Promise<string> => {
    try {
      const result = await ctx.runAction(api.mcpClient.callMcpTool, {
        serverId: "server_name" as any,
        toolName: "toolName",
        parameters: args,
      });
      
      if (result.success) {
        return result.result;
      }
      
      return `Failed to ...: ${result.error}`;
    } catch (error: any) {
      return `Error ...: ${error.message}`;
    }
  },
});
```

## 📝 Notes

- All wrappers return strings (not JSON) for agent consumption
- Error handling is consistent across all wrappers
- Server IDs are cast to `any` to bypass type checking (MCP servers are external)
- Wrappers are lightweight - business logic stays in MCP servers

## 📞 Owner

Core Agent Team

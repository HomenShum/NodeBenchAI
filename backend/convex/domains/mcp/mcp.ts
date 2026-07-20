// convex/domains/mcp/mcp.ts - Model Context Protocol integration for NodeBench
import { v } from "convex/values";
import { internalAction, internalMutation, mutation, query } from "../../_generated/server";
import { internal, api } from "../../_generated/api";
import { discoverToolsWithSdk } from "../../lib/mcpTransport";
import { Doc, Id } from "../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

/* ------------------------------------------------------------------ */
/* MCP SERVER MANAGEMENT                                              */
/* ------------------------------------------------------------------ */

/**
 * Add a new MCP server configuration
 */
export const addMcpServer = mutation({  
  args: {
    name: v.string(),
    url: v.optional(v.string()),
    apiKey: v.optional(v.string()),
  },
  returns: v.id("mcpServers"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Authentication required");
    }

    // Check for duplicate names
    const existing = await ctx.db
      .query("mcpServers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("name"), args.name))
      .first() as Doc<"mcpServers"> | null;

    if (existing) {
      throw new Error(`MCP server with name "${args.name}" already exists`);
    }

    const now = Date.now();
    const serverId = await ctx.db.insert("mcpServers", {
      name: args.name,
      url: args.url,
      apiKey: args.apiKey, // TODO: Encrypt in production
      userId,
      createdAt: now,
      updatedAt: now,
    });

    // Automatically discover and store tools from the new server
    if (args.url) {
      await ctx.scheduler.runAfter(0, internal.domains.mcp.mcp.discoverAndStoreTools, {
        serverId,
        serverUrl: args.url
      });
    }

    return serverId;
  },
});

/**
 * Store per-user MCP tool usage history (for previewing past usage cases)
 */
export const storeUsageHistory = internalMutation({
  args: {
    userId: v.id("users"),
    toolId: v.id("mcpTools"),
    serverId: v.id("mcpServers"),
    naturalLanguageQuery: v.string(),
    parameters: v.any(),
    executionSuccess: v.boolean(),
    resultPreview: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  returns: v.id("mcpToolHistory"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("mcpToolHistory", {
      ...args,
      createdAt: now,
    });
    return id;
  },
});

/**
 * List current user's history for a specific tool (most recent first)
 */
export const listToolHistory = query({
  args: {
    toolId: v.id("mcpTools"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("mcpToolHistory"),
      userId: v.id("users"),
      toolId: v.id("mcpTools"),
      serverId: v.id("mcpServers"),
      naturalLanguageQuery: v.string(),
      parameters: v.any(),
      executionSuccess: v.boolean(),
      resultPreview: v.optional(v.string()),
      errorMessage: v.optional(v.string()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, { toolId, limit }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const q = ctx.db
      .query("mcpToolHistory")
      .withIndex("by_user_tool_createdAt", (q) => q.eq("userId", userId).eq("toolId", toolId))
      .order("desc");

    const rows = await (limit && limit > 0 ? q.take(limit) : q.take(5)) as Doc<"mcpToolHistory">[];
    // Strip system fields like _creationTime to match validator
    return rows.map((r: Doc<"mcpToolHistory">) => ({
      _id: r._id,
      userId: r.userId,
      toolId: r.toolId,
      serverId: r.serverId,
      naturalLanguageQuery: r.naturalLanguageQuery,
      parameters: r.parameters,
      executionSuccess: r.executionSuccess,
      resultPreview: r.resultPreview,
      errorMessage: r.errorMessage,
      createdAt: r.createdAt,
    }));
  },
});

/**
 * List current user's recent MCP tool usage across tools (most recent first)
 */
export const listUserHistory = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("mcpToolHistory"),
      userId: v.id("users"),
      toolId: v.id("mcpTools"),
      serverId: v.id("mcpServers"),
      naturalLanguageQuery: v.string(),
      parameters: v.any(),
      executionSuccess: v.boolean(),
      resultPreview: v.optional(v.string()),
      errorMessage: v.optional(v.string()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, { limit }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const q = ctx.db
      .query("mcpToolHistory")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
      .order("desc");

    const rows = await (limit && limit > 0 ? q.take(limit) : q.take(20)) as Doc<"mcpToolHistory">[];
    // Strip system fields like _creationTime to match validator
    return rows.map((r: Doc<"mcpToolHistory">) => ({
      _id: r._id,
      userId: r.userId,
      toolId: r.toolId,
      serverId: r.serverId,
      naturalLanguageQuery: r.naturalLanguageQuery,
      parameters: r.parameters,
      executionSuccess: r.executionSuccess,
      resultPreview: r.resultPreview,
      errorMessage: r.errorMessage,
      createdAt: r.createdAt,
    }));
  },
});

/**
 * Add a tool to an MCP server
 */
export const addMcpTool = mutation({
  args: {
    serverId: v.id("mcpServers"),
    name: v.string(),
    description: v.string(),
    inputSchema: v.any(),
  },
  returns: v.id("mcpTools"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Authentication required");
    }

    // Verify server exists and user owns it
    const server = await ctx.db.get(args.serverId) as Doc<"mcpServers"> | null;
    if (!server) {
      throw new Error("MCP server not found");
    }

    if (server.userId !== userId) {
      throw new Error("Access denied");
    }

    // Check for existing tool with same name
    const existing = await ctx.db
      .query("mcpTools")
      .withIndex("by_server", (q) => q.eq("serverId", args.serverId))
      .filter((q) => q.eq(q.field("name"), args.name))
      .first() as Doc<"mcpTools"> | null;

    if (existing) {
      // Update existing tool
      await ctx.db.patch(existing._id, {
        description: args.description,
        schema: args.inputSchema,
        updatedAt: Date.now(),
        isAvailable: true,
      });
      return existing._id;
    } else {
      // Create new tool
      const toolId = await ctx.db.insert("mcpTools", {
        serverId: args.serverId,
        name: args.name,
        description: args.description,
        schema: args.inputSchema,
        isAvailable: true,
        isEnabled: true,
        usageCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return toolId;
    }
  },
});

/**
 * Update an existing MCP server configuration
 */
export const updateMcpServer = mutation({
  args: {
    serverId: v.id("mcpServers"),
    name: v.optional(v.string()),
    url: v.optional(v.string()),
    apiKey: v.optional(v.string()),
    description: v.optional(v.string()),
    isEnabled: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Authentication required");
    }

    const server = await ctx.db.get(args.serverId) as Doc<"mcpServers"> | null;
    if (!server) {
      throw new Error("MCP server not found");
    }

    if (server.userId !== userId) {
      throw new Error("Access denied");
    }

    const updates: any = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) updates.name = args.name;
    if (args.url !== undefined) updates.url = args.url;
    if (args.apiKey !== undefined) updates.apiKey = args.apiKey;
    if (args.description !== undefined) updates.description = args.description;
    if (args.isEnabled !== undefined) updates.isEnabled = args.isEnabled;

    await ctx.db.patch(args.serverId, updates);

    return null;
  },
});

/**
 * Delete an MCP server and all associated data
 */
export const deleteMcpServer = mutation({
  args: {
    serverId: v.id("mcpServers"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Authentication required");
    }

    const server = await ctx.db.get(args.serverId) as Doc<"mcpServers"> | null;
    if (!server) {
      throw new Error("MCP server not found");
    }

    if (server.userId !== userId) {
      throw new Error("Access denied");
    }

    // Disconnect any active sessions
    await ctx.scheduler.runAfter(0, internal.domains.mcp.mcp.disconnectFromServer, { serverId: args.serverId });

    // Delete associated tools
    const tools = await ctx.db
      .query("mcpTools")
      .withIndex("by_server", (q) => q.eq("serverId", args.serverId))
      .collect() as Doc<"mcpTools">[];

    for (const tool of tools) {
      await ctx.db.delete(tool._id);
    }

    // Delete associated sessions
    const sessions = await ctx.db
      .query("mcpSessions")
      .withIndex("by_server", (q) => q.eq("serverId", args.serverId))
      .collect() as Doc<"mcpSessions">[];

    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }

    // Delete the server
    await ctx.db.delete(args.serverId);

    return null;
  },
});

/**
 * List MCP servers for the current user
 */
export const listMcpServers = query({
  args: {},
  returns: v.array(v.object({
    _id: v.id("mcpServers"),
    name: v.string(),
    url: v.optional(v.string()),
    apiKey: v.optional(v.string()),
    description: v.optional(v.string()),
    isEnabled: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
    toolCount: v.number(),
  })),
  handler: async (ctx, _args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const servers = await ctx.db.query("mcpServers").withIndex("by_user", (q) => q.eq("userId", userId)).collect() as Doc<"mcpServers">[];

    // Get tool counts for each server
    const serversWithCounts = await Promise.all(
      servers.map(async (server: Doc<"mcpServers">) => {
        const toolCount = await ctx.db
          .query("mcpTools")
          .withIndex("by_server", (q) => q.eq("serverId", server._id))
          .collect()
          .then((tools: Doc<"mcpTools">[]) => tools.length);

        return {
          _id: server._id,
          name: server.name,
          url: server.url,
          apiKey: server.apiKey,
          description: server.description,
          isEnabled: server.isEnabled,
          createdAt: server.createdAt,
          updatedAt: server.updatedAt,
          toolCount,
        };
      })
    );

    return serversWithCounts;
  },
});

/**
 * Get tools available from MCP servers
 */
export const getMcpTools = query({
  args: {
    serverId: v.optional(v.id("mcpServers")),
    availableOnly: v.optional(v.boolean()),
  },
  returns: v.array(v.object({
    _id: v.id("mcpTools"),
    _creationTime: v.number(),
    serverId: v.id("mcpServers"),
    serverName: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    schema: v.optional(v.any()),
    isAvailable: v.boolean(),
    isEnabled: v.optional(v.boolean()),
    lastUsed: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    usageCount: v.optional(v.number()),
  })),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    let toolsQuery;
    if (args.serverId) {
      // Get tools for specific server
      const server = await ctx.db.get(args.serverId) as Doc<"mcpServers"> | null;
      if (!server || server.userId !== userId) {
        return [];
      }
      toolsQuery = ctx.db.query("mcpTools").withIndex("by_server", (q) => q.eq("serverId", args.serverId));
    } else {
      // Get all tools for user's servers
      const userServers = await ctx.db
        .query("mcpServers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect() as Doc<"mcpServers">[];

      const serverIds = userServers.map((s: Doc<"mcpServers">) => s._id);
      const allTools = await Promise.all(
        serverIds.map((serverId: Id<"mcpServers">) =>
          ctx.db.query("mcpTools").withIndex("by_server", (q) => q.eq("serverId", serverId)).collect()
        )
      ) as Doc<"mcpTools">[][];

      const tools = allTools.flat();
      if (args.availableOnly) {
        return tools
          .filter((tool: Doc<"mcpTools">) => tool.isAvailable)
          .map((tool: Doc<"mcpTools">) => {
            const server = userServers.find((s: Doc<"mcpServers">) => s._id === tool.serverId);
            return {
              ...tool,
              serverName: server?.name || "Unknown",
            };
          });
      }

      return tools.map((tool: Doc<"mcpTools">) => {
        const server = userServers.find((s: Doc<"mcpServers">) => s._id === tool.serverId);
        return {
          ...tool,
          serverName: server?.name || "Unknown",
        };
      });
    }

    if (args.availableOnly) {
      toolsQuery = toolsQuery.filter((q) => q.eq(q.field("isAvailable"), true));
    }

    const tools = await toolsQuery.collect() as Doc<"mcpTools">[];

    // Add server names
    const toolsWithServerNames = await Promise.all(
      tools.map(async (tool: Doc<"mcpTools">) => {
        const server = await ctx.db.get(tool.serverId) as Doc<"mcpServers"> | null;
        return {
          ...tool,
          serverName: server?.name || "Unknown",
        };
      })
    );

    return toolsWithServerNames;
  },
});

/* ------------------------------------------------------------------ */
/* INTERNAL FUNCTIONS FOR MCP CONNECTION MANAGEMENT                  */
/* ------------------------------------------------------------------ */

/**
 * Internal action to connect to an MCP server
 */
export const connectToServer = internalAction({
  args: {
    serverId: v.id("mcpServers"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const server = await ctx.runQuery(api.domains.mcp.mcp.getMcpServerById, { serverId: args.serverId });
    if (!server || server.isEnabled === false) {
      return null;
    }

    try {
      await ctx.runMutation(internal.domains.mcp.mcp.updateServerStatus, {
        serverId: args.serverId,
        status: "connecting",
        errorMessage: undefined,
      });

      // Discover tools from the remote MCP server
      if (server.url) {
        await ctx.runAction(internal.domains.mcp.mcp.discoverAndStoreTools, {
          serverId: args.serverId,
          serverUrl: server.url,
          apiKey: server.apiKey,
        });
      }

      await ctx.runMutation(internal.domains.mcp.mcp.updateServerStatus, {
        serverId: args.serverId,
        status: "connected",
        errorMessage: undefined,
        lastConnected: Date.now(),
      });

    } catch (error) {
      console.error(`Failed to connect to MCP server ${args.serverId}:`, error);
      await ctx.runMutation(internal.domains.mcp.mcp.updateServerStatus, {
        serverId: args.serverId,
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });
    }

    return null;
  },
});

/**
 * Internal action to disconnect from an MCP server
 */
export const disconnectFromServer = internalAction({
  args: {
    serverId: v.id("mcpServers"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      // Update status to disconnected
      await ctx.runMutation(internal.domains.mcp.mcp.updateServerStatus, {
        serverId: args.serverId,
        status: "disconnected",
        errorMessage: undefined,
      });

      // Mark all tools as unavailable
      await ctx.runMutation(internal.domains.mcp.mcp.markToolsUnavailable, { serverId: args.serverId });

    } catch (error) {
      console.error(`Failed to disconnect from MCP server ${args.serverId}:`, error);
    }

    return null;
  },
});

/**
 * Internal query to get MCP server by ID
 */
export const getMcpServerById = query({
  args: {
    serverId: v.id("mcpServers"),
  },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.serverId) as Doc<"mcpServers"> | null;
  },
});

/**
 * Internal action to discover and store tools from MCP server
 */
export const discoverAndStoreTools = internalAction({
  args: {
    serverId: v.id("mcpServers"),
    serverUrl: v.string(),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { serverId, serverUrl, apiKey }) => {
    try {
      const tools = await discoverToolsWithSdk(serverUrl, apiKey);

      // Mark existing tools unavailable before refresh
      await ctx.runMutation(internal.domains.mcp.mcp.markToolsUnavailable, { serverId });

      const storedToolIds: Id<"mcpTools">[] = [];
      for (const tool of tools) {
        const toolId = await ctx.runMutation(internal.domains.mcp.mcp.storeMcpTool, {
          serverId,
          name: tool.name,
          description: tool.description || `Execute ${tool.name} via MCP`,
          inputSchema: tool.inputSchema || {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        });
        if (toolId) storedToolIds.push(toolId);
      }

      console.log(`[MCP] Stored ${storedToolIds.length} tools for server ${serverId}`);
    } catch (error) {
      console.error(`[MCP] Failed to discover tools for server ${serverId}:`, error);
    }
    
    return null;
  },
});

/**
 * Internal mutation to store MCP tool
 */
export const storeMcpTool = internalMutation({
  args: {
    serverId: v.id("mcpServers"),
    name: v.string(),
    description: v.string(),
    inputSchema: v.any(),
  },
  returns: v.id("mcpTools"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mcpTools")
      .withIndex("by_server", (q) => q.eq("serverId", args.serverId))
      .filter((q) => q.eq(q.field("name"), args.name))
      .first() as Doc<"mcpTools"> | null;

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        description: args.description,
        schema: args.inputSchema,
        isAvailable: true,
        updatedAt: now,
      });
      console.log(`[MCP] Updated tool: ${args.name}`);
      return existing._id;
    }

    const newId = await ctx.db.insert("mcpTools", {
      serverId: args.serverId,
      name: args.name,
      description: args.description,
      schema: args.inputSchema,
      isAvailable: true,
      isEnabled: true,
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`[MCP] Stored tool: ${args.name}`);
    return newId;
  },
});

export const incrementMcpUsage = internalMutation({
  args: {
    userId: v.optional(v.id("users")),
    date: v.string(), // YYYY-MM-DD
    limit: v.number(),
  },
  returns: v.object({ allowed: v.boolean(), count: v.number() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("dailyUsage")
      .withIndex("by_user_provider_date", (q) => q.eq("userId", args.userId ?? undefined).eq("provider", "mcp").eq("date", args.date))
      .first() as Doc<"dailyUsage"> | null;

    const now = Date.now();
    if (!existing) {
      await ctx.db.insert("dailyUsage", {
        userId: args.userId ?? undefined,
        provider: "mcp",
        date: args.date,
        count: 1,
        limit: args.limit,
        updatedAt: now,
      });
      return { allowed: true, count: 1 };
    }

    const newCount = (existing.count ?? 0) + 1;
    if (existing.limit && newCount > existing.limit && existing.limit <= args.limit) {
      return { allowed: false, count: existing.count ?? 0 };
    }

    await ctx.db.patch(existing._id, {
      count: newCount,
      limit: args.limit,
      updatedAt: now,
    });
    return { allowed: newCount <= args.limit, count: newCount };
  },
});

export const getToolByName = query({
  args: {
    serverId: v.id("mcpServers"),
    name: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id("mcpTools"),
      serverId: v.id("mcpServers"),
      name: v.string(),
      description: v.optional(v.string()),
      schema: v.optional(v.any()),
      isAvailable: v.boolean(),
      isEnabled: v.optional(v.boolean()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const tool = await ctx.db
      .query("mcpTools")
      .withIndex("by_server", (q) => q.eq("serverId", args.serverId))
      .filter((q) => q.eq(q.field("name"), args.name))
      .first() as Doc<"mcpTools"> | null;
    if (!tool) return null;
    return {
      _id: tool._id,
      serverId: tool.serverId,
      name: tool.name,
      description: tool.description,
      schema: tool.schema,
      isAvailable: tool.isAvailable,
      isEnabled: tool.isEnabled,
      createdAt: tool.createdAt,
      updatedAt: tool.updatedAt,
    };
  },
});

/**
 * Clear all tools for a server
 */
export const clearServerTools = internalMutation({
  args: {
    serverId: v.id("mcpServers"),
  },
  handler: async (ctx, args) => {
    const tools = await ctx.db
      .query("mcpTools")
      .withIndex("by_server", (q) => q.eq("serverId", args.serverId))
      .collect() as Doc<"mcpTools">[];

    for (const tool of tools) {
      await ctx.db.delete(tool._id);
    }
  },
});

/**
 * Add a discovered tool to the database
 */
export const addDiscoveredTool = internalMutation({
  args: {
    serverId: v.id("mcpServers"),
    name: v.string(),
    description: v.string(),
    schema: v.any(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("mcpTools", {
      serverId: args.serverId,
      name: args.name,
      description: args.description,
      schema: args.schema,
      isAvailable: true,
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Update tool usage statistics
 */
export const updateToolUsage = internalMutation({
  args: {
    toolId: v.id("mcpTools"),
    success: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const tool = await ctx.db.get(args.toolId) as Doc<"mcpTools"> | null;
    if (!tool) return null;

    await ctx.db.patch(args.toolId, {
      usageCount: (tool.usageCount || 0) + 1,
      lastUsed: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Update an individual MCP tool's properties (public mutation)
 */
export const updateMcpTool = mutation({
  args: {
    toolId: v.id("mcpTools"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    isEnabled: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Authentication required");
    }

    const tool = await ctx.db.get(args.toolId) as Doc<"mcpTools"> | null;
    if (!tool) {
      throw new Error("Tool not found");
    }

    // Check if the tool belongs to a server owned by the user
    const server = await ctx.db.get(tool.serverId) as Doc<"mcpServers"> | null;
    if (!server || server.userId !== userId) {
      throw new Error("Not authorized to modify this tool");
    }

    // Check for duplicate names if name is being changed
    if (args.name && args.name !== tool.name) {
      const existing = await ctx.db
        .query("mcpTools")
        .withIndex("by_server", (q) => q.eq("serverId", tool.serverId))
        .filter((q) => q.eq(q.field("name"), args.name))
        .first() as Doc<"mcpTools"> | null;

      if (existing) {
        throw new Error(`Tool with name "${args.name}" already exists on this server`);
      }
    }

    // Update the tool
    const updates: any = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.isEnabled !== undefined) updates.isEnabled = args.isEnabled;

    await ctx.db.patch(args.toolId, updates);
    return null;
  },
});

/**
 * Delete an individual MCP tool (public mutation)
 */
export const deleteMcpTool = mutation({
  args: {
    toolId: v.id("mcpTools"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Authentication required");
    }

    const tool = await ctx.db.get(args.toolId) as Doc<"mcpTools"> | null;
    if (!tool) {
      throw new Error("Tool not found");
    }

    // Check if the tool belongs to a server owned by the user
    const server = await ctx.db.get(tool.serverId) as Doc<"mcpServers"> | null;
    if (!server || server.userId !== userId) {
      throw new Error("Not authorized to delete this tool");
    }

    // Delete the tool
    await ctx.db.delete(args.toolId);
    return null;
  },
});

/**
 * Internal mutation to update server connection status
 */
export const updateServerStatus = internalMutation({
  args: {
    serverId: v.id("mcpServers"),
    status: v.union(v.literal("connecting"), v.literal("connected"), v.literal("disconnected"), v.literal("error")),
    errorMessage: v.optional(v.string()),
    lastConnected: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Check if the server exists before trying to update it
    const server = await ctx.db.get(args.serverId) as Doc<"mcpServers"> | null;
    if (!server) {
      console.warn(`[updateServerStatus] Server ${args.serverId} not found, skipping update`);
      return null;
    }

    const updates: any = {
      connectionStatus: args.status,
      updatedAt: Date.now(),
    };

    if (args.errorMessage !== undefined) {
      updates.errorMessage = args.errorMessage;
    }
    if (args.lastConnected !== undefined) {
      updates.lastConnected = args.lastConnected;
    }

    try {
      await ctx.db.patch(args.serverId, updates);
    } catch (error) {
      console.error(`[updateServerStatus] Failed to update server ${args.serverId}:`, error);
      throw error;
    }
    return null;
  },
});

/**
 * Internal mutation to mark all tools for a server as unavailable
 */
export const markToolsUnavailable = internalMutation({
  args: {
    serverId: v.id("mcpServers"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const tools = await ctx.db
      .query("mcpTools")
      .withIndex("by_server", (q) => q.eq("serverId", args.serverId))
      .collect() as Doc<"mcpTools">[];

    for (const tool of tools) {
      await ctx.db.patch(tool._id, {
        isAvailable: false,
        updatedAt: Date.now(),
      });
    }

    return null;
  },
});

/**
 * Internal mutation to add sample tools (for demo purposes)
 */
export const addSampleTools = internalMutation({
  args: {
    serverId: v.id("mcpServers"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const server = await ctx.db.get(args.serverId) as Doc<"mcpServers"> | null;
    if (!server) return null;

    const now = Date.now();
    const sampleTools: Array<{ name: string; description: string; schema: any }> = [];

    // Add different sample tools based on server name/type
    if (server.name.toLowerCase().includes("tavily")) {
      sampleTools.push(
        {
          name: "search",
          description: "Search the web for information",
          schema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
              max_results: { type: "number", description: "Maximum number of results", default: 10 }
            },
            required: ["query"]
          }
        }
      );
    } else if (server.name.toLowerCase().includes("weather")) {
      sampleTools.push(
        {
          name: "get_weather",
          description: "Get current weather for a location",
          schema: {
            type: "object",
            properties: {
              location: { type: "string", description: "City, State or coordinates" },
              units: { type: "string", enum: ["metric", "imperial"], default: "metric" }
            },
            required: ["location"]
          }
        }
      );
    } else {
      // Generic tools
      sampleTools.push(
        {
          name: "ping",
          description: "Test connectivity to the server",
          schema: {
            type: "object",
            properties: {},
            required: []
          }
        },
        {
          name: "get_capabilities",
          description: "Get server capabilities and available resources",
          schema: {
            type: "object",
            properties: {},
            required: []
          }
        }
      );
    }

    for (const tool of sampleTools) {
      await ctx.db.insert("mcpTools", {
        serverId: args.serverId,
        name: tool.name,
        description: tool.description,
        schema: tool.schema,
        isAvailable: true,
        usageCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    return null;
  },
});

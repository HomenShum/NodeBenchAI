import { useState, useCallback, useEffect } from 'react';
import { useMutation, useQuery, useAction } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

const MCP_PRIORITY = ["context7", "convex"];

export interface McpTool {
  name: string;
  description?: string;
  schema?: any;
}

export interface McpServer {
  _id: Id<"mcpServers">;
  name: string;
  url?: string;
  toolCount?: number;
}

export function useMcp() {
  const [serverId, setServerId] = useState<Id<"mcpServers"> | null>(null);
  const [invoking, setInvoking] = useState(false);

  // Convex mutations and actions
  const addMcpServer = useMutation(api.domains.mcp.mcp.addMcpServer);
  const callTool = useAction(api.domains.mcp.mcpClient.callMcpTool);
  
  // Get MCP servers and tools for current server
  const servers = useQuery(api.domains.mcp.mcp.listMcpServers, {}) || [];
  const tools = useQuery(api.domains.mcp.mcp.getMcpTools, serverId ? { serverId } : "skip") || [];

  const pickPreferredServer = useCallback((list: McpServer[]) => {
    if (!list || list.length === 0) return null;
    const withUrls = list.filter((s) => s.url);
    const targetList = withUrls.length > 0 ? withUrls : list;
    const scored = [...targetList].sort((a, b) => {
      const score = (name?: string) => {
        if (!name) return MCP_PRIORITY.length + 1;
        const lower = name.toLowerCase();
        const idx = MCP_PRIORITY.findIndex((p) => lower.includes(p));
        return idx === -1 ? MCP_PRIORITY.length : idx;
      };
      const diff = score(a.name) - score(b.name);
      if (diff !== 0) return diff;
      return (Number(b.toolCount ?? 0) - Number(a.toolCount ?? 0)) || 0;
    });
    return scored[0] ?? null;
  }, []);

  // Auto-select preferred server when list changes
  useEffect(() => {
    if (serverId || !servers || servers.length === 0) return;
    const preferred = pickPreferredServer(servers as McpServer[]);
    if (preferred?._id) {
      setServerId(preferred._id);
    }
  }, [servers, serverId, pickPreferredServer]);

  const addServer = useCallback(async (url: string, name: string) => {
    try {
      // Just add the MCP server metadata to the database
      const newServerId = await addMcpServer({
        name,
        url,
      });
      
      setServerId(newServerId);
      return newServerId;
    } catch (error) {
      console.error('Failed to add MCP server:', error);
      throw error;
    }
  }, [addMcpServer]);

  const selectServer = useCallback((id: Id<"mcpServers"> | null) => {
    setServerId(id);
  }, []);

  const invoke = useCallback(async (toolName: string, args: any = {}) => {
    let activeServerId = serverId;
    if (!activeServerId) {
      const preferred = pickPreferredServer((servers as McpServer[]) || []);
      if (preferred?._id) {
        activeServerId = preferred._id;
        setServerId(preferred._id);
      }
    }

    if (!activeServerId) throw new Error('No active MCP session');

    setInvoking(true);
    try {
      const result = await callTool({
        serverId: activeServerId,
        toolName,
        parameters: args,
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to invoke tool');
      }
      
      return result.result;
    } finally {
      setInvoking(false);
    }
  }, [serverId, callTool]);

  return {
    sessionId: serverId, // Keep compatible with existing UI
    tools,
    invoking,
    addServer,
    invoke,
    selectServer,
    servers, // Expose servers list for potential future use
  };
}

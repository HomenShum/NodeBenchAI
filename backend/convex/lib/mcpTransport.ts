// convex/lib/mcpClient.ts
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { api } from "../_generated/api";

/**
 * HTTP/SSE Transport for remote MCP servers
 */
export class HttpSSETransport implements Transport {
  private serverUrl: string;
  private headers: Record<string, string>;
  
  constructor(serverUrl: string, headers: Record<string, string> = {}) {
    this.serverUrl = serverUrl;
    this.headers = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      ...headers
    };
  }
  
  async start(): Promise<void> {
    // HTTP transports don't need initialization
  }
  
  async close(): Promise<void> {
    // HTTP transports don't need cleanup
  }
  
  async send(_message: any): Promise<void> {
    // For HTTP/SSE, we handle send/receive in a single request
  }
  
  onMessage?: (message: any) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
  
  // Custom method for request/response pattern
  async request(method: string, params: any = {}): Promise<any> {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const requestBody = {
      jsonrpc: "2.0",
      id: requestId,
      method,
      params
    };
    
    console.log(`[MCP SDK] Making request to ${this.serverUrl}:`, JSON.stringify(requestBody, null, 2));
    
    const response = await fetch(this.serverUrl, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(requestBody),
    });
    
    const responseText = await response.text();
    console.log(`[MCP SDK] Response status: ${response.status}`);
    console.log(`[MCP SDK] Response body:`, responseText.substring(0, 500));
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${responseText}`);
    }
    
    // Parse SSE or JSON response
    let result;
    if (responseText.includes('event:') || responseText.includes('\ndata:')) {
      // Parse SSE
      const lines = responseText.split('\n');
      for (const line of lines) {
        if (line.startsWith('data:')) {
          const data = line.substring(5).trim();
          if (data && data !== '[DONE]') {
            try {
              const parsed = JSON.parse(data);
              if (parsed.id === requestId) {
                result = parsed;
                break;
              } else if (!result) {
                result = parsed; // Use first valid result if no ID match
              }
            } catch {
              console.warn(`[MCP SDK] Failed to parse SSE data: ${data}`);
            }
          }
        }
      }
    } else {
      result = JSON.parse(responseText);
    }
    
    if (result?.error) {
      throw new Error(`MCP Error ${result.error.code}: ${result.error.message}`);
    }
    
    console.log(`[MCP SDK] Parsed result:`, result?.result);
    return result?.result;
  }
}

type McpResult = {
  success?: boolean;
  result?: any;
  error?: string;
};

/**
 * Shared helper to call the core agent MCP server with consistent error handling.
 * Intended for Convex functions/tools that want to prefer MCP and fall back to native logic.
 */
export async function callCoreAgentMcp(
  ctx: any,
  toolName: string,
  parameters: any,
  prioritizedServers: string[] = ["core_agent_server"],
): Promise<{ source: "mcp"; payload: any }> {
  try {
    const res: McpResult = await ctx.runAction((api as any).domains.mcp.mcpClient.callMcpTool, {
      toolName,
      parameters,
      prioritizedServers,
    });

    if (!res?.success) {
      throw new Error(res?.error || "MCP call failed");
    }

    const payload = res.result ?? {};
    return { source: "mcp", payload };
  } catch (err) {
    console.warn(`[callCoreAgentMcp] MCP call failed for ${toolName}:`, err);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * Create MCP client wrapper for remote server communication
 * Since we can't override the transport in the official SDK, we'll use direct HTTP calls
 */
export async function createRemoteMcpClient(
  serverUrl: string, 
  apiKey?: string
): Promise<HttpSSETransport> {
  const headers: Record<string, string> = {};
  
  // Handle API key in URL or as separate parameter
  console.log(`[MCP SDK] Processing server URL: ${serverUrl}`);
  console.log(`[MCP SDK] Separate API key provided: ${apiKey ? '[REDACTED]' : 'none'}`);
  
  let finalUrl = serverUrl;
  if (serverUrl.includes('tavilyApiKey=')) {
    // API key is in URL, extract it for header
    try {
      const url = new URL(serverUrl);
      const tavilyKey = url.searchParams.get('tavilyApiKey');
      console.log(`[MCP SDK] Extracted API key from URL: ${tavilyKey ? '[REDACTED]' : 'none'}`);
      if (tavilyKey) {
        // Try multiple authentication approaches for Tavily
        headers['Authorization'] = `Bearer ${tavilyKey}`;
        headers['x-mcp-token'] = tavilyKey;
        headers['X-API-Key'] = tavilyKey;
        headers['tavily-api-key'] = tavilyKey;
        console.log(`[MCP SDK] Added multiple authentication headers with extracted key`);
        
        // Also keep the API key in URL as backup (some MCP servers need it there)
        finalUrl = serverUrl; // Keep original URL with API key
      } 
      console.log(`[MCP SDK] Cleaned URL: ${finalUrl}`);
    } catch (error) {
      console.warn(`[MCP SDK] Failed to parse URL for API key extraction: ${serverUrl}`, error);
    }
  } else if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
    headers['x-mcp-token'] = apiKey;
    console.log(`[MCP SDK] Added Authorization header with provided API key`);
  }
  
  const redactedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (/(authorization|token|key|secret)/i.test(key)) {
      redactedHeaders[key] = "[REDACTED]";
    } else {
      redactedHeaders[key] = value;
    }
  }
  console.log(`[MCP SDK] Final headers (sensitive redacted):`, redactedHeaders);
  
  return new HttpSSETransport(finalUrl, headers);
}

/**
 * Discover tools using MCP SDK transport
 */
export async function discoverToolsWithSdk(serverUrl: string, apiKey?: string): Promise<Array<{
  name: string;
  description?: string;
  inputSchema?: any;
}>> {
  const transport = await createRemoteMcpClient(serverUrl, apiKey);
  
  try {
    console.log(`[MCP SDK] Discovering tools from ${serverUrl}`);
    const toolsResponse = await transport.request('tools/list', {});
    const tools = toolsResponse?.tools || [];
    
    console.log(`[MCP SDK] Discovered ${tools.length} tools:`, tools.map((t: any) => t.name));
    
    return tools.map((tool: any) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema || tool.input_schema
    }));
    
  } finally {
    await transport.close();
  }
}

/**
 * Execute tool using MCP SDK transport
 */
export async function executeToolWithSdk(
  serverUrl: string,
  toolName: string,
  arguments_: any,
  apiKey?: string,
): Promise<any> {
  const transport = await createRemoteMcpClient(serverUrl, apiKey);
  
  try {
    console.log(`[MCP SDK] Executing tool '${toolName}' with args:`, arguments_);
    const result = await transport.request('tools/call', {
      name: toolName,
      arguments: arguments_
    });
    
    console.log(`[MCP SDK] Tool execution successful`);
    return result;
    
  } finally {
    await transport.close();
  }
}

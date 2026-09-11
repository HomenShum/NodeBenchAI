export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/** Preserve successful content blocks; keep explicit failures available to dispatch. */
export type RawToolResult = ContentBlock[] | { error: true; message: string; [key: string]: unknown };

export type McpToolAnnotations = {
  /** Tool only reads data — no side effects. */
  readOnlyHint?: boolean;
  /** Tool performs destructive/irreversible operations. */
  destructiveHint?: boolean;
  /** Tool accesses external/open-world services (network, APIs). */
  openWorldHint?: boolean;
};

export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** If true, handler returns RawToolResult: content blocks on success or an explicit error object. */
  rawContent?: boolean;
  /** MCP spec security annotations for trust & safety. */
  annotations?: McpToolAnnotations;
  handler: (args: any) => Promise<unknown>;
};

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/** Preserve successful content blocks; keep explicit failures available to dispatch. */
export type RawToolResult = ContentBlock[] | { error: true; message: string; [key: string]: unknown };

/** Inspect the explicit outcome only; text and image content are opaque. */
export function getToolErrorMessage(result: unknown): string | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const failure = result as { error?: unknown; message?: unknown };
  if (!failure.error) return null;
  return typeof failure.message === "string"
    ? failure.message
    : typeof failure.error === "string" ? failure.error : "soft error";
}

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
  /** If true, handler returns content blocks on success or an explicit error object. */
  rawContent?: boolean;
  /** MCP spec security annotations for trust & safety. */
  annotations?: McpToolAnnotations;
  handler: (args: any) => Promise<unknown>;
};

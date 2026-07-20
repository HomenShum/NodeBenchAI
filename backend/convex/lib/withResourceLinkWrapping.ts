// convex/lib/withResourceLinkWrapping.ts
// Central tool wrapper for automatic MCP-style resource_link wrapping.
// This prevents large tool outputs from being poured directly into the LLM context.

import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

// The @convex-dev/agent tool objects are not strongly typed for internal handler access.
type ToolLike = any;

export interface ResourceLinkWrapperDeps {
  runId?: Id<"agentRuns"> | string;
}

const WRAP_THRESHOLD_BYTES = 100 * 1024;

function getByteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

function looksLikeResourceLink(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as any).type === "resource_link" &&
    typeof (value as any).resourceId === "string" &&
    typeof (value as any).artifactId === "string"
  );
}

function extractSourceUrl(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v: any = value;
  const candidates = [v.sourceUrl, v.url, v.source_url, v.link].filter((x) => typeof x === "string");
  return candidates[0];
}

function safeJsonStringify(value: unknown): string | null {
  try {
    const seen = new WeakSet<object>();
    return JSON.stringify(
      value,
      (_key, v) => {
        if (typeof v === "bigint") return v.toString();
        if (typeof v === "object" && v !== null) {
          if (seen.has(v)) return "[Circular]";
          seen.add(v);
        }
        return v;
      },
      2
    );
  } catch {
    return null;
  }
}

function computeSerialization(value: unknown): { content: string; mimeType: string; sizeBytes: number } | null {
  if (typeof value === "string") {
    const sizeBytes = getByteLength(value);
    return { content: value, mimeType: "text/plain", sizeBytes };
  }
  const json = safeJsonStringify(value);
  if (json == null) return null;
  const sizeBytes = getByteLength(json);
  return { content: json, mimeType: "application/json", sizeBytes };
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && typeof (value as any)[Symbol.asyncIterator] === "function";
}

export function withResourceLinkWrapping<T extends ToolLike>(
  deps: { toolName: string; nextToolCallId: () => string } & ResourceLinkWrapperDeps,
  tool: T
): T {
  const toolAny = tool as any;
  const originalExecute = toolAny.execute;
  const originalHandler = toolAny.handler;

  async function maybeWrap(ctx: any, result: any): Promise<any> {
    // Avoid double-wrapping and keep existing resource_link payloads stable.
    if (looksLikeResourceLink(result)) return result;
    // If a tool streams results, do not attempt to serialize/wrap.
    if (isAsyncIterable(result)) return result;

    const serialized = computeSerialization(result);
    if (!serialized) return result;
    if (serialized.sizeBytes < WRAP_THRESHOLD_BYTES) return result;

    try {
      if (!ctx?.runAction) return result;
      const wrapped = await ctx.runAction(api.tools.context.resourceLinks.wrapToolOutput, {
        runId: deps.runId as any,
        toolName: deps.toolName,
        toolCallId: deps.nextToolCallId(),
        content: serialized.content,
        mimeType: serialized.mimeType,
        sourceUrl: extractSourceUrl(result),
      });

      if (wrapped?.resourceLink) return wrapped.resourceLink;
      return result;
    } catch (e) {
      console.error(`[withResourceLinkWrapping] Failed to wrap ${deps.toolName}:`, e);
      return result;
    }
  }

  // Prefer wrapping AI SDK `execute(args, options)` so we preserve `this.ctx` binding.
  if (typeof originalExecute === "function") {
    return {
      ...toolAny,
      execute: async function (this: any, args: any, options: any) {
        const result = await originalExecute.call(this, args, options);
        const ctx = this?.ctx;
        return await maybeWrap(ctx, result);
      },
    } as T;
  }

  // Fallback for non-AI-SDK tool shapes that expose a `handler(ctx, args, options)`.
  if (typeof originalHandler === "function") {
    return {
      ...toolAny,
      handler: async (ctx: any, args: any, options: any) => {
        const result = await originalHandler(ctx, args, options);
        return await maybeWrap(ctx, result);
      },
    } as T;
  }

  return tool;
}

export function wrapAllToolsWithResourceLinkWrapping<T extends Record<string, ToolLike>>(
  tools: T,
  deps: ResourceLinkWrapperDeps
): T {
  let callSeq = 0;
  const wrapped: Record<string, ToolLike> = {};

  for (const [name, tool] of Object.entries(tools)) {
    // Don't wrap the wrapper itself.
    if (name === "wrapToolOutput") {
      wrapped[name] = tool;
      continue;
    }
    wrapped[name] = withResourceLinkWrapping(
      {
        toolName: name,
        runId: deps.runId,
        nextToolCallId: () => `${String(deps.runId ?? "no_run")}:${name}:${++callSeq}`,
      },
      tool
    );
  }

  return wrapped as T;
}

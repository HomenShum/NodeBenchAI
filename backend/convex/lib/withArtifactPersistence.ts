// convex/lib/withArtifactPersistence.ts
// Central tool wrapper for artifact extraction and persistence
// Wraps ALL tools at registration time - extraction decides "no-op"

import { extractArtifacts } from "../../shared/artifactExtractors";
import { canonicalizeUrl, generateIdempotencyKey } from "../../shared/artifacts";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// CHUNKING CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const MAX_ARTIFACTS_PER_JOB = 25; // Prevent scheduler payload failures

/**
 * Chunk an array into smaller arrays
 */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/** Mutable reference for dynamic section ID */
type SectionIdRef = { current: string | undefined };

interface WrapperDeps {
  /** Tool name for extraction routing */
  toolName: string;
  /** Agent thread ID (stable for run) */
  runId: string;
  /** User ID for artifact ownership */
  userId: Id<"users">;
  /** Mutable ref for dynamic section ID (read at invocation time) */
  sectionIdRef?: SectionIdRef;
}

// Use any for tool type since AI SDK Tool doesn't expose handler publicly
// The @convex-dev/agent library internally calls the handler we provide
type ToolLike = any;

// ═══════════════════════════════════════════════════════════════════════════
// WRAPPER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Wrap a tool to extract and persist artifacts from its results
 * 
 * - Wraps ALL tools (extraction returns [] for irrelevant ones)
 * - Uses closure for runId/userId (not ctx.threadId)
 * - Calls server mutation for persistence (server computes IDs, rev)
 * 
 * @param deps - runId, userId, toolName passed via closure
 * @param tool - The tool to wrap
 * @returns Wrapped tool with same interface
 */
export function withArtifactPersistence<T extends ToolLike>(
  deps: WrapperDeps,
  tool: T
): T {
  // FIX 4: Defense-in-depth - reject if not in allowlist (even if caller tries to wrap)
  if (!ARTIFACT_PRODUCERS.has(deps.toolName)) {
    // Silent pass-through - don't wrap non-artifact-producing tools
    return tool;
  }
  
  // Cast to any to access handler property (TypeScript doesn't know about it)
  const toolAny = tool as any;
  
  // If tool doesn't have a handler (e.g., it's a delegation tool or built-in),
  // return it unchanged - artifacts will be extracted from subagent tools
  if (typeof toolAny?.handler !== 'function') {
    return tool;
  }
  
  const originalHandler = toolAny.handler;
  
  return {
    ...toolAny,
    handler: async (ctx: any, args: any) => {
      // Execute original tool
      const result = await originalHandler(ctx, args);
      
      // Extract artifacts (returns [] for non-artifact-producing tools)
      const rawArtifacts = extractArtifacts(deps.toolName, result);
      
      // Persist if any artifacts found - use scheduler for durable delivery
      if (rawArtifacts.length > 0) {
        // Chunk artifacts to prevent oversized payloads
        const chunks = chunkArray(rawArtifacts, MAX_ARTIFACTS_PER_JOB);
        
        // ✅ Capture section ID ONCE at invocation time (prevents drift if ref changes later)
        const capturedSectionId = deps.sectionIdRef?.current;
        
        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
          const chunk = chunks[chunkIndex];
          
          // Get canonical URLs for deterministic idempotency key
          const canonicalUrls = chunk.map(a => canonicalizeUrl(a.url));
          
          // Generate stable idempotency key from sorted canonical URLs
          const idempotencyKey = generateIdempotencyKey(
            deps.runId,
            deps.toolName,
            chunkIndex,
            canonicalUrls
          );
          
          const jobArgs = {
            runId: deps.runId,
            userId: deps.userId,
            toolName: deps.toolName,
            rawArtifacts: chunk,
            attempt: 0,
            idempotencyKey,
            sectionId: capturedSectionId, // Per-section linking (captured at invocation)
          };
          
          // Use scheduler (durable) instead of fire-and-forget
          // This survives handler exit and guarantees the persistence job runs
          if (ctx.scheduler?.runAfter) {
            await ctx.scheduler.runAfter(
              0,
              internal.lib.artifactPersistence.persistArtifactsWithRetry,
              jobArgs
            );
          } else {
            // Fallback: if no scheduler in this context, we MUST await
            await ctx.runAction(
              internal.lib.artifactPersistence.persistArtifactsWithRetry,
              jobArgs
            );
          }
        }
        
        console.log(`[withArtifactPersistence] Scheduled ${chunks.length} chunk(s) for ${rawArtifacts.length} artifacts from ${deps.toolName}`);
      }
      
      return result;
    },
  } as T;
}

/**
 * Tools that produce artifacts (URL results worth persisting)
 * Only these get wrapped - everything else is left untouched
 * This prevents accidental wrapping of delegation/meta/memory tools
 */
export const ARTIFACT_PRODUCERS = new Set([
  // Search tools that return URLs
  "linkupSearch",
  "linkupStructuredSearch", // NEW: Structured output search
  "youtubeSearch",
  "searchHashtag",
  "searchTodaysFunding",
  
  // Entity enrichment tools (may return source URLs)
  "enrichFounderInfo",
  "enrichInvestmentThesis",
  "enrichPatentsAndResearch",
  "enrichCompanyDossier",
  
  // External orchestrator may return source URLs
  "externalOrchestratorTool",
]);

/** Deps for wrapping all tools (includes mutable section ref) */
export interface ArtifactWrapperDeps {
  runId: string;
  userId: Id<"users">;
  sectionIdRef?: SectionIdRef;
}

/**
 * Wrap artifact-producing tools in a registry
 * 
 * @param tools - Object of tool name -> tool
 * @param deps - runId, userId, and optional sectionIdRef for all tools
 * @param allowlist - Optional set of tool names to wrap (defaults to ARTIFACT_PRODUCERS)
 * @returns Tools object with artifact producers wrapped
 */
export function wrapAllToolsWithArtifactPersistence<T extends Record<string, ToolLike>>(
  tools: T,
  deps: ArtifactWrapperDeps,
  allowlist: Set<string> = ARTIFACT_PRODUCERS
): T {
  const wrapped: Record<string, ToolLike> = {};
  
  for (const [name, tool] of Object.entries(tools)) {
    // Only wrap tools in the allowlist
    if (allowlist.has(name)) {
      wrapped[name] = withArtifactPersistence(
        { 
          toolName: name, 
          runId: deps.runId, 
          userId: deps.userId,
          sectionIdRef: deps.sectionIdRef, // Pass through mutable ref
        },
        tool
      );
    } else {
      // Pass through unchanged
      wrapped[name] = tool;
    }
  }
  
  return wrapped as T;
}

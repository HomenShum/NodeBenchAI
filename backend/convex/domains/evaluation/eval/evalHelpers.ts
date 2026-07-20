// convex/domains/eval/evalHelpers.ts
// Helper functions for evaluation tests

import { internal } from "../../../_generated/api";
import type { ActionCtx } from "../../../_generated/server";
import type { Id } from "../../../_generated/dataModel";

/**
 * Wait for parallel delegations to complete and extract tools used
 * 
 * @param ctx - Action context
 * @param runId - Delegation run ID (from parallelDelegate tool result)
 * @param userId - User ID for auth
 * @param maxWaitMs - Maximum time to wait (default: 60000ms = 60s)
 * @param pollIntervalMs - Polling interval (default: 500ms)
 * @returns Array of tool names used by all delegations
 */
export async function waitForDelegationsAndExtractTools(
  ctx: ActionCtx,
  runId: string,
  userId: Id<"users">,
  maxWaitMs: number = 60000,
  pollIntervalMs: number = 500
): Promise<string[]> {
  const startTime = Date.now();
  const toolsUsed: string[] = [];
  
  console.log(`[waitForDelegationsAndExtractTools] Waiting for delegations in run ${runId}...`);
  
  while (Date.now() - startTime < maxWaitMs) {
    const delegations = await ctx.runQuery(internal.domains.agents.agentDelegations.listByRunInternal, {
      runId,
      userId,
    });
    
    if (delegations.length === 0) {
      console.log(`[waitForDelegationsAndExtractTools] No delegations found yet, waiting...`);
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      continue;
    }
    
    const allCompleted = delegations.every((d: any) => 
      d.status === "completed" || d.status === "failed" || d.status === "cancelled"
    );
    
    if (allCompleted) {
      console.log(`[waitForDelegationsAndExtractTools] All ${delegations.length} delegations completed`);
      
      // Extract tools from completed delegations
      for (const delegation of delegations) {
        if (delegation.status === "completed") {
          // Get the final event which contains toolsUsed
          const events = await ctx.runQuery(internal.domains.agents.agentDelegations.getWriteEventsInternal, {
            delegationId: delegation.delegationId,
          });
          
          const finalEvent = events.find((e: any) => e.kind === "final");
          if (finalEvent && finalEvent.metadata && finalEvent.metadata.toolsUsed) {
            console.log(`[waitForDelegationsAndExtractTools] Found toolsUsed from ${delegation.agentName}:`, finalEvent.metadata.toolsUsed);
            for (const tool of finalEvent.metadata.toolsUsed) {
              if (!toolsUsed.includes(tool)) {
                toolsUsed.push(tool);
                console.log(`[waitForDelegationsAndExtractTools] ✅ Extracted tool:`, tool);
              }
            }
          }
        }
      }
      
      return toolsUsed;
    }
    
    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
  
  console.log(`[waitForDelegationsAndExtractTools] ⚠️ Timeout waiting for delegations to complete`);
  return toolsUsed;
}

/**
 * Extract runId from parallelDelegate tool result
 * 
 * @param toolResult - Tool result string from parallelDelegate
 * @returns runId if found, null otherwise
 */
export function extractRunIdFromDelegationResult(toolResult: string): string | null {
  try {
    if (typeof toolResult === "string" && toolResult.includes("delegations_scheduled")) {
      const parsed = JSON.parse(toolResult);
      return parsed.runId || null;
    }
  } catch (e) {
    console.log(`[extractRunIdFromDelegationResult] Failed to parse:`, e);
  }
  return null;
}


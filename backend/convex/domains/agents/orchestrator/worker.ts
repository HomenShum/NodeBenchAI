import { internalAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { v } from "convex/values";

const WORKER_ID_PREFIX = "worker-";

/**
 * Worker process that strictly consumes from the queue.
 * Claims tasks, executes them (dispatching to specific handlers), and manages lifecycle.
 * Designed to be called recursively or via cron.
 */
export const processQueue = internalAction({
    args: {},
    handler: async (ctx) => {
        const workerId = `${WORKER_ID_PREFIX}${crypto.randomUUID().slice(0, 8)}`;
        console.log(`[Worker:${workerId}] Starting queue processing loop`);

        let processedCount = 0;
        while (true) {
            // 1. Claim work
            const workItem = await ctx.runMutation(internal.domains.agents.orchestrator.queueProtocol.claimNextWorkItem, {
                workerId,
                leaseMs: 5 * 60 * 1000, // 5 minute lease
            });

            if (!workItem) {
                if (processedCount > 0) {
                    console.log(`[Worker:${workerId}] Queue drained. Processed ${processedCount} items.`);
                }
                break;
            }

            const { runId } = workItem;
            console.log(`[Worker:${workerId}] Claimed run ${runId}, executing...`);

            try {
                // 2. Fetch Run Details
                const run = await ctx.runQuery(internal.domains.agents.orchestrator.queueProtocol.getRun, { runId });
                if (!run) {
                    throw new Error(`Run ${runId} claimed but document not found`);
                }

                const args = run.args || {};

                // 3. Dispatch based on workflow type
                const workflow = run.workflow ?? "chat"; // Default to chat for bw compat

                if (workflow === "chat") {
                    // Call the chat streaming logic
                    // Pass runId and workerId so streamAsync can handle completion/failure and heartbeats
                    await ctx.runAction(internal.domains.agents.fastAgentPanelStreaming.streamAsync, {
                        ...args,
                        runId,
                        workerId,
                    });
                } else {
                    throw new Error(`Unknown workflow type: ${workflow}`);
                }

                processedCount++;

            } catch (err) {
                console.error(`[Worker:${workerId}] Fatal error processing run ${runId}:`, err);
                // Attempt to fail the item so it doesn't get stuck in running forever (until lease expires)
                try {
                    await ctx.runMutation(internal.domains.agents.orchestrator.queueProtocol.failWorkItem, {
                        runId,
                        workerId,
                        error: String(err),
                    });
                } catch (failErr) {
                    console.warn(`[Worker:${workerId}] Failed to mark item as failed:`, failErr);
                }
            }
        }
    }
});

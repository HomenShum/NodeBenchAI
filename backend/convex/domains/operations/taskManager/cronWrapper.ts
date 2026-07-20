/**
 * Cron Job Wrapper for Task Manager
 *
 * Provides utilities to wrap cron job handlers with automatic task session
 * creation, telemetry tracking, and error handling.
 *
 * Usage:
 * ```ts
 * import { withCronTaskSession } from "./cronWrapper";
 *
 * export const myCronJob = internalAction({
 *   args: {},
 *   handler: withCronTaskSession(
 *     "My Cron Job",
 *     "daily-cron-job",
 *     async (ctx, args, sessionApi) => {
 *       // Your cron logic here
 *       sessionApi.addToolUsed("web_search");
 *       sessionApi.updateTokens(1500, 800);
 *       return { processed: 100 };
 *     }
 *   ),
 * });
 * ```
 */
import { ActionCtx } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { Id } from "../../../_generated/dataModel";

export interface SessionApi {
  /** Add a tool to the list of tools used */
  addToolUsed: (toolName: string) => void;
  /** Update token counts */
  updateTokens: (inputTokens: number, outputTokens: number) => void;
  /** Get the session ID */
  getSessionId: () => Id<"agentTaskSessions">;
}

interface CronResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Wrap a cron job handler with automatic task session creation
 *
 * @param title - Human-readable title for the task
 * @param cronJobName - Unique identifier for the cron job
 * @param handler - The actual cron job handler
 * @param options - Optional configuration
 */
export function withCronTaskSession<TArgs extends Record<string, unknown>>(
  title: string,
  cronJobName: string,
  handler: (
    ctx: ActionCtx,
    args: TArgs,
    sessionApi: SessionApi
  ) => Promise<unknown>,
  options?: {
    description?: string;
    visibility?: "public" | "private";
  }
) {
  return async (ctx: ActionCtx, args: TArgs): Promise<CronResult> => {
    const startedAt = Date.now();
    let inputTokens = 0;
    let outputTokens = 0;
    const toolsUsed: string[] = [];

    // Create the session
    const sessionId = await ctx.runMutation(
      internal.domains.taskManager.mutations.startSession,
      {
        title,
        type: "cron",
        visibility: options?.visibility ?? "public",
        description: options?.description,
        cronJobName,
      }
    );

    // Create the session API for the handler
    const sessionApi: SessionApi = {
      addToolUsed: (toolName: string) => {
        if (!toolsUsed.includes(toolName)) {
          toolsUsed.push(toolName);
        }
      },
      updateTokens: (input: number, output: number) => {
        inputTokens += input;
        outputTokens += output;
      },
      getSessionId: () => sessionId,
    };

    try {
      // Run the actual handler
      const result = await handler(ctx, args, sessionApi);

      // Complete the session
      const completedAt = Date.now();
      await ctx.runMutation(
        internal.domains.taskManager.mutations.completeSession,
        {
          sessionId,
          completedAt,
          inputTokens,
          outputTokens,
          toolsUsed,
        }
      );

      return { success: true, data: result };
    } catch (error) {
      // Fail the session
      const completedAt = Date.now();
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      await ctx.runMutation(
        internal.domains.taskManager.mutations.failSession,
        {
          sessionId,
          completedAt,
          errorMessage,
          errorStack,
          inputTokens,
          outputTokens,
          toolsUsed,
        }
      );

      console.error(`[${cronJobName}] Cron job failed:`, errorMessage);
      return { success: false, error: errorMessage };
    }
  };
}

import type { Doc } from "../../_generated/dataModel";

const MAX_PUBLIC_RUN_ERROR_LENGTH = 500;

export function canReadAgentRunPresentation(args: {
  authenticatedUserId?: string | null;
  threadUserId?: string | null;
  threadAnonymousSessionId?: string | null;
  anonymousSessionId?: string | null;
}): boolean {
  const isAuthenticatedOwner = Boolean(
    args.authenticatedUserId &&
      args.threadUserId &&
      args.authenticatedUserId === args.threadUserId,
  );
  const isAnonymousOwner = Boolean(
    args.threadAnonymousSessionId &&
      args.anonymousSessionId &&
      args.threadAnonymousSessionId === args.anonymousSessionId,
  );
  return isAuthenticatedOwner || isAnonymousOwner;
}

/** Strip internal error wrappers and stack frames before returning a run failure to its owner. */
export function formatPublicAgentRunError(
  errorMessage: string | undefined,
): string | undefined {
  if (!errorMessage) return undefined;

  let message = errorMessage.split(/\r?\n/, 1)[0]?.trim() ?? "";
  let previous = "";
  while (message && message !== previous) {
    previous = message;
    message = message
      .replace(/^Error:\s*/i, "")
      .replace(/^Uncaught\s+/i, "")
      .trim();
  }

  if (!message) return "The agent run failed before producing a response.";
  return message.slice(0, MAX_PUBLIC_RUN_ERROR_LENGTH);
}

export function projectAgentRunPresentation(
  run: Doc<"agentRuns"> | null,
): {
  runId?: Doc<"agentRuns">["_id"];
  runStatus?: Doc<"agentRuns">["status"];
  runModel?: string;
  runErrorMessage?: string;
} {
  if (!run) return {};
  return {
    runId: run._id,
    runStatus: run.status,
    runModel: run.model,
    runErrorMessage:
      run.status === "error"
        ? formatPublicAgentRunError(run.errorMessage)
        : undefined,
  };
}

import { getAuthUserId } from "@convex-dev/auth/server";

type PipelineCallerContext = {
  auth: unknown;
};

const ANONYMOUS_SESSION_PATTERN = /^[a-zA-Z0-9._:-]{3,160}$/;

/**
 * Resolve the only owner key a public pipeline caller may use.
 *
 * Authenticated identity always wins. Guests use the browser-held anonymous
 * session token as a possession credential. Public endpoints must never accept
 * a caller-supplied owner key directly.
 */
export async function requirePipelineCallerOwnerKey(
  ctx: PipelineCallerContext,
  anonymousSessionId?: string | null,
): Promise<string> {
  const userId = await getAuthUserId(ctx as any);
  if (userId) return `user:${String(userId)}`;

  const sessionId = anonymousSessionId?.trim() ?? "";
  if (
    !ANONYMOUS_SESSION_PATTERN.test(sessionId) ||
    sessionId === "anon-fallback"
  ) {
    throw new Error("Authentication or anonymous session required");
  }

  return `session:${sessionId}`;
}

/** Resolve a cost-bearing public pipeline operation from server auth only. */
export async function requireAuthenticatedPipelineOwnerKey(
  ctx: PipelineCallerContext,
): Promise<string> {
  const userId = await getAuthUserId(ctx as any);
  if (!userId) throw new Error("Authentication required for pipeline controls");
  return `user:${String(userId)}`;
}

export function pipelineOwnerMatches(
  row: { ownerKey?: string | null } | null | undefined,
  ownerKey: string,
): boolean {
  return Boolean(row && row.ownerKey === ownerKey);
}

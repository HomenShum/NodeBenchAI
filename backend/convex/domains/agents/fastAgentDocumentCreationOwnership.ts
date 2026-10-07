/**
 * Fail-closed ownership guard for agent-thread-backed document generation.
 *
 * Keep this helper independent of Convex runtime modules so the exact tenant
 * boundary can be exercised without invoking an LLM provider in tests.
 */
export function assertFastAgentDocumentThreadOwner(
  authenticatedUserId: unknown,
  threadUserId: unknown,
): void {
  if (
    authenticatedUserId === null ||
    authenticatedUserId === undefined ||
    threadUserId === null ||
    threadUserId === undefined ||
    String(authenticatedUserId) !== String(threadUserId)
  ) {
    throw new Error("Thread not found or unauthorized");
  }
}

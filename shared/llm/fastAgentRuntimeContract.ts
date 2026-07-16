export const ANONYMOUS_FAST_AGENT_MODEL_ID =
  "gemini-3.1-flash-lite-preview" as const;
export const FAST_AGENT_SIGN_IN_BENEFIT_COPY =
  "Sign in for account-based limits and cross-device history." as const;

/**
 * Anonymous FastAgent runs use one bounded runtime lane regardless of any
 * client-supplied preference. Keep this pure contract shared by the client
 * presentation and the Convex enforcement path so the UI cannot advertise a
 * model the runtime will silently replace.
 */
export function resolveFastAgentRequestedModel({
  isAnonymous,
  requestedModel,
}: {
  isAnonymous: boolean;
  requestedModel?: string;
}): string | undefined {
  return isAnonymous ? ANONYMOUS_FAST_AGENT_MODEL_ID : requestedModel;
}

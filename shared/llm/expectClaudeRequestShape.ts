/**
 * Shared request-shape assertion for every suite that builds a real Anthropic request through the
 * repo's own code with a fake transport (SPEC-v9 A.0.6, s1.3). Claude Sonnet 5.5 and Opus 5.5
 * answer 400 to a manual thinking budget, to `thinking:{type:"disabled"}` and to a forced
 * `tool_choice`; a suite that checks only sampling keys stays green when one of them is added.
 * Accepts the raw Messages body (`thinking`, `tool_choice`) and the AI SDK call
 * (`providerOptions.anthropic.thinking`, `toolChoice`).
 */
import { expect } from "vitest";

export function expectNoManualThinkingOrForcedToolChoice(request: unknown, label = "request"): void {
  const r = (request ?? {}) as Record<string, any>;
  const thinking = r.thinking ?? r.providerOptions?.anthropic?.thinking;
  const toolChoice = r.tool_choice ?? r.toolChoice;
  expect(thinking?.budget_tokens, `${label}: thinking.budget_tokens must be absent`).toBeUndefined();
  expect(thinking?.budgetTokens, `${label}: thinking.budgetTokens must be absent`).toBeUndefined();
  expect(["enabled", "disabled"], `${label}: thinking.type must not be enabled/disabled`).not.toContain(thinking?.type);
  const forced = typeof toolChoice === "string" ? toolChoice === "required" : ["any", "tool"].includes(toolChoice?.type);
  expect(forced, `${label}: tool_choice must not be forced`).toBe(false);
}

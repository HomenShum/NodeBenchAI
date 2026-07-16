import { describe, expect, it } from "vitest";

import {
  ANONYMOUS_FAST_AGENT_MODEL_ID,
  FAST_AGENT_SIGN_IN_BENEFIT_COPY,
  resolveFastAgentRequestedModel,
} from "./fastAgentRuntimeContract";

describe("FastAgent runtime model contract", () => {
  it("forces every anonymous request onto the disclosed bounded model lane", () => {
    expect(resolveFastAgentRequestedModel({
      isAnonymous: true,
      requestedModel: "claude-sonnet-4.6",
    })).toBe(ANONYMOUS_FAST_AGENT_MODEL_ID);
    expect(resolveFastAgentRequestedModel({
      isAnonymous: true,
      requestedModel: undefined,
    })).toBe(ANONYMOUS_FAST_AGENT_MODEL_ID);
  });

  it("preserves authenticated model selection", () => {
    expect(resolveFastAgentRequestedModel({
      isAnonymous: false,
      requestedModel: "gpt-5.4-mini",
    })).toBe("gpt-5.4-mini");
  });

  it("describes sign-in benefits without promising unlimited usage", () => {
    expect(FAST_AGENT_SIGN_IN_BENEFIT_COPY).toBe(
      "Sign in for account-based limits and cross-device history.",
    );
    expect(FAST_AGENT_SIGN_IN_BENEFIT_COPY).not.toMatch(/unlimited/i);
  });
});

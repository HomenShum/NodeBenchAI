import { describe, expect, it } from "vitest";
import { classifyEvidenceVerification } from "./sourceVerificationPolicy";

describe("classifyEvidenceVerification", () => {
  it("keeps cached non-url references visible without marking them unsupported", () => {
    const decision = classifyEvidenceVerification({
      source: "Act I: Setup - Coverage & Freshness",
      sourceProvider: "memory_cache",
    });

    expect(decision.state).toBe("cached_reference");
    expect(decision.blocking).toBe(false);
    expect(decision.verified).toBe(false);
  });

  it("treats publisher 403s as fetch-blocked, not failed support", () => {
    const decision = classifyEvidenceVerification({
      source: "https://www.nytimes.com/example",
      sourceProvider: "gemini_grounding",
      fetchedOk: false,
      fetchReason: "http_403",
    });

    expect(decision.state).toBe("fetch_blocked");
    expect(decision.blocking).toBe(false);
  });

  it("preserves provider-grounded snippets when exact substring matching misses", () => {
    const decision = classifyEvidenceVerification({
      source: "https://openai.com/news/",
      sourceProvider: "gemini_grounding",
      fetchedOk: true,
      quoteMatched: false,
    });

    expect(decision.state).toBe("provider_grounded");
    expect(decision.status).toBe("provider_grounded_unmatched");
    expect(decision.blocking).toBe(false);
  });

  it("marks ungrounded quote mismatch as unsupported", () => {
    const decision = classifyEvidenceVerification({
      source: "https://example.com/report",
      fetchedOk: true,
      quoteMatched: false,
    });

    expect(decision.state).toBe("unsupported");
    expect(decision.blocking).toBe(true);
  });
});

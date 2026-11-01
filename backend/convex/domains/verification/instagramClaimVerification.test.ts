// @vitest-environment node
/**
 * verifyInstagramClaims is a free-lane job ("Cost: $0.00"). Persona: an operator whose deploy has
 * no OPENROUTER_API_KEY. Before SPEC-v9 A.0.10 the action quietly built gemini-3-flash-preview
 * (a paid model) and verified claims on it; now it fails visibly and nothing is dispatched.
 * generateText is the fake transport; no network, no spend.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.hoisted(() => vi.fn());
vi.mock("ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("ai")>()), generateText }));

import { verifyInstagramClaims } from "./instagramClaimVerification";

const claims = [{ claim: "The sky is blue", confidence: 0.9 }];
const run = () => (verifyInstagramClaims as any)._handler({ runMutation: vi.fn(async () => null) }, { postId: "p1", claims });

describe("instagramClaimVerification free model selection", () => {
  beforeEach(() => {
    for (const key of ["OPENROUTER_API_KEY", "GEMINI_API_KEY", "GOOGLE_AI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"]) vi.stubEnv(key, "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    generateText.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("with no free model buildable it throws and never builds or calls a paid model", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key-not-real-0000"); // a paid provider IS configured: it must not be used
    await expect(run()).rejects.toThrow(/No free model available/);
    expect(generateText).not.toHaveBeenCalled();
  });
});

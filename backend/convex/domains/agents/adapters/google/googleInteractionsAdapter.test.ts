import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createGoogleInteractionsAdapter,
  getNodeBenchResearchMcpToolFromEnv,
} from "./googleInteractionsAdapter";
import { DEFAULT_SDK_CONFIG, detectSDKFromQuery } from "../types";

const ORIGINAL_ENV = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GOOGLE_AI_API_KEY: process.env.GOOGLE_AI_API_KEY,
  GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  RESEARCH_MCP_SERVER_URL: process.env.RESEARCH_MCP_SERVER_URL,
  RESEARCH_API_KEY: process.env.RESEARCH_API_KEY,
  MCP_SECRET: process.env.MCP_SECRET,
};

function restoreEnv() {
  const envEntries = Object.entries(ORIGINAL_ENV) as Array<
    [keyof typeof ORIGINAL_ENV, string | undefined]
  >;
  for (const [key, value] of envEntries) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("googleInteractionsAdapter", () => {
  beforeEach(() => {
    restoreEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  it("routes deep research phrasing to the google sdk", () => {
    expect(
      detectSDKFromQuery(
        "Please do deep research with sources on this company",
        DEFAULT_SDK_CONFIG,
      ),
    ).toBe("google");
  });

  it("builds a NodeBench research MCP tool from environment variables", () => {
    process.env.RESEARCH_MCP_SERVER_URL = "https://research.example.com/mcp";
    process.env.MCP_SECRET = "test-secret";

    const tool = getNodeBenchResearchMcpToolFromEnv({
      name: "NodeBench Research MCP",
      allowedTools: [{ mode: "auto", tools: ["search", "fetch"] }],
    });

    expect(tool).not.toBeNull();
    expect(tool?.type).toBe("mcp_server");
    expect(tool && "url" in tool ? tool.url : undefined).toBe(
      "https://research.example.com/mcp",
    );
    expect(tool && "headers" in tool ? tool.headers?.Authorization : undefined).toBe(
      "Bearer test-secret",
    );
  });

  it("returns an error result when no google api key is configured", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    const adapter = createGoogleInteractionsAdapter({
      name: "missing-google-key",
    });

    const result = await adapter.execute({
      query: "What is the capital of France?",
    });

    expect(result.sdk).toBe("google");
    expect(result.status).toBe("error");
    expect(result.thinkingTrace).toContain("Google Gemini API key not configured");
    expect(result.result.status).toBe("failed");
  });
});

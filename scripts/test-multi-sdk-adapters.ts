/**
 * Live Evaluation Test for Multi-SDK Sub-Agent Adapters
 *
 * Tests the adapter registry, cross-SDK handoffs, and SDK-specific
 * functionality (Anthropic extended thinking, OpenAI handoffs).
 *
 * Run with: npx tsx scripts/test-multi-sdk-adapters.ts
 */

import "dotenv/config";

// Import adapter utilities
import {
  registerAdapter,
  listAdaptersWithSDK,
  getRegistryStats,
  executeWithAdapter,
  routeQuery,
  clearRegistry,
} from "../backend/convex/domains/agents/adapters/registry";

import {
  createDeepReasoningAgent,
  createAnthropicReasoningAdapter,
} from "../backend/convex/domains/agents/adapters/anthropic/anthropicReasoningAdapter";

import {
  createOpenAIAgentsAdapter,
  createTriageAgentSystem,
} from "../backend/convex/domains/agents/adapters/openai/openaiAgentsAdapter";

import {
  createVercelAiSdkAdapter,
} from "../backend/convex/domains/agents/adapters/vercel/vercelAiSdkAdapter";

import {
  createLangGraphAdapter,
} from "../backend/convex/domains/agents/adapters/langgraph/langgraphAdapter";

import {
  createGoogleInteractionsAdapter,
  DEFAULT_GEMINI_DEEP_RESEARCH_AGENT,
} from "../backend/convex/domains/agents/adapters/google/googleInteractionsAdapter";

import {
  detectSDKFromQuery,
  DEFAULT_SDK_CONFIG,
} from "../backend/convex/domains/agents/adapters/types";

import {
  executeHandoff,
  serializeHandoffContext,
  findBestAdapterForTask,
} from "../backend/convex/domains/agents/adapters/handoffBridge";

// Test colors for console output
const colors = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  reset: "\x1b[0m",
};

function log(message: string, color: keyof typeof colors = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title: string) {
  console.log("\n" + "=".repeat(60));
  log(title, "blue");
  console.log("=".repeat(60));
}

function logResult(testName: string, passed: boolean, details?: string) {
  const status = passed ? "✓ PASS" : "✗ FAIL";
  const color = passed ? "green" : "red";
  log(`${status}: ${testName}`, color);
  if (details) {
    console.log(`   ${details}`);
  }
}

// Test results tracking
const results: { name: string; passed: boolean; error?: string }[] = [];

function recordTest(name: string, passed: boolean, error?: string) {
  results.push({ name, passed, error });
  logResult(name, passed, error);
}

async function runTests() {
  logSection("Multi-SDK Sub-Agent Adapter Tests");

  // ============================================
  // Test 1: SDK Detection from Query
  // ============================================
  logSection("1. SDK Detection from Query");

  try {
    const queries = [
      { query: "Think through this complex problem", expected: "anthropic" },
      { query: "Do deep research with sources on this topic", expected: "google" },
      { query: "Research and investigate the topic deeply", expected: "langgraph" },
      { query: "Triage this customer request", expected: "openai" },
      { query: "Stream the response quickly", expected: "vercel" },
      { query: "Just a normal query", expected: null },
    ];

    for (const { query, expected } of queries) {
      const detected = detectSDKFromQuery(query, DEFAULT_SDK_CONFIG);
      const passed = detected === expected;
      recordTest(
        `detectSDKFromQuery("${query.substring(0, 30)}...")`,
        passed,
        `Expected: ${expected}, Got: ${detected}`
      );
    }
  } catch (error) {
    recordTest("SDK Detection", false, String(error));
  }

  // ============================================
  // Test 2: Adapter Registry
  // ============================================
  logSection("2. Adapter Registry");

  try {
    // Clear registry for clean test
    clearRegistry();

    // Create and register adapters
    const anthropicAdapter = createAnthropicReasoningAdapter({
      name: "TestAnthropicAgent",
      thinking: { enabled: false, budgetTokens: 2000 },
    });
    registerAdapter(anthropicAdapter);

    const openaiAdapter = createOpenAIAgentsAdapter({
      name: "TestOpenAIAgent",
      instructions: "You are a test agent",
    });
    registerAdapter(openaiAdapter);

    const vercelAdapter = createVercelAiSdkAdapter({
      name: "TestVercelAi",
      model: "gpt-5.4-mini",
      systemPrompt: "You are a test agent. Answer concisely.",
      maxSteps: 3,
    });
    registerAdapter(vercelAdapter);

    const langgraphAdapter = createLangGraphAdapter({
      name: "TestLangGraph",
      model: "gpt-5.4-mini",
      systemPrompt: "You are a test agent. Answer concisely.",
      maxIterations: 3,
    });
    registerAdapter(langgraphAdapter);

    const googleAdapter = createGoogleInteractionsAdapter({
      name: "TestGoogleDeepResearch",
      agent: DEFAULT_GEMINI_DEEP_RESEARCH_AGENT,
      background: true,
      stream: false,
      pollIntervalMs: 2000,
      maxPolls: 1,
      tools: [
        { type: "google_search", search_types: ["web_search"] },
        { type: "url_context" },
      ],
      agentConfig: {
        type: "deep-research",
        thinking_summaries: "none",
      },
    });
    registerAdapter(googleAdapter);

    // Test listing
    const adapters = listAdaptersWithSDK();
    recordTest(
      "Adapter registration",
      adapters.length === 5,
      `Registered ${adapters.length} adapters`
    );

    // Test stats
    const stats = getRegistryStats();
    recordTest(
      "Registry stats",
      stats.totalAdapters === 5,
      `Total: ${stats.totalAdapters}, Anthropic: ${stats.adaptersBySDK.anthropic || 0}, OpenAI: ${stats.adaptersBySDK.openai || 0}, Google: ${stats.adaptersBySDK.google || 0}, Vercel: ${stats.adaptersBySDK.vercel || 0}, LangGraph: ${stats.adaptersBySDK.langgraph || 0}`
    );

    // Test routing
    const routed = routeQuery("reason through this problem");
    recordTest(
      "Query routing",
      routed?.sdk === "anthropic",
      `Routed to: ${routed?.name} (${routed?.sdk})`
    );
  } catch (error) {
    recordTest("Adapter Registry", false, String(error));
  }

  // ============================================
  // Test 3: Handoff Bridge
  // ============================================
  logSection("3. Handoff Bridge");

  try {
    // Test best adapter finding
    const bestForReasoning = findBestAdapterForTask("reason through this");
    recordTest(
      "Find best adapter for reasoning",
      bestForReasoning !== null,
      `Found: ${bestForReasoning}`
    );

    const bestForTriage = findBestAdapterForTask("triage and route");
    recordTest(
      "Find best adapter for triage",
      bestForTriage !== null,
      `Found: ${bestForTriage}`
    );

    const bestForDeepResearch = findBestAdapterForTask("run deep research with sources");
    recordTest(
      "Find best adapter for deep research",
      bestForDeepResearch !== null,
      `Found: ${bestForDeepResearch}`
    );

    // Test serialization
    const serialized = serializeHandoffContext(
      "TestAnthropicAgent",
      "TestOpenAIAgent",
      {
        messages: [{ role: "user", content: "Test message" }],
        taskDescription: "Test task",
      }
    );
    recordTest(
      "Handoff context serialization",
      serialized.handoffId.startsWith("ho_"),
      `Handoff ID: ${serialized.handoffId}`
    );
  } catch (error) {
    recordTest("Handoff Bridge", false, String(error));
  }

  // ============================================
  // Test 4: Anthropic Deep Reasoning (Live API)
  // ============================================
  logSection("4. Anthropic Deep Reasoning (Live API Call)");

  if (!process.env.ANTHROPIC_API_KEY) {
    recordTest("Anthropic API Key", false, "ANTHROPIC_API_KEY not set");
  } else {
    try {
      // Create a simple reasoning adapter without extended thinking
      const reasoningAdapter = createAnthropicReasoningAdapter({
        name: "LiveReasoningAgent",
        model: "claude-sonnet-4.6",
        thinking: { enabled: false, budgetTokens: 0 },
        systemPrompt: "You are a helpful assistant. Answer concisely.",
      });

      registerAdapter(reasoningAdapter);

      const result = await executeWithAdapter("LiveReasoningAgent", {
        query: "What is 2 + 2? Answer with just the number.",
      });

      const passed = result.status === "success";
      const answer = (result.result as { answer: string })?.answer || "";
      recordTest(
        "Anthropic API call",
        passed && answer.includes("4"),
        `Status: ${result.status}, Answer: ${answer.substring(0, 50)}...`
      );
    } catch (error) {
      recordTest("Anthropic API call", false, String(error));
    }
  }

  // ============================================
  // Test 5: OpenAI Agents SDK (Live API)
  // ============================================
  logSection("5. OpenAI Agents SDK (Live API Call)");

  if (!process.env.OPENAI_API_KEY) {
    recordTest("OpenAI API Key", false, "OPENAI_API_KEY not set");
  } else {
    try {
      const openaiAdapter = createOpenAIAgentsAdapter({
        name: "LiveOpenAIAgent",
        instructions: "You are a helpful assistant. Answer concisely.",
        model: "gpt-5.4-mini", // GPT-5.4 mini - smaller/faster model
        maxTurns: 3,
      });

      registerAdapter(openaiAdapter);

      const result = await executeWithAdapter("LiveOpenAIAgent", {
        query: "What is the capital of France? Answer with just the city name.",
      });

      const passed = result.status === "success";
      const answer = String(result.result || "");
      recordTest(
        "OpenAI Agents API call",
        passed && answer.toLowerCase().includes("paris"),
        `Status: ${result.status}, Answer: ${answer.substring(0, 50)}...`
      );
    } catch (error) {
      recordTest("OpenAI Agents API call", false, String(error));
    }
  }

  // ============================================
  // Test 6: Triage Agent System
  // ============================================
  logSection("6. Triage Agent System (Structure Test)");

  try {
    const triageSystem = createTriageAgentSystem({
      triageName: "CustomerTriage",
      triageInstructions: "Route customer queries to appropriate specialists",
      specialists: [
        {
          name: "BillingSpecialist",
          instructions: "Handle billing questions",
          handoffDescription: "For billing and payment issues",
        },
        {
          name: "TechSupport",
          instructions: "Handle technical issues",
          handoffDescription: "For technical problems",
        },
      ],
      model: "gpt-5.4-mini", // GPT-5.4 mini for triage
    });

    recordTest(
      "Triage system creation",
      triageSystem.triageAgent !== undefined &&
        triageSystem.specialistAgents.length === 2,
      `Triage: ${triageSystem.triageAgent ? "created" : "failed"}, Specialists: ${triageSystem.specialistAgents.length}`
    );
  } catch (error) {
    recordTest("Triage system creation", false, String(error));
  }

  logSection("7. Vercel AI SDK (Live API Call)");

  if (
    !process.env.OPENAI_API_KEY &&
    !process.env.ANTHROPIC_API_KEY &&
    !process.env.GOOGLE_GENERATIVE_AI_API_KEY &&
    !process.env.GOOGLE_AI_API_KEY &&
    !process.env.GEMINI_API_KEY
  ) {
    recordTest(
      "Vercel AI SDK provider keys",
      false,
      "No provider API key set (OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY / GOOGLE_AI_API_KEY / GEMINI_API_KEY)"
    );
  } else {
    try {
      const vercelAdapter = createVercelAiSdkAdapter({
        name: "LiveVercelAi",
        model: "gpt-5.4-mini",
        systemPrompt: "You are a helpful assistant. Answer concisely.",
        maxSteps: 3,
      });
      registerAdapter(vercelAdapter);

      const result = await executeWithAdapter("LiveVercelAi", {
        query: "What is 1 + 1? Answer with just the number.",
      });

      const passed = result.status === "success";
      const answer = String(result.result || "");
      recordTest(
        "Vercel AI SDK API call",
        passed && answer.includes("2"),
        `Status: ${result.status}, Answer: ${answer.substring(0, 50)}...`
      );
    } catch (error) {
      recordTest("Vercel AI SDK API call", false, String(error));
    }
  }

  logSection("8. Google Deep Research (Live API Call)");

  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY && !process.env.GOOGLE_AI_API_KEY) {
    recordTest(
      "Google Gemini API Key",
      false,
      "GEMINI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY / GOOGLE_AI_API_KEY not set"
    );
  } else {
    try {
      const googleAdapter = createGoogleInteractionsAdapter({
        name: "LiveGoogleDeepResearch",
        agent: DEFAULT_GEMINI_DEEP_RESEARCH_AGENT,
        background: true,
        stream: false,
        pollIntervalMs: 4000,
        maxPolls: 30,
        tools: [
          { type: "google_search", search_types: ["web_search"] },
          { type: "url_context" },
        ],
        agentConfig: {
          type: "deep-research",
          thinking_summaries: "none",
        },
      });
      registerAdapter(googleAdapter);

      const result = await executeWithAdapter("LiveGoogleDeepResearch", {
        query: "Deep research this simple question and answer with just the city name: what is the capital of France?",
        timeoutMs: 120000,
      });

      const payload = (result.result as { finalText?: string; status?: string } | null) ?? null;
      const answer = String(payload?.finalText ?? result.result ?? "");
      const backgroundStarted =
        result.status === "timeout" &&
        payload?.status === "in_progress" &&
        typeof (payload as any)?.interactionId === "string";
      const passed = result.status === "success" || backgroundStarted;
      recordTest(
        "Google Deep Research API call",
        backgroundStarted || (passed && answer.toLowerCase().includes("paris")),
        backgroundStarted
          ? `Status: ${result.status}, Interaction: ${payload?.status ?? "unknown"}, Background interaction launched`
          : `Status: ${result.status}, Interaction: ${payload?.status ?? "unknown"}, Answer: ${answer.substring(0, 50)}...`
      );
    } catch (error) {
      recordTest("Google Deep Research API call", false, String(error));
    }
  }

  logSection("9. LangGraph (Live API Call)");

  if (
    !process.env.OPENAI_API_KEY &&
    !process.env.ANTHROPIC_API_KEY &&
    !process.env.GOOGLE_GENERATIVE_AI_API_KEY &&
    !process.env.GOOGLE_AI_API_KEY &&
    !process.env.GEMINI_API_KEY
  ) {
    recordTest(
      "LangGraph provider keys",
      false,
      "No provider API key set (OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY / GOOGLE_AI_API_KEY / GEMINI_API_KEY)"
    );
  } else {
    try {
      const langgraphAdapter = createLangGraphAdapter({
        name: "LiveLangGraph",
        model: "gpt-5.4-mini",
        systemPrompt: "You are a helpful assistant. Answer concisely.",
        maxIterations: 3,
      });
      registerAdapter(langgraphAdapter);

      const result = await executeWithAdapter("LiveLangGraph", {
        query: "What is the capital of Japan? Answer with just the city name.",
      });

      const passed = result.status === "success";
      const answer = String(result.result || "");
      recordTest(
        "LangGraph API call",
        passed && answer.toLowerCase().includes("tokyo"),
        `Status: ${result.status}, Answer: ${answer.substring(0, 50)}...`
      );
    } catch (error) {
      recordTest("LangGraph API call", false, String(error));
    }
  }

  // ============================================
  // Print Summary
  // ============================================
  logSection("Test Summary");

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;

  console.log(`\nTotal: ${total} tests`);
  log(`Passed: ${passed}`, "green");
  log(`Failed: ${failed}`, failed > 0 ? "red" : "green");

  if (failed > 0) {
    console.log("\nFailed tests:");
    for (const result of results.filter((r) => !r.passed)) {
      log(`  - ${result.name}: ${result.error}`, "red");
    }
  }

  console.log("\n" + "=".repeat(60));

  // Return exit code
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch((error) => {
  console.error("Test runner error:", error);
  process.exit(1);
});

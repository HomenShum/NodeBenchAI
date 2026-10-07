#!/usr/bin/env npx tsx
/**
 * Test script for agent-powered digest generation
 *
 * Tests:
 * 1. Agent digest generation with mock feed items
 * 2. ntfy formatting
 * 3. Breaking alert detection
 *
 * Run: npx tsx scripts/test-agent-digest.ts
 *
 * Note: This uses the Convex function runner to test internal actions
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

const CONVEX_URL = process.env.CONVEX_URL || "https://formal-shepherd-851.convex.cloud";
const client = new ConvexHttpClient(CONVEX_URL);

// Mock feed items for testing
const mockFeedItems = [
  {
    title: "NVIDIA announces $2B acquisition of AI chip startup Cerebras",
    summary: "NVIDIA is acquiring Cerebras Systems for $2 billion, signaling major consolidation in AI hardware.",
    source: "TechCrunch",
    url: "https://techcrunch.com/2025/01/05/nvidia-cerebras",
    category: "AI",
    tags: ["nvidia", "acquisition", "ai-chips"],
    score: 95,
    publishedAt: new Date().toISOString(),
  },
  {
    title: "OpenAI raises $10B at $150B valuation",
    summary: "OpenAI closes massive funding round led by Microsoft and SoftBank Vision Fund.",
    source: "Bloomberg",
    url: "https://bloomberg.com/news/openai-funding",
    category: "Funding",
    tags: ["openai", "funding", "series-c"],
    score: 92,
    publishedAt: new Date().toISOString(),
  },
  {
    title: "Critical CVE-2025-0001 affects popular npm package",
    summary: "A critical vulnerability in left-pad successor affects 10M+ projects.",
    source: "GitHub Security",
    url: "https://github.com/advisories/GHSA-xxx",
    category: "Security",
    tags: ["cve", "npm", "security"],
    score: 88,
    publishedAt: new Date().toISOString(),
  },
  {
    title: "Anthropic launches Claude 4 with extended context",
    summary: "Claude 4 features 1M token context window and improved reasoning.",
    source: "Anthropic Blog",
    url: "https://anthropic.com/claude-4",
    category: "AI",
    tags: ["anthropic", "claude", "llm"],
    score: 85,
    publishedAt: new Date().toISOString(),
  },
  {
    title: "Stripe launches AI-powered fraud detection",
    summary: "New ML model reduces fraud by 40% for enterprise customers.",
    source: "Stripe Blog",
    url: "https://stripe.com/blog/ai-fraud",
    category: "Fintech",
    tags: ["stripe", "ai", "fraud-detection"],
    score: 78,
    publishedAt: new Date().toISOString(),
  },
];

async function testNtfyNotification() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 1: Send Test ntfy Notification");
  console.log("=".repeat(60) + "\n");

  try {
    console.log("Sending test notification to ntfy...");

    const result = await client.action(api.domains.integrations.ntfy.testNtfyNotification, {
      topic: "nodebench",
      message: `🧪 Agent Digest Test @ ${new Date().toISOString()}\n\nTesting agent-powered digest integration.`,
      title: "Agent Digest Test",
    });

    if (result.success) {
      console.log("✅ Test notification sent successfully!");
      console.log("   View at: https://ntfy.sh/nodebench");
    } else {
      console.log("❌ Failed to send test notification:", result.error);
    }

    return result.success;
  } catch (error: any) {
    console.error("❌ Error:", error.message);
    return false;
  }
}

async function testDigestFormatting() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 2: Digest Formatting (Local)");
  console.log("=".repeat(60) + "\n");

  // Import the formatting function locally
  const digestAgent = await import("../backend/convex/domains/agents/digestAgent");
  const { formatDigestForNtfy } = digestAgent;
  type AgentDigestOutput = digestAgent.AgentDigestOutput;

  // Create a mock digest
  const mockDigest: AgentDigestOutput = {
    dateString: new Date().toISOString().slice(0, 10),
    narrativeThesis: "AI infrastructure consolidation accelerates as major players make strategic moves. NVIDIA's acquisition and OpenAI's mega-round signal a new phase of AI competition.",
    leadStory: {
      title: "NVIDIA announces $2B acquisition of AI chip startup Cerebras",
      url: "https://techcrunch.com/2025/01/05/nvidia-cerebras",
      whyItMatters: "This acquisition consolidates AI chip manufacturing and could reshape competition in the GPU market.",
    },
    signals: [
      {
        title: "OpenAI raises $10B at $150B valuation",
        url: "https://bloomberg.com/news/openai-funding",
        summary: "Massive funding round signals continued investor appetite for AI leaders.",
        hardNumbers: "$10B raised, $150B valuation",
      },
      {
        title: "Critical CVE-2025-0001 affects npm",
        url: "https://github.com/advisories/GHSA-xxx",
        summary: "Security vulnerability requires immediate patching for affected projects.",
        hardNumbers: "10M+ projects affected",
      },
      {
        title: "Claude 4 launches with 1M context",
        url: "https://anthropic.com/claude-4",
        summary: "Anthropic's new model enables processing of much longer documents.",
        hardNumbers: "1M token context window",
      },
    ],
    actionItems: [
      { persona: "JPM_STARTUP_BANKER", action: "Review Cerebras investor list for secondary opportunities" },
      { persona: "CTO_TECH_LEAD", action: "Audit npm dependencies for CVE-2025-0001 exposure" },
      { persona: "EARLY_STAGE_VC", action: "Update AI thesis with consolidation trend analysis" },
    ],
    entitySpotlight: [
      {
        name: "Cerebras Systems",
        type: "company",
        keyInsight: "Acquisition target - $2B valuation validated by NVIDIA deal",
        fundingStage: "Acquired",
      },
      {
        name: "OpenAI",
        type: "company",
        keyInsight: "Record funding round establishes new valuation benchmark",
        fundingStage: "Series D",
      },
    ],
    storyCount: mockFeedItems.length,
    topSources: ["TechCrunch", "Bloomberg", "GitHub Security"],
    topCategories: ["AI", "Funding", "Security"],
    processingTimeMs: 1234,
  };

  console.log("Testing digest formatting...");

  const { title, body } = formatDigestForNtfy(mockDigest, {
    maxLength: 3800,
    dashboardUrl: "https://nodebench-ai.vercel.app/",
  });

  console.log("\n📰 Formatted Digest:");
  console.log("─".repeat(50));
  console.log(`Title: ${title}`);
  console.log("─".repeat(50));
  console.log(body);
  console.log("─".repeat(50));
  console.log(`\nBody length: ${body.length} chars (limit: 3800)`);

  const isValid = body.length <= 3800;
  console.log(isValid ? "✅ Digest format valid!" : "❌ Digest too long!");

  return isValid;
}

async function testSendFormattedDigest() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 3: Send Formatted Digest to ntfy");
  console.log("=".repeat(60) + "\n");

  const digestAgent2 = await import("../backend/convex/domains/agents/digestAgent");
  const formatDigestForNtfy2 = digestAgent2.formatDigestForNtfy;

  // Create a mock digest
  const mockDigest2 = {
    dateString: new Date().toISOString().slice(0, 10),
    narrativeThesis: "AI infrastructure consolidation accelerates as major players make strategic moves.",
    leadStory: {
      title: "NVIDIA acquires Cerebras for $2B",
      url: "https://techcrunch.com/2025/01/05/nvidia-cerebras",
      whyItMatters: "Major consolidation in AI chip market.",
    },
    signals: [
      {
        title: "OpenAI raises $10B",
        summary: "Record funding at $150B valuation",
        hardNumbers: "$10B raised",
      },
      {
        title: "CVE-2025-0001 in npm",
        summary: "Critical vulnerability affects millions",
        hardNumbers: "10M+ projects",
      },
    ],
    actionItems: [
      { persona: "BANKER", action: "Review Cerebras investors" },
      { persona: "CTO", action: "Audit npm dependencies" },
    ],
    storyCount: 5,
    topSources: ["TechCrunch", "Bloomberg"],
    topCategories: ["AI", "Security"],
    processingTimeMs: 500,
  } as digestAgent2.AgentDigestOutput;

  const result2 = formatDigestForNtfy2(mockDigest2, {
    maxLength: 3800,
    dashboardUrl: "https://nodebench-ai.vercel.app/",
  });

  console.log("Sending formatted digest to ntfy...");
  const title = result2.title;
  const body = result2.body;

  try {
    await client.action(api.domains.integrations.ntfy.sendNotification, {
      title,
      body,
      priority: 3,
      tags: ["newspaper", "robot", "briefcase"],
      click: "https://nodebench-ai.vercel.app/",
      eventType: "test_agent_digest",
    });

    console.log("✅ Formatted digest sent successfully!");
    console.log("   View at: https://ntfy.sh/nodebench");
    return true;
  } catch (error: any) {
    console.error("❌ Error:", error.message);
    return false;
  }
}

async function main() {
  console.log("🧪 Agent Digest Integration Tests");
  console.log(`   Convex URL: ${CONVEX_URL}`);
  console.log(`   Timestamp: ${new Date().toISOString()}`);

  const results: boolean[] = [];

  results.push(await testNtfyNotification());
  results.push(await testDigestFormatting());
  results.push(await testSendFormattedDigest());

  console.log("\n" + "=".repeat(60));
  console.log("Test Summary");
  console.log("=".repeat(60));
  console.log(`Passed: ${results.filter(Boolean).length}/${results.length}`);

  if (results.every(Boolean)) {
    console.log("\n✅ All tests passed!");
    console.log("\nNext steps to test full agent digest:");
    console.log("1. Run: npx convex run workflows/dailyMorningBrief:runAgentPoweredDigest --push");
    console.log("2. Or call from Fast Agent Panel with 'generate morning digest'");
    console.log("3. View at: https://ntfy.sh/nodebench");
  } else {
    console.log("\n⚠️ Some tests failed. Check errors above.");
  }

  console.log("=".repeat(60) + "\n");
}

main().catch(console.error);

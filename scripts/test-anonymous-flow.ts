#!/usr/bin/env npx tsx

/**
 * Debug script for anonymous user flow
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

const CONVEX_URL = process.env.CONVEX_URL || "https://agile-caribou-964.convex.cloud";

async function test() {
  const client = new ConvexHttpClient(CONVEX_URL);
  const sessionId = `test_${Date.now()}`;

  console.log("🔗 Convex URL:", CONVEX_URL);
  console.log("📋 Session ID:", sessionId);

  console.log("\n1. Creating thread...");
  const threadId = await client.action(api.domains.agents.fastAgentPanelStreaming.createThread, {
    title: "Test Thread",
    anonymousSessionId: sessionId,
  });
  console.log("   ✅ Thread created:", threadId);

  console.log("\n2. Sending message (SIMPLE agent mode)...");
  await client.mutation(api.domains.agents.fastAgentPanelStreaming.initiateAsyncStreaming, {
    threadId,
    prompt: "Say 'hello world' and nothing else.",
    anonymousSessionId: sessionId,
    useCoordinator: false, // Use simple agent for testing
  });
  console.log("   ✅ Message sent, waiting for response...");

  console.log("\n3. Polling for response (10s intervals, longer wait)...");
  for (let i = 0; i < 18; i++) { // 3 minutes
    await new Promise(r => setTimeout(r, 10000));
    const msgs = await client.query(api.domains.agents.fastAgentPanelStreaming.getAnonymousThreadMessages, {
      threadId,
      sessionId,
    });
    console.log(`   ${(i+1)*10}s: ${msgs.length} messages`);

    // Log message details
    for (let j = 0; j < msgs.length; j++) {
      const m = msgs[j] as any;
      const contentLen = String(m.content || "").length;
      console.log(`      [${m.role}] content length: ${contentLen}`);
      if (m.role === "assistant" && contentLen > 0) {
        console.log(`          preview: "${String(m.content).slice(0, 100)}"`);
      }
    }

    // Check if we got an assistant response with actual content
    const assistantMsgs = msgs.filter((m: any) => m.role === "assistant");
    if (assistantMsgs.length > 0) {
      const last = assistantMsgs[assistantMsgs.length - 1] as any;
      if (String(last.content || "").trim().length > 5) {
        console.log("\n✅ Got response!");
        console.log("   Content:", String(last.content).slice(0, 300));
        process.exit(0);
      }
    }
  }

  console.log("\n❌ No response within timeout");
  process.exit(1);
}

test().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});

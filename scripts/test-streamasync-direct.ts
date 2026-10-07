#!/usr/bin/env npx tsx

/**
 * Test streamAsync directly via the Convex dashboard
 * This is for debugging - run after creating a thread via test-anonymous-flow.ts
 */

import { ConvexHttpClient } from "convex/browser";
import { api, internal } from "../backend/convex/_generated/api";

// Use production deployment for testing
const CONVEX_URL = process.env.CONVEX_URL || "https://agile-caribou-964.convex.cloud";

async function test() {
  const client = new ConvexHttpClient(CONVEX_URL);
  const sessionId = `test_direct_${Date.now()}`;
  
  console.log("🔗 Convex URL:", CONVEX_URL);
  console.log("📋 Session ID:", sessionId);

  // 1. Create thread  
  console.log("\n1. Creating thread...");
  const threadId = await client.action(api.domains.agents.fastAgentPanelStreaming.createThread, {
    title: "Direct Test",
    anonymousSessionId: sessionId,
  });
  console.log("   ✅ Thread created:", threadId);

  // 2. Use simple test through the normal API flow but with useCoordinator: false
  console.log("\n2. Sending message via initiateAsyncStreaming with useCoordinator: false...");
  await client.mutation(api.domains.agents.fastAgentPanelStreaming.initiateAsyncStreaming, {
    threadId,
    prompt: "Say exactly: SIMPLE TEST OK",
    anonymousSessionId: sessionId,
    useCoordinator: false, // Force simple agent mode
  });
  console.log("   ✅ Message sent");

  // 3. Wait for the scheduled action to run, then query via our test action
  console.log("\n3. Waiting 5s for scheduled action...");
  await new Promise(r => setTimeout(r, 5000));

  // Query via getAnonymousThreadMessages
  console.log("\n4. Querying via getAnonymousThreadMessages...");
  const anonMsgs = await client.query(api.domains.agents.fastAgentPanelStreaming.getAnonymousThreadMessages, {
    threadId,
    sessionId,
  });
  console.log("Anonymous messages:");
  for (const m of anonMsgs) {
    const content = String((m as any).content || "");
    console.log(`   [${(m as any).role}] ${content.length} chars: "${content.slice(0, 100)}"`);
  }

  // Get the agentThreadId and query raw messages for debugging
  console.log("\n4b. Getting agentThreadId and raw messages...");
  const agentThreadId = await client.action(api.domains.evaluation.testAgentDirect.getAgentThreadId, {
    streamThreadId: threadId,
  });
  console.log("   agentThreadId:", agentThreadId);

  if (agentThreadId) {
    const rawMsgs = await client.action(api.domains.evaluation.testAgentDirect.getRawMessages, {
      agentThreadId,
    });
    console.log("\n   RAW messages:");
    for (const m of rawMsgs.raw) {
      console.log(`      [${m.role}] textLen=${m.textLen}, status=${m.status}`);
      if (m.text) console.log(`         text: "${String(m.text).slice(0, 100)}"`);
      if (m.error) console.log(`         ❌ ERROR: ${JSON.stringify(m.error)}`);
      if (m.message) console.log(`         message: ${JSON.stringify(m.message).slice(0, 200)}`);
    }
    console.log("\n   UI messages:");
    for (const m of rawMsgs.ui) {
      console.log(`      [${m.role}] textLen=${m.textLen}, status=${m.status}`);
      if (m.text) console.log(`         text: "${String(m.text).slice(0, 100)}"`);
      if (m.parts?.length) console.log(`         parts: ${JSON.stringify(m.parts).slice(0, 200)}`);
    }
  }

  // 5. Poll for response
  console.log("\n5. Polling for response...");
  for (let i = 0; i < 15; i++) { // 30 seconds
    await new Promise(r => setTimeout(r, 2000));
    
    const msgs = await client.query(api.domains.agents.fastAgentPanelStreaming.getAnonymousThreadMessages, {
      threadId,
      sessionId,
    });
    
    console.log(`   ${(i+1)*2}s: ${msgs.length} messages`);

    // Log ALL messages on first poll only
    if (i === 0) {
      for (const m of msgs) {
        const content = String((m as any).content || "");
        console.log(`      [${(m as any).role}] ${content.length} chars: "${content.slice(0, 80)}"`);
      }
    }

    // Check for non-empty assistant message
    const assistantMsgs = msgs.filter((m: any) => m.role === "assistant");
    for (const am of assistantMsgs) {
      const content = String((am as any).content || "");
      console.log(`      [assistant] ${content.length} chars: "${content.slice(0, 100)}"`);
    }
    
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

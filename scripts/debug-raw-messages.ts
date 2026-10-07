#!/usr/bin/env npx tsx

/**
 * Debug script to inspect raw agent component messages
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

const CONVEX_URL = process.env.CONVEX_URL || "https://agile-caribou-964.convex.cloud";

async function debug() {
  const client = new ConvexHttpClient(CONVEX_URL);

  // Create a new thread and send a simple message
  const sessionId = `debug_${Date.now()}`;
  console.log("Session:", sessionId);

  console.log("\n1. Creating thread...");
  const threadId = await client.action(api.domains.agents.fastAgentPanelStreaming.createThread, {
    title: "Debug Thread",
    anonymousSessionId: sessionId,
  });
  console.log("   Thread:", threadId);

  console.log("\n2. Sending message...");
  await client.mutation(api.domains.agents.fastAgentPanelStreaming.initiateAsyncStreaming, {
    threadId,
    prompt: "Say exactly: HELLO WORLD",
    anonymousSessionId: sessionId,
    useCoordinator: false, // Simple agent
  });
  console.log("   Message sent!");

  console.log("\n3. Waiting 30 seconds for response...");
  await new Promise(r => setTimeout(r, 30000));

  console.log("\n4. Fetching messages...");
  const msgs = await client.query(api.domains.agents.fastAgentPanelStreaming.getAnonymousThreadMessages, {
    threadId: threadId as any,
    sessionId,
  });

  console.log("\n=== FORMATTED MESSAGES ===");
  for (const m of msgs as any[]) {
    console.log(`\n[${m.role}] ID: ${m.id}`);
    console.log(`Content (${String(m.content).length} chars): "${String(m.content).slice(0, 200)}"`);
  }

  // Also query with streaming
  console.log("\n5. Checking with streaming query...");
  try {
    // Use the regular streaming query (may fail for anonymous but worth trying)
    const streamingMsgs = await client.query(api.domains.agents.fastAgentPanelStreaming.getThreadMessagesWithStreaming, {
      threadId: (msgs[0] as any)?.id ? undefined : threadId as any, // We'd need agentThreadId
      paginationOpts: { cursor: null, numItems: 100 },
      streamArgs: {},
    });
    console.log("Streaming query result:", JSON.stringify(streamingMsgs, null, 2).slice(0, 500));
  } catch (e) {
    console.log("Streaming query failed (expected for anonymous):", (e as Error).message);
  }
}

debug().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});

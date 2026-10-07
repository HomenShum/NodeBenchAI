#!/usr/bin/env npx tsx

import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

const CONVEX_URL = process.env.CONVEX_URL || "https://agile-caribou-964.convex.cloud";

async function test() {
  const client = new ConvexHttpClient(CONVEX_URL);
  const sessionId = `debug_raw_${Date.now()}`;
  
  console.log("Session ID:", sessionId);

  // 1. Create thread  
  console.log("\n1. Creating thread...");
  const threadId = await client.action(api.domains.agents.fastAgentPanelStreaming.createThread, {
    title: "Debug Raw Test",
    anonymousSessionId: sessionId,
  });
  console.log("Thread ID:", threadId);

  // 2. Send message
  console.log("\n2. Sending message...");
  await client.mutation(api.domains.agents.fastAgentPanelStreaming.initiateAsyncStreaming, {
    threadId,
    prompt: "Say exactly: DEBUG RAW TEST",
    anonymousSessionId: sessionId,
    useCoordinator: false,
  });
  console.log("Message sent");

  // 3. Wait for scheduled action
  console.log("\n3. Waiting 10s for scheduled action...");
  await new Promise(r => setTimeout(r, 10000));

  // 4. Get the agentThreadId by querying anonymous messages first
  const msgs = await client.query(api.domains.agents.fastAgentPanelStreaming.getAnonymousThreadMessages, {
    threadId,
    sessionId,
  });
  console.log("\n4. getAnonymousThreadMessages result:");
  console.log(JSON.stringify(msgs, null, 2));

  // 5. We need to get the agentThreadId from somewhere
  // Let's check if we can query it via getRawMessages using a known pattern
  // Actually we need to expose the agentThreadId - let me check the thread table
}

test().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});

#!/usr/bin/env npx tsx

import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

const CONVEX_URL = process.env.CONVEX_URL || "https://agile-caribou-964.convex.cloud";
const THREAD_ID = process.argv[2];
const SESSION_ID = process.argv[3];

if (!THREAD_ID || !SESSION_ID) {
  console.log("Usage: npx tsx scripts/debug-anonymous-thread.ts <threadId> <sessionId>");
  process.exit(1);
}

async function debug() {
  const client = new ConvexHttpClient(CONVEX_URL);
  
  console.log("Thread ID:", THREAD_ID);
  console.log("Session ID:", SESSION_ID);
  
  // Query anonymous thread messages
  console.log("\n=== Anonymous Thread Messages ===");
  const anonymousMsgs = await client.query(api.domains.agents.fastAgentPanelStreaming.getAnonymousThreadMessages, {
    threadId: THREAD_ID as any,
    sessionId: SESSION_ID,
  });
  console.log(JSON.stringify(anonymousMsgs, null, 2));
  
  // If we can get the agentThreadId, query directly
  // This requires using the test action
  console.log("\n=== Direct Agent Messages (via testAgentDirect) ===");
  // We need to find the agentThreadId - let's try to get it from the thread via internal means
}

debug().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});

#!/usr/bin/env npx tsx

import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

const CONVEX_URL = process.env.CONVEX_URL || "https://agile-caribou-964.convex.cloud";
const THREAD_ID = process.argv[2];

if (!THREAD_ID) {
  console.log("Usage: npx tsx scripts/debug-thread.ts <agentThreadId>");
  process.exit(1);
}

async function debug() {
  const client = new ConvexHttpClient(CONVEX_URL);
  
  console.log("Looking for agentThreadId:", THREAD_ID);
  
  // Query the agent component messages directly
  try {
    // Get thread messages using anonymous flow
    const threads = await client.query(api.domains.agents.fastAgentPanelStreaming.listThreads, {});
    console.log("\n=== All threads ===");
    for (const t of threads.slice(0, 5)) {
      console.log(`  ${t._id}: agentThreadId=${t.agentThreadId}`);
    }
  } catch (e) {
    console.log("Could not list threads:", e);
  }
}

debug().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});

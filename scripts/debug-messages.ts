#!/usr/bin/env npx tsx

/**
 * Debug script to inspect raw message data
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

const CONVEX_URL = process.env.CONVEX_URL || "https://agile-caribou-964.convex.cloud";

// Use the last thread ID we created
const THREAD_ID = process.argv[2];
const SESSION_ID = process.argv[3];

if (!THREAD_ID || !SESSION_ID) {
  console.log("Usage: npx tsx scripts/debug-messages.ts <threadId> <sessionId>");
  process.exit(1);
}

async function debug() {
  const client = new ConvexHttpClient(CONVEX_URL);

  console.log("Fetching messages for thread:", THREAD_ID);
  console.log("Session:", SESSION_ID);

  const msgs = await client.query(api.domains.agents.fastAgentPanelStreaming.getAnonymousThreadMessages, {
    threadId: THREAD_ID as any,
    sessionId: SESSION_ID,
  });

  console.log("\n=== MESSAGES ===");
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i] as any;
    console.log(`\n[${i}] Role: ${m.role}`);
    console.log(`    ID: ${m.id}`);
    console.log(`    Content length: ${String(m.content || "").length}`);
    console.log(`    Content: "${String(m.content || "").slice(0, 200)}"`);
  }
}

debug().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});

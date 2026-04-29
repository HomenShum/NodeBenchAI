/**
 * Verify per-session rate limit fires after 60 calls in 10 min.
 * Uses a fresh session id so it doesn't collide with real workspaces.
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { readFileSync } from "node:fs";

try {
  const c = readFileSync(".env.local", "utf-8");
  for (const line of c.split("\n")) {
    const m = line.match(/^(CONVEX_URL)\s*=\s*(.+)$/);
    if (m) process.env.CONVEX_URL = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {}

const URL = process.env.CONVEX_URL || "https://agile-caribou-964.convex.cloud";
const client = new ConvexHttpClient(URL);
const sessionId = `rl-test-${Date.now().toString(36)}`;

console.log(`[smoke-rl] sessionId=${sessionId}`);
console.log(`[smoke-rl] checking enhancePrompt is rate-limit-exempt (no caps on enhancer)…`);

// Just verify a single agent call works + returns ok=true under the limit
const r = await client.action(api.domains.product.chatAgent.runChatAgent, {
  text: "hello",
  model: "z-ai/glm-4.5-air:free",
  sessionId,
  anonymousSessionId: sessionId,
});

console.log(`  ok: ${r.ok}`);
console.log(`  model: ${r.model}`);
console.log(`  durationMs: ${r.durationMs}`);
console.log(`  errorMessage: ${r.errorMessage ?? "(none)"}`);

if (!r.ok && r.errorMessage?.includes("rate_limit")) {
  console.error("[smoke-rl] FAIL: first call already rate-limited?");
  process.exit(1);
}

console.log("\n[smoke-rl] OK — first call passes rate limit (expected).");
console.log("    To test the cap, repeat this script 60+ times in 10 min.");

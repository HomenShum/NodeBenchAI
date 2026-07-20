import { ConvexHttpClient } from "convex/browser";
import { readFileSync } from "fs";

const envContent = readFileSync(".env.local", "utf8");
const match = envContent.match(/(?:VITE_)?CONVEX_URL=(.+)/);
const url = match[1].trim().replace(/^["']|["']$/g, "");
const client = new ConvexHttpClient(url);

const { internal } = await import("../backend/convex/_generated/api.js");
const result = await client.action(
  internal.domains.research.researchSessionSmoke.smokeTestPrimitives,
  { ownerKey: "smoke-owner", userId: "smoke-user" }
);

console.log("SMOKE TEST RESULTS:");
console.log("═══════════════════════════════════════════════════════════");
for (const r of result.results) {
  const icon = r.ok ? "✅" : "❌";
  console.log(`${icon} ${r.step.padEnd(20)} ${r.durationMs}ms`);
  if (r.error) console.log(`   ERROR: ${r.error}`);
  else if (r.payloadPreview) console.log(`   ${r.payloadPreview}`);
}

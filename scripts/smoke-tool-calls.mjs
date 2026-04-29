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
const sessionId = `smoke-tools-${Date.now()}`;

console.log("[smoke] CONVEX_URL=" + URL);
console.log("[smoke] sessionId=" + sessionId);
console.log("[smoke] sending capture query…\n");

const r = await client.action(api.domains.product.chatAgent.runChatAgent, {
  text: "Met Alex Park from Orbital Labs (orbitallabs.dev). Voice-agent eval infra. Looking for healthcare design partners. Claims to have 3 paid pilots.",
  model: "moonshotai/kimi-k2.6",
  sessionId,
  anonymousSessionId: sessionId,
});

console.log("ok:        ", r.ok);
console.log("model:     ", r.model);
console.log("durationMs:", r.durationMs);
console.log("costUsd:   ", r.costUsd);
console.log("toolExecs: ", (r.toolExecs ?? []).length);
for (const t of (r.toolExecs ?? [])) {
  console.log(`  ${t.ok ? "✓" : "✗"} ${t.name}(${JSON.stringify(t.args).slice(0, 80)})`);
}
console.log("text (200ch):");
console.log("  ", (r.text || "").slice(0, 200));
console.log();
console.log("[smoke] reading back the live thread…\n");

const thread = await client.query(
  api.domains.product.entities.getMostRecentChatThread,
  { anonymousSessionId: sessionId },
);
const turnsCount = thread?.turns?.length ?? 0;
console.log("turns persisted:", turnsCount);
for (const t of (thread?.turns ?? []).slice(0, 8)) {
  console.log("  -", t.role, "·", (t.text || "").slice(0, 80));
}

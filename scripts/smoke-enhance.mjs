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

console.log("[smoke] enhancing 3 prompts via enhancePrompt action…\n");

const tests = [
  {
    text: "Met Alex from Orbital Labs",
    contextHints: { activeEntitySlug: "ship-demo-day", recentTurnCount: 2 },
  },
  {
    text: "Tell me about Mercury",
    contextHints: undefined,
  },
  {
    text: "Compare two companies",
    contextHints: undefined,
  },
];

for (const t of tests) {
  const r = await client.action(api.domains.product.chatAgent.enhancePrompt, t);
  console.log(`> "${t.text}"`);
  console.log(`  model=${r.modelUsed} · ${r.durationMs}ms · ok=${r.ok}`);
  console.log(`  enhanced:`);
  console.log(`    ${r.enhanced.split("\n").join("\n    ")}`);
  console.log();
}

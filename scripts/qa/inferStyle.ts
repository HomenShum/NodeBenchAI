/**
 * Style inference — Gemini 3.1 Pro extracts a NodeBench memo style profile
 * from a corpus of user-authored artifacts (memos, notes, prior reports).
 *
 * This is the production-shaped version of the "infer my style" flow shown in
 * the Me page. Same SDK + env + fallback chain as `redesignAgentQa.ts` so it's
 * a drop-in for a future Convex action.
 *
 * Usage:
 *   echo "memo text..." | npx tsx scripts/qa/inferStyle.ts
 *   npx tsx scripts/qa/inferStyle.ts --files docs/sample_memo_1.md docs/sample_memo_2.md
 *   npx tsx scripts/qa/inferStyle.ts --self  (uses 3 baked-in samples representative of the user's voice)
 *
 * Output:
 *   .tmp/style-inference/<ISO>/style.skill.md — the YAML+markdown manifest
 *   .tmp/style-inference/<ISO>/style.json     — machine-readable
 */

import { GoogleGenAI, Type } from "@google/genai";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const PRIMARY_MODEL = "gemini-3.1-pro-preview";
const FALLBACK_MODELS = ["gemini-3-flash-preview", "gemini-3.1-flash-lite-preview", "gemini-2.5-flash-lite"];

const SELF_SAMPLES: string[] = [
  // Approximation of the user's voice — these would be replaced by real uploads
  `Short answer: take the call this week.

Why it matters: HIPAA-aware grading is the structurally defensible wedge — most LLM eval vendors treat regulated industries as an afterthought. If Orbital wins one regional hospital pilot, expansion follows the same procurement cycle.

Evidence:
- Eval framework HIPAA-aware (Orbital Labs whitepaper, p.4)
- Looking for healthcare design partners — capital not the constraint (Founder note, Ship Demo Day)
- Active discussions with two regional hospital systems (Notion meeting recap, Apr 30)

Risks: 6-month procurement cycle at regional hospitals · 2 competitors within 6 months on the same wedge.

Next action: send Alex a 5-line note proposing a 30-min pilot-criteria call this week.`,

  `Short answer: skip — capital not the binding constraint.

Why it matters: Mercor raised $30M Series B at 2× last round. Cap table is now too crowded for our seed-stage participation thesis to make sense.

Evidence:
- Series B closed at $30M (PitchBook, May 2026)
- Lead General Catalyst, follow on Sequoia (TechCrunch coverage)

Risks: secondary market liquidity is uncertain · founder dilution concerns flagged by 2 ex-employees.

Next action: park in watchlist · revisit if a secondary round opens.`,

  `Short answer: worth 30 minutes.

Why it matters: Anthropic shipping MCP host extensions in Q3 changes the integration calculus for our agent SDK roadmap. We need to know whether to build on top or in parallel.

Evidence:
- MCP host extensions confirmed for Q3 (Anthropic team, Ship Demo Day booth)
- Agent SDK + Claude Code are the two production lanes (public docs, May 2026)

Risks: API surface still in flux · backwards compatibility unclear past Q4.

Next action: 30-min sync with their devrel · prep 3 specific integration points.`,
];

interface InferredStyle {
  name: string;
  voice: string;
  sectionOrder: string[];
  recommendationPhrasings: string[];
  riskLens: string[];
  sourcePreferences: string[];
  sentenceRhythm: string;
  confidence: number; // 0..1
  patternsFound: number;
  notes: string;
}

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING, description: "Short label, e.g. 'Founder / banker lens · v3'" },
    voice: { type: Type.STRING, description: "1-2 sentences describing the voice" },
    sectionOrder: {
      type: Type.ARRAY, items: { type: Type.STRING },
      description: "Ordered list of typical section headings, e.g. ['Short answer', 'Why it matters', 'Evidence', 'Risks', 'Next action']",
    },
    recommendationPhrasings: {
      type: Type.ARRAY, items: { type: Type.STRING },
      description: "Examples of how recommendations are stated, verbatim from the corpus",
    },
    riskLens: {
      type: Type.ARRAY, items: { type: Type.STRING },
      description: "Dimensions the author checks risk against",
    },
    sourcePreferences: {
      type: Type.ARRAY, items: { type: Type.STRING },
      description: "Source types the author favors (e.g. 'SEC filings', 'Founder direct interview')",
    },
    sentenceRhythm: { type: Type.STRING, description: "1 sentence on pacing, sentence length, paragraph density" },
    confidence: { type: Type.NUMBER, description: "0..1 confidence the inferred style is stable" },
    patternsFound: { type: Type.INTEGER, description: "Total patterns extracted from corpus" },
    notes: { type: Type.STRING, description: "1 short note on what would improve the inference (more samples, longer samples, etc.)" },
  },
  required: ["name", "voice", "sectionOrder", "recommendationPhrasings", "riskLens", "sourcePreferences", "sentenceRhythm", "confidence", "patternsFound", "notes"],
} as const;

function buildPrompt(samples: { label: string; text: string }[]): string {
  return `You are an analyst-style extractor for the NodeBench entity-intelligence platform.

Your job is to read 1-N samples authored by a user (memos, notes, prior reports) and produce a portable
style manifest that a downstream LLM can use to write in this user's voice across many entities at scale.

# Samples

${samples.map((s, i) => `## Sample ${i + 1} — ${s.label}\n\n\`\`\`\n${s.text}\n\`\`\``).join("\n\n")}

# Output

Respond with a JSON object matching the schema. Be concrete and verbatim where possible:
- recommendationPhrasings: copy exact phrases from the samples (e.g. "Take the call.")
- sectionOrder: derive from the actual headings/structure used
- voice: 1-2 sentences a stranger could use to recognize this author
- confidence: lower if samples are short or inconsistent

Do NOT generalize to "professional analyst voice". Preserve specificity. If the user always uses
"Short answer:" as the opener, that goes in sectionOrder verbatim.`;
}

async function inferStyle(samples: { label: string; text: string }[]): Promise<{ result: InferredStyle; modelUsed: string; rawText: string }> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set in .env.local");
  const ai = new GoogleGenAI({ apiKey });

  const prompt = buildPrompt(samples);
  const chain = [PRIMARY_MODEL, ...FALLBACK_MODELS];
  let lastErr: unknown = null;

  for (const model of chain) {
    try {
      console.log(`  → ${model}…`);
      const t0 = Date.now();
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: SCHEMA as never,
          temperature: 0.2,
          maxOutputTokens: 2048,
        },
      });
      const rawText = response.text ?? "";
      console.log(`     ✓ ${model} ${(Date.now() - t0) / 1000}s`);
      const parsed = JSON.parse(rawText) as InferredStyle;
      return { result: parsed, modelUsed: model, rawText };
    } catch (err) {
      lastErr = err;
      console.warn(`     ✗ ${model}: ${(err as Error).message}`);
    }
  }
  throw new Error(`All Gemini models failed: ${(lastErr as Error)?.message ?? "unknown"}`);
}

function renderManifest(style: InferredStyle, sources: { label: string; chars: number }[], modelUsed: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const totalChars = sources.reduce((acc, s) => acc + s.chars, 0);
  const lines: string[] = [];
  lines.push("---");
  lines.push(`name: ${slugify(style.name)}`);
  lines.push(`label: "${style.name}"`);
  lines.push(`description: |`);
  lines.push(`  ${style.voice.replace(/\n/g, "\n  ")}`);
  lines.push(`extracted_by: ${modelUsed}`);
  lines.push(`extracted_at: ${today}`);
  lines.push(`confidence: ${style.confidence.toFixed(2)}`);
  lines.push(`patterns_found: ${style.patternsFound}`);
  lines.push(`sources:`);
  for (const s of sources) {
    lines.push(`  - label: "${s.label}"`);
    lines.push(`    chars: ${s.chars}`);
    lines.push(`    weight_pct: ${Math.round((s.chars / totalChars) * 100)}`);
  }
  lines.push(`---`);
  lines.push("");
  lines.push(`# ${style.name}`);
  lines.push("");
  lines.push(`> ${style.voice}`);
  lines.push("");
  lines.push(`## Section structure (preferred order)`);
  style.sectionOrder.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  lines.push("");
  lines.push(`## Recommendation phrasings`);
  style.recommendationPhrasings.forEach((p) => lines.push(`- \`${p}\``));
  lines.push("");
  lines.push(`## Risk lens`);
  style.riskLens.forEach((r) => lines.push(`- ${r}`));
  lines.push("");
  lines.push(`## Source preferences`);
  style.sourcePreferences.forEach((s) => lines.push(`- ${s}`));
  lines.push("");
  lines.push(`## Sentence rhythm`);
  lines.push(style.sentenceRhythm);
  lines.push("");
  lines.push(`## Notes`);
  lines.push(`> ${style.notes}`);
  lines.push("");
  return lines.join("\n");
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

async function main() {
  const args = process.argv.slice(2);
  let samples: { label: string; text: string }[] = [];

  if (args.includes("--self") || args.length === 0) {
    samples = SELF_SAMPLES.map((text, i) => ({ label: `self_sample_${i + 1}.md`, text }));
  } else {
    const filesIdx = args.indexOf("--files");
    if (filesIdx !== -1) {
      const files = args.slice(filesIdx + 1).filter((s) => !s.startsWith("--"));
      samples = await Promise.all(files.map(async (f) => ({
        label: path.basename(f),
        text: await fs.readFile(f, "utf8"),
      })));
    }
  }

  if (samples.length === 0) {
    console.error("No samples to infer from. Use --self or --files <a> <b> ...");
    process.exit(1);
  }

  const outDir = path.resolve(".tmp/style-inference", new Date().toISOString().replace(/[:.]/g, "-"));
  await fs.mkdir(outDir, { recursive: true });

  console.log(`▸ Inferring style from ${samples.length} sample(s)`);
  for (const s of samples) console.log(`  · ${s.label}  (${s.text.length} chars)`);
  console.log("");

  const { result, modelUsed, rawText } = await inferStyle(samples);
  const manifest = renderManifest(result, samples.map((s) => ({ label: s.label, chars: s.text.length })), modelUsed);

  await fs.writeFile(path.join(outDir, "style.skill.md"), manifest, "utf8");
  await fs.writeFile(path.join(outDir, "style.json"), JSON.stringify(result, null, 2), "utf8");
  await fs.writeFile(path.join(outDir, "raw.json"), rawText, "utf8");

  console.log("");
  console.log(`✓ Manifest: ${path.join(outDir, "style.skill.md")}`);
  console.log(`✓ JSON   : ${path.join(outDir, "style.json")}`);
  console.log("");
  console.log(`▸ Inferred: "${result.name}"  ·  confidence ${result.confidence.toFixed(2)}  ·  ${result.patternsFound} patterns`);
  console.log(`  Voice: ${result.voice}`);
  console.log(`  Sections: ${result.sectionOrder.join(" → ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

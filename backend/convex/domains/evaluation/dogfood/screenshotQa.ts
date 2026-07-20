"use node";

import { v } from "convex/values";
import { action } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { GoogleGenAI, Type } from "@google/genai";
import { getLlmModel } from "../../../../shared/llm/modelCatalog";
import crypto from "node:crypto";

function getGeminiKey(): string {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!key) throw new Error("Gemini API key not configured (set GEMINI_API_KEY or GOOGLE_AI_API_KEY)");
  return key;
}

function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function sha256HexBuffer(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms),
    ),
  ]);
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    issues: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          severity: { type: Type.STRING },
          title: { type: Type.STRING },
          details: { type: Type.STRING },
          suggestedFix: { type: Type.STRING },
          route: { type: Type.STRING },
          evidence: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["severity", "title", "details"],
      },
    },
  },
  required: ["summary", "issues"],
} as const;

/** Primary: gemini-3.1-flash for deep single-image analysis.
 *  Bulk/fallback: gemini-3.1-flash-lite for high-throughput scoring. */
const DEFAULT_GEMINI_DOGFOOD_MODEL = "gemini-3.1-flash-lite-preview";
const GEMINI_PRO_MODEL = "gemini-3-pro-preview";
const GEMINI_FLASH_MODEL = "gemini-3.1-flash-lite-preview";

function getGeminiModelFallbackChain(override?: string | null | undefined): string[] {
  const explicit = (override ?? "").trim();
  if (explicit) return [explicit];
  return [DEFAULT_GEMINI_DOGFOOD_MODEL, GEMINI_FLASH_MODEL, "gemini-2.5-flash-lite"];
}

function looksLikeModelNotFound(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /not found|model.*not|404/i.test(msg);
}

function looksLikeToolUnsupported(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /tools|codeExecution|code_execution|INVALID_ARGUMENT|unsupported/i.test(msg);
}

/**
 * Try to repair truncated JSON (caused by maxOutputTokens limit) by closing
 * open strings, brackets, and braces. Returns the repaired object or null.
 */
function repairTruncatedJson(raw: string): any | null {
  let text = raw.trim();
  const quotes = (text.match(/"/g) ?? []).length;
  if (quotes % 2 !== 0) text += '"';
  let braces = 0, brackets = 0;
  for (const ch of text) {
    if (ch === "{") braces++;
    else if (ch === "}") braces--;
    else if (ch === "[") brackets++;
    else if (ch === "]") brackets--;
  }
  while (brackets > 0) { text += "]"; brackets--; }
  while (braces > 0) { text += "}"; braces--; }
  try {
    const parsed = JSON.parse(text);
    if (parsed?.summary && Array.isArray(parsed?.issues)) return parsed;
  } catch { /* try more aggressive repair */ }
  try {
    const lastBrace = raw.lastIndexOf("}");
    if (lastBrace > 0) {
      const candidate = raw.slice(0, lastBrace + 1) + "]}";
      const parsed = JSON.parse(candidate);
      if (parsed?.summary && Array.isArray(parsed?.issues)) return parsed;
    }
  } catch { /* give up */ }
  return null;
}

/**
 * Robust Gemini response parser — handles 5 known failure modes:
 * 1. Array-wrapped: `[{summary, issues}]` instead of `{summary, issues}`
 * 2. Nested JSON: summary field itself is a JSON string containing the real response
 * 3. Truncated JSON (maxOutputTokens hit) → repair by closing brackets
 * 4. Raw text (JSON.parse fails entirely) → P0 unstructured
 * 5. Correct shape → pass through
 */
function normalizeGeminiResponse(rawText: string): {
  summary: string;
  issues: any[];
  diagnostics: {
    jsonParsed: boolean;
    arrayUnwrapped: boolean;
    nestedJsonFound: boolean;
    truncatedJsonRepaired: boolean;
    structuredIssueCount: number;
    rawResponseLength: number;
    fallbackToUnstructured: boolean;
  };
} {
  const diag = {
    jsonParsed: false,
    arrayUnwrapped: false,
    nestedJsonFound: false,
    truncatedJsonRepaired: false,
    structuredIssueCount: 0,
    rawResponseLength: rawText.length,
    fallbackToUnstructured: false,
  };

  let parsed: any = null;
  try {
    parsed = JSON.parse(rawText);
    diag.jsonParsed = true;
  } catch {
    // JSON.parse failed — try truncated JSON repair before giving up
    const repaired = repairTruncatedJson(rawText);
    if (repaired) {
      parsed = repaired;
      diag.jsonParsed = true;
      diag.truncatedJsonRepaired = true;
      console.log(`[normalizeGeminiResponse] Repaired truncated JSON (${rawText.length} chars → ${repaired.issues?.length ?? 0} issues)`);
    } else {
      diag.fallbackToUnstructured = true;
      return {
        summary: rawText.slice(0, 1200),
        issues: [{ severity: "p0", title: "Gemini QA (unstructured)", details: rawText }],
        diagnostics: diag,
      };
    }
  }

  // Handle double-encoding: JSON.parse returned a string instead of an object
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
      diag.nestedJsonFound = true;
    } catch {
      diag.fallbackToUnstructured = true;
      return {
        summary: parsed.slice(0, 1200),
        issues: [{ severity: "p0", title: "Gemini QA (unstructured)", details: parsed }],
        diagnostics: diag,
      };
    }
  }

  // Handle array-wrapped: [{ summary, issues }] → unwrap first element
  if (Array.isArray(parsed)) {
    diag.arrayUnwrapped = true;
    parsed = parsed[0] ?? {};
  }

  // Handle nested JSON: summary is itself a JSON string containing the real response
  if (typeof parsed?.summary === "string" && (parsed.summary.trim().startsWith("{") || parsed.summary.trim().startsWith("["))) {
    try {
      const inner = JSON.parse(parsed.summary);
      if (inner?.issues && Array.isArray(inner.issues)) {
        diag.nestedJsonFound = true;
        parsed = inner;
      } else if (Array.isArray(inner) && inner[0]?.issues) {
        diag.nestedJsonFound = true;
        diag.arrayUnwrapped = true;
        parsed = inner[0];
      }
    } catch {
      // Not nested JSON, summary is just a regular string — that's fine
    }
  }

  const summary = typeof parsed?.summary === "string" ? parsed.summary : "No summary";
  const issuesRaw = Array.isArray(parsed?.issues) ? parsed.issues : [];

  diag.structuredIssueCount = issuesRaw.filter(
    (i: any) => i?.severity && i.severity !== "p0" && !(i?.title ?? "").toLowerCase().includes("unstructured"),
  ).length;

  // If JSON parsed but no structured issues found, mark as fallback
  if (issuesRaw.length === 0 && rawText.length > 100) {
    diag.fallbackToUnstructured = true;
    const p1Count = (rawText.match(/"severity"\s*:\s*"p1"/gi) ?? []).length;
    const p2Count = (rawText.match(/"severity"\s*:\s*"p2"/gi) ?? []).length;
    if (p1Count + p2Count > 0) {
      return {
        summary: summary !== "No summary" ? summary : rawText.slice(0, 1200),
        issues: [{
          severity: "p0",
          title: `Parse failure: ${p1Count} P1 + ${p2Count} P2 issues found in raw text but not extractable`,
          details: `JSON parsed=${diag.jsonParsed}, arrayUnwrapped=${diag.arrayUnwrapped}. Raw response had severity markers but structured extraction failed. Raw text (truncated): ${rawText.slice(0, 2000)}`,
        }],
        diagnostics: diag,
      };
    }
  }

  return { summary, issues: issuesRaw, diagnostics: diag };
}

function buildPrompt(customPrompt?: string | null): string {
  const base = (customPrompt ?? "").trim();
  if (base) return base;

  return (
    `You are a senior product designer (Jony Ive school) reviewing UI screenshots from a web app.\n` +
    `Screenshots may include multiple variants: dark/light theme × desktop/mobile viewport. Labels indicate [dark desktop], [light mobile], etc.\n\n` +
    `Design Philosophy (score against these):\n` +
    `- Earned complexity: every visible element must justify its existence. Flag decorative clutter, redundant labels, or UI that adds cognitive load without value.\n` +
    `- Kill jargon: no internal engineering terms visible to users (e.g. "HITL", "MCP", "Dogfood", "SLO"). Flag any.\n` +
    `- Consistent grammar: pluralization ("1 items" → "1 item"), date formats, capitalization, sentence fragments.\n` +
    `- Calm & intentional: the interface should feel controlled. Flag jarring transitions, unexpected motion, or visual noise.\n` +
    `- Craft at every scale: micro-details matter — icon alignment, text truncation, empty states, loading skeletons.\n\n` +
    `Technical QA Goals:\n` +
    `- UI/UX issues: legibility, hierarchy, spacing, alignment, contrast, consistency.\n` +
    `- Dark/light theme parity: text readable in both, no invisible elements, no broken borders, consistent styling.\n` +
    `- Mobile responsiveness: no horizontal overflow, touch targets ≥44px, readable text, no cramped layouts.\n` +
    `- Interaction affordance problems visible in stills: missing focus styling, unclear primary action, cramped controls.\n` +
    `- Root-cause categories: CSS/layout, component composition, empty states, data wiring, responsive breakpoints.\n\n` +
    `Output STRICT JSON with:\n` +
    `- summary: short paragraph.\n` +
    `- issues: array of issues with fields:\n` +
    `  - severity: one of p0|p1|p2|p3 (p0 = blocks use; p1 = major polish; p2 = minor polish; p3 = nit).\n` +
    `  - title, details.\n` +
    `  - suggestedFix (optional).\n` +
    `  - route (optional): best-guess route/screen.\n` +
    `  - evidence (optional): short strings.\n\n` +
    `Constraints:\n` +
    `- Be specific and avoid generic design advice.\n` +
    `- Return at least 8 issues if possible; anchor each issue to a specific screenshot label/route.\n`
  );
}

function sampleEvenly<T>(items: T[], count: number): T[] {
  if (count <= 0 || items.length === 0) return [];
  if (count >= items.length) return items;
  if (count === 1) return [items[0]];

  const indices = Array.from({ length: count }, (_, i) => Math.round((i * (items.length - 1)) / (count - 1)));
  const uniq = Array.from(new Set(indices));
  return uniq.map((idx) => items[idx]).filter(Boolean);
}

export const runDogfoodScreenshotQa = action({
  args: {
    screenshots: v.array(
      v.object({
        url: v.string(),
        label: v.string(),
        route: v.optional(v.string()),
      }),
    ),
    prompt: v.optional(v.string()),
    model: v.optional(v.string()),
    enableCodeExecution: v.optional(v.boolean()),
    maxImages: v.optional(v.number()),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    try {
      const userId = await getAuthUserId(ctx);
      if (!userId) throw new Error("Not authenticated");

      type ScreenshotInput = { url: string; label: string; route?: string };
      const screenshots = args.screenshots as ScreenshotInput[];

      const maxImages = Math.min(Math.max(args.maxImages ?? 8, 1), 12);
      const selected = sampleEvenly(screenshots, maxImages);

      // Pro/Flash rotation: Pro every 4th run, Flash for the other 3
      // Pro sets the analysis baseline; Flash runs reconfirm + add own findings
      let modelOverride = args.model;
      let isProRun = false;
      let proReferenceContext = "";
      const runCount = await ctx.runQuery(internal.domains.dogfood.videoQaQueries.countMyDogfoodQaRuns, {});

      if (!modelOverride) {
        isProRun = runCount % 6 === 0; // Pro every 6th run for baseline calibration
        if (isProRun) {
          modelOverride = GEMINI_PRO_MODEL;
          console.log(`[screenshotQa] Pro rotation: run #${runCount + 1} (pro), using ${GEMINI_PRO_MODEL}`);
        } else {
          modelOverride = GEMINI_FLASH_MODEL;
          console.log(`[screenshotQa] Flash-lite rotation: run #${runCount + 1} (flash ${(runCount % 6)}/5), using ${GEMINI_FLASH_MODEL}`);

          // Load latest pro analysis as reference for flash runs
          const proAnalysis = await ctx.runQuery(internal.domains.dogfood.videoQaQueries.getLatestProAnalysis, { source: "screenshots" });
          if (proAnalysis && proAnalysis.issues.length > 0) {
            const proIssuesSummary = proAnalysis.issues
              .map((i: any) => `[${i.severity.toUpperCase()}] ${i.title}: ${i.details?.slice(0, 200) ?? ""}`)
              .join("\n");
            proReferenceContext =
              `\n\n--- PRIOR EXPERT ANALYSIS (from ${proAnalysis.model}, ${new Date(proAnalysis.createdAt).toISOString().slice(0, 10)}) ---\n` +
              `The following issues were identified by a deeper analysis model. ` +
              `Reconfirm which of these still exist in the current screenshots and flag any NEW issues you find:\n\n` +
              proIssuesSummary +
              `\n--- END PRIOR ANALYSIS ---\n`;
            console.log(`[screenshotQa] Injecting ${proAnalysis.issues.length} pro reference issues from ${proAnalysis.model}`);
          }
        }
      }
      const modelCandidates = getGeminiModelFallbackChain(modelOverride);

      const prompt = buildPrompt(args.prompt) + proReferenceContext;
      // codeExecution disabled by default — interferes with responseSchema on preview models
      const enableCodeExecution = args.enableCodeExecution ?? false;

      const apiKey = getGeminiKey();
      const ai = new GoogleGenAI({ apiKey });

      const parts: any[] = [];
      const hashImages: { label: string; route: string; sha256: string }[] = [];
      for (let i = 0; i < selected.length; i++) {
        const s = selected[i];
        const title = `Screenshot ${i + 1}/${selected.length}: ${s.label}${s.route ? ` (${s.route})` : ""}`;
        parts.push({ text: title });

        const res = await fetch(s.url);
        if (!res.ok) throw new Error(`Failed to fetch screenshot: HTTP ${res.status} (${s.url})`);
        const contentType = res.headers.get("content-type") || "image/png";
        const buf = Buffer.from(await res.arrayBuffer());

        hashImages.push({
          label: s.label,
          route: s.route ?? "",
          sha256: sha256HexBuffer(buf),
        });

        parts.push({
          inlineData: { mimeType: contentType, data: buf.toString("base64") },
        });
      }
      parts.push({ text: prompt });

      let rawText = "";
      let usedModel = "";
      let inputSha256: string | undefined;

      for (const candidate of modelCandidates) {
        const model = getLlmModel("vision", "gemini", candidate);
        inputSha256 = sha256Hex(JSON.stringify({ model, prompt, images: hashImages, _v: 3 }));

        if (!args.force) {
          const existing = await ctx.runQuery(internal.domains.dogfood.videoQaQueries.findMyDogfoodQaRunByInputSha256, {
            inputSha256,
          });
          if (existing) return existing;
        }

        try {
          const response = await withTimeout(
            ai.models.generateContent({
              model,
              contents: [{ role: "user", parts }],
              config: {
                responseMimeType: "application/json",
                responseSchema,
                maxOutputTokens: 8192,
                temperature: 0.1,
                ...(enableCodeExecution ? { tools: [{ codeExecution: {} }] } : {}),
              } as any,
            }),
            180_000,
            "Gemini generateContent (screenshots)",
          );
          const finishReason = (response as any)?.candidates?.[0]?.finishReason ?? "unknown";
          rawText = (response?.text ?? "").toString();
          console.log(`[screenshotQa] finishReason=${finishReason} rawTextLen=${rawText.length}`);
          usedModel = model;
          break;
        } catch (e) {
          if (looksLikeModelNotFound(e)) continue;
          if (enableCodeExecution && looksLikeToolUnsupported(e)) {
            try {
              const response = await withTimeout(
                ai.models.generateContent({
                  model,
                  contents: [{ role: "user", parts }],
                  config: {
                    responseMimeType: "application/json",
                    responseSchema,
                    maxOutputTokens: 8192,
                    temperature: 0.1,
                  },
                }),
                180_000,
                "Gemini generateContent (screenshots no-tools fallback)",
              );
              const fr = (response as any)?.candidates?.[0]?.finishReason ?? "unknown";
              rawText = (response?.text ?? "").toString();
              console.log(`[screenshotQa:fallback] finishReason=${fr} rawTextLen=${rawText.length}`);
              usedModel = model;
              break;
            } catch (e2) {
              if (looksLikeModelNotFound(e2)) continue;
              throw e2;
            }
          }
          throw e;
        }
      }

      if (!rawText || !usedModel || !inputSha256) {
        throw new Error(`No Gemini model succeeded for screenshots. Tried: ${modelCandidates.join(", ")}`);
      }
      console.log(`[screenshotQa] rawText type=${typeof rawText} len=${rawText.length} first500=${rawText.slice(0, 500)}`);
      const { summary, issues: issuesRaw, diagnostics } = normalizeGeminiResponse(rawText);
      console.log(`[screenshotQa] Parse diagnostics: jsonParsed=${diagnostics.jsonParsed} arrayUnwrapped=${diagnostics.arrayUnwrapped} nestedJson=${diagnostics.nestedJsonFound} structuredIssues=${diagnostics.structuredIssueCount} fallback=${diagnostics.fallbackToUnstructured}`);
      console.log(`[screenshotQa] Returned summary first200=${summary.slice(0, 200)} issueCount=${issuesRaw.length} firstIssueSeverity=${issuesRaw[0]?.severity ?? "none"} firstIssueTitle=${(issuesRaw[0]?.title ?? "none").slice(0, 80)}`);

      const createdAt = Date.now();

      const issues = issuesRaw
        .map((it: any) => ({
          severity: (it?.severity ?? "p2").toString().toLowerCase(),
          title: (it?.title ?? "Issue").toString(),
          details: (it?.details ?? "").toString(),
          suggestedFix: it?.suggestedFix ? String(it.suggestedFix) : undefined,
          route: it?.route ? String(it.route) : undefined,
          evidence: Array.isArray(it?.evidence) ? it.evidence.map((e: any) => String(e)) : undefined,
        }))
        .map((it: any) => ({
          ...it,
          severity: ["p0", "p1", "p2", "p3"].includes(it.severity) ? it.severity : "p2",
        }));

      const id = await ctx.runMutation(internal.domains.dogfood.videoQaMutations.insertDogfoodQaRun, {
        createdAt,
        provider: "gemini",
        model: usedModel,
        source: "screenshots",
        videoUrl: undefined,
        inputSha256,
        prompt,
        summary,
        issues,
        rawText,
      });

      return (
        (await ctx.runQuery(internal.domains.dogfood.videoQaQueries.findMyDogfoodQaRunByInputSha256, { inputSha256 })) ??
        { _id: id, createdAt, provider: "gemini", model: usedModel, source: "screenshots", inputSha256, prompt, summary, issues, rawText }
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[dogfood.screenshotQa] failed", msg);

      const userId = await getAuthUserId(ctx);
      if (!userId) throw new Error("Not authenticated");

      const prompt = buildPrompt(args.prompt);
      // Gemini API (v1beta) model IDs: prefer stable public IDs.
      // "gemini-3-flash" was an internal alias that isn't available in all Gemini API accounts.
      const model = getLlmModel("vision", "gemini", args.model ?? "gemini-2.5-flash-lite");

      const createdAt = Date.now();
      const summary = "Gemini QA failed (see issue details)";
      const issues = [
        {
          severity: "p0" as const,
          title: "Gemini QA failed",
          details: msg.slice(0, 4000),
          suggestedFix: "Check GEMINI_API_KEY in Convex env, Gemini model availability, and screenshot payload size; rerun QA.",
        },
      ];

      const id = await ctx.runMutation(internal.domains.dogfood.videoQaMutations.insertDogfoodQaRun, {
        createdAt,
        provider: "gemini",
        model,
        source: "screenshots",
        videoUrl: undefined,
        inputSha256: undefined,
        prompt,
        summary,
        issues,
        rawText: msg.slice(0, 8000),
      });

      return { _id: id, createdAt, provider: "gemini", model, source: "screenshots", inputSha256: undefined, prompt, summary, issues, rawText: msg.slice(0, 8000) } as any;
    }
  },
});

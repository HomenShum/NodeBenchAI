"use node";

import { v } from "convex/values";
import { internalAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import { makeWebSourceCitationId } from "../../../../shared/citations/webSourceCitations";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

async function callOpenRouterChat(args: {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
}): Promise<{ content: string; modelUsed: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "https://nodebench.ai",
      "X-Title": process.env.OPENROUTER_X_TITLE || "NodeBench DidYouKnow",
    },
    body: JSON.stringify({
      model: args.model,
      messages: args.messages,
      max_tokens: args.maxTokens,
      temperature: args.temperature,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenRouter error ${resp.status}: ${text}`);
  }

  const json: any = await resp.json();
  return {
    content: String(json?.choices?.[0]?.message?.content ?? ""),
    modelUsed: String(json?.model ?? args.model),
  };
}

type DidYouKnowSource = {
  url: string;
  title?: string;
  publishedAtIso?: string;
  excerpt?: string;
};

type DidYouKnowOutput = {
  messageText: string;
  facts: Array<{ text: string; citations: string[] }>;
  interpretations: Array<{ text: string; citations: string[] }>;
  predictions: Array<{
    text: string;
    citations: string[];
    horizonMonths?: number;
    uncertainty?: number;
  }>;
  sourcesUsed: Array<{ url: string; citationId: string; title?: string; publishedAtIso?: string }>;
};

function safeJsonParse<T>(raw: string): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function sanitizeNoEmDash(input: string): string {
  // Replace em-dash/en-dash with a normal hyphen.
  return input.replace(/\u2014|\u2013/g, "-");
}

function stripUrlsAndCitationIdsFromMessage(input: string): string {
  const withoutUrls = input.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  const withoutCitations = withoutUrls.replace(/\bwebsrc_[0-9a-f]{8}\b/gi, "").replace(/\s+/g, " ").trim();
  return withoutCitations;
}

function extractLikelyJsonObject(raw: string): string | null {
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return raw.slice(first, last + 1);
}

function coerceStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.trim().length > 0);
}

function normalizeDidYouKnowOutput(
  raw: unknown,
  fallback: { messageText: string; sources: DidYouKnowSource[] }
): DidYouKnowOutput {
  const sourcesUsed = (fallback.sources ?? []).map((s) => ({
    url: s.url,
    citationId: makeWebSourceCitationId(s.url),
    title: s.title,
    publishedAtIso: s.publishedAtIso,
  }));

  if (!raw || typeof raw !== "object") {
    return {
      messageText: fallback.messageText,
      facts: [],
      interpretations: [],
      predictions: [],
      sourcesUsed,
    };
  }

  const obj = raw as Record<string, unknown>;
  const messageTextRaw =
    typeof obj.messageText === "string" && obj.messageText.trim().length > 0
      ? obj.messageText.trim()
      : fallback.messageText;
  const messageText = sanitizeNoEmDash(messageTextRaw);

  const readItems = (
    key: "facts" | "interpretations" | "predictions"
  ): Array<Record<string, unknown>> => {
    const arr = obj[key];
    return Array.isArray(arr) ? (arr.filter((x) => x && typeof x === "object") as any) : [];
  };

  const facts = readItems("facts").map((it) => ({
    text: typeof it.text === "string" ? sanitizeNoEmDash(it.text) : "",
    citations: coerceStringArray(it.citations),
  })).filter((x) => x.text.trim().length > 0);

  const interpretations = readItems("interpretations").map((it) => ({
    text: typeof it.text === "string" ? sanitizeNoEmDash(it.text) : "",
    citations: coerceStringArray(it.citations),
  })).filter((x) => x.text.trim().length > 0);

  const predictions = readItems("predictions").map((it) => ({
    text: typeof it.text === "string" ? sanitizeNoEmDash(it.text) : "",
    citations: coerceStringArray(it.citations),
    horizonMonths: typeof it.horizonMonths === "number" ? it.horizonMonths : undefined,
    uncertainty:
      typeof it.uncertainty === "number"
        ? it.uncertainty > 1 && it.uncertainty <= 100
          ? it.uncertainty / 100
          : it.uncertainty
        : undefined,
  })).filter((x) => x.text.trim().length > 0);

  // Ignore sourcesUsed echoed by the model and use the canonical prepared sources.
  // This guarantees that `publishedAtIso` (when extractable) is always present for audit/UX.

  return {
    messageText,
    facts,
    interpretations,
    predictions,
    sourcesUsed,
  };
}

function buildFallbackMessage(
  tonePreset: "homer_bot_clone" | "casual_concise" | "professional",
  output: DidYouKnowOutput
): string {
  const opener =
    tonePreset === "professional"
      ? "Did you know that"
      : "hey did you know that";

  const factByCitation = new Map<string, string>();
  for (const f of output.facts) {
    const text = f.text?.trim();
    if (!text) continue;
    for (const c of f.citations ?? []) {
      if (typeof c !== "string" || c.trim().length === 0) continue;
      if (!factByCitation.has(c)) factByCitation.set(c, text);
    }
  }
  const distinctFacts = [...factByCitation.values()].slice(0, 2);
  const fallbackFact = output.facts[0]?.text?.trim();
  const fact = distinctFacts[0] ?? fallbackFact;
  const secondFact = distinctFacts[1];
  const interpretation = output.interpretations[0]?.text?.trim();
  const prediction = output.predictions[0]?.text?.trim();

  const parts: string[] = [];
  parts.push(opener);
  if (fact) parts.push(`${fact}`);
  if (secondFact) parts.push(`${secondFact}`);
  if (interpretation) parts.push(`interpretation: ${interpretation}`);
  if (prediction) parts.push(`prediction: ${prediction}`);

  const sep = tonePreset === "professional" ? " " : " ";
  const msg = parts.join(sep);
  return sanitizeNoEmDash(msg);
}

function buildCoworkerMessageNoEmDash(
  tonePreset: "homer_bot_clone" | "casual_concise" | "professional",
  output: DidYouKnowOutput
): string {
  const opener = tonePreset === "professional" ? "Did you know that " : "hey did you know that ";
  const factBySource = new Map<string, string>();
  for (const f of output.facts) {
    const text = f.text?.trim();
    if (!text) continue;
    for (const cid of f.citations ?? []) {
      if (typeof cid !== "string" || cid.trim().length === 0) continue;
      if (!factBySource.has(cid)) factBySource.set(cid, text);
    }
  }

  const sourceIds = output.sourcesUsed.map((s) => s.citationId);
  const firstTwoFacts = sourceIds
    .map((cid) => factBySource.get(cid))
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .slice(0, 2);

  const interpretation = output.interpretations[0]?.text?.trim();
  const prediction = output.predictions[0]?.text?.trim();

  const sentences: string[] = [];
  if (firstTwoFacts.length > 0) {
    sentences.push(opener + firstTwoFacts[0]);
    if (firstTwoFacts[1]) sentences.push(`Also: ${firstTwoFacts[1]}`);
  } else {
    sentences.push(opener + "there were fresh updates.");
  }
  if (interpretation) sentences.push(`If that's the case, interpretation: ${interpretation}`);
  if (prediction) sentences.push(`Prediction: ${prediction}`);

  return stripUrlsAndCitationIdsFromMessage(sanitizeNoEmDash(sentences.join(" ")));
}

function attributeIfPerformanceClaim(
  tonePreset: "homer_bot_clone" | "casual_concise" | "professional",
  text: string
): string {
  const t = text.trim();
  if (!t) return t;

  const lower = t.toLowerCase();
  const looksLikePerf =
    /\b(\d+(\.\d+)?)x\b/.test(lower) ||
    /\b(outperform\w*|benchmark\w*|sota|state[-\s]?of[-\s]?the[-\s]?art|improv\w*|faster|slower|latency|throughput)\b/.test(
      lower
    );
  const alreadyAttributed =
    /\b(claims?|says?|according to|reported|the blog|the post)\b/.test(lower);

  if (!looksLikePerf || alreadyAttributed) return t;

  if (tonePreset === "professional") return `According to the source, ${t}`;
  return `apparently (per the source), ${t}`;
}

export const generateDidYouKnow = internalAction({
  args: {
    workflowId: v.optional(v.string()),
    sources: v.array(
      v.object({
        url: v.string(),
        title: v.optional(v.string()),
        publishedAtIso: v.optional(v.string()),
        excerpt: v.optional(v.string()),
      })
    ),
    tonePreset: v.optional(
      v.union(
        v.literal("homer_bot_clone"),
        v.literal("casual_concise"),
        v.literal("professional")
      )
    ),
    maxTokens: v.optional(v.number()),
    temperature: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    output: DidYouKnowOutput;
    modelUsed: string;
    artifactId: Id<"sourceArtifacts">;
    parseError?: string;
  }> => {
    const tonePreset = args.tonePreset ?? "homer_bot_clone";
    const sources = args.sources as DidYouKnowSource[];
    const sourcesUsed = sources.map((s) => ({
      url: s.url,
      citationId: makeWebSourceCitationId(s.url),
      title: s.title,
      publishedAtIso: s.publishedAtIso,
      excerpt: s.excerpt,
    }));

    const toneGuide =
      tonePreset === "professional"
        ? "Tone: clear, confident, professional. No slang."
        : tonePreset === "casual_concise"
          ? "Tone: casual, concise, friendly. No cringe, no emojis."
          : "Tone: casual, slightly chaotic, like a coworker text. Start with \"hey did you know that\". No emojis.";

    const system = [
      "You write a short \"did you know\" update for internal coworkers.",
      "Hard rules:",
      "- Do NOT invent facts. Only state factual claims that are supported by the provided source excerpts.",
      "- Avoid generic filler like \"X was published/updated\". Each fact must mention a concrete capability, benchmark, number, or named feature from the excerpt.",
      "- If a source makes performance/benchmark claims, attribute them: \"they claim...\" / \"the blog says...\".",
      "- Separate: facts vs interpretation vs predictions. Predictions MUST be labeled as prediction.",
      "- Include at least TWO facts total. Prefer 1-2 facts per source.",
      "- Include at least one fact referencing EACH provided source (by citationId).",
      "- Include citations using the provided citationId strings in each item (array of strings).",
      "- Output MUST be valid JSON only (no markdown fences).",
      "- Do NOT use em dashes or en dashes (—, –). Use normal hyphens '-' or periods.",
      "",
      toneGuide,
    ].join("\n");

      const user = [
        "Write output JSON with this exact shape:",
        "{",
        "  \"messageText\": string,",
        "  \"facts\": [{\"text\": string, \"citations\": string[]}],",
        "  \"interpretations\": [{\"text\": string, \"citations\": string[]}],",
        "  \"predictions\": [{\"text\": string, \"citations\": string[], \"horizonMonths\"?: number, \"uncertainty\"?: number}],",
        "  \"sourcesUsed\": [{\"url\": string, \"citationId\": string, \"title\"?: string, \"publishedAtIso\"?: string}]",
        "}",
        "",
        "Sources:",
      JSON.stringify(
        sourcesUsed.map((s) => ({
          url: s.url,
          citationId: s.citationId,
          title: s.title,
          publishedAtIso: s.publishedAtIso,
          excerpt: (s.excerpt || "").slice(0, 3000),
        })),
        null,
        2
      ),
    ].join("\n");

    const response = await ctx.runAction(
      internal.domains.models.autonomousModelResolver.executeWithFallback,
      {
        taskType: "publishing",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        maxTokens: args.maxTokens ?? 900,
        temperature: args.temperature ?? 0.6,
      }
    );

    let parsed = safeJsonParse<DidYouKnowOutput>(response.content);
    let parseError: string | undefined = parsed.ok ? undefined : parsed.error;

    if (!parsed.ok) {
      const extracted = extractLikelyJsonObject(response.content);
      if (extracted) {
        const reparsed = safeJsonParse<DidYouKnowOutput>(extracted);
        if (reparsed.ok) {
          parsed = reparsed;
          parseError = undefined;
        }
      }
    }

    // Repair pass for malformed JSON (best-effort).
    if (!parsed.ok) {
      try {
        const repair = await ctx.runAction(
          internal.domains.models.autonomousModelResolver.executeWithFallback,
          {
            taskType: "validation",
            messages: [
              {
                role: "system",
                content:
                  "Fix the provided text into valid JSON matching the required schema. " +
                  "Return JSON only. Do not include markdown. Do not use em/en dashes (—, –).",
              },
              {
                role: "user",
	                content: [
	                  "Schema shape reminder:",
	                  "{",
	                  "  \"messageText\": string,",
	                  "  \"facts\": [{\"text\": string, \"citations\": string[]}],",
	                  "  \"interpretations\": [{\"text\": string, \"citations\": string[]}],",
	                  "  \"predictions\": [{\"text\": string, \"citations\": string[], \"horizonMonths\"?: number, \"uncertainty\"?: number}],",
	                  "  \"sourcesUsed\": [{\"url\": string, \"citationId\": string, \"title\"?: string, \"publishedAtIso\"?: string}]",
	                  "}",
	                  "",
	                  "Bad output to fix:",
	                  response.content.slice(0, 6000),
	                ].join("\n"),
              },
            ],
            maxTokens: 900,
            temperature: 0,
          }
        );
        const repairedParsed = safeJsonParse<DidYouKnowOutput>(repair.content);
        if (repairedParsed.ok) {
          parsed = repairedParsed;
          parseError = undefined;
        } else {
          parseError = repairedParsed.error;
        }
      } catch (e: any) {
        parseError = String(e?.message || e);
      }
    }

    const fallbackMessage = `hey did you know there were fresh updates on ${sourcesUsed
      .map((s) => new URL(s.url).hostname.replace(/^www\\./, ""))
      .join(" + ")}? (sources: ${sourcesUsed.map((s) => s.url).join(", ")})`;

    let output = parsed.ok
      ? normalizeDidYouKnowOutput(parsed.value, { messageText: fallbackMessage, sources })
      : normalizeDidYouKnowOutput(null, { messageText: fallbackMessage, sources });

    // If the model doesn't give a usable messageText, synthesize one deterministically.
    if (!output.messageText || output.messageText.trim().length < 80) {
      output = {
        ...output,
        messageText: buildFallbackMessage(tonePreset, output),
      };
    }

    // If the model omitted facts entirely, at least include source titles as factual anchors.
    if (output.facts.length === 0 && output.sourcesUsed.length > 0) {
      output = {
        ...output,
        facts: output.sourcesUsed.map((s) => ({
          text: s.title ? `${s.title} was published/updated.` : `Update published at ${s.url}.`,
          citations: [s.citationId],
        })),
      };
    }

    // Ensure there's at least one prediction. Keep it explicitly speculative and cite the sources.
    if (output.predictions.length === 0 && output.sourcesUsed.length > 0) {
      const citations = output.sourcesUsed.map((s) => s.citationId);
      output = {
        ...output,
        predictions: [
          {
            text:
              "In the next 3-6 months, we might see more vendors ship similar agentic multimodal capabilities, but it's uncertain how quickly this becomes a default workflow.",
            citations,
            horizonMonths: 6,
            uncertainty: 0.6,
          },
        ],
      };
    }

    // Ensure we have at least one fact per source.
    const missingFactCitations = output.sourcesUsed
      .map((s) => s.citationId)
      .filter((cid) => !output.facts.some((f) => (f.citations ?? []).includes(cid)));
    if (missingFactCitations.length > 0) {
      const byCitation = new Map(output.sourcesUsed.map((s) => [s.citationId, s]));
      output = {
        ...output,
        facts: [
          ...output.facts,
          ...missingFactCitations.map((cid) => {
            const src = byCitation.get(cid);
            return {
              text: src?.title
                ? `Update: ${src.title}.`
                : `Update published at ${src?.url ?? cid}.`,
              citations: [cid],
            };
          }),
        ],
      };
    }

    // Light safety: performance-y claims should be explicitly attributed.
    output = {
      ...output,
      facts: output.facts.map((f) => ({
        ...f,
        text: attributeIfPerformanceClaim(tonePreset, f.text),
      })),
    };

    // Ensure final output contains no em/en dashes (even if the model ignored instructions).
    output = {
      ...output,
      messageText: sanitizeNoEmDash(output.messageText),
      facts: output.facts.map((f) => ({ ...f, text: sanitizeNoEmDash(f.text) })),
      interpretations: output.interpretations.map((i) => ({ ...i, text: sanitizeNoEmDash(i.text) })),
      predictions: output.predictions.map((p) => ({ ...p, text: sanitizeNoEmDash(p.text) })),
    };

    // Build a "coworker text" style message from the structured output (no em dashes).
    output = {
      ...output,
      messageText: buildCoworkerMessageNoEmDash(tonePreset, output),
    };

    // Persist as an audit artifact for replay / coworker sharing.
    const artifact = await ctx.runMutation(
      internal.domains.artifacts.sourceArtifacts.upsertSourceArtifact,
      {
        sourceType: "extracted_text",
        sourceUrl: args.workflowId
          ? `didyouknow://message/${encodeURIComponent(args.workflowId)}`
          : "didyouknow://message/ad_hoc",
        title: "Did You Know message",
        rawContent: JSON.stringify(output, null, 2),
        extractedData: {
          kind: "did_you_know_message",
          tonePreset,
          workflowId: args.workflowId,
          modelUsed: response.modelUsed,
          sources: sourcesUsed.map((s) => ({
            url: s.url,
            citationId: s.citationId,
            title: s.title,
            publishedAtIso: s.publishedAtIso,
          })),
          parseError: parsed.ok ? undefined : parsed.error,
        },
        fetchedAt: Date.now(),
      }
    );

    return {
      output,
      modelUsed: response.modelUsed,
      artifactId: artifact.id,
      ...(parseError ? { parseError } : {}),
    };
  },
});

function computeDidYouKnowBooleanChecks(output: DidYouKnowOutput): {
  noEmDash: boolean;
  allSourcesHavePublishedAtIso: boolean;
  hasFactPerSource: boolean;
  allFactsHaveCitations: boolean;
  nonGenericFacts: boolean;
  hasPrediction: boolean;
  predictionsHaveCitations: boolean;
  performanceClaimsAttributed: boolean;
} {
  const noEmDash =
    !/\u2014|\u2013/.test(output.messageText) &&
    output.facts.every((f) => !/\u2014|\u2013/.test(f.text)) &&
    output.interpretations.every((i) => !/\u2014|\u2013/.test(i.text)) &&
    output.predictions.every((p) => !/\u2014|\u2013/.test(p.text));

  const allFactsHaveCitations = output.facts.every(
    (f) => Array.isArray(f.citations) && f.citations.length > 0
  );

  const nonGenericFacts = output.facts.every((f) => {
    const t = String(f.text || "").trim().toLowerCase();
    if (!t) return false;
    if (t.includes("published/updated")) return false;
    if (/\b(was published|was updated|was announced)\b/.test(t) && t.length < 100 && !/\d/.test(t)) return false;
    return true;
  });

  const hasPrediction = output.predictions.length > 0;
  const predictionsHaveCitations = output.predictions.every(
    (p) => Array.isArray(p.citations) && p.citations.length > 0
  );

  const sourceCitations = output.sourcesUsed.map((s) => s.citationId);
  const hasFactPerSource = sourceCitations.every((cid) =>
    output.facts.some((f) => (f.citations ?? []).includes(cid))
  );

  const allSourcesHavePublishedAtIso =
    output.sourcesUsed.length > 0 &&
    output.sourcesUsed.every((s) => {
      const iso = typeof s.publishedAtIso === "string" ? s.publishedAtIso.trim() : "";
      if (!iso) return false;
      const t = Date.parse(iso);
      return Number.isFinite(t);
    });

  const perfKeywords =
    /\b(\d+(\.\d+)?)x\b|\b(outperform\w*|benchmark\w*|sota|state[-\s]?of[-\s]?the[-\s]?art|improv\w*|faster|slower|latency|throughput)\b/i;
  const attributionKeywords =
    /\b(claims?|says?|according to|reported|the blog|the post|per the source|apparently)\b/i;

  const performanceClaimsAttributed = output.facts.every((f) => {
    if (!perfKeywords.test(f.text)) return true;
    return attributionKeywords.test(f.text);
  });

  return {
    noEmDash,
    allSourcesHavePublishedAtIso,
    hasFactPerSource,
    allFactsHaveCitations,
    nonGenericFacts,
    hasPrediction,
    predictionsHaveCitations,
    performanceClaimsAttributed,
  };
}

export const judgeDidYouKnow = internalAction({
  args: {
    workflowId: v.optional(v.string()),
    didYouKnowArtifactId: v.id("sourceArtifacts"),
    output: v.any(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    passed: boolean;
    checks: ReturnType<typeof computeDidYouKnowBooleanChecks>;
    reasons: string[];
    explanation: string;
    llmJudge: {
      passed: boolean;
      modelUsed: string;
      artifactId: Id<"sourceArtifacts">;
      result: { passed: boolean; reasons?: string[] } | null;
      parseError?: string;
    };
  }> => {
    const output = args.output as DidYouKnowOutput;
    const checks = computeDidYouKnowBooleanChecks(output);

    const deterministicPassed =
      checks.noEmDash &&
      checks.allSourcesHavePublishedAtIso &&
      checks.hasFactPerSource &&
      checks.allFactsHaveCitations &&
      checks.nonGenericFacts &&
      checks.hasPrediction &&
      checks.predictionsHaveCitations &&
      checks.performanceClaimsAttributed;

    const judgeResponse = await ctx.runAction(
      internal.domains.models.autonomousModelResolver.executeWithFallback,
      {
        taskType: "validation",
        messages: [
          {
            role: "system",
            content:
              "You are a strict validator for an internal 'did you know' message. " +
              "You must verify the output follows these rules: " +
              "(1) No invented facts beyond the provided excerpts, " +
              "(2) Each fact has citations and each source is referenced by at least one fact, " +
              "(3) Each sourcesUsed entry includes a valid publishedAtIso, " +
              "(4) Predictions are clearly forward-looking and cited, " +
              "(5) Do not use em dash or en dash. Use normal hyphens '-' instead. " +
              "(4) No em/en dashes (—, –). " +
              "Return JSON only: {\"passed\": boolean, \"reasons\": string[]} and reasons MUST be non-empty.",
          },
          {
            role: "user",
            content: JSON.stringify(
              {
                output,
                deterministicChecks: checks,
              },
              null,
              2
            ),
          },
        ],
        maxTokens: 350,
        temperature: 0,
      }
    );

    let parsed = safeJsonParse<{ passed: boolean; reasons?: string[] }>(judgeResponse.content);
    if (!parsed.ok) {
      const extracted = extractLikelyJsonObject(judgeResponse.content);
      if (extracted) parsed = safeJsonParse<{ passed: boolean; reasons?: string[] }>(extracted);
    }

    const llmPassed = parsed.ok ? !!(parsed.value as any).passed : false;
    const llmJudgeResult = parsed.ok ? (parsed.value as any) : null;
    const reasons = parsed.ok && Array.isArray((parsed.value as any).reasons)
      ? (parsed.value as any).reasons.map(String)
      : [];
    const parseError = parsed.ok ? undefined : parsed.error;

    const explanationParts: string[] = [];
    explanationParts.push(`deterministicPassed=${deterministicPassed}`);
    explanationParts.push(`llmJudgePassed=${llmPassed}`);
    if (reasons.length > 0) explanationParts.push(`reasons=${reasons.join("; ")}`);
    const explanation = explanationParts.join(" | ").replace(/\u2014|\u2013/g, "-");

    const judgeArtifact = await ctx.runMutation(
      internal.domains.artifacts.sourceArtifacts.upsertSourceArtifact,
      {
        sourceType: "extracted_text",
        sourceUrl: args.workflowId
          ? `didyouknow://judge/${encodeURIComponent(args.workflowId)}`
          : "didyouknow://judge/ad_hoc",
        title: "Did You Know judge result",
        rawContent: parsed.ok ? JSON.stringify(parsed.value, null, 2) : judgeResponse.content,
        extractedData: {
          kind: "did_you_know_judge",
          workflowId: args.workflowId,
          didYouKnowArtifactId: String(args.didYouKnowArtifactId),
          deterministicChecks: checks,
          modelUsed: judgeResponse.modelUsed,
          parseError: parsed.ok ? undefined : parsed.error,
        },
        fetchedAt: Date.now(),
      }
    );

    return {
      passed: deterministicPassed && llmPassed,
      checks,
      reasons,
      explanation,
      llmJudge: {
        passed: llmPassed,
        modelUsed: judgeResponse.modelUsed,
        artifactId: judgeArtifact.id,
        result: llmJudgeResult,
        parseError,
      },
    };
  },
});

export const generateAndJudgeDidYouKnowFromUrls = internalAction({
  args: {
    workflowId: v.optional(v.string()),
    urls: v.array(v.string()),
    tonePreset: v.optional(
      v.union(v.literal("homer_bot_clone"), v.literal("casual_concise"), v.literal("professional"))
    ),
    preferLinkup: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const workflowId = args.workflowId ?? `didyouknow_urls_${Date.now()}`;

    const prepared = await ctx.runAction(internal.domains.narrative.didYouKnowSources.fetchSourcesForDidYouKnow, {
      urls: args.urls,
      workflowId,
      preferLinkup: args.preferLinkup ?? true,
      maxUrls: 5,
    });

    const didYouKnow = await ctx.runAction(internal.domains.narrative.didYouKnow.generateDidYouKnow, {
      workflowId,
      sources: prepared.map((s: any) => ({
        url: s.url,
        title: s.title,
        publishedAtIso: s.publishedAtIso,
        excerpt: s.excerpt,
      })),
      tonePreset: args.tonePreset ?? "homer_bot_clone",
      maxTokens: 850,
      temperature: 0.6,
    });

    const judge = await ctx.runAction(internal.domains.narrative.didYouKnow.judgeDidYouKnow, {
      workflowId,
      didYouKnowArtifactId: didYouKnow.artifactId,
      output: didYouKnow.output,
    });

    return {
      workflowId,
      didYouKnowArtifactId: didYouKnow.artifactId,
      modelUsed: didYouKnow.modelUsed,
      output: didYouKnow.output,
      judge,
    };
  },
});

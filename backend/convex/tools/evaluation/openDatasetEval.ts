"use node";

/**
 * Open-source dataset end-to-end evaluation (ground-truth).
 *
 * This is intentionally "live" (runs the agent stack via sendMessageInternal),
 * but uses an open dataset (SQuAD v1.1) as ground truth so results are reproducible.
 *
 * Pipeline exercised:
 * - store context as `sourceArtifacts`
 * - index into `artifactChunks`
 * - agent retrieves via `retrieveArtifact`
 * - response includes resolvable `{{cite:artifactId:chunkId}}` anchors
 */

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

type SquadV11 = {
  data: Array<{
    title: string;
    paragraphs: Array<{
      context: string;
      qas: Array<{
        id: string;
        question: string;
        answers: Array<{ text: string; answer_start: number }>;
      }>;
    }>;
  }>;
};

type EvalCase = {
  id: string;
  title: string;
  question: string;
  context: string;
  answers: string[];
  sourceUrl: string;
};

function getByteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

function normalizeSquadAnswer(s: string): string {
  const lower = (s ?? "").toLowerCase();
  const noPunct = lower.replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, " ");
  const noArticles = noPunct.replace(/\b(a|an|the)\b/g, " ");
  return noArticles.replace(/\s+/g, " ").trim();
}

function answerMatches(predictedNorm: string, expectedNorm: string): boolean {
  if (!predictedNorm || !expectedNorm) return false;
  if (predictedNorm === expectedNorm) return true;
  // Allow small format variance (e.g., extra leading words) while staying grounded.
  if (predictedNorm.includes(expectedNorm)) return true;
  if (expectedNorm.includes(predictedNorm)) return true;
  return false;
}

function extractShortAnswer(response: string): string {
  const text = (response ?? "").trim();
  if (!text) return "";

  // Prefer explicit "ANSWER:" line if present.
  const answerLine = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /^answer\s*:/i.test(l));

  const raw = answerLine ? answerLine.replace(/^answer\s*:\s*/i, "") : text.split("\n")[0] ?? text;

  // Remove citation anchors.
  return raw.replace(/\{\{cite:[^}]+\}\}/g, "").trim();
}

function extractCitationAnchors(response: string): Array<{ artifactId: string; chunkId: string; anchor: string }> {
  const text = response ?? "";
  const matches = text.matchAll(/\{\{cite:([^:}]+):([^}]+)\}\}/g);
  const out: Array<{ artifactId: string; chunkId: string; anchor: string }> = [];
  for (const m of matches) {
    const artifactId = String(m[1] ?? "");
    const chunkId = String(m[2] ?? "");
    const anchor = String(m[0] ?? "");
    if (artifactId && chunkId) out.push({ artifactId, chunkId, anchor });
  }
  return out;
}

function sampleSquadCases(dataset: SquadV11, count: number): EvalCase[] {
  const out: EvalCase[] = [];
  const url = "https://rajpurkar.github.io/SQuAD-explorer/dataset/dev-v1.1.json";

  for (const entry of dataset.data) {
    for (const para of entry.paragraphs) {
      for (const qa of para.qas) {
        const answers = (qa.answers ?? []).map((a) => String(a.text ?? "")).filter((t) => t.trim().length > 0);
        if (answers.length === 0) continue;
        out.push({
          id: qa.id,
          title: entry.title,
          question: qa.question,
          context: para.context,
          answers,
          sourceUrl: `${url}#${encodeURIComponent(qa.id)}`,
        });
        if (out.length >= count) return out;
      }
    }
  }
  return out;
}

export const runSQuADV11OpenSourceEval = action({
  args: {
    count: v.optional(v.number()),
    useCoordinator: v.optional(v.boolean()),
    perQuestionBudgetTokens: v.optional(v.number()),
  },
  returns: v.object({
    dataset: v.string(),
    total: v.number(),
    passed: v.number(),
    score100: v.number(),
    averageLatencyMs: v.number(),
    failures: v.array(
      v.object({
        id: v.string(),
        question: v.string(),
        expectedAnswers: v.array(v.string()),
        predicted: v.string(),
        citationsFound: v.number(),
        citationsResolved: v.number(),
        toolsCalled: v.array(v.string()),
        error: v.optional(v.string()),
      })
    ),
  }),
  handler: async (ctx, args) => {
    const count = Math.max(1, Math.min(args.count ?? 3, 10));
    const perQuestionBudgetTokens = Math.max(300, Math.min(args.perQuestionBudgetTokens ?? 1800, 8000));

    // Fetch open dataset (no auth).
    const datasetUrl = "https://rajpurkar.github.io/SQuAD-explorer/dataset/dev-v1.1.json";
    const res = await fetch(datasetUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch SQuAD v1.1 dev: ${res.status} ${res.statusText}`);
    }
    const dataset = (await res.json()) as SquadV11;
    const cases = sampleSquadCases(dataset, count);
    if (cases.length === 0) throw new Error("No SQuAD cases found in dataset parse");

    let passed = 0;
    let totalLatency = 0;
    const failures: Array<{
      id: string;
      question: string;
      expectedAnswers: string[];
      predicted: string;
      citationsFound: number;
      citationsResolved: number;
      toolsCalled: string[];
      error?: string;
    }> = [];

    for (const tc of cases) {
      const start = Date.now();

      // Persist context as an artifact (provenance is the dataset URL + QA id).
      const sizeBytes = getByteLength(tc.context);
      const artifact = await ctx.runMutation(internal.domains.artifacts.sourceArtifacts.upsertSourceArtifact, {
        sourceType: "url_fetch",
        sourceUrl: tc.sourceUrl,
        rawContent: tc.context,
        mimeType: "text/plain",
        sizeBytes,
        title: `SQuAD v1.1: ${tc.title} (${tc.id})`,
        fetchedAt: Date.now(),
        extractedData: {
          dataset: "SQuAD v1.1 dev",
          qaId: tc.id,
          title: tc.title,
        },
      });

      // Index for chunk-level citations (deterministic chunk IDs).
      await ctx.runAction(internal.domains.artifacts.evidenceIndexActions.indexArtifact, {
        artifactId: artifact.id,
      });

      const evalPrompt = [
        "Grounded QA task (open-source dataset).",
        `SOURCE [accessed ${new Date().toISOString().slice(0, 10)}]: ${tc.sourceUrl}`,
        "",
        "You MUST answer using ONLY the provided artifact context.",
        "You MUST call the `retrieveArtifact` tool at least once using the artifactId below.",
        "You MUST include at least 1 citation anchor from the tool output in your final answer.",
        "",
        `artifactId: ${artifact.id}`,
        `queryBudget: ${perQuestionBudgetTokens} tokens`,
        "",
        `Question: ${tc.question}`,
        "",
        "Output format (strict):",
        "ANSWER: <short answer only>",
        "CITATIONS: <one or more {{cite:artifactId:chunkId}} anchors>",
        "SOURCE: <repeat the SOURCE line with accessed date>",
      ].join("\n");

      let responseText = "";
      let toolsCalled: string[] = [];
      let citationsFound = 0;
      let citationsResolved = 0;

      try {
        const agentResult = await ctx.runAction(internal.domains.agents.fastAgentPanelStreaming.sendMessageInternal, {
          message: evalPrompt,
          useCoordinator: args.useCoordinator ?? true,
        });

        responseText = agentResult.response ?? "";
        toolsCalled = agentResult.toolsCalled ?? [];

        // Score answer (normalized exact match against any ground-truth answer).
        const predicted = extractShortAnswer(responseText);
        const predictedNorm = normalizeSquadAnswer(predicted);
        const expectedNorms = tc.answers.map(normalizeSquadAnswer);
        const answerOk = expectedNorms.some((a) => answerMatches(predictedNorm, a));

        // Score citations (must exist and resolve).
        const citations = extractCitationAnchors(responseText);
        const citationsForArtifact = citations.filter((c) => c.artifactId === String(artifact.id));
        citationsFound = citationsForArtifact.length;

        for (const c of citationsForArtifact) {
          const chunk = await ctx.runQuery(internal.domains.artifacts.evidenceSearch.getEvidenceChunkById, {
            chunkId: c.chunkId as Id<"artifactChunks">,
          });
          if (chunk && String(chunk.artifactId) === c.artifactId) {
            citationsResolved++;
          }
        }

        const usedRetrieveArtifact = toolsCalled.includes("retrieveArtifact");
        const citationsOk = citationsFound > 0 && citationsResolved === citationsFound;

        const ok = answerOk && usedRetrieveArtifact && citationsOk;
        if (ok) {
          passed++;
        } else {
          failures.push({
            id: tc.id,
            question: tc.question,
            expectedAnswers: tc.answers.slice(0, 3),
            predicted,
            citationsFound,
            citationsResolved,
            toolsCalled,
            error: [
              !answerOk ? "answer_mismatch" : null,
              !usedRetrieveArtifact ? "missing_tool:retrieveArtifact" : null,
              !citationsOk ? "citations_unresolved" : null,
            ]
              .filter(Boolean)
              .join(", "),
          });
        }
      } catch (e) {
        failures.push({
          id: tc.id,
          question: tc.question,
          expectedAnswers: tc.answers.slice(0, 3),
          predicted: extractShortAnswer(responseText),
          citationsFound,
          citationsResolved,
          toolsCalled,
          error: e instanceof Error ? e.message : String(e),
        });
      } finally {
        totalLatency += Date.now() - start;
      }
    }

    const total = cases.length;
    const score100 = Math.round((passed / Math.max(1, total)) * 100);
    const averageLatencyMs = Math.round(totalLatency / Math.max(1, total));

    return {
      dataset: "SQuAD v1.1 dev",
      total,
      passed,
      score100,
      averageLatencyMs,
      failures,
    };
  },
});

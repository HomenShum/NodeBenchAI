// convex/domains/ai/metadataAnalyzer.ts
"use node";

import { v } from "convex/values";
import { action, internalAction } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../../_generated/dataModel";
import { GoogleGenAI, createUserContent } from "@google/genai";
import { getLlmModel } from "../../../shared/llm/modelCatalog";

// Shared constants
const METADATA_HEADING = "\uD83D\uDCCA Metadata (Auto-Generated)";
const MAX_ASSETS = 20;
const MAX_TEXT_CHARS = 4000; // cap to avoid excessive tokens


// Utility: clamp text size
function clamp(text: string | undefined, max = MAX_TEXT_CHARS): string {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "\n…" : text;
}


// INTERNAL: Build dossier-level metadata (lightweight, no per-asset Gemini calls)
export const buildDossierMetadata = action({
  args: { dossierId: v.id("documents"), testBypassUserId: v.optional(v.union(v.id("users"), v.string())) },
  returns: v.object({
    success: v.boolean(),
    quickNotesId: v.optional(v.id("documents")),
    addedLines: v.optional(v.number()),
    error: v.optional(v.string()),
    judge: v.object({
      passSpeed: v.boolean(),
      passCompleteness: v.boolean(),
      passUsefulness: v.boolean(),
      overallPass: v.boolean(),
    }),
  }),
  handler: async (ctx, { dossierId, testBypassUserId }) => {
    const t0 = Date.now();
    const userId = testBypassUserId || await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const dossier = await ctx.runQuery(api.domains.documents.documents.getById, { documentId: dossierId, userId });
    if (!dossier || dossier.documentType !== "dossier" || dossier.dossierType !== "primary") {
      throw new Error("buildDossierMetadata requires a primary dossier document");
    }

    // 1) Get or create Quick Notes doc
    const quickNotes: any = await ctx.runMutation(api.domains.documents.documents.getOrCreateQuickNotes, { dossierId, userId });

    // If quick notes not available (e.g., public dossier without edit permissions), skip metadata generation
    if (!quickNotes) {
      return { success: false, error: "Quick notes not available for this dossier", judge: { passSpeed: true, passCompleteness: false, passUsefulness: false, overallPass: false } };
    }

    // 2) Collect quick-notes user text (keep small)
    const qnNodes = await ctx.runQuery(api.domains.knowledge.nodes.by_document, { docId: quickNotes._id });
    const userNotesConcat = clamp(qnNodes.map((n: any) => n.text || "").filter(Boolean).join("\n"), 2000);

    // 3) Collect lightweight asset info (title/desc/url) without per-file analysis
    const assets: any[] = await ctx.runQuery(api.domains.documents.documents.getLinkedAssets, { dossierId });

    const assetSummaries: string[] = assets.slice(0, MAX_ASSETS).map((a: any) => {
      const meta = a.assetMetadata?.metadata || {};
      const title = meta.title || a.title || "Untitled";
      const desc = meta.description ? String(meta.description).slice(0, 200) : "";
      const url = a.assetMetadata?.sourceUrl || meta.url || "";
      return `• ${title}${desc ? ` — ${desc}` : ""}${url ? `\n  URL: ${url}` : ""}`;
    });

    // 4) Include recent agent outputs if available (minimal)
    const agentNotes: string[] = [];

    // 5) Summarize with Gemini (single lightweight call)
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) throw new Error("Gemini API key not configured");
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `Create a concise dossier metadata summary. DO NOT analyze each linked asset; only reference titles/descriptions/URLs. Sections to include: 1) User Notes (if any); 2) Agent Insights (if any); 3) Assets (titles/descriptions/URLs). Keep it brief and scannable.`;

    const contents = createUserContent([
      { text: `Dossier: ${dossier.title}` },
      { text: `User Notes (truncated):\n${userNotesConcat}` },
      { text: agentNotes.length ? `Agent Insights (latest):\n${agentNotes.join("\n\n")}` : "" },
      { text: assetSummaries.length ? `Assets:\n${assetSummaries.join("\n")}` : "Assets: none" },
      { text: prompt },
    ]);

    const response = await ai.models.generateContent({ model: getLlmModel("analysis", "gemini"), contents });
    const summary = clamp(response.text || "", 2000);

    // 6) Upsert metadata section at the top of Quick Notes
    const lines: string[] = [];
    if (summary) lines.push(summary);
    if (assetSummaries.length) {
      lines.push("\nAssets (titles & URLs only):");
      lines.push(...assetSummaries);
    }

    await ctx.runMutation(internal.domains.knowledge.nodes.upsertMetadataSection, { documentId: quickNotes._id, contentLines: lines, authorId: userId });

    const durMs = Date.now() - t0;
    const passSpeed = durMs < 7000; // <7s for lightweight dossier summary
    const passCompleteness: boolean = !!summary && (assetSummaries.length > 0 || userNotesConcat.length > 0 || agentNotes.length > 0);
    const passUsefulness = (summary?.length || 0) >= 120; // at least a short paragraph
    const overallPass = passSpeed && passCompleteness && passUsefulness;

    return { success: true, quickNotesId: quickNotes._id, addedLines: lines.length, judge: { passSpeed, passCompleteness, passUsefulness, overallPass } };
  },
});

// PUBLIC: Analyze a single non-dossier document into a top metadata section
export const analyzeDocumentMetadata = action({
  args: { documentId: v.id("documents"), force: v.optional(v.boolean()), testBypassUserId: v.optional(v.union(v.id("users"), v.string())) },
  returns: v.object({
    success: v.boolean(),
    reused: v.optional(v.boolean()),
    judge: v.object({
      passSpeed: v.boolean(),
      passCompleteness: v.boolean(),
      passUsefulness: v.boolean(),
      overallPass: v.boolean(),
    }),
  }),
  handler: async (ctx, { documentId, force, testBypassUserId }) => {
    const t0 = Date.now();
    const userId = testBypassUserId || await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const doc: any = await ctx.runQuery(api.domains.documents.documents.getById, { documentId, userId });
    if (!doc) throw new Error("Document not found");

    // For file documents, call our file analysis action
    if (doc.documentType === "file" && doc.fileId) {
      if (!force) {
        // If file already has analysis, reuse it to avoid token spend
        const file: any = await ctx.runQuery(internal.domains.documents.files.getFile, { fileId: doc.fileId });
        if (file?.analysis) {
          await ctx.runMutation(internal.domains.knowledge.nodes.upsertMetadataSection, { documentId, contentLines: [clamp(file.analysis, 2000)] });
          const durMs = Date.now() - t0;
          const passSpeed = durMs < 5000;
          const passCompleteness: boolean = (file.analysis || '').length > 80;
          const passUsefulness = passCompleteness;
          return { success: true, reused: true, judge: { passSpeed, passCompleteness, passUsefulness, overallPass: passSpeed && passCompleteness && passUsefulness } };
        }
      }
      // Run Gemini analysis via our endpoint
      const result: any = await ctx.runAction(api.domains.documents.fileAnalysis.analyzeFileWithGenAI, {
        fileId: doc.fileId,
        analysisPrompt: "Provide a concise summary capturing key content, entities, and actionable insights.",
        analysisType: doc.fileType || undefined,
        testBypassUserId: userId,
      });
      await ctx.runMutation(internal.domains.knowledge.nodes.upsertMetadataSection, { documentId, contentLines: [clamp(result.analysis, 2000)], authorId: userId });
      const durMs = Date.now() - t0;
      const passSpeed = durMs < 12000;
      const passCompleteness = (result.analysis || '').length > 80;
      const passUsefulness = passCompleteness;
      return { success: true, reused: false, judge: { passSpeed, passCompleteness, passUsefulness, overallPass: passSpeed && passCompleteness && passUsefulness } };
    }

    // For text/timeline docs: summarize nodes text lightly
    const nodes: any[] = await ctx.runQuery(api.domains.knowledge.nodes.by_document, { docId: documentId });
    const plain = clamp(nodes.map((n: any) => n.text || "").filter(Boolean).join("\n\n"), 4000);

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) throw new Error("Gemini API key not configured");
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: getLlmModel("analysis", "gemini"),
      contents: createUserContent([
        { text: `Document: ${doc.title}` },
        { text: plain },
        { text: "Summarize concisely: key points, entities, and any tasks implied." },
      ]),
    });
    const summary: string = clamp(response.text || "", 2000);
    await ctx.runMutation(internal.domains.knowledge.nodes.upsertMetadataSection, { documentId, contentLines: [summary], authorId: userId });
    const durMs = Date.now() - t0;
    const passSpeed = durMs < 8000;
    const passCompleteness = (summary || '').length > 80;
    const passUsefulness = passCompleteness;
    return { success: true, judge: { passSpeed, passCompleteness, passUsefulness, overallPass: passSpeed && passCompleteness && passUsefulness } };
  },
});

// PUBLIC: Analyze selected files (by documentId) and append results to dossier Quick Notes, parallelized
export const analyzeSelectedFilesIntoDossier = action({
  args: {
    dossierId: v.id("documents"),
    documentIds: v.array(v.id("documents")),
    maxParallel: v.optional(v.number()),
    testBypassUserId: v.optional(v.union(v.id("users"), v.string())),
  },
  returns: v.object({
    success: v.boolean(),
    analyzed: v.number(),
    failed: v.number(),
    error: v.optional(v.string()),
    judge: v.object({
      passSpeed: v.boolean(),
      passCompleteness: v.boolean(),
      passUsefulness: v.boolean(),
      overallPass: v.boolean(),
    }),
  }),
  handler: async (ctx, { dossierId, documentIds, maxParallel, testBypassUserId }) => {
    const t0 = Date.now();
    const userId = testBypassUserId || await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const dossier = await ctx.runQuery(api.domains.documents.documents.getById, { documentId: dossierId, userId });
    if (!dossier || dossier.documentType !== "dossier") throw new Error("Invalid dossierId");

    const quickNotes: any = await ctx.runMutation(api.domains.documents.documents.getOrCreateQuickNotes, { dossierId, userId });

    // If quick notes not available (e.g., public dossier without edit permissions), skip analysis
    if (!quickNotes) {
      return { success: false, analyzed: 0, failed: 0, error: "Quick notes not available for this dossier", judge: { passSpeed: true, passCompleteness: false, passUsefulness: false, overallPass: false } };
    }

    // Map docs → fileIds
    const docs: any[] = await Promise.all(documentIds.map((id: any) => ctx.runQuery(api.domains.documents.documents.getById, { documentId: id, userId })));

    type Item = { documentId: Id<"documents">; fileId: Id<"files">; fileType?: string };
    const items: Item[] = docs
      .filter((d: any) => d && d.documentType === "file" && d.fileId)
      .map((d: any) => ({ documentId: d._id as Id<"documents">, fileId: d.fileId as Id<"files">, fileType: d.fileType }));

    // Concurrency control
    const concurrency = Math.max(1, Math.min(maxParallel ?? 5, 10));
    const queue = [...items];
    const results: { documentId: Id<"documents">; ok: boolean; analysis?: string; error?: string }[] = [];

    async function worker() {
      while (queue.length) {
        const next = queue.shift();
        if (!next) break;
        try {
          const res: any = await ctx.runAction(api.domains.documents.fileAnalysis.analyzeFileWithGenAI, {
            fileId: next.fileId,
            analysisPrompt: "Analyze file for dossier: provide a concise, token-efficient summary with key facts and sources.",
            analysisType: next.fileType || undefined,
            testBypassUserId: userId,
          });
          results.push({ documentId: next.documentId, ok: true, analysis: clamp(res.analysis, 2000) });
        } catch (e: any) {
          results.push({ documentId: next.documentId, ok: false, error: String(e?.message || e) });
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    const lines: string[] = [];
    lines.push("\uD83E\uDDE0 Analyzed Files (user-selected):");
    for (const r of results) {
      const doc = docs.find((d: any) => d?._id === r.documentId);
      const title = doc?.title || String(r.documentId);
      if (r.ok) {
        lines.push(`• ${title}`);
        lines.push(clamp(r.analysis, 800));
      } else {
        lines.push(`• ${title} — ERROR: ${r.error}`);
      }
    }

    await ctx.runMutation(internal.domains.knowledge.nodes.upsertMetadataSection, { documentId: quickNotes._id, contentLines: lines, authorId: userId });

    const durMs = Date.now() - t0;
    const analyzedCount = results.filter(r => r.ok).length;
    const passSpeed: boolean = durMs < Math.max(15000, items.length * 8000);
    const passCompleteness = analyzedCount > 0 && lines.length > 2;
    const passUsefulness = analyzedCount > 0; // at least one useful analysis appended
    const overallPass = passSpeed && passCompleteness && passUsefulness;

    return { success: true, analyzed: analyzedCount, failed: results.filter(r => !r.ok).length, judge: { passSpeed, passCompleteness, passUsefulness, overallPass } };
  },
});

// convex/tools/geminiFileSearch.ts
// Gemini File Search tool for querying uploaded files using Gemini's file search capability
// Enhanced with page-indexed RAG pipeline for document citations

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../../_generated/api";

const description = [
  "Search across all uploaded files (PDFs, images, documents) using Gemini File Search and page-indexed RAG.",
  "",
  "Use this tool when:",
  "- User asks to find information across multiple uploaded files",
  "- User wants to search through their uploaded documents",
  "- User asks questions about files they've uploaded",
  "- User wants to compare or analyze content from multiple files",
  "",
  "This tool searches the user's Gemini File Search store AND the page-indexed RAG pipeline.",
  "Results include page references when available — ALWAYS include the {{cite:...}} tokens in your response text verbatim so the UI renders page badges.",
].join("\n");

/**
 * Search across all uploaded files using Gemini File Search + page-indexed RAG
 * Combines Gemini's native file search with the custom RAG pipeline that has
 * page-level granularity via [PAGE N] markers in the vector index.
 */
export const searchFiles = createTool({
  description,

  args: z.object({
    query: z.string().describe("The search query to find information across uploaded files"),
  }),

  handler: async (ctx, args): Promise<string> => {
    // Extract userId from agent tool context for auth propagation
    const userId = (ctx as any).evaluationUserId || (ctx as any).userId || undefined;

    // Run both search pipelines in parallel for speed
    const [geminiResult, ragResult] = await Promise.allSettled([
      ctx.runAction(internal.domains.documents.fileSearch.searchUserFiles, {
        query: args.query,
        ...(userId ? { userId } : {}),
      }),
      ctx.runAction(internal.domains.search.rag.answerQuestionViaRAG, {
        prompt: args.query,
      }),
    ]);

    const gemini = geminiResult.status === "fulfilled" ? geminiResult.value : null;
    const rag = ragResult.status === "fulfilled" ? ragResult.value : null;

    // Build response combining both sources
    const sections: string[] = [];

    // --- Page-indexed RAG results (higher priority — has page references) ---
    if (rag && rag.candidateDocs && rag.candidateDocs.length > 0) {
      sections.push("## Document Search Results (with page references)\n");

      rag.candidateDocs.forEach((doc: any, i: number) => {
        const title = doc.title || "Unknown Document";
        const snippet = doc.snippet || "";
        const page = doc.pageIndex;
        const score = doc.score != null ? ` (relevance: ${(doc.score * 100).toFixed(0)}%)` : "";

        // Build citation token with page reference
        const safeTitle = title.replace(/[|{}]/g, " ").slice(0, 80);
        const citeId = `doc_${i + 1}`;
        const citeToken = page != null
          ? `{{cite:${citeId}|${safeTitle}|type:document|page:${page}}}`
          : `{{cite:${citeId}|${safeTitle}|type:document}}`;

        sections.push(
          `${i + 1}. **${title}**${page != null ? ` [Page ${page}]` : ""}${score}`,
          `   ${snippet.slice(0, 400)}`,
          `   Citation token: ${citeToken}`,
          "",
        );
      });

      // Include RAG answer if available
      if (rag.answer && rag.answer.trim()) {
        sections.push("### RAG Summary\n" + rag.answer + "\n");
      }
    }

    // --- Gemini File Search results ---
    if (gemini && gemini.results && gemini.results.length > 0) {
      sections.push("## Gemini File Search Results\n");

      gemini.results.forEach((r: any, i: number) => {
        const fileName = r.fileName || "Unknown File";
        const excerpt = r.excerpt || "No content";
        sections.push(`${i + 1}. From "${fileName}":\n${excerpt}\n`);
      });

      if (gemini.summary) {
        sections.push("### Gemini Summary\n" + gemini.summary + "\n");
      }
    }

    // No results from either pipeline
    if (sections.length === 0) {
      return gemini?.summary || "No results found in uploaded files.";
    }

    return [
      "IMPORTANT: Include the {{cite:...}} tokens in your response text EXACTLY as shown — they render as interactive page badges in the UI.",
      "",
      ...sections,
    ].join("\n");
  },
});

/**
 * Pipeline Document Handoff
 *
 * Best-effort: when a pipeline run has `ownerKey: "user:<userId>"`,
 * write the bundle as a Workspace `documents` row so RichNotebookEditor
 * + the existing workspace surface render it natively. For anonymous
 * runs (no userId), the storage-bundle export remains the only path.
 *
 * Why a separate file instead of inline: keeps the per-pipeline action
 * focused on the pi-ai work; the documents handoff has its own
 * concerns (auth shape, content format, archive vs publish).
 *
 * Output format (for the documents.content field):
 *   - JSON-stringified ProseMirror doc with sections derived from the
 *     bundle. Top-level sections: spec → output (files / decomposition
 *     / synthesis) → verdict → sources.
 */

import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

interface BundleSummaryArgs {
  pipelineKind: "code_gen" | "design_gen" | "research" | "custom";
  spec: string;
  // Code-gen specific
  files?: Array<{ path: string; content: string }>;
  // Design-gen specific
  brief?: any;
  decomposition?: any;
  imageStorageId?: Id<"_storage">;
  // Research specific
  synthesis?: string;
  sourcesConsulted?: Array<{ idx: number; title?: string; url?: string }>;
  citationsUsed?: Array<{ idx: number; title?: string; url?: string }>;
  // Common
  verdict?: { tier: string; passing: number; failing: number; notes: string[] };
}

function buildProseMirrorDoc(args: BundleSummaryArgs): string {
  const blocks: any[] = [];

  // Title
  blocks.push({
    type: "heading",
    attrs: { level: 1 },
    content: [{ type: "text", text: pipelineHeading(args.pipelineKind) }],
  });

  // Spec
  blocks.push({
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text: "Spec" }],
  });
  blocks.push({
    type: "paragraph",
    content: [{ type: "text", text: args.spec }],
  });

  // Per-pipeline body
  if (args.pipelineKind === "code_gen" && args.files) {
    blocks.push({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: `Generated files (${args.files.length})` }],
    });
    for (const f of args.files) {
      blocks.push({
        type: "heading",
        attrs: { level: 3 },
        content: [{ type: "text", text: f.path }],
      });
      blocks.push({
        type: "codeBlock",
        attrs: { language: detectLang(f.path) },
        content: [{ type: "text", text: f.content.slice(0, 8000) }],
      });
    }
  } else if (args.pipelineKind === "design_gen") {
    if (args.brief) {
      blocks.push({
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Brief" }],
      });
      blocks.push({
        type: "codeBlock",
        attrs: { language: "json" },
        content: [{ type: "text", text: JSON.stringify(args.brief, null, 2) }],
      });
    }
    if (args.decomposition?.components?.length) {
      blocks.push({
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Components" }],
      });
      const items = args.decomposition.components.map((c: any) => ({
        type: "listItem",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", marks: [{ type: "strong" }], text: c.name },
              { type: "text", text: ` — ${c.role}` },
            ],
          },
        ],
      }));
      blocks.push({ type: "bulletList", content: items });
    }
  } else if (args.pipelineKind === "research" && args.synthesis) {
    blocks.push({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Synthesis" }],
    });
    blocks.push({
      type: "paragraph",
      content: [{ type: "text", text: args.synthesis }],
    });
    if (args.sourcesConsulted?.length) {
      blocks.push({
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Sources consulted" }],
      });
      const items = args.sourcesConsulted.map((c) => ({
        type: "listItem",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: `[${c.idx}] ${c.title ?? ""} ` },
              ...(c.url
                ? [
                    {
                      type: "text",
                      marks: [{ type: "link", attrs: { href: c.url } }],
                      text: c.url,
                    },
                  ]
                : []),
            ],
          },
        ],
      }));
      blocks.push({ type: "bulletList", content: items });
    }
    if (args.citationsUsed?.length) {
      blocks.push({
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Citations used in synthesis" }],
      });
      const items = args.citationsUsed.map((c) => ({
        type: "listItem",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: `[${c.idx}] ${c.title ?? ""} ` },
              ...(c.url
                ? [
                    {
                      type: "text",
                      marks: [{ type: "link", attrs: { href: c.url } }],
                      text: c.url,
                    },
                  ]
                : []),
            ],
          },
        ],
      }));
      blocks.push({ type: "bulletList", content: items });
    }
  }

  // Verdict
  if (args.verdict) {
    blocks.push({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Verdict" }],
    });
    blocks.push({
      type: "paragraph",
      content: [
        { type: "text", marks: [{ type: "strong" }], text: `${args.verdict.tier}` },
        {
          type: "text",
          text: ` — passing=${args.verdict.passing}, failing=${args.verdict.failing}`,
        },
      ],
    });
    if (args.verdict.notes.length > 0) {
      blocks.push({
        type: "bulletList",
        content: args.verdict.notes.map((n) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: n }] }],
        })),
      });
    }
  }

  return JSON.stringify({ type: "doc", content: blocks });
}

function pipelineHeading(kind: BundleSummaryArgs["pipelineKind"]): string {
  switch (kind) {
    case "code_gen":
      return "Generated code bundle";
    case "design_gen":
      return "Generated design bundle";
    case "research":
      return "Research synthesis";
    default:
      return "Pipeline output";
  }
}

function detectLang(path: string): string {
  const ext = path.toLowerCase().split(".").pop();
  return (
    {
      ts: "typescript",
      tsx: "typescript",
      js: "javascript",
      jsx: "javascript",
      py: "python",
      rb: "ruby",
      go: "go",
      rs: "rust",
      java: "java",
      json: "json",
      yaml: "yaml",
      yml: "yaml",
      md: "markdown",
      sh: "bash",
      sql: "sql",
      css: "css",
      html: "html",
    }[ext ?? ""] ?? "plaintext"
  );
}

/**
 * Create a Workspace document from a pipeline bundle. Returns the
 * documentId or null when the run isn't owned by a real user (auth
 * fallback — anonymous runs export via storage bundle only).
 *
 * Idempotent: re-runs against the same `pipelineRunId` overwrite the
 * existing document's content (the run's verdict is the latest source
 * of truth).
 */
export const createPipelineDocument = internalMutation({
  args: {
    pipelineRunId: v.id("pipelineRuns"),
    runId: v.string(),
    workflowExecutionKey: v.string(),
    executionGeneration: v.number(),
    bundle: v.object({
      pipelineKind: v.union(
        v.literal("code_gen"),
        v.literal("design_gen"),
        v.literal("research"),
        v.literal("custom"),
      ),
      spec: v.string(),
      files: v.optional(
        v.array(v.object({ path: v.string(), content: v.string() })),
      ),
      brief: v.optional(v.any()),
      decomposition: v.optional(v.any()),
      imageStorageId: v.optional(v.id("_storage")),
      synthesis: v.optional(v.string()),
      sourcesConsulted: v.optional(
        v.array(
          v.object({
            idx: v.number(),
            title: v.optional(v.string()),
            url: v.optional(v.string()),
          }),
        ),
      ),
      citationsUsed: v.optional(
        v.array(
          v.object({
            idx: v.number(),
            title: v.optional(v.string()),
            url: v.optional(v.string()),
          }),
        ),
      ),
      verdict: v.optional(
        v.object({
          tier: v.string(),
          passing: v.number(),
          failing: v.number(),
          notes: v.array(v.string()),
        }),
      ),
    }),
  },
  returns: v.object({
    documentId: v.optional(v.id("documents")),
    skipped: v.boolean(),
    skipReason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.pipelineRunId);
    if (!run) {
      return { documentId: undefined, skipped: true, skipReason: "run_not_found" };
    }
    if (
      run.workflowExecutionKey !== args.workflowExecutionKey ||
      run.executionGeneration !== args.executionGeneration ||
      run.status !== "running"
    ) {
      return {
        documentId: undefined,
        skipped: true,
        skipReason: "stale_execution",
      };
    }

    // Auth contract: only user:<id>-owned runs get a Workspace document.
    // Anon runs use the storage bundle export.
    const ownerKey = run.ownerKey;
    if (!ownerKey || !ownerKey.startsWith("user:")) {
      return {
        documentId: undefined,
        skipped: true,
        skipReason: "no_user_ownerKey",
      };
    }
    const userId = ownerKey.slice("user:".length) as Id<"users">;

    const content = buildProseMirrorDoc(args.bundle);
    const title = run.title || pipelineHeading(args.bundle.pipelineKind);

    // Idempotent: overwrite if we already wrote a document for this run.
    if (run.outputDocumentId) {
      const existing = await ctx.db.get(run.outputDocumentId);
      if (existing) {
        await ctx.db.patch(run.outputDocumentId, {
          title,
          content,
          lastModified: Date.now(),
        });
        return { documentId: run.outputDocumentId, skipped: false };
      }
    }

    const documentId = await ctx.db.insert("documents", {
      title,
      content,
      createdBy: userId,
      lastEditedBy: userId,
      isPublic: false,
      lastModified: Date.now(),
      summary: `pipeline_run:${args.runId}`,
      icon: args.bundle.pipelineKind === "code_gen" ? "code" : args.bundle.pipelineKind === "design_gen" ? "image" : "book-open",
    });
    await ctx.db.patch(args.pipelineRunId, { outputDocumentId: documentId });
    return { documentId, skipped: false };
  },
});

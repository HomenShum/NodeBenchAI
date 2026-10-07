"use node";

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { markdownToTipTap } from "../../lib/markdownToTipTap";

const idSchema = z.string().min(1);

export const createDossier = createTool({
  description: `Create a new dossier document (documentType: "dossier").
Accepts optional Markdown which will be stored as TipTap/ProseMirror JSON.`,
  args: z.object({
    title: z.string().min(1).describe("Dossier title"),
    markdown: z.string().optional().describe("Optional initial dossier content in Markdown"),
    isPublic: z.boolean().optional().describe("Whether the dossier is public"),
    allowPublicEdit: z.boolean().optional().describe("Allow public edits when public"),
    parentId: idSchema.optional().describe("Optional parent folder/document ID"),
  }),
  handler: async (ctx, args): Promise<string> => {
    const content = args.markdown ? JSON.stringify(markdownToTipTap(args.markdown)) : undefined;
    const dossierId = await ctx.runMutation(api.domains.documents.documents.createDossier, {
      title: args.title,
      content,
      isPublic: args.isPublic,
      allowPublicEdit: args.allowPublicEdit,
      parentId: args.parentId as any,
    });

    return `Created dossier "${args.title}" (id: ${dossierId}).`;
  },
});

export const updateDossier = createTool({
  description: `Update a dossier's title and/or content (Markdown will be converted to TipTap/ProseMirror JSON).`,
  args: z.object({
    dossierId: idSchema.describe("Dossier document ID"),
    title: z.string().optional().describe("New title"),
    markdown: z.string().optional().describe("New dossier content in Markdown"),
    isPublic: z.boolean().optional().describe("Whether the dossier is public"),
    allowPublicEdit: z.boolean().optional().describe("Allow public edits when public"),
  }),
  handler: async (ctx, args): Promise<string> => {
    const content = args.markdown ? JSON.stringify(markdownToTipTap(args.markdown)) : undefined;
    await ctx.runMutation(api.domains.documents.documents.update, {
      id: args.dossierId,
      title: args.title,
      content,
      isPublic: args.isPublic,
      allowPublicEdit: args.allowPublicEdit,
    });
    return `Updated dossier ${args.dossierId}.`;
  },
});

export const deleteDossier = createTool({
  description: `Soft-delete a dossier by moving it to trash (archives recursively).`,
  args: z.object({
    dossierId: idSchema.describe("Dossier document ID"),
  }),
  handler: async (ctx, args): Promise<string> => {
    await ctx.runMutation(api.domains.documents.documents.archive, {
      id: args.dossierId,
    });
    return `Archived dossier ${args.dossierId}.`;
  },
});

export const listDossiers = createTool({
  description: `List your most recent dossiers (primary, non-archived).`,
  args: z.object({
    limit: z.number().min(1).max(50).default(10).describe("Max dossiers to return"),
  }),
  handler: async (ctx, args): Promise<string> => {
    const dossiers = await ctx.runQuery(api.domains.documents.documents.listUserDossiers, {
      limit: args.limit,
    });
    if (!dossiers.length) return "No dossiers found.";

    const lines = dossiers.map((d: any, idx: number) => {
      const title = d.title || "Untitled";
      const updated = (d.lastModified || d._creationTime) as number;
      return `${idx + 1}. ${title} (id: ${d._id}) — updated ${new Date(updated).toLocaleString()}`;
    });
    return `Dossiers:\n${lines.join("\n")}`;
  },
});

export const dossierCrudTools = {
  createDossier,
  updateDossier,
  deleteDossier,
  listDossiers,
};


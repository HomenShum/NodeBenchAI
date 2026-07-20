/**
 * Citations Module
 * 
 * Manages document-to-artifact citation links for verified sourcing.
 * Links documents to sourceArtifacts for traceable citations.
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id, Doc } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface LinkedArtifact {
    artifactId: Id<"sourceArtifacts">;
    citationKey: string;
    addedAt: number;
    addedBy: Id<"users">;
}

// ═══════════════════════════════════════════════════════════════════════════
// Mutations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Add a citation link from a document to a source artifact.
 * Creates bidirectional traceability between work products and their sources.
 */
export const addCitationToDocument = mutation({
    args: {
        documentId: v.id("documents"),
        artifactId: v.id("sourceArtifacts"),
        citationKey: v.string(), // e.g., "[1]", "[SEC-10K]"
    },
    returns: v.object({ success: v.boolean(), message: v.string() }),
    handler: async (ctx, args) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) {
            return { success: false, message: "Not authenticated" };
        }

        // Verify document exists and user has access
        const document = await ctx.db.get(args.documentId) as Doc<"documents"> | null;
        if (!document) {
            return { success: false, message: "Document not found" };
        }
        if (document.createdBy !== userId) {
            return { success: false, message: "Not authorized to modify this document" };
        }

        // Verify artifact exists
        const artifact = await ctx.db.get(args.artifactId) as Doc<"sourceArtifacts"> | null;
        if (!artifact) {
            return { success: false, message: "Source artifact not found" };
        }

        // Get existing linked artifacts or initialize empty array
        const existingLinks = (document.linkedArtifacts ?? []) as LinkedArtifact[];

        // Check for duplicate citation key
        const existingCitation = existingLinks.find(
            (link) => link.citationKey === args.citationKey
        );
        if (existingCitation) {
            // Update existing citation to point to new artifact
            const updatedLinks = existingLinks.map((link) =>
                link.citationKey === args.citationKey
                    ? { ...link, artifactId: args.artifactId, addedAt: Date.now() }
                    : link
            );
            await ctx.db.patch(args.documentId, { linkedArtifacts: updatedLinks });
            return { success: true, message: `Updated citation ${args.citationKey}` };
        }

        // Add new citation
        const newLink = {
            artifactId: args.artifactId,
            citationKey: args.citationKey,
            addedAt: Date.now(),
            addedBy: userId,
        };
        await ctx.db.patch(args.documentId, {
            linkedArtifacts: [...existingLinks, newLink],
        });

        return { success: true, message: `Added citation ${args.citationKey}` };
    },
});

/**
 * Remove a citation from a document.
 */
export const removeCitationFromDocument = mutation({
    args: {
        documentId: v.id("documents"),
        citationKey: v.string(),
    },
    returns: v.object({ success: v.boolean(), message: v.string() }),
    handler: async (ctx, args) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) {
            return { success: false, message: "Not authenticated" };
        }

        const document = await ctx.db.get(args.documentId) as Doc<"documents"> | null;
        if (!document) {
            return { success: false, message: "Document not found" };
        }
        if (document.createdBy !== userId) {
            return { success: false, message: "Not authorized to modify this document" };
        }

        const existingLinks = (document.linkedArtifacts ?? []) as LinkedArtifact[];
        const filteredLinks = existingLinks.filter(
            (link) => link.citationKey !== args.citationKey
        );

        if (filteredLinks.length === existingLinks.length) {
            return { success: false, message: `Citation ${args.citationKey} not found` };
        }

        await ctx.db.patch(args.documentId, { linkedArtifacts: filteredLinks });
        return { success: true, message: `Removed citation ${args.citationKey}` };
    },
});

// ═══════════════════════════════════════════════════════════════════════════
// Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get all citations for a document with their source artifact details.
 */
export const getDocumentCitations = query({
    args: { documentId: v.id("documents") },
    returns: v.array(
        v.object({
            citationKey: v.string(),
            artifactId: v.id("sourceArtifacts"),
            sourceUrl: v.optional(v.string()),
            sourceType: v.string(),
            addedAt: v.number(),
        })
    ),
    handler: async (ctx, args) => {
        const document = await ctx.db.get(args.documentId) as Doc<"documents"> | null;
        if (!document || !document.linkedArtifacts) {
            return [];
        }

        const citations = await Promise.all(
            (document.linkedArtifacts as LinkedArtifact[]).map(async (link) => {
                const artifact = await ctx.db.get(link.artifactId) as Doc<"sourceArtifacts"> | null;
                return {
                    citationKey: link.citationKey,
                    artifactId: link.artifactId,
                    sourceUrl: artifact?.sourceUrl,
                    sourceType: artifact?.sourceType ?? "unknown",
                    addedAt: link.addedAt,
                };
            })
        );

        return citations;
    },
});

/**
 * Find all documents that cite a specific artifact.
 */
export const getArtifactUsage = query({
    args: { artifactId: v.id("sourceArtifacts") },
    returns: v.array(
        v.object({
            documentId: v.id("documents"),
            documentTitle: v.string(),
            citationKey: v.string(),
        })
    ),
    handler: async (ctx, args) => {
        // Note: This is a scan operation. For large datasets, consider adding an index.
        const documents = await ctx.db.query("documents").collect();

        const usages: { documentId: Id<"documents">; documentTitle: string; citationKey: string }[] = [];

        for (const doc of documents) {
            if (doc.linkedArtifacts) {
                for (const link of doc.linkedArtifacts) {
                    if (link.artifactId === args.artifactId) {
                        usages.push({
                            documentId: doc._id,
                            documentTitle: doc.title,
                            citationKey: link.citationKey,
                        });
                    }
                }
            }
        }

        return usages;
    },
});

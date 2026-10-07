/**
 * Citation Validator
 * 
 * Validates that document outputs have proper citation coverage.
 * Scans text for citation markers and verifies they have linked artifacts.
 */

import { v } from "convex/values";
import { query, internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id, Doc } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface CitationValidationResult {
    isValid: boolean;
    totalCitationsFound: number;
    linkedCitations: number;
    orphanCitations: string[];      // Citations in text but not linked
    unusedLinks: string[];          // Linked but not in text
    warnings: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Citation Patterns
// ═══════════════════════════════════════════════════════════════════════════

// Matches [1], [2], [SEC-10K], [Source 1], etc.
const CITATION_PATTERN = /\[(?:\d+|[A-Z]+-[A-Z0-9]+|Source\s+\d+)\]/g;

// ═══════════════════════════════════════════════════════════════════════════
// Validation Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract all citation markers from text content.
 */
export function extractCitationsFromText(text: string): string[] {
    const matches = text.match(CITATION_PATTERN);
    if (!matches) return [];

    // Deduplicate
    return [...new Set(matches)];
}

/**
 * Validate document citations - ensures all citations in text have linked artifacts.
 */
export const validateDocumentCitations = query({
    args: { documentId: v.id("documents") },
    returns: v.object({
        isValid: v.boolean(),
        totalCitationsFound: v.number(),
        linkedCitations: v.number(),
        orphanCitations: v.array(v.string()),
        unusedLinks: v.array(v.string()),
        warnings: v.array(v.string()),
    }),
    handler: async (ctx, args): Promise<CitationValidationResult> => {
        const document = await ctx.db.get(args.documentId) as Doc<"documents"> | null;
        if (!document) {
            return {
                isValid: false,
                totalCitationsFound: 0,
                linkedCitations: 0,
                orphanCitations: [],
                unusedLinks: [],
                warnings: ["Document not found"],
            };
        }

        // Get document text content
        // First check content field, then query nodes for ProseMirror docs
        let textContent = document.content ?? "";

        // If using nodes-based storage, aggregate text from nodes
        if (!textContent) {
            const nodes = await ctx.db
                .query("nodes")
                .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
                .collect();

            textContent = nodes
                .map((node) => node.text ?? "")
                .filter(Boolean)
                .join(" ");
        }

        // Extract citations from text
        const citationsInText = extractCitationsFromText(textContent);

        // Get linked artifacts - cast to proper type
        interface LinkedArtifact {
            artifactId: string;
            citationKey: string;
            addedAt: number;
            addedBy: string;
        }
        const linkedArtifacts = (document.linkedArtifacts ?? []) as LinkedArtifact[];
        const linkedCitationKeys = new Set(linkedArtifacts.map((l) => l.citationKey));

        // Find orphan citations (in text but not linked)
        const orphanCitations = citationsInText.filter(
            (citation) => !linkedCitationKeys.has(citation)
        );

        // Find unused links (linked but not in text)
        const citationsInTextSet = new Set(citationsInText);
        const unusedLinks = [...linkedCitationKeys].filter(
            (key) => !citationsInTextSet.has(key)
        );

        // Generate warnings
        const warnings: string[] = [];
        if (orphanCitations.length > 0) {
            warnings.push(
                `${orphanCitations.length} citation(s) in text have no linked source: ${orphanCitations.join(", ")}`
            );
        }
        if (unusedLinks.length > 0) {
            warnings.push(
                `${unusedLinks.length} linked source(s) not referenced in text: ${unusedLinks.join(", ")}`
            );
        }

        const linkedCitations = citationsInText.length - orphanCitations.length;

        return {
            isValid: orphanCitations.length === 0,
            totalCitationsFound: citationsInText.length,
            linkedCitations,
            orphanCitations,
            unusedLinks,
            warnings,
        };
    },
});

/**
 * Batch validate multiple documents (for memo generation workflows).
 */
export const validateBatchDocuments = internalAction({
    args: {
        documentIds: v.array(v.id("documents")),
    },
    returns: v.object({
        allValid: v.boolean(),
        results: v.array(
            v.object({
                documentId: v.id("documents"),
                isValid: v.boolean(),
                orphanCount: v.number(),
            })
        ),
    }),
    handler: async (ctx, args) => {
        const results = await Promise.all(
            args.documentIds.map(async (documentId: Id<"documents">) => {
                const validation = await ctx.runQuery(
                    internal.domains.documents.citationValidator.validateDocumentCitations,
                    { documentId }
                );
                return {
                    documentId,
                    isValid: validation.isValid,
                    orphanCount: validation.orphanCitations.length,
                };
            })
        );

        return {
            allValid: results.every((r) => r.isValid),
            results,
        };
    },
});

/**
 * Generate a citation report for a document (human-readable format).
 */
export const generateCitationReport = query({
    args: { documentId: v.id("documents") },
    returns: v.string(),
    handler: async (ctx, args): Promise<string> => {
        const document = await ctx.db.get(args.documentId) as Doc<"documents"> | null;
        if (!document) {
            return "❌ Document not found";
        }

        const linkedArtifacts = document.linkedArtifacts ?? [];

        if (linkedArtifacts.length === 0) {
            return "📋 No citations linked to this document.";
        }

        const lines: string[] = [
            `# Citation Report: ${document.title}`,
            "",
            `Total linked citations: ${linkedArtifacts.length}`,
            "",
            "## Linked Sources",
            "",
        ];

        for (const link of linkedArtifacts) {
            const artifact = await ctx.db.get(link.artifactId) as Doc<"sourceArtifacts"> | null;
            if (artifact) {
                lines.push(
                    `- **${link.citationKey}**: ${artifact.sourceType} - ${artifact.sourceUrl ?? "No URL"}`
                );
            } else {
                lines.push(`- **${link.citationKey}**: ⚠️ Artifact not found`);
            }
        }

        return lines.join("\n");
    },
});

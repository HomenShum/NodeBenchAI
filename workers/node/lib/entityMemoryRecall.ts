import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

export const MEMORY_CONTEXT_STEP_ID = "ctx_memory";

export interface EntityMemoryRecallEntry {
  entitySlug: string;
  entityName: string;
  entityType: string;
  summary: string;
  savedBecause?: string | null;
  latestRevision: number;
  updatedAt: number;
  latestReportTitle?: string | null;
  latestReportSummary?: string | null;
  noteSnippet?: string | null;
}

let convexClient: ConvexHttpClient | null | undefined;

function getConvexClient(): ConvexHttpClient | null {
  if (convexClient !== undefined) return convexClient;

  const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
  if (!convexUrl) {
    convexClient = null;
    return convexClient;
  }

  convexClient = new ConvexHttpClient(convexUrl);
  return convexClient;
}

function summarizeRecallEntry(entry: EntityMemoryRecallEntry): string {
  const pieces = [
    entry.entityName,
    entry.savedBecause ? `saved because ${entry.savedBecause}` : null,
    entry.latestReportSummary || entry.summary,
    entry.noteSnippet ? `notes: ${entry.noteSnippet}` : null,
    `revision ${entry.latestRevision}`,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  return pieces.join(" | ");
}

export function buildMemorySeedContext(
  recalledMemory: EntityMemoryRecallEntry[] | null | undefined,
): Record<string, unknown> | undefined {
  if (!recalledMemory?.length) return undefined;

  return {
    [MEMORY_CONTEXT_STEP_ID]: {
      kind: "entity_memory_recall",
      recalledAt: Date.now(),
      entities: recalledMemory,
      summary: recalledMemory.map(summarizeRecallEntry).join("\n"),
    },
  };
}

export function formatEntityMemoryRecallForPrompt(
  recalledMemory: EntityMemoryRecallEntry[] | null | undefined,
): string | null {
  if (!recalledMemory?.length) return null;

  return recalledMemory
    .map((entry) => {
      const lines = [
        `- ${entry.entityName} (${entry.entityType})`,
        `  summary: ${entry.latestReportSummary || entry.summary}`,
        entry.savedBecause ? `  savedBecause: ${entry.savedBecause}` : null,
        entry.noteSnippet ? `  noteSnippet: ${entry.noteSnippet}` : null,
        `  latestRevision: ${entry.latestRevision}`,
      ].filter((value): value is string => Boolean(value));
      return lines.join("\n");
    })
    .join("\n");
}

export async function recallEntityMemory(args: {
  ownerKey?: string | null;
  entityTargets: string[];
  limit?: number;
}): Promise<EntityMemoryRecallEntry[]> {
  const ownerKey = args.ownerKey?.trim();
  const targets = args.entityTargets
    .map((target) => target.trim())
    .filter((target) => target.length > 0)
    .slice(0, 6);

  if (!ownerKey || targets.length === 0) return [];

  const client = getConvexClient();
  if (!client) return [];

  try {
    const result = await client.query(anyApi.domains.product.entities.recallEntityMemory, {
      ownerKey,
      entityTargets: targets,
      limit: args.limit ?? 3,
    });
    return Array.isArray(result) ? (result as EntityMemoryRecallEntry[]) : [];
  } catch {
    return [];
  }
}

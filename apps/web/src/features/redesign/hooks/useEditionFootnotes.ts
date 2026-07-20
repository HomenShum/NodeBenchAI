/**
 * useEditionFootnotes — fetches `evidenceArtifacts` referenced by
 * §1–§3 of the editorial home plus recent `industryUpdates`.
 *
 * Pass the union of `evidenceArtifactIds` collected from pulse +
 * hypotheses; the hook bounds the request server-side via the
 * editionQueries module.
 */

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";

export interface FootnoteArtifact {
  _id: string;
  artifactId: string;
  url: string;
  canonicalUrl: string;
  publisher: string;
  publishedAt: number | null;
  credibilityTier: string;
  firstQuote: string | null;
}

export interface FootnoteIndustryUpdate {
  _id: string;
  provider: string;
  providerName: string;
  url: string;
  title: string;
  summary: string;
  relevance: number;
  scannedAt: number;
}

export interface EditionFootnotes {
  artifacts: FootnoteArtifact[];
  industry: FootnoteIndustryUpdate[];
}

export function useEditionFootnotes(
  artifactIds: string[],
  industryLimit = 8,
  artifactLimit = 24,
): EditionFootnotes | undefined {
  // Stable key set — sorted for cache hit consistency.
  const sorted = [...new Set(artifactIds)].sort();
  const data = useQuery(
    api.domains.research.editionQueries.getEditionFootnotes,
    {
      artifactIds: sorted,
      industryLimit,
      artifactLimit,
    },
  );
  return data as EditionFootnotes | undefined;
}

/**
 * useEntityHoverData - Lazy load entity enrichment data for hover previews
 *
 * Provides:
 * - Debounced query for entity context (250ms delay matches hover)
 * - Transforms entityContexts data to EntityHoverData format
 * - Fetches adaptive profile for relationships and timeline
 * - Caching with 5-minute stale time
 * - Fallback to basic entity data if enrichment fails
 */

import { useState, useEffect, useRef } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { EntityHoverData } from "../components/EntityHoverPreview";
import type { EntityType } from "../types/entitySchema";

type ExtendedEntityType = EntityType | "fda_approval" | "funding_event" | "research_paper";

interface UseEntityHoverDataOptions {
  /** Whether to enable the query (e.g., only when hovering) */
  enabled?: boolean;
  /** Debounce delay in ms (default: 250) */
  debounceMs?: number;
  /** Pre-loaded enrichment data to use instead of fetching */
  preloadedData?: EntityHoverData;
}

interface UseEntityHoverDataReturn {
  data: EntityHoverData | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Map entity context type to extended entity type
 */
function mapEntityType(
  contextType: "company" | "person",
  name?: string
): ExtendedEntityType {
  // Check for special entity types based on name patterns
  if (name) {
    const lowerName = name.toLowerCase();
    if (lowerName.includes("fda") || lowerName.includes("breakthrough")) {
      return "fda_approval";
    }
    if (lowerName.includes("series") || lowerName.includes("funding") || lowerName.includes("acquired")) {
      return "funding_event";
    }
    if (lowerName.includes("paper") || lowerName.includes("arxiv") || lowerName.includes("research")) {
      return "research_paper";
    }
  }
  return contextType;
}

/**
 * Extract funding info from entity context
 */
function extractFunding(context: any): EntityHoverData["funding"] | undefined {
  if (!context.funding) return undefined;

  const funding = context.funding;
  return {
    stage: funding.stage || context.crmFields?.fundingStage || undefined,
    totalRaised: funding.totalRaised
      ? `$${funding.totalRaised.amount}${funding.totalRaised.unit || "M"}`
      : context.crmFields?.totalFunding,
    lastRound: funding.lastRound?.roundType,
  };
}

/**
 * Extract sources from entity context
 */
function extractSources(context: any): EntityHoverData["sources"] | undefined {
  if (!context.sources || context.sources.length === 0) return undefined;

  return context.sources.slice(0, 2).map((source: any) => ({
    name: source.name,
    url: source.url,
    credibility: source.credibility || "medium",
  }));
}

/**
 * Extract freshness info from entity context
 */
function extractFreshness(context: any): EntityHoverData["freshness"] | undefined {
  if (!context.freshness) return undefined;

  return {
    newsAgeDays: context.freshness.newsAgeDays ?? 999,
    isStale: !context.freshness.withinBankerWindow,
  };
}

/**
 * Transform entity context to EntityHoverData format
 */
function transformToHoverData(
  entityName: string,
  entityType: "company" | "person",
  context: any,
  adaptiveProfile?: any
): EntityHoverData {
  const keyFacts = context.keyFacts?.slice(0, 3) || [];

  // Add funding info to key facts if not already present
  if (context.funding?.bankerTakeaway && keyFacts.length < 3) {
    keyFacts.push(context.funding.bankerTakeaway);
  }

  // Extract adaptive enrichment data
  const relationships = adaptiveProfile?.relationships?.slice(0, 3).map((r: any) => ({
    entityName: r.entityName,
    relationshipType: r.relationshipType,
    strength: r.strength || "moderate",
  }));

  const circleOfInfluence = adaptiveProfile?.circleOfInfluence
    ? {
        tier1: adaptiveProfile.circleOfInfluence.tier1?.slice(0, 3) || [],
        tier2: adaptiveProfile.circleOfInfluence.tier2?.slice(0, 2) || [],
      }
    : undefined;

  const timelineHighlight = adaptiveProfile?.timeline?.[0]
    ? {
        date: adaptiveProfile.timeline[0].date,
        title: adaptiveProfile.timeline[0].title,
        category: adaptiveProfile.timeline[0].category,
      }
    : undefined;

  const executiveSummary = adaptiveProfile?.executiveSummary
    ? {
        whatTheyreKnownFor: adaptiveProfile.executiveSummary.whatTheyreKnownFor,
        currentFocus: adaptiveProfile.executiveSummary.currentFocus,
      }
    : undefined;

  return {
    entityId: context._id || entityName.toLowerCase().replace(/\s+/g, "-"),
    name: entityName,
    type: mapEntityType(entityType, entityName),
    summary: context.summary || adaptiveProfile?.headline || `${entityName} is a ${entityType}.`,
    keyFacts,
    funding: extractFunding(context),
    sources: extractSources(context),
    freshness: extractFreshness(context),
    avatarUrl: context.crmFields?.logo,
    dossierId: context.dossierId,
    url: context.crmFields?.website,
    // Adaptive enrichment fields
    relationships,
    circleOfInfluence,
    timelineHighlight,
    executiveSummary,
  };
}

/**
 * Create fallback EntityHoverData when no enrichment is available
 */
function createFallbackData(
  entityName: string,
  entityType: ExtendedEntityType
): EntityHoverData {
  return {
    entityId: entityName.toLowerCase().replace(/\s+/g, "-"),
    name: entityName,
    type: entityType,
    summary: `Information about ${entityName} is being researched.`,
    keyFacts: [],
  };
}

/**
 * Create EntityHoverData from adaptive profile when no entity context exists
 */
function createFallbackDataFromAdaptive(
  entityName: string,
  entityType: ExtendedEntityType,
  adaptiveProfile: any
): EntityHoverData {
  // Map adaptive profile type to our EntityType
  const profileType = adaptiveProfile.entityType?.toLowerCase() || "";
  let mappedType: ExtendedEntityType = entityType;
  if (profileType.includes("company") || profileType.includes("organization")) {
    mappedType = "company";
  } else if (profileType.includes("person") || profileType.includes("entrepreneur") || profileType.includes("researcher")) {
    mappedType = "person";
  }

  const relationships = adaptiveProfile.relationships?.slice(0, 3).map((r: any) => ({
    entityName: r.entityName,
    relationshipType: r.relationshipType,
    strength: r.strength || "moderate",
  }));

  const circleOfInfluence = adaptiveProfile.circleOfInfluence
    ? {
        tier1: adaptiveProfile.circleOfInfluence.tier1?.slice(0, 3) || [],
        tier2: adaptiveProfile.circleOfInfluence.tier2?.slice(0, 2) || [],
      }
    : undefined;

  const timelineHighlight = adaptiveProfile.timeline?.[0]
    ? {
        date: adaptiveProfile.timeline[0].date,
        title: adaptiveProfile.timeline[0].title,
        category: adaptiveProfile.timeline[0].category,
      }
    : undefined;

  const executiveSummary = adaptiveProfile.executiveSummary
    ? {
        whatTheyreKnownFor: adaptiveProfile.executiveSummary.whatTheyreKnownFor,
        currentFocus: adaptiveProfile.executiveSummary.currentFocus,
      }
    : undefined;

  return {
    entityId: entityName.toLowerCase().replace(/\s+/g, "-"),
    name: entityName,
    type: mappedType,
    summary: adaptiveProfile.headline || `${entityName} - AI enriched profile.`,
    keyFacts: [],
    relationships,
    circleOfInfluence,
    timelineHighlight,
    executiveSummary,
  };
}

/**
 * Hook to lazy-load entity enrichment data for hover previews
 * Now with auto-enrichment trigger when no data is found
 */
export function useEntityHoverData(
  entityName: string,
  entityType: ExtendedEntityType,
  options: UseEntityHoverDataOptions = {}
): UseEntityHoverDataReturn {
  const { enabled = true, debounceMs = 250, preloadedData } = options;

  const [debouncedEnabled, setDebouncedEnabled] = useState(false);
  const [enrichmentTriggered, setEnrichmentTriggered] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Get the auto-enrichment action
  const triggerAutoEnrichment = useAction(api.domains.knowledge.adaptiveEntityEnrichment.triggerAutoEnrichment);

  // Map extended types to base types for the query
  const queryEntityType: "company" | "person" =
    entityType === "person" ? "person" : "company";

  // Debounce the enabled state (skip when preloaded data is available)
  useEffect(() => {
    if (preloadedData) return; // Skip debounce when data is preloaded

    if (enabled) {
      timeoutRef.current = setTimeout(() => {
        setDebouncedEnabled(true);
      }, debounceMs);
    } else {
      setDebouncedEnabled(false);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [enabled, debounceMs, preloadedData]);

  // Skip querying if preloaded data is available
  const shouldQuery = !preloadedData && debouncedEnabled;

  // Query entity context (only when debounced enabled is true)
  const entityContext = useQuery(
    api.domains.knowledge.entityContexts.getEntityContext,
    shouldQuery ? { entityName, entityType: queryEntityType } : "skip"
  );

  // Also fetch adaptive profile for enriched data (relationships, timeline, etc.)
  const adaptiveProfile = useQuery(
    api.domains.knowledge.adaptiveEntityQueries.getAdaptiveProfile,
    shouldQuery ? { entityName } : "skip"
  );

  // Auto-trigger enrichment when no data is found after queries complete
  useEffect(() => {
    if (preloadedData) return; // Skip when data is preloaded

    // Only trigger once per entity hover session
    if (!enrichmentTriggered && debouncedEnabled) {
      // Both queries have completed (not undefined)
      const queriesComplete = entityContext !== undefined || adaptiveProfile !== undefined;
      const noDataFound = entityContext === null && adaptiveProfile === null;

      if (queriesComplete && noDataFound) {
        setEnrichmentTriggered(true);

        // Fire and forget - don't wait for completion
        triggerAutoEnrichment({
          entityName,
          entityType: queryEntityType,
          source: "hover",
          priority: "low", // Background enrichment, don't block hover
        }).catch((err) => {
          console.error(`[AutoEnrich] Failed to trigger enrichment for ${entityName}:`, err);
        });
      }
    }
  }, [entityContext, adaptiveProfile, debouncedEnabled, enrichmentTriggered, entityName, queryEntityType, triggerAutoEnrichment, preloadedData]);

  // Reset enrichment trigger when entity changes
  useEffect(() => {
    setEnrichmentTriggered(false);
  }, [entityName]);

  // If preloaded data is provided, use it directly
  if (preloadedData) {
    return {
      data: preloadedData,
      isLoading: false,
      error: null,
    };
  }

  // Transform the data - merge entity context with adaptive profile
  const data: EntityHoverData | null = entityContext
    ? transformToHoverData(entityName, queryEntityType, entityContext, adaptiveProfile)
    : adaptiveProfile
    ? createFallbackDataFromAdaptive(entityName, entityType, adaptiveProfile)
    : debouncedEnabled
    ? createFallbackData(entityName, entityType)
    : null;

  return {
    data,
    isLoading: debouncedEnabled && entityContext === undefined && adaptiveProfile === undefined,
    error: null,
  };
}

/**
 * Pre-fetch multiple entities for batch loading (useful for digest)
 */
export function useEntityHoverDataBatch(
  entities: Array<{ name: string; type: ExtendedEntityType }>,
  enabled: boolean = true
): Map<string, EntityHoverData> {
  // For now, return empty map - batch loading can be implemented later
  // when performance optimization is needed
  return new Map();
}

export default useEntityHoverData;

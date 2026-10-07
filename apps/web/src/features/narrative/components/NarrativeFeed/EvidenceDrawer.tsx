"use client";

/**
 * EvidenceDrawer - Evidence and Citation Panel
 *
 * Right-side drawer showing evidence artifacts and citations
 * for a selected post or event. Shows credibility tiers,
 * extracted quotes, and source metadata.
 *
 * @module features/narrative/components/NarrativeFeed/EvidenceDrawer
 */

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMotionConfig } from "@/lib/motion";
import {
  X,
  ExternalLink,
  Shield,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Quote,
  Calendar,
  Clock,
  Building,
  Hash,
  ChevronDown,
  ChevronUp,
  FileText,
  Link2,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Credibility tier type
 */
type CredibilityTier =
  | "tier1_primary"
  | "tier2_established"
  | "tier3_community"
  | "tier4_unverified";

/**
 * Evidence artifact data structure
 */
export interface EvidenceArtifact {
  artifactId: string;
  url: string;
  canonicalUrl: string;
  publisher: string;
  publishedAt?: number;
  fetchedAt: number;
  contentHash: string;
  pageIndex?: number;
  extractedQuotes: Array<{
    text: string;
    context?: string;
  }>;
  entities: string[];
  topics: string[];
  credibilityTier: CredibilityTier;
  retrievalTrace: {
    searchQuery?: string;
    agentName: string;
    toolName: string;
  };
}

interface EvidenceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  artifacts: EvidenceArtifact[];
  className?: string;
}

/**
 * Get credibility tier display info
 */
function getCredibilityDisplay(tier: CredibilityTier): {
  icon: React.ReactNode;
  label: string;
  color: string;
  description: string;
} {
  switch (tier) {
    case "tier1_primary":
      return {
        icon: <ShieldCheck className="w-4 h-4" />,
        label: "Primary Source",
        color: "text-green-500 bg-green-500/10 border-green-500/30",
        description: "Official filings, major wire services, institutional reports",
      };
    case "tier2_established":
      return {
        icon: <Shield className="w-4 h-4" />,
        label: "Established",
        color: "text-blue-500 bg-blue-500/10 border-blue-500/30",
        description: "Major tech publications, industry analysts",
      };
    case "tier3_community":
      return {
        icon: <ShieldAlert className="w-4 h-4" />,
        label: "Community",
        color: "text-yellow-500 bg-yellow-500/10 border-yellow-500/30",
        description: "Social media, forums, community discussions",
      };
    case "tier4_unverified":
      return {
        icon: <ShieldQuestion className="w-4 h-4" />,
        label: "Unverified",
        color: "text-content-secondary bg-gray-500/10 border-gray-500/30",
        description: "Unknown or unverified sources",
      };
  }
}

/**
 * Format date for display
 */
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Format relative time
 */
function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return formatDate(timestamp);
}

/**
 * Extract domain from URL
 */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return url;
  }
}

/**
 * Single Artifact Card
 */
function ArtifactCard({ artifact }: { artifact: EvidenceArtifact }) {
  const { instant } = useMotionConfig();
  const [expanded, setExpanded] = React.useState(false);
  const credibility = getCredibilityDisplay(artifact.credibilityTier);
  const hasQuotes = artifact.extractedQuotes.length > 0;

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card">
      {/* Header */}
      <div className="p-3 border-b border-border">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <a
              href={artifact.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-primary transition-colors"
            >
              <Building className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
              <span className="truncate">{artifact.publisher}</span>
              <ExternalLink className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
            </a>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Link2 className="w-3 h-3" />
                {extractDomain(artifact.url)}
              </span>
            </div>
          </div>

          {/* Credibility Badge */}
          <div
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border",
              credibility.color
            )}
            title={credibility.description}
          >
            {credibility.icon}
            <span className="font-medium">{credibility.label}</span>
          </div>
        </div>

        {/* Dates and Page */}
        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
          {artifact.publishedAt && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              Published {formatDate(artifact.publishedAt)}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Fetched {formatTimeAgo(artifact.fetchedAt)}
          </span>
          {artifact.pageIndex != null && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded font-medium">
              <FileText className="w-3 h-3" />
              p. {artifact.pageIndex}
            </span>
          )}
        </div>
      </div>

      {/* Quotes */}
      {hasQuotes && (
        <div className="p-3 bg-muted/30">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground w-full"
          >
            <Quote className="w-3 h-3" />
            {artifact.extractedQuotes.length} extracted quote(s)
            {expanded ? (
              <ChevronUp className="w-3 h-3 ml-auto" />
            ) : (
              <ChevronDown className="w-3 h-3 ml-auto" />
            )}
          </button>

          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={instant ? undefined : { opacity: 0, height: 0 }}
                animate={instant ? undefined : { opacity: 1, height: "auto" }}
                exit={instant ? undefined : { opacity: 0, height: 0 }}
                className="mt-2 space-y-2"
              >
                {artifact.extractedQuotes.map((quote, idx) => (
                  <div
                    key={idx}
                    className="pl-3 border-l-2 border-primary/30 text-sm"
                  >
                    <p className="text-foreground/90 italic">&ldquo;{quote.text}&rdquo;</p>
                    {quote.context && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Context: {quote.context}
                      </p>
                    )}
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Metadata Footer */}
      <div className="p-3 border-t border-border bg-muted/20">
        {/* Entities */}
        {artifact.entities.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {artifact.entities.slice(0, 5).map((entity, idx) => (
              <span
                key={idx}
                className="px-1.5 py-0.5 text-xs bg-primary/10 text-primary rounded"
              >
                {entity}
              </span>
            ))}
            {artifact.entities.length > 5 && (
              <span className="px-1.5 py-0.5 text-xs text-muted-foreground">
                +{artifact.entities.length - 5} more
              </span>
            )}
          </div>
        )}

        {/* Topics */}
        {artifact.topics.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {artifact.topics.slice(0, 4).map((topic, idx) => (
              <span
                key={idx}
                className="px-1.5 py-0.5 text-xs bg-muted text-muted-foreground rounded"
              >
                #{topic}
              </span>
            ))}
          </div>
        )}

        {/* Retrieval Trace */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <FileText className="w-3 h-3" />
            via {artifact.retrievalTrace.agentName}
          </span>
          {artifact.retrievalTrace.searchQuery && (
            <span className="truncate">
              &ldquo;{artifact.retrievalTrace.searchQuery}&rdquo;
            </span>
          )}
        </div>

        {/* Content Hash */}
        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground/60">
          <Hash className="w-3 h-3" />
          <span className="font-mono">{artifact.contentHash.slice(0, 12)}...</span>
        </div>
      </div>
    </div>
  );
}

/**
 * EvidenceDrawer Component
 */
export function EvidenceDrawer({
  isOpen,
  onClose,
  title = "Evidence & Sources",
  artifacts,
  className,
}: EvidenceDrawerProps) {
  const { instant, transition } = useMotionConfig();

  // Group artifacts by credibility tier
  const groupedArtifacts = React.useMemo(() => {
    const groups: Record<CredibilityTier, EvidenceArtifact[]> = {
      tier1_primary: [],
      tier2_established: [],
      tier3_community: [],
      tier4_unverified: [],
    };

    artifacts.forEach((artifact) => {
      groups[artifact.credibilityTier].push(artifact);
    });

    return groups;
  }, [artifacts]);

  // Count by tier
  const tierCounts = React.useMemo(() => {
    return {
      tier1_primary: groupedArtifacts.tier1_primary.length,
      tier2_established: groupedArtifacts.tier2_established.length,
      tier3_community: groupedArtifacts.tier3_community.length,
      tier4_unverified: groupedArtifacts.tier4_unverified.length,
    };
  }, [groupedArtifacts]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={instant ? undefined : { opacity: 0 }}
            animate={instant ? undefined : { opacity: 1 }}
            exit={instant ? undefined : { opacity: 0 }}
            className="fixed inset-0 bg-black/20 z-40"
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.div
            initial={instant ? undefined : { x: "100%" }}
            animate={instant ? undefined : { x: 0 }}
            exit={instant ? undefined : { x: "100%" }}
            transition={transition({ type: "spring", damping: 25, stiffness: 200 })}
            role="dialog"
            aria-label={title}
            className={cn(
              "fixed right-0 top-0 h-full w-full max-w-md bg-background border-l border-border shadow-xl z-50 flex flex-col",
              className
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <h2 className="text-lg font-semibold">{title}</h2>
                <p className="text-sm text-muted-foreground">
                  {artifacts.length} source(s)
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close panel"
                className="p-2 hover:bg-muted rounded-md transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tier Summary */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/30">
              {(["tier1_primary", "tier2_established", "tier3_community", "tier4_unverified"] as const).map(
                (tier) => {
                  const display = getCredibilityDisplay(tier);
                  const count = tierCounts[tier];
                  if (count === 0) return null;

                  return (
                    <div
                      key={tier}
                      className={cn(
                        "flex items-center gap-1 px-2 py-1 rounded text-xs border",
                        display.color
                      )}
                    >
                      {display.icon}
                      <span>{count}</span>
                    </div>
                  );
                }
              )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {artifacts.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No evidence found</p>
                </div>
              ) : (
                <>
                  {/* Render by tier (highest credibility first) */}
                  {(["tier1_primary", "tier2_established", "tier3_community", "tier4_unverified"] as const).map(
                    (tier) => {
                      const tierArtifacts = groupedArtifacts[tier];
                      if (tierArtifacts.length === 0) return null;

                      const display = getCredibilityDisplay(tier);

                      return (
                        <div key={tier}>
                          <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-2">
                            {display.icon}
                            {display.label} ({tierArtifacts.length})
                          </h3>
                          <div className="space-y-3">
                            {tierArtifacts.map((artifact) => (
                              <ArtifactCard
                                key={artifact.artifactId}
                                artifact={artifact}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    }
                  )}
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default EvidenceDrawer;

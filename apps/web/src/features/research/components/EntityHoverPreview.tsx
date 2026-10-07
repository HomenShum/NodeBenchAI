"use client";

import React, { useState, useRef, useEffect, useId } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMotionConfig } from '@/lib/motion';
import {
  Building2,
  User,
  Package,
  Cpu,
  Hash,
  Globe,
  Calendar,
  TrendingUp,
  FileText,
  ExternalLink,
  ArrowRight,
  DollarSign,
  ShieldCheck,
  BookOpen,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Users,
  Sparkles,
} from "lucide-react";
import type { EntityType } from "../types/entitySchema";

/**
 * Entity hover preview data structure (medium detail)
 */
export interface EntityHoverData {
  entityId: string;
  name: string;
  type: EntityType | "fda_approval" | "funding_event" | "research_paper";
  summary: string;
  keyFacts: string[]; // Max 3
  funding?: {
    stage: string;
    totalRaised?: string;
    lastRound?: string;
  };
  sources?: Array<{
    name: string;
    url?: string;
    credibility: "high" | "medium" | "low";
  }>;
  freshness?: {
    newsAgeDays: number;
    isStale: boolean;
  };
  avatarUrl?: string;
  dossierId?: string;
  url?: string;
  // Adaptive enrichment fields
  relationships?: Array<{
    entityName: string;
    relationshipType: string;
    strength: "strong" | "moderate" | "weak";
  }>;
  circleOfInfluence?: {
    tier1: string[]; // Inner circle
    tier2: string[]; // Extended network
  };
  timelineHighlight?: {
    date: string;
    title: string;
    category: string;
  };
  executiveSummary?: {
    whatTheyreKnownFor?: string;
    currentFocus?: string;
  };
}

interface EntityHoverPreviewProps {
  /** Entity data for the preview */
  data: EntityHoverData;
  /** Whether the preview is currently visible */
  isOpen: boolean;
  /** Position offset from the anchor */
  offset?: { x: number; y: number };
  /** Callback when user clicks "View Dossier" or "Explore" */
  onExplore?: (entity: EntityHoverData) => void;
  /** Callback when user clicks external link */
  onExternalClick?: (url: string) => void;
  /** Custom class name */
  className?: string;
}

type ExtendedEntityType = EntityType | "fda_approval" | "funding_event" | "research_paper";

/**
 * Get icon for entity type (including new types)
 */
const getEntityIcon = (type: ExtendedEntityType) => {
  switch (type) {
    case "company":
      return Building2;
    case "person":
      return User;
    case "product":
      return Package;
    case "technology":
      return Cpu;
    case "topic":
      return Hash;
    case "region":
      return Globe;
    case "event":
      return Calendar;
    case "metric":
      return TrendingUp;
    case "document":
      return FileText;
    // New types
    case "fda_approval":
      return ShieldCheck;
    case "funding_event":
      return DollarSign;
    case "research_paper":
      return BookOpen;
    default:
      return Hash;
  }
};

/**
 * Get color classes for entity type (including new types)
 */
const getEntityColors = (type: ExtendedEntityType) => {
  switch (type) {
    case "company":
      return {
        text: "text-content-secondary",
        bg: "bg-indigo-50",
        border: "border-indigo-200",
        icon: "text-indigo-500",
        badge: "bg-indigo-100 text-content-secondary",
        ring: "ring-ring",
      };
    case "person":
      return {
        text: "text-indigo-700",
        bg: "bg-indigo-50",
        border: "border-indigo-200",
        icon: "text-indigo-500",
        badge: "bg-indigo-100 text-indigo-700",
        ring: "ring-ring",
      };
    case "product":
      return {
        text: "text-blue-700",
        bg: "bg-blue-50",
        border: "border-blue-200",
        icon: "text-blue-500",
        badge: "bg-blue-100 text-blue-700",
        ring: "ring-ring",
      };
    case "technology":
      return {
        text: "text-purple-700",
        bg: "bg-purple-50",
        border: "border-purple-200",
        icon: "text-purple-500",
        badge: "bg-purple-100 text-purple-700",
        ring: "ring-purple-500/20",
      };
    // New types
    case "fda_approval":
      return {
        text: "text-green-700",
        bg: "bg-green-50",
        border: "border-green-200",
        icon: "text-green-500",
        badge: "bg-green-100 text-green-700",
        ring: "ring-green-500/20",
      };
    case "funding_event":
      return {
        text: "text-amber-700",
        bg: "bg-amber-50",
        border: "border-amber-200",
        icon: "text-amber-500",
        badge: "bg-amber-100 text-amber-700",
        ring: "ring-amber-500/20",
      };
    case "research_paper":
      return {
        text: "text-indigo-700",
        bg: "bg-indigo-50",
        border: "border-indigo-200",
        icon: "text-indigo-500",
        badge: "bg-indigo-100 text-indigo-700",
        ring: "ring-ring",
      };
    default:
      return {
        text: "text-content",
        bg: "bg-surface-secondary",
        border: "border-edge",
        icon: "text-content-secondary",
        badge: "bg-surface-secondary text-content",
        ring: "ring-[color:var(--border-color)]",
      };
  }
};

/**
 * Get freshness indicator color
 */
const getFreshnessColor = (days: number | undefined) => {
  if (days === undefined) return "text-content-secondary";
  if (days <= 7) return "text-green-500";
  if (days <= 14) return "text-yellow-500";
  return "text-red-500";
};

/**
 * Get credibility badge color
 */
const getCredibilityColor = (credibility: string) => {
  switch (credibility) {
    case "high":
      return "bg-green-100 text-green-700";
    case "medium":
      return "bg-yellow-100 text-yellow-700";
    case "low":
      return "bg-surface-secondary text-content";
    default:
      return "bg-surface-secondary text-content";
  }
};

/**
 * Format entity type for display
 */
const formatEntityType = (type: ExtendedEntityType): string => {
  switch (type) {
    case "fda_approval":
      return "FDA Approval";
    case "funding_event":
      return "Funding Event";
    case "research_paper":
      return "Research";
    default:
      return type.charAt(0).toUpperCase() + type.slice(1);
  }
};

/**
 * EntityHoverPreview - Medium detail entity preview card
 *
 * Displays:
 * - Header: Avatar/icon + Name + Type badge + Freshness indicator
 * - Summary: 2-3 sentences
 * - Key Facts: Up to 3 bullet points
 * - Funding: Stage + total raised (if applicable)
 * - Sources: Top 2 with credibility badges
 * - Action: "View Dossier" / "Explore" button
 */
export const EntityHoverPreview: React.FC<EntityHoverPreviewProps> = ({
  data,
  isOpen,
  offset = { x: 0, y: 8 },
  onExplore,
  onExternalClick,
  className = "",
}) => {
  const { instant, transition } = useMotionConfig();
  const tooltipId = useId();
  const Icon = getEntityIcon(data.type);
  const colors = getEntityColors(data.type);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          id={tooltipId}
          role="tooltip"
          initial={{ opacity: 0, scale: instant ? 1 : 0.95, y: instant ? 0 : -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: instant ? 1 : 0.95, y: instant ? 0 : -4 }}
          transition={transition({ duration: 0.15, ease: "easeOut" })}
          style={{
            marginTop: offset.y,
            marginLeft: offset.x,
          }}
          className={`
            absolute left-0 top-full z-50
            w-80 p-4
            rounded-lg border border-edge bg-surface shadow-2xl
            ring-1 ${colors.ring}
            ${className}
          `}
        >
          {/* Header */}
          <div className="flex items-start gap-3 mb-3">
            {data.avatarUrl ? (
              <img
                src={data.avatarUrl}
                alt={data.name}
                className="w-10 h-10 rounded-lg object-cover"
              />
            ) : (
              <span className={`w-10 h-10 rounded-lg flex items-center justify-center ${colors.bg}`}>
                <Icon className={`w-5 h-5 ${colors.icon}`} />
              </span>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-content text-sm truncate">
                  {data.name}
                </span>
                {data.freshness && (
                  <span
                    className={`flex items-center gap-0.5 text-xs ${getFreshnessColor(data.freshness.newsAgeDays)}`}
                    title={`Last news: ${data.freshness.newsAgeDays} days ago`}
                  >
                    <Clock className="w-3 h-3" />
                    {data.freshness.newsAgeDays}d
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${colors.badge}`}>
                  {formatEntityType(data.type)}
                </span>
                {data.funding?.stage && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-surface-secondary text-content font-medium">
                    {data.funding.stage}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Summary */}
          <p className="text-sm text-content leading-relaxed mb-3 line-clamp-3">
            {data.summary}
          </p>

          {/* Key Facts */}
          {data.keyFacts && data.keyFacts.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-bold text-content-secondary mb-1.5">
                Key Facts
              </div>
              <ul className="space-y-1">
                {data.keyFacts.slice(0, 3).map((fact, idx) => (
                  <li key={idx} className="flex items-start gap-1.5 text-xs text-content">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" />
                    <span className="line-clamp-2">{fact}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Executive Summary (from adaptive enrichment) */}
          {data.executiveSummary?.whatTheyreKnownFor && (
            <div className="mb-3 p-2 bg-amber-50 border border-amber-100 rounded-lg">
              <div className="flex items-center gap-1 mb-1">
                <Sparkles className="w-3 h-3 text-amber-500" />
                <span className="text-xs font-bold text-amber-600">
                  Known For
                </span>
              </div>
              <p className="text-xs text-amber-900 line-clamp-2">
                {data.executiveSummary.whatTheyreKnownFor}
              </p>
            </div>
          )}

          {/* Circle of Influence (from adaptive enrichment) */}
          {data.circleOfInfluence && (data.circleOfInfluence.tier1?.length > 0 || data.circleOfInfluence.tier2?.length > 0) && (
            <div className="mb-3">
              <div className="flex items-center gap-1 mb-1.5">
                <Users className="w-3 h-3 text-content-secondary" />
                <span className="text-xs font-bold text-content-secondary">
                  Network
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {data.circleOfInfluence.tier1?.slice(0, 3).map((name, idx) => (
                  <span
                    key={`t1-${idx}`}
                    className="px-1.5 py-0.5 text-xs bg-indigo-100 text-content-secondary rounded"
                    title="Inner circle"
                  >
                    {name}
                  </span>
                ))}
                {data.circleOfInfluence.tier2?.slice(0, 2).map((name, idx) => (
                  <span
                    key={`t2-${idx}`}
                    className="px-1.5 py-0.5 text-xs bg-blue-50 text-blue-600 rounded"
                    title="Extended network"
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Timeline Highlight (from adaptive enrichment) */}
          {data.timelineHighlight && (
            <div className="mb-3 flex items-start gap-2 px-2 py-1.5 bg-surface-secondary rounded-lg border border-edge">
              <Calendar className="w-3.5 h-3.5 text-content-muted mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-xs text-content-secondary">{data.timelineHighlight.date}</div>
                <div className="text-xs text-content-secondary line-clamp-1">{data.timelineHighlight.title}</div>
              </div>
            </div>
          )}

          {/* Funding Info */}
          {data.funding?.totalRaised && (
            <div className="flex items-center gap-2 mb-3 px-2 py-1.5 bg-amber-50 rounded-lg border border-amber-100">
              <DollarSign className="w-4 h-4 text-amber-600" />
              <div className="flex-1">
                <div className="text-xs font-medium text-amber-800">
                  {data.funding.totalRaised}
                </div>
                {data.funding.lastRound && (
                  <div className="text-xs text-amber-600">
                    Last: {data.funding.lastRound}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Sources */}
          {data.sources && data.sources.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-bold text-content-secondary mb-1.5">
                Sources
              </div>
              <div className="flex flex-wrap gap-1.5">
                {data.sources.slice(0, 2).map((source, idx) => (
                  <span
                    key={idx}
                    className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${getCredibilityColor(source.credibility)}`}
                    title={`Credibility: ${source.credibility}`}
                  >
                    {source.credibility === "high" && <CheckCircle2 className="w-2.5 h-2.5" />}
                    {source.credibility === "low" && <AlertCircle className="w-2.5 h-2.5" />}
                    {source.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-2 pt-2 border-t border-edge">
            {data.dossierId ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onExplore?.(data);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>View Dossier</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onExplore?.(data);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${colors.text} ${colors.bg} hover:opacity-80 rounded-lg transition-colors`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>Explore</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
            {data.url && (
              <a
                href={data.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.stopPropagation();
                  onExternalClick?.(data.url!);
                }}
                className="flex items-center gap-1 px-2 py-1.5 text-xs text-content bg-surface-secondary hover:bg-surface-hover rounded-lg transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                <span className="truncate max-w-[80px]">
                  {data.url ? new URL(data.url).hostname.replace("www.", "") : "Link"}
                </span>
              </a>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/**
 * Loading state for the preview
 */
export const EntityHoverPreviewSkeleton: React.FC = () => (
  <div className="w-80 p-4 rounded-lg border border-edge bg-surface shadow-2xl">
    <div className="flex items-start gap-3 mb-3">
      <div className="w-10 h-10 rounded-lg bg-surface-secondary motion-safe:animate-pulse" />
      <div className="flex-1">
        <div className="h-4 w-24 bg-surface-secondary rounded motion-safe:animate-pulse mb-1.5" />
        <div className="h-3 w-16 bg-surface-secondary rounded motion-safe:animate-pulse" />
      </div>
    </div>
    <div className="space-y-2 mb-3">
      <div className="h-3 bg-surface-secondary rounded motion-safe:animate-pulse" />
      <div className="h-3 bg-surface-secondary rounded motion-safe:animate-pulse w-4/5" />
    </div>
    <div className="flex items-center gap-2">
      <Loader2 className="w-4 h-4 text-content-secondary motion-safe:animate-spin" />
      <span className="text-xs text-content-secondary">Loading enrichment...</span>
    </div>
  </div>
);

export default EntityHoverPreview;

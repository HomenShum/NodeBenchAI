"use client";

import React, { useState, useRef, useEffect, useId } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
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
} from "lucide-react";
import type { Entity, EntityType } from "../types/entitySchema";
import { EntityHoverPreview, EntityHoverPreviewSkeleton, type EntityHoverData } from "./EntityHoverPreview";
import { useEntityHoverData } from "../hooks/useEntityHoverData";

// Extended entity type including new digest types
type ExtendedEntityType = EntityType | "fda_approval" | "funding_event" | "research_paper";

// Extended Entity interface
interface ExtendedEntity extends Omit<Entity, "type"> {
  type: ExtendedEntityType;
}

interface EntityLinkProps {
  /** Entity data */
  entity: Entity | ExtendedEntity;
  /** Custom display name override */
  displayName?: string;
  /** Whether to show preview tooltip on hover */
  showPreview?: boolean;
  /** Callback when entity is clicked */
  onClick?: (entity: Entity | ExtendedEntity) => void;
  /** Pre-loaded enrichment data for medium-detail preview */
  preloadedEnrichment?: EntityHoverData;
  /** Whether to use medium-detail preview (with lazy loading) */
  useMediumPreview?: boolean;
  /** Custom class name */
  className?: string;
}

/**
 * Get icon for entity type (including extended types)
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
    // Extended types
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
 * Get color classes for entity type (including extended types)
 */
const getEntityColors = (type: ExtendedEntityType) => {
  switch (type) {
    case "company":
      return {
        text: "text-content-secondary",
        bg: "bg-surface-secondary hover:bg-surface-hover",
        border: "border-edge",
        icon: "text-indigo-600 dark:text-indigo-400",
        badge: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
      };
    case "person":
      return {
        text: "text-content",
        bg: "bg-surface-secondary hover:bg-surface-hover",
        border: "border-edge",
        icon: "text-indigo-600 dark:text-indigo-400",
        badge: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
      };
    case "product":
      return {
        text: "text-content",
        bg: "bg-indigo-500/10 hover:bg-indigo-500/10",
        border: "border-indigo-500/20",
        icon: "text-indigo-600 dark:text-indigo-400",
        badge: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
      };
    case "technology":
      return {
        text: "text-content",
        bg: "bg-indigo-500/10 hover:bg-indigo-500/10",
        border: "border-indigo-500/20",
        icon: "text-indigo-600 dark:text-indigo-400",
        badge: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
      };
    case "topic":
      return {
        text: "text-content-secondary",
        bg: "bg-surface-secondary hover:bg-surface-hover",
        border: "border-edge",
        icon: "text-content-secondary",
        badge: "bg-surface-secondary text-content-secondary",
      };
    case "region":
      return {
        text: "text-content-secondary",
        bg: "bg-surface-secondary hover:bg-surface-hover",
        border: "border-edge",
        icon: "text-content-secondary",
        badge: "bg-surface-secondary text-content-secondary",
      };
    case "event":
      return {
        text: "text-rose-700",
        bg: "bg-rose-50 hover:bg-rose-100",
        border: "border-rose-200",
        icon: "text-rose-500",
        badge: "bg-rose-100 text-rose-700",
      };
    case "metric":
      return {
        text: "text-cyan-700",
        bg: "bg-cyan-50 hover:bg-cyan-100",
        border: "border-cyan-200",
        icon: "text-cyan-500",
        badge: "bg-cyan-100 text-cyan-700",
      };
    case "document":
      return {
        text: "text-content",
        bg: "bg-surface-secondary hover:bg-surface-hover",
        border: "border-edge",
        icon: "text-content-secondary",
        badge: "bg-surface-secondary text-content",
      };
    // Extended types
    case "fda_approval":
      return {
        text: "text-green-700",
        bg: "bg-green-50 hover:bg-green-100",
        border: "border-green-200",
        icon: "text-green-500",
        badge: "bg-green-100 text-green-700",
      };
    case "funding_event":
      return {
        text: "text-content-secondary",
        bg: "bg-surface-secondary hover:bg-surface-hover",
        border: "border-edge",
        icon: "text-content-secondary",
        badge: "bg-surface-secondary text-content-secondary",
      };
    case "research_paper":
      return {
        text: "text-content",
        bg: "bg-indigo-500/10 hover:bg-indigo-500/10",
        border: "border-indigo-500/20",
        icon: "text-indigo-600 dark:text-indigo-400",
        badge: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
      };
    default:
      return {
        text: "text-content",
        bg: "bg-surface-secondary hover:bg-surface-hover",
        border: "border-edge",
        icon: "text-content-secondary",
        badge: "bg-surface-secondary text-content",
      };
  }
};

/**
 * Format extended entity type for display
 */
const formatEntityType = (type: ExtendedEntityType): string => {
  switch (type) {
    case "fda_approval":
      return "FDA Approval";
    case "funding_event":
      return "Funding";
    case "research_paper":
      return "Research";
    default:
      return type.charAt(0).toUpperCase() + type.slice(1);
  }
};

/**
 * EntityLink - AI-2027.com-inspired entity link with visual distinction
 *
 * Displays entities with type-specific styling, icons, and hover previews.
 * Supports internal dossier navigation and external links.
 * Now supports medium-detail preview with lazy loading for enriched entities.
 */
export const EntityLink: React.FC<EntityLinkProps> = ({
  entity,
  displayName,
  showPreview = true,
  onClick,
  preloadedEnrichment,
  useMediumPreview = false,
  className = "",
}) => {
  const { instant } = useMotionConfig();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const tooltipId = useId();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lazy load entity hover data if using medium preview
  const { data: hoverData, isLoading } = useEntityHoverData(
    entity.name,
    entity.type as ExtendedEntityType,
    {
      enabled: useMediumPreview && isHovering && !preloadedEnrichment,
      preloadedData: preloadedEnrichment,
    }
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleMouseEnter = () => {
    setIsHovering(true);
    if (!showPreview) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setIsOpen(true), useMediumPreview ? 300 : 250);
  };

  const handleMouseLeave = () => {
    setIsHovering(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setIsOpen(false), 100);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (onClick) {
      onClick(entity);
    } else if (entity.dossierId) {
      // Navigate to internal dossier
      window.location.href = `/documents/${entity.dossierId}`;
    } else if (entity.url) {
      window.open(entity.url, "_blank", "noopener,noreferrer");
    }
  };

  const handleExplore = (data: EntityHoverData) => {
    if (data.dossierId) {
      navigate(`/documents/${data.dossierId}`);
    } else {
      // Navigate to entity profile page
      navigate(`/entity/${encodeURIComponent(data.name)}`);
    }
  };

  const Icon = getEntityIcon(entity.type as ExtendedEntityType);
  const colors = getEntityColors(entity.type as ExtendedEntityType);
  const name = displayName || entity.name;

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <motion.button
        type="button"
        onClick={handleClick}
        className={`
          inline-flex items-center gap-1 px-1.5 py-0.5 rounded
          font-medium text-sm
          border-b-2 border-dashed
          transition-all duration-200
          focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-ring
          ${colors.text} ${colors.border}
          hover:${colors.bg}
          ${className}
        `}
        whileHover={!instant ? { scale: 1.02 } : undefined}
        whileTap={!instant ? { scale: 0.98 } : undefined}
        aria-describedby={showPreview ? tooltipId : undefined}
      >
        <Icon className={`w-3.5 h-3.5 ${colors.icon}`} />
        <span>{name}</span>
        {entity.ticker && (
          <span className="text-xs opacity-60">({entity.ticker})</span>
        )}
      </motion.button>

      {/* Interactive Popover - Medium Detail */}
      {showPreview && useMediumPreview && (
        <div
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {isLoading ? (
            <div className={`
              absolute left-0 top-full z-50 mt-2
              ${isOpen ? "opacity-100 visible" : "opacity-0 invisible"}
            `}>
              <EntityHoverPreviewSkeleton />
            </div>
          ) : hoverData ? (
            <EntityHoverPreview
              data={hoverData}
              isOpen={isOpen}
              onExplore={handleExplore}
            />
          ) : null}
        </div>
      )}

      {/* Interactive Popover - Basic (Legacy) */}
      {showPreview && !useMediumPreview && (
        <div
          id={tooltipId}
          role="tooltip"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className={`
            absolute left-1/2 -translate-x-1/2 top-full z-50
            w-72 mt-2 p-3
            rounded-lg border border-edge bg-surface shadow-xl ring-1 ring-black/5
            transition-all duration-200 origin-top
            ${isOpen ? "opacity-100 scale-100 visible pointer-events-auto" : "opacity-0 scale-95 invisible pointer-events-none"}
          `}
        >
          <div className="flex flex-col gap-2">
            {/* Header */}
            <div className="flex items-center gap-2">
              {entity.avatarUrl ? (
                <img
                  src={entity.avatarUrl}
                  alt={entity.name}
                  className="w-8 h-8 rounded-full object-cover"
                />
              ) : (
                <span className={`w-8 h-8 rounded-full flex items-center justify-center ${colors.bg}`}>
                  <Icon className={`w-4 h-4 ${colors.icon}`} />
                </span>
              )}
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-content text-sm block truncate">
                  {entity.name}
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${colors.badge}`}>
                  {formatEntityType(entity.type as ExtendedEntityType)}
                </span>
              </div>
            </div>

            {/* Description */}
            {entity.description && (
              <p className="text-sm text-content line-clamp-2">
                {entity.description}
              </p>
            )}

            {/* Action Buttons */}
            <div className="flex items-center gap-2 pt-2 border-t border-edge">
              {entity.dossierId ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.location.href = `/documents/${entity.dossierId}`;
                  }}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/10 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                >
                  <FileText className="w-3 h-3" />
                  <span>View Dossier</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Dispatch event to create a new dossier for this entity
                    window.dispatchEvent(new CustomEvent('entity:createDossier', {
                      detail: { entity }
                    }));
                  }}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-content-secondary bg-surface-secondary hover:bg-surface-hover rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                >
                  <FileText className="w-3 h-3" />
                  <span>Create Dossier</span>
                </button>
              )}
              {entity.url && (
                <a
                  href={entity.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-content bg-surface-secondary hover:bg-surface-hover rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span className="truncate max-w-[80px]">
                    {new URL(entity.url).hostname}
                  </span>
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </span>
  );
};

export default EntityLink;


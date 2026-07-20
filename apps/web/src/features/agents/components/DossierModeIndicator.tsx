"use client";

/**
 * DossierModeIndicator - Shows when Fast Agent is synced with a dossier
 * 
 * Displays:
 * - Current act indicator
 * - Focused data point (if any)
 * - Sync status (connected/disconnected)
 */

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link2, Link2Off, TrendingUp, BookOpen, Lightbulb, Target } from "lucide-react";
import { useFastAgentDossierMode } from "../context/FastAgentContext";
import { cn } from "@/lib/utils";
import { useMotionConfig } from "@/lib/motion";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface DossierModeIndicatorProps {
  /** Additional className */
  className?: string;
  /** Compact mode (icon only) */
  compact?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ACT_CONFIG = {
  actI: {
    label: "Quick Pulse",
    description: "Overview",
    icon: BookOpen,
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-950/30",
    borderColor: "border-blue-200 dark:border-blue-900/50",
  },
  actII: {
    label: "Analysis",
    description: "Deep Dive",
    icon: Target,
    color: "text-purple-600 dark:text-purple-400",
    bgColor: "bg-purple-50 dark:bg-purple-950/30",
    borderColor: "border-purple-200 dark:border-purple-900/50",
  },
  actIII: {
    label: "Deep Dive",
    description: "Implications",
    icon: Lightbulb,
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-50 dark:bg-amber-950/30",
    borderColor: "border-amber-200 dark:border-amber-900/50",
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export const DossierModeIndicator: React.FC<DossierModeIndicatorProps> = ({
  className,
  compact = false,
}) => {
  const { instant, transition } = useMotionConfig();
  const { isDossierMode, currentAct, chartContext, focusedDataIndex } = useFastAgentDossierMode();

  // Not in dossier mode - show disconnected state
  if (!isDossierMode) {
    if (compact) return null;
    
    return (
      <div className={cn(
        "flex items-center gap-1.5 px-2 py-1 rounded-md",
        "bg-slate-50 border border-slate-200 dark:border-white/[0.08] text-slate-400 dark:text-slate-500",
        "text-xs",
        className
      )}>
        <Link2Off className="w-3 h-3" />
        <span>No context</span>
      </div>
    );
  }

  const actConfig = ACT_CONFIG[currentAct];
  const ActIcon = actConfig.icon;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={currentAct}
        initial={{ opacity: instant ? 1 : 0, y: instant ? 0 : -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: instant ? 1 : 0, y: instant ? 0 : 4 }}
        transition={transition(0.2)}
        className={cn(
          "flex items-center gap-2 px-2.5 py-1.5 rounded-lg",
          "border shadow-sm",
          actConfig.bgColor,
          actConfig.borderColor,
          className
        )}
      >
        {/* Sync indicator */}
        <div className="flex items-center gap-1">
          <Link2 className={cn("w-3 h-3", actConfig.color)} />
          <span className={cn("text-xs font-medium", actConfig.color)}>
            Synced
          </span>
        </div>

        {/* Divider */}
        <div className="w-px h-4 bg-slate-200 dark:bg-white/[0.12]" />

        {/* Act indicator */}
        <div className="flex items-center gap-1.5">
          <ActIcon className={cn("w-3.5 h-3.5", actConfig.color)} />
          {!compact && (
            <span className={cn("text-xs font-medium", actConfig.color)}>
              {actConfig.label}
            </span>
          )}
        </div>

        {/* Focused data point (if any) */}
        {chartContext && (
          <>
            <div className="w-px h-4 bg-slate-200 dark:bg-white/[0.12]" />
            <div className="flex items-center gap-1">
              <TrendingUp className="w-3 h-3 text-slate-500 dark:text-slate-400" />
              <span className="text-xs text-slate-600 dark:text-slate-300 font-mono">
                {chartContext.dataLabel}: {chartContext.value}{chartContext.unit ?? ""}
              </span>
            </div>
          </>
        )}

        {/* Data index badge (if focused but no chart context) */}
        {focusedDataIndex !== null && !chartContext && (
          <>
            <div className="w-px h-4 bg-slate-200 dark:bg-white/[0.12]" />
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
              Point [{focusedDataIndex}]
            </span>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

export default DossierModeIndicator;


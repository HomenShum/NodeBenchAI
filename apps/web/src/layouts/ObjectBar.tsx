/**
 * ObjectBar — Sticky top bar showing current object, state, and mode.
 *
 * Inspired by modern AI-native business software (Gnomos, Linear, etc.)
 * Provides clear context about what object the user is working on.
 */

import React from "react";
import { Check, Cloud, Share2, Clock, Database, FileText, Briefcase } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";

export type ObjectState = "draft" | "saved" | "synced" | "syncing" | "error";
export type Mode = "quick" | "deep";

interface ObjectBarProps {
  /** Name of the current object/entity */
  objectName: string;
  /** Current state of the object */
  objectState: ObjectState;
  /** Current mode */
  mode: Mode;
  /** Called when mode changes */
  onModeChange?: (mode: Mode) => void;
  /** Sync status message (e.g., "Synced 5m ago") */
  syncStatus?: string;
  /** Number of sources backing this object */
  sourceCount?: number;
  /** Lens/role label (Investor, Founder, etc.) */
  lensLabel?: string;
  /** Compact mode for mobile */
  compact?: boolean;
  /** Whether left panel is collapsed */
  leftCollapsed?: boolean;
  /** Toggle left panel collapse */
  onLeftCollapseToggle?: () => void;
  /** Optional share handler */
  onShare?: () => void;
  /** Optional className */
  className?: string;
}

const stateConfig: Record<
  ObjectState,
  { icon: React.ElementType; label: string; color: string; bgColor: string }
> = {
  draft: {
    icon: FileText,
    label: "Draft",
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
  },
  saved: {
    icon: Check,
    label: "Saved",
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor: "bg-emerald-100 dark:bg-emerald-900/30",
  },
  synced: {
    icon: Cloud,
    label: "Synced",
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
  },
  syncing: {
    icon: Clock,
    label: "Syncing...",
    color: "text-slate-600 dark:text-slate-400",
    bgColor: "bg-slate-100 dark:bg-slate-800",
  },
  error: {
    icon: Database,
    label: "Error",
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-100 dark:bg-red-900/30",
  },
};

export function ObjectBar({
  objectName,
  objectState,
  mode,
  onModeChange,
  syncStatus,
  sourceCount,
  lensLabel,
  compact = false,
  leftCollapsed,
  onLeftCollapseToggle,
  onShare,
  className,
}: ObjectBarProps) {
  const state = stateConfig[objectState];
  const StateIcon = state.icon;

  if (compact) {
    // Mobile compact version
    return (
      <div
        className={cn(
          "flex items-center justify-between px-3 py-2 border-b border-border/50 bg-background/95 backdrop-blur-sm",
          className
        )}
      >
        {/* Left: Object name */}
        <div className="flex items-center gap-2 min-w-0">
          <Briefcase className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="font-medium text-sm truncate">{objectName}</span>
          <span
            className={cn(
              "text-xs px-1.5 py-0.5 rounded-full shrink-0",
              state.bgColor,
              state.color
            )}
          >
            {state.label}
          </span>
        </div>

        {/* Right: Mode toggle (compact) */}
        <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
          <button
            onClick={() => onModeChange?.("quick")}
            className={cn(
              "px-2 py-1 text-xs font-medium rounded-md transition-all",
              mode === "quick"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Quick
          </button>
          <button
            onClick={() => onModeChange?.("deep")}
            className={cn(
              "px-2 py-1 text-xs font-medium rounded-md transition-all",
              mode === "deep"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Deep
          </button>
        </div>
      </div>
    );
  }

  // Desktop full version
  return (
    <div
      className={cn(
        "flex items-center justify-between px-4 py-3 border-b border-border/50 bg-background/95 backdrop-blur-sm shrink-0",
        className
      )}
    >
      {/* Left section: Object info */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {/* Collapse toggle */}
        {leftCollapsed !== undefined && onLeftCollapseToggle && (
          <button
            onClick={onLeftCollapseToggle}
            className="p-1.5 hover:bg-muted rounded-md transition-colors"
            aria-label={leftCollapsed ? "Expand chat" : "Collapse chat"}
          >
            <svg
              className={cn(
                "w-4 h-4 text-muted-foreground transition-transform",
                leftCollapsed && "rotate-180"
              )}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 17l-5-5 5-5M19 17l-5-5 5-5"
              />
            </svg>
          </button>
        )}

        {/* Object icon */}
        <div className="p-2 bg-primary/10 rounded-lg shrink-0">
          <Briefcase className="w-4 h-4 text-primary" />
        </div>

        {/* Object name and state */}
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="font-semibold text-base truncate">{objectName}</h1>
          <div
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium shrink-0",
              state.bgColor,
              state.color
            )}
          >
            <StateIcon className="w-3 h-3" />
            <span>{state.label}</span>
          </div>
          {lensLabel && (
            <span className="text-xs text-muted-foreground px-2 py-0.5 bg-muted rounded-full shrink-0">
              {lensLabel}
            </span>
          )}
        </div>
      </div>

      {/* Center: Mode toggle */}
      <div className="flex items-center justify-center flex-1">
        <div className="flex items-center gap-1 bg-muted/80 rounded-xl p-1">
          <button
            onClick={() => onModeChange?.("quick")}
            className={cn(
              "px-4 py-1.5 text-sm font-medium rounded-lg transition-all duration-200",
              mode === "quick"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Quick
          </button>
          <button
            onClick={() => onModeChange?.("deep")}
            className={cn(
              "px-4 py-1.5 text-sm font-medium rounded-lg transition-all duration-200",
              mode === "deep"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Deep
          </button>
        </div>
      </div>

      {/* Right: Status and actions */}
      <div className="flex items-center gap-3 justify-end flex-1">
        {/* Source count */}
        {sourceCount !== undefined && sourceCount > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Database className="w-3.5 h-3.5" />
            <span>
              {sourceCount} source{sourceCount !== 1 ? "s" : ""}
            </span>
          </div>
        )}

        {/* Sync status */}
        {syncStatus && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            <span>{syncStatus}</span>
          </div>
        )}

        {/* Share button */}
        {onShare && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onShare}
            className="gap-1.5"
          >
            <Share2 className="w-4 h-4" />
            <span className="hidden sm:inline">Share</span>
          </Button>
        )}
      </div>
    </div>
  );
}

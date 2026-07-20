/**
 * ObjectFirstToggle — UI toggle for switching between legacy and object-first layout.
 *
 * A floating pill toggle that appears in the bottom-right corner on supported surfaces.
 * Persists preference via localStorage feature flags.
 */

import React, { useState, useEffect, useCallback } from "react";
import { LayoutTemplate, Columns } from "lucide-react";
import { cn } from "@/lib/utils";
import { setFeatureFlag, getFeatureFlag, type FeatureFlag } from "@/lib/featureFlags";

interface ObjectFirstToggleProps {
  /** Which surface this toggle controls */
  surfaceFlag: FeatureFlag;
  /** Optional className for positioning */
  className?: string;
  /** Whether to show label text alongside icon */
  showLabel?: boolean;
}

/**
 * Floating toggle button for switching layout modes.
 *
 * Usage:
 * ```tsx
 * <ObjectFirstToggle surfaceFlag="object-first-chat" />
 * ```
 */
export function ObjectFirstToggle({
  surfaceFlag,
  className,
  showLabel = false,
}: ObjectFirstToggleProps) {
  const [enabled, setEnabled] = useState(() => getFeatureFlag(surfaceFlag));
  const [isHovered, setIsHovered] = useState(false);

  // Sync with external changes (e.g. from localStorage in another tab)
  useEffect(() => {
    const handleStorage = () => {
      setEnabled(getFeatureFlag(surfaceFlag));
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [surfaceFlag]);

  const handleToggle = useCallback(() => {
    const next = !enabled;
    setFeatureFlag(surfaceFlag, next);
    setEnabled(next);

    // Reload to ensure clean state transition between layout modes
    window.location.reload();
  }, [enabled, surfaceFlag]);

  return (
    <button
      onClick={handleToggle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        "flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium transition-all duration-200 shadow-lg border",
        enabled
          ? "bg-primary text-primary-foreground border-primary/20 hover:bg-primary/90"
          : "bg-background text-foreground border-border/50 hover:bg-muted",
        className
      )}
      aria-pressed={enabled}
      aria-label={enabled ? "Switch to legacy layout" : "Switch to object-first layout"}
      title={enabled ? "Object-first layout active — click to switch to legacy" : "Legacy layout — click to try object-first"}
    >
      {enabled ? (
        <Columns className="w-4 h-4" aria-hidden="true" />
      ) : (
        <LayoutTemplate className="w-4 h-4" aria-hidden="true" />
      )}
      {showLabel && (
        <span className="hidden sm:inline">
          {isHovered
            ? (enabled ? "Switch to legacy" : "Try object-first")
            : (enabled ? "Object-first" : "Legacy")}
        </span>
      )}
      {/* Dot indicator */}
      <span
        className={cn(
          "w-2 h-2 rounded-full transition-colors",
          enabled ? "bg-primary-foreground" : "bg-muted-foreground"
        )}
        aria-hidden="true"
      />
    </button>
  );
}

/**
 * Unified toggle that controls all object-first surfaces at once.
 */
export function ObjectFirstGlobalToggle({
  className,
  showLabel = true,
}: Omit<ObjectFirstToggleProps, "surfaceFlag">) {
  const [enabled, setEnabled] = useState(() =>
    getFeatureFlag("object-first-chat") ||
    getFeatureFlag("object-first-reports") ||
    getFeatureFlag("object-first-layout")
  );
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    const handleStorage = () => {
      setEnabled(
        getFeatureFlag("object-first-chat") ||
        getFeatureFlag("object-first-reports") ||
        getFeatureFlag("object-first-layout")
      );
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const handleToggle = useCallback(() => {
    const next = !enabled;
    // Set all object-first flags together
    setFeatureFlag("object-first-layout", next);
    setFeatureFlag("object-first-chat", next);
    setFeatureFlag("object-first-reports", next);
    setEnabled(next);
    window.location.reload();
  }, [enabled]);

  return (
    <button
      onClick={handleToggle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        "flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium transition-all duration-200 shadow-lg border",
        enabled
          ? "bg-primary text-primary-foreground border-primary/20 hover:bg-primary/90"
          : "bg-background text-foreground border-border/50 hover:bg-muted",
        className
      )}
      aria-pressed={enabled}
      aria-label={enabled ? "Switch to legacy layout" : "Switch to object-first layout"}
      title={enabled ? "Object-first active — click for legacy" : "Legacy layout — click for object-first"}
    >
      {enabled ? (
        <Columns className="w-4 h-4" aria-hidden="true" />
      ) : (
        <LayoutTemplate className="w-4 h-4" aria-hidden="true" />
      )}
      {showLabel && (
        <span className="hidden sm:inline">
          {isHovered
            ? (enabled ? "Switch to legacy" : "Try object-first")
            : (enabled ? "Object-first mode" : "Legacy mode")}
        </span>
      )}
      <span
        className={cn(
          "w-2 h-2 rounded-full transition-colors",
          enabled ? "bg-primary-foreground" : "bg-muted-foreground"
        )}
        aria-hidden="true"
      />
    </button>
  );
}

export default ObjectFirstGlobalToggle;

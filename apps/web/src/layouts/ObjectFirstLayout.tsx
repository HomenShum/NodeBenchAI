/**
 * ObjectFirstLayout — Two-column layout with object bar, chat lane, and artifact host.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ ObjectBar: Current entity/object + mode toggle + sync status            │
 * ├──────────────────┬────────────────────────────────────────────────────────┤
 * │  Chat Lane       │  Artifact Host                                        │
 * │  (collapsible)   │  (scrollable)                                         │
 * │                  │                                                       │
 * │  • Thread        │  • Report / Notebook / Entity view                    │
 * │  • Suggestions   │  • Tabs: Brief/Notebook/Sources/Activity            │
 * │  • Quick actions │  • Actions bar                                        │
 * │  • Composer      │                                                       │
 └──────────────────┴────────────────────────────────────────────────────────┘
 */

import React, { useState, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ObjectBar, type ObjectState } from "./ObjectBar";

interface ObjectFirstLayoutProps {
  /** Current object/entity name */
  objectName: string;
  /** Current object state */
  objectState: ObjectState;
  /** Quick or Deep mode */
  mode: "quick" | "deep";
  /** Called when mode changes */
  onModeChange?: (mode: "quick" | "deep") => void;
  /** Left panel content (chat/thread) */
  leftContent: React.ReactNode;
  /** Right panel content (artifact) */
  rightContent: React.ReactNode;
  /** Optional sync status message */
  syncStatus?: string;
  /** Optional source count */
  sourceCount?: number;
  /** Optional lens label (Investor, Founder, etc.) */
  lensLabel?: string;
  /** Optional className for styling */
  className?: string;
  /** Whether left panel is initially collapsed */
  defaultLeftCollapsed?: boolean;
  /** Called when collapse state changes */
  onLeftCollapseChange?: (collapsed: boolean) => void;
}

export function ObjectFirstLayout({
  objectName,
  objectState,
  mode,
  onModeChange,
  leftContent,
  rightContent,
  syncStatus,
  sourceCount,
  lensLabel,
  className,
  defaultLeftCollapsed = false,
  onLeftCollapseChange,
}: ObjectFirstLayoutProps) {
  const [leftCollapsed, setLeftCollapsed] = useState(defaultLeftCollapsed);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const handleCollapseToggle = useCallback(() => {
    const next = !leftCollapsed;
    setLeftCollapsed(next);
    onLeftCollapseChange?.(next);
  }, [leftCollapsed, onLeftCollapseChange]);

  // Mobile: Use legacy single-column layout
  // Object-first two-column is desktop-only to avoid conflicts with
  // CockpitLayout's mobile shell (MobileTabBar, swipe navigation, etc.)
  if (isMobile) {
    return (
      <div className={cn("flex flex-col h-full bg-background", className)}>
        {/* On mobile, render only the artifact content to avoid double headers */}
        <div className="flex-1 overflow-hidden">
          {rightContent}
        </div>
      </div>
    );
  }

  // Desktop/Tablet: Two-column layout
  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      {/* ObjectBar */}
      <ObjectBar
        objectName={objectName}
        objectState={objectState}
        mode={mode}
        onModeChange={onModeChange}
        syncStatus={syncStatus}
        sourceCount={sourceCount}
        lensLabel={lensLabel}
        leftCollapsed={leftCollapsed}
        onLeftCollapseToggle={handleCollapseToggle}
      />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Chat Lane */}
        <aside
          className={cn(
            "border-r border-border/50 bg-muted/20 flex flex-col transition-all duration-300 ease-out",
            leftCollapsed ? "w-12" : "w-[380px] min-w-[320px]"
          )}
        >
          {/* Collapse toggle button (visible when collapsed) */}
          {leftCollapsed && (
            <button
              onClick={handleCollapseToggle}
              className="p-3 hover:bg-muted transition-colors"
              aria-label="Expand chat panel"
            >
              <svg
                className="w-4 h-4 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 5l7 7-7 7M5 5l7 7-7 7"
                />
              </svg>
            </button>
          )}

          {/* Chat content */}
          <div
            className={cn(
              "flex-1 overflow-hidden",
              leftCollapsed && "opacity-0 pointer-events-none"
            )}
          >
            {leftContent}
          </div>
        </aside>

        {/* Right: Artifact Host */}
        <main className="flex-1 overflow-hidden bg-background">
          {rightContent}
        </main>
      </div>
    </div>
  );
}

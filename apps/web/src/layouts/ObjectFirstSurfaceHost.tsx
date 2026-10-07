/**
 * ObjectFirstSurfaceHost — Adapter component for integrating ObjectFirst layout into existing surfaces.
 *
 * Wraps legacy surface components with the new two-column object-first layout.
 * Provides a migration path without rewriting entire surfaces.
 */

import React, { useState, useCallback, useMemo, useEffect } from "react";
import { ObjectFirstLayout } from "./ObjectFirstLayout";
import { ChatLane } from "@/features/chat/components/ChatLane";
import { ArtifactHost } from "@/features/artifacts/components/ArtifactHost";
import type { ArtifactTab } from "@/features/artifacts/components/ArtifactTabs";
import type { LensId } from "@/features/controlPlane/components/searchTypes";
import type { ArtifactMode, ArtifactState } from "@/features/artifacts/context/ArtifactContext";
import { useFeatureFlag } from "@/lib/featureFlags";

// Message type for chat
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: Date;
  suggestions?: Array<{
    id: string;
    label: string;
    onClick: () => void;
  }>;
}

// Props for the adapter
interface ObjectFirstSurfaceHostProps {
  /** Surface identifier */
  surfaceId: string;
  /** Current entity/object being viewed */
  entityName: string;
  /** Entity state */
  entityState?: ArtifactState;
  /** Current mode (quick/deep) */
  mode?: ArtifactMode;
  /** Mode change handler */
  onModeChange?: (mode: ArtifactMode) => void;
  /** Sync status message */
  syncStatus?: string;
  /** Source count */
  sourceCount?: number;
  /** Current lens */
  lens?: LensId;
  /** Lens change handler */
  onLensChange?: (lens: LensId) => void;
  /** Chat messages */
  messages?: ChatMessage[];
  /** Whether chat is loading */
  isLoading?: boolean;
  /** Input value for composer */
  inputValue?: string;
  /** Input change handler */
  onInputChange?: (value: string) => void;
  /** Submit handler */
  onSubmit?: () => void;
  /** Quick actions for chat */
  quickActions?: Array<{
    id: string;
    label: string;
    onClick: () => void;
  }>;
  /** Current artifact tab */
  activeTab?: ArtifactTab;
  /** Tab change handler */
  onTabChange?: (tab: ArtifactTab) => void;
  /** Artifact content props */
  artifactTitle?: string;
  artifactType?: "report" | "notebook" | "entity" | "draft";
  artifactSections?: Array<{
    id: string;
    title: string;
    content: string;
    confidence?: "high" | "medium" | "low";
    sourceCount?: number;
  }>;
  artifactSources?: Array<{
    id: string;
    title: string;
    domain: string;
    confidence: number;
    url?: string;
  }>;
  artifactActivity?: Array<{
    id: string;
    type: "created" | "updated" | "synced" | "exported";
    description: string;
    timestamp: Date;
  }>;
  artifactFiles?: Array<{
    id: string;
    name: string;
    type: string;
    size: string;
  }>;
  lastUpdated?: Date;
  confidenceScore?: number;
  isTracked?: boolean;
  onTrackToggle?: () => void;
  onShare?: () => void;
  onExport?: (format: "pdf" | "csv" | "notion") => void;
  /** Children for legacy fallback */
  children?: React.ReactNode;
  /** Whether to show empty state */
  isEmpty?: boolean;
}

/**
 * ObjectFirstSurfaceHost — Wraps surfaces with the new object-first layout.
 *
 * Usage:
 * ```tsx
 * <ObjectFirstSurfaceHost
 *   surfaceId="workspace"
 *   entityName="Stripe"
 *   messages={messages}
 *   inputValue={input}
 *   onInputChange={setInput}
 *   onSubmit={handleSubmit}
 *   activeTab="brief"
 *   onTabChange={setTab}
 *   artifactTitle="Stripe Research"
 *   artifactSections={sections}
 * >
 *   <LegacyChatHome /> // Fallback for non-object-first mode
 * </ObjectFirstSurfaceHost>
 * ```
 */
export function ObjectFirstSurfaceHost({
  surfaceId,
  entityName,
  entityState = "draft",
  mode = "quick",
  onModeChange,
  syncStatus,
  sourceCount = 0,
  lens = "founder",
  onLensChange,
  messages,
  isLoading,
  inputValue,
  onInputChange,
  onSubmit,
  quickActions,
  activeTab,
  onTabChange,
  artifactTitle,
  artifactType = "draft",
  artifactSections,
  artifactSources,
  artifactActivity,
  artifactFiles,
  lastUpdated,
  confidenceScore,
  isTracked,
  onTrackToggle,
  onShare,
  onExport,
  children,
  isEmpty = false,
}: ObjectFirstSurfaceHostProps) {
  // Mobile detection - ObjectFirst is desktop-only
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Object-first layout is ONLY for workspace (chat) and packets (reports) surfaces
  // Ask/home surface should always use legacy layout
  const isObjectFirstSurface = surfaceId === "workspace" || surfaceId === "packets";

  // Check feature flag for this specific surface
  const flagKey = surfaceId === "workspace"
    ? "object-first-chat"
    : surfaceId === "packets"
    ? "object-first-reports"
    : "object-first-layout" as const;
  const objectFirstEnabled = useFeatureFlag(flagKey) && isObjectFirstSurface;

  // Left panel collapse state
  const [leftCollapsed, setLeftCollapsed] = useState(false);

  // Handle lens change with default
  const handleLensChange = useCallback(
    (newLens: LensId) => {
      onLensChange?.(newLens);
    },
    [onLensChange]
  );

  // Handle mode change with default
  const handleModeChange = useCallback(
    (newMode: ArtifactMode) => {
      onModeChange?.(newMode);
    },
    [onModeChange]
  );

  // If not an object-first surface OR not enabled OR on mobile, render children (legacy mode)
  // ObjectFirst is desktop-only to preserve CockpitLayout's mobile shell
  if (!isObjectFirstSurface || !objectFirstEnabled || isMobile) {
    return <>{children}</>;
  }

  // Build lens label
  const lensLabel = useMemo(() => {
    const labels: Record<LensId, string> = {
      founder: "Founder lens",
      investor: "Investor lens",
      banker: "Banker lens",
      ceo: "CEO lens",
      legal: "Legal lens",
      student: "Student lens",
    };
    return labels[lens] ?? "Founder lens";
  }, [lens]);

  return (
    <ObjectFirstLayout
      objectName={entityName}
      objectState={entityState}
      mode={mode}
      onModeChange={handleModeChange}
      syncStatus={syncStatus}
      sourceCount={sourceCount}
      lensLabel={lensLabel}
      defaultLeftCollapsed={leftCollapsed}
      onLeftCollapseChange={setLeftCollapsed}
      leftContent={
        messages && onInputChange && onSubmit ? (
          <ChatLane
            threadTitle={`${entityName} Research`}
            messages={messages}
            isLoading={isLoading}
            quickActions={quickActions}
            inputValue={inputValue ?? ""}
            onInputChange={onInputChange}
            onSubmit={onSubmit}
            lens={lens}
            onLensChange={handleLensChange}
            placeholder={`Ask about ${entityName}...`}
            threadCollapsed={leftCollapsed}
            onThreadCollapse={() => setLeftCollapsed(!leftCollapsed)}
          />
        ) : (
          children ?? null
        )
      }
      rightContent={
        artifactTitle && onTabChange ? (
          <ArtifactHost
            title={artifactTitle}
            type={artifactType}
            activeTab={activeTab ?? "brief"}
            onTabChange={onTabChange}
            sections={artifactSections}
            sources={artifactSources}
            activity={artifactActivity}
            files={artifactFiles}
            lastUpdated={lastUpdated}
            confidenceScore={confidenceScore}
            isTracked={isTracked}
            onTrackToggle={onTrackToggle}
            onShare={onShare}
            onExport={onExport}
            isEmpty={isEmpty}
          />
        ) : (
          children ?? null
        )
      }
    />
  );
}

/**
 * Simplified wrapper for surfaces that only need the layout shell
 * without full chat/artifact integration.
 */
interface ObjectFirstShellProps {
  /** Surface identifier */
  surfaceId: string;
  /** Current entity/object being viewed */
  entityName: string;
  /** Entity state */
  entityState?: ArtifactState;
  /** Current mode */
  mode?: ArtifactMode;
  /** Mode change handler */
  onModeChange?: (mode: ArtifactMode) => void;
  /** Left panel content */
  leftContent: React.ReactNode;
  /** Right panel content (artifact area) */
  rightContent: React.ReactNode;
  /** Fallback children for legacy mode */
  children?: React.ReactNode;
  /** Additional className */
  className?: string;
}

export function ObjectFirstShell({
  surfaceId,
  entityName,
  entityState = "draft",
  mode = "quick",
  onModeChange,
  leftContent,
  rightContent,
  children,
  className,
}: ObjectFirstShellProps) {
  // Mobile detection - ObjectFirst is desktop-only
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Check feature flag
  const objectFirstEnabled = useFeatureFlag("object-first-layout");

  // If not enabled OR on mobile, render legacy children
  if (!objectFirstEnabled || isMobile) {
    return <>{children}</>;
  }

  return (
    <ObjectFirstLayout
      objectName={entityName}
      objectState={entityState}
      mode={mode}
      onModeChange={onModeChange}
      leftContent={leftContent}
      rightContent={rightContent}
      className={className}
    />
  );
}

export default ObjectFirstSurfaceHost;
